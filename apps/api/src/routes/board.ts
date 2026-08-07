import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

interface BoardRow {
  run_id: string;
  code: string;
  zone: string;
  kind: 'suite' | 'run' | 'playgroup';
  capacity: number;
  display_order: number;
  booking_id: string | null;
  service_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  pet_id: string | null;
  pet_name: string | null;
  breed: string | null;
  avatar_color: string | null;
  has_meds: boolean | null;
  is_new_client: boolean | null;
  night_number: number | null;
  total_nights: number | null;
}

export async function boardRoutes(app: FastifyInstance): Promise<void> {
  // Live facility board: every run/playgroup with today's occupants.
  app.get('/board', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query<BoardRow>(
        `SELECT
           r.id AS run_id, r.code, r.zone, r.kind, r.capacity, r.display_order,
           b.id AS booking_id, b.service_type, b.status,
           b.start_date::text, b.end_date::text,
           p.id AS pet_id, p.name AS pet_name, p.breed, p.avatar_color,
           (p.medication_notes IS NOT NULL) AS has_meds,
           (c.created_at > now() - interval '30 days') AS is_new_client,
           CASE WHEN b.service_type = 'boarding'
                THEN (CURRENT_DATE - b.start_date) + 1 END AS night_number,
           CASE WHEN b.service_type = 'boarding'
                THEN (b.end_date - b.start_date) END AS total_nights
         FROM runs r
         LEFT JOIN bookings b
           ON b.run_id = r.id
          AND b.status IN ('confirmed', 'checked_in', 'checked_out')
          AND (
            (b.service_type = 'boarding'
              AND b.start_date <= CURRENT_DATE AND b.end_date >= CURRENT_DATE)
            OR (b.service_type = 'daycare' AND b.start_date = CURRENT_DATE)
          )
         LEFT JOIN pets p ON p.id = b.pet_id
         LEFT JOIN clients c ON c.id = b.client_id
         ORDER BY
           CASE r.kind WHEN 'suite' THEN 1 WHEN 'run' THEN 2 ELSE 3 END,
           r.zone, r.display_order, r.code, p.name`,
      );

      const byRun = new Map<string, {
        run: { id: string; code: string; zone: string; kind: string; capacity: number };
        occupants: unknown[];
      }>();
      for (const row of rows) {
        let cell = byRun.get(row.run_id);
        if (!cell) {
          cell = {
            run: {
              id: row.run_id,
              code: row.code,
              zone: row.zone,
              kind: row.kind,
              capacity: row.capacity,
            },
            occupants: [],
          };
          byRun.set(row.run_id, cell);
        }
        if (row.booking_id) {
          cell.occupants.push({
            bookingId: row.booking_id,
            serviceType: row.service_type,
            status: row.status,
            startDate: row.start_date,
            endDate: row.end_date,
            petId: row.pet_id,
            petName: row.pet_name,
            breed: row.breed,
            avatarColor: row.avatar_color,
            hasMeds: row.has_meds,
            isNewClient: row.is_new_client,
            nightNumber: row.night_number,
            totalNights: row.total_nights,
          });
        }
      }
      return { cells: [...byRun.values()] };
    });
  });

  // Check-in / check-out state transitions from the board.
  app.post<{
    Params: { bookingId: string };
    Body: {
      staffName?: string;
      belongings?: string;
      feedingConfirmed?: boolean;
      medsConfirmed?: boolean;
      vaccinesVerified?: boolean;
      signatureCaptured?: boolean;
    };
  }>('/bookings/:bookingId/check-in', async (req, reply) => {
    const b = req.body ?? {};
    // Summarise the front-desk checklist onto the check-in event so the audit
    // trail records what was actually confirmed at drop-off.
    const confirmed = [
      b.vaccinesVerified ? 'vaccines verified' : null,
      b.feedingConfirmed ? 'feeding plan confirmed' : null,
      b.medsConfirmed ? 'medication confirmed' : null,
      b.signatureCaptured ? 'owner signature captured' : null,
    ].filter(Boolean);
    const parts = [
      confirmed.length ? `Checklist: ${confirmed.join(', ')}.` : null,
      b.belongings?.trim() ? `Belongings: ${b.belongings.trim()}.` : null,
    ].filter(Boolean);

    return transition(
      req.tenant.schemaName,
      req.params.bookingId,
      'checked_in',
      'checkin',
      b.staffName,
      reply,
      parts.length ? parts.join(' ') : undefined,
    );
  });
  app.post<{ Params: { bookingId: string }; Body: { staffName?: string } }>(
    '/bookings/:bookingId/check-out',
    async (req, reply) => {
      return transition(req.tenant.schemaName, req.params.bookingId, 'checked_out', 'checkout',
        req.body?.staffName, reply);
    },
  );
}

async function transition(
  schemaName: string,
  bookingId: string,
  status: 'checked_in' | 'checked_out',
  eventType: 'checkin' | 'checkout',
  staffName: string | undefined,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  note?: string,
) {
  // Legal transitions only: confirmed/requested → checked_in → checked_out.
  const allowedFrom = status === 'checked_in' ? ['requested', 'confirmed'] : ['checked_in'];
  return withTenant(schemaName, async (db) => {
    const { rows } = await db.query(
      `UPDATE bookings SET status = $2
       WHERE id = $1 AND status = ANY($3)
       RETURNING id, pet_id, status`,
      [bookingId, status, allowedFrom],
    );
    if (!rows[0]) {
      return reply.code(409).send({ error: `Booking is not in a state that allows ${status}` });
    }
    await db.query(
      `INSERT INTO care_events (booking_id, pet_id, type, staff_name, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookingId, rows[0].pet_id, eventType, staffName ?? null, note ?? null],
    );
    return { id: rows[0].id, status: rows[0].status };
  });
}

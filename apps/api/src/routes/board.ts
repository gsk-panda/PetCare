import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

export interface StayMedicationInput {
  name: string;
  dose?: string;
  schedule?: string;
  withFood?: boolean;
  notes?: string;
}

export interface StayIntakeInput {
  belongings?: string;
  collarType?: string;
  foodSource?: 'owner' | 'house';
  foodDescription?: string;
  feedingAmount?: string;
  feedingTimes?: string[];
  bowlType?: string;
  treatsAllowed?: boolean;
  treatsNotes?: string;
  bonesAllowed?: boolean;
  bonesNotes?: string;
  medications?: StayMedicationInput[];
}

interface CheckInBody {
  staffName?: string;
  vaccinesVerified?: boolean;
  feedingConfirmed?: boolean;
  medsConfirmed?: boolean;
  signatureCaptured?: boolean;
  allergiesChecked?: boolean;
  intake?: StayIntakeInput;
  /** Extras agreed at drop-off; billed at check-out. */
  serviceItemIds?: string[];
}

interface BoardRow {
  run_id: string;
  code: string;
  label: string | null;
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
  is_first_stay: boolean | null;
  night_number: number | null;
  total_nights: number | null;
}

export async function boardRoutes(app: FastifyInstance): Promise<void> {
  // The facility board for a given day. Defaults to today, but the desk needs
  // to look ahead at tomorrow's arrivals and back at what happened yesterday.
  app.get<{ Querystring: { date?: string } }>('/board', async (req, reply) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query<BoardRow>(
        `SELECT
           r.id AS run_id, r.code, r.label, r.zone, r.kind, r.capacity, r.display_order,
           b.id AS booking_id, b.service_type, b.status,
           b.start_date::text, b.end_date::text,
           p.id AS pet_id, p.name AS pet_name, p.breed, p.avatar_color,
           (p.medication_notes IS NOT NULL) AS has_meds,
           (c.created_at > now() - interval '30 days') AS is_new_client,
           -- A returning client's second dog is still a first-time boarder,
           -- so this asks about the pet's history, not the account's age.
           NOT EXISTS (
             SELECT 1 FROM bookings prior
             WHERE prior.pet_id = p.id AND prior.status = 'checked_out'
               AND prior.id <> b.id
           ) AS is_first_stay,
           CASE WHEN b.service_type = 'boarding'
                THEN ($1::date - b.start_date) + 1 END AS night_number,
           CASE WHEN b.service_type = 'boarding'
                THEN (b.end_date - b.start_date) END AS total_nights
         FROM runs r
         LEFT JOIN bookings b
           ON b.run_id = r.id
          AND b.status IN ('requested', 'confirmed', 'checked_in', 'checked_out')
          AND (
            (b.service_type = 'boarding'
              AND b.start_date <= $1::date AND b.end_date >= $1::date)
            OR (b.service_type = 'daycare' AND b.start_date = $1::date)
          )
         LEFT JOIN pets p ON p.id = b.pet_id
         LEFT JOIN clients c ON c.id = b.client_id
         WHERE r.active
         ORDER BY
           CASE r.kind WHEN 'suite' THEN 1 WHEN 'run' THEN 2 ELSE 3 END,
           r.zone, r.display_order, r.code_prefix, r.code_number, r.code, p.name`,
        [date],
      );

      const byRun = new Map<string, {
        run: {
          id: string; code: string; label: string; zone: string;
          kind: string; capacity: number;
        };
        occupants: unknown[];
      }>();
      for (const row of rows) {
        let cell = byRun.get(row.run_id);
        if (!cell) {
          cell = {
            run: {
              id: row.run_id,
              code: row.code,
              // Play groups are named by the facility ("Small dogs"); the code
              // is an internal key and should not be what staff read.
              label: row.label ?? row.code,
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
            isFirstStay: row.is_first_stay,
            nightNumber: row.night_number,
            totalNights: row.total_nights,
          });
        }
      }
      return { date, cells: [...byRun.values()] };
    });
  });

  // Check-in captures the drop-off intake alongside the state change: what the
  // owner brought, how this pet eats on this stay, and the medication schedule.
  app.post<{
    Params: { bookingId: string };
    Body: CheckInBody;
  }>('/bookings/:bookingId/check-in', async (req, reply) => {
    const b = req.body ?? {};
    const intake = b.intake;

    const meds = (intake?.medications ?? [])
      .filter((m) => m.name?.trim())
      .map((m) => ({
        name: m.name.trim(),
        dose: m.dose?.trim() || null,
        schedule: m.schedule?.trim() || 'AM',
        withFood: m.withFood ?? true,
        notes: m.notes?.trim() || null,
      }));

    // Summarise the checklist onto the care event so the audit trail records
    // what was confirmed, while the structured detail goes to stay_intake.
    const confirmed = [
      b.vaccinesVerified ? 'vaccines verified' : null,
      b.allergiesChecked ? 'allergies confirmed' : null,
      b.feedingConfirmed ? 'feeding plan confirmed' : null,
      b.medsConfirmed ? 'medication confirmed' : null,
      b.signatureCaptured ? 'owner signature captured' : null,
    ].filter(Boolean);
    const parts = [
      confirmed.length ? `Checklist: ${confirmed.join(', ')}.` : null,
      intake?.belongings?.trim() ? `Belongings: ${intake.belongings.trim()}.` : null,
      meds.length ? `${meds.length} medication${meds.length === 1 ? '' : 's'} scheduled.` : null,
      b.serviceItemIds?.length
        ? `${b.serviceItemIds.length} extra${b.serviceItemIds.length === 1 ? '' : 's'} booked.`
        : null,
    ].filter(Boolean);

    return withTenant(req.tenant.schemaName, async (db) => {
      await db.query('BEGIN');
      try {
        const { rows } = await db.query(
          `UPDATE bookings SET status = 'checked_in'
           WHERE id = $1 AND status IN ('requested', 'confirmed')
           RETURNING id, pet_id`,
          [req.params.bookingId],
        );
        if (!rows[0]) {
          await db.query('ROLLBACK');
          return reply.code(409).send({ error: 'Booking is not awaiting check-in' });
        }

        // Attribution comes from the session, never the request body: a log
        // the caller can name themselves in is not an audit trail.
        await db.query(
          `INSERT INTO care_events (booking_id, pet_id, type, staff_name, staff_id, note)
           VALUES ($1, $2, 'checkin', $3, $4, $5)`,
          [rows[0].id, rows[0].pet_id, req.staff.name, req.staff.id, parts.join(' ') || null],
        );

        if (intake) {
          await db.query(
            `INSERT INTO stay_intake (
               booking_id, belongings, collar_type, food_source, food_description,
               feeding_amount, feeding_times, bowl_type, treats_allowed, treats_notes,
               bones_allowed, bones_notes, recorded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (booking_id) DO UPDATE SET
               belongings = EXCLUDED.belongings,
               collar_type = EXCLUDED.collar_type,
               food_source = EXCLUDED.food_source,
               food_description = EXCLUDED.food_description,
               feeding_amount = EXCLUDED.feeding_amount,
               feeding_times = EXCLUDED.feeding_times,
               bowl_type = EXCLUDED.bowl_type,
               treats_allowed = EXCLUDED.treats_allowed,
               treats_notes = EXCLUDED.treats_notes,
               bones_allowed = EXCLUDED.bones_allowed,
               bones_notes = EXCLUDED.bones_notes,
               recorded_by = EXCLUDED.recorded_by,
               recorded_at = now()`,
            [
              rows[0].id,
              intake.belongings?.trim() || null,
              intake.collarType?.trim() || null,
              intake.foodSource === 'house' || intake.foodSource === 'owner'
                ? intake.foodSource
                : null,
              intake.foodDescription?.trim() || null,
              intake.feedingAmount?.trim() || null,
              intake.feedingTimes ?? [],
              intake.bowlType?.trim() || null,
              intake.treatsAllowed ?? true,
              intake.treatsNotes?.trim() || null,
              intake.bonesAllowed ?? false,
              intake.bonesNotes?.trim() || null,
              b.staffName ?? null,
            ],
          );

          // Snapshot name and price so a later price change in Settings does
          // not silently re-price what the owner was quoted at the door.
          const wanted = b.serviceItemIds ?? [];
          await db.query('DELETE FROM booking_services WHERE booking_id = $1', [rows[0].id]);
          if (wanted.length > 0) {
            await db.query(
              `INSERT INTO booking_services
                 (booking_id, service_item_id, name, unit_cents, taxable, added_by)
               SELECT $1, si.id, si.name, si.price_cents, si.taxable, $3
               FROM service_items si
               WHERE si.id = ANY($2) AND si.active`,
              [rows[0].id, wanted, req.staff.id],
            );
          }

          await db.query('DELETE FROM stay_medications WHERE booking_id = $1', [rows[0].id]);
          for (const m of meds) {
            await db.query(
              `INSERT INTO stay_medications (booking_id, name, dose, schedule, with_food, notes)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [rows[0].id, m.name, m.dose, m.schedule, m.withFood, m.notes],
            );
          }
        }

        await db.query('COMMIT');
        return { id: rows[0].id, status: 'checked_in', medications: meds.length };
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    });
  });
  app.post<{ Params: { bookingId: string } }>(
    '/bookings/:bookingId/check-out',
    async (req, reply) => {
      return transition(req.tenant.schemaName, req.params.bookingId, 'checked_out', 'checkout',
        req.staff, reply);
    },
  );
}

async function transition(
  schemaName: string,
  bookingId: string,
  status: 'checked_in' | 'checked_out',
  eventType: 'checkin' | 'checkout',
  staff: { id: string; name: string },
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
      `INSERT INTO care_events (booking_id, pet_id, type, staff_name, staff_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, rows[0].pet_id, eventType, staff.name, staff.id, note ?? null],
    );
    return { id: rows[0].id, status: rows[0].status };
  });
}

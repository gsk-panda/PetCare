import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

/**
 * Vaccine expiries that need a human. Two distinct problems live here:
 *
 *  - expiring soon (default 30 days) — chase the owner for an updated record;
 *  - expiring *during a booked stay* — the pet arrives compliant and stops
 *    being compliant mid-stay, which is the case that actually bites, because
 *    a check-in-time check alone will happily wave it through.
 */
export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { withinDays?: string } }>('/alerts/vaccines', async (req, reply) => {
    const withinDays = Number(req.query.withinDays ?? 30);
    if (!Number.isFinite(withinDays) || withinDays < 0 || withinDays > 365) {
      return reply.code(400).send({ error: 'withinDays must be between 0 and 365' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT v.id, v.vaccine, v.expires_on::text AS expires_on, v.verified,
                (v.expires_on - facility_today())::int AS days_left,
                p.id AS pet_id, p.name AS pet_name, p.avatar_color,
                c.first_name || ' ' || c.last_name AS client_name,
                c.phone AS client_phone,
                s.id AS booking_id, s.start_date::text AS start_date,
                s.end_date::text AS end_date, s.status AS booking_status,
                r.code AS run_code
         FROM vaccinations v
         JOIN pets p ON p.id = v.pet_id
         JOIN clients c ON c.id = p.client_id
         LEFT JOIN LATERAL (
           SELECT b.id, b.start_date, b.end_date, b.status, b.run_id
           FROM bookings b
           WHERE b.pet_id = p.id
             AND b.status IN ('requested', 'confirmed', 'checked_in')
             AND b.end_date >= facility_today()
             AND v.expires_on <= b.end_date
           ORDER BY b.start_date
           LIMIT 1
         ) s ON true
         LEFT JOIN runs r ON r.id = s.run_id
         WHERE v.expires_on <= facility_today() + $1::int
         ORDER BY v.expires_on, p.name`,
        [withinDays],
      );

      const alerts = rows.map((r) => {
        const expiresDuringStay =
          Boolean(r.booking_id) && r.expires_on >= r.start_date && r.expires_on <= r.end_date;
        return {
          id: r.id,
          vaccine: r.vaccine,
          expiresOn: r.expires_on,
          daysLeft: r.days_left,
          expired: r.days_left < 0,
          verified: r.verified,
          petId: r.pet_id,
          petName: r.pet_name,
          avatarColor: r.avatar_color,
          clientName: r.client_name,
          clientPhone: r.client_phone,
          stay: r.booking_id
            ? {
                bookingId: r.booking_id,
                startDate: r.start_date,
                endDate: r.end_date,
                status: r.booking_status,
                runCode: r.run_code,
              }
            : null,
          expiresDuringStay,
        };
      });

      return {
        withinDays,
        alerts,
        summary: {
          total: alerts.length,
          expired: alerts.filter((a) => a.expired).length,
          duringStay: alerts.filter((a) => a.expiresDuringStay).length,
        },
      };
    });
  });
}

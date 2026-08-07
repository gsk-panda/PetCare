import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

/**
 * Per-day capacity math for the scheduling calendar. Pending (`requested`)
 * bookings count toward the booked total so the desk never oversells a weekend
 * while requests sit unreviewed.
 */
export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string } }>('/calendar', async (req, reply) => {
    const from = req.query.from ?? new Date().toISOString().slice(0, 10);
    const to = req.query.to ?? from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return reply.code(400).send({ error: 'from/to must be YYYY-MM-DD' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      // Sequential, not Promise.all: these share one pooled client, and a pg
      // client cannot run queries concurrently.
      // Boarding capacity is kennels/suites; daycare capacity is play-group slots.
      const capacityRes = await db.query(
        `SELECT
           COALESCE(SUM(capacity) FILTER (WHERE kind IN ('suite', 'run')), 0)::int AS boarding,
           COALESCE(SUM(capacity) FILTER (WHERE kind = 'playgroup'), 0)::int AS daycare
         FROM runs`,
      );
      const daysRes = await db.query(
        // `boarding`/`daycare` are confirmed occupancy; `pending` is counted
        // separately so callers can add the two without double-counting.
        `SELECT d::date AS date,
             COUNT(*) FILTER (
               WHERE b.service_type = 'boarding'
                 AND b.status IN ('confirmed', 'checked_in', 'checked_out')
                 AND b.start_date <= d AND b.end_date > d
             )::int AS boarding,
             COUNT(*) FILTER (
               WHERE b.service_type = 'daycare'
                 AND b.status IN ('confirmed', 'checked_in', 'checked_out')
                 AND b.start_date = d
             )::int AS daycare,
             COUNT(*) FILTER (
               WHERE b.status = 'requested'
                 AND ((b.service_type = 'boarding'
                        AND b.start_date <= d AND b.end_date > d)
                   OR (b.service_type = 'daycare' AND b.start_date = d))
             )::int AS pending
           FROM generate_series($1::date, $2::date, interval '1 day') AS d
           LEFT JOIN bookings b ON true
           GROUP BY d ORDER BY d`,
        [from, to],
      );
      const bookingsRes = await db.query(
          `SELECT b.id, b.service_type, b.status,
                  b.start_date::text, b.end_date::text,
                  p.id AS pet_id, p.name AS pet_name, p.breed, p.avatar_color,
                  (p.medication_notes IS NOT NULL) AS has_meds,
                  c.first_name || ' ' || c.last_name AS client_name,
                  r.code AS run_code, r.label AS run_label
           FROM bookings b
           JOIN pets p ON p.id = b.pet_id
           JOIN clients c ON c.id = b.client_id
           LEFT JOIN runs r ON r.id = b.run_id
           WHERE b.status <> 'canceled'
             AND b.start_date <= $2::date AND b.end_date >= $1::date
           ORDER BY b.start_date, b.end_date DESC, p.name`,
        [from, to],
      );

      // Active play groups drive the daycare view's columns, so a single-group
      // facility renders one column rather than three mostly-empty ones.
      const groupsRes = await db.query(
        `SELECT id, code, label, capacity FROM runs
         WHERE kind = 'playgroup' AND active
         ORDER BY display_order, code`,
      );

      return {
        capacity: {
          boarding: capacityRes.rows[0].boarding,
          daycare: capacityRes.rows[0].daycare,
        },
        days: daysRes.rows.map((r) => ({
          date: r.date.toISOString().slice(0, 10),
          boarding: r.boarding,
          daycare: r.daycare,
          pending: r.pending,
        })),
        groups: groupsRes.rows.map((g) => ({
          id: g.id,
          code: g.code,
          label: g.label ?? g.code,
          capacity: g.capacity,
        })),
        bookings: bookingsRes.rows.map((b) => ({
          id: b.id,
          serviceType: b.service_type,
          status: b.status,
          petId: b.pet_id,
          hasMeds: b.has_meds,
          runLabel: b.run_label,
          startDate: b.start_date,
          endDate: b.end_date,
          petName: b.pet_name,
          breed: b.breed,
          avatarColor: b.avatar_color,
          clientName: b.client_name,
          runCode: b.run_code,
        })),
      };
    });
  });
}

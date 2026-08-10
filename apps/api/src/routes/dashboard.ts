import type { FastifyInstance } from 'fastify';
import type { DashboardStats } from '@petcare/shared';
import { withTenant } from '../db.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async (req): Promise<DashboardStats> => {
    return withTenant(req.tenant.schemaName, async (db) => {
      // Sequential, not Promise.all: these share one pooled client, and a pg
      // client cannot run queries concurrently.
      const capacityRes = await db.query(
        `SELECT COALESCE(SUM(capacity), 0)::int AS capacity
         FROM runs WHERE kind IN ('suite', 'run')`,
      );
      const occupiedRes = await db.query(
        `SELECT COUNT(*)::int AS n FROM bookings
         WHERE service_type = 'boarding'
           AND status IN ('confirmed', 'checked_in')
           AND start_date <= facility_today() AND end_date > facility_today()`,
      );
      const daycareRes = await db.query(
        `SELECT COUNT(*)::int AS n FROM bookings
         WHERE service_type = 'daycare'
           AND status IN ('confirmed', 'checked_in')
           AND start_date = facility_today()`,
      );
      const arrivalsRes = await db.query(
        `SELECT COUNT(*)::int AS n FROM bookings
         WHERE start_date = facility_today()
           AND status IN ('requested', 'confirmed', 'checked_in')`,
      );
      const departuresRes = await db.query(
        `SELECT COUNT(*)::int AS n FROM bookings
         WHERE service_type = 'boarding' AND end_date = facility_today()
           AND status IN ('confirmed', 'checked_in', 'checked_out')`,
      );
      const weekRes = await db.query(
        // ::text, not a bare date: the driver returns DATE as a JS Date at
        // local midnight, and toISOString() on that can land on the day before.
        `SELECT (d::date)::text AS date,
           COUNT(*) FILTER (
             WHERE b.service_type = 'boarding'
               AND b.start_date <= d AND b.end_date > d
           )::int AS boarding,
           COUNT(*) FILTER (
             WHERE b.service_type = 'daycare' AND b.start_date = d
           )::int AS daycare
         FROM generate_series(facility_today(), facility_today() + 6, interval '1 day') AS d
         LEFT JOIN bookings b
           ON b.status IN ('requested', 'confirmed', 'checked_in')
         GROUP BY d ORDER BY d`,
      );

      return {
        occupancy: {
          occupied: occupiedRes.rows[0].n,
          capacity: capacityRes.rows[0].capacity,
          daycareOnly: daycareRes.rows[0].n,
        },
        arrivalsToday: arrivalsRes.rows[0].n,
        departuresToday: departuresRes.rows[0].n,
        next7Days: weekRes.rows.map((r) => ({
          date: r.date,
          boarding: r.boarding,
          daycare: r.daycare,
        })),
      };
    });
  });
}

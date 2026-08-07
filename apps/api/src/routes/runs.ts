import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

/**
 * Runs with availability for a proposed booking window.
 *
 * Boarding runs hold one stay at a time, so a run is unavailable when any
 * non-canceled boarding stay overlaps the window (half-open: a stay ending on
 * the day another starts does not conflict — the kennel turns over that day).
 *
 * Daycare play groups are capacity-based: availability is the group's capacity
 * minus the busiest day's headcount in the window.
 */
export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { from?: string; to?: string; serviceType?: string };
  }>('/runs', async (req, reply) => {
    const serviceType = req.query.serviceType ?? 'boarding';
    if (serviceType !== 'boarding' && serviceType !== 'daycare') {
      return reply.code(400).send({ error: "serviceType must be 'boarding' or 'daycare'" });
    }
    const from = req.query.from ?? new Date().toISOString().slice(0, 10);
    const to = req.query.to ?? from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return reply.code(400).send({ error: 'from/to must be YYYY-MM-DD' });
    }
    if (to < from) {
      return reply.code(400).send({ error: 'to must not be before from' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      if (serviceType === 'boarding') {
        const { rows } = await db.query(
          `SELECT r.id, r.code, r.zone, r.kind, r.capacity, r.display_order,
                  conflict.pet_name
           FROM runs r
           LEFT JOIN LATERAL (
             SELECT p.name AS pet_name
             FROM bookings b
             JOIN pets p ON p.id = b.pet_id
             WHERE b.run_id = r.id
               AND b.service_type = 'boarding'
               AND b.status IN ('requested', 'confirmed', 'checked_in')
               AND b.start_date < $2::date AND b.end_date > $1::date
             ORDER BY b.start_date
             LIMIT 1
           ) AS conflict ON true
           WHERE r.kind IN ('suite', 'run')
           ORDER BY r.zone, r.display_order, r.code`,
          [from, to],
        );
        return {
          runs: rows.map((r) => ({
            id: r.id,
            code: r.code,
            zone: r.zone,
            kind: r.kind,
            capacity: r.capacity,
            available: r.pet_name === null,
            takenBy: r.pet_name,
            remaining: r.pet_name === null ? 1 : 0,
          })),
        };
      }

      // Daycare: busiest day's headcount across the window.
      const { rows } = await db.query(
        `SELECT r.id, r.code, r.zone, r.kind, r.capacity, r.display_order,
                COALESCE(MAX(day_counts.n), 0)::int AS peak
         FROM runs r
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS n
           FROM bookings b
           WHERE b.run_id = r.id
             AND b.service_type = 'daycare'
             AND b.status IN ('requested', 'confirmed', 'checked_in')
             AND b.start_date BETWEEN $1::date AND $2::date
           GROUP BY b.start_date
         ) AS day_counts ON true
         WHERE r.kind = 'playgroup'
         GROUP BY r.id, r.code, r.zone, r.kind, r.capacity, r.display_order
         ORDER BY r.display_order, r.code`,
        [from, to],
      );
      return {
        runs: rows.map((r) => ({
          id: r.id,
          code: r.code,
          zone: r.zone,
          kind: r.kind,
          capacity: r.capacity,
          available: r.peak < r.capacity,
          takenBy: null,
          remaining: Math.max(0, r.capacity - r.peak),
        })),
      };
    });
  });

  // Flat pet list for pickers — cheaper than loading the full clients tree.
  app.get('/pets', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.breed, p.avatar_color,
                c.first_name || ' ' || c.last_name AS client_name
         FROM pets p
         JOIN clients c ON c.id = p.client_id
         ORDER BY p.name`,
      );
      return {
        pets: rows.map((p) => ({
          id: p.id,
          name: p.name,
          breed: p.breed,
          avatarColor: p.avatar_color,
          clientName: p.client_name,
        })),
      };
    });
  });
}

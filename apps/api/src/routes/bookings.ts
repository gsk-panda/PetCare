import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string } }>('/bookings', async (req) => {
    const from = req.query.from ?? new Date().toISOString().slice(0, 10);
    const to = req.query.to ?? from;
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT b.id, b.service_type, b.status,
                b.start_date::text, b.end_date::text, b.notes,
                p.name AS pet_name, p.breed, p.avatar_color,
                c.first_name || ' ' || c.last_name AS client_name,
                r.code AS run_code
         FROM bookings b
         JOIN pets p ON p.id = b.pet_id
         JOIN clients c ON c.id = b.client_id
         LEFT JOIN runs r ON r.id = b.run_id
         WHERE b.start_date <= $2::date AND b.end_date >= $1::date
           AND b.status <> 'canceled'
         ORDER BY b.start_date, p.name`,
        [from, to],
      );
      return {
        bookings: rows.map((b) => ({
          id: b.id,
          serviceType: b.service_type,
          status: b.status,
          startDate: b.start_date,
          endDate: b.end_date,
          notes: b.notes,
          petName: b.pet_name,
          breed: b.breed,
          avatarColor: b.avatar_color,
          clientName: b.client_name,
          runCode: b.run_code,
        })),
      };
    });
  });

  app.post<{
    Body: {
      petId: string;
      serviceType: 'boarding' | 'daycare';
      startDate: string;
      endDate: string;
      runId?: string;
      notes?: string;
    };
  }>('/bookings', async (req, reply) => {
    const { petId, serviceType, startDate, endDate, runId, notes } = req.body;
    if (!petId || !serviceType || !startDate || !endDate) {
      return reply.code(400).send({ error: 'petId, serviceType, startDate, endDate are required' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: petRows } = await db.query(
        'SELECT client_id FROM pets WHERE id = $1',
        [petId],
      );
      if (!petRows[0]) return reply.code(404).send({ error: 'Pet not found' });

      // Conflict check: a run can't hold two boarding stays on overlapping nights.
      if (runId && serviceType === 'boarding') {
        const { rows: conflicts } = await db.query(
          `SELECT id FROM bookings
           WHERE run_id = $1 AND service_type = 'boarding'
             AND status IN ('requested', 'confirmed', 'checked_in')
             AND start_date < $3::date AND end_date > $2::date`,
          [runId, startDate, endDate],
        );
        if (conflicts.length > 0) {
          return reply.code(409).send({ error: 'Run already booked for those dates' });
        }
      }

      const { rows } = await db.query(
        `INSERT INTO bookings (pet_id, client_id, service_type, status, start_date, end_date, run_id, notes)
         VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7) RETURNING id`,
        [petId, petRows[0].client_id, serviceType, startDate, endDate, runId ?? null, notes ?? null],
      );
      reply.code(201);
      return { id: rows[0].id };
    });
  });
}

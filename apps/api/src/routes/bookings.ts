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

  /**
   * Can this stay move to these dates? Same rule the save path enforces, but
   * answerable while someone is still choosing, so a clash shows up before
   * they commit rather than as an error afterwards.
   */
  app.get<{
    Params: { bookingId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/bookings/:bookingId/date-availability', async (req, reply) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate || !iso.test(startDate) || !iso.test(endDate)) {
      return reply.code(400).send({ error: 'startDate and endDate must be YYYY-MM-DD' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: current } = await db.query(
        `SELECT b.id, b.run_id, b.service_type, r.code AS run_code, r.label AS run_label
         FROM bookings b LEFT JOIN runs r ON r.id = b.run_id WHERE b.id = $1`,
        [req.params.bookingId],
      );
      const booking = current[0];
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });

      // Nothing to clash with until a run is assigned.
      if (!booking.run_id || booking.service_type !== 'boarding') {
        return { available: true, runLabel: booking.run_label ?? booking.run_code, conflicts: [] };
      }

      const { rows: conflicts } = await db.query(
        `SELECT p.name AS pet_name, b.start_date::text AS start_date, b.end_date::text AS end_date
         FROM bookings b JOIN pets p ON p.id = b.pet_id
         WHERE b.run_id = $1 AND b.id <> $2 AND b.service_type = 'boarding'
           AND b.status IN ('requested', 'confirmed', 'checked_in')
           AND b.start_date < $4::date AND b.end_date > $3::date
         ORDER BY b.start_date`,
        [booking.run_id, booking.id, startDate, endDate],
      );

      return {
        available: conflicts.length === 0,
        runLabel: booking.run_label ?? booking.run_code,
        conflicts: conflicts.map((c) => ({
          petName: c.pet_name,
          startDate: c.start_date,
          endDate: c.end_date,
        })),
      };
    });
  });

  /**
   * Extend or shorten a stay. A dog already in the kennel is the common case —
   * the owner's flight moved — so this works on checked-in stays too, and only
   * refuses when the run is genuinely needed by someone else.
   */
  app.patch<{
    Params: { bookingId: string };
    Body: { startDate?: string; endDate?: string; notes?: string };
  }>('/bookings/:bookingId/dates', async (req, reply) => {
    const { startDate, endDate, notes } = req.body ?? {};
    const iso = /^\d{4}-\d{2}-\d{2}$/;

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: current } = await db.query(
        `SELECT id, service_type, status, run_id,
                start_date::text AS start_date, end_date::text AS end_date
         FROM bookings WHERE id = $1`,
        [req.params.bookingId],
      );
      const booking = current[0];
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.status === 'canceled' || booking.status === 'checked_out') {
        return reply.code(409).send({ error: 'This stay is already closed' });
      }

      const nextStart = startDate ?? booking.start_date;
      const nextEnd = endDate ?? booking.end_date;
      if (!iso.test(nextStart) || !iso.test(nextEnd)) {
        return reply.code(400).send({ error: 'Dates must be YYYY-MM-DD' });
      }
      if (nextEnd < nextStart) {
        return reply.code(400).send({ error: 'Check-out cannot be before check-in' });
      }
      if (booking.service_type === 'boarding' && nextEnd === nextStart) {
        return reply.code(400).send({ error: 'A boarding stay needs at least one night' });
      }
      if (booking.service_type === 'daycare' && nextEnd !== nextStart) {
        return reply.code(400).send({ error: 'Daycare is a single day' });
      }
      // Moving the start of a stay that has already begun would rewrite
      // history the care log already recorded against.
      if (booking.status === 'checked_in' && nextStart !== booking.start_date) {
        return reply.code(409).send({
          error: 'This stay has already started, so only the check-out date can change',
        });
      }

      if (booking.run_id && booking.service_type === 'boarding') {
        const { rows: clash } = await db.query(
          `SELECT p.name FROM bookings b JOIN pets p ON p.id = b.pet_id
           WHERE b.run_id = $1 AND b.id <> $2 AND b.service_type = 'boarding'
             AND b.status IN ('requested', 'confirmed', 'checked_in')
             AND b.start_date < $4::date AND b.end_date > $3::date
           LIMIT 1`,
          [booking.run_id, booking.id, nextStart, nextEnd],
        );
        if (clash[0]) {
          return reply.code(409).send({
            error: `${clash[0].name} is booked into that run for part of those dates. Move one of them first.`,
          });
        }
      }

      const { rows } = await db.query(
        `UPDATE bookings
         SET start_date = $2::date, end_date = $3::date, notes = COALESCE($4, notes)
         WHERE id = $1
         RETURNING start_date::text, end_date::text`,
        [booking.id, nextStart, nextEnd, notes?.trim() ?? null],
      );

      // Worth a trail: a changed departure date moves what the client owes.
      await db.query(
        `INSERT INTO care_events (booking_id, pet_id, type, staff_name, staff_id, note)
         SELECT b.id, b.pet_id, 'note', $2, $3, $4 FROM bookings b WHERE b.id = $1`,
        [
          booking.id, req.staff.name, req.staff.id,
          `Dates changed from ${booking.start_date} → ${booking.end_date} to ${rows[0].start_date} → ${rows[0].end_date}.`,
        ],
      );

      return { startDate: rows[0].start_date, endDate: rows[0].end_date };
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
    if (serviceType !== 'boarding' && serviceType !== 'daycare') {
      return reply.code(400).send({ error: "serviceType must be 'boarding' or 'daycare'" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return reply.code(400).send({ error: 'startDate/endDate must be YYYY-MM-DD' });
    }
    if (endDate < startDate) {
      return reply.code(400).send({ error: 'endDate must not be before startDate' });
    }
    if (serviceType === 'boarding' && endDate === startDate) {
      return reply.code(400).send({ error: 'A boarding stay must cover at least one night' });
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

      // Daycare play groups are capacity-based rather than exclusive.
      if (runId && serviceType === 'daycare') {
        const { rows: full } = await db.query(
          `SELECT r.code, r.capacity, COUNT(b.id)::int AS booked
           FROM runs r
           LEFT JOIN bookings b
             ON b.run_id = r.id AND b.service_type = 'daycare'
            AND b.status IN ('requested', 'confirmed', 'checked_in')
            AND b.start_date = $2::date
           WHERE r.id = $1
           GROUP BY r.code, r.capacity
           HAVING COUNT(b.id) >= r.capacity`,
          [runId, startDate],
        );
        if (full[0]) {
          return reply.code(409).send({
            error: `Play group ${full[0].code} is full that day (${full[0].booked}/${full[0].capacity})`,
          });
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

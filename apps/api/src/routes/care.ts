import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  CARE_SLOTS,
  MED_SCHEDULE_SLOTS,
  SLOT_HOURS,
  type CareSlot,
  type CareTask,
} from '@petcare/shared';
import { withTenant } from '../db.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Expand each in-house stay's feeding times and medication schedule into the
 * individual rounds they generate for `date`, then mark off the ones already
 * logged. The schedule is the source of truth; care_events record completion.
 */
async function buildTasks(db: pg.PoolClient, date: string): Promise<CareTask[]> {
  // Pets physically in house on this date. Departure day is included so the
  // morning round before pickup still appears.
  const { rows: stays } = await db.query(
    `SELECT b.id AS booking_id, p.id AS pet_id, p.name AS pet_name,
            p.avatar_color, r.code AS run_code,
            i.feeding_times, i.feeding_amount, i.food_description,
            i.bowl_type, i.food_source
     FROM bookings b
     JOIN pets p ON p.id = b.pet_id
     LEFT JOIN runs r ON r.id = b.run_id
     LEFT JOIN stay_intake i ON i.booking_id = b.id
     WHERE b.status = 'checked_in'
       AND ((b.service_type = 'boarding' AND b.start_date <= $1::date AND b.end_date >= $1::date)
         OR (b.service_type = 'daycare' AND b.start_date = $1::date))
     ORDER BY r.code NULLS LAST, p.name`,
    [date],
  );
  if (stays.length === 0) return [];

  const bookingIds = stays.map((s) => s.booking_id);
  const { rows: meds } = await db.query(
    `SELECT booking_id, name, dose, schedule, with_food, notes
     FROM stay_medications WHERE booking_id = ANY($1) ORDER BY created_at`,
    [bookingIds],
  );
  const { rows: logged } = await db.query(
    `SELECT booking_id, type, slot, COALESCE(subject, '') AS subject,
            staff_name, occurred_at
     FROM care_events
     WHERE care_date = $1::date AND slot IS NOT NULL AND booking_id = ANY($2)`,
    [date, bookingIds],
  );

  const doneKey = (bookingId: string, type: string, slot: string, subject: string) =>
    `${bookingId}|${type}|${slot}|${subject}`;
  const doneMap = new Map(
    logged.map((l) => [doneKey(l.booking_id, l.type, l.slot, l.subject), l]),
  );

  const tasks: CareTask[] = [];
  const push = (
    stay: (typeof stays)[number],
    slot: CareSlot,
    type: 'feeding' | 'medication',
    subject: string | null,
    detail: string,
  ) => {
    const hit = doneMap.get(doneKey(stay.booking_id, type, slot, subject ?? ''));
    tasks.push({
      bookingId: stay.booking_id,
      petId: stay.pet_id,
      petName: stay.pet_name,
      avatarColor: stay.avatar_color,
      runCode: stay.run_code,
      slot,
      type,
      subject,
      detail,
      done: Boolean(hit),
      doneAt: hit ? new Date(hit.occurred_at).toISOString() : null,
      doneBy: hit?.staff_name ?? null,
    });
  };

  for (const stay of stays) {
    const times: string[] = stay.feeding_times ?? [];
    for (const slot of times) {
      if (!(CARE_SLOTS as readonly string[]).includes(slot)) continue;
      const detail = [
        stay.feeding_amount,
        stay.food_source === 'house' ? 'house food' : stay.food_description,
        stay.bowl_type && stay.bowl_type !== 'Standard' ? `${stay.bowl_type} bowl` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      push(stay, slot as CareSlot, 'feeding', null, detail || 'Standard portion');
    }

    for (const med of meds.filter((m) => m.booking_id === stay.booking_id)) {
      const slots = MED_SCHEDULE_SLOTS[med.schedule] ?? [];
      for (const slot of slots) {
        const detail = [med.dose, med.with_food ? 'with food' : 'any time', med.notes]
          .filter(Boolean)
          .join(' · ');
        push(stay, slot, 'medication', med.name, detail);
      }
    }
  }

  return tasks.sort(
    (a, b) =>
      SLOT_HOURS[a.slot] - SLOT_HOURS[b.slot] ||
      // Medication first within a round — it is the one that must not be missed.
      Number(a.type === 'feeding') - Number(b.type === 'feeding') ||
      (a.runCode ?? '').localeCompare(b.runCode ?? '') ||
      a.petName.localeCompare(b.petName),
  );
}

export async function careRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { date?: string } }>('/care-tasks', async (req, reply) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    if (!ISO_DATE.test(date)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const tasks = await buildTasks(db, date);
      return {
        date,
        tasks,
        summary: {
          total: tasks.length,
          done: tasks.filter((t) => t.done).length,
          medicationOutstanding: tasks.filter((t) => t.type === 'medication' && !t.done).length,
        },
      };
    });
  });

  app.post<{
    Body: {
      bookingId: string;
      type: 'feeding' | 'medication';
      slot: CareSlot;
      subject?: string | null;
      note?: string;
      date?: string;
    };
  }>('/care-tasks', async (req, reply) => {
    const { bookingId, type, slot, subject, note } = req.body ?? {};
    const date = req.body?.date ?? new Date().toISOString().slice(0, 10);
    if (!bookingId || (type !== 'feeding' && type !== 'medication')) {
      return reply.code(400).send({ error: "bookingId and type ('feeding'|'medication') required" });
    }
    if (!(CARE_SLOTS as readonly string[]).includes(slot)) {
      return reply.code(400).send({ error: `slot must be one of ${CARE_SLOTS.join(', ')}` });
    }
    if (!ISO_DATE.test(date)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: booking } = await db.query(
        'SELECT pet_id FROM bookings WHERE id = $1',
        [bookingId],
      );
      if (!booking[0]) return reply.code(404).send({ error: 'Booking not found' });

      // Idempotent: double-tapping a round must not double-log a dose.
      // Who gave the dose comes from the session, not the request body.
      const { rows } = await db.query(
        `INSERT INTO care_events
           (booking_id, pet_id, type, slot, subject, note, staff_name, staff_id, care_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)
         ON CONFLICT DO NOTHING
         RETURNING id, occurred_at`,
        [bookingId, booking[0].pet_id, type, slot, subject ?? null, note ?? null,
          req.staff.name, req.staff.id, date],
      );
      return { recorded: rows.length > 0, alreadyLogged: rows.length === 0 };
    });
  });

  // Undo a mis-tapped round.
  app.delete<{
    Body: {
      bookingId: string;
      type: 'feeding' | 'medication';
      slot: CareSlot;
      subject?: string | null;
      date?: string;
    };
  }>('/care-tasks', async (req, reply) => {
    const { bookingId, type, slot, subject } = req.body ?? {};
    const date = req.body?.date ?? new Date().toISOString().slice(0, 10);
    if (!bookingId || !slot || !ISO_DATE.test(date)) {
      return reply.code(400).send({ error: 'bookingId, slot and a valid date are required' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rowCount } = await db.query(
        `DELETE FROM care_events
         WHERE booking_id = $1 AND type = $2 AND slot = $3
           AND COALESCE(subject, '') = COALESCE($4, '') AND care_date = $5::date`,
        [bookingId, type, slot, subject ?? null, date],
      );
      return { removed: rowCount ?? 0 };
    });
  });

  // Daily care log: what was given, what was missed, who gave it.
  app.get<{ Querystring: { date?: string } }>('/reports/care-log', async (req, reply) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    if (!ISO_DATE.test(date)) {
      return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const tasks = await buildTasks(db, date);
      const byPet = new Map<string, { petName: string; runCode: string | null; tasks: CareTask[] }>();
      for (const t of tasks) {
        const entry = byPet.get(t.petId) ?? {
          petName: t.petName,
          runCode: t.runCode,
          tasks: [],
        };
        entry.tasks.push(t);
        byPet.set(t.petId, entry);
      }
      const meds = tasks.filter((t) => t.type === 'medication');
      const feeds = tasks.filter((t) => t.type === 'feeding');
      return {
        date,
        summary: {
          pets: byPet.size,
          feedingsScheduled: feeds.length,
          feedingsGiven: feeds.filter((t) => t.done).length,
          medicationsScheduled: meds.length,
          medicationsGiven: meds.filter((t) => t.done).length,
        },
        pets: [...byPet.entries()].map(([petId, v]) => ({
          petId,
          petName: v.petName,
          runCode: v.runCode,
          tasks: v.tasks,
        })),
      };
    });
  });
}

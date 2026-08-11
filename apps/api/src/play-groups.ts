import type pg from 'pg';

/**
 * The play group this dog was in last time.
 *
 * Derived from its own booking history rather than stored on the pet: there is
 * then nothing to keep in sync, and a dog moved between groups on the floor
 * carries that change forward on its own. Retired groups are ignored — a
 * facility that reorganises its groups should not have new bookings quietly
 * land in a group that no longer runs.
 */
export async function lastPlayGroup(
  db: pg.PoolClient,
  petId: string,
): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT b.run_id
       FROM bookings b
       JOIN runs r ON r.id = b.run_id
      WHERE b.pet_id = $1
        AND b.service_type = 'daycare'
        AND b.status <> 'canceled'
        AND r.kind = 'playgroup'
        AND r.active
      -- Days already attended come first. A day booked for next month is a
      -- guess about where the dog will go; the last day it actually spent in
      -- a group is the fact. Without this, moving a dog on the floor today
      -- would be overridden by a booking someone made for a fortnight away.
      ORDER BY (b.start_date <= facility_today()) DESC, b.start_date DESC, b.id DESC
      LIMIT 1`,
    [petId],
  );
  return rows[0]?.run_id ?? null;
}

/** Is there room in this group on this day, counting everyone already in it? */
export async function groupHasRoom(
  db: pg.PoolClient,
  runId: string,
  date: string,
  ignoreBookingId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { rows } = await db.query(
    `SELECT r.code, r.label, r.capacity,
            COUNT(b.id) FILTER (
              WHERE b.service_type = 'daycare'
                AND b.status IN ('requested', 'confirmed', 'checked_in')
                AND b.start_date = $2::date
                AND ($3::uuid IS NULL OR b.id <> $3)
            )::int AS booked
       FROM runs r
       LEFT JOIN bookings b ON b.run_id = r.id
      WHERE r.id = $1
      GROUP BY r.code, r.label, r.capacity`,
    [runId, date, ignoreBookingId ?? null],
  );
  const g = rows[0];
  if (!g) return { ok: false, reason: 'That play group no longer exists' };
  if (g.booked >= g.capacity) {
    return {
      ok: false,
      reason: `${g.label ?? g.code} is full that day (${g.booked}/${g.capacity})`,
    };
  }
  return { ok: true };
}

/**
 * Where a daycare booking should go when nobody has said: the group the dog
 * was in last time, as long as it still has room that day.
 */
export async function suggestedPlayGroup(
  db: pg.PoolClient,
  petId: string,
  date: string,
): Promise<string | null> {
  const previous = await lastPlayGroup(db, petId);
  if (!previous) return null;
  const room = await groupHasRoom(db, previous, date);
  return room.ok ? previous : null;
}

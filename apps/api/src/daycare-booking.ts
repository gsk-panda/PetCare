import type pg from 'pg';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Booking a year of daycare in one click is a mistake, not a feature. */
const MAX_DAYS = 60;

export type DaycareDaysResult = {
  created: Array<{ date: string; id: string }>;
  skipped: Array<{ date: string; reason: string }>;
};

/**
 * Book a set of daycare days for one pet.
 *
 * Daycare is one booking per day everywhere else in the system, so several
 * days means several bookings. They are made in a single transaction, but a
 * day that cannot be booked is skipped and reported rather than failing the
 * whole request: "Wednesday is full, I booked the other two" is how the desk
 * actually talks, and it beats making someone re-pick the days that were fine.
 */
export async function createDaycareDays(
  db: pg.PoolClient,
  opts: {
    dates: string[];
    petId: string;
    runId?: string | undefined;
    notes?: string | undefined;
    status: 'confirmed' | 'requested';
    /** 'staff' or 'portal'. Not nullable: the column has a default that an
     *  explicit null would override, and every booking has an origin. */
    source: 'staff' | 'portal';
    today: string;
    /** Portal callers already know the client; staff derive it from the pet. */
    clientId?: string;
  },
): Promise<{ error: string; code: number } | DaycareDaysResult> {
  const unique = [...new Set(opts.dates)].sort();
  if (unique.length === 0) return { error: 'Choose at least one day', code: 400 };
  if (unique.length > MAX_DAYS) {
    return { error: `That is more than ${MAX_DAYS} days in one booking`, code: 400 };
  }
  if (unique.some((d) => !ISO_DATE.test(d))) {
    return { error: 'Dates must be YYYY-MM-DD', code: 400 };
  }
  if (unique.some((d) => d < opts.today)) {
    return { error: 'Choose dates from today onwards', code: 400 };
  }

  const { rows: pet } = await db.query('SELECT client_id FROM pets WHERE id = $1', [opts.petId]);
  const clientId = opts.clientId ?? pet[0]?.client_id;
  if (!clientId) return { error: 'Pet not found', code: 404 };

  const created: DaycareDaysResult['created'] = [];
  const skipped: DaycareDaysResult['skipped'] = [];

  await db.query('BEGIN');
  try {
    for (const date of unique) {
      // Same dog, same day, twice over is a double booking, not two visits.
      const { rows: already } = await db.query(
        `SELECT id FROM bookings
         WHERE pet_id = $1 AND service_type = 'daycare' AND start_date = $2::date
           AND status IN ('requested', 'confirmed', 'checked_in', 'checked_out')`,
        [opts.petId, date],
      );
      if (already[0]) {
        skipped.push({ date, reason: 'Already booked' });
        continue;
      }

      if (opts.runId) {
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
          [opts.runId, date],
        );
        if (full[0]) {
          skipped.push({ date, reason: `${full[0].code} full (${full[0].booked}/${full[0].capacity})` });
          continue;
        }
      }

      const { rows } = await db.query(
        `INSERT INTO bookings
           (pet_id, client_id, service_type, status, start_date, end_date, run_id, notes, source)
         VALUES ($1, $2, 'daycare', $3, $4::date, $4::date, $5, $6, $7)
         RETURNING id`,
        [
          opts.petId,
          clientId,
          opts.status,
          date,
          opts.runId ?? null,
          opts.notes?.trim() || null,
          opts.source,
        ],
      );
      created.push({ date, id: rows[0].id });
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  return { created, skipped };
}

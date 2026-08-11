import type { FastifyInstance } from 'fastify';
import { facilityToday, withTenant } from '../db.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A range longer than this is a data export, not a report someone reads. */
const MAX_RANGE_DAYS = 400;

async function range(
  req: { query: { from?: string; to?: string }; tenant: { schemaName: string } },
): Promise<{ from: string; to: string } | { error: string }> {
  const today = await facilityToday(req.tenant.schemaName);
  const to = req.query.to ?? today;
  // A month back is the span a desk actually asks about.
  const from = req.query.from ?? shift(to, -29);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { error: 'from/to must be YYYY-MM-DD' };
  if (to < from) return { error: 'to must not be before from' };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  if (days > MAX_RANGE_DAYS) return { error: `Choose a range of ${MAX_RANGE_DAYS} days or fewer` };
  return { from, to };
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Occupancy per day: how full the building was, and how full it could have
   * been. Boarding counts nights (a stay occupies its run every night except
   * the departure day); daycare counts the day itself.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/reports/occupancy',
    async (req, reply) => {
      const r = await range(req);
      if ('error' in r) return reply.code(400).send({ error: r.error });

      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `WITH days AS (
             SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d
           ),
           cap AS (
             SELECT
               COALESCE(SUM(capacity) FILTER (WHERE kind IN ('suite','run')), 0)::int AS boarding,
               COALESCE(SUM(capacity) FILTER (WHERE kind = 'playgroup'), 0)::int AS daycare
             FROM runs WHERE active
           )
           SELECT days.d::text AS date,
                  cap.boarding AS boarding_capacity,
                  cap.daycare  AS daycare_capacity,
                  COUNT(b.id) FILTER (
                    WHERE b.service_type = 'boarding'
                      AND b.start_date <= days.d AND b.end_date > days.d
                  )::int AS boarding,
                  COUNT(b.id) FILTER (
                    WHERE b.service_type = 'daycare' AND b.start_date = days.d
                  )::int AS daycare
             FROM days
             CROSS JOIN cap
             LEFT JOIN bookings b
               ON b.status IN ('confirmed', 'checked_in', 'checked_out')
              AND b.start_date <= days.d AND b.end_date >= days.d
            GROUP BY days.d, cap.boarding, cap.daycare
            ORDER BY days.d`,
          [r.from, r.to],
        );

        const days = rows.map((x) => ({
          date: x.date,
          boarding: x.boarding,
          daycare: x.daycare,
          boardingCapacity: x.boarding_capacity,
          daycareCapacity: x.daycare_capacity,
          utilisationBps:
            x.boarding_capacity > 0
              ? Math.round((x.boarding / x.boarding_capacity) * 10_000)
              : 0,
        }));
        const nights = days.reduce((n, d) => n + d.boarding, 0);
        const capacityNights = days.reduce((n, d) => n + d.boardingCapacity, 0);

        return {
          from: r.from,
          to: r.to,
          days,
          totals: {
            boardingNights: nights,
            daycareDays: days.reduce((n, d) => n + d.daycare, 0),
            capacityNights,
            utilisationBps: capacityNights > 0 ? Math.round((nights / capacityNights) * 10_000) : 0,
            busiestDate: days.reduce(
              (best, d) => (best === null || d.boarding > best.boarding ? d : best),
              null as (typeof days)[number] | null,
            )?.date ?? null,
          },
        };
      });
    },
  );

  /**
   * Revenue over a period, by the day the invoice was raised. Voided invoices
   * are excluded from every total rather than shown as zero: an invoice that
   * was cancelled is not revenue of any size.
   */
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/reports/revenue',
    async (req, reply) => {
      const r = await range(req);
      if ('error' in r) return reply.code(400).send({ error: r.error });

      return withTenant(req.tenant.schemaName, async (db) => {
        // Dates are compared in the facility's timezone, not the server's, or
        // an invoice raised at 8pm lands in tomorrow's figures.
        const { rows: totals } = await db.query(
          `SELECT COUNT(*)::int AS invoices,
                  COALESCE(SUM(subtotal_cents), 0)::int AS subtotal_cents,
                  COALESCE(SUM(tax_cents), 0)::int      AS tax_cents,
                  COALESCE(SUM(total_cents), 0)::int    AS total_cents,
                  COALESCE(SUM(paid_cents), 0)::int     AS paid_cents
             FROM invoices
            WHERE status <> 'void'
              AND (created_at AT TIME ZONE (SELECT timezone FROM facility_settings))::date
                  BETWEEN $1::date AND $2::date`,
          [r.from, r.to],
        );

        const { rows: byDay } = await db.query(
          `SELECT (created_at AT TIME ZONE (SELECT timezone FROM facility_settings))::date::text AS date,
                  COUNT(*)::int AS invoices,
                  COALESCE(SUM(total_cents), 0)::int AS total_cents
             FROM invoices
            WHERE status <> 'void'
              AND (created_at AT TIME ZONE (SELECT timezone FROM facility_settings))::date
                  BETWEEN $1::date AND $2::date
            GROUP BY 1 ORDER BY 1`,
          [r.from, r.to],
        );

        const { rows: byKind } = await db.query(
          `SELECT l.kind,
                  COALESCE(SUM(l.amount_cents), 0)::int AS amount_cents,
                  COUNT(*)::int AS lines
             FROM invoice_lines l
             JOIN invoices i ON i.id = l.invoice_id
            WHERE i.status <> 'void'
              AND (i.created_at AT TIME ZONE (SELECT timezone FROM facility_settings))::date
                  BETWEEN $1::date AND $2::date
            GROUP BY l.kind ORDER BY 2 DESC`,
          [r.from, r.to],
        );

        const { rows: byMethod } = await db.query(
          `SELECT p.method,
                  COALESCE(SUM(p.amount_cents), 0)::int AS amount_cents,
                  COUNT(*)::int AS payments
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
            WHERE i.status <> 'void'
              AND (p.created_at AT TIME ZONE (SELECT timezone FROM facility_settings))::date
                  BETWEEN $1::date AND $2::date
            GROUP BY p.method ORDER BY 2 DESC`,
          [r.from, r.to],
        );

        const t = totals[0];
        return {
          from: r.from,
          to: r.to,
          totals: {
            invoices: t.invoices,
            subtotalCents: t.subtotal_cents,
            taxCents: t.tax_cents,
            totalCents: t.total_cents,
            paidCents: t.paid_cents,
            outstandingCents: t.total_cents - t.paid_cents,
          },
          byDay: byDay.map((x) => ({
            date: x.date,
            invoices: x.invoices,
            totalCents: x.total_cents,
          })),
          byKind: byKind.map((x) => ({
            kind: x.kind,
            amountCents: x.amount_cents,
            lines: x.lines,
          })),
          byMethod: byMethod.map((x) => ({
            method: x.method,
            amountCents: x.amount_cents,
            payments: x.payments,
          })),
        };
      });
    },
  );

  /**
   * Vaccination status across every pet on the books. Unlike the dashboard
   * alert, which only looks forward 30 days, this is the list you work through
   * when chasing paperwork: already expired first, then expiring soon.
   */
  app.get<{ Querystring: { withinDays?: string } }>(
    '/reports/vaccinations',
    async (req, reply) => {
      const withinDays = Number(req.query.withinDays ?? 60);
      if (!Number.isFinite(withinDays) || withinDays < 0 || withinDays > 365) {
        return reply.code(400).send({ error: 'withinDays must be between 0 and 365' });
      }

      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `SELECT v.vaccine, v.expires_on::text AS expires_on, v.verified,
                  (v.expires_on - facility_today())::int AS days_left,
                  p.id AS pet_id, p.name AS pet_name, p.avatar_color,
                  c.first_name || ' ' || c.last_name AS client_name,
                  c.phone AS client_phone, c.email AS client_email,
                  EXISTS (
                    SELECT 1 FROM bookings b
                     WHERE b.pet_id = p.id
                       AND b.status IN ('requested', 'confirmed', 'checked_in')
                       AND b.end_date >= facility_today()
                  ) AS has_upcoming
             FROM vaccinations v
             JOIN pets p ON p.id = v.pet_id
             JOIN clients c ON c.id = p.client_id
            WHERE v.expires_on <= facility_today() + $1::int
            ORDER BY v.expires_on, p.name`,
          [withinDays],
        );

        const rowsOut = rows.map((x) => ({
          petId: x.pet_id,
          petName: x.pet_name,
          avatarColor: x.avatar_color,
          clientName: x.client_name,
          clientPhone: x.client_phone,
          clientEmail: x.client_email,
          vaccine: x.vaccine,
          expiresOn: x.expires_on,
          daysLeft: x.days_left,
          verified: x.verified,
          hasUpcoming: x.has_upcoming,
        }));

        return {
          withinDays,
          rows: rowsOut,
          totals: {
            expired: rowsOut.filter((x) => x.daysLeft < 0).length,
            expiringSoon: rowsOut.filter((x) => x.daysLeft >= 0).length,
            // The ones that actually block a drop-off.
            blockingUpcoming: rowsOut.filter((x) => x.daysLeft < 0 && x.hasUpcoming).length,
            unverified: rowsOut.filter((x) => !x.verified).length,
          },
        };
      });
    },
  );
}

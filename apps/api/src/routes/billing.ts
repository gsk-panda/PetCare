import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from '../db.js';
import { MANAGES_SETTINGS } from '../staff-auth.js';
import { stripeConfigured, verifyStripe } from '../stripe.js';

/** Payment methods the desk can record without a card reader. */
const MANUAL_METHODS = ['cash', 'check', 'card_manual', 'account_credit', 'other'];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const requireManager = async (req: FastifyRequest, reply: FastifyReply): Promise<undefined> => {
    if (!MANAGES_SETTINGS.includes(req.staff.role)) {
      reply.code(403).send({ error: 'Only an owner or manager can change billing settings' });
    }
    return undefined;
  };

  /* ========================= settings ========================= */
  app.get('/settings/billing', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: fs } = await db.query(
        `SELECT currency, tax_rate_bps, terminal_provider, terminal_label,
                terminal_location, terminal_status, timezone,
                to_char(pickup_cutoff, 'HH24:MI') AS pickup_cutoff,
                to_char(pickup_cutoff, 'HH12:MI AM') AS pickup_cutoff_label
         FROM facility_settings WHERE singleton`,
      );
      const { rows: items } = await db.query(
        `SELECT id, name, description, price_cents, taxable, active, display_order
         FROM service_items ORDER BY active DESC, display_order, name`,
      );
      const s = fs[0];
      return {
        currency: s.currency,
        taxRateBps: s.tax_rate_bps,
        timezone: s.timezone,
        pickupCutoff: s.pickup_cutoff,
        pickupCutoffLabel: s.pickup_cutoff_label,
        terminal: {
          provider: s.terminal_provider,
          label: s.terminal_label,
          location: s.terminal_location,
          status: s.terminal_status,
          // Whether the server actually holds a Stripe key. The UI must not
          // claim a connection the environment cannot back up.
          stripeConfigured: stripeConfigured(),
        },
        serviceItems: items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceCents: i.price_cents,
          taxable: i.taxable,
          active: i.active,
        })),
      };
    });
  });

  app.patch<{
    Body: {
      taxRateBps?: number;
      terminalProvider?: string | null;
      terminalLabel?: string | null;
      terminalLocation?: string | null;
      pickupCutoff?: string;
      timezone?: string;
    };
  }>('/settings/billing', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.taxRateBps !== undefined &&
        (!Number.isInteger(b.taxRateBps) || b.taxRateBps < 0 || b.taxRateBps > 3000)) {
      return reply.code(400).send({ error: 'Tax rate must be between 0 and 30%' });
    }
    if (b.pickupCutoff !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.pickupCutoff)) {
      return reply.code(400).send({ error: 'Pickup cutoff must be a time like 11:00' });
    }
    if (b.terminalProvider != null && b.terminalProvider !== 'stripe_terminal') {
      return reply.code(400).send({
        error: 'Stripe Terminal is the only card reader supported so far',
      });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      await db.query(
        `UPDATE facility_settings SET
           pickup_cutoff = COALESCE($6::time, pickup_cutoff),
           timezone = COALESCE($7, timezone),
           tax_rate_bps = COALESCE($1, tax_rate_bps),
           terminal_provider = CASE WHEN $2::boolean THEN $3 ELSE terminal_provider END,
           terminal_label = COALESCE($4, terminal_label),
           terminal_location = COALESCE($5, terminal_location),
           -- Changing the reader invalidates any previous connection.
           terminal_status = CASE WHEN $2::boolean OR $5 IS NOT NULL
                                  THEN 'not_connected' ELSE terminal_status END,
           updated_at = now()
         WHERE singleton`,
        [
          b.taxRateBps ?? null,
          b.terminalProvider !== undefined,
          b.terminalProvider ?? null,
          b.terminalLabel?.trim() ?? null,
          b.terminalLocation?.trim() ?? null,
          b.pickupCutoff ?? null,
          b.timezone?.trim() || null,
        ],
      );
      return { ok: true };
    });
  });

  /**
   * Confirm the server's Stripe key works and the configured reader exists.
   * Deliberately talks to Stripe rather than trusting stored state: "connected"
   * should mean a call succeeded, not that someone typed something once.
   */
  app.post('/settings/billing/stripe/verify', { preHandler: requireManager }, async (req, reply) => {
    if (!stripeConfigured()) {
      return reply.code(400).send({
        error:
          'No Stripe key on the server. Set STRIPE_SECRET_KEY in the API environment, then verify again.',
      });
    }
    const result = await verifyStripe();
    if (!result.ok) {
      await withTenant(req.tenant.schemaName, async (db) => {
        await db.query(
          `UPDATE facility_settings SET terminal_status = 'not_connected', updated_at = now()
           WHERE singleton`,
        );
      });
      return reply.code(502).send({ error: result.error });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      await db.query(
        `UPDATE facility_settings
         SET terminal_provider = 'stripe_terminal', terminal_status = 'connected',
             updated_at = now()
         WHERE singleton`,
      );
      return { ok: true, account: result.account, locations: result.locations };
    });
  });

  /* ========================= service items ========================= */
  app.post<{ Body: { name?: string; description?: string; priceCents?: number; taxable?: boolean } }>(
    '/settings/service-items',
    { preHandler: requireManager },
    async (req, reply) => {
      const name = req.body?.name?.trim();
      const price = req.body?.priceCents ?? 0;
      if (!name) return reply.code(400).send({ error: 'Give the item a name' });
      if (!Number.isInteger(price) || price < 0 || price > 1_000_000) {
        return reply.code(400).send({ error: 'Price must be between $0 and $10,000' });
      }
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO service_items (name, description, price_cents, taxable, display_order)
           VALUES ($1, $2, $3, $4,
                   COALESCE((SELECT MAX(display_order) + 1 FROM service_items), 1))
           RETURNING id`,
          [name, req.body?.description?.trim() || null, price, req.body?.taxable ?? true],
        );
        reply.code(201);
        return { id: rows[0].id };
      });
    },
  );

  app.patch<{
    Params: { itemId: string };
    Body: { name?: string; description?: string; priceCents?: number; taxable?: boolean; active?: boolean };
  }>('/settings/service-items/:itemId', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.priceCents !== undefined &&
        (!Number.isInteger(b.priceCents) || b.priceCents < 0 || b.priceCents > 1_000_000)) {
      return reply.code(400).send({ error: 'Price must be between $0 and $10,000' });
    }
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `UPDATE service_items SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           price_cents = COALESCE($4, price_cents),
           taxable = COALESCE($5, taxable),
           active = COALESCE($6, active)
         WHERE id = $1 RETURNING id`,
        [
          req.params.itemId, b.name?.trim() ?? null, b.description?.trim() ?? null,
          b.priceCents ?? null, b.taxable ?? null, b.active ?? null,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Item not found' });
      return { ok: true };
    });
  });

  /* ========================= check-out ========================= */
  /**
   * What this stay costs, priced from the nights actually stayed rather than
   * the nights booked — an extended or shortened stay bills what happened.
   */
  app.get<{
    Params: { bookingId: string };
    Querystring: { pickedUpAt?: string; waiveLatePickup?: string };
  }>('/bookings/:bookingId/checkout-quote', async (req, reply) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const quote = await buildQuote(db, req.params.bookingId, {
        pickedUpAt: req.query.pickedUpAt,
        waiveLatePickup: req.query.waiveLatePickup === 'true',
        waivedBy: staffName(req),
      });
      if ('error' in quote) return reply.code(quote.code).send({ error: quote.error });
      return quote;
    });
  });

  app.post<{
    Params: { bookingId: string };
    Body: {
      serviceItemIds?: string[];
      adjustmentCents?: number;
      adjustmentNote?: string;
      payment?: { method?: string; amountCents?: number; reference?: string };
      note?: string;
      pickedUpAt?: string;
      waiveLatePickup?: boolean;
    };
  }>('/bookings/:bookingId/checkout', async (req, reply) => {
    const b = req.body ?? {};
    const method = b.payment?.method;
    if (method && !MANUAL_METHODS.includes(method)) {
      return reply.code(400).send({
        error: 'Card reader payments go through the terminal, not this endpoint',
      });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      await db.query('BEGIN');
      try {
        const quote = await buildQuote(db, req.params.bookingId, {
          serviceItemIds: b.serviceItemIds ?? [],
          pickedUpAt: b.pickedUpAt,
          waiveLatePickup: b.waiveLatePickup === true,
          waivedBy: staffName(req),
        });
        if ('error' in quote) {
          await db.query('ROLLBACK');
          return reply.code(quote.code).send({ error: quote.error });
        }

        const lines = [...quote.lines];
        if (b.adjustmentCents) {
          lines.push({
            kind: 'adjustment',
            description: b.adjustmentNote?.trim() || 'Adjustment',
            quantity: 1,
            unitCents: b.adjustmentCents,
            amountCents: b.adjustmentCents,
            taxable: false,
          });
        }
        const subtotal = lines.reduce((n, l) => n + l.amountCents, 0);
        const taxable = lines.filter((l) => l.taxable).reduce((n, l) => n + l.amountCents, 0);
        const tax = Math.round((taxable * quote.taxRateBps) / 10_000);
        const total = subtotal + tax;

        const { rows: inv } = await db.query(
          `INSERT INTO invoices
             (booking_id, client_id, subtotal_cents, tax_cents, total_cents, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            req.params.bookingId, quote.clientId, subtotal, tax, total,
            b.note?.trim() || null, req.staff.id,
          ],
        );
        const invoiceId = inv[0].id;

        for (const [i, l] of lines.entries()) {
          await db.query(
            `INSERT INTO invoice_lines
               (invoice_id, kind, description, quantity, unit_cents, amount_cents, taxable, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [invoiceId, l.kind, l.description, l.quantity, l.unitCents, l.amountCents, l.taxable, i],
          );
        }

        let paid = 0;
        if (method && (b.payment?.amountCents ?? 0) > 0) {
          paid = b.payment!.amountCents!;
          await db.query(
            `INSERT INTO payments (invoice_id, amount_cents, method, reference, recorded_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [invoiceId, paid, method, b.payment?.reference?.trim() || null, req.staff.id],
          );
          await db.query(
            `UPDATE invoices SET paid_cents = $2,
               status = CASE WHEN $2 >= total_cents THEN 'paid' ELSE status END,
               paid_at = CASE WHEN $2 >= total_cents THEN now() ELSE paid_at END
             WHERE id = $1`,
            [invoiceId, paid],
          );
        }

        // Only close the stay once the money side has been written, so a
        // failure here never leaves a dog checked out with no invoice.
        // Record when the dog actually left: it is what makes a late-pickup
        // charge answerable if the owner queries it later.
        const { rows: closed } = await db.query(
          `UPDATE bookings SET status = 'checked_out',
             picked_up_at = COALESCE($2::timestamptz, now())
           WHERE id = $1 AND status = 'checked_in'
           RETURNING pet_id`,
          [req.params.bookingId, b.pickedUpAt ?? null],
        );
        if (!closed[0]) {
          await db.query('ROLLBACK');
          return reply.code(409).send({ error: 'This stay is not checked in' });
        }
        await db.query(
          `INSERT INTO care_events (booking_id, pet_id, type, staff_name, staff_id, note)
           VALUES ($1, $2, 'checkout', $3, $4, $5)`,
          [
            req.params.bookingId, closed[0].pet_id, req.staff.name, req.staff.id,
            `Checked out. Invoice ${money(total)}${paid ? `, paid ${money(paid)} by ${method}` : ', unpaid'}.`,
          ],
        );

        await db.query('COMMIT');
        return {
          invoiceId,
          subtotalCents: subtotal,
          taxCents: tax,
          totalCents: total,
          paidCents: paid,
          balanceCents: total - paid,
        };
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    });
  });

  app.get<{ Params: { invoiceId: string } }>('/invoices/:invoiceId', async (req, reply) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT i.*, c.first_name || ' ' || c.last_name AS client_name, p.name AS pet_name
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         LEFT JOIN bookings b ON b.id = i.booking_id
         LEFT JOIN pets p ON p.id = b.pet_id
         WHERE i.id = $1`,
        [req.params.invoiceId],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Invoice not found' });
      const { rows: lines } = await db.query(
        `SELECT kind, description, quantity, unit_cents, amount_cents
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`,
        [req.params.invoiceId],
      );
      const { rows: pays } = await db.query(
        `SELECT amount_cents, method, reference, created_at
         FROM payments WHERE invoice_id = $1 ORDER BY created_at`,
        [req.params.invoiceId],
      );
      const i = rows[0];
      return {
        id: i.id,
        status: i.status,
        clientName: i.client_name,
        petName: i.pet_name,
        subtotalCents: i.subtotal_cents,
        taxCents: i.tax_cents,
        totalCents: i.total_cents,
        paidCents: i.paid_cents,
        createdAt: i.created_at,
        lines: lines.map((l) => ({
          kind: l.kind,
          description: l.description,
          quantity: Number(l.quantity),
          unitCents: l.unit_cents,
          amountCents: l.amount_cents,
        })),
        payments: pays.map((p) => ({
          amountCents: p.amount_cents,
          method: p.method,
          reference: p.reference,
          createdAt: p.created_at,
        })),
      };
    });
  });
}

interface QuoteLine {
  kind: 'boarding' | 'daycare' | 'service' | 'adjustment';
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  taxable: boolean;
}

/**
 * Price a stay. Boarding bills nights (check-out day is not a night); daycare
 * bills the day. Rates come from the run the pet actually occupied, falling
 * back to its type when a run was never assigned.
 */
/**
 * Whose name goes on a waiver. Read from the session, never from the request
 * body, so nobody can attribute a discount to a colleague.
 */
function staffName(req: { staff?: { name?: string } }): string | undefined {
  return req.staff?.name;
}

async function buildQuote(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  bookingId: string,
  opts: {
    serviceItemIds?: string[];
    pickedUpAt?: string;
    /** Cancel the after-cutoff day. The charge still appears; see below. */
    waiveLatePickup?: boolean;
    /** Who granted the waiver. From the session, never from the request body. */
    waivedBy?: string;
  } = {},
): Promise<
  | { error: string; code: number }
  | {
      bookingId: string; clientId: string; petName: string; clientName: string;
      serviceType: string; startDate: string; endDate: string; nights: number;
      runLabel: string; taxRateBps: number; lines: QuoteLine[];
      subtotalCents: number; taxCents: number; totalCents: number;
      pickupCutoff: string; afterCutoff: boolean; timezone: string;
      latePickupCents: number; latePickupWaived: boolean;
    }
> {
  const { serviceItemIds = [], pickedUpAt, waiveLatePickup = false, waivedBy } = opts;
  const { rows } = await db.query(
    `SELECT b.id, b.client_id, b.service_type, b.status,
            b.start_date::text AS start_date, b.end_date::text AS end_date,
            (b.end_date - b.start_date) AS nights,
            p.name AS pet_name,
            c.first_name || ' ' || c.last_name AS client_name,
            r.code AS run_code, r.label AS run_label,
            COALESCE(NULLIF(r.rate_cents, 0), t.rate_cents, 0) AS rate_cents,
            t.name AS type_name
     FROM bookings b
     JOIN pets p ON p.id = b.pet_id
     JOIN clients c ON c.id = b.client_id
     LEFT JOIN runs r ON r.id = b.run_id
     LEFT JOIN run_types t ON t.id = r.run_type_id
     WHERE b.id = $1`,
    [bookingId],
  );
  const b = rows[0];
  if (!b) return { error: 'Booking not found', code: 404 };

  const { rows: existing } = await db.query(
    `SELECT id FROM invoices WHERE booking_id = $1 AND status <> 'void'`,
    [bookingId],
  );
  if (existing[0]) return { error: 'This stay has already been invoiced', code: 409 };

  // Evaluate the cutoff against the facility's own clock. Comparing an 11:00
  // cutoff to UTC now() would bill an extra day to anyone collecting after 6am
  // local, which is most of the morning.
  const { rows: fs } = await db.query(
    `SELECT tax_rate_bps, pickup_cutoff, timezone,
            to_char(pickup_cutoff, 'HH12:MI AM') AS cutoff_label,
            -- ::text, not a bare date: the driver hands back a JS Date whose
            -- string form is not ISO, which silently breaks day arithmetic.
            ((COALESCE($1::timestamptz, now()) AT TIME ZONE timezone)::date)::text
              AS local_pickup_date,
            (COALESCE($1::timestamptz, now()) AT TIME ZONE timezone)::time  AS local_pickup_time,
            ((COALESCE($1::timestamptz, now()) AT TIME ZONE timezone)::time > pickup_cutoff)
              AS after_cutoff
     FROM facility_settings WHERE singleton`,
    [pickedUpAt ?? null],
  );
  const taxRateBps = fs[0]?.tax_rate_bps ?? 0;

  const rate = Number(b.rate_cents) || 0;
  const lines: QuoteLine[] = [];
  const runLabel = b.run_label ?? b.run_code ?? 'Unassigned';
  let latePickupCents = 0;
  let latePickupWaived = false;

  if (b.service_type === 'boarding') {
    const nights = Math.max(1, Number(b.nights));
    lines.push({
      kind: 'boarding',
      description: `Boarding · ${b.type_name ?? runLabel} · ${b.start_date} → ${b.end_date}`,
      quantity: nights,
      unitCents: rate,
      amountCents: nights * rate,
      taxable: true,
    });

    // The pickup day is free if the run is back in service that morning.
    // Past the cutoff it cannot be re-let, so it is charged — and a dog
    // collected days late owes for each of those days too.
    const localPickup: string = fs[0].local_pickup_date;
    const daysBeyond = Math.max(
      0,
      Math.round(
        (Date.parse(`${localPickup}T12:00:00Z`) - Date.parse(`${b.end_date}T12:00:00Z`)) /
          86_400_000,
      ),
    );
    const extraDays = daysBeyond + (fs[0].after_cutoff ? 1 : 0);
    if (extraDays > 0) {
      latePickupCents = extraDays * rate;
      lines.push({
        kind: 'boarding',
        description:
          daysBeyond > 0
            ? `Late collection · ${daysBeyond + (fs[0].after_cutoff ? 1 : 0)} day${extraDays === 1 ? '' : 's'} past ${b.end_date}`
            : `Pickup after ${fs[0].cutoff_label} · pickup day charged`,
        quantity: extraDays,
        unitCents: rate,
        amountCents: latePickupCents,
        taxable: true,
      });

      // A waiver cancels the charge with a second line rather than deleting the
      // first. Months later, "why was this stay cheaper?" is a question someone
      // will ask, and a bill that quietly disagrees with the stated policy
      // cannot answer it. Taxable, mirroring the charge, so the tax comes off
      // with it instead of being levied on money nobody paid.
      if (waiveLatePickup) {
        latePickupWaived = true;
        lines.push({
          kind: 'adjustment',
          description: `Late pickup waived${waivedBy ? ` · ${waivedBy}` : ''}`,
          quantity: 1,
          unitCents: -latePickupCents,
          amountCents: -latePickupCents,
          taxable: true,
        });
      }
    }
  } else {
    lines.push({
      kind: 'daycare',
      description: `Daycare · ${runLabel} · ${b.start_date}`,
      quantity: 1,
      unitCents: rate,
      amountCents: rate,
      taxable: true,
    });
  }

  // Extras agreed at drop-off, at the price quoted then rather than today's.
  const { rows: agreed } = await db.query(
    `SELECT name, unit_cents, quantity, taxable FROM booking_services
     WHERE booking_id = $1 ORDER BY created_at`,
    [bookingId],
  );
  for (const s of agreed) {
    lines.push({
      kind: 'service',
      description: s.name,
      quantity: s.quantity,
      unitCents: s.unit_cents,
      amountCents: s.unit_cents * s.quantity,
      taxable: s.taxable,
    });
  }

  // Anything added at the till on top.
  if (serviceItemIds.length > 0) {
    const { rows: items } = await db.query(
      `SELECT id, name, price_cents, taxable FROM service_items
       WHERE id = ANY($1) AND active`,
      [serviceItemIds],
    );
    for (const item of items) {
      lines.push({
        kind: 'service',
        description: item.name,
        quantity: 1,
        unitCents: item.price_cents,
        amountCents: item.price_cents,
        taxable: item.taxable,
      });
    }
  }

  const subtotal = lines.reduce((n, l) => n + l.amountCents, 0);
  const taxableTotal = lines.filter((l) => l.taxable).reduce((n, l) => n + l.amountCents, 0);
  const tax = Math.round((taxableTotal * taxRateBps) / 10_000);

  return {
    bookingId: b.id,
    clientId: b.client_id,
    petName: b.pet_name,
    clientName: b.client_name,
    serviceType: b.service_type,
    startDate: b.start_date,
    endDate: b.end_date,
    nights: Number(b.nights),
    runLabel,
    taxRateBps,
    lines,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    pickupCutoff: fs[0].cutoff_label,
    afterCutoff: Boolean(fs[0].after_cutoff),
    timezone: fs[0].timezone,
    latePickupCents,
    latePickupWaived,
  };
}

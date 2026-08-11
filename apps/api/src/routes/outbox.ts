import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';
import { queueEmail, sendReleased, vaccineReminder } from '../outbox.js';

/** The window the facility warns on. Matches the dashboard alert. */
const DEFAULT_WINDOW_DAYS = 30;

export async function outboxRoutes(app: FastifyInstance): Promise<void> {
  /** The review queue. Defaults to what still needs a decision. */
  app.get<{ Querystring: { status?: string; kind?: string } }>(
    '/outbox',
    async (req) => {
      const status = req.query.status ?? 'queued';
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `SELECT e.id, e.kind, e.status, e.to_email, e.subject, e.body,
                  e.created_at, e.released_at, e.sent_at, e.attempts, e.last_error,
                  e.booking_id, e.invoice_id,
                  c.first_name || ' ' || c.last_name AS client_name,
                  s.first_name || ' ' || s.last_name AS released_by_name
             FROM outbound_emails e
             JOIN clients c ON c.id = e.client_id
             LEFT JOIN staff s ON s.id = e.released_by
            WHERE ($1 = 'all' OR e.status = $1)
              AND ($2::text IS NULL OR e.kind = $2)
            ORDER BY e.created_at DESC
            LIMIT 300`,
          [status, req.query.kind ?? null],
        );

        const { rows: counts } = await db.query(
          `SELECT status, COUNT(*)::int AS n FROM outbound_emails GROUP BY status`,
        );

        return {
          messages: rows.map((m) => ({
            id: m.id,
            kind: m.kind,
            status: m.status,
            toEmail: m.to_email,
            subject: m.subject,
            body: m.body,
            clientName: m.client_name,
            createdAt: m.created_at,
            releasedAt: m.released_at,
            releasedByName: m.released_by_name,
            sentAt: m.sent_at,
            attempts: m.attempts,
            lastError: m.last_error,
            bookingId: m.booking_id,
            invoiceId: m.invoice_id,
          })),
          counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
        };
      });
    },
  );

  /**
   * Release messages and attempt them straight away. Attribution comes from
   * the session: "who let this go out" is the whole point of holding them.
   */
  app.post<{ Body: { ids?: string[]; all?: boolean; kind?: string } }>(
    '/outbox/release',
    async (req, reply) => {
      const { ids, all, kind } = req.body ?? {};
      if (!all && (!ids || ids.length === 0)) {
        return reply.code(400).send({ error: 'Choose at least one message' });
      }

      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows: released } = await db.query(
          `UPDATE outbound_emails
              SET released_at = now(), released_by = $1
            WHERE status = 'queued' AND released_at IS NULL
              AND ($2::boolean OR id = ANY($3::uuid[]))
              AND ($4::text IS NULL OR kind = $4)
            RETURNING id`,
          [req.staff.id, all === true, ids ?? [], kind ?? null],
        );

        const result = await sendReleased(db, (msg, meta) => req.log.warn(meta ?? {}, msg));
        return { released: released.length, ...result };
      });
    },
  );

  /** Cancel without sending. The dedupe index allows a corrected replacement. */
  app.post<{ Body: { ids?: string[] } }>('/outbox/cancel', async (req, reply) => {
    const ids = req.body?.ids ?? [];
    if (ids.length === 0) return reply.code(400).send({ error: 'Choose at least one message' });

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `UPDATE outbound_emails SET status = 'canceled'
          WHERE status = 'queued' AND id = ANY($1::uuid[])
          RETURNING id`,
        [ids],
      );
      return { canceled: rows.length };
    });
  });

  /** Put a failed message back in the queue, still released. */
  app.post<{ Body: { ids?: string[] } }>('/outbox/retry', async (req, reply) => {
    const ids = req.body?.ids ?? [];
    if (ids.length === 0) return reply.code(400).send({ error: 'Choose at least one message' });

    return withTenant(req.tenant.schemaName, async (db) => {
      await db.query(
        `UPDATE outbound_emails
            SET status = 'queued', released_at = COALESCE(released_at, now()), last_error = NULL
          WHERE status = 'failed' AND id = ANY($1::uuid[])`,
        [ids],
      );
      const result = await sendReleased(db, (msg, meta) => req.log.warn(meta ?? {}, msg));
      return result;
    });
  });

  /**
   * Build vaccine reminders for everyone with something expiring inside the
   * window. One message per client rather than per vaccination: three notes
   * about the same dog on the same morning reads as a system malfunctioning,
   * not as diligence.
   */
  app.post<{ Body: { withinDays?: number } }>('/outbox/vaccine-sweep', async (req, reply) => {
    const withinDays = Number(req.body?.withinDays ?? DEFAULT_WINDOW_DAYS);
    if (!Number.isFinite(withinDays) || withinDays < 1 || withinDays > 365) {
      return reply.code(400).send({ error: 'withinDays must be between 1 and 365' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id AS client_id, c.first_name, c.email,
                v.id AS vaccination_id, v.vaccine, v.expires_on::text AS expires_on,
                (v.expires_on - facility_today())::int AS days_left,
                p.name AS pet_name
           FROM vaccinations v
           JOIN pets p ON p.id = v.pet_id
           JOIN clients c ON c.id = p.client_id
          WHERE v.expires_on <= facility_today() + $1::int
            AND COALESCE(c.email, '') <> ''
          ORDER BY c.id, v.expires_on, p.name`,
        [withinDays],
      );

      const { rows: tenantRow } = await db.query(
        `SELECT name FROM platform.tenants WHERE schema_name = current_schema()`,
      );
      const facility = tenantRow[0]?.name ?? 'Your pet care team';

      // Group per client so one owner gets one note.
      const byClient = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = byClient.get(r.client_id) ?? [];
        list.push(r);
        byClient.set(r.client_id, list);
      }

      let queued = 0;
      let skipped = 0;
      for (const [clientId, items] of byClient) {
        const first = items[0];
        const { subject, body } = vaccineReminder({
          facility,
          clientFirstName: first.first_name,
          items: items.map((i) => ({
            petName: i.pet_name,
            vaccine: i.vaccine,
            expiresOn: i.expires_on,
            daysLeft: i.days_left,
          })),
        });

        // Keyed on the exact set of records, so a client whose situation has
        // not changed is not written to again, while a newly lapsed vaccine
        // produces a genuinely new message.
        const dedupeKey = `vaccine:${clientId}:${items
          .map((i) => i.vaccination_id)
          .sort()
          .join(',')}`;

        const result = await queueEmail(db, {
          kind: 'vaccine_expiry',
          clientId,
          toEmail: first.email,
          subject,
          body,
          dedupeKey,
        });
        if (result) queued += 1;
        else skipped += 1;
      }

      // Auto-release is off for reminders by default, so this usually sends
      // nothing and simply fills the review queue.
      const sent = await sendReleased(db, (msg, meta) => req.log.warn(meta ?? {}, msg));

      return {
        clientsConsidered: byClient.size,
        queued,
        alreadyQueued: skipped,
        ...sent,
      };
    });
  });

  /** Drain anything released but not yet delivered. Safe to call repeatedly. */
  app.post('/outbox/send-pending', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      return sendReleased(db, (msg, meta) => req.log.warn(meta ?? {}, msg));
    });
  });
}

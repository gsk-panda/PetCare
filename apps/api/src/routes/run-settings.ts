import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from '../db.js';
import { MANAGES_SETTINGS } from '../staff-auth.js';

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
const MAX_BULK = 60;

/**
 * Kennel inventory configuration: the classes of run a facility has, and the
 * individual runs within them.
 *
 * Deleting is real deletion, but only when nothing depends on the record. A
 * run a dog has ever stayed in is history, so it retires instead — the board
 * stops offering it while past bookings still resolve.
 */
export async function runSettingsRoutes(app: FastifyInstance): Promise<void> {
  const requireManager = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<undefined> => {
    if (!MANAGES_SETTINGS.includes(req.staff.role)) {
      reply.code(403).send({ error: 'Only an owner or manager can change facility settings' });
    }
    return undefined;
  };

  /* ------------------------------ read ------------------------------ */
  app.get('/settings/run-types', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: types } = await db.query(
        `SELECT t.id, t.name, t.zone_label, t.kind, t.default_capacity,
                t.display_order, t.active, t.rate_cents,
                COUNT(r.id)::int AS run_count,
                COUNT(r.id) FILTER (WHERE r.active)::int AS active_run_count
         FROM run_types t
         LEFT JOIN runs r ON r.run_type_id = t.id
         GROUP BY t.id
         ORDER BY t.active DESC, t.display_order, t.name`,
      );
      const { rows: runs } = await db.query(
        `SELECT r.id, r.code, r.capacity, r.display_order, r.active, r.run_type_id,
                EXISTS (SELECT 1 FROM bookings b WHERE b.run_id = r.id) AS has_history,
                EXISTS (
                  SELECT 1 FROM bookings b
                  WHERE b.run_id = r.id
                    AND b.status IN ('requested', 'confirmed', 'checked_in')
                    AND b.end_date >= CURRENT_DATE
                ) AS in_use
         FROM runs r
         WHERE r.kind IN ('suite', 'run')
         ORDER BY r.code_prefix, r.code_number, r.code`,
      );
      return {
        types: types.map((t) => ({
          id: t.id,
          name: t.name,
          zoneLabel: t.zone_label,
          kind: t.kind,
          defaultCapacity: t.default_capacity,
          rateCents: t.rate_cents,
          displayOrder: t.display_order,
          active: t.active,
          runCount: t.run_count,
          activeRunCount: t.active_run_count,
          runs: runs
            .filter((r) => r.run_type_id === t.id)
            .map((r) => ({
              id: r.id,
              code: r.code,
              capacity: r.capacity,
              active: r.active,
              hasHistory: r.has_history,
              inUse: r.in_use,
            })),
        })),
      };
    });
  });

  /* --------------------------- run types --------------------------- */
  app.post<{
    Body: { name?: string; zoneLabel?: string; kind?: string; defaultCapacity?: number };
  }>('/settings/run-types', { preHandler: requireManager }, async (req, reply) => {
    const name = req.body?.name?.trim();
    const kind = req.body?.kind ?? 'run';
    const capacity = req.body?.defaultCapacity ?? 1;
    if (!name) return reply.code(400).send({ error: 'Give the run type a name' });
    if (kind !== 'suite' && kind !== 'run') {
      return reply.code(400).send({ error: "Kind must be 'suite' or 'run'" });
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
      return reply.code(400).send({ error: 'Default capacity must be between 1 and 20' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO run_types (name, zone_label, kind, default_capacity, display_order)
         VALUES ($1, $2, $3, $4,
                 COALESCE((SELECT MAX(display_order) + 1 FROM run_types), 1))
         RETURNING id`,
        [name, req.body?.zoneLabel?.trim() || name, kind, capacity],
      );
      reply.code(201);
      return { id: rows[0].id };
    });
  });

  app.patch<{
    Params: { typeId: string };
    Body: {
      name?: string; zoneLabel?: string; defaultCapacity?: number;
      active?: boolean; rateCents?: number;
    };
  }>('/settings/run-types/:typeId', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.rateCents !== undefined &&
        (!Number.isInteger(b.rateCents) || b.rateCents < 0 || b.rateCents > 1_000_000)) {
      return reply.code(400).send({ error: 'Nightly rate must be between $0 and $10,000' });
    }
    if (b.name !== undefined && !b.name.trim()) {
      return reply.code(400).send({ error: 'Name cannot be empty' });
    }
    if (b.defaultCapacity !== undefined &&
        (!Number.isInteger(b.defaultCapacity) || b.defaultCapacity < 1 || b.defaultCapacity > 20)) {
      return reply.code(400).send({ error: 'Default capacity must be between 1 and 20' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      if (b.active === false) {
        const { rows: busy } = await db.query(
          `SELECT COUNT(*)::int AS n FROM runs r
           JOIN bookings bk ON bk.run_id = r.id
           WHERE r.run_type_id = $1
             AND bk.status IN ('requested', 'confirmed', 'checked_in')
             AND bk.end_date >= CURRENT_DATE`,
          [req.params.typeId],
        );
        if (busy[0].n > 0) {
          return reply.code(409).send({
            error: `${busy[0].n} upcoming booking${busy[0].n === 1 ? '' : 's'} use runs of this type. Move them first.`,
          });
        }
      }

      const { rows } = await db.query(
        `UPDATE run_types SET
           name = COALESCE($2, name),
           zone_label = COALESCE($3, zone_label),
           default_capacity = COALESCE($4, default_capacity),
           active = COALESCE($5, active),
           rate_cents = COALESCE($6, rate_cents)
         WHERE id = $1
         RETURNING id, zone_label, active`,
        [
          req.params.typeId, b.name?.trim() ?? null, b.zoneLabel?.trim() ?? null,
          b.defaultCapacity ?? null, b.active ?? null, b.rateCents ?? null,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Run type not found' });

      // The board groups by runs.zone, so a renamed zone has to reach the runs.
      if (b.zoneLabel !== undefined) {
        await db.query('UPDATE runs SET zone = $2 WHERE run_type_id = $1', [
          rows[0].id, rows[0].zone_label,
        ]);
      }
      // Retiring a type retires the runs under it, or the board would keep
      // offering runs whose type is gone.
      if (b.active === false) {
        await db.query('UPDATE runs SET active = false WHERE run_type_id = $1', [rows[0].id]);
      }
      return { ok: true };
    });
  });

  app.delete<{ Params: { typeId: string } }>(
    '/settings/run-types/:typeId',
    { preHandler: requireManager },
    async (req, reply) => {
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows: used } = await db.query(
          'SELECT COUNT(*)::int AS n FROM runs WHERE run_type_id = $1',
          [req.params.typeId],
        );
        if (used[0].n > 0) {
          return reply.code(409).send({
            error: `This type still has ${used[0].n} run${used[0].n === 1 ? '' : 's'}. Delete or move them first, or retire the type instead.`,
          });
        }
        const { rowCount } = await db.query('DELETE FROM run_types WHERE id = $1', [
          req.params.typeId,
        ]);
        if (!rowCount) return reply.code(404).send({ error: 'Run type not found' });
        return { ok: true };
      });
    },
  );

  /* ------------------------------ runs ------------------------------ */
  app.post<{
    Body: { runTypeId?: string; code?: string; capacity?: number; count?: number; startAt?: number };
  }>('/settings/runs', { preHandler: requireManager }, async (req, reply) => {
    const { runTypeId, code, count = 1, startAt } = req.body ?? {};
    if (!runTypeId) return reply.code(400).send({ error: 'Choose a run type' });
    const prefix = code?.trim().toUpperCase() ?? '';
    if (!prefix) return reply.code(400).send({ error: 'Give the run a code, e.g. C13' });
    if (!Number.isInteger(count) || count < 1 || count > MAX_BULK) {
      return reply.code(400).send({ error: `Create between 1 and ${MAX_BULK} runs at a time` });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows: type } = await db.query(
        'SELECT id, zone_label, kind, default_capacity FROM run_types WHERE id = $1',
        [runTypeId],
      );
      if (!type[0]) return reply.code(404).send({ error: 'Run type not found' });
      const capacity = req.body?.capacity ?? type[0].default_capacity;
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
        return reply.code(400).send({ error: 'Capacity must be between 1 and 20' });
      }

      // A single code creates one run; a count creates a numbered series so a
      // new wing is one action rather than twenty-four.
      const letters = prefix.replace(/\d+$/, '');
      const firstNumber = startAt ?? Number(prefix.match(/(\d+)$/)?.[1] ?? 1);
      const codes =
        count === 1 && /\d$/.test(prefix)
          ? [prefix]
          : Array.from({ length: count }, (_, i) => `${letters}${firstNumber + i}`);

      for (const c of codes) {
        if (!CODE_RE.test(c)) {
          return reply.code(400).send({ error: `'${c}' is not a valid run code` });
        }
      }

      const { rows: clashes } = await db.query(
        'SELECT code FROM runs WHERE code = ANY($1)',
        [codes],
      );
      if (clashes.length > 0) {
        return reply.code(409).send({
          error: `Already in use: ${clashes.map((c) => c.code).join(', ')}`,
        });
      }

      // Ordering comes from code_prefix/code_number, not this column. Seed it
      // from the code anyway so nothing reading display_order disagrees with
      // where the run actually appears.
      await db.query(
        `INSERT INTO runs (code, zone, kind, capacity, display_order, run_type_id)
         SELECT c.code, $2, $3, $4,
                COALESCE(NULLIF(substring(c.code from '[0-9]+$'), '')::integer, 0),
                $5
         FROM unnest($1::text[]) AS c(code)`,
        [codes, type[0].zone_label, type[0].kind, capacity, runTypeId],
      );
      reply.code(201);
      return { created: codes.length, codes };
    });
  });

  app.patch<{
    Params: { runId: string };
    Body: { code?: string; capacity?: number; active?: boolean };
  }>('/settings/runs/:runId', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body ?? {};
    const code = b.code?.trim().toUpperCase();
    if (code !== undefined && !CODE_RE.test(code)) {
      return reply.code(400).send({ error: 'Codes use A-Z, 0-9, dash or underscore' });
    }
    if (b.capacity !== undefined &&
        (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 20)) {
      return reply.code(400).send({ error: 'Capacity must be between 1 and 20' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      if (b.active === false) {
        const { rows: busy } = await db.query(
          `SELECT COUNT(*)::int AS n FROM bookings
           WHERE run_id = $1 AND status IN ('requested', 'confirmed', 'checked_in')
             AND end_date >= CURRENT_DATE`,
          [req.params.runId],
        );
        if (busy[0].n > 0) {
          return reply.code(409).send({
            error: `A dog is booked into this run. Move the booking before retiring it.`,
          });
        }
      }
      if (code) {
        const { rows: clash } = await db.query(
          'SELECT id FROM runs WHERE code = $1 AND id <> $2',
          [code, req.params.runId],
        );
        if (clash[0]) return reply.code(409).send({ error: `${code} is already in use` });
      }

      const { rows } = await db.query(
        `UPDATE runs SET
           code = COALESCE($2, code),
           capacity = COALESCE($3, capacity),
           active = COALESCE($4, active)
         WHERE id = $1 AND kind IN ('suite', 'run')
         RETURNING id`,
        [req.params.runId, code ?? null, b.capacity ?? null, b.active ?? null],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Run not found' });
      return { ok: true };
    });
  });

  app.delete<{ Params: { runId: string } }>(
    '/settings/runs/:runId',
    { preHandler: requireManager },
    async (req, reply) => {
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows: history } = await db.query(
          'SELECT COUNT(*)::int AS n FROM bookings WHERE run_id = $1',
          [req.params.runId],
        );
        if (history[0].n > 0) {
          return reply.code(409).send({
            error: `This run has ${history[0].n} booking${history[0].n === 1 ? '' : 's'} against it. Retire it instead so past stays still resolve.`,
          });
        }
        const { rowCount } = await db.query(
          `DELETE FROM runs WHERE id = $1 AND kind IN ('suite', 'run')`,
          [req.params.runId],
        );
        if (!rowCount) return reply.code(404).send({ error: 'Run not found' });
        return { ok: true };
      });
    },
  );
}

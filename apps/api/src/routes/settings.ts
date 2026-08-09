import type { FastifyInstance } from 'fastify';
import { withTenant } from '../db.js';
import { MANAGES_SETTINGS } from '../staff-auth.js';

const CODE_RE = /^[A-Z0-9_-]{2,16}$/;

/**
 * Per-tenant facility configuration. Today this is play groups; runs and
 * business hours belong here too as they become configurable.
 *
 * A single-group daycare is a normal setup — plenty of facilities run one
 * mixed group — so nothing here assumes more than one exists.
 */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // Anyone signed in can read the configuration; changing it is a manager job.
  const requireManager = async (
    req: { staff: { role: string } },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (!MANAGES_SETTINGS.includes(req.staff.role as never)) {
      return reply.code(403).send({
        error: 'Only an owner or manager can change facility settings',
      });
    }
  };

  app.get('/settings/play-groups', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT r.id, r.code, r.label, r.capacity, r.display_order, r.active, r.rate_cents,
                COUNT(b.id) FILTER (
                  WHERE b.status IN ('confirmed', 'checked_in')
                    AND b.start_date = CURRENT_DATE
                )::int AS today
         FROM runs r
         LEFT JOIN bookings b ON b.run_id = r.id AND b.service_type = 'daycare'
         WHERE r.kind = 'playgroup'
         GROUP BY r.id
         ORDER BY r.active DESC, r.display_order, r.code`,
      );
      return {
        groups: rows.map((g) => ({
          id: g.id,
          code: g.code,
          label: g.label ?? g.code,
          capacity: g.capacity,
          displayOrder: g.display_order,
          rateCents: g.rate_cents,
          active: g.active,
          bookedToday: g.today,
        })),
      };
    });
  });

  app.post<{ Body: { code?: string; label?: string; capacity?: number } }>(
    '/settings/play-groups',
    { preHandler: requireManager },
    async (req, reply) => {
      const label = req.body?.label?.trim();
      const capacity = Number(req.body?.capacity);
      if (!label) return reply.code(400).send({ error: 'label is required' });
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
        return reply.code(400).send({ error: 'capacity must be a whole number from 1 to 200' });
      }
      // Derive a stable code from the label unless one was supplied; bookings
      // key to the row, but the code is what staff see on run cards.
      const code =
        req.body?.code?.trim().toUpperCase() ||
        `GRP_${label.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'NEW'}`;
      if (!CODE_RE.test(code)) {
        return reply.code(400).send({ error: 'code must be 2-16 chars: A-Z, 0-9, dash or underscore' });
      }

      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows: clash } = await db.query('SELECT id FROM runs WHERE code = $1', [code]);
        if (clash[0]) return reply.code(409).send({ error: `A run or group already uses ${code}` });

        const { rows } = await db.query(
          `INSERT INTO runs (code, zone, kind, capacity, display_order, label)
           VALUES ($1, 'Daycare play groups', 'playgroup', $2,
                   COALESCE((SELECT MAX(display_order) + 1 FROM runs WHERE kind = 'playgroup'), 1),
                   $3)
           RETURNING id`,
          [code, capacity, label],
        );
        reply.code(201);
        return { id: rows[0].id, code };
      });
    },
  );

  app.patch<{
    Params: { groupId: string };
    Body: { label?: string; capacity?: number; active?: boolean; rateCents?: number };
  }>('/settings/play-groups/:groupId', { preHandler: requireManager }, async (req, reply) => {
    const { label, capacity, active, rateCents } = req.body ?? {};
    if (rateCents !== undefined &&
        (!Number.isInteger(rateCents) || rateCents < 0 || rateCents > 1_000_000)) {
      return reply.code(400).send({ error: 'Daily rate must be between $0 and $10,000' });
    }
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > 200)) {
      return reply.code(400).send({ error: 'capacity must be a whole number from 1 to 200' });
    }
    if (label !== undefined && !label.trim()) {
      return reply.code(400).send({ error: 'label cannot be empty' });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      // Retiring a group with dogs booked into it today would strand them.
      if (active === false) {
        const { rows: busy } = await db.query(
          `SELECT COUNT(*)::int AS n FROM bookings
           WHERE run_id = $1 AND service_type = 'daycare'
             AND status IN ('requested', 'confirmed', 'checked_in')
             AND start_date >= CURRENT_DATE`,
          [req.params.groupId],
        );
        if (busy[0].n > 0) {
          return reply.code(409).send({
            error: `${busy[0].n} upcoming booking${busy[0].n === 1 ? '' : 's'} still use this group. Move them first.`,
          });
        }
      }

      const { rows } = await db.query(
        `UPDATE runs SET
           label = COALESCE($2, label),
           capacity = COALESCE($3, capacity),
           active = COALESCE($4, active),
           rate_cents = COALESCE($5, rate_cents)
         WHERE id = $1 AND kind = 'playgroup'
         RETURNING id, code, label, capacity, active`,
        [req.params.groupId, label?.trim() ?? null, capacity ?? null, active ?? null, rateCents ?? null],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Play group not found' });
      return {
        id: rows[0].id,
        code: rows[0].code,
        label: rows[0].label ?? rows[0].code,
        capacity: rows[0].capacity,
        active: rows[0].active,
      };
    });
  });
}

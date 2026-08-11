import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from '../db.js';
import { MANAGES_SETTINGS } from '../staff-auth.js';

const KINDS = ['add', 'change', 'remove'];
/** Long enough for a paragraph of context, short enough to stay a list. */
const MAX_BODY = 2000;

export async function changeRequestRoutes(app: FastifyInstance): Promise<void> {
  const requireManager = async (req: FastifyRequest, reply: FastifyReply): Promise<undefined> => {
    if (!MANAGES_SETTINGS.includes(req.staff.role)) {
      reply.code(403).send({ error: 'Only an owner or manager can change this list' });
    }
    return undefined;
  };

  /** Readable by any signed-in staff member — seeing the list is not editing it. */
  app.get('/settings/change-requests', async (req) => {
    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `SELECT r.id, r.kind, r.body, r.done, r.created_at, r.updated_at,
                c.first_name || ' ' || c.last_name AS created_by_name,
                u.first_name || ' ' || u.last_name AS updated_by_name
           FROM change_requests r
           LEFT JOIN staff c ON c.id = r.created_by
           LEFT JOIN staff u ON u.id = r.updated_by
          ORDER BY r.done, r.created_at DESC`,
      );
      return {
        requests: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          body: r.body,
          done: r.done,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          createdByName: r.created_by_name,
          updatedByName: r.updated_by_name,
        })),
      };
    });
  });

  app.post<{ Body: { kind?: string; body?: string } }>(
    '/settings/change-requests',
    { preHandler: requireManager },
    async (req, reply) => {
      const body = req.body?.body?.trim() ?? '';
      const kind = req.body?.kind ?? 'add';
      if (!body) return reply.code(400).send({ error: 'Write what should change' });
      if (body.length > MAX_BODY) {
        return reply.code(400).send({ error: `Keep it under ${MAX_BODY} characters` });
      }
      if (!KINDS.includes(kind)) {
        return reply.code(400).send({ error: "kind must be 'add', 'change' or 'remove'" });
      }

      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO change_requests (kind, body, created_by, updated_by)
           VALUES ($1, $2, $3, $3) RETURNING id`,
          [kind, body, req.staff.id],
        );
        reply.code(201);
        return { id: rows[0].id };
      });
    },
  );

  app.patch<{
    Params: { requestId: string };
    Body: { kind?: string; body?: string; done?: boolean };
  }>('/settings/change-requests/:requestId', { preHandler: requireManager }, async (req, reply) => {
    const b = req.body ?? {};
    if (b.body !== undefined && !b.body.trim()) {
      return reply.code(400).send({ error: 'The note cannot be empty' });
    }
    if (b.body !== undefined && b.body.length > MAX_BODY) {
      return reply.code(400).send({ error: `Keep it under ${MAX_BODY} characters` });
    }
    if (b.kind !== undefined && !KINDS.includes(b.kind)) {
      return reply.code(400).send({ error: "kind must be 'add', 'change' or 'remove'" });
    }

    return withTenant(req.tenant.schemaName, async (db) => {
      const { rows } = await db.query(
        `UPDATE change_requests
            SET kind = COALESCE($2, kind),
                body = COALESCE($3, body),
                done = COALESCE($4, done),
                updated_at = now(),
                updated_by = $5
          WHERE id = $1
          RETURNING id`,
        [
          req.params.requestId,
          b.kind ?? null,
          b.body?.trim() ?? null,
          b.done ?? null,
          req.staff.id,
        ],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      return { ok: true };
    });
  });

  /**
   * Genuinely deleted rather than hidden. This is the facility's own scratch
   * list, not a record anyone audits, and a wish list you cannot clear out
   * stops being read.
   */
  app.delete<{ Params: { requestId: string } }>(
    '/settings/change-requests/:requestId',
    { preHandler: requireManager },
    async (req, reply) => {
      return withTenant(req.tenant.schemaName, async (db) => {
        const { rows } = await db.query(
          'DELETE FROM change_requests WHERE id = $1 RETURNING id',
          [req.params.requestId],
        );
        if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
        return { ok: true };
      });
    },
  );
}

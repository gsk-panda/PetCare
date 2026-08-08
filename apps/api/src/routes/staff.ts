import type { FastifyInstance } from 'fastify';
import {
  clearStaffCookie,
  readStaffCookie,
  revokeStaffSession,
  setStaffCookie,
  signIn,
} from '../staff-auth.js';

/**
 * Public staff auth. Sign-in must sit outside the protected tree, or nobody
 * could ever get a session.
 */
export async function staffAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { email?: string; password?: string } }>(
    '/staff/login',
    async (req, reply) => {
      const email = req.body?.email?.trim() ?? '';
      const password = req.body?.password ?? '';
      if (!email || !password) {
        return reply.code(400).send({ error: 'Enter your email and password' });
      }

      const result = await signIn(
        req.tenant.schemaName,
        email,
        password,
        req.headers['user-agent'],
      );
      if (!result) {
        // One message for every failure mode: wrong email, wrong password and
        // deactivated account are indistinguishable from outside.
        return reply.code(401).send({ error: 'That email and password do not match' });
      }

      setStaffCookie(reply, result.token, result.expiresAt);
      req.log.info({ staffId: result.staff.id, role: result.staff.role }, 'staff signed in');
      return { staff: result.staff };
    },
  );

  app.post('/staff/logout', async (req, reply) => {
    await revokeStaffSession(req.tenant.schemaName, readStaffCookie(req));
    clearStaffCookie(reply);
    return { ok: true };
  });
}

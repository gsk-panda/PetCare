import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTenant } from './db.js';

export const SESSION_COOKIE = 'petcare_portal';
const CODE_TTL_MINUTES = 10;
const SESSION_TTL_DAYS = 30;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Codes and session tokens are stored hashed, so a database read never yields
 * a working credential. Codes are short and human-typable; session tokens are
 * long and random.
 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function newLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export interface PortalSession {
  identityId: string;
  clientId: string;
  email: string;
}

/**
 * Issue a login code for an email that already belongs to a client. Unknown
 * emails deliberately return the same shape as known ones — the caller must
 * not be able to enumerate which addresses are customers.
 */
export async function issueLoginCode(
  schemaName: string,
  email: string,
): Promise<{ code: string; identityId: string } | null> {
  return withTenant(schemaName, async (db) => {
    const identity = await findOrLinkIdentity(db, email);
    if (!identity) return null;

    const code = newLoginCode();
    await db.query(
      `INSERT INTO portal_login_codes (identity_id, code_hash, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [identity.id, sha256(code), String(CODE_TTL_MINUTES)],
    );
    return { code, identityId: identity.id };
  });
}

/**
 * An email is a portal identity if it matches an existing client record. This
 * is how a client the desk created gets portal access without an invite step.
 */
async function findOrLinkIdentity(
  db: pg.PoolClient,
  email: string,
): Promise<{ id: string; client_id: string } | null> {
  const normalized = email.trim().toLowerCase();
  const { rows: existing } = await db.query(
    'SELECT id, client_id FROM portal_identities WHERE lower(email) = $1',
    [normalized],
  );
  if (existing[0]) return existing[0];

  const { rows: client } = await db.query(
    'SELECT id FROM clients WHERE lower(email) = $1 ORDER BY created_at LIMIT 1',
    [normalized],
  );
  if (!client[0]) return null;

  const { rows: created } = await db.query(
    'INSERT INTO portal_identities (client_id, email) VALUES ($1, $2) RETURNING id, client_id',
    [client[0].id, normalized],
  );
  return created[0];
}

export async function verifyLoginCode(
  schemaName: string,
  email: string,
  code: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date } | null> {
  return withTenant(schemaName, async (db) => {
    const { rows: identity } = await db.query(
      'SELECT id FROM portal_identities WHERE lower(email) = $1',
      [email.trim().toLowerCase()],
    );
    if (!identity[0]) return null;

    const { rows: pending } = await db.query(
      `SELECT id, code_hash, attempts FROM portal_login_codes
       WHERE identity_id = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [identity[0].id],
    );
    const record = pending[0];
    if (!record) return null;

    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      // Burn it rather than allowing unlimited guesses at six digits.
      await db.query('UPDATE portal_login_codes SET consumed_at = now() WHERE id = $1', [record.id]);
      return null;
    }

    if (!constantTimeEqual(record.code_hash, sha256(code.trim()))) {
      await db.query('UPDATE portal_login_codes SET attempts = attempts + 1 WHERE id = $1', [
        record.id,
      ]);
      return null;
    }

    await db.query('UPDATE portal_login_codes SET consumed_at = now() WHERE id = $1', [record.id]);

    const token = newSessionToken();
    const { rows: session } = await db.query(
      `INSERT INTO portal_sessions (identity_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)
       RETURNING expires_at`,
      [identity[0].id, sha256(token), String(SESSION_TTL_DAYS), userAgent ?? null],
    );
    await db.query('UPDATE portal_identities SET last_login_at = now() WHERE id = $1', [
      identity[0].id,
    ]);
    return { token, expiresAt: session[0].expires_at };
  });
}

export async function resolveSession(
  schemaName: string,
  token: string | undefined,
): Promise<PortalSession | null> {
  if (!token) return null;
  return withTenant(schemaName, async (db) => {
    const { rows } = await db.query(
      `SELECT i.id AS identity_id, i.client_id, i.email
       FROM portal_sessions s
       JOIN portal_identities i ON i.id = s.identity_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (!rows[0]) return null;
    return {
      identityId: rows[0].identity_id,
      clientId: rows[0].client_id,
      email: rows[0].email,
    };
  });
}

export async function revokeSession(schemaName: string, token: string | undefined): Promise<void> {
  if (!token) return;
  await withTenant(schemaName, async (db) => {
    await db.query(
      'UPDATE portal_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(token)],
    );
  });
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionCookie(req: FastifyRequest): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

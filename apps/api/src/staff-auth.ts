import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from './db.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const STAFF_COOKIE = 'petcare_staff';
const SESSION_TTL_HOURS = 12;
const KEYLEN = 64;

export type StaffRole = 'owner' | 'manager' | 'kennel_tech' | 'front_desk';

export interface StaffSession {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  role: StaffRole;
}

/** Roles allowed to change how the facility is configured. */
export const MANAGES_SETTINGS: StaffRole[] = ['owner', 'manager'];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** `scrypt$<salt>$<hash>` — self-describing so the format can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = await scrypt(password, salt, KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

export async function signIn(
  schemaName: string,
  email: string,
  password: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date; staff: StaffSession } | null> {
  return withTenant(schemaName, async (db) => {
    const { rows } = await db.query(
      `SELECT id, email, password_hash, first_name, last_name, role, active
       FROM staff WHERE lower(email) = $1`,
      [email.trim().toLowerCase()],
    );
    const person = rows[0];

    // Hash even when the account is missing, so a wrong email and a wrong
    // password take the same time to reject.
    const ok = person
      ? await verifyPassword(password, person.password_hash)
      : await verifyPassword(password, `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`);
    if (!person || !ok || !person.active) return null;

    const token = randomBytes(32).toString('hex');
    const { rows: session } = await db.query(
      `INSERT INTO staff_sessions (staff_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4)
       RETURNING expires_at`,
      [person.id, sha256(token), String(SESSION_TTL_HOURS), userAgent ?? null],
    );
    await db.query('UPDATE staff SET last_login_at = now() WHERE id = $1', [person.id]);

    return {
      token,
      expiresAt: session[0].expires_at,
      staff: toSession(person),
    };
  });
}

export async function resolveStaff(
  schemaName: string,
  token: string | undefined,
): Promise<StaffSession | null> {
  if (!token) return null;
  return withTenant(schemaName, async (db) => {
    const { rows } = await db.query(
      `SELECT s.id, s.email, s.first_name, s.last_name, s.role
       FROM staff_sessions ss
       JOIN staff s ON s.id = ss.staff_id
       WHERE ss.token_hash = $1 AND ss.revoked_at IS NULL
         AND ss.expires_at > now() AND s.active`,
      [sha256(token)],
    );
    return rows[0] ? toSession(rows[0]) : null;
  });
}

export async function revokeStaffSession(
  schemaName: string,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await withTenant(schemaName, async (db) => {
    await db.query(
      'UPDATE staff_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(token)],
    );
  });
}

function toSession(row: {
  id: string; email: string; first_name: string; last_name: string; role: string;
}): StaffSession {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`,
    role: row.role as StaffRole,
  };
}

export function setStaffCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearStaffCookie(reply: FastifyReply): void {
  reply.clearCookie(STAFF_COOKIE, { path: '/' });
}

export function readStaffCookie(req: FastifyRequest): string | undefined {
  return req.cookies?.[STAFF_COOKIE];
}

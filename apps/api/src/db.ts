import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://petcare:petcare@localhost:5432/petcare';

/**
 * Managed Postgres (Lightsail, RDS) only accepts TLS connections. Point
 * DATABASE_CA_FILE at the AWS CA bundle so the certificate is actually
 * verified: an unverified TLS connection stops eavesdropping but not an
 * impostor, which is the half of the problem worth having.
 *
 * DATABASE_SSL=insecure is the escape hatch for a managed database whose CA
 * you do not have to hand yet. It is not a place to leave things.
 */
function sslOptions(): pg.ConnectionConfig['ssl'] {
  const caFile = process.env.DATABASE_CA_FILE;
  if (caFile) return { ca: readFileSync(caFile, 'utf8') };
  if (process.env.DATABASE_SSL === 'insecure') return { rejectUnauthorized: false };
  return undefined;
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslOptions(),
  // A 1 GB managed instance allows ~90 connections; stay well inside that so
  // psql and the migration runner can still get in when the app is busy.
  max: Number(process.env.PGPOOL_MAX ?? 10),
});

/** Quote an identifier for use in dynamic DDL (schema names). */
export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

export function schemaNameForSlug(slug: string): string {
  return `t_${slug.replace(/-/g, '_')}`;
}

/**
 * Run `fn` on a client whose search_path is pinned to the tenant's schema.
 * All tenant-table SQL in the app goes through this, so queries never need
 * schema qualifiers and can never silently cross tenants.
 */
export async function withTenant<T>(
  schemaName: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdent(schemaName)}`);
    return await fn(client);
  } finally {
    // Reset so a pooled connection never leaks one tenant's search_path into
    // another tenant's request.
    try {
      await client.query('SET search_path TO public');
    } finally {
      client.release();
    }
  }
}

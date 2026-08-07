import pg from 'pg';

const { Pool } = pg;

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://petcare:petcare@localhost:5432/petcare';

export const pool = new Pool({ connectionString: DATABASE_URL });

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

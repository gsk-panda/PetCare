import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool, quoteIdent } from './db.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function migrationFiles(kind: 'platform' | 'tenant'): Promise<string[]> {
  const files = await readdir(join(MIGRATIONS_DIR, kind));
  return files.filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Apply every not-yet-applied migration file inside `schemaName`, tracking
 * applied files in `<schema>._migrations`. Each file runs in its own
 * transaction with search_path pinned to the schema.
 */
async function applyMigrations(
  client: pg.PoolClient,
  schemaName: string,
  kind: 'platform' | 'tenant',
): Promise<string[]> {
  const schema = quoteIdent(schemaName);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${schema}._migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await client.query<{ filename: string }>(
    `SELECT filename FROM ${schema}._migrations`,
  );
  const done = new Set(rows.map((r) => r.filename));
  const applied: string[] = [];

  for (const file of await migrationFiles(kind)) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, kind, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query(sql);
      await client.query(`INSERT INTO ${schema}._migrations (filename) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${kind}/${file} failed in ${schemaName}: ${(err as Error).message}`);
    }
  }
  return applied;
}

export async function migratePlatform(): Promise<string[]> {
  const client = await pool.connect();
  try {
    return await applyMigrations(client, 'platform', 'platform');
  } finally {
    client.release();
  }
}

export async function migrateTenantSchema(schemaName: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    return await applyMigrations(client, schemaName, 'tenant');
  } finally {
    client.release();
  }
}

/**
 * Arbitrary but fixed: every process that migrates must agree on it, and
 * nothing else in the database may use it.
 */
const MIGRATION_LOCK_KEY = 4_021_968;

/**
 * Bring the platform schema and every registered tenant schema up to date.
 *
 * Serialised on a session-level advisory lock, because migrations now run at
 * container start: two instances rolling out together would otherwise race
 * the same CREATE TABLE, and the loser would crash-loop. The second one
 * blocks, then finds everything already applied.
 */
export async function migrateAll(log: (msg: string) => void = () => {}): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    const platformApplied = await migratePlatform();
    log(`platform: ${platformApplied.length ? platformApplied.join(', ') : 'up to date'}`);

    const { rows: tenants } = await pool.query<{ slug: string; schema_name: string }>(
      'SELECT slug, schema_name FROM platform.tenants ORDER BY created_at',
    );
    for (const t of tenants) {
      const applied = await migrateTenantSchema(t.schema_name);
      log(`tenant ${t.slug}: ${applied.length ? applied.join(', ') : 'up to date'}`);
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    lock.release();
  }
}

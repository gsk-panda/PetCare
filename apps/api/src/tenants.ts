import type { Tenant, TenantTheme } from '@petcare/shared';
import { pool, schemaNameForSlug } from './db.js';
import { migrateTenantSchema } from './migrations.js';

export interface TenantRecord extends Tenant {
  schemaName: string;
}

const DEFAULT_THEME: TenantTheme = {
  appName: 'Denly',
  logoInitials: 'D',
  primary: '#275E54',
  primaryDeep: '#1C4741',
  accent: '#E8965A',
  accentText: '#3D2A16',
};

function rowToTenant(row: {
  id: string;
  slug: string;
  name: string;
  schema_name: string;
  plan: string;
  theme: Partial<TenantTheme>;
}): TenantRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    schemaName: row.schema_name,
    plan: row.plan === 'pro' ? 'pro' : 'free',
    theme: { ...DEFAULT_THEME, ...row.theme },
  };
}

export async function getTenantBySlug(slug: string): Promise<TenantRecord | null> {
  const { rows } = await pool.query(
    'SELECT id, slug, name, schema_name, plan, theme FROM platform.tenants WHERE slug = $1',
    [slug],
  );
  return rows[0] ? rowToTenant(rows[0]) : null;
}

/** Create schema, register the tenant, and run tenant migrations. Idempotent per slug. */
export async function provisionTenant(
  slug: string,
  name: string,
  opts: { plan?: 'free' | 'pro'; theme?: Partial<TenantTheme> } = {},
): Promise<TenantRecord> {
  const existing = await getTenantBySlug(slug);
  if (existing) {
    await migrateTenantSchema(existing.schemaName);
    return existing;
  }
  const schemaName = schemaNameForSlug(slug);
  const { rows } = await pool.query(
    `INSERT INTO platform.tenants (slug, name, schema_name, plan, theme)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, slug, name, schema_name, plan, theme`,
    [slug, name, schemaName, opts.plan ?? 'free', JSON.stringify(opts.theme ?? {})],
  );
  await migrateTenantSchema(schemaName);
  return rowToTenant(rows[0]);
}

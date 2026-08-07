import { migratePlatform } from '../src/migrations.js';
import { provisionTenant } from '../src/tenants.js';
import { pool } from '../src/db.js';

const [slug, name] = process.argv.slice(2);
if (!slug || !name) {
  console.error('Usage: npm run provision -- <slug> "<Business name>"');
  process.exit(1);
}

try {
  await migratePlatform();
  const tenant = await provisionTenant(slug, name);
  console.log(`Tenant ready: ${tenant.slug} → schema ${tenant.schemaName}`);
} finally {
  await pool.end();
}

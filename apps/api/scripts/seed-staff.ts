import { getTenantBySlug } from '../src/tenants.js';
import { hashPassword } from '../src/staff-auth.js';
import { pool, withTenant } from '../src/db.js';

/**
 * Seed the demo facility's staff. Development only: the password is shared and
 * printed. Real accounts get created through an invite flow, not a script.
 */
const DEV_PASSWORD = process.env.STAFF_DEV_PASSWORD ?? 'cedarcreek';

const PEOPLE = [
  ['Rosa', 'Kim', 'rosa@cedarcreek.example', 'owner'],
  ['Dev', 'Mehta', 'dev@cedarcreek.example', 'manager'],
  ['Jordan', 'Price', 'jordan@cedarcreek.example', 'front_desk'],
  ['Priya', 'Sandoval', 'priya@cedarcreek.example', 'kennel_tech'],
] as const;

const slug = process.argv[2] ?? 'cedar-creek';
const tenant = await getTenantBySlug(slug);
if (!tenant) {
  console.error(`No tenant '${slug}'. Run npm run seed:demo first.`);
  process.exit(1);
}

const hash = await hashPassword(DEV_PASSWORD);

await withTenant(tenant.schemaName, async (db) => {
  for (const [first, last, email, role] of PEOPLE) {
    await db.query(
      `INSERT INTO staff (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lower(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             role = EXCLUDED.role,
             active = true`,
      [email, hash, first, last, role],
    );
  }

  // Historical care events were logged before anyone could sign in. Point them
  // at the front-desk account so the audit trail is not half-anonymous.
  const { rows: desk } = await db.query(
    `SELECT id, first_name || ' ' || last_name AS name FROM staff
     WHERE lower(email) = 'jordan@cedarcreek.example'`,
  );
  const { rowCount } = await db.query(
    `UPDATE care_events SET staff_id = $1, staff_name = $2
     WHERE staff_id IS NULL AND staff_name = 'Front desk'`,
    [desk[0].id, desk[0].name],
  );

  console.log(`Staff seeded for ${slug}:`);
  for (const [first, last, email, role] of PEOPLE) {
    console.log(`  ${first} ${last} · ${role.padEnd(11)} · ${email}`);
  }
  console.log(`\n  Password for all of them (dev only): ${DEV_PASSWORD}`);
  console.log(`  Reattributed ${rowCount} historical care events to ${desk[0].name}.`);
});

await pool.end();

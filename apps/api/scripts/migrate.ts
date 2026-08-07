import { migrateAll } from '../src/migrations.js';
import { pool } from '../src/db.js';

try {
  await migrateAll((msg) => console.log(msg));
  console.log('Migrations complete.');
} finally {
  await pool.end();
}

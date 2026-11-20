import fs from 'fs';
import path from 'path';
import { dbPool } from './index.js';

export async function runMigration() {
  console.log('🔄 Running database migrations...');
  const schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Database schema migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js')) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

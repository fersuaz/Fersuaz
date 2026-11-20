// Aplica las migraciones SQL en orden, una sola vez cada una.
// Uso: DATABASE_URL=... npm run migrar
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { PostgresStore } from '../store.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const { pool } = await PostgresStore.connect(process.env.DATABASE_URL);
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())');
const hechas = new Set((await pool.query('SELECT nombre FROM schema_migrations')).rows.map((r) => r.nombre));
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
  if (hechas.has(f)) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(await readFile(join(dir, f), 'utf8'));
    await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('Aplicada', f);
  } catch (e) { await client.query('ROLLBACK'); console.error('Falló', f, e.message); process.exit(1); }
  finally { client.release(); }
}
await pool.end();

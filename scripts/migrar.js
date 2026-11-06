// Uso: node --env-file=.env scripts/migrar.js db/migracion_02_turnos.sql
import pg from 'pg';
import fs from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('Uso: node --env-file=.env scripts/migrar.js db/archivo.sql'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL });
await pool.query(fs.readFileSync(file, 'utf8'));
console.log('Migración aplicada:', file);
await pool.end();

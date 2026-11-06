// Preparación automática al arrancar (útil en la nube, donde no hay terminal):
//  1) base vacía  → crea las tablas (db/schema.sql) y, si quieres, el menú de ejemplo (db/seed.sql)
//  2) base vieja  → aplica las migraciones pendientes (db/migracion_*.sql), una sola vez cada una
//  3) sin usuarios → crea el administrador inicial con ADMIN_USUARIO y ADMIN_CLAVE
// Usa DATABASE_URL_ADMIN si existe (usuario con permiso para crear tablas); si no, DATABASE_URL.
import { urlDirecta } from './conexion.js';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db');
const leer = (f) => fs.readFileSync(path.join(DB, f), 'utf8');
const okPass = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);
const TABLA_MIG = 'CREATE TABLE IF NOT EXISTS migraciones (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())';

export async function arrancar() {
  if (process.env.SALTAR_ARRANQUE === 'true') return;
  const c = new pg.Client({
    connectionString: urlDirecta(process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_VERIFY !== 'false' } : undefined,
    connectionTimeoutMillis: 10000,
  });
  await c.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727272)');   // si arrancan dos copias a la vez, una espera a la otra
    const existe = async (t) => (await c.query('SELECT to_regclass($1) AS t', [t])).rows[0].t !== null;
    const migs = fs.readdirSync(DB).filter((f) => /^migracion_.*\.sql$/.test(f)).sort();
    const aplicadas = new Set((await existe('public.migraciones')) ? (await c.query('SELECT nombre FROM migraciones')).rows.map((r) => r.nombre) : []);

    if (!(await existe('public.usuarios'))) {                       // 1) instalación nueva
      console.log('[arranque] Base de datos vacía: creando las tablas...');
      const esquema = leer('schema.sql');
      await c.query(esquema);
      if (process.env.CARGAR_CATALOGO_EJEMPLO !== 'false') { await c.query(leer('seed.sql')); console.log('[arranque] Menú de ejemplo cargado (edítalo desde el panel de administrador).'); }
      await c.query(TABLA_MIG);
      for (const m of migs) if (esquema.includes(leer(m))) {      // las migraciones que ya trae schema.sql no se repiten
        await c.query('INSERT INTO migraciones (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [m]); aplicadas.add(m);
      }
    }
    const pendientes = migs.filter((m) => !aplicadas.has(m));        // 2) actualización (las migraciones son idempotentes)
    if (pendientes.length) {
      await c.query(TABLA_MIG);
      for (const m of pendientes) {
        console.log('[arranque] Aplicando migración', m);
        await c.query(leer(m));
        await c.query('INSERT INTO migraciones (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [m]);
      }
    }
    const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM usuarios');
    if (n === 0) {                                                   // 3) primer administrador
      const u = (process.env.ADMIN_USUARIO || '').trim().toLowerCase(), p = process.env.ADMIN_CLAVE || '';
      if (!u && !p) console.warn('[arranque] AVISO: no hay usuarios. Define ADMIN_USUARIO y ADMIN_CLAVE para crear el administrador.');
      else {
        if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw new Error('ADMIN_USUARIO no es válido (3 a 40 caracteres: letras, números, . _ -).');
        if (!okPass(p)) throw new Error('ADMIN_CLAVE debe tener mínimo 10 caracteres, con letras y números.');
        await c.query("INSERT INTO usuarios (usuario, password_hash, rol) VALUES ($1,$2,'admin')", [u, await bcrypt.hash(p, 12)]);
        console.log(`[arranque] Administrador "${u}" creado. Entra al sistema y luego BORRA la variable ADMIN_CLAVE del servidor.`);
      }
    }
  } catch (e) {
    if (e.code === '42501') throw new Error('La base necesita cambios (tablas o migraciones) y su usuario no tiene permiso. Define DATABASE_URL_ADMIN con el usuario administrador de la base.');
    throw e;
  } finally {
    await c.query('SELECT pg_advisory_unlock(727272)').catch(() => {});
    await c.end();
  }
}

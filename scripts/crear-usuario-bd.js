// Crea el usuario de base de datos "fercho_app" con PERMISOS MÍNIMOS (no es superusuario, no puede borrar
// tablas, ni borrar/editar la auditoría) y muestra la DATABASE_URL que debe usar el servidor.
// Uso: node --env-file=.env scripts/crear-usuario-bd.js
// Conecta con DATABASE_URL_ADMIN (o DATABASE_URL) de un usuario administrador. Si lo repites, cambia la contraseña.
import pg from 'pg';
import crypto from 'node:crypto';
const admin = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: admin });
await c.connect();
const { rows: [{ db }] } = await c.query('SELECT current_database() AS db');
const clave = crypto.randomBytes(24).toString('base64url');
await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fercho_app')
  THEN CREATE ROLE fercho_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$`);
await c.query(`ALTER ROLE fercho_app PASSWORD ${c.escapeLiteral(clave)}`);
await c.query(`GRANT CONNECT ON DATABASE "${db}" TO fercho_app`);
await c.query('GRANT USAGE ON SCHEMA public TO fercho_app');
await c.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fercho_app');
await c.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fercho_app');
// lo que la aplicación nunca debe poder borrar ni reescribir
await c.query('REVOKE DELETE ON usuarios, pedidos, pedido_items, platos, insumos, turnos_caja, gastos FROM fercho_app');
await c.query('REVOKE UPDATE, DELETE ON movimientos_caja, movimientos_inventario, auditoria_caja, accesos FROM fercho_app');
await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fercho_app');
await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fercho_app');
await c.end();
const u = new URL(admin);
console.log('\nListo. Pon esta línea en el .env del SERVIDOR (reemplaza la DATABASE_URL anterior):\n');
console.log(`DATABASE_URL=postgres://fercho_app:${clave}@${u.host}/${db}${u.search}\n`);
console.log('Guarda la URL de administrador como DATABASE_URL_ADMIN solo para migraciones y copias; no la uses en el servidor.');

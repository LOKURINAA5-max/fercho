// Uso: node --env-file=.env scripts/crear-usuario.js admin "ContraseñaSegura1" admin
import pg from 'pg';
import bcrypt from 'bcryptjs';
const [nombre, password, rol] = process.argv.slice(2);
const usuario = (nombre || '').toLowerCase();
if (!usuario || !password || password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !['admin', 'caja', 'cocina'].includes(rol)) {
  console.error('Uso: node --env-file=.env scripts/crear-usuario.js <usuario> <contraseña: mín. 10, con letras y números> <admin|caja|cocina>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(
  `INSERT INTO usuarios (usuario, password_hash, rol) VALUES ($1,$2,$3)
   ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash, rol = EXCLUDED.rol, activo = TRUE`,
  [usuario, await bcrypt.hash(password, 12), rol]);
console.log('Usuario listo:', usuario, `(${rol})`);
await pool.end();

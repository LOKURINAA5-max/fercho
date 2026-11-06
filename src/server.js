import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { urlDirecta } from './conexion.js';
import path from 'node:path';
import fs from 'node:fs';
import { b32enc, totpCheck, sha, llaveDe, cifrar, descifrar } from './totp.js';
import { arrancar } from './arranque.js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = process.env.UPLOADS_DIR || path.join(root, 'uploads');   // en la nube: apuntar a un disco persistente
try { fs.mkdirSync(UPLOADS, { recursive: true }); } catch { /* sin disco: las fotos nuevas van a la base de datos */ }
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env');
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'fercho_sesion';
const REQ2FA = (process.env.EXIGIR_2FA || '').split(',').map((x) => x.trim()).filter(Boolean);   // roles que deben usar 2FA
const CONFIRMAR = process.env.CONFIRMAR_PEDIDOS !== 'false';                                     // pedidos de clientes esperan a caja
const LLAVE_2FA = llaveDe(SECRET);

const pool = new pg.Pool({
  connectionString: urlDirecta(process.env.DATABASE_URL),
  options: '-c timezone=America/Bogota',
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_VERIFY !== 'false' } : undefined,
  idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, statement_timeout: 15000,   // una consulta lenta no deja colgado el sistema
});
pool.on('error', (e) => console.error('Error en la conexión a la base:', e.message));
const q = (sql, params) => pool.query(sql, params);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

/* ---------- Tiempo real: avisa a las pantallas que algo cambió (SSE) ---------- */
const clientes = new Set();
const notify = () => clientes.forEach((r) => r.write('data: cambio\n\n'));
setInterval(() => clientes.forEach((r) => r.write(':\n\n')), 25000).unref();

/* ---------- Autenticación y permisos por rol ---------- */
function cookieOf(req, name) {
  const c = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(name + '='));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : null;
}
function userFrom(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  const raw = bearer || cookieOf(req, COOKIE);
  if (!raw) return null;
  try { const p = jwt.verify(raw, SECRET); if (p.fase) return null; p.via = bearer ? 'header' : 'cookie'; return p; }
  catch { return null; }
}
// Valida la sesión Y que el usuario siga activo; el rol se lee de la BD (una baja o cambio de rol aplican al instante).
// Con cookie, las peticiones que modifican datos exigen la cabecera X-Requested-With (defensa contra CSRF).
const auth = (...roles) => async (req, res, next) => {
  const t = userFrom(req);
  if (!t) return res.status(401).json({ error: 'No autenticado' });
  if (t.via === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'fercho')
    return res.status(403).json({ error: 'Solicitud no permitida' });
  const { rows: [u] } = await q('SELECT id, usuario, rol FROM usuarios WHERE id = $1 AND activo', [t.id]);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  if (t.p2 && !req.path.startsWith('/api/2fa') && req.path !== '/api/logout' && req.path !== '/api/yo')
    return res.status(403).json({ error: 'Configura la verificación en dos pasos para continuar', codigo: '2FA_REQUERIDA' });
  if (roles.length && !roles.includes(u.rol)) return res.status(403).json({ error: 'Sin permiso' });
  req.user = u; req.p2 = !!t.p2; next();
};
const DUMMY = bcrypt.hashSync('no-existe', 12);
const okPass = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 100 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASS_MSG = 'La contraseña debe tener mínimo 10 caracteres, con letras y números';

/* ---------- Subida de fotos ---------- */
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.memoryStorage(),     // la foto se guarda en la base de datos (tabla "fotos"), no en el disco
  limits: { fileSize: 300 * 1024 },
  fileFilter: (req, f, cb) => cb(EXT[f.mimetype] ? null : bad('La foto debe ser PNG, JPG o WEBP'), !!EXT[f.mimetype]),
});
const FIRMAS = { 'image/png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' };
async function guardarFoto(req) {   // devuelve la dirección de la foto subida (o null si no subieron ninguna)
  if (!req.file) return null;
  if (!FIRMAS[req.file.mimetype](req.file.buffer)) throw bad('El archivo no es una imagen válida');
  const { rows: [f] } = await q('INSERT INTO fotos (tipo, datos) VALUES ($1,$2) RETURNING id', [req.file.mimetype, req.file.buffer]);
  return '/foto/' + f.id;
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
if (process.env.NODE_ENV === 'production')   // detrás de un proxy: si el cliente llegó por http, lo manda a https
  app.use((req, res, next) => (req.headers['x-forwarded-proto'] === 'http'
    ? res.redirect(308, 'https://' + req.headers.host + req.originalUrl) : next()));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
}));
if (process.env.LOG_ACCESO !== 'false') app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => { if (!['/api/salud', '/api/eventos'].includes(req.path))
    console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t0, ip: req.ip })); });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '1d' }));   // fotos antiguas guardadas en disco (versiones anteriores)
app.get('/foto/:id', async (req, res) => {   // fotos guardadas en la base de datos; cada foto nueva tiene su propio id, por eso se pueden guardar mucho tiempo
  if (!/^\d{1,9}$/.test(req.params.id)) return res.sendStatus(404);
  const { rows: [f] } = await q('SELECT tipo, datos FROM fotos WHERE id = $1', [req.params.id]);
  if (!f) return res.sendStatus(404);
  res.set({ 'Content-Type': f.tipo, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(f.datos);
});   // las fotos casi no cambian: menos carga y más rápido en el celular
app.use(express.static(path.join(root, 'public')));

/* ---------- Públicas ---------- */
const limLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
const disp = (req) => String(req.headers['user-agent'] || '').slice(0, 200);
const logAcceso = (req, usuario, u, exito, motivo) => q(
  'INSERT INTO accesos (usuario_id, usuario_intentado, exito, motivo, ip, dispositivo) VALUES ($1,$2,$3,$4,$5,$6)',
  [u ? u.id : null, String(usuario || '').slice(0, 40), exito, motivo || null, req.ip, disp(req)]);
const evento = (ev, uid, detalle, ip) => q('INSERT INTO auditoria_caja (evento, detalle, usuario_id, ip) VALUES ($1,$2,$3,$4)', [ev, JSON.stringify(detalle), uid, ip]);

async function fallo(req, usuario, u, motivo) {
  if (u) {
    const { rows: [r] } = await q(`UPDATE usuarios SET
        intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= 5 THEN 0 ELSE intentos_fallidos + 1 END,
        bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= 5 THEN now() + interval '15 minutes' ELSE bloqueado_hasta END
      WHERE id = $1 RETURNING (bloqueado_hasta > now()) AS bloqueado`, [u.id]);
    if (r.bloqueado) { await evento('cuenta_bloqueada', u.id, { ip: req.ip }, req.ip); notify(); }
  }
  await logAcceso(req, usuario, u, false, motivo);
}
function darSesion(req, res, u) {
  const p2 = REQ2FA.includes(u.rol) && !u.totp_activo;
  const token = jwt.sign({ id: u.id, usuario: u.usuario, rol: u.rol, ...(p2 ? { p2: true } : {}) }, SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600 * 1000, path: '/' });
  const out = { usuario: u.usuario, rol: u.rol, totp: !!u.totp_activo, debe_configurar_2fa: p2 };
  if (req.headers['x-cliente'] === 'api') out.token = token;   // solo para scripts; el navegador usa la cookie
  return out;
}
async function exito(req, res, u) {
  await q('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
  const visto = (await q('SELECT 1 FROM accesos WHERE usuario_id = $1 AND exito AND ip = $2 AND dispositivo = $3 LIMIT 1', [u.id, req.ip, disp(req)])).rowCount;
  const previos = (await q('SELECT 1 FROM accesos WHERE usuario_id = $1 AND exito LIMIT 1', [u.id])).rowCount;
  await logAcceso(req, u.usuario, u, true);
  if (u.rol === 'admin' && previos && !visto) { await evento('acceso_nuevo', u.id, { ip: req.ip }, req.ip); notify(); }   // aviso: red o dispositivo nuevos
  res.json(darSesion(req, res, u));
}
// Acepta el código de 6 dígitos de la app o un código de recuperación (de un solo uso). Un código no sirve dos veces.
async function verificar2fa(u, codigo) {
  const c = String(codigo || '').replace(/\s|-/g, '').toLowerCase();
  if (/^\d{6}$/.test(c)) {
    const step = totpCheck(descifrar(u.totp_secreto, LLAVE_2FA), c);
    if (step === null) return false;
    return (await q('UPDATE usuarios SET totp_ultimo_paso = $2 WHERE id = $1 AND totp_ultimo_paso < $2', [u.id, step])).rowCount === 1;
  }
  if (/^[0-9a-f]{10}$/.test(c))
    return (await q('UPDATE usuarios SET totp_recuperacion = array_remove(totp_recuperacion, $2) WHERE id = $1 AND $2 = ANY(totp_recuperacion)', [u.id, sha(c)])).rowCount === 1;
  return false;
}
const BLOQUEO = 'Cuenta bloqueada por intentos fallidos. Intenta de nuevo en 15 minutos';

app.post('/api/login', limLogin, async (req, res) => {
  const { usuario, password } = req.body || {};
  const { rows: [u] } = await q('SELECT * FROM usuarios WHERE usuario = $1 AND activo', [String(usuario || '').toLowerCase()]);
  if (u?.bloqueado_hasta && u.bloqueado_hasta > new Date()) return res.status(429).json({ error: BLOQUEO });
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : DUMMY);   // mismo tiempo exista o no el usuario
  if (!u || !ok) { await fallo(req, usuario, u, 'clave'); return res.status(401).json({ error: 'Credenciales incorrectas' }); }
  if (u.totp_activo) return res.json({ requiere_2fa: true, temp: jwt.sign({ id: u.id, fase: '2fa' }, SECRET, { expiresIn: '5m' }) });
  await exito(req, res, u);
});

app.post('/api/login/2fa', limLogin, async (req, res) => {
  let t;
  try { t = jwt.verify(String(req.body?.temp || ''), SECRET); } catch { return res.status(401).json({ error: 'La verificación venció. Ingresa de nuevo' }); }
  if (t.fase !== '2fa') return res.status(401).json({ error: 'La verificación venció. Ingresa de nuevo' });
  const { rows: [u] } = await q('SELECT * FROM usuarios WHERE id = $1 AND activo AND totp_activo', [t.id]);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  if (u.bloqueado_hasta && u.bloqueado_hasta > new Date()) return res.status(429).json({ error: BLOQUEO });
  if (!(await verificar2fa(u, req.body?.codigo))) { await fallo(req, u.usuario, u, '2fa'); return res.status(401).json({ error: 'Código incorrecto' }); }
  await exito(req, res, u);
});

app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

app.get('/api/yo', auth(), async (req, res) => {
  const { rows: [u] } = await q('SELECT totp_activo FROM usuarios WHERE id = $1', [req.user.id]);
  res.json({ usuario: req.user.usuario, rol: req.user.rol, totp: u.totp_activo, p2: req.p2 });
});

// Activar 2FA: 1) preparar (genera la clave para el QR)  2) activar (confirma con un código y entrega códigos de recuperación)
app.post('/api/2fa/preparar', auth(), async (req, res) => {
  const { rows: [u] } = await q('SELECT totp_activo FROM usuarios WHERE id = $1', [req.user.id]);
  if (u.totp_activo) throw new HttpError(409, 'Ya tienes la verificación activa. Si perdiste el celular, pide al administrador que la restablezca');
  const secreto = b32enc(crypto.randomBytes(20));
  await q('UPDATE usuarios SET totp_secreto = $2 WHERE id = $1', [req.user.id, cifrar(secreto, LLAVE_2FA)]);
  res.json({ secreto, uri: `otpauth://totp/${encodeURIComponent('Fercho:' + req.user.usuario)}?secret=${secreto}&issuer=Fercho&digits=6&period=30` });
});
app.post('/api/2fa/activar', auth(), async (req, res) => {
  const { rows: [u] } = await q('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
  if (!u.totp_secreto || u.totp_activo) throw bad('Primero genera el código QR');
  const step = totpCheck(descifrar(u.totp_secreto, LLAVE_2FA), String(req.body?.codigo || '').replace(/\s/g, ''));
  if (step === null) throw bad('El código no coincide. Revisa que la hora del celular sea automática e inténtalo de nuevo');
  const codigos = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  await q('UPDATE usuarios SET totp_activo = TRUE, totp_ultimo_paso = $2, totp_recuperacion = $3 WHERE id = $1', [u.id, step, codigos.map(sha)]);
  res.json({ ...darSesion(req, res, { ...u, totp_activo: true }), recuperacion: codigos });
});
app.post('/api/usuarios/:id/reset-2fa', auth('admin'), async (req, res) => {
  const { rowCount } = await q("UPDATE usuarios SET totp_secreto = NULL, totp_activo = FALSE, totp_recuperacion = '{}', totp_ultimo_paso = 0 WHERE id = $1", [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Usuario no encontrado');
  await evento('reset_2fa', Number(req.params.id), { por: req.user.usuario }, req.ip);
  res.json({ ok: true });
});
app.get('/api/accesos', auth('admin'), async (req, res) =>
  res.json((await q('SELECT id, usuario_intentado, exito, motivo, ip, dispositivo, creado_en FROM accesos ORDER BY id DESC LIMIT 40')).rows));

app.get('/api/salud', async (req, res) => {   // para monitoreo (UptimeRobot, Render, Docker)
  try { await q('SELECT 1'); res.json({ estado: 'ok' }); } catch { res.status(503).json({ estado: 'error' }); }
});

app.get('/api/config', async (req, res) => {
  const { rowCount } = await q('SELECT 1 FROM turnos_caja WHERE cerrado_en IS NULL');
  res.json({ nequi_numero: process.env.NEQUI_NUMERO || null, nequi_nombre: process.env.NEQUI_NOMBRE || null,
    abierto: rowCount > 0, meta_min: Number(process.env.COCINA_META_MIN || 10), alerta_min: Number(process.env.COCINA_ALERTA_MIN || 15) });
});

app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clientes.add(res);
  req.on('close', () => clientes.delete(res));
});

app.get('/api/menu', async (req, res) => {
  const { rows } = await q(`
    SELECT p.id, p.nombre, p.descripcion, p.precio, p.foto, p.emoji, p.agotado, p.categoria, p.orden,
           coalesce(array_agg(i.nombre ORDER BY i.nombre) FILTER (WHERE i.id IS NOT NULL), '{}') AS ingredientes
    FROM platos p
    LEFT JOIN recetas r ON r.plato_id = p.id
    LEFT JOIN insumos i ON i.id = r.insumo_id
    WHERE p.activo GROUP BY p.id ORDER BY p.orden, p.id`);
  res.json(rows);
});

// Crear pedido (cliente por QR, o personal desde caja). El total se calcula SIEMPRE en el servidor.
app.post('/api/pedidos', rateLimit({ windowMs: 10 * 60 * 1000, limit: Number(process.env.LIMITE_PEDIDOS_10MIN || 120) }), async (req, res) => {
  const { tipo, mesa, cliente, telefono, direccion, items, metodo_pago = 'efectivo', referencia_pago } = req.body || {};
  if (!['mesa', 'domicilio', 'mostrador'].includes(tipo)) throw bad('Tipo de pedido inválido');
  if (tipo === 'mostrador') {
    const t = userFrom(req);
    const { rowCount } = t ? await q("SELECT 1 FROM usuarios WHERE id = $1 AND activo AND rol IN ('caja','admin')", [t.id]) : { rowCount: 0 };
    if (!rowCount) throw new HttpError(403, 'Solo el personal puede crear pedidos de mostrador');
  }
  if (!['efectivo', 'nequi'].includes(metodo_pago)) throw bad('Método de pago inválido');
  if (metodo_pago === 'nequi') {
    if (!process.env.NEQUI_NUMERO) throw bad('El pago por Nequi no está habilitado');
    if (!/^[A-Za-z0-9-]{4,30}$/.test(String(referencia_pago || ''))) throw bad('Escribe la referencia de tu pago Nequi (4 a 30 letras o números)');
  }
  if (tipo === 'mesa' && !String(mesa || '').trim()) throw bad('Indica el número de mesa');
  if (tipo === 'domicilio' && !(cliente && telefono && direccion)) throw bad('Completa nombre, teléfono y dirección');
  if (!Array.isArray(items) || !items.length || items.length > 50) throw bad('El pedido no tiene productos');
  const lines = items.map((i) => {
    const plato_id = Number(i?.plato_id), cantidad = Number(i?.cantidad);
    if (!Number.isInteger(plato_id) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw bad('Producto inválido');
    const sin = Array.isArray(i.sin) ? i.sin.slice(0, 20).map((s) => String(s).slice(0, 80)) : [];
    return { plato_id, cantidad, sin, nota: String(i.nota || '').slice(0, 200) };
  });

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const ids = [...new Set(lines.map((l) => l.plato_id))];
    const { rows: platos } = await c.query(
      'SELECT id, nombre, precio FROM platos WHERE id = ANY($1) AND activo AND NOT agotado', [ids]);
    if (platos.length !== ids.length) throw bad('Algún producto no está disponible');
    const byId = new Map(platos.map((p) => [p.id, p]));
    const total = lines.reduce((a, l) => a + byId.get(l.plato_id).precio * l.cantidad, 0);
    // El número (#1, #2...) reinicia en cada turno de caja. FOR UPDATE ordena las creaciones y el cierre de caja.
    const { rows: [t] } = await c.query('SELECT id FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE');
    if (!t) throw new HttpError(409, 'El local está cerrado por ahora. Inténtalo cuando abran la caja');
    const { rows: [{ n }] } = await c.query('SELECT coalesce(max(numero_dia), 0) + 1 AS n FROM pedidos WHERE turno_creacion = $1', [t.id]);
    const conf = !(CONFIRMAR && tipo !== 'mostrador');
    const { rows: [p] } = await c.query(
      `INSERT INTO pedidos (tipo, mesa, cliente, telefono, direccion, total, metodo_pago, referencia_pago, confirmado,
                            turno_creacion, numero_dia, confirmado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $9 THEN now() END) RETURNING id, numero_dia AS numero`,
      [tipo, tipo === 'mesa' ? String(mesa).slice(0, 10) : null,
       cliente ? String(cliente).slice(0, 80) : null, telefono ? String(telefono).slice(0, 20) : null,
       direccion ? String(direccion).slice(0, 300) : null, total,
       metodo_pago, metodo_pago === 'nequi' ? String(referencia_pago) : null, conf, t.id, n]);
    for (const l of lines) {
      const pl = byId.get(l.plato_id);
      await c.query(
        `INSERT INTO pedido_items (pedido_id, plato_id, nombre, precio_unit, cantidad, sin, nota)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [p.id, pl.id, pl.nombre, pl.precio, l.cantidad, l.sin, l.nota || null]);
    }
    await c.query('COMMIT');
    notify();
    res.status(201).json({ id: p.id, numero: p.numero, total });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

// Seguimiento público por el cliente (el id es un UUID imposible de adivinar)
app.get('/api/pedidos/:id/estado', async (req, res) => {
  const { rows: [p] } = await q('SELECT coalesce(numero_dia, numero) AS numero, tipo, estado, confirmado, creado_en, preparacion_en, listo_en FROM pedidos WHERE id = $1', [req.params.id]);
  if (!p) throw new HttpError(404, 'Pedido no encontrado');
  res.json(p);
});

/* ---------- Cocina / Caja ---------- */
const FLOW = (p) => (p.tipo === 'domicilio'
  ? ['espera', 'preparacion', 'listo', 'entregando', 'entregado']
  : ['espera', 'preparacion', 'listo', 'entregado']);

app.get('/api/pedidos', auth('cocina', 'caja', 'admin'), async (req, res) => {
  const where = req.user.rol === 'cocina'
    ? "p.estado IN ('espera','preparacion') AND p.confirmado AND p.creado_en > now() - interval '48 hours'"
    : "p.estado <> 'cancelado' AND NOT (p.estado = 'entregado' AND p.pagado) AND (p.creado_en > now() - interval '48 hours' OR (p.estado = 'entregado' AND NOT p.pagado))";
  const { rows } = await q(`
    SELECT p.*, coalesce(p.numero_dia, p.numero) AS numero,
           coalesce(json_agg(json_build_object('id', i.id, 'nombre', i.nombre, 'cantidad', i.cantidad,
             'precio_unit', i.precio_unit, 'sin', i.sin, 'nota', i.nota, 'listo', i.listo) ORDER BY i.id)
             FILTER (WHERE i.id IS NOT NULL), '[]') AS items
    FROM pedidos p LEFT JOIN pedido_items i ON i.pedido_id = p.id
    WHERE ${where} GROUP BY p.id ORDER BY coalesce(p.confirmado_en, p.creado_en) LIMIT 300`);
  res.json(rows);
});

async function descontarInventario(c, pedidoId, usuarioId) {
  const { rows } = await c.query(`
    SELECT r.insumo_id, sum(r.cantidad * it.cantidad) AS qty
    FROM pedido_items it
    JOIN recetas r ON r.plato_id = it.plato_id
    JOIN insumos s ON s.id = r.insumo_id
    WHERE it.pedido_id = $1 AND NOT (s.nombre = ANY(it.sin))
    GROUP BY r.insumo_id`, [pedidoId]);
  for (const r of rows) {
    await c.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, motivo, pedido_id, usuario_id)
       VALUES ($1, 'salida', $2, 'Pedido en preparación', $3, $4)`, [r.insumo_id, r.qty, pedidoId, usuarioId]);
    await c.query('UPDATE insumos SET cantidad = GREATEST(cantidad - $2, 0) WHERE id = $1', [r.insumo_id, r.qty]);
  }
}

app.patch('/api/pedidos/:id/avanzar', auth('cocina', 'caja', 'admin'), async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [p] } = await c.query('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!p) throw new HttpError(404, 'Pedido no encontrado');
    if (p.estado === 'cancelado') throw new HttpError(409, 'El pedido está cancelado');
    if (!p.confirmado) throw new HttpError(409, 'Primero confirma el pedido');
    const flow = FLOW(p), next = flow[flow.indexOf(p.estado) + 1];
    if (!next) throw new HttpError(409, 'El pedido ya está en su estado final');
    if (req.user.rol === 'cocina' && !['preparacion', 'listo'].includes(next)) throw new HttpError(403, 'Sin permiso');
    if (next === 'preparacion' && !p.inventario_descontado) await descontarInventario(c, p.id, req.user.id);
    await c.query(`UPDATE pedidos SET estado = $2::varchar, inventario_descontado = inventario_descontado OR $3,
        preparacion_en = CASE WHEN $2::text = 'preparacion' THEN now() ELSE preparacion_en END,
        listo_en       = CASE WHEN $2::text = 'listo' THEN now() ELSE listo_en END WHERE id = $1`,
      [p.id, next, next === 'preparacion']);
    if (next === 'listo') await c.query('UPDATE pedido_items SET listo = TRUE WHERE pedido_id = $1', [p.id]);
    await c.query('COMMIT');
    notify();
    res.json({ estado: next });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

// La cocina marca (o desmarca) cada plato como terminado
app.patch('/api/pedidos/:id/items/:item/listo', auth('cocina', 'caja', 'admin'), async (req, res) => {
  const { rowCount } = await q(`UPDATE pedido_items i SET listo = $3 FROM pedidos p
    WHERE i.id = $2 AND i.pedido_id = $1 AND p.id = i.pedido_id AND p.estado IN ('espera','preparacion')`,
    [req.params.id, req.params.item, req.body?.listo !== false]);
  if (!rowCount) throw new HttpError(404, 'Plato no encontrado');
  notify();
  res.json({ ok: true });
});

// Cobrar exige un turno de caja abierto. FOR SHARE impide que el turno se cierre mientras se registra el cobro.
app.patch('/api/pedidos/:id/pagar', auth('caja', 'admin'), async (req, res) => {
  const out = await tx(async (c) => {
    const { rows: [t] } = await c.query('SELECT id FROM turnos_caja WHERE cerrado_en IS NULL FOR SHARE');
    if (!t) throw new HttpError(409, 'Abre la caja antes de cobrar');
    const { rows: [p] } = await c.query('SELECT total, metodo_pago, pagado, estado FROM pedidos WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!p || p.pagado || p.estado === 'cancelado') throw new HttpError(409, 'Pedido inexistente, cancelado o ya pagado');
    const total = Number(p.total);
    let recibido = null, vueltos = null;
    if (p.metodo_pago === 'efectivo') {
      recibido = req.body?.efectivo_recibido === undefined ? total : Number(req.body.efectivo_recibido);   // sin dato = pago exacto
      if (!Number.isInteger(recibido) || recibido < 0 || recibido > 10000000) throw bad('Valor recibido inválido');
      if (recibido < total) throw bad('El dinero recibido no alcanza para pagar el pedido');
      vueltos = recibido - total;
    }
    await c.query(`UPDATE pedidos SET pagado = TRUE, pagado_en = now(), turno_id = $2, efectivo_recibido = $3, vueltos = $4 WHERE id = $1`,
      [req.params.id, t.id, recibido, vueltos]);
    return { pagado: true, total, recibido, vueltos };
  });
  notify();
  res.json(out);
});

/* ---------- Administrador: inventario ---------- */
app.get('/api/insumos', auth('admin'), async (req, res) => {
  res.json((await q('SELECT * FROM insumos WHERE activo ORDER BY nombre')).rows);
});

app.post('/api/insumos', auth('admin'), upload.single('foto'), async (req, res) => {
  const { codigo, nombre, unidad } = req.body, cantidad = Number(req.body.cantidad || 0), costo = Number(req.body.costo_unitario || 0);
  if (!codigo || !nombre || !(cantidad >= 0) || !(costo >= 0)) throw bad('Código, nombre y cantidad válidos son obligatorios');
  const foto = await guardarFoto(req);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [i] } = await c.query(
      'INSERT INTO insumos (codigo, nombre, cantidad, unidad, foto, costo_unitario) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [codigo, nombre, cantidad, unidad || 'u', foto, costo]);
    if (cantidad > 0) await c.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, motivo, usuario_id)
       VALUES ($1,'entrada',$2,'Stock inicial',$3)`, [i.id, cantidad, req.user.id]);
    await c.query('COMMIT');
    res.status(201).json(i);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

app.put('/api/insumos/:id', auth('admin'), upload.single('foto'), async (req, res) => {
  const { nombre, unidad } = req.body, costo = req.body.costo_unitario === undefined || req.body.costo_unitario === '' ? null : Number(req.body.costo_unitario);
  if (costo !== null && !(costo >= 0)) throw bad('Costo inválido');
  const foto = await guardarFoto(req);
  const { rows: [i] } = await q(
    `UPDATE insumos SET nombre = coalesce($2, nombre), unidad = coalesce($3, unidad), foto = coalesce($4, foto),
        costo_unitario = coalesce($5, costo_unitario)
     WHERE id = $1 AND activo RETURNING *`, [req.params.id, nombre || null, unidad || null, foto, costo]);
  if (!i) throw new HttpError(404, 'Producto no encontrado');
  res.json(i);
});

app.delete('/api/insumos/:id', auth('admin'), async (req, res) => {   // borrado lógico: conserva el historial
  await q('UPDATE insumos SET activo = FALSE WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// entrada (compra), salida (merma/uso manual) o ajuste (conteo físico: "cantidad" es el nuevo total)
app.post('/api/insumos/:id/movimiento', auth('admin'), async (req, res) => {
  const { tipo, motivo } = req.body, n = Number(req.body.cantidad);
  if (!['entrada', 'salida', 'ajuste'].includes(tipo) || !(n >= 0)) throw bad('Movimiento inválido');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [i] } = await c.query('SELECT cantidad FROM insumos WHERE id = $1 AND activo FOR UPDATE', [req.params.id]);
    if (!i) throw new HttpError(404, 'Producto no encontrado');
    const delta = tipo === 'entrada' ? n : tipo === 'salida' ? -n : n - Number(i.cantidad);
    if (Number(i.cantidad) + delta < 0) throw bad('No hay suficiente stock');
    await c.query('UPDATE insumos SET cantidad = cantidad + $2 WHERE id = $1', [req.params.id, delta]);
    await c.query(
      `INSERT INTO movimientos_inventario (insumo_id, tipo, cantidad, motivo, usuario_id) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, tipo, Math.abs(delta), String(motivo || '').slice(0, 200) || null, req.user.id]);
    await c.query('COMMIT');
    res.json({ cantidad: Number(i.cantidad) + delta });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

app.get('/api/movimientos', auth('admin'), async (req, res) => {   // historial (RF-10)
  const { rows } = await q(`
    SELECT m.*, s.nombre AS insumo, u.usuario
    FROM movimientos_inventario m JOIN insumos s ON s.id = m.insumo_id LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE ($1::int IS NULL OR m.insumo_id = $1) ORDER BY m.creado_en DESC LIMIT 200`, [req.query.insumo_id || null]);
  res.json(rows);
});

/* ---------- Administrador: menú ---------- */
app.post('/api/platos', auth('admin'), upload.single('foto'), async (req, res) => {
  const { nombre, descripcion, emoji } = req.body, precio = Number(req.body.precio), categoria = String(req.body.categoria || 'General').trim().slice(0, 40) || 'General';
  let receta = [];
  try { receta = JSON.parse(req.body.receta || '[]'); } catch { throw bad('Receta inválida'); }
  if (!nombre || !(precio >= 0)) throw bad('Nombre y precio válidos son obligatorios');
  const foto = await guardarFoto(req);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [p] } = await c.query(
      'INSERT INTO platos (nombre, descripcion, precio, foto, emoji, categoria) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nombre, descripcion || null, precio, foto, emoji || '🍽️', categoria]);
    for (const r of receta)
      await c.query('INSERT INTO recetas (plato_id, insumo_id, cantidad) VALUES ($1,$2,$3)',
        [p.id, Number(r.insumo_id), Number(r.cantidad)]);
    await c.query('COMMIT');
    notify();
    res.status(201).json(p);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

app.put('/api/platos/:id', auth('admin'), async (req, res) => {
  const { nombre, precio, agotado, categoria } = req.body;
  if (precio !== undefined && !(Number(precio) >= 0)) throw bad('Precio inválido');
  const { rows: [p] } = await q(
    `UPDATE platos SET nombre = coalesce($2, nombre), precio = coalesce($3, precio), agotado = coalesce($4, agotado),
        categoria = coalesce($5, categoria) WHERE id = $1 AND activo RETURNING *`,
    [req.params.id, nombre ?? null, precio ?? null, typeof agotado === 'boolean' ? agotado : null,
     categoria ? String(categoria).trim().slice(0, 40) : null]);
  if (!p) throw new HttpError(404, 'Plato no encontrado');
  notify();
  res.json(p);
});

/* ---------- Administrador: contabilidad y reportes ---------- */
const VENTAS = { dia: 'ventas_diarias', mes: 'ventas_mensuales', anio: 'ventas_anuales' };
app.get('/api/reportes/ventas', auth('admin'), async (req, res) => {
  const vista = VENTAS[req.query.periodo || 'dia'];
  if (!vista) throw bad('periodo debe ser dia, mes o anio');
  res.json((await q(`SELECT * FROM ${vista} ORDER BY periodo DESC LIMIT 12`)).rows);   // vista de una lista cerrada
});
app.get('/api/reportes/platos', auth('admin'), async (req, res) => res.json((await q('SELECT * FROM platos_mas_vendidos LIMIT 10')).rows));
app.get('/api/reportes/consumo', auth('admin'), async (req, res) => res.json((await q('SELECT * FROM consumo_insumos LIMIT 10')).rows));
app.get('/api/reportes/recomendaciones', auth('admin'), async (req, res) => res.json((await q('SELECT * FROM recomendacion_stock ORDER BY nombre')).rows));

/* ---------- Contabilidad: resumen por rango, series, gastos, márgenes y exportación ---------- */
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function rango(req) {
  const hoy = new Date().toLocaleDateString('sv', { timeZone: 'America/Bogota' });
  const desde = String(req.query.desde || hoy.slice(0, 8) + '01'), hasta = String(req.query.hasta || hoy);
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) throw bad('Rango de fechas inválido');
  if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > 800) throw bad('El rango máximo es de 2 años');
  return [desde, hasta];
}
const PAGADOS = 'pagado AND pagado_en::date BETWEEN $1 AND $2';

app.get('/api/contabilidad/resumen', auth('admin'), async (req, res) => {
  const R = rango(req);
  const [v, tipos, horas, dias, canc, gas, gcat, cost, top, tiempos] = await Promise.all([
    q(`SELECT count(*)::int AS pedidos, coalesce(sum(total),0)::bigint AS total,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'),0)::bigint AS efectivo,
         coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'),0)::bigint AS nequi FROM pedidos WHERE ${PAGADOS}`, R),
    q(`SELECT tipo, count(*)::int AS pedidos, sum(total)::bigint AS total FROM pedidos WHERE ${PAGADOS} GROUP BY tipo ORDER BY total DESC`, R),
    q(`SELECT extract(hour FROM creado_en)::int AS hora, count(*)::int AS pedidos, sum(total)::bigint AS total
       FROM pedidos WHERE ${PAGADOS} GROUP BY 1 ORDER BY 1`, R),
    q(`SELECT pagado_en::date::text AS dia, count(*)::int AS pedidos, sum(total)::bigint AS total FROM pedidos WHERE ${PAGADOS} GROUP BY 1 ORDER BY 1`, R),
    q(`SELECT count(*)::int AS pedidos, coalesce(sum(total),0)::bigint AS total FROM pedidos WHERE estado = 'cancelado' AND creado_en::date BETWEEN $1 AND $2`, R),
    q(`SELECT coalesce(sum(monto),0)::bigint AS total FROM gastos WHERE NOT anulado AND fecha BETWEEN $1 AND $2`, R),
    q(`SELECT categoria, sum(monto)::bigint AS total FROM gastos WHERE NOT anulado AND fecha BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`, R),
    q(`SELECT coalesce(sum(m.cantidad * i.costo_unitario) FILTER (WHERE m.pedido_id IS NOT NULL),0)::bigint AS costo_ventas,
              coalesce(sum(m.cantidad * i.costo_unitario) FILTER (WHERE m.pedido_id IS NULL),0)::bigint AS mermas
       FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id WHERE m.tipo = 'salida' AND m.creado_en::date BETWEEN $1 AND $2`, R),
    q(`SELECT it.nombre, sum(it.cantidad)::int AS unidades, sum(it.cantidad * it.precio_unit)::bigint AS ingresos
       FROM pedido_items it JOIN pedidos p ON p.id = it.pedido_id WHERE ${PAGADOS.replaceAll('pagado', 'p.pagado')} GROUP BY it.nombre ORDER BY unidades DESC LIMIT 10`, R),
    q(`SELECT count(*)::int AS pedidos,
         round(avg(extract(epoch FROM listo_en - coalesce(confirmado_en, creado_en))))::int AS total_seg,
         round(avg(extract(epoch FROM preparacion_en - coalesce(confirmado_en, creado_en))))::int AS espera_seg,
         round(avg(extract(epoch FROM listo_en - preparacion_en)))::int AS cocina_seg
       FROM pedidos WHERE listo_en IS NOT NULL AND preparacion_en IS NOT NULL AND creado_en::date BETWEEN $1 AND $2`, R),
  ]);
  const ventas = v.rows[0], c = cost.rows[0], gastos = Number(gas.rows[0].total);
  const bruta = Number(ventas.total) - Number(c.costo_ventas);
  res.json({
    desde: R[0], hasta: R[1], ventas, ticket_promedio: ventas.pedidos ? Math.round(Number(ventas.total) / ventas.pedidos) : 0,
    por_tipo: tipos.rows, por_hora: horas.rows, por_dia: dias.rows, cancelados: canc.rows[0],
    gastos: { total: gastos, por_categoria: gcat.rows }, costo_ventas: Number(c.costo_ventas), mermas: Number(c.mermas),
    utilidad_bruta: bruta, utilidad_neta: bruta - Number(c.mermas) - gastos, top_platos: top.rows, tiempos: tiempos.rows[0],
  });
});

const FORMATOS = { dia: ['YYYY-MM-DD', 31], mes: ['YYYY-MM', 24], anio: ['YYYY', 10] };
app.get('/api/contabilidad/serie', auth('admin'), async (req, res) => {
  const f = FORMATOS[req.query.periodo || 'dia'];
  if (!f) throw bad('periodo debe ser dia, mes o anio');
  const { rows } = await q(`
    WITH v AS (SELECT to_char(pagado_en, $1) AS p, count(*)::int AS pedidos, sum(total)::bigint AS total,
                 coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'),0)::bigint AS efectivo,
                 coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'),0)::bigint AS nequi
               FROM pedidos WHERE pagado GROUP BY 1),
         g AS (SELECT to_char(fecha, $1) AS p, sum(monto)::bigint AS gastos FROM gastos WHERE NOT anulado GROUP BY 1)
    SELECT coalesce(v.p, g.p) AS periodo, coalesce(v.pedidos,0) AS pedidos, coalesce(v.total,0) AS total,
           coalesce(v.efectivo,0) AS efectivo, coalesce(v.nequi,0) AS nequi, coalesce(g.gastos,0) AS gastos,
           coalesce(v.total,0) - coalesce(g.gastos,0) AS resultado
    FROM v FULL JOIN g ON v.p = g.p ORDER BY 1 DESC LIMIT $2`, [f[0], f[1]]);
  res.json(rows);
});

app.get('/api/contabilidad/margenes', auth('admin'), async (req, res) => {
  const { rows } = await q(`
    SELECT p.id, p.nombre, p.categoria, p.precio::bigint AS precio,
           coalesce(sum(r.cantidad * i.costo_unitario),0)::bigint AS costo,
           (p.precio - coalesce(sum(r.cantidad * i.costo_unitario),0))::bigint AS margen,
           count(r.insumo_id)::int AS ingredientes
    FROM platos p LEFT JOIN recetas r ON r.plato_id = p.id LEFT JOIN insumos i ON i.id = r.insumo_id
    WHERE p.activo GROUP BY p.id ORDER BY p.categoria, p.nombre`);
  res.json(rows);
});

app.get('/api/gastos', auth('admin'), async (req, res) => {
  const R = rango(req);
  res.json((await q(`SELECT g.id, g.fecha::text AS fecha, g.categoria, g.descripcion, g.monto::bigint AS monto, g.anulado, u.usuario
    FROM gastos g LEFT JOIN usuarios u ON u.id = g.usuario_id WHERE g.fecha BETWEEN $1 AND $2 ORDER BY g.fecha DESC, g.id DESC LIMIT 500`, R)).rows);
});
app.post('/api/gastos', auth('admin'), async (req, res) => {
  const categoria = String(req.body?.categoria || '').trim().slice(0, 40), descripcion = String(req.body?.descripcion || '').trim().slice(0, 200);
  const valor = Number(req.body?.monto), hoy = new Date().toLocaleDateString('sv', { timeZone: 'America/Bogota' });
  const fecha = req.body?.fecha ? String(req.body.fecha) : hoy;
  if (!categoria || descripcion.length < 3) throw bad('Escribe la categoría y una descripción');
  if (!Number.isInteger(valor) || valor < 1 || valor > 1000000000) throw bad('Monto inválido');
  if (!FECHA.test(fecha) || fecha > hoy) throw bad('La fecha no puede ser futura');
  const { rows: [g] } = await q('INSERT INTO gastos (fecha, categoria, descripcion, monto, usuario_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [fecha, categoria, descripcion, valor, req.user.id]);
  res.status(201).json({ id: g.id });
});
app.patch('/api/gastos/:id/anular', auth('admin'), async (req, res) => {
  const { rows: [g] } = await q('UPDATE gastos SET anulado = TRUE WHERE id = $1 AND NOT anulado RETURNING monto, descripcion', [req.params.id]);
  if (!g) throw new HttpError(404, 'Gasto no encontrado o ya anulado');
  await evento('gasto_anulado', req.user.id, { monto: Number(g.monto), descripcion: g.descripcion }, req.ip);
  res.json({ ok: true });
});

// CSV para el contador (abre directo en Excel). Se neutralizan celdas que parezcan fórmulas.
const csvCelda = (v) => {
  if (v === null || v === undefined) return '';
  let t = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
app.get('/api/contabilidad/exportar.csv', auth('admin'), async (req, res) => {
  const R = rango(req);
  const [v, g] = await Promise.all([
    q(`SELECT pagado_en, turno_id, coalesce(numero_dia, numero) AS numero, tipo, metodo_pago, total, efectivo_recibido, vueltos, referencia_pago
       FROM pedidos WHERE ${PAGADOS} ORDER BY pagado_en`, R),
    q(`SELECT fecha::text, categoria, descripcion, monto, anulado FROM gastos WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha, id`, R),
  ]);
  const fila = (a) => a.map(csvCelda).join(';');
  const out = [
    'VENTAS COBRADAS', fila(['Fecha y hora', 'Turno', 'Pedido', 'Tipo', 'Pago', 'Total COP', 'Efectivo recibido', 'Vueltos', 'Referencia Nequi']),
    ...v.rows.map((r) => fila([r.pagado_en, r.turno_id, r.numero, r.tipo, r.metodo_pago, r.total, r.efectivo_recibido, r.vueltos, r.referencia_pago])),
    '', 'GASTOS', fila(['Fecha', 'Categoría', 'Descripción', 'Monto COP', 'Anulado']),
    ...g.rows.map((r) => fila([r.fecha, r.categoria, r.descripcion, r.monto, r.anulado ? 'SI' : 'NO'])),
  ].join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="fercho_${R[0]}_a_${R[1]}.csv"` });
  res.send('﻿' + out);
});

/* ---------- Caja: confirmar pedidos de clientes, cancelar y cierre del día ---------- */
app.patch('/api/pedidos/:id/confirmar', auth('caja', 'admin'), async (req, res) => {
  const { rowCount } = await q("UPDATE pedidos SET confirmado = TRUE, confirmado_en = now() WHERE id = $1 AND NOT confirmado AND estado <> 'cancelado'", [req.params.id]);
  if (!rowCount) throw new HttpError(409, 'El pedido ya está confirmado o fue cancelado');
  notify();
  res.json({ confirmado: true });
});

app.patch('/api/pedidos/:id/cancelar', auth('caja', 'admin'), async (req, res) => {
  const motivo = String(req.body?.motivo || '').slice(0, 200) || null;
  const { rowCount } = await q(`UPDATE pedidos SET estado = 'cancelado', cancelado_motivo = $2
    WHERE id = $1 AND NOT pagado AND estado NOT IN ('entregado','cancelado')`, [req.params.id, motivo]);
  if (!rowCount) throw new HttpError(409, 'No se puede cancelar este pedido');
  notify();
  res.json({ estado: 'cancelado' });
});

app.get('/api/caja/hoy', auth('admin'), async (req, res) => {
  const SUMA = `SELECT count(*)::int AS pedidos, coalesce(sum(total),0) AS total,
      coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'),0) AS efectivo,
      coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'),0) AS nequi FROM pedidos WHERE pagado AND `;
  const { rows: [turno] } = await q(SUMA + 'turno_id = (SELECT id FROM turnos_caja WHERE cerrado_en IS NULL)');
  const { rows: [sin_turno] } = await q(SUMA + 'turno_id IS NULL AND pagado_en::date = current_date');
  res.json({ turno, sin_turno });   // lo cobrado en el turno abierto, y lo cobrado hoy sin ningún turno
});

/* ---------- Administrador: usuarios y contraseñas ---------- */
app.get('/api/usuarios', auth('admin'), async (req, res) =>
  res.json((await q('SELECT id, usuario, rol, activo, totp_activo, creado_en FROM usuarios ORDER BY usuario')).rows));

app.post('/api/usuarios', auth('admin'), async (req, res) => {
  const usuario = String(req.body?.usuario || '').toLowerCase(), { rol, password } = req.body || {};
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw bad('Usuario: de 3 a 40 caracteres (letras, números, . _ -)');
  if (!['admin', 'caja', 'cocina'].includes(rol)) throw bad('Rol inválido');
  if (!okPass(password)) throw bad(PASS_MSG);
  const { rows: [u] } = await q('INSERT INTO usuarios (usuario, password_hash, rol) VALUES ($1,$2,$3) RETURNING id, usuario, rol',
    [usuario, await bcrypt.hash(password, 12), rol]);
  res.status(201).json(u);
});

app.patch('/api/usuarios/:id', auth('admin'), async (req, res) => {
  const { rol, activo, password } = req.body || {};
  if (Number(req.params.id) === req.user.id && (activo === false || (rol && rol !== 'admin')))
    throw bad('No puedes desactivarte ni quitarte el rol de administrador');
  if (rol !== undefined && !['admin', 'caja', 'cocina'].includes(rol)) throw bad('Rol inválido');
  if (password !== undefined && !okPass(password)) throw bad(PASS_MSG);
  const { rowCount } = await q(`UPDATE usuarios SET rol = coalesce($2, rol), activo = coalesce($3, activo),
      password_hash = coalesce($4, password_hash), intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`,
    [req.params.id, rol ?? null, typeof activo === 'boolean' ? activo : null, password ? await bcrypt.hash(password, 12) : null]);
  if (!rowCount) throw new HttpError(404, 'Usuario no encontrado');
  res.json({ ok: true });
});

app.post('/api/cambiar-password', auth(), async (req, res) => {
  const { actual, nueva } = req.body || {};
  const { rows: [u] } = await q('SELECT password_hash FROM usuarios WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(String(actual || ''), u.password_hash))) throw new HttpError(401, 'La contraseña actual no es correcta');
  if (!okPass(nueva)) throw bad(PASS_MSG);
  await q('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(nueva, 12)]);
  res.json({ ok: true });
});

app.get('/api/platos/:id/receta', auth('admin'), async (req, res) =>
  res.json((await q('SELECT insumo_id, cantidad FROM recetas WHERE plato_id = $1', [req.params.id])).rows));
app.delete('/api/platos/:id', auth('admin'), async (req, res) => {   // borrado lógico: conserva los pedidos antiguos
  await q('UPDATE platos SET activo = FALSE WHERE id = $1', [req.params.id]);
  notify();
  res.status(204).end();
});
app.put('/api/platos/:id/receta', auth('admin'), async (req, res) => {
  const receta = req.body?.receta;
  if (!Array.isArray(receta)) throw bad('Receta inválida');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM recetas WHERE plato_id = $1', [req.params.id]);
    for (const r of receta)
      await c.query('INSERT INTO recetas (plato_id, insumo_id, cantidad) VALUES ($1,$2,$3)', [req.params.id, Number(r.insumo_id), Number(r.cantidad)]);
    await c.query('COMMIT');
    notify();
    res.json({ ok: true });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
});

/* ---------- Turnos de caja: apertura, movimientos, cierre y alertas ---------- */
const UMBRAL_DIF = Number(process.env.CAJA_UMBRAL_DIFERENCIA || 5000);
const UMBRAL_RETIRO = Number(process.env.CAJA_UMBRAL_RETIRO || 100000);
const MAX_HORAS = Math.round(Number(process.env.CAJA_MAX_HORAS_TURNO || 14));
const EVENTOS = `SELECT x.id, x.turno_id, x.evento, x.detalle, x.creado_en, u.usuario
                 FROM auditoria_caja x LEFT JOIN usuarios u ON u.id = x.usuario_id`;

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const audit = (c, turno, evento, detalle, req) => c.query(
  'INSERT INTO auditoria_caja (turno_id, evento, detalle, usuario_id, ip) VALUES ($1,$2,$3,$4,$5)',
  [turno, evento, JSON.stringify(detalle || {}), req.user.id, req.ip]);
const monto = (v, max = 10000000) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : null; };

async function cifras(c, t) {
  const { rows: [v] } = await c.query(`SELECT
      coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS ventas_efectivo,
      coalesce(sum(total) FILTER (WHERE metodo_pago = 'nequi'), 0) AS ventas_nequi, count(*)::int AS n_pedidos
    FROM pedidos WHERE turno_id = $1 AND pagado`, [t.id]);
  const { rows: [m] } = await c.query(`SELECT
      coalesce(sum(monto) FILTER (WHERE tipo = 'retiro'), 0) AS retiros,
      coalesce(sum(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos
    FROM movimientos_caja WHERE turno_id = $1`, [t.id]);
  const esperado = Number(t.monto_apertura) + Number(v.ventas_efectivo) + Number(m.ingresos) - Number(m.retiros);
  return { ...v, ...m, esperado };
}
const turnoAbierto = () => q(
  'SELECT t.*, u.usuario AS abierto_por_nombre FROM turnos_caja t JOIN usuarios u ON u.id = t.abierto_por WHERE t.cerrado_en IS NULL');

// El cajero NO ve el efectivo esperado (cierre "a ciegas"); el administrador sí.
app.get('/api/turno', auth('caja', 'admin'), async (req, res) => {
  const { rows: [t] } = await turnoAbierto();
  if (!t) return res.json(null);
  const out = { id: t.id, abierto_por: t.abierto_por_nombre, monto_apertura: t.monto_apertura, abierto_en: t.abierto_en };
  if (req.user.rol === 'admin') Object.assign(out, await cifras(pool, t));
  res.json(out);
});

app.post('/api/turno/abrir', auth('caja', 'admin'), async (req, res) => {
  const base = monto(req.body?.monto);
  if (base === null) throw bad('Monto de apertura inválido');
  try {
    const id = await tx(async (c) => {
      const { rows: [t] } = await c.query(
        'INSERT INTO turnos_caja (abierto_por, monto_apertura, abierto_ip, abierto_dispositivo) VALUES ($1,$2,$3,$4) RETURNING id',
        [req.user.id, base, req.ip, String(req.headers['user-agent'] || '').slice(0, 200)]);
      await audit(c, t.id, 'apertura', { monto: base }, req);
      return t.id;
    });
    notify();
    res.status(201).json({ id });
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'Ya hay una caja abierta'); throw e; }
});

app.post('/api/turno/movimiento', auth('caja', 'admin'), async (req, res) => {
  const { tipo } = req.body || {}, valor = monto(req.body?.monto), motivo = String(req.body?.motivo || '').trim().slice(0, 200);
  if (!['retiro', 'ingreso'].includes(tipo) || !valor) throw bad('Movimiento inválido');
  if (motivo.length < 3) throw bad('Escribe el motivo del movimiento');
  await tx(async (c) => {
    const { rows: [t] } = await c.query('SELECT id FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE');
    if (!t) throw new HttpError(409, 'No hay caja abierta');
    let gastoId = null;
    const cat = String(req.body?.categoria_gasto || '').trim().slice(0, 40);
    if (tipo === 'retiro' && cat) {   // el retiro es un gasto del negocio: entra también a la contabilidad
      const { rows: [g] } = await c.query('INSERT INTO gastos (categoria, descripcion, monto, usuario_id, turno_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [cat, motivo, valor, req.user.id, t.id]);
      gastoId = g.id;
    }
    await c.query('INSERT INTO movimientos_caja (turno_id, tipo, monto, motivo, usuario_id, gasto_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [t.id, tipo, valor, motivo, req.user.id, gastoId]);
    await audit(c, t.id, tipo === 'retiro' && valor > UMBRAL_RETIRO ? 'retiro_alto' : tipo, { monto: valor, motivo }, req);
  });
  notify();
  res.status(201).json({ ok: true });
});

app.post('/api/turno/cerrar', auth('caja', 'admin'), async (req, res) => {
  const contado = monto(req.body?.efectivo_contado, 100000000);
  if (contado === null) throw bad('Escribe el efectivo contado');
  const notas = String(req.body?.notas || '').slice(0, 200) || null;
  const out = await tx(async (c) => {
    const { rows: [t] } = await c.query('SELECT * FROM turnos_caja WHERE cerrado_en IS NULL FOR UPDATE');
    if (!t) throw new HttpError(409, 'No hay caja abierta');
    const { rows: [pend] } = await c.query("SELECT count(*)::int AS n FROM pedidos WHERE estado = 'entregado' AND NOT pagado");
    if (pend.n) throw new HttpError(409, `Hay ${pend.n} pedido(s) entregado(s) sin cobrar. Cóbralos antes de cerrar la caja`);
    const { rows: [vivos] } = await c.query("SELECT count(*)::int AS n FROM pedidos WHERE estado NOT IN ('entregado','cancelado')");
    if (vivos.n) throw new HttpError(409, `Hay ${vivos.n} pedido(s) sin terminar. Entrégalos o cancélalos antes de cerrar la caja`);
    const f = await cifras(c, t), dif = contado - f.esperado, alerta = Math.abs(dif) > UMBRAL_DIF;
    const { rows: [canc] } = await c.query("SELECT count(*)::int AS n FROM pedidos WHERE estado = 'cancelado' AND turno_creacion = $1", [t.id]);
    await c.query(`UPDATE turnos_caja SET cerrado_por = $2, cerrado_en = now(), efectivo_contado = $3, ventas_efectivo = $4,
        ventas_nequi = $5, n_pedidos = $6, n_cancelados = $7, retiros = $8, ingresos = $9, efectivo_esperado = $10,
        diferencia = $11, notas_cierre = $12, alerta = $13 WHERE id = $1`,
      [t.id, req.user.id, contado, f.ventas_efectivo, f.ventas_nequi, f.n_pedidos, canc.n, f.retiros, f.ingresos, f.esperado, dif, notas, alerta]);
    await audit(c, t.id, 'cierre', { contado, esperado: f.esperado, diferencia: dif, alerta }, req);
    return { ...f, contado, diferencia: dif, alerta, monto_apertura: t.monto_apertura, n_cancelados: canc.n };
  });
  notify();
  res.json(out);
});

app.get('/api/turnos', auth('admin'), async (req, res) => {
  const { rows: turnos } = await q(`
    SELECT t.id, t.abierto_en, t.cerrado_en, t.monto_apertura, t.efectivo_esperado, t.efectivo_contado, t.diferencia,
           t.ventas_efectivo, t.ventas_nequi, t.n_pedidos, t.alerta, t.notas_cierre, a.usuario AS abierto_por, c.usuario AS cerrado_por
    FROM turnos_caja t JOIN usuarios a ON a.id = t.abierto_por LEFT JOIN usuarios c ON c.id = t.cerrado_por
    ORDER BY t.id DESC LIMIT 60`);
  const { rows: eventos } = await q(`${EVENTOS} ORDER BY x.id DESC LIMIT 30`);
  res.json({ turnos, eventos });
});
app.get('/api/turnos/:id/detalle', auth('admin'), async (req, res) =>
  res.json({ eventos: (await q(`${EVENTOS} WHERE x.turno_id = $1 ORDER BY x.id`, [req.params.id])).rows }));

// Alertas en tiempo real para el administrador. El canal SSE solo avisa "cambio"; los datos se piden aquí, con sesión.
app.get('/api/alertas', auth('admin'), async (req, res) => {
  const { rows: [m] } = await q('SELECT coalesce(max(id), 0) AS ultimo FROM auditoria_caja');
  const d = req.query.desde === undefined || req.query.desde === '' ? NaN : Number(req.query.desde);
  const items = Number.isFinite(d) ? (await q(`${EVENTOS} WHERE x.id > $1 ORDER BY x.id`, [d])).rows : [];
  res.json({ ultimo: Number(m.ultimo), items });
});

// Aviso si un turno lleva demasiadas horas abierto (se avisa una sola vez por turno)
setInterval(async () => {
  try {
    const { rows: [t] } = await q(`SELECT id FROM turnos_caja t WHERE cerrado_en IS NULL
      AND abierto_en < now() - make_interval(hours => $1)
      AND NOT EXISTS (SELECT 1 FROM auditoria_caja WHERE turno_id = t.id AND evento = 'turno_largo')`, [MAX_HORAS]);
    if (t) { await q("INSERT INTO auditoria_caja (turno_id, evento, detalle) VALUES ($1,'turno_largo',$2)", [t.id, JSON.stringify({ horas: MAX_HORAS })]); notify(); }
  } catch (e) { console.error(e); }
}, 5 * 60 * 1000).unref();

// Pedidos que nadie atendió en 24 h se cancelan solos para que no queden "fantasmas" en las pantallas
setInterval(async () => {
  try {
    const { rowCount } = await q(`UPDATE pedidos SET estado = 'cancelado', cancelado_motivo = 'Abandonado: sin atender por más de 24 horas'
      WHERE estado IN ('espera','preparacion','listo') AND NOT pagado AND creado_en < now() - interval '24 hours'`);
    if (rowCount) notify();
  } catch (e) { console.error(e.message); }
}, 60 * 60 * 1000).unref();

/* ---------- Errores ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'La foto debe pesar máximo 300 KB' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Identificador inválido' });
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese valor' });
  if (['23514', '23503'].includes(err.code)) return res.status(400).json({ error: 'Datos inválidos' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

await arrancar();   // prepara tablas, migraciones y el primer administrador si hace falta
const server = app.listen(process.env.PORT || 3000, () => console.log('Fercho API lista en el puerto', process.env.PORT || 3000));
// Detrás de un proxy (Render, Caddy, Cloudflare) las conexiones persistentes deben durar MÁS que las del proxy.
// Con el valor por defecto de Node (5 s) aparecen errores 502 intermitentes.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
process.on('unhandledRejection', (e) => console.error('Promesa sin manejar:', e));   // un fallo suelto no tumba el local
process.on('uncaughtException', (e) => { console.error('Excepción no capturada:', e); apagar('uncaughtException'); });
function apagar(senal) {   // cierre ordenado: termina lo que está en curso antes de salir (despliegues sin cortes)
  console.log(senal + ' recibido: cerrando...');
  clientes.forEach((r) => r.end());
  server.close(() => pool.end().then(() => process.exit(0)));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10000).unref();
}
['SIGTERM', 'SIGINT'].forEach((sg) => process.on(sg, () => apagar(sg)));

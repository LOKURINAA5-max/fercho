#!/usr/bin/env node
// Agente de impresión de comandas (opcional). Se ejecuta en un computador del local, en la misma red que las impresoras.
// Pregunta al servidor por las comandas pendientes de cada zona y las envía a su impresora térmica de red (ESC/POS, puerto 9100).
// No necesita instalar nada más que Node 18 o superior:   node impresion/agente.mjs
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUTA = process.argv[2] || path.join(DIR, 'config.json');
if (!fs.existsSync(RUTA)) { console.error(`Falta ${RUTA}. Copia config.ejemplo.json como config.json y complétalo.`); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
const BASE = String(CFG.servidor || '').replace(/\/+$/, '');
const CADA = Math.max(2, Number(CFG.cada_segundos) || 3) * 1000;
const ANCHO = Number(CFG.columnas) || 42;      // 42 columnas en papel de 80 mm; usa 32 para 58 mm
let token = null;

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');   // sin tildes: todas las impresoras lo entienden
async function api(m, u, b) {
  const r = await fetch(BASE + '/api' + u, { method: m, headers: { 'content-type': 'application/json', 'X-Cliente': 'api', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => null);
  if (r.status === 401 && token) { token = null; throw new Error('sesión vencida'); }
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}
async function entrar() {
  const r = await api('POST', '/login', { usuario: CFG.usuario, password: CFG.clave });
  if (r.requiere_2fa) throw new Error('Ese usuario tiene verificación en dos pasos. Usa un usuario de cocina sin 2FA para el agente.');
  token = r.token; console.log(new Date().toLocaleTimeString(), 'Conectado como', r.usuario);
}
const ESC = '\x1b', GS = '\x1d', INI = ESC + '@', CENTRO = ESC + 'a\x01', IZQ = ESC + 'a\x00', NEG = ESC + 'E\x01', NONEG = ESC + 'E\x00',
  GRANDE = GS + '!\x11', ALTO = GS + '!\x01', NORMAL = GS + '!\x00', CORTE = '\n\n\n\n' + GS + 'V\x42\x00', PITO = ESC + 'B\x02\x02';
const raya = '-'.repeat(ANCHO) + '\n';
function ticket(j) {
  const c = j.contenido, dest = c.tipo_pedido === 'mesa' ? 'MESA ' + plano(c.mesa) : c.tipo_pedido === 'domicilio' ? 'DOMICILIO' : 'MOSTRADOR';
  let t = INI + CENTRO + NEG + GRANDE + plano(c.zona).toUpperCase() + '\n' + NORMAL;
  if (j.tipo === 'anulado') t += GRANDE + '** ANULADO **\n' + NORMAL; else if (j.tipo === 'copia') t += '(COPIA)\n';
  t += IZQ + GRANDE + `#${c.numero} ${dest}\n` + NORMAL + NONEG;
  if (c.complemento_num) t += NEG + `COMPLEMENTO DEL #${c.complemento_num}\n` + NONEG;
  t += new Date(c.hora).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + (c.tipo_pedido === 'domicilio' && c.cliente ? ' - ' + plano(c.cliente) : '') + '\n' + raya;
  for (const l of c.lineas) {
    t += NEG + ALTO + `${l.cantidad} x ${plano(l.nombre)}\n` + NORMAL + NONEG;
    if (l.parte) t += `   (${plano(l.parte)})\n`;
    if (l.origen) t += `   de: ${plano(l.origen)}\n`;
    if (l.sin && l.sin.length) t += NEG + `   SIN ${plano(l.sin.join(', '))}\n` + NONEG;
    if (l.nota) t += NEG + `   NOTA: ${plano(l.nota)}\n` + NONEG;
  }
  t += raya;
  if (j.tipo === 'anulado' && c.motivo) t += `Motivo: ${plano(c.motivo)}\n`;
  t += c.otras && c.otras.length ? `Tambien preparan: ${plano(c.otras.join(', '))}\n` : 'Solo esta zona\n';
  return t + (CFG.pitar === false ? '' : PITO) + CORTE;
}
const enviar = (imp, datos) => new Promise((ok, mal) => {
  const s = net.createConnection({ host: imp.host, port: imp.port || 9100, timeout: 6000 });
  s.on('connect', () => s.end(Buffer.from(datos, 'latin1'), () => { ok(); setTimeout(() => s.destroy(), 1500); }));   // enviado completo
  s.on('timeout', () => { s.destroy(); mal(new Error('la impresora no responde')); });
  s.on('error', mal);
});
let zonas = null, avisado = new Set();
async function vuelta() {
  if (!token) await entrar();
  if (!zonas) zonas = await api('GET', '/zonas');
  for (const [nombre, imp] of Object.entries(CFG.impresoras || {})) {
    const z = nombre.toLowerCase() === 'todas' ? { id: 'todas' } : zonas.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (!z) { if (!avisado.has(nombre)) { avisado.add(nombre); console.error(`La zona «${nombre}» no existe en el sistema. Revisa config.json`); } continue; }
    const trabajos = await api('POST', '/impresion/tomar', { zona: z.id, estacion: ('agente ' + nombre).slice(0, 40) });
    for (const j of trabajos) {
      try { await enviar(imp, ticket(j)); await api('POST', `/impresion/${j.id}/hecha`); console.log(new Date().toLocaleTimeString(), `Impresa #${j.contenido.numero} en ${j.contenido.zona}`); }
      catch (e) { await api('POST', `/impresion/${j.id}/fallo`).catch(() => {}); console.error(new Date().toLocaleTimeString(), `No se pudo imprimir en ${nombre} (${imp.host}): ${e.message}`); break; }
    }
  }
}
console.log(`Agente de impresión Fercho · servidor ${BASE} · cada ${CADA / 1000} s`);
for (;;) {
  try { await vuelta(); } catch (e) { console.error(new Date().toLocaleTimeString(), 'Error:', e.message); zonas = null; }
  if (process.env.UNA_VEZ) break;
  await new Promise((r) => setTimeout(r, CADA));
}

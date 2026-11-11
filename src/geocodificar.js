// Buscar una dirección colombiana ("Calle 45 # 23-10") y devolver su punto en el mapa.
// Gratis: OpenStreetMap (Nominatim). Como OSM casi no tiene números de casa en Bucaramanga, se usa el sistema de
// nomenclatura colombiano: "Calle 45 # 23-10" queda en la Calle 45 junto al cruce con la Carrera 23, y se calcula ese cruce.
// Si se configura GOOGLE_GEOCODING_KEY se usa Google (más preciso en Colombia, con costo según su cupo).
const MUNICIPIOS = {
  Bucaramanga: { lat: 7.1193, lng: -73.1227 }, Floridablanca: { lat: 7.0647, lng: -73.0898 },
  'Girón': { lat: 7.0682, lng: -73.1698 }, Piedecuesta: { lat: 6.9877, lng: -73.0505 },
};
export const municipios = Object.keys(MUNICIPIOS);
const CAJA = { izq: -73.25, arr: 7.20, der: -72.98, aba: 6.93 };   // área metropolitana de Bucaramanga
const BASE = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const AGENTE = 'Fercho-Pedidos/9.3 (sistema de pedidos de un restaurante en Bucaramanga)' + (process.env.NOMINATIM_EMAIL ? ' ' + process.env.NOMINATIM_EMAIL : '');

const TIPOS = [
  [/^(calle|cll|clle|cl)\.?$/i, 'Calle'], [/^(carrera|cra|kra|kr|cr|crr)\.?$/i, 'Carrera'], [/^(avenida|av|avda)\.?$/i, 'Avenida'],
  [/^(transversal|tv|trans|tr|transv)\.?$/i, 'Transversal'], [/^(diagonal|dg|diag)\.?$/i, 'Diagonal'], [/^(circunvalar|circ|cir)\.?$/i, 'Circunvalar'],
];
// "cra 27 # 50-12 apto 301" → { tipo:'Carrera', num:'27', cruce:'50', placa:'12' }
export function analizar(txt) {
  const t = String(txt || '').replace(/\s+/g, ' ').replace(/n[°ºo]\.?|número|numero/gi, '#').trim();
  const m = t.match(/^([a-zá]+)\.?\s*(\d{1,3}\s?[a-z]?)\s*(?:bis\s*[a-z]?)?\s*(?:#|\s)\s*(\d{1,3}\s?[a-z]?)\s*(?:-\s*(\d{1,3}))?/i);
  if (!m) return null;
  const tipo = (TIPOS.find(([re]) => re.test(m[1])) || [])[1];
  if (!tipo) return null;
  return { tipo, num: m[2].replace(/\s/g, '').toUpperCase(), cruce: m[3].replace(/\s/g, '').toUpperCase(), placa: m[4] || null };
}
const otraVia = (tipo) => (tipo === 'Calle' ? ['Carrera'] : tipo === 'Carrera' ? ['Calle'] : ['Carrera', 'Calle']);

// Nominatim permite como máximo 1 consulta por segundo: se ponen en fila. Los resultados se guardan 7 días.
let fila = Promise.resolve();
const memoria = new Map();
function nominatim(params) {
  const clave = JSON.stringify(params);
  const m = memoria.get(clave);
  if (m && Date.now() - m.t < 7 * 864e5) return Promise.resolve(m.v);
  const p = fila.then(async () => {
    const u = new URL(BASE + '/search');
    Object.entries({ format: 'jsonv2', countrycodes: 'co', 'accept-language': 'es', limit: 10, bounded: 1,
      viewbox: `${CAJA.izq},${CAJA.arr},${CAJA.der},${CAJA.aba}`, ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('El buscador de direcciones respondió ' + r.status);
    const v = await r.json();
    if (memoria.size > 1000) memoria.delete(memoria.keys().next().value);
    memoria.set(clave, { t: Date.now(), v });
    return v;
  });
  fila = p.then(() => new Promise((ok) => setTimeout(ok, 1100)), () => new Promise((ok) => setTimeout(ok, 1100)));
  return p;
}
// Geometría: líneas de una calle (en [lng,lat]) → tramos en metros alrededor de un punto de referencia
function lineas(resultados) {
  const out = [];
  for (const r of resultados) {
    const g = r.geojson;
    if (!g) continue;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
  }
  return out;
}
function cruce(A, B) {
  const lat0 = 7.1, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const P = ([x, y]) => [x * kx, y * ky];
  const segs = (L) => L.flatMap((l) => l.slice(1).map((p, i) => [P(l[i]), P(p)]));
  const sa = segs(A), sb = segs(B);
  const cerca = (p, [a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return [a[0] + t * dx, a[1] + t * dy]; };
  let mejor = null;
  for (const s of sa) for (const u of sb) {
    for (const [p, seg] of [[s[0], u], [s[1], u], [u[0], s], [u[1], s]]) {
      const q = cerca(p, seg), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!mejor || d < mejor.d) mejor = { d, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 };
    }
  }
  if (!mejor || mejor.d > 120) return null;   // las calles no se cruzan cerca: no es confiable
  return { lat: mejor.y / ky, lng: mejor.x / kx };
}
const enCaja = (lat, lng) => lat <= CAJA.arr && lat >= CAJA.aba && lng >= CAJA.izq && lng <= CAJA.der;
const red = (v) => Math.round(Number(v) * 1e6) / 1e6;

async function conGoogle(dir, mun) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('address', `${dir}, ${mun}, Santander, Colombia`);
  u.searchParams.set('components', 'country:CO');
  u.searchParams.set('bounds', `${CAJA.aba},${CAJA.izq}|${CAJA.arr},${CAJA.der}`);
  u.searchParams.set('language', 'es');
  u.searchParams.set('key', process.env.GOOGLE_GEOCODING_KEY);
  const r = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json();
  const x = (r.results || [])[0];
  if (!x || !enCaja(x.geometry.location.lat, x.geometry.location.lng)) return null;
  const tipo = x.geometry.location_type;
  return { lat: red(x.geometry.location.lat), lng: red(x.geometry.location.lng), etiqueta: x.formatted_address,
    precision: tipo === 'ROOFTOP' || tipo === 'RANGE_INTERPOLATED' ? 'exacta' : 'aproximada' };
}

// Devuelve { encontrado, lat, lng, precision: 'exacta'|'cruce'|'calle'|'barrio'|'municipio', etiqueta, centro }
export async function buscar(dir, mun = 'Bucaramanga', barrio = '') {
  if (!MUNICIPIOS[mun]) mun = 'Bucaramanga';
  const centro = MUNICIPIOS[mun];
  dir = String(dir || '').trim().slice(0, 200);
  if (process.env.GOOGLE_GEOCODING_KEY) {
    try { const g = await conGoogle(dir, mun); if (g) return { encontrado: true, ...g, centro }; } catch (e) { console.warn('[geocodificar] Google:', e.message); }
  }
  const a = analizar(dir);
  if (a) {
    const via = `${a.tipo} ${a.num}`;
    const r1 = await nominatim({ street: via, city: mun, polygon_geojson: 1 });
    const L1 = lineas(r1.filter((x) => /highway/.test(x.category || x.class || '') || x.geojson?.type?.includes('Line')));
    if (L1.length) {
      for (const otra of otraVia(a.tipo)) {
        const r2 = await nominatim({ street: `${otra} ${a.cruce}`, city: mun, polygon_geojson: 1 });
        const p = cruce(L1, lineas(r2));
        if (p && enCaja(p.lat, p.lng)) return { encontrado: true, lat: red(p.lat), lng: red(p.lng), precision: 'cruce', etiqueta: `${via} con ${otra} ${a.cruce}, ${mun}`, centro };
      }
      const x = r1[0];
      if (x && enCaja(+x.lat, +x.lon)) return { encontrado: true, lat: red(x.lat), lng: red(x.lon), precision: 'calle', etiqueta: `${via}, ${mun}`, centro };
    }
  }
  if (dir) {
    const r = await nominatim({ q: `${dir}, ${mun}, Santander` });
    const x = r.find((y) => enCaja(+y.lat, +y.lon));
    if (x) return { encontrado: true, lat: red(x.lat), lng: red(x.lon), precision: x.category === 'building' || x.type === 'house' ? 'exacta' : 'aproximada', etiqueta: x.display_name, centro };
  }
  if (barrio && String(barrio).trim().length > 2) {
    const r = await nominatim({ q: `${String(barrio).slice(0, 80)}, ${mun}, Santander` });
    const x = r.find((y) => enCaja(+y.lat, +y.lon));
    if (x) return { encontrado: true, lat: red(x.lat), lng: red(x.lon), precision: 'barrio', etiqueta: x.display_name, centro };
  }
  return { encontrado: false, precision: 'municipio', centro, etiqueta: mun };
}

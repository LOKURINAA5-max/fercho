// Tarifa de domicilio: fija o por kilómetro. La distancia se calcula en línea recta (fórmula de Haversine)
// y se multiplica por un factor de ruta (las calles no son rectas). Es una estimación gratuita y sin servicios externos.
import { bad } from './errores.js';

export const enColombia = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat > -4.5 && lat < 13.5 && lng > -79.5 && lng < -66.5;
export function kmEntre(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
export function config(aj) {
  const lat = aj.local_lat === '' || aj.local_lat == null ? null : Number(aj.local_lat), lng = aj.local_lng === '' || aj.local_lng == null ? null : Number(aj.local_lng);
  return {
    ubicacion: aj.dom_ubicacion !== 'false', nav: ['waze', 'google', 'ambas'].includes(aj.nav_app) ? aj.nav_app : 'waze',
    modo: ['ninguno', 'fija', 'km'].includes(aj.dom_modo) ? aj.dom_modo : 'fija', fija: n(aj.dom_fija, 0), base: n(aj.dom_base, 0),
    km_incluidos: n(aj.dom_km_incluidos, 0), por_km: n(aj.dom_por_km, 0), km_max: n(aj.dom_km_max, 0), factor: Math.max(1, n(aj.dom_factor_ruta, 1.3)),
    local: lat !== null && lng !== null && enColombia(lat, lng) ? { lat, lng } : null,
  };
}
// Devuelve { km, costo }. Lanza error si la ubicación es obligatoria y falta, o si queda fuera de cobertura.
export function cotizar(cfg, punto) {
  let km = null;
  if (punto && cfg.local) km = Math.round(kmEntre(cfg.local, punto) * cfg.factor * 10) / 10;
  if (cfg.km_max > 0 && km !== null && km > cfg.km_max) throw bad(`Tu ubicación queda a unos ${km} km y llegamos hasta ${cfg.km_max} km. Habla con el local`);
  if (cfg.modo === 'ninguno') return { km, costo: 0 };
  if (cfg.modo === 'fija') return { km, costo: Math.round(cfg.fija) };
  if (km === null) throw bad(cfg.local ? 'Marca tu ubicación para calcular el domicilio' : 'El local aún no configuró su ubicación para calcular el domicilio');
  const extra = Math.max(0, km - cfg.km_incluidos) * cfg.por_km;
  return { km, costo: Math.ceil((cfg.base + extra) / 500) * 500 };   // se redondea hacia arriba a múltiplos de $500
}
export function punto(lat, lng) {
  if (lat === undefined || lat === null || lat === '') return null;
  const p = { lat: Number(lat), lng: Number(lng) };
  if (!enColombia(p.lat, p.lng)) throw bad('Ubicación inválida');
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

// Neon ofrece dos direcciones: "directa" y "pooler" (el host trae "-pooler"). El pooler (PgBouncer) no admite
// la zona horaria de la sesión ni los candados que usa el arranque, así que SIEMPRE usamos la directa.
export function urlDirecta(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (/-pooler(\.|$)/.test(u.hostname)) {
      u.hostname = u.hostname.replace('-pooler', '');
      console.warn('[conexion] La DATABASE_URL era la del "pooler" de Neon; se usa la conexión directa (la app lo necesita).');
      return u.toString();
    }
  } catch { /* si no es una URL válida, que falle pg con su mensaje */ }
  return url;
}

// Verificación en dos pasos (TOTP, RFC 6238) y cifrado del secreto, sin dependencias externas.
import crypto from 'node:crypto';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function b32enc(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
export function b32dec(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
// Devuelve el "paso" de 30 s en que el código es válido (tolera ±1 paso por diferencia de reloj) o null.
export function totpCheck(secretB32, code, now = Date.now()) {
  const key = b32dec(secretB32), step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const esperado = Buffer.from(hotp(key, step + d)), recibido = Buffer.from(String(code));
    if (esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido)) return step + d;
  }
  return null;
}
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const llaveDe = (secreto) => crypto.createHash('sha256').update('totp:' + secreto).digest();
export function cifrar(texto, llave) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', llave, iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join(':');
}
export function descifrar(s, llave) {
  const [iv, tag, enc] = s.split(':').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', llave, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

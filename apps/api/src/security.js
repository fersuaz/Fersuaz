import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

// Token de sesión firmado (HMAC-SHA256). El secreto viene de SESSION_SECRET.
export function signSession(payload, secret, ttlSeconds = 8 * 3600) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySession(token, secret) {
  const [encoded, sig] = String(token ?? '').split('.');
  if (!encoded || !sig) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const body = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  if (body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

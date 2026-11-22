import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Fotos de recetas en memoria (pruebas). */
export class MemoryFiles {
  constructor() { this.m = new Map(); }
  async put(buf, tipo, ownerId) { const clave = `${randomUUID()}.${EXT[tipo]}`; this.m.set(clave, { buf, tipo, ownerId }); return clave; }
  async get(clave) { return this.m.get(clave) ?? null; }
  async remove(clave) { this.m.delete(clave); }
}

/** Fotos en disco: desarrollo local. En producción se reemplaza por DigitalOcean Spaces (privado). */
export class LocalFiles {
  constructor(dir) { this.dir = dir; this.meta = new Map(); }
  async put(buf, tipo, ownerId) {
    await mkdir(this.dir, { recursive: true });
    const clave = `${randomUUID()}.${EXT[tipo]}`;
    await writeFile(join(this.dir, clave), buf);
    this.meta.set(clave, { tipo, ownerId });
    return clave;
  }
  async get(clave) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(clave)) return null;
    try {
      const buf = await readFile(join(this.dir, clave));
      const tipo = Object.entries(EXT).find(([, e]) => clave.endsWith(e))[0];
      return { buf, tipo, ownerId: this.meta.get(clave)?.ownerId };
    } catch { return null; }
  }
  async remove(clave) { if (/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(clave)) await unlink(join(this.dir, clave)).catch(() => {}); }
}

// ---------------------------------------------------------------- DigitalOcean Spaces (compatible con S3)
import { createHash, createHmac } from 'node:crypto';

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

/** Firma AWS Signature V4 (S3/Spaces, SES…). Devuelve los encabezados a enviar. */
export function firmarS3({ method, host, path, region, accessKey, secretKey, headers = {}, payloadHash, fecha = new Date(), servicio = 's3' }) {
  const amzDate = fecha.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const nombres = Object.keys(h).sort();
  const canon = [method, path.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/'), '', ...nombres.map((k) => `${k}:${h[k]}`), '', nombres.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${servicio}/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canon)].join('\n');
  const kFirma = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), servicio), 'aws4_request');
  const firma = createHmac('sha256', kFirma).update(aFirmar).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${nombres.join(';')}, Signature=${firma}` };
}

/** Archivos privados en un Space: ni públicos ni listables; se sirven solo a través de la API con permisos. */
export class SpacesFiles {
  constructor({ accessKey, secretKey, bucket, region = 'nyc3', prefijo = 'adjuntos', fetchImpl = fetch }) {
    Object.assign(this, { accessKey, secretKey, bucket, region, prefijo, fetch: fetchImpl });
    this.host = `${bucket}.${region}.digitaloceanspaces.com`;
  }
  async put(buf, tipo, ownerId) {
    const clave = `${randomUUID()}.${EXT[tipo]}`;
    const path = `/${this.prefijo}/${clave}`;
    const headers = firmarS3({ method: 'PUT', host: this.host, path, region: this.region, accessKey: this.accessKey, secretKey: this.secretKey,
      headers: { 'content-type': tipo, 'x-amz-acl': 'private', 'x-amz-meta-owner': ownerId }, payloadHash: sha256(buf) });
    const r = await this.fetch(`https://${this.host}${path}`, { method: 'PUT', headers, body: buf });
    if (!r.ok) throw new Error(`No se pudo guardar el archivo (Spaces ${r.status}).`);
    return clave;
  }
  async get(clave) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(clave)) return null;
    const path = `/${this.prefijo}/${clave}`;
    const headers = firmarS3({ method: 'GET', host: this.host, path, region: this.region, accessKey: this.accessKey, secretKey: this.secretKey, payloadHash: sha256('') });
    const r = await this.fetch(`https://${this.host}${path}`, { headers });
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error(`No se pudo leer el archivo (Spaces ${r.status}).`);
    return { buf: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type'), ownerId: r.headers.get('x-amz-meta-owner') };
  }
  async remove(clave) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(clave)) return;
    const path = `/${this.prefijo}/${clave}`;
    const headers = firmarS3({ method: 'DELETE', host: this.host, path, region: this.region, accessKey: this.accessKey, secretKey: this.secretKey, payloadHash: sha256('') });
    const r = await this.fetch(`https://${this.host}${path}`, { method: 'DELETE', headers });
    if (!r.ok && r.status !== 404) throw new Error(`No se pudo borrar el archivo (Spaces ${r.status}).`);
  }
}

export const sha256Hex = sha256;
export function crearArchivos(env, uploadDir) {
  const { SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION } = env;
  if (SPACES_KEY && SPACES_SECRET && SPACES_BUCKET) return new SpacesFiles({ accessKey: SPACES_KEY, secretKey: SPACES_SECRET, bucket: SPACES_BUCKET, region: SPACES_REGION || 'nyc3' });
  if (env.NODE_ENV === 'production') console.warn('⚠ Sin Spaces configurado: los archivos se guardan en el disco del servidor y se pierden al redesplegar.');
  return new LocalFiles(uploadDir);
}

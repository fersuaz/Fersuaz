import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Fotos de recetas en memoria (pruebas). */
export class MemoryFiles {
  constructor() { this.m = new Map(); }
  async put(buf, tipo, ownerId) { const clave = `${randomUUID()}.${EXT[tipo]}`; this.m.set(clave, { buf, tipo, ownerId }); return clave; }
  async get(clave) { return this.m.get(clave) ?? null; }
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
}

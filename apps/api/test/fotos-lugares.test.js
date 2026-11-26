import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { fotosDe } from '../src/lugares.js';

const foto = (pid, k) => ({ name: `places/${pid}/photos/F${k}`, widthPx: 800, heightPx: 600, authorAttributions: [{ displayName: 'Autor Ejemplo', uri: 'https://maps.google.com/x' }] });

test('fotosDe: solo nombres válidos de Google, máximo 6, con atribución', () => {
  const fs = fotosDe([...Array.from({ length: 8 }, (_, i) => foto('PID12345678', i)), { name: 'http://otro-sitio/x.jpg' }]);
  assert.equal(fs.length, 6);
  assert.deepEqual(fs[0], { nombre: 'places/PID12345678/photos/F0', ancho: 800, alto: 600, autores: [{ nombre: 'Autor Ejemplo', url: 'https://maps.google.com/x' }] });
  assert.deepEqual(fotosDe(undefined), []);
});

test('fotos de lugares: se traen de Google por tandas, se sirven solo las de lugares registrados y se guardan al agregar', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const pedidas = [];
  const lugares = {
    activo: true,
    fotos: async (pid) => (pid === 'PIDSINFOTO1' ? [] : fotosDe([foto(pid, 1), foto(pid, 2)])),
    imagen: async (n, w) => { pedidas.push([n, w]); return { tipo: 'image/jpeg', buf: Buffer.from(`jpg-${n}-${w}`) }; },
    detalle: async () => ({ placeId: 'PIDNUEVO123', nombre: 'Clínica Nueva (Ejemplo)', direccion: 'Moca', lat: 19.39, lng: -70.52, fotos: fotosDe([foto('PIDNUEVO123', 9)]) }),
    buscar: async () => [],
  };
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), lugares })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {};
    for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' } })) {
      await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props });
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    for (const [i, pid] of ['PIDAAAAAAA1', 'PIDBBBBBBB2', 'PIDSINFOTO1'].entries()) await data.insert('establecimientos', { tipo: 'clinica', nombre: `Clínica ${i} (Ejemplo)`, provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'google', placeId: pid });
    await data.insert('establecimientos', { tipo: 'clinica', nombre: 'Sin Google (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });

    assert.equal((await call('POST', '/api/lugares/fotos/traer', { tipo: 'establecimiento' }, tok.rep)).status, 403);
    const t1 = (await call('POST', '/api/lugares/fotos/traer', { tipo: 'establecimiento', limite: 2 }, tok.ger)).body.item;
    assert.deepEqual([t1.consultados, t1.conFotos, t1.faltan, t1.sinGoogle], [2, 2, 1, 1]);
    const t2 = (await call('POST', '/api/lugares/fotos/traer', { tipo: 'establecimiento', limite: 2 }, tok.ger)).body.item;
    assert.deepEqual([t2.consultados, t2.conFotos, t2.faltan], [1, 0, 0], 'el que no tiene fotos queda revisado');
    assert.equal((await call('POST', '/api/lugares/fotos/traer', { tipo: 'establecimiento' }, tok.ger)).body.item.consultados, 0, 'no se repite');

    // Servir la imagen (sin sesión, como <img>), con caché y solo de lugares registrados
    const ok = await fetch(`${url}/api/lugares/foto?n=${encodeURIComponent('places/PIDAAAAAAA1/photos/F1')}&w=200`);
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg'); assert.match(ok.headers.get('cache-control'), /max-age=86400/);
    assert.equal(await ok.text(), 'jpg-places/PIDAAAAAAA1/photos/F1-200');
    await fetch(`${url}/api/lugares/foto?n=${encodeURIComponent('places/PIDAAAAAAA1/photos/F1')}&w=200`);
    assert.equal(pedidas.length, 1, 'la segunda vez sale de la caché');
    assert.equal((await fetch(`${url}/api/lugares/foto?n=${encodeURIComponent('places/OTROLUGAR99/photos/F1')}`)).status, 404, 'lugar no registrado');
    assert.equal((await fetch(`${url}/api/lugares/foto?n=${encodeURIComponent('https://evil/x')}`)).status, 404);

    // Al agregar desde Google, sus fotos quedan guardadas
    const a = await call('POST', '/api/territorio/google/agregar', { tipo: 'clinica', provincia: 'Espaillat', municipio: 'Moca', placeId: 'PIDNUEVO123' }, tok.ger);
    assert.ok([200, 201].includes(a.status), JSON.stringify(a.body));
    const nuevo = await data.get('establecimientos', a.body.item.id);
    assert.equal(nuevo.fotos.items[0].nombre, 'places/PIDNUEVO123/photos/F9');
  } finally { server.close(); }
});

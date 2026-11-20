import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { firmarS3, SpacesFiles } from '../src/files.js';
import { GoogleRoutes, SinMapas } from '../src/mapas.js';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

test('SigV4: coincide con el vector oficial de AWS (GET con Range)', () => {
  const h = firmarS3({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    headers: { range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    fecha: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('Spaces: guarda privado con dueño y lo lee de vuelta', async () => {
  const objetos = new Map(); const pedidos = [];
  const fakeFetch = async (url, o = {}) => {
    pedidos.push({ url, method: o.method ?? 'GET', headers: o.headers });
    if ((o.method ?? 'GET') === 'PUT') { objetos.set(url, { body: o.body, tipo: o.headers['content-type'], owner: o.headers['x-amz-meta-owner'] }); return new Response(null, { status: 200 }); }
    const x = objetos.get(url);
    return x ? new Response(x.body, { status: 200, headers: { 'content-type': x.tipo, 'x-amz-meta-owner': x.owner } }) : new Response(null, { status: 404 });
  };
  const s = new SpacesFiles({ accessKey: 'K', secretKey: 'S', bucket: 'fersuaz-archivos', region: 'nyc3', fetchImpl: fakeFetch });
  const clave = await s.put(Buffer.from('%PDF-1.4'), 'application/pdf', 'user-1');
  assert.match(pedidos[0].url, /^https:\/\/fersuaz-archivos\.nyc3\.digitaloceanspaces\.com\/adjuntos\/[0-9a-f-]{36}\.pdf$/);
  assert.equal(pedidos[0].headers['x-amz-acl'], 'private');
  assert.match(pedidos[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=K\/\d{8}\/nyc3\/s3\/aws4_request/);
  const f = await s.get(clave);
  assert.equal(f.ownerId, 'user-1'); assert.equal(f.buf.toString(), '%PDF-1.4');
  assert.equal(await s.get('../../etc/passwd'), null);
});

test('Google Routes: arma la ruta residencia → paradas → residencia y lee km y minutos', async () => {
  let enviado;
  const g = new GoogleRoutes('CLAVE', { fetchImpl: async (url, o) => {
    enviado = { url, headers: o.headers, body: JSON.parse(o.body) };
    return new Response(JSON.stringify({ routes: [{ distanceMeters: 84213, duration: '5400s', legs: [{ distanceMeters: 42000, duration: '2700s' }, { distanceMeters: 42213, duration: '2700s' }] }] }), { status: 200 });
  } });
  const r = await g.ruta({ municipio: 'Concepción de La Vega', provincia: 'La Vega', direccion: 'Calle 1' }, [{ lugar: 'Hospital Regional', municipio: 'Moca', provincia: 'Espaillat' }]);
  assert.equal(r.km, 84.21); assert.equal(r.minutos, 90); assert.equal(r.tramos.length, 2);
  assert.equal(enviado.headers['X-Goog-Api-Key'], 'CLAVE');
  assert.equal(enviado.body.origin.address, 'Calle 1, Concepción de La Vega, La Vega, República Dominicana');
  assert.equal(enviado.body.destination.address, enviado.body.origin.address);
  assert.equal(enviado.body.intermediates[0].address, 'Hospital Regional, Moca, Espaillat, República Dominicana');
  assert.equal(enviado.body.travelMode, 'DRIVE');
});

test('Google Routes: errores con mensaje claro', async () => {
  const g = (status, body = {}) => new GoogleRoutes('X', { fetchImpl: async () => new Response(JSON.stringify(body), { status }) });
  await assert.rejects(g(403).ruta({ municipio: 'A' }, [{ lugar: 'B' }]), /clave/);
  await assert.rejects(g(429).ruta({ municipio: 'A' }, [{ lugar: 'B' }]), /límite/);
  await assert.rejects(g(200, { routes: [] }).ruta({ municipio: 'A' }, [{ lugar: 'B' }]), /No se encontró/);
});

async function app(mapas) {
  const store = new MemoryStore();
  const server = createServer(createApp({ store, data: new MemoryData(), files: new MemoryFiles(), mapas, sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const tok = {};
  for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' } })) {
    await store.createUser({ fullName: k, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props });
    tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
  }
  const repId = (await call('GET', '/api/auth/me', null, tok.rep)).body.user.id;
  await call('POST', `/api/viaticos/perfiles/${repId}`, { residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega' }, vehiculo: { propiedad: 'asignado', combustible: 'gasolina_regular', rendimiento: 30 }, tarifaAlimentacion: 400 }, tok.ger);
  return { server, call, tok };
}
const J = { fecha: '2026-11-10', paradas: [{ lugar: 'Hospital Regional', municipio: 'Moca', provincia: 'Espaillat' }] };

test('sin proveedor: calcular km responde 503 y la jornada exige km manuales', async () => {
  const { server, call, tok } = await app(new SinMapas());
  try {
    assert.equal((await call('GET', '/api/viaticos/estado', null, tok.rep)).body.mapas, false);
    assert.equal((await call('POST', '/api/viaticos/calcular-km', J, tok.rep)).status, 503);
    assert.equal((await call('POST', '/api/viaticos/jornadas', J, tok.rep)).status, 422);
    assert.equal((await call('POST', '/api/viaticos/jornadas', { ...J, kmEstimados: 80 }, tok.rep)).body.item.kmFuente, 'manual');
  } finally { server.close(); }
});

test('con proveedor: el servidor recalcula los km del mapa; no acepta la cifra del navegador', async () => {
  const mapas = { activo: true, async ruta() { return { km: 84.21, minutos: 90, tramos: [], proveedor: 'google' }; } };
  const { server, call, tok } = await app(mapas);
  try {
    assert.equal((await call('POST', '/api/viaticos/calcular-km', J, tok.rep)).body.km, 84.21);
    const j = (await call('POST', '/api/viaticos/jornadas', { ...J, kmEstimados: 999, kmFuente: 'google' }, tok.rep)).body.item;
    assert.equal(j.kmEstimados, 84.21); assert.equal(j.kmFuente, 'google');
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, tok.rep)).body.calculo;
    assert.equal(p.supuestos.kmTipo, 'por carretera (Google)');
  } finally { server.close(); }
});

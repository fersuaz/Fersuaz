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
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), mapas, sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const tok = {}; const ids = {};
  for (const [k, props] of Object.entries({ adm: { role: 'administrador' }, ger: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' }, otro: { role: 'representante', position: 'PVC' } })) {
    ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
    tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
  }
  await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega' }, vehiculo: { propiedad: 'asignado', combustible: 'gasolina_regular', rendimiento: 30 }, tarifaAlimentacion: 400 }, tok.ger);
  await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['Espaillat', 'La Vega'] }, tok.ger);
  // Ejemplo: tres lugares; el administrador los programa en un orden que no es el más corto.
  const lug = {};
  lug.moca = await data.insert('establecimientos', { tipo: 'hospital', nombre: 'Hospital Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', lat: 19.39, lng: -70.52, estado: 'validado', fuente: 'manual' });
  lug.jarabacoa = await data.insert('establecimientos', { tipo: 'unap', nombre: 'UNAP Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', lat: 19.12, lng: -70.64, estado: 'validado', fuente: 'manual' });
  lug.farm = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Bonao', provincia: 'Monseñor Nouel', municipio: 'Bonao', estado: 'validada', fuente: 'manual' });
  return { server, call, tok, ids, lug, data };
}
const ref = (x, t = 'establecimiento') => ({ refTipo: t, refId: x.id });

test('cronograma: solo el administrador lo crea, dentro de las provincias del representante y sin repetir días', async () => {
  const { server, call, tok, ids, lug } = await app(new SinMapas());
  try {
    const body = { representanteId: ids.rep, fechas: ['2026-11-23', '2026-11-24'], lugares: [ref(lug.moca), ref(lug.jarabacoa)] };
    assert.equal((await call('POST', '/api/cronogramas', body, tok.ger)).status, 403);
    assert.equal((await call('POST', '/api/cronogramas', body, tok.rep)).status, 403);
    assert.equal((await call('POST', '/api/cronogramas', { ...body, fechas: ['2026-10-31'] }, tok.adm)).status, 422, 'meses anteriores no');
    const fuera = await call('POST', '/api/cronogramas', { ...body, lugares: [ref(lug.farm, 'farmacia')] }, tok.adm);
    assert.equal(fuera.status, 422); assert.match(fuera.body.fields.lugares, /fuera de las provincias/);
    assert.equal((await call('POST', '/api/cronogramas', { ...body, representanteId: ids.otro }, tok.adm)).status, 409, 'sin provincias asignadas');
    const ok = await call('POST', '/api/cronogramas', body, tok.adm);
    assert.equal(ok.status, 201); assert.equal(ok.body.items.length, 2);
    assert.equal(ok.body.items[0].lugares[0].lugar, 'Hospital Ejemplo Moca');
    assert.equal((await call('POST', '/api/cronogramas', body, tok.adm)).status, 409, 'no se duplica el día');
    const mios = (await call('GET', '/api/cronogramas', null, tok.rep)).body.items;
    assert.deepEqual(mios.map((c) => c.fecha), ['2026-11-23', '2026-11-24']);
    const notis = (await call('GET', '/api/notificaciones', null, tok.rep)).body;
    assert.equal(notis.sinLeer, 1); assert.equal(notis.items[0].titulo, 'Nuevo cronograma');
    const an = await call('POST', `/api/cronogramas/${mios[1].id}/anular`, { motivo: 'Cambio de ruta' }, tok.adm);
    assert.equal(an.body.item.estado, 'anulado');
    assert.equal((await call('GET', '/api/cronogramas', null, tok.rep)).body.items.length, 1, 'el anulado no se le muestra');
  } finally { server.close(); }
});

test('sin mapa: la jornada sale del cronograma (orden del administrador) y exige km manuales', async () => {
  const { server, call, tok, ids, lug } = await app(new SinMapas());
  try {
    const [c] = (await call('POST', '/api/cronogramas', { representanteId: ids.rep, fechas: ['2026-11-23'], lugares: [ref(lug.jarabacoa), ref(lug.moca)] }, tok.adm)).body.items;
    assert.equal((await call('GET', '/api/viaticos/estado', null, tok.rep)).body.mapas, false);
    assert.equal((await call('POST', '/api/viaticos/jornadas', { fecha: '2026-11-23', paradas: [{ lugar: 'Inventado', municipio: 'Moca', provincia: 'Espaillat' }], kmEstimados: 10 }, tok.rep)).status, 422, 'sin cronograma no hay jornada');
    assert.equal((await call('POST', '/api/viaticos/jornadas', { cronogramaId: c.id }, tok.rep)).status, 422, 'faltan km');
    assert.equal((await call('POST', '/api/viaticos/jornadas', { cronogramaId: c.id, kmEstimados: 90 }, tok.otro)).status, 404, 'el cronograma es de otro');
    const j = (await call('POST', '/api/viaticos/jornadas', { cronogramaId: c.id, kmEstimados: 90, fecha: '2026-12-31' }, tok.rep)).body.item;
    assert.equal(j.fecha, '2026-11-23', 'la fecha la pone el cronograma'); assert.equal(j.kmFuente, 'manual');
    assert.deepEqual(j.paradas.map((p) => p.lugar), ['UNAP Ejemplo Jarabacoa', 'Hospital Ejemplo Moca']);
    assert.equal((await call('POST', `/api/cronogramas/${c.id}/anular`, { motivo: 'x x x' }, tok.adm)).status, 409, 'con jornada no se anula');
    assert.equal((await call('GET', '/api/cronogramas', null, tok.rep)).body.items[0].jornadaId, j.id);
  } finally { server.close(); }
});

test('con mapa: el servidor ordena las paradas por distancia y usa los km del mapa, no los del navegador', async () => {
  let pedido;
  const mapas = { activo: true, async ruta(o, paradas, op) { pedido = { paradas, op }; return { km: 84.21, minutos: 90, tramos: [], orden: [1, 0], proveedor: 'google' }; } };
  const { server, call, tok, ids, lug } = await app(mapas);
  try {
    const [c] = (await call('POST', '/api/cronogramas', { representanteId: ids.rep, fechas: ['2026-11-23'], lugares: [ref(lug.jarabacoa), ref(lug.moca)] }, tok.adm)).body.items;
    const vista = (await call('GET', `/api/cronogramas/${c.id}/ruta`, null, tok.rep)).body;
    assert.deepEqual(vista.paradas.map((p) => p.lugar), ['Hospital Ejemplo Moca', 'UNAP Ejemplo Jarabacoa']);
    assert.equal(vista.km, 84.21); assert.equal(vista.optimizado, true);
    assert.equal(pedido.op.optimizar, true); assert.equal(pedido.paradas[0].lat, 19.12, 'coordenadas de la base');
    const j = (await call('POST', '/api/viaticos/jornadas', { cronogramaId: c.id, kmEstimados: 999 }, tok.rep)).body.item;
    assert.equal(j.kmEstimados, 84.21); assert.equal(j.kmFuente, 'google');
    assert.deepEqual(j.paradas.map((p) => p.lugar), ['Hospital Ejemplo Moca', 'UNAP Ejemplo Jarabacoa']);
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, tok.rep)).body.calculo;
    assert.equal(p.supuestos.kmTipo, 'por carretera (Google)');
  } finally { server.close(); }
});

test('SES: firma SigV4 del servicio ses y cuerpo con asunto y HTML', async () => {
  const { SesCorreo } = await import('../src/correo.js');
  let req;
  const ses = new SesCorreo({ accessKey: 'AKIDEJEMPLO', secretKey: 'secreto', region: 'us-east-1', remitente: 'FERSUAZ <notificaciones@fersuaz.net>', fetchImpl: async (url, o) => { req = { url, ...o }; return new Response('{}', { status: 200 }); } });
  await ses.enviar({ para: 'ana@ejemplo.do', asunto: 'Prueba', texto: 'Hola', html: '<p>Hola</p>' });
  assert.equal(req.url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
  assert.match(req.headers.authorization, /\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
  const b = JSON.parse(req.body);
  assert.deepEqual(b.Destination.ToAddresses, ['ana@ejemplo.do']); assert.equal(b.Content.Simple.Body.Html.Data, '<p>Hola</p>');
  const mal = new SesCorreo({ accessKey: 'A', secretKey: 'B', remitente: 'x@y.do', fetchImpl: async () => new Response('{"message":"Email address is not verified."}', { status: 400 }) });
  await assert.rejects(mal.enviar({ para: 'a@b.do', asunto: 's', texto: 't' }), /not verified/);
});

test('notificaciones: una solicitud nueva avisa a quienes pueden aprobar, con campana y correo', async () => {
  const enviados = [];
  const correo = { activo: true, async enviar(m) { enviados.push(m); } };
  const store = new MemoryStore();
  const server = createServer(createApp({ store, data: new MemoryData(), files: new MemoryFiles(), correo, sitio: 'https://ejemplo.fersuaz', sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {};
    for (const [k, role] of Object.entries({ ger: 'gerencia', fin: 'finanzas' })) {
      await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), role });
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await call('POST', '/api/auth/register', { fullName: 'Rosa Ejemplo', email: 'rosa@ejemplo.do', password: 'ClaveEjemplo2026', role: 'representante', position: 'PVC', acceptsPrivacy: true });
    await new Promise((r) => setTimeout(r, 50));
    const g = (await call('GET', '/api/notificaciones', null, tok.ger)).body;
    assert.equal(g.sinLeer, 1); assert.equal(g.items[0].enlace, '#solicitudes'); assert.equal(g.items[0].correo, 'enviado');
    assert.equal((await call('GET', '/api/notificaciones', null, tok.fin)).body.sinLeer, 0, 'finanzas no aprueba representantes');
    assert.equal(enviados.length, 1); assert.equal(enviados[0].para, 'ger@x.do'); assert.match(enviados[0].html, /ejemplo\.fersuaz\/panel\.html#solicitudes/);
    assert.equal((await call('POST', `/api/notificaciones/${g.items[0].id}/leer`, null, tok.fin)).status, 404, 'solo el dueño la marca');
    await call('POST', '/api/notificaciones/leer-todas', null, tok.ger);
    assert.equal((await call('GET', '/api/notificaciones', null, tok.ger)).body.sinLeer, 0);
  } finally { server.close(); }
});

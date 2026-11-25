import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { leerCoordenadas } from '../src/validation.js';
import { GooglePlaces, zonaDeComponentes } from '../src/lugares.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';

test('Coordenadas: acepta un punto de República Dominicana y rechaza lo que está fuera o mal escrito', () => {
  assert.deepEqual(leerCoordenadas('19.4517123', '-70.6970456'), { lat: 19.451712, lng: -70.697046 });
  assert.deepEqual(leerCoordenadas(18.4861, -69.9312), { lat: 18.4861, lng: -69.9312 });
  assert.match(leerCoordenadas('-70.69', '19.45').error, /no están en República Dominicana/); // al revés
  assert.match(leerCoordenadas('40.71', '-74.00').error, /no están en República Dominicana/); // Nueva York
  assert.match(leerCoordenadas('19,45', '-70,69').error, /punto decimal/);
  assert.match(leerCoordenadas('', '-70.69').error, /punto decimal/);
});

test('Google: provincia, municipio y sector desde los componentes de la dirección', () => {
  const z = zonaDeComponentes([
    { long_name: 'Los Jardines', types: ['sublocality_level_1', 'sublocality'] },
    { long_name: 'Santiago de los Caballeros', types: ['locality'] },
    { long_name: 'Provincia de Santiago', types: ['administrative_area_level_1'] },
  ]);
  assert.deepEqual(z, { provincia: 'Santiago', municipio: 'Santiago de los Caballeros', sector: 'Los Jardines' });
});

test('Google: usa la dirección; si Geocoding no está habilitada, el lugar más cercano', async () => {
  const geo = new GooglePlaces('K', { fetchImpl: async (url) => {
    assert.match(url, /latlng=19\.45,-70\.69/);
    return new Response(JSON.stringify({ status: 'OK', results: [{ formatted_address: 'Calle 5 (Ejemplo), Tamboril, República Dominicana', address_components: [{ long_name: 'Tamboril', types: ['locality'] }, { long_name: 'Santiago', types: ['administrative_area_level_1'] }] }] }));
  } });
  assert.deepEqual(await geo.ubicacion(19.45, -70.69), { nombre: 'Calle 5 (Ejemplo), Tamboril', provincia: 'Santiago', municipio: 'Tamboril', sector: null, fuente: 'direccion' });
  const urls = [];
  const cerca = new GooglePlaces('K', { fetchImpl: async (url, o) => {
    urls.push(url);
    if (url.includes('geocode')) return new Response(JSON.stringify({ status: 'REQUEST_DENIED' }));
    assert.equal(JSON.parse(o.body).locationRestriction.circle.center.latitude, 19.45);
    return new Response(JSON.stringify({ places: [{ displayName: { text: 'Colmado (Ejemplo)' }, formattedAddress: 'Tamboril, República Dominicana', addressComponents: [{ longText: 'Tamboril', types: ['locality'] }] }] }));
  } });
  const x = await cerca.ubicacion(19.45, -70.69);
  assert.equal(x.nombre, 'Cerca de Colmado (Ejemplo), Tamboril'); assert.equal(x.fuente, 'cercano'); assert.equal(urls.length, 2);
});

test('Perfil: guarda latitud y longitud de donde sale; el endpoint nombra el punto y solo lo usa la gestión', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const lugares = { activo: true, ubicacion: async () => ({ nombre: 'Calle 5 (Ejemplo), Tamboril', provincia: 'Provincia de Santiago', municipio: 'tamboril', sector: null, fuente: 'direccion' }) };
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, lugares })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, tk) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(tk && { authorization: `Bearer ${tk}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const t = {}; const id = {};
  for (const [k, props] of Object.entries({ gerente: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' } })) {
    const u = await store.createUser({ fullName: k, email: `${k}@x.do`, phone: null, status: 'activo', passwordHash: await hashPassword(`clave${k}12345`), ...props });
    id[k] = u.id; t[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: `clave${k}12345` })).body.token;
  }
  try {
    const u = await call('GET', '/api/territorio/ubicacion?lat=19.45&lng=-70.69', null, t.gerente);
    assert.equal(u.status, 200);
    assert.deepEqual(u.body.item, { nombre: 'Calle 5 (Ejemplo), Tamboril', provincia: 'Santiago', municipio: 'Tamboril', sector: null, fuente: 'direccion' });
    assert.equal((await call('GET', '/api/territorio/ubicacion?lat=40&lng=-74', null, t.gerente)).status, 422);
    assert.equal((await call('GET', '/api/territorio/ubicacion?lat=19.45&lng=-70.69', null, t.rep)).status, 403);

    const perfil = { residencia: { provincia: 'Santiago', municipio: 'Tamboril', direccion: 'Calle 5 (Ejemplo), corregido', lat: '19.4517', lng: '-70.6970' }, vehiculo: { propiedad: 'asignado', marca: 'Toyota', modelo: 'Hilux', anio: 2022, combustible: 'gasoil_regular', rendimiento: 35 }, tarifaAlimentacion: 500 };
    const mal = await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...perfil, residencia: { ...perfil.residencia, lat: '19.45', lng: '' } }, t.gerente);
    assert.equal(mal.status, 422); assert.ok(mal.body.fields['residencia.coordenadas']);
    assert.equal((await call('POST', `/api/viaticos/perfiles/${id.rep}`, perfil, t.gerente)).status, 200);
    const g = (await call('GET', `/api/viaticos/perfiles/${id.rep}`, null, t.gerente)).body.item.residencia;
    assert.deepEqual([g.lat, g.lng, g.direccion], [19.4517, -70.697, 'Calle 5 (Ejemplo), corregido']);
    // Sin coordenadas sigue siendo válido (son opcionales).
    assert.equal((await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...perfil, residencia: { provincia: 'Santiago', municipio: 'Tamboril' } }, t.gerente)).status, 200);
  } finally { server.close(); }
});

import { coordsDeEnlace, abrirEnlace } from '../src/enlace-mapa.js';

test('Enlaces de Google Maps: lee el punto del lugar, ?q=, /search/ y el centro del mapa', () => {
  assert.deepEqual(coordsDeEnlace('https://www.google.com/maps/place/Farmacia+Ejemplo/@19.45,-70.69,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d19.4517123!4d-70.6970456'), { lat: 19.4517123, lng: -70.6970456 });
  assert.deepEqual(coordsDeEnlace('https://maps.google.com/?q=18.4861,-69.9312'), { lat: 18.4861, lng: -69.9312 });
  assert.deepEqual(coordsDeEnlace('https://www.google.com/maps/search/19.4517,+-70.6970?entry=tts'), { lat: 19.4517, lng: -70.697 });
  assert.deepEqual(coordsDeEnlace('https://www.google.com/maps/place/Parque+Central+(Ejemplo)/@19.39,-70.52,15z'), { lat: 19.39, lng: -70.52, aproximado: true, nombre: 'Parque Central (Ejemplo)' });
  assert.deepEqual(coordsDeEnlace('https://consent.google.com/ml?continue=https://www.google.com/maps?q%3D19.1,-70.2'), { lat: 19.1, lng: -70.2 });
  assert.equal(coordsDeEnlace('https://ejemplo.com/maps/@19.4,-70.6'), null); // no es Google
  assert.equal(coordsDeEnlace('no es un enlace'), null);
});

test('Enlace corto: sigue redirecciones solo dentro de Google', async () => {
  const saltos = { 'https://maps.app.goo.gl/Ejemplo123': 'https://www.google.com/maps/place/X/data=!3d19.2!4d-70.5' };
  const f = async (url) => (saltos[url] ? new Response(null, { status: 302, headers: { location: saltos[url] } }) : new Response('ok', { status: 200 }));
  assert.equal(await abrirEnlace('https://maps.app.goo.gl/Ejemplo123', f), 'https://www.google.com/maps/place/X/data=!3d19.2!4d-70.5');
  const fuera = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
  assert.equal(await abrirEnlace('https://maps.app.goo.gl/Malo', fuera), null);
  assert.equal(await abrirEnlace('https://otro-sitio.com/x', f), null);
});

test('Endpoint de enlace: corto → punto → nombre del lugar; rechaza enlaces que no son de Google', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const lugares = { activo: true, ubicacion: async () => ({ nombre: 'Calle 5 (Ejemplo), Moca', provincia: 'Espaillat', municipio: 'Moca', sector: null, fuente: 'direccion' }), coordsDe: async () => null };
  const enlaceFetch = async (url) => (url.includes('goo.gl') ? new Response(null, { status: 301, headers: { location: 'https://www.google.com/maps/place/Ejemplo/data=!3d19.3926!4d-70.5258' } }) : new Response('', { status: 200 }));
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, lugares, enlaceFetch })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, tk) => { const r = await fetch(url + p, { headers: { authorization: `Bearer ${tk}` } }); return { status: r.status, body: await r.json() }; };
  await store.createUser({ fullName: 'g', email: 'g@x.do', phone: null, status: 'activo', role: 'gerencia', passwordHash: await hashPassword('claveg12345') });
  const tk = (await (await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'g@x.do', password: 'claveg12345' }) })).json()).token;
  try {
    const r = await call(`/api/territorio/ubicacion-enlace?url=${encodeURIComponent('https://maps.app.goo.gl/Ejemplo123')}`, tk);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.lat, r.body.lng, r.body.item.nombre, r.body.item.municipio, r.body.desdeEnlace], [19.3926, -70.5258, 'Calle 5 (Ejemplo), Moca', 'Moca', true]);
    assert.equal((await call(`/api/territorio/ubicacion-enlace?url=${encodeURIComponent('https://ejemplo.com/@19.4,-70.6')}`, tk)).status, 422);
    assert.equal((await call(`/api/territorio/ubicacion-enlace?url=${encodeURIComponent('https://www.google.com/maps/@40.7,-74.0,15z')}`, tk)).status, 422); // fuera de RD
  } finally { server.close(); }
});

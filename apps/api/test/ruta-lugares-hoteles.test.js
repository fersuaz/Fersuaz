import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = () => new Date('2026-11-20T16:00:00Z');

async function setup() {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, now: NOW })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, tk) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(tk && { authorization: `Bearer ${tk}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const t = {}; const id = {};
  for (const [k, props] of Object.entries({ admin: { role: 'administrador' }, gerente: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' }, rep2: { role: 'representante', position: 'Vendedor' } })) {
    const u = await store.createUser({ fullName: k, email: `${k}@x.do`, phone: null, status: 'activo', passwordHash: await hashPassword(`clave${k}12345`), ...props });
    id[k] = u.id; t[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: `clave${k}12345` })).body.token;
  }
  // Ejemplo: tres lugares en Moca
  const ests = [];
  for (const n of ['Clínica A (Ejemplo)', 'Clínica B (Ejemplo)']) ests.push(await data.insert('establecimientos', { tipo: 'clinica', nombre: n, provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' }));
  const far = await data.insert('farmacias', { nombre: 'Farmacia C (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', estado: 'activa' });
  for (const r of ['rep', 'rep2']) await call('POST', `/api/territorio/zonas/${id[r]}`, { provincias: ['Espaillat'] }, t.gerente);
  return { server, call, t, id, data, ests, far };
}

test('Ruta: quitar lugares solo de un representante, deshacer y que no entren en su propuesta', async () => {
  const { server, call, t, id, ests, far } = await setup();
  try {
    const l0 = (await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.gerente)).body;
    assert.equal(l0.establecimientos.length + l0.farmacias.length, 3);
    assert.equal((await call('POST', `/api/territorio/zonas/${id.rep}/excluidos`, { quitar: [ests[0].id, far.id] }, t.rep)).status, 403);
    const q = await call('POST', `/api/territorio/zonas/${id.rep}/excluidos`, { quitar: [ests[0].id, far.id] }, t.gerente);
    assert.deepEqual(q.body.item, { excluidos: 2, quitados: 2, devueltos: 0 });
    const l1 = (await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.gerente)).body;
    assert.deepEqual(l1.establecimientos.map((x) => x.id), [ests[1].id]); assert.equal(l1.farmacias.length, 0);
    assert.equal(l1.excluidos.length, 2);
    // El otro representante y el catálogo no cambian
    const otro = (await call('GET', `/api/territorio/zonas/${id.rep2}/lugares`, null, t.gerente)).body;
    assert.equal(otro.establecimientos.length + otro.farmacias.length, 3);
    // La propuesta automática no los usa
    const pr = await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11', porDia: 5 }, t.admin);
    assert.equal(pr.status, 200);
    assert.deepEqual(pr.body.item.dias.flatMap((d) => d.lugares.map((l) => l.refId)), [ests[1].id]);
    // Cambiar la zona no borra los quitados
    await call('POST', `/api/territorio/zonas/${id.rep}`, { provincias: ['Espaillat', 'Santiago'] }, t.gerente);
    assert.equal((await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.gerente)).body.excluidos.length, 2);
    // Deshacer
    const v = await call('POST', `/api/territorio/zonas/${id.rep}/excluidos`, { volver: [ests[0].id, far.id] }, t.gerente);
    assert.deepEqual(v.body.item, { excluidos: 0, quitados: 0, devueltos: 2 });
    const l2 = (await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.gerente)).body;
    assert.equal(l2.establecimientos.length + l2.farmacias.length, 3); assert.equal(l2.excluidos.length, 0);
    assert.equal((await call('POST', `/api/territorio/zonas/${id.rep}/excluidos`, {}, t.gerente)).status, 422);
  } finally { server.close(); }
});

test('Hoteles: editar nombre, teléfono y precio; quitar varios y deshacer', async () => {
  const { server, call, t, data } = await setup();
  try {
    const a = await data.insert('hoteles', { nombre: 'Hotel A (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', fuente: 'manual', requisitos: {}, estado: 'activo' });
    const b = await data.insert('hoteles', { nombre: 'Hotel B (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', fuente: 'manual', requisitos: {}, estado: 'activo' });
    const e = await call('POST', `/api/hoteles/${a.id}`, { nombre: 'Hotel A Centro (Ejemplo)', telefono: '809-555-0101', precioNoche: '2500' }, t.gerente);
    assert.equal(e.status, 200); assert.equal(e.body.item.nombre, 'Hotel A Centro (Ejemplo)'); assert.equal(e.body.item.precioNoche, 2500); assert.equal(e.body.item.telefono, '809-555-0101');
    assert.equal((await call('POST', `/api/hoteles/${a.id}`, { nombre: 'x' }, t.gerente)).status, 422);
    assert.equal((await call('POST', '/api/hoteles/lote', { ids: [a.id, b.id], estado: 'inactivo' }, t.rep)).status, 403);
    const q = await call('POST', '/api/hoteles/lote', { ids: [a.id, b.id], estado: 'inactivo' }, t.gerente);
    assert.deepEqual(q.body.item, { cambiados: 2 });
    assert.equal((await call('GET', '/api/hoteles?provincia=Espaillat', null, t.rep)).body.items.length, 0);
    assert.deepEqual((await call('POST', '/api/hoteles/lote', { ids: [a.id, b.id], estado: 'activo' }, t.gerente)).body.item, { cambiados: 2 });
    assert.equal((await call('GET', '/api/hoteles?provincia=Espaillat', null, t.rep)).body.items.length, 2);
  } finally { server.close(); }
});

test('Listas en un solo pedido: todas las zonas y todos los planes de días', async () => {
  const { server, call, t, id } = await setup();
  try {
    const z = await call('GET', '/api/territorio/zonas', null, t.gerente);
    assert.equal(z.status, 200);
    assert.deepEqual(z.body.items.find((x) => x.representanteId === id.rep).provincias, ['Espaillat']);
    assert.equal((await call('GET', '/api/territorio/zonas', null, t.rep)).status, 403);
    const p = await call('GET', '/api/representantes/plan-dias', null, t.gerente);
    assert.equal(p.status, 200); assert.ok(Array.isArray(p.body.items));
    assert.equal((await call('GET', '/api/representantes/plan-dias', null, t.rep)).status, 403);
  } finally { server.close(); }
});

test('Visitas por día por posición: la propuesta usa la de su posición y se puede cambiar al proponer', async () => {
  const { server, call, t, id, data } = await setup();
  try {
    for (let i = 0; i < 6; i++) await data.insert('establecimientos', { tipo: 'clinica', nombre: `Clínica Extra ${i} (Ejemplo)`, provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });
    const v0 = (await call('GET', '/api/cronogramas/visitas-por-dia', null, t.gerente)).body.item;
    assert.equal(v0.predeterminado, 8); assert.equal(v0.porPosicion.Visitador, null);
    assert.equal((await call('POST', '/api/cronogramas/visitas-por-dia', { porPosicion: { Visitador: 3 } }, t.rep)).status, 403);
    assert.equal((await call('POST', '/api/cronogramas/visitas-por-dia', { porPosicion: { Visitador: 40 } }, t.gerente)).status, 422);
    const g = await call('POST', '/api/cronogramas/visitas-por-dia', { porPosicion: { Visitador: 3, Promotora: '' } }, t.gerente);
    assert.equal(g.body.item.porPosicion.Visitador, 3); assert.equal(g.body.item.porPosicion.Promotora, null);
    const pr = (await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11' }, t.admin)).body.item;
    assert.equal(pr.porDia, 3); assert.ok(pr.dias.every((d) => d.lugares.length <= 3));
    assert.equal((await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11', porDia: 5 }, t.admin)).body.item.porDia, 5);
  } finally { server.close(); }
});

test('Google: un hotel ya registrado en otro municipio sale como registrado y no da error al agregarlo', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const lugares = { activo: true,
    buscar: async () => [{ placeId: 'g-marien', nombre: 'Hotel Marien (Ejemplo)', direccion: 'Sabaneta', telefono: '809-555-0100' }],
    detalle: async () => ({ placeId: 'g-marien', nombre: 'Hotel Marien (Ejemplo)', direccion: 'Sabaneta', telefono: '809-555-0100', lat: 19.47, lng: -71.34 }) };
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, lugares })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, tk) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(tk && { authorization: `Bearer ${tk}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  await store.createUser({ fullName: 'g', email: 'g@x.do', phone: null, status: 'activo', role: 'gerencia', passwordHash: await hashPassword('claveg12345') });
  const tk = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'claveg12345' })).body.token;
  try {
    await data.insert('hoteles', { nombre: 'Hotel Marien (Ejemplo)', provincia: 'Santiago Rodríguez', municipio: 'Villa Los Almácigos', placeId: 'g-marien', fuente: 'google', requisitos: {}, estado: 'activo' });
    const b = await call('GET', `/api/territorio/google/buscar?${new URLSearchParams({ tipo: 'hotel', provincia: 'Santiago Rodríguez', municipio: 'San Ignacio de Sabaneta' })}`, null, tk);
    assert.equal(b.status, 200); assert.equal(b.body.items[0].registrado, true); assert.equal(b.body.items[0].registradoEn, 'Villa Los Almácigos, Santiago Rodríguez');
    const a = await call('POST', '/api/territorio/google/agregar', { tipo: 'hotel', provincia: 'Santiago Rodríguez', municipio: 'San Ignacio de Sabaneta', placeId: 'g-marien' }, tk);
    assert.equal(a.status, 409); assert.match(a.body.error, /ya está registrado en Villa Los Almácigos/);
    // Todos los municipios de la provincia: una búsqueda por municipio, sin repetir el mismo lugar
    const t = await call('GET', `/api/territorio/google/buscar?${new URLSearchParams({ tipo: 'hotel', provincia: 'Santiago Rodríguez', municipio: 'todos' })}`, null, tk);
    assert.equal(t.status, 200); assert.equal(t.body.items.length, 1); assert.equal(t.body.items[0].municipio, 'Monción', 'queda con el primer municipio donde salió');
    assert.equal(t.body.items[0].registrado, true);
  } finally { server.close(); }
});

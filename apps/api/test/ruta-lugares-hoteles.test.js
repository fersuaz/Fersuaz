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

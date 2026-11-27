import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { hashPassword } from '../src/security.js';
import { precioPorUnidad, cajasEquivalentes, conMargen } from '../src/calculos.js';

test('precio por unidad, cajas equivalentes y margen de farmacia', () => {
  assert.equal(precioPorUnidad(600, 30), 20);
  assert.equal(precioPorUnidad(1000, 3), 333.33);
  assert.equal(precioPorUnidad(600, null), null, 'jarabe: sin unidades por caja');
  assert.equal(precioPorUnidad(0, 10), null);
  assert.equal(cajasEquivalentes(3, 'caja', 30), 3);
  assert.equal(cajasEquivalentes(10, 'unidad', 30), 0.333);
  assert.equal(cajasEquivalentes(30, 'unidad', 30), 1);
  assert.equal(conMargen(20, 15), 23);
  assert.equal(conMargen(20, 30), 26);
  assert.equal(conMargen(0, 15), null);
});

test('medicamento por caja o por unidad; la dependiente puede enviar el voucher sin medicamentos', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const login = async (email) => (await call('POST', '/api/auth/login', { email, password: 'clave123456' })).body.token;
  try {
    const f = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo', provincia: 'Espaillat', municipio: 'Moca', estado: 'activa' });
    await store.createUser({ fullName: 'Dep Ejemplo', email: 'd@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'dependiente', farmaciaId: f.id });
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    const td = await login('d@x.do'); const tg = await login('g@x.do');
    // La gerencia configura las unidades por caja (no aplica a jarabes)
    const tab = (await call('POST', '/api/catalogo/medicamentos', { nombre: 'Tableta Ejemplo', presentacion: 'Caja x 30', precio: 600, unidadesPorCaja: 30 }, tg));
    assert.equal(tab.status, 201, JSON.stringify(tab.body)); assert.equal(tab.body.item.unidadesPorCaja, 30);
    const jar = (await call('POST', '/api/catalogo/medicamentos', { nombre: 'Jarabe Ejemplo', precio: 250 }, tg)).body.item;
    assert.equal((await call('POST', '/api/catalogo/medicamentos', { nombre: 'Malo Ejemplo', unidadesPorCaja: 1 }, tg)).status, 422);
    const jpg = (n) => ({ tipo: 'image/jpeg', nombre: `v-${n}.jpg`, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64') });
    // Por unidad: el precio sugerido es el de la caja ÷ unidades
    const v = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(1), items: [{ medicamentoId: tab.body.item.id, forma: 'unidad', cantidad: 10 }, { medicamentoId: jar.id, cantidad: 1, precio: 250 }] }, td);
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const [l1, l2] = v.body.item.items;
    assert.deepEqual([l1.forma, l1.precio, l1.monto, l1.cajas, l1.unidadesPorCaja], ['unidad', 20, 200, 0.333, 30]);
    assert.deepEqual([l2.forma, l2.cajas], ['caja', 1]);
    assert.equal(v.body.item.total, 450);
    const malo = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(2), items: [{ medicamentoId: jar.id, forma: 'unidad', cantidad: 2 }] }, td);
    assert.equal(malo.status, 422, 'el jarabe no se vende por unidad');
    // Sin medicamentos: se acepta para la dependiente; no se aprueba hasta completarlo
    const sola = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(3) }, td);
    assert.equal(sola.status, 201, JSON.stringify(sola.body)); assert.equal(sola.body.item.total, 0);
    assert.equal((await call('POST', `/api/vouchers/${sola.body.item.id}/aprobar`, {}, tg)).status, 409);
    assert.equal((await call('POST', `/api/vouchers/${sola.body.item.id}/completar`, { items: [{ medicamentoId: jar.id, cantidad: 2, precio: 250 }] }, td)).status, 403);
    const comp = await call('POST', `/api/vouchers/${sola.body.item.id}/completar`, { items: [{ medicamentoId: jar.id, cantidad: 2, precio: 250 }] }, tg);
    assert.equal(comp.status, 200, JSON.stringify(comp.body)); assert.equal(comp.body.item.total, 500);
    assert.equal((await call('POST', `/api/vouchers/${sola.body.item.id}/aprobar`, {}, tg)).status, 200);
  } finally { server.close(); }
});

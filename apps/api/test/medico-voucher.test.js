import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { hashPassword } from '../src/security.js';

test('voucher con médico: la dependiente lo agrega una vez y después solo lo elige', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const f = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo', provincia: 'Espaillat', municipio: 'Moca', estado: 'activa' });
    await store.createUser({ fullName: 'Dep Ejemplo', email: 'd@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'dependiente', farmaciaId: f.id });
    const t = (await call('POST', '/api/auth/login', { email: 'd@x.do', password: 'clave123456' })).body.token;
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 100, activo: true });
    const r1 = await call('POST', '/api/catalogo/medicos', { nombre: 'Ana', apellido: 'Ejemplo', especialidad: 'Pediatría' }, t);
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.item.nombre, r1.body.item.provincia, r1.body.item.municipio], ['Ana Ejemplo', 'Espaillat', 'Moca'], 'toma la zona de su farmacia');
    const r2 = await call('POST', '/api/catalogo/medicos', { nombre: 'ana', apellido: 'ejemplo', especialidad: 'Pediatría' }, t);
    assert.equal(r2.body.item.id, r1.body.item.id, 'no se duplica');
    const jpg = (n) => ({ tipo: 'image/jpeg', nombre: `v-${n}.jpg`, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64') }); const foto = jpg(1);
    const v = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto, items: [{ medicamentoId: med.id, cantidad: 1, precio: 100 }], medicoId: r1.body.item.id }, t);
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.equal(v.body.item.medico, 'Ana Ejemplo, Pediatría');
    const mal = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(2), items: [{ medicamentoId: med.id, cantidad: 1, precio: 100 }], medicoId: 'no-existe' }, t);
    assert.equal(mal.status, 422);
    // Revisión en lote: rechazar pide motivo; aprobar todos aplica las mismas reglas que uno solo
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    const tg = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'clave123456' })).body.token;
    const v2 = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(3), items: [{ medicamentoId: med.id, cantidad: 2, precio: 100 }] }, t);
    const pend = (await call('GET', '/api/vouchers?estado=pendiente', null, tg)).body.items;
    assert.equal(pend.length, 2); assert.equal(pend[0].municipio, 'Moca', 'trae la zona de la farmacia');
    assert.equal((await call('POST', '/api/vouchers/decidir', { ids: pend.map((x) => x.id), aprobar: false }, tg)).status, 422);
    assert.equal((await call('POST', '/api/vouchers/decidir', { ids: pend.map((x) => x.id), aprobar: true }, t)).status, 403);
    const lote = (await call('POST', '/api/vouchers/decidir', { ids: [...pend.map((x) => x.id), v2.body.item.id], aprobar: true }, tg)).body;
    assert.deepEqual([lote.hechos, lote.errores.length], [2, 0]);
    const otra = (await call('POST', '/api/vouchers/decidir', { ids: [v2.body.item.id], aprobar: true }, tg)).body;
    assert.equal(otra.errores[0].error, 'Este voucher ya fue revisado.');
  } finally { server.close(); }
});

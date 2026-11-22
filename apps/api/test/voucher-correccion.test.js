import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { hashPassword } from '../src/security.js';

test('voucher rechazado para corregir: la dependiente lo corrige en el mes; si no, se elimina al cambiar de mes', async () => {
  const store = new MemoryStore(); const data = new MemoryData(); const files = new MemoryFiles();
  let ahora = new Date('2026-11-20T15:00:00Z');
  const app = createApp({ store, data, files, sessionSecret: 'x'.repeat(40), now: () => ahora });
  const server = createServer(app).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const f = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo', provincia: 'Espaillat', municipio: 'Moca', estado: 'activa' });
    await store.createUser({ fullName: 'Dep Ejemplo', email: 'd@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'dependiente', farmaciaId: f.id });
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    const td = (await call('POST', '/api/auth/login', { email: 'd@x.do', password: 'clave123456' })).body.token;
    const tg = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'clave123456' })).body.token;
    const a = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 100, activo: true });
    const b = await data.insert('medicamentos', { nombre: 'Tableta Ejemplo', precio: 80, activo: true });
    const jpg = (n) => ({ tipo: 'image/jpeg', nombre: `v-${n}.jpg`, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64') });
    const v1 = (await call('POST', '/api/vouchers', { fecha: '2026-10-30', foto: jpg(1), items: [{ medicamentoId: a.id, cantidad: 1, precio: 100 }] }, td)).body.item;
    const v2 = (await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(2), items: [{ medicamentoId: a.id, cantidad: 1, precio: 100 }] }, td)).body.item;
    const v3 = (await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: jpg(3), items: [{ medicamentoId: a.id, cantidad: 1, precio: 100 }] }, td)).body.item;
    // Rechazo con opción de corregir; aprobar con nota
    const r1 = await call('POST', `/api/vouchers/${v1.id}/rechazar`, { motivo: 'La fecha no pertenece al mes', corregible: true }, tg);
    assert.equal(r1.body.item.corregible, true);
    await call('POST', `/api/vouchers/${v2.id}/rechazar`, { motivo: 'El medicamento no coincide con la prescripción', corregible: true }, tg);
    const ap = await call('POST', `/api/vouchers/${v3.id}/aprobar`, { motivo: 'Todo coincide' }, tg);
    assert.equal(ap.body.item.nota, 'Todo coincide');
    // Corregir: solo quien lo cargó; vuelve a pendiente con lo nuevo
    assert.equal((await call('POST', `/api/vouchers/${v1.id}/corregir`, { fecha: '2026-11-02', items: [{ medicamentoId: a.id, cantidad: 1, precio: 100 }] }, tg)).status, 403);
    const c1 = await call('POST', `/api/vouchers/${v1.id}/corregir`, { fecha: '2026-11-02', items: [{ medicamentoId: b.id, cantidad: 2, precio: 80 }] }, td);
    assert.equal(c1.status, 200, JSON.stringify(c1.body));
    assert.deepEqual([c1.body.item.estado, c1.body.item.fecha, c1.body.item.total, c1.body.item.correcciones, c1.body.item.corregible], ['pendiente', '2026-11-02', 160, 1, false]);
    assert.equal((await call('POST', `/api/vouchers/${v1.id}/corregir`, { fecha: '2026-11-02', items: [{ medicamentoId: b.id, cantidad: 2, precio: 80 }] }, td)).status, 409, 'ya no está rechazado');
    // Cambia el mes: el rechazado sin corregir se elimina con su foto; aprobados y pendientes se quedan
    ahora = new Date('2026-12-01T12:00:00Z');
    assert.equal((await call('POST', `/api/vouchers/${v2.id}/corregir`, { fecha: '2026-11-19', items: [{ medicamentoId: b.id, cantidad: 1, precio: 80 }] }, td)).status, 409, 'terminó el plazo');
    const r = await app.comercial.vouchers.limpiarRechazados();
    assert.equal(r.eliminados, 1);
    assert.equal(await data.get('vouchers', v2.id), null);
    assert.equal(await files.get(v2.foto.clave), null, 'la foto también se borra');
    assert.ok(await data.get('vouchers', v1.id)); assert.ok(await data.get('vouchers', v3.id));
  } finally { server.close(); }
});

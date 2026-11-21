import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

test('registro: la dependiente siempre queda ligada a farmacia, provincia y municipio', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const reg = async (b) => { const r = await fetch(`${url}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'dependiente', fullName: 'Dependiente Ejemplo', password: 'clave123456', acceptsPrivacy: true, ...b }) }); return { status: r.status, body: await r.json() }; };
  try {
    const sinMun = await reg({ email: 'a@x.do', pharmacy: 'Farmacia Nueva Ejemplo', province: 'Espaillat' });
    assert.equal(sinMun.status, 422); assert.ok(sinMun.body.fields.municipio);
    const ok = await reg({ email: 'b@x.do', pharmacy: 'Farmacia Nueva Ejemplo', province: 'Espaillat', municipio: 'Moca' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.user.status, 'pendiente_aprobacion');
    const f = (await data.list('farmacias'))[0];
    assert.deepEqual([f.nombre, f.provincia, f.municipio, f.estado], ['Farmacia Nueva Ejemplo', 'Espaillat', 'Moca', 'pendiente']);
    assert.equal(ok.body.user.farmaciaId, f.id);
    await reg({ email: 'c@x.do', pharmacy: 'farmacia nueva ejemplo', province: 'Espaillat', municipio: 'Moca' });
    assert.equal((await data.list('farmacias')).length, 1, 'la misma farmacia no se duplica');
  } finally { server.close(); }
});

test('equipos por zona y tareas sugeridas', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-15T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const far = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', estado: 'validada', fuente: 'manual' });
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, ven: { role: 'representante', position: 'Vendedor' }, vis: { role: 'representante', position: 'Visitador' }, pro: { role: 'representante', position: 'Promotora' }, ven2: { role: 'representante', position: 'Vendedor' }, dep: { role: 'dependiente', farmaciaId: far.id }, dep2: { role: 'dependiente' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await data.insert('zonas', { representanteId: ids.ven, provincias: ['Espaillat'], municipios: {} });
    await data.insert('zonas', { representanteId: ids.vis, provincias: ['Espaillat', 'Santiago'], municipios: {} });
    await data.insert('zonas', { representanteId: ids.pro, provincias: ['Espaillat'], municipios: { Espaillat: ['Moca'] } });
    await data.insert('zonas', { representanteId: ids.ven2, provincias: ['La Vega'], municipios: {} });
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 200, activo: true });
    // Mes anterior: la farmacia vendía; este mes, recetas sin venta
    await data.insert('vouchers', { dependienteId: ids.dep, fecha: '2026-10-10', periodo: '2026-10', items: [{ medicamentoId: med.id, medicamento: 'Jarabe Ejemplo', cantidad: 40, monto: 12000 }], total: 12000, estado: 'aprobado' });
    await data.insert('vouchers', { dependienteId: ids.dep, fecha: '2026-11-10', periodo: '2026-11', items: [{ medicamentoId: med.id, medicamento: 'Jarabe Ejemplo', cantidad: 2, monto: 600 }], total: 600, estado: 'pendiente' });
    await data.insert('recetas', { promotoraId: ids.pro, medicoId: 'm1', fecha: '2026-11-08', provincia: 'Espaillat', municipio: 'Moca', items: [{ medicamentoId: med.id, unidades: 30 }], pacienteId: 'p1' });
    await call('POST', '/api/metas/equipo/global', { monto: 50000 }, tok.ger);
    await call('POST', `/api/metas/equipo/${ids.ven}`, { monto: 20000 }, tok.ger);
    assert.equal((await call('POST', `/api/metas/equipo/${ids.ven}`, { monto: 1 }, tok.ven)).status, 403);

    const eq = (await call('GET', '/api/metas/equipos?mes=2026-11', null, tok.ger)).body;
    const e1 = eq.equipos.find((e) => e.vendedor.id === ids.ven);
    assert.deepEqual(e1.integrantes.map((i) => i.posicion).sort(), ['Promotora', 'Vendedor', 'Visitador']);
    assert.deepEqual([e1.ventas.vouchers, e1.recetado, e1.meta, e1.porcentaje, e1.metaFuente], [600, 6000, 20000, 3, 'equipo']);
    const e2 = eq.equipos.find((e) => e.vendedor.id === ids.ven2);
    assert.deepEqual([e2.meta, e2.metaFuente], [50000, 'global']); assert.deepEqual(e2.faltan, ['Visitador', 'Promotora']);
    const mio = (await call('GET', '/api/metas/equipos?mes=2026-11', null, tok.pro)).body;
    assert.equal(mio.equipos.length, 1, 'la promotora ve su equipo');

    assert.equal((await call('GET', '/api/tareas?mes=2026-11', null, tok.ven)).status, 403);
    const t = (await call('GET', '/api/tareas?mes=2026-11', null, tok.ger)).body.tareas;
    const tipos = t.map((x) => x.tipo);
    for (const k of ['recetado_sin_venta', 'equipo_atrasado', 'equipo_incompleto', 'dependientes_sin_farmacia', 'vouchers_pendientes']) assert.ok(tipos.includes(k), `falta ${k}: ${tipos}`);
    const sinVenta = t.find((x) => x.tipo === 'recetado_sin_venta');
    assert.match(sinVenta.titulo, /Jarabe Ejemplo.*Moca/); assert.match(sinVenta.quien, /ven Ejemplo/);
    assert.ok(PRIO(t), 'ordenadas por prioridad');
  } finally { server.close(); }
});
const PRIO = (t) => t.every((x, i) => i === 0 || ({ alta: 0, media: 1, baja: 2 })[t[i - 1].prioridad] <= ({ alta: 0, media: 1, baja: 2 })[x.prioridad]);

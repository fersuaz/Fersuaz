import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { valoresDelMes, metaEfectiva } from '../src/metas.js';

test('valores del mes: solo visitas hechas; recetas, promedio, volumen y pacientes', () => {
  const jornadas = [
    { estado: 'realizada', paradas: [{ refTipo: 'farmacia', hecha: true }, { refTipo: 'farmacia', hecha: false }, { refTipo: 'establecimiento', hecha: true }] },
    { estado: 'cancelada', paradas: [{ refTipo: 'farmacia', hecha: true }] },
  ];
  const recetas = [{ pacienteId: 'p1', items: [{ medicamentoId: 'm1', unidades: 2 }, { medicamentoId: 'm2', unidades: 1 }] }, { pacienteId: 'p1', items: [{ medicamentoId: 'm1', unidades: 1 }] }];
  const v = valoresDelMes({ jornadas, recetas, precios: new Map([['m1', 250], ['m2', 99.5]]) });
  assert.deepEqual(v, { visitasFarmacias: 1, visitasCentros: 1, recetas: 2, medicamentosPorReceta: 1.5, volumen: 849.5, pacientes: 1 });
  const cfg = { porPosicion: { Visitador: { visitasFarmacias: 60, visitasCentros: 20 } }, porRep: { r1: { visitasCentros: 30 } } };
  assert.deepEqual(metaEfectiva(cfg, { id: 'r1', position: 'Visitador' }), { visitasFarmacias: { meta: 60, fuente: 'posicion' }, visitasCentros: { meta: 30, fuente: 'representante' } });
  assert.deepEqual(metaEfectiva(cfg, { id: 'r2', position: 'Vendedor' }), { visitasFarmacias: { meta: null, fuente: null } });
});

test('metas: la gerencia fija por posición y por representante; las visitas cuentan al marcarlas', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, vis: { role: 'representante', position: 'Visitador' }, vis2: { role: 'representante', position: 'Visitador' }, pro: { role: 'representante', position: 'Promotora' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    assert.equal((await call('POST', '/api/metas/posicion', { posicion: 'Visitador', valores: { visitasFarmacias: 60 } }, tok.vis)).status, 403);
    assert.equal((await call('POST', '/api/metas/posicion', { posicion: 'Visitador', valores: { visitasFarmacias: 6.5 } }, tok.ger)).status, 422, 'visitas enteras');
    await call('POST', '/api/metas/posicion', { posicion: 'Visitador', valores: { visitasFarmacias: 60, visitasCentros: 20 } }, tok.ger);
    await call('POST', '/api/metas/posicion', { posicion: 'Promotora', valores: { recetas: 100, medicamentosPorReceta: 2.5, volumen: '150,000', pacientes: 80 } }, tok.ger);
    await call('POST', `/api/metas/representante/${ids.vis2}`, { valores: { visitasCentros: 30 } }, tok.ger);
    const cfg = (await call('GET', '/api/metas', null, tok.ger)).body.item;
    assert.equal(cfg.porPosicion.Promotora.volumen, 150000); assert.deepEqual(cfg.porRep[ids.vis2], { visitasCentros: 30 });

    // Jornada del visitador con 3 lugares: marca 2 como hechos
    const j = await data.insert('jornadas', { representanteId: ids.vis, fecha: '2026-11-18', paradas: [{ refTipo: 'farmacia', refId: 'f1', lugar: 'Farmacia Ejemplo' }, { refTipo: 'farmacia', refId: 'f2', lugar: 'Farmacia Ejemplo 2' }, { refTipo: 'establecimiento', refId: 'e1', lugar: 'Hospital Ejemplo' }], kmEstimados: 10, kmFuente: 'manual', conAlimentacion: true, peajes: 0, estacionamiento: 0, otros: 0, estado: 'planificada' });
    const fut = await data.insert('jornadas', { representanteId: ids.vis, fecha: '2026-11-25', paradas: [{ refTipo: 'farmacia', refId: 'f3', lugar: 'X' }], kmEstimados: 10, kmFuente: 'manual', conAlimentacion: true, peajes: 0, estacionamiento: 0, otros: 0, estado: 'planificada' });
    assert.equal((await call('POST', `/api/viaticos/jornadas/${j.id}/visita`, { hechas: [0] }, tok.ger)).status, 403, 'solo el representante');
    assert.equal((await call('POST', `/api/viaticos/jornadas/${fut.id}/visita`, { hechas: [0] }, tok.vis)).status, 409, 'no en el futuro');
    assert.equal((await call('POST', `/api/viaticos/jornadas/${j.id}/visita`, { hechas: [7] }, tok.vis)).status, 422);
    const mk = await call('POST', `/api/viaticos/jornadas/${j.id}/visita`, { hechas: [0, 2] }, tok.vis);
    assert.deepEqual(mk.body.item.paradas.map((p) => p.hecha), [true, false, true]);

    // Recetas de la promotora
    await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 200, activo: true });
    const med = (await data.list('medicamentos'))[0];
    for (const [pac, n] of [['p1', 2], ['p2', 1]]) await data.insert('recetas', { promotoraId: ids.pro, medicoId: 'm', fecha: '2026-11-10', provincia: 'Espaillat', municipio: 'Moca', items: Array.from({ length: n }, () => ({ medicamentoId: med.id, unidades: 5 })), pacienteId: pac });

    const av = (await call('GET', '/api/metas/avance?mes=2026-11', null, tok.ger)).body;
    assert.equal(av.items.length, 3);
    const vis = av.items.find((x) => x.representante.id === ids.vis);
    assert.deepEqual(vis.metricas.map((m) => [m.clave, m.valor, m.meta, m.porcentaje]), [['visitasFarmacias', 1, 60, 2], ['visitasCentros', 1, 20, 5]]);
    assert.equal(av.items.find((x) => x.representante.id === ids.vis2).metricas[1].fuente, 'representante');
    const pro = av.items.find((x) => x.representante.id === ids.pro);
    assert.deepEqual(pro.metricas.map((m) => m.valor), [2, 1.5, 3000, 2]);
    const mio = (await call('GET', '/api/metas/avance?mes=2026-11', null, tok.vis)).body;
    assert.equal(mio.items.length, 1, 'el representante ve solo lo suyo'); assert.equal(mio.dias.transcurridos, 20);
    await call('POST', `/api/metas/representante/${ids.vis2}`, { quitar: true }, tok.ger);
    assert.equal((await call('GET', '/api/metas', null, tok.ger)).body.item.porRep[ids.vis2], undefined);
  } finally { server.close(); }
});

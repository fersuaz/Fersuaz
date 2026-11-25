import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { proponerConMedicos } from '../src/propuesta-cronograma.js';
import { valoresDelMes, lugaresCubiertos } from '../src/metas.js';

const centro = (id, n, lat, lng) => ({ refTipo: 'establecimiento', refId: id, lugar: `Centro ${id}`, provincia: 'Santiago', municipio: 'Tamboril', lat, lng, medicos: Array.from({ length: n }, (_, i) => ({ medicoId: `${id}-m${i}`, nombre: `Dr. ${id}${i} (Ejemplo)` })) });

test('propuesta con médicos: 10 por día en un solo centro, empieza por el centro elegido y sigue por cercanía', () => {
  const fechas = ['2026-11-23', '2026-11-24', '2026-11-25'];
  const r = proponerConMedicos({ centros: [centro('A', 3, 19.40, -70.60), centro('B', 10, 19.50, -70.70), centro('C', 4, 19.41, -70.61)], fechas, medicosPorDia: 10, centroInicioId: 'B' });
  assert.deepEqual(r.dias[0].lugares.map((l) => [l.refId, l.medicos.length]), [['B', 10]], 'día 1: los 10 médicos del centro B');
  assert.deepEqual(r.dias[1].lugares.map((l) => [l.refId, l.medicos.length]), [['C', 4], ['A', 3]], 'día 2: el más cercano a B primero');
  assert.equal(r.dias.length, 2); assert.deepEqual(r.sinDia, []);
  // PVC: médicos y farmacias el mismo día
  const f = [{ refTipo: 'farmacia', refId: 'F1', lugar: 'Farmacia 1', provincia: 'Santiago', municipio: 'Tamboril' }, { refTipo: 'farmacia', refId: 'F2', lugar: 'Farmacia 2', provincia: 'Santiago', municipio: 'Tamboril' }];
  const p = proponerConMedicos({ centros: [centro('A', 3, 19.4, -70.6)], farmacias: f, fechas: ['2026-11-23'], medicosPorDia: 2, farmaciasPorDia: 1 });
  assert.deepEqual(p.dias[0].lugares.map((l) => [l.refTipo, l.medicos?.length ?? 0]), [['establecimiento', 2], ['farmacia', 0]]);
  assert.deepEqual(p.sinDia.map((x) => [x.refId, x.medicos?.length ?? 0]), [['A', 1], ['F2', 0]], 'lo que no cupo queda pendiente');
});

test('meta: cada médico visitado es una visita y cuenta los médicos que recibieron sus visitas', () => {
  const jornadas = [{ estado: 'realizada', paradas: [{ refTipo: 'establecimiento', refId: 'A', hecha: true, medicos: [{ medicoId: 'm1' }, { medicoId: 'm2' }] }, { refTipo: 'farmacia', refId: 'F', hecha: true }] },
    { estado: 'realizada', paradas: [{ refTipo: 'establecimiento', refId: 'A', hecha: true, medicos: [{ medicoId: 'm1' }] }, { refTipo: 'establecimiento', refId: 'B', hecha: false, medicos: [{ medicoId: 'm3' }] }] }];
  assert.equal(valoresDelMes({ jornadas }).visitasMedicos, 3);
  const paradas = jornadas.flatMap((j) => j.paradas);
  assert.equal(lugaresCubiertos(paradas, 'medico', 2), 1, 'solo m1 recibió 2 visitas');
});

test('cartera: solo visitador y PVC; médicos de centros de su ruta; propuesta y lote guardan los médicos', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ adm: { role: 'administrador' }, ger: { role: 'gerencia' }, vis: { role: 'representante', position: 'Visitador' }, ven: { role: 'representante', position: 'Vendedor' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await call('POST', `/api/territorio/zonas/${ids.vis}`, { provincias: ['Espaillat'] }, tok.ger);
    await call('POST', `/api/territorio/zonas/${ids.ven}`, { provincias: ['Espaillat'] }, tok.ger);
    const h = await data.insert('establecimientos', { tipo: 'hospital', nombre: 'Hospital Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });
    const fuera = await data.insert('establecimientos', { tipo: 'clinica', nombre: 'Clínica Ejemplo Santiago', provincia: 'Santiago', municipio: 'Tamboril', estado: 'validado', fuente: 'manual' });
    const meds = [];
    for (let i = 0; i < 3; i++) meds.push(await data.insert('medicos', { nombre: `Dra. Ejemplo ${i}`, especialidad: i ? 'Pediatría' : 'Cardiología', provincia: 'Espaillat', municipio: 'Moca', establecimientoId: h.id, estado: 'validado' }));
    const otro = await data.insert('medicos', { nombre: 'Dr. Fuera (Ejemplo)', especialidad: 'Pediatría', provincia: 'Santiago', municipio: 'Tamboril', establecimientoId: fuera.id, estado: 'validado' });

    const v = (await call('GET', `/api/territorio/zonas/${ids.vis}/cartera`, null, tok.ger)).body.item;
    assert.equal(v.aplica, true); assert.equal(v.disponibles.length, 3, 'solo los médicos de centros de su ruta');
    assert.equal((await call('POST', `/api/territorio/zonas/${ids.ven}/cartera`, { medicos: [] }, tok.ger)).status, 409, 'el vendedor visita farmacias');
    assert.equal((await call('POST', `/api/territorio/zonas/${ids.vis}/cartera`, { medicos: [{ medicoId: otro.id, establecimientoId: fuera.id }] }, tok.ger)).status, 422);
    assert.equal((await call('POST', `/api/territorio/zonas/${ids.vis}/cartera`, { medicos: [] }, tok.vis)).status, 403);
    const g = await call('POST', `/api/territorio/zonas/${ids.vis}/cartera`, { medicos: meds.map((m) => ({ medicoId: m.id, establecimientoId: h.id })), centroInicioId: h.id, visitas: { medicos: 2 } }, tok.ger);
    assert.equal(g.status, 200); assert.equal(g.body.item.medicos.length, 3); assert.equal(g.body.item.visitas.medicos, 2);

    const pr = (await call('POST', '/api/cronogramas/propuesta', { representanteId: ids.vis, mes: '2026-11' }, tok.adm)).body.item;
    assert.equal(pr.modo, 'medicos'); assert.equal(pr.porDia, 2);
    assert.deepEqual(pr.dias.map((d) => d.lugares.map((l) => l.medicos.length)), [[2], [1]], '3 médicos a 2 por día');
    const lote = await call('POST', '/api/cronogramas/lote', { representanteId: ids.vis, dias: pr.dias.map((d) => ({ fecha: d.fecha, lugares: d.lugares.map((l) => ({ refTipo: l.refTipo, refId: l.refId, medicos: l.medicos.map((m) => ({ medicoId: m.medicoId })) })) })) }, tok.adm);
    assert.equal(lote.status, 201, JSON.stringify(lote.body));
    assert.ok(lote.body.items[0].lugares[0].medicos.every((m) => m.especialidad), 'nombre y especialidad salen de la base');
    assert.equal(lote.body.items[0].lugares[0].medicos.length, 2);
    // Ya programados: la siguiente propuesta no repite esos médicos
    const pr2 = (await call('POST', '/api/cronogramas/propuesta', { representanteId: ids.vis, mes: '2026-11' }, tok.adm)).body.item;
    assert.equal(pr2.dias.length, 0);
  } finally { server.close(); }
});

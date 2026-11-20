import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore, PostgresStore } from '../src/store.js';
import { MemoryData, PgData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = () => new Date('2026-11-20T16:00:00Z'); // hoy: 20-11-2026
const PG = process.env.TEST_DATABASE_URL;
let pg;
test.after(async () => { if (pg) await pg.pool.end(); });

async function setup() {
  let store, data;
  if (PG) {
    pg ??= await PostgresStore.connect(PG);
    await pg.pool.query('TRUNCATE hoteles, notificaciones, cronogramas, zonas_representante, establecimientos, presupuestos_viatico, jornadas, precios_combustible, perfiles_viatico, configuracion, inventario, recetas, operativos, cierres_comision, vouchers, medicos, farmacias, medicamentos, audit_logs, users CASCADE');
    store = pg; data = new PgData(pg.pool);
  } else { store = new MemoryStore(); data = new MemoryData(); }
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, now: NOW })).listen(0);
  setup.data = data;
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const t = {}; const id = {};
  for (const [k, props] of Object.entries({
    admin: { role: 'administrador' }, gerente: { role: 'gerencia' }, finanzas: { role: 'finanzas' }, supervisor: { role: 'supervisor' },
    rep: { role: 'representante', position: 'Visitador' }, rep2: { role: 'representante', position: 'Vendedor' }, dep: { role: 'dependiente' },
  })) {
    const pw = `clave${k}12345`;
    const u = await store.createUser({ fullName: k, email: `${k}@x.do`, phone: null, position: null, status: 'activo', passwordHash: await hashPassword(pw), ...props });
    id[k] = u.id;
    t[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: pw })).body.token;
  }
  // Ejemplo: un hospital en Moca y las provincias de cada representante, para programar cronogramas.
  const est = await data.insert('establecimientos', { tipo: 'hospital', nombre: 'Hospital Regional (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });
  for (const r of ['rep', 'rep2']) await call('POST', `/api/territorio/zonas/${id[r]}`, { provincias: ['Espaillat'] }, t.gerente);
  /** El administrador programa el día y el representante crea su jornada desde ese cronograma. */
  const planificar = async (body, token) => {
    const quien = Object.keys(t).find((k) => t[k] === token);
    let cid = null;
    if (id[quien] && body.fecha) {
      const c = await call('POST', '/api/cronogramas', { representanteId: id[quien], fechas: [body.fecha], lugares: [{ refTipo: 'establecimiento', refId: est.id }] }, t.admin);
      cid = c.body.items?.[0]?.id ?? (await call('GET', `/api/cronogramas?representanteId=${id[quien]}`, null, t.admin)).body.items.find((x) => x.fecha === body.fecha)?.id;
    }
    const { fecha, paradas, ...resto } = body;
    return call('POST', '/api/viaticos/jornadas', { ...resto, cronogramaId: cid }, token);
  };
  return { server, call, t, id, planificar, est };
}

const PERFIL = {
  residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega', direccion: 'Calle Privada 12' },
  vehiculo: { propiedad: 'asignado', marca: 'Toyota', modelo: 'Hilux', anio: 2022, combustible: 'gasoil_regular', rendimiento: 35 },
  tarifaAlimentacion: 500,
};
const jornada = (fecha, km, extra = {}) => ({ fecha, kmEstimados: km, paradas: [{ lugar: 'Hospital Regional', municipio: 'Moca', provincia: 'Espaillat' }], ...extra });

test('perfil: solo gestión lo configura; la dirección exacta es restringida', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    assert.equal((await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.rep)).status, 403);
    assert.equal((await call('POST', `/api/viaticos/perfiles/${id.dep}`, PERFIL, t.gerente)).status, 404);
    const malo = await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, vehiculo: { ...PERFIL.vehiculo, rendimiento: 0 } }, t.gerente);
    assert.ok(malo.body.fields['vehiculo.rendimiento']);
    const reemb = await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, reembolsoPorKm: 12 }, t.gerente);
    assert.ok(reemb.body.fields.reembolsoPorKm); // asignado no lleva reembolso por km
    assert.equal((await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.supervisor)).status, 200);
    assert.equal((await call('GET', `/api/viaticos/perfiles/${id.rep}`, null, t.rep)).body.item.residencia.direccion, 'Calle Privada 12');
    assert.equal((await call('GET', `/api/viaticos/perfiles/${id.rep}`, null, t.finanzas)).body.item.residencia.direccion, undefined);
    assert.equal((await call('GET', `/api/viaticos/perfiles/${id.rep}`, null, t.rep2)).status, 403);
  } finally { server.close(); }
});

test('prompt maestro §13: 2,100 km, 35 km/gal, RD$250 → RD$15,000; comida 21 × RD$500; hotel 3 × RD$2,500; total RD$36,000', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    // presupuesto sin precio vigente: se dice qué falta
    for (let d = 1; d <= 21; d++) {
      const fecha = `2026-12-${String(d).padStart(2, '0')}`;
      const extra = d === 1 ? { peajes: 2000, otros: 1000, hospedaje: { noches: 3, tarifaNoche: 2500, motivo: 'Operativo en Puerto Plata' } } : {};
      const r = await planificar(jornada(fecha, 100, extra), t.rep);
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    let p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-12', null, t.rep)).body;
    assert.ok(p.calculo.faltan.some((f) => f.includes('precio')));
    assert.ok(p.calculo.faltan.some((f) => f.includes('hospedaje')));
    assert.equal((await call('POST', '/api/viaticos/presupuesto/solicitar', { mes: '2026-12' }, t.rep)).status, 409);

    assert.equal((await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-11-28' }, t.rep)).status, 403);
    assert.equal((await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-11-28' }, t.finanzas)).status, 201);
    const j1 = (await call('GET', '/api/viaticos/jornadas?mes=2026-12', null, t.rep)).body.items[0];
    assert.equal((await call('POST', `/api/viaticos/jornadas/${j1.id}/hospedaje`, { aprobar: true }, t.supervisor)).status, 403);
    assert.equal((await call('POST', `/api/viaticos/jornadas/${j1.id}/hospedaje`, { aprobar: true }, t.gerente)).status, 200);

    p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-12', null, t.rep)).body;
    assert.deepEqual(p.calculo.faltan, []);
    assert.equal(p.calculo.detalle.combustible, 15000);
    assert.equal(p.calculo.detalle.alimentacion, 10500);
    assert.equal(p.calculo.detalle.hospedaje, 7500);
    assert.equal(p.calculo.total, 36000);
    assert.equal(p.calculo.supuestos.galones, 60);
    assert.equal(p.calculo.supuestos.kmTipo, 'estimado manual');
  } finally { server.close(); }
});

test('el precio aplicado es el vigente en la fecha de cada jornada', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-11-01' }, t.finanzas);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 280, vigenteDesde: '2026-11-15' }, t.finanzas);
    assert.equal((await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 290, vigenteDesde: '2026-11-15' }, t.finanzas)).status, 409);
    await planificar(jornada('2026-11-10', 70), t.rep); // 2 gal × 250 = 500
    await planificar(jornada('2026-11-16', 70), t.rep); // 2 gal × 280 = 560
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.equal(p.detalle.combustible, 1060);
    assert.equal(p.detalle.alimentacion, 1000);
  } finally { server.close(); }
});

test('jornadas: una por día, cancelada no cuenta, sin comida si no hay desplazamiento, km reales solo en el pasado', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-01-01' }, t.finanzas);
    assert.equal((await planificar(jornada('2026-11-10', 35), t.dep)).status, 403);
    const a = (await planificar(jornada('2026-11-10', 35), t.rep)).body.item;
    assert.equal((await planificar(jornada('2026-11-10', 35), t.rep)).status, 409);
    const b = (await planificar(jornada('2026-11-11', 35, { conAlimentacion: false }), t.rep)).body.item;
    const c = (await planificar(jornada('2026-11-25', 35), t.rep)).body.item;
    assert.equal((await call('POST', `/api/viaticos/jornadas/${c.id}/cancelar`, {}, t.rep)).status, 200);
    assert.equal((await call('POST', `/api/viaticos/jornadas/${a.id}/realizada`, { kmReales: 41 }, t.rep)).status, 200);
    assert.equal((await call('POST', `/api/viaticos/jornadas/${c.id}/realizada`, { kmReales: 41 }, t.rep)).status, 409);
    assert.equal((await call('POST', `/api/viaticos/jornadas/${b.id}/cancelar`, {}, t.rep2)).status, 403);
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.equal(p.supuestos.jornadas, 2); assert.equal(p.supuestos.diasAlimentacion, 1); assert.equal(p.detalle.alimentacion, 500);
    assert.equal(p.detalle.combustible, 500); // 70 km / 35 × 250
  } finally { server.close(); }
});

test('vehículo propio con reembolso por km: no se suma también el combustible', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, vehiculo: { ...PERFIL.vehiculo, propiedad: 'propio' }, reembolsoPorKm: 12 }, t.gerente);
    await planificar(jornada('2026-11-10', 100), t.rep);
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.deepEqual(p.faltan, []); // no necesita precio de combustible
    assert.equal(p.detalle.combustible, 1200); assert.equal(p.supuestos.reembolsoPorKm, 12);
  } finally { server.close(); }
});

test('eléctrico: no se calcula con galones; se dice que falta el método energético', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, vehiculo: { propiedad: 'asignado', combustible: 'electrico' } }, t.gerente);
    await planificar(jornada('2026-11-10', 100), t.rep);
    const p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.ok(p.faltan.some((f) => f.includes('eléctrico')));
  } finally { server.close(); }
});

test('flujo completo: solicitar, aprobar, desembolsar, comprobantes, liquidar; nada se borra', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-01-01' }, t.finanzas);
    await planificar(jornada('2026-11-10', 70, { peajes: 100 }), t.rep);
    await planificar(jornada('2026-11-12', 70), t.rep);
    // total: combustible 1,000 + comida 1,000 + peajes 100 = 2,100
    const sol = await call('POST', '/api/viaticos/presupuesto/solicitar', { mes: '2026-11' }, t.rep);
    assert.equal(sol.status, 200); assert.equal(sol.body.item.total, 2100);
    const pid = sol.body.item.id;
    assert.equal((await call('POST', '/api/viaticos/presupuesto/solicitar', { mes: '2026-11' }, t.rep)).status, 409);
    assert.equal((await planificar(jornada('2026-11-14', 10), t.rep)).status, 409); // mes bloqueado

    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/aprobar`, {}, t.finanzas)).status, 403);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/aprobar`, { montoAprobado: 3000 }, t.gerente)).status, 422);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/aprobar`, { montoAprobado: 2000 }, t.gerente)).body.item.montoAprobado, 2000);

    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/desembolsos`, { monto: 1500, referencia: 'TRF-1' }, t.gerente)).status, 403);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/desembolsos`, { monto: 2500, referencia: 'TRF-1' }, t.finanzas)).status, 422);
    await call('POST', `/api/viaticos/presupuestos/${pid}/desembolsos`, { monto: 1500, referencia: 'TRF-1' }, t.finanzas);
    let p = (await call('POST', `/api/viaticos/presupuestos/${pid}/desembolsos`, { monto: 500, referencia: 'TRF-2' }, t.finanzas)).body.item;
    assert.equal(p.resumen.entregado, 2000);

    const g = (body) => call('POST', `/api/viaticos/presupuestos/${pid}/gastos`, body, t.rep);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/gastos`, { categoria: 'combustible', monto: 900, fecha: '2026-11-10', referencia: 'NCF-1' }, t.rep2)).status, 403);
    assert.equal((await g({ categoria: 'combustible', monto: 900, fecha: '2026-10-30', referencia: 'NCF-1' })).status, 422); // fuera del mes
    await g({ categoria: 'combustible', monto: 900, fecha: '2026-11-10', referencia: 'NCF-1' });
    assert.equal((await g({ categoria: 'combustible', monto: 900, fecha: '2026-11-10', referencia: 'ncf-1' })).status, 409); // duplicado
    const pdf = Buffer.from('%PDF-1.4 comprobante').toString('base64');
    await g({ categoria: 'alimentacion', monto: 450, fecha: '2026-11-12', referencia: 'NCF-2', adjunto: { tipo: 'application/pdf', base64: pdf, nombre: 'factura.pdf' } });
    p = (await g({ categoria: 'peajes', monto: 100, fecha: '2026-11-10', referencia: 'TICKET-9' })).body.item;
    assert.equal(p.gastos.length, 3); assert.ok(p.gastos[1].adjunto.clave);

    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/liquidar`, {}, t.finanzas)).status, 409); // sin revisar
    const [g1, g2, g3] = p.gastos;
    await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g1.id}/aceptar`, {}, t.finanzas);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g2.id}/rechazar`, {}, t.finanzas)).status, 422);
    await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g2.id}/rechazar`, { motivo: 'Factura ilegible' }, t.finanzas);
    await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g3.id}/aceptar`, {}, t.finanzas);
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g3.id}/aceptar`, {}, t.finanzas)).status, 409);

    const liq = (await call('POST', `/api/viaticos/presupuestos/${pid}/liquidar`, {}, t.finanzas)).body.item;
    assert.equal(liq.estado, 'liquidado');
    assert.equal(liq.liquidacion.justificado, 1000); assert.equal(liq.liquidacion.saldo, 1000);
    assert.equal(liq.liquidacion.resultado, 'el representante devuelve');
    assert.equal(liq.gastos.length, 3); // el rechazado sigue registrado
    assert.equal((await call('POST', `/api/viaticos/presupuestos/${pid}/gastos/${g2.id}/aceptar`, {}, t.finanzas)).status, 409);

    const cons = (await call('GET', '/api/viaticos/consolidado?mes=2026-11', null, t.supervisor)).body;
    const fila = cons.filas.find((f) => f.representanteId === id.rep);
    assert.equal(fila.total, 2100); assert.equal(fila.entregado, 2000); assert.equal(fila.justificado, 1000);
    assert.equal(cons.filas.find((f) => f.representanteId === id.rep2).estado, 'sin_solicitud');
    assert.equal((await call('GET', '/api/viaticos/consolidado?mes=2026-11', null, t.rep)).status, 403);
  } finally { server.close(); }
});

test('tope mensual de combustible: global, por representante y con aviso', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-11-01' }, t.finanzas);
    await planificar(jornada('2026-11-23', 350), t.rep); await planificar(jornada('2026-11-24', 350), t.rep); // 700 km / 35 = 20 gal × 250 = 5,000
    let p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.equal(p.detalle.combustible, 5000); assert.equal(p.supuestos.tope, null); assert.deepEqual(p.avisos, []);
    assert.equal((await call('POST', '/api/viaticos/tope-global', { monto: 4000 }, t.rep)).status, 403);
    assert.equal((await call('POST', '/api/viaticos/tope-global', { monto: -5 }, t.gerente)).status, 422);
    assert.equal((await call('POST', '/api/viaticos/tope-global', { monto: 4000 }, t.gerente)).body.item.monto, 4000);
    p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.equal(p.detalle.combustible, 4000); assert.equal(p.supuestos.combustibleCalculado, 5000);
    assert.equal(p.supuestos.excedenteTope, 1000); assert.equal(p.supuestos.topeFuente, 'global'); assert.equal(p.avisos.length, 1);
    assert.equal(p.total, 4000 + 1000, 'comida 2 × 500 más el combustible topado');
    // El tope del representante manda sobre el global
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, topeCombustible: 6000 }, t.gerente);
    p = (await call('GET', '/api/viaticos/presupuesto?mes=2026-11', null, t.rep)).body.calculo;
    assert.equal(p.detalle.combustible, 5000); assert.equal(p.supuestos.topeFuente, 'representante'); assert.deepEqual(p.avisos, []);
    assert.ok((await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, topeCombustible: 0 }, t.gerente)).body.fields.topeCombustible);
  } finally { server.close(); }
});

test('hoteles: la administración confirma precio y requisitos; se recomienda el más económico que cumple todo', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    const { items: reqs } = (await call('GET', '/api/hoteles/requisitos', null, t.rep)).body;
    const todo = Object.fromEntries(reqs.map((r) => [r.value, true]));
    assert.equal((await call('POST', '/api/hoteles', { nombre: 'Hotel Ejemplo A', provincia: 'Espaillat', municipio: 'Moca' }, t.rep)).status, 403);
    const crear = async (nombre, precioNoche, requisitos) => {
      const h = (await call('POST', '/api/hoteles', { nombre, provincia: 'Espaillat', municipio: 'Moca' }, t.admin)).body.item;
      return (await call('POST', `/api/hoteles/${h.id}`, { precioNoche, requisitos }, t.admin)).body.item;
    };
    const a = await crear('Hotel Ejemplo A', 2000, todo);
    const b = await crear('Hotel Ejemplo B', 1500, { ...todo, parqueo: false });
    const c = await crear('Hotel Ejemplo C', 1800, todo);
    assert.equal(b.cumple, false); assert.deepEqual(b.faltan, ['parqueo']); assert.equal(a.cumple, true);
    assert.equal((await call('POST', '/api/hoteles', { nombre: 'hotel ejemplo a', provincia: 'Espaillat', municipio: 'Moca' }, t.admin)).status, 409);
    assert.equal((await call('POST', `/api/hoteles/${a.id}`, { precioNoche: 1 }, t.rep)).status, 403);
    const rec = (await call('GET', '/api/hoteles/recomendado?provincia=Espaillat&municipio=Moca', null, t.rep)).body.item;
    assert.equal(rec.hotel.id, c.id); assert.equal(rec.alcance, 'municipio');
    // En la jornada, el precio sale del hotel verificado y no del navegador
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    const j = await planificar(jornada('2026-11-25', 100, { hospedaje: { hotelId: c.id, noches: 1, tarifaNoche: 1, motivo: 'Ruta de dos días (Ejemplo)' } }), t.rep);
    assert.equal(j.status, 201, JSON.stringify(j.body));
    assert.equal(j.body.item.hospedaje.tarifaNoche, 1800); assert.equal(j.body.item.hospedaje.hotel, 'Hotel Ejemplo C'); assert.equal(j.body.item.hospedaje.hotelId, c.id);
    const mal = await planificar(jornada('2026-11-26', 100, { hospedaje: { hotelId: b.id, noches: 1, motivo: 'Ejemplo' } }), t.rep);
    assert.equal(mal.status, 422);
    const audit = (await call('GET', '/api/hoteles?provincia=Espaillat', null, t.admin)).body.items;
    assert.equal(audit.length, 3);
  } finally { server.close(); }
});

test('zona por municipio y posición: solo se programan lugares de los municipios asignados', async () => {
  const { server, call, t, id } = await setup();
  try {
    const data = setup.data;
    const gh = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Gaspar', provincia: 'Espaillat', municipio: 'Gaspar Hernández', estado: 'validada', fuente: 'manual' });
    const z = await call('POST', `/api/territorio/zonas/${id.rep}`, { provincias: ['Espaillat'], municipios: { Espaillat: ['Moca'] }, posicion: 'PVC' }, t.gerente);
    assert.equal(z.status, 200, JSON.stringify(z.body)); assert.deepEqual(z.body.item.municipios, { Espaillat: ['Moca'] }); assert.equal(z.body.item.posicion, 'PVC');
    assert.equal((await call('POST', `/api/territorio/zonas/${id.rep}`, { provincias: ['Espaillat'], municipios: { Espaillat: ['Bonao'] } }, t.gerente)).status, 422);
    assert.equal((await call('POST', `/api/territorio/zonas/${id.rep}`, { provincias: ['Espaillat'], posicion: 'Jefe' }, t.gerente)).status, 422);
    const c = await call('POST', '/api/cronogramas', { representanteId: id.rep, fechas: ['2026-11-23'], lugares: [{ refTipo: 'farmacia', refId: gh.id }] }, t.admin);
    assert.equal(c.status, 422); assert.match(c.body.fields.lugares, /Gaspar Hernández/);
    const l = (await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.rep)).body;
    assert.equal(l.establecimientos.length, 1); assert.equal(l.farmacias.length, 0); assert.equal(l.resumen[0].hospital, 1);
    assert.equal((await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.rep2)).status, 403);
    // Elegir todos los municipios equivale a la provincia completa
    const todos = await call('POST', `/api/territorio/zonas/${id.rep}`, { provincias: ['Espaillat'], municipios: { Espaillat: ['Moca', 'Cayetano Germosén', 'Gaspar Hernández', 'Jamao al Norte', 'San Víctor'] } }, t.gerente);
    assert.deepEqual(todos.body.item.municipios, {});
  } finally { server.close(); }
});

test('propuesta del mes: reparte los lugares de la zona en días libres y se aprueba todo junto', async () => {
  const { server, call, t, id } = await setup();
  try {
    const data = setup.data;
    for (let i = 1; i <= 5; i++) await data.insert('farmacias', { nombre: `Farmacia Ejemplo ${i}`, provincia: 'Espaillat', municipio: 'Moca', lat: 19.39 + i / 1000, lng: -70.52, estado: 'validada', fuente: 'google' });
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, { ...PERFIL, residencia: { provincia: 'Espaillat', municipio: 'Moca' } }, t.gerente);
    assert.equal((await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11', porDia: 2 }, t.gerente)).status, 403);
    assert.equal((await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-10', porDia: 2 }, t.admin)).status, 422);
    const p = (await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11', porDia: 2 }, t.admin)).body.item;
    assert.equal(p.resumen.lugares, 6); assert.equal(p.resumen.diasLibres, 7); assert.equal(p.dias.length, 3);
    assert.deepEqual(p.dias.map((d) => d.fecha), ['2026-11-20', '2026-11-23', '2026-11-24']);
    // Un día con un lugar de fuera de la zona hace fallar todo el lote: no se guarda nada
    const fuera = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Bonao', provincia: 'Monseñor Nouel', municipio: 'Bonao', estado: 'validada', fuente: 'manual' });
    const dias = p.dias.map((d) => ({ fecha: d.fecha, lugares: d.lugares.map(({ refTipo, refId }) => ({ refTipo, refId })) }));
    const malo = await call('POST', '/api/cronogramas/lote', { representanteId: id.rep, dias: [...dias, { fecha: '2026-11-25', lugares: [{ refTipo: 'farmacia', refId: fuera.id }] }] }, t.admin);
    assert.equal(malo.status, 422);
    assert.equal((await call('GET', `/api/cronogramas?representanteId=${id.rep}`, null, t.admin)).body.items.length, 0);
    const ok = await call('POST', '/api/cronogramas/lote', { representanteId: id.rep, dias }, t.admin);
    assert.equal(ok.status, 201); assert.equal(ok.body.items.length, 3);
    const n = (await call('GET', '/api/notificaciones', null, t.rep)).body.items;
    assert.ok(n.some((x) => /3 día/.test(x.texto)));
    const otra = (await call('POST', '/api/cronogramas/propuesta', { representanteId: id.rep, mes: '2026-11', porDia: 2 }, t.admin)).body.item;
    assert.equal(otra.resumen.lugares, 0, 'lo ya programado no se vuelve a proponer'); assert.equal(otra.resumen.diasLibres, 4);
  } finally { server.close(); }
});

test('panel de inicio: cada rol ve su resumen con cifras reales', async () => {
  const { server, call, t, id, planificar } = await setup();
  try {
    const data = setup.data;
    const f1 = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Central', provincia: 'Espaillat', municipio: 'Moca', sector: 'Juan López', estado: 'validada', fuente: 'manual' });
    await call('POST', `/api/viaticos/perfiles/${id.rep}`, PERFIL, t.gerente);
    await call('POST', '/api/viaticos/precios', { combustible: 'gasoil_regular', precioGalon: 250, vigenteDesde: '2026-11-01' }, t.finanzas);
    await planificar(jornada('2026-11-23', 350), t.rep);
    // Representante
    const r = (await call('GET', '/api/inicio?mes=2026-11', null, t.rep)).body;
    assert.equal(r.tipo, 'representante'); assert.deepEqual(r.zona.provincias, ['Espaillat']);
    assert.equal(r.lugares.total, 2, 'hospital y farmacia de su zona'); assert.equal(r.cronograma.dias, 1); assert.equal(r.cronograma.cobertura, 50);
    assert.equal(r.viaticos.detalle.combustible, 2500); assert.equal(r.jornadas.km, 350);
    assert.equal(r.cronograma.proximo.fecha, '2026-11-23');
    // Dependiente: sin farmacia ligada, la liga una vez; después solo la gestión la cambia
    let d = (await call('GET', '/api/inicio', null, t.dep)).body;
    assert.equal(d.tipo, 'dependiente'); assert.equal(d.farmacia, null);
    assert.equal((await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: 'no-existe' }, t.dep)).status, 422);
    assert.equal((await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: f1.id }, t.dep)).status, 200);
    d = (await call('GET', '/api/inicio', null, t.dep)).body;
    assert.deepEqual([d.farmacia.provincia, d.farmacia.municipio, d.farmacia.sector], ['Espaillat', 'Moca', 'Juan López']);
    assert.equal((await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: f1.id }, t.dep)).status, 403);
    assert.equal((await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: f1.id }, t.rep)).status, 403);
    assert.equal((await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: f1.id }, t.supervisor)).status, 200);
    assert.equal(d.vouchers.ventasPorMes.length, 6);
    // Gestión
    const g = (await call('GET', '/api/inicio?mes=2026-11', null, t.gerente)).body;
    assert.equal(g.tipo, 'gestion'); assert.equal(g.catalogo.farmacias, 1); assert.equal(g.catalogo.centros, 1);
    assert.equal(g.cronogramas.dias, 1); assert.equal(g.equipo.dependientesSinFarmacia, 0);
    assert.equal(g.cobertura.find((x) => x.id === id.rep).cobertura, 50);
    assert.equal(g.catalogo.provincias[0].nombre, 'Espaillat');
    assert.equal((await call('GET', '/api/usuarios/dependientes', null, t.rep)).status, 403);
    assert.equal((await call('GET', '/api/usuarios/dependientes', null, t.gerente)).body.items[0].farmacia.nombre, 'Farmacia Ejemplo Central');
  } finally { server.close(); }
});

test('no es un centro de salud: se descarta, sale de zona y propuesta, y se puede restaurar', async () => {
  const { server, call, t, id } = await setup();
  try {
    const data = setup.data;
    const malo = await data.insert('establecimientos', { tipo: 'clinica', nombre: '5 de mayo #258', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'google' });
    const rev = (await call('GET', '/api/territorio/establecimientos?ver=revisar', null, t.gerente)).body.items;
    assert.deepEqual(rev.map((x) => x.nombre), ['5 de mayo #258']);
    assert.equal((await call('POST', '/api/territorio/establecimientos/descartar', { ids: [malo.id] }, t.rep)).status, 403);
    assert.equal((await call('POST', '/api/territorio/establecimientos/descartar', { ids: [] }, t.gerente)).status, 422);
    const d = await call('POST', '/api/territorio/establecimientos/descartar', { ids: [malo.id, malo.id], motivo: 'Es una dirección (Ejemplo)' }, t.gerente);
    assert.equal(d.body.item.descartados, 1);
    assert.ok(!(await call('GET', '/api/territorio/establecimientos', null, t.gerente)).body.items.some((x) => x.id === malo.id));
    assert.equal((await call('GET', '/api/territorio/establecimientos?ver=descartados', null, t.gerente)).body.items[0].descarteMotivo, 'Es una dirección (Ejemplo)');
    assert.ok(!(await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.rep)).body.establecimientos.some((x) => x.id === malo.id));
    const c = await call('POST', '/api/cronogramas', { representanteId: id.rep, fechas: ['2026-11-23'], lugares: [{ refTipo: 'establecimiento', refId: malo.id }] }, t.admin);
    assert.equal(c.status, 422, 'un descartado no se puede programar');
    assert.equal((await call('POST', `/api/territorio/establecimientos/${malo.id}/restaurar`, null, t.gerente)).body.item.estado, 'validado');
    assert.ok((await call('GET', `/api/territorio/zonas/${id.rep}/lugares`, null, t.rep)).body.establecimientos.some((x) => x.id === malo.id));
  } finally { server.close(); }
});

test('dependiente: se registra eligiendo su farmacia del catálogo y queda activa y ligada', async () => {
  const { server, call, t } = await setup();
  try {
    const data = setup.data;
    const f = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Registro', provincia: 'Espaillat', municipio: 'Moca', sector: 'Centro', estado: 'validada', fuente: 'manual' });
    assert.equal((await call('GET', '/api/publico/farmacias?provincia=Espaillat')).status, 422);
    const pub = (await call('GET', '/api/publico/farmacias?provincia=Espaillat&municipio=Moca&q=registro')).body;
    assert.deepEqual(pub.items.map((x) => x.nombre), ['Farmacia Ejemplo Registro']); assert.equal(pub.items[0].estado, undefined, 'solo datos públicos de la farmacia');
    assert.ok((await call('GET', '/api/publico/division')).body.provincias.includes('Espaillat'));
    const base = { role: 'dependiente', fullName: 'Dependiente Ejemplo Nueva', phone: '809-555-0101', password: 'ClaveSegura2026', acceptsPrivacy: true };
    assert.equal((await call('POST', '/api/auth/register', { ...base, email: 'dep.nueva@ejemplo.do', farmaciaId: 'no-existe' })).status, 422);
    const r = await call('POST', '/api/auth/register', { ...base, email: 'dep.nueva@ejemplo.do', farmaciaId: f.id });
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.user.status, 'activo'); assert.match(r.body.message, /Farmacia Ejemplo Registro/);
    const login = await call('POST', '/api/auth/login', { email: 'dep.nueva@ejemplo.do', password: 'ClaveSegura2026' });
    assert.equal(login.status, 200);
    const ini = (await call('GET', '/api/inicio', null, login.body.token)).body;
    assert.deepEqual([ini.farmacia.nombre, ini.farmacia.municipio, ini.farmacia.sector], ['Farmacia Ejemplo Registro', 'Moca', 'Centro']);
    // Sin farmacia del catálogo sigue el camino de siempre: pendiente de aprobación
    const sin = await call('POST', '/api/auth/register', { ...base, email: 'dep.otra@ejemplo.do', pharmacy: 'Farmacia que no está', province: 'Espaillat' });
    assert.equal(sin.body.user.status, 'pendiente_aprobacion');
    assert.ok((await call('GET', '/api/notificaciones', null, t.gerente)).body.items.some((x) => x.titulo === 'Nueva dependiente'));
  } finally { server.close(); }
});

test('vouchers: precio por unidad suma el total; el Vendedor carga a nombre de una dependiente de su zona', async () => {
  const { server, call, t, id } = await setup();
  try {
    const data = setup.data;
    const med = await data.insert('medicamentos', { nombre: 'Medicamento Ejemplo', linea: 'Ejemplo', presentacion: 'Caja x 30', activo: true });
    const fMoca = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', estado: 'validada', fuente: 'manual' });
    const fBonao = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Bonao', provincia: 'Monseñor Nouel', municipio: 'Bonao', estado: 'validada', fuente: 'manual' });
    await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: fMoca.id }, t.supervisor);
    await call('POST', '/api/comisiones/config', { porcentaje: 10, periodo: 'mensual' }, t.gerente);
    // Dependiente: 3 × 250 + 1 × 100 = 850
    const v1 = await call('POST', '/api/vouchers', { referencia: 'EJ-001', fecha: '2026-11-19', items: [{ medicamentoId: med.id, cantidad: 3, precio: 250 }, { medicamentoId: med.id, cantidad: 1, precio: 100 }] }, t.dep);
    assert.equal(v1.status, 201, JSON.stringify(v1.body)); assert.equal(v1.body.item.total, 850); assert.equal(v1.body.item.estado, 'pendiente');
    assert.equal(v1.body.item.farmacia, 'Farmacia Ejemplo Moca'); assert.equal(v1.body.item.items[0].precio, 250);
    assert.equal((await call('GET', '/api/vouchers/porcentaje', null, t.dep)).body.item.porcentaje, 10);
    // Vendedor (rep2) con Espaillat en su zona
    await call('POST', `/api/territorio/zonas/${id.rep2}`, { provincias: ['Espaillat'] }, t.gerente);
    assert.equal((await call('GET', '/api/vouchers/dependientes', null, t.rep)).status, 403, 'un Visitador no carga vouchers');
    const deps = (await call('GET', '/api/vouchers/dependientes', null, t.rep2)).body.items;
    assert.deepEqual(deps.map((d) => d.id), [id.dep]);
    assert.equal((await call('POST', '/api/vouchers', { referencia: 'EJ-002', fecha: '2026-11-19', items: [{ medicamentoId: med.id, cantidad: 2, precio: 300 }] }, t.rep2)).status, 422, 'falta la dependiente');
    const v2 = await call('POST', '/api/vouchers', { dependienteId: id.dep, referencia: 'EJ-002', fecha: '2026-11-19', items: [{ medicamentoId: med.id, cantidad: 2, precio: 300 }] }, t.rep2);
    assert.equal(v2.status, 201); assert.equal(v2.body.item.dependienteId, id.dep); assert.equal(v2.body.item.registradoPor, id.rep2); assert.equal(v2.body.item.total, 600);
    assert.equal((await call('POST', '/api/vouchers', { dependienteId: id.dep, referencia: 'ej-001', fecha: '2026-11-19', items: [{ medicamentoId: med.id, cantidad: 1, precio: 1 }] }, t.rep2)).status, 409, 'mismo número para la misma dependiente');
    // Dependiente de otra zona: no
    await call('POST', `/api/usuarios/${id.dep}/farmacia`, { farmaciaId: fBonao.id }, t.supervisor);
    assert.equal((await call('POST', '/api/vouchers', { dependienteId: id.dep, referencia: 'EJ-003', fecha: '2026-11-19', items: [{ medicamentoId: med.id, cantidad: 1, precio: 10 }] }, t.rep2)).status, 403);
    const delVendedor = (await call('GET', '/api/vouchers', null, t.rep2)).body.items;
    assert.deepEqual(delVendedor.map((v) => v.referencia), ['EJ-002']);
    const deLaDep = (await call('GET', '/api/vouchers', null, t.dep)).body.items;
    assert.equal(deLaDep.find((v) => v.referencia === 'EJ-002').cargadoPor, 'rep2');
    assert.ok((await call('GET', '/api/notificaciones', null, t.dep)).body.items.some((x) => x.titulo === 'Voucher cargado a tu nombre'));
    assert.equal((await call('POST', `/api/vouchers/${v2.body.item.id}/anular`, null, t.rep2)).body.item.estado, 'anulado');
  } finally { server.close(); }
});

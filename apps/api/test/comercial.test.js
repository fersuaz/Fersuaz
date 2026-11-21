import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore, PostgresStore } from '../src/store.js';
import { MemoryData, PgData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { periodoDe, rangoDe, esFechaISO } from '../src/periodos.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
// "Hoy" fijo: 20-11-2026 a mediodía en Santo Domingo.
const NOW = () => new Date('2026-11-20T16:00:00Z');

// Con TEST_DATABASE_URL las mismas pruebas corren contra PostgreSQL real (migraciones aplicadas).
const PG = process.env.TEST_DATABASE_URL;
let pgStore;
async function nuevoAlmacen() {
  if (!PG) return { store: new MemoryStore(), data: new MemoryData() };
  pgStore ??= await PostgresStore.connect(PG);
  await pgStore.pool.query('TRUNCATE configuracion, inventario, recetas, pacientes, operativos, cierres_comision, vouchers, medicos, farmacias, medicamentos, audit_logs, users CASCADE');
  const s = pgStore; s.audit = { some: () => true }; // la auditoría en PG se verifica con SQL aparte
  return { store: s, data: new PgData(s.pool) };
}
test.after(async () => { if (pgStore) await pgStore.pool.end(); });

async function setup() {
  const { store, data } = await nuevoAlmacen();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, now: NOW })).listen(0);
  setup.data = data;
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
  };
  const users = {};
  async function user(key, props) {
    const pw = 'clave' + key + '12345';
    await store.createUser({ fullName: key, email: `${key}@fersuaz.net`, status: 'activo', passwordHash: await hashPassword(pw), ...props });
    users[key] = (await call('POST', '/api/auth/login', { email: `${key}@fersuaz.net`, password: pw })).body.token;
  }
  await user('gerente', { role: 'gerencia' });
  await user('finanzas', { role: 'finanzas' });
  await user('supervisor', { role: 'supervisor' });
  await user('dep', { role: 'dependiente', pharmacy: 'Farmacia Carol', province: 'Santiago' });
  await user('dep2', { role: 'dependiente', pharmacy: 'Farmacia Los Hidalgos', province: 'La Vega' });
  await user('promo', { role: 'representante', position: 'Promotora' });
  await user('promo2', { role: 'representante', position: 'Promotora' });
  await user('vendedor', { role: 'representante', position: 'Vendedor' });
  await user('visitador', { role: 'representante', position: 'Visitador' });
  const tioDex = (await call('POST', '/api/catalogo/medicamentos', { nombre: 'Tio-Dex', linea: 'Respiratoria', presentacion: 'Jarabe 120 mL' }, users.gerente)).body.item;
  const otro = (await call('POST', '/api/catalogo/medicamentos', { nombre: 'Medicamento B', linea: 'Analgésicos' }, users.gerente)).body.item;
  return { server, call, t: users, store, tioDex, otro };
}

test('catálogo: poner y cambiar el precio de un medicamento deja historial', async () => {
  const { server, call, t, tioDex } = await setup();
  try {
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${tioDex.id}/precios`, { precio: 450 }, t.promo)).status, 403);
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${tioDex.id}/precios`, { precio: 0 }, t.gerente)).status, 422);
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${tioDex.id}/precios`, { precio: '1,250.50', vigenteDesde: '2026-11-01' }, t.gerente)).body.item.precio, 1250.5);
    await call('POST', `/api/catalogo/medicamentos/${tioDex.id}/precios`, { precio: 1300, vigenteDesde: '2026-11-15' }, t.gerente);
    const h = (await call('GET', `/api/catalogo/medicamentos/${tioDex.id}/precios`, null, t.gerente)).body.items;
    assert.deepEqual(h.map((x) => [x.precio, x.fuente]), [[1300, 'manual'], [1250.5, 'manual']]);
  } finally { server.close(); }
});

test('períodos quincenal y mensual', () => {
  assert.deepEqual(periodoDe('2026-11-15', 'quincenal'), { clave: '2026-11-Q1', desde: '2026-11-01', hasta: '2026-11-15' });
  assert.deepEqual(periodoDe('2026-02-20', 'quincenal'), { clave: '2026-02-Q2', desde: '2026-02-16', hasta: '2026-02-28' });
  assert.deepEqual(periodoDe('2028-02-03', 'mensual').hasta, '2028-02-29');
  assert.equal(rangoDe('2026-11-Q2').hasta, '2026-11-30');
  assert.throws(() => rangoDe('2026-13'));
  assert.equal(esFechaISO('2026-02-30'), false);
});

test('catálogo: solo gerencia crea medicamentos; sin duplicados', async () => {
  const { server, call, t } = await setup();
  try {
    assert.equal((await call('POST', '/api/catalogo/medicamentos', { nombre: 'X' }, t.dep)).status, 403);
    assert.equal((await call('POST', '/api/catalogo/medicamentos', { nombre: 'tio-dex', presentacion: 'Jarabe 120 mL' }, t.gerente)).status, 409);
    assert.equal((await call('GET', '/api/catalogo/medicamentos', null)).status, 401);
    assert.equal((await call('GET', '/api/catalogo/medicamentos', null, t.dep)).body.items.length, 2);
  } finally { server.close(); }
});

test('vouchers: carga, duplicado, fecha futura, permisos y aprobación', async () => {
  const { server, call, t, tioDex, store } = await setup();
  try {
    const base = { referencia: 'V-001', fecha: '2026-11-05', items: [{ medicamentoId: tioDex.id, cantidad: 1, monto: 500 }] };
    assert.equal((await call('POST', '/api/vouchers', base, t.promo)).status, 422, 'la promotora carga vouchers, pero a nombre de una dependiente');
    const v = await call('POST', '/api/vouchers', base, t.dep);
    assert.equal(v.status, 201, JSON.stringify(v.body)); assert.equal(v.body.item.total, 500); assert.equal(v.body.item.farmacia, 'Farmacia Carol');
    assert.equal((await call('POST', '/api/vouchers', { ...base, referencia: ' v-001 ' }, t.dep)).status, 409);
    const fut = await call('POST', '/api/vouchers', { ...base, referencia: 'V-2', fecha: '2026-11-21' }, t.dep);
    assert.equal(fut.status, 422); assert.ok(fut.body.fields.fecha);
    const malo = await call('POST', '/api/vouchers', { referencia: 'V-3', fecha: '2026-11-05', items: [{ medicamentoId: 'nope', cantidad: 0, monto: -1 }] }, t.dep);
    assert.equal(malo.status, 422); assert.ok(malo.body.fields['items.0.medicamentoId']); assert.ok(malo.body.fields['items.0.cantidad']); assert.ok(malo.body.fields['items.0.monto']);

    // cada dependiente ve solo los suyos
    assert.equal((await call('GET', '/api/vouchers', null, t.dep2)).body.items.length, 0);
    assert.equal((await call('GET', '/api/vouchers', null, t.dep)).body.items.length, 1);
    assert.equal((await call('GET', '/api/vouchers', null, t.visitador)).status, 200, 'el visitador ve los vouchers que cargó');
    assert.equal((await call('GET', '/api/vouchers', null, t.finanzas)).status, 200);

    // revisar
    assert.equal((await call('POST', `/api/vouchers/${v.body.item.id}/aprobar`, {}, t.dep)).status, 403);
    assert.equal((await call('POST', `/api/vouchers/${v.body.item.id}/rechazar`, {}, t.supervisor)).status, 422);
    assert.equal((await call('POST', `/api/vouchers/${v.body.item.id}/aprobar`, {}, t.supervisor)).status, 200);
    assert.equal((await call('POST', `/api/vouchers/${v.body.item.id}/aprobar`, {}, t.supervisor)).status, 409);
    assert.equal((await call('POST', `/api/vouchers/${v.body.item.id}/anular`, {}, t.dep)).status, 409);
    assert.ok(store.audit.some((a) => a.action === 'voucher_aprobado'));
  } finally { server.close(); }
});

test('comisiones: sin configuración no se inventa el porcentaje', async () => {
  const { server, call, t } = await setup();
  try {
    const r = await call('GET', '/api/comisiones/resumen', null, t.dep);
    assert.equal(r.body.configurado, false);
  } finally { server.close(); }
});

test('PDF: 100 vouchers de Tio-Dex a RD$500 al 10 % = RD$5,000; cierre inmutable', async () => {
  const { server, call, t, tioDex } = await setup();
  try {
    assert.equal((await call('POST', '/api/comisiones/config', { porcentaje: 10, periodo: 'quincenal' }, t.dep)).status, 403);
    assert.equal((await call('POST', '/api/comisiones/config', { porcentaje: 150, periodo: 'quincenal' }, t.finanzas)).status, 422);
    assert.equal((await call('POST', '/api/comisiones/config', { porcentaje: 10, periodo: 'quincenal' }, t.finanzas)).status, 200);
    const ids = [];
    for (let i = 0; i < 100; i++) {
      const r = await call('POST', '/api/vouchers', { referencia: `Q1-${i}`, fecha: '2026-11-10', items: [{ medicamentoId: tioDex.id, cantidad: 1, monto: 500 }] }, t.dep);
      ids.push(r.body.item.id);
    }
    // cierre bloqueado mientras haya pendientes
    assert.equal((await call('POST', '/api/comisiones/cierres', { dependienteId: (await call('GET', '/api/auth/me', null, t.dep)).body.user.id, periodo: '2026-11-Q1' }, t.finanzas)).status, 409);
    for (const id of ids) await call('POST', `/api/vouchers/${id}/aprobar`, {}, t.supervisor);
    const r = await call('GET', '/api/comisiones/resumen?periodo=2026-11-Q1', null, t.dep);
    assert.equal(r.body.ventasAprobadas, 50000); assert.equal(r.body.comision, 5000); assert.equal(r.body.vouchers.aprobados, 100);

    const depId = (await call('GET', '/api/auth/me', null, t.dep)).body.user.id;
    assert.equal((await call('POST', '/api/comisiones/cierres', { dependienteId: depId, periodo: '2026-11-Q2' }, t.finanzas)).status, 409); // no ha terminado
    assert.equal((await call('POST', '/api/comisiones/cierres', { dependienteId: depId, periodo: '2026-11-Q1' }, t.supervisor)).status, 403);
    const c = await call('POST', '/api/comisiones/cierres', { dependienteId: depId, periodo: '2026-11-Q1' }, t.finanzas);
    assert.equal(c.status, 201); assert.equal(c.body.item.comision, 5000);
    assert.equal((await call('POST', '/api/comisiones/cierres', { dependienteId: depId, periodo: '2026-11-Q1' }, t.finanzas)).status, 409);
    const tarde = await call('POST', '/api/vouchers', { referencia: 'tarde', fecha: '2026-11-03', items: [{ medicamentoId: tioDex.id, cantidad: 1, monto: 500 }] }, t.dep);
    assert.equal(tarde.status, 409);

    // porcentaje propio por dependiente
    await call('POST', '/api/comisiones/config', { dependienteId: depId, porcentaje: 12.5 }, t.gerente);
    assert.equal((await call('GET', '/api/comisiones/resumen?periodo=2026-11-Q1', null, t.dep)).body.porcentaje, 12.5);
    // otro dependiente no ve el resumen ajeno
    assert.equal((await call('GET', `/api/comisiones/resumen?dependienteId=${depId}`, null, t.dep2)).status, 403);
  } finally { server.close(); }
});

test('promotoras: operativo, médico, receta con foto y alerta de inventario al 75 %', async () => {
  const { server, call, t, tioDex, otro } = await setup();
  try {
    const op = { provincia: 'Santiago', municipio: 'Santiago de los Caballeros', centro: 'Hospital Cabral y Báez' };
    assert.equal((await call('POST', '/api/operativos', op, t.visitador)).status, 403);
    const o = (await call('POST', '/api/operativos', op, t.promo)).body.item;
    assert.equal(o.fecha, '2026-11-20');
    const o2 = (await call('POST', '/api/operativos', op, t.promo2)).body.item;

    const med = (await call('POST', '/api/catalogo/medicos', { nombre: 'Dra. Ana Gómez', especialidad: 'Neumología', provincia: 'Santiago', municipio: 'Santiago de los Caballeros' }, t.promo)).body.item;
    assert.equal(med.estado, 'pendiente');
    const dupMed = (await call('POST', '/api/catalogo/medicos', { nombre: 'dra. ana gómez', especialidad: 'Neumología', provincia: 'Santiago', municipio: 'Santiago de los Caballeros' }, t.promo2)).body.item;
    assert.equal(dupMed.id, med.id);

    // receta: operativo ajeno, medicamento repetido, unidades inválidas
    const ajeno = await call('POST', '/api/recetas', { operativoId: o2.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 1 }] }, t.promo);
    assert.equal(ajeno.status, 422); assert.ok(ajeno.body.fields.operativoId);
    const rep = await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 1 }, { medicamentoId: tioDex.id, unidades: 0 }] }, t.promo);
    assert.ok(rep.body.fields['items.1.medicamentoId']);

    // sin inventario registrado: se dice, no se inventa
    // paciente obligatorio: teléfono dominicano y nombre
    const sinPac = await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 18 }] }, t.promo);
    assert.equal(sinPac.status, 422); assert.ok(sinPac.body.fields['paciente.telefono']);
    const sinNombre = await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 18 }], paciente: { telefono: '809-555-0101' } }, t.promo);
    assert.equal(sinNombre.status, 422); assert.ok(sinNombre.body.fields['paciente.nombre']);
    assert.equal((await call('GET', '/api/pacientes?telefono=8095550101', null, t.promo)).body.paciente, null);
    const r1 = await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 18 }], paciente: { telefono: '809-555-0101', nombre: 'Paciente Ejemplo Uno' } }, t.promo);
    assert.equal(r1.status, 201); assert.equal(r1.body.alertas[0].estado, 'sin_inventario'); assert.equal(r1.body.paciente.nuevo, true);
    // el mismo teléfono se reconoce: nombre autocompletado y sin duplicar el contacto
    const bp = (await call('GET', '/api/pacientes?telefono=1 (809) 555 0101', null, t.promo2)).body.paciente;
    assert.equal(bp.nombre, 'Paciente Ejemplo Uno'); assert.equal(bp.recetas, 1); assert.equal(bp.telefono, '809-555-0101');
    assert.equal((await call('GET', '/api/pacientes?telefono=8095550101', null, t.vendedor)).status, 403);

    // inventario: 25 unidades en la zona
    assert.equal((await call('POST', '/api/catalogo/farmacias', { nombre: 'Farmacia Carol', provincia: 'Santiago', municipio: 'Santiago de los Caballeros' }, t.promo)).status, 403);
    const f = (await call('POST', '/api/catalogo/farmacias', { nombre: 'Farmacia Carol', provincia: 'Santiago', municipio: 'Santiago de los Caballeros' }, t.vendedor)).body.item;
    assert.equal(f.estado, 'pendiente');
    assert.equal((await call('POST', '/api/inventario', { farmaciaId: f.id, medicamentoId: tioDex.id, unidades: 25 }, t.promo)).status, 403);
    assert.equal((await call('POST', '/api/inventario', { farmaciaId: f.id, medicamentoId: tioDex.id, unidades: 25 }, t.vendedor)).status, 201);

    // 18/25 = 72 % → sin alerta; +1 = 19/25 = 76 % → alerta
    let al = (await call('GET', '/api/alertas', null, t.promo)).body;
    assert.equal(al.umbral, 0.75); assert.equal(al.items[0].estado, 'ok'); assert.equal(al.items[0].recetado, 18);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
    const r2 = await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 1 }, { medicamentoId: otro.id, unidades: 2 }], adjunto: { nombre: 'receta.png', tipo: 'image/png', base64: png }, paciente: { telefono: '8095550101', nombre: 'Otro nombre' } }, t.promo);
    assert.equal(r2.status, 201); assert.equal(r2.body.paciente.nuevo, false); assert.equal(r2.body.paciente.nombre, 'Paciente Ejemplo Uno', 'se respeta el paciente ya registrado');
    assert.equal((await setup.data.list('pacientes')).length, 1);
    const a = r2.body.alertas.find((x) => x.medicamentoId === tioDex.id);
    assert.equal(a.estado, 'alerta'); assert.equal(a.recetado, 19); assert.equal(a.disponible, 25);

    // foto: solo la dueña o gestión la ven
    const clave = r2.body.receta.adjunto.clave;
    assert.equal((await call('GET', `/api/adjuntos/${clave}`, null, t.promo)).status, 200);
    assert.equal((await call('GET', `/api/adjuntos/${clave}`, null, t.promo2)).status, 404);
    assert.equal((await call('GET', `/api/adjuntos/${clave}`, null, t.gerente)).status, 200);
    // foto falsa (PNG que no es PNG) y formato no permitido
    assert.equal((await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 1 }], adjunto: { tipo: 'image/png', base64: Buffer.from('hola').toString('base64') } }, t.promo)).status, 422);
    assert.equal((await call('POST', '/api/recetas', { operativoId: o.id, medicoId: med.id, items: [{ medicamentoId: tioDex.id, unidades: 1 }], adjunto: { tipo: 'text/html', base64: 'PGgxPg==' } }, t.promo)).status, 422);

    // umbral configurable solo por gerencia
    assert.equal((await call('POST', '/api/alertas/umbral', { umbral: 0.9 }, t.promo)).status, 403);
    await call('POST', '/api/alertas/umbral', { umbral: 0.8 }, t.gerente);
    al = (await call('GET', '/api/alertas', null, t.promo)).body;
    assert.equal(al.umbral, 0.8); assert.equal(al.items.find((x) => x.medicamentoId === tioDex.id).estado, 'ok'); // 19/25 = 76 % < 80 %

    // cada promotora ve solo sus recetas; gestión ve todas
    assert.equal((await call('GET', '/api/recetas', null, t.promo2)).body.items.length, 0);
    const delSup = (await call('GET', '/api/recetas?mes=2026-11', null, t.supervisor)).body.items;
    assert.equal(delSup.length, 2); assert.equal(delSup[0].paciente.telefono, '···-···-0101', 'la supervisión ve el teléfono oculto');
    assert.equal((await call('GET', '/api/recetas?mes=2026-11', null, t.promo)).body.items[0].paciente.telefono, '809-555-0101');

    // reportes
    const rep2 = (await call('GET', '/api/reportes/recetas?mes=2026-11&agrupar=medicamento', null, t.gerente)).body;
    assert.equal(rep2.totalRecetas, 2);
    assert.deepEqual(rep2.filas.find((x) => x.clave === 'Tio-Dex'), { clave: 'Tio-Dex', recetas: 2, unidades: 19 });
    assert.equal((await call('GET', '/api/reportes/recetas?mes=2026-11&agrupar=especialidad', null, t.gerente)).body.filas[0].clave, 'Neumología');
    assert.equal((await call('GET', '/api/reportes/recetas?mes=2026-11&agrupar=medicamento', null, t.promo)).status, 403);
  } finally { server.close(); }
});

test('cuenta pendiente no puede usar la API aunque tenga token', async () => {
  const { server, call, t, store } = await setup();
  try {
    const me = (await call('GET', '/api/auth/me', null, t.dep)).body.user;
    await store.updateUser(me.id, { status: 'inactivo' });
    assert.equal((await call('GET', '/api/vouchers', null, t.dep)).status, 403);
  } finally { server.close(); }
});

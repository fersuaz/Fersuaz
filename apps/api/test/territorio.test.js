import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/store.js';
import { MemoryData, PgData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { provinciaOficial, municipioOficial, tipoEstablecimiento } from '../src/territorio.js';
import { DIVISION, PROVINCIAS } from '../src/datos/division-territorial.js';
import { leerHoja } from '../src/hojas.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('división oficial: Distrito Nacional, 31 provincias y 158 municipios', () => {
  assert.equal(PROVINCIAS.length, 32);
  assert.equal(Object.values(DIVISION).flat().length, 158);
  assert.ok(PROVINCIAS.includes('Distrito Nacional') && PROVINCIAS.includes('Hermanas Mirabal'));
});

test('nombres: acepta sin acentos y nombres comunes, rechaza lo que no existe', () => {
  assert.equal(provinciaOficial('maria trinidad sanchez'), 'María Trinidad Sánchez');
  assert.equal(provinciaOficial('Montecristi'), 'Monte Cristi');
  assert.equal(provinciaOficial('D.N.'), 'Distrito Nacional');
  assert.equal(provinciaOficial('Narnia'), null);
  assert.equal(municipioOficial('La Vega', 'la vega'), 'Concepción de La Vega');
  assert.equal(municipioOficial('Santiago', 'Santiago'), 'Santiago de los Caballeros');
  assert.equal(municipioOficial('La Altagracia', 'Higuey'), 'Salvaleón de Higüey');
  assert.equal(municipioOficial('La Vega', 'Moca'), null, 'Moca es de Espaillat');
  assert.equal(tipoEstablecimiento('Centro de primer nivel'), 'cpn');
  assert.equal(tipoEstablecimiento('clinica'), 'clinica');
  assert.equal(tipoEstablecimiento('Supermercado'), null);
});

test('hojas: lee la plantilla .xlsx oficial y CSV con punto y coma y comillas', () => {
  const x = leerHoja(readFileSync(new URL('../../web/assets/plantillas/representantes.xlsx', import.meta.url)), 'r.xlsx');
  assert.deepEqual(x.columnas, ['nombre completo', 'correo', 'telefono', 'cargo', 'provincias']);
  const c = leerHoja(Buffer.from('Nombre;Precio RD$\n"Jarabe; 120";"1,250.50"\n', 'utf8'), 'x.csv');
  assert.deepEqual(c.filas[0], { _fila: 2, nombre: 'Jarabe; 120', 'precio rd': '1,250.50' });
  assert.throws(() => leerHoja(Buffer.from('xx'), 'viejo.xls'), /\.xls antiguo/);
});

export async function arrancar({ data = new MemoryData(), lugares } = {}) {
  const store = new MemoryStore();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), lugares, barridoPausa: 0, sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, tok) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(tok && { authorization: `Bearer ${tok}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const tok = {}; const ids = {};
  for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, sup: { role: 'supervisor' }, fin: { role: 'finanzas' }, rep: { role: 'representante', position: 'Visitador' }, ven: { role: 'representante', position: 'Vendedor' } })) {
    const u = await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props });
    ids[k] = u.id; tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
  }
  return { server, call, tok, ids, store };
}

test('importar medicamentos: vista previa sin guardar, todo o nada, y el precio guarda historial', async () => {
  const { server, call, tok } = await arrancar();
  try {
    const csv = 'Nombre,Línea,Presentación,Precio RD$,Vigente desde\nEJEMPLO Medicamento,X,Y,1,\nMedicamento A,Antitusivos,Jarabe 120 mL,450,2026-11-01\nMedicamento B,,Tabletas,abc,\n';
    assert.equal((await call('POST', '/api/importar/medicamentos', { archivo: b64(csv), nombre: 'm.csv' }, tok.rep)).status, 403);
    const pre = (await call('POST', '/api/importar/medicamentos', { archivo: b64(csv), nombre: 'm.csv' }, tok.ger)).body;
    assert.equal(pre.total, 2, 'la fila EJEMPLO se ignora'); assert.equal(pre.guardado, false);
    assert.deepEqual(pre.errores, [{ fila: 4, errores: ['El precio debe ser un número mayor que cero.'] }]);
    const mal = await call('POST', '/api/importar/medicamentos', { archivo: b64(csv), nombre: 'm.csv', confirmar: true }, tok.ger);
    assert.equal(mal.status, 422);
    assert.equal((await call('GET', '/api/catalogo/medicamentos', null, tok.ger)).body.items.length, 0, 'nada se guardó');
    const ok = 'Nombre,Línea,Presentación,Precio RD$\nMedicamento A,Antitusivos,Jarabe 120 mL,450\nMedicamento B,,Tabletas,"1,250.50"\n';
    const r = (await call('POST', '/api/importar/medicamentos', { archivo: b64(ok), confirmar: true }, tok.ger)).body;
    assert.deepEqual(r.resumen, { crear: 2 });
    const subida = (await call('POST', '/api/importar/medicamentos', { archivo: b64('Nombre,Presentación,Precio RD$\nmedicamento a,jarabe 120 ml,475\nMedicamento B,Tabletas,1250.5\n'), confirmar: true }, tok.ger)).body;
    assert.deepEqual(subida.resumen, { 'actualizar precio': 1, 'sin cambio': 1 });
    const meds = (await call('GET', '/api/catalogo/medicamentos', null, tok.ger)).body.items;
    const a = meds.find((m) => m.nombre === 'Medicamento A');
    assert.equal(a.precio, 475);
    const hist = (await call('GET', `/api/catalogo/medicamentos/${a.id}/precios`, null, tok.ger)).body.items;
    assert.deepEqual(hist.map((h) => h.precio).sort(), [450, 475], 'el precio anterior no se borra');
  } finally { server.close(); }
});

test('importar farmacias y establecimientos: municipios oficiales y sin duplicados', async () => {
  const { server, call, tok } = await arrancar();
  try {
    const f = 'Nombre,Provincia,Municipio,Sector\nFarmacia Uno,La Vega,la vega,Centro\nFarmacia Dos,Espaillat,Jarabacoa,\nFarmacia Uno,La Vega,Concepción de La Vega,\n';
    const pre = (await call('POST', '/api/importar/farmacias', { archivo: b64(f) }, tok.sup)).body;
    assert.equal(pre.errores.length, 2);
    assert.match(pre.errores[0].errores[0], /no pertenece a Espaillat/);
    assert.match(pre.errores[1].errores[0], /Repetida en la fila 2/);
    const okF = (await call('POST', '/api/importar/farmacias', { archivo: b64('Nombre,Provincia,Municipio\nFarmacia Uno,La Vega,la vega\n'), confirmar: true }, tok.sup)).body;
    assert.deepEqual(okF.resumen, { crear: 1 });
    const otra = (await call('POST', '/api/importar/farmacias', { archivo: b64('Nombre,Provincia,Municipio\nFARMACIA UNO,la vega,Concepcion de la Vega\n') }, tok.sup)).body;
    assert.deepEqual(otra.resumen, { 'ya existe': 1 });
    const e = 'Tipo,Nombre,Provincia,Municipio\nHospital,Hospital Ejemplar Uno,Espaillat,Moca\nUNAP,Unap Ejemplar,Espaillat,Moca\nSupermercado,X,Espaillat,Moca\n';
    const pe = (await call('POST', '/api/importar/establecimientos', { archivo: b64(e) }, tok.ger)).body;
    assert.equal(pe.errores.length, 1); assert.equal(pe.errores[0].fila, 4);
    assert.equal((await call('POST', '/api/importar/establecimientos', { archivo: b64(e.split('\n').slice(0, 3).join('\n')), confirmar: true }, tok.ger)).body.resumen.crear, 2);
    const lista = (await call('GET', '/api/territorio/establecimientos?municipio=Moca', null, tok.ger)).body.items;
    assert.deepEqual(lista.map((x) => x.tipo).sort(), ['hospital', 'unap']);
    assert.equal((await call('POST', '/api/importar/establecimientos', { archivo: b64('Nombre\nX\n') }, tok.ger)).body.fields.archivo, 'Faltan columnas: tipo, provincia, municipio. Usa la plantilla.');
  } finally { server.close(); }
});

test('zonas: el representante solo ve y registra en sus provincias', async () => {
  const { server, call, tok, ids } = await arrancar();
  try {
    await call('POST', '/api/importar/establecimientos', { archivo: b64('Tipo,Nombre,Provincia,Municipio\nClínica,Clínica Ejemplo Moca,Espaillat,Moca\nClínica,Clínica Ejemplo Bonao,Monseñor Nouel,Bonao\n'), confirmar: true }, tok.ger);
    assert.deepEqual((await call('GET', '/api/territorio/mis-provincias', null, tok.rep)).body.items, []);
    assert.equal((await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['Narnia'] }, tok.sup)).status, 422);
    assert.equal((await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['espaillat'] }, tok.rep)).status, 403);
    await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['espaillat', 'La Vega'] }, tok.sup);
    assert.deepEqual((await call('GET', '/api/territorio/mis-provincias', null, tok.rep)).body.items, ['Espaillat', 'La Vega']);
    assert.deepEqual((await call('GET', '/api/territorio/establecimientos', null, tok.rep)).body.items.map((x) => x.nombre), ['Clínica Ejemplo Moca']);
    assert.equal((await call('POST', '/api/territorio/establecimientos', { tipo: 'UNAP', nombre: 'UNAP Bonao Ejemplo', provincia: 'Monseñor Nouel', municipio: 'Bonao' }, tok.rep)).status, 403);
    const nuevo = await call('POST', '/api/territorio/establecimientos', { tipo: 'UNAP', nombre: 'UNAP Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', lat: 19.1, lng: -70.6, placeId: 'falso' }, tok.rep);
    assert.equal(nuevo.status, 201); assert.equal(nuevo.body.item.estado, 'pendiente');
    assert.equal(nuevo.body.item.lat, null, 'coordenadas del navegador se ignoran');
    assert.equal((await call('POST', '/api/territorio/establecimientos', { tipo: 'UNAP', nombre: 'unap ejemplo jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa' }, tok.rep)).status, 409);
  } finally { server.close(); }
});

test('pre-registro: el representante del Excel queda activo con su cargo y provincias al registrarse', async () => {
  const { server, call, tok } = await arrancar();
  try {
    const x = 'Nombre completo,Correo,Teléfono,Cargo,Provincias\nEJEMPLO Representante,ejemplo@correo.com,,Visitador,La Vega\nAna Ejemplo Pérez,Ana.Ejemplo@Correo.do,8090000000,Promotor,La Vega; espaillat\nSin Apellido,malcorreo,,Chofer,Narnia\nger Ejemplo,ger@x.do,,Visitador,\n';
    const pre = (await call('POST', '/api/importar/representantes', { archivo: b64(x) }, tok.ger)).body;
    assert.equal(pre.total, 3);
    assert.equal(pre.errores[0].fila, 4); assert.equal(pre.errores[0].errores.length, 3);
    const ok = x.split('\n').filter((l, i) => i !== 3).join('\n');
    const r = (await call('POST', '/api/importar/representantes', { archivo: b64(ok), confirmar: true }, tok.ger)).body;
    assert.deepEqual(r.resumen, { 'pre-registrar': 1, 'ya tiene cuenta': 1 });
    const reg = await call('POST', '/api/auth/register', { fullName: 'Ana Ejemplo Pérez', email: 'ana.ejemplo@correo.do', phone: '8095550000', password: 'ClaveEjemplo2026', role: 'representante', position: 'Vendedor', acceptsPrivacy: true });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.user.status, 'activo'); assert.equal(reg.body.user.position, 'Promotora', 'manda el cargo del Excel');
    assert.match(reg.body.message, /ya está activa/);
    const login = await call('POST', '/api/auth/login', { email: 'ana.ejemplo@correo.do', password: 'ClaveEjemplo2026' });
    assert.equal(login.status, 200);
    assert.deepEqual((await call('GET', '/api/territorio/mis-provincias', null, login.body.token)).body.items, ['La Vega', 'Espaillat']);
    assert.equal((await call('GET', '/api/territorio/preregistros', null, tok.ger)).body.items[0].estado, 'usado');
    const otro = await call('POST', '/api/auth/register', { fullName: 'Otro Ejemplo', email: 'otro@correo.do', phone: '8095550001', password: 'ClaveEjemplo2026', role: 'representante', position: 'Vendedor', acceptsPrivacy: true });
    assert.equal(otro.body.user.status, 'pendiente_aprobacion', 'sin pre-registro sigue esperando aprobación');
  } finally { server.close(); }
});

test('Google Maps: sin clave avisa; con clave busca, marca los ya registrados y agrega con datos verificados', async () => {
  const sin = await arrancar();
  try { assert.equal((await sin.call('GET', '/api/territorio/google/buscar?tipo=farmacia&provincia=Espaillat&municipio=Moca', null, sin.tok.ger)).status, 503); } finally { sin.server.close(); }
  const lugar = { placeId: 'ChIJ_ejemplo_1234', nombre: 'Farmacia Ejemplo Moca', direccion: 'Calle Ejemplo, Moca', lat: 19.39, lng: -70.52, telefono: '809-000-0000', cerrado: false };
  const lugares = { activo: true, async buscar() { return [lugar]; }, async detalle(id) { return id === lugar.placeId ? lugar : null; } };
  const { server, call, tok } = await arrancar({ lugares });
  try {
    assert.equal((await call('GET', '/api/territorio/google/buscar?tipo=farmacia&provincia=Espaillat&municipio=Moca', null, tok.rep)).status, 403);
    assert.equal((await call('GET', '/api/territorio/google/buscar?tipo=farmacia&provincia=Espaillat&municipio=Bonao', null, tok.ger)).status, 422);
    const b = (await call('GET', '/api/territorio/google/buscar?tipo=farmacia&provincia=Espaillat&municipio=Moca', null, tok.ger)).body.items;
    assert.equal(b[0].registrado, false);
    const add = await call('POST', '/api/territorio/google/agregar', { tipo: 'farmacia', placeId: lugar.placeId, provincia: 'Espaillat', municipio: 'Moca', nombre: 'Nombre inventado' }, tok.ger);
    assert.equal(add.status, 201); assert.equal(add.body.item.nombre, 'Farmacia Ejemplo Moca'); assert.equal(add.body.item.lat, 19.39); assert.equal(add.body.item.fuente, 'google');
    assert.equal((await call('GET', '/api/territorio/google/buscar?tipo=farmacia&provincia=Espaillat&municipio=Moca', null, tok.ger)).body.items[0].registrado, true);
    assert.equal((await call('POST', '/api/territorio/google/agregar', { tipo: 'farmacia', placeId: lugar.placeId, provincia: 'Espaillat', municipio: 'Moca' }, tok.ger)).status, 409);
    assert.equal((await call('POST', '/api/territorio/google/agregar', { tipo: 'hospital', placeId: 'ChIJ_no_existe_00', provincia: 'Espaillat', municipio: 'Moca' }, tok.ger)).status, 404);
  } finally { server.close(); }
});

test('Google Maps: registro automático de una provincia, sin duplicar y descartando lo de otra provincia', async () => {
  const L = (id, nombre, direccion) => ({ placeId: `ChIJ_ejemplo_${id}`, nombre, direccion, lat: 19.4, lng: -70.5, telefono: null, cerrado: false });
  const A = L('aaaa1111', 'Farmacia Ejemplo Uno', 'Calle 1, Moca 56000');
  const B = L('bbbb2222', 'Farmacia Ejemplo Dos', 'Calle 2, Gaspar Hernández');
  const C = L('cccc3333', 'Farmacia Ejemplo Fuera', 'Av. 3, Santiago de los Caballeros 51000');
  const pedidas = [];
  const lugares = { activo: true, async buscar() { return []; }, async detalle() { return null; },
    async pagina({ tipo, municipio }, token) {
      pedidas.push(`${tipo}:${municipio}:${token ?? ''}`);
      if (municipio === 'Moca') return token ? { items: [C, A], siguiente: null } : { items: [A, B], siguiente: 'pag2' };
      return { items: municipio === 'Gaspar Hernández' ? [B] : [], siguiente: null };
    } };
  const { server, call, tok } = await arrancar({ lugares });
  const esperar = async () => { for (let i = 0; i < 100; i++) { const e = (await call('GET', '/api/territorio/google/barrido', null, tok.ger)).body.item; if (e && e.estado !== 'en_curso') return e; await new Promise((r) => setTimeout(r, 10)); } throw new Error('no terminó'); };
  try {
    assert.equal((await call('POST', '/api/territorio/google/barrido', { tipo: 'farmacia', provincia: 'Espaillat' }, tok.sup)).status, 403);
    assert.equal((await call('POST', '/api/territorio/google/barrido', { tipo: 'farmacia', provincia: 'Espaillat', municipio: 'Bonao' }, tok.ger)).status, 422);
    assert.deepEqual((await call('GET', '/api/territorio/google/barrido/estimar?tipo=farmacia&provincia=Espaillat', null, tok.ger)).body.item, { municipios: 5, consultasMaximas: 15 });
    assert.equal((await call('GET', '/api/territorio/google/barrido/estimar?tipo=farmacia', null, tok.ger)).body.item.municipios, 158);
    assert.equal((await call('POST', '/api/territorio/google/barrido', { tipo: 'farmacia', provincia: 'Espaillat' }, tok.ger)).status, 202);
    const e = await esperar();
    assert.equal(e.estado, 'terminado'); assert.equal(e.agregados, 2); assert.equal(e.descartados, 1); assert.equal(e.consultas, 6);
    assert.equal(pedidas.filter((x) => x.startsWith('farmacia:Moca')).length, 2, 'pide la segunda página');
    const fs = (await call('GET', '/api/catalogo/farmacias', null, tok.ger)).body.items;
    assert.deepEqual(fs.map((f) => `${f.nombre}|${f.municipio}|${f.fuente}`).sort(), ['Farmacia Ejemplo Dos|Gaspar Hernández|google', 'Farmacia Ejemplo Uno|Moca|google']);
    const notis = (await call('GET', '/api/notificaciones', null, tok.ger)).body.items;
    assert.ok(notis.some((x) => x.titulo === 'Registro automático terminado' && /2 nuevos/.test(x.texto)));
    // Otra pasada no duplica nada
    await call('POST', '/api/territorio/google/barrido', { tipo: 'farmacia', provincia: 'Espaillat' }, tok.ger);
    const e2 = await esperar();
    assert.equal(e2.agregados, 0); assert.equal((await call('GET', '/api/catalogo/farmacias', null, tok.ger)).body.items.length, 2);
    // También sirve para centros de salud
    await call('POST', '/api/territorio/google/barrido', { tipo: 'hospital', provincia: 'Espaillat', municipio: 'Moca' }, tok.ger);
    const e3 = await esperar();
    assert.equal(e3.agregados, 2, 'B es de Gaspar Hernández pero está en Espaillat, entra allí'); assert.equal(e3.total, 1);
  } finally { server.close(); }
});

test('ubicarResultado: reconoce el municipio por la dirección', async () => {
  const { ubicarResultado } = await import('../src/barrido-google.js');
  assert.equal(ubicarResultado('Esq. Nicolás Mañón 84, Azua 71000', 'Azua', 'Peralta'), 'Azua de Compostela');
  assert.equal(ubicarResultado('F736+79W', 'Azua', 'Peralta'), 'Peralta', 'sin municipio en la dirección se queda en el buscado');
  assert.equal(ubicarResultado('Calle 1, Baní 94000', 'Azua', 'Peralta'), null, 'otra provincia se descarta');
  assert.equal(ubicarResultado('Av. X, Santo Domingo Este 11506', 'Santo Domingo', 'Boca Chica'), 'Santo Domingo Este');
});

// Contra PostgreSQL real, si hay base de pruebas.
test('PostgreSQL: columnas nuevas de territorio', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { PostgresStore } = await import('../src/store.js');
  const st = await PostgresStore.connect(process.env.TEST_DATABASE_URL);
  await st.pool.query('TRUNCATE preregistros, zonas_representante, establecimientos, precios_medicamento CASCADE');
  const data = new PgData(st.pool);
  const e = await data.insert('establecimientos', { tipo: 'unap', nombre: 'UNAP Ejemplo PG', provincia: 'Espaillat', municipio: 'Moca', lat: 19.391234, lng: -70.521234, estado: 'validado', fuente: 'excel' });
  assert.equal(e.lat, 19.391234); assert.equal(e.lng, -70.521234);
  const m = await data.insert('medicamentos', { nombre: `Med PG ${Date.now()}`, presentacion: 'Tabletas', precio: 99.5, activo: true });
  assert.equal(m.precio, 99.5);
  await st.pool.end();
});

test('PostgreSQL: importar y precios del MICM dejan auditoría válida', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { PostgresStore } = await import('../src/store.js');
  const { createTerritorio } = await import('../src/territorio.js');
  const st = await PostgresStore.connect(process.env.TEST_DATABASE_URL);
  const data = new PgData(st.pool);
  const ger = await st.createUser({ fullName: 'Gerencia Ejemplo PG', email: `ger-pg-${Date.now()}@x.do`, phone: null, role: 'gerencia', position: null, passwordHash: 'x', status: 'activo' });
  const t = createTerritorio({ data, users: st, audit: (e) => st.addAudit(e) });
  const r = await t.importar(ger, 'establecimientos', { archivo: b64(`Tipo,Nombre,Provincia,Municipio\nHospital,Hospital PG ${Date.now()},Espaillat,Moca\n`), nombre: 'e.csv', confirmar: true });
  assert.equal(r.guardado, true);
  // Auditoría con listas (provincias) y textos sueltos: deben guardarse como JSON válido.
  await st.addAudit({ actorId: ger.id, action: 'zona_asignada', entity: 'user', entityId: ger.id, before: null, after: ['La Vega', 'Espaillat'] });
  await st.addAudit({ actorId: ger.id, action: 'prueba', entity: 'x', entityId: 'y', before: 'texto', after: 3 });
  await st.pool.query("DELETE FROM precios_combustible WHERE vigente_desde = '2026-11-14'");
  const { actualizarDesdeMicm, URL_AVISOS } = await import('../src/combustible-micm.js');
  const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
  const f = async (u) => new Response(u === URL_AVISOS ? fx('listado-micm-ejemplo.html') : fx('aviso-ejemplo-libreoffice.pdf'));
  const m = await actualizarDesdeMicm({ data, audit: (e) => st.addAudit(e), fetchImpl: f });
  assert.equal(m.estado, 'registrado', m.mensaje);
  const { rows } = await st.pool.query("SELECT fuente, count(*)::int n FROM precios_combustible WHERE vigente_desde='2026-11-14' GROUP BY fuente");
  assert.deepEqual(rows, [{ fuente: 'micm', n: 5 }]);
  await st.pool.end();
});

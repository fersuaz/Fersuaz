import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore, PostgresStore } from '../src/store.js';
import { MemoryData, PgData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { fechaISO, filasDePlantilla, emparejar, parecido } from '../src/ventas.js';
import { createLectorIA } from '../src/lector-ia.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = () => new Date('2026-11-20T16:00:00Z');
const PG = process.env.TEST_DATABASE_URL;
let pgStore;
async function nuevoAlmacen() {
  if (!PG) return { store: new MemoryStore(), data: new MemoryData() };
  pgStore ??= await PostgresStore.connect(PG);
  await pgStore.pool.query('TRUNCATE ventas_farmacia, zonas_representante, configuracion, inventario, recetas, pacientes, operativos, cierres_comision, vouchers, medicos, farmacias, medicamentos, audit_logs, users CASCADE');
  return { store: pgStore, data: new PgData(pgStore.pool) };
}
test.after(async () => { if (pgStore) await pgStore.pool.end(); });

async function setup(lectorIA = null) {
  const { store, data } = await nuevoAlmacen();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: SECRET, now: NOW, lectorIA })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const t = {}; const id = {};
  for (const [k, props] of Object.entries({ gerente: { role: 'gerencia' }, vendedor: { role: 'representante', position: 'Vendedor' }, promo: { role: 'representante', position: 'Promotora' } })) {
    const u = await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@fersuaz.net`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props });
    id[k] = u.id; t[k] = (await call('POST', '/api/auth/login', { email: `${k}@fersuaz.net`, password: 'clave123456' })).body.token;
  }
  const tio = await data.insert('medicamentos', { nombre: 'Tio-Dex', presentacion: 'Jarabe 120 mL', linea: 'Respiratoria', precio: 450, activo: true });
  const ibu = await data.insert('medicamentos', { nombre: 'Ibuprofeno Ejemplo', presentacion: 'Tabletas 400 mg', linea: 'Analgésicos', precio: 120, activo: true });
  const carol = await data.insert('farmacias', { nombre: 'Farmacia Carol (Ejemplo)', provincia: 'Santiago', municipio: 'Santiago de los Caballeros', estado: 'validada', fuente: 'manual' });
  const moca = await data.insert('farmacias', { nombre: 'Farmacia Moca Centro (Ejemplo)', provincia: 'Espaillat', municipio: 'Moca', estado: 'validada', fuente: 'manual' });
  await call('POST', `/api/territorio/zonas/${id.vendedor}`, { provincias: ['Espaillat'] }, t.gerente);
  return { server, call, t, id, data, tio, ibu, carol, moca };
}
const csv = (txt) => ({ nombre: 'ventas.csv', tipo: 'text/csv', base64: Buffer.from(txt, 'utf8').toString('base64') });

test('ventas: fechas, columnas de la plantilla y parecido de nombres', () => {
  assert.equal(fechaISO('21/11/2026'), '2026-11-21'); assert.equal(fechaISO('2026-11-05'), '2026-11-05'); assert.equal(fechaISO('46346'), '2026-11-20'); assert.equal(fechaISO(''), null);
  const filas = filasDePlantilla({ columnas: ['fecha', 'cliente', 'producto', 'cantidad'], filas: [{ _fila: 2, fecha: '1/11/2026', cliente: 'Carol', producto: 'Tio', cantidad: '3' }] });
  assert.equal(filas[0].farmacia, 'Carol'); assert.equal(filas[0].unidades, '3');
  assert.equal(filasDePlantilla({ columnas: ['a', 'b'], filas: [] }), null);
  assert.equal(parecido('FARMACIA CAROL', 'Farmacia Carol (Ejemplo)'), 0.75, 'todas las palabras del nombre corto están'); assert.equal(parecido('Farmacia Carol', 'Farmacia Los Hidalgos'), 1 / 3);
  const m = emparejar('tio dex jarabe', [{ n: 'Tio-Dex Jarabe 120 mL' }, { n: 'Ibuprofeno' }], (x) => x.n);
  assert.equal(m.elegido.n, 'Tio-Dex Jarabe 120 mL');
});

test('ventas: plantilla → vista previa → guardar; inventario sube; sin duplicados; vendedor solo en su zona', async () => {
  const { server, call, t, id, data, tio, ibu, carol, moca } = await setup();
  try {
    assert.equal((await call('POST', '/api/ventas/leer', { archivo: csv('Farmacia,Medicamento,Unidades\nx,y,1') }, t.promo)).status, 403);
    const archivo = csv('Fecha,Farmacia,Municipio,Medicamento,Unidades,Precio unitario,Factura\n18/11/2026,Farmacia Carol,Santiago de los Caballeros,Tio-Dex Jarabe 120 mL,12,,B0100000010\n18/11/2026,Farmacia Moca Centro,Moca,Ibuprofeno Ejemplo Tabletas 400 mg,30,110,B0100000011\n18/11/2026,Farmacia Que No Existe,Moca,Producto raro,0,,');
    const v = (await call('POST', '/api/ventas/leer', { archivo }, t.gerente)).body;
    assert.equal(v.fuente, 'plantilla'); assert.equal(v.filas.length, 3); assert.equal(v.listas, 2);
    assert.equal(v.filas[0].farmaciaId, carol.id); assert.equal(v.filas[0].medicamentoId, tio.id); assert.equal(v.filas[0].fecha, '2026-11-18');
    assert.deepEqual(v.filas[2].avisos.slice(0, 1), ['Elige la farmacia']);
    // Al guardar, cada línea se valida; las dudosas se corrigen o se quitan en pantalla
    assert.equal((await call('POST', '/api/ventas/confirmar', { filas: v.filas }, t.gerente)).status, 422);
    await data.insert('inventario', { farmaciaId: carol.id, medicamentoId: tio.id, unidades: 5, fechaCorte: '2026-11-10', registradoPor: id.gerente });
    const ok = await call('POST', '/api/ventas/confirmar', { filas: v.filas.slice(0, 2), archivo: 'ventas.csv', fuente: 'plantilla' }, t.gerente);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.insertadas, 2); assert.equal(ok.body.unidades, 42); assert.equal(ok.body.monto, 12 * 450 + 30 * 110, 'precio del archivo o, si falta, el del catálogo');
    const inv = (await data.list('inventario')).filter((x) => x.farmaciaId === carol.id && x.fuente === 'venta');
    assert.equal(inv.length, 1); assert.equal(inv[0].unidades, 17, '5 del último conteo + 12 vendidas'); assert.equal(inv[0].fechaCorte, '2026-11-18');
    const otra = await call('POST', '/api/ventas/confirmar', { filas: v.filas.slice(0, 2) }, t.gerente);
    assert.equal(otra.body.insertadas, 0); assert.equal(otra.body.duplicadas, 2, 'la misma carga no se cuenta dos veces');
    // El vendedor (zona Espaillat) no ve ni carga farmacias de Santiago
    const vv = (await call('POST', '/api/ventas/leer', { archivo }, t.vendedor)).body;
    assert.equal(vv.filas[1].farmaciaId, moca.id); assert.notEqual(vv.filas[0].farmaciaId, carol.id);
    assert.equal((await call('POST', '/api/ventas/confirmar', { filas: [{ ...v.filas[0], factura: 'B0100000099' }] }, t.vendedor)).status, 422);
    assert.equal((await call('GET', '/api/ventas?mes=2026-11', null, t.vendedor)).body.items.length, 1, 'solo las de su zona');
    assert.equal((await call('GET', '/api/ventas?mes=2026-11', null, t.gerente)).body.items.length, 2);
    // Sin IA configurada, un PDF pide usar la plantilla
    assert.equal((await call('POST', '/api/ventas/leer', { archivo: { nombre: 'factura.pdf', tipo: 'application/pdf', base64: 'JVBERi0x' } }, t.gerente)).status, 503);
    assert.equal(ibu.precio, 120);
  } finally { server.close(); }
});

test('ventas con IA: una factura en PDF se lee y se empareja con el catálogo (lector simulado)', async () => {
  let pedido;
  const lector = createLectorIA({ apiKey: 'clave-ejemplo', fetchImpl: async (url, o) => {
    pedido = JSON.parse(o.body);
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'registrar_ventas', input: { filas: [
      { fecha: '2026-11-19', farmacia: 'FARMACIA MOCA CENTRO', municipio: 'Moca', medicamento: 'TIO DEX JARABE 120ML', unidades: 24, precioUnitario: 440, factura: 'B0100000123' },
    ], notas: null } }] }), { status: 200 });
  } });
  const { server, call, t, tio, moca } = await setup(lector);
  try {
    assert.equal((await call('GET', '/api/ventas/estado', null, t.gerente)).body.ia, true);
    const v = (await call('POST', '/api/ventas/leer', { archivo: { nombre: 'factura.pdf', tipo: 'application/pdf', base64: 'JVBERi0xLjQ=' } }, t.gerente)).body;
    assert.equal(v.fuente, 'ia'); assert.equal(v.filas[0].farmaciaId, moca.id); assert.equal(v.filas[0].medicamentoId, tio.id); assert.equal(v.filas[0].precioUnitario, 440);
    assert.equal(pedido.messages[0].content[0].type, 'document'); assert.equal(pedido.tool_choice.name, 'registrar_ventas');
    assert.match(pedido.messages[0].content[1].text, /No inventes datos/);
    const ok = await call('POST', '/api/ventas/confirmar', { filas: v.filas, archivo: 'factura.pdf', fuente: 'ia' }, t.gerente);
    assert.equal(ok.status, 201); assert.equal(ok.body.monto, 24 * 440);
  } finally { server.close(); }
  // Sin saldo en Anthropic: mensaje claro
  const sinSaldo = createLectorIA({ apiKey: 'x', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Your credit balance is too low' } }), { status: 400 }) });
  await assert.rejects(sinSaldo.leerVentas({ tipo: 'application/pdf', base64: 'x' }), /no tiene saldo/);
});

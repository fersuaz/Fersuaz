import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { agruparMovimiento } from '../src/movimiento.js';

const foto = (n) => ({ tipo: 'image/jpeg', nombre: `voucher-${n}.jpg`, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64') });

test('agrupar movimiento: recetas, vouchers y ventas por zona; alerta si se recetó más de lo vendido', () => {
  const precios = new Map([['m1', 200]]); const nombres = new Map([['m1', 'Jarabe Ejemplo']]);
  const r = agruparMovimiento({
    recetas: [{ provincia: 'Espaillat', municipio: 'Moca', items: [{ medicamentoId: 'm1', unidades: 10 }] }],
    vouchers: [{ estado: 'aprobado', dependienteId: 'd1', items: [{ medicamentoId: 'm1', cantidad: 3, monto: 750 }] }, { estado: 'rechazado', dependienteId: 'd1', items: [{ medicamentoId: 'm1', cantidad: 99, monto: 1 }] }, { estado: 'pendiente', dependienteId: 'x', items: [] }],
    ventas: [{ provincia: 'Espaillat', municipio: 'Moca', medicamentoId: 'm1', unidades: 4, precioUnitario: 180 }],
    farmaciaDe: (v) => (v.dependienteId === 'd1' ? { provincia: 'Espaillat', municipio: 'Moca' } : null), precios, nombres,
  });
  assert.equal(r.filas.length, 1);
  assert.deepEqual(r.filas[0], { provincia: 'Espaillat', municipio: 'Moca', medicamentoId: 'm1', medicamento: 'Jarabe Ejemplo', recetadas: 10, recetas: 1, volumenRecetado: 2000, vendidasVoucher: 3, montoVoucher: 750, vouchersPendientes: 0, vendidasLaboratorio: 4, montoLaboratorio: 720, alerta: true });
  assert.equal(r.sinUbicacion, 1); assert.equal(r.porProvincia[0].alertas, 1);
});

test('vouchers y recetas por foto: sin número, sin fotos repetidas; promotora carga vouchers; reporte por territorio', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const far = await data.insert('farmacias', { nombre: 'Farmacia Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', estado: 'validada', fuente: 'manual' });
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, dep: { role: 'dependiente', farmaciaId: far.id }, pro: { role: 'representante', position: 'Promotora' }, vis: { role: 'representante', position: 'Visitador' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await data.insert('zonas', { representanteId: ids.pro, provincias: ['Espaillat'], municipios: {} });
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 200, activo: true });
    const item = { medicamentoId: med.id, cantidad: 2, precio: 250 };

    // Dependiente: sin número, con foto; la misma foto no entra dos veces
    const v1 = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: foto(1), items: [item] }, tok.dep);
    assert.equal(v1.status, 201, JSON.stringify(v1.body)); assert.equal(v1.body.item.referencia, null); assert.ok(v1.body.item.foto.clave);
    const rep = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: foto(1), items: [item] }, tok.dep);
    assert.equal(rep.status, 409); assert.match(rep.body.error, /ya se cargó/);
    assert.equal((await call('POST', '/api/vouchers', { fecha: '2026-11-19', items: [item] }, tok.dep)).status, 422, 'sin foto ni número no');
    // Promotora: a nombre de la dependiente de una farmacia de su zona
    const deps = (await call('GET', '/api/vouchers/dependientes', null, tok.pro)).body.items;
    assert.deepEqual(deps.map((d) => d.id), [ids.dep]);
    assert.equal((await call('POST', '/api/vouchers', { dependienteId: ids.dep, fecha: '2026-11-19', foto: foto(2), items: [{ ...item, cantidad: 1 }] }, tok.pro)).status, 201);
    await data.insert('zonas', { representanteId: ids.vis, provincias: ['Espaillat'], municipios: {} });
    // La misma foto que subió la dependiente no la puede subir otra persona
    const otra = await call('POST', '/api/vouchers', { dependienteId: ids.dep, fecha: '2026-11-19', foto: foto(1), items: [item] }, tok.vis);
    assert.equal(otra.status, 409, 'repetida aunque la cargue el visitador');
    // Reenviada (otro archivo, misma imagen): mismo dHash o casi
    const casi = await call('POST', '/api/vouchers', { dependienteId: ids.dep, fecha: '2026-11-19', foto: foto(4), fotoDhash: 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5', items: [item] }, tok.vis);
    assert.equal(casi.status, 201, JSON.stringify(casi.body));
    const reenvio = await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: foto(5), fotoDhash: 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a4', items: [item] }, tok.dep);
    assert.equal(reenvio.status, 409); assert.match(reenvio.body.error, /igual a otra ya cargada/);
    // Verificar antes de enviar
    const h1 = v1.body.item.fotoHuella;
    const ver = await call('POST', '/api/fotos/verificar', { tipo: 'voucher', fotos: [{ huella: h1 }, { huella: 'b'.repeat(64), dhash: '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' }, { dhash: 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a7' }] }, tok.pro);
    assert.deepEqual(ver.body.repetidas.map((x) => [x.indice, x.motivo]), [[0, 'igual'], [2, 'parecida']]);
    assert.equal((await call('POST', '/api/fotos/verificar', { tipo: 'receta', fotos: [] }, tok.dep)).status, 403);
    // Un voucher anulado libera su foto
    await call('POST', `/api/vouchers/${casi.body.item.id}/anular`, null, tok.vis);
    assert.equal((await call('POST', '/api/vouchers', { fecha: '2026-11-19', foto: foto(5), fotoDhash: 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a4', items: [item] }, tok.dep)).status, 201);
    assert.equal((await call('GET', '/api/vouchers', null, tok.pro)).body.items.length, 1, 'la promotora ve los que cargó');
    assert.equal((await call('POST', '/api/vouchers', { dependienteId: ids.dep, fecha: '2026-11-19', foto: foto(8), items: [item] }, tok.ger)).status, 403);

    // Receta por foto: no se repite la misma foto
    const op = (await call('POST', '/api/operativos', { provincia: 'Espaillat', municipio: 'Moca', centro: 'Hospital Ejemplo' }, tok.pro)).body.item;
    const m = (await call('POST', '/api/catalogo/medicos', { nombre: 'Ana Ejemplo', especialidad: 'Pediatría', provincia: 'Espaillat', municipio: 'Moca' }, tok.pro)).body.item;
    const receta = { operativoId: op.id, medicoId: m.id, paciente: { telefono: '8095550101', nombre: 'Paciente Ejemplo' }, items: [{ medicamentoId: med.id, unidades: 10 }], adjunto: foto(9) };
    const r1 = await call('POST', '/api/recetas', receta, tok.pro);
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    const r2 = await call('POST', '/api/recetas', receta, tok.pro);
    assert.equal(r2.status, 409); assert.match(r2.body.error, /ya se cargó como receta/);

    // Reporte por territorio
    assert.equal((await call('GET', '/api/reportes/territorio?mes=2026-11', null, tok.pro)).status, 403);
    const rpt = (await call('GET', '/api/reportes/territorio?mes=2026-11', null, tok.ger)).body;
    assert.equal(rpt.filas.length, 1);
    assert.deepEqual([rpt.filas[0].recetadas, rpt.filas[0].volumenRecetado, rpt.filas[0].vendidasVoucher, rpt.filas[0].montoVoucher, rpt.filas[0].alerta], [10, 2000, 5, 1250, true]);
    assert.equal(rpt.ranking[0].medico, 'Ana Ejemplo'); assert.equal(rpt.ranking[0].volumen, 2000);
    assert.equal(rpt.totales.vouchers, 3);
    assert.equal((await call('GET', '/api/reportes/territorio?mes=2026-11&provincia=La Vega', null, tok.ger)).body.filas.length, 0);
  } finally { server.close(); }
});

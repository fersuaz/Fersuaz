import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { copiarFechas } from '../src/propuesta-cronograma.js';
import { precioHotelPlan } from '../src/viaticos.js';

const todo = { basicos: true, aire: true, agua: true, cama: true, higiene: true, parqueo: true, seguridad: true };

test('copiar fechas: mismo día de la semana y mismo número en el mes', () => {
  // Noviembre 2026: 3 = 1.er martes, 30 = 5.º lunes. Diciembre 2026: 1 = 1.er martes, no hay 5.º lunes.
  const r = copiarFechas('2026-12', ['2026-11-03', '2026-11-11', '2026-11-30']);
  assert.deepEqual(r.mapa, [{ desde: '2026-11-03', fecha: '2026-12-01' }, { desde: '2026-11-11', fecha: '2026-12-09' }]);
  assert.deepEqual(r.sinDia, ['2026-11-30']);
  assert.deepEqual(copiarFechas('2027-01', ['2026-12-15', '2026-12-31']), { mapa: [{ desde: '2026-12-15', fecha: '2027-01-19' }], sinDia: ['2026-12-31'] }, 'cambio de año');
});

test('precio de la noche: hotel elegido, verificado, referencia por provincia, general', () => {
  const hoteles = [{ id: 'h1', nombre: 'Hotel Ejemplo', provincia: 'La Vega', municipio: 'Jarabacoa', precioNoche: 2300, requisitos: todo, estado: 'activo' }];
  const ref = { global: 1800, porProvincia: { Espaillat: 2000 } };
  assert.equal(precioHotelPlan({ hoteles, referencia: ref, provincia: 'Espaillat', hotelId: 'h1' }).fuente, 'hotel');
  const v = precioHotelPlan({ hoteles, referencia: ref, provincia: 'La Vega', municipio: 'Jarabacoa' });
  assert.deepEqual([v.precio, v.fuente, v.hotel], [2300, 'verificado', 'Hotel Ejemplo']);
  assert.deepEqual([precioHotelPlan({ hoteles, referencia: ref, provincia: 'Espaillat' }).precio, precioHotelPlan({ hoteles, referencia: ref, provincia: 'Espaillat' }).fuente], [2000, 'referencia-provincia']);
  assert.equal(precioHotelPlan({ hoteles, referencia: ref, provincia: 'Santiago' }).fuente, 'referencia-global');
  assert.equal(precioHotelPlan({ hoteles, referencia: {}, provincia: 'Santiago' }).precio, null);
});

test('noche fuera en el cronograma entra al presupuesto; copiar el mes anterior', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const mapas = { activo: true, async ruta(o, ps) { return { km: 100, minutos: 90, tramos: [], orden: ps.map((_, i) => i) }; } };
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), mapas, sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-02T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ adm: { role: 'administrador' }, ger: { role: 'gerencia' }, rep: { role: 'representante', position: 'Visitador' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega' }, vehiculo: { propiedad: 'asignado', combustible: 'gasolina_regular', rendimiento: 30 }, tarifaAlimentacion: 400 }, tok.ger);
    await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['Espaillat', 'La Vega'] }, tok.ger);
    await data.insert('precios', { combustible: 'gasolina_regular', precioGalon: 290, vigenteDesde: '2026-10-01', fuente: 'manual' });
    const moca = await data.insert('establecimientos', { tipo: 'hospital', nombre: 'Hospital Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });
    const jar = await data.insert('establecimientos', { tipo: 'unap', nombre: 'UNAP Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', estado: 'validado', fuente: 'manual' });
    const hotel = await data.insert('hoteles', { nombre: 'Hotel Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', precioNoche: 2300, requisitos: todo, fuente: 'manual', estado: 'activo' });
    const l = (x) => ({ refTipo: 'establecimiento', refId: x.id });

    // Moca: noche fuera sin hotel verificado → falta el precio hasta poner la referencia
    const c1 = await call('POST', '/api/cronogramas/lote', { representanteId: ids.rep, dias: [{ fecha: '2026-11-03', lugares: [l(moca)], duermeFuera: true }, { fecha: '2026-11-04', lugares: [l(jar)], duermeFuera: true }, { fecha: '2026-11-05', lugares: [l(moca)] }] }, tok.adm);
    assert.equal(c1.status, 201, JSON.stringify(c1.body));
    let p = (await call('GET', `/api/viaticos/presupuesto?representanteId=${ids.rep}&mes=2026-11`, null, tok.ger)).body;
    assert.match(JSON.stringify(p), /no hay hotel verificado ni precio de referencia/);
    assert.equal((await call('POST', '/api/viaticos/hotel-referencia', { global: 1800, porProvincia: { Espaillat: 2000 } }, tok.rep)).status, 403);
    assert.equal((await call('POST', '/api/viaticos/hotel-referencia', { global: -5 }, tok.ger)).status, 422);
    await call('POST', '/api/viaticos/hotel-referencia', { global: 1800, porProvincia: { Espaillat: 2000 } }, tok.ger);
    p = (await call('GET', `/api/viaticos/presupuesto?representanteId=${ids.rep}&mes=2026-11`, null, tok.ger)).body;
    const total = (o) => JSON.stringify(o).match(/"hospedaje":(\d+(\.\d+)?)/g);
    assert.ok(JSON.stringify(p).includes('"hospedaje":4300'), `Moca 2000 (referencia) + Jarabacoa 2300 (verificado): ${total(p)}`);

    // Quitar la noche de un día ya aprobado
    const dia = c1.body.items.find((c) => c.fecha === '2026-11-03');
    assert.equal((await call('POST', `/api/cronogramas/${dia.id}/hotel`, { duermeFuera: false }, tok.rep)).status, 403);
    await call('POST', `/api/cronogramas/${dia.id}/hotel`, { duermeFuera: false }, tok.ger);
    p = (await call('GET', `/api/viaticos/presupuesto?representanteId=${ids.rep}&mes=2026-11`, null, tok.ger)).body;
    assert.ok(JSON.stringify(p).includes('"hospedaje":2300'), total(p));

    // Copiar a diciembre: mismo día de la semana, mismas noches fuera, nada guardado aún
    const cp = await call('POST', '/api/cronogramas/copiar-mes-anterior', { representanteId: ids.rep, mes: '2026-12' }, tok.adm);
    assert.equal(cp.status, 200, JSON.stringify(cp.body));
    assert.deepEqual(cp.body.item.dias.map((d) => [d.desde, d.fecha, d.duermeFuera]), [['2026-11-03', '2026-12-01', false], ['2026-11-04', '2026-12-02', true], ['2026-11-05', '2026-12-03', false]]);
    assert.equal((await data.list('cronogramas')).length, 3);
    const ok = await call('POST', '/api/cronogramas/lote', { representanteId: ids.rep, dias: cp.body.item.dias }, tok.adm);
    assert.equal(ok.status, 201); assert.equal(ok.body.items.filter((c) => c.duermeFuera).length, 1);
    const otra = await call('POST', '/api/cronogramas/copiar-mes-anterior', { representanteId: ids.rep, mes: '2026-12' }, tok.adm);
    assert.equal(otra.body.item.dias.length, 0); assert.equal(otra.body.item.omitidos.length, 3, 'no duplica días ya programados');
    assert.equal((await call('POST', '/api/cronogramas/copiar-mes-anterior', { representanteId: ids.rep, mes: '2027-02' }, tok.adm)).status, 409, 'enero vacío');
  } finally { server.close(); }
});

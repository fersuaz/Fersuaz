import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { descontarDesayunos } from '../src/calculos.js';

const todo = { basicos: true, aire: true, agua: true, cama: true, higiene: true, parqueo: true, seguridad: true };

test('desayuno incluido: se descuenta de la comida de ese día y nunca la deja en negativo', () => {
  const comida = [{ fecha: '2026-11-03', monto: 500 }, { fecha: '2026-11-04', monto: 500 }, { fecha: '2026-11-05', monto: 200 }];
  assert.deepEqual(descontarDesayunos(comida, { '2026-11-03': 300, '2026-11-05': 500 }), { descuento: 500, noches: 2, porDia: [{ fecha: '2026-11-03', descuento: 300 }, { fecha: '2026-11-05', descuento: 200 }] });
  assert.deepEqual(descontarDesayunos(comida, {}), { descuento: 0, noches: 0, porDia: [] });
  assert.equal(descontarDesayunos(comida, { '2026-11-09': 300 }).descuento, 0, 'sin día de trabajo no hay comida que rebajar');
});

test('hotel con desayuno: la gerencia lo marca y la comida del presupuesto baja ese día', async () => {
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
    await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega' }, vehiculo: { propiedad: 'asignado', combustible: 'gasolina_regular', rendimiento: 30 }, tarifaAlimentacion: 500 }, tok.ger);
    await call('POST', `/api/territorio/zonas/${ids.rep}`, { provincias: ['La Vega'] }, tok.ger);
    await data.insert('precios', { combustible: 'gasolina_regular', precioGalon: 290, vigenteDesde: '2026-10-01', fuente: 'manual' });
    const jar = await data.insert('establecimientos', { tipo: 'unap', nombre: 'UNAP Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', estado: 'validado', fuente: 'manual' });
    const hotel = await data.insert('hoteles', { nombre: 'Hotel Ejemplo Jarabacoa', provincia: 'La Vega', municipio: 'Jarabacoa', precioNoche: 2300, requisitos: todo, fuente: 'manual', estado: 'activo' });
    const l = { refTipo: 'establecimiento', refId: jar.id };
    assert.equal((await call('POST', '/api/cronogramas/lote', { representanteId: ids.rep, dias: [{ fecha: '2026-11-03', lugares: [l], duermeFuera: true }, { fecha: '2026-11-04', lugares: [l] }] }, tok.adm)).status, 201);
    const comida = async () => (await call('GET', `/api/viaticos/presupuesto?representanteId=${ids.rep}&mes=2026-11`, null, tok.ger)).body.calculo;
    let c = await comida();
    assert.equal(c.detalle.alimentacion, 1000, '2 días × RD$500');
    assert.equal(c.supuestos.desayunos, null);

    // Con desayuno pero sin valor ni desayuno propio del representante: avisa y no rebaja
    assert.equal((await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: true }, tok.ger)).status, 200);
    c = await comida();
    assert.equal(c.detalle.alimentacion, 1000); assert.match(c.avisos.join(' '), /incluye desayuno, pero no se sabe cuánto rebajar/);
    assert.equal(c.faltan.length, 0, 'es un aviso, no bloquea asignar');
    assert.equal((await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: true, valorDesayuno: -1 }, tok.ger)).status, 422);
    assert.equal((await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: true, valorDesayuno: 300 }, tok.rep)).status, 403);
    const h = await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: true, valorDesayuno: 300 }, tok.ger);
    assert.deepEqual([h.body.item.desayunoIncluido, h.body.item.valorDesayuno], [true, 300]);
    c = await comida();
    assert.equal(c.detalle.alimentacion, 700, 'la noche del 3 en el hotel con desayuno rebaja RD$300');
    assert.deepEqual(c.supuestos.desayunos, { noches: 1, descuento: 300, porDia: [{ fecha: '2026-11-03', descuento: 300, hotel: 'Hotel Ejemplo Jarabacoa' }] });
    assert.equal(c.supuestos.comidaBruta, 1000);
    assert.equal(c.supuestos.porDia.find((d) => d.fecha === '2026-11-03').noche.desayuno, 300);
    assert.equal(c.supuestos.semanas.reduce((s, w) => s + w.alimentacion, 0), 700, 'el cuadro por semana cuadra con el total');

    await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: false }, tok.ger);
    assert.equal((await comida()).detalle.alimentacion, 1000, 'sin desayuno vuelve a la comida completa');
    // Comprobante fiscal sin ITBIS en el precio: la noche de RD$2,300 entra como RD$2,714 (2,300 + 18%)
    assert.equal((await comida()).detalle.hospedaje, 2300);
    assert.equal((await call('POST', `/api/hoteles/${hotel.id}`, { comprobanteFiscal: true }, tok.ger)).status, 422, 'pide si incluye el ITBIS');
    const it = await call('POST', `/api/hoteles/${hotel.id}`, { comprobanteFiscal: true, precioIncluyeItbis: false }, tok.ger);
    assert.deepEqual([it.body.item.precioFinal, it.body.item.itbis], [2714, 414]);
    assert.equal((await comida()).detalle.hospedaje, 2714);
    await call('POST', `/api/hoteles/${hotel.id}`, { comprobanteFiscal: true, precioIncluyeItbis: true }, tok.ger);
    assert.equal((await comida()).detalle.hospedaje, 2300);
    await call('POST', `/api/hoteles/${hotel.id}`, { comprobanteFiscal: false }, tok.ger);

    // Comida desglosada del representante: la comida del día es la suma y se rebaja SU desayuno (no el del hotel)
    const perfil = { residencia: { provincia: 'La Vega', municipio: 'Concepción de La Vega' }, vehiculo: { propiedad: 'asignado', combustible: 'gasolina_regular', rendimiento: 30 } };
    assert.equal((await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { ...perfil, comidaDesglose: { desayuno: 'x', almuerzo: 400 } }, tok.ger)).status, 422);
    assert.equal((await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { ...perfil, comidaDesglose: { desayuno: '', almuerzo: '', cena: '' }, tarifaAlimentacion: 500 }, tok.ger)).status, 200, 'vacío = un monto por día');
    const g = await call('POST', `/api/viaticos/perfiles/${ids.rep}`, { ...perfil, comidaDesglose: { desayuno: 250, almuerzo: 400, cena: 350 } }, tok.ger);
    assert.equal(g.status, 200); assert.equal(g.body.item.tarifaAlimentacion, 1000);
    await call('POST', `/api/hoteles/${hotel.id}`, { desayunoIncluido: true, valorDesayuno: 300 }, tok.ger);
    c = await comida();
    assert.equal(c.detalle.alimentacion, 1750, '2 días × RD$1,000 − desayuno propio RD$250');
    assert.deepEqual(c.supuestos.comidaDesglose, { desayuno: 250, almuerzo: 400, cena: 350 });
  } finally { server.close(); }
});

import { precioFinal, elegirHotel } from '../src/hoteles.js';

test('ITBIS: con comprobante fiscal y precio sin ITBIS se suma el 18%; en los demás casos el precio queda igual', () => {
  assert.equal(precioFinal({ precioNoche: 2000, comprobanteFiscal: true, precioIncluyeItbis: false }), 2360);
  assert.equal(precioFinal({ precioNoche: 2000, comprobanteFiscal: true, precioIncluyeItbis: true }), 2000);
  assert.equal(precioFinal({ precioNoche: 2000, comprobanteFiscal: false }), 2000);
  assert.equal(precioFinal({ precioNoche: 1500.5, comprobanteFiscal: true, precioIncluyeItbis: false }), 1770.59);
  assert.equal(precioFinal({ precioNoche: null }), null);
  // El recomendado compara el precio final: 2,100 con ITBIS incluido gana a 2,000 + 18%
  const req = { basicos: true, aire: true, agua: true, cama: true, higiene: true, parqueo: true, seguridad: true };
  const r = elegirHotel([{ id: 'a', nombre: 'A', provincia: 'P', municipio: 'M', precioNoche: 2000, comprobanteFiscal: true, precioIncluyeItbis: false, requisitos: req },
    { id: 'b', nombre: 'B', provincia: 'P', municipio: 'M', precioNoche: 2100, comprobanteFiscal: true, precioIncluyeItbis: true, requisitos: req }], 'P', 'M');
  assert.equal(r.hotel.id, 'b');
});

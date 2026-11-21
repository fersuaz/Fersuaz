// Cálculos nuevos: tope de combustible, hotel recomendado y reparto del cronograma (reglas puras).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarTope, CalculoError } from '../src/calculos.js';
import { elegirHotel, requisitosFaltantes, REQUISITOS } from '../src/hoteles.js';
import { diasLaborables, proponer, distanciaKm } from '../src/propuesta-cronograma.js';
import { dentroDeZona } from '../src/territorio.js';

test('tope de combustible: se paga lo calculado hasta el tope y se informa el excedente', () => {
  assert.deepEqual(aplicarTope({ calculado: 6000, tope: 5000 }), { aplicado: 5000, excedente: 1000, topado: true });
  assert.deepEqual(aplicarTope({ calculado: 4200.5, tope: 5000 }), { aplicado: 4200.5, excedente: 0, topado: false });
  assert.deepEqual(aplicarTope({ calculado: 5000, tope: 5000 }), { aplicado: 5000, excedente: 0, topado: false });
  assert.deepEqual(aplicarTope({ calculado: 3000, tope: null }), { aplicado: 3000, excedente: 0, topado: false }, 'sin tope se paga lo calculado');
  assert.throws(() => aplicarTope({ calculado: 3000, tope: 0 }), CalculoError);
  assert.throws(() => aplicarTope({ calculado: -1, tope: 100 }), CalculoError);
});

const todo = Object.fromEntries(Object.keys(REQUISITOS).map((k) => [k, true]));
const H = (nombre, municipio, precioNoche, req = todo, extra = {}) => ({ nombre, provincia: 'Espaillat', municipio, precioNoche, requisitos: req, estado: 'activo', ...extra });

test('hotel recomendado: el más económico que cumple todos los requisitos, primero en el mismo municipio', () => {
  const hs = [
    H('Hotel Ejemplo A', 'Moca', 2000), H('Hotel Ejemplo B', 'Moca', 1500, { ...todo, parqueo: false }), H('Hotel Ejemplo C', 'Moca', 1800),
    H('Hotel Ejemplo D', 'Gaspar Hernández', 1200), H('Hotel Ejemplo E', 'Moca', null), H('Hotel Ejemplo F', 'Moca', 900, todo, { estado: 'inactivo' }),
  ];
  assert.equal(elegirHotel(hs, 'Espaillat', 'Moca').hotel.nombre, 'Hotel Ejemplo C');
  assert.equal(elegirHotel(hs, 'Espaillat', 'Moca').alcance, 'municipio');
  assert.deepEqual(elegirHotel(hs, 'Espaillat', 'Jamao al Norte'), { hotel: hs[3], alcance: 'provincia' }, 'sin hotel en el municipio, el mejor de la provincia');
  assert.equal(elegirHotel(hs, 'Santiago', 'Santiago de los Caballeros'), null);
  // A igual precio gana la mejor calificación
  assert.equal(elegirHotel([H('Uno', 'Moca', 1000, todo, { calificacion: 3.9 }), H('Dos', 'Moca', 1000, todo, { calificacion: 4.5 })], 'Espaillat', 'Moca').hotel.nombre, 'Dos');
  assert.deepEqual(requisitosFaltantes(H('X', 'Moca', 1, { aire: true })), Object.keys(REQUISITOS).filter((k) => k !== 'aire'), 'lo no confirmado cuenta como faltante');
});

test('zona: provincia completa o solo los municipios elegidos', () => {
  const z = { provincias: ['Espaillat', 'Santiago'], municipios: { Santiago: ['Tamboril'] } };
  assert.ok(dentroDeZona(z, 'Espaillat', 'Moca'));
  assert.ok(dentroDeZona(z, 'Santiago', 'Tamboril'));
  assert.ok(!dentroDeZona(z, 'Santiago', 'Licey al Medio'));
  assert.ok(!dentroDeZona(z, 'La Vega', 'Jarabacoa'));
  assert.ok(!dentroDeZona(null, 'Espaillat', 'Moca'));
});

test('días laborables: lunes a viernes desde hoy, sin los ya programados', () => {
  assert.deepEqual(diasLaborables('2026-11', { desde: '2026-11-20' }), ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30']);
  assert.deepEqual(diasLaborables('2026-11', { desde: '2026-11-26', excluir: ['2026-11-27'], sabados: true }), ['2026-11-26', '2026-11-28', '2026-11-30']);
});

test('propuesta: empieza en el municipio de residencia, agrupa por cercanía y no pasa del máximo por día', () => {
  const L = (id, municipio, provincia, lat, lng) => ({ refTipo: 'farmacia', refId: id, lugar: `Lugar ${id}`, municipio, provincia, lat, lng });
  const lugares = [
    L('t1', 'Tamboril', 'Santiago', 19.485, -70.611), L('m1', 'Moca', 'Espaillat', 19.394, -70.525), L('m2', 'Moca', 'Espaillat', 19.390, -70.520),
    L('g1', 'Gaspar Hernández', 'Espaillat', 19.627, -70.278), L('m3', 'Moca', 'Espaillat', 19.399, -70.530), { refTipo: 'establecimiento', refId: 's1', lugar: 'Sin ubicación', municipio: 'Moca', provincia: 'Espaillat' },
  ];
  const r = proponer({ lugares, residencia: { provincia: 'Espaillat', municipio: 'Moca' }, fechas: ['2026-11-23', '2026-11-24', '2026-11-25'], porDia: 4 });
  assert.equal(r.dias.length, 2);
  assert.deepEqual(r.dias[0].lugares.map((l) => l.refId).slice(0, 4).every((x) => ['m1', 'm2', 'm3', 's1'].includes(x)), true, 'el primer día es todo Moca');
  assert.equal(r.dias[1].lugares[0].refId, 't1', 'Tamboril está más cerca de Moca que Gaspar Hernández');
  assert.equal(r.sinDia.length, 0);
  const corto = proponer({ lugares, residencia: null, fechas: ['2026-11-23'], porDia: 2 });
  assert.equal(corto.dias.length, 1); assert.equal(corto.sinDia.length, 4, 'lo que no cabe se informa');
  assert.ok(Math.abs(distanciaKm({ lat: 19.394, lng: -70.525 }, { lat: 19.485, lng: -70.611 }) - 13.5) < 1.5);
});

test('posible error de Google: direcciones, negocios ajenos y nombres sin palabra de salud', async () => {
  const { posibleError } = await import('../src/territorio.js');
  for (const n of ['5 de mayo #258', 'AgnusDei Experience Recovery & Spa', 'Calle Duarte 12', 'J3RR+996', 'Hotel Ejemplo', 'Colmado Ejemplo', 'AgusDei']) assert.equal(posibleError(n), true, n);
  for (const n of ['Clínica Ejemplo', 'Hospital Municipal Ejemplo', 'UNAP Ejemplo', 'Centro Médico Ejemplo', 'Consultorio Dr. Ejemplo', 'Ac. Dental. Odontología Especializada', 'Laboratorio Clínico Ejemplo', 'Policlínica Ejemplo'])
    assert.equal(posibleError(n), false, n);
});

test('transporte público: días dentro y fuera de su municipio según las paradas', async () => {
  const { calcularTransportePublico, mpgAKmPorGalon } = await import('../src/calculos.js');
  const casa = { provincia: 'Espaillat', municipio: 'Moca' };
  const J = (fecha, munis, conAlimentacion = true) => ({ fecha, conAlimentacion, paradas: munis.map((m) => ({ provincia: 'Espaillat', municipio: m })) });
  const r = calcularTransportePublico({
    jornadas: [J('2026-11-23', ['Moca']), J('2026-11-24', ['Moca', 'Gaspar Hernández']), J('2026-11-25', ['Moca'], false), J('2026-11-26', ['San Víctor'])],
    residencia: casa, tarifas: { transporteDentro: 150, comidaDentro: 300, transporteFuera: 500, comidaFuera: 450 },
  });
  assert.equal(r.diasDentro, 2); assert.equal(r.diasFuera, 2);
  assert.equal(r.transporte, 2 * 150 + 2 * 500);
  assert.equal(r.alimentacion, 1 * 300 + 2 * 450, 'el 25 no lleva comida');
  assert.deepEqual(r.dias.map((d) => d.fuera), [false, true, false, true]);
  // Con zona de trabajo: vive en Moca pero trabaja en Gaspar Hernández y San Víctor; Moca cuenta como fuera.
  const zona = new Set(['Gaspar Hernández', 'San Víctor']);
  const z = calcularTransportePublico({ jornadas: [J('2026-11-23', ['Gaspar Hernández', 'San Víctor']), J('2026-11-24', ['Moca'])], esDentro: (p) => zona.has(p.municipio), residencia: casa, tarifas: { transporteDentro: 150, comidaDentro: 300, transporteFuera: 500, comidaFuera: 450 } });
  assert.deepEqual([z.diasDentro, z.diasFuera], [1, 1]);
  assert.throws(() => calcularTransportePublico({ jornadas: [], residencia: casa, tarifas: { transporteDentro: 1, comidaDentro: 1, transporteFuera: null, comidaFuera: 1 } }));
  // EPA: millas por galón (EE. UU.) a km por galón
  assert.equal(mpgAKmPorGalon(30), 48.3); assert.equal(mpgAKmPorGalon(41), 66);
});

test('vehículos EPA: lee menús y ficha en JSON o XML', async () => {
  const { leerMenu, leerFicha } = await import('../src/vehiculos.js');
  assert.deepEqual(leerMenu({ menuItem: [{ text: 'Toyota', value: 'Toyota' }] }), [{ texto: 'Toyota', valor: 'Toyota' }]);
  assert.deepEqual(leerMenu({ menuItem: { text: 'Auto 6-spd, 4 cyl, 2.5 L', value: '45000' } }), [{ texto: 'Auto 6-spd, 4 cyl, 2.5 L', valor: '45000' }]);
  assert.deepEqual(leerMenu('<menuItems><menuItem><text>Corolla</text><value>Corolla</value></menuItem></menuItems>'), [{ texto: 'Corolla', valor: 'Corolla' }]);
  const f = leerFicha({ id: '45000', year: '2022', make: 'Toyota', model: 'Corolla', comb08: '34', city08: '31', highway08: '38', fuelType1: 'Regular Gasoline', displ: '1.8', cylinders: '4', trany: 'Automatic (AV-S10)' });
  assert.equal(f.kmPorGalon, 54.7); assert.equal(f.combustible, 'gasolina_regular'); assert.equal(f.motor, '1.8 L, 4 cil., Automatic (AV-S10)');
  assert.equal(leerFicha('<vehicle><id>1</id><comb08>25</comb08><fuelType1>Diesel</fuelType1></vehicle>').combustible, 'gasoil_regular');
  assert.equal(leerFicha({ comb08: '0' }), null);
});

test('versiones de la EPA en palabras claras', async () => {
  const { traducirVersion } = await import('../src/vehiculos.js');
  assert.equal(traducirVersion('Auto 8-spd, 6 cyl, 3.8 L'), 'Automática de 8 velocidades, 6 cilindros, motor de 3.8 L');
  assert.equal(traducirVersion('Man 6-spd, 4 cyl, 1.6 L, Turbo'), 'Manual de 6 velocidades, 4 cilindros, motor de 1.6 L, turbo');
  assert.equal(traducirVersion('Auto (S6), 4 cyl, 2.4 L, SIDI'), 'Automática de 6 velocidades, 4 cilindros, motor de 2.4 L');
  assert.equal(traducirVersion('Auto(AM7), 4 cyl, 1.6 L, Turbo'), 'Automática de doble embrague de 7 velocidades, 4 cilindros, motor de 1.6 L, turbo');
  assert.equal(traducirVersion('Auto (variable gear ratios), 4 cyl, 1.8 L, Hybrid'), 'Automática CVT (sin cambios fijos), 4 cilindros, motor de 1.8 L, híbrido');
  assert.equal(traducirVersion('Auto (A1), 4 cyl, 2.0 L, PHEV'), 'Automática de una velocidad, 4 cilindros, motor de 2.0 L, híbrido enchufable');
});

test('alta: usuario a partir del nombre y clave temporal con letras y números', async () => {
  const { usuarioBase, claveTemporal } = await import('../src/representantes.js');
  assert.equal(usuarioBase('José Miguel', 'Pérez de la Cruz'), 'jperez');
  assert.equal(usuarioBase('Ana', 'Núñez'), 'anunez');
  for (let i = 0; i < 50; i++) { const c = claveTemporal(); assert.equal(c.length, 10); assert.match(c, /[A-Za-z]/); assert.match(c, /\d/); assert.doesNotMatch(c, /[0O1lI]/); }
});

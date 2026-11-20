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

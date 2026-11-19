import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCombustible, calcularAlimentacion, calcularNoches, calcularHospedaje,
  calcularPresupuesto, detectarDuplicados, CalculoError,
} from '../src/calculos.js';

// Casos del Prompt Maestro, sección 13 (datos de prueba, no valores reales).
test('combustible: 2,100 km / 35 km/gal × RD$250 = 60 gal, RD$15,000', () => {
  assert.deepEqual(calcularCombustible({ kilometros: 2100, rendimientoKmGalon: 35, precioGalon: 250 }), { galones: 60, costo: 15000 });
});
test('alimentación: RD$500 × 21 = RD$10,500', () => assert.equal(calcularAlimentacion({ tarifaDiaria: 500, diasElegibles: 21 }), 10500));
test('hospedaje: 3 noches × RD$2,500 = RD$7,500', () => assert.equal(calcularHospedaje({ noches: 3, tarifaNoche: 2500 }), 7500));
test('presupuesto total RD$36,000', () => {
  const r = calcularPresupuesto({ combustible: 15000, alimentacion: 10500, hospedaje: 7500, peajes: 2000, otros: 1000 });
  assert.equal(r.total, 36000);
});

test('cero kilómetros cuesta cero', () => assert.deepEqual(calcularCombustible({ kilometros: 0, rendimientoKmGalon: 35, precioGalon: 250 }), { galones: 0, costo: 0 }));
test('rendimiento cero o negativo se rechaza', () => {
  assert.throws(() => calcularCombustible({ kilometros: 10, rendimientoKmGalon: 0, precioGalon: 250 }), CalculoError);
  assert.throws(() => calcularCombustible({ kilometros: 10, rendimientoKmGalon: -5, precioGalon: 250 }), CalculoError);
});
test('precio negativo se rechaza', () => assert.throws(() => calcularCombustible({ kilometros: 10, rendimientoKmGalon: 30, precioGalon: -1 }), CalculoError));
test('datos vacíos se rechazan', () => assert.throws(() => calcularCombustible({}), CalculoError));
test('redondeo a centavos', () => assert.deepEqual(calcularCombustible({ kilometros: 100, rendimientoKmGalon: 3, precioGalon: 100 }), { galones: 33.33, costo: 3333.33 }));
test('noches reales y fechas incorrectas', () => {
  assert.equal(calcularNoches('2026-11-02', '2026-11-05'), 3);
  assert.throws(() => calcularNoches('2026-11-05', '2026-11-02'), CalculoError);
  assert.throws(() => calcularNoches('ayer', '2026-11-02'), CalculoError);
});
test('el salario no entra en viáticos', () => assert.throws(() => calcularPresupuesto({ salario: 40000 }), CalculoError));
test('detecta gastos duplicados', () => {
  const g = { fecha: '2026-11-03', categoria: 'peajes', monto: 100, referencia: 'T-1' };
  assert.equal(detectarDuplicados([g, { ...g, referencia: ' t-1 ' }, { ...g, monto: 60 }]).length, 1);
});

import { calcularComisionVouchers, evaluarAlertaInventario } from '../src/calculos.js';

test('PDF: 100 vouchers de Tio Dex × RD$500 al 10 % = RD$5,000 de comisión', () => {
  const vouchers = Array.from({ length: 100 }, () => ({ items: [{ medicamento: 'Tio Dex', monto: 500 }] }));
  const r = calcularComisionVouchers(vouchers, 10);
  assert.equal(r.ventas, 50000); assert.equal(r.comision, 5000); assert.equal(r.porMedicamento['Tio Dex'], 50000);
});
test('voucher vacío o porcentaje inválido se rechaza', () => {
  assert.throws(() => calcularComisionVouchers([{ items: [] }], 10), CalculoError);
  assert.throws(() => calcularComisionVouchers([], 150), CalculoError);
});
test('PDF: alerta cuando recetas alcanzan 75 % del inventario', () => {
  assert.equal(evaluarAlertaInventario({ unidadesRecetadas: 18, unidadesDisponibles: 25 }).alerta, false);
  const r = evaluarAlertaInventario({ unidadesRecetadas: 50, unidadesDisponibles: 25 });
  assert.equal(r.alerta, true); assert.equal(r.faltante, 25);
  assert.equal(evaluarAlertaInventario({ unidadesRecetadas: 19, unidadesDisponibles: 25 }).alerta, true);
  assert.equal(evaluarAlertaInventario({ unidadesRecetadas: 3, unidadesDisponibles: 0 }).alerta, true);
});

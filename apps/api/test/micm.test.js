import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vigenciaDeTitulo, avisoMasReciente, preciosDePdf, preciosDeLineas, actualizarDesdeMicm, URL_AVISOS } from '../src/combustible-micm.js';
import { lineasPdf } from '../src/pdf-texto.js';
import { MemoryData } from '../src/data.js';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
// Ejemplo: valores del aviso del MICM del 14 al 20 de noviembre de 2026, maquetados en un PDF de prueba.
const ESPERADO = { gasolina_premium: 362.1, gasolina_regular: 317.5, gasoil_optimo: 322.1, gasoil_regular: 270.8, glp: 135.2 };

test('vigencia: lee los tres formatos de título del MICM', () => {
  assert.deepEqual(vigenciaDeTitulo('del 14 al 20 de noviembre del 2026'), { desde: '2026-11-14', hasta: '2026-11-20' });
  assert.deepEqual(vigenciaDeTitulo('del 31 de octubre al 06 noviembre del 2026'), { desde: '2026-10-31', hasta: '2026-11-06' });
  assert.deepEqual(vigenciaDeTitulo('del 27 de diciembre del 2025 al 02 de enero del 2026'), { desde: '2025-12-27', hasta: '2026-01-02' });
  assert.deepEqual(vigenciaDeTitulo('del 27 de diciembre al 02 de enero del 2026'), { desde: '2025-12-27', hasta: '2026-01-02' });
  assert.equal(vigenciaDeTitulo('semana próxima'), null);
});

test('listado: toma el aviso más reciente y su PDF', () => {
  const a = avisoMasReciente(fx('listado-micm-ejemplo.html').toString());
  assert.equal(a.desde, '2026-11-14');
  assert.equal(a.pdf, 'https://micm.gob.do/wp-content/uploads/2026/11/AVISO-PRE.-SEM.CORTE-14-20-NOV-DE-2026.pdf');
});

test('PDF: reconstruye filas por posición y verifica que los componentes sumen el precio oficial', () => {
  const lineas = lineasPdf(fx('aviso-ejemplo-libreoffice.pdf'))[0].map((l) => l.texto);
  assert.ok(lineas.some((l) => l.startsWith('Gasoil Regular 173.56')));
  const { precios, detalle } = preciosDePdf(fx('aviso-ejemplo-libreoffice.pdf'));
  assert.deepEqual(precios, ESPERADO);
  assert.deepEqual(detalle.gasoil_regular, { oficial: 274.1, ajuste: -3.3, componentes: [173.56, 28.06, 27.77, 14.28, 23.75, 6.68] });
});

test('PDF: si la suma no cuadra, no inventa el precio', () => {
  const malas = [[{ texto: 'Gasolina Premium 210.87 71.85 33.74 16.59 27.07 6.68 999.99 (4.70) 0.00' }]];
  assert.deepEqual(preciosDeLineas(malas).precios, {});
  const sinAjuste = [[{ texto: 'Gasolina Regular 179.16 63.83 28.67 16.59 27.07 6.68 322.00 317.50 0.00' }]];
  assert.equal(preciosDeLineas(sinAjuste).precios.gasolina_regular, 317.5, 'si sigue el precio al público, lo usa');
});

function fetchFalso({ pdf = fx('aviso-ejemplo-libreoffice.pdf'), html = fx('listado-micm-ejemplo.html') } = {}) {
  const pedidos = [];
  const f = async (url) => { pedidos.push(url); if (url === URL_AVISOS) return new Response(html); if (url.endsWith('.pdf')) return new Response(pdf); return new Response('', { status: 404 }); };
  f.pedidos = pedidos; return f;
}

test('actualizar: registra los cinco precios con fuente y enlace, una sola vez', async () => {
  const data = new MemoryData(); const auditoria = [];
  const f = fetchFalso();
  const r = await actualizarDesdeMicm({ data, audit: async (e) => auditoria.push(e), fetchImpl: f, now: () => new Date('2026-11-14T12:00:00Z') });
  assert.equal(r.estado, 'registrado', r.mensaje);
  const ps = await data.list('precios');
  assert.deepEqual(Object.fromEntries(ps.map((p) => [p.combustible, p.precioGalon])), ESPERADO);
  assert.ok(ps.every((p) => p.fuente === 'micm' && p.vigenteDesde === '2026-11-14' && p.enlace.endsWith('.pdf')));
  assert.equal(auditoria[0].entityId, '2026-11-14');
  const otra = await actualizarDesdeMicm({ data, audit: async () => {}, fetchImpl: f });
  assert.equal(otra.estado, 'al dia');
  assert.equal(f.pedidos.filter((u) => u.endsWith('.pdf')).length, 1, 'no vuelve a bajar el PDF');
  assert.equal((await data.list('configuracion', { clave: 'micm_estado' }))[0].valor.estado, 'al dia');
});

test('actualizar: no sobrescribe un precio manual y frena cambios bruscos', async () => {
  const data = new MemoryData();
  await data.insert('precios', { combustible: 'glp', precioGalon: 136, vigenteDesde: '2026-11-14', fuente: 'manual', registradoPor: null });
  const r = await actualizarDesdeMicm({ data, audit: async () => {}, fetchImpl: fetchFalso() });
  assert.equal(r.registrados.length, 4);
  assert.equal((await data.list('precios', { combustible: 'glp' }))[0].precioGalon, 136, 'el manual se respeta');
  const d2 = new MemoryData();
  await d2.insert('precios', { combustible: 'gasolina_premium', precioGalon: 200, vigenteDesde: '2026-11-07', fuente: 'manual', registradoPor: null });
  const r2 = await actualizarDesdeMicm({ data: d2, audit: async () => {}, fetchImpl: fetchFalso() });
  assert.equal(r2.estado, 'error'); assert.match(r2.mensaje, /más de 25 %/);
  assert.equal((await d2.list('precios')).length, 1, 'no registró nada');
});

test('actualizar: errores claros si el MICM cambia o no responde', async () => {
  const d = new MemoryData();
  assert.match((await actualizarDesdeMicm({ data: d, audit: async () => {}, fetchImpl: fetchFalso({ html: '<p>sin avisos</p>' }) })).mensaje, /cambiar su diseño/);
  assert.match((await actualizarDesdeMicm({ data: d, audit: async () => {}, fetchImpl: async () => { throw new Error('red'); } })).mensaje, /No se pudo contactar al MICM/);
  assert.match((await actualizarDesdeMicm({ data: d, audit: async () => {}, fetchImpl: fetchFalso({ pdf: Buffer.from('%PDF-1.4\n%%EOF') }) })).mensaje, /No se pudo verificar/);
});

test('PDF: lee la tabla aunque venga dentro de un objeto de formulario (tabla de Excel pegada)', () => {
  assert.deepEqual(preciosDePdf(fx('aviso-ejemplo-formulario.pdf')).precios, ESPERADO);
});

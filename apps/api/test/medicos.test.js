import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { limpiarNombre, pareceMedico, redesDe, especialidadDe } from '../src/medicos.js';

test('nombre, especialidad y redes', () => {
  assert.deepEqual(limpiarNombre('Dra. Ana Pérez - Pediatra'), { nombre: 'Ana Pérez', especialidad: 'Pediatría' });
  assert.deepEqual(limpiarNombre('Dr. Luis Gómez, Cardiólogo'), { nombre: 'Luis Gómez', especialidad: 'Cardiología' });
  assert.equal(especialidadDe('ginecologa'), 'Ginecología y obstetricia');
  assert.equal(pareceMedico('Dr. Juan Ejemplo'), true);
  assert.equal(pareceMedico('Clínica Pediátrica Ejemplo'), false, 'una clínica no es un médico');
  assert.equal(pareceMedico('Farmacia Ejemplo'), false);
  assert.deepEqual(redesDe({ instagram: '@dra.ejemplo', facebook: 'https://www.facebook.com/dr.ejemplo/', web: 'consultorio-ejemplo.do' }),
    { instagram: 'https://instagram.com/dra.ejemplo', facebook: 'https://facebook.com/dr.ejemplo', web: 'https://consultorio-ejemplo.do' });
  assert.deepEqual(redesDe({ web: 'https://instagram.com/otro.ejemplo?igsh=1' }), { instagram: 'https://instagram.com/otro.ejemplo' });
});

async function arrancar(extra = {}) {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), barridoPausa: 0, sessionSecret: 'x'.repeat(40), ...extra })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  const tok = {};
  for (const [k, props] of Object.entries({ ger: { role: 'gerencia' }, promo: { role: 'representante', position: 'Promotora' }, ven: { role: 'representante', position: 'Vendedor' } })) {
    await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props });
    tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
  }
  const hosp = await data.insert('establecimientos', { tipo: 'hospital', nombre: 'Hospital Ejemplo Moca', provincia: 'Espaillat', municipio: 'Moca', lat: 19.3921, lng: -70.5251, estado: 'validado', fuente: 'manual' });
  return { server, call, tok, data, hosp };
}

test('a mano: el establecimiento da la zona; sin duplicar, completa lo que falta', async () => {
  const { server, call, tok, data, hosp } = await arrancar();
  try {
    assert.equal((await call('POST', '/api/catalogo/medicos', { nombre: 'Ana Ejemplo', especialidad: 'Pediatría', provincia: 'Espaillat', municipio: 'Moca' }, tok.ven)).status, 403);
    assert.equal((await call('POST', '/api/catalogo/medicos', { nombre: 'Ana Ejemplo', establecimientoId: hosp.id }, tok.ger)).status, 422, 'especialidad obligatoria a mano');
    assert.equal((await call('POST', '/api/catalogo/medicos', { nombre: 'Ana Ejemplo', especialidad: 'Pediatría', establecimientoId: hosp.id, telefono: '123' }, tok.ger)).status, 422, 'teléfono no válido');
    const a = await call('POST', '/api/catalogo/medicos', { nombre: 'Dra. Ana Ejemplo', especialidad: 'pediatra', establecimientoId: hosp.id, telefono: '(809) 555-0101', instagram: '@ana.ejemplo' }, tok.ger);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const m = a.body.item;
    assert.deepEqual([m.nombre, m.especialidad, m.centro, m.provincia, m.municipio, m.telefono, m.estado], ['Ana Ejemplo', 'Pediatría', 'Hospital Ejemplo Moca', 'Espaillat', 'Moca', '8095550101', 'validado']);
    assert.equal(m.redes.instagram, 'https://instagram.com/ana.ejemplo');
    // La promotora registra el mismo médico con Facebook: no se duplica, se completa
    const b = await call('POST', '/api/catalogo/medicos', { nombre: 'ana ejemplo', especialidad: 'Pediatría', provincia: 'Espaillat', municipio: 'Moca', facebook: 'facebook.com/ana.ejemplo' }, tok.promo);
    assert.equal(b.status, 200); assert.equal(b.body.accion, 'completado'); assert.equal(b.body.item.redes.facebook, 'https://facebook.com/ana.ejemplo');
    assert.equal((await data.list('medicos')).length, 1);
    const c = await call('POST', '/api/catalogo/medicos', { nombre: 'Otro Ejemplo', especialidad: 'Cardiología', provincia: 'Espaillat', municipio: 'Moca' }, tok.promo);
    assert.equal(c.body.item.estado, 'pendiente', 'lo del equipo espera validación');
    const ed = await call('POST', `/api/catalogo/medicos/${c.body.item.id}`, { establecimientoId: hosp.id, estado: 'validado' }, tok.ger);
    assert.equal(ed.body.item.centro, 'Hospital Ejemplo Moca');
    assert.equal((await call('POST', `/api/catalogo/medicos/${c.body.item.id}`, { estado: 'validado' }, tok.promo)).status, 403);
  } finally { server.close(); }
});

test('documento: plantilla de Excel con vista previa y guardado; PDF con IA', async () => {
  const leidos = [];
  const lectorIA = { activo: true, async leerVentas() { return { filas: [] }; },
    async leerMedicos(x) { leidos.push(x); return { filas: [{ nombre: 'Dr. Juan Ejemplo', especialidad: 'Ginecólogo', establecimiento: 'Hospital Ejemplo de Moca', telefono: '829 555 0103' }], notas: null }; } };
  const { server, call, tok, data } = await arrancar({ lectorIA });
  try {
    const archivo = { nombre: 'medicos.xlsx', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: readFileSync(new URL('./fixtures/medicos-ejemplo.xlsx', import.meta.url)).toString('base64') };
    const v = await call('POST', '/api/medicos/documento/leer', { archivo }, tok.ger);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.filas.length, 3, 'la fila Ejemplo se ignora');
    const [luis, rosa, pedro] = v.body.filas;
    assert.equal(luis.nombre, 'Luis Ejemplo'); assert.equal(luis.municipio, 'Moca', 'zona sale del hospital'); assert.ok(luis.establecimientoId);
    assert.match(rosa.avisos.join(' '), /Por confirmar/); assert.match(rosa.avisos.join(' '), /Teléfono/);
    assert.equal(pedro.especialidad, 'Pediatría'); assert.match(pedro.avisos.join(' '), /No encontramos/);
    assert.equal((await data.list('medicos')).length, 0, 'leer no guarda');
    const ok = await call('POST', '/api/medicos/documento/confirmar', { filas: v.body.filas, fuente: v.body.fuente }, tok.ger);
    assert.deepEqual(ok.body.resumen, { creado: 3, completado: 0, existente: 0, error: 0 });
    const ms = await data.list('medicos');
    assert.equal(ms.find((m) => m.nombre === 'Rosa Ejemplo').estado, 'pendiente');
    assert.equal(ms.find((m) => m.nombre === 'Luis Ejemplo').redes.instagram, 'https://instagram.com/luis.ejemplo');
    // Otra vez: no duplica
    const otra = await call('POST', '/api/medicos/documento/confirmar', { filas: v.body.filas }, tok.ger);
    assert.equal(otra.body.resumen.creado, 0); assert.equal((await data.list('medicos')).length, 3);
    // PDF: lo lee la IA y se empareja con el hospital del catálogo
    const pdf = await call('POST', '/api/medicos/documento/leer', { archivo: { nombre: 'lista.pdf', tipo: 'application/pdf', base64: Buffer.from('%PDF-1.4 ejemplo').toString('base64') } }, tok.promo);
    assert.equal(pdf.status, 200, JSON.stringify(pdf.body)); assert.equal(pdf.body.fuente, 'ia');
    assert.deepEqual([pdf.body.filas[0].nombre, pdf.body.filas[0].especialidad, pdf.body.filas[0].municipio, pdf.body.filas[0].telefono], ['Juan Ejemplo', 'Ginecología y obstetricia', 'Moca', '8295550103']);
    assert.match(leidos[0].establecimientos.join(' '), /Hospital Ejemplo Moca/);
  } finally { server.close(); }
});

test('Google Maps: registro automático de médicos; descarta clínicas; liga el hospital cercano', async () => {
  const L = (id, nombre, extra = {}) => ({ placeId: `ChIJ_medico_${id}`, nombre, direccion: 'Calle 1, Moca 56000', lat: 19.3922, lng: -70.5252, telefono: '809-555-0199', web: null, cerrado: false, ...extra });
  const lugares = { activo: true, async buscar() { return []; }, async detalle() { return null; },
    async pagina({ municipio }) { return { items: municipio === 'Moca' ? [L('aaaa1111', 'Dra. Carmen Ejemplo - Pediatra', { web: 'https://instagram.com/dra.carmen.ejemplo' }), L('bbbb2222', 'Clínica Ejemplo Moca'), L('cccc3333', 'Dr. Mario Ejemplo', { lat: 19.5, lng: -70.6, direccion: 'Av. 2, Moca' })] : [], siguiente: null }; } };
  const { server, call, tok, data } = await arrancar({ lugares });
  try {
    assert.equal((await call('POST', '/api/territorio/google/barrido', { tipo: 'medico', provincia: 'Espaillat', municipio: 'Moca' }, tok.ger)).status, 202);
    let e; for (let i = 0; i < 100; i++) { e = (await call('GET', '/api/territorio/google/barrido', null, tok.ger)).body.item; if (e.estado !== 'en_curso') break; await new Promise((r) => setTimeout(r, 10)); }
    assert.equal(e.estado, 'terminado'); assert.equal(e.agregados, 2); assert.equal(e.descartados, 1);
    const ms = await data.list('medicos');
    const carmen = ms.find((m) => m.nombre === 'Carmen Ejemplo');
    assert.deepEqual([carmen.especialidad, carmen.centro, carmen.telefono, carmen.fuente, carmen.estado, carmen.redes.instagram], ['Pediatría', 'Hospital Ejemplo Moca', '8095550199', 'google', 'validado', 'https://instagram.com/dra.carmen.ejemplo']);
    const mario = ms.find((m) => m.nombre === 'Mario Ejemplo');
    assert.deepEqual([mario.especialidad, mario.estado, mario.centro], ['Por confirmar', 'pendiente', null]);
  } finally { server.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { hashPassword } from '../src/security.js';

test('médico: se registra con varios lugares, la gerencia lo aprueba y sus recetas llevan su nombre y van a revisión', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    const tg = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'clave123456' })).body.token;
    const hosp = await data.insert('establecimientos', { nombre: 'Hospital Ejemplo', tipo: 'hospital', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });
    await data.insert('establecimientos', { nombre: 'Farmacia no', tipo: 'unap', provincia: 'Santiago', municipio: 'Tamboril', estado: 'inactivo', fuente: 'manual' });
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 100, activo: true });
    const otro = await data.insert('medicos', { nombre: 'Luis Ejemplo', especialidad: 'Pediatría', provincia: 'Espaillat', municipio: 'Moca', estado: 'validado', fuente: 'manual' });

    const pub = (await call('GET', '/api/publico/establecimientos?provincia=Espaillat,Santiago')).body.items;
    assert.deepEqual(pub.map((x) => x.nombre), ['Hospital Ejemplo'], 'solo lugares activos de las provincias elegidas');
    assert.ok((await call('GET', '/api/publico/especialidades')).body.items.includes('Pediatría'));

    const base = { fullName: 'Ana Ejemplo', email: 'ana@x.do', phone: '8095550000', password: 'clave123456', role: 'medico', acceptsPrivacy: true, acceptsTerms: true };
    const mal = await call('POST', '/api/auth/register', base);
    assert.equal(mal.status, 422); assert.ok(mal.body.fields.especialidad && mal.body.fields.lugares);
    const reg = await call('POST', '/api/auth/register', { ...base, especialidad: 'Medicina general', lugares: [{ establecimientoId: hosp.id }, { nombre: 'Clínica Nueva Ejemplo', tipo: 'clinica', provincia: 'Santiago', municipio: 'Tamboril' }] });
    assert.equal(reg.status, 201, JSON.stringify(reg.body)); assert.equal(reg.body.user.status, 'pendiente_aprobacion');
    const nueva = (await data.list('establecimientos')).find((x) => x.nombre === 'Clínica Nueva Ejemplo');
    assert.equal(nueva.estado, 'pendiente', 'el lugar nuevo queda para revisar');

    assert.equal((await call('POST', `/api/auth/requests/${reg.body.user.id}/aprobar`, {}, tg)).status, 200);
    const tm = (await call('POST', '/api/auth/login', { email: 'ana@x.do', password: 'clave123456' })).body.token;
    const perfil = (await call('GET', '/api/medico/perfil', null, tm)).body.item;
    assert.deepEqual([perfil.nombre, perfil.especialidad, perfil.estado, perfil.lugares.length], ['Ana Ejemplo', 'Medicina general', 'validado', 2]);

    const jpg = (n) => ({ tipo: 'image/jpeg', nombre: `r-${n}.jpg`, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64') });
    // Sin médico: queda él. Sin paciente: se puede. Lugar: el segundo.
    const r1 = await call('POST', '/api/recetas', { establecimientoId: nueva.id, fecha: '2026-11-20', adjunto: jpg(1), items: [{ medicamentoId: med.id, unidades: 2 }] }, tm);
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.receta.medicoId, r1.body.receta.estado, r1.body.receta.municipio, r1.body.receta.pacienteId], [perfil.id, 'pendiente', 'Tamboril', null]);
    // Prescrita por otro médico
    const r2 = await call('POST', '/api/recetas', { medicoId: otro.id, adjunto: jpg(2), items: [{ medicamentoId: med.id, unidades: 1 }], paciente: { telefono: '8095551234', nombre: 'Paciente Ejemplo' } }, tm);
    assert.equal(r2.body.receta.medicoId, otro.id); assert.equal(r2.body.receta.municipio, 'Moca');
    assert.equal((await call('POST', '/api/recetas', { items: [{ medicamentoId: med.id, unidades: 1 }] }, tm)).status, 422, 'la foto es obligatoria');
    // Sus recetas, y la revisión
    const mias = (await call('GET', '/api/recetas', null, tm)).body.items;
    assert.equal(mias.length, 2); assert.equal(mias[0].cargadoPorRol, 'Médico');
    assert.equal((await call('POST', `/api/recetas/${r1.body.receta.id}/aprobar`, {}, tm)).status, 403);
    const rech = await call('POST', `/api/recetas/${r2.body.receta.id}/rechazar`, { motivo: 'El medicamento no coincide con la prescripción.' }, tg);
    assert.equal(rech.body.item.estado, 'rechazada');
    assert.equal((await call('GET', '/api/recetas?estado=pendiente', null, tg)).body.items.length, 1);
  } finally { server.close(); }
});

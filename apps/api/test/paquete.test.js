import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';
import { usuarioBase } from '../src/representantes.js';

const leer = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url)).toString('base64');
const xlsx = leer('paquete-ejemplo.xlsx');
const xlsxOk = leer('paquete-ejemplo-ok.xlsx');

test('usuario de alguien con un solo nombre', () => {
  assert.equal(usuarioBase('Rosa', ''), 'rosa');
  assert.equal(usuarioBase('José', 'Pérez'), 'jperez');
  assert.equal(usuarioBase('Ashley', 'de Jesús'), 'ajesus');
});

test('importar paquete: nombres, posiciones y días; sin salario; zona pendiente', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    await store.createUser({ fullName: 'Admin Ejemplo', email: 'adm@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'administrador' });
    const adm = (await call('POST', '/api/auth/login', { email: 'adm@x.do', password: 'clave123456' })).body.token;
    const prev = await call('POST', '/api/representantes/importar-paquete', { archivo: xlsx, nombre: 'paquete.xlsx' }, adm);
    assert.equal(prev.status, 200, JSON.stringify(prev.body));
    assert.equal(prev.body.total, 4, 'las filas de totales se ignoran');
    const [ana, luis, rosa, juan] = prev.body.filas;
    assert.equal(ana.nombre, 'Ana Ejemplo'); assert.equal(ana.posicion, 'Visitador'); assert.equal(ana.diasFuera, 7); assert.equal(ana.diasDentro, 14);
    assert.equal(luis.diasFuera, 0); assert.equal(luis.diasDentro, 21);
    assert.equal(rosa.posicion, 'Promotora'); assert.match(rosa.avisos.join(' '), /apellido/); assert.match(rosa.avisos.join(' '), /26 días/);
    assert.equal(juan.accion, 'error'); assert.match(juan.errores[0], /Posición/);
    assert.equal(JSON.stringify(prev.body).includes('25000'), false, 'el salario no se lee');
    assert.equal((await call('POST', '/api/representantes/importar-paquete', { archivo: xlsx, confirmar: true }, adm)).status, 422, 'con errores no guarda nada');
    assert.equal((await store.listUsers()).length, 1);
    // Sin la fila con error: se crean las cuentas con su plan de días
    const ok = await call('POST', '/api/representantes/importar-paquete', { archivo: xlsxOk, nombre: 'paquete.xlsx', confirmar: true }, adm);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.items.map((x) => x.usuario), ['aejemplo', 'lejemplo', 'rosa']);
    assert.ok(ok.body.items.every((x) => x.nuevo && x.claveTemporal), 'contraseña temporal que se muestra una vez');
    const reps = (await store.listUsers()).filter((u) => u.role === 'representante');
    assert.equal(reps.length, 3); assert.ok(reps.every((u) => u.debeCambiarClave && u.status === 'activo'));
    const plan = await call('GET', `/api/representantes/${ok.body.items[0].id}/plan-dias`, null, adm);
    assert.deepEqual([plan.body.item.diasDentro, plan.body.item.diasFuera], [14, 7]);
    const zona = await call('GET', `/api/territorio/zonas/${ok.body.items[0].id}`, null, adm);
    assert.equal(zona.body.item?.provincias?.length ?? 0, 0, 'la zona queda para asignar');
    // Volver a subirlo no duplica: solo actualiza los días
    const otra = await call('POST', '/api/representantes/importar-paquete', { archivo: xlsxOk }, adm);
    assert.ok(otra.body.filas.every((x) => x.accion === 'ya existe: actualizar días'));
    await call('POST', '/api/representantes/importar-paquete', { archivo: xlsxOk, confirmar: true }, adm);
    assert.equal((await store.listUsers()).filter((u) => u.role === 'representante').length, 3);
    assert.equal((await data.list('planDias')).length, 3);
  } finally { server.close(); }
});

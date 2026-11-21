import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

const leer = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url)).toString('base64');

test('medicamentos: plantilla con código; volver a subirla actualiza código, nombre y precio; editar a mano', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    const t = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'clave123456' })).body.token;
    // Ya existía uno sin código, con el mismo nombre: se le pone el código, no se duplica
    await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo Frasco 120 mL.', precio: 400, activo: true });
    const prev = await call('POST', '/api/importar/medicamentos', { archivo: leer('medicamentos-ejemplo.xlsx'), nombre: 'm.xlsx' }, t);
    assert.equal(prev.status, 200, JSON.stringify(prev.body));
    assert.deepEqual(prev.body.vista.map((x) => x.accion), ['crear', 'actualizar código, precio', 'error']);
    assert.match(prev.body.errores[0].errores.join(' '), /repetido/);
    const ok2 = await call('POST', '/api/importar/medicamentos', { archivo: leer('medicamentos-ejemplo-ok.xlsx'), nombre: 'm.xlsx', confirmar: true }, t);
    assert.equal(ok2.status, 200, JSON.stringify(ok2.body));
    let ms = await data.list('medicamentos');
    assert.equal(ms.length, 2);
    const j = ms.find((m) => m.codigo === 'JARA001');
    assert.deepEqual([j.nombre, j.precio], ['Jarabe Ejemplo Frasco 120 mL.', 558.36]);
    assert.equal(ms.find((m) => m.nombre.startsWith('Cápsula')).codigo, 'CAPS002', 'el código se guarda sin espacios');
    // Segunda carga: mismo código, nombre y precio nuevos → se actualiza, con historial de precio
    const v2 = await call('POST', '/api/importar/medicamentos', { archivo: leer('medicamentos-ejemplo-v2.xlsx'), nombre: 'm.xlsx', confirmar: true }, t);
    assert.equal(v2.status, 200, JSON.stringify(v2.body));
    ms = await data.list('medicamentos');
    assert.equal(ms.length, 2);
    assert.deepEqual([ms.find((m) => m.codigo === 'JARA001').nombre, ms.find((m) => m.codigo === 'JARA001').precio], ['Jarabe Ejemplo Plus 120 mL.', 600]);
    assert.ok((await data.list('preciosMedicamento')).filter((p) => p.medicamentoId === j.id).length >= 2);
    // Editar a mano: código y nombre; código repetido no
    const caps = ms.find((m) => m.codigo === 'CAPS002');
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${caps.id}`, { codigo: 'jara001' }, t)).status, 409);
    const ed = await call('POST', `/api/catalogo/medicamentos/${caps.id}`, { codigo: 'caps 003', nombre: 'Cápsula Ejemplo C/20' }, t);
    assert.deepEqual([ed.body.item.codigo, ed.body.item.nombre], ['CAPS003', 'Cápsula Ejemplo C/20']);
  } finally { server.close(); }
});

test('medicamentos: lista vieja (nombre + presentación) se une con la nueva; repetidos; eliminar', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40) })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    await store.createUser({ fullName: 'Ger Ejemplo', email: 'g@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'gerencia' });
    await store.createUser({ fullName: 'Ven Ejemplo', email: 'v@x.do', status: 'activo', passwordHash: await hashPassword('clave123456'), role: 'representante', position: 'Vendedor' });
    const t = (await call('POST', '/api/auth/login', { email: 'g@x.do', password: 'clave123456' })).body.token;
    const tv = (await call('POST', '/api/auth/login', { email: 'v@x.do', password: 'clave123456' })).body.token;
    // Como quedó la lista vieja: nombre y presentación separados; y un repetido escrito a mano
    const viejo = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', presentacion: 'Frasco 120 mL.', linea: 'Antitusivos', precio: 500, activo: true });
    const otro = await data.insert('medicamentos', { nombre: 'jarabe ejemplo', presentacion: 'frasco de 120 ml', precio: null, activo: true });
    await data.insert('medicamentos', { nombre: 'Cápsula Ejemplo', presentacion: 'C/30', precio: 100, activo: true });
    // Crear a mano un repetido: rechazado
    assert.equal((await call('POST', '/api/catalogo/medicamentos', { nombre: 'Jarabe-Ejemplo Frasco 120 ML' }, t)).status, 409);
    const rep = (await call('GET', '/api/catalogo/medicamentos/repetidos', null, t)).body.grupos;
    assert.equal(rep.length, 1); assert.equal(rep[0].exacto, true); assert.equal(rep[0].conservar, viejo.id, 'se conserva el que tiene precio');
    assert.equal((await call('POST', '/api/catalogo/medicamentos/repetidos', { auto: true }, tv)).status, 403);
    const lim = (await call('POST', '/api/catalogo/medicamentos/repetidos', { auto: true }, t)).body;
    assert.equal(lim.eliminados, 1);
    assert.equal((await data.get('medicamentos', otro.id)).activo, false);
    assert.equal((await call('GET', '/api/catalogo/medicamentos', null, t)).body.items.length, 2);
    // La lista nueva (código + nombre completo) actualiza el viejo en vez de duplicarlo
    const v = await call('POST', '/api/importar/medicamentos', { archivo: leer('medicamentos-ejemplo-ok.xlsx'), confirmar: true }, t);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const ms = (await call('GET', '/api/catalogo/medicamentos', null, t)).body.items;
    assert.equal(ms.length, 2, 'la cápsula y el jarabe de la lista nueva coinciden con los que ya estaban: no se duplican');
    assert.equal(ms.find((m) => m.nombre.startsWith('Cápsula')).codigo, 'CAPS002');
    const j = ms.find((m) => m.codigo === 'JARA001');
    assert.deepEqual([j.id, j.nombre, j.presentacion, j.precio, j.linea], [viejo.id, 'Jarabe Ejemplo Frasco 120 mL.', null, 558.36, 'Antitusivos']);
    // Fila idéntica repetida en el archivo: se omite sola
    const csv = Buffer.from('Código,Medicamento / Producto,Precio Final ($)\nJARA001,Jarabe Ejemplo Frasco 120 mL.,558.36\nJARA001,Jarabe Ejemplo Frasco 120 mL.,558.36\n').toString('base64');
    const d = (await call('POST', '/api/importar/medicamentos', { archivo: csv, nombre: 'r.csv' }, t)).body;
    assert.equal(d.errores.length, 0); assert.match(d.vista[1].accion, /repetido.*se omite/);
    // Eliminar
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${j.id}/eliminar`, {}, tv)).status, 403);
    assert.equal((await call('POST', `/api/catalogo/medicamentos/${j.id}/eliminar`, { motivo: 'Ya no se fabrica' }, t)).status, 200);
    assert.equal((await call('GET', '/api/catalogo/medicamentos', null, t)).body.items.some((m) => m.id === j.id), false);
  } finally { server.close(); }
});

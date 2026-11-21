import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { MemoryData } from '../src/data.js';
import { MemoryFiles } from '../src/files.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/security.js';

test('paciente por nombre: sugerencias de su zona con teléfono oculto; elegirlo no lo duplica', async () => {
  const store = new MemoryStore(); const data = new MemoryData();
  const server = createServer(createApp({ store, data, files: new MemoryFiles(), sessionSecret: 'x'.repeat(40), now: () => new Date('2026-11-20T16:00:00Z') })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, b, t) => { const r = await fetch(url + p, { method: m, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: b && JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
  try {
    const tok = {}; const ids = {};
    for (const [k, props] of Object.entries({ p1: { role: 'representante', position: 'Promotora' }, p2: { role: 'representante', position: 'Promotora' }, ven: { role: 'representante', position: 'Vendedor' } })) {
      ids[k] = (await store.createUser({ fullName: `${k} Ejemplo`, email: `${k}@x.do`, status: 'activo', passwordHash: await hashPassword('clave123456'), ...props })).id;
      tok[k] = (await call('POST', '/api/auth/login', { email: `${k}@x.do`, password: 'clave123456' })).body.token;
    }
    await data.insert('zonas', { representanteId: ids.p1, provincias: ['Espaillat'], municipios: {} });
    await data.insert('zonas', { representanteId: ids.p2, provincias: ['La Vega'], municipios: {} });
    const med = await data.insert('medicamentos', { nombre: 'Jarabe Ejemplo', precio: 200, activo: true });
    const nueva = async (t, prov, mun, paciente) => {
      const op = (await call('POST', '/api/operativos', { provincia: prov, municipio: mun, centro: 'Hospital Ejemplo' }, t)).body.item;
      const m = (await call('POST', '/api/catalogo/medicos', { nombre: `Médico Ejemplo ${mun}`, especialidad: 'Pediatría', provincia: prov, municipio: mun }, t)).body.item;
      return call('POST', '/api/recetas', { operativoId: op.id, medicoId: m.id, paciente, items: [{ medicamentoId: med.id, unidades: 1 }] }, t);
    };
    assert.equal((await nueva(tok.p1, 'Espaillat', 'Moca', { telefono: '8095550101', nombre: 'María Ejemplo Pérez' })).status, 201);
    assert.equal((await nueva(tok.p2, 'La Vega', 'Jarabacoa', { telefono: '8295550202', nombre: 'María Ejemplo Gómez' })).status, 201);

    assert.equal((await call('GET', '/api/pacientes?nombre=mar', null, tok.ven)).status, 403);
    const s1 = (await call('GET', '/api/pacientes?nombre=maria eje', null, tok.p1)).body.pacientes;
    assert.deepEqual(s1.map((x) => [x.nombre, x.telefono, x.recetas]), [['María Ejemplo Pérez', '···-···-0101', 1]], 'solo los de su zona y con teléfono oculto');
    assert.equal((await call('GET', '/api/pacientes?nombre=ma', null, tok.p1)).body.pacientes.length, 0, 'desde 3 letras');
    // Elegido por nombre: la receta se suma al mismo paciente
    const r = await nueva(tok.p1, 'Espaillat', 'Moca', { id: s1[0].id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await data.list('pacientes')).length, 2);
    assert.equal((await call('GET', '/api/pacientes?nombre=maria', null, tok.p1)).body.pacientes[0].recetas, 2);
    // El paciente de otra zona no se puede elegir por id
    const otro = (await data.list('pacientes')).find((p) => p.telefono === '8295550202');
    assert.equal((await nueva(tok.p1, 'Espaillat', 'Moca', { id: otro.id })).status, 422);
  } finally { server.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { cambiarCorreo, cambiarClave } from '../src/cuentas.js';
import { verifyPassword } from '../src/security.js';

const base = async () => { const s = new MemoryStore(); const u = await s.createUser({ fullName: 'Admin Ejemplo', email: 'iejemplo@x.do', role: 'administrador', status: 'activo', passwordHash: 'x' }); return { s, u }; };

test('cambiar correo: misma cuenta, nuevo correo en minúscula y auditado', async () => {
  const { s, u } = await base();
  const r = await cambiarCorreo(s, 'IEjemplo@x.do', ' LEjemplo@x.do ');
  assert.equal(r.id, u.id); assert.equal(r.email, 'lejemplo@x.do');
  assert.equal(await s.findUserByEmail('iejemplo@x.do'), null);
  assert.deepEqual(s.audit.at(-1).before, { email: 'iejemplo@x.do' });
});
test('cambiar correo: rechaza correo inválido, inexistente o ya usado', async () => {
  const { s } = await base();
  await s.createUser({ fullName: 'Otro', email: 'otro@x.do', role: 'gerencia', status: 'activo' });
  await assert.rejects(cambiarCorreo(s, 'iejemplo@x.do', 'no-es-correo'), /no es válido/);
  await assert.rejects(cambiarCorreo(s, 'nadie@x.do', 'nuevo@x.do'), /No existe/);
  await assert.rejects(cambiarCorreo(s, 'iejemplo@x.do', 'otro@x.do'), /Ya existe/);
});
test('cambiar contraseña: mínimo 12 y queda verificable', async () => {
  const { s, u } = await base();
  await assert.rejects(cambiarClave(s, 'iejemplo@x.do', 'corta'), /12/);
  await cambiarClave(s, 'iejemplo@x.do', 'ClaveNueva2026!');
  assert.ok(await verifyPassword('ClaveNueva2026!', (await s.findUserById(u.id)).passwordHash));
  assert.equal(JSON.stringify(s.audit).includes('ClaveNueva'), false);
});

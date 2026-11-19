import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MemoryStore } from '../src/store.js';
import { createApp } from '../src/server.js';
import { validateRegistration } from '../src/validation.js';
import { hashPassword } from '../src/security.js';
import { canApprove } from '../src/roles.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const base = { fullName: '  Ana   Pérez ', email: 'Ana@Fersuaz.net', password: 'claveSegura12', acceptsPrivacy: true };

test('normaliza nombre y correo', () => {
  const r = validateRegistration({ ...base, role: 'finanzas' });
  assert.ok(r.ok); assert.equal(r.data.fullName, 'Ana Pérez'); assert.equal(r.data.email, 'ana@fersuaz.net');
});
test('no se puede solicitar rol administrador', () => assert.ok(validateRegistration({ ...base, role: 'administrador' }).errors.role));
test('representante exige posición válida', () => {
  assert.ok(validateRegistration({ ...base, role: 'representante' }).errors.position);
  assert.ok(validateRegistration({ ...base, role: 'representante', position: 'Visitador' }).ok);
});
test('teléfono dominicano', () => {
  assert.ok(validateRegistration({ ...base, role: 'finanzas', phone: '809-555-1234' }).ok);
  assert.ok(validateRegistration({ ...base, role: 'finanzas', phone: '305-555-1234' }).errors.phone);
});
test('contraseña débil y privacidad', () => {
  const r = validateRegistration({ ...base, role: 'finanzas', password: 'corta', acceptsPrivacy: false });
  assert.ok(r.errors.password); assert.ok(r.errors.acceptsPrivacy);
});
test('matriz de aprobación', () => {
  assert.ok(canApprove('supervisor', 'representante'));
  assert.ok(!canApprove('supervisor', 'gerencia'));
  assert.ok(!canApprove('representante', 'representante'));
  assert.ok(!canApprove('finanzas', 'finanzas'));
});

async function withServer(fn) {
  const store = new MemoryStore();
  const server = createServer(createApp({ store, sessionSecret: SECRET })).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn({ call, store }); } finally { server.close(); }
}

test('flujo: registro → pendiente → aprobación → login', () => withServer(async ({ call, store }) => {
  const reg = await call('POST', '/api/auth/register', { ...base, role: 'representante', position: 'Vendedor' });
  assert.equal(reg.status, 201); assert.equal(reg.body.user.status, 'pendiente_aprobacion');
  assert.equal(reg.body.user.passwordHash, undefined);

  assert.equal((await call('POST', '/api/auth/register', { ...base, role: 'finanzas' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: base.email, password: base.password })).status, 403);

  const sup = await store.createUser({ fullName: 'Sup', email: 'sup@fersuaz.net', role: 'supervisor', status: 'activo', passwordHash: await hashPassword('claveSup1234') });
  const fin = await store.createUser({ fullName: 'Fin', email: 'fin@fersuaz.net', role: 'finanzas', status: 'activo', passwordHash: await hashPassword('claveFin1234') });
  const supTok = (await call('POST', '/api/auth/login', { email: 'sup@fersuaz.net', password: 'claveSup1234' })).body.token;
  const finTok = (await call('POST', '/api/auth/login', { email: 'fin@fersuaz.net', password: 'claveFin1234' })).body.token;

  assert.equal((await call('POST', `/api/auth/requests/${reg.body.user.id}/aprobar`)).status, 401);
  assert.equal((await call('POST', `/api/auth/requests/${reg.body.user.id}/aprobar`, null, finTok)).status, 403);
  assert.equal((await call('POST', `/api/auth/requests/${reg.body.user.id}/aprobar`, null, supTok)).status, 200);
  assert.equal((await call('POST', `/api/auth/requests/${reg.body.user.id}/aprobar`, null, supTok)).status, 409);

  const login = await call('POST', '/api/auth/login', { email: base.email, password: base.password });
  assert.equal(login.status, 200); assert.ok(login.body.token);
  assert.equal((await call('POST', '/api/auth/login', { email: base.email, password: 'malaClave123' })).status, 401);
  assert.equal(store.audit.at(-1).action, 'registro_aprobado'); assert.equal(store.audit.at(-1).actorId, sup.id);
  assert.ok(fin);
}));

test('token manipulado se rechaza', () => withServer(async ({ call }) => {
  assert.equal((await call('GET', '/api/auth/pending', null, 'abc.def')).status, 401);
}));

test('dependiente exige farmacia y provincia', () => {
  const r = validateRegistration({ ...base, role: 'dependiente' });
  assert.ok(r.errors.pharmacy); assert.ok(r.errors.province);
  assert.ok(validateRegistration({ ...base, role: 'dependiente', pharmacy: 'Farmacia Carol', province: 'Santiago' }).ok);
});

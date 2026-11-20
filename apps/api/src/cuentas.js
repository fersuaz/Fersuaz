// Mantenimiento de cuentas desde la consola del servidor (no expuesto en la API pública).
import { hashPassword } from './security.js';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = (c) => String(c ?? '').trim().toLowerCase();

/** Cambia el correo de una cuenta, con auditoría. No crea una cuenta nueva. */
export async function cambiarCorreo(store, actual, nuevo) {
  const de = norm(actual); const a = norm(nuevo);
  if (!CORREO.test(a)) throw new Error('El correo nuevo no es válido.');
  if (de === a) throw new Error('El correo nuevo es igual al actual.');
  const u = await store.findUserByEmail(de);
  if (!u) throw new Error(`No existe una cuenta con el correo ${de}.`);
  if (await store.findUserByEmail(a)) throw new Error(`Ya existe una cuenta con el correo ${a}.`);
  const out = await store.updateUser(u.id, { email: a });
  await store.addAudit({ action: 'correo_cambiado_cli', entity: 'user', entityId: u.id, before: { email: de }, after: { email: a } });
  return out;
}

/** Cambia la contraseña de una cuenta, con auditoría (la contraseña nunca se registra). */
export async function cambiarClave(store, correo, clave) {
  if (String(clave ?? '').length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
  const u = await store.findUserByEmail(norm(correo));
  if (!u) throw new Error(`No existe una cuenta con el correo ${norm(correo)}.`);
  const out = await store.updateUser(u.id, { passwordHash: await hashPassword(clave) });
  await store.addAudit({ action: 'clave_cambiada_cli', entity: 'user', entityId: u.id });
  return out;
}

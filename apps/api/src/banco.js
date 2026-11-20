// Cuenta de banco de la dependiente (para el pago de su comisión).
// Solo BHD, Banco Popular y Banreservas; cuenta de ahorro o corriente. El correo se completa con el de su cuenta.
// El número completo lo ven ella, la administración, la gerencia y finanzas; los demás lo ven enmascarado.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';
import { normalizeName } from './validation.js';

export const BANCOS = Object.freeze({ bhd: 'BHD', popular: 'Banco Popular', banreservas: 'Banreservas' });
export const TIPOS_CUENTA = Object.freeze({ ahorro: 'Ahorro', corriente: 'Corriente' });
const VEN_COMPLETO = ['administrador', 'gerencia', 'finanzas'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** ····1234: solo los últimos 4 dígitos. */
export const enmascarar = (numero) => `····${String(numero ?? '').slice(-4)}`;

export function createBanco({ data, users, audit }) {
  const activo = (a) => a?.status === STATUS.ACTIVO;
  const vista = (c, completo) => c && ({ ...c, bancoNombre: BANCOS[c.banco], tipoNombre: TIPOS_CUENTA[c.tipo], numero: completo ? c.numero : enmascarar(c.numero), completo });
  const deUsuario = async (id) => (await data.list('cuentasBanco', { usuarioId: id }))[0] ?? null;

  async function ver(actor, usuarioId) {
    const id = usuarioId ?? actor?.id;
    const propia = activo(actor) && actor.id === id;
    const gestion = activo(actor) && [...VEN_COMPLETO, 'supervisor'].includes(actor.role);
    if (!propia && !gestion) throw new HttpError(403, 'No tienes permiso para ver esta cuenta.');
    const u = await users.findUserById(id);
    if (!u || u.role !== 'dependiente') throw new HttpError(404, 'La dependiente no existe.');
    return { cuenta: vista(await deUsuario(id), propia || VEN_COMPLETO.includes(actor.role)), correoSugerido: u.email ?? null, titularSugerido: u.fullName };
  }

  /** La dependiente guarda o actualiza su cuenta (la gestión también puede corregirla). */
  async function guardar(actor, usuarioId, input = {}) {
    const id = usuarioId ?? actor?.id;
    const propia = activo(actor) && actor.role === 'dependiente' && actor.id === id;
    if (!propia && !(activo(actor) && ['administrador', 'gerencia', 'finanzas'].includes(actor.role))) throw new HttpError(403, 'Solo la dependiente, finanzas o la gerencia registran la cuenta de banco.');
    const u = await users.findUserById(id);
    if (!u || u.role !== 'dependiente') throw new HttpError(404, 'La dependiente no existe.');
    const e = {};
    if (!BANCOS[input.banco]) e.banco = 'Elige el banco: BHD, Banco Popular o Banreservas.';
    if (!TIPOS_CUENTA[input.tipo]) e.tipo = 'Elige si la cuenta es de ahorro o corriente.';
    const numero = String(input.numero ?? '').replace(/[\s-]/g, '');
    if (!/^\d{6,20}$/.test(numero)) e.numero = 'Escribe el número de cuenta, solo dígitos (entre 6 y 20).';
    const titular = normalizeName(input.titular) || u.fullName;
    if (titular.length < 3) e.titular = 'Escribe el nombre del titular de la cuenta.';
    const correo = String(input.correo ?? '').trim().toLowerCase() || (u.email ?? '');
    if (!EMAIL.test(correo)) e.correo = 'Escribe un correo válido para el aviso de la transferencia.';
    if (Object.keys(e).length) throw new HttpError(422, 'Revisa los campos marcados.', e);
    const antes = await deUsuario(id);
    const datos = { usuarioId: id, banco: input.banco, tipo: input.tipo, numero, titular: titular.slice(0, 120), correo, actualizadoPor: actor.id };
    const c = antes ? await data.update('cuentasBanco', antes.id, datos) : await data.insert('cuentasBanco', datos);
    // Auditoría sin el número completo
    await audit({ actorId: actor.id, action: antes ? 'cuenta_banco_actualizada' : 'cuenta_banco_registrada', entity: 'cuenta_banco', entityId: c.id,
      before: antes ? { banco: antes.banco, tipo: antes.tipo, numero: enmascarar(antes.numero) } : null, after: { banco: c.banco, tipo: c.tipo, numero: enmascarar(c.numero) } });
    return vista(c, true);
  }

  /** Para pagos: cuentas de todas las dependientes (completas para finanzas, gerencia y administración). */
  async function listar(actor) {
    if (!(activo(actor) && [...VEN_COMPLETO, 'supervisor'].includes(actor.role))) throw new HttpError(403, 'No tienes permiso para esta acción.');
    const completo = VEN_COMPLETO.includes(actor.role);
    return (await data.list('cuentasBanco')).map((c) => vista(c, completo));
  }
  return { ver, guardar, listar };
}

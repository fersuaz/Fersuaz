// Alta de representantes (Promotora, Visitador, Vendedor, PVC) por el administrador.
// Con nombre y apellido se crea el usuario (ej. jperez) y una contraseña temporal que se muestra una sola vez;
// el representante la cambia al entrar. En el mismo paso se asignan posición, zona, residencia y vehículo
// (o transporte público), para que su cronograma, km, combustible y viáticos se calculen solos.
import { randomInt } from 'node:crypto';
import { AuthError as HttpError } from './auth.js';
import { POSITIONS, STATUS } from './roles.js';
import { hashPassword } from './security.js';
import { normalizeName } from './validation.js';
import { provinciaOficial, municipioOficial } from './territorio.js';

const sinTilde = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Usuario base: inicial del nombre + primer apellido, sin tildes ni espacios (José Pérez → jperez). */
export function usuarioBase(nombre, apellido) {
  const n = sinTilde(nombre).replace(/[^a-z]/g, ' ').trim().split(/\s+/)[0] ?? '';
  const a = sinTilde(apellido).replace(/[^a-z]/g, ' ').trim().split(/\s+/)[0] ?? '';
  return `${n.slice(0, 1)}${a}`.slice(0, 24) || 'representante';
}
/** Contraseña temporal de 10 caracteres con letras y números, sin caracteres confusos (0/O, 1/l/I). */
export function claveTemporal() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'; const D = '23456789';
  const todo = L + D;
  const c = [L[randomInt(L.length)], D[randomInt(D.length)], ...Array.from({ length: 8 }, () => todo[randomInt(todo.length)])];
  for (let i = c.length - 1; i > 0; i--) { const j = randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}

export function createAltaRepresentantes({ store, t, v }) {
  const permitir = (a) => {
    if (!(a?.status === STATUS.ACTIVO && ['administrador', 'gerencia'].includes(a.role))) throw new HttpError(403, 'Solo la administración o la gerencia registran representantes.');
  };
  async function usuarioLibre(base) {
    for (let i = 1; i < 500; i++) {
      const u = i === 1 ? base : `${base}${i}`;
      if (!(await store.findUserByUsername(u))) return u;
    }
    throw new HttpError(409, 'No pudimos generar un usuario libre.');
  }

  async function alta(actor, input = {}) {
    permitir(actor);
    const e = {};
    const nombre = normalizeName(input.nombre); const apellido = normalizeName(input.apellido);
    if (nombre.length < 2) e.nombre = 'Escribe el nombre.';
    if (apellido.length < 2) e.apellido = 'Escribe el apellido.';
    if (!POSITIONS.includes(input.posicion)) e.posicion = 'Elige la posición: Visitador, PVC, Vendedor o Promotora.';
    const correo = String(input.correo ?? '').trim().toLowerCase() || null;
    if (correo && !EMAIL.test(correo)) e.correo = 'Escribe un correo válido o déjalo vacío.';
    else if (correo && (await store.findUserByEmail(correo))) e.correo = 'Ya existe una cuenta con ese correo.';
    const telefono = String(input.telefono ?? '').replace(/[^\d]/g, '');
    if (telefono && !/^(1)?(809|829|849)\d{7}$/.test(telefono)) e.telefono = 'Usa un teléfono dominicano de 10 dígitos.';
    const provincias = [...new Set((Array.isArray(input.provincias) ? input.provincias : []).map(provinciaOficial))];
    if (!provincias.length) e.provincias = 'Elige al menos una provincia que visitará.';
    else if (provincias.includes(null)) e.provincias = 'Hay provincias que no son oficiales.';
    for (const [p0, ms] of Object.entries(input.municipios ?? {})) {
      const p = provinciaOficial(p0);
      if (p && (ms ?? []).some((m) => !municipioOficial(p, m))) e.municipios = `Hay municipios que no pertenecen a ${p}.`;
    }
    if (!e.provincias && !e.municipios && POSITIONS.includes(input.posicion)) {
      const municipios = Object.fromEntries(Object.entries(input.municipios ?? {}).map(([p0, ms]) => [provinciaOficial(p0), (ms ?? []).map((m) => municipioOficial(provinciaOficial(p0), m))]).filter(([p]) => p));
      const cs = await t.conflictosZona({ provincias, municipios }, input.posicion, null);
      if (cs.length) e.provincias = t.mensajeConflicto(cs, input.posicion);
    }
    const rp = provinciaOficial(input.residencia?.provincia);
    const rm = rp && municipioOficial(rp, input.residencia?.municipio);
    if (!rp) e['residencia.provincia'] = 'Elige la provincia donde vive.';
    else if (!rm) e['residencia.municipio'] = 'Elige el municipio donde vive.';
    let perfil = null;
    try {
      perfil = v.prepararPerfil({ ...input, residencia: { provincia: rp, municipio: rm, direccion: input.residencia?.direccion } });
    } catch (err) { if (err.fields) Object.assign(e, Object.fromEntries(Object.entries(err.fields).filter(([k]) => !k.startsWith('residencia')))); else throw err; }
    if (Object.keys(e).length) throw new HttpError(422, 'Revisa los campos marcados.', e);

    const usuario = await usuarioLibre(usuarioBase(nombre, apellido));
    const clave = claveTemporal();
    const u = await store.createUser({
      fullName: `${nombre} ${apellido}`, email: correo, phone: telefono ? telefono.slice(-10).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : null,
      role: 'representante', position: input.posicion, username: usuario, debeCambiarClave: true,
      passwordHash: await hashPassword(clave), status: STATUS.ACTIVO,
    });
    await store.addAudit({ actorId: actor.id, action: 'representante_creado', entity: 'user', entityId: u.id, after: { usuario, posicion: u.position, provincias } });
    await t.asignarZona(actor, u.id, { provincias, municipios: input.municipios ?? {} });
    await v.guardarPerfil(actor, u.id, { ...input, residencia: perfil.residencia });
    return { representante: { id: u.id, nombre: u.fullName, posicion: u.position, usuario, correo }, claveTemporal: clave };
  }

  /** Nueva contraseña temporal (si la olvidó). Se muestra una sola vez y debe cambiarla al entrar. */
  async function restablecerClave(actor, id) {
    permitir(actor);
    const u = await store.findUserById(id);
    if (!u || u.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const clave = claveTemporal();
    let usuario = u.username;
    if (!usuario) {
      const [n, ...rest] = u.fullName.split(' ');
      usuario = await usuarioLibre(usuarioBase(n, rest.join(' ')));
    }
    await store.updateUser(u.id, { passwordHash: await hashPassword(clave), debeCambiarClave: true, ...(u.username ? {} : { username: usuario }) });
    await store.addAudit({ actorId: actor.id, action: 'clave_temporal_generada', entity: 'user', entityId: u.id });
    return { usuario, claveTemporal: clave };
  }
  return { alta, restablecerClave };
}

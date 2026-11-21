// Alta de representantes (Promotora, Visitador, Vendedor, PVC) por el administrador.
// Con nombre y apellido se crea el usuario (ej. jperez) y una contraseña temporal que se muestra una sola vez;
// el representante la cambia al entrar. En el mismo paso se asignan posición, zona, residencia y vehículo
// (o transporte público), para que su cronograma, km, combustible y viáticos se calculen solos.
import { randomInt } from 'node:crypto';
import { AuthError as HttpError } from './auth.js';
import { POSITIONS, STATUS } from './roles.js';
import { hashPassword } from './security.js';
import { normalizeName, errorClave } from './validation.js';
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

export function createAltaRepresentantes({ store, t, v, data, notificar }) {
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

  // Contraseña inicial: una global y fija (si la administración la configuró) o una temporal al azar.
  // En los dos casos el representante debe cambiarla al entrar por primera vez.
  async function claveInicial() {
    const [c] = data ? await data.list('configuracion', { clave: 'clave_inicial' }) : [];
    if (c?.valor?.hash) return { passwordHash: c.valor.hash, clave: null, global: true };
    const clave = claveTemporal();
    return { passwordHash: await hashPassword(clave), clave, global: false };
  }
  const credenciales = (usuario, ini) => ({ usuario, claveTemporal: ini.clave, claveInicialGlobal: ini.global });
  async function verClaveInicial(actor) {
    permitir(actor);
    const [c] = data ? await data.list('configuracion', { clave: 'clave_inicial' }) : [];
    return { configurada: Boolean(c?.valor?.hash), actualizada: c?.updatedAt ?? c?.createdAt ?? null };
  }
  async function guardarClaveInicial(actor, input = {}) {
    if (actor?.role !== 'administrador' || actor.status !== STATUS.ACTIVO) throw new HttpError(403, 'Solo la administración fija la contraseña inicial.');
    if (input.quitar) {
      const [c] = await data.list('configuracion', { clave: 'clave_inicial' });
      if (c) await data.update('configuracion', c.id, { valor: {}, actualizadoPor: actor.id });
      await store.addAudit({ actorId: actor.id, action: 'clave_inicial_quitada', entity: 'configuracion', entityId: 'clave_inicial' });
      return { configurada: false };
    }
    const err = errorClave(input.clave);
    if (err) throw new HttpError(422, 'Revisa los campos marcados.', { clave: err });
    const valor = { hash: await hashPassword(String(input.clave)) }; // solo se guarda cifrada; no se puede volver a ver
    const [c] = await data.list('configuracion', { clave: 'clave_inicial' });
    if (c) await data.update('configuracion', c.id, { valor, actualizadoPor: actor.id }); else await data.insert('configuracion', { clave: 'clave_inicial', valor, actualizadoPor: actor.id });
    await store.addAudit({ actorId: actor.id, action: 'clave_inicial_fijada', entity: 'configuracion', entityId: 'clave_inicial' });
    return { configurada: true };
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
    const ini = await claveInicial();
    const u = await store.createUser({
      fullName: `${nombre} ${apellido}`, email: correo, phone: telefono ? telefono.slice(-10).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : null,
      role: 'representante', position: input.posicion, username: usuario, debeCambiarClave: true,
      passwordHash: ini.passwordHash, status: STATUS.ACTIVO,
    });
    await store.addAudit({ actorId: actor.id, action: 'representante_creado', entity: 'user', entityId: u.id, after: { usuario, posicion: u.position, provincias } });
    await t.asignarZona(actor, u.id, { provincias, municipios: input.municipios ?? {} });
    await v.guardarPerfil(actor, u.id, { ...input, residencia: perfil.residencia });
    return { representante: { id: u.id, nombre: u.fullName, posicion: u.position, usuario, correo }, ...credenciales(usuario, ini) };
  }

  /** Nueva contraseña temporal (si la olvidó). Se muestra una sola vez y debe cambiarla al entrar. */
  async function restablecerClave(actor, id) {
    permitir(actor);
    const u = await store.findUserById(id);
    if (!u || u.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const ini = await claveInicial();
    let usuario = u.username;
    if (!usuario) {
      const [n, ...rest] = u.fullName.split(' ');
      usuario = await usuarioLibre(usuarioBase(n, rest.join(' ')));
    }
    await store.updateUser(u.id, { passwordHash: ini.passwordHash, debeCambiarClave: true, ...(u.username ? {} : { username: usuario }) });
    await store.addAudit({ actorId: actor.id, action: ini.global ? 'clave_inicial_asignada' : 'clave_temporal_generada', entity: 'user', entityId: u.id });
    return credenciales(usuario, ini);
  }
  async function representante(id) {
    const u = await store.findUserById(id);
    if (!u || u.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    return u;
  }
  /** Corregir nombre, teléfono o correo. El usuario de acceso no cambia (para no dejarlo fuera). */
  async function editar(actor, id, input = {}) {
    permitir(actor);
    const u = await representante(id);
    const e = {}; const patch = {};
    if (input.nombre !== undefined || input.apellido !== undefined) {
      const nombre = normalizeName(input.nombre); const apellido = normalizeName(input.apellido);
      if (nombre.length < 2) e.nombre = 'Escribe el nombre.';
      if (apellido.length < 2) e.apellido = 'Escribe el apellido.';
      patch.fullName = `${nombre} ${apellido}`.trim();
    }
    if (input.telefono !== undefined && input.telefono !== '') {
      const d = String(input.telefono).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (!/^(809|829|849)\d{7}$/.test(d)) e.telefono = 'Escribe un teléfono dominicano (809, 829 u 849).';
      else patch.phone = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (input.correo !== undefined && input.correo !== '') {
      const c = String(input.correo).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(c)) e.correo = 'Escribe un correo válido.';
      else { const otro = await store.findUserByEmail(c); if (otro && otro.id !== u.id) e.correo = 'Ese correo ya lo usa otra cuenta.'; else patch.email = c; }
    }
    if (Object.keys(e).length) throw new HttpError(422, 'Revisa los campos marcados.', e);
    if (!Object.keys(patch).length) return { item: vistaRep(u) };
    // Si cambia el nombre, cambia su usuario y vuelve a la contraseña inicial (debe cambiarla al entrar).
    let cred = null;
    if (patch.fullName && patch.fullName !== u.fullName) {
      const base = usuarioBase(normalizeName(input.nombre), normalizeName(input.apellido));
      const usuario = base === u.username ? base : await usuarioLibre(base);
      const ini = await claveInicial();
      Object.assign(patch, { username: usuario, passwordHash: ini.passwordHash, debeCambiarClave: true });
      cred = credenciales(usuario, ini);
    }
    const out = await store.updateUser(u.id, patch);
    const { passwordHash, ...sinClave } = patch;
    await store.addAudit({ actorId: actor.id, action: 'representante_editado', entity: 'user', entityId: u.id, before: { fullName: u.fullName, username: u.username ?? null, phone: u.phone ?? null, email: u.email ?? null }, after: sinClave });
    return { item: vistaRep(out), ...(cred ?? {}) };
  }
  const vistaRep = (u) => ({ id: u.id, fullName: u.fullName, username: u.username ?? null, email: u.email ?? null, phone: u.phone ?? null, position: u.position ?? null, status: u.status });
  /**
   * Dar de baja: la cuenta queda inactiva (no entra más), su territorio queda libre para otro de su posición y
   * se anulan sus días de cronograma futuros sin jornada. Su historial (jornadas, viáticos, recetas) se conserva.
   */
  async function baja(actor, id, motivo) {
    permitir(actor);
    const u = await representante(id);
    if (u.status !== STATUS.ACTIVO) throw new HttpError(409, 'Este representante ya está dado de baja.');
    const m = normalizeName(motivo);
    if (m.length < 3) throw new HttpError(422, 'Revisa los campos marcados.', { motivo: 'Escribe el motivo de la baja.' });
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
    let anulados = 0;
    if (data) {
      const js = await data.list('jornadas', { representanteId: u.id });
      for (const c of await data.list('cronogramas', { representanteId: u.id })) {
        if (c.estado !== 'aprobado' || c.fecha < hoy || js.some((j) => j.cronogramaId === c.id && j.estado !== 'cancelada')) continue;
        await data.update('cronogramas', c.id, { estado: 'anulado', motivo: `Baja del representante: ${m}` }); anulados++;
      }
    }
    const out = await store.updateUser(u.id, { status: STATUS.INACTIVO });
    await store.addAudit({ actorId: actor.id, action: 'representante_baja', entity: 'user', entityId: u.id, before: { status: u.status }, after: { status: STATUS.INACTIVO, motivo: m, cronogramasAnulados: anulados } });
    return { item: vistaRep(out), cronogramasAnulados: anulados };
  }
  /** Reactivar: vuelve a entrar con una contraseña temporal nueva. Su zona se revisa de nuevo al editarla. */
  async function reactivar(actor, id) {
    permitir(actor);
    const u = await representante(id);
    if (u.status === STATUS.ACTIVO) throw new HttpError(409, 'Este representante ya está activo.');
    if (u.status !== STATUS.INACTIVO) throw new HttpError(409, 'Solo se reactivan representantes dados de baja.');
    await store.updateUser(u.id, { status: STATUS.ACTIVO });
    await store.addAudit({ actorId: actor.id, action: 'representante_reactivado', entity: 'user', entityId: u.id, before: { status: u.status }, after: { status: STATUS.ACTIVO } });
    const cred = await restablecerClave(actor, u.id);
    return { item: vistaRep(await store.findUserById(u.id)), ...cred };
  }
  return { alta, restablecerClave, editar, baja, reactivar, verClaveInicial, guardarClaveInicial };
}

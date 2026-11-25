import { errorClave, validateRegistration } from './validation.js';
import { hashPassword, verifyPassword } from './security.js';
import { STATUS, canApprove } from './roles.js';

export class AuthError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

const publicUser = ({ passwordHash, ...u }) => u;

/** `preregistro`: { buscar(email, role), confirmar(user, p) } — opcional, para representantes cargados por Excel. */
export function createAuthService(store, { preregistro, farmaciaPara, farmaciaNueva, registroMedico } = {}) {
  return {
    async register(input) {
      // Dependiente que elige su farmacia del catálogo: queda ligada y activa de inmediato.
      let farmacia = null; let nueva = null;
      if (String(input?.role ?? '').toLowerCase() === 'dependiente' && input.farmaciaId && farmaciaPara) {
        farmacia = await farmaciaPara(String(input.farmaciaId));
        if (!farmacia) throw new AuthError(422, 'Revisa los campos marcados.', { farmaciaId: 'Esa farmacia no está en el catálogo. Búscala de nuevo o escribe su nombre.' });
        input = { ...input, pharmacy: farmacia.nombre, province: farmacia.provincia };
      } else if (String(input?.role ?? '').toLowerCase() === 'dependiente' && farmaciaNueva) {
        // Su farmacia no está en el catálogo: se agrega como pendiente (con provincia y municipio) y queda ligada.
        // La dependiente siempre queda ligada a una farmacia, una provincia y un municipio.
        const r = await farmaciaNueva({ nombre: input.pharmacy, provincia: input.province, municipio: input.municipio });
        if (r.errores) throw new AuthError(422, 'Revisa los campos marcados.', r.errores);
        nueva = r.farmacia;
      }
      const { ok, errors, data } = validateRegistration(input);
      // Médico: especialidad y lugares de trabajo (varias provincias, municipios y establecimientos).
      let medico = null;
      if (String(input?.role ?? '').toLowerCase() === 'medico' && registroMedico) {
        medico = await registroMedico.validar(input);
        if (medico.errores) throw new AuthError(422, 'Revisa los campos marcados.', { ...(errors ?? {}), ...medico.errores });
      }
      if (!ok) throw new AuthError(422, 'Revisa los campos marcados.', errors);
      if (await store.findUserByEmail(data.email)) {
        throw new AuthError(409, 'Ya existe una cuenta con ese correo.', { email: 'Este correo ya está registrado. Inicia sesión.' });
      }
      const { password, ...rest } = data;
      const pre = await preregistro?.buscar(data.email, data.role);
      const user = await store.createUser({
        ...rest, ...(pre ? { position: pre.posicion } : {}), ...(farmacia ? { farmaciaId: farmacia.id } : nueva ? { farmaciaId: nueva.id } : {}),
        passwordHash: await hashPassword(password), status: pre || farmacia ? STATUS.ACTIVO : STATUS.PENDIENTE,
      });
      await store.addAudit({ action: pre ? 'registro_preaprobado' : farmacia ? 'registro_dependiente_farmacia' : 'registro_solicitado', entity: 'user', entityId: user.id, after: { role: user.role, ...(pre ? { position: user.position } : {}), ...(farmacia ? { farmaciaId: farmacia.id, farmacia: farmacia.nombre } : {}), ...(nueva ? { farmaciaId: nueva.id, farmaciaNueva: nueva.nombre } : {}) } });
      if (pre) await preregistro.confirmar(user, pre);
      if (medico) await registroMedico.crear(user, medico.datos);
      return publicUser(user);
    },

    /** Entra con el correo o con el usuario que creó el administrador (ej. jperez). */
    async login(email, password) {
      const id = String(email ?? '').trim().toLowerCase();
      const user = id.includes('@') ? await store.findUserByEmail(id) : await store.findUserByUsername?.(id);
      const valid = user && (await verifyPassword(String(password ?? ''), user.passwordHash));
      if (!valid) throw new AuthError(401, 'Correo, usuario o contraseña incorrectos.');
      if (user.status === STATUS.PENDIENTE) throw new AuthError(403, 'Tu cuenta espera aprobación de la gerencia.');
      if (user.status !== STATUS.ACTIVO) throw new AuthError(403, 'Tu cuenta no está activa. Contacta al administrador.');
      return publicUser(user);
    },

    /** Cambio de contraseña del propio usuario (obligatorio la primera vez si la creó el administrador). */
    async cambiarMiClave(user, actual, nueva) {
      if (!user) throw new AuthError(401, 'Inicia sesión.');
      const u = await store.findUserById(user.id);
      if (!(await verifyPassword(String(actual ?? ''), u.passwordHash))) throw new AuthError(422, 'Revisa los campos marcados.', { actual: 'La contraseña actual no es correcta.' });
      const err = errorClave(nueva);
      if (err) throw new AuthError(422, 'Revisa los campos marcados.', { nueva: err });
      if (String(nueva) === String(actual)) throw new AuthError(422, 'Revisa los campos marcados.', { nueva: 'Elige una contraseña distinta de la temporal.' });
      await store.updateUser(u.id, { passwordHash: await hashPassword(String(nueva)), debeCambiarClave: false });
      await store.addAudit({ actorId: u.id, action: 'clave_cambiada', entity: 'user', entityId: u.id });
      return { ok: true };
    },

    async decide(approver, userId, approve) {
      const target = await store.findUserById(userId);
      if (!target) throw new AuthError(404, 'La solicitud no existe.');
      if (target.status !== STATUS.PENDIENTE) throw new AuthError(409, 'Esta solicitud ya fue decidida.');
      if (!approver || approver.status !== STATUS.ACTIVO || !canApprove(approver.role, target.role)) {
        throw new AuthError(403, 'No tienes permiso para decidir esta solicitud.');
      }
      if (approver.id === target.id) throw new AuthError(403, 'No puedes aprobar tu propia cuenta.');
      const status = approve ? STATUS.ACTIVO : STATUS.RECHAZADO;
      const updated = await store.updateUser(userId, { status, approvedBy: approver.id });
      if (target.role === 'medico') await registroMedico?.alDecidir(target, approve);
      await store.addAudit({
        actorId: approver.id, action: approve ? 'registro_aprobado' : 'registro_rechazado',
        entity: 'user', entityId: userId, before: { status: target.status }, after: { status },
      });
      return publicUser(updated);
    },
  };
}

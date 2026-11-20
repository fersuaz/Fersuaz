import { validateRegistration } from './validation.js';
import { hashPassword, verifyPassword } from './security.js';
import { STATUS, canApprove } from './roles.js';

export class AuthError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

const publicUser = ({ passwordHash, ...u }) => u;

/** `preregistro`: { buscar(email, role), confirmar(user, p) } — opcional, para representantes cargados por Excel. */
export function createAuthService(store, { preregistro, farmaciaPara } = {}) {
  return {
    async register(input) {
      // Dependiente que elige su farmacia del catálogo: queda ligada y activa de inmediato.
      let farmacia = null;
      if (String(input?.role ?? '').toLowerCase() === 'dependiente' && input.farmaciaId && farmaciaPara) {
        farmacia = await farmaciaPara(String(input.farmaciaId));
        if (!farmacia) throw new AuthError(422, 'Revisa los campos marcados.', { farmaciaId: 'Esa farmacia no está en el catálogo. Búscala de nuevo o escribe su nombre.' });
        input = { ...input, pharmacy: farmacia.nombre, province: farmacia.provincia };
      }
      const { ok, errors, data } = validateRegistration(input);
      if (!ok) throw new AuthError(422, 'Revisa los campos marcados.', errors);
      if (await store.findUserByEmail(data.email)) {
        throw new AuthError(409, 'Ya existe una cuenta con ese correo.', { email: 'Este correo ya está registrado. Inicia sesión.' });
      }
      const { password, ...rest } = data;
      const pre = await preregistro?.buscar(data.email, data.role);
      const user = await store.createUser({
        ...rest, ...(pre ? { position: pre.posicion } : {}), ...(farmacia ? { farmaciaId: farmacia.id } : {}),
        passwordHash: await hashPassword(password), status: pre || farmacia ? STATUS.ACTIVO : STATUS.PENDIENTE,
      });
      await store.addAudit({ action: pre ? 'registro_preaprobado' : farmacia ? 'registro_dependiente_farmacia' : 'registro_solicitado', entity: 'user', entityId: user.id, after: { role: user.role, ...(pre ? { position: user.position } : {}), ...(farmacia ? { farmaciaId: farmacia.id, farmacia: farmacia.nombre } : {}) } });
      if (pre) await preregistro.confirmar(user, pre);
      return publicUser(user);
    },

    async login(email, password) {
      const user = await store.findUserByEmail(String(email ?? '').trim().toLowerCase());
      const valid = user && (await verifyPassword(String(password ?? ''), user.passwordHash));
      if (!valid) throw new AuthError(401, 'Correo o contraseña incorrectos.');
      if (user.status === STATUS.PENDIENTE) throw new AuthError(403, 'Tu cuenta espera aprobación de la gerencia.');
      if (user.status !== STATUS.ACTIVO) throw new AuthError(403, 'Tu cuenta no está activa. Contacta al administrador.');
      return publicUser(user);
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
      await store.addAudit({
        actorId: approver.id, action: approve ? 'registro_aprobado' : 'registro_rechazado',
        entity: 'user', entityId: userId, before: { status: target.status }, after: { status },
      });
      return publicUser(updated);
    },
  };
}

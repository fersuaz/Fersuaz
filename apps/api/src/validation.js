import { POSITIONS, ROLES, SELF_REGISTERABLE } from './roles.js';

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const EMAIL_MAL = /\.\.|^\.|\.@|@\.|@-|-\./;
// Teléfonos dominicanos: códigos 809, 829, 849 + 7 dígitos. Acepta +1, espacios y guiones.
const DO_PHONE_RE = /^(?:\+?1)?(809|829|849)\d{7}$/;

export function normalizeName(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function normalizePhone(value) {
  return String(value ?? '').replace(/[\s\-().]/g, '');
}

/**
 * Valida una solicitud de registro. Devuelve { ok, data, errors }.
 * errors es un objeto { campo: mensaje } listo para mostrar en el formulario.
 */
export function validateRegistration(input = {}) {
  const errors = {};
  const fullName = normalizeName(input.fullName);
  const email = String(input.email ?? '').trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  const role = String(input.role ?? '').trim().toLowerCase();
  const position = input.position ? normalizeName(input.position) : null;
  const password = String(input.password ?? '');

  if (fullName.length < 3) errors.fullName = 'Escribe tu nombre completo.';
  else if (fullName.length > 120) errors.fullName = 'El nombre no puede pasar de 120 caracteres.';

  if (!EMAIL_RE.test(email) || EMAIL_MAL.test(email) || email.length > 254) errors.email = 'Escribe un correo válido, por ejemplo nombre@fersuaz.net.';

  if (phone && !DO_PHONE_RE.test(phone)) {
    errors.phone = 'Usa un teléfono dominicano de 10 dígitos que empiece por 809, 829 o 849.';
  }

  if (role === ROLES.ADMINISTRADOR) {
    errors.role = 'Las cuentas de administrador las crea el equipo de FERSUAZ.';
  } else if (!SELF_REGISTERABLE.includes(role)) {
    errors.role = 'Elige el tipo de usuario.';
  }

  if (role === ROLES.REPRESENTANTE) {
    if (!position || !POSITIONS.includes(position)) {
      errors.position = `Elige tu posición: ${POSITIONS.join(', ')}.`;
    }
  }

  // Dependiente: su farmacia se registra como texto pendiente de validación
  // hasta que exista el directorio de farmacias (no se inventan farmacias).
  const pharmacy = role === ROLES.DEPENDIENTE ? normalizeName(input.pharmacy) : null;
  const province = role === ROLES.DEPENDIENTE ? normalizeName(input.province) : null;
  if (role === ROLES.DEPENDIENTE) {
    if (pharmacy.length < 2) errors.pharmacy = 'Escribe el nombre de la farmacia donde trabajas.';
    if (province.length < 2) errors.province = 'Escribe la provincia de tu farmacia.';
  }

  if (password.length < 10) errors.password = 'La contraseña necesita al menos 10 caracteres.';
  else if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) {
    errors.password = 'La contraseña debe combinar letras y números.';
  } else if (password.length > 200) errors.password = 'La contraseña es demasiado larga.';

  if (input.acceptsPrivacy !== true) {
    errors.acceptsPrivacy = 'Debes aceptar la política de privacidad para continuar.';
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    data: ok
      ? { fullName, email, phone: phone || null, role, position: role === ROLES.REPRESENTANTE ? position : null, pharmacy, province, password }
      : null,
  };
}

/** Regla de contraseña (la misma del registro). Devuelve el mensaje de error o null. */
export function errorClave(password) {
  const p = String(password ?? '');
  if (p.length < 10) return 'La contraseña necesita al menos 10 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) || !/\d/.test(p)) return 'La contraseña debe combinar letras y números.';
  if (p.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

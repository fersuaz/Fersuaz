// Tipos de usuario de FERSUAZ.NET y reglas de registro/aprobación.

export const ROLES = Object.freeze({
  ADMINISTRADOR: 'administrador',
  GERENCIA: 'gerencia',
  SUPERVISOR: 'supervisor',
  REPRESENTANTE: 'representante',
  FINANZAS: 'finanzas',
  DEPENDIENTE: 'dependiente', // dependiente de farmacia (vouchers y comisiones)
});

export const ROLE_LABELS = Object.freeze({
  administrador: 'Administrador',
  gerencia: 'Gerencia',
  supervisor: 'Supervisor',
  representante: 'Representante',
  finanzas: 'Finanzas',
  dependiente: 'Dependiente de farmacia',
});

// Posiciones comerciales aprobadas (solo aplican al rol representante).
export const POSITIONS = Object.freeze(['Visitador', 'PVC', 'Vendedor', 'Promotora']);

// Roles que pueden solicitarse en el registro público. Administrador nunca.
export const SELF_REGISTERABLE = Object.freeze([
  ROLES.GERENCIA, ROLES.SUPERVISOR, ROLES.REPRESENTANTE, ROLES.FINANZAS, ROLES.DEPENDIENTE,
]);

// Quién puede aprobar una solicitud de cada rol.
const APPROVERS = Object.freeze({
  gerencia: [ROLES.ADMINISTRADOR],
  finanzas: [ROLES.ADMINISTRADOR],
  supervisor: [ROLES.ADMINISTRADOR, ROLES.GERENCIA],
  representante: [ROLES.ADMINISTRADOR, ROLES.GERENCIA, ROLES.SUPERVISOR],
  dependiente: [ROLES.ADMINISTRADOR, ROLES.GERENCIA, ROLES.SUPERVISOR],
});

export function canApprove(approverRole, requestedRole) {
  return (APPROVERS[requestedRole] ?? []).includes(approverRole);
}

export const STATUS = Object.freeze({
  PENDIENTE: 'pendiente_aprobacion',
  ACTIVO: 'activo',
  RECHAZADO: 'rechazado',
  INACTIVO: 'inactivo',
});

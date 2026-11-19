# Primer prompt de módulos — FERSUAZ.NET

Copia este texto en Claude Code (o en un issue con `@claude`) para continuar el desarrollo.

---

Actúa como el agente `desarrollador` de `.claude/agents/desarrollador.md` en el repositorio fersuaz/Fersuaz.
Lee `CLAUDE.md`, `docs/PROMPT-MAESTRO-TERRITORIOS.md` y `docs/ESTRUCTURA-COMERCIAL.md`.

Estado actual (ya construido y probado):
- Sitio público con scrollytelling (`apps/web/index.html`), registro por tipo de usuario y login.
- API de registro con roles: representante (con posición), dependiente (con farmacia/provincia), supervisor,
  gerencia y finanzas; aprobación según matriz de roles; auditoría; 24 pruebas pasando.
- Cálculos: combustible, alimentación, noches/hospedaje, presupuesto (sin salario), duplicados,
  comisión de vouchers y alerta de inventario al 75 %.

Trabaja en este orden. Un pull request por punto. Espera aprobación entre puntos.

**Módulo A — Panel de aprobación de cuentas.**
Pantalla `apps/web/app/aprobaciones.html` para administrador, gerencia y supervisor: lista de solicitudes
pendientes (`GET /api/auth/pending`), ver datos, aprobar o rechazar con confirmación. Filtra en backend lo que
cada rol puede aprobar. Envía correo por AWS SES al aprobar (si faltan credenciales, deja el envío en cola y
muestra "correo pendiente de configuración"). Pruebas de permisos por rol.

**Módulo B — Representantes (Módulo 2 del prompt maestro).**
Migración `002_representatives.sql`, carga de los 19 espacios iniciales tal como están en la sección 6
(vacantes incluidas, zonas ambiguas marcadas "por revisar"), directorio con búsqueda y filtros, ficha con
residencia restringida por rol, historial. Vincular usuario aprobado ↔ ficha de representante.

**Módulo C — Dashboard gerencial con estados vacíos (Módulo 1).**
Indicadores conectados solo a datos reales; donde no hay datos, explicar qué falta y enlazar a dónde cargarlo.

**Módulo D — Recetas de promotoras (objetivo 1 de la estructura comercial).**
Registro diario de operativo (provincia, municipio, centro), carga de foto de receta a DigitalOcean Spaces
(privado, validación de tipo y tamaño), desglose de medicamentos desde un catálogo, médico prescriptor,
y alerta de inventario usando `evaluarAlertaInventario` con umbral configurable. Notificación vía Twilio cuando
existan credenciales.

**Módulo E — Vouchers y comisiones de dependientes (objetivo 2).**
Carga de vouchers con varios medicamentos, comisión con `calcularComisionVouchers`, porcentaje y período
(quincenal/mensual) configurables globalmente o por dependiente, cierre de período auditable.

Reglas: no inventar datos, autorización en backend, salario separado de viáticos, interfaz en español con la
identidad de CLAUDE.md, y al final de cada módulo el informe de la sección 15 del prompt maestro.
Antes de fusionar, pide revisión al agente `revisor` y ejecuta el agente `probador`.

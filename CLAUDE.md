# FERSUAZ.NET — Reglas para Claude

Plataforma para automatizar el departamento comercial de FERSUAZ (República Dominicana):
representantes, territorios, establecimientos médicos, rutas, viáticos y liquidaciones.
La especificación funcional completa está en `docs/PROMPT-MAESTRO-TERRITORIOS.md`.

## Estructura
- `apps/web` — sitio público + app web (HTML5, CSS3, JavaScript sin framework). Se despliega en **Cloudflare Pages**.
- `apps/api` — API Node.js 22 (sin dependencias en el núcleo). Se despliega en **DigitalOcean App Platform**.
- `apps/api/migrations` — SQL para PostgreSQL (DigitalOcean Managed Database).
- `.claude/agents` — subagentes: `desarrollador`, `probador`, `revisor`.
- `.github/workflows` — CI, revisión automática con Claude y despliegues.

## Comandos
- Pruebas API: `cd apps/api && npm test`
- Servidor local API: `cd apps/api && npm run dev` (puerto 8080)
- Web local: `npx serve apps/web` (o cualquier servidor estático)

## Reglas no negociables
1. Interfaz en español. Moneda RD$. Zona horaria America/Santo_Domingo.
2. No inventar datos: sin cifras ficticias presentadas como reales. Los ejemplos se rotulan "Ejemplo".
3. Autorización siempre en backend; el frontend solo oculta, nunca protege.
4. Salario separado de viáticos en todo modelo, pantalla y reporte.
5. Ningún secreto en el repositorio ni en JavaScript público. Usar variables de entorno / GitHub Secrets.
6. Movimientos financieros aprobados no se borran: reversos o ajustes auditables.
7. Todo cálculo (combustible, alimentación, hospedaje, presupuesto) lleva pruebas unitarias.
8. Cambios pequeños y reversibles. Un PR por funcionalidad. Explicar cómo revertir.
9. Estados vacíos, de carga y de error en cada pantalla. Accesible: teclado, foco visible, contraste AA, `prefers-reduced-motion`.

## Identidad visual (lujo sobrio)
- Colores: Verde Caribe `#08201C`, Bosque `#123A33`, Champán `#C9A96E`, Perla `#E6EBE8`, Niebla `#8FA39D`, Alerta `#D2644A`.
- Tipografía: **Bodoni Moda** (títulos), **Figtree** (texto e interfaz).
- Un solo momento de movimiento memorable por página. Nada de animar cada tarjeta.

## Roles
Administrador, Gerencia, Supervisor, Representante, Finanzas.
El rol Administrador no se puede solicitar en el registro público.

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

## Identidad visual (colores corporativos de Laboratorio FERSUAZ)
- Logo: `apps/web/assets/brand/fersuaz-logo-color.svg` (fondos claros) y `fersuaz-logo-blanco.svg` (fondos azules). No redibujar ni recolorear.
- Colores, muestreados del logo oficial:
  - Azul marino `#003463` (SUAZ): títulos, botón principal, fondos de contraste.
  - Celeste `#3085AC` (FER): acentos gráficos, líneas, títulos grandes. No usarlo en texto pequeño (contraste 3.9:1).
  - Celeste texto `#246C8E`: enlaces y texto pequeño en celeste (5.5:1).
  - Blanco clínico `#F5F8FB` (fondo), Panel `#E9F0F6`, Línea `#C7D6E3`, Tinta `#0F2A44`, Texto secundario `#52677A`, Alerta `#C0462C`.
- Prohibido el verde u otros colores ajenos a la marca en páginas, imágenes o video.
- Tipografía: **Poppins** 500/600 (títulos, geométrica como el logo) y **Figtree** 400/500/600 (texto e interfaz).
- Un solo momento de movimiento memorable por página. Nada de animar cada tarjeta.

## Páginas cinematográficas (skill `10k-websites` + Higgsfield)
Para el sitio público y cualquier hero con video, la referencia es la skill `10k-websites`.
Ver `docs/REFERENCIA-10K.md` para el mapa completo. En resumen:
- Imágenes y video: siempre Higgsfield. Preflight de costo (`get_cost: true`) y precio dicho al usuario antes de gastar créditos.
- Las 12 leyes del video (`references/prompt-laws.md`) antes de escribir cualquier prompt.
- Estándar del hero scrub (`references/scrub-pipeline.md`): video como Blob con anillo de carga, lerp normalizado, seeks con compuerta, escrituras al DOM solo con cambios, bandas de texto en vh con prueba de flick, sistema de legibilidad de 4 capas, 5 compuertas de hero estático en CSS y JS, página completa sin video.
- Codificación con `references/ffmpeg-recipes.md` (`-g 8 -keyint_min 8`). Crudos y revisiones FUERA de `apps/web`.
- ⛔ Compuerta de video: el usuario aprueba cada video antes de construir alrededor de él.
- Antes de mostrar: grep de rayas largas y palabras de relleno, y la lista de autoprueba completa.
- Excepción aprobada para FERSUAZ: el despliegue NO usa Hostinger. Sigue en Cloudflare Pages (`deploy-web.yml`) según la estructura tecnológica de la empresa.

## Roles
Administrador, Gerencia, Supervisor, Representante, Finanzas.
El rol Administrador no se puede solicitar en el registro público.

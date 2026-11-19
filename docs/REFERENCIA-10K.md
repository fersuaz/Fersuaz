# Referencia: skill 10k-websites aplicada a FERSUAZ.NET

La skill `10k-websites` es el estándar para el sitio público cinematográfico. Este documento dice qué se toma tal cual
y qué se adapta a la infraestructura de FERSUAZ.

## Se usa tal cual
| Parte de la skill | Dónde se aplica en FERSUAZ |
|---|---|
| Las 12 leyes del video y las plantillas de prompt | Todo hero o video generado en Higgsfield |
| Preflight de costo y elección de modelo con números reales | Antes de cada imagen o video |
| Compuerta de video (aprobación del usuario) | Antes de construir la página alrededor del video |
| Paquete de diseño (`design-package.md`) | Se escribe en `docs/diseno/<pagina>.md` antes de generar |
| Estándar del hero scrub y piso de calidad | `apps/web/index.html` y futuras páginas con video |
| Recetas de ffmpeg | Codificación en `apps/web/assets/`, crudos en `review/` fuera del despliegue |
| Autoprueba y compuerta de textos | Parte del agente `probador` |

## Se adapta
| La skill dice | FERSUAZ hace | Por qué |
|---|---|---|
| Hostinger para publicar | Cloudflare Pages vía GitHub Actions | La estructura tecnológica de la empresa ya usa Cloudflare (SSL, CDN, anti-bots) |
| Un solo `index.html` sin backend; formulario a mailto o servicio externo | La web es estática pero el registro llama a la API propia en DigitalOcean | El registro por tipo de usuario necesita backend real |
| Verificar en vivo con `curl` y medir velocidad | Igual, contra la vista previa de Cloudflare de cada PR y contra fersuaz.net | Mismo estándar, otro host |

## Pendiente para usar la skill completa
- El conector de Higgsfield de esta sesión solo consulta (créditos, modelos, historial). Para generar imagen y video
  hace falta el conector con herramientas de generación (URL `https://mcp.higgsfield.ai/mcp`).
- Créditos actuales: plan gratuito. Un hero cuesta unos 2 créditos de imagen más 10 a 55 de video según el modelo.

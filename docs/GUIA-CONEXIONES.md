# Guía para conectar todo: GitHub, Claude, Cloudflare, DigitalOcean y Higgsfield

Orden recomendado. Cada paso dice dónde hacerlo y qué guardar.

```
Tú / Claude (desarrollador)  ──PR──►  GitHub  ──CI: pruebas──►  Claude (revisor)
                                         │
                       ┌─────────────────┴──────────────────┐
                 apps/web → Cloudflare Pages         apps/api → DigitalOcean App Platform
                 (fersuaz.net, vista previa por PR)   (api.fersuaz.net + PostgreSQL + Spaces)
```

---

## 1. GitHub — que Claude pueda subir código

El repositorio `fersuaz/Fersuaz` existe pero está vacío, y hoy Claude puede leerlo pero **no hacer push**.

1. Instala la GitHub App de Claude en tu cuenta u organización: https://github.com/apps/claude/installations/select_target → elige `fersuaz/Fersuaz`.
2. En claude.ai → Configuración → Conectores, reconecta GitHub si aparece desconectado.
3. Protege `main`: GitHub → Settings → Branches → Add rule → `main` → exigir pull request y que pase el check **CI**.

Cuando esto esté listo, dile a Claude: *"sube la base al repositorio"* y abrirá el primer pull request.

## 2. Claude dentro de GitHub — desarrollador, probador y revisor automáticos

Los tres agentes ya están definidos en `.claude/agents/` y el flujo en `.github/workflows/claude.yml`.

1. Crea una clave en https://console.anthropic.com → API Keys.
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**: `ANTHROPIC_API_KEY`.
   (Alternativa con suscripción Claude: en Claude Code ejecuta `/install-github-app`, que configura app y secreto por ti.)
3. Uso:
   - **Revisor:** se ejecuta solo en cada pull request y deja comentarios y veredicto.
   - **Desarrollador:** escribe en un issue `@claude implementa el módulo 2 según docs/PROMPT-MODULO-01.md`. Abre un PR.
   - **Probador:** el CI (`ci.yml`) corre las pruebas en cada PR; pídele al desarrollador `@claude usa el agente probador` para ampliar cobertura.

## 3. Cloudflare — web, CDN, SSL y despliegue automático

1. Cloudflare → Workers & Pages → Create → Pages → **Direct Upload** → nombre del proyecto: `fersuaz-web` (sube cualquier archivo la primera vez).
2. Cloudflare → My Profile → API Tokens → Create Token → plantilla **Edit Cloudflare Workers** (incluye Pages). Copia el token.
3. Copia tu **Account ID** (Workers & Pages → panel derecho).
4. En GitHub → Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
5. Dominio (fersuaz.net está registrado en Hostinger; se queda ahí, solo cambia a dónde apunta):
   1. Cloudflare → Add a site → `fersuaz.net` → plan Free. Cloudflare copia los registros DNS actuales y te da dos nameservers (por ejemplo `xxx.ns.cloudflare.com`).
   2. Revisa que estén los registros de correo (MX, SPF, DKIM) antes de seguir, para no cortar el correo.
   3. Hostinger → hPanel → Dominios → fersuaz.net → DNS / Nameservers → "Cambiar nameservers" → pega los dos de Cloudflare.
   4. Espera a que Cloudflare marque el sitio como "Active" (minutos a pocas horas).
   5. En el proyecto Pages → Custom domains → `fersuaz.net` y `www.fersuaz.net`.
6. Seguridad recomendada (Security): Bot Fight Mode activado, SSL "Full (strict)", WAF con reglas gestionadas.

Resultado: cada PR publica una vista previa propia; cada merge a `main` publica fersuaz.net.

## 4. DigitalOcean — API, base de datos, archivos

1. Databases → Create → PostgreSQL → nombre `fersuaz-db`. Ejecuta `apps/api/migrations/001_users_audit.sql`.
2. API → Tokens → Generate (lectura y escritura). En GitHub → Secrets: `DIGITALOCEAN_ACCESS_TOKEN`.
3. Apps → Create App → desde GitHub `fersuaz/Fersuaz` → o con `doctl apps create --spec .do/app.yaml`.
4. En la App → Settings → variables: `SESSION_SECRET` (64 caracteres aleatorios: `openssl rand -hex 32`).
5. Domains → `api.fersuaz.net`; en Cloudflare crea el CNAME que DigitalOcean te indique.
6. En GitHub → Settings → Variables: `API_URL = https://api.fersuaz.net` (la web lo inyecta al desplegar).
7. Spaces (fase de recetas y comprobantes): Spaces → Create → `fersuaz-archivos`, privado; claves en variables de la App.
8. GitHub → Settings → Environments → `production` → exige tu aprobación antes de cada despliegue de la API.

Escala: `instance_count` en `.do/app.yaml` (hasta los 10 servidores previstos); App Platform incluye el balanceador.

## 5. Higgsfield — imágenes y video de lujo para la página

El conector de Higgsfield está conectado a tu cuenta, pero **desde aquí solo puede consultar** espacios de trabajo,
créditos, modelos y generaciones existentes. No genera imágenes ni video ni sube archivos.

Flujo práctico:
1. Genera en higgsfield.ai (por ejemplo: carretera dominicana al amanecer, consultorio con luz cálida, detalle de una receta sobre madera).
2. Pídele a Claude: *"muéstrame mis últimas generaciones de Higgsfield"* para elegir.
3. Descarga y adjunta los archivos en el chat; Claude los optimiza (WebP/AV1) y los coloca en `apps/web/assets/`.
4. Para video de fondo: máx. 6 s, sin audio, < 3 MB, con imagen fija de respaldo y respeto a `prefers-reduced-motion`.

## 6. AWS SES y Twilio (siguiente fase)

- SES: verifica el dominio `fersuaz.net` y sal del sandbox; guarda `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` en DigitalOcean. Se usará para avisar aprobaciones de cuenta.
- Twilio: número o remitente de WhatsApp; `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`. Se usará para alertas de inventario a promotoras.

## 7. App móvil

Fase 1 (ya incluida): la web es una PWA (`manifest.webmanifest`); en el teléfono se instala con "Agregar a pantalla de inicio".
Fase 2: empaquetar con Capacitor para Google Play y App Store reutilizando `apps/web`, cuando existan el panel y la carga de recetas con cámara.

## Resumen de secretos

| Dónde | Nombre | Para qué |
|---|---|---|
| GitHub Secret | `ANTHROPIC_API_KEY` | Claude revisor/desarrollador |
| GitHub Secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Desplegar la web |
| GitHub Secret | `DIGITALOCEAN_ACCESS_TOKEN` | Desplegar la API |
| GitHub Variable | `API_URL` | La web sabe dónde está la API |
| DigitalOcean App | `SESSION_SECRET`, `DATABASE_URL` | Sesiones y base de datos |

Nunca pegues estas claves en el chat ni en el código.

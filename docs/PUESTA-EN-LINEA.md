# Puesta en línea de FERSUAZ.NET

Orden exacto para dejar la API, la base de datos y la web funcionando en `fersuaz.net`.
Ninguna clave se pega en el chat ni en el código: solo en **GitHub → Settings → Secrets and variables → Actions**.

## Lo que ya está listo
- Web en Cloudflare Pages, con despliegue automático desde `main`.
- API con pruebas automáticas (CI con PostgreSQL 16).
- Migraciones 001 a 004. Se aplican solas antes de cada despliegue (job `migrar` en `.do/app.yaml`).

## 1. Base de datos (DigitalOcean → Databases)
1. Create Database Cluster → **PostgreSQL 16** → región **New York (NYC)** → nombre exacto **`fersuaz-db`**.
2. Espera a que diga **Online** (unos 5 minutos).
3. Settings → Trusted sources: déjala sin restricciones por ahora. Cuando la App exista, agrega la App `fersuaz-api` como fuente de confianza.

No hace falta ejecutar SQL a mano: el job `migrar` lo hace en el primer despliegue.

## 2. Token de DigitalOcean
1. API → Tokens → **Generate New Token** → nombre `github-deploy`, permisos **Full Access** (o de escritura para Apps), sin vencimiento corto.
2. En GitHub → Secrets → **New repository secret**: `DIGITALOCEAN_ACCESS_TOKEN`.

## 3. Secreto de sesiones
En tu computadora, en una terminal: `openssl rand -hex 32` (64 caracteres).
Guárdalo en GitHub → Secrets como `SESSION_SECRET`. Si cambia, todas las sesiones se cierran.

## 4. Primer despliegue de la API
GitHub → Actions → **Deploy API (DigitalOcean)** → **Run workflow** → rama `main`.
- Crea la App `fersuaz-api` desde `.do/app.yaml`, aplica las migraciones y arranca la API.
- Comprueba: en DigitalOcean → Apps → `fersuaz-api` → la URL `…ondigitalocean.app/api/health` responde `{"ok":true}`.

## 5. Primer administrador
DigitalOcean → Apps → `fersuaz-api` → **Console** (servicio `api`):
```
npm run crear-admin
```
Pide nombre, correo y contraseña (mínimo 12 caracteres). El rol Administrador nunca se puede pedir desde el registro público.

## 6. Dominio de la API
1. App → Settings → Domains → Add → `api.fersuaz.net`.
2. En Cloudflare → DNS: crea el **CNAME** `api` que DigitalOcean te indique (nube gris, "DNS only", hasta que DigitalOcean emita el certificado).
3. GitHub → Settings → **Variables** (no Secrets): `API_URL = https://api.fersuaz.net`.
4. Vuelve a ejecutar **Deploy Web** para que la web apunte a la API.

## 7. Fotos de recetas y comprobantes (DigitalOcean Spaces)
Necesario antes de usar comprobantes en producción y antes de subir `instance_count` a 2 o más.
1. Spaces Object Storage → Create → región **NYC3** → nombre **`fersuaz-archivos`** → **Restrict File Listing** activado. Sin CDN.
2. Spaces Keys → Generate New Key → nombre `fersuaz-api`, acceso limitado a `fersuaz-archivos` si la opción aparece.
3. GitHub → Secrets: `SPACES_KEY` (Access Key) y `SPACES_SECRET` (Secret Key).
4. Ejecuta de nuevo **Deploy API**. Los archivos quedan privados y solo se sirven a través de la API con permisos.

## 8. Mapas (Google Routes API)
Opcional. Sin clave, los representantes escriben los km y quedan marcados "estimado manual".
1. Google Cloud Console → proyecto `fersuaz` → activa la facturación.
2. APIs & Services → Library → **Routes API** → Enable.
3. Credentials → Create API key → **Restrict key**: API restrictions = solo *Routes API*. (Es una clave de servidor; no se restringe por sitio web.)
4. Billing → Budgets & alerts: crea un presupuesto mensual con alerta, por ejemplo al 50 % y 90 %.
5. GitHub → Secrets: `MAPS_API_KEY`. Ejecuta de nuevo **Deploy API**.
6. Comprueba: en **Mis jornadas** aparece el botón "Calcular km con el mapa".

El servidor recalcula siempre los km del mapa; nunca acepta la cifra que envía el navegador.

## 9. Dominio principal (Hostinger → Cloudflare)
Solo cuando confirmes si usan correo `@fersuaz.net` en Hostinger (si sí, primero copiamos los registros MX a Cloudflare para no cortar el correo).
1. Cloudflare → Add site `fersuaz.net` → plan Free → revisa que importe los registros MX y TXT.
2. Hostinger → Dominios → `fersuaz.net` → DNS / Nameservers → **Cambiar nameservers** → los dos que da Cloudflare.
3. Cloudflare Pages → proyecto → Custom domains → `fersuaz.net` y `www.fersuaz.net`.

## Resumen de secretos y variables en GitHub
| Nombre | Tipo | Obligatorio | Para qué |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secret | Sí | Publicar la web |
| `DIGITALOCEAN_ACCESS_TOKEN` | Secret | Sí | Publicar la API |
| `SESSION_SECRET` | Secret | Sí | Firmar sesiones |
| `SPACES_KEY`, `SPACES_SECRET` | Secret | Antes de usar comprobantes | Archivos privados |
| `MAPS_API_KEY` | Secret | No | Km por carretera |
| `ANTHROPIC_API_KEY` | Secret | No | Revisor automático de PR |
| `API_URL` | Variable | Sí | La web sabe dónde está la API |

## Cómo revertir
- Despliegue malo: DigitalOcean → Apps → `fersuaz-api` → Activity → despliegue anterior → **Rollback**.
- Migración: cada archivo en `apps/api/migrations` tiene su bloque `DOWN` comentado; se ejecuta a mano y se borra la fila de `schema_migrations`. Nunca en tablas con movimientos financieros aprobados sin respaldo previo.
- Web: Cloudflare Pages → Deployments → versión anterior → **Rollback**.

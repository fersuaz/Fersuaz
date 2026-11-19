# FERSUAZ.NET

Automatización del departamento comercial de FERSUAZ: territorios, visitas, recetas, vouchers, comisiones y viáticos.

- `apps/web` — sitio y app web (HTML/CSS/JS, PWA) → Cloudflare Pages
- `apps/api` — API Node.js 22 → DigitalOcean App Platform + PostgreSQL
- `docs/GUIA-CONEXIONES.md` — cómo conectar GitHub, Claude, Cloudflare, DigitalOcean y Higgsfield
- `docs/PROMPT-MODULO-01.md` — siguiente orden de trabajo para Claude

```bash
cd apps/api && npm test       # pruebas
cd apps/api && npm run dev    # API en http://localhost:8080 (memoria, solo desarrollo)
npx serve apps/web            # web local; pon http://localhost:8080 en <meta name="fersuaz-api">
```

"""Genera las páginas de acceso y legales, e inserta el pie de página común.

Uso: python3 tools/build_pages.py
Sin dependencias. El resultado es HTML estático en apps/web (sin paso de build en el despliegue).
"""
from pathlib import Path
import re

WEB = Path(__file__).resolve().parent.parent / "apps" / "web"

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Figtree:wght@400;500;600&display=swap" rel="stylesheet">')

# ---------------------------------------------------------------- pie común
FOOTER = '''  <footer class="pie" aria-labelledby="pie-titulo">
    <h2 id="pie-titulo" class="sr-only">Pie de página</h2>
    <div class="pie-grid">
      <div class="pie-marca">
        <a href="./" class="pie-logo" aria-label="FERSUAZ, inicio"><img src="assets/brand/fersuaz-logo-blanco.svg" alt="FERSUAZ Laboratorio Farmacéutico" width="200" height="56" loading="lazy"></a>
        <p>Laboratorio farmacéutico dominicano. Esta plataforma conecta a visitadores, vendedores, promotoras y dependientes con la gerencia, del consultorio a la farmacia.</p>
        <ul class="pie-chips">
          <li>RNC 1-03-03243-5</li>
          <li>Reg. Ind. 18704</li>
          <li>La Vega, República Dominicana</li>
        </ul>
      </div>
      <nav class="pie-col" aria-label="Plataforma">
        <h3>Plataforma</h3>
        <ul>
          <li><a href="./">Inicio</a></li>
          <li><a href="./#jornada">La jornada</a></li>
          <li><a href="./#cuentas">Tipos de cuenta</a></li>
          <li><a href="./#tio-dex">Tio-Dex</a></li>
        </ul>
      </nav>
      <nav class="pie-col" aria-label="Equipo comercial">
        <h3>Equipo comercial</h3>
        <ul>
          <li><a href="registro.html?rol=representante">Representantes</a></li>
          <li><a href="registro.html?rol=dependiente">Dependientes de farmacia</a></li>
          <li><a href="registro.html?rol=supervisor">Supervisores</a></li>
          <li><a href="registro.html?rol=gerencia">Gerencia y finanzas</a></li>
        </ul>
      </nav>
      <nav class="pie-col" aria-label="Cuenta">
        <h3>Tu cuenta</h3>
        <ul>
          <li><a href="registro.html">Crear cuenta</a></li>
          <li><a href="entrar.html">Iniciar sesión</a></li>
          <li><a href="entrar.html#recuperar">Recuperar acceso</a></li>
        </ul>
      </nav>
      <nav class="pie-col" aria-label="Legal del sitio">
        <h3>Legal</h3>
        <ul>
          <li><a href="terminos.html">Términos y condiciones</a></li>
          <li><a href="privacidad.html">Política de privacidad</a></li>
          <li><a href="seguridad.html">Seguridad y trazabilidad</a></li>
        </ul>
      </nav>
    </div>

    <section class="pie-app" aria-labelledby="app-titulo">
      <div class="pie-telefonos" aria-hidden="true">
        <div class="tel tel-a">
          <div class="tel-pantalla">
            <div class="tel-isla"></div>
            <img class="tel-logo" src="assets/brand/fersuaz-logo-blanco.svg" alt="" width="90" height="25">
            <p class="tel-etq">Ruta de hoy</p>
            <ol class="tel-ruta"><li><span></span>Residencia</li><li><span></span>Clínica</li><li><span></span>Hospital</li><li><span></span>Farmacia</li></ol>
            <p class="tel-km">Ejemplo</p>
          </div>
        </div>
        <div class="tel tel-b">
          <div class="tel-pantalla">
            <div class="tel-isla"></div>
            <img class="tel-logo" src="assets/brand/fersuaz-logo-blanco.svg" alt="" width="90" height="25">
            <div class="tel-tarjeta"><p>Comisión de la quincena</p><strong>RD$ 5,000</strong><small>Ejemplo · 100 vouchers al 10 %</small></div>
            <div class="tel-botones"><span>Cargar voucher</span><span>Ver detalle</span></div>
          </div>
        </div>
      </div>
      <div class="pie-app-texto">
        <p class="pie-app-etq">App móvil para iOS y Android</p>
        <h3 id="app-titulo">FERSUAZ en tu bolsillo</h3>
        <p>Tu ruta del día, tus recetas y tus vouchers desde el celular. Mientras llega a las tiendas, instálala desde el navegador: abre la web y elige «Agregar a pantalla de inicio».</p>
        <ul class="pie-tiendas">
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.7zM14.1 5.6c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"/></svg><span><small>Próximamente en</small>App Store</span></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 2.3 13.4 12l-9.8 9.7c-.4-.2-.6-.6-.6-1.1V3.4c0-.5.2-.9.6-1.1zm11 8.5 2.6-2.6 3.2 1.8c.9.5.9 1.8 0 2.3l-3.2 1.8-2.6-2.6-.6-.7zm-1.2 1.2 2.4 2.4L5.1 21l8.3-9zm0 0L5.1 3l10.7 6.6-2.4 2.4z"/></svg><span><small>Próximamente en</small>Google Play</span></li>
        </ul>
      </div>
    </section>

    <div class="pie-final">
      <p>© 2026 FERSUAZ Farmacéutica S.R.L. Todos los derechos reservados. La Vega, República Dominicana.</p>
      <p>Las personas que aparecen en los videos son generadas con inteligencia artificial.</p>
    </div>
  </footer>'''

# ---------------------------------------------------------------- acceso
def auth_page(active):
    entrar = active == "entrar"
    title = "Iniciar sesión" if entrar else "Crear cuenta"
    return f'''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} | FERSUAZ</title>
  <meta name="theme-color" content="#003463">
  <!-- URL pública de la API (DigitalOcean). Se completa en el despliegue. -->
  <meta name="fersuaz-api" content="">
  <link rel="manifest" href="manifest.webmanifest">
  {FONTS}
  <link rel="stylesheet" href="css/site.css">
  <link rel="stylesheet" href="css/acceso.css">
</head>
<body class="acceso">
  <main class="acceso-main">
    <div class="acceso-fondo" aria-hidden="true"></div>
    <section class="acceso-tarjeta" aria-labelledby="acceso-titulo">
      <a class="acceso-logo" href="./" aria-label="FERSUAZ, inicio"><img src="assets/brand/fersuaz-logo-color.svg" alt="FERSUAZ Laboratorio Farmacéutico" width="210" height="59"></a>
      <h1 id="acceso-titulo">{title}</h1>

      <div class="pestanas" role="tablist" aria-label="Acceso">
        <button type="button" role="tab" id="tab-entrar" aria-controls="panel-entrar" aria-selected="{str(entrar).lower()}" data-tab="entrar">Iniciar sesión</button>
        <button type="button" role="tab" id="tab-crear" aria-controls="panel-crear" aria-selected="{str(not entrar).lower()}" data-tab="crear">Crear cuenta</button>
      </div>

      <div id="panel-entrar" role="tabpanel" aria-labelledby="tab-entrar"{'' if entrar else ' hidden'}>
        <form id="entrar" novalidate>
          <div class="field">
            <label for="login-email">Correo electrónico</label>
            <input id="login-email" name="email" type="email" autocomplete="email" placeholder="usuario@fersuaz.net" required>
          </div>
          <div class="field">
            <label for="login-password">Contraseña</label>
            <div class="clave">
              <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required>
              <button type="button" class="ojo" aria-label="Mostrar contraseña" aria-controls="login-password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
          </div>
          <div class="acceso-fila">
            <label class="check"><input type="checkbox" name="recordar" id="recordar"><span>Recordarme en este equipo</span></label>
            <button type="button" class="enlace" data-abrir="recuperar">¿Olvidaste tu contraseña?</button>
          </div>
          <button class="btn btn-acceso" type="submit">Continuar</button>
          <div class="status" id="status-entrar" role="status" aria-live="polite"></div>
        </form>

        <form id="recuperar" class="recuperar" novalidate hidden>
          <h2>Recuperar acceso</h2>
          <p>Escribe el correo de tu cuenta.</p>
          <div class="field">
            <label for="rec-email">Correo electrónico</label>
            <input id="rec-email" name="email" type="email" autocomplete="email" required>
          </div>
          <button class="btn btn-acceso" type="submit">Solicitar acceso nuevo</button>
          <button type="button" class="enlace volver-login" data-cerrar="recuperar">Volver a iniciar sesión</button>
          <div class="status" id="status-recuperar" role="status" aria-live="polite"></div>
        </form>
        <p class="acceso-alt">¿No tienes una cuenta? <button type="button" class="enlace fuerte" data-tab="crear">Solicítala aquí</button></p>
      </div>

      <div id="panel-crear" role="tabpanel" aria-labelledby="tab-crear"{' hidden' if entrar else ''}>
        <form id="registro" novalidate>
          <fieldset>
            <legend>¿Cuál es tu función?</legend>
            <div class="role-pick" id="roles">
              <label><input type="radio" name="role" value="representante" required><span>Representante</span><small>Visitador, PVC, vendedor o promotora</small></label>
              <label><input type="radio" name="role" value="dependiente"><span>Dependiente</span><small>Trabajo en una farmacia</small></label>
              <label><input type="radio" name="role" value="supervisor"><span>Supervisor</span><small>Superviso representantes</small></label>
              <label><input type="radio" name="role" value="gerencia"><span>Gerencia</span><small>Dirección comercial</small></label>
              <label><input type="radio" name="role" value="finanzas"><span>Finanzas</span><small>Desembolsos y liquidaciones</small></label>
            </div>
            <p class="error" id="role-error" role="alert"></p>
          </fieldset>

          <div class="field">
            <label for="fullName">Nombre completo</label>
            <input id="fullName" name="fullName" type="text" autocomplete="name" required aria-describedby="fullName-error">
            <p class="error" id="fullName-error"></p>
          </div>
          <div class="row2">
            <div class="field">
              <label for="email">Correo electrónico</label>
              <input id="email" name="email" type="email" autocomplete="email" placeholder="usuario@fersuaz.net" required aria-describedby="email-error">
              <p class="error" id="email-error"></p>
            </div>
            <div class="field">
              <label for="phone">Teléfono <span class="hint">(opcional)</span></label>
              <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="809 555 0000" aria-describedby="phone-error">
              <p class="error" id="phone-error"></p>
            </div>
          </div>
          <div class="field" data-for="representante" hidden>
            <label for="position">Posición</label>
            <select id="position" name="position" aria-describedby="position-error">
              <option value="">Elige tu posición</option>
              <option>Visitador</option><option>PVC</option><option>Vendedor</option><option>Promotora</option>
            </select>
            <p class="error" id="position-error"></p>
          </div>
          <div class="row2" data-for="dependiente" hidden>
            <div class="field">
              <label for="pharmacy">Farmacia</label>
              <input id="pharmacy" name="pharmacy" type="text" aria-describedby="pharmacy-error">
              <p class="error" id="pharmacy-error"></p>
            </div>
            <div class="field">
              <label for="province">Provincia</label>
              <input id="province" name="province" type="text" aria-describedby="province-error">
              <p class="error" id="province-error"></p>
            </div>
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <div class="clave">
              <input id="password" name="password" type="password" autocomplete="new-password" placeholder="Mínimo 10 caracteres, con letras y números" required aria-describedby="password-error">
              <button type="button" class="ojo" aria-label="Mostrar contraseña" aria-controls="password" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
            <p class="error" id="password-error"></p>
          </div>
          <label class="check"><input type="checkbox" name="acceptsPrivacy" id="acceptsPrivacy"><span>Acepto la <a href="privacidad.html">política de privacidad</a> y los <a href="terminos.html">términos</a>.</span></label>
          <p class="error" id="acceptsPrivacy-error"></p>
          <button class="btn btn-acceso" type="submit" id="submit">Enviar solicitud</button>
          <p class="acceso-nota">Tu solicitud queda pendiente hasta que tu supervisor o la gerencia la apruebe.</p>
          <div class="status" id="status" role="status" aria-live="polite"></div>
        </form>
        <p class="acceso-alt">¿Ya tienes una cuenta? <button type="button" class="enlace fuerte" data-tab="entrar">Inicia sesión</button></p>
      </div>

      <nav class="acceso-legal" aria-label="Enlaces legales de acceso"><a href="terminos.html">Términos</a><a href="privacidad.html">Privacidad</a><a href="seguridad.html">Seguridad</a></nav>
      <a class="acceso-volver" href="./"><span aria-hidden="true">←</span> Volver al inicio</a>
    </section>
  </main>

{FOOTER}

  <script type="module" src="js/acceso.js"></script>
</body>
</html>
'''

# ---------------------------------------------------------------- legales
LEGAL = {
    "privacidad": ("Política de privacidad", "Cómo FERSUAZ recoge, usa y protege los datos de su equipo comercial."),
    "terminos": ("Términos y condiciones", "Las reglas de uso de la plataforma comercial de FERSUAZ."),
    "seguridad": ("Seguridad y trazabilidad", "Cómo se protegen las cuentas y cómo queda registrado cada cambio."),
}
SEGURIDAD_BODY = '''        <ul class="legal-lista">
          <li>Las contraseñas se guardan cifradas con scrypt; nadie en FERSUAZ puede leerlas.</li>
          <li>Cada cuenta nueva queda pendiente hasta que la aprueba una persona con autoridad: un administrador, la gerencia o un supervisor, según el rol.</li>
          <li>Los permisos se comprueban en el servidor en cada acción, no solo en la pantalla.</li>
          <li>Cada aprobación, rechazo o cambio importante queda en un registro de auditoría con quién lo hizo, cuándo y el valor anterior.</li>
          <li>Los movimientos financieros aprobados no se borran: se corrigen con ajustes que también quedan registrados.</li>
        </ul>'''

def legal_page(slug):
    title, lede = LEGAL[slug]
    body = SEGURIDAD_BODY if slug == "seguridad" else ""
    return f'''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} | FERSUAZ</title>
  <meta name="theme-color" content="#003463">
  {FONTS}
  <link rel="stylesheet" href="css/site.css">
</head>
<body>
  <header class="bar">
    <a class="brand" href="./" aria-label="FERSUAZ, inicio"><img src="assets/brand/fersuaz-logo-color.svg" alt="FERSUAZ Laboratorio Farmacéutico" width="180" height="51"></a>
    <nav aria-label="Principal"><a class="bar-cta" href="entrar.html">Iniciar sesión</a></nav>
  </header>
  <main class="legal">
    <h1>{title}</h1>
    <p class="lede">{lede}</p>
{body}
    <p class="legal-pendiente">Pendiente: el texto definitivo lo redacta y aprueba la asesoría legal de FERSUAZ, conforme a la Ley 172-13 sobre protección de datos personales de la República Dominicana.</p>
  </main>

{FOOTER}
</body>
</html>
'''

def main():
    (WEB / "entrar.html").write_text(auth_page("entrar"), encoding="utf-8")
    (WEB / "registro.html").write_text(auth_page("crear"), encoding="utf-8")
    for slug in LEGAL:
        (WEB / f"{slug}.html").write_text(legal_page(slug), encoding="utf-8")
    idx = WEB / "index.html"
    html = idx.read_text(encoding="utf-8")
    html = re.sub(r'  <footer class="(foot|pie)".*?</footer>', FOOTER, html, flags=re.S)
    idx.write_text(html, encoding="utf-8")
    print("ok")

if __name__ == "__main__":
    main()

// Acceso unificado: pestañas, inicio de sesión, recuperar acceso y ver contraseña.
// El registro (pestaña "Crear cuenta") lo maneja registro.js.
import { apiBase } from './api.js';
import './registro.js';

const tabs = [...document.querySelectorAll('[role="tab"]')];
const titulo = document.getElementById('acceso-titulo');

function showTab(name, { focus = false, push = true } = {}) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) t.focus();
  });
  titulo.textContent = name === 'entrar' ? 'Iniciar sesión' : 'Crear cuenta';
  document.title = `${titulo.textContent} | FERSUAZ`;
  if (push) {
    const page = name === 'entrar' ? 'entrar.html' : 'registro.html';
    history.replaceState(null, '', page + location.search);
  }
}
document.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => showTab(el.dataset.tab, { focus: el.getAttribute('role') !== 'tab' })));
document.querySelector('.pestanas').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  showTab(tabs[(cur + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, { focus: true });
});
tabs.forEach((t) => { t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });

// Ver u ocultar contraseña
document.querySelectorAll('.ojo').forEach((b) => b.addEventListener('click', () => {
  const input = document.getElementById(b.getAttribute('aria-controls'));
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
}));

// Recuperar acceso
const login = document.getElementById('entrar');
const rec = document.getElementById('recuperar');
function openRecover(open) {
  login.hidden = open; rec.hidden = !open;
  (open ? rec.querySelector('input') : login.querySelector('input')).focus();
}
document.querySelector('[data-abrir="recuperar"]').addEventListener('click', () => openRecover(true));
document.querySelector('[data-cerrar="recuperar"]').addEventListener('click', () => openRecover(false));
if (location.hash === '#recuperar') { showTab('entrar', { push: false }); openRecover(true); }

const say = (id, kind, text) => { const s = document.getElementById(id); s.dataset.kind = kind; s.textContent = text; };

rec.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!rec.email.value.trim()) return say('status-recuperar', 'error', 'Escribe el correo de tu cuenta.');
  // El envío por correo (AWS SES) aún no está configurado: se dice con claridad.
  say('status-recuperar', 'error', 'La recuperación por correo todavía no está activa. Pide a tu supervisor o a la gerencia que restablezca tu acceso.');
});

// Recordarme: el correo se recuerda en este equipo; la sesión dura lo que dure la pestaña salvo que se marque.
try { const m = localStorage.getItem('fersuaz.email'); if (m) { login.email.value = m; login.recordar.checked = true; } } catch {}

login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = login.querySelector('button[type="submit"]');
  if (!login.email.value.trim() || !login.password.value) return say('status-entrar', 'error', 'Escribe tu correo y tu contraseña.');
  const base = apiBase();
  if (!base) return say('status-entrar', 'error', 'El inicio de sesión todavía no está conectado al servidor.');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: login.email.value, password: login.password.value }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return say('status-entrar', 'error', body.error ?? 'No pudimos iniciar tu sesión.');
    const store = login.recordar.checked ? localStorage : sessionStorage;
    try {
      store.setItem('fersuaz.token', body.token);
      if (login.recordar.checked) localStorage.setItem('fersuaz.email', login.email.value.trim()); else localStorage.removeItem('fersuaz.email');
    } catch {}
    say('status-entrar', 'ok', `Hola, ${body.user.fullName}. Tu panel llegará en el próximo módulo.`);
  } catch { say('status-entrar', 'error', 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.'); }
  finally { btn.disabled = false; btn.textContent = 'Continuar'; }
});

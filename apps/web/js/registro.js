// Registro por tipo de usuario. La validación aquí ayuda al usuario;
// la que manda es la del servidor (apps/api/src/validation.js).
import { apiBase } from './api.js';
import { activarTelefono, activarCorreo, correoValido } from './campos.js';

const form = document.getElementById('registro');
const statusEl = document.getElementById('status');
const submit = document.getElementById('submit');
const FIELDS = ['role', 'fullName', 'email', 'phone', 'position', 'farmaciaId', 'pharmacy', 'province', 'password', 'acceptsPrivacy'];

// Preselección desde ?rol=
const preset = new URLSearchParams(location.search).get('rol');
const presetInput = preset && form.querySelector(`input[name="role"][value="${CSS.escape(preset)}"]`);
if (presetInput) presetInput.checked = true;

function syncRoleFields() {
  const role = form.role.value;
  form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== role; });
}
form.addEventListener('change', (e) => { if (e.target.name === 'role') syncRoleFields(); });
syncRoleFields();

// ---- Dependiente: provincia, municipio y farmacia del catálogo
const baseApi = () => apiBase() || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8080' : '');
const sp = document.getElementById('dep-provincia'); const sm = document.getElementById('dep-municipio');
const buscar = document.getElementById('dep-buscar'); const resultados = document.getElementById('dep-resultados');
const noEsta = document.getElementById('dep-no-esta'); const manual = document.getElementById('dep-manual');
let division = null; let elegida = null; let espera;
const opcion = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
async function cargarDivision() {
  if (division || !baseApi()) return;
  try { division = await (await fetch(`${baseApi()}/api/publico/division`)).json(); } catch { return; }
  sp.replaceChildren(opcion('', 'Elige la provincia'), ...division.provincias.map((p) => opcion(p, p)));
}
function pintarResultados(items, total) {
  resultados.replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'No encontramos farmacias con ese nombre en este municipio.'; resultados.append(p); return; }
  for (const f of items) {
    const l = document.createElement('label'); l.className = 'farmacia-opcion';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'farmaciaId'; r.value = f.id; r.checked = elegida === f.id;
    r.addEventListener('change', () => { elegida = f.id; });
    const t = document.createElement('span'); const b = document.createElement('strong'); b.textContent = f.nombre;
    const d = document.createElement('small'); d.textContent = [f.sector, f.direccion].filter(Boolean).join(', ');
    t.append(b, d); l.append(r, t); resultados.append(l);
  }
  if (total > items.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = `Mostrando ${items.length} de ${total}. Escribe parte del nombre para afinar.`; resultados.append(p); }
}
async function buscarFarmacias() {
  if (!sp.value || !sm.value || !baseApi()) return;
  const q = new URLSearchParams({ provincia: sp.value, municipio: sm.value, q: buscar.value.trim() });
  try { const r = await (await fetch(`${baseApi()}/api/publico/farmacias?${q}`)).json(); pintarResultados(r.items ?? [], r.total ?? 0); } catch { /* sin conexión */ }
}
sp.addEventListener('change', () => {
  const ms = division?.municipios?.[sp.value] ?? [];
  sm.replaceChildren(opcion('', ms.length ? 'Elige el municipio' : 'Elige primero la provincia'), ...ms.map((m) => opcion(m, m)));
  sm.disabled = !ms.length; buscar.disabled = true; elegida = null; resultados.replaceChildren();
});
sm.addEventListener('change', () => { buscar.disabled = !sm.value; elegida = null; buscarFarmacias(); });
buscar.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(buscarFarmacias, 250); });
noEsta.addEventListener('change', () => { manual.hidden = !noEsta.checked; resultados.hidden = noEsta.checked; if (noEsta.checked) elegida = null; });
form.addEventListener('change', (e) => { if (e.target.name === 'role' && form.role.value === 'dependiente') cargarDivision(); });
if (form.role.value === 'dependiente') cargarDivision();
activarTelefono(form.elements.phone);
activarCorreo(form.elements.email, document.getElementById('email-error'));

function showErrors(errors = {}) {
  for (const f of FIELDS) {
    const msg = errors[f] ?? '';
    const el = document.getElementById(`${f}-error`);
    if (el) el.textContent = msg;
    const input = form.elements[f];
    if (input && 'setAttribute' in input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  const first = FIELDS.find((f) => errors[f]);
  if (first) (form.elements[first]?.[0] ?? form.elements[first])?.focus?.();
}

function localValidate(d) {
  const e = {};
  if (!d.role) e.role = 'Elige el tipo de usuario.';
  if (d.fullName.trim().length < 3) e.fullName = 'Escribe tu nombre completo.';
  if (!correoValido(d.email)) e.email = 'Escribe un correo válido, por ejemplo nombre@fersuaz.net.';
  if (d.phone && !/^(?:\+?1)?(809|829|849)\d{7}$/.test(d.phone.replace(/[\s\-().]/g, ''))) e.phone = 'Usa un teléfono dominicano de 10 dígitos que empiece por 809, 829 o 849.';
  if (d.role === 'representante' && !d.position) e.position = 'Elige tu posición.';
  if (d.role === 'dependiente' && !d.province) e.province = 'Elige la provincia de tu farmacia.';
  if (d.role === 'dependiente' && !d.farmaciaId && !noEsta.checked) e.farmaciaId = 'Elige tu farmacia de la lista, o marca "No encuentro mi farmacia".';
  if (d.role === 'dependiente' && noEsta.checked && d.pharmacy.trim().length < 2) e.pharmacy = 'Escribe el nombre de la farmacia donde trabajas.';
  if (d.password.length < 10) e.password = 'La contraseña necesita al menos 10 caracteres.';
  else if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(d.password) || !/\d/.test(d.password)) e.password = 'La contraseña debe combinar letras y números.';
  if (!d.acceptsPrivacy) e.acceptsPrivacy = 'Debes aceptar la política de privacidad para continuar.';
  return e;
}

function setStatus(kind, text) { statusEl.dataset.kind = kind; statusEl.textContent = text; }

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(form);
  const data = {
    role: fd.get('role') ?? '', fullName: fd.get('fullName') ?? '', email: fd.get('email') ?? '',
    phone: fd.get('phone') ?? '', position: fd.get('position') ?? '', pharmacy: noEsta.checked ? fd.get('pharmacy') ?? '' : '',
    province: sp.value, farmaciaId: noEsta.checked ? '' : (elegida ?? ''), password: fd.get('password') ?? '', acceptsPrivacy: form.acceptsPrivacy.checked,
  };
  if (data.role !== 'dependiente') { delete data.farmaciaId; data.province = ''; }
  const errors = localValidate(data);
  showErrors(errors);
  if (Object.keys(errors).length) { setStatus('error', 'Revisa los campos marcados.'); return; }

  const base = apiBase() || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8080' : '');
  if (!base) { setStatus('error', 'El registro todavía no está conectado al servidor. Configura la URL de la API en el despliegue.'); return; }

  submit.disabled = true; submit.textContent = 'Enviando solicitud…'; setStatus('', '');
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset(); syncRoleFields(); showErrors(); resultados.replaceChildren(); elegida = null; manual.hidden = true; resultados.hidden = false;
      setStatus('ok', body.message ?? 'Solicitud enviada. Te avisaremos cuando sea aprobada.');
    } else {
      showErrors(body.fields);
      setStatus('error', body.error ?? 'No pudimos enviar tu solicitud. Revisa los datos e intenta de nuevo.');
    }
  } catch {
    setStatus('error', 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
  } finally {
    submit.disabled = false; submit.textContent = 'Enviar solicitud';
  }
});

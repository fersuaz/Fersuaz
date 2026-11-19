// Registro por tipo de usuario. La validación aquí ayuda al usuario;
// la que manda es la del servidor (apps/api/src/validation.js).
import { apiBase } from './api.js';

const form = document.getElementById('registro');
const statusEl = document.getElementById('status');
const submit = document.getElementById('submit');
const FIELDS = ['role', 'fullName', 'email', 'phone', 'position', 'pharmacy', 'province', 'password', 'acceptsPrivacy'];

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Escribe un correo válido, por ejemplo nombre@fersuaz.net.';
  if (d.phone && !/^(?:\+?1)?(809|829|849)\d{7}$/.test(d.phone.replace(/[\s\-().]/g, ''))) e.phone = 'Usa un teléfono dominicano de 10 dígitos que empiece por 809, 829 o 849.';
  if (d.role === 'representante' && !d.position) e.position = 'Elige tu posición.';
  if (d.role === 'dependiente' && d.pharmacy.trim().length < 2) e.pharmacy = 'Escribe el nombre de la farmacia donde trabajas.';
  if (d.role === 'dependiente' && d.province.trim().length < 2) e.province = 'Escribe la provincia de tu farmacia.';
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
    phone: fd.get('phone') ?? '', position: fd.get('position') ?? '', pharmacy: fd.get('pharmacy') ?? '',
    province: fd.get('province') ?? '', password: fd.get('password') ?? '', acceptsPrivacy: form.acceptsPrivacy.checked,
  };
  const errors = localValidate(data);
  showErrors(errors);
  if (Object.keys(errors).length) { setStatus('error', 'Revisa los campos marcados.'); return; }

  const base = apiBase();
  if (!base) { setStatus('error', 'El registro todavía no está conectado al servidor. Configura la URL de la API en el despliegue.'); return; }

  submit.disabled = true; submit.textContent = 'Enviando solicitud…'; setStatus('', '');
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset(); syncRoleFields(); showErrors();
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

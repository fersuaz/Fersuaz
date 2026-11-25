// Registro por tipo de usuario. La validación aquí ayuda al usuario;
// la que manda es la del servidor (apps/api/src/validation.js).
import { apiBase } from './api.js';
import { activarTelefono, activarCorreo, correoValido } from './campos.js';

const form = document.getElementById('registro');
const statusEl = document.getElementById('status');
const submit = document.getElementById('submit');
const FIELDS = ['role', 'fullName', 'email', 'phone', 'position', 'farmaciaId', 'pharmacy', 'province', 'municipio', 'especialidad', 'lugares', 'password', 'acceptsPrivacy'];

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
form.addEventListener('change', (e) => { if (e.target.name === 'role' && ['dependiente', 'medico'].includes(form.role.value)) cargarDivision().then(prepararMedico); });
if (['dependiente', 'medico'].includes(form.role.value)) cargarDivision().then(prepararMedico);

// ---- Médico: especialidad, varias provincias y municipios, y sus clínicas u hospitales
const mEsp = document.getElementById('med-especialidad'); const mProv = document.getElementById('med-provincias'); const mMun = document.getElementById('med-municipios');
const mBuscar = document.getElementById('med-buscar'); const mRes = document.getElementById('med-resultados'); const mEleg = document.getElementById('med-elegidos');
const mNoEsta = document.getElementById('med-no-esta'); const mManual = document.getElementById('med-manual');
const provs = new Set(); const muns = new Set(); const lugares = new Map(); // clave → { establecimientoId } o { nombre, tipo, provincia, municipio }
let lugaresZona = []; let mListo = false;
const TIPO_TXT = { hospital: 'Hospital', clinica: 'Clínica', consultorio: 'Consultorio', diagnostico: 'Centro diagnóstico', cpn: 'Primer nivel', unap: 'UNAP' };
const nodo = (tag, props = {}, ...hijos) => { const e = Object.assign(document.createElement(tag), props); e.append(...hijos.filter((x) => x != null)); return e; };
const marca = (valor, texto, marcado, alCambiar) => { const c = nodo('input', { type: 'checkbox', value: valor, checked: marcado }); c.addEventListener('change', () => alCambiar(c.checked)); return nodo('label', { className: 'marca' }, c, nodo('span', { textContent: texto })); };
// Caja moderna para las listas de marcar: buscador arriba y cuántas van elegidas junto al título
function cajaMarcas(lista, nombre, singular, plural) {
  if (!lista || lista.closest('.marcas-caja')) return () => {};
  const caja = nodo('div', { className: 'marcas-caja' });
  const filtro = nodo('input', { type: 'search', className: 'marcas-filtro', placeholder: `Buscar ${nombre}`, autocomplete: 'off' });
  filtro.setAttribute('aria-label', `Buscar ${nombre}`);
  const vacio = nodo('p', { className: 'marcas-vacio', hidden: true, textContent: 'Sin coincidencias.' });
  lista.before(caja); caja.append(filtro, lista, vacio);
  const etq = caja.parentElement.querySelector('.etq'); const cuenta = nodo('span', { className: 'cuenta' }); etq?.append(cuenta);
  const aplicar = () => {
    const k = sinT(filtro.value.trim()); let vistos = 0;
    lista.querySelectorAll('.marca').forEach((m) => { const ve = !k || sinT(m.textContent).includes(k); m.hidden = !ve; if (ve) vistos++; });
    lista.querySelectorAll('.grupo').forEach((g) => { let n = g.nextElementSibling, alguno = false; while (n && !n.classList.contains('grupo')) { if (!n.hidden) alguno = true; n = n.nextElementSibling; } g.hidden = !alguno; });
    vacio.hidden = !k || vistos > 0;
    const n = lista.querySelectorAll('.marca input:checked').length;
    cuenta.textContent = n ? `${n} ${n === 1 ? singular : plural}` : '';
    filtro.hidden = !lista.querySelector('.marca');
  };
  filtro.addEventListener('input', aplicar); lista.addEventListener('change', aplicar);
  new MutationObserver(aplicar).observe(lista, { childList: true });
  aplicar(); return aplicar;
}
async function prepararMedico() {
  if (mListo || form.role.value !== 'medico' || !division) return; mListo = true;
  try { const r = await (await fetch(`${baseApi()}/api/publico/especialidades`)).json(); mEsp.append(...r.items.map((x) => opcion(x, x))); } catch { /* sin conexión */ }
  cajaMarcas(mProv, 'provincia', 'elegida', 'elegidas'); cajaMarcas(mMun, 'municipio', 'elegido', 'elegidos');
  mProv.replaceChildren(...division.provincias.map((p) => marca(p, p, false, (si) => { si ? provs.add(p) : provs.delete(p); pintarMunicipios(); cargarLugares(); })));
}
function pintarMunicipios() {
  for (const m of [...muns]) if (![...provs].some((p) => (division.municipios[p] ?? []).includes(m))) muns.delete(m);
  if (!provs.size) { mMun.replaceChildren(nodo('p', { className: 'hint', textContent: 'Elige primero la provincia.' })); return; }
  mMun.replaceChildren(...[...provs].flatMap((p) => [nodo('strong', { className: 'grupo', textContent: p }), ...(division.municipios[p] ?? []).map((m) => marca(m, m, muns.has(m), (si) => { si ? muns.add(m) : muns.delete(m); cargarLugares(); }))]));
  const mp = document.getElementById('med-m-prov'); mp.replaceChildren(...[...provs].map((p) => opcion(p, p))); mp.dispatchEvent(new Event('change'));
}
async function cargarLugares() {
  mBuscar.disabled = !provs.size;
  if (!provs.size) { lugaresZona = []; mRes.replaceChildren(); return; }
  const q = new URLSearchParams({ provincia: [...provs].join(','), municipio: [...muns].join(',') });
  try { lugaresZona = (await (await fetch(`${baseApi()}/api/publico/establecimientos?${q}`)).json()).items ?? []; } catch { lugaresZona = []; }
  pintarLugares();
}
const sinT = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function pintarLugares() {
  const k = sinT(mBuscar.value.trim());
  const vis = lugaresZona.filter((x) => !k || sinT(x.nombre).includes(k));
  mRes.replaceChildren(...(vis.length ? vis.slice(0, 80).map((x) => marca(x.id, `${x.nombre} · ${TIPO_TXT[x.tipo] ?? x.tipo}, ${x.municipio}`, lugares.has(x.id), (si) => { si ? lugares.set(x.id, { establecimientoId: x.id, nombre: x.nombre }) : lugares.delete(x.id); pintarElegidos(); }))
    : [nodo('p', { className: 'hint', textContent: lugaresZona.length ? 'Ningún lugar con ese nombre.' : 'No hay clínicas ni hospitales registrados aquí. Usa "No encuentro un lugar donde trabajo".' })]));
  if (vis.length > 80) mRes.append(nodo('p', { className: 'hint', textContent: `Mostrando 80 de ${vis.length}. Escribe parte del nombre para afinar.` }));
}
function pintarElegidos() {
  mEleg.replaceChildren(...(lugares.size ? [nodo('span', { className: 'hint', textContent: 'Trabajas en: ' })] : []),
    ...[...lugares].map(([k, l]) => { const b = nodo('button', { type: 'button', className: 'chip-quitar', textContent: `${l.nombre} ×`, ariaLabel: `Quitar ${l.nombre}` }); b.addEventListener('click', () => { lugares.delete(k); pintarElegidos(); pintarLugares(); }); return b; }));
}
mBuscar.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(pintarLugares, 150); });
mNoEsta.addEventListener('change', () => { mManual.hidden = !mNoEsta.checked; });
document.getElementById('med-m-prov').addEventListener('change', (e) => { const ms = division?.municipios?.[e.target.value] ?? []; document.getElementById('med-m-mun').replaceChildren(...ms.map((m) => opcion(m, m))); });
document.getElementById('med-m-agregar').addEventListener('click', () => {
  const nombre = document.getElementById('med-m-nombre').value.trim(); const err = document.getElementById('lugares-error');
  const provincia = document.getElementById('med-m-prov').value; const municipio = document.getElementById('med-m-mun').value;
  if (nombre.length < 3) { err.textContent = 'Escribe el nombre del lugar.'; return; }
  if (!provincia || !municipio) { err.textContent = 'Elige primero la provincia, y luego el municipio del lugar.'; return; }
  lugares.set(`nuevo:${sinT(nombre)}:${municipio}`, { nombre, tipo: document.getElementById('med-m-tipo').value, provincia, municipio });
  document.getElementById('med-m-nombre').value = ''; err.textContent = ''; pintarElegidos();
});
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
  if (d.role === 'dependiente' && !d.municipio) e.municipio = 'Elige el municipio de tu farmacia.';
  if (d.role === 'dependiente' && !d.farmaciaId && !noEsta.checked) e.farmaciaId = 'Elige tu farmacia de la lista, o marca "No encuentro mi farmacia".';
  if (d.role === 'dependiente' && noEsta.checked && d.pharmacy.trim().length < 2) e.pharmacy = 'Escribe el nombre de la farmacia donde trabajas.';
  if (d.role === 'medico' && !d.especialidad) e.especialidad = 'Elige tu especialidad.';
  if (d.role === 'medico' && !d.lugares.length) e.lugares = 'Elige al menos una clínica u hospital donde trabajas.';
  if (d.password.length < 10) e.password = 'La contraseña necesita al menos 10 caracteres.';
  else if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(d.password) || !/\d/.test(d.password)) e.password = 'La contraseña debe combinar letras y números.';
  if (!d.acceptsPrivacy) e.acceptsPrivacy = 'Debes aceptar la política de privacidad para continuar.';
  return e;
}

function setStatus(kind, text) { statusEl.dataset.kind = kind; statusEl.textContent = text; }

function leerDatos() {
  const fd = new FormData(form);
  const data = {
    role: fd.get('role') ?? '', fullName: fd.get('fullName') ?? '', email: fd.get('email') ?? '',
    phone: fd.get('phone') ?? '', position: fd.get('position') ?? '', pharmacy: noEsta.checked ? fd.get('pharmacy') ?? '' : '',
    province: sp.value, municipio: sm.value, farmaciaId: noEsta.checked ? '' : (elegida ?? ''), password: fd.get('password') ?? '', acceptsPrivacy: form.acceptsPrivacy.checked,
  };
  if (data.role !== 'dependiente') { delete data.farmaciaId; delete data.municipio; data.province = ''; }
  if (data.role === 'medico') { data.especialidad = mEsp.value; data.lugares = [...lugares.values()].map((l) => (l.establecimientoId ? { establecimientoId: l.establecimientoId } : l)); }
  return data;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // En los pasos anteriores, Enter o Enviar solo avanzan.
  if (pasoActual < pasosVisibles().length - 1) { siguiente(); return; }
  const data = leerDatos();
  const errors = localValidate(data);
  showErrors(errors);
  if (Object.keys(errors).length) { irAlPasoDe(errors); setStatus('error', 'Revisa los campos marcados.'); return; }

  const base = apiBase() || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8080' : '');
  if (!base) { setStatus('error', 'El registro todavía no está conectado al servidor. Configura la URL de la API en el despliegue.'); return; }

  submit.disabled = true; submit.textContent = 'Enviando solicitud…'; setStatus('', '');
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset(); syncRoleFields(); showErrors(); pasoMax = 0; irA(0, false); resultados.replaceChildren(); elegida = null; manual.hidden = true; resultados.hidden = false;
      lugares.clear(); provs.clear(); muns.clear(); pintarElegidos(); mListo = false;
      setStatus('ok', body.message ?? 'Solicitud enviada. Te avisaremos cuando sea aprobada.');
    } else {
      showErrors(body.fields); irAlPasoDe(body.fields ?? {});
      setStatus('error', body.error ?? 'No pudimos enviar tu solicitud. Revisa los datos e intenta de nuevo.');
    }
  } catch {
    setStatus('error', 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
  } finally {
    submit.disabled = false; submit.textContent = 'Enviar solicitud';
  }
});


// ---- Registro por pasos: barra de progreso; no se ve ni se pasa al siguiente sin completar el actual.
const PASOS = [
  { id: 'funcion', titulo: 'Tu función', campos: ['role'] },
  { id: 'datos', titulo: 'Tus datos', campos: ['fullName', 'email', 'phone', 'position'] },
  { id: 'lugar', titulo: 'Dónde trabajas', campos: ['province', 'municipio', 'farmaciaId', 'pharmacy', 'especialidad', 'lugares'], solo: ['dependiente', 'medico'] },
  { id: 'acceso', titulo: 'Tu acceso', campos: ['password', 'acceptsPrivacy'] },
];
let pasoActual = 0; let pasoMax = 0;
const cajas = {};
(function armarPasos() {
  const hijos = [...form.children].filter((el) => el.id !== 'status');
  const de = (el) => {
    if (el.querySelector?.('input[name="role"]')) return 'funcion';
    if (el.matches('[data-for="dependiente"], [data-for="medico"]')) return 'lugar';
    if (el.querySelector?.('#password') || el.querySelector?.('#acceptsPrivacy') || el.id === 'acceptsPrivacy-error' || el.matches('.check') || el.id === 'submit' || el.matches('.acceso-nota')) return 'acceso';
    return 'datos';
  };
  for (const p of PASOS) { cajas[p.id] = document.createElement('div'); cajas[p.id].className = 'paso'; cajas[p.id].dataset.paso = p.id; cajas[p.id].setAttribute('role', 'group'); cajas[p.id].setAttribute('aria-label', p.titulo); }
  for (const el of hijos) cajas[de(el)].append(el);
  const barra = document.createElement('div'); barra.className = 'pasos-barra';
  barra.innerHTML = '<p class="pasos-texto" aria-live="polite"></p><div class="pasos-riel" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div><ol class="pasos-lista"></ol>';
  const nav = document.createElement('div'); nav.className = 'pasos-nav';
  nav.innerHTML = '<button type="button" class="btn-paso atras">Atrás</button><button type="button" class="btn btn-acceso adelante">Siguiente</button>';
  for (const p of PASOS) cajas[p.id].hidden = true;
  form.prepend(barra, ...PASOS.map((p) => cajas[p.id]));
  form.insertBefore(nav, document.getElementById('status'));
  nav.querySelector('.atras').addEventListener('click', () => irA(pasoActual - 1));
  nav.querySelector('.adelante').addEventListener('click', siguiente);
})();
function pasosVisibles() { const r = form.role.value; return PASOS.filter((p) => !p.solo || !r || p.solo.includes(r)); }
function pintarPasos() {
  const vis = pasosVisibles(); const p = vis[pasoActual];
  for (const x of PASOS) cajas[x.id].hidden = x !== p;
  const pct = Math.round(((pasoActual + 1) / vis.length) * 100);
  form.querySelector('.pasos-texto').textContent = `Paso ${pasoActual + 1} de ${vis.length}: ${p.titulo}`;
  const riel = form.querySelector('.pasos-riel'); riel.setAttribute('aria-valuenow', String(pct)); riel.setAttribute('aria-valuetext', `Paso ${pasoActual + 1} de ${vis.length}`); riel.querySelector('span').style.width = `${pct}%`;
  const ol = form.querySelector('.pasos-lista'); ol.replaceChildren(...vis.map((x, i) => {
    const li = document.createElement('li'); li.className = i < pasoActual ? 'hecho' : i === pasoActual ? 'actual' : 'pendiente';
    if (i === pasoActual) li.setAttribute('aria-current', 'step');
    // Se puede volver a un paso ya completado; los siguientes no se abren hasta completar el actual.
    if (i < pasoActual || (i <= pasoMax && i !== pasoActual)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = x.titulo; b.addEventListener('click', () => (i < pasoActual ? irA(i) : null)); b.disabled = i > pasoActual; li.append(b); }
    else { const sp2 = document.createElement('span'); sp2.textContent = x.titulo; li.append(sp2); }
    return li;
  }));
  const ultimo = pasoActual === vis.length - 1;
  form.querySelector('.pasos-nav .atras').hidden = pasoActual === 0;
  form.querySelector('.pasos-nav .adelante').hidden = ultimo;
  document.getElementById('submit').hidden = !ultimo;
  form.querySelector('.acceso-nota')?.toggleAttribute('hidden', !ultimo);
}
function irA(i, enfocar = true) {
  const vis = pasosVisibles(); pasoActual = Math.max(0, Math.min(i, vis.length - 1));
  pintarPasos(); setStatus('', '');
  if (enfocar) {
    const caja = cajas[vis[pasoActual].id];
    (caja.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled])') ?? caja).focus({ preventScroll: true });
    form.querySelector('.pasos-barra').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
function erroresDelPaso(p) {
  const todos = localValidate(leerDatos());
  return Object.fromEntries(Object.entries(todos).filter(([k]) => p.campos.includes(k)));
}
function siguiente() {
  const vis = pasosVisibles(); const p = vis[pasoActual];
  const e = erroresDelPaso(p); showErrors(e);
  if (Object.keys(e).length) { setStatus('error', 'Completa este paso para seguir.'); return; }
  pasoMax = Math.max(pasoMax, pasoActual + 1);
  irA(pasoActual + 1);
}
/** Un error del servidor puede ser de un paso anterior (por ejemplo, el correo ya existe): se vuelve a ese paso. */
function irAlPasoDe(errores) {
  const vis = pasosVisibles();
  const i = vis.findIndex((p) => p.campos.some((c) => errores[c] || Object.keys(errores).some((k) => k.startsWith(`${c}.`))));
  if (i >= 0 && i !== pasoActual) { irA(i); showErrors(errores); }
}
// Al elegir la función se avanza solo.
form.addEventListener('change', (e) => { if (e.target.name === 'role' && pasoActual === 0) { pasoMax = 1; setTimeout(() => irA(1), 180); } });
if (presetInput) { pasoMax = 1; pasoActual = 1; }
pintarPasos();

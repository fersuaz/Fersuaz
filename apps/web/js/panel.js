// Panel de trabajo FERSUAZ. Muestra a cada rol solo lo suyo; el servidor vuelve a comprobar cada permiso.
import { apiBase } from './api.js';
import { activarDesplegables } from './desplegable.js';
import { activarNumeros } from './numeros.js';
import { verImagen, verGaleria } from './visor.js';
import { descargarXlsx, imprimirPdf } from './exportar.js';

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const fmtRD = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = new Intl.NumberFormat('es-DO');
const RD = (n) => `RD$ ${fmtRD.format(Number(n) || 0)}`;
const hoy = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const mesActual = () => hoy().slice(0, 7);
const fecha = (s) => (s ? new Date(`${String(s).slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ROLES = { administrador: 'Administrador', gerencia: 'Gerencia', supervisor: 'Supervisor', representante: 'Representante', finanzas: 'Finanzas', dependiente: 'Dependiente de farmacia', medico: 'Médico' };
const ESTADOS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', aprobada: 'Aprobada', rechazada: 'Rechazada', anulado: 'Anulado', alerta: 'Alerta', ok: 'Cubierto', sin_inventario: 'Sin inventario', validada: 'Validada', validado: 'Validado', recibido: 'Recibido', confirmado: 'Confirmado', despachado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado' };

/** Crea elementos sin innerHTML: todo texto entra como textContent. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const chip = (estado) => h('span', { class: `chip ${estado}` }, ESTADOS[estado] ?? estado);

// ---------------------------------------------------------------- sesión y API
const API = apiBase() || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8080' : '');
function token() { try { return sessionStorage.getItem('fersuaz.token') || localStorage.getItem('fersuaz.token'); } catch { return null; } }
function salir() { try { sessionStorage.removeItem('fersuaz.token'); localStorage.removeItem('fersuaz.token'); } catch {} location.href = 'entrar.html'; }

class ApiError extends Error { constructor(status, body) { super(body?.error || 'Error inesperado.'); this.status = status; this.fields = body?.fields; } }
// ---------------------------------------------------------------- avisos de confirmación
// Después de cada acción que guarda, aprueba, cancela o rechaza algo, aparece un aviso que dice qué se hizo.
let accionPendiente = null;
let avisosEnPausa = false; // carga masiva: un solo aviso al final, no uno por fila
const SIN_AVISO = /\/(leer|propuesta|estimar|login|cambiar-clave|leer-todas|ruta|verificar)(\?|$)|\/notificaciones\//;
const HECHO = { aprobar: 'aprobado', rechazar: 'rechazado', eliminar: 'eliminado', anular: 'anulado', guardar: 'guardado', enviar: 'enviado', cancelar: 'cancelado', cerrar: 'cerrado', quitar: 'quitado', confirmar: 'confirmado' };
function textoAccion(etiqueta) {
  // "Sí, rechazar" → "Listo: rechazado."; "Guardar cambios" → "Listo: guardado (cambios)."
  const t = String(etiqueta ?? '').replace(/\s+/g, ' ').replace(/…$/, '').replace(/^sí,\s*/i, '').trim();
  if (!t) return 'Listo. Los cambios se guardaron.';
  const [v, ...resto] = t.split(' ');
  const p = HECHO[v.toLowerCase()];
  return p ? `Listo: ${p}${resto.length ? ` (${resto.join(' ')})` : ''}.` : `Listo. Se completó: ${t}.`;
}
function aviso(texto, tipo = 'ok') {
  let zona = document.getElementById('avisos');
  if (!zona) { zona = h('div', { id: 'avisos', class: 'avisos', role: 'status', 'aria-live': 'polite' }); document.body.append(zona); }
  const caja = h('div', { class: `aviso-flotante ${tipo}` },
    h('span', { class: 'aviso-icono', 'aria-hidden': 'true' }, tipo === 'ok' ? '✓' : tipo === 'error' ? '!' : 'i'), h('span', {}, texto),
    h('button', { type: 'button', class: 'aviso-cerrar', 'aria-label': 'Cerrar aviso', onclick: () => caja.remove() }, '×'));
  zona.append(caja);
  setTimeout(() => caja.remove(), tipo === 'error' ? 9000 : 5000);
}
async function api(method, path, body) {
  if (!API) throw new ApiError(0, { error: 'El panel todavía no está conectado al servidor.' });
  let r;
  try {
    r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` }, body: body && JSON.stringify(body) });
  } catch { throw new ApiError(0, { error: 'No pudimos conectar con el servidor. Revisa tu conexión.' }); }
  if (r.status === 401) { salir(); throw new ApiError(401, { error: 'Tu sesión terminó.' }); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { accionPendiente = null; throw new ApiError(r.status, data); }
  if (method !== 'GET') { if (!SIN_AVISO.test(path) && !avisosEnPausa) aviso(textoAccion(accionPendiente)); accionPendiente = null; }
  return data;
}

// ---------------------------------------------------------------- formularios
/** Zona para arrastrar y soltar archivos (o hacer clic). Envuelve un input de archivo; el resto del código lo usa igual. */
function zonaArchivo(input) {
  input.classList.add('sr-only');
  const varios = input.multiple;
  const nombre = h('span', { class: 'za-nombre', 'aria-live': 'polite' }, varios ? 'Ningún archivo elegido' : 'Ningún archivo elegido');
  const zona = h('label', { class: 'za', for: input.id },
    h('span', { class: 'za-icono', 'aria-hidden': 'true' }, '⇪'),
    h('span', { class: 'za-texto' }, h('strong', {}, varios ? 'Arrastra aquí los archivos' : 'Arrastra aquí el archivo'), h('span', {}, ' o haz clic para elegirlo')),
    nombre, input);
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const pintar = () => {
    const fs = [...(input.files ?? [])];
    nombre.textContent = !fs.length ? 'Ningún archivo elegido' : fs.length === 1 ? `${fs[0].name} (${kb(fs[0].size)})` : `${fs.length} archivos elegidos`;
    zona.classList.toggle('con-archivo', fs.length > 0);
  };
  input.addEventListener('change', pintar);
  ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('activa'); }));
  ['dragleave', 'dragend'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('activa')));
  zona.addEventListener('drop', (e) => {
    e.preventDefault(); zona.classList.remove('activa');
    const fs = [...e.dataTransfer.files]; if (!fs.length) return;
    const dt = new DataTransfer(); (varios ? fs : fs.slice(0, 1)).forEach((f) => dt.items.add(f));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return zona;
}
function campo(name, label, attrs = {}, hint) {
  const id = `f-${name.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  if (attrs.type === 'file') {
    const input = h('input', { id, name, ...attrs, 'aria-describedby': `${id}-e` });
    return h('div', { class: 'field' }, h('span', { class: 'za-etq' }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), zonaArchivo(input), h('p', { class: 'error', id: `${id}-e`, dataset: { for: name } }));
  }
  const input = attrs.options
    ? h('select', { id, name, required: attrs.required }, h('option', { value: '' }, attrs.placeholder ?? 'Elige una opción'), ...attrs.options.map((o) => h('option', { value: o.value, selected: o.value === attrs.value }, o.label)))
    : h('input', { id, name, type: 'text', ...attrs, 'aria-describedby': `${id}-e` });
  return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), input, h('p', { class: 'error', id: `${id}-e`, dataset: { for: name } }));
}
function mostrarErrores(form, err) {
  form.querySelectorAll('.error:not(.aviso)').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  const f = err?.fields ?? {};
  let primero = null;
  for (const [k, msg] of Object.entries(f)) {
    const p = form.querySelector(`.error[data-for="${CSS.escape(k)}"]`);
    if (p) { p.textContent = msg; const inp = p.parentElement.querySelector('input,select'); inp?.setAttribute('aria-invalid', 'true'); primero ??= inp; }
  }
  primero?.focus();
}
function estado(el, kind, msg) { el.className = `aviso ${kind}`; el.textContent = msg; el.hidden = !msg; }
async function enviar(form, boton, fn) {
  const st = form.querySelector('.aviso') ?? form.appendChild(h('div', { class: 'aviso', role: 'status', hidden: true }));
  const txt = boton.textContent; boton.disabled = true; boton.textContent = 'Guardando…'; accionPendiente = txt;
  try { mostrarErrores(form); st.hidden = true; st.textContent = ''; const r = await fn(); return r; }
  catch (e) { mostrarErrores(form, e); estado(st, 'error', e.message); return null; }
  finally { boton.disabled = false; boton.textContent = txt; }
}
function confirmar(titulo, cuerpo, { okTexto = 'Confirmar', pedirMotivo = false, etiquetaMotivo = 'Motivo', sugerencias = null, corregir = null, casilla = null, campos = null } = {}) {
  const d = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  const c = $('#dialogo-cuerpo'); c.replaceChildren(h('p', {}, cuerpo));
  let motivo; let caja;
  if (pedirMotivo) {
    motivo = h('textarea', { id: 'motivo', rows: 3 });
    c.append(h('label', { for: 'motivo', class: 'hint' }, etiquetaMotivo));
    // Respuestas rápidas: un clic llena el motivo (y marca si el usuario puede corregirlo).
    if (sugerencias?.length) {
      const chips = sugerencias.map((x) => h('button', { type: 'button', class: 'chip-sug', 'aria-pressed': 'false', onclick: (e) => {
        motivo.value = x.texto; chips.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        if (corr && x.corregible != null) corr.checked = x.corregible;
        motivo.focus();
      } }, x.texto));
      c.append(h('div', { class: 'sugerencias', role: 'group', 'aria-label': 'Respuestas rápidas' }, ...chips));
    }
    c.append(motivo);
  }
  // Rechazo que el usuario puede corregir: la respuesta es { motivo, corregible }.
  let corr = null;
  if (corregir) { corr = h('input', { type: 'checkbox', checked: Boolean(corregir.marcada) }); c.append(h('label', { class: 'check', style: 'margin-top:.75rem' }, corr, h('span', {}, corregir.texto))); }
  // Una casilla opcional: la respuesta es { casilla: true | false } en vez de true.
  if (casilla) { caja = h('input', { type: 'checkbox', checked: casilla.marcada !== false }); c.append(h('label', { class: 'check', style: 'margin-top:.75rem' }, caja, h('span', {}, casilla.texto))); }
  // Campos opcionales: la respuesta es { nombre: valor } con lo que se escribió.
  const entradas = (campos ?? []).map((x) => { const el = h('input', { id: `dlg-${x.name}`, name: x.name, type: x.type ?? 'text', value: x.value ?? '', autocomplete: 'off', ...(x.inputmode ? { inputmode: x.inputmode } : {}) }); c.append(h('div', { class: 'field' }, h('label', { for: `dlg-${x.name}` }, x.label), el)); return el; });
  $('#dialogo-ok').textContent = okTexto;
  d.showModal();
  const soloVer = ['Cerrar', 'Listo', 'Entendido'].includes(okTexto);
  return new Promise((res) => d.addEventListener('close', () => {
    const ok = d.returnValue === 'ok';
    // Confirmado: la próxima acción guardada se anuncia con este nombre. Cancelado: se avisa que no se hizo nada.
    if (ok && !soloVer) accionPendiente = okTexto;
    if (!ok && !soloVer) aviso('Cancelado. No se hizo ningún cambio.', 'info');
    res(!ok ? null : corr ? { motivo: motivo?.value ?? '', corregible: corr.checked } : motivo ? motivo.value : caja ? { casilla: caja.checked } : entradas.length ? Object.fromEntries(entradas.map((x) => [x.name, x.value])) : true);
  }, { once: true }));
}
const sinTilde = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Texto buscable de una fila: sus valores (hasta dos niveles) y las celdas que son texto. */
function textoFila(f, cols) {
  const partes = [];
  const juntar = (v, n) => { if (v == null) return; if (typeof v === 'string' || typeof v === 'number') partes.push(v); else if (n < 2 && typeof v === 'object') for (const x of Object.values(v)) juntar(x, n + 1); };
  juntar(f, 0);
  for (const c of cols) { try { const v = c.v(f); if (typeof v === 'string' || typeof v === 'number') partes.push(v); else if (v instanceof Node) partes.push(v.textContent); } catch { /* celda con acciones */ } }
  return sinTilde(partes.join(' '));
}
/**
 * Tabla. Con más de 25 filas agrega un buscador (sin importar tildes) y paginación de 25.
 * La búsqueda revisa todas las filas, no solo la página visible.
 */
/** Texto de una celda para exportar (sin botones). */
function textoCelda(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(textoCelda).filter(Boolean).join(', ');
  if (v instanceof Element) return /\b(btn|btn-sec|btn-enlace|enlace)\b/.test(v.className) && v.tagName !== 'SPAN' ? '' : v.textContent.replace(/\s+/g, ' ').trim();
  if (v instanceof Node) return v.textContent.trim();
  return String(v);
}
/** Botones de exportar (Excel y PDF) para una tabla; exporta las filas que se están viendo. */
function barraExportar(cols, filasVisibles, { nombre, titulo }) {
  const usar = cols.filter((c) => typeof c.t === 'string' && c.t);
  const datos = () => { const fs = filasVisibles(); return [usar.map((c) => c.t), fs.map((f) => usar.map((c) => { try { return textoCelda(c.v(f)); } catch { return ''; } }))]; };
  const archivo = `${nombre}-${hoy()}`;
  return h('div', { class: 'exportar' },
    h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: () => { const [e, f] = datos(); descargarXlsx(archivo, titulo, e, f); aviso(`Exportado a Excel: ${fmtN.format(f.length)} registro(s).`); } }, 'Exportar a Excel'),
    h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: () => { const [e, f] = datos(); imprimirPdf(titulo, e, f); aviso('Elige "Guardar como PDF" en la ventana de impresión.', 'info'); } }, 'Exportar a PDF'));
}
function tabla(cols, filas, vacio, { porPagina = 25, exportar = null } = {}) {
  if (!filas.length) return h('div', { class: 'tarjeta vacio' }, h('strong', {}, vacio[0]), vacio[1]);
  // Una celda solo con botones o enlaces de acción se muestra como grupo alineado y espaciado.
  const esAccion = (x) => x instanceof Element && /\b(btn|btn-sec|btn-enlace)\b/.test(x.className);
  const celda = (v) => {
    const xs = (Array.isArray(v) ? v : [v]).flat().filter((x) => x != null && x !== '' && x !== false);
    return xs.length && xs.every(esAccion) ? h('span', { class: 'celda acciones-celda' }, xs) : h('span', { class: 'celda' }, v);
  };
  const fila = (f) => h('tr', {}, cols.map((c) => { const v = c.v(f); const cel = celda(v); return h('td', { 'data-label': c.etiqueta ?? (typeof c.t === 'string' ? c.t : ''), class: [c.num ? 'num' : null, c.clase ?? null, cel.classList.contains('acciones-celda') ? 'td-acciones' : null].filter(Boolean).join(' ') || null }, cel); }));
  const cabeza = h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.t))));
  if (filas.length <= porPagina) {
    const t = h('div', { class: 'tabla-envoltura' }, h('table', { class: 'tabla' }, cabeza, h('tbody', {}, filas.map(fila))));
    return exportar ? h('div', { class: 'tabla-larga' }, h('div', { class: 'tabla-barra' }, h('span', { class: 'tabla-estado' }, `${fmtN.format(filas.length)} registro(s)`), barraExportar(cols, () => filas, exportar)), t) : t;
  }
  let indice = null; let lista = filas; let pagina = 1;
  const cuerpo = h('tbody');
  const estadoTxt = h('p', { class: 'tabla-estado', 'aria-live': 'polite' });
  const pager = h('nav', { class: 'paginas', 'aria-label': 'Páginas de la tabla' });
  const id = `buscar-${Math.random().toString(36).slice(2, 8)}`;
  const buscador = h('input', { id, type: 'search', class: 'tabla-buscar', placeholder: 'Buscar por nombre, dirección, municipio…', autocomplete: 'off', enterkeyhint: 'search' });
  const caja = h('div', { class: 'tabla-envoltura' }, h('table', { class: 'tabla' }, cabeza, cuerpo));
  const boton = (texto, n, extra = {}) => h('button', { type: 'button', class: `pag${n === pagina ? ' actual' : ''}`, disabled: n < 1 || n > total() || undefined, 'aria-current': n === pagina ? 'page' : null, onclick: () => ir(n), ...extra }, texto);
  const total = () => Math.max(1, Math.ceil(lista.length / porPagina));
  function pintar() {
    const ini = (pagina - 1) * porPagina;
    const vis = lista.slice(ini, ini + porPagina);
    cuerpo.replaceChildren(...(vis.length ? vis.map(fila) : [h('tr', {}, h('td', { colspan: cols.length, class: 'tabla-sin' }, 'Ningún resultado con esa búsqueda.'))]));
    estadoTxt.textContent = lista.length ? `Mostrando ${fmtN.format(ini + 1)} a ${fmtN.format(ini + vis.length)} de ${fmtN.format(lista.length)}${lista.length !== filas.length ? ` (de ${fmtN.format(filas.length)} en total)` : ''}` : `0 de ${fmtN.format(filas.length)}`;
    const t = total(); const nums = new Set([1, t, pagina - 1, pagina, pagina + 1].filter((n) => n >= 1 && n <= t));
    const ordenados = [...nums].sort((a, b) => a - b); const botones = [];
    ordenados.forEach((n, i) => { if (i && n - ordenados[i - 1] > 1) botones.push(h('span', { class: 'pag-puntos', 'aria-hidden': 'true' }, '…')); botones.push(boton(fmtN.format(n), n, { 'aria-label': `Página ${n}` })); });
    pager.replaceChildren(boton('Anterior', pagina - 1), ...botones, boton('Siguiente', pagina + 1));
    pager.hidden = t <= 1;
  }
  function ir(n) { pagina = Math.min(Math.max(1, n), total()); pintar(); caja.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  let espera;
  buscador.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      const q = sinTilde(buscador.value).trim().split(/\s+/).filter(Boolean);
      if (q.length && !indice) indice = filas.map((f) => textoFila(f, cols));
      lista = q.length ? filas.filter((_, i) => q.every((w) => indice[i].includes(w))) : filas;
      pagina = 1; pintar();
    }, 150);
  });
  pintar();
  return h('div', { class: 'tabla-larga' },
    h('div', { class: 'tabla-barra' }, h('label', { for: id, class: 'sr-only' }, 'Buscar en la tabla'), buscador, estadoTxt, exportar ? barraExportar(cols, () => lista, exportar) : null), caja, pager);
}
const vista = (titulo, sub, ...contenido) => [h('h1', {}, titulo), sub ? h('p', { class: 'vista-sub' }, sub) : null, ...contenido];
/** Marca bloques como una sección; `vistaS` las muestra con un control segmentado (una a la vez). */
const S = (id, label, ...nodos) => ({ __sec: id, label, nodos: nodos.flat().filter(Boolean) });
function vistaS(ruta, orden, titulo, sub, ...contenido) {
  const fijos = []; const grupos = new Map();
  for (const b of contenido.flat()) {
    if (!b) continue;
    if (b.__sec) { const g = grupos.get(b.__sec) ?? { label: b.label, nodos: [] }; g.nodos.push(...b.nodos); grupos.set(b.__sec, g); } else fijos.push(b);
  }
  const ids = [...orden.filter((id) => grupos.get(id)?.nodos.length), ...[...grupos.keys()].filter((id) => !orden.includes(id) && grupos.get(id).nodos.length)];
  if (!ids.length) return vista(titulo, sub, ...fijos);
  const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]));
  const actual = ids.includes(q.sec) ? q.sec : ids[0];
  const seg = ids.length > 1 ? segmentos(titulo, ids.map((id) => [id, grupos.get(id).label]), actual, (id) => irA(ruta, { ...q, sec: id })) : null;
  return vista(titulo, sub, ...fijos, seg, ...grupos.get(actual).nodos);
}

// ---------------------------------------------------------------- catálogos compartidos
let cache = {};
async function medicamentos() { return (cache.meds ??= (await api('GET', '/api/catalogo/medicamentos')).items); }

function lineasEditor({ conMonto }) {
  const cont = h('div', { class: 'lineas' });
  const total = h('span', { class: 'total', 'aria-live': 'polite' });
  let n = 0; let meds = [];
  const recalcular = () => { if (conMonto) total.textContent = `Total ${RD([...cont.querySelectorAll('[name$=".monto"]')].reduce((s, i) => s + (Number(i.value) || 0), 0))}`; };
  function agregar() {
    const i = n++;
    const fila = h('div', { class: `linea${conMonto ? '' : ' sin-monto'}` },
      campo(`items.${i}.medicamentoId`, 'Medicamento', { options: meds.map((m) => ({ value: m.id, label: m.presentacion ? `${m.nombre}, ${m.presentacion}` : m.nombre })), placeholder: 'Elige el medicamento' }),
      conMonto ? campo(`items.${i}.cantidad`, 'Cantidad', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric' }) : campo(`items.${i}.unidades`, 'Unidades', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric' }),
      conMonto ? campo(`items.${i}.monto`, 'Monto RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal', oninput: recalcular }) : null,
      h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar medicamento', onclick: () => { if (cont.children.length > 1) { fila.remove(); recalcular(); } } }, 'Quitar'));
    cont.append(fila); recalcular();
  }
  return {
    async init() { meds = await medicamentos(); agregar(); },
    el: cont, total,
    boton: h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: agregar }, 'Agregar medicamento'),
    valores: () => [...cont.children].map((f) => {
      const g = (s) => f.querySelector(`[name$=".${s}"]`)?.value;
      return conMonto ? { medicamentoId: g('medicamentoId'), cantidad: Number(g('cantidad')), monto: Number(g('monto')) } : { medicamentoId: g('medicamentoId'), unidades: Number(g('unidades')) };
    }),
    hayMeds: () => meds.length > 0,
  };
}

// ---------------------------------------------------------------- vistas: dependiente
const V = {};
/** Editor de un voucher: medicamentos del catálogo, cantidad y precio por unidad; suma el total y la comisión estimada. */
function editorVoucher(meds, pct) {
  const cont = h('div', { class: 'vlineas' });
  const totalEl = h('strong', { class: 'vtotal-monto' }, RD(0));
  const comEl = h('strong', { class: 'vtotal-monto' }, '');
  const comNota = h('small', {});
  let porcentaje = pct; let n = 0;
  const etiqueta = (m) => (m.presentacion ? `${m.nombre}, ${m.presentacion}` : m.nombre);
  function recalcular() {
    let total = 0;
    for (const f of cont.children) {
      const c = Number(f.querySelector('[name$=".cantidad"]').value) || 0; const p = Number(f.querySelector('[name$=".precio"]').value) || 0;
      const sub = c * p; total += sub; f.querySelector('.vsub').textContent = RD(sub);
    }
    totalEl.textContent = RD(total);
    if (porcentaje == null) { comEl.textContent = 'Sin configurar'; comNota.textContent = 'La gerencia aún no ha fijado el porcentaje de comisión.'; }
    else { comEl.textContent = RD(Math.round(total * porcentaje) / 100); comNota.textContent = `${fmtN.format(porcentaje)} % del total. Se confirma cuando el voucher se aprueba.`; }
  }
  function agregar() {
    const i = n++;
    const sel = campo(`items.${i}.medicamentoId`, 'Medicamento', { options: meds.map((m) => ({ value: m.id, label: etiqueta(m) })), placeholder: 'Elige el medicamento' });
    const cant = campo(`items.${i}.cantidad`, 'Cantidad', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric' });
    const prec = campo(`items.${i}.precio`, 'Precio por unidad RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' });
    const fila = h('div', { class: 'vlinea' }, sel, cant, prec,
      h('div', { class: 'vsub-caja' }, h('span', { class: 'hint' }, 'Subtotal'), h('span', { class: 'vsub' }, RD(0))),
      h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar medicamento', onclick: () => { if (cont.children.length > 1) { fila.remove(); recalcular(); } } }, 'Quitar'));
    // Al elegir el medicamento se propone su precio del catálogo; se puede cambiar por el precio real de la venta.
    sel.querySelector('select').addEventListener('change', (e) => { const m = meds.find((x) => x.id === e.target.value); const inp = prec.querySelector('input'); if (m?.precio && !inp.value) inp.value = m.precio; recalcular(); });
    fila.addEventListener('input', recalcular);
    cont.append(fila); recalcular();
    if (i > 0) sel.querySelector('select').focus();
  }
  agregar();
  return {
    el: cont,
    resumen: h('div', { class: 'vtotales', 'aria-live': 'polite' }, h('div', {}, h('span', {}, 'Total del voucher'), totalEl), h('div', { class: 'vcom' }, h('span', {}, 'Comisión estimada'), comEl, comNota)),
    boton: h('button', { type: 'button', class: 'btn-sec', onclick: () => agregar() }, 'Agregar otro medicamento'),
    porcentaje: (p) => { porcentaje = p; recalcular(); },
    valores: () => [...cont.children].map((f) => ({ medicamentoId: f.querySelector('select').value, cantidad: Number(f.querySelector('[name$=".cantidad"]').value), precio: f.querySelector('[name$=".precio"]').value })),
    reiniciar: () => { cont.replaceChildren(); n = 0; agregar(); },
  };
}
// ---------------------------------------------------------------- carga masiva por fotos (vouchers y recetas)
// Se arrastran o eligen todas las fotos a la vez (sin límite). Cada foto es una fila: la foto primero y a su lado
// los medicamentos de esa foto. Una foto puede tener varios medicamentos ("Agregar medicamento"); la cantidad
// solo cambia si hay varias unidades del mismo. Se envían una por una y cada fila muestra si entró o por qué no.
async function huellaArchivo(file) {
  try { const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { return null; }
}
/** Huella de parecido (dHash 32×32 = 1,024 bits): la misma imagen aunque se haya reenviado o comprimido; vouchers distintos del mismo formato no se confunden. */
async function dhashArchivo(file) {
  if (!/^image\//.test(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const W = 33; const H = 32;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data; const g = (i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    let bits = '';
    for (let y = 0; y < H; y++) for (let k = 0; k < W - 1; k++) bits += g(y * W + k + 1) - g(y * W + k) > 2 ? '1' : '0'; // margen de 2: el ruido de la compresión no cambia bits
    return bits.match(/.{4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
  } catch { return null; }
}
const bitsDistintos = (a, b) => { if (a.length !== b.length) return Infinity; let n = 0; for (let i = 0; i < a.length; i++) { let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };
/** Fotos grandes de celular → JPEG de 1,800 px máximo (rápido de subir y se lee igual de bien). */
async function prepararFoto(file) {
  if (file.type === 'application/pdf') return { tipo: 'application/pdf', nombre: file.name, base64: await archivoB64(file) };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
    return { tipo: 'image/jpeg', nombre: file.name.replace(/\.[^.]+$/, '') + '.jpg', base64: await archivoB64(blob) };
  } catch { return { tipo: file.type, nombre: file.name, base64: await archivoB64(file) }; }
}
/**
 * cfg: { meds, conPrecio, etiquetaCant, porcentaje?, extras?(fila) → { nodos, valores(), valido() }, enviar(fila) → Promise, nombre: 'voucher' | 'receta', arriba? }
 */
// Médico de una foto (voucher o receta): se elige de la lista; si no está, se escribe nombre, apellido y
// especialidad, y queda registrado para todos. La próxima vez solo se elige.
const NUEVO_MED = '__nuevo';
function selectorMedico(catalogo, { requerido = false, ubicacion = () => ({}), preferir = null, yo: textoYo = null } = {}) {
  const etiq = (m) => `${m.nombre}${m.especialidad ? `, ${m.especialidad}` : ''}${m.municipio ? ` (${m.municipio})` : ''}`;
  const ordenados = () => {
    const p = preferir?.() ?? {};
    const peso = (m) => (p.municipio && m.municipio === p.municipio ? 0 : p.provincia && m.provincia === p.provincia ? 1 : 2);
    return catalogo.items.slice().sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, 'es'));
  };
  const sel = h('select', { 'aria-label': 'Médico que prescribió', 'data-medicos': '1' });
  const llenar = () => {
    const v = sel.value;
    sel.replaceChildren(h('option', { value: '' }, textoYo ?? (requerido ? 'Elige el médico' : 'Elige el médico (opcional)')), h('option', { value: NUEVO_MED }, '+ No está en la lista: agregar médico'), ...ordenados().map((m) => h('option', { value: m.id }, etiq(m))));
    sel.value = v;
  };
  llenar();
  sel.addEventListener('medicos-cambio', llenar);
  const nom = h('input', { autocomplete: 'off', placeholder: 'Nombre', 'aria-label': 'Nombre del médico' });
  const ape = h('input', { autocomplete: 'off', placeholder: 'Apellido', 'aria-label': 'Apellido del médico' });
  const esp = h('select', { 'aria-label': 'Especialidad del médico' }, h('option', { value: '' }, 'Elige la especialidad'), ...(catalogo.especialidades ?? []).map((x) => h('option', { value: x }, x)));
  const caja = h('div', { class: 'med-nuevo', hidden: true },
    h('label', {}, h('span', {}, 'Nombre'), nom), h('label', {}, h('span', {}, 'Apellido'), ape), h('label', {}, h('span', {}, 'Especialidad'), esp),
    h('small', { class: 'hint' }, 'Se guarda en la lista de médicos: la próxima vez solo lo eliges.'));
  sel.addEventListener('change', () => { caja.hidden = sel.value !== NUEVO_MED; if (!caja.hidden) nom.focus(); });
  const nodos = [h('label', { class: 'med-elegir' }, h('span', {}, 'Médico'), sel), caja];
  return {
    nodos,
    valido() {
      if (sel.value === NUEVO_MED) {
        if (nom.value.trim().length < 2) return 'Escribe el nombre del médico.';
        if (ape.value.trim().length < 2) return 'Escribe el apellido del médico.';
        if (!esp.value) return 'Elige la especialidad del médico.';
        return null;
      }
      return requerido && !sel.value ? 'Elige el médico que prescribió.' : null;
    },
    /** Id del médico; si es nuevo, lo registra (una sola vez aunque se repita en varias fotos). */
    async valor() {
      if (sel.value !== NUEVO_MED) return sel.value || null;
      const clave = `${nom.value} ${ape.value}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      catalogo.pendientes ??= new Map();
      if (!catalogo.pendientes.has(clave)) {
        catalogo.pendientes.set(clave, api('POST', '/api/catalogo/medicos', { nombre: nom.value.trim(), apellido: ape.value.trim(), especialidad: esp.value, ...ubicacion() }).then((r) => {
          if (!catalogo.items.some((m) => m.id === r.item.id)) catalogo.items.push(r.item);
          document.querySelectorAll('select[data-medicos]').forEach((s) => s.dispatchEvent(new Event('medicos-cambio')));
          return r.item.id;
        }).catch((e) => { catalogo.pendientes.delete(clave); throw e; }));
      }
      const id = await catalogo.pendientes.get(clave);
      sel.value = id; caja.hidden = true;
      return id;
    },
  };
}

function cargaMasiva(cfg) {
  const filas = []; let n = 0;
  const etiqueta = (m) => (m.presentacion ? `${m.nombre}, ${m.presentacion}` : m.nombre);
  const lista = h('div', { class: 'cm-lista', 'aria-live': 'polite' });
  const input = h('input', { type: 'file', id: 'cm-fotos', multiple: true, accept: 'image/*,application/pdf', class: 'sr-only' });
  const zona = h('label', { class: 'cm-zona', for: 'cm-fotos', tabindex: 0 },
    h('strong', {}, `Arrastra aquí las fotos de ${cfg.nombre === 'receta' ? 'las recetas' : 'los vouchers'}`),
    h('span', {}, 'o haz clic para elegirlas. Puedes subir todas las que quieras; cada foto será una fila.'), input);
  zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('activa'); }));
  ['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, () => zona.classList.remove('activa')));
  zona.addEventListener('drop', (e) => { e.preventDefault(); agregarArchivos([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { agregarArchivos([...input.files]); input.value = ''; });
  const avisoDup = h('p', { class: 'hint', 'aria-live': 'polite' });
  const totalEl = h('strong', {}); const comEl = h('strong', {}); const cuenta = h('span', {});
  const enviarBtn = h('button', { class: 'btn', type: 'button' });
  const barra = h('div', { class: 'cm-barra', hidden: true }, h('div', { class: 'cm-cifras' }, cuenta, cfg.conPrecio ? h('span', {}, 'Total ', totalEl) : null, cfg.conPrecio && cfg.porcentaje ? h('span', {}, 'Comisión estimada ', comEl) : null), enviarBtn);

  function recalcular() {
    const vivas = filas.filter((f) => f.estado !== 'ok');
    let total = 0;
    for (const f of vivas) {
      let t = 0;
      for (const l of f.lineas) { const sub = (Number(l.cant.value) || 0) * (Number(l.prec?.value) || 0); t += sub; if (l.sub) l.sub.textContent = RD(sub); }
      f.totalEl && (f.totalEl.textContent = RD(t)); total += t;
    }
    totalEl.textContent = RD(total);
    const pct = typeof cfg.porcentaje === 'function' ? cfg.porcentaje() : cfg.porcentaje;
    comEl.textContent = pct == null ? 'sin configurar' : RD(Math.round(total * pct) / 100);
    cuenta.textContent = `${fmtN.format(vivas.length)} ${cfg.nombre === 'receta' ? 'receta(s)' : 'voucher(s)'}`;
    enviarBtn.textContent = `Enviar ${fmtN.format(vivas.length)} a revisión`;
    if (cfg.nombre === 'receta') enviarBtn.textContent = `Guardar ${fmtN.format(vivas.length)} receta(s)`;
    enviarBtn.disabled = !vivas.length; barra.hidden = !filas.length;
  }
  function lineaNueva(f, foco) {
    const sel = h('select', { 'aria-label': 'Medicamento' }, h('option', { value: '' }, 'Elige el medicamento'), ...cfg.meds.map((m) => h('option', { value: m.id }, etiqueta(m))));
    const cant = h('input', { type: 'number', min: 1, step: 1, value: 1, inputmode: 'numeric', 'aria-label': cfg.etiquetaCant });
    const prec = cfg.conPrecio ? h('input', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal', 'aria-label': 'Precio por unidad RD$', placeholder: '0.00' }) : null;
    const sub = cfg.conPrecio ? h('span', { class: 'cm-sub' }, RD(0)) : null;
    const l = { sel, cant, prec, sub };
    const quitar = h('button', { type: 'button', class: 'btn-enlace cm-quitar', 'aria-label': 'Quitar este medicamento', onclick: () => { if (f.lineas.length === 1) { sel.value = ''; cant.value = 1; if (prec) prec.value = ''; } else { f.lineas.splice(f.lineas.indexOf(l), 1); fila.remove(); } recalcular(); } }, 'Quitar');
    const fila = h('div', { class: `cm-linea${cfg.conPrecio ? '' : ' sin-precio'}` }, h('label', {}, h('span', {}, 'Medicamento'), sel), h('label', {}, h('span', {}, cfg.etiquetaCant), cant),
      prec ? h('label', {}, h('span', {}, 'Precio por unidad RD$'), prec) : null, sub ? h('div', { class: 'cm-subcaja' }, h('span', {}, 'Subtotal'), sub) : null, quitar);
    sel.addEventListener('change', () => { const m = cfg.meds.find((x) => x.id === sel.value); if (prec && m?.precio && !prec.value) prec.value = m.precio; recalcular(); });
    fila.addEventListener('input', recalcular);
    f.lineas.push(l); f.cajaLineas.append(fila);
    if (foco) sel.focus();
  }
  function quitarFila(f) { URL.revokeObjectURL(f.url); filas.splice(filas.indexOf(f), 1); f.el.remove(); numerar(); recalcular(); }
  function numerar() { filas.forEach((f, i) => { f.num.textContent = `${cfg.nombre === 'receta' ? 'Receta' : 'Voucher'} ${i + 1}`; }); }
  // Al elegir las fotos se rechazan de inmediato las repetidas: dentro de esta carga y contra todo lo ya cargado en el sistema.
  const rechazos = h('ul', { class: 'cm-rechazos', 'aria-live': 'polite' });
  async function agregarArchivos(archivos) {
    const validos = archivos.filter((a) => /^image\//.test(a.type) || a.type === 'application/pdf');
    let grandes = 0; const nuevos = []; const rechazadas = [];
    avisoDup.textContent = `Revisando ${fmtN.format(validos.length)} foto(s)…`;
    for (const file of validos) {
      if (file.size > 25 * 1024 * 1024) { grandes++; continue; }
      const [huella, dhash] = await Promise.all([huellaArchivo(file), dhashArchivo(file)]);
      const enLista = [...filas, ...nuevos].find((x) => (huella && x.huella === huella) || (dhash && x.dhash && bitsDistintos(dhash, x.dhash) <= 24));
      if (enLista) { rechazadas.push({ nombre: file.name, texto: `Es la misma foto que ${enLista.file.name}, ya está en esta lista.` }); continue; }
      nuevos.push({ file, huella, dhash });
    }
    if (nuevos.length) {
      try {
        const { repetidas } = await api('POST', '/api/fotos/verificar', { tipo: cfg.nombre, fotos: nuevos.map((x) => ({ huella: x.huella, dhash: x.dhash })) });
        for (const r of repetidas.sort((a, b) => b.indice - a.indice)) { rechazadas.push({ nombre: nuevos[r.indice].file.name, texto: r.texto }); nuevos.splice(r.indice, 1); }
      } catch { /* si no se puede verificar ahora, el servidor la rechaza al enviar */ }
    }
    for (const { file, huella, dhash } of nuevos) {
      const f = { id: ++n, file, huella, dhash, url: URL.createObjectURL(file), lineas: [], estado: 'pendiente' };
      f.num = h('strong', {});
      f.msg = h('p', { class: 'cm-msg', role: 'status' });
      f.cajaLineas = h('div', { class: 'cm-lineas' });
      f.fecha = cfg.nombre === 'voucher' || cfg.fechaReceta ? h('input', { type: 'date', value: hoy(), max: hoy(), 'aria-label': `Fecha ${cfg.nombre === 'voucher' ? 'del voucher' : 'de la receta'}` }) : null;
      f.totalEl = cfg.conPrecio ? h('strong', {}, RD(0)) : null;
      f.extras = cfg.extras ? cfg.extras(f) : null;
      const vista = file.type === 'application/pdf' ? h('span', { class: 'cm-pdf' }, 'PDF') : h('img', { src: f.url, alt: `Foto ${file.name}`, loading: 'lazy' });
      // En grande: la foto con sus datos al lado para elegir medicamentos y médico, y pasar a la siguiente con las flechas.
      const ver = h('button', { type: 'button', class: 'cm-foto', 'aria-label': 'Ver la foto en grande y completar sus datos', onclick: () => {
        const vis = filas.filter((x) => x.estado !== 'ok');
        verGaleria(vis.map((x) => ({ url: x.url, tipo: x.file.type, nombre: `${x.num.textContent}: ${x.file.name}`,
          detalle: () => { const ms = x.lineas.filter((l) => l.sel.value).map((l) => `${l.sel.selectedOptions[0].textContent} ×${l.cant.value}`); return ms.length ? ms.join(', ') : 'Falta elegir el medicamento'; },
          panel: { nodo: () => x.datos, devolver: () => x.el.append(x.datos) } })), vis.indexOf(f), { onClose: () => f.el.scrollIntoView({ block: 'nearest' }) });
      } }, vista);
      f.datos = h('div', { class: 'cm-datos' },
          h('div', { class: 'cm-cabeza' }, h('div', {}, f.num, h('small', {}, file.name)), f.fecha ? h('label', { class: 'cm-fecha' }, h('span', {}, 'Fecha'), f.fecha) : null,
            h('button', { type: 'button', class: 'btn-sec btn-peq btn-peligro', onclick: () => quitarFila(f) }, cfg.nombre === 'receta' ? 'Quitar receta' : 'Quitar voucher')),
          f.extras?.nodos ?? null, f.cajaLineas,
          h('div', { class: 'cm-pie' }, h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: () => lineaNueva(f, true) }, 'Agregar medicamento'), f.totalEl ? h('span', {}, 'Total de este voucher ', f.totalEl) : null),
          f.msg);
      f.el = h('article', { class: 'cm-fila' }, ver, f.datos);
      lineaNueva(f, false);
      filas.push(f); lista.append(f.el);
    }
    numerar(); recalcular();
    const partes = [];
    if (nuevos.length) partes.push(`${fmtN.format(nuevos.length)} foto(s) agregada(s)`);
    if (rechazadas.length) partes.push(`${fmtN.format(rechazadas.length)} rechazada(s) por repetida(s)`);
    if (grandes) partes.push(`${grandes} archivo(s) pasan de 25 MB`);
    if (validos.length < archivos.length) partes.push(`${archivos.length - validos.length} archivo(s) no son fotos ni PDF`);
    avisoDup.textContent = partes.length ? `${partes.join('; ')}.` : '';
    rechazos.replaceChildren(...rechazadas.map((r) => h('li', {}, h('strong', {}, r.nombre), `: ${r.texto} No se agregó.`)));
    if (rechazadas.length) aviso(`${fmtN.format(rechazadas.length)} foto(s) rechazada(s) por repetida(s). No se agregaron.`, 'error');
  }
  function validar(f) {
    const errs = [];
    const lineas = f.lineas.filter((l) => l.sel.value);
    if (!lineas.length) errs.push('Elige al menos un medicamento de FERSUAZ.');
    const ids = lineas.map((l) => l.sel.value);
    if (new Set(ids).size !== ids.length) errs.push('Un medicamento está repetido: sube su cantidad en vez de repetirlo.');
    for (const l of lineas) {
      if (!(Number.isInteger(Number(l.cant.value)) && Number(l.cant.value) >= 1)) errs.push(`${cfg.etiquetaCant}: número entero desde 1.`);
      if (l.prec && !(Number(l.prec.value) > 0)) errs.push('Escribe el precio por unidad.');
    }
    if (f.fecha && (!f.fecha.value || f.fecha.value > hoy())) errs.push('Revisa la fecha.');
    const ex = f.extras?.valido?.(); if (ex) errs.push(ex);
    return [...new Set(errs)];
  }
  enviarBtn.addEventListener('click', async () => {
    const pend = filas.filter((f) => f.estado !== 'ok');
    let conError = 0;
    for (const f of pend) { const e = validar(f); f.el.classList.toggle('con-error', !!e.length); f.msg.textContent = e.join(' '); if (e.length) conError++; }
    if (conError) { aviso(`${conError} fila(s) necesitan datos. Están marcadas en rojo.`, 'error'); pend.find((f) => f.el.classList.contains('con-error'))?.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); return; }
    if (cfg.antes && !(await cfg.antes(pend.length))) return;
    enviarBtn.disabled = true;
    let ok = 0; let mal = 0; let i = 0;
    const trabajar = async () => {
      while (i < pend.length) {
        const f = pend[i++];
        f.estado = 'enviando'; f.el.classList.add('enviando'); f.msg.textContent = 'Enviando…';
        enviarBtn.textContent = `Enviando ${ok + mal + 1} de ${pend.length}…`;
        try {
          const items = f.lineas.filter((l) => l.sel.value).map((l) => ({ medicamentoId: l.sel.value, ...(cfg.conPrecio ? { cantidad: Number(l.cant.value), precio: l.prec.value } : { unidades: Number(l.cant.value) }) }));
          const foto = await prepararFoto(f.file);
          await cfg.enviar({ items, foto, huella: f.huella, dhash: f.dhash, fecha: f.fecha?.value, extras: f.extras?.valores?.() ?? {} });
          f.estado = 'ok'; ok++;
          f.el.classList.remove('enviando', 'con-error'); f.el.classList.add('enviada'); f.msg.textContent = cfg.nombre === 'receta' ? 'Guardada.' : 'Enviado a revisión.';
          f.el.querySelectorAll('select, input, button:not(.cm-foto)').forEach((x) => { x.disabled = true; });
        } catch (err) {
          f.estado = 'error'; mal++;
          f.el.classList.remove('enviando'); f.el.classList.add('con-error');
          f.msg.textContent = err.fields ? Object.values(err.fields).join(' ') + (err.message && !Object.values(err.fields).includes(err.message) ? ` ${err.message}` : '') : err.message;
        }
      }
    };
    avisosEnPausa = true;
    try { await Promise.all([trabajar(), trabajar(), trabajar()]); } finally { avisosEnPausa = false; } // tres a la vez
    recalcular();
    aviso(mal ? `Listo: ${ok} enviado(s). ${mal} con error: revisa las filas en rojo.` : `Listo: ${ok} ${cfg.nombre === 'receta' ? 'receta(s) guardada(s)' : 'voucher(s) enviado(s) a revisión'}.`, mal ? 'error' : 'ok');
    // Las que entraron se quitan de la lista después de un momento; quedan solo las que hay que corregir.
    setTimeout(() => { for (const f of filas.filter((x) => x.estado === 'ok')) { URL.revokeObjectURL(f.url); f.el.remove(); } filas.splice(0, filas.length, ...filas.filter((x) => x.estado !== 'ok')); if (!filas.length) { avisoDup.textContent = ''; rechazos.replaceChildren(); } numerar(); recalcular(); }, 2500);
  });
  return { el: h('div', { class: 'cm' }, cfg.arriba ?? null, zona, avisoDup, rechazos, lista, barra), recalcular };
}

V.voucher = async () => {
  const carga = yo.role === 'representante';
  const [meds, deps, pct0, cat] = await Promise.all([medicamentos(), carga ? api('GET', '/api/vouchers/dependientes').then((x) => x.items) : null, carga ? null : api('GET', '/api/vouchers/porcentaje').then((x) => x.item.porcentaje), api('GET', '/api/catalogo/medicos').catch(() => ({ items: [], especialidades: [] }))]);
  const catMed = { items: cat.items.filter((m) => m.estado !== 'inactivo' && m.estado !== 'rechazado'), especialidades: cat.especialidades ?? [] };
  if (!meds.length) return vista('Cargar vouchers', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Todavía no hay medicamentos en el catálogo'), 'La gerencia debe agregarlos antes de cargar vouchers.'));
  if (carga && !deps.length) return vista('Cargar vouchers', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay dependientes en farmacias de tu zona'), 'Aparecen aquí cuando una dependiente se registra con una farmacia de tus provincias.'));
  let pct = pct0 ?? null;
  const selDep = carga ? campo('dependienteId', 'Dependiente (farmacia) de estos vouchers', { options: deps.map((d) => ({ value: d.id, label: `${d.nombre} (${d.farmacia}, ${d.municipio})` })), placeholder: 'Elige la dependiente' }) : null;
  let cm;
  selDep?.querySelector('select').addEventListener('change', async (e) => { pct = null; if (e.target.value) { try { pct = (await api('GET', `/api/vouchers/porcentaje?dependienteId=${e.target.value}`)).item.porcentaje; } catch { /* sin porcentaje */ } } cm.recalcular(); });
  cm = cargaMasiva({
    nombre: 'voucher', meds, conPrecio: true, etiquetaCant: 'Cantidad', porcentaje: () => pct,
    extras: () => {
      const depElegida = () => deps?.find((d) => d.id === selDep?.querySelector('select').value) ?? (yo.farmacia ?? {});
      const med = selectorMedico(catMed, { ubicacion: () => (selDep ? { dependienteId: selDep.querySelector('select').value } : {}), preferir: depElegida });
      return { nodos: h('div', { class: 'cm-extras cm-extras-med' }, ...med.nodos), valores: () => ({ medico: med }), valido: () => med.valido() };
    },
    arriba: selDep ? h('div', { class: 'form-fila' }, selDep) : null,
    antes: async (n) => { if (selDep && !selDep.querySelector('select').value) { aviso('Elige la dependiente de la farmacia.', 'error'); selDep.querySelector('select').focus(); return false; } return true; },
    enviar: async ({ items, foto, huella, dhash, fecha: f, extras }) => api('POST', '/api/vouchers', { ...(selDep ? { dependienteId: selDep.querySelector('select').value } : {}), fecha: f, items, foto, fotoHuella: huella, fotoDhash: dhash, medicoId: await extras.medico.valor() }),
  });
  return vista('Cargar vouchers', `${carga ? 'Carga los vouchers a nombre de la dependiente de la farmacia: la comisión es de ella y queda constancia de que los cargaste tú. ' : ''}Sube todas las fotos de una vez. En cada foto elige los medicamentos de FERSUAZ que tiene; si un voucher tiene varios, usa "Agregar medicamento". La cantidad solo cambia si hay varias unidades del mismo medicamento. Quedan en revisión hasta que la supervisión o finanzas los aprueben.`, cm.el);
};
// Filtros de una lista ya cargada: se aplican en el momento y la tabla vuelve a la página 1.
// campos: [{ id, etiqueta, tipo: 'buscar' | 'opciones' | 'desde' | 'hasta' | 'minimo', opciones, valor(fila) }]
const estadoFiltros = {};
function listaFiltrada(clave, filas, campos, pintarTabla, resumen) {
  const st = (estadoFiltros[clave] ??= {});
  const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const caja = h('div', { class: 'lf-tabla' });
  const cuenta = h('p', { class: 'lf-cuenta', 'aria-live': 'polite' });
  const ctrls = campos.map((c) => {
    let el;
    if (c.tipo === 'opciones') {
      // Varias a la vez: se guarda la lista elegida.
      const ms = multiSel({ id: `lf-${clave}-${c.id}`, etiqueta: c.etiqueta, opciones: c.opciones.map((o) => ({ value: o.value ?? o, label: o.label ?? o })), valores: Array.isArray(st[c.id]) ? st[c.id] : [], plural: c.plural ?? 'elegidos', conAplicar: false,
        alCambiar: (vals) => { st[c.id] = vals.length ? vals : ''; aplicar(); } });
      ms.classList.add('lf-campo');
      return { c, el: null, nodo: ms };
    }
    if (c.tipo === 'desde' || c.tipo === 'hasta') el = h('input', { type: 'date' });
    else if (c.tipo === 'minimo') el = h('input', { inputmode: 'decimal', placeholder: '0.00' });
    else el = h('input', { type: 'search', placeholder: c.placeholder ?? 'Buscar', autocomplete: 'off' });
    el.value = st[c.id] ?? '';
    el.addEventListener(c.tipo === 'buscar' || c.tipo === 'minimo' ? 'input' : 'change', () => { st[c.id] = el.value; aplicar(); });
    return { c, el, nodo: h('label', { class: `lf-campo lf-${c.tipo}` }, h('span', {}, c.etiqueta), el) };
  });
  const limpiar = h('button', { type: 'button', class: 'btn-enlace' }, 'Limpiar filtros');
  limpiar.addEventListener('click', () => { for (const k of Object.keys(st)) delete st[k]; router(); });
  function pasa(f) {
    for (const { c } of ctrls) {
      const v = st[c.id]; if (!v) continue;
      const x = c.valor(f);
      if (c.tipo === 'buscar') { if (!sinTildes(x).includes(sinTildes(v.trim()))) return false; }
      else if (c.tipo === 'opciones') { const vs = Array.isArray(v) ? v : [v]; const xs = Array.isArray(x) ? x : [String(x ?? '')]; if (!vs.some((y) => xs.includes(y))) return false; }
      else if (c.tipo === 'desde') { if (String(x) < v) return false; }
      else if (c.tipo === 'hasta') { if (String(x) > v) return false; }
      else if (c.tipo === 'minimo') { const n = Number(String(v).replace(/,/g, '')); if (Number.isFinite(n) && Number(x) < n) return false; }
    }
    return true;
  }
  let aplicar = function () {
    const vis = filas.filter(pasa);
    const activos = ctrls.filter(({ c }) => st[c.id]).length;
    cuenta.textContent = `${activos ? `${fmtN.format(vis.length)} de ${fmtN.format(filas.length)}` : fmtN.format(filas.length)}${resumen ? ` · ${resumen(vis)}` : ''}`;
    limpiar.hidden = !activos;
    caja.replaceChildren(pintarTabla(vis, activos));
  };
  aplicar();
  // En el celular los filtros extra se pliegan bajo "Más filtros" para no ocupar toda la pantalla.
  const principales = ctrls.filter(({ c }) => c.tipo === 'buscar');
  const extra = ctrls.filter(({ c }) => c.tipo !== 'buscar');
  const resumenMas = h('summary', {}, 'Más filtros');
  const mas = h('details', { class: 'lf-mas' }, resumenMas, h('div', { class: 'lf-mas-campos' }, ...extra.map((x) => x.nodo)));
  const ancho = matchMedia('(min-width: 768px)');
  const ajustar = () => { const n = extra.filter(({ c }) => st[c.id]).length; resumenMas.textContent = n ? `Más filtros (${n} activo${n > 1 ? 's' : ''})` : 'Más filtros'; if (ancho.matches) mas.open = true; };
  ancho.addEventListener?.('change', ajustar);
  const aplicarAntes = aplicar;
  aplicar = () => { aplicarAntes(); ajustar(); };
  ajustar();
  return h('div', { class: 'lf' }, filas.length ? h('div', { class: 'lf-barra' }, ...principales.map((x) => x.nodo), extra.length ? mas : null, h('div', { class: 'lf-pie' }, cuenta, limpiar)) : null, caja);
}

/** Corregir un voucher rechazado: la foto a la izquierda y fecha, medicamentos y médico a la derecha. */
async function corregirVoucher(v) {
  const [meds, cat] = await Promise.all([medicamentos(), api('GET', '/api/catalogo/medicos').catch(() => ({ items: [], especialidades: [] }))]);
  const catMed = { items: cat.items.filter((m) => m.estado !== 'inactivo' && m.estado !== 'rechazado'), especialidades: cat.especialidades ?? [] };
  const activos = meds.filter((m) => m.activo !== false);
  const fechaIn = h('input', { type: 'date', value: v.fecha, max: hoy(), id: 'cv-fecha' });
  const lineas = h('div', { class: 'cv-lineas' });
  const totalEl = h('strong', {});
  const recalc = () => { let t = 0; lineas.querySelectorAll('.cv-linea').forEach((l) => { const c = Number(l.querySelector('[data-c]').value) || 0; const p = Number(String(l.querySelector('[data-p]').value).replace(/,/g, '')) || 0; t += c * p; }); totalEl.textContent = RD(t); };
  const linea = (it = {}) => {
    const sel = h('select', { 'aria-label': 'Medicamento', 'data-m': '1' }, h('option', { value: '' }, 'Elige el medicamento'), ...activos.map((m) => h('option', { value: m.id }, `${m.nombre}${m.presentacion ? `, ${m.presentacion}` : ''}`)));
    sel.value = it.medicamentoId ?? '';
    const cant = h('input', { inputmode: 'numeric', value: it.cantidad ?? 1, 'aria-label': 'Cantidad', 'data-c': '1' });
    const precio = h('input', { inputmode: 'decimal', value: it.precio ?? (it.monto && it.cantidad ? (it.monto / it.cantidad).toFixed(2) : ''), 'aria-label': 'Precio por unidad RD$', 'data-p': '1' });
    sel.addEventListener('change', () => { const m = activos.find((x) => x.id === sel.value); if (m?.precio != null && !precio.value) precio.value = m.precio; recalc(); });
    const el = h('div', { class: 'cv-linea' },
      h('label', {}, h('span', {}, 'Medicamento'), sel), h('label', {}, h('span', {}, 'Cantidad'), cant), h('label', {}, h('span', {}, 'Precio por unidad RD$'), precio),
      h('button', { type: 'button', class: 'btn-enlace', onclick: () => { if (lineas.children.length > 1) { el.remove(); recalc(); } } }, 'Quitar'));
    el.addEventListener('input', recalc);
    lineas.append(el);
  };
  (v.items.length ? v.items : [{}]).forEach(linea); recalc();
  const med = selectorMedico(catMed, {});
  if (v.medicoId) { const s = med.nodos[0].querySelector('select'); s.value = v.medicoId; }
  const err = h('div', { role: 'alert' });
  const enviarC = h('button', { class: 'btn', type: 'button', onclick: async () => {
    err.replaceChildren();
    const items = [...lineas.querySelectorAll('.cv-linea')].map((l) => ({ medicamentoId: l.querySelector('[data-m]').value, cantidad: Number(l.querySelector('[data-c]').value), precio: Number(String(l.querySelector('[data-p]').value).replace(/,/g, '')) }));
    if (items.some((i) => !i.medicamentoId)) { err.append(h('div', { class: 'aviso error' }, 'Elige el medicamento en cada fila.')); return; }
    const malMed = med.valido(); if (malMed) { err.append(h('div', { class: 'aviso error' }, malMed)); return; }
    enviarC.disabled = true;
    try {
      await api('POST', `/api/vouchers/${v.id}/corregir`, { fecha: fechaIn.value, items, medicoId: await med.valor() });
      aviso('Listo: el voucher corregido se envió otra vez a revisión.', 'ok'); irA('misVouchers');
    } catch (e) { err.append(h('div', { class: 'aviso error' }, e.message)); enviarC.disabled = false; }
  } }, 'Enviar corregido a revisión');
  const foto = v.foto ? h('button', { type: 'button', class: 'cv-foto', 'aria-label': 'Ver la foto en grande', onclick: () => verAdjunto(v.foto.clave) }, h('span', {}, 'Ver la foto en grande')) : h('p', { class: 'hint' }, 'Este voucher no tiene foto.');
  if (v.foto) cargarAdjunto(v.foto.clave).then((x) => foto.prepend(h('img', { src: x.url, alt: 'Foto del voucher' }))).catch(() => {});
  return vista('Corregir voucher', `Rechazado: ${v.motivo ?? ''} Corrige lo que haga falta y envíalo otra vez. Tienes hasta el ${fecha(finDeMes())}; si no, se elimina.`,
    h('div', { class: 'cv' }, foto,
      h('div', { class: 'tarjeta cv-form' },
        h('label', { for: 'cv-fecha' }, h('span', {}, 'Fecha del voucher')), fechaIn, ...med.nodos,
        h('h3', {}, 'Medicamentos'), lineas,
        h('div', { class: 'acciones', style: 'justify-content:space-between' }, h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: () => linea() }, 'Agregar medicamento'), h('span', {}, 'Total ', totalEl)),
        err, h('div', { class: 'acciones' }, enviarC, h('button', { type: 'button', class: 'btn-sec', onclick: () => irA('misVouchers') }, 'Cancelar')))));
}
const finDeMes = () => { const [y, m] = hoy().split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

V.misVouchers = async () => {
  const { items } = await api('GET', '/api/vouchers');
  const aCorregir = param('corregir') && items.find((v) => v.id === param('corregir') && v.estado === 'rechazado' && v.corregible);
  if (aCorregir) return corregirVoucher(aCorregir);
  const pintar = async () => router();
  const vendedor = yo.role === 'representante';
  const ESTADOS_V = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', anulado: 'Anulado' };
  const unicos = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const filas = items.slice().reverse();
  const campos = [
    { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Medicamento, médico, farmacia…', valor: (v) => [v.items.map((i) => i.medicamento).join(' '), v.medico, v.farmacia, v.dependiente, v.referencia].join(' ') },
    { id: 'estado', etiqueta: 'Estado', tipo: 'opciones', opciones: Object.entries(ESTADOS_V).filter(([k]) => items.some((v) => v.estado === k)).map(([value, label]) => ({ value, label })), valor: (v) => v.estado },
    { id: 'desde', etiqueta: 'Desde', tipo: 'desde', valor: (v) => v.fecha },
    { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta', valor: (v) => v.fecha },
    { id: 'med', etiqueta: 'Medicamento', tipo: 'opciones', opciones: unicos(items.flatMap((v) => v.items.map((i) => i.medicamento))), valor: (v) => v.items.map((i) => i.medicamento) },
    { id: 'medico', etiqueta: 'Médico', tipo: 'opciones', opciones: [...unicos(items.map((v) => v.medico)), ...(items.some((v) => !v.medico) ? [{ value: '—', label: 'Sin médico' }] : [])], valor: (v) => v.medico ?? '—' },
    vendedor
      ? { id: 'dep', etiqueta: 'Farmacia', tipo: 'opciones', opciones: unicos(items.map((v) => v.farmacia)), valor: (v) => v.farmacia }
      : { id: 'por', etiqueta: 'Cargado por', tipo: 'opciones', opciones: unicos(items.map((v) => v.cargadoPor ?? 'Tú')), valor: (v) => v.cargadoPor ?? 'Tú' },
    { id: 'min', etiqueta: 'Total desde RD$', tipo: 'minimo', valor: (v) => v.total },
  ];
  let vistos = filas;
  const detV = (v) => `${fecha(v.fecha)} · ${v.items.map((i) => `${i.medicamento}${i.cantidad ? ` ×${i.cantidad}` : ""}`).join(', ')} · ${RD(v.total)}${v.medico ? ` · ${v.medico}` : ''}`;
  const galeriaV = (v) => verAdjunto(v.foto.clave, vistos.filter((x) => x.foto).map((x) => ({ clave: x.foto.clave, nombre: `Voucher del ${fecha(x.fecha)}`, detalle: `${detV(x)} · ${ESTADOS_V[x.estado] ?? x.estado}` })));
  const cols = [
    { t: 'Foto', v: (v) => (v.foto ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => galeriaV(v) }, 'Ver foto') : v.referencia ?? '') }, { t: 'Fecha', v: (v) => fecha(v.fecha) },
    ...(vendedor ? [{ t: 'Dependiente', v: (v) => [v.dependiente, v.farmacia ? h('small', { style: 'display:block;color:var(--texto-2)' }, v.farmacia) : null] }] : [{ t: 'Cargado por', v: (v) => v.cargadoPor ?? 'Tú' }]),
    { t: 'Medicamentos', v: (v) => v.items.map((i) => `${i.medicamento}${i.cantidad ? ` ×${i.cantidad}` : ""}`).join(', ') },
    { t: 'Médico', v: (v) => v.medico ?? h('span', { style: 'color:var(--texto-2)' }, 'Sin médico') },
    { t: 'Total', num: true, v: (v) => RD(v.total) }, { t: 'Estado', v: (v) => [chip(v.estado), v.motivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, v.motivo) : null, v.estado === 'rechazado' && v.corregible ? h('small', { style: 'display:block;color:#C0462C;font-weight:600' }, `Corrígelo antes del ${fecha(finDeMes())}`) : null, v.nota ? h('small', { style: 'display:block;color:var(--texto-2)' }, `Nota: ${v.nota}`) : null] },
    { t: '', v: (v) => v.estado === 'rechazado' && v.corregible ? h('button', { class: 'btn btn-peq', onclick: () => irA('misVouchers', { corregir: v.id }) }, 'Corregir') : v.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: async () => { if (await confirmar('Anular voucher', `¿Anular el voucher del ${fecha(v.fecha)} por ${RD(v.total)}? No contará para la comisión.`, { okTexto: 'Anular voucher' })) { await api('POST', `/api/vouchers/${v.id}/anular`).catch((e) => alert(e.message)); pintar(); } } }, 'Anular') : '' },
  ];
  const resumen = (vs) => { const vivos = vs.filter((v) => v.estado !== 'anulado' && v.estado !== 'rechazado'); return `Total ${RD(vivos.reduce((n, v) => n + v.total, 0))} (sin anulados ni rechazados)`; };
  const porCorregir = items.filter((v) => v.estado === 'rechazado' && v.corregible);
  const avisoCorregir = porCorregir.length ? h('div', { class: 'aviso alerta' }, h('strong', {}, `Tienes ${fmtN.format(porCorregir.length)} voucher(s) para corregir. `), `Revisa el motivo, pulsa "Corregir" y envíalos otra vez antes del ${fecha(finDeMes())}. Si no se corrigen, se eliminan al cerrar el mes.`) : null;
  return vista(vendedor ? 'Vouchers cargados' : 'Mis vouchers', 'Puedes anular un voucher mientras siga pendiente de revisión.', avisoCorregir,
    listaFiltrada('misVouchers', filas, campos, (vs, activos) => (vistos = vs, tabla(cols, vs, activos ? ['Ningún voucher con estos filtros', 'Cambia o limpia los filtros.'] : ['Aún no has cargado vouchers', 'Cuando cargues uno, aparecerá aquí con su estado.'], { porPagina: 15 })), resumen));
};
function resumenComision(r) {
  if (!r.configurado) return h('div', { class: 'aviso' }, r.mensaje);
  return h('div', {},
    h('p', { class: 'vista-sub' }, `Período ${r.tipo === 'quincenal' ? 'quincenal' : 'mensual'}: ${fecha(r.periodo.desde)} al ${fecha(r.periodo.hasta)}. Porcentaje ${fmtN.format(r.porcentaje)} %${r.origen === 'dependiente' ? ' (propio)' : ''}.`),
    h('dl', { class: 'rejilla' },
      h('div', { class: 'cifra destacada' }, h('dt', {}, r.cierre ? 'Comisión cerrada' : 'Comisión hasta hoy'), h('dd', {}, RD(r.cierre ? r.cierre.comision : r.comision))),
      h('div', { class: 'cifra' }, h('dt', {}, 'Ventas aprobadas'), h('dd', {}, RD(r.ventasAprobadas))),
      h('div', { class: 'cifra' }, h('dt', {}, 'Vouchers aprobados'), h('dd', {}, fmtN.format(r.vouchers.aprobados))),
      h('div', { class: 'cifra' }, h('dt', {}, 'Pendientes de revisión'), h('dd', {}, fmtN.format(r.vouchers.pendientes)))),
    Object.keys(r.porMedicamento).length ? h('div', { class: 'tarjeta', style: 'margin-top:1rem' }, h('h2', {}, 'Ventas por medicamento'),
      tabla([{ t: 'Medicamento', v: ([m]) => m }, { t: 'Ventas', num: true, v: ([, v]) => RD(v) }], Object.entries(r.porMedicamento), ['', ''])) : null);
}
// ---------------------------------------------------------------- tienda: pedidos de farmacias
const PAGO_N = { transferencia: 'Transferencia', credito: 'Crédito', contra_entrega: 'Pago al entregar' };
const fotoUrl = (u) => (u.startsWith('/api/') ? API + u : u);
V.pedidos = async () => {
  const estado = param('estado') || ''; const id = param('id');
  const { items } = await api('GET', '/api/pedidos');
  const esDep = yo.role === 'dependiente';
  const mueve = ES_GER() || (yo.role === 'representante' && ['Vendedor', 'PVC'].includes(yo.position));
  const SIG = { recibido: ['confirmado', 'Confirmar'], confirmado: ['despachado', 'Marcar despachado'], despachado: ['entregado', 'Marcar entregado'] };
  const err = (e) => alert(e.fields ? Object.values(e.fields).join(' ') : e.message);
  const mover = async (p, est, texto) => {
    const cancelar = est === 'cancelado';
    const cuerpo = est === 'entregado' ? `Las ${fmtN.format(p.unidades)} unidades de ${p.numero} quedarán como venta a ${p.farmacia?.nombre ?? 'la farmacia'} y su inventario sube. Esto no se puede deshacer.`
      : cancelar ? `${p.numero} quedará cancelado. Escribe el motivo: ${esDep ? 'la gerencia' : 'la farmacia'} lo verá.` : `${p.numero} de ${p.farmacia?.nombre ?? 'la farmacia'} pasará a "${ESTADOS[est]}". La farmacia recibe el aviso.`;
    const r = await confirmar(`${texto}: ${p.numero}`, cuerpo, { okTexto: texto, pedirMotivo: cancelar });
    if (r == null || r === false) return;
    try { await api('POST', `/api/pedidos/${p.id}/estado`, { estado: est, ...(cancelar ? { nota: r } : {}) }); router(); } catch (e) { err(e); }
  };
  const subirComp = (p) => {
    const inp = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', style: 'display:none' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) return alert('El comprobante no puede pasar de 5 MB.');
      accionPendiente = 'subir comprobante';
      try { await api('POST', `/api/pedidos/${p.id}/comprobante`, { comprobante: { tipo: f.type, nombre: f.name, base64: await archivoB64(f) } }); router(); } catch (e) { err(e); }
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
  };
  const acciones = (p, detalle) => {
    const b = [];
    if (!detalle) b.push(h('a', { class: 'btn-sec btn-peq', href: `#pedidos?id=${p.id}` }, 'Ver'));
    if (mueve && SIG[p.estado]) b.push(h('button', { class: 'btn btn-peq', type: 'button', onclick: () => mover(p, ...SIG[p.estado]) }, SIG[p.estado][1]));
    if ((mueve && ['recibido', 'confirmado'].includes(p.estado)) || (esDep && p.estado === 'recibido')) b.push(h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', onclick: () => mover(p, 'cancelado', 'Cancelar pedido') }, 'Cancelar'));
    if (esDep && p.pago === 'transferencia' && !['entregado', 'cancelado'].includes(p.estado)) b.push(h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => subirComp(p) }, p.comprobante ? 'Cambiar comprobante' : 'Subir comprobante'));
    return h('div', { class: 'acciones-fila' }, b);
  };
  const productos = (p) => p.items.map((l) => `${l.nombre} ×${fmtN.format(l.cantidad)}`).join(', ');
  const irTienda = esDep ? h('a', { class: 'btn', href: 'tienda.html' }, 'Ir a la tienda') : null;
  if (id) {
    const p = items.find((x) => x.id === id);
    if (!p) return vista('Pedido', null, h('div', { class: 'aviso' }, 'Ese pedido no existe o no lo puedes ver.'), h('a', { class: 'btn-sec', href: '#pedidos' }, 'Volver a pedidos'));
    return vista(`Pedido ${p.numero}`, `${p.farmacia?.nombre ?? ''}${p.farmacia ? `, ${p.farmacia.municipio} (${p.farmacia.provincia})` : ''}. Hecho el ${fecha(String(p.createdAt).slice(0, 10))}.`,
      h('div', { class: 'acciones' }, h('a', { class: 'btn-sec', href: '#pedidos' }, 'Volver a pedidos')),
      h('dl', { class: 'rejilla' }, h('div', { class: 'cifra destacada' }, h('dt', {}, 'Total'), h('dd', {}, RD(p.total))), h('div', { class: 'cifra' }, h('dt', {}, 'Unidades'), h('dd', {}, fmtN.format(p.unidades))),
        h('div', { class: 'cifra' }, h('dt', {}, 'Pago'), h('dd', {}, PAGO_N[p.pago])), h('div', { class: 'cifra' }, h('dt', {}, 'Estado'), h('dd', {}, chip(p.estado)))),
      h('div', { class: 'tarjeta', style: 'margin-top:1rem' }, h('h2', {}, 'Productos'),
        tabla([{ t: 'Producto', v: (l) => [l.nombre, l.presentacion ? h('small', { style: 'display:block;color:var(--texto-2)' }, l.presentacion) : null] }, { t: 'Precio', num: true, v: (l) => RD(l.precio) }, { t: 'Cantidad', num: true, v: (l) => fmtN.format(l.cantidad) }, { t: 'Subtotal', num: true, v: (l) => RD(l.subtotal) }], p.items, ['', ''])),
      p.nota ? h('p', { class: 'hint', style: 'margin-top:1rem' }, `Nota de la farmacia: ${p.nota}`) : null,
      p.pago === 'transferencia' ? h('p', { class: 'hint' }, p.comprobante ? ['Comprobante de la transferencia: ', (ES_GER() || esDep || ['supervisor', 'finanzas'].includes(yo.role)) ? h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => verAdjunto(p.comprobante.clave) }, 'Ver comprobante') : 'cargado'] : 'Aún no hay comprobante de la transferencia.') : null,
      acciones(p, true),
      h('div', { class: 'tarjeta', style: 'margin-top:1.25rem' }, h('h2', {}, 'Historial'), h('ol', { class: 'historial' }, (p.historial ?? []).map((x) => h('li', {}, chip(x.estado), ` ${new Date(x.fecha).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' })}`, x.nota ? h('small', { style: 'display:block;color:var(--texto-2)' }, x.nota) : null)))));
  }
  const vis = items.filter((p) => !estado || p.estado === estado);
  const cuenta = (e) => items.filter((p) => p.estado === e).length;
  const seg = segmentos('Estado del pedido', [['', `Todos (${fmtN.format(items.length)})`], ...['recibido', 'confirmado', 'despachado', 'entregado', 'cancelado'].map((e) => [e, `${ESTADOS[e]} (${fmtN.format(cuenta(e))})`])], estado, (e) => irA('pedidos', e ? { estado: e } : {}));
  return vista(esDep ? 'Mis pedidos' : 'Pedidos de farmacias', esDep ? 'Los pedidos que haces en la tienda. Te avisamos cada vez que cambian de estado.' : 'Pedidos que las farmacias hacen en la tienda. Confírmalos, despáchalos y márcalos entregados: al entregarlos quedan como venta y suben el inventario de la farmacia.',
    irTienda ? h('div', { class: 'acciones acciones-arriba' }, irTienda) : null, seg,
    tabla([{ t: 'Pedido', v: (p) => [p.numero, h('small', { style: 'display:block;color:var(--texto-2)' }, fecha(String(p.createdAt).slice(0, 10)))] },
      ...(esDep ? [] : [{ t: 'Farmacia', v: (p) => [p.farmacia?.nombre ?? '', h('small', { style: 'display:block;color:var(--texto-2)' }, p.farmacia ? `${p.farmacia.municipio}, ${p.farmacia.provincia}` : '')] }]),
      { t: 'Productos', v: productos }, { t: 'Total', num: true, v: (p) => RD(p.total) }, { t: 'Pago', v: (p) => PAGO_N[p.pago] }, { t: 'Estado', v: (p) => chip(p.estado) }, { t: '', v: (p) => acciones(p) }],
    vis, esDep ? ['Aún no has hecho pedidos', 'Entra a la tienda, agrega productos y envía tu pedido.'] : ['No hay pedidos en este estado', 'Cuando una farmacia pida en la tienda, aparecerá aquí.'], { exportar: esDep ? null : { nombre: 'pedidos', titulo: 'Pedidos de farmacias' } }));
};

// ---------------------------------------------------------------- tienda: productos publicados (gestión)
V.tienda = async () => {
  if (!ES_GER()) return vista('Productos en tienda', null, h('div', { class: 'aviso' }, 'Solo la administración o la gerencia publican en la tienda.'));
  const { items, fotosSitio } = await api('GET', '/api/tienda/admin');
  const id = param('id');
  if (!id) {
    const pub = items.filter((m) => m.publicado).length;
    return vista('Productos en tienda', `Elige qué medicamentos del catálogo se ven en la tienda pública, con sus fotos y su ficha. ${fmtN.format(pub)} de ${fmtN.format(items.length)} publicados.`,
      h('div', { class: 'acciones' }, h('a', { class: 'btn-sec', href: 'tienda.html', target: '_blank', rel: 'noopener' }, 'Ver la tienda')),
      tabla([{ t: 'Foto', v: (m) => m.fotos[0] ? h('img', { class: 'mini-foto', src: fotoUrl(m.fotos[0].url), alt: '', width: 48, height: 48, loading: 'lazy' }) : h('span', { class: 'mini-foto vacia', 'aria-hidden': 'true' }) },
        { t: 'Medicamento', v: (m) => [m.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, m.presentacion ?? '')] },
        { t: 'Precio', num: true, v: (m) => (m.precio != null ? RD(m.precio) : h('span', { style: 'color:var(--alerta)' }, 'Sin precio')) },
        { t: 'Fotos', num: true, v: (m) => fmtN.format(m.fotos.length) },
        { t: 'En tienda', v: (m) => h('span', { class: `chip ${m.publicado ? 'validado' : 'pendiente'}` }, m.publicado ? 'Publicado' : 'No publicado') },
        { t: '', v: (m) => h('a', { class: 'btn-sec btn-peq', href: `#tienda?id=${m.id}` }, 'Editar ficha') }],
      items, ['El catálogo no tiene medicamentos', 'Agrégalos en Catálogo → Medicamentos.']));
  }
  const m = items.find((x) => x.id === id);
  if (!m) return vista('Productos en tienda', null, h('div', { class: 'aviso' }, 'Ese medicamento no existe.'));
  const err = (e) => alert(e.fields ? Object.values(e.fields).join(' ') : e.message);
  const guardar = async (cuerpo, texto) => { accionPendiente = texto; try { await api('POST', `/api/tienda/admin/${id}`, cuerpo); router(); } catch (e) { err(e); } };
  const fotos = h('div', { class: 'fotos-admin' }, m.fotos.length ? m.fotos.map((f, i) => h('figure', {}, h('img', { src: fotoUrl(f.url), alt: f.nombre, loading: 'lazy' }),
    h('figcaption', {}, i === 0 ? h('strong', {}, 'Principal') : h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => guardar({ orden: [f.id] }, 'poner como principal') }, 'Hacer principal'),
      h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', onclick: async () => { if (await confirmar('Quitar foto', `La foto "${f.nombre}" deja de verse en la tienda.`, { okTexto: 'Quitar foto' })) guardar({ quitar: f.id }, 'quitar foto'); } }, 'Quitar'))))
    : h('p', { class: 'hint' }, 'Aún no tiene fotos. Agrega al menos una para poder publicarlo.'));
  const subir = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'foto-nueva', multiple: true });
  subir.addEventListener('change', async () => {
    for (const f of subir.files) {
      if (f.size > 5 * 1024 * 1024) { alert(`${f.name} pasa de 5 MB.`); continue; }
      accionPendiente = 'subir foto';
      try { await api('POST', `/api/tienda/admin/${id}/foto`, { foto: { tipo: f.type, nombre: f.name, base64: await archivoB64(f) } }); } catch (e) { err(e); break; }
    }
    router();
  });
  const delSitio = new Set(m.fotos.filter((f) => f.delSitio).map((f) => f.url));
  const sitio = h('fieldset', { class: 'fotos-sitio' }, h('legend', {}, 'Fotos que ya están en el sitio'), fotosSitio.map((f) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'sitio', value: f.url, checked: delSitio.has(f.url) }), h('img', { src: f.url, alt: '', width: 56, height: 56 }), h('span', {}, f.nombre))));
  const filaFicha = (x = {}) => { const fila = h('div', { class: 'fila-ficha' }, h('input', { name: 'dato', value: x.dato ?? '', placeholder: 'Dato (ej. Principio activo)', 'aria-label': 'Dato' }), h('input', { name: 'valor', value: x.valor ?? '', placeholder: 'Valor', 'aria-label': 'Valor' }), h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => fila.remove() }, 'Quitar')); return fila; };
  const ficha = h('div', { class: 'ficha-filas' }, (m.ficha.length ? m.ficha : [{}]).map(filaFicha));
  const desc = h('textarea', { id: 'descripcion', rows: 6, maxlength: 4000 }); desc.value = m.descripcion ?? '';
  const pub = h('input', { type: 'checkbox', id: 'publicado', checked: m.publicado });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Guardar ficha');
  const f = h('form', { class: 'tarjeta', novalidate: true },
    h('h2', {}, 'Fotos'), fotos, h('div', { class: 'field' }, h('span', { class: 'za-etq' }, 'Agregar fotos (JPG, PNG o WEBP, máximo 5 MB cada una)'), zonaArchivo(subir)), sitio,
    h('h2', { style: 'margin-top:1.5rem' }, 'Ficha'), h('p', { class: 'hint' }, 'Datos cortos que se muestran como lista: principio activo, presentación, registro sanitario.'), ficha,
    h('div', { class: 'acciones' }, h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => ficha.append(filaFicha()) }, 'Agregar dato')),
    h('div', { class: 'field' }, h('label', { for: 'descripcion' }, 'Descripción'), desc),
    h('p', { class: 'hint' }, m.precio != null ? `Precio en la tienda: ${RD(m.precio)}. Se cambia en Catálogo → Medicamentos.` : 'Este medicamento no tiene precio: ponle precio en Catálogo → Medicamentos antes de publicarlo.'),
    h('label', { class: 'check' }, pub, h('span', {}, 'Publicado en la tienda')),
    h('div', { class: 'acciones' }, btn));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const filas = [...ficha.querySelectorAll('.fila-ficha')].map((x) => ({ dato: x.querySelector('[name=dato]').value, valor: x.querySelector('[name=valor]').value }));
    const r = await enviar(f, btn, () => api('POST', `/api/tienda/admin/${id}`, { descripcion: desc.value, ficha: filas, fotosSitio: [...f.querySelectorAll('[name=sitio]:checked')].map((x) => x.value), publicado: pub.checked }));
    if (r) router();
  });
  return vista(m.nombre, `${m.presentacion ?? ''} · ficha en la tienda`.replace(/^ · /, 'Ficha en la tienda'), h('div', { class: 'acciones' }, h('a', { class: 'btn-sec', href: '#tienda' }, 'Volver'), m.publicado ? h('a', { class: 'btn-sec', href: `producto.html?id=${m.id}`, target: '_blank', rel: 'noopener' }, 'Ver en la tienda') : null), f);
};

// ---------------------------------------------------------------- tareas sugeridas
V.tareas = async () => {
  const mes = mesDe();
  const r = await api('GET', `/api/tareas?mes=${mes}`);
  const ETQ = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const lista = r.tareas.length ? h('ol', { class: 'tareas' }, r.tareas.map((t) => h('li', { class: `tarea prioridad-${t.prioridad}` },
    h('div', { class: 'tarea-cabeza' }, h('span', { class: `chip ${t.prioridad === 'alta' ? 'alerta' : t.prioridad === 'media' ? 'pendiente' : 'ok'}` }, `Prioridad ${ETQ[t.prioridad].toLowerCase()}`), t.impacto > 0 ? h('small', {}, `En juego: ${RD(t.impacto)}`) : null),
    h('h3', {}, t.titulo), h('p', {}, t.porque), h('p', { class: 'tarea-quien' }, h('strong', {}, 'Quién: '), t.quien),
    t.enlace ? h('a', { class: 'btn-sec btn-peq', href: t.enlace }, 'Ver los datos') : null)))
    : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay tareas sugeridas este mes'), 'Cuando haya recetas sin venta, farmacias que dejaron de comprar o metas atrasadas, aparecerán aquí.');
  return vista('Tareas sugeridas', `Lo que conviene hacer para vender más, según lo que muestran las recetas, los vouchers, las ventas y las metas de ${mes}. Ordenadas por prioridad y por lo que hay en juego.`, filtroMes(mes, 'tareas'), lista);
};

// ---------------------------------------------------------------- movimiento por territorio
/** Ranking que se puede ordenar por volumen de ventas o por unidades: cambia en el momento, sin recargar. */
const ordenRanking = {};
function rankingOrdenable(clave, lista, opciones, pintar) {
  const caja = h('div', {});
  const botones = opciones.map((o) => h('button', { type: 'button', role: 'radio', class: 'orden-op', onclick: () => elegir(o.id) }, o.etiqueta));
  const barra = h('div', { class: 'orden-barra' }, h('span', { class: 'orden-tit', id: `orden-${clave}` }, 'Ordenar por'), h('div', { class: 'orden-seg', role: 'radiogroup', 'aria-labelledby': `orden-${clave}` }, ...botones));
  function elegir(id) {
    ordenRanking[clave] = id;
    const o = opciones.find((x) => x.id === id);
    botones.forEach((b, i) => { const si = opciones[i].id === id; b.setAttribute('aria-checked', String(si)); b.tabIndex = si ? 0 : -1; });
    const orden = lista.slice().sort((a, b) => (Number(o.valor(b)) || 0) - (Number(o.valor(a)) || 0));
    caja.replaceChildren(pintar(orden, o));
  }
  barra.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const i = opciones.findIndex((x) => x.id === ordenRanking[clave]);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + opciones.length) % opciones.length;
    elegir(opciones[j].id); botones[j].focus();
  });
  elegir(ordenRanking[clave] ?? opciones[0].id);
  return h('div', {}, lista.length > 1 ? barra : null, caja);
}

V.territorio = async () => {
  const mes = mesDe(); const prov = param('provincia') || '';
  const [r, div] = await Promise.all([api('GET', `/api/reportes/territorio?mes=${mes}${prov ? `&provincia=${encodeURIComponent(prov)}` : ''}`), division()]);
  const fp = campo('fprov', 'Provincia', { options: div.provincias.map((p) => ({ value: p, label: p })), value: prov, placeholder: 'Todo el país' });
  fp.querySelector('select').addEventListener('change', (e) => irA('territorio', { mes, ...(e.target.value ? { provincia: e.target.value } : {}) }));
  const t = r.totales;
  const cifras = h('dl', { class: 'rejilla' },
    h('div', { class: 'cifra destacada' }, h('dt', {}, 'Volumen recetado'), h('dd', {}, RD(t.volumenRecetado))),
    h('div', { class: 'cifra' }, h('dt', {}, 'Unidades recetadas'), h('dd', {}, fmtN.format(t.recetadas)), h('small', {}, `${fmtN.format(t.recetas)} receta(s)`)),
    h('div', { class: 'cifra' }, h('dt', {}, 'Vendido en farmacias (vouchers)'), h('dd', {}, RD(t.montoVoucher)), h('small', {}, `${fmtN.format(t.vendidasVoucher)} unidades, ${fmtN.format(t.vouchers)} voucher(s)`)),
    h('div', { class: 'cifra' }, h('dt', {}, 'Vendido por el laboratorio'), h('dd', {}, RD(t.montoLaboratorio)), h('small', {}, `${fmtN.format(t.vendidasLaboratorio)} unidades`)));
  const sub = (x) => h('small', { style: 'display:block;color:var(--texto-2)' }, x);
  const bloques = [h('div', { class: 'form-fila' }, filtroMes(mes, 'territorio', () => (prov ? `provincia=${encodeURIComponent(prov)}` : '')), fp), cifras];
  if (r.sinUbicacion) bloques.push(h('div', { class: 'aviso' }, `${fmtN.format(r.sinUbicacion)} voucher(s) no se pudieron ubicar: su dependiente no está ligada a una farmacia del catálogo.`));
  bloques.push(S('provincias', 'Por provincia', tabla([
    { t: 'Provincia', v: (x) => [x.provincia, sub(`${fmtN.format(x.municipios)} municipio(s)`)] },
    { t: 'Recetado', num: true, v: (x) => [RD(x.volumenRecetado), sub(`${fmtN.format(x.recetadas)} u.`)] },
    { t: 'Vouchers', num: true, v: (x) => [RD(x.montoVoucher), sub(`${fmtN.format(x.vendidasVoucher)} u.`)] },
    { t: 'Laboratorio', num: true, v: (x) => [RD(x.montoLaboratorio), sub(`${fmtN.format(x.vendidasLaboratorio)} u.`)] },
    { t: 'Alertas', num: true, v: (x) => (x.alertas ? h('span', { class: 'chip alerta' }, fmtN.format(x.alertas)) : '0') },
    { t: '', v: (x) => (prov ? '' : h('a', { class: 'btn-sec btn-peq', href: `#territorio?mes=${mes}&provincia=${encodeURIComponent(x.provincia)}&sec=detalle` }, 'Ver municipios')) },
  ], r.porProvincia, ['Sin movimiento este mes', 'Aparece cuando hay recetas, vouchers o ventas cargadas.'], { exportar: { nombre: `movimiento-provincias-${mes}`, titulo: `Movimiento por provincia ${mes}` } })));
  bloques.push(S('detalle', 'Por municipio y medicamento', h('p', { class: 'hint' }, 'Alerta: en ese municipio se recetaron más unidades de las que salieron por sus farmacias (vouchers y ventas del laboratorio). Puede ser una venta perdida o una farmacia sin inventario.'), tabla([
    { t: 'Zona', v: (x) => [x.municipio, sub(x.provincia)] }, { t: 'Medicamento', v: (x) => x.medicamento },
    { t: 'Recetado', num: true, v: (x) => [fmtN.format(x.recetadas), sub(RD(x.volumenRecetado))] },
    { t: 'Vouchers', num: true, v: (x) => [fmtN.format(x.vendidasVoucher), sub(RD(x.montoVoucher)), x.vouchersPendientes ? sub(`${x.vouchersPendientes} por revisar`) : null] },
    { t: 'Laboratorio', num: true, v: (x) => [fmtN.format(x.vendidasLaboratorio), sub(RD(x.montoLaboratorio))] },
    { t: 'Estado', v: (x) => (x.alerta ? h('span', { class: 'chip alerta' }, 'Recetado sin venta') : h('span', { class: 'chip ok' }, 'Cubierto')) },
  ], r.filas, ['Sin movimiento', 'Elige otro mes o provincia.'], { exportar: { nombre: `movimiento-${prov || 'pais'}-${mes}`, titulo: `Movimiento ${prov || 'todo el país'} ${mes}` } })));
  bloques.push(S('farmacias', 'Farmacias que más venden', h('p', { class: 'hint' }, 'Según los vouchers que suben sus dependientes (aprobados y por revisar).'), rankingOrdenable('farmacias', r.farmaciasTop, [{ id: 'monto', etiqueta: 'Volumen de ventas (RD$)', valor: (x) => x.monto }, { id: 'unidades', etiqueta: 'Unidades vendidas', valor: (x) => x.unidades }, { id: 'vouchers', etiqueta: 'Vouchers', valor: (x) => x.vouchers }], (lista, o) => tabla([
    { t: '#', num: true, v: (x) => lista.indexOf(x) + 1 }, { t: 'Farmacia', v: (x) => [x.farmacia, sub(`${x.municipio}, ${x.provincia}`)] },
    { t: 'Vendido', num: true, v: (x) => RD(x.monto) }, { t: 'Unidades', num: true, v: (x) => fmtN.format(x.unidades) }, { t: 'Vouchers', num: true, v: (x) => fmtN.format(x.vouchers) },
    { t: 'Dependientes', num: true, v: (x) => fmtN.format(x.dependientes) }, { t: 'Más vendido', v: (x) => x.masVendido ?? '' },
  ], lista, ['Sin vouchers este mes', 'Aparecen cuando las dependientes suben sus vouchers.'], { porPagina: 15, exportar: { nombre: `farmacias-top-${mes}-${o.id}`, titulo: `Farmacias que más venden ${mes}, por ${o.etiqueta.toLowerCase()}` } }))));
  const OPC_VENTA = [{ id: 'monto', etiqueta: 'Volumen de ventas (RD$)', valor: (x) => x.monto }, { id: 'unidades', etiqueta: 'Unidades vendidas', valor: (x) => x.unidades }];
  bloques.push(S('medicamentos', 'Medicamentos más vendidos', rankingOrdenable('medicamentos', r.medicamentosTop, [...OPC_VENTA, { id: 'recetadas', etiqueta: 'Unidades recetadas', valor: (x) => x.recetadas }], (lista, o) => tabla([
    { t: '#', num: true, v: (x) => lista.indexOf(x) + 1 }, { t: 'Medicamento', v: (x) => x.medicamento },
    { t: 'Vendido', num: true, v: (x) => RD(x.monto) }, { t: 'Unidades vendidas', num: true, v: (x) => fmtN.format(x.unidades) },
    { t: 'Unidades recetadas', num: true, v: (x) => fmtN.format(x.recetadas) }, { t: 'Municipios', num: true, v: (x) => fmtN.format(x.municipios) },
  ], lista, ['Sin ventas este mes', ''], { porPagina: 15, exportar: { nombre: `medicamentos-top-${mes}-${o.id}`, titulo: `Medicamentos más vendidos ${mes}, por ${o.etiqueta.toLowerCase()}` } }))));
  bloques.push(S('municipios', 'Municipios que más venden', rankingOrdenable('municipios', r.municipiosTop, [...OPC_VENTA, { id: 'recetado', etiqueta: 'Volumen recetado', valor: (x) => x.recetado }], (lista, o) => tabla([
    { t: '#', num: true, v: (x) => lista.indexOf(x) + 1 }, { t: 'Municipio', v: (x) => [x.municipio, sub(x.provincia)] },
    { t: 'Vendido', num: true, v: (x) => RD(x.monto) }, { t: 'Unidades', num: true, v: (x) => fmtN.format(x.unidades) }, { t: 'Recetado', num: true, v: (x) => RD(x.recetado) },
  ], lista, ['Sin ventas este mes', ''], { porPagina: 15, exportar: { nombre: `municipios-top-${mes}-${o.id}`, titulo: `Municipios que más venden ${mes}, por ${o.etiqueta.toLowerCase()}` } }))));
  bloques.push(S('medicos', 'Médicos que más recetan', tabla([
    { t: '#', num: true, v: (x) => r.ranking.indexOf(x) + 1 }, { t: 'Médico', v: (x) => [x.medico, x.especialidad ? sub(x.especialidad) : null] },
    { t: 'Centro', v: (x) => [x.centro ?? '', sub(x.zona)] }, { t: 'Recetas', num: true, v: (x) => fmtN.format(x.recetas) }, { t: 'Unidades', num: true, v: (x) => fmtN.format(x.unidades) },
    { t: 'Volumen', num: true, v: (x) => RD(x.volumen) }, { t: 'Última receta', v: (x) => (x.ultima ? fecha(x.ultima) : '') },
  ], r.ranking, ['Sin recetas este mes', ''], { exportar: { nombre: `ranking-medicos-${mes}`, titulo: `Médicos que más recetan ${mes}` } })));
  return vistaS('territorio', ['provincias', 'detalle', 'farmacias', 'medicamentos', 'municipios', 'medicos'], 'Movimiento por territorio', 'Qué medicamentos y cuánto volumen se movió en cada provincia y municipio: lo recetado (precio del catálogo), lo vendido en las farmacias según los vouchers y lo vendido por el laboratorio.', ...bloques);
};

// ---------------------------------------------------------------- metas
const fmtMeta = (m, v) => (v == null ? '' : m.unidad === 'RD$' ? RD(v) : m.decimal ? fmtN.format(v) : fmtN.format(Math.round(v)));
/** Barra de avance: el número va siempre en texto, la barra solo acompaña. */
function barraMeta(m, dias) {
  if (m.meta == null) return h('div', { class: 'meta-celda' }, h('strong', {}, fmtMeta(m, m.valor)), h('small', {}, 'Sin meta'));
  const pct = m.porcentaje ?? 0; const esperado = dias.total ? Math.round((dias.transcurridos / dias.total) * 100) : 0;
  const atrasado = m.clave !== 'medicamentosPorReceta' && dias.transcurridos > 0 && dias.transcurridos < dias.total && pct < esperado * 0.8;
  return h('div', { class: 'meta-celda' }, h('span', {}, h('strong', {}, fmtMeta(m, m.valor)), ` de ${fmtMeta(m, m.meta)}`),
    h('div', { class: 'meta-barra', role: 'img', 'aria-label': `${pct}% de la meta` }, h('span', { style: `width:${Math.min(pct, 100)}%` }), m.clave !== 'medicamentosPorReceta' && esperado > 0 && esperado < 100 ? h('i', { style: `left:${esperado}%`, title: `Ritmo esperado a hoy: ${esperado}%` }) : null),
    h('small', { class: atrasado ? 'atrasado' : '' }, `${pct}%${atrasado ? ' · por debajo del ritmo' : ''}${m.fuente === 'representante' ? ' · meta propia' : ''}`),
    m.vecesPorLugar != null ? h('small', { class: 'meta-calculo' }, `${fmtN.format(m.vecesPorLugar)} ${m.vecesPorLugar === 1 ? 'vez' : 'veces'} × ${fmtN.format(m.lugares)} ${m.porLugar === 'farmacia' ? 'farmacias' : 'centros'} de su zona. Con todas sus visitas: ${fmtN.format(m.cubiertos)} de ${fmtN.format(m.lugares)}.`) : null);
}
/** Equipos por zona: vendedor + visitador + promotora (y PVC) de la misma zona; un objetivo común, vender más. */
async function seccionEquipos(mes) {
  const r = await api('GET', `/api/metas/equipos?mes=${mes}`);
  const ritmo = r.dias.total && r.dias.transcurridos < r.dias.total ? Math.round((r.dias.transcurridos / r.dias.total) * 100) : null;
  const tarjeta = (e) => {
    const barra = e.meta ? barraMeta({ clave: 'ventas', nombre: 'Ventas', unidad: 'RD$', decimal: true, meta: e.meta, valor: e.ventas.total, porcentaje: e.porcentaje, fuente: null }, r.dias) : h('p', { class: 'hint' }, `Ventas: ${RD(e.ventas.total)}. Sin meta de ventas para este equipo.`);
    let metaForm = null;
    if (ES_GER()) {
      const inp = h('input', { type: 'number', min: 1, step: 0.01, inputmode: 'decimal', value: e.metaFuente === 'equipo' ? e.meta : '', placeholder: r.equipoGlobal ? `General: ${fmtN.format(r.equipoGlobal)}` : 'RD$', 'aria-label': `Meta de ventas del equipo de ${e.vendedor.nombre}` });
      const b = h('button', { class: 'btn-sec btn-peq', type: 'submit' }, 'Guardar meta');
      metaForm = h('form', { class: 'equipo-meta', novalidate: true }, h('label', {}, h('span', {}, 'Meta de ventas del equipo (RD$ al mes)'), inp), b);
      metaForm.addEventListener('submit', async (ev) => { ev.preventDefault(); if (await enviar(metaForm, b, () => api('POST', `/api/metas/equipo/${e.vendedor.id}`, { monto: inp.value }))) router(); });
    }
    return h('article', { class: 'tarjeta equipo' },
      h('div', { class: 'equipo-cabeza' }, h('div', {}, h('h3', {}, `Equipo de ${e.vendedor.nombre}`), h('small', {}, e.zona)), e.porcentaje != null ? h('span', { class: `chip ${e.porcentaje >= (ritmo ?? 100) ? 'ok' : 'alerta'}` }, `${e.porcentaje}% de la meta`) : null),
      barra,
      h('dl', { class: 'equipo-cifras' }, h('div', {}, h('dt', {}, 'Vouchers de farmacias'), h('dd', {}, RD(e.ventas.vouchers))), h('div', {}, h('dt', {}, 'Ventas del laboratorio'), h('dd', {}, RD(e.ventas.laboratorio))), h('div', {}, h('dt', {}, 'Recetado en la zona'), h('dd', {}, RD(e.recetado)))),
      h('ul', { class: 'equipo-miembros' }, e.integrantes.map((i) => h('li', {}, h('span', {}, h('strong', {}, i.nombre), h('small', {}, i.posicion)), h('span', { class: 'equipo-prom' }, i.promedio != null ? `${i.promedio}% de sus metas` : 'Sin metas')))),
      e.faltan.length ? h('div', { class: 'aviso' }, `Falta ${e.faltan.join(' y ').toLowerCase()} en esta zona.`) : null, metaForm);
  };
  const glob = ES_GER() ? (() => {
    const inp = h('input', { type: 'number', min: 1, step: 0.01, inputmode: 'decimal', value: r.equipoGlobal ?? '', 'aria-label': 'Meta de ventas general por equipo' });
    const b = h('button', { class: 'btn-sec', type: 'submit' }, 'Guardar meta general');
    const f = h('form', { class: 'tarjeta equipo-meta', novalidate: true }, h('label', {}, h('span', {}, 'Meta de ventas general por equipo (RD$ al mes); cada equipo puede tener la suya'), inp), b);
    f.addEventListener('submit', async (ev) => { ev.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/metas/equipo/global', { monto: inp.value }))) router(); });
    return f;
  })() : null;
  return h('div', { class: 'equipos' },
    h('p', { class: 'hint' }, 'Cada zona es un equipo: el vendedor y los visitadores, promotoras y PVC que trabajan su territorio. Cada uno tiene su meta y todas suman a un mismo objetivo: las ventas del equipo en su zona (vouchers de sus farmacias y ventas del laboratorio).'),
    glob, r.equipos.length ? h('div', { class: 'equipos-lista' }, r.equipos.map(tarjeta)) : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Aún no hay equipos'), 'Un equipo se forma cuando un vendedor tiene zona asignada.'),
    r.sinEquipo.length ? h('div', { class: 'aviso' }, `Sin equipo: ${r.sinEquipo.map((u) => `${u.nombre} (${u.posicion}${u.conZona ? '' : ', sin zona'})`).join(', ')}.`) : null);
}

V.metas = async () => {
  const mes = mesDe();
  const esRep = yo.role === 'representante';
  const av = await api('GET', `/api/metas/avance?mes=${mes}`);
  const nota = av.dias.transcurridos && av.dias.transcurridos < av.dias.total ? `Van ${av.dias.transcurridos} de ${av.dias.total} días del mes; la línea en cada barra marca el ritmo esperado a hoy.` : '';
  if (esRep) {
    const yoAv = av.items[0];
    const cuerpo = !yoAv || !yoAv.metricas.length ? h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Tu posición aún no tiene metas'), 'La gerencia las fija; aquí verás tu avance.')
      : h('div', { class: 'metas-tarjetas' }, yoAv.metricas.map((m) => h('article', { class: 'tarjeta meta-tarjeta' }, h('h2', {}, m.nombre), barraMeta(m, av.dias))));
    const equipo = await seccionEquipos(mes);
    return vista('Mis metas', `${nota} ${yoAv?.metricas.some((m) => m.clave.startsWith('visitas')) ? 'Una visita cuenta cuando la marcas en Mis jornadas → Marcar visitas.' : ''}`.trim() || null, filtroMes(mes, 'metas'), cuerpo, h('h2', { style: 'margin-top:2rem' }, 'Mi equipo'), equipo);
  }
  const cfg = ES_GER() || yo.role === 'supervisor' ? (await api('GET', '/api/metas')).item : null;
  const bloques = [h('div', { class: 'form-fila' }, filtroMes(mes, 'metas'))];
  bloques.push(S('equipos', 'Equipos por zona', await seccionEquipos(mes)));
  const grupos = ['Vendedor', 'PVC', 'Visitador', 'Promotora'].map((pos) => [pos, av.items.filter((x) => x.representante.posicion === pos)]).filter(([, xs]) => xs.length);
  bloques.push(S('avance', 'Avance del mes', ...(grupos.length ? grupos.map(([pos, xs]) => h('div', { class: 'tarjeta', style: 'margin-bottom:1rem' }, h('h2', {}, pos === 'Promotora' ? 'Promotoras' : `${pos}es`.replace('PVCes', 'PVC')),
    tabla([{ t: 'Representante', v: (x) => [x.representante.nombre, x.promedio != null ? h('small', { style: 'display:block;color:var(--texto-2)' }, `Promedio ${x.promedio}%`) : null] },
      ...xs[0].metricas.map((m, i) => ({ t: m.nombre, v: (x) => barraMeta(x.metricas[i], av.dias) }))], xs, ['', ''], { exportar: { nombre: `metas-${pos.toLowerCase()}-${mes}`, titulo: `Metas ${pos} ${mes}` } }))) : [h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay representantes activos con metas'), 'Vendedores, PVC, visitadores y promotoras aparecen aquí.')]), nota ? h('p', { class: 'hint' }, nota) : null));
  if (ES_GER()) {
    const formPos = (pos) => {
      const ks = cfg.porPosicionMetricas[pos];
      const b = h('button', { class: 'btn-sec', type: 'submit' }, `Guardar metas de ${pos}`);
      const f = h('form', { class: 'tarjeta', novalidate: true, style: 'margin-bottom:1rem' }, h('h2', {}, pos),
        h('div', { class: 'form-fila' }, ks.map((k) => campo(k, cfg.metricas[k].etiquetaMeta ?? `${cfg.metricas[k].nombre}${cfg.metricas[k].unidad === 'RD$' ? ' (RD$)' : ''} por mes`, { type: 'number', min: 0, step: cfg.metricas[k].decimal ? 0.1 : 1, inputmode: cfg.metricas[k].decimal ? 'decimal' : 'numeric', value: cfg.porPosicion?.[pos]?.[k] ?? '' }))),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/metas/posicion', { posicion: pos, valores: Object.fromEntries(ks.map((k) => [k, f[k].value])) }))) router(); });
      return f;
    };
    bloques.push(S('posicion', 'Metas por posición', h('p', { class: 'hint' }, 'Aplican a todos los de esa posición, cada mes. Las visitas se fijan como veces al mes por lugar: la meta del mes es veces × lugares de su zona (por ejemplo, 2 veces × 100 farmacias = 200 visitas). Vendedor: farmacias. Visitador y PVC (visitador y vendedor a la vez): farmacias y centros de salud. Promotora: recetas, medicamentos por receta, volumen (unidades × precio del catálogo) y pacientes.'), ['Vendedor', 'PVC', 'Visitador', 'Promotora'].map(formPos)));
    const reps = av.items.map((x) => x.representante);
    const rep = param('rep') || '';
    const sel = campo('rep', 'Representante', { options: reps.map((r) => ({ value: r.id, label: `${r.nombre} (${r.posicion})` })), value: rep, placeholder: 'Elige el representante' });
    sel.querySelector('select').addEventListener('change', (e) => irA('metas', { mes, sec: 'propias', ...(e.target.value ? { rep: e.target.value } : {}) }));
    const r = reps.find((x) => x.id === rep);
    let fr = null;
    if (r) {
      const ks = cfg.porPosicionMetricas[r.posicion]; const propias = cfg.porRep?.[r.id] ?? {};
      const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar metas propias');
      fr = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, r.nombre),
        h('p', { class: 'hint' }, 'Deja en blanco lo que debe seguir la meta de su posición (aparece como sugerencia).'),
        h('div', { class: 'form-fila' }, ks.map((k) => campo(k, cfg.metricas[k].etiquetaMeta ?? cfg.metricas[k].nombre, { type: 'number', min: 0, step: cfg.metricas[k].decimal ? 0.1 : 1, value: propias[k] ?? '', placeholder: cfg.porPosicion?.[r.posicion]?.[k] != null ? `Posición: ${fmtN.format(cfg.porPosicion[r.posicion][k])}` : 'Sin meta' }))),
        h('div', { class: 'acciones' }, b, Object.keys(propias).length ? h('button', { class: 'btn-sec', type: 'button', onclick: async () => { if (await confirmar('Quitar metas propias', `${r.nombre} volverá a la meta de ${r.posicion}.`, { okTexto: 'Quitar metas propias' })) { await api('POST', `/api/metas/representante/${r.id}`, { quitar: true }).catch((e) => alert(e.message)); router(); } } }, 'Usar las de su posición') : null));
      fr.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(fr, b, () => api('POST', `/api/metas/representante/${r.id}`, { valores: Object.fromEntries(ks.map((k) => [k, fr[k].value])) }))) router(); });
    }
    bloques.push(S('propias', 'Metas por representante', h('p', { class: 'hint' }, 'Para quien necesite una meta distinta a la de su posición.'), h('div', { style: 'max-width:28rem' }, sel), fr));
  }
  return vistaS('metas', ['equipos', 'avance', 'posicion', 'propias'], 'Metas', 'Metas mensuales de visitas, recetas y volumen. Las visitas cuentan cuando el representante las marca como hechas en su jornada.', ...bloques);
};

V.comision = async () => vista('Mi comisión', null, resumenComision(await api('GET', '/api/comisiones/resumen')));

/** Tarjeta con la cuenta de banco (número completo o enmascarado según quién la ve). */
function tarjetaCuenta(c, nombre) {
  if (!c) return h('div', { class: 'aviso' }, `${nombre ? `${nombre} aún no` : 'Aún no'} ha registrado su cuenta de banco.`);
  return h('div', { class: 'cuenta-banco' }, h('span', { class: 'cuenta-banco-nombre' }, c.bancoNombre),
    h('strong', { class: 'cuenta-banco-numero' }, c.numero), h('span', {}, `Cuenta de ${c.tipoNombre.toLowerCase()} a nombre de ${c.titular}`), h('small', {}, `Aviso de transferencia: ${c.correo}`));
}
V.banco = async () => {
  const [{ bancos, tipos }, r] = await Promise.all([api('GET', '/api/banco/opciones'), api('GET', '/api/banco/mia')]);
  const c = r.cuenta;
  const b = h('button', { class: 'btn', type: 'submit' }, c ? 'Actualizar cuenta' : 'Guardar cuenta');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, c ? 'Actualizar tu cuenta' : 'Agrega tu cuenta'),
    h('div', { class: 'form-fila' },
      campo('banco', 'Banco', { options: bancos, value: c?.banco, placeholder: 'Elige el banco' }),
      campo('tipo', 'Tipo de cuenta', { options: tipos, value: c?.tipo, placeholder: 'Ahorro o corriente' }),
      campo('numero', 'Número de cuenta', { inputmode: 'numeric', autocomplete: 'off', value: c?.numero ?? '', placeholder: 'Solo números' })),
    h('div', { class: 'form-fila' },
      campo('titular', 'Titular de la cuenta', { value: c?.titular ?? r.titularSugerido ?? '', autocomplete: 'name' }),
      campo('correo', 'Correo para el aviso de la transferencia', { type: 'email', value: c?.correo ?? r.correoSugerido ?? '', autocomplete: 'email' }, '(se completa con el de tu cuenta)')),
    h('p', { class: 'hint' }, 'Solo tú, finanzas y la gerencia ven el número completo. Si lo cambias, queda registrado.'),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await enviar(f, b, () => api('POST', '/api/banco/mia', { banco: f.banco.value, tipo: f.tipo.value, numero: f.numero.value, titular: f.titular.value, correo: f.correo.value }))) irA('banco', { sec: 'registrada' });
  });
  const sub = 'Aquí se te paga la comisión. Bancos disponibles: BHD, Banco Popular y Banreservas.';
  if (!c) return vista('Mi cuenta de banco', sub, f);
  return vistaS('banco', ['registrada', 'actualizar'], 'Mi cuenta de banco', sub,
    S('registrada', 'Cuenta registrada', h('div', { class: 'tarjeta' }, h('h2', {}, 'Cuenta registrada'), tarjetaCuenta(c))),
    S('actualizar', 'Actualizar tu cuenta', f));
};

// ---------------------------------------------------------------- vistas: promotora
V.operativo = async () => {
  const { items } = await api('GET', `/api/operativos?fecha=${hoy()}`);
  const boton = h('button', { class: 'btn', type: 'submit' }, 'Registrar operativo');
  const form = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, '¿Dónde estás trabajando hoy?'),
    h('div', { class: 'form-fila' }, campo('provincia', 'Provincia', { required: true }), campo('municipio', 'Municipio', { required: true }), campo('centro', 'Centro de salud', { required: true })),
    h('div', { class: 'acciones' }, boton));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, boton, () => api('POST', '/api/operativos', { provincia: form.provincia.value, municipio: form.municipio.value, centro: form.centro.value }));
    if (r) location.hash = '#receta';
  });
  return vista('Operativo de hoy', 'Registra cada centro donde trabajas hoy. Luego cargas las recetas de ese centro.', form,
    h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Operativos de hoy'),
    tabla([{ t: 'Centro', v: (o) => o.centro }, { t: 'Municipio', v: (o) => o.municipio }, { t: 'Provincia', v: (o) => o.provincia }], items, ['Aún no registras operativos hoy', 'Registra el centro donde estás para empezar a cargar recetas.']));
};
/**
 * Paciente por teléfono o por nombre. Con el teléfono, si ya existe, su nombre se llena solo.
 * Con el nombre (desde 3 letras) aparecen los pacientes ya registrados; al elegir uno se llena su teléfono
 * (oculto salvo los 4 últimos) y la receta se suma a su historial sin duplicarlo.
 */
function buscadorPaciente(inTel, inNom, nota) {
  let elegido = null; let qTel = 0; let qNom = 0; let opciones = []; let activo = -1;
  const lista = h('ul', { class: 'pac-sugerencias', role: 'listbox', hidden: true, id: `pac-${Math.random().toString(36).slice(2)}` });
  inNom.setAttribute('autocomplete', 'off'); inNom.setAttribute('role', 'combobox'); inNom.setAttribute('aria-autocomplete', 'list'); inNom.setAttribute('aria-controls', lista.id); inNom.setAttribute('aria-expanded', 'false');
  inNom.parentElement.classList.add('pac-caja'); inNom.insertAdjacentElement('afterend', lista);
  const cerrar = () => { lista.hidden = true; inNom.setAttribute('aria-expanded', 'false'); activo = -1; };
  const marcar = () => [...lista.children].forEach((li, i) => { li.setAttribute('aria-selected', String(i === activo)); if (i === activo) inNom.setAttribute('aria-activedescendant', li.id); });
  const soltar = () => { if (!elegido) return; elegido = null; inTel.readOnly = false; inTel.value = ''; inTel.classList.remove('paciente-conocido'); nota.textContent = ''; };
  const elegir = (p) => {
    elegido = p; inNom.value = p.nombre; inTel.value = p.telefono; inTel.readOnly = true; inTel.classList.add('paciente-conocido');
    nota.replaceChildren(`Paciente ya registrado, con ${fmtN.format(p.recetas)} receta(s)${p.ultima ? `, la última el ${fecha(p.ultima)}` : ''}. Su teléfono ya está guardado; esta receta se suma a su historial. `,
      h('button', { type: 'button', class: 'btn-enlace', onclick: () => { soltar(); inNom.value = ''; inNom.focus(); } }, 'Es otra persona'));
    cerrar();
  };
  inNom.addEventListener('input', async () => {
    if (elegido) soltar();
    if (inTel.readOnly) return; // el teléfono ya identificó al paciente
    const q = inNom.value.trim(); const k = ++qNom;
    if (q.length < 3) { cerrar(); return; }
    try {
      const { pacientes } = await api('GET', `/api/pacientes?nombre=${encodeURIComponent(q)}`);
      if (k !== qNom) return;
      opciones = pacientes; activo = -1;
      lista.replaceChildren(...pacientes.map((p, i) => h('li', { role: 'option', id: `${lista.id}-${i}`, 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); elegir(p); } },
        h('strong', {}, p.nombre), h('span', {}, `Tel. ${p.telefono} · ${fmtN.format(p.recetas)} receta(s)${p.municipio ? ` · ${p.municipio}` : ''}`))));
      lista.hidden = !pacientes.length; inNom.setAttribute('aria-expanded', String(!!pacientes.length));
      if (!pacientes.length && !String(inTel.value).replace(/\D/g, '')) nota.textContent = 'Paciente nuevo: escribe también su teléfono.';
      else if (pacientes.length) nota.textContent = 'Si es uno de estos pacientes, elígelo: su teléfono se llena solo.';
    } catch { cerrar(); }
  });
  inNom.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(opciones.length - 1, activo + 1); marcar(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(0, activo - 1); marcar(); }
    else if (e.key === 'Enter' && activo >= 0) { e.preventDefault(); elegir(opciones[activo]); }
    else if (e.key === 'Escape') cerrar();
  });
  inNom.addEventListener('blur', () => setTimeout(cerrar, 120));
  inTel.addEventListener('input', async () => {
    if (elegido) return;
    const d = String(inTel.value).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); const k = ++qTel;
    if (d.length < 10) { if (inNom.readOnly) { inNom.readOnly = false; inNom.value = ''; inNom.classList.remove('paciente-conocido'); nota.textContent = ''; } return; }
    try {
      const { paciente } = await api('GET', `/api/pacientes?telefono=${d}`);
      if (k !== qTel) return;
      if (paciente) { inNom.value = paciente.nombre; inNom.readOnly = true; inNom.classList.add('paciente-conocido'); cerrar(); nota.textContent = `Paciente ya registrado, con ${fmtN.format(paciente.recetas)} receta(s). Esta receta se suma a su historial; no se duplica su contacto.`; }
      else { if (inNom.readOnly) { inNom.readOnly = false; inNom.value = ''; inNom.classList.remove('paciente-conocido'); } nota.textContent = 'Paciente nuevo: escribe su nombre.'; }
    } catch { /* se puede escribir el nombre igual */ }
  });
  return {
    valor: () => (elegido ? { id: elegido.id } : { telefono: inTel.value, nombre: inNom.value }),
    conocido: () => Boolean(elegido) || inNom.readOnly,
    reiniciar: () => { elegido = null; inTel.readOnly = false; inNom.readOnly = false; inTel.value = ''; inNom.value = ''; inTel.classList.remove('paciente-conocido'); inNom.classList.remove('paciente-conocido'); nota.textContent = ''; cerrar(); },
  };
}

V.receta = async () => {
  if (yo.role === 'medico') return recetaMedico();
  const [ops, meds] = await Promise.all([api('GET', '/api/operativos'), api('GET', '/api/catalogo/medicos')]);
  const recientes = ops.items.filter((o) => o.fecha >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).reverse();
  if (!recientes.length) return vista('Cargar receta', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Primero registra tu operativo'), 'Cada receta va ligada al centro donde la registras. ', h('a', { href: '#operativo' }, 'Registrar operativo')));
  const ed = lineasEditor({ conMonto: false }); await ed.init();
  if (!ed.hayMeds()) return vista('Cargar receta', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Todavía no hay medicamentos en el catálogo'), 'La gerencia debe agregarlos primero.'));
  const opcionesMedico = () => meds.items.map((m) => ({ value: m.id, label: `${m.nombre}, ${m.especialidad}${m.estado === 'pendiente' ? ' (por validar)' : ''}` }));
  let selMedico = campo('medicoId', 'Médico que prescribió', { options: opcionesMedico(), placeholder: 'Elige el médico', required: true });
  const nuevoMed = h('details', { class: 'tarjeta', style: 'background:var(--canvas)' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--marino)' }, '¿El médico no está en la lista? Agrégalo'),
    h('div', { class: 'form-fila', style: 'margin-top:1rem' }, campo('m_nombre', 'Nombre del médico'), campo('m_especialidad', 'Especialidad'), campo('m_centro', 'Centro', {}, '(opcional)')));
  const foto = campo('adjunto', 'Foto de la receta', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', capture: 'environment' }, '(opcional, hasta 5 MB)');
  const boton = h('button', { class: 'btn', type: 'submit' }, 'Guardar receta');
  const alertas = h('div', {});
  // Paciente: el teléfono lo identifica. Si ya existe, el nombre se completa solo y no se duplica.
  const fTel = campo('paciente.telefono', 'Teléfono del paciente', { type: 'tel', inputmode: 'tel', autocomplete: 'off', required: true });
  const fNom = campo('paciente.nombre', 'Nombre del paciente', { autocomplete: 'off', required: true });
  const pacNota = h('p', { class: 'hint paciente-nota', 'aria-live': 'polite' }, 'Escribe primero el teléfono: si el paciente ya está registrado, su nombre aparece solo.');
  const inTel = fTel.querySelector('input'); const inNom = fNom.querySelector('input');
  const pac = buscadorPaciente(inTel, inNom, pacNota);
  const reiniciarPaciente = () => { pac.reiniciar(); pacNota.textContent = 'Escribe el teléfono o el nombre: si el paciente ya está registrado, sus datos aparecen solos.'; };
  pacNota.textContent = 'Escribe el teléfono o el nombre: si el paciente ya está registrado, sus datos aparecen solos.';
  const pacBloque = h('div', {}, h('h2', {}, 'Paciente'), h('div', { class: 'form-fila' }, fTel, fNom), pacNota);
  const form = h('form', { class: 'tarjeta', novalidate: true },
    campo('operativoId', 'Operativo', { options: recientes.map((o) => ({ value: o.id, label: `${o.centro}, ${o.municipio} (${fecha(o.fecha)})` })), value: recientes[0].id, required: true }),
    selMedico, nuevoMed, pacBloque,
    h('h2', {}, 'Medicamentos recetados'), h('p', { class: 'error', dataset: { for: 'items' } }), ed.el, h('div', { class: 'acciones' }, ed.boton),
    foto, h('div', { class: 'acciones' }, boton));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, boton, async () => {
      let medicoId = form.medicoId.value;
      if (nuevoMed.open && form.m_nombre.value.trim()) {
        const op = recientes.find((o) => o.id === form.operativoId.value);
        const m = await api('POST', '/api/catalogo/medicos', { nombre: form.m_nombre.value, especialidad: form.m_especialidad.value, centro: form.m_centro.value || op.centro, provincia: op.provincia, municipio: op.municipio })
          .catch((err) => { throw Object.assign(err, { fields: Object.fromEntries(Object.entries(err.fields ?? {}).map(([k, v]) => [`m_${k}`, v])) }); });
        medicoId = m.item.id; meds.items.push(m.item);
      }
      let adjunto;
      const file = form.adjunto.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new ApiError(413, { error: 'La foto no puede pasar de 5 MB.', fields: { adjunto: 'Archivo demasiado grande.' } });
        const b64 = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(file); });
        adjunto = { nombre: file.name, tipo: file.type, base64: b64 };
      }
      return api('POST', '/api/recetas', { operativoId: form.operativoId.value, medicoId, items: ed.valores(), adjunto, paciente: pac.valor() });
    });
    if (r) {
      estado(form.querySelector('.aviso'), 'ok', r.paciente?.nuevo === false ? `Receta guardada y sumada a ${r.paciente.nombre}.` : 'Receta guardada.');
      reiniciarPaciente();
      alertas.replaceChildren(...r.alertas.filter((a) => a.estado !== 'ok').map((a) => h('div', { class: `aviso ${a.estado === 'alerta' ? 'error' : ''}` },
        a.estado === 'alerta' ? `Alerta: en ${a.municipio} ya se recetaron ${fmtN.format(a.recetado)} unidades de ${a.medicamento} y las farmacias de la zona tienen ${fmtN.format(a.disponible)}. Coordina compra con el vendedor.` : `${a.medicamento}: ${a.mensaje}`)));
      form.adjunto.value = ''; ed.el.replaceChildren(); ed.boton.click();
      if (nuevoMed.open) { nuevoMed.open = false; const nuevo = campo('medicoId', 'Médico que prescribió', { options: opcionesMedico(), placeholder: 'Elige el médico', required: true }); selMedico.replaceWith(nuevo); selMedico = nuevo; }
    }
  });
  // Varias por foto: cada foto es una fila con su médico, su paciente y sus medicamentos.
  const selOp = campo('opMasivo', 'Operativo de estas recetas', { options: recientes.map((o) => ({ value: o.id, label: `${o.centro}, ${o.municipio} (${fecha(o.fecha)})` })), value: recientes[0].id });
  const listaMed = meds.items.filter((m) => m.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const catMed = { items: meds.items.filter((m) => m.estado !== 'inactivo'), especialidades: meds.especialidades ?? [] };
  const opElegido = () => recientes.find((o) => o.id === selOp.querySelector('select').value) ?? {};
  const extrasReceta = () => {
    const med = selectorMedico(catMed, { requerido: true, ubicacion: () => ({ operativoId: opElegido().id }), preferir: opElegido });
    const tel = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '809-000-0000', 'aria-label': 'Teléfono del paciente' });
    const nom = h('input', { autocomplete: 'off', placeholder: 'Nombre del paciente', 'aria-label': 'Nombre del paciente' });
    const nota = h('small', { class: 'hint pac-nota' });
    const lNom = h('label', {}, h('span', {}, 'Nombre del paciente'), nom);
    const nodos = h('div', { class: 'cm-extras' }, ...med.nodos, h('label', {}, h('span', {}, 'Teléfono del paciente'), tel), lNom, nota);
    const pac = buscadorPaciente(tel, nom, nota);
    return {
      nodos,
      valores: () => ({ medico: med, paciente: pac.valor() }),
      valido: () => med.valido() ?? (pac.valor().id ? null : String(tel.value).replace(/\D/g, '').length < 10 ? 'Escribe el teléfono del paciente o elige un paciente ya registrado por su nombre.' : !pac.conocido() && nom.value.trim().length < 3 ? 'Escribe el nombre del paciente.' : null),
    };
  };
  const cmR = cargaMasiva({
    nombre: 'receta', meds: await medicamentos(), conPrecio: false, etiquetaCant: 'Unidades', extras: extrasReceta,
    arriba: h('div', {}, h('div', { class: 'form-fila' }, selOp), h('p', { class: 'hint' }, '¿El médico no está en la lista? Elige "No está en la lista" y escribe su nombre, apellido y especialidad. Queda guardado para la próxima vez.')),
    enviar: async ({ items, foto, huella, dhash, extras }) => api('POST', '/api/recetas', { operativoId: selOp.querySelector('select').value, medicoId: await extras.medico.valor(), paciente: extras.paciente, items, adjunto: foto, fotoHuella: huella, fotoDhash: dhash }),
  });
  return vistaS('receta', ['fotos', 'una'], 'Cargar recetas', 'Sube todas las fotos de las prescripciones de una vez, o regístralas una por una. Cada receta lleva su médico, su paciente y los medicamentos de FERSUAZ que se recetaron.',
    S('fotos', 'Varias por foto', cmR.el), S('una', 'Una por una', alertas, form));
};
/**
 * Cargar recetas del médico: el médico de cada receta es él (nombre, apellido y especialidad, sin buscarlo).
 * Solo si la prescribió otro médico lo cambia. El paciente es opcional. Todas van a revisión.
 */
async function recetaMedico() {
  const [perfil, cat, meds] = await Promise.all([api('GET', '/api/medico/perfil'), api('GET', '/api/catalogo/medicos').catch(() => ({ items: [], especialidades: [] })), medicamentos()]);
  const yoMed = perfil.item;
  if (!yoMed) return vista('Cargar recetas', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Tu ficha de médico no está lista'), 'Pide a la gerencia que revise tu cuenta.'));
  const lugares = yoMed.lugares ?? [];
  const catMed = { items: cat.items.filter((m) => m.estado !== 'inactivo' && m.estado !== 'rechazado' && m.id !== yoMed.id), especialidades: cat.especialidades ?? perfil.especialidades ?? [] };
  const yoTxt = `${yoMed.nombre}, ${yoMed.especialidad}`;
  const selLugar = campo('lugarMed', 'Lugar donde recetaste', { options: lugares.map((l) => ({ value: l.establecimientoId, label: `${l.nombre}, ${l.municipio}` })), value: lugares[0]?.establecimientoId });
  const lugarElegido = () => lugares.find((l) => l.establecimientoId === selLugar.querySelector('select').value) ?? lugares[0] ?? {};
  const extras = () => {
    // El médico es él; solo se despliega para elegir a otro si la receta no fue suya.
    const med = selectorMedico(catMed, { yo: `Yo: ${yoTxt}`, ubicacion: () => ({ provincia: lugarElegido().provincia, municipio: lugarElegido().municipio }), preferir: lugarElegido });
    const otro = h('details', { class: 'med-otro' }, h('summary', {}, `Médico: ${yoTxt}. ¿La prescribió otro médico? Cámbialo`), ...med.nodos);
    const tel = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '809-000-0000', 'aria-label': 'Teléfono del paciente' });
    const nom = h('input', { autocomplete: 'off', placeholder: 'Nombre del paciente', 'aria-label': 'Nombre del paciente' });
    const nota = h('small', { class: 'hint pac-nota' }, 'Paciente: opcional.');
    const nodos = h('div', { class: 'cm-extras' }, otro, h('label', {}, h('span', {}, 'Teléfono del paciente (opcional)'), tel), h('label', {}, h('span', {}, 'Nombre del paciente (opcional)'), nom), nota);
    const pac = buscadorPaciente(tel, nom, nota);
    const conPac = () => pac.valor().id || String(tel.value).replace(/\D/g, '') || nom.value.trim();
    return {
      nodos,
      valores: () => ({ medico: med, paciente: conPac() ? pac.valor() : null }),
      valido: () => med.valido() ?? (!conPac() || pac.valor().id ? null : String(tel.value).replace(/\D/g, '').length < 10 ? 'Escribe el teléfono completo del paciente, o deja los dos campos del paciente vacíos.' : !pac.conocido() && nom.value.trim().length < 3 ? 'Escribe el nombre del paciente.' : null),
    };
  };
  const cm = cargaMasiva({
    nombre: 'receta', meds, conPrecio: false, etiquetaCant: 'Unidades', extras, fechaReceta: true,
    arriba: h('div', {}, h('div', { class: 'form-fila' }, selLugar), h('p', { class: 'hint' }, `Cada receta lleva tu nombre y especialidad (${yoTxt}). Si alguna la prescribió otro médico, cámbialo en esa fila. Todas pasan a revisión antes de contar.`)),
    enviar: async ({ items, foto, huella, dhash, fecha: f, extras: x }) => api('POST', '/api/recetas', { establecimientoId: lugarElegido().establecimientoId, fecha: f, medicoId: (await x.medico.valor()) || undefined, ...(x.paciente ? { paciente: x.paciente } : {}), items, adjunto: foto, fotoHuella: huella, fotoDhash: dhash }),
  });
  return vista('Cargar recetas', 'Sube todas las fotos de tus prescripciones de una vez. Por cada foto elige los medicamentos de FERSUAZ y las unidades.', cm.el);
}
const ESTADO_RECETA = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

V.misRecetas = async () => {
  const mes = new URLSearchParams(location.hash.split('?')[1]).get('mes') || mesActual();
  const { items } = await api('GET', `/api/recetas?mes=${mes}`);
  const propio = ['medico', 'representante'].includes(yo.role);
  const sub = (x) => h('small', { style: 'display:block;color:var(--texto-2)' }, x);
  const uni = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const filas = items.slice().reverse();
  let vistos = filas;
  const meds = (r) => r.items.map((i) => `${i.medicamento} ×${i.unidades}`).join(', ');
  const campos = [
    { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Medicamento, médico, paciente…', valor: (r) => [meds(r), r.medico, r.paciente?.nombre, r.cargadoPorNombre, r.lugar].join(' ') },
    { id: 'estado', etiqueta: 'Estado', tipo: 'opciones', opciones: Object.entries(ESTADO_RECETA).filter(([k]) => items.some((r) => r.estado === k)).map(([value, label]) => ({ value, label })), valor: (r) => r.estado },
    { id: 'med', etiqueta: 'Medicamento', tipo: 'opciones', plural: 'medicamentos', opciones: uni(items.flatMap((r) => r.items.map((i) => i.medicamento))), valor: (r) => r.items.map((i) => i.medicamento) },
    { id: 'medico', etiqueta: 'Médico', tipo: 'opciones', plural: 'médicos', opciones: uni(items.map((r) => r.medico)), valor: (r) => r.medico },
    { id: 'mun', etiqueta: 'Municipio', tipo: 'opciones', plural: 'municipios', opciones: uni(items.map((r) => r.municipio)), valor: (r) => r.municipio },
    ...(!propio ? [{ id: 'por', etiqueta: 'Cargada por', tipo: 'opciones', opciones: uni(items.map((r) => r.cargadoPorNombre)), valor: (r) => r.cargadoPorNombre }] : []),
  ];
  const cols = [
    { t: 'Fecha', v: (r) => fecha(r.fecha) },
    { t: 'Médico', v: (r) => [r.medico, sub(r.especialidad)] },
    ...(!propio ? [{ t: 'Cargada por', v: (r) => [r.cargadoPorNombre, sub(r.cargadoPorRol)] }] : []),
    { t: 'Paciente', v: (r) => r.paciente ? [r.paciente.nombre, sub(r.paciente.telefono)] : h('span', { style: 'color:var(--texto-2)' }, 'Sin registrar') },
    { t: 'Lugar', v: (r) => [r.lugar ?? r.municipio, sub(`${r.municipio}, ${r.provincia}`)] },
    { t: 'Medicamentos', v: (r) => meds(r) },
    { t: 'Estado', v: (r) => [chip(r.estado), r.motivo ? sub(r.motivo) : null, r.nota ? sub(`Nota: ${r.nota}`) : null] },
    { t: 'Foto', v: (r) => r.adjunto ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => verAdjunto(r.adjunto.clave, vistos.filter((x) => x.adjunto).map((x) => ({ clave: x.adjunto.clave, nombre: `Receta del ${fecha(x.fecha)}`, detalle: `${x.medico} · ${meds(x)} · ${ESTADO_RECETA[x.estado] ?? x.estado}` }))) }, 'Ver foto') : 'Sin foto' },
  ];
  const resumen = (vs) => Object.entries(ESTADO_RECETA).map(([k, l]) => `${fmtN.format(vs.filter((r) => r.estado === k).length)} ${l.toLowerCase()}(s)`).join(' · ');
  return vista(propio ? 'Mis recetas' : 'Recetas', propio ? 'Cada receta pasa por revisión. Solo las aprobadas cuentan en metas y reportes.' : null, filtroMes(mes, 'misRecetas'),
    listaFiltrada(`recetas-${mes}`, filas, campos, (vs, activos) => { vistos = vs; return tabla(cols, vs, activos ? ['Ninguna receta con estos filtros', 'Cambia o limpia los filtros.'] : ['No hay recetas en este mes', 'Las recetas que se carguen aparecerán aquí.'], { porPagina: 25 }); }, resumen));
};

/** Recetas por revisar: las de promotoras y médicos. Aprobar o rechazar, una por una, desde la foto o todas. */
V.revisarRecetas = async () => {
  const { items } = await api('GET', '/api/recetas?estado=pendiente');
  const sub = (x) => h('small', { style: 'display:block;color:var(--texto-2)' }, x);
  const uni = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const meds = (r) => r.items.map((i) => `${i.medicamento} ×${i.unidades}`).join(', ');
  const filas = items.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  let vistos = filas; let cambios = false;
  const SUG_R = [
    { texto: 'El medicamento cargado no coincide con la prescripción.' }, { texto: 'Las unidades no coinciden con la prescripción.' },
    { texto: 'La fecha de la receta no pertenece al mes.' }, { texto: 'El médico no coincide con la prescripción.' },
    { texto: 'La foto no se ve clara. Vuelve a cargarla.' }, { texto: 'Receta repetida.' }, { texto: 'No incluye medicamentos de FERSUAZ.' },
  ];
  const SUG_A = [{ texto: 'Todo coincide con la prescripción.' }, { texto: 'Verificado: medicamentos, unidades y médico correctos.' }];
  async function decidir(r, aprobar) {
    const quien = `${r.cargadoPorNombre}${r.cargadoPorRol ? ` (${r.cargadoPorRol})` : ''}`;
    const m = aprobar ? await confirmar('Aprobar receta', `¿Aprobar la receta del ${fecha(r.fecha)} cargada por ${quien}? Contará en metas y reportes.`, { okTexto: 'Sí, aprobar', pedirMotivo: true, etiquetaMotivo: 'Nota (opcional)', sugerencias: SUG_A })
      : await confirmar('Rechazar receta', `¿Rechazar la receta del ${fecha(r.fecha)} cargada por ${quien}? Elige o escribe el motivo: lo verá.`, { okTexto: 'Sí, rechazar', pedirMotivo: true, sugerencias: SUG_R });
    if (m == null || m === false) return null;
    try { await api('POST', `/api/recetas/${r.id}/${aprobar ? 'aprobar' : 'rechazar'}`, { motivo: m }); cambios = true; return aprobar ? 'Aprobada' : 'Rechazada'; } catch (e) { alert(e.message); return null; }
  }
  const etiquetas = (r) => ({ titulo: 'Lo que cargó', lineas: r.items.map((i) => ({ texto: i.medicamento, extra: `${fmtN.format(i.unidades)} unidad(es)` })),
    notas: [`Médico: ${r.medico}${r.especialidad ? `, ${r.especialidad}` : ''}`, `Fecha: ${fecha(r.fecha)}`, r.paciente ? `Paciente: ${r.paciente.nombre}` : 'Sin paciente', `Cargada por ${r.cargadoPorNombre}${r.cargadoPorRol ? ` (${r.cargadoPorRol})` : ''}`] });
  const abrir = (r) => verAdjunto(r.adjunto.clave, vistos.filter((x) => x.adjunto).map((x) => ({ clave: x.adjunto.clave, nombre: `${x.cargadoPorNombre} · ${x.lugar ?? x.municipio}`, detalle: `${x.municipio}, ${x.provincia} · ${meds(x)}`,
    etiquetas: () => etiquetas(x), acciones: [{ texto: 'Aprobar', clase: 'ok', accion: () => decidir(x, true) }, { texto: 'Rechazar', clase: 'no', accion: () => decidir(x, false) }] })), { onClose: () => { if (cambios) router(); } });
  const sel = new Set();
  const elegidos = () => vistos.filter((r) => sel.has(r.id));
  const marcaTodos = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todas las recetas que se ven con los filtros' });
  marcaTodos.addEventListener('change', () => { if (marcaTodos.checked) vistos.forEach((r) => sel.add(r.id)); else sel.clear(); document.querySelectorAll('input[data-sel-receta]').forEach((c) => { c.checked = sel.has(c.dataset.selReceta); c.closest('tr')?.classList.toggle('fila-sel', c.checked); }); pintarLote(); });
  const loteCaja = h('div', { class: 'lote-barra' });
  async function todos(aprobar) {
    const rs = elegidos().length ? elegidos() : vistos; if (!rs.length) return;
    const que = elegidos().length ? 'Son las que seleccionaste.' : 'Son todas las que se ven con los filtros de ahora.';
    const m = aprobar ? await confirmar(`Aprobar ${fmtN.format(rs.length)} receta(s)`, `¿Seguro que quieres aprobar ${fmtN.format(rs.length)} receta(s)? ${que}`, { okTexto: `Sí, aprobar ${fmtN.format(rs.length)}`, pedirMotivo: true, etiquetaMotivo: 'Nota (opcional)', sugerencias: SUG_A })
      : await confirmar(`Rechazar ${fmtN.format(rs.length)} receta(s)`, `¿Seguro que quieres rechazar ${fmtN.format(rs.length)} receta(s)? ${que} Elige o escribe el motivo.`, { okTexto: `Sí, rechazar ${fmtN.format(rs.length)}`, pedirMotivo: true, sugerencias: SUG_R });
    if (m == null || m === false) return;
    try { const out = await api('POST', '/api/recetas/decidir', { ids: rs.map((r) => r.id), aprobar, motivo: m }); aviso(out.errores.length ? `${fmtN.format(out.hechos)} listas; ${out.errores.length} no se pudieron: ${out.errores[0].error}` : `Listo: ${fmtN.format(out.hechos)} receta(s) ${aprobar ? 'aprobada(s)' : 'rechazada(s)'}.`, out.errores.length ? 'error' : 'ok'); } catch (e) { alert(e.message); }
    router();
  }
  function pintarLote() {
    const n = elegidos().length;
    marcaTodos.checked = n > 0 && n === vistos.length; marcaTodos.indeterminate = n > 0 && n < vistos.length;
    loteCaja.replaceChildren(...(vistos.length < 2 && !n ? [] : [
      h('span', { class: 'lote-estado' }, n ? `${fmtN.format(n)} seleccionada(s)` : `Ninguna seleccionada. Los botones actúan sobre las ${fmtN.format(vistos.length)} que se ven.`),
      h('div', { class: 'acciones', style: 'margin:0' },
        h('button', { class: 'btn', type: 'button', onclick: () => todos(true) }, n ? `Aprobar seleccionadas (${fmtN.format(n)})` : `Aprobar todas (${fmtN.format(vistos.length)})`),
        h('button', { class: 'btn-sec btn-peligro', type: 'button', onclick: () => todos(false) }, n ? `Rechazar seleccionadas (${fmtN.format(n)})` : `Rechazar todas (${fmtN.format(vistos.length)})`),
        n ? h('button', { class: 'btn-enlace', type: 'button', onclick: () => { marcaTodos.checked = false; marcaTodos.indeterminate = false; marcaTodos.dispatchEvent(new Event('change')); } }, 'Quitar selección') : null),
    ]));
  }
  const campos = [
    { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Medicamento, médico, quién la cargó…', valor: (r) => [meds(r), r.medico, r.cargadoPorNombre, r.paciente?.nombre, r.lugar].join(' ') },
    { id: 'rol', etiqueta: 'Cargada por (tipo)', tipo: 'opciones', opciones: uni(items.map((r) => r.cargadoPorRol)), valor: (r) => r.cargadoPorRol },
    { id: 'por', etiqueta: 'Cargada por', tipo: 'opciones', opciones: uni(items.map((r) => r.cargadoPorNombre)), valor: (r) => r.cargadoPorNombre },
    { id: 'prov', etiqueta: 'Provincia', tipo: 'opciones', plural: 'provincias', opciones: uni(items.map((r) => r.provincia)), valor: (r) => r.provincia },
    { id: 'mun', etiqueta: 'Municipio', tipo: 'opciones', plural: 'municipios', opciones: uni(items.map((r) => r.municipio)), valor: (r) => r.municipio },
    { id: 'medico', etiqueta: 'Médico', tipo: 'opciones', plural: 'médicos', opciones: uni(items.map((r) => r.medico)), valor: (r) => r.medico },
    { id: 'med', etiqueta: 'Medicamento', tipo: 'opciones', plural: 'medicamentos', opciones: uni(items.flatMap((r) => r.items.map((i) => i.medicamento))), valor: (r) => r.items.map((i) => i.medicamento) },
    { id: 'desde', etiqueta: 'Desde', tipo: 'desde', valor: (r) => r.fecha }, { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta', valor: (r) => r.fecha },
  ];
  const cols = [
    { t: marcaTodos, etiqueta: 'Seleccionar esta receta', clase: 'td-sel', v: (r) => { const c = h('input', { type: 'checkbox', 'data-sel-receta': r.id, 'aria-label': `Seleccionar receta del ${fecha(r.fecha)} de ${r.cargadoPorNombre}` }); c.checked = sel.has(r.id); c.addEventListener('change', () => { c.checked ? sel.add(r.id) : sel.delete(r.id); c.closest('tr')?.classList.toggle('fila-sel', c.checked); pintarLote(); }); return h('span', { class: 'celda-sel' }, c); } },
    { t: 'Cargada por', v: (r) => [r.cargadoPorNombre, sub(r.cargadoPorRol)] },
    { t: 'Foto', v: (r) => (r.adjunto ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => abrir(r) }, 'Ver foto') : 'Sin foto') },
    { t: 'Fecha', v: (r) => fecha(r.fecha) },
    { t: 'Médico', v: (r) => [r.medico, sub(r.especialidad)] },
    { t: 'Lugar', v: (r) => [r.lugar ?? r.municipio, sub(`${r.municipio}, ${r.provincia}`)] },
    { t: 'Medicamentos', v: (r) => meds(r) },
    { t: '', clase: 'td-acciones', v: (r) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' }, h('button', { class: 'btn btn-peq', onclick: async () => { if (await decidir(r, true)) router(); } }, 'Aprobar'), h('button', { class: 'btn-sec btn-peq', onclick: async () => { if (await decidir(r, false)) router(); } }, 'Rechazar')) },
  ];
  return vista('Recetas por revisar', 'Todas las pendientes: de promotoras y de médicos. Solo las aprobadas cuentan en metas y reportes. En la foto puedes comparar lo cargado y aprobar o rechazar sin cerrarla.',
    listaFiltrada('revisarRecetas', filas, campos, (vs, activos) => { vistos = vs; for (const id of [...sel]) if (!vs.some((r) => r.id === id)) sel.delete(id); pintarLote(); return h('div', {}, loteCaja, tabla(cols, vs, activos ? ['Ninguna receta pendiente con estos filtros', 'Cambia o limpia los filtros.'] : ['No hay recetas pendientes', 'Cuando una promotora o un médico cargue una, aparecerá aquí.'], { porPagina: 25 })); }));
};

/** Perfil del médico: especialidad y lugares de trabajo. */
V.miPerfilMedico = async () => {
  const p = await api('GET', '/api/medico/perfil');
  const m = p.item;
  if (!m) return vista('Mi perfil', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Tu ficha de médico no está lista'), 'Pide a la gerencia que revise tu cuenta.'));
  return vista('Mi perfil', 'Tu nombre y especialidad van en cada receta que cargas.', h('div', { class: 'tarjeta' },
    h('h2', {}, m.nombre), h('p', {}, m.especialidad),
    h('h3', {}, 'Dónde trabajas'), h('ul', {}, ...(m.lugares ?? []).map((l) => h('li', {}, `${l.nombre}, ${l.municipio}, ${l.provincia}`))),
    h('p', { class: 'hint' }, 'Para cambiar tus lugares de trabajo o tu especialidad, escribe a la gerencia.')));
};
const adjuntosCache = new Map();
/** Descarga un adjunto con la sesión y lo deja listo para el visor (se guarda mientras la página esté abierta). */
function cargarAdjunto(clave) {
  if (!adjuntosCache.has(clave)) {
    adjuntosCache.set(clave, fetch(`${API}/api/adjuntos/${encodeURIComponent(clave)}`, { headers: { authorization: `Bearer ${token()}` } })
      .then(async (r) => {
        if (r.status === 404) throw Object.assign(new Error('El archivo de esta foto no está guardado en el servidor. Pide que la vuelvan a cargar o recházalo.'), { permanente: true });
        if (!r.ok) throw new Error(`El servidor no entregó la foto (${r.status}).`);
        const b = await r.blob(); return { url: URL.createObjectURL(b), tipo: b.type };
      })
      .catch((e) => { adjuntosCache.delete(clave); throw e; }));
    if (adjuntosCache.size > 60) { const [k, p] = adjuntosCache.entries().next().value; adjuntosCache.delete(k); p.then((x) => URL.revokeObjectURL(x.url)).catch(() => {}); }
  }
  return adjuntosCache.get(clave);
}
/** Una foto sola, o varias: `lista` = [{ clave, nombre, detalle }] para pasar de una a otra sin cerrar. */
async function verAdjunto(clave, lista = null, opciones = {}) {
  const items = (lista ?? [{ clave, nombre: 'Foto adjunta' }]).map((x) => ({ ...x, nombre: x.nombre ?? 'Foto adjunta', cargar: () => cargarAdjunto(x.clave) }));
  verGaleria(items, Math.max(0, (lista ?? []).findIndex((x) => x.clave === clave)), opciones);
}
function filtroMes(mes, ruta, extra, { futuro = false } = {}) {
  const inp = h('input', { type: 'month', value: mes, id: 'filtro-mes', max: futuro ? null : mesActual() });
  inp.addEventListener('change', () => { location.hash = `#${ruta}?mes=${inp.value}${extra ? `&${extra()}` : ''}`; });
  return h('div', { class: 'field', style: 'max-width:14rem' }, h('label', { for: 'filtro-mes' }, 'Mes'), inp);
}
V.alertas = async () => {
  const mes = new URLSearchParams(location.hash.split('?')[1]).get('mes') || mesActual();
  const { items, umbral } = await api('GET', `/api/alertas?mes=${mes}`);
  return vista('Alertas de inventario', `Se avisa cuando lo recetado en una zona llega al ${Math.round(umbral * 100)} % de las unidades disponibles en sus farmacias.`, filtroMes(mes, 'alertas'), tabla([
    { t: 'Estado', v: (a) => chip(a.estado) }, { t: 'Medicamento', v: (a) => a.medicamento }, { t: 'Zona', v: (a) => `${a.municipio}, ${a.provincia}` },
    { t: 'Recetado', num: true, v: (a) => fmtN.format(a.recetado) }, { t: 'Disponible', num: true, v: (a) => a.disponible == null ? 'Sin datos' : fmtN.format(a.disponible) },
  ], items, ['Sin alertas este mes', 'Aparecen cuando se registran recetas en una zona.']));
};

// ---------------------------------------------------------------- vistas: gestión
V.revisar = async () => {
  // Por defecto: todos los pendientes, de cualquier usuario, provincia o municipio. Los filtros son opcionales.
  const { items } = await api('GET', '/api/vouchers?estado=pendiente');
  const sub = (x) => h('small', { style: 'display:block;color:var(--texto-2)' }, x);
  const medsDe = (v) => v.items.map((i) => `${i.medicamento}${i.cantidad ? ` ×${i.cantidad}` : ''}`).join(', ');
  const unicos = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const filas = items.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  let vistos = filas; let cambios = false;
  // Respuestas rápidas. Las que se pueden arreglar (fecha, medicamento, cantidad, precio) dejan que el usuario corrija
  // el voucher hasta fin de mes; si no lo hace, se elimina al cerrar el mes.
  const SUG_RECHAZO = [
    { texto: 'La fecha del voucher no pertenece al mes.', corregible: true },
    { texto: 'El medicamento cargado no coincide con la prescripción.', corregible: true },
    { texto: 'La cantidad no coincide con la prescripción.', corregible: true },
    { texto: 'El precio no coincide con el voucher.', corregible: true },
    { texto: 'Falta el médico o no coincide con la prescripción.', corregible: true },
    { texto: 'La foto no se ve clara. Vuelve a cargarla.', corregible: false },
    { texto: 'La foto no quedó guardada. Vuelve a cargarla.', corregible: false },
    { texto: 'Voucher repetido.', corregible: false },
    { texto: 'No es un voucher de esta farmacia.', corregible: false },
  ];
  const SUG_APROBAR = [{ texto: 'Todo coincide con la prescripción.' }, { texto: 'Verificado: medicamento, cantidad y fecha correctos.' }, { texto: 'Aprobado con observación: ' }];
  const CORREGIR = { texto: 'Dejar que lo corrija (fecha, medicamento, cantidad, precio o médico) hasta fin de mes. Si no lo corrige, se elimina al cerrar el mes.', marcada: true };
  const pedirAprobar = (v) => confirmar('Aprobar voucher', `¿Aprobar el voucher del ${fecha(v.fecha)} de ${v.dependiente} por ${RD(v.total)}? Contará para su comisión.`, { okTexto: 'Sí, aprobar', pedirMotivo: true, etiquetaMotivo: 'Nota (opcional)', sugerencias: SUG_APROBAR });
  const pedirRechazo = (v) => confirmar('Rechazar voucher', `¿Rechazar el voucher del ${fecha(v.fecha)} de ${v.dependiente} por ${RD(v.total)}? Elige o escribe el motivo: la dependiente lo verá.`, { okTexto: 'Sí, rechazar', pedirMotivo: true, sugerencias: SUG_RECHAZO, corregir: CORREGIR });
  async function decidir(v, aprobar) {
    const r = aprobar ? await pedirAprobar(v) : await pedirRechazo(v);
    if (r == null || r === false) return null;
    try {
      await api('POST', `/api/vouchers/${v.id}/${aprobar ? 'aprobar' : 'rechazar'}`, aprobar ? { motivo: r } : { motivo: r.motivo, corregible: r.corregible });
      cambios = true; return aprobar ? 'Aprobado' : r.corregible ? 'Rechazado: lo puede corregir' : 'Rechazado';
    } catch (e) { alert(e.message); return null; }
  }
  const etiquetasDe = (v) => ({ titulo: 'Lo que cargó', lineas: v.items.map((i) => ({ texto: `${i.medicamento}${i.presentacion ? `, ${i.presentacion}` : ''}`, extra: `${i.cantidad ?? 1} × ${RD(i.precio ?? (i.monto / (i.cantidad || 1)))} = ${RD(i.monto)}` })),
    notas: [`Fecha del voucher: ${fecha(v.fecha)}`, v.medico ? `Médico: ${v.medico}` : 'Sin médico', v.cargadoPor ? `Cargado por ${v.cargadoPor}` : null].filter(Boolean), total: `Total ${RD(v.total)}` });
  const abrirFoto = (v) => verAdjunto(v.foto.clave, vistos.filter((x) => x.foto).map((x) => ({
    clave: x.foto.clave, nombre: `${x.dependiente} · ${x.farmacia ?? ''}`, detalle: `${x.municipio ? `${x.municipio}, ${x.provincia} · ` : ''}${medsDe(x)} · ${RD(x.total)}`,
    etiquetas: () => etiquetasDe(x),
    acciones: [{ texto: 'Aprobar', clase: 'ok', accion: () => decidir(x, true) }, { texto: 'Rechazar', clase: 'no', accion: () => decidir(x, false) }],
  })), { onClose: () => { if (cambios) router(); } });
  const campos = [
    { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Dependiente, farmacia, medicamento, médico…', valor: (v) => [v.dependiente, v.farmacia, medsDe(v), v.medico, v.cargadoPor, v.referencia].join(' ') },
    { id: 'prov', etiqueta: 'Provincia', tipo: 'opciones', opciones: unicos(items.map((v) => v.provincia)), valor: (v) => v.provincia },
    { id: 'mun', etiqueta: 'Municipio', tipo: 'opciones', opciones: unicos(items.map((v) => v.municipio)), valor: (v) => v.municipio },
    { id: 'farm', etiqueta: 'Farmacia', tipo: 'opciones', opciones: unicos(items.map((v) => v.farmacia)), valor: (v) => v.farmacia },
    { id: 'dep', etiqueta: 'Dependiente', tipo: 'opciones', opciones: unicos(items.map((v) => v.dependiente)), valor: (v) => v.dependiente },
    { id: 'med', etiqueta: 'Medicamento', tipo: 'opciones', opciones: unicos(items.flatMap((v) => v.items.map((i) => i.medicamento))), valor: (v) => v.items.map((i) => i.medicamento) },
    { id: 'medico', etiqueta: 'Médico', tipo: 'opciones', opciones: [...unicos(items.map((v) => v.medico)), ...(items.some((v) => !v.medico) ? [{ value: '—', label: 'Sin médico' }] : [])], valor: (v) => v.medico ?? '—' },
    { id: 'por', etiqueta: 'Cargado por', tipo: 'opciones', opciones: unicos(items.map((v) => v.cargadoPor ?? 'La dependiente')), valor: (v) => v.cargadoPor ?? 'La dependiente' },
    { id: 'desde', etiqueta: 'Desde', tipo: 'desde', valor: (v) => v.fecha },
    { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta', valor: (v) => v.fecha },
    { id: 'min', etiqueta: 'Total desde RD$', tipo: 'minimo', valor: (v) => v.total },
  ];
  // Selección: una por una o todas las que se ven con los filtros (en todas las páginas).
  const sel = new Set();
  const elegidos = () => vistos.filter((v) => sel.has(v.id));
  const marcaTodos = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todos los vouchers que se ven con los filtros' });
  marcaTodos.addEventListener('change', () => { if (marcaTodos.checked) vistos.forEach((v) => sel.add(v.id)); else sel.clear(); document.querySelectorAll('input[data-sel-voucher]').forEach((c) => { c.checked = sel.has(c.dataset.selVoucher); c.closest('tr')?.classList.toggle('fila-sel', c.checked); }); pintarLote(); });
  const loteCaja = h('div', { class: 'lote-barra' });
  function pintarLote() {
    const es = elegidos(); const n = es.length; const objetivo = n ? es : vistos;
    marcaTodos.checked = n > 0 && n === vistos.length; marcaTodos.indeterminate = n > 0 && n < vistos.length;
    const total = RD(objetivo.reduce((t, v) => t + v.total, 0));
    loteCaja.replaceChildren(...(vistos.length < 2 && !n ? [] : [
      h('span', { class: 'lote-estado' }, n ? `${fmtN.format(n)} seleccionado(s) · ${total}` : `Ninguno seleccionado. Los botones actúan sobre los ${fmtN.format(vistos.length)} que se ven.`),
      h('div', { class: 'acciones', style: 'margin:0' },
        h('button', { class: 'btn', type: 'button', onclick: () => todos(true) }, n ? `Aprobar seleccionados (${fmtN.format(n)})` : `Aprobar todos (${fmtN.format(vistos.length)})`),
        h('button', { class: 'btn-sec btn-peligro', type: 'button', onclick: () => todos(false) }, n ? `Rechazar seleccionados (${fmtN.format(n)})` : `Rechazar todos (${fmtN.format(vistos.length)})`),
        n ? h('button', { class: 'btn-enlace', type: 'button', onclick: () => { marcaTodos.checked = false; marcaTodos.indeterminate = false; marcaTodos.dispatchEvent(new Event('change')); } }, 'Quitar selección') : null),
    ]));
  }
  async function todos(aprobar) {
    const vs = elegidos().length ? elegidos() : vistos; if (!vs.length) return;
    const que = elegidos().length ? 'Son los que seleccionaste.' : 'Son todos los que se ven con los filtros de ahora.';
    const total = RD(vs.reduce((n, v) => n + v.total, 0));
    const r = aprobar
      ? await confirmar(`Aprobar ${fmtN.format(vs.length)} voucher(s)`, `¿Seguro que quieres aprobar ${fmtN.format(vs.length)} voucher(s) por ${total} en total? ${que} Contarán para la comisión de cada dependiente.`, { okTexto: `Sí, aprobar ${fmtN.format(vs.length)}`, pedirMotivo: true, etiquetaMotivo: 'Nota (opcional)', sugerencias: SUG_APROBAR })
      : await confirmar(`Rechazar ${fmtN.format(vs.length)} voucher(s)`, `¿Seguro que quieres rechazar ${fmtN.format(vs.length)} voucher(s) por ${total} en total? ${que} Elige o escribe el motivo: cada dependiente lo verá.`, { okTexto: `Sí, rechazar ${fmtN.format(vs.length)}`, pedirMotivo: true, sugerencias: SUG_RECHAZO, corregir: CORREGIR });
    if (r == null || r === false) return;
    try {
      const out = await api('POST', '/api/vouchers/decidir', { ids: vs.map((v) => v.id), aprobar, ...(aprobar ? { motivo: r } : { motivo: r.motivo, corregible: r.corregible }) });
      aviso(out.errores.length ? `${fmtN.format(out.hechos)} ${aprobar ? 'aprobado(s)' : 'rechazado(s)'}; ${out.errores.length} no se pudieron: ${out.errores[0].error}` : `Listo: ${fmtN.format(out.hechos)} voucher(s) ${aprobar ? 'aprobado(s)' : 'rechazado(s)'}.`, out.errores.length ? 'error' : 'ok');
    } catch (e) { alert(e.message); }
    router();
  }
  const cols = [
    { t: marcaTodos, etiqueta: 'Seleccionar este voucher', clase: 'td-sel', v: (v) => { const c = h('input', { type: 'checkbox', 'data-sel-voucher': v.id, 'aria-label': `Seleccionar voucher de ${v.dependiente} del ${fecha(v.fecha)} por ${RD(v.total)}` }); c.checked = sel.has(v.id); c.addEventListener('change', () => { if (c.checked) sel.add(v.id); else sel.delete(v.id); c.closest('tr')?.classList.toggle('fila-sel', c.checked); pintarLote(); }); queueMicrotask(() => c.closest('tr')?.classList.toggle('fila-sel', c.checked)); return h('span', { class: 'celda-sel' }, c); } },
    { t: 'Dependiente', v: (v) => [v.dependiente, sub(v.farmacia ?? ''), v.municipio ? sub(`${v.municipio}, ${v.provincia}`) : null] },
    { t: 'Foto', v: (v) => (v.foto ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => abrirFoto(v) }, 'Ver foto') : v.referencia ?? '') }, { t: 'Fecha', v: (v) => fecha(v.fecha) },
    { t: 'Medicamentos', v: (v) => [medsDe(v), v.medico ? sub(v.medico) : null] }, { t: 'Total', num: true, v: (v) => RD(v.total) },
    { t: '', clase: 'td-acciones', v: (v) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' }, h('button', { class: 'btn btn-peq', onclick: async () => { if (await decidir(v, true)) router(); } }, 'Aprobar'), h('button', { class: 'btn-sec btn-peq', onclick: async () => { if (await decidir(v, false)) router(); } }, 'Rechazar')) },
  ];

  return vista('Vouchers por revisar', 'Todos los pendientes, de cualquier dependiente, provincia o municipio. Solo los aprobados cuentan para la comisión. En la foto puedes comparar lo cargado y aprobar o rechazar sin cerrarla.',
    listaFiltrada('revisar', filas, campos, (vs, activos) => { vistos = vs; for (const id of [...sel]) if (!vs.some((v) => v.id === id)) sel.delete(id); pintarLote(); return h('div', {}, loteCaja, tabla(cols, vs, activos ? ['Ningún voucher pendiente con estos filtros', 'Cambia o limpia los filtros.'] : ['No hay vouchers pendientes', 'Cuando un dependiente cargue uno, aparecerá aquí.'], { porPagina: 25 })); }, (vs) => `Total ${RD(vs.reduce((n, v) => n + v.total, 0))}`));
};
V.comisiones = async () => {
  const puedeConfig = ['administrador', 'gerencia', 'finanzas'].includes(yo.role);
  const [cfg, deps] = await Promise.all([api('GET', '/api/comisiones/config'), api('GET', '/api/dependientes')]);
  const bloques = [];
  if (puedeConfig) {
    const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar configuración');
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Configuración general'),
      h('div', { class: 'form-fila' }, campo('porcentaje', 'Porcentaje de comisión', { type: 'number', min: 0, max: 100, step: 0.01, value: cfg.global?.porcentaje ?? '', inputmode: 'decimal' }),
        campo('periodo', 'Período de pago', { options: [{ value: 'quincenal', label: 'Quincenal' }, { value: 'mensual', label: 'Mensual' }], value: cfg.global?.periodo })),
      h('div', { class: 'acciones' }, b));
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/comisiones/config', { porcentaje: f.porcentaje.value, periodo: f.periodo.value }))) router(); });
    bloques.push(S('config', 'Configuración general', f));
  }
  if (!cfg.global) bloques.push(h('div', { class: 'aviso' }, 'Todavía no hay porcentaje ni período configurados. Hasta entonces no se calculan comisiones.'));
  const sel = campo('dep', 'Dependiente', { options: deps.items.map((d) => ({ value: d.id, label: `${d.fullName}${d.pharmacy ? `, ${d.pharmacy}` : ''}` })), placeholder: 'Elige un dependiente' });
  // Período: una lista con el actual y los anteriores, según la configuración (mensual o quincenal).
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const periodos = (tipo) => {
    const [y0, m0] = hoy().split('-').map(Number); const d0 = Number(hoy().slice(8, 10)); const out = [];
    for (let k = 0; k < 13; k++) {
      const d = new Date(Date.UTC(y0, m0 - 1 - k, 1)); const y = d.getUTCFullYear(); const m = d.getUTCMonth() + 1; const mm = String(m).padStart(2, '0');
      const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
      if (tipo === 'quincenal') {
        if (!(k === 0 && d0 <= 15)) out.push({ value: `${y}-${mm}-Q2`, label: `16 al ${ult} de ${MESES[m - 1]} ${y}` });
        out.push({ value: `${y}-${mm}-Q1`, label: `1 al 15 de ${MESES[m - 1]} ${y}` });
      } else out.push({ value: `${y}-${mm}`, label: `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${y}` });
    }
    out[0].label += ' (actual)';
    return out;
  };
  const per = h('div', { class: 'field' }, h('label', { for: 'per' }, 'Período'), h('select', { id: 'per', 'data-sin-buscador': '1', disabled: true }, h('option', { value: '' }, 'Elige primero el dependiente')));
  const selPer = per.querySelector('select'); let tipoPer = null;
  const detalle = h('div', {});
  const ver = async () => {
    const id = sel.querySelector('select').value; if (!id) return;
    const p = selPer.value;
    try {
      const r = await api('GET', `/api/comisiones/resumen?dependienteId=${id}${p ? `&periodo=${encodeURIComponent(p)}` : ''}`);
      if (r.configurado && r.tipo !== tipoPer) {
        tipoPer = r.tipo;
        selPer.replaceChildren(...periodos(r.tipo).map((o) => h('option', { value: o.value }, o.label)));
        selPer.value = r.periodo.clave; selPer.disabled = false;
      }
      const kids = [resumenComision(r)];
      try { const cb = await api('GET', `/api/banco/${id}`); kids.push(h('div', { class: 'tarjeta', style: 'margin-top:1rem' }, h('h2', {}, 'Cuenta para el pago'), tarjetaCuenta(cb.cuenta, deps.items.find((d) => d.id === id)?.fullName))); } catch { /* sin permiso */ }
      if (r.configurado && !r.cierre && puedeConfig && r.periodo.hasta < hoy()) kids.push(h('div', { class: 'acciones' }, h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmar('Cerrar período', `Cerrar ${r.periodo.clave} con una comisión de ${RD(r.comision)}. Después no se pueden aprobar ni cargar vouchers de ese período.`, { okTexto: 'Cerrar período' }))) return;
        try { await api('POST', '/api/comisiones/cierres', { dependienteId: id, periodo: r.periodo.clave }); ver(); } catch (e) { alert(e.message); }
      } }, 'Cerrar período')));
      if (r.cierre) kids.push(h('div', { class: 'aviso ok' }, `Período cerrado el ${fecha(r.cierre.createdAt)}.`));
      else if (r.configurado && puedeConfig && r.periodo.hasta >= hoy()) kids.push(h('p', { class: 'hint' }, `Este período termina el ${fecha(r.periodo.hasta)}. Se podrá cerrar desde el día siguiente.`));
      detalle.replaceChildren(...kids);
    } catch (e) { detalle.replaceChildren(h('div', { class: 'aviso error' }, e.message)); }
  };
  sel.querySelector('select').addEventListener('change', ver);
  selPer.addEventListener('change', ver);
  bloques.push(S('dep', 'Comisión por dependiente', h('div', { class: 'tarjeta' }, h('h2', {}, 'Comisión por dependiente'), deps.items.length ? h('div', { class: 'form-fila' }, sel, per) : h('p', { class: 'vacio' }, 'Aún no hay dependientes con cuenta activa.'), detalle)));
  return vistaS('comisiones', ['dep', 'config'], 'Comisiones', 'Configura el porcentaje, revisa lo acumulado y cierra cada período para pagarlo.', ...bloques);
};
V.reportes = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1]);
  const mes = q.get('mes') || mesActual(); const agrupar = q.get('agrupar') || 'medicamento';
  const r = await api('GET', `/api/reportes/recetas?mes=${mes}&agrupar=${agrupar}`);
  const OPC = { medicamento: 'Medicamento', linea: 'Línea', promotora: 'Promotora', medico: 'Médico', especialidad: 'Especialidad', provincia: 'Provincia', municipio: 'Municipio', centro: 'Centro de salud' };
  const sel = h('select', { id: 'agrupar' }, Object.entries(OPC).map(([v, l]) => h('option', { value: v, selected: v === agrupar }, l)));
  sel.addEventListener('change', () => { location.hash = `#reportes?mes=${mes}&agrupar=${sel.value}`; });
  return vista('Reporte de recetas', `${fmtN.format(r.totalRecetas)} recetas registradas en el mes.`,
    h('div', { class: 'form-fila', style: 'max-width:30rem' }, filtroMes(mes, 'reportes', () => `agrupar=${agrupar}`), h('div', { class: 'field' }, h('label', { for: 'agrupar' }, 'Agrupar por'), sel)),
    tabla([{ t: OPC[agrupar], v: (f) => f.clave }, { t: 'Recetas', num: true, v: (f) => fmtN.format(f.recetas) }, { t: 'Unidades', num: true, v: (f) => fmtN.format(f.unidades) }],
      r.filas, ['No hay recetas en este mes', 'El reporte se llena cuando las promotoras registran recetas.']));
};
V.inventario = async () => {
  const [fs, ms] = await Promise.all([api('GET', '/api/catalogo/farmacias'), medicamentos()]);
  const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar inventario');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Unidades disponibles en farmacia'),
    fs.items.length ? null : h('div', { class: 'aviso' }, 'Primero agrega farmacias en Catálogo.'),
    h('div', { class: 'form-fila' },
      campo('farmaciaId', 'Farmacia', { options: fs.items.map((x) => ({ value: x.id, label: `${x.nombre}, ${x.municipio}` })) }),
      campo('medicamentoId', 'Medicamento', { options: ms.map((m) => ({ value: m.id, label: m.nombre })) }),
      campo('unidades', 'Unidades disponibles', { type: 'number', min: 0, step: 1, inputmode: 'numeric' }),
      campo('fechaCorte', 'Fecha del conteo', { type: 'date', value: hoy(), max: hoy() })),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(f, b, () => api('POST', '/api/inventario', { farmaciaId: f.farmaciaId.value, medicamentoId: f.medicamentoId.value, unidades: Number(f.unidades.value), fechaCorte: f.fechaCorte.value }));
    if (r) { estado(f.querySelector('.aviso:last-of-type') ?? f.appendChild(h('div', { class: 'aviso' })), 'ok', 'Inventario registrado.'); f.unidades.value = ''; }
  });
  // Cargar ventas por archivo: plantilla de Excel, o factura en PDF / foto leída con inteligencia artificial.
  const mes = hoy().slice(0, 7);
  const [{ ia }, cargadas] = await Promise.all([api('GET', '/api/ventas/estado').catch(() => ({ ia: false })), api('GET', `/api/ventas?mes=${mes}`).then((x) => x.items).catch(() => [])]);
  const vistaPrevia = h('div', { 'aria-live': 'polite' });
  const bLeer = h('button', { class: 'btn', type: 'submit' }, 'Leer archivo');
  const fv = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Cargar lo que se vendió a cada farmacia'),
    h('p', { class: 'hint' }, ia
      ? 'Sube la plantilla de Excel, o la factura o el reporte en PDF, Excel o foto: la plataforma lo lee con inteligencia artificial. Antes de guardar verás cada línea para revisarla. Al guardar, el inventario de cada farmacia sube con las unidades vendidas.'
      : 'Sube la plantilla de Excel con las ventas. Antes de guardar verás cada línea para revisarla. Al guardar, el inventario de cada farmacia sube con las unidades vendidas. La lectura de facturas en PDF o fotos se activa cuando la clave de inteligencia artificial esté configurada en el servidor.'),
    h('div', { class: 'form-fila' }, campo('archivoVentas', 'Archivo', { type: 'file', accept: ia ? '.xlsx,.csv,application/pdf,image/jpeg,image/png,image/webp' : '.xlsx,.csv' }, ia ? '(Excel, CSV, PDF o foto; hasta 6 MB)' : '(Excel o CSV; hasta 6 MB)')),
    h('div', { class: 'acciones' }, bLeer, h('a', { class: 'btn-sec', href: 'assets/plantillas/ventas.xlsx', download: 'plantilla-ventas-fersuaz.xlsx' }, 'Descargar plantilla')), vistaPrevia);
  fv.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fv.archivoVentas.files[0];
    const r = await enviar(fv, bLeer, async () => {
      if (!file) throw new ApiError(422, { error: 'Elige el archivo.', fields: { archivoVentas: 'Elige el archivo.' } });
      if (file.size > 6 * 1024 * 1024) throw new ApiError(413, { error: 'El archivo no puede pasar de 6 MB.', fields: { archivoVentas: 'Archivo demasiado grande.' } });
      bLeer.textContent = /pdf|image/.test(file.type) ? 'Leyendo con inteligencia artificial…' : 'Leyendo…';
      return api('POST', '/api/ventas/leer', { archivo: { nombre: file.name, tipo: file.type, base64: await archivoB64(file) } });
    });
    bLeer.textContent = 'Leer archivo';
    if (r) pintarVistaPrevia(r);
  });
  function pintarVistaPrevia(r) {
    const filas = r.filas.map((x) => ({ ...x, incluir: true }));
    const sel = (x, k, ops, etiqueta) => {
      const s = h('select', { 'aria-label': `${etiqueta}, línea ${x.n}` }, h('option', { value: '' }, `Elige ${k === 'farmaciaId' ? 'la farmacia' : 'el medicamento'}`),
        ...ops.map((o) => h('option', { value: o.id, selected: o.id === x[k] }, k === 'farmaciaId' ? `${o.nombre}, ${o.municipio}` : o.nombre)),
        // Debajo de las sugerencias, toda la lista (se abre con buscador), por si la correcta no salió sugerida.
        ...(k === 'farmaciaId' ? fs.items.map((o) => ({ id: o.id, txt: `${o.nombre}, ${o.municipio}` })) : ms.map((o) => ({ id: o.id, txt: `${o.nombre}${o.presentacion ? ` ${o.presentacion}` : ''}` })))
          .filter((o) => !ops.some((p) => p.id === o.id)).map((o) => h('option', { value: o.id }, o.txt)));
      s.addEventListener('change', () => { x[k] = s.value || null; contar(); });
      return s;
    };
    const num = (x, k, etiqueta, paso) => { const i = h('input', { type: 'number', min: 0, step: paso, value: x[k] ?? '', 'aria-label': `${etiqueta}, línea ${x.n}` }); i.addEventListener('input', () => { x[k] = i.value === '' ? null : Number(i.value); contar(); }); return i; };
    const fechaIn = (x) => { const i = h('input', { type: 'date', value: x.fecha ?? '', max: hoy(), 'aria-label': `Fecha, línea ${x.n}` }); i.addEventListener('input', () => { x.fecha = i.value || null; contar(); }); return i; };
    const lista = (x) => x.incluir && x.farmaciaId && x.medicamentoId && Number.isInteger(x.unidades) && x.unidades > 0 && x.fecha;
    const bGuardar = h('button', { class: 'btn', type: 'button' }, 'Guardar');
    const resumen = h('p', { class: 'hint' });
    const contar = () => { const n = filas.filter(lista).length; const fuera = filas.filter((x) => x.incluir && !lista(x)).length; bGuardar.textContent = `Guardar ${fmtN.format(n)} línea(s)`; bGuardar.disabled = !n || fuera > 0; resumen.textContent = fuera ? `${fuera} línea(s) incluidas tienen datos por completar: corrígelas o quítalas.` : `${n} línea(s) listas.`; };
    const tablaV = h('div', { class: 'tabla-montos ventas-previa' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Incluir', 'En el archivo', 'Farmacia', 'Medicamento', 'Unidades', 'Precio RD$', 'Fecha', 'Factura'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, filas.map((x) => {
        const inc = h('input', { type: 'checkbox', checked: true, 'aria-label': `Incluir línea ${x.n}` }); inc.addEventListener('change', () => { x.incluir = inc.checked; tr.classList.toggle('fila-fuera', !inc.checked); contar(); });
        const tr = h('tr', { class: x.avisos.length ? 'fila-revisar' : null }, h('td', {}, inc),
          h('td', {}, h('small', {}, `${x.original.farmacia}${x.original.municipio ? `, ${x.original.municipio}` : ''}`), h('small', { style: 'display:block' }, x.original.medicamento), x.avisos.length ? h('small', { class: 'precio-subio' }, x.avisos.join('. ')) : null),
          h('td', {}, sel(x, 'farmaciaId', x.farmaciaOpciones, 'Farmacia')), h('td', {}, sel(x, 'medicamentoId', x.medicamentoOpciones, 'Medicamento')),
          h('td', {}, num(x, 'unidades', 'Unidades', 1)), h('td', {}, num(x, 'precioUnitario', 'Precio', 0.01)), h('td', {}, fechaIn(x)), h('td', {}, h('small', {}, x.factura ?? '')));
        return tr;
      }))));
    bGuardar.addEventListener('click', async () => {
      bGuardar.disabled = true;
      try {
        const out = await api('POST', '/api/ventas/confirmar', { filas: filas.filter(lista).map(({ farmaciaId, medicamentoId, unidades, precioUnitario, fecha, factura }) => ({ farmaciaId, medicamentoId, unidades, precioUnitario, fecha, factura })), archivo: r.archivo, fuente: r.fuente });
        vistaPrevia.replaceChildren(h('div', { class: 'aviso ok' }, `Se guardaron ${fmtN.format(out.insertadas)} línea(s): ${fmtN.format(out.unidades)} unidades por ${RD(out.monto)}. Se actualizó el inventario de ${fmtN.format(out.inventarioActualizado)} producto(s) en farmacias.${out.duplicadas ? ` ${out.duplicadas} línea(s) ya estaban cargadas y no se repitieron.` : ''}`),
          h('div', { class: 'acciones' }, h('button', { class: 'btn-sec', type: 'button', onclick: () => router() }, 'Ver ventas cargadas')));
      } catch (e2) { alert(e2.fields ? Object.values(e2.fields).join(' ') : e2.message); bGuardar.disabled = false; }
    });
    vistaPrevia.replaceChildren(...[h('h3', { style: 'margin:1.5rem 0 .25rem' }, `Vista previa: ${fmtN.format(filas.length)} línea(s) ${r.fuente === 'ia' ? 'leídas con inteligencia artificial' : 'de la plantilla'}`),
      r.fuente === 'ia' ? h('p', { class: 'hint' }, 'Revisa cada línea: la inteligencia artificial puede equivocarse con letras poco claras. Las marcadas en rojo necesitan tu ayuda.') : null,
      r.notas ? h('div', { class: 'aviso' }, `Nota de la lectura: ${r.notas}`) : null, tablaV, resumen, h('div', { class: 'acciones' }, bGuardar)].filter(Boolean));
    contar();
  }
  const tablaCargadas = tabla([
    { t: 'Fecha', v: (x) => fecha(x.fecha) }, { t: 'Farmacia', v: (x) => [x.farmacia, h('small', { style: 'display:block;color:var(--texto-2)' }, x.municipio)] }, { t: 'Medicamento', v: (x) => x.medicamento },
    { t: 'Unidades', num: true, v: (x) => fmtN.format(x.unidades) }, { t: 'Monto', num: true, v: (x) => x.monto != null ? RD(x.monto) : '' }, { t: 'Factura', v: (x) => x.factura ?? '' },
    { t: 'Origen', v: (x) => x.fuente === 'ia' ? 'Leído con IA' : 'Plantilla' }], cargadas, ['Aún no hay ventas cargadas este mes', 'Sube la plantilla o una factura en "Cargar ventas".']);
  return vistaS('inventario', ['ventas', 'conteo', 'cargadas'], 'Inventario en farmacias', 'Lo vendido a cada farmacia y sus conteos. Las alertas comparan las recetas de la zona con el inventario de cada farmacia.',
    S('ventas', 'Cargar ventas', fv), S('conteo', 'Conteo manual', f), S('cargadas', `Ventas del mes (${fmtN.format(cargadas.length)})`, tablaCargadas));
};
V.solicitudes = async () => {
  const { pending } = await api('GET', '/api/auth/pending');
  const decidir = async (u, ok) => {
    if (!(await confirmar(ok ? 'Aprobar cuenta' : 'Rechazar cuenta', `${ok ? 'Aprobar' : 'Rechazar'} la solicitud de ${u.fullName} como ${ROLES[u.role]}.`, { okTexto: ok ? 'Aprobar cuenta' : 'Rechazar cuenta' }))) return;
    try { await api('POST', `/api/auth/requests/${u.id}/${ok ? 'aprobar' : 'rechazar'}`); } catch (e) { alert(e.message); }
    router();
  };
  const deps = await api('GET', '/api/usuarios/dependientes').then((x) => x.items).catch(() => []);
  const cuentas = await api('GET', '/api/banco/cuentas').then((x) => Object.fromEntries(x.items.map((c) => [c.usuarioId, c]))).catch(() => ({}));
  const ligar = async (d) => {
    const opciones = d.candidatas.length ? d.candidatas : [];
    const dlg = $('#dialogo'); $('#dialogo-titulo').textContent = `Farmacia de ${d.nombre}`;
    const sel = h('select', { id: 'dep-farm' }, h('option', { value: '' }, 'Elige la farmacia'), ...opciones.map((f) => h('option', { value: f.id }, `${f.nombre} (${f.municipio}, ${f.provincia})`)));
    const busc = h('input', { id: 'dep-busca', type: 'search', placeholder: 'Escribe parte del nombre' });
    let todas = null;
    busc.addEventListener('input', async () => {
      todas ??= (await api('GET', '/api/catalogo/farmacias')).items;
      const k = busc.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const xs = todas.filter((f) => f.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(k)).slice(0, 40);
      sel.replaceChildren(h('option', { value: '' }, xs.length ? 'Elige la farmacia' : 'Sin resultados'), ...xs.map((f) => h('option', { value: f.id }, `${f.nombre} (${f.municipio}, ${f.provincia})`)));
    });
    $('#dialogo-cuerpo').replaceChildren(h('p', { class: 'hint' }, `Escribió: ${d.escrita ?? 'sin farmacia'}${d.provinciaEscrita ? `, ${d.provinciaEscrita}` : ''}.`), h('label', { for: 'dep-busca', class: 'hint' }, 'Buscar en el catálogo'), busc, h('label', { for: 'dep-farm', class: 'hint', style: 'display:block;margin-top:.75rem' }, 'Farmacia'), sel);
    $('#dialogo-ok').textContent = 'Guardar'; dlg.showModal();
    const ok = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
    if (!ok || !sel.value) return;
    try { await api('POST', `/api/usuarios/${d.id}/farmacia`, { farmaciaId: sel.value }); } catch (e) { alert(e.message); }
    router();
  };
  const tablaDeps = tabla([
    { t: 'Dependiente', v: (d) => [d.nombre, d.escrita ? h('small', { style: 'display:block;color:var(--texto-2)' }, `Escribió: ${d.escrita}`) : null] },
    { t: 'Farmacia', v: (d) => d.farmacia ? [d.farmacia.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, [d.farmacia.sector, d.farmacia.municipio, d.farmacia.provincia].filter(Boolean).join(', '))] : h('span', { class: 'chip pendiente' }, 'Sin ligar') },
    { t: 'Cuenta de banco', v: (d) => cuentas[d.id] ? [cuentas[d.id].bancoNombre, h('small', { style: 'display:block;color:var(--texto-2)' }, `${cuentas[d.id].tipoNombre}, ${cuentas[d.id].numero}`)] : h('span', { class: 'chip pendiente' }, 'Sin cuenta') },
    { t: '', v: (d) => yo.role !== 'finanzas' ? h('button', { class: 'btn-sec btn-peq', onclick: () => ligar(d) }, d.farmacia ? 'Cambiar' : 'Ligar') : '' },
  ], deps, ['No hay dependientes activas', 'Aparecen aquí cuando se aprueban sus cuentas.']);
  return vistaS('solicitudes', ['pendientes', 'dependientes'], 'Solicitudes de cuenta', 'Solo puedes decidir las solicitudes que tu rol permite aprobar. Liga a cada dependiente con su farmacia del catálogo para ubicarla por provincia, municipio y sector.', S('dependientes', `Dependientes y su farmacia (${fmtN.format(deps.length)})`, tablaDeps), S('pendientes', `Pendientes (${fmtN.format(pending.length)})`, tabla([
    { t: 'Nombre', v: (u) => [u.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, u.email)] },
    { t: 'Rol', v: (u) => `${ROLES[u.role]}${u.position ? `, ${u.position}` : ''}` }, { t: 'Farmacia', v: (u) => u.pharmacy ? `${u.pharmacy}, ${u.province}` : '' },
    { t: 'Fecha', v: (u) => fecha(u.createdAt) },
    { t: '', v: (u) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' }, h('button', { class: 'btn btn-peq', onclick: () => decidir(u, true) }, 'Aprobar'), h('button', { class: 'btn-sec btn-peq', onclick: () => decidir(u, false) }, 'Rechazar')) },
  ], pending, ['No hay solicitudes pendientes', 'Las nuevas cuentas aparecerán aquí.'])));
};
V.pronto = async () => vista('Tu panel', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay módulos para tu rol todavía'), 'Pide a la gerencia que revise los permisos de tu cuenta.'));

// ---------------------------------------------------------------- vistas: rutas y viáticos
const CAT = { combustible: 'Combustible', transporte: 'Transporte', alimentacion: 'Alimentación', hospedaje: 'Hospedaje', peajes: 'Peajes', estacionamiento: 'Estacionamiento', otros: 'Otros' };
const EST_P = { sin_solicitud: 'Sin solicitud', borrador: 'Borrador', solicitado: 'Solicitado', aprobado: 'Aprobado', rechazado: 'Rechazado', desembolsado: 'Desembolsado', liquidado: 'Liquidado', planificada: 'Planificada', realizada: 'Realizada', cancelada: 'Cancelada', propuesto: 'Por autorizar', reportado: 'Por revisar', aceptado: 'Aceptado' };
const chipP = (e) => h('span', { class: `chip ${({ aprobado: 'aprobado', liquidado: 'aprobado', realizada: 'aprobado', aceptado: 'aprobado', solicitado: 'pendiente', propuesto: 'pendiente', reportado: 'pendiente', desembolsado: 'ok', rechazado: 'rechazado', cancelada: 'anulado' })[e] ?? ''}` }, EST_P[e] ?? e);
const mesDe = () => new URLSearchParams(location.hash.split('?')[1]).get('mes') || mesActual();
const archivoB64 = (file) => new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(file); });
function desglose(d, total) {
  return h('dl', { class: 'rejilla' }, ...Object.entries(CAT).map(([k, l]) => h('div', { class: 'cifra' }, h('dt', {}, l), h('dd', {}, RD(d[k] ?? 0)))),
    h('div', { class: 'cifra destacada' }, h('dt', {}, 'Total'), h('dd', {}, RD(total))));
}

/** "16 al 22 nov" para una semana del mes. */
function rangoSemana(w) {
  const d = (f) => Number(f.slice(8, 10));
  const m = new Date(`${w.hasta}T12:00:00Z`).toLocaleDateString('es-DO', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  return w.desde === w.hasta ? `${d(w.desde)} ${m}` : `${d(w.desde)} al ${d(w.hasta)} ${m}`;
}
/** Cuadro por semana y explicación de cada partida del presupuesto de viáticos. */
const COMB_NOMBRE = { gasolina_regular: 'gasolina regular', gasolina_premium: 'gasolina premium', gasoil_regular: 'gasoil regular', gasoil_optimo: 'gasoil óptimo', glp: 'GLP', electrico: 'electricidad' };
function detalleCalculo(c, partes = false) {
  const s = c.supuestos; if (!s?.semanas?.length) return null;
  const pub = !!s.transportePublico;
  const tot = (k) => s.semanas.reduce((x, w) => x + (w[k] || 0), 0);
  const filas = [...s.semanas, { total: true, desde: '', hasta: '', dias: tot('dias'), lugares: tot('lugares'), km: tot('km'), galones: tot('galones'), combustible: tot('combustible'), transporte: tot('transporte'), alimentacion: tot('alimentacion'), hospedaje: tot('hospedaje'), otros: tot('otros') }];
  filas.at(-1).total = filas.at(-1).combustible + filas.at(-1).transporte + filas.at(-1).alimentacion + filas.at(-1).hospedaje + filas.at(-1).otros;
  const b = (w, v) => (w.total === true || typeof w.total === 'number' && !w.n ? h('strong', {}, v) : v);
  const cols = [
    { t: 'Semana', v: (w) => w.n ? h('span', { class: 'sem-nombre' }, h('strong', {}, `Semana ${w.n}`), h('small', {}, rangoSemana(w))) : h('strong', {}, 'Total del mes') },
    { t: 'Días', num: true, v: (w) => b(w, fmtN.format(w.dias)) }, { t: 'Lugares', num: true, v: (w) => b(w, fmtN.format(w.lugares)) },
    ...(pub ? [{ t: 'Transporte', num: true, v: (w) => b(w, RD(w.transporte)) }] : [
      { t: 'Km', num: true, v: (w) => b(w, fmtN.format(w.km)) }, { t: 'Galones', num: true, v: (w) => b(w, fmtN.format(w.galones)) }, { t: 'Combustible', num: true, v: (w) => b(w, RD(w.combustible)) }]),
    { t: 'Comida', num: true, v: (w) => b(w, RD(w.alimentacion)) }, { t: 'Hotel', num: true, v: (w) => b(w, w.hospedaje ? RD(w.hospedaje) : '') },
    { t: 'Peajes y otros', num: true, v: (w) => b(w, w.otros ? RD(w.otros) : '') }, { t: 'Total', num: true, v: (w) => h('strong', {}, RD(w.n ? w.total : filas.at(-1).total)) },
  ];
  const precios = Object.entries(s.preciosUsados ?? {}).map(([desde, p]) => `${RD(p)} por galón (vigente desde ${fecha(desde)})`).join(' y ');
  const comb = COMB_NOMBRE[s.combustible];
  const como = pub ? [
    `Transporte: cada día cuenta como "dentro" si todos sus lugares están en su zona de trabajo (${RD(s.tarifas.transporteDentro)} por día) o "fuera" si visita un lugar fuera de su zona (${RD(s.tarifas.transporteFuera)} por día). Este mes: ${s.diasDentro} día(s) dentro y ${s.diasFuera} fuera.`,
    `Comida: ${RD(s.tarifas.comidaDentro)} por día dentro de su zona y ${RD(s.tarifas.comidaFuera)} por día fuera.`,
  ] : [
    `Kilómetros: ruta de cada día, ${s.kmTipo}, saliendo de su residencia, pasando por los lugares del día y regresando. Total del mes: ${fmtN.format(s.km)} km.`,
    s.reembolsoPorKm ? `Combustible: reembolso de ${RD(s.reembolsoPorKm)} por km recorrido.` : `Combustible: ${fmtN.format(s.km)} km ÷ ${fmtN.format(s.rendimiento ?? 0)} km por galón = ${fmtN.format(s.galones)} galones${comb ? ` de ${comb}` : ''}${precios ? `, a ${precios}` : ''}.`,
    s.comidaFuera != null && s.comidaFuera !== s.comidaDentro
      ? `Comida: ${s.diasComidaDentro} día(s) dentro de su zona × ${RD(s.comidaDentro)} y ${s.diasComidaFuera} día(s) fuera × ${RD(s.comidaFuera)}${s.comidaFuente === 'posicion' ? ` (montos de la posición ${s.posicion})` : s.comidaFuente === 'global' ? ' (monto global)' : ''}.`
      : `Comida: ${s.diasAlimentacion} día(s) de trabajo × ${RD(s.tarifaAlimentacion)} por día${s.comidaDesglose ? ` (desayuno ${RD(s.comidaDesglose.desayuno)} + almuerzo ${RD(s.comidaDesglose.almuerzo)} + cena ${RD(s.comidaDesglose.cena)})` : ''}.`,
  ];
  const FUENTE_NOCHE = { hotel: 'hotel elegido', verificado: 'hotel verificado', 'referencia-provincia': 'referencia de la provincia', 'referencia-global': 'referencia general' };
  const plan = (s.porDia ?? []).filter((d) => d.noche);
  const deJornada = (s.hospedajes ?? 0) - plan.length;
  if (s.desayunos?.noches) como.push(`Desayuno incluido en el hotel: ${s.desayunos.noches} noche(s), se rebajan ${RD(s.desayunos.descuento)} de la comida (${s.desayunos.porDia.map((d) => `${fecha(d.fecha)}${d.hotel ? ` en ${d.hotel}` : ''}: ${RD(d.descuento)}`).join('; ')}). Comida sin descuento: ${RD(s.comidaBruta)}.`);
  if (plan.length) como.push(`Hotel planificado: ${plan.length} noche(s) fuera del cronograma, ${RD(plan.reduce((x, d) => x + d.noche.precio, 0))}. ${plan.map((d) => `${fecha(d.fecha)} en ${d.noche.municipio ?? ''}: ${RD(d.noche.precio)}${d.noche.hotel ? ` (${d.noche.hotel})` : ''}, ${FUENTE_NOCHE[d.noche.fuente]}`).join('; ')}. Cuando crea la jornada de ese día, cuenta el hotel real.`);
  if (deJornada > 0) como.push(`Hotel en jornadas: ${deJornada} noche(s); solo cuentan las autorizadas por la gerencia.`);
  if (!plan.length && deJornada <= 0) como.push('Hotel: no aplica este mes. Se agrega cuando un día del cronograma está marcado "duerme fuera" o cuando una jornada necesita dormir fuera y la gerencia lo autoriza.');
  if (s.tope != null) como.push(`Tope mensual de ${pub ? 'transporte' : 'combustible'}: ${RD(s.tope)} (${s.topeFuente === 'representante' ? 'propio del representante' : 'global'}).${s.excedenteTope ? ` Lo calculado pasa el tope por ${RD(s.excedenteTope)}; se presupuesta el tope.` : ''}`);
  como.push(`Origen: ${s.diasCronograma ? `${s.diasCronograma} día(s) del cronograma aprobado` : ''}${s.diasCronograma && s.jornadas ? ' y ' : ''}${s.jornadas ? `${s.jornadas} jornada(s) creada(s)` : ''}. El salario no forma parte de los viáticos.`);
  const semana = h('div', { class: 'tarjeta' }, h('h2', {}, 'Por semana'), tabla(cols, filas, ['', '']));
  const explicacion = h('div', { class: 'tarjeta como-se-calcula' }, h('h2', {}, 'Cómo se calcula'), h('ul', {}, como.map((x) => h('li', {}, x))));
  return partes ? { semana, como: explicacion } : h('div', {}, semana, explicacion);
}

V.jornadas = async () => {
  const mes = mesDe();
  const cronId = param('cron');
  const [{ items }, { items: crons }] = await Promise.all([api('GET', `/api/viaticos/jornadas?mes=${mes}`), api('GET', `/api/cronogramas?mes=${mes}`)]);
  const accion = async (j, a) => {
    if (a === 'realizada') {
      const km = await confirmar('Marcar jornada realizada', `Escribe los km reales del ${fecha(j.fecha)} según el odómetro.`, { okTexto: 'Guardar', pedirMotivo: true });
      if (km == null) return; try { await api('POST', `/api/viaticos/jornadas/${j.id}/realizada`, { kmReales: Number(String(km).replace(',', '.')) }); } catch (e) { alert(e.message); }
    } else if (await confirmar('Cancelar jornada', `¿Cancelar la jornada del ${fecha(j.fecha)}? No contará en el presupuesto.`, { okTexto: 'Cancelar jornada' })) {
      try { await api('POST', `/api/viaticos/jornadas/${j.id}/cancelar`); } catch (e) { alert(e.message); }
    }
    router();
  };
  // Marcar qué lugares visitó: cada visita hecha cuenta para sus metas.
  const marcarVisitas = async (j) => {
    const d = $('#dialogo'); $('#dialogo-titulo').textContent = `Visitas del ${fecha(j.fecha)}`;
    const cajas = j.paradas.map((p, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'visita', value: i, checked: p.hecha === true }), h('span', {}, p.lugar, h('small', { style: 'display:block;color:var(--texto-2)' }, `${p.refTipo === 'farmacia' ? 'Farmacia' : 'Centro de salud'} · ${p.municipio ?? ''}`), p.medicos?.length ? h('small', { style: 'display:block;color:var(--celeste-texto)' }, `Médicos: ${p.medicos.map((m) => `${m.nombre}${m.especialidad ? ` (${m.especialidad})` : ''}`).join(', ')}`) : null)));
    $('#dialogo-cuerpo').replaceChildren(h('p', { class: 'hint' }, 'Marca los lugares que visitaste. Solo las visitas marcadas cuentan para tus metas del mes.'), h('div', { class: 'dialogo-checks' }, cajas));
    $('#dialogo-ok').textContent = 'Guardar visitas'; d.showModal();
    const ok = await new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
    if (!ok) return;
    accionPendiente = 'guardar visitas';
    try { await api('POST', `/api/viaticos/jornadas/${j.id}/visita`, { hechas: [...d.querySelectorAll('input[name=visita]:checked')].map((x) => Number(x.value)) }); } catch (e) { alert(e.message); }
    router();
  };
  const bloques = [];
  if (cronId) {
    const c = crons.find((x) => x.id === cronId);
    const r = await api('GET', `/api/cronogramas/${cronId}/ruta`);
    const boton = h('button', { class: 'btn', type: 'submit' }, 'Crear mi jornada');
    const fin = r.paradas.at(-1);
    const [{ items: hotelesProv }, { item: rec }] = await Promise.all([
      api('GET', `/api/hoteles?provincia=${encodeURIComponent(fin.provincia)}`).catch(() => ({ items: [] })),
      api('GET', `/api/hoteles/recomendado?provincia=${encodeURIComponent(fin.provincia)}&municipio=${encodeURIComponent(fin.municipio)}`).catch(() => ({ item: null }))]);
    const aptos = hotelesProv.filter((x) => x.cumple && x.precioNoche);
    // Hotel: el aprobado por la gerencia, con su precio. Cambiarlo pide la razón; otro precio pide el comprobante.
    const otros = aptos.filter((x) => x.id !== rec?.hotel?.id);
    const opcion = (v, titulo, texto, marcado) => h('label', {}, h('input', { type: 'radio', name: 'hotelModo', value: v, checked: marcado }), h('span', {}, h('strong', {}, titulo), h('small', {}, texto)));
    const modos = h('fieldset', { class: 'modo-montos hotel-modos' }, h('legend', { class: 'sr-only' }, 'Hotel'),
      rec ? opcion('aprobado', 'Usar el hotel aprobado', 'Queda autorizado al guardar la jornada.', true) : null,
      opcion('otro', rec ? 'Usar otro hotel' : 'Proponer un hotel', rec ? 'Explica por qué; la gerencia lo revisa.' : 'Aún no hay hotel aprobado aquí; la gerencia lo revisa.', !rec));
    const tarjetaRec = rec ? h('div', { class: 'hotel-aprobado' },
      h('span', { class: 'hotel-sello' }, 'Aprobado por la gerencia'),
      h('strong', {}, rec.hotel.nombre), h('span', {}, `${rec.hotel.municipio}, ${rec.hotel.provincia}${rec.hotel.telefono ? `. Tel. ${rec.hotel.telefono}` : ''}`),
      h('span', { class: 'hotel-precio' }, `${RD(rec.hotel.precioNoche)} por noche`),
      h('small', {}, `El más económico ${rec.alcance === 'municipio' ? `en ${fin.municipio}` : `de ${fin.provincia}`} que cumple servicios básicos, aire, agua, cama cómoda, higiene, parqueo y seguridad.`)) : null;
    const precioCaja = h('input', { type: 'checkbox', name: 'precioDistinto' });
    const precioDistinto = h('div', { class: 'precio-distinto', hidden: !rec },
      h('label', { class: 'check' }, precioCaja, h('span', {}, 'El hotel me cobró un precio distinto')),
      h('div', { class: 'precio-campos', hidden: true },
        h('div', { class: 'form-fila' }, campo('hospedaje.tarifaCobrada', 'Precio cobrado por noche RD$', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal' }),
          campo('hospedaje.comprobante', 'Comprobante (voucher)', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', capture: 'environment' }, '(foto o PDF, hasta 5 MB)')),
        h('p', { class: 'hint' }, 'La gerencia recibe un aviso para llamar al hotel y aprobar o no el precio. Así queda registro si el hotel subió el precio.')));
    precioCaja.addEventListener('change', () => { precioDistinto.querySelector('.precio-campos').hidden = !precioCaja.checked; sincronizarRazon(); });
    const selOtro = campo('hospedaje.hotelId', 'Hotel', { options: [...otros.map((x) => ({ value: x.id, label: `${x.nombre} (${x.municipio}), ${RD(x.precioNoche)} por noche` })), { value: 'manual', label: 'Otro que no está en la lista (lo escribo)' }], value: otros.length ? '' : 'manual', placeholder: 'Elige el hotel' });
    const manual = h('div', { class: 'form-fila', hidden: !!otros.length }, campo('hospedaje.hotel', 'Nombre del hotel'), campo('hospedaje.tarifaNoche', 'Tarifa por noche RD$', { type: 'number', min: 0, step: 0.01 }));
    selOtro.querySelector('select').addEventListener('change', (e) => { manual.hidden = e.target.value !== 'manual'; });
    const bloqueOtro = h('div', { class: 'hotel-otro', hidden: !!rec }, selOtro, manual);
    const razon = campo('hospedaje.motivoCambio', 'Razón del cambio', { placeholder: 'Ejemplo: el hotel aprobado estaba lleno' });
    const sincronizarRazon = () => {
      const modo = modos.querySelector('input:checked')?.value;
      razon.hidden = !(modo === 'otro' || precioCaja.checked);
      razon.querySelector('label').firstChild.textContent = precioCaja.checked && modo !== 'otro' ? 'Razón del precio distinto' : rec ? 'Razón del cambio' : 'Motivo del hospedaje';
    };
    modos.addEventListener('change', () => {
      const modo = modos.querySelector('input:checked').value;
      bloqueOtro.hidden = modo !== 'otro'; precioDistinto.hidden = modo !== 'aprobado';
      if (modo !== 'aprobado') { precioCaja.checked = false; precioDistinto.querySelector('.precio-campos').hidden = true; }
      sincronizarRazon();
    });
    sincronizarRazon();
    const hosp = h('details', { class: 'tarjeta hotel-jornada', style: 'background:var(--canvas)', open: c?.duermeFuera === true }, h('summary', {}, c?.duermeFuera ? `La gerencia programó que este día duermes fuera${rec ? `. Hotel aprobado: ${rec.hotel.nombre}, ${RD(rec.hotel.precioNoche)} por noche` : ''}` : rec ? `¿Duermes fuera? Hotel aprobado: ${rec.hotel.nombre}, ${RD(rec.hotel.precioNoche)} por noche` : '¿Necesitas hotel? La gerencia debe autorizarlo'),
      tarjetaRec, modos, bloqueOtro, precioDistinto,
      h('div', { class: 'form-fila' }, campo('hospedaje.noches', 'Noches', { type: 'number', min: 1, step: 1, inputmode: 'numeric', value: 1 }), campo('hospedaje.cargos', 'Impuestos y cargos RD$', { type: 'number', min: 0, step: 0.01, value: 0 })),
      razon);
    const form = h('form', { class: 'tarjeta', novalidate: true },
      h('h2', {}, `Ruta del ${fecha(r.fecha)}`),
      h('p', { class: 'hint' }, r.optimizado ? 'Ordenada por distancia para que recorras menos y gastes menos combustible.' : r.km != null ? 'Ruta calculada por carretera.' : 'El mapa aún no está conectado: se respeta el orden del cronograma y escribes los km por carretera.'),
      h('ol', { class: 'ruta-orden' }, h('li', { class: 'casa' }, h('span', {}, 'Sales de tu residencia')), ...r.paradas.map((p) => h('li', {}, h('span', {}, h('strong', {}, p.lugar), h('small', { style: 'display:block;color:var(--texto-2)' }, `${p.municipio}, ${p.provincia}`), p.medicos?.length ? h('small', { style: 'display:block;color:var(--celeste-texto)' }, `${p.medicos.length} médico(s): ${p.medicos.map((m) => m.nombre).join(', ')}`) : null))), h('li', { class: 'casa' }, h('span', {}, 'Regresas a tu residencia'))),
      r.km != null ? h('dl', { class: 'rejilla', style: 'margin-top:1.25rem' }, h('div', { class: 'cifra' }, h('dt', {}, 'Recorrido por carretera'), h('dd', {}, `${fmtN.format(r.km)} km`)), r.minutos ? h('div', { class: 'cifra' }, h('dt', {}, 'Manejo aproximado'), h('dd', {}, `${fmtN.format(Math.round(r.minutos / 6) / 10)} h`)) : null)
        : h('div', { class: 'form-fila', style: 'margin-top:1rem' }, campo('kmEstimados', 'Km por carretera (ida, paradas y regreso)', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal' })),
      c?.nota ? h('p', { class: 'aviso' }, `Nota del administrador: ${c.nota}`) : null,
      h('div', { class: 'form-fila', style: 'margin-top:1rem' }, campo('peajes', 'Peajes RD$', { type: 'number', min: 0, step: 0.01, value: 0 }), campo('estacionamiento', 'Estacionamiento RD$', { type: 'number', min: 0, step: 0.01, value: 0 }), campo('otros', 'Otros RD$', { type: 'number', min: 0, step: 0.01, value: 0 })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'conAlimentacion', checked: true }), h('span', {}, 'Este día lleva gasto de alimentación')),
      hosp, h('div', { class: 'acciones' }, boton, h('a', { class: 'btn-sec', href: `#jornadas?mes=${mes}` }, 'Volver')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const g = (k) => form.elements[k]?.value;
      const body = { cronogramaId: cronId, kmEstimados: g('kmEstimados'), peajes: g('peajes'), estacionamiento: g('estacionamiento'), otros: g('otros'), conAlimentacion: form.conAlimentacion.checked,
        hospedaje: null };
      if (await enviar(form, boton, async () => {
        if (hosp.open && g('hospedaje.noches')) {
          const modo = form.querySelector('[name=hotelModo]:checked')?.value;
          const base = { noches: Number(g('hospedaje.noches')), cargos: g('hospedaje.cargos'), motivoCambio: g('hospedaje.motivoCambio') };
          if (modo === 'aprobado') {
            body.hospedaje = { ...base, hotelId: rec.hotel.id };
            if (precioCaja.checked) {
              const file = form.elements['hospedaje.comprobante'].files[0];
              if (file && file.size > 5 * 1024 * 1024) throw new ApiError(413, { error: 'El comprobante no puede pasar de 5 MB.', fields: { 'hospedaje.comprobante': 'Archivo demasiado grande.' } });
              body.hospedaje.tarifaCobrada = g('hospedaje.tarifaCobrada');
              body.hospedaje.comprobante = file ? { nombre: file.name, tipo: file.type, base64: await archivoB64(file) } : undefined;
            }
          } else if (g('hospedaje.hotelId') && g('hospedaje.hotelId') !== 'manual') body.hospedaje = { ...base, hotelId: g('hospedaje.hotelId') };
          else body.hospedaje = { ...base, tarifaNoche: g('hospedaje.tarifaNoche'), hotel: g('hospedaje.hotel'), motivo: g('hospedaje.motivoCambio') };
        }
        return api('POST', '/api/viaticos/jornadas', body);
      })) irA('jornadas', { mes });
    });
    return vista('Crear jornada', 'Los lugares y el día los programó el administrador. El sistema calcula el recorrido, el combustible y los viáticos.', form);
  }
  bloques.push(filtroMes(mes, 'jornadas', null, { futuro: true }),
    S('cronograma', `Mi cronograma (${fmtN.format(crons.length)})`, tabla([
      { t: 'Día', v: (c) => fecha(c.fecha) },
      { t: 'Lugares', v: (c) => c.lugares.map((l) => l.lugar).join(', ') },
      { t: 'Estado', v: (c) => c.jornadaId ? h('span', { class: 'chip aprobado' }, 'Jornada creada') : h('span', { class: 'chip pendiente' }, 'Por planificar') },
      { t: '', v: (c) => c.jornadaId ? '' : h('a', { class: 'btn btn-peq', href: `#jornadas?mes=${mes}&cron=${c.id}` }, 'Crear jornada') },
    ], crons, ['No tienes días programados este mes', 'El administrador programa tu cronograma; te llegará una notificación.'])),
    S('jornadas', `Jornadas del mes (${fmtN.format(items.length)})`, tabla([
      { t: 'Fecha', v: (j) => fecha(j.fecha) }, { t: 'Recorrido', v: (j) => j.paradas.map((p) => p.lugar).join(' → ') },
      { t: 'Km', num: true, v: (j) => [fmtN.format(j.kmEstimados), h('small', { style: 'display:block;color:var(--texto-2)' }, j.kmFuente === 'google' ? 'mapa' : 'manual'), j.kmReales != null ? h('small', { style: 'display:block' }, `real ${fmtN.format(j.kmReales)}`) : null] },
      { t: 'Hotel', v: (j) => j.hospedaje ? [`${j.hospedaje.noches} noche(s)`, ' ', chipP(j.hospedaje.estado)] : 'No' },
      { t: 'Estado', v: (j) => [chipP(j.estado), j.estado !== 'cancelada' && j.fecha <= hoy() ? h('small', { style: 'display:block;color:var(--texto-2);margin-top:.25rem' }, `${j.paradas.filter((p) => p.hecha).length} de ${j.paradas.length} visitados`) : null] },
      { t: '', v: (j) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
        j.estado !== 'cancelada' && j.fecha <= hoy() ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => marcarVisitas(j) }, 'Marcar visitas') : null,
        j.estado === 'planificada' && j.fecha <= hoy() ? h('button', { class: 'btn btn-peq', onclick: () => accion(j, 'realizada') }, 'Realizada') : null,
        j.estado === 'planificada' ? h('button', { class: 'btn-sec btn-peq', onclick: () => accion(j, 'cancelar') }, 'Cancelar') : null) },
    ], items, ['No hay jornadas en este mes', 'Crea tus jornadas desde tu cronograma.'])));
  return vistaS('jornadas', ['cronograma', 'jornadas'], 'Mis jornadas', 'Tu cronograma lo programa el administrador; desde cada día creas tu jornada y el sistema calcula la ruta y los viáticos.', ...bloques);
};

/** [1,2,3,4,5] → "lunes a viernes"; [1,3,5] → "lunes, miércoles y viernes". */
function nombresDias(ds = [1, 2, 3, 4, 5]) {
  const N = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const orden = [...ds].map(Number).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const pos = orden.map((d) => (d + 6) % 7);
  if (orden.length > 2 && pos.every((p, i) => i === 0 || p === pos[i - 1] + 1)) return `${N[orden[0]]} a ${N[orden.at(-1)]}`;
  const ns = orden.map((d) => N[d]);
  return ns.length > 1 ? `${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}` : ns[0] ?? '';
}
/**
 * Revisión de días antes de aprobar (propuesta automática o copia del mes anterior):
 * quitar días o lugares y marcar las noches que duerme fuera. Aprueba todo junto con el lote.
 */
function revisarDias(salida, diasIn, rep, mes, div, intro, avisos = [], alAprobar = null) {
  const etiqueta = (l) => (l.refTipo === 'farmacia' ? 'Farmacia' : div.tipos[l.tipo] ?? 'Centro');
  const quitados = new Set(); const diasFuera = new Set();
  const noches = new Set(diasIn.filter((d) => d.duermeFuera).map((d) => d.fecha));
  const aprobar = h('button', { class: 'btn', type: 'button' });
  const contar = () => {
    const n = diasIn.filter((d) => !diasFuera.has(d.fecha) && d.lugares.some((l) => !quitados.has(`${d.fecha}|${l.refId}`))).length;
    const nf = diasIn.filter((d) => !diasFuera.has(d.fecha) && noches.has(d.fecha)).length;
    aprobar.textContent = `Aprobar ${n} día(s)${nf ? `, ${nf} noche(s) fuera` : ''}`; aprobar.disabled = !n;
  };
  const tarjetas = diasIn.map((d) => {
    const lista = h('ol', { class: 'propuesta-lugares' }, d.lugares.map((l) => {
      const k = `${d.fecha}|${l.refId}`;
      const li = h('li', {}, h('span', {}, h('strong', {}, l.lugar), h('small', {}, `${etiqueta(l)} · ${l.municipio}${l.lat == null ? ' · sin ubicación' : ''}`),
        l.medicos?.length ? h('small', { class: 'propuesta-medicos' }, `${fmtN.format(l.medicos.length)} médico(s): ${l.medicos.map((m) => `${m.nombre}${m.especialidad ? ` (${m.especialidad})` : ''}`).join(', ')}`) : null),
        h('button', { class: 'btn-enlace', type: 'button', 'aria-label': `Quitar ${l.lugar}`, onclick: (ev) => {
          const fuera = !quitados.has(k); fuera ? quitados.add(k) : quitados.delete(k);
          li.classList.toggle('quitado', fuera); ev.target.textContent = fuera ? 'Volver a poner' : 'Quitar'; contar();
        } }, 'Quitar'));
      return li;
    }));
    const muns = [...new Set(d.lugares.map((l) => l.municipio))].join(', ');
    const art = h('article', { class: 'propuesta-dia' });
    const caja = h('input', { type: 'checkbox', checked: true, onchange: (ev) => { ev.target.checked ? diasFuera.delete(d.fecha) : diasFuera.add(d.fecha); art.classList.toggle('quitado', !ev.target.checked); contar(); } });
    const noche = h('label', { class: 'noche-fuera' }, h('input', { type: 'checkbox', checked: noches.has(d.fecha), onchange: (ev) => { ev.target.checked ? noches.add(d.fecha) : noches.delete(d.fecha); contar(); } }), h('span', {}, `Duerme fuera esta noche${d.lugares.at(-1) ? ` (${d.lugares.at(-1).municipio})` : ''}`));
    art.append(...[h('label', { class: 'propuesta-cabeza' }, caja, h('span', {}, h('strong', {}, fecha(d.fecha)), h('small', {}, `${d.desde ? `Copia del ${fecha(d.desde)} · ` : ''}${d.lugares.length} lugar(es) · ${muns}`))), lista, noche,
      d.quitados?.length ? h('small', { class: 'hint' }, `Ya no están activos: ${d.quitados.join(', ')}.`) : null].filter(Boolean));
    return art;
  });
  aprobar.addEventListener('click', async () => {
    const dias = diasIn.filter((d) => !diasFuera.has(d.fecha))
      .map((d) => ({ fecha: d.fecha, duermeFuera: noches.has(d.fecha), hotelId: noches.has(d.fecha) ? d.hotelId ?? null : null, lugares: d.lugares.filter((l) => !quitados.has(`${d.fecha}|${l.refId}`)).map(({ refTipo, refId, medicos }) => ({ refTipo, refId, ...(medicos?.length ? { medicos: medicos.map((m) => ({ medicoId: m.medicoId })) } : {}) })) }))
      .filter((d) => d.lugares.length);
    const nf = dias.filter((d) => d.duermeFuera).length;
    const nMed = dias.reduce((n, d) => n + d.lugares.reduce((x, l) => x + (l.medicos?.length ?? 0), 0), 0);
    if (!(await confirmar('Aprobar cronograma', `Se aprobarán ${dias.length} día(s) con ${dias.reduce((n, d) => n + d.lugares.length, 0)} lugares${nMed ? ` (${nMed} médicos)` : ''}${nf ? ` y ${nf} noche(s) fuera, que entran al presupuesto con el precio del hotel verificado o el de referencia` : ''}. El representante recibirá un aviso y podrá crear sus jornadas.`, { okTexto: 'Aprobar' }))) return;
    aprobar.disabled = true; aprobar.textContent = 'Aprobando…';
    try { await api('POST', '/api/cronogramas/lote', { representanteId: rep, dias }); if (alAprobar) alAprobar(); else irA('cronogramas', { mes, rep, sec: 'dias' }); }
    catch (err) { const a = h('div', { role: 'status' }); estado(a, 'error', err.message); salida.prepend(a); contar(); }
  });
  contar();
  salida.replaceChildren(intro, ...avisos.map((t) => h('div', { class: 'aviso' }, t)), h('div', { class: 'propuesta' }, tarjetas), h('div', { class: 'acciones' }, aprobar));
}

/** Copiar el cronograma del mes anterior: mismos lugares y noches fuera, en el mismo día de la semana. */
function copiarMes(rep, mes, div, alAprobar = null) {
  const b = h('button', { class: 'btn', type: 'submit' }, 'Copiar del mes anterior');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Copiar el mes anterior'),
    h('p', { class: 'hint' }, 'Como cada representante repite su ruta cada mes, copia los días aprobados del mes anterior al mismo día de la semana (el 2.º martes pasa al 2.º martes), con sus lugares y sus noches fuera. Revisas y apruebas; nada se guarda antes.'),
    h('div', { class: 'acciones' }, b), salida);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(f, b, () => api('POST', '/api/cronogramas/copiar-mes-anterior', { representanteId: rep, mes }));
    if (!r) return;
    const p = r.item;
    const avisos = p.omitidos.length ? [`${fmtN.format(p.omitidos.length)} día(s) no se copian: ${p.omitidos.map((o) => `${fecha(o.desde)} (${o.razon.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`] : [];
    if (!p.dias.length) { salida.replaceChildren(...avisos.map((t) => h('div', { class: 'aviso' }, t)), h('div', { class: 'tarjeta vacio', style: 'margin-top:1rem' }, h('strong', {}, 'No hay días para copiar'), 'Ya están programados o ya pasaron.')); return; }
    revisarDias(salida, p.dias, rep, mes, div, h('p', { class: 'hint', style: 'margin-top:1rem' }, `${fmtN.format(p.resumen.copiados)} de ${fmtN.format(p.resumen.origen)} día(s) de ${p.anterior} copiados${p.resumen.nochesFuera ? `, ${fmtN.format(p.resumen.nochesFuera)} con noche fuera` : ''}.`), avisos, alAprobar);
  });
  return f;
}

/** Propuesta automática del mes (solo administrador): el sistema reparte los lugares de la zona; el admin ajusta y aprueba. */
async function propuestaMes(rep, mes, div, alAprobar = null, posicion = null) {
  const vpd = await api('GET', '/api/cronogramas/visitas-por-dia').then((x) => x.item).catch(() => null);
  const n0 = (posicion && vpd?.porPosicion?.[posicion]) || vpd?.predeterminado || 8;
  const cart = ['Visitador', 'PVC'].includes(posicion) ? await api('GET', `/api/territorio/zonas/${rep}/cartera`).then((x) => x.item).catch(() => null) : null;
  const conMed = !!cart?.medicos?.length; const esPVC = posicion === 'PVC';
  const nF0 = esPVC ? cart?.visitas?.farmacias ?? Math.floor(n0 / 2) : 0;
  const nM0 = cart?.visitas?.medicos ?? (esPVC ? Math.max(n0 - nF0, 0) : n0);
  const fpd = conMed ? h('div', { class: 'form-fila' }, campo('porDia', 'Médicos por día', { type: 'number', min: 0, max: 40, step: 1, value: nM0, inputmode: 'numeric' }, `(de su cartera de ${fmtN.format(cart.medicos.length)})`),
    esPVC ? campo('farmaciasPorDia', 'Farmacias por día', { type: 'number', min: 0, max: 15, step: 1, value: nF0, inputmode: 'numeric' }) : null)
    : campo('porDia', 'Visitas por día', { type: 'number', min: 1, max: 15, step: 1, value: n0, inputmode: 'numeric' }, posicion ? `(${posicion}: ${n0}${vpd?.porPosicion?.[posicion] ? ', configurado' : ', predeterminado'})` : '');
  // Días de la semana que trabaja (por defecto, lunes a viernes) y fechas que no trabaja
  const SEMANA = [[1, 'Lun', 'lunes'], [2, 'Mar', 'martes'], [3, 'Mié', 'miércoles'], [4, 'Jue', 'jueves'], [5, 'Vie', 'viernes'], [6, 'Sáb', 'sábado'], [0, 'Dom', 'domingo']];
  const sab = h('fieldset', { class: 'dias-semana' }, h('legend', {}, 'Días laborables'),
    h('div', { class: 'dias-chips' }, SEMANA.map(([n, c, l]) => h('label', { title: l }, h('input', { type: 'checkbox', name: 'dia', value: n, checked: n >= 1 && n <= 5 }), h('span', {}, c)))),
    h('p', { class: 'hint' }, 'Por defecto, de lunes a viernes. Se cuentan desde hoy hasta el fin del mes.'));
  const [anioM, mesM] = mes.split('-').map(Number);
  const ultimo = `${mes}-${String(new Date(Date.UTC(anioM, mesM, 0)).getUTCDate()).padStart(2, '0')}`;
  const feriados = new Set();
  const listaFer = h('div', { class: 'feriados-lista', 'aria-live': 'polite' });
  const inFer = h('input', { type: 'date', id: 'feriado', min: mes === hoy().slice(0, 7) ? hoy() : `${mes}-01`, max: ultimo });
  const pintarFer = () => listaFer.replaceChildren(...[...feriados].sort().map((d) => h('span', { class: 'chip-fecha' }, fecha(d),
    h('button', { type: 'button', 'aria-label': `Quitar ${fecha(d)}`, onclick: () => { feriados.delete(d); pintarFer(); } }, '×'))));
  const bFer = h('button', { type: 'button', class: 'btn-sec' }, 'Agregar fecha');
  bFer.addEventListener('click', () => { if (inFer.value && inFer.value >= inFer.min && inFer.value <= ultimo) { feriados.add(inFer.value); inFer.value = ''; pintarFer(); } });
  const fer = h('div', { class: 'feriados' }, h('label', { for: 'feriado' }, 'Fechas que no trabaja ', h('small', {}, '(feriados, vacaciones; opcional)')),
    h('div', { class: 'feriados-fila' }, inFer, bFer), listaFer);
  const b = h('button', { class: 'btn', type: 'submit' }, 'Proponer el mes');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Propuesta automática del mes'),
    h('p', { class: 'hint' }, conMed ? `Reparte los médicos de su cartera por centro${cart.centroInicioId ? ', empezando por su centro de inicio' : ''} y sigue por cercanía${esPVC ? '; cada día lleva también farmacias de su zona' : ''}. Un centro puede llenar el día entero. Nada se guarda hasta que apruebes.` : 'El sistema reparte las farmacias, hospitales, clínicas y UNAP de su zona que aún no tienen día este mes, en los días laborables libres. Empieza por su municipio de residencia y agrupa por cercanía para gastar menos combustible. Nada se guarda hasta que apruebes.'),
    h('div', { class: 'form-fila' }, fpd), sab, fer, h('p', { class: 'error', dataset: { for: 'dias' } }), h('div', { class: 'acciones' }, b), salida);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(f, b, () => api('POST', '/api/cronogramas/propuesta', { representanteId: rep, mes, porDia: Number(f.porDia.value), ...(f.farmaciasPorDia ? { farmaciasPorDia: Number(f.farmaciasPorDia.value) } : {}), dias: [...f.querySelectorAll('[name=dia]:checked')].map((x) => Number(x.value)), feriados: [...feriados] }));
    if (!r) return;
    const p = r.item;
    if (!p.dias.length) {
      salida.replaceChildren(h('div', { class: 'tarjeta vacio', style: 'margin-top:1rem' }, h('strong', {}, p.resumen.lugares ? 'No quedan días laborables libres este mes' : 'No hay lugares pendientes'),
        p.resumen.lugares ? 'Elige el mes siguiente o anula algún día.' : 'Todos los lugares de su zona ya tienen día este mes, o su zona no tiene lugares registrados.'));
      return;
    }
    const avisos = [];
    if (p.sinDia.length) avisos.push(`${fmtN.format(p.sinDia.length)} lugar(es) no caben en los días libres de este mes; quedarán para el próximo.`);
    if (p.resumen.sinUbicacion) avisos.push(`${fmtN.format(p.resumen.sinUbicacion)} lugar(es) no tienen ubicación y van al final de su municipio.`);
    if (p.sinResidencia) avisos.push('Este representante no tiene perfil de viático: el recorrido no empieza en su residencia.');
    revisarDias(salida, p.dias, rep, mes, div, h('p', { class: 'hint', style: 'margin-top:1rem' }, `${fmtN.format(p.resumen.lugares)} lugares pendientes en ${fmtN.format(p.resumen.diasLibres)} día(s) laborable(s) libre(s) (${nombresDias(p.resumen.diasSemana)}, desde ${fecha(p.resumen.desde > `${mes}-01` ? p.resumen.desde : `${mes}-01`)}${p.resumen.feriados?.length ? `, sin ${p.resumen.feriados.length} fecha(s) quitada(s)` : ''}). Quita lo que no quieras y marca las noches que duerme fuera antes de aprobar; el orden exacto de cada día lo calcula el mapa cuando el representante crea su jornada.`), avisos, alAprobar);
  });
  return f;
}

V.cronogramas = async () => {
  const mes = mesDe(); const rep = param('rep') || '';
  const [{ items: reps }, div] = await Promise.all([api('GET', '/api/viaticos/representantes'), division()]);
  const esAdmin = yo.role === 'administrador';
  const selRep = campo('rep', 'Representante', { options: reps.map((r) => ({ value: r.id, label: `${r.fullName} (${r.position ?? ''})` })), value: rep, placeholder: 'Elige el representante' });
  selRep.querySelector('select').addEventListener('change', (e) => irA('cronogramas', { mes, rep: e.target.value }));
  const bloques = [h('div', { class: 'form-fila' }, selRep, filtroMes(mes, 'cronogramas', () => `rep=${rep}`, { futuro: true }))];
  const visitas = ES_GER() ? S('visitas', 'Visitas por día', await formVisitasPorDia()) : null;
  if (!rep) return vistaS('cronogramas', ['visitas'], 'Cronogramas', 'Elige un representante para ver y programar sus días.', ...bloques, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Elige un representante'), 'Verás sus días, la propuesta automática y la copia del mes anterior.'), visitas);
  const [{ item: zona }, { items: crons }, lz] = await Promise.all([api('GET', `/api/territorio/zonas/${rep}`), api('GET', `/api/cronogramas?representanteId=${rep}&mes=${mes}`), api('GET', `/api/territorio/zonas/${rep}/lugares`)]);
  if (esAdmin) {
    if (!zona.provincias.length) bloques.push(h('div', { class: 'aviso error' }, 'Este representante no tiene provincias asignadas. ', h('a', { href: `#representantes?rep=${rep}` }, 'Asignar provincias')));
    else {
      bloques.push(S('copiar', 'Copiar mes anterior', copiarMes(rep, mes, div)));
      bloques.push(S('propuesta', 'Propuesta automática', await propuestaMes(rep, mes, div, null, reps.find((x) => x.id === rep)?.position)));
      const lugares = [...lz.establecimientos.map((x) => ({ ...x, refTipo: 'establecimiento', etiqueta: div.tipos[x.tipo] })), ...lz.farmacias.map((x) => ({ ...x, refTipo: 'farmacia', etiqueta: 'Farmacia' }))]
        .sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
      // Días del mes como botones
      const [y, m] = mes.split('-').map(Number); const nDias = new Date(y, m, 0).getDate();
      const ocupados = new Set(crons.filter((c) => c.estado === 'aprobado').map((c) => c.fecha));
      const elegidos = new Set();
      const minimo = `${hoy().slice(0, 7)}-01`;
      const dias = h('div', { class: 'dias', role: 'group', 'aria-label': 'Días a programar' }, Array.from({ length: nDias }, (_, i) => {
        const f = `${mes}-${String(i + 1).padStart(2, '0')}`; const dow = new Date(`${f}T12:00:00`).toLocaleDateString('es-DO', { weekday: 'short' }).replace('.', '');
        const b = h('button', { type: 'button', 'aria-pressed': 'false', disabled: ocupados.has(f) || f < minimo, title: ocupados.has(f) ? 'Ya programado' : null, onclick: () => { const on = !elegidos.has(f); on ? elegidos.add(f) : elegidos.delete(f); b.setAttribute('aria-pressed', String(on)); } }, String(i + 1), h('small', {}, dow));
        return b;
      }));
      const fmun = campo('fmun', 'Filtrar lugares por municipio', { options: [...new Set(lugares.map((l) => l.municipio))].map((x) => ({ value: x, label: x })), placeholder: 'Todos los municipios' });
      const lista = h('div', { class: 'lugares-lista' }, lugares.map((l) => h('label', { dataset: { mun: l.municipio } }, h('input', { type: 'checkbox', name: 'lugar', value: `${l.refTipo}:${l.id}` }), h('span', {}, l.nombre, h('small', {}, `${l.etiqueta} · ${l.municipio}, ${l.provincia}`)))));
      fmun.querySelector('select').addEventListener('change', (e) => lista.querySelectorAll('label').forEach((x) => { x.hidden = !!e.target.value && x.dataset.mun !== e.target.value; }));
      const b = h('button', { class: 'btn', type: 'submit' }, 'Aprobar cronograma');
      const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Programar días a mano'),
        h('p', { class: 'hint' }, `Zona: ${zona.provincias.map((p) => (zona.municipios?.[p]?.length ? `${p} (${zona.municipios[p].join(', ')})` : p)).join('; ')}. Elige los días y los lugares; el orden de visita lo calcula el sistema por distancia.`),
        h('p', { class: 'error', dataset: { for: 'fechas' } }), dias,
        lugares.length ? [fmun, h('p', { class: 'error', dataset: { for: 'lugares' } }), lista] : h('div', { class: 'aviso' }, 'No hay lugares registrados en sus provincias. ', h('a', { href: '#establecimientos' }, 'Registrar establecimientos')),
        h('label', { class: 'noche-fuera' }, h('input', { type: 'checkbox', name: 'duermeFuera' }), h('span', {}, 'Duerme fuera la noche de cada día elegido')),
        campo('nota', 'Nota para el representante', {}, '(opcional)'), h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sel = [...f.querySelectorAll('[name=lugar]:checked')].map((x) => { const [refTipo, refId] = x.value.split(':'); return { refTipo, refId }; });
        if (await enviar(f, b, () => api('POST', '/api/cronogramas', { representanteId: rep, fechas: [...elegidos].sort(), lugares: sel, nota: f.nota.value, duermeFuera: f.duermeFuera.checked }))) irA('cronogramas', { mes, rep, sec: 'dias' });
      });
      bloques.push(S('mano', 'Programar a mano', f));
    }
  }
  const puedeNoche = ['administrador', 'gerencia'].includes(yo.role);
  const noche = async (c) => {
    const poner = !c.duermeFuera;
    if (!(await confirmar(poner ? 'Marcar noche fuera' : 'Quitar noche fuera', poner ? `El ${fecha(c.fecha)} duerme fuera. La noche entra al presupuesto con el hotel verificado de ${c.lugares.at(-1)?.municipio ?? 'la zona'} o el precio de referencia.` : `El ${fecha(c.fecha)} ya no duerme fuera; la noche sale del presupuesto.`, { okTexto: poner ? 'Marcar noche fuera' : 'Quitar noche fuera' }))) return;
    try { await api('POST', `/api/cronogramas/${c.id}/hotel`, { duermeFuera: poner }); } catch (e) { alert(e.message); } router();
  };
  const anular = async (c) => { const m = await confirmar('Anular cronograma', `El representante dejará de ver el día ${fecha(c.fecha)}. Escribe el motivo.`, { okTexto: 'Anular', pedirMotivo: true }); if (m == null) return; try { await api('POST', `/api/cronogramas/${c.id}/anular`, { motivo: m }); } catch (e) { alert(e.message); } router(); };
  bloques.push(S('dias', `Días programados (${fmtN.format(crons.filter((c) => c.estado === 'aprobado').length)})`,
    tabla([{ t: 'Día', v: (c) => fecha(c.fecha) }, { t: 'Lugares', v: (c) => c.lugares.map((l) => (l.medicos?.length ? `${l.lugar} (${l.medicos.length} médicos)` : l.lugar)).join(', ') },
      { t: 'Estado', v: (c) => c.estado === 'anulado' ? [h('span', { class: 'chip anulado' }, 'Anulado'), c.motivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, c.motivo) : null] : c.jornadaId ? h('span', { class: 'chip aprobado' }, 'Jornada creada') : h('span', { class: 'chip pendiente' }, 'Aprobado') },
      { t: 'Noche', v: (c) => (c.duermeFuera ? h('span', { class: 'chip noche' }, 'Duerme fuera') : '') },
      { t: '', v: (c) => c.estado === 'aprobado' && !c.jornadaId ? h('div', { class: 'acciones-fila' }, puedeNoche ? h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => noche(c) }, c.duermeFuera ? 'Quitar noche fuera' : 'Noche fuera') : null, esAdmin ? h('button', { class: 'btn-sec btn-peq', onclick: () => anular(c) }, 'Anular') : null) : '' }],
    crons, ['Sin días programados en este mes', esAdmin ? 'Usa la propuesta automática o programa a mano.' : 'El administrador aún no programa este mes.'])));
  bloques.push(visitas);
  return vistaS('cronogramas', ['copiar', 'propuesta', 'mano', 'dias', 'visitas'], 'Cronogramas', 'El administrador programa y aprueba los días y lugares de cada representante.', ...bloques);
};

// ---------------------------------------------------------------- campana de notificaciones
async function campana() {
  const btn = $('#campana'); const panel = $('#campana-panel'); const lista = $('#campana-lista'); const cuenta = $('#campana-cuenta');
  if (!btn) return;
  const pintar = async () => {
    let r; try { r = await api('GET', '/api/notificaciones?limite=30'); } catch { return; }
    cuenta.hidden = !r.sinLeer; cuenta.textContent = r.sinLeer > 99 ? '99+' : String(r.sinLeer);
    btn.setAttribute('aria-label', r.sinLeer ? `Notificaciones, ${r.sinLeer} sin leer` : 'Notificaciones');
    const relativo = (iso) => {
      const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (min < 1) return 'Ahora'; if (min < 60) return `Hace ${min} min`;
      const hrs = Math.round(min / 60); if (hrs < 24) return `Hace ${hrs} h`;
      return new Date(iso).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    };
    const ICONO_TIPO = { voucher: 'misVouchers', cronograma: 'cronogramas', viatico: 'viaticos', presupuesto: 'viaticos', solicitud: 'solicitudes', territorio: 'establecimientos', cuenta: 'solicitudes' };
    lista.replaceChildren(...(r.items.length ? r.items.map((n) => {
      const ic = icono(ICONO_TIPO[n.tipo] ?? 'inicio'); ic.classList.add('campana-icono');
      const cuerpo = [ic, h('span', { class: 'campana-texto' }, h('strong', {}, n.titulo), h('span', {}, n.texto), h('small', {}, relativo(n.createdAt))), n.leida ? null : h('span', { class: 'campana-punto', 'aria-label': 'Sin leer' })];
      const marcar = () => { if (!n.leida) api('POST', `/api/notificaciones/${n.id}/leer`).then(pintar).catch(() => {}); };
      return h('li', { class: n.leida ? '' : 'nueva' }, n.enlace ? h('a', { href: n.enlace, onclick: () => { marcar(); cerrar(); } }, cuerpo) : h('div', { onclick: marcar }, cuerpo));
    }) : [h('li', { class: 'campana-vacia' }, h('strong', {}, 'Estás al día'), 'Aquí verás aprobaciones, cronogramas y avisos del sistema.')]));
    $('#campana-todas').hidden = !r.sinLeer;
  };
  const cerrar = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', () => { const abrir = panel.hidden; panel.hidden = !abrir; btn.setAttribute('aria-expanded', String(abrir)); if (abrir) pintar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { cerrar(); btn.focus(); } });
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.campana')) cerrar(); });
  $('#campana-todas').addEventListener('click', async () => { try { await api('POST', '/api/notificaciones/leer-todas'); } catch {} pintar(); });
  await pintar();
  setInterval(() => { if (document.visibilityState === 'visible') pintar(); }, 60000);
}

/** Balance del mes: asignado, gastado y disponible, total y por partida. */
function balanceViaticos(p) {
  const r = p.resumen; if (r.aprobado == null) return null;
  const pct = r.aprobado ? Math.min(100, Math.round((r.reportado / r.aprobado) * 100)) : 0;
  const partidas = Object.entries(r.porCategoria ?? {}).filter(([, x]) => x.asignado || x.gastado);
  return h('div', { class: 'tarjeta balance' }, h('h2', {}, 'Tu balance de viáticos'),
    h('div', { class: 'balance-cifras' },
      h('div', {}, h('span', {}, 'Asignado'), h('strong', {}, RD(r.aprobado))),
      h('div', {}, h('span', {}, 'Gastos registrados'), h('strong', {}, RD(r.reportado))),
      h('div', { class: r.disponible < 0 ? 'balance-neg' : 'balance-disp' }, h('span', {}, r.disponible < 0 ? 'Te pasaste' : 'Disponible'), h('strong', {}, RD(Math.abs(r.disponible))))),
    h('div', { class: 'balance-barra', role: 'img', 'aria-label': `Usado ${pct}% del asignado` }, h('span', { style: `width:${pct}%` })),
    partidas.length ? h('table', { class: 'balance-partidas' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Partida'), h('th', { scope: 'col' }, 'Asignado'), h('th', { scope: 'col' }, 'Gastado'), h('th', { scope: 'col' }, 'Disponible'))),
      h('tbody', {}, partidas.map(([k, x]) => h('tr', {}, h('th', { scope: 'row' }, CAT[k]), h('td', {}, RD(x.asignado)), h('td', {}, RD(x.gastado)), h('td', { class: x.disponible < 0 ? 'balance-neg' : '' }, RD(x.disponible)))))) : null,
    h('p', { class: 'hint' }, 'Registra cada gasto con su comprobante a medida que cumples tus jornadas; el disponible baja solo. El salario no forma parte de los viáticos.'));
}
function bloqueResumen(p) {
  const r = p.resumen;
  return h('dl', { class: 'rejilla' },
    h('div', { class: 'cifra' }, h('dt', {}, 'Aprobado'), h('dd', {}, r.aprobado == null ? 'Pendiente' : RD(r.aprobado))),
    h('div', { class: 'cifra' }, h('dt', {}, 'Entregado'), h('dd', {}, RD(r.entregado))),
    h('div', { class: 'cifra' }, h('dt', {}, 'Justificado'), h('dd', {}, RD(r.justificado))),
    h('div', { class: 'cifra destacada' }, h('dt', {}, r.saldo > 0 ? 'Saldo por devolver' : r.saldo < 0 ? 'FERSUAZ te debe' : 'Saldo'), h('dd', {}, RD(Math.abs(r.saldo)))));
}
function tablaGastos(p, acciones) {
  return tabla([
    { t: 'Fecha', v: (g) => fecha(g.fecha) }, { t: 'Categoría', v: (g) => CAT[g.categoria] }, { t: 'Comprobante', v: (g) => [g.referencia, g.adjunto ? h('button', { class: 'enlace', style: 'display:block', onclick: () => verAdjunto(g.adjunto.clave) }, 'Ver archivo') : null] },
    { t: 'Monto', num: true, v: (g) => RD(g.monto) }, { t: 'Estado', v: (g) => [chipP(g.estado), g.motivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, g.motivo) : null] },
    ...(acciones ? [{ t: '', v: acciones }] : []),
  ], p.gastos ?? [], ['Aún no hay gastos reportados', 'Cada gasto con su comprobante aparecerá aquí.']);
}
V.presupuesto = async () => {
  const mes = mesDe();
  const { guardado: p, calculo: c } = await api('GET', `/api/viaticos/presupuesto?mes=${mes}`);
  const bloques = [filtroMes(mes, 'presupuesto', null, { futuro: true })];
  const editable = !p || ['borrador', 'rechazado'].includes(p.estado);
  if (p) bloques.push(h('div', { class: `aviso ${p.estado === 'rechazado' ? 'error' : 'ok'}` }, `Estado: ${EST_P[p.estado]}.${p.motivo ? ` Motivo: ${p.motivo}` : ''}${p.estado === 'liquidado' ? ` Resultado: ${p.liquidacion.resultado}.` : ''}`));
  if (editable) {
    if (c.faltan?.length) bloques.push(h('div', { class: 'aviso' }, h('strong', {}, 'Para solicitar falta: '), c.faltan.join(' ')));
    if (c.detalle) {
      for (const a of c.avisos ?? []) bloques.push(h('div', { class: 'aviso' }, a));
      bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Presupuesto calculado'), desglose(c.detalle, c.total),
        h('p', { class: 'hint', style: 'margin-top:1rem' }, c.supuestos.transportePublico ? `${c.supuestos.jornadas} jornadas en transporte público: ${c.supuestos.diasDentro} día(s) dentro de tu zona (transporte ${RD(c.supuestos.tarifas.transporteDentro)} y comida ${RD(c.supuestos.tarifas.comidaDentro)} por día) y ${c.supuestos.diasFuera} día(s) fuera (transporte ${RD(c.supuestos.tarifas.transporteFuera)} y comida ${RD(c.supuestos.tarifas.comidaFuera)} por día).${c.supuestos.tope != null ? ` Tope mensual: ${RD(c.supuestos.tope)}.` : ''} Tu salario no forma parte de este presupuesto.` : `${c.supuestos.jornadas} jornadas, ${fmtN.format(c.supuestos.km)} km (${c.supuestos.kmTipo}), ${c.supuestos.diasAlimentacion} días de alimentación a ${RD(c.supuestos.tarifaAlimentacion)}.${c.supuestos.reembolsoPorKm ? ` Reembolso de ${RD(c.supuestos.reembolsoPorKm)} por km.` : c.supuestos.galones ? ` ${fmtN.format(c.supuestos.galones)} galones a ${c.supuestos.rendimiento} km/gal.` : ''}${c.supuestos.tope != null ? ` Tope mensual de combustible: ${RD(c.supuestos.tope)} (${c.supuestos.topeFuente === 'representante' ? 'propio' : 'global'}).` : ''} Tu salario no forma parte de este presupuesto.`),
        detalleCalculo(c),
        h('div', { class: 'acciones' }, h('button', { class: 'btn', disabled: c.faltan?.length > 0, onclick: async (ev) => {
          if (!(await confirmar('Solicitar viáticos', `Enviar a la gerencia el presupuesto de ${mes} por ${RD(c.total)}. Después no podrás cambiar las jornadas del mes.`, { okTexto: 'Solicitar' }))) return;
          ev.target.disabled = true; try { await api('POST', '/api/viaticos/presupuesto/solicitar', { mes }); } catch (e) { alert(e.message); } router();
        } }, 'Solicitar viáticos'))));
    }
  } else {
    bloques.push(S('resumen', 'Presupuesto', balanceViaticos(p), h('div', { class: 'tarjeta' }, h('h2', {}, p.origen === 'asignado' ? 'Asignado por la gerencia' : 'Presupuesto solicitado'), desglose(p.detalle, p.total),
      p.ajustes?.length ? h('div', { style: 'margin-top:1rem' }, h('h3', { style: 'font-size:1rem' }, 'Ajustes'), h('ul', {}, p.ajustes.map((a) => h('li', {}, `${fecha(a.fecha)}: ${a.motivo}, ${RD(a.monto)}`)))) : null), bloqueResumen(p)));
    if (['aprobado', 'desembolsado'].includes(p.estado)) {
      const b = h('button', { class: 'btn', type: 'submit' }, 'Reportar gasto');
      const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Reportar un gasto'),
        h('div', { class: 'form-fila' }, campo('categoria', 'Categoría', { options: Object.entries(CAT).map(([value, label]) => ({ value, label })) }), campo('monto', 'Monto RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' }),
          campo('fecha', 'Fecha', { type: 'date', value: hoy().startsWith(mes) ? hoy() : `${mes}-01`, min: `${mes}-01`, max: hoy() }), campo('referencia', 'Factura o NCF')),
        campo('adjunto', 'Comprobante', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', capture: 'environment' }, '(foto o PDF, hasta 5 MB)'), campo('nota', 'Nota', {}, '(opcional)'),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await enviar(f, b, async () => {
          const file = f.adjunto.files[0];
          if (file && file.size > 5 * 1024 * 1024) throw new ApiError(413, { error: 'El comprobante no puede pasar de 5 MB.', fields: { adjunto: 'Archivo demasiado grande.' } });
          const adjunto = file ? { nombre: file.name, tipo: file.type, base64: await archivoB64(file) } : undefined;
          return api('POST', `/api/viaticos/presupuestos/${p.id}/gastos`, { categoria: f.categoria.value, monto: f.monto.value, fecha: f.fecha.value, referencia: f.referencia.value, nota: f.nota.value, adjunto });
        });
        if (r) router();
      });
      bloques.push(S('reportar', 'Reportar gasto', f));
    }
    bloques.push(S('gastos', `Gastos reportados (${fmtN.format(p.gastos?.length ?? 0)})`, tablaGastos(p)));
  }
  return vistaS('presupuesto', ['resumen', 'reportar', 'gastos'], 'Mi presupuesto de viáticos', 'Sale del cronograma que programó la gerencia: km de cada día, rendimiento de tu vehículo, precio del combustible, comida y hoteles. Registra tus gastos y verás cuánto te queda.', ...bloques);
};

V.perfiles = async () => {
  const [{ items: reps }, { items: combs }] = await Promise.all([api('GET', '/api/viaticos/representantes'), api('GET', '/api/viaticos/combustibles')]);
  const puede = ['administrador', 'gerencia', 'supervisor'].includes(yo.role);
  const id = new URLSearchParams(location.hash.split('?')[1]).get('rep');
  const lista = tabla([
    { t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] },
    { t: 'Residencia', v: (r) => r.perfil ? `${r.perfil.residencia.municipio}, ${r.perfil.residencia.provincia}` : 'Sin perfil' },
    { t: 'Vehículo', v: (r) => !r.perfil ? '' : r.perfil.vehiculo.propiedad === 'ninguno' ? 'Transporte público' : [`${r.perfil.vehiculo.propiedad === 'propio' ? 'Propio' : 'Asignado'}${r.perfil.vehiculo.marca ? `, ${[r.perfil.vehiculo.marca, r.perfil.vehiculo.modelo, r.perfil.vehiculo.anio].filter(Boolean).join(' ')}` : ''}`,
      h('small', { style: 'display:block;color:var(--texto-2)' }, `${combs.find((c) => c.value === r.perfil.vehiculo.combustible)?.label ?? ''}${r.perfil.vehiculo.rendimiento ? `, ${fmtN.format(r.perfil.vehiculo.rendimiento)} km/gal${r.perfil.vehiculo.rendimientoFuente === 'epa' ? ' (EPA)' : ''}` : ''}`)] },
    { t: 'Comida/día', num: true, v: (r) => !r.perfil ? '' : r.perfil.vehiculo.propiedad === 'ninguno' ? 'Por zona' : RD(r.perfil.tarifaAlimentacion) },
    { t: 'Tope combustible', num: true, v: (r) => r.perfil?.topeCombustible ? RD(r.perfil.topeCombustible) : r.perfil ? 'Global' : '' },
    { t: '', v: (r) => puede ? h('a', { class: 'btn-sec btn-peq', href: `#configurar?rep=${r.id}&paso=${r.perfil ? 'vehiculo' : 'zona'}` }, r.perfil ? 'Editar' : 'Configurar') : '' },
  ], reps, ['Aún no hay representantes activos', 'Aparecen aquí cuando se aprueban sus cuentas.']);
  if (!id || !puede) {
    const bloques = [];
    if (ES_GER()) {
      const { item: tg } = await api('GET', '/api/viaticos/tope-global');
      const bt = h('button', { class: 'btn', type: 'submit' }, 'Guardar tope');
      const ft = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Tope mensual global de combustible o transporte'),
        h('p', { class: 'hint' }, 'Se aplica a todos los representantes que no tengan un tope propio. El combustible se calcula por los km del cronograma; si pasa del tope, se presupuesta el tope y se avisa. Déjalo vacío para no usar tope.'),
        h('div', { class: 'form-fila' }, campo('monto', 'Tope mensual RD$', { type: 'number', min: 0, step: 0.01, value: tg.monto ?? '', inputmode: 'decimal' })), h('div', { class: 'acciones' }, bt));
      ft.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(ft, bt, () => api('POST', '/api/viaticos/tope-global', { monto: ft.monto.value || null }))) router(); });
      const { item: tp } = await api('GET', '/api/viaticos/tarifas-publico');
      const bp = h('button', { class: 'btn', type: 'submit' }, 'Guardar montos');
      const inp = (pre, k, val) => h('input', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal', name: `${pre}.${k}`, value: val ?? '', 'aria-label': `${TARIFAS_PUB.find((x) => x[0] === k)[1]}${pre === 'global' ? '' : `, ${pre}`}` });
      const cab = h('tr', {}, h('th', { scope: 'col' }, ''), ...TARIFAS_PUB.map(([, l]) => h('th', { scope: 'col' }, l)));
      // Visitador, Vendedor y PVC usan vehículo: su transporte sale solo de la ruta (km ÷ km por galón × precio).
      // Se puede escribir un monto para quien de esas posiciones no tenga vehículo.
      const CON_VEHICULO = ['Visitador', 'Vendedor', 'PVC'];
      const celdaPos = (pos, k) => {
        const i = inp(pos, k, tp.porPosicion?.[pos]?.[k]);
        if (CON_VEHICULO.includes(pos) && k.startsWith('transporte')) { i.placeholder = 'Automático por ruta'; i.title = 'Se calcula por los km de su ruta y su vehículo. Escribe un monto solo para quien no tenga vehículo.'; }
        return h('td', {}, i);
      };
      const tablaPos = h('div', { class: 'tabla-montos' }, h('table', {}, h('thead', {}, cab),
        h('tbody', {}, ...POSICIONES.map((pos) => h('tr', {}, h('th', { scope: 'row' }, pos, CON_VEHICULO.includes(pos) ? h('small', { style: 'display:block;font-weight:400;color:var(--texto-2)' }, 'Transporte por ruta') : null), ...TARIFAS_PUB.map(([k]) => celdaPos(pos, k)))))),
        h('p', { class: 'hint', style: 'margin-top:.75rem' }, 'Comida: aplica a todos los de la posición, tengan o no vehículo (dentro o fuera de su zona). Transporte de Visitador, Vendedor y PVC: automático por los km de su ruta, el rendimiento de su vehículo y el precio del combustible; escribe un monto solo si alguno no tiene vehículo.'));
      const filaGlobal = h('div', { class: 'tabla-montos' }, h('table', {}, h('thead', {}, cab.cloneNode(true)),
        h('tbody', {}, h('tr', {}, h('th', { scope: 'row' }, 'Todas las posiciones'), ...TARIFAS_PUB.map(([k]) => h('td', {}, inp('global', k, tp.global?.[k])))))));
      const modo = h('fieldset', { class: 'modo-montos' }, h('legend', {}, '¿Cómo se fijan los montos?'),
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'posicion', checked: tp.modo !== 'global' }), h('span', {}, h('strong', {}, 'Por posición'), h('small', {}, 'Un monto para Visitador, otro para Promotora, etc.'))),
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'global', checked: tp.modo === 'global' }), h('span', {}, h('strong', {}, 'Un monto para todos'), h('small', {}, 'El mismo monto sin importar la posición.'))));
      const pintarModo = () => { const g = modo.querySelector('input:checked').value === 'global'; tablaPos.hidden = g; filaGlobal.hidden = !g; };
      modo.addEventListener('change', pintarModo); pintarModo();
      const fp = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Comida y transporte: montos por día'),
        h('p', { class: 'hint' }, 'Comida por día para todos y transporte para quienes no tienen vehículo. Un día del cronograma cuenta como "dentro" si todas sus paradas están en su zona de trabajo (las provincias y municipios que le asignaste), aunque no viva allí; si va a un lugar fuera de su zona, cuenta como "fuera". Un representante puede tener montos propios en su perfil.'),
        modo, tablaPos, filaGlobal, h('div', { class: 'acciones' }, bp));
      const leer = (pre) => Object.fromEntries(TARIFAS_PUB.map(([k]) => [k, fp.elements[`${pre}.${k}`].value || null]));
      fp.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(fp, bp, () => api('POST', '/api/viaticos/tarifas-publico', { modo: fp.elements.modo.value, global: leer('global'), porPosicion: Object.fromEntries(POSICIONES.map((p) => [p, leer(p)])) }))) router(); });
      bloques.push(S('tope', 'Montos globales', fp, ft));
    }
    return vistaS('perfiles', ['lista', 'tope'], 'Perfiles de viático', 'Vehículo, residencia, tarifa y tope de cada representante. La dirección exacta solo la ven la gerencia y el propio representante.', S('lista', 'Representantes', lista), ...bloques);
  }
  location.replace(`#configurar?rep=${id}&paso=vehiculo`); return [];
};

V.precios = async () => {
  const [{ items }, { items: combs }, { item: micm }] = await Promise.all([api('GET', '/api/viaticos/precios'), api('GET', '/api/viaticos/combustibles'), api('GET', '/api/viaticos/precios/micm')]);
  const puede = ['administrador', 'gerencia', 'finanzas'].includes(yo.role);
  const bloques = [];
  const estadoMicm = h('div', { class: 'tarjeta' }, h('h2', {}, 'Actualización automática desde el MICM'),
    h('p', { class: 'hint' }, 'Cada 6 horas se revisa el aviso semanal oficial del MICM. Un precio solo se registra si los componentes del aviso suman el precio oficial; si algo no cuadra, no se registra nada y se avisa aquí.'),
    micm ? h('div', { class: `aviso ${micm.estado === 'error' ? 'error' : 'ok'}`, role: 'status' },
      `${micm.estado === 'error' ? 'No se pudo actualizar' : micm.estado === 'al dia' ? 'Al día' : 'Actualizado'}: ${micm.mensaje ?? ''} Última revisión: ${new Date(micm.revisado).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'medium', timeStyle: 'short' }).replace(/\.$/, '')}.`,
      micm.pdf ? [' ', h('a', { href: micm.pdf, target: '_blank', rel: 'noopener' }, micm.aviso ?? 'Ver aviso')] : null)
      : h('p', {}, 'Todavía no se ha revisado el aviso del MICM.'),
    puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn-sec', type: 'button', onclick: async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Revisando el MICM…';
      try { await api('POST', '/api/viaticos/precios/micm'); } catch (e) { alert(e.message); }
      router();
    } }, 'Revisar el MICM ahora')) : null);
  bloques.push(S('micm', 'Actualización MICM', estadoMicm));
  if (puede) {
    const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar precio');
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Registrar a mano'),
      h('p', { class: 'hint' }, 'Úsalo solo si el MICM no se pudo leer. Un precio registrado a mano no se sobrescribe.'),
      h('div', { class: 'form-fila' }, campo('combustible', 'Combustible', { options: combs.filter((c) => !['hibrido', 'electrico'].includes(c.value)) }),
        campo('precioGalon', 'Precio por galón RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' }), campo('vigenteDesde', 'Vigente desde', { type: 'date', value: hoy() })),
      h('div', { class: 'acciones' }, b));
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/viaticos/precios', { combustible: f.combustible.value, precioGalon: f.precioGalon.value, vigenteDesde: f.vigenteDesde.value }))) irA('precios', {}); });
    bloques.push(S('manual', 'Registrar a mano', f));
  }
  bloques.push(S('historial', 'Historial de precios', tabla([{ t: 'Combustible', v: (p) => combs.find((c) => c.value === p.combustible)?.label ?? p.combustible }, { t: 'Precio por galón', num: true, v: (p) => RD(p.precioGalon) }, { t: 'Vigente desde', v: (p) => fecha(p.vigenteDesde) },
      { t: 'Fuente', v: (p) => p.fuente === 'micm' ? h('a', { href: p.enlace, target: '_blank', rel: 'noopener' }, 'Aviso MICM') : 'Manual' }],
    items, ['Aún no hay precios registrados', 'Se cargarán solos con el próximo aviso del MICM, o puedes revisarlo ahora.'])));
  return vistaS('precios', ['historial', 'micm', 'manual'], 'Precios de combustible', 'Cada jornada usa el precio vigente en su fecha. Los presupuestos ya aprobados no cambian.', ...bloques);
};
V.viaticos = async () => {
  const mes = mesDe();
  const r = await api('GET', `/api/viaticos/consolidado?mes=${mes}`);
  return vista('Presupuestos de viáticos', `Consolidado de ${mes}: ${RD(r.totales.total)} solicitados, ${RD(r.totales.entregado)} entregados, ${RD(r.totales.justificado)} justificados.`,
    filtroMes(mes, 'viaticos'),
    tabla([
      { t: 'Representante', v: (f) => [f.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, f.posicion ?? '')] },
      { t: 'Jornadas', num: true, v: (f) => fmtN.format(f.jornadas) }, { t: 'Km est. / real', num: true, v: (f) => `${fmtN.format(f.kmEstimados)} / ${fmtN.format(f.kmReales)}` },
      { t: 'Presupuesto', num: true, v: (f) => f.total == null ? '' : RD(f.total) }, { t: 'Entregado', num: true, v: (f) => RD(f.entregado) }, { t: 'Saldo', num: true, v: (f) => RD(f.saldo) },
      { t: 'Estado', v: (f) => [chipP(f.estado), f.porRevisar ? h('small', { style: 'display:block;color:var(--alerta)' }, `${f.porRevisar} gasto(s) por revisar`) : null] },
      { t: '', v: (f) => h('a', { class: 'btn-sec btn-peq', href: `#viatico?rep=${f.representanteId}&mes=${mes}` }, 'Abrir') },
    ], r.filas, ['No hay representantes activos', 'Aparecen aquí cuando se aprueban sus cuentas.']));
};
V.viatico = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1]); const rep = q.get('rep'); const mes = q.get('mes') || mesActual();
  const [{ guardado: p, calculo: c }, { items: js }, reps] = await Promise.all([
    api('GET', `/api/viaticos/presupuesto?representanteId=${rep}&mes=${mes}`), api('GET', `/api/viaticos/jornadas?representanteId=${rep}&mes=${mes}`), api('GET', '/api/viaticos/representantes')]);
  const nombre = reps.items.find((r) => r.id === rep)?.fullName ?? 'Representante';
  const ger = ['administrador', 'gerencia'].includes(yo.role); const fin = ['administrador', 'finanzas'].includes(yo.role);
  const recargar = () => router();
  const accion = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } recargar(); };
  const bloques = [h('p', {}, h('a', { href: `#viaticos?mes=${mes}` }, 'Volver al consolidado'))];
  const hoteles = js.filter((j) => j.hospedaje && j.estado !== 'cancelada');
  const sub = (t) => h('small', { style: 'display:block;color:var(--texto-2)' }, t);
  if (hoteles.length) bloques.push(S('hoteles', `Hospedajes (${fmtN.format(hoteles.length)})`, tabla([
    { t: 'Fecha', v: (j) => fecha(j.fecha) },
    { t: 'Hotel', v: (j) => [j.hospedaje.hotel ?? 'Sin nombre', sub(`${j.hospedaje.municipio ?? ''}${j.hospedaje.telefonoHotel ? `. Tel. ${j.hospedaje.telefonoHotel}` : ''}`),
      j.hospedaje.cambioHotel ? sub(`En vez de ${j.hospedaje.recomendado ?? 'el aprobado'}`) : null] },
    { t: 'Precio por noche', num: true, v: (j) => [RD(j.hospedaje.tarifaNoche), j.hospedaje.cambioPrecio ? h('small', { class: 'precio-subio' }, `Aprobado: ${RD(j.hospedaje.tarifaAprobada)}`) : null] },
    { t: 'Razón', v: (j) => [j.hospedaje.motivoCambio ?? j.hospedaje.motivo, j.hospedaje.comprobante ? h('button', { class: 'enlace', style: 'display:block', onclick: () => verAdjunto(j.hospedaje.comprobante.clave) }, 'Ver comprobante') : null,
      j.hospedaje.nota ? sub(`Gerencia: ${j.hospedaje.nota}`) : null] },
    { t: 'Total', num: true, v: (j) => RD(j.hospedaje.noches * j.hospedaje.tarifaNoche + j.hospedaje.cargos) },
    { t: 'Estado', v: (j) => [chipP(j.hospedaje.estado), j.hospedaje.decididoPor === 'hotel-aprobado' ? sub('Hotel aprobado') : null] },
    { t: '', v: (j) => ger && j.hospedaje.estado === 'propuesto' ? [
      h('button', { class: 'btn btn-peq', onclick: async () => {
        let actualizarPrecio = false;
        if (j.hospedaje.cambioPrecio) {
          const ok = await confirmar('Autorizar precio distinto', `${j.hospedaje.hotel} cobró ${RD(j.hospedaje.tarifaNoche)} por noche; el precio aprobado era ${RD(j.hospedaje.tarifaAprobada)}. Revisa el comprobante y confírmalo con el hotel antes de autorizar.`, { okTexto: 'Autorizar', casilla: { texto: `Actualizar el precio del hotel a ${RD(j.hospedaje.tarifaNoche)} para las próximas jornadas` } });
          if (ok === null) return; actualizarPrecio = ok.casilla;
        }
        accion(() => api('POST', `/api/viaticos/jornadas/${j.id}/hospedaje`, { aprobar: true, actualizarPrecio }));
      } }, 'Autorizar'),
      h('button', { class: 'btn-sec btn-peq', onclick: async () => { const m = await confirmar('No autorizar hotel', 'Explica la razón al representante.', { okTexto: 'No autorizar', pedirMotivo: true }); if (m != null) accion(() => api('POST', `/api/viaticos/jornadas/${j.id}/hospedaje`, { aprobar: false, nota: m })); } }, 'No autorizar')] : '' },
  ], hoteles, ['', ''])));
  if (!p || ['borrador', 'rechazado'].includes(p.estado)) {
    bloques.push(h('div', { class: 'aviso' }, p?.estado === 'rechazado' ? `Rechazado: ${p.motivo}. Puedes asignarlo de nuevo cuando esté listo.` : 'Aún no tiene viáticos asignados este mes. Asígnalos desde su cronograma aprobado: el representante verá su balance y registrará sus gastos.'));
    if (ger && c.detalle) bloques.push(h('div', { class: 'acciones' }, h('button', { class: 'btn', disabled: c.faltan?.length > 0, title: c.faltan?.length ? c.faltan.join(' ') : null, onclick: async () => {
      if (!(await confirmar('Asignar viáticos del mes', `${nombre} tendrá ${RD(c.total)} de viáticos en ${mes}. Cada gasto que registre rebaja su balance. Los cambios después se hacen con ajustes.`, { okTexto: 'Asignar' }))) return;
      accion(() => api('POST', '/api/viaticos/presupuestos/asignar', { representanteId: rep, mes }));
    } }, `Asignar ${RD(c.total)}`)));
    if (c.faltan?.length) bloques.push(h('div', { class: 'aviso' }, c.faltan.join(' ')));
    for (const a of c.avisos ?? []) bloques.push(h('div', { class: 'aviso' }, a));
    if (c.detalle) { const d = detalleCalculo(c, true); bloques.push(S('calculo', 'Cálculo del mes', h('div', { class: 'tarjeta' }, h('h2', {}, 'Cálculo del mes'), desglose(c.detalle, c.total)), d?.semana), S('como', 'Cómo se calcula', d?.como)); }
  } else {
    const dp = detalleCalculo({ supuestos: p.supuestos }, true);
    bloques.push(S('calculo', 'Cálculo del mes', balanceViaticos(p), h('div', { class: 'tarjeta' }, h('h2', {}, `Presupuesto ${EST_P[p.estado].toLowerCase()}${p.origen === 'asignado' ? ' (asignado por la gerencia)' : ''}`), desglose(p.detalle, p.total),
      h('p', { class: 'hint', style: 'margin-top:1rem' }, `${p.supuestos.jornadas} jornadas, ${fmtN.format(p.supuestos.km)} km (${p.supuestos.kmTipo}).`)), bloqueResumen(p), dp?.semana), dp ? S('como', 'Cómo se calcula', dp.como) : null);
    const acc = h('div', { class: 'acciones' });
    if (ger && p.estado === 'solicitado') {
      acc.append(h('button', { class: 'btn', onclick: async () => { const m = await confirmar('Aprobar presupuesto', `Monto a aprobar (máximo ${RD(p.total)}). Déjalo vacío para aprobar el total.`, { okTexto: 'Aprobar', pedirMotivo: true }); if (m == null) return; accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/aprobar`, { montoAprobado: m.trim() ? Number(m.replace(',', '.')) : null })); } }, 'Aprobar'),
        h('button', { class: 'btn-sec', onclick: async () => { const m = await confirmar('Rechazar presupuesto', 'Explica qué debe corregir el representante.', { okTexto: 'Rechazar', pedirMotivo: true }); if (m == null) return; accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/rechazar`, { motivo: m })); } }, 'Rechazar'));
    }
    if (fin && ['aprobado', 'desembolsado'].includes(p.estado)) {
      const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar desembolso');
      const f = h('form', { class: 'tarjeta', novalidate: true, style: 'margin-top:1.25rem' }, h('h2', {}, 'Desembolso'),
        h('div', { class: 'form-fila' }, campo('monto', 'Monto RD$', { type: 'number', min: 0.01, step: 0.01, value: r2(p.montoAprobado - p.resumen.entregado) }), campo('fecha', 'Fecha', { type: 'date', value: hoy(), max: hoy() }), campo('referencia', 'Referencia (transferencia o cheque)')),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', `/api/viaticos/presupuestos/${p.id}/desembolsos`, { monto: f.monto.value, fecha: f.fecha.value, referencia: f.referencia.value }))) recargar(); });
      bloques.push(S('calculo', 'Cálculo del mes', f));
    }
    if (fin && p.estado === 'desembolsado') acc.append(h('button', { class: 'btn', onclick: async () => { if (await confirmar('Liquidar viáticos', `Cerrar ${mes} de ${nombre}. Entregado ${RD(p.resumen.entregado)}, justificado ${RD(p.resumen.justificado)}.`, { okTexto: 'Liquidar' })) accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/liquidar`)); } }, 'Liquidar'));
    bloques.push(S('calculo', 'Cálculo del mes', acc), S('gastos', `Gastos y comprobantes (${fmtN.format((p.gastos ?? []).length)})`,
      tablaGastos(p, fin && p.estado !== 'liquidado' ? (g) => g.estado === 'reportado' ? h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
        h('button', { class: 'btn btn-peq', onclick: () => accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/gastos/${g.id}/aceptar`)) }, 'Aceptar'),
        h('button', { class: 'btn-sec btn-peq', onclick: async () => { const m = await confirmar('No aceptar gasto', 'Explica el motivo.', { okTexto: 'No aceptar', pedirMotivo: true }); if (m != null) accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/gastos/${g.id}/rechazar`, { motivo: m })); } }, 'No aceptar')) : '' : null)));
  }
  bloques.push(S('jornadas', `Jornadas (${fmtN.format(js.length)})`,
    tabla([{ t: 'Fecha', v: (j) => fecha(j.fecha) }, { t: 'Paradas', v: (j) => j.paradas.map((x) => x.lugar).join(' → ') }, { t: 'Km', num: true, v: (j) => `${fmtN.format(j.kmEstimados)}${j.kmReales != null ? ` / ${fmtN.format(j.kmReales)} real` : ''}` }, { t: 'Estado', v: (j) => chipP(j.estado) }],
      js, ['Sin jornadas creadas en el mes', 'El representante las crea desde su cronograma; mientras tanto, el cálculo usa los días aprobados.'], { porPagina: 10 })));
  return vistaS('viatico', ['calculo', 'como', 'jornadas', 'hoteles', 'gastos'], `${nombre}: viáticos de ${mes}`, null, ...bloques);
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- territorio, catálogo e importación
const GESTION_T = () => ['administrador', 'gerencia', 'supervisor'].includes(yo.role);
const ES_GER = () => ['administrador', 'gerencia'].includes(yo.role);
async function division() { return (cache.div ??= await api('GET', '/api/territorio/division')); }
const param = (k) => new URLSearchParams(location.hash.split('?')[1]).get(k);

/** Control segmentado accesible: flechas izquierda/derecha cambian de opción. */
function segmentos(etiqueta, opciones, actual, alCambiar) {
  const cont = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': etiqueta });
  const botones = opciones.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(id === actual), tabindex: id === actual ? '0' : '-1', onclick: () => alCambiar(id) }, label));
  cont.addEventListener('keydown', (e) => {
    const i = botones.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % botones.length : e.key === 'ArrowLeft' ? (i - 1 + botones.length) % botones.length : -1;
    if (j >= 0) { e.preventDefault(); botones[j].focus(); botones[j].click(); }
  });
  cont.append(...botones);
  return cont;
}
const irA = (ruta, params) => { location.hash = `#${ruta}?${new URLSearchParams(params)}`; };

/** Selects de provincia y municipio dependientes. */
/**
 * Selección múltiple con buscador: un botón que dice lo elegido ("Todas", "Duarte, Santiago", "3 municipios")
 * y una lista de casillas. opciones: [{ value, label, grupo? }]. alCambiar(valores) al pulsar "Aplicar".
 */
function multiSel({ id, etiqueta, opciones, valores = [], todas = 'Todos', plural = 'elegidos', alCambiar, conAplicar = true }) {
  let elegidos = new Set(valores.filter((v) => opciones.some((o) => o.value === v)));
  const texto = () => { const xs = opciones.filter((o) => elegidos.has(o.value)); return !xs.length ? todas : xs.length <= 2 ? xs.map((o) => o.label).join(', ') : `${fmtN.format(xs.length)} ${plural}`; };
  const boton = h('button', { type: 'button', class: 'ms-boton', id, 'aria-haspopup': 'true', 'aria-expanded': 'false' }, h('span', { class: 'ms-texto' }, texto()), h('span', { class: 'ms-flecha', 'aria-hidden': 'true' }));
  const buscar = h('input', { type: 'search', placeholder: 'Buscar', 'aria-label': `Buscar en ${etiqueta}`, autocomplete: 'off' });
  const lista = h('div', { class: 'ms-lista', role: 'group', 'aria-label': etiqueta });
  const pintar = () => {
    const k = sinTilde(buscar.value.trim());
    const vis = opciones.filter((o) => !k || sinTilde(o.label).includes(k) || sinTilde(o.grupo ?? '').includes(k));
    const nodos = []; let grupo = null;
    for (const o of vis) {
      if (o.grupo && o.grupo !== grupo) { grupo = o.grupo; nodos.push(h('div', { class: 'ms-grupo' }, grupo)); }
      const c = h('input', { type: 'checkbox', value: o.value, checked: elegidos.has(o.value) });
      c.addEventListener('change', () => { c.checked ? elegidos.add(o.value) : elegidos.delete(o.value); boton.querySelector('.ms-texto').textContent = texto(); if (!conAplicar) alCambiar?.([...elegidos]); });
      nodos.push(h('label', { class: 'ms-op' }, c, h('span', {}, o.label)));
    }
    lista.replaceChildren(...(nodos.length ? nodos : [h('p', { class: 'hint', style: 'margin:.5rem' }, 'Sin resultados.')]));
  };
  buscar.addEventListener('input', pintar);
  const todo = h('button', { type: 'button', class: 'btn-enlace' }, 'Todos'); const nada = h('button', { type: 'button', class: 'btn-enlace' }, 'Ninguno');
  todo.addEventListener('click', () => { lista.querySelectorAll('input').forEach((c) => elegidos.add(c.value)); pintar(); boton.querySelector('.ms-texto').textContent = texto(); if (!conAplicar) alCambiar?.([...elegidos]); });
  nada.addEventListener('click', () => { elegidos.clear(); pintar(); boton.querySelector('.ms-texto').textContent = texto(); if (!conAplicar) alCambiar?.([]); });
  const aplicar = h('button', { type: 'button', class: 'btn btn-peq' }, 'Aplicar');
  const panel = h('div', { class: 'ms-panel', hidden: true }, buscar, h('div', { class: 'ms-acc' }, todo, nada), lista, conAplicar ? h('div', { class: 'ms-pie' }, aplicar) : null);
  const caja = h('div', { class: 'ms' }, boton, panel);
  const cerrar = (aplicarCambios) => { if (panel.hidden) return; panel.hidden = true; boton.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', fuera, true); if (aplicarCambios && conAplicar) alCambiar?.([...elegidos]); };
  const fuera = (e) => { if (!caja.contains(e.target)) cerrar(true); };
  boton.addEventListener('click', () => {
    if (!panel.hidden) return cerrar(true);
    panel.hidden = false; boton.setAttribute('aria-expanded', 'true'); buscar.value = ''; pintar(); buscar.focus();
    document.addEventListener('pointerdown', fuera, true);
  });
  aplicar.addEventListener('click', () => { cerrar(true); boton.focus(); });
  caja.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); cerrar(true); boton.focus(); } });
  caja.valores = () => [...elegidos];
  return h('div', { class: 'field ms-campo' }, h('label', { for: id }, etiqueta), caja);
}

function selectorZona(provincias, municipios, { provincia = '', municipio = '', prefijo = '' } = {}) {
  const fp = campo(`${prefijo}provincia`, 'Provincia', { options: provincias.map((p) => ({ value: p, label: p })), value: provincia, placeholder: 'Elige la provincia' });
  const fm = campo(`${prefijo}municipio`, 'Municipio', { options: [], placeholder: 'Elige primero la provincia' });
  const sp = fp.querySelector('select'); const sm = fm.querySelector('select');
  const llenar = (sel) => {
    const lista = municipios[sp.value] ?? [];
    sm.replaceChildren(h('option', { value: '' }, lista.length ? 'Elige el municipio' : 'Elige primero la provincia'), ...lista.map((m) => h('option', { value: m, selected: m === sel }, m)));
    sm.disabled = !lista.length;
  };
  sp.addEventListener('change', () => { llenar(''); sm.dispatchEvent(new Event('change')); });
  llenar(municipio);
  return { fp, fm, sp, sm };
}

/** Subir Excel: primero revisa (vista previa), luego importa todo o nada. */
function importador(tipo, titulo, ayuda, alTerminar) {
  const archivo = campo('archivo', 'Archivo Excel (.xlsx) o CSV', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' });
  const revisar = h('button', { class: 'btn-sec', type: 'submit' }, 'Revisar archivo');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta importador', novalidate: true },
    h('h2', {}, titulo), h('p', { class: 'hint' }, ayuda, ' ', h('a', { href: `assets/plantillas/${tipo}.xlsx`, download: true }, 'Descargar plantilla')),
    archivo, h('div', { class: 'acciones' }, revisar), salida);
  let leido = null;
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); salida.replaceChildren();
    const file = f.archivo.files[0];
    const r = await enviar(f, revisar, async () => {
      if (!file) throw new ApiError(422, { error: 'Elige un archivo.', fields: { archivo: 'Elige un archivo .xlsx o .csv.' } });
      if (file.size > 8 * 1024 * 1024) throw new ApiError(413, { error: 'El archivo no puede pasar de 8 MB.', fields: { archivo: 'Archivo demasiado grande.' } });
      leido = { archivo: await archivoB64(file), nombre: file.name };
      return api('POST', `/api/importar/${tipo}`, leido);
    });
    if (!r) return;
    const chips = Object.entries(r.resumen).map(([k, n]) => h('span', {}, `${fmtN.format(n)} ${k}`));
    if (r.errores.length) chips.push(h('span', { class: 'mal' }, `${fmtN.format(r.errores.length)} con errores`));
    salida.append(h('p', {}, `${fmtN.format(r.total)} filas leídas de ${file.name}.`), h('div', { class: 'resumen' }, chips));
    if (r.errores.length) {
      salida.append(h('div', { class: 'aviso error' }, 'Corrige estas filas en el Excel y vuelve a revisarlo. No se guarda nada mientras haya errores.'),
        h('ul', { class: 'errores' }, r.errores.slice(0, 100).map((x) => h('li', {}, `Fila ${x.fila}: ${x.errores.join(' ')}`))));
      return;
    }
    const cambios = r.total - (r.resumen['ya existe'] ?? 0) - (r.resumen['sin cambio'] ?? 0) - (r.resumen['ya tiene cuenta'] ?? 0);
    if (!cambios) { salida.append(h('div', { class: 'aviso ok' }, 'No hay nada nuevo que guardar: todo ya está registrado.')); return; }
    const imp = h('button', { class: 'btn', type: 'button', onclick: async () => {
      imp.disabled = true; imp.textContent = 'Importando…';
      try { const ok = await api('POST', `/api/importar/${tipo}`, { ...leido, confirmar: true }); salida.replaceChildren(h('div', { class: 'aviso ok' }, `Importación lista: ${Object.entries(ok.resumen).map(([k, n]) => `${n} ${k}`).join(', ')}.`)); cache = {}; setTimeout(alTerminar, 1200); }
      catch (err) { imp.disabled = false; imp.textContent = 'Importar'; salida.append(h('div', { class: 'aviso error' }, err.message)); }
    } }, `Importar ${fmtN.format(cambios)} fila(s)`);
    salida.append(h('div', { class: 'acciones' }, imp));
  });
  return f;
}

/** Búsqueda de Google Maps por municipio (solo gestión). */
async function buscadorGoogle(tipos, alAgregar, { provincias = null, municipios = null, titulo = 'Buscar en Google Maps', nota = 'Busca por municipio y agrega con un clic. Cada búsqueda consume cuota de Google.' } = {}) {
  const [{ activo }, div] = await Promise.all([api('GET', '/api/territorio/google/estado'), division()]);
  if (!activo) return h('div', { class: 'tarjeta' }, h('h2', {}, titulo), h('p', { class: 'hint' }, 'La búsqueda en Google Maps se activa cuando se configure la clave del mapa (MAPS_API_KEY) en el servidor. Mientras tanto, registra a mano o importa un Excel.'));
  const z = selectorZona(provincias ?? div.provincias, municipios ?? div.municipios, provincias?.length === 1 ? { provincia: provincias[0] } : {});
  // Opción "Todos los municipios" de la provincia elegida (busca en cada uno).
  const conTodos = () => { if (z.sp.value && !z.sm.querySelector('option[value="todos"]')) z.sm.insertBefore(h('option', { value: 'todos' }, 'Todos los municipios'), z.sm.options[1] ?? null); };
  z.sp.addEventListener('change', () => setTimeout(conTodos, 0)); conTodos();
  const ft = campo('tipo', 'Tipo', { options: tipos.map(([value, label]) => ({ value, label })), value: tipos[0][0] });
  const ftx = campo('texto', 'Nombre o palabra', {}, '(opcional)');
  const b = h('button', { class: 'btn-sec', type: 'submit' }, 'Buscar en Google Maps');
  const res = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, titulo), h('p', { class: 'hint' }, nota),
    h('div', { class: 'form-fila' }, z.fp, z.fm, ft, ftx), h('div', { class: 'acciones' }, b), res);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = { tipo: f.tipo.value, provincia: z.sp.value, municipio: z.sm.value, texto: f.texto.value };
    const r = await enviar(f, b, () => api('GET', `/api/territorio/google/buscar?${new URLSearchParams(q)}`));
    if (!r) return;
    res.replaceChildren(tabla([
      { t: 'Nombre', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion)] },
      ...(q.municipio === 'todos' ? [{ t: 'Municipio', v: (x) => x.municipio }] : []),
      { t: 'Teléfono', v: (x) => x.telefono ?? '' },
      { t: '', v: (x) => x.registrado ? h('span', { class: 'chip validado', title: x.registradoEn ? `Registrado en ${x.registradoEn}` : null }, x.registradoEn ? `Ya registrado en ${x.registradoEn.split(',')[0]}` : 'Ya registrado') : h('button', { class: 'btn btn-peq', type: 'button', onclick: async (ev) => {
        ev.target.disabled = true;
        try { await api('POST', '/api/territorio/google/agregar', { ...q, municipio: x.municipio ?? q.municipio, placeId: x.placeId }); ev.target.replaceWith(h('span', { class: 'chip validado' }, 'Agregado')); alAgregar?.(); }
        catch (err) { if (err.status === 409) ev.target.replaceWith(h('span', { class: 'chip validado', title: err.message }, 'Ya registrado')); else { ev.target.disabled = false; alert(err.message); } }
      } }, 'Agregar') },
    ], r.items, ['Google no encontró resultados', 'Prueba con otro tipo o escribe parte del nombre.']));
  });
  return f;
}

/** Registro automático: el sistema recorre los municipios y guarda lo que Google encuentre (solo administración y gerencia). */
async function registroAutomatico(tipos) {
  const [{ activo }, div, st] = await Promise.all([api('GET', '/api/territorio/google/estado'), division(), api('GET', '/api/territorio/google/barrido')]);
  if (!activo) return null;
  const ft = campo('tipo', 'Qué registrar', { options: tipos.map(([value, label]) => ({ value, label })), value: tipos[0][0] });
  const fp = campo('provincia', 'Dónde', { options: [{ value: 'todas', label: 'Todo el país (158 municipios)' }, ...div.provincias.map((p) => ({ value: p, label: p }))], value: 'todas' });
  const fm = campo('municipio', 'Municipio', { options: [], placeholder: 'Todos los municipios' });
  const sp = fp.querySelector('select'); const sm = fm.querySelector('select');
  const llenar = () => { const l = div.municipios[sp.value] ?? []; sm.replaceChildren(h('option', { value: '' }, 'Todos los municipios'), ...l.map((m) => h('option', { value: m }, m))); sm.disabled = !l.length; };
  sp.addEventListener('change', llenar); llenar();
  const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar automáticamente');
  const panel = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Registro automático desde Google Maps'),
    h('p', { class: 'hint' }, 'El sistema recorre cada municipio, busca en Google Maps y guarda solo lo que falte, con dirección, teléfono y ubicación. No duplica lo ya registrado. Puedes salir de esta pantalla mientras trabaja; te avisa en la campana al terminar.'),
    h('div', { class: 'form-fila' }, ft, fp, fm), h('div', { class: 'acciones' }, b), panel);
  const nombreTipo = (t) => (tipos.find(([v]) => v === t)?.[1] ?? t).toLowerCase();
  const pintar = (e) => {
    if (!e) { panel.replaceChildren(); b.disabled = false; return; }
    const zona = e.alcance.municipio ?? (e.alcance.provincia === 'todas' ? 'todo el país' : e.alcance.provincia);
    const hechos = e.hechos?.length ?? 0;
    const cifras = h('p', {}, `${fmtN.format(e.agregados)} nuevos · ${fmtN.format(e.existentes)} ya estaban · ${fmtN.format(e.consultas)} consultas a Google${e.descartados ? ` · ${fmtN.format(e.descartados)} de otra provincia (no se guardaron)` : ''}${e.errores ? ` · ${fmtN.format(e.errores)} con error` : ''}`);
    const titulo = { en_curso: `Registrando ${nombreTipo(e.tipo)} en ${zona}…`, terminado: `Terminado: ${nombreTipo(e.tipo)} en ${zona}`, interrumpido: `Se interrumpió: ${nombreTipo(e.tipo)} en ${zona}`, error: `Se detuvo: ${nombreTipo(e.tipo)} en ${zona}` }[e.estado];
    const partes = [h('strong', {}, titulo),
      h('progress', { max: e.total, value: hechos, style: 'width:100%;height:.75rem;accent-color:var(--marino)', 'aria-label': 'Avance del registro' }),
      h('p', { class: 'hint' }, `${fmtN.format(hechos)} de ${fmtN.format(e.total)} municipios${e.actual ? `. Ahora: ${e.actual}` : ''}`), cifras];
    if (e.mensajes?.length && e.estado !== 'terminado') partes.push(h('p', { class: 'hint', style: 'color:var(--alerta)' }, e.mensajes.at(-1)));
    if (['interrumpido', 'error'].includes(e.estado)) partes.push(h('button', { class: 'btn-sec', type: 'button', onclick: () => lanzar({ tipo: e.tipo, provincia: e.alcance.provincia, municipio: e.alcance.municipio, continuar: true }) }, 'Continuar donde quedó'));
    panel.replaceChildren(h('div', { class: 'tarjeta', style: 'margin-top:1rem;background:var(--panel);display:grid;gap:.5rem' }, ...partes));
    b.disabled = e.estado === 'en_curso';
  };
  const seguir = async () => {
    if (!f.isConnected) return;
    try { const { item } = await api('GET', '/api/territorio/google/barrido'); pintar(item); if (item?.estado === 'en_curso') setTimeout(seguir, 3000); } catch { setTimeout(seguir, 6000); }
  };
  async function lanzar(datos) {
    try { const { item } = await api('POST', '/api/territorio/google/barrido', datos); pintar(item); setTimeout(seguir, 2000); }
    catch (err) { const a = h('div', { role: 'status' }); estado(a, 'error', err.message); panel.replaceChildren(a); }
  }
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const datos = { tipo: f.tipo.value, provincia: sp.value, municipio: sm.value || undefined };
    const q = new URLSearchParams(Object.entries(datos).filter(([, v]) => v));
    const est = await enviar(f, b, () => api('GET', `/api/territorio/google/barrido/estimar?${q}`));
    if (!est) return;
    const zona = datos.municipio ?? (datos.provincia === 'todas' ? 'todo el país' : datos.provincia);
    const ok = await confirmar('Registrar automáticamente', `Se buscarán ${nombreTipo(datos.tipo)} en ${zona}: ${fmtN.format(est.item.municipios)} municipio(s), hasta ${fmtN.format(est.item.consultasMaximas)} consultas a Google (normalmente menos). Google cobra cada consulta según tu plan de Google Cloud.`, { okTexto: 'Empezar' });
    if (ok) lanzar(datos);
  });
  pintar(st.item); if (st.item?.estado === 'en_curso') setTimeout(seguir, 3000);
  return f;
}

V.catalogo = async () => {
  const ver = param('ver') || 'medicamentos';
  const seg = h('div', { class: 'segmentos-doble' }, segmentos('Secciones del catálogo', [['medicamentos', 'Medicamentos'], ['farmacias', 'Farmacias'], ['medicos', 'Médicos']], ver, (id) => irA('catalogo', { ver: id })));
  const validar = async (col, id) => { try { await api('POST', `/api/catalogo/${col}/${id}/validar`); router(); } catch (e) { alert(e.message); } };
  const bloques = [seg];
  if (ver === 'medicamentos') {
    const ms = await medicamentos();
    if (ES_GER()) {
      const b = h('button', { class: 'btn', type: 'submit' }, 'Agregar medicamento');
      const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo medicamento'),
        h('div', { class: 'form-fila' }, campo('codigo', 'Código', { placeholder: 'Ej. TIODEX01', autocomplete: 'off' }, '(opcional)'), campo('nombre', 'Medicamento / Producto'), campo('linea', 'Línea', {}, '(opcional)'), campo('presentacion', 'Presentación', {}, '(opcional)'), campo('precio', 'Precio final RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' }, '(opcional)')),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/catalogo/medicamentos', { codigo: f.codigo.value, nombre: f.nombre.value, linea: f.linea.value, presentacion: f.presentacion.value, precio: f.precio.value || undefined }))) { cache = {}; irA('catalogo', { ver: 'medicamentos' }); } });
      bloques.push(S('nuevo', 'Nuevo medicamento', f));
    }
    const ponerPrecio = async (m) => {
      const v = await confirmar(m.precio != null ? 'Cambiar precio' : 'Poner precio', `${m.nombre}${m.presentacion ? `, ${m.presentacion}` : ''}. ${m.precio != null ? `Precio actual: ${RD(m.precio)}. ` : ''}El precio anterior queda en el historial.`, { okTexto: 'Guardar precio', campos: [{ name: 'precio', label: 'Precio RD$', value: m.precio ?? '', type: 'number', inputmode: 'decimal' }, { name: 'vigenteDesde', label: 'Vigente desde', value: hoy(), type: 'date' }] });
      if (!v) return;
      try { await api('POST', `/api/catalogo/medicamentos/${m.id}/precios`, v); router(); } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
    };
    // Editar código, nombre, presentación, línea y precio. Si el precio cambia, el anterior queda en el historial.
    const editarMed = async (m) => {
      const v = await confirmar(`Editar ${m.nombre}`, 'Cambia lo que necesites. Si cambias el precio, el anterior queda en el historial.', { okTexto: 'Guardar cambios', campos: [
        { name: 'codigo', label: 'Código', value: m.codigo ?? '' }, { name: 'nombre', label: 'Medicamento / Producto', value: m.nombre },
        { name: 'presentacion', label: 'Presentación (opcional)', value: m.presentacion ?? '' }, { name: 'linea', label: 'Línea (opcional)', value: m.linea ?? '' },
        { name: 'precio', label: 'Precio final RD$', value: m.precio ?? '', type: 'number', inputmode: 'decimal' }] });
      if (!v) return;
      try {
        await api('POST', `/api/catalogo/medicamentos/${m.id}`, { codigo: v.codigo, nombre: v.nombre, presentacion: v.presentacion, linea: v.linea });
        if (v.precio !== '' && Number(v.precio) !== Number(m.precio)) { accionPendiente = 'cambiar precio'; await api('POST', `/api/catalogo/medicamentos/${m.id}/precios`, { precio: v.precio, vigenteDesde: hoy() }); }
        cache = {}; router();
      } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
    };
    const eliminarMed = async (m) => {
      const r = await confirmar(`Eliminar ${m.nombre}`, 'Deja de aparecer para cargar recetas, vouchers, pedidos y en la tienda. Las recetas, vouchers y ventas que ya lo usan se conservan. Escribe el motivo (opcional).', { okTexto: 'Eliminar medicamento', pedirMotivo: true });
      if (r == null) return;
      try { await api('POST', `/api/catalogo/medicamentos/${m.id}/eliminar`, { motivo: r }); cache = {}; router(); } catch (e) { alert(e.message); }
    };
    const historial = async (m) => {
      const { items } = await api('GET', `/api/catalogo/medicamentos/${m.id}/precios`);
      await confirmar(`Precios de ${m.nombre}`, items.length ? items.map((p) => `${fecha(p.vigenteDesde)}: ${RD(p.precio)} (${p.fuente})`).join('  ·  ') : 'Sin historial de precios.', { okTexto: 'Cerrar' });
    };
    bloques.push(S('lista', `Medicamentos (${fmtN.format(ms.length)})`, tabla([{ t: 'Código', v: (m) => (m.codigo ? h('code', { class: 'codigo-med' }, m.codigo) : '') }, { t: 'Medicamento / Producto', v: (m) => [m.nombre, m.presentacion ? h('small', { style: 'display:block;color:var(--texto-2)' }, m.presentacion) : null] }, { t: 'Línea', v: (m) => m.linea ?? '' },
        { t: 'Precio', num: true, v: (m) => m.precio != null ? h('strong', { class: 'precio-cat' }, RD(m.precio)) : h('span', { class: 'chip pendiente' }, 'Sin precio') },
        { t: '', v: (m) => [ES_GER() ? h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => editarMed(m) }, 'Editar') : null, ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => ponerPrecio(m) }, m.precio != null ? 'Cambiar precio' : 'Poner precio') : null,
          h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => historial(m) }, 'Historial'),
          ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', onclick: () => eliminarMed(m) }, 'Eliminar') : null] }], ms, ['Catálogo vacío', 'Agrega los medicamentos de FERSUAZ o impórtalos desde Excel.'], { exportar: { nombre: 'medicamentos-fersuaz', titulo: 'Medicamentos' } })));
    if (ES_GER()) {
      const { grupos } = await api('GET', '/api/catalogo/medicamentos/repetidos');
      const exactos = grupos.filter((g) => g.exacto);
      const nombreM = (m) => `${m.nombre}${m.presentacion ? `, ${m.presentacion}` : ''}`;
      const tarjetaG = (g, i) => {
        const nombre = `grupo-${i}`;
        const op = g.items.map((m) => h('label', { class: 'rep-opcion' }, h('input', { type: 'radio', name: nombre, value: m.id, checked: m.id === g.conservar }),
          h('span', {}, m.codigo ? h('code', { class: 'codigo-med' }, m.codigo) : null, ' ', h('strong', {}, nombreM(m)), h('small', {}, m.precio != null ? RD(m.precio) : 'Sin precio'))));
        const b = h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: async () => {
          const conservar = op.map((l) => l.querySelector('input')).find((x) => x.checked).value;
          const quitar = g.items.map((m) => m.id).filter((x) => x !== conservar);
          if (!(await confirmar('Quitar repetidos', `Se conserva ${nombreM(g.items.find((m) => m.id === conservar))} y se eliminan ${quitar.length} repetido(s). Si al conservado le falta código, precio o línea, se le pasan.`, { okTexto: 'Quitar repetidos' }))) return;
          try { await api('POST', '/api/catalogo/medicamentos/repetidos', { grupos: [{ conservar, quitar }] }); cache = {}; router(); } catch (e) { alert(e.message); }
        } }, 'Conservar el marcado y eliminar los demás');
        return h('div', { class: 'tarjeta rep-grupo' }, h('p', {}, h('span', { class: `chip ${g.exacto ? 'alerta' : 'pendiente'}` }, g.exacto ? 'Repetido' : 'Posible repetido'), ` ${g.motivo}`), op, h('div', { class: 'acciones' }, b));
      };
      const auto = exactos.length ? h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmar('Eliminar repetidos automáticamente', `Se quitan ${exactos.reduce((n, g) => n + g.items.length - 1, 0)} medicamento(s) repetidos exactos (mismo código, o mismo nombre y presentación). En cada grupo queda el más completo.`, { okTexto: 'Eliminar repetidos' }))) return;
        try { const r = await api('POST', '/api/catalogo/medicamentos/repetidos', { auto: true }); cache = {}; aviso(`Listo: ${r.eliminados} repetido(s) eliminado(s).`, 'ok'); router(); } catch (e) { alert(e.message); }
      } }, `Eliminar automáticamente ${exactos.length} grupo(s) de repetidos exactos`) : null;
      bloques.push(S('repetidos', `Repetidos (${fmtN.format(grupos.length)})`,
        h('p', { class: 'hint' }, 'El sistema compara código, nombre y presentación sin tildes, espacios ni signos ("Tio dex, Jarabe de 120ml" y "Tio-Dex Jarabe Frasco 120 mL"). Al crear o importar, los repetidos se rechazan o se unen solos; aquí ves los que ya estaban.'),
        grupos.length ? [auto ? h('div', { class: 'acciones' }, auto) : null, ...grupos.map(tarjetaG)] : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay medicamentos repetidos'), 'El catálogo está limpio.')));
    }
    if (ES_GER()) bloques.push(S('importar', 'Importar Excel', importador('medicamentos', 'Importar medicamentos y precios', 'Columnas: Código, Medicamento / Producto y Precio Final. Si el código ya existe, se actualizan su nombre y su precio (el precio anterior queda en el historial); si no tiene código, se busca por nombre y se le pone. Puedes volver a subir la lista completa cada vez que cambien precios.', () => { cache = {}; router(); })));
  } else if (ver === 'farmacias') {
    const [fs, div] = await Promise.all([api('GET', '/api/catalogo/farmacias'), division()]);
    const fprov = param('provincia') || '';
    if (GESTION_T() || (yo.role === 'representante' && yo.position === 'Vendedor')) {
      const z = selectorZona(div.provincias, div.municipios);
      const b = h('button', { class: 'btn', type: 'submit' }, 'Agregar farmacia');
      const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nueva farmacia'),
        h('div', { class: 'form-fila' }, campo('nombre', 'Nombre'), z.fp, z.fm, campo('sector', 'Sector o distrito municipal', {}, '(opcional)'), campo('direccion', 'Dirección', {}, '(opcional)'), campo('telefono', 'Teléfono', { inputmode: 'tel' }, '(opcional)')),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/catalogo/farmacias', { nombre: f.nombre.value, provincia: z.sp.value, municipio: z.sm.value, sector: f.sector.value, direccion: f.direccion.value, telefono: f.telefono.value }))) irA('catalogo', { ver: 'farmacias' }); });
      bloques.push(S('nueva', 'Nueva farmacia', f));
    }
    const filtro = campo('fprov', 'Filtrar por provincia', { options: div.provincias.map((p) => ({ value: p, label: p })), value: fprov, placeholder: 'Todas las provincias' });
    filtro.querySelector('select').addEventListener('change', (e) => irA('catalogo', { ver: 'farmacias', provincia: e.target.value }));
    const lista = fs.items.filter((x) => !fprov || x.provincia === fprov).sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    bloques.push(S('lista', `Farmacias (${fmtN.format(lista.length)})`, h('div', { style: 'max-width:20rem;margin-bottom:1rem' }, filtro),
      tabla([{ t: 'Nombre', v: (x) => [x.nombre, x.direccion ? h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion) : null] }, { t: 'Zona', v: (x) => `${x.sector ? `${x.sector}, ` : ''}${x.municipio}, ${x.provincia}` }, { t: 'Estado', v: (x) => chip(x.estado) },
        { t: '', v: (x) => ES_GER() && x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar('farmacias', x.id) }, 'Validar') : '' }], lista, ['Aún no hay farmacias', 'Agrégalas a mano, impórtalas desde Excel o búscalas en Google Maps.'], { exportar: { nombre: 'farmacias-fersuaz', titulo: 'Farmacias' } })));
    if (GESTION_T()) bloques.push(S('importar', 'Importar Excel', importador('farmacias', 'Importar farmacias', 'Provincia y municipio deben ser oficiales. Las que ya existen en el mismo municipio no se duplican.', router)),
      S('google', 'Buscar en Google', await buscadorGoogle([['farmacia', 'Farmacias']], null)), ES_GER() ? S('auto', 'Registro automático', await registroAutomatico([['farmacia', 'Farmacias']])) : null);
  } else {
    bloques.push(...await seccionesMedicos());
  }
  return vistaS('catalogo', ['lista', 'nuevo', 'nueva', 'documento', 'repetidos', 'importar', 'google', 'auto'], 'Catálogo', 'Lo que agregan las promotoras y los vendedores queda pendiente hasta que la gerencia lo valida.', ...bloques);
};

// ---------------------------------------------------------------- médicos: lista, a mano, documento y Google
const ENLACE_RED = { instagram: 'Instagram', facebook: 'Facebook', web: 'Web' };
const redesCelda = (r = {}) => h('span', { class: 'redes' }, Object.entries(ENLACE_RED).filter(([k]) => r[k]).map(([k, t]) => h('a', { href: r[k], target: '_blank', rel: 'noopener noreferrer' }, t)));
const telMed = (t) => (t ? `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6)}` : '');
const puedeRegistrarMedico = () => ES_GER() || yo.role === 'supervisor' || (yo.role === 'representante' && ['Promotora', 'Visitador'].includes(yo.position));
/** Elegir especialidad de la lista, u "Otra" con texto libre. */
function campoEspecialidad(lista, valor = '') {
  const otra = valor && !lista.includes(valor) && valor !== 'Por confirmar';
  const sel = campo('especialidad', 'Especialidad', { options: [...lista.map((x) => ({ value: x, label: x })), { value: '__otra', label: 'Otra (la escribo)' }], value: otra ? '__otra' : valor, placeholder: 'Elige la especialidad' });
  const txt = campo('especialidadOtra', 'Cuál especialidad', { value: otra ? valor : '' });
  txt.hidden = !otra;
  sel.querySelector('select').addEventListener('change', (e) => { txt.hidden = e.target.value !== '__otra'; });
  return { nodos: [sel, txt], valor: () => (sel.querySelector('select').value === '__otra' ? txt.querySelector('input').value : sel.querySelector('select').value) };
}
/** Establecimiento donde labora (de la lista de Establecimientos) u otro lugar con provincia y municipio. */
function campoCentro(ests, div, valor = '') {
  const sel = campo('establecimientoId', 'Establecimiento donde labora', { options: [...ests.map((x) => ({ value: x.id, label: `${x.nombre} (${x.municipio}, ${x.provincia})` })), { value: '__otro', label: 'No está en la lista' }], value: valor, placeholder: 'Elige el hospital, clínica o consultorio' });
  const z = selectorZona(div.provincias, div.municipios);
  const zona = h('div', { class: 'form-fila', hidden: true }, z.fp, z.fm, h('p', { class: 'hint', style: 'flex-basis:100%' }, 'Si su centro no está, regístralo en Establecimientos para que aparezca en las rutas. Mientras, indica dónde trabaja.'));
  sel.querySelector('select').addEventListener('change', (e) => { zona.hidden = e.target.value !== '__otro'; });
  return { nodos: [sel, zona], valor: () => { const v = sel.querySelector('select').value; return v === '__otro' || !v ? { provincia: z.sp.value, municipio: z.sm.value } : { establecimientoId: v }; } };
}
async function seccionesMedicos() {
  const [mds, div, ests] = await Promise.all([api('GET', '/api/catalogo/medicos'), division(), api('GET', '/api/territorio/establecimientos').then((x) => x.items).catch(() => [])]);
  const lista = ests.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const out = [];
  // Lista
  const fprov = param('provincia') || ''; const fesp = param('especialidad') || ''; const fq = param('q') || '';
  const fp = campo('fprov', 'Provincia', { options: div.provincias.map((p) => ({ value: p, label: p })), value: fprov, placeholder: 'Todas las provincias' });
  const fe = campo('fesp', 'Especialidad', { options: [...new Set([...mds.especialidades, ...mds.items.map((m) => m.especialidad)])].sort((a, b) => a.localeCompare(b, 'es')).map((x) => ({ value: x, label: x })), value: fesp, placeholder: 'Todas' });
  const fb = campo('fq', 'Buscar', { type: 'search', value: fq, placeholder: 'Nombre, centro o teléfono' });
  const aplicar = () => irA('catalogo', Object.fromEntries(Object.entries({ ver: 'medicos', provincia: fp.querySelector('select').value, especialidad: fe.querySelector('select').value, q: fb.querySelector('input').value.trim() }).filter(([, v]) => v)));
  fp.querySelector('select').addEventListener('change', aplicar); fe.querySelector('select').addEventListener('change', aplicar);
  fb.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } });
  const k = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const vis = mds.items.filter((m) => m.estado !== 'inactivo' && (!fprov || m.provincia === fprov) && (!fesp || m.especialidad === fesp) && (!fq || k(`${m.nombre} ${m.centro ?? ''} ${m.telefono ?? ''}`).includes(k(fq.replace(/-/g, '')))));
  const editar = async (m) => {
    const d = $('#dialogo'); $('#dialogo-titulo').textContent = m.nombre;
    const esp = campoEspecialidad(mds.especialidades, m.especialidad); const cen = campoCentro(lista, div, m.establecimientoId ?? '');
    const tel = campo('telefono', 'Teléfono', { inputmode: 'tel', value: telMed(m.telefono) });
    const ig = campo('instagram', 'Instagram', { value: m.redes?.instagram ?? '', placeholder: '@usuario' }); const fbk = campo('facebook', 'Facebook', { value: m.redes?.facebook ?? '' }); const web = campo('web', 'Página web', { value: m.redes?.web ?? '' });
    $('#dialogo-cuerpo').replaceChildren(...esp.nodos, ...cen.nodos, tel, ig, fbk, web);
    $('#dialogo-ok').textContent = 'Guardar'; d.showModal();
    const ok = await new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
    if (!ok) return;
    accionPendiente = 'guardar médico';
    const c = cen.valor();
    try { await api('POST', `/api/catalogo/medicos/${m.id}`, { especialidad: esp.valor(), ...(c.establecimientoId ? { establecimientoId: c.establecimientoId } : {}), telefono: tel.querySelector('input').value, instagram: ig.querySelector('input').value, facebook: fbk.querySelector('input').value, web: web.querySelector('input').value }); } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
    router();
  };
  const validarMed = async (m) => { accionPendiente = 'validar médico'; try { await api('POST', `/api/catalogo/medicos/${m.id}/validar`); } catch (e) { alert(e.message); } router(); };
  out.push(S('lista', `Médicos (${fmtN.format(vis.length)})`, h('div', { class: 'form-fila' }, fp, fe, fb),
    tabla([{ t: 'Médico', v: (m) => [m.nombre, m.telefono ? h('small', { style: 'display:block;color:var(--texto-2)' }, telMed(m.telefono)) : null] },
      { t: 'Especialidad', v: (m) => (m.especialidad === 'Por confirmar' ? h('span', { class: 'chip pendiente' }, 'Por confirmar') : m.especialidad) },
      { t: 'Establecimiento', v: (m) => m.centro ?? '' }, { t: 'Zona', v: (m) => `${m.municipio}, ${m.provincia}` },
      { t: 'Redes', v: (m) => redesCelda(m.redes) }, { t: 'Estado', v: (m) => chip(m.estado) },
      { t: '', v: (m) => (ES_GER() ? h('div', { class: 'acciones-fila' }, m.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validarMed(m) }, 'Validar') : null, h('button', { class: 'btn-sec btn-peq btn-suave', onclick: () => editar(m) }, 'Editar')) : '') }],
    vis, ['Aún no hay médicos con estos filtros', 'Agrégalos a mano, carga un documento o usa el registro automático desde Google Maps.'], { exportar: { nombre: 'medicos-fersuaz', titulo: 'Médicos' } })));
  if (!puedeRegistrarMedico()) return out;
  // A mano
  const esp = campoEspecialidad(mds.especialidades); const cen = campoCentro(lista, div);
  const b = h('button', { class: 'btn', type: 'submit' }, 'Agregar médico');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo médico'),
    h('p', { class: 'hint' }, 'Al elegir el establecimiento donde labora, la provincia y el municipio se llenan solos. Si el médico ya está registrado, solo se completan los datos que le faltan.'),
    h('div', { class: 'form-fila' }, campo('nombre', 'Nombre completo', { placeholder: 'Sin "Dr." ni "Dra."' }), ...esp.nodos), ...cen.nodos,
    h('div', { class: 'form-fila' }, campo('telefono', 'Teléfono', { inputmode: 'tel' }, '(opcional)'), campo('instagram', 'Instagram', { placeholder: '@usuario' }, '(opcional)'), campo('facebook', 'Facebook', { placeholder: 'facebook.com/usuario' }, '(opcional)'), campo('web', 'Página web', {}, '(opcional)')),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(f, b, () => api('POST', '/api/catalogo/medicos', { nombre: f.nombre.value, especialidad: esp.valor(), ...cen.valor(), telefono: f.telefono.value, instagram: f.instagram.value, facebook: f.facebook.value, web: f.web.value }));
    if (r) { if (r.accion === 'existente') aviso('Ese médico ya estaba registrado con estos datos.', 'ok'); irA('catalogo', { ver: 'medicos' }); }
  });
  out.push(S('nuevo', 'Nuevo médico', f));
  out.push(S('documento', 'Cargar documento', formDocumentoMedicos(lista, mds)));
  if (ES_GER()) out.push(S('auto', 'Registro automático', await registroAutomatico([['medico', 'Médicos']])));
  return out;
}
/** Cargar un documento de médicos: plantilla de Excel, o PDF/foto/otra hoja leída con IA. Vista previa editable. */
function formDocumentoMedicos(ests, mds) {
  const archivo = campo('archivo', 'Archivo', { type: 'file', accept: '.xlsx,.csv,application/pdf,image/jpeg,image/png,image/webp' });
  const b = h('button', { class: 'btn-sec', type: 'submit' }, 'Leer documento');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta importador', novalidate: true }, h('h2', {}, 'Cargar un documento de médicos'),
    h('p', { class: 'hint' }, 'Sube la plantilla de Excel llena', mds.iaActiva ? ', o un PDF, una foto o cualquier lista: la inteligencia artificial la lee' : ' (la lectura de PDF y fotos con inteligencia artificial se activa cuando el servidor tenga saldo de Anthropic)', '. Revisas antes de guardar. ', h('a', { href: 'assets/plantillas/medicos.xlsx', download: true }, 'Descargar plantilla')),
    archivo, h('div', { class: 'acciones' }, b), salida);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); salida.replaceChildren();
    const file = f.archivo.files[0];
    const r = await enviar(f, b, async () => {
      if (!file) throw new ApiError(422, { error: 'Elige un archivo.', fields: { archivo: 'Elige el archivo.' } });
      if (file.size > 6 * 1024 * 1024) throw new ApiError(413, { error: 'El archivo no puede pasar de 6 MB.', fields: { archivo: 'Archivo demasiado grande.' } });
      return api('POST', '/api/medicos/documento/leer', { archivo: { nombre: file.name, tipo: file.type, base64: await archivoB64(file) } });
    });
    if (!r) return;
    const filas = r.filas.map((x) => ({ ...x, incluir: !x.existe && !x.repetidoEn }));
    const nYa = filas.filter((x) => x.existe).length; const nRep = filas.filter((x) => !x.existe && x.repetidoEn).length;
    const opcionesEst = (x) => [...x.opciones, ...ests.filter((y) => !x.opciones.some((o) => o.id === y.id))];
    const guardar = h('button', { class: 'btn', type: 'button' });
    const contar = () => { const n = filas.filter((x) => x.incluir).length; guardar.textContent = `Guardar ${fmtN.format(n)} médico(s)`; guardar.disabled = !n; };
    const cuerpo = tabla([
      { t: '', v: (x) => h('input', { type: 'checkbox', checked: x.incluir, disabled: !!(x.existe || x.repetidoEn), 'aria-label': `Incluir ${x.nombre}`, onchange: (ev) => { x.incluir = ev.target.checked; contar(); } }) },
      { t: 'Médico', v: (x) => [x.nombre, x.telefono ? h('small', { style: 'display:block;color:var(--texto-2)' }, telMed(x.telefono)) : null, x.existe ? h('span', { class: 'chip pendiente', style: 'margin-top:.25rem' }, 'Ya registrado: no se carga') : x.repetidoEn ? h('span', { class: 'chip pendiente', style: 'margin-top:.25rem' }, `Repetido de la fila ${x.repetidoEn}`) : h('span', { class: 'chip ok', style: 'margin-top:.25rem' }, 'Nuevo'), ...x.avisos.map((t) => h('small', { style: 'display:block;color:var(--texto-2)' }, t))] },
      { t: 'Especialidad', v: (x) => { const s = h('select', { 'aria-label': `Especialidad de ${x.nombre}`, onchange: (ev) => { x.especialidad = ev.target.value; } }, h('option', { value: '' }, 'Por confirmar'), ...[...new Set([...(x.especialidad ? [x.especialidad] : []), ...mds.especialidades])].map((y) => h('option', { value: y, selected: y === x.especialidad }, y))); return s; } },
      { t: 'Establecimiento', v: (x) => h('select', { 'aria-label': `Establecimiento de ${x.nombre}`, onchange: (ev) => { const est = ests.find((y) => y.id === ev.target.value); x.establecimientoId = est?.id ?? null; if (est) { x.provincia = est.provincia; x.municipio = est.municipio; } } },
        h('option', { value: '' }, x.municipio ? `Sin establecimiento (${x.municipio})` : 'Sin establecimiento'), ...opcionesEst(x).slice(0, 400).map((y) => h('option', { value: y.id, selected: y.id === x.establecimientoId }, `${y.nombre} (${y.municipio})`))) },
      { t: 'Redes', v: (x) => redesCelda(x.redes) }], filas, ['', ''], { porPagina: 50 });
    guardar.addEventListener('click', async () => {
      const sel = filas.filter((x) => x.incluir);
      if (!(await confirmar('Guardar médicos', `Se cargarán ${sel.length} médico(s) nuevo(s). Los que ya están registrados no se cargan ni se cambian.`, { okTexto: 'Guardar' }))) return;
      guardar.disabled = true; guardar.textContent = 'Guardando…';
      try {
        const ok = await api('POST', '/api/medicos/documento/confirmar', { filas: sel, fuente: r.fuente, soloNuevos: true });
        salida.replaceChildren(...[h('div', { class: 'aviso ok' }, `Listo: ${fmtN.format(ok.resumen.creado)} nuevo(s), ${fmtN.format(ok.resumen.completado)} completado(s), ${fmtN.format(ok.resumen.existente)} sin cambios${ok.resumen.error ? `, ${fmtN.format(ok.resumen.error)} con error` : ''}.`),
          ok.errores.length ? h('ul', { class: 'hint' }, ok.errores.map((x) => h('li', {}, `${x.nombre}: ${x.error}`))) : null, h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#representantes?ver=cartera' }, 'Asignar médicos a visitadores'), h('a', { class: 'btn-sec', href: '#catalogo?ver=medicos' }, 'Ver la lista'))].filter(Boolean));
      } catch (err) { guardar.disabled = false; contar(); salida.prepend(h('div', { class: 'aviso error' }, err.message)); }
    });
    contar();
    salida.replaceChildren(...[h('p', { class: 'hint' }, `${fmtN.format(filas.length)} médico(s) leídos${r.fuente === 'ia' ? ' con inteligencia artificial: revisa bien cada fila' : ' de la plantilla'}: ${fmtN.format(filas.length - nYa - nRep)} nuevo(s), ${fmtN.format(nYa)} ya registrado(s)${nRep ? `, ${fmtN.format(nRep)} repetido(s) en el archivo` : ''}. Solo se cargan los nuevos.`), r.notas ? h('div', { class: 'aviso' }, `Nota de la lectura: ${r.notas}`) : null, cuerpo, h('div', { class: 'acciones' }, guardar)].filter(Boolean));
  });
  return f;
}

V.establecimientos = async () => {
  const [div, mias] = await Promise.all([division(), api('GET', '/api/territorio/mis-provincias')]);
  const provincias = mias.items;
  if (!provincias.length) return vista('Establecimientos', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Aún no tienes provincias asignadas'), 'Pide a tu supervisor que te asigne las provincias que visitas.'));
  // Filtros de varias opciones a la vez: provincias, municipios y tipos (en la dirección, separados por coma).
  const lst = (k) => (param(k) || '').split(',').filter(Boolean);
  const fprovs = lst('provincia').length ? lst('provincia') : provincias.length === 1 ? [provincias[0]] : [];
  const fmuns = lst('municipio'); const ftipos = lst('tipo');
  const fprov = fprovs.length === 1 ? fprovs[0] : ''; const fmun = fmuns.length === 1 ? fmuns[0] : '';
  const fver = GESTION_T() && ['revisar', 'descartados'].includes(param('ver')) ? param('ver') : '';
  const qs = new URLSearchParams(Object.entries({ provincia: fprovs.join(','), municipio: fmuns.join(','), tipo: ftipos.join(','), ver: fver }).filter(([, v]) => v));
  const { items } = await api('GET', `/api/territorio/establecimientos?${qs}`);
  const tipos = Object.entries(div.tipos);
  const ir = (cambio) => irA('establecimientos', Object.fromEntries(Object.entries({ sec: 'lista', provincia: fprovs.join(','), municipio: fmuns.join(','), tipo: ftipos.join(','), ver: fver, ...cambio }).filter(([, v]) => v)));
  const msProv = multiSel({ id: 'fprov', etiqueta: 'Provincias', opciones: provincias.map((p) => ({ value: p, label: p })), valores: fprovs, todas: 'Todas mis provincias', plural: 'provincias',
    alCambiar: (vs) => { const munsOk = fmuns.filter((m) => vs.some((p) => (div.municipios[p] ?? []).includes(m))); ir({ provincia: vs.join(','), municipio: munsOk.join(',') }); } });
  const provsMun = fprovs.length ? fprovs : provincias;
  const msMun = multiSel({ id: 'fmun', etiqueta: 'Municipios', opciones: provsMun.flatMap((p) => (div.municipios[p] ?? []).map((m) => ({ value: m, label: m, grupo: provsMun.length > 1 ? p : null }))), valores: fmuns, todas: 'Todos los municipios', plural: 'municipios',
    alCambiar: (vs) => ir({ municipio: vs.join(',') }) });
  const msTipo = multiSel({ id: 'ftipo', etiqueta: 'Tipos', opciones: tipos.map(([value, label]) => ({ value, label })), valores: ftipos, todas: 'Todos los tipos', plural: 'tipos', alCambiar: (vs) => ir({ tipo: vs.join(',') }) });
  const fv = GESTION_T() ? campo('fver', 'Mostrar', { options: [{ value: '', label: 'Todos los activos' }, { value: 'revisar', label: 'Posibles errores de Google' }, { value: 'descartados', label: 'No son centros de salud' }], value: fver }) : null;
  fv?.querySelector('select').addEventListener('change', (e) => ir({ ver: e.target.value }));
  const fz = { fp: msProv, fm: msMun }; const ft = msTipo;
  const z = selectorZona(provincias, div.municipios, { provincia: fprov, municipio: fmun });
  const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar establecimiento');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo establecimiento'),
    h('div', { class: 'form-fila' }, campo('tipo', 'Tipo', { options: tipos.map(([value, label]) => ({ value, label })) }), campo('nombre', 'Nombre'), z.fp, z.fm, campo('sector', 'Sector o distrito municipal', {}, '(opcional)'), campo('direccion', 'Dirección', {}, '(opcional)'), campo('telefono', 'Teléfono', { inputmode: 'tel' }, '(opcional)')),
    h('p', { class: 'hint' }, GESTION_T() ? 'Queda validado de inmediato.' : 'Queda pendiente hasta que tu supervisor lo valide.'), h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/territorio/establecimientos', { tipo: f.tipo.value, nombre: f.nombre.value, provincia: z.sp.value, municipio: z.sm.value, sector: f.sector.value, direccion: f.direccion.value, telefono: f.telefono.value }))) irA('establecimientos', {}); });
  const validar = async (x) => { try { await api('POST', `/api/territorio/establecimientos/${x.id}/validar`); router(); } catch (e) { alert(e.message); } };
  // "No es un centro de salud": por fila o varios marcados a la vez. Se puede restaurar.
  const marcados = new Set();
  const bDesc = h('button', { class: 'btn-sec', type: 'button', disabled: true }, 'Marcar como no es centro de salud');
  // Marcar todos: los de la lista con los filtros actuales (todas las páginas).
  const marcaTodosE = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los de la lista' });
  const contar = () => {
    bDesc.disabled = !marcados.size; bDesc.textContent = marcados.size ? `Marcar ${fmtN.format(marcados.size)} como no es centro de salud` : 'Marcar como no es centro de salud';
    marcaTodosE.checked = marcados.size > 0 && marcados.size === items.length; marcaTodosE.indeterminate = marcados.size > 0 && marcados.size < items.length;
  };
  marcaTodosE.addEventListener('change', () => { if (marcaTodosE.checked) items.forEach((x) => marcados.add(x.id)); else marcados.clear(); document.querySelectorAll('input[data-marca]').forEach((c) => { c.checked = marcados.has(c.dataset.marca); }); contar(); });
  const descartar = async (ids) => {
    if (!(await confirmar('No es un centro de salud', `${fmtN.format(ids.length)} registro(s) saldrán de las zonas, los cronogramas y las propuestas. El registro automático no los volverá a traer. Puedes restaurarlos en "No son centros de salud".`, { okTexto: 'Marcar' }))) return;
    try { await api('POST', '/api/territorio/establecimientos/descartar', { ids }); router(); } catch (e) { alert(e.message); }
  };
  bDesc.addEventListener('click', () => descartar([...marcados]));
  const restaurar = async (x) => { try { await api('POST', `/api/territorio/establecimientos/${x.id}/restaurar`); router(); } catch (e) { alert(e.message); } };
  const columnas = [
    ...(GESTION_T() && fver !== 'descartados' ? [{ t: marcaTodosE, etiqueta: 'Marcar', v: (x) => h('input', { type: 'checkbox', class: 'marca', 'data-marca': x.id, 'aria-label': `Marcar ${x.nombre}`, checked: marcados.has(x.id), onchange: (e) => { e.target.checked ? marcados.add(x.id) : marcados.delete(x.id); contar(); } }) }] : []),
    { t: 'Nombre', v: (x) => [x.nombre, x.revisar && GESTION_T() ? h('span', { class: 'chip pendiente', style: 'margin-left:.5rem' }, 'Revisar') : null, x.direccion ? h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion) : null] },
    { t: 'Tipo', v: (x) => div.tipos[x.tipo] }, { t: 'Zona', v: (x) => `${x.sector ? `${x.sector}, ` : ''}${x.municipio}, ${x.provincia}` },
    { t: 'Estado', v: (x) => (x.estado === 'inactivo' ? [h('span', { class: 'chip anulado' }, 'No es centro de salud'), x.descarteMotivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, x.descarteMotivo) : null] : chip(x.estado)) },
    { t: '', v: (x) => !GESTION_T() ? '' : x.estado === 'inactivo' ? h('button', { class: 'btn-sec btn-peq', onclick: () => restaurar(x) }, 'Restaurar')
      : [x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar(x) }, 'Validar') : null, h('button', { class: 'btn-enlace', onclick: () => descartar([x.id]) }, 'No es centro de salud')] },
  ];
  const vacioTxt = fver === 'revisar' ? ['No hay posibles errores con estos filtros', 'Todos los nombres parecen de centros de salud.'] : fver === 'descartados' ? ['Nada descartado', 'Aquí aparecen los registros que marques como "no es centro de salud".'] : ['No hay establecimientos con estos filtros', 'Regístralos en "Nuevo"; tu supervisor también puede importarlos desde Excel.'];
  const bloques = [S('nuevo', 'Nuevo', f), S('lista', `Registrados (${fmtN.format(items.length)})`, h('div', { class: 'form-fila' }, fz.fp, fz.fm, ft, fv),
    fver === 'revisar' ? h('div', { class: 'aviso' }, 'Nombres que parecen una dirección, un negocio ajeno (spa, hotel, colmado…) o que no dicen ser de salud. Revisa y marca los que no son centros de salud; los que sí lo son, déjalos.') : null,
    GESTION_T() && fver !== 'descartados' ? h('div', { class: 'acciones', style: 'margin:0 0 .75rem' }, bDesc) : null,
    tabla(columnas, items, vacioTxt, { exportar: { nombre: 'establecimientos-fersuaz', titulo: 'Establecimientos de salud' } }))];
  if (GESTION_T()) bloques.push(S('importar', 'Importar Excel', importador('establecimientos', 'Importar clínicas, hospitales, UNAP y centros', 'Tipo, nombre, provincia y municipio son obligatorios. Los que ya existen en el mismo municipio no se duplican.', router)),
    S('google', 'Buscar en Google', await buscadorGoogle(tipos, null)), ES_GER() ? S('auto', 'Registro automático', await registroAutomatico([['salud', 'Hospitales, clínicas, UNAP y centros de primer nivel (todo junto)'], ...tipos])) : null);
  return vistaS('establecimientos', ['lista', 'nuevo', 'importar', 'google', 'auto'], 'Establecimientos', 'Clínicas, hospitales, UNAP y centros de primer nivel por municipio. Se usan como paradas exactas de las jornadas.', ...bloques);
};

/** Precio de referencia por noche (por provincia y general), para las noches fuera sin hotel verificado. */
async function formReferenciaHotel(div) {
  const { item: ref } = await api('GET', '/api/viaticos/hotel-referencia');
  const general = campo('global', 'Precio general por noche (RD$)', { type: 'number', min: 1, step: 0.01, inputmode: 'decimal', value: ref.global ?? '' }, '(se usa donde la provincia no tiene precio)');
  const filas = h('div', { class: 'ref-provincias' }, div.provincias.map((p) => h('label', {}, h('span', {}, p), h('input', { type: 'number', min: 1, step: 0.01, inputmode: 'decimal', name: `prov-${p}`, dataset: { prov: p }, value: ref.porProvincia?.[p] ?? '', placeholder: ref.global ? `General: ${fmtN.format(ref.global)}` : 'Sin precio', 'aria-label': `Precio por noche en ${p}` }))));
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar precios de referencia');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Precio de referencia por noche'),
    h('p', { class: 'hint' }, 'Cuando un día del cronograma está marcado "duerme fuera", la noche entra al presupuesto así: primero el hotel verificado más económico del municipio o la provincia; si no hay, el precio de referencia de la provincia; si tampoco, el general. Cuando el representante crea su jornada, usa el hotel real.'),
    general, h('p', { class: 'error', dataset: { for: 'global' } }), filas, h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const porProvincia = Object.fromEntries([...filas.querySelectorAll('input')].filter((x) => x.value !== '').map((x) => [x.dataset.prov, x.value]));
    if (await enviar(f, b, () => api('POST', '/api/viaticos/hotel-referencia', { global: f.global.value, porProvincia }))) router();
  });
  return f;
}

V.hoteles = async () => {
  const [div, { items: reqs }] = await Promise.all([division(), api('GET', '/api/hoteles/requisitos')]);
  const fprov = param('provincia') || ''; const fmun = param('municipio') || '';
  const qs = new URLSearchParams(Object.entries({ provincia: fprov, municipio: fmun }).filter(([, v]) => v));
  const [{ items }, rec] = await Promise.all([api('GET', `/api/hoteles?${qs}`), fprov ? api('GET', `/api/hoteles/recomendado?${qs}`).then((x) => x.item) : null]);
  const fz = selectorZona(div.provincias, div.municipios, { provincia: fprov, municipio: fmun, prefijo: 'f' });
  fz.sp.options[0].textContent = 'Todas las provincias'; if (fz.sp.value) fz.sm.options[0].textContent = 'Todos los municipios';
  const aplicar = () => irA('hoteles', Object.fromEntries(Object.entries({ provincia: fz.sp.value, municipio: fz.sm.value }).filter(([, v]) => v)));
  fz.sp.addEventListener('change', aplicar); fz.sm.addEventListener('change', aplicar);
  const editar = async (x) => {
    const d = $('#dialogo'); $('#dialogo-titulo').textContent = x.nombre;
    const precio = h('input', { id: 'h-precio', type: 'number', min: 1, step: 0.01, inputmode: 'decimal', value: x.precioNoche ?? '' });
    const cajas = reqs.map((r) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `req-${r.value}`, checked: x.requisitos?.[r.value] === true }), h('span', {}, r.label)));
    const notas = h('textarea', { id: 'h-notas', rows: 2 }, x.notas ?? '');
    const inactivo = h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'h-inactivo', checked: x.estado === 'inactivo' }), h('span', {}, 'No usar este hotel'));
    const des = camposDesayuno(x); const fis = camposFiscal(x, precio);
    $('#dialogo-cuerpo').replaceChildren(h('p', { class: 'hint' }, `${x.municipio}, ${x.provincia}${x.telefono ? `. Teléfono ${x.telefono}` : ''}. Confirma el precio y marca solo lo que hayas verificado por llamada o visita.`),
      h('label', { for: 'h-precio', class: 'hint' }, 'Precio por noche RD$'), precio, fis.nodo, des.nodo, h('div', { class: 'dialogo-checks' }, cajas), h('label', { for: 'h-notas', class: 'hint' }, 'Notas'), notas, inactivo);
    $('#dialogo-ok').textContent = 'Guardar'; d.showModal();
    const ok = await new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
    if (!ok) return;
    const requisitos = Object.fromEntries(reqs.map((r) => [r.value, d.querySelector(`input[name="req-${r.value}"]`).checked]));
    try { await api('POST', `/api/hoteles/${x.id}`, { precioNoche: precio.value || null, requisitos, notas: notas.value, ...des.leer(), ...fis.leer(), estado: d.querySelector('input[name=h-inactivo]').checked ? 'inactivo' : 'activo' }); } catch (e) { alert(e.message); }
    router();
  };
  const bloques = [];
  if (rec) bloques.push(h('div', { class: 'tarjeta recomendado' }, h('h2', {}, 'Recomendado'), h('p', {}, h('strong', {}, rec.hotel.nombre), ` en ${rec.hotel.municipio}: ${RD(rec.hotel.precioNoche)} por noche. Es el más económico ${rec.alcance === 'municipio' ? 'del municipio' : 'de la provincia'} que cumple todos los requisitos.`)));
  else if (fprov) bloques.push(h('div', { class: 'aviso' }, `Aún no hay un hotel verificado en ${fmun || fprov} que cumpla todos los requisitos.`));
  bloques.push(S('lista', `Hoteles (${fmtN.format(items.length)})`, h('div', { class: 'form-fila' }, fz.fp, fz.fm),
    tabla([
      { t: 'Hotel', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, [x.direccion, x.telefono].filter(Boolean).join('. '))] },
      { t: 'Zona', v: (x) => `${x.municipio}, ${x.provincia}` },
      { t: 'Calificación', num: true, v: (x) => x.calificacion != null ? `${fmtN.format(x.calificacion)} de 5` : '' },
      { t: 'Por noche', num: true, v: (x) => [x.precioNoche ? RD(x.precioFinal ?? x.precioNoche) : 'Sin confirmar', x.itbis ? h('small', { style: 'display:block;color:var(--texto-2)' }, `${RD(x.precioNoche)} + ITBIS`) : x.comprobanteFiscal ? h('small', { style: 'display:block;color:var(--texto-2)' }, 'Con comprobante, ITBIS incluido') : null, x.desayunoIncluido ? h('small', { style: 'display:block;color:var(--celeste-texto)' }, x.valorDesayuno ? `Con desayuno (${RD(x.valorDesayuno)})` : 'Con desayuno') : null] },
      { t: 'Requisitos', v: (x) => x.estado === 'inactivo' ? h('span', { class: 'chip anulado' }, 'No usar') : x.cumple ? h('span', { class: 'chip validado' }, 'Cumple todo') : h('span', { class: 'chip pendiente', title: x.faltan.map((k) => reqs.find((r) => r.value === k)?.label).join(', ') }, `Faltan ${x.faltan.length}`) },
      { t: '', v: (x) => ES_GER() ? h('button', { class: 'btn-sec btn-peq', onclick: () => editar(x) }, x.precioNoche ? 'Editar' : 'Confirmar') : '' },
    ], items, ['No hay hoteles con estos filtros', ES_GER() ? 'Tráelos de Google Maps en "Registro automático".' : 'La administración los registra y verifica.'], { exportar: { nombre: 'hoteles-fersuaz', titulo: 'Hoteles' } })));
  if (ES_GER()) bloques.push(S('referencia', 'Precio de referencia', await formReferenciaHotel(div)), S('google', 'Buscar en Google', await buscadorGoogle([['hotel', 'Hoteles']], null)), S('auto', 'Registro automático', await registroAutomatico([['hotel', 'Hoteles']])));
  return vistaS('hoteles', ['lista', 'referencia', 'google', 'auto'], 'Hoteles', 'Para el hospedaje de los representantes. Google Maps trae los hoteles; la administración confirma precio y requisitos: servicios básicos, aire, agua, cama cómoda, higiene, parqueo y seguridad. Se recomienda el más económico que cumple todo.', ...bloques);
};

// ---------------------------------------------------------------- vehículo del representante (EPA o a mano) o transporte público
const TIPOS_VEH = [['carro', 'Carro'], ['jeepeta', 'Jeepeta'], ['camioneta', 'Camioneta'], ['motocicleta', 'Motocicleta']];
const TARIFAS_PUB = [['transporteDentro', 'Transporte dentro de su zona'], ['comidaDentro', 'Comida dentro de su zona'], ['transporteFuera', 'Transporte fuera de su zona'], ['comidaFuera', 'Comida fuera de su zona']];
const POSICIONES = ['Visitador', 'PVC', 'Vendedor', 'Promotora'];
/** Monto que le tocaría a una posición según la configuración (por posición o global). */
const montoBase = (g, pos, k) => (g?.modo === 'global' || !pos ? g?.global?.[k] : g?.porPosicion?.[pos]?.[k]) ?? null;
/**
 * Campos del vehículo. Con vehículo: año, marca, modelo y versión desde FuelEconomy.gov (EPA) completan el
 * rendimiento en km por galón; si no aparece (p. ej., motocicleta o modelo que no se vende en EE. UU.), se escribe a mano.
 * Sin vehículo: transporte público, con montos propios opcionales (vacío = monto global).
 */
function formularioVehiculo(pf, combs, globales, posicion) {
  const v = pf?.vehiculo ?? {};
  let tiene = v.propiedad ? v.propiedad !== 'ninguno' : true;
  let epaId = v.epaId ?? null; let fuente = v.rendimientoFuente ?? (v.epaId ? 'epa' : 'manual');
  const radio = (valor, texto, detalle) => h('label', { class: 'opcion-tarjeta' }, h('input', { type: 'radio', name: 'tieneVehiculo', value: valor, checked: (valor === 'si') === tiene }), h('span', {}, h('strong', {}, texto), h('small', {}, detalle)));
  const eleccion = h('div', { class: 'opciones-tarjeta', role: 'radiogroup', 'aria-label': '¿Tiene vehículo?' },
    radio('si', 'Tiene vehículo', 'Se calcula el combustible por los km del cronograma.'), radio('no', 'No tiene vehículo', 'Transporte público: transporte y comida por día, dentro o fuera de su zona.'));

  // --- con vehículo
  const fProp = campo('vehiculo.propiedad', 'Propiedad', { options: [{ value: 'asignado', label: 'Asignado por FERSUAZ' }, { value: 'propio', label: 'Propio' }], value: v.propiedad && v.propiedad !== 'ninguno' ? v.propiedad : 'asignado' });
  const fTipo = campo('vehiculo.tipo', 'Tipo de vehículo', { options: TIPOS_VEH.map(([value, label]) => ({ value, label })), value: v.tipo ?? 'carro' });
  const sAnio = h('select', { id: 'epa-anio' }, h('option', { value: '' }, 'Año'));
  const sMarca = h('select', { id: 'epa-marca', disabled: true }, h('option', { value: '' }, 'Marca'));
  const sModelo = h('select', { id: 'epa-modelo', disabled: true }, h('option', { value: '' }, 'Modelo'));
  const VACIA_VER = 'Elige motor y caja de cambios';
  const sVersion = h('select', { id: 'epa-version', disabled: true }, h('option', { value: '' }, VACIA_VER));
  const lab = (id, t) => h('label', { for: id }, t);
  const epaNota = h('p', { class: 'hint', 'aria-live': 'polite' });
  const manualCaja = h('input', { type: 'checkbox', id: 'veh-manual', checked: Boolean(v.marca) && !v.epaId });
  const fMarca = campo('vehiculo.marca', 'Marca', { value: v.marca ?? '' }); const fModelo = campo('vehiculo.modelo', 'Modelo', { value: v.modelo ?? '' });
  const fAnio = campo('vehiculo.anio', 'Año', { type: 'number', min: 1980, max: Number(hoy().slice(0, 4)) + 1, value: v.anio ?? '', inputmode: 'numeric' });
  const manualRef = h('div'); const agHueco = h('div');
  const manual = h('div', { hidden: !manualCaja.checked }, h('div', { class: 'form-fila' }, fMarca, fModelo, fAnio), manualRef);
  const fComb = campo('vehiculo.combustible', 'Combustible', { options: combs, value: v.combustible });
  const fRend = campo('vehiculo.rendimiento', 'Kilómetros por galón', { type: 'number', min: 1, step: 0.1, value: v.rendimiento ?? '', inputmode: 'decimal' });
  const fPlaca = campo('vehiculo.placa', 'Placa', { value: v.placa ?? '' }, '(opcional)');
  fRend.querySelector('input').addEventListener('input', () => { fuente = 'manual'; epaNota.textContent = 'Rendimiento escrito a mano.'; });
  // Referencia automática de km por galón para lo escrito a mano (marca, modelo y año)
  const refCaja = h('div', { class: 'referencia', 'aria-live': 'polite' });
  const bRef = h('button', { type: 'button', class: 'btn-sec' }, 'Buscar referencia de km por galón');
  bRef.addEventListener('click', () => buscarReferencia({ marca: fMarca.querySelector('input').value, modelo: fModelo.querySelector('input').value, anio: fAnio.querySelector('input').value }, bRef, refCaja,
    (km, texto) => { fRend.querySelector('input').value = km; fuente = 'manual'; epaNota.textContent = `Rendimiento tomado de la referencia: ${texto}. Ajústalo si conoces el real.`; }));
  manualRef.append(h('div', { class: 'acciones', style: 'margin-top:0' }, bRef), refCaja);
  const epa = h('div', { class: 'epa', hidden: manualCaja.checked },
    h('p', { class: 'hint' }, 'Elige año, marca, modelo y versión: el sistema completa los kilómetros por galón con el dato oficial de FuelEconomy.gov (EPA). Puedes ajustarlo al rendimiento real.'),
    h('div', { class: 'epa-fila' }, h('div', { class: 'field' }, lab('epa-anio', 'Año'), sAnio), h('div', { class: 'field' }, lab('epa-marca', 'Marca'), sMarca), h('div', { class: 'field' }, lab('epa-modelo', 'Modelo'), sModelo), h('div', { class: 'field epa-version' }, lab('epa-version', 'Versión'), sVersion)),
    h('p', { class: 'hint epa-ayuda' }, '¿Qué es la versión? Es el motor y la caja de cambios de ese modelo (por ejemplo, "Automática de 6 velocidades, 4 cilindros, motor de 2.4 L"). Lo dice la matrícula o el manual. Si no lo sabes, elige la más común: la diferencia en km por galón suele ser pequeña.'),
    agHueco);
  const llenar = (sel, items, vacio) => { sel.replaceChildren(h('option', { value: '' }, vacio), ...items.map((x) => (typeof x === 'string' ? h('option', { value: x }, x) : h('option', { value: x.id }, x.texto)))); sel.disabled = !items.length; };
  const fallo = (e) => { epaNota.textContent = `${e.message} Marca "No está en la lista" para escribirlo a mano.`; };
  let cargado = false;
  async function cargarAnios() {
    if (cargado) return; cargado = true;
    try { llenar(sAnio, (await api('GET', '/api/vehiculos/anios')).items, 'Año'); if (v.anio && !manualCaja.checked) sAnio.value = String(v.anio); } catch (e) { fallo(e); }
  }
  sAnio.addEventListener('change', async () => { llenar(sMarca, [], 'Marca'); llenar(sModelo, [], 'Modelo'); llenar(sVersion, [], VACIA_VER); if (!sAnio.value) return; try { llenar(sMarca, (await api('GET', `/api/vehiculos/marcas?anio=${sAnio.value}`)).items, 'Marca'); } catch (e) { fallo(e); } });
  let agregadosModelo = [];
  async function cargarModelos(elegir) {
    llenar(sModelo, [], 'Modelo'); llenar(sVersion, [], VACIA_VER); agregarCaja.hidden = true; if (!sMarca.value) return;
    try {
      const r = await api('GET', `/api/vehiculos/modelos?anio=${sAnio.value}&marca=${encodeURIComponent(sMarca.value)}`);
      agregadosModelo = r.agregados ?? [];
      llenar(sModelo, r.items, 'Modelo');
      for (const a of agregadosModelo) sModelo.append(h('option', { value: `agregado:${a.id}` }, `${a.modelo}${a.version ? ` ${a.version}` : ''} (agregado)`));
      sModelo.append(h('option', { value: '__agregar' }, '+ Agregar un modelo que no aparece'));
      sModelo.disabled = false;
      if (elegir) { sModelo.value = elegir; sModelo.dispatchEvent(new Event('change')); }
    } catch (e) { fallo(e); }
  }
  sMarca.addEventListener('change', () => cargarModelos());
  // Formulario para agregar un modelo (queda guardado para todos)
  const agModelo = campo('ag-modelo', 'Modelo', { autocomplete: 'off', placeholder: 'Ejemplo: K5' });
  const agVersion = campo('ag-version', 'Motor (opcional)', { autocomplete: 'off', placeholder: 'Ejemplo: 2.0 L automática' });
  const agKm = campo('ag-km', 'Kilómetros por galón', { type: 'number', min: 1, step: 0.1, inputmode: 'decimal' });
  const agRef = h('div', { class: 'referencia', 'aria-live': 'polite' });
  const bAgRef = h('button', { type: 'button', class: 'btn-sec' }, 'Buscar referencia');
  const bAg = h('button', { type: 'button', class: 'btn' }, 'Guardar modelo');
  const agAviso = h('p', { class: 'aviso-ag', role: 'alert', hidden: true });
  bAgRef.addEventListener('click', () => buscarReferencia({ marca: sMarca.value, modelo: agModelo.querySelector('input').value, anio: sAnio.value }, bAgRef, agRef, (km) => { agKm.querySelector('input').value = km; }));
  bAg.addEventListener('click', async () => {
    bAg.disabled = true; agAviso.hidden = true;
    try {
      const { item } = await api('POST', '/api/vehiculos/agregados', { anio: sAnio.value, marca: sMarca.value, modelo: agModelo.querySelector('input').value, version: agVersion.querySelector('input').value, kmPorGalon: agKm.querySelector('input').value, combustible: fComb.querySelector('select').value });
      agModelo.querySelector('input').value = ''; agVersion.querySelector('input').value = ''; agKm.querySelector('input').value = ''; agRef.replaceChildren();
      await cargarModelos(`agregado:${item.id}`);
    } catch (e) { agAviso.hidden = false; agAviso.textContent = e.fields ? Object.values(e.fields).join(' ') : e.message; }
    bAg.disabled = false;
  });
  const agregarCaja = h('div', { class: 'agregar-modelo', hidden: true },
    h('h4', {}, 'Agregar un modelo que no aparece'),
    h('p', { class: 'hint' }, 'Queda guardado para este año y marca, y lo verán todos al registrar otro vehículo igual.'),
    h('div', { class: 'form-fila' }, agModelo, agVersion, agKm), h('div', { class: 'acciones' }, bAgRef, bAg), agRef, agAviso);
  agHueco.append(agregarCaja);
  sModelo.addEventListener('change', async () => {
    llenar(sVersion, [], VACIA_VER); agregarCaja.hidden = sModelo.value !== '__agregar'; if (!sModelo.value) return;
    if (sModelo.value === '__agregar') { sVersion.disabled = true; agModelo.querySelector('input').focus(); return; }
    if (sModelo.value.startsWith('agregado:')) {
      const a = agregadosModelo.find((x) => `agregado:${x.id}` === sModelo.value); if (!a) return;
      sVersion.disabled = true; epaId = null; fuente = 'manual';
      fRend.querySelector('input').value = a.kmPorGalon;
      if (a.combustible && combs.some((c) => c.value === a.combustible)) fComb.querySelector('select').value = a.combustible;
      fMarca.querySelector('input').value = a.marca; fModelo.querySelector('input').value = a.modelo; fAnio.querySelector('input').value = a.anio;
      epaNota.textContent = `${a.marca} ${a.modelo} ${a.anio}: ${fmtN.format(a.kmPorGalon)} km por galón (modelo agregado por la gestión). Puedes ajustarlo.`;
      return;
    }
    try { const vs = (await api('GET', `/api/vehiculos/versiones?anio=${sAnio.value}&marca=${encodeURIComponent(sMarca.value)}&modelo=${encodeURIComponent(sModelo.value)}`)).items; llenar(sVersion, vs, VACIA_VER); if (vs.length === 1) { sVersion.value = vs[0].id; sVersion.dispatchEvent(new Event('change')); } } catch (e) { fallo(e); }
  });
  sVersion.addEventListener('change', async () => {
    if (!sVersion.value) return;
    try {
      const f = (await api('GET', `/api/vehiculos/ficha/${sVersion.value}`)).item;
      fRend.querySelector('input').value = f.kmPorGalon; epaId = f.id; fuente = 'epa';
      if (f.combustible && combs.some((c) => c.value === f.combustible)) fComb.querySelector('select').value = f.hibrido ? 'hibrido' : f.combustible;
      fMarca.querySelector('input').value = f.marca; fModelo.querySelector('input').value = f.modelo; fAnio.querySelector('input').value = f.anio;
      epaNota.textContent = `${f.marca} ${f.modelo} ${f.anio} (${f.motor}): ${fmtN.format(f.mpgCombinado)} millas por galón combinado según la EPA = ${fmtN.format(f.kmPorGalon)} km por galón.${f.kmPorGalonCiudad ? ` En ciudad: ${fmtN.format(f.kmPorGalonCiudad)} km por galón.` : ''}`;
    } catch (e) { fallo(e); }
  });
  manualCaja.addEventListener('change', () => { manual.hidden = !manualCaja.checked; epa.hidden = manualCaja.checked; if (manualCaja.checked) { epaId = null; fuente = 'manual'; } else cargarAnios(); });
  if (v.epaId) epaNota.textContent = `Rendimiento de FuelEconomy.gov (EPA): ${[v.marca, v.modelo, v.anio].filter(Boolean).join(' ')}, ${fmtN.format(v.rendimiento)} km por galón.`;
  const conVehiculo = h('div', { class: 'grupo-vehiculo' }, h('div', { class: 'form-fila' }, fProp, fTipo), epa,
    h('label', { class: 'check' }, manualCaja, h('span', {}, 'No está en la lista (motocicleta o modelo que no se vende en EE. UU.): escribirlo a mano')), manual, epaNota,
    h('div', { class: 'form-fila' }, fComb, fRend, fPlaca));

  // --- sin vehículo: transporte público
  const pub = pf?.publico ?? {};
  const sinVehiculo = h('div', { class: 'grupo-vehiculo' }, h('p', { class: 'hint' }, `Montos por día. Déjalos vacíos para usar los de ${globales?.modo === 'global' ? 'todas las posiciones' : posicion ? `la posición ${posicion}` : 'su posición'}; escribe uno solo si este representante tiene un monto distinto. "Dentro" es su zona de trabajo; "fuera", cualquier lugar fuera de ella.`),
    h('div', { class: 'form-fila' }, ...TARIFAS_PUB.map(([k, l]) => { const b = montoBase(globales, posicion, k); return campo(`publico.${k}`, `${l} (por día)`, { type: 'number', min: 0, step: 0.01, value: pub[k] ?? '', inputmode: 'decimal', placeholder: b != null ? `Según posición: ${RD(b)}` : (globales?.modo === 'global' || posicion ? 'Sin monto configurado' : 'Según su posición') }); })));
  const pintar = () => { conVehiculo.hidden = !tiene; sinVehiculo.hidden = tiene; if (tiene && !manualCaja.checked) cargarAnios(); };
  eleccion.addEventListener('change', (e) => { tiene = e.target.value === 'si'; pintar(); });
  pintar();
  return {
    el: h('div', {}, eleccion, conVehiculo, sinVehiculo),
    valores(f) {
      const g = (k) => f.elements[k]?.value ?? '';
      if (!tiene) return { vehiculo: { propiedad: 'ninguno' }, publico: Object.fromEntries(TARIFAS_PUB.map(([k]) => [k, g(`publico.${k}`) || null])) };
      return { vehiculo: { propiedad: g('vehiculo.propiedad'), tipo: g('vehiculo.tipo'), combustible: g('vehiculo.combustible'), rendimiento: g('vehiculo.rendimiento'),
        marca: g('vehiculo.marca'), modelo: g('vehiculo.modelo'), anio: g('vehiculo.anio'), placa: g('vehiculo.placa'), epaId, rendimientoFuente: fuente } };
    },
    tiene: () => tiene,
  };
}

/** Selector de provincia y municipio oficiales (residencia). */
function residenciaCampos(div, valor) {
  const z = selectorZona(div.provincias, div.municipios, { provincia: valor?.provincia ?? '', municipio: valor?.municipio ?? '', prefijo: 'res' });
  z.fp.querySelector('label').textContent = 'Provincia donde vive'; z.fm.querySelector('label').textContent = 'Municipio donde vive';
  z.sp.name = 'residencia.provincia'; z.sm.name = 'residencia.municipio';
  const err = (f, k) => { let e = f.querySelector('.error'); if (!e) { e = h('p', { class: 'error' }); f.append(e); } e.dataset.for = k; };
  err(z.fp, 'residencia.provincia'); err(z.fm, 'residencia.municipio');
  return z;
}

/**
 * Busca una referencia oficial de km por galón (EPA, año más cercano) o un modelo ya agregado.
 * Nunca inventa cifras: si no hay dato, lo dice. usar(km, texto) aplica el valor elegido.
 */
async function buscarReferencia({ marca, modelo, anio }, boton, caja, usar) {
  if (!marca?.trim() || !modelo?.trim() || !/^\d{4}$/.test(String(anio).trim())) { caja.replaceChildren(h('p', { class: 'hint' }, 'Escribe la marca, el modelo y el año para buscar la referencia.')); return; }
  const texto0 = boton.textContent; boton.disabled = true; boton.textContent = 'Buscando…';
  caja.replaceChildren(h('p', { class: 'hint' }, 'Buscando el dato oficial del mismo modelo en años cercanos. Puede tardar unos segundos.'));
  try {
    const r = await api('GET', `/api/vehiculos/referencia?marca=${encodeURIComponent(marca.trim())}&modelo=${encodeURIComponent(modelo.trim())}&anio=${encodeURIComponent(String(anio).trim())}`);
    const usarBtn = (km, txt) => h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: () => usar(km, txt) }, `Usar ${fmtN.format(km)}`);
    const partes = [];
    if (r.agregado) {
      const txt = `${r.agregado.marca} ${r.agregado.modelo} ${r.agregado.anio}, agregado por la gestión`;
      partes.push(h('div', { class: 'ref-fila' }, h('span', {}, `${txt}: `, h('strong', {}, `${fmtN.format(r.agregado.kmPorGalon)} km por galón`)), usarBtn(r.agregado.kmPorGalon, txt)));
    }
    if (r.epa) {
      partes.push(h('p', { class: 'ref-titulo' }, `${r.epa.marca} ${r.epa.modelo} ${r.epa.anio}, dato oficial de FuelEconomy.gov${r.epa.mismoAnio ? '' : ` (el año más cercano con datos; tú buscaste ${anio})`}:`));
      for (const v of r.epa.versiones) {
        const txt = `${r.epa.marca} ${r.epa.modelo} ${r.epa.anio}, ${v.version}`;
        partes.push(h('div', { class: 'ref-fila' }, h('span', {}, `${v.version}: `, h('strong', {}, `${fmtN.format(v.kmPorGalon)} km por galón`)), usarBtn(v.kmPorGalon, txt)));
      }
    }
    if (!partes.length) partes.push(h('p', { class: 'hint' }, r.epaError ? `No pudimos consultar FuelEconomy.gov ahora (${r.epaError}). Escribe el rendimiento que conozcas.` : `No encontramos datos oficiales de ${marca} ${modelo} cerca de ${anio}. Escribe el rendimiento que conozcas (por ejemplo, el que marca el tablero o el manual).`));
    else partes.push(h('p', { class: 'hint' }, 'Es una referencia: el rendimiento real cambia con el estado del vehículo y las vías. Con GLP suele rendir menos que con gasolina; ajústalo si conoces el real.'));
    caja.replaceChildren(h('div', { class: 'ref-caja' }, ...partes));
  } catch (e) { caja.replaceChildren(h('p', { class: 'hint' }, e.message)); }
  boton.disabled = false; boton.textContent = texto0;
}

/** Cómo quedó el correo de bienvenida (usuario, pasos y enlace). */
function estadoCorreo(e) {
  const t = { enviado: 'Le enviamos un correo con su usuario, los pasos y el enlace para entrar.', sin_correo: 'No tiene correo registrado: entrégale los datos en persona. Puedes agregarle un correo con "Editar datos".',
    no_configurado: 'El envío de correos aún no está activado en la plataforma; entrégale los datos en persona.', error: 'No se pudo enviar el correo ahora; entrégale los datos en persona.' }[e];
  return t ? h('p', { class: `estado-correo ${e === 'enviado' ? 'ok' : ''}` }, t) : null;
}
/** Muestra el usuario y la contraseña para entregar al representante (la temporal solo se ve una vez). */
function mostrarCredenciales(titulo, x, alCerrar) {
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-cuerpo').replaceChildren(h('dl', { class: 'credenciales-lista' }, h('dt', {}, 'Usuario'), h('dd', {}, x.usuario),
    h('dt', {}, x.claveInicialGlobal ? 'Contraseña' : 'Contraseña temporal'), h('dd', {}, x.claveInicialGlobal ? 'La contraseña inicial global de FERSUAZ' : x.claveTemporal)),
    estadoCorreo(x.correoBienvenida),
    h('p', { class: 'hint' }, x.claveInicialGlobal ? 'Al entrar por primera vez deberá cambiarla por una propia.' : 'No se volverá a mostrar. Entrégala por un medio seguro; al entrar deberá cambiarla.'));
  $('#dialogo-ok').textContent = 'Listo';
  if (alCerrar) $('#dialogo').addEventListener('close', alCerrar, { once: true });
  $('#dialogo').showModal();
}
/** Provincias (y municipios opcionales) de una zona, como casillas. */
function filasZona(div, item) {
  const marcadas = new Set(item?.provincias ?? []);
  const resumenMun = (n) => (n ? `Solo ${n} municipio(s)` : 'Toda la provincia (elegir municipios)');
  return div.provincias.map((p) => {
    const elegidos = new Set(item?.municipios?.[p] ?? []);
    const muns = h('details', { class: 'prov-muns', hidden: !marcadas.has(p), open: elegidos.size > 0 },
      h('summary', {}, resumenMun(elegidos.size)),
      h('div', { class: 'prov-muns-lista' }, div.municipios[p].map((m) => h('label', {}, h('input', { type: 'checkbox', name: `mun:${p}`, value: m, checked: elegidos.has(m) }), h('span', {}, m)))));
    muns.addEventListener('change', () => { muns.querySelector('summary').textContent = resumenMun(muns.querySelectorAll('input:checked').length); });
    const caja = h('input', { type: 'checkbox', name: 'prov', value: p, checked: marcadas.has(p), onchange: (e) => { muns.hidden = !e.target.checked; if (e.target.checked && muns.dataset.parcial) muns.open = true; } });
    return h('div', { class: 'prov-item', dataset: { prov: p } }, h('label', {}, caja, h('span', {}, p)), h('small', { class: 'ocupada', hidden: true }), muns);
  });
}
const zonaDeForm = (f) => {
  const provincias = [...f.querySelectorAll('[name=prov]:checked')].map((x) => x.value);
  const municipios = Object.fromEntries(provincias.map((p) => [p, [...f.querySelectorAll(`[name="mun:${p}"]:checked`)].map((x) => x.value)]).filter(([, ms]) => ms.length));
  return { provincias, municipios };
};
/**
 * Marca el territorio que ya cubre otro representante de la misma posición (no se puede repetir).
 * Con otra posición sí se puede compartir, por eso se vuelve a pintar al cambiar la posición.
 */
async function marcarOcupadas(cont, posicion, excluirId) {
  cont.querySelectorAll('.prov-item').forEach((it) => {
    const n = it.querySelector('.ocupada'); n.hidden = true; n.textContent = ''; it.classList.remove('prov-ocupada'); delete it.querySelector('.prov-muns').dataset.parcial;
    it.querySelectorAll('input').forEach((x) => { if (x.dataset.bloqueada) { x.disabled = false; delete x.dataset.bloqueada; } });
    it.querySelectorAll('.mun-ocupado').forEach((x) => x.remove());
  });
  if (!posicion) return;
  let items = [];
  try { items = (await api('GET', `/api/territorio/zonas-ocupadas?posicion=${encodeURIComponent(posicion)}${excluirId ? `&excluir=${excluirId}` : ''}`)).items; } catch { return; }
  const bloquear = (x) => { if (!x.checked) { x.disabled = true; x.dataset.bloqueada = '1'; } };
  for (const z of items) for (const p of z.provincias) {
    const it = cont.querySelector(`.prov-item[data-prov="${CSS.escape(p)}"]`); if (!it) continue;
    const n = it.querySelector('.ocupada'); const muns = z.municipios?.[p];
    const txt = muns?.length ? `${z.representante} cubre ${muns.join(', ')}` : `Ya la cubre ${z.representante}`;
    n.textContent = n.textContent ? `${n.textContent}. ${txt}` : txt; n.hidden = false;
    if (!muns?.length) { it.classList.add('prov-ocupada'); bloquear(it.querySelector('[name=prov]')); it.querySelectorAll('[name^="mun:"]').forEach(bloquear); continue; }
    it.querySelector('.prov-muns').dataset.parcial = '1';
    for (const m of muns) {
      const x = it.querySelector(`[name="mun:${CSS.escape(p)}"][value="${CSS.escape(m)}"]`); if (!x) continue;
      bloquear(x); x.closest('label').append(h('small', { class: 'mun-ocupado' }, z.representante));
    }
  }
  // Si toda la provincia quedó repartida, no se puede elegir.
  cont.querySelectorAll('.prov-item').forEach((it) => {
    const ms = [...it.querySelectorAll('[name^="mun:"]')];
    if (ms.length && ms.every((x) => x.dataset.bloqueada)) { it.classList.add('prov-ocupada'); bloquear(it.querySelector('[name=prov]')); }
  });
}

/** Primera entrada con contraseña temporal: debe elegir la suya antes de usar el panel. */
/** Mi cuenta: cada persona ve su usuario y corrige su teléfono, su correo y su contraseña. */
V.cuenta = async () => {
  const { user: u } = await api('GET', '/api/auth/me');
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar mis datos');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Mis datos'),
    h('dl', { class: 'credenciales-lista datos-lista' }, h('dt', {}, 'Nombre'), h('dd', {}, u.fullName), u.username ? h('dt', {}, 'Usuario') : null, u.username ? h('dd', {}, u.username) : null, h('dt', {}, 'Rol'), h('dd', {}, `${ROLES[u.role] ?? u.role}${u.position ? `, ${u.position}` : ''}`)),
    h('p', { class: 'hint' }, 'Si tu nombre está mal escrito, pídele a la administración que lo corrija.'),
    h('div', { class: 'form-fila' }, campo('telefono', 'Teléfono', { type: 'tel', inputmode: 'tel', value: u.phone ?? '' }), campo('correo', 'Correo', { type: 'email', value: u.email ?? '', autocomplete: 'email' }, '(para recibir avisos y recuperar tu contraseña)')),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => { e.preventDefault(); await enviar(f, b, () => api('POST', '/api/auth/mis-datos', { telefono: f.telefono.value, correo: f.correo.value })); });
  const bc = h('button', { class: 'btn', type: 'submit' }, 'Cambiar mi contraseña');
  const fc = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Contraseña'),
    h('div', { class: 'form-fila' }, campo('actual', 'Contraseña actual', { type: 'password', autocomplete: 'current-password' }), campo('nueva', 'Nueva contraseña', { type: 'password', autocomplete: 'new-password' }, '(10 o más, letras y números)'), campo('repetir', 'Repite la nueva', { type: 'password', autocomplete: 'new-password' })),
    h('div', { class: 'acciones' }, bc));
  fc.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await enviar(fc, bc, async () => { if (fc.nueva.value !== fc.repetir.value) throw new ApiError(422, { error: 'Las contraseñas no coinciden.', fields: { repetir: 'No coincide con la nueva.' } }); return api('POST', '/api/auth/cambiar-clave', { actual: fc.actual.value, nueva: fc.nueva.value }); })) fc.reset();
  });
  return vista('Mi cuenta', 'Tus datos de acceso y de contacto.', f, fc);
};
function vistaCambioClave() {
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar mi contraseña');
  const f = h('form', { class: 'tarjeta cambio-clave', novalidate: true }, h('h2', {}, 'Elige tu contraseña'),
    h('p', { class: 'hint' }, 'Entraste con una contraseña temporal. Escribe una nueva de al menos 10 caracteres, con letras y números.'),
    campo('actual', 'Contraseña temporal', { type: 'password', autocomplete: 'current-password' }),
    campo('nueva', 'Nueva contraseña', { type: 'password', autocomplete: 'new-password' }),
    campo('repetir', 'Repite la nueva contraseña', { type: 'password', autocomplete: 'new-password' }),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.nueva.value !== f.repetir.value) { const st = f.querySelector('.aviso') ?? f.appendChild(h('div', { class: 'aviso', role: 'status' })); estado(st, 'error', 'Las contraseñas nuevas no coinciden.'); return; }
    if (await enviar(f, b, () => api('POST', '/api/auth/cambiar-clave', { actual: f.actual.value, nueva: f.nueva.value }))) location.reload();
  });
  return [h('h1', {}, `Hola, ${yo.fullName.split(' ')[0]}`), h('p', { class: 'vista-sub' }, `Tu usuario es ${yo.username ?? yo.email}.`), f];
}

/** Importar representantes desde el Excel del paquete: vista previa, confirmar y verificación con lo que falta (zona). */
function importarPaquete() {
  const archivo = campo('archivo', 'Archivo Excel (.xlsx)', { type: 'file', accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' });
  const revisar = h('button', { class: 'btn-sec', type: 'submit' }, 'Revisar archivo');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta importador', novalidate: true },
    h('h2', {}, 'Importar desde el paquete de viáticos'),
    h('p', { class: 'hint' }, 'El Excel debe tener las columnas Representante, Posición, Días fuera de la zona y Días en la zona. Las filas de totales sin nombre se ignoran. A cada uno se le crea su usuario y entra con la contraseña inicial; después le asignas su zona.'),
    archivo, h('div', { class: 'acciones' }, revisar), salida);
  let leido = null;
  const chipAccion = (x) => h('span', { class: `chip ${x.accion === 'error' ? 'rechazado' : x.accion === 'crear cuenta' ? 'validado' : 'pendiente'}` }, x.accion === 'error' ? 'Con error' : x.accion === 'crear cuenta' ? 'Cuenta nueva' : 'Ya existe: actualiza días');
  const notas = (x) => [...x.errores.map((t) => h('small', { style: 'display:block;color:var(--alerta)' }, t)), ...x.avisos.map((t) => h('small', { style: 'display:block;color:var(--texto-2)' }, t))];
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); salida.replaceChildren();
    const file = f.archivo.files[0];
    const r = await enviar(f, revisar, async () => {
      if (!file) throw new ApiError(422, { error: 'Elige un archivo.', fields: { archivo: 'Elige el Excel del paquete.' } });
      if (file.size > 8 * 1024 * 1024) throw new ApiError(413, { error: 'El archivo no puede pasar de 8 MB.', fields: { archivo: 'Archivo demasiado grande.' } });
      leido = { archivo: await archivoB64(file), nombre: file.name };
      return api('POST', '/api/representantes/importar-paquete', leido);
    });
    if (!r) return;
    const nuevos = r.filas.filter((x) => x.accion === 'crear cuenta').length;
    salida.append(h('p', {}, `${fmtN.format(r.total)} representante(s) leídos de ${file.name}: ${fmtN.format(nuevos)} nuevo(s), ${fmtN.format(r.total - nuevos - r.errores)} ya existen${r.errores ? `, ${fmtN.format(r.errores)} con error` : ''}.`),
      tabla([{ t: 'Fila', num: true, v: (x) => x.fila }, { t: 'Representante', v: (x) => [x.nombre, ...notas(x)] }, { t: 'Posición', v: (x) => x.posicion ?? '' },
        { t: 'Días en la zona', num: true, v: (x) => fmtN.format(x.diasDentro) }, { t: 'Días fuera', num: true, v: (x) => fmtN.format(x.diasFuera) },
        { t: 'Total', num: true, v: (x) => fmtN.format(x.diasDentro + x.diasFuera) }, { t: 'Qué se hará', v: chipAccion }], r.filas, ['', ''], { porPagina: 50 }));
    if (r.errores) { salida.append(h('div', { class: 'aviso error' }, 'Corrige las filas con error en el Excel y vuelve a revisarlo. No se guarda nada mientras haya errores.')); return; }
    const imp = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!(await confirmar('Importar representantes', `Se crearán ${nuevos} cuenta(s) nuevas y se guardarán los días de ${r.total} representante(s). Después asígnales su zona.`, { okTexto: 'Importar' }))) return;
      imp.disabled = true; imp.textContent = 'Importando…';
      try {
        const ok = await api('POST', '/api/representantes/importar-paquete', { ...leido, confirmar: true });
        cache = {};
        const [{ items: reps }] = await Promise.all([api('GET', '/api/viaticos/representantes')]);
        const zPor = new Map((await api('GET', '/api/territorio/zonas').then((x) => x.items).catch(() => [])).map((z) => [z.representanteId, z]));
        const zonas = ok.items.map((x) => zPor.get(x.id) ?? null);
        const conClave = ok.items.some((x) => x.claveTemporal);
        const global = ok.items.some((x) => x.claveInicialGlobal);
        const sinZona = ok.items.filter((x, i) => !zonas[i]?.provincias?.length).length;
        const enSistema = new Set(reps.map((x) => x.id));
        salida.replaceChildren(...[
          h('div', { class: 'aviso ok' }, `Listo: ${ok.items.filter((x) => x.nuevo).length} cuenta(s) nuevas y ${ok.total} plan(es) de días guardados. Verificado: ${ok.items.filter((x) => enSistema.has(x.id)).length} de ${ok.total} ya aparecen en Representantes.`),
          sinZona ? h('div', { class: 'aviso' }, `Falta asignar la zona a ${sinZona} representante(s). Usa "Asignar zona" en cada fila.`) : null,
          global ? h('p', { class: 'hint' }, 'Entran con la contraseña inicial global y deberán cambiarla al entrar.') : null,
          conClave ? h('p', { class: 'hint' }, 'Anota o entrega ahora las contraseñas temporales: no se vuelven a mostrar.') : null,
          tabla([{ t: 'Representante', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, x.posicion)] },
            { t: 'Usuario', v: (x) => x.usuario ?? '' }, ...(conClave ? [{ t: 'Contraseña temporal', v: (x) => x.claveTemporal ? h('code', {}, x.claveTemporal) : '' }] : []),
            { t: 'Días en la zona', num: true, v: (x) => fmtN.format(x.diasDentro) }, { t: 'Días fuera', num: true, v: (x) => fmtN.format(x.diasFuera) },
            { t: 'Zona', v: (x) => { const z = zonas[ok.items.indexOf(x)]; return z?.provincias?.length ? z.provincias.join(', ') : h('a', { class: 'btn-sec btn-peq', href: `#representantes?rep=${x.id}` }, 'Asignar zona'); } }],
          ok.items, ['', ''], { porPagina: 50 })].filter(Boolean));
      } catch (err) { imp.disabled = false; imp.textContent = 'Importar'; salida.append(h('div', { class: 'aviso error' }, err.message)); }
    } }, `Importar ${fmtN.format(r.total)} representante(s)`);
    salida.append(h('div', { class: 'acciones' }, imp));
  });
  return f;
}

async function formClaveInicial() {
  const { configurada } = await api('GET', '/api/representantes/clave-inicial');
  const b = h('button', { class: 'btn', type: 'submit' }, configurada ? 'Cambiar contraseña inicial' : 'Guardar contraseña inicial');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Contraseña inicial global'),
    h('p', {}, configurada ? 'Hay una contraseña inicial configurada. Por seguridad no se puede ver; puedes cambiarla o quitarla.' : 'Aún no hay contraseña inicial: a cada representante se le genera una temporal distinta al azar.'),
    h('p', { class: 'hint' }, 'Se usa al registrar un representante, al cambiarle el nombre, al darle "Nueva clave" y al reactivarlo. Al entrar por primera vez, el sistema le obliga a cambiarla por una propia. Cuidado: quien la conozca puede entrar a las cuentas que todavía no la cambiaron; compártela solo con el equipo nuevo y cámbiala de vez en cuando.'),
    h('div', { class: 'form-fila' }, campo('clave', 'Contraseña inicial', { type: 'password', autocomplete: 'new-password', minlength: 10 }, '(10 o más caracteres, con letras y números)')),
    h('div', { class: 'acciones' }, b, configurada ? h('button', { class: 'btn-sec btn-peligro', type: 'button', onclick: async () => {
      if (!(await confirmar('Quitar contraseña inicial', 'Desde ahora, cada representante recibirá una contraseña temporal distinta al azar.', { okTexto: 'Quitar' }))) return;
      try { await api('POST', '/api/representantes/clave-inicial', { quitar: true }); router(); } catch (e) { alert(e.message); }
    } }, 'Quitar') : null));
  f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/representantes/clave-inicial', { clave: f.clave.value }))) { f.clave.value = ''; router(); } });
  return f;
}
V.representantes = async () => {
  const ver = param('ver') || 'zonas';
  const seg = segmentos('Representantes', [...(ES_GER() ? [['nuevo', 'Nuevo representante'], ['paquete', 'Importar desde Excel']] : []), ['zonas', 'Zonas por representante'], ...(GESTION_T() ? [['cartera', 'Cartera de médicos']] : []), ['preregistro', 'Pre-registro por Excel'], ...(yo.role === 'administrador' ? [['clave', 'Contraseña inicial']] : [])], ver, (id) => irA('representantes', { ver: id }));
  if (ver === 'clave' && yo.role === 'administrador') return vista('Representantes', 'La contraseña con la que entra por primera vez cada representante nuevo o cuyo nombre cambió.', seg, await formClaveInicial());
  if (ver === 'nuevo' && ES_GER()) { borradorRep = {}; delete SESION_REP.nuevo; location.replace('#configurar?paso=datos'); return []; }
  if (ver === 'paquete' && ES_GER()) return vista('Representantes', 'Crea de una vez las cuentas de tu equipo desde el Excel del paquete de viáticos. Solo se toman nombre, posición y días en la zona y fuera de ella; el salario y los montos no se leen.', seg, importarPaquete());
  if (ver === 'cartera' && GESTION_T()) return vista('Representantes', 'Elige médicos por establecimiento y especialidad y agrégalos de una vez a uno o varios visitadores o PVC. A cada uno solo se le agregan los médicos de centros de su ruta.', seg, ...(await carteraLote()));
  if (ver === 'preregistro') {
    const { items } = await api('GET', '/api/territorio/preregistros');
    const anular = async (p) => { if (await confirmar('Anular pre-registro', `${p.nombre} ya no quedará aprobado automáticamente al registrarse.`, { okTexto: 'Anular' })) { try { await api('POST', `/api/territorio/preregistros/${p.id}/anular`); } catch (e) { alert(e.message); } router(); } };
    return vista('Representantes', 'Carga promotores, visitadores, vendedores y PVC con sus provincias. Cuando cada uno se registra con su mismo correo, su cuenta se activa sola.', seg,
      importador('representantes', 'Importar representantes', 'Nadie recibe contraseñas por Excel: cada representante crea la suya al registrarse en la web.', router),
      h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Pre-registrados'),
      tabla([{ t: 'Nombre', v: (p) => [p.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, p.email)] }, { t: 'Cargo', v: (p) => p.posicion }, { t: 'Provincias', v: (p) => p.provincias.join(', ') || 'Sin asignar' },
        { t: 'Estado', v: (p) => h('span', { class: `chip ${p.estado === 'usado' ? 'validado' : 'pendiente'}` }, p.estado === 'usado' ? 'Ya registrado' : 'Esperando registro') },
        { t: '', v: (p) => p.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => anular(p) }, 'Anular') : '' }], items, ['Aún no hay pre-registros', 'Importa el Excel de tu equipo comercial.']));
  }
  const [{ items: reps }, div] = await Promise.all([api('GET', '/api/viaticos/representantes'), division()]);
  const id = param('rep');
  if (id) {
    const r = reps.find((x) => x.id === id);
    const [{ item }, lz] = await Promise.all([api('GET', `/api/territorio/zonas/${id}`), api('GET', `/api/territorio/zonas/${id}/lugares`)]);
    const marcadas = new Set(item.provincias);
    const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar zona');
    const pos = campo('posicion', 'Posición', { options: ['Visitador', 'PVC', 'Vendedor', 'Promotora'].map((x) => ({ value: x, label: x })), value: r?.position ?? '' });
    const filas = filasZona(div, item);
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, r?.fullName ?? 'Representante'),
      h('div', { class: 'form-fila' }, pos),
      h('p', { class: 'hint' }, 'Marca las provincias que visita. Si solo visita algunos municipios de una provincia, ábrela y márcalos; si no marcas ninguno, visita toda la provincia. Dos representantes de la misma posición no pueden compartir zona; con otra posición sí, por eso lo ya cubierto cambia según la posición.'),
      h('p', { class: 'error', dataset: { for: 'municipios' } }), h('p', { class: 'error', dataset: { for: 'provincias' } }),
      h('div', { class: 'provincias provincias-zona' }, filas),
      h('div', { class: 'acciones' }, b, h('a', { class: 'btn-sec', href: '#representantes' }, 'Volver')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { provincias, municipios } = zonaDeForm(f);
      if (await enviar(f, b, () => api('POST', `/api/territorio/zonas/${id}`, { provincias, municipios, posicion: f.posicion.value || undefined }))) irA('representantes', { rep: id, sec: 'lugares' });
    });
    f.posicion.addEventListener('change', () => marcarOcupadas(f, f.posicion.value, id));
    marcarOcupadas(f, r?.position, id);
    const T = (n) => (n ? fmtN.format(n) : '');
    // Lista de cada lugar de su zona: para revisar qué entró (por ejemplo, del registro automático de Google) y quitar lo que no va.
    const ORIGEN = { google: 'Google', manual: 'Manual', excel: 'Excel', registro_dependiente: 'Registro de dependiente' };
    const TIPOS_L = { farmacia: 'Farmacia', hospital: 'Hospital', clinica: 'Clínica', unap: 'UNAP', cpn: 'Primer nivel', diagnostico: 'Centro diagnóstico', consultorio: 'Consultorio' };
    const todos = [...lz.farmacias.map((x) => ({ ...x, tipo: 'farmacia', esFarmacia: true })), ...lz.establecimientos].sort((a, b) => a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    const uni = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const selL = new Set();
    const bQuitar = h('button', { class: 'btn-sec btn-peligro', type: 'button', disabled: true }, 'Quitar los marcados');
    let vistosL = [];
    const marcaTodosL = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los lugares que se ven con los filtros' });
    const contarL = () => {
      bQuitar.disabled = !selL.size; bQuitar.textContent = selL.size ? `Quitar ${fmtN.format(selL.size)} marcado(s)` : 'Quitar los marcados';
      const n = vistosL.filter((x) => selL.has(x.id)).length; marcaTodosL.checked = n > 0 && n === vistosL.length; marcaTodosL.indeterminate = n > 0 && n < vistosL.length;
    };
    marcaTodosL.addEventListener('change', () => { if (marcaTodosL.checked) vistosL.forEach((x) => selL.add(x.id)); else vistosL.forEach((x) => selL.delete(x.id)); document.querySelectorAll('input[data-marca-l]').forEach((c) => { c.checked = selL.has(c.dataset.marcaL); }); contarL(); });
    const quitarL = async (ids) => {
      const r2 = await confirmar('Quitar lugares', `${fmtN.format(ids.length)} lugar(es) saldrán de las zonas, los cronogramas y las metas de visitas. El registro automático no los volverá a traer. Los establecimientos se pueden restaurar en Establecimientos → "No son centros de salud".`, { okTexto: 'Quitar', pedirMotivo: true, etiquetaMotivo: 'Motivo', sugerencias: [{ texto: 'No es un centro de salud.' }, { texto: 'No es una farmacia.' }, { texto: 'Está cerrado.' }, { texto: 'Repetido.' }, { texto: 'No está en esta zona.' }] });
      if (r2 == null) return;
      try { await api('POST', '/api/territorio/establecimientos/descartar', { ids, motivo: r2 }); aviso(`Listo: ${fmtN.format(ids.length)} lugar(es) quitado(s).`, 'ok'); router(); } catch (e) { alert(e.message); }
    };
    bQuitar.addEventListener('click', () => quitarL([...selL]));
    const camposL = [
      { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre o dirección', valor: (x) => `${x.nombre} ${x.direccion ?? ''} ${x.sector ?? ''}` },
      { id: 'prov', etiqueta: 'Provincias', tipo: 'opciones', plural: 'provincias', opciones: uni(todos.map((x) => x.provincia)), valor: (x) => x.provincia },
      { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: uni(todos.map((x) => x.municipio)), valor: (x) => x.municipio },
      { id: 'tipo', etiqueta: 'Tipos', tipo: 'opciones', plural: 'tipos', opciones: uni(todos.map((x) => x.tipo)).map((t) => ({ value: t, label: TIPOS_L[t] ?? t })), valor: (x) => x.tipo },
      { id: 'origen', etiqueta: 'Cómo entró', tipo: 'opciones', plural: 'orígenes', opciones: uni(todos.map((x) => x.fuente ?? 'manual')).map((t) => ({ value: t, label: ORIGEN[t] ?? t })), valor: (x) => x.fuente ?? 'manual' },
      { id: 'est', etiqueta: 'Estado', tipo: 'opciones', opciones: uni(todos.map((x) => x.estado)).map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })), valor: (x) => x.estado },
      { id: 'ubic', etiqueta: 'Ubicación', tipo: 'opciones', opciones: [{ value: 'si', label: 'Con ubicación' }, { value: 'no', label: 'Sin ubicación' }], valor: (x) => (x.lat == null || x.lng == null ? 'no' : 'si') },
      { id: 'desde', etiqueta: 'Agregado desde', tipo: 'desde', valor: (x) => String(x.createdAt ?? '').slice(0, 10) },
    ];
    const colsL = [
      ...(ES_GER() ? [{ t: marcaTodosL, etiqueta: 'Marcar', clase: 'td-sel', v: (x) => { const c = h('input', { type: 'checkbox', 'data-marca-l': x.id, 'aria-label': `Marcar ${x.nombre}`, checked: selL.has(x.id) }); c.addEventListener('change', () => { c.checked ? selL.add(x.id) : selL.delete(x.id); contarL(); }); return h('span', { class: 'celda-sel' }, c); } }] : []),
      { t: 'Lugar', v: (x) => [x.nombre, x.direccion ? h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion) : null] },
      { t: 'Tipo', v: (x) => TIPOS_L[x.tipo] ?? x.tipo }, { t: 'Municipio', v: (x) => [x.municipio, h('small', { style: 'display:block;color:var(--texto-2)' }, x.provincia)] },
      { t: 'Cómo entró', v: (x) => [ORIGEN[x.fuente ?? 'manual'] ?? x.fuente, x.createdAt ? h('small', { style: 'display:block;color:var(--texto-2)' }, fecha(String(x.createdAt).slice(0, 10))) : null] },
      { t: 'Estado', v: (x) => [chip(x.estado), x.lat == null ? h('small', { style: 'display:block;color:var(--alerta)' }, 'Sin ubicación') : null] },
      ...(ES_GER() ? [{ t: '', v: (x) => h('button', { class: 'btn-enlace', type: 'button', onclick: () => quitarL([x.id]) }, 'Quitar') }] : []),
    ];
    const detalle = todos.length ? h('div', { style: 'margin-top:1.5rem' }, h('h2', {}, 'Cada lugar de su zona'),
      h('p', { class: 'hint' }, 'Todos los lugares activos de sus provincias y municipios, con cómo entraron al sistema. Si alguno no va (no es centro de salud, está cerrado, repetido), márcalo y quítalo.'),
      listaFiltrada(`lugares-${id}`, todos, camposL, (vs) => { vistosL = vs; contarL(); return h('div', {}, ES_GER() ? h('div', { class: 'acciones', style: 'margin:0 0 .75rem' }, bQuitar) : null, tabla(colsL, vs, ['Ningún lugar con estos filtros', 'Cambia o limpia los filtros.'], { porPagina: 25 })); })) : null;
    const lugares = h('div', {},
      tabla([{ t: 'Municipio', v: (x) => [x.municipio, h('small', { style: 'display:block;color:var(--texto-2)' }, x.provincia)] },
        { t: 'Farmacias', num: true, v: (x) => T(x.farmacia) }, { t: 'Hospitales', num: true, v: (x) => T(x.hospital) }, { t: 'Clínicas', num: true, v: (x) => T(x.clinica) },
        { t: 'UNAP', num: true, v: (x) => T(x.unap) }, { t: 'Primer nivel', num: true, v: (x) => T(x.cpn) },
        { t: 'Sin ubicación', num: true, v: (x) => x.sinUbicacion ? h('span', { style: 'color:var(--alerta)' }, fmtN.format(x.sinUbicacion)) : '' }],
      lz.resumen, ['Su zona aún no tiene lugares registrados', 'Usa el registro automático en Catálogo → Farmacias y en Establecimientos.']),
      lz.resumen.length ? h('p', { class: 'hint' }, 'Los lugares sin ubicación no entran en el cálculo de distancia; regístralos desde Google Maps para tener km exactos.') : null,
      lz.resumen.length && yo.role === 'administrador' ? h('div', { class: 'acciones' }, h('a', { class: 'btn', href: `#cronogramas?rep=${id}` }, 'Programar su cronograma')) : null, detalle);
    return vistaS('representantes', ['zona', 'lugares'], 'Zona del representante', `${r?.fullName ?? ''}: posición, provincias y municipios que visita. De aquí salen sus lugares, su cronograma, los km, el combustible y sus viáticos.`, S('zona', 'Zona y posición', f), S('lugares', `Lugares de su zona (${fmtN.format(lz.farmacias.length + lz.establecimientos.length)})`, lugares));
  }
  // Todas las zonas y los planes en dos pedidos (antes era uno por representante y la sección tardaba).
  const [zTodas, pTodos] = await Promise.all([api('GET', '/api/territorio/zonas').then((x) => x.items).catch(() => []), ES_GER() ? api('GET', '/api/representantes/plan-dias').then((x) => x.items).catch(() => []) : []]);
  const zPor = new Map(zTodas.map((z) => [z.representanteId, z])); const pPor = new Map(pTodos.map((x) => [x.representanteId, x]));
  const zonas = reps.map((r) => zPor.get(r.id) ?? { provincias: [], municipios: {} });
  const planes = ES_GER() ? reps.map((r) => pPor.get(r.id) ?? null) : [];
  const nuevaClave = async (r) => {
    if (!(await confirmar('Nueva contraseña temporal', `${r.fullName} volverá a la contraseña inicial (la global, si está configurada, o una temporal nueva). La actual dejará de funcionar y deberá cambiarla al entrar.`, { okTexto: 'Generar' }))) return;
    try {
      const x = await api('POST', `/api/representantes/${r.id}/clave`);
      mostrarCredenciales('Nueva contraseña', x);
    } catch (e) { alert(e.message); }
  };
  const texto = (z) => z.provincias.map((p) => (z.municipios?.[p]?.length ? `${p} (${z.municipios[p].join(', ')})` : p)).join('; ');
  const editarDatos = async (r) => {
    const [nombre, ...resto] = (r.fullName ?? '').split(' ');
    const v = await confirmar('Editar datos', `Corrige los datos de ${r.fullName}. Si cambias el nombre o el apellido, se le crea un usuario nuevo y vuelve a la contraseña inicial (deberá cambiarla al entrar).`, { okTexto: 'Guardar', campos: [
      { name: 'nombre', label: 'Nombre', value: nombre }, { name: 'apellido', label: 'Apellido', value: resto.join(' ') },
      { name: 'telefono', label: 'Teléfono (opcional)', value: r.phone ?? '', type: 'tel', inputmode: 'tel' }, { name: 'correo', label: 'Correo (opcional)', value: r.email ?? '', type: 'email' }] });
    if (!v) return;
    try { const x = await api('POST', `/api/representantes/${r.id}/editar`, v); if (x.usuario) mostrarCredenciales('Nombre cambiado: acceso nuevo', x, () => router()); else router(); } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
  };
  const darBaja = async (r) => {
    const m = await confirmar('Dar de baja', `${r.fullName} ya no podrá entrar. Su zona queda libre para otro ${r.position ?? 'representante'} y se anulan sus días de cronograma futuros que no tengan jornada. Su historial (jornadas, viáticos, recetas) se conserva y puedes reactivarlo después.`, { okTexto: 'Dar de baja', pedirMotivo: true });
    if (m == null) return;
    try { const x = await api('POST', `/api/representantes/${r.id}/baja`, { motivo: m }); alert(`${r.fullName} quedó dado de baja.${x.cronogramasAnulados ? ` Se anularon ${x.cronogramasAnulados} día(s) futuros de su cronograma.` : ''}`); router(); } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
  };
  const inactivos = ES_GER() ? await api('GET', '/api/representantes/inactivos').then((x) => x.items).catch(() => []) : [];
  const reactivar = async (r) => {
    if (!(await confirmar('Reactivar', `${r.fullName} podrá entrar de nuevo con una contraseña temporal. Revisa su zona después: si otro de su posición ya cubre ese territorio, deberás ajustarla.`, { okTexto: 'Reactivar' }))) return;
    try {
      const x = await api('POST', `/api/representantes/${r.id}/reactivar`);
      mostrarCredenciales('Reactivado', x, () => router());
    } catch (e) { alert(e.message); }
  };
  const bajas = inactivos.length ? h('details', { class: 'tarjeta bajas', style: 'margin-top:1.25rem' }, h('summary', {}, `Dados de baja (${fmtN.format(inactivos.length)})`),
    tabla([{ t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] }, { t: 'Usuario', v: (r) => r.username ?? '' },
      { t: '', v: (r) => h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => reactivar(r) }, 'Reactivar') }], inactivos, ['', ''])) : null;
  return vista('Representantes', 'Asigna a cada representante su posición y las provincias o municipios que visita.', seg,
    tabla([{ t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] },
      { t: 'Zona', v: (r) => texto(zonas[reps.indexOf(r)]) || h('span', { class: 'chip pendiente' }, 'Sin asignar') },
      ...(planes.some(Boolean) ? [{ t: 'Días en zona / fuera', v: (r) => { const p = planes[reps.indexOf(r)]; return p ? `${fmtN.format(p.diasDentro)} / ${fmtN.format(p.diasFuera)}` : ''; } }] : []),
      { t: '', v: (r) => [GESTION_T() ? h('a', { class: 'btn btn-peq', href: `#configurar?rep=${r.id}` }, 'Configurar todo') : null, GESTION_T() ? h('a', { class: 'btn-sec btn-peq', href: `#representantes?rep=${r.id}` }, texto(zonas[reps.indexOf(r)]) ? 'Editar zona' : 'Asignar zona') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => editarDatos(r) }, 'Editar datos') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => nuevaClave(r) }, 'Nueva clave') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', onclick: () => darBaja(r) }, 'Dar de baja') : null] }], reps, ['Aún no hay representantes activos', 'Regístralos en "Nuevo representante".']), bajas);
};


// ---------------------------------------------------------------- configurar representante: todo en un solo lugar, paso a paso
const PASOS_REP = [['datos', 'Datos'], ['zona', 'Zona de trabajo'], ['vehiculo', 'Vehículo y comida'], ['lugares', 'Establecimientos'], ['medicos', 'Médicos'], ['hoteles', 'Hoteles'], ['cronograma', 'Cronograma'], ['resumen', 'Resumen']];
/** Barra de progreso + control segmentado de pasos. Un paso bloqueado no se puede abrir hasta completar el anterior. */
function barraPasosRep(actual, hechos, maxAbierto, ir) {
  const i0 = PASOS_REP.findIndex(([id]) => id === actual);
  const pct = Math.round(((i0 + 1) / PASOS_REP.length) * 100);
  const botones = PASOS_REP.map(([id, label], i) => {
    const bloqueado = i > maxAbierto; const hecho = hechos.has(id) && id !== actual;
    return h('button', { type: 'button', role: 'tab', class: `asis-paso${hecho ? ' hecho' : ''}${bloqueado ? ' bloqueado' : ''}`, 'aria-selected': String(id === actual), 'aria-disabled': bloqueado ? 'true' : null,
      tabindex: id === actual ? '0' : '-1', title: bloqueado ? 'Completa el paso anterior para abrirlo' : null, onclick: () => { if (!bloqueado && id !== actual) ir(id); } },
    h('span', { class: 'asis-num', 'aria-hidden': 'true' }, hecho ? '✓' : String(i + 1)), h('span', { class: 'asis-txt' }, label));
  });
  const seg = h('div', { class: 'asis-pasos', role: 'tablist', 'aria-label': 'Pasos de la configuración' }, ...botones);
  seg.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = botones.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); let j = i;
    do { j = (j + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length; } while (j > maxAbierto && j !== i);
    botones[j].focus();
  });
  return h('div', { class: 'asis-barra' },
    h('p', { class: 'asis-texto' }, `Paso ${i0 + 1} de ${PASOS_REP.length}: ${PASOS_REP[i0][1]}`),
    h('div', { class: 'asis-riel', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Avance de la configuración' }, h('span', { style: `width:${pct}%` })),
    seg);
}
/** Botones Atrás / Siguiente del asistente. */
function navPasosRep(paso, ir, { siguiente, textoSiguiente = 'Siguiente', bloqueado = false, motivo = null } = {}) {
  const i = PASOS_REP.findIndex(([id]) => id === paso);
  const sig = PASOS_REP[i + 1];
  const b = sig ? h('button', { class: 'btn', type: siguiente === 'submit' ? 'submit' : 'button', disabled: bloqueado, title: bloqueado ? motivo : null }, textoSiguiente) : null;
  if (b && siguiente !== 'submit') b.addEventListener('click', async () => { if (typeof siguiente === 'function') { b.disabled = true; const ok = await siguiente(); b.disabled = false; if (ok === false) return; } ir(sig[0]); });
  return { nodo: h('div', { class: 'acciones asis-nav' }, i > 0 ? h('button', { class: 'btn-sec', type: 'button', onclick: () => ir(PASOS_REP[i - 1][0]) }, 'Atrás') : null, b, bloqueado && motivo ? h('p', { class: 'hint asis-motivo' }, motivo) : null), boton: b };
}
const SESION_REP = {}; // pasos abiertos por representante en esta sesión
V.configurar = async () => {
  if (!GESTION_T()) return vista('Configurar representante', null, h('div', { class: 'aviso' }, 'Solo la gerencia y la administración configuran representantes.'));
  const rep = param('rep'); const mesP = param('mes'); const mes = /^\d{4}-\d{2}$/.test(mesP ?? '') ? mesP : mesActual();
  const [div, { items: combs }, { item: globales }, { items: reps }] = await Promise.all([division(), api('GET', '/api/viaticos/combustibles'), api('GET', '/api/viaticos/tarifas-publico'), api('GET', '/api/viaticos/representantes')]);
  const r = rep ? reps.find((x) => x.id === rep) : null;
  if (rep && !r) return vista('Configurar representante', null, h('div', { class: 'aviso error' }, 'Ese representante no está activo.'), h('a', { class: 'btn-sec', href: '#representantes' }, 'Volver a representantes'));
  if (!rep && !ES_GER()) return vista('Configurar representante', null, h('div', { class: 'aviso' }, 'Solo la gerencia registra representantes nuevos.'));
  const [zona, pf, todosCron] = rep ? await Promise.all([api('GET', `/api/territorio/zonas/${rep}`).then((x) => x.item), api('GET', `/api/viaticos/perfiles/${rep}`).then((x) => x.item).catch(() => null), api('GET', `/api/cronogramas?representanteId=${rep}`).then((x) => x.items)]) : [null, null, []];
  const diasAprob = todosCron.filter((c) => c.estado === 'aprobado' && c.fecha.startsWith(mes));
  const yaProgramado = todosCron.some((c) => c.estado === 'aprobado'); // ya tiene ruta en algún mes: los pasos de revisión cuentan como hechos
  // Qué está completo y hasta dónde se puede abrir
  const hechos = new Set();
  if (r?.position) hechos.add('datos');
  if (zona?.provincias?.length && pf?.residencia?.provincia) hechos.add('zona');
  if (pf?.vehiculo?.propiedad) hechos.add('vehiculo');
  const ses = (SESION_REP[rep ?? 'nuevo'] ??= new Set());
  for (const x of ses) hechos.add(x);
  if (yaProgramado && hechos.has('vehiculo')) ['lugares', 'medicos', 'hoteles'].forEach((x) => hechos.add(x));
  if (diasAprob.length && hechos.has('vehiculo')) hechos.add('cronograma');
  if (hechos.has('lugares') && r && !['Visitador', 'PVC'].includes(r.position)) hechos.add('medicos'); // los vendedores no tienen cartera de médicos
  if (ses.has('cronograma')) hechos.add('cronograma');
  let maxAbierto = PASOS_REP.findIndex(([id]) => !hechos.has(id)); if (maxAbierto < 0) maxAbierto = PASOS_REP.length - 1;
  const pedido = param('paso'); const iPed = PASOS_REP.findIndex(([id]) => id === pedido);
  const paso = iPed >= 0 && iPed <= maxAbierto ? pedido : PASOS_REP[Math.min(maxAbierto, rep ? maxAbierto : 0)][0];
  const ir = (id) => irA('configurar', { ...(rep ? { rep } : {}), paso: id, mes });
  const titulo = r ? `Configurar a ${r.fullName}` : 'Nuevo representante';
  const sub = 'Todo su territorio en un solo lugar: datos, zona, establecimientos, vehículo, comida, hoteles y cronograma. Al terminar verás el resumen de km y gastos del mes. El salario no forma parte de los viáticos.';
  const barra = barraPasosRep(paso, hechos, maxAbierto, ir);
  const cuerpo = await pasoRep(paso, { rep, r, zona, pf, div, combs, globales, mes, diasAprob, ir, ses });
  return vista(titulo, sub, h('p', { class: 'asis-volver' }, h('a', { href: '#representantes' }, 'Volver a representantes')), barra, ...[cuerpo].flat());
};

/** Borrador del representante nuevo (pasos 1 a 3), se guarda todo junto al crear la cuenta. */
let borradorRep = {};
async function pasoRep(paso, ctx) {
  const { rep, r, zona, pf, div, combs, globales, mes, diasAprob, ir, ses } = ctx;
  const nuevo = !rep; const B = borradorRep;
  if (paso === 'datos') {
    const [n0, ...a0] = (r?.fullName ?? '').split(' ');
    const v = (k, x) => (nuevo ? B[k] ?? '' : x ?? '');
    const pos = campo('posicion', 'Posición', { options: POSICIONES.map((x) => ({ value: x, label: x })), placeholder: 'Elige la posición', value: v('posicion', r?.position) });
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Datos del representante'),
      h('p', { class: 'hint' }, nuevo ? 'El sistema crea su usuario y una contraseña temporal cuando termines el paso 3. Al entrar por primera vez, elige su propia contraseña.' : 'Si cambias el nombre o el apellido, se le crea un usuario nuevo y vuelve a la contraseña inicial.'),
      h('div', { class: 'form-fila' }, campo('nombre', 'Nombre', { autocomplete: 'off', value: v('nombre', n0) }), campo('apellido', 'Apellido', { autocomplete: 'off', value: v('apellido', a0.join(' ')) }), pos),
      h('div', { class: 'form-fila' }, campo('telefono', 'Teléfono', { inputmode: 'tel', autocomplete: 'off', value: v('telefono', r?.phone) }, '(opcional)'), campo('correo', 'Correo', { type: 'email', autocomplete: 'off', value: v('correo', r?.email) }, '(opcional: le llega su usuario y el enlace para entrar)')));
    const nav = navPasosRep('datos', ir, { siguiente: 'submit' }); f.append(nav.nodo);
    if (nuevo && B.errores) { const e0 = B.errores; delete B.errores; setTimeout(() => errPaso(f, e0, 'Revisa los campos marcados.'), 0); }
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const g = (k) => f.elements[k].value.trim();
      const err = {};
      if (g('nombre').length < 2) err.nombre = 'Escribe el nombre.';
      if (g('apellido').length < 2) err.apellido = 'Escribe el apellido.';
      if (!g('posicion')) err.posicion = 'Elige la posición.';
      if (Object.keys(err).length) { errPaso(f, err); return; }
      if (nuevo) { Object.assign(B, { nombre: g('nombre'), apellido: g('apellido'), posicion: g('posicion'), telefono: g('telefono'), correo: g('correo') }); ses.add('datos'); ir('zona'); return; }
      const cambio = {}; if (`${g('nombre')} ${g('apellido')}` !== r.fullName) Object.assign(cambio, { nombre: g('nombre'), apellido: g('apellido') });
      if (g('telefono') !== (r.phone ?? '')) cambio.telefono = g('telefono'); if (g('correo') !== (r.email ?? '')) cambio.correo = g('correo');
      const ok = await enviar(f, nav.boton, async () => {
        let x = {}; if (Object.keys(cambio).length) x = await api('POST', `/api/representantes/${rep}/editar`, cambio);
        if (g('posicion') !== r.position && zona?.provincias?.length) await api('POST', `/api/territorio/zonas/${rep}`, { provincias: zona.provincias, municipios: zona.municipios ?? {}, posicion: g('posicion') });
        return x;
      });
      if (!ok) return;
      ses.add('datos');
      if (ok.usuario) mostrarCredenciales('Nombre cambiado: acceso nuevo', ok, () => ir('zona')); else ir('zona');
    });
    return f;
  }
  if (paso === 'zona') {
    const res = residenciaCampos(div, nuevo ? B.residencia : pf?.residencia);
    const puntoSalida = campoPuntoSalida(nuevo ? B.residencia : pf?.residencia, res);
    const provs = h('div', { class: 'provincias provincias-zona' }, filasZona(div, nuevo ? B.zona : zona));
    const posicion = nuevo ? B.posicion : r.position;
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Dónde vive y dónde trabaja'),
      h('h3', { class: 'subtitulo-form' }, 'Dónde vive'), h('p', { class: 'hint' }, 'De aquí sale y aquí regresa cada día: con esto se calculan los km.'),
      h('div', { class: 'form-fila' }, res.fp, res.fm),
      puntoSalida.nodo,
      h('h3', { class: 'subtitulo-form' }, 'Provincias y municipios que trabajará'),
      h('p', { class: 'hint' }, `Con esto se conectan sus farmacias, hospitales, clínicas, UNAP y hoteles. Si solo trabaja algunos municipios, abre la provincia y márcalos. Lo marcado en gris ya lo cubre otro ${posicion ?? 'representante'} de la misma posición.`),
      h('p', { class: 'error', dataset: { for: 'provincias' } }), h('p', { class: 'error', dataset: { for: 'municipios' } }), provs);
    marcarOcupadas(provs, posicion, rep);
    const nav = navPasosRep('zona', ir, { siguiente: 'submit' }); f.append(nav.nodo);
    if (nuevo && B.errores) { const e0 = B.errores; delete B.errores; setTimeout(() => errPaso(f, e0, 'Revisa los campos marcados.'), 0); }
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const z = zonaDeForm(f); const pto = puntoSalida.leer();
      const residencia = { provincia: res.sp.value, municipio: res.sm.value, direccion: f.elements['residencia.direccion'].value.trim(), lat: pto.lat ?? null, lng: pto.lng ?? null };
      const err = {};
      if (pto.error) err['residencia.coordenadas'] = pto.error;
      if (!residencia.provincia) err['residencia.provincia'] = 'Elige la provincia donde vive.'; else if (!residencia.municipio) err['residencia.municipio'] = 'Elige el municipio donde vive.';
      if (!z.provincias.length) err.provincias = 'Elige al menos una provincia que trabajará.';
      if (Object.keys(err).length) { errPaso(f, err); return; }
      if (nuevo) { B.residencia = residencia; B.zona = z; ses.add('zona'); ir('vehiculo'); return; }
      const ok = await enviar(f, nav.boton, async () => {
        await api('POST', `/api/territorio/zonas/${rep}`, { ...z, posicion: r.position });
        // La residencia vive en el perfil de viático: si ya hay perfil, se actualiza solo la residencia.
        if (pf?.vehiculo) await api('POST', `/api/viaticos/perfiles/${rep}`, { ...perfilBody(pf), residencia });
        else ctx.ses.residencia = residencia;
        return true;
      });
      if (ok) { ses.add('zona'); ir('vehiculo'); }
    });
    return f;
  }
  if (paso === 'vehiculo') {
    const base = nuevo ? B.perfil ?? null : pf;
    const veh = formularioVehiculo(base, combs, globales, nuevo ? B.posicion : r.position);
    const comida = camposComida(base);
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Vehículo, comida y tope'),
      veh.el,
      h('h3', { class: 'subtitulo-form' }, 'Comida por día'), comida.nodo,
      h('h3', { class: 'subtitulo-form' }, 'Reembolso y tope'),
      h('div', { class: 'form-fila' },
        h('div', { class: 'solo-vehiculo' }, campo('reembolsoPorKm', 'Reembolso por km RD$', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal', value: base?.reembolsoPorKm ?? '' }, '(solo vehículo propio; reemplaza al combustible)')),
        campo('topeCombustible', 'Tope mensual de combustible o transporte RD$', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal', value: base?.topeCombustible ?? '' }, '(vacío = tope global)')));
    const sincronizar = () => f.querySelectorAll('.solo-vehiculo').forEach((x) => { x.hidden = !veh.tiene(); });
    veh.el.addEventListener('change', sincronizar); sincronizar();
    const nav = navPasosRep('vehiculo', ir, { siguiente: 'submit', textoSiguiente: nuevo ? 'Crear representante y seguir' : 'Guardar y seguir' }); f.append(nav.nodo);
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const g = (k) => f.elements[k].value;
      const cm = comida.leer();
      const extra = { tarifaAlimentacion: veh.tiene() && !cm.comidaDesglose ? cm.tarifaAlimentacion : '', comidaDesglose: cm.comidaDesglose, reembolsoPorKm: veh.tiene() ? g('reembolsoPorKm') : '', topeCombustible: g('topeCombustible') };
      if (nuevo) {
        const body = { nombre: B.nombre, apellido: B.apellido, posicion: B.posicion, telefono: B.telefono, correo: B.correo, residencia: B.residencia, ...B.zona, ...veh.valores(f), ...extra };
        let x = null; const txt = nav.boton.textContent; nav.boton.disabled = true; nav.boton.textContent = 'Creando…';
        try { x = await api('POST', '/api/representantes', body); }
        catch (err) {
          const k = Object.keys(err.fields ?? {});
          const aDatos = k.some((c) => ['nombre', 'apellido', 'posicion', 'telefono', 'correo'].includes(c));
          const aZona = k.some((c) => c.startsWith('residencia') || ['provincias', 'municipios'].includes(c));
          if (aDatos || aZona) { B.errores = err.fields; ses.delete(aDatos ? 'datos' : 'zona'); ir(aDatos ? 'datos' : 'zona'); return; }
          errPaso(f, err.fields, err.message); return;
        } finally { nav.boton.disabled = false; nav.boton.textContent = txt; }
        borradorRep = {}; SESION_REP[x.representante.id] = new Set(['datos', 'zona', 'vehiculo']);
        mostrarCredenciales(`${x.representante.nombre} quedó registrado`, { ...x, usuario: x.representante.usuario }, () => irA('configurar', { rep: x.representante.id, paso: 'lugares', mes }));
        return;
      }
      const residencia = pf?.residencia ?? ses.residencia;
      if (!residencia) { ir('zona'); return; }
      const ok = await enviar(f, nav.boton, () => api('POST', `/api/viaticos/perfiles/${rep}`, { residencia, ...veh.valores(f), ...extra }));
      if (ok) { ses.add('vehiculo'); ir('lugares'); }
    });
    return f;
  }
  if (paso === 'lugares') {
    const TIP = { farmacia: 'Farmacia', hospital: 'Hospital', clinica: 'Clínica', unap: 'UNAP', cpn: 'Primer nivel', diagnostico: 'Centro diagnóstico', consultorio: 'Consultorio' };
    const uni = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const cont = h('div', { class: 'asis-lista', 'aria-live': 'polite' }); const sel = new Set(); let deshacer = null; let abierto = false;
    const nav = navPasosRep('lugares', ir, { siguiente: () => { ses.add('lugares'); } });
    const nombreRep = r?.fullName ?? 'el representante';
    const cambiar = async (cuerpo, hecho) => {
      try { await api('POST', `/api/territorio/zonas/${rep}/excluidos`, cuerpo); }
      catch (e) { alert(e.message); return; }
      deshacer = hecho ? { texto: hecho, cuerpo: cuerpo.quitar ? { volver: cuerpo.quitar } : { quitar: cuerpo.volver } } : null;
      sel.clear(); await pintar();
    };
    const quitar = (ids) => cambiar({ quitar: ids }, `${fmtN.format(ids.length)} lugar(es) quitado(s) de la ruta de ${nombreRep}.`);
    const volver = (ids) => cambiar({ volver: ids }, `${fmtN.format(ids.length)} lugar(es) agregado(s) de nuevo a su ruta.`);
    async function pintar() {
      let lz; try { lz = await api('GET', `/api/territorio/zonas/${rep}/lugares`); } catch (e) { cont.replaceChildren(h('div', { class: 'aviso error' }, e.message)); return; }
      const todos = [...lz.farmacias.map((x) => ({ ...x, tipo: 'farmacia' })), ...lz.establecimientos].sort((a, b) => a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
      const fuera = (lz.excluidos ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      if (nav.boton) { nav.boton.disabled = !todos.length; nav.boton.title = todos.length ? '' : 'Agrega al menos un lugar a su ruta para seguir.'; }
      const porTipo = Object.entries(todos.reduce((m, x) => ((m[x.tipo] = (m[x.tipo] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
      let vistos = [];
      const todosVis = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los lugares que se ven' });
      const bMarc = h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', disabled: true });
      const bTodos = h('button', { class: 'btn-sec btn-peq', type: 'button' });
      const contar = () => {
        const n = vistos.filter((x) => sel.has(x.id)).length;
        todosVis.checked = n > 0 && n === vistos.length; todosVis.indeterminate = n > 0 && n < vistos.length;
        bMarc.disabled = !sel.size; bMarc.textContent = sel.size ? `Quitar ${fmtN.format(sel.size)} marcado(s)` : 'Quitar marcados';
        bTodos.textContent = `Quitar todos los que se ven (${fmtN.format(vistos.length)})`; bTodos.disabled = !vistos.length;
      };
      todosVis.addEventListener('change', () => { vistos.forEach((x) => (todosVis.checked ? sel.add(x.id) : sel.delete(x.id))); cont.querySelectorAll('input[data-lugar]').forEach((c) => { c.checked = sel.has(c.dataset.lugar); }); contar(); });
      bMarc.addEventListener('click', () => quitar([...sel]));
      bTodos.addEventListener('click', async () => {
        if (!(await confirmar('Quitar todos', `${fmtN.format(vistos.length)} lugar(es) saldrán de la ruta de ${nombreRep}: de su propuesta de cronograma y de su meta de visitas. Siguen en el catálogo y en la zona de los demás. Puedes deshacerlo.`, { okTexto: `Quitar ${fmtN.format(vistos.length)}` }))) return;
        quitar(vistos.map((x) => x.id));
      });
      const cols = [
        { t: '', v: (x) => h('input', { type: 'checkbox', 'data-lugar': x.id, checked: sel.has(x.id), 'aria-label': `Marcar ${x.nombre}`, onchange: (e) => { e.target.checked ? sel.add(x.id) : sel.delete(x.id); contar(); } }) },
        { t: 'Lugar', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion ?? '')] }, { t: 'Tipo', v: (x) => TIP[x.tipo] ?? x.tipo },
        { t: 'Municipio', v: (x) => `${x.municipio}, ${x.provincia}` }, { t: 'Ubicación', v: (x) => (x.lat == null ? h('span', { class: 'chip pendiente' }, 'Sin ubicación') : 'Sí') },
        { t: '', v: (x) => h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => quitar([x.id]) }, 'Quitar') }];
      const campos = [
        { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre o dirección', valor: (x) => `${x.nombre} ${x.direccion ?? ''}` },
        { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: uni(todos.map((x) => x.municipio)), valor: (x) => x.municipio },
        { id: 'tipo', etiqueta: 'Tipos', tipo: 'opciones', plural: 'tipos', opciones: uni(todos.map((x) => x.tipo)).map((t) => ({ value: t, label: TIP[t] ?? t })), valor: (x) => x.tipo },
      ];
      const lista = todos.length ? listaFiltrada(`asis-lugares-${rep}`, todos, campos, (vs, activos) => {
        vistos = vs; contar();
        return h('div', {}, h('div', { class: 'lote-barra asis-lote' }, h('label', { class: 'check' }, todosVis, h('span', {}, 'Marcar los que se ven')), bMarc, bTodos),
          tabla(cols, vs, activos ? ['Ningún lugar con estos filtros', 'Cambia o limpia los filtros.'] : ['', ''], { porPagina: 15 }));
      }) : h('div', { class: 'tarjeta vacio' }, h('strong', {}, fuera.length ? 'Quitaste todos los lugares de su ruta' : 'Su zona no tiene lugares'), fuera.length ? 'Vuelve a agregar los que visitará en "Quitados de su ruta" o búscalos abajo.' : 'Búscalos abajo en Google Maps.');
      const quitados = fuera.length ? h('details', { class: 'tarjeta asis-quitados', open: abierto || !todos.length, ontoggle: (e) => { abierto = e.target.open; } }, h('summary', {}, `Quitados de su ruta (${fmtN.format(fuera.length)})`),
        h('div', { class: 'asis-quitados-cabeza' }, h('p', { class: 'hint' }, 'No entran en su cronograma ni en su meta de visitas. Siguen en el catálogo. Filtra, marca los que visitará y agrégalos.')),
        listaMarcable({ clave: `asis-quitados-${rep}`, filas: fuera, verbo: 'Agregar', accion: (ids) => volver(ids),
          campos: [{ id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre o dirección', valor: (x) => `${x.nombre} ${x.direccion ?? ''}` },
            { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: uni(fuera.map((x) => x.municipio)), valor: (x) => x.municipio },
            { id: 'tipo', etiqueta: 'Tipos', tipo: 'opciones', plural: 'tipos', opciones: uni(fuera.map((x) => x.tipo)).map((t) => ({ value: t, label: TIP[t] ?? t })), valor: (x) => x.tipo }],
          cols: [{ t: 'Lugar', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion ?? '')] }, { t: 'Tipo', v: (x) => TIP[x.tipo] ?? x.tipo }, { t: 'Municipio', v: (x) => `${x.municipio}, ${x.provincia}` },
            { t: '', v: (x) => h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => volver([x.id]) }, 'Volver a agregar') }] })) : null;
      cont.replaceChildren(...[
        deshacer ? h('div', { class: 'asis-deshacer', role: 'status' }, h('span', {}, deshacer.texto), h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => cambiar(deshacer.cuerpo, null) }, 'Deshacer')) : null,
        h('div', { class: 'tarjeta' }, h('h2', {}, `Establecimientos que visitará (${fmtN.format(todos.length)})`),
          h('p', { class: 'hint' }, 'Son los lugares de su zona que entran a su cronograma y a su meta de visitas. Quitar aquí lo saca solo de su ruta: no se borra del catálogo ni de la zona de los demás.'),
          porTipo.length ? h('div', { class: 'asis-chips' }, porTipo.map(([t, n]) => h('span', { class: 'asis-chip' }, h('strong', {}, fmtN.format(n)), ` ${TIP[t] ?? t}`))) : null, lista),
        quitados].filter(Boolean));
    }
    await pintar();
    const zprov = zona?.provincias ?? [];
    const buscador = await buscadorGoogle([['farmacia', 'Farmacias'], ['clinica', 'Clínicas'], ['hospital', 'Hospitales'], ['unap', 'UNAP'], ['cpn', 'Centros de primer nivel'], ['diagnostico', 'Centros diagnósticos'], ['consultorio', 'Consultorios']], () => pintar(),
      { provincias: zprov, municipios: Object.fromEntries(zprov.map((p) => [p, zona.municipios?.[p]?.length ? zona.municipios[p] : div.municipios[p]])), titulo: 'Buscar y agregar lugares', nota: 'Busca en Google Maps dentro de su zona y agrega con un clic: entra al catálogo y a su ruta. Si ya está registrado pero lo quitaste, vuélvelo a agregar en "Quitados de su ruta".' });
    return [cont, buscador, nav.nodo];
  }
  if (paso === 'medicos') return pasoMedicosRep({ rep, r, ir, ses });
  if (paso === 'hoteles') {
    const provs = zona?.provincias ?? [];
    const puedeEditar = ES_GER();
    const reqs = (await api('GET', '/api/hoteles/requisitos')).items;
    const cont = h('div', { class: 'asis-lista', 'aria-live': 'polite' }); const sel = new Set(); let deshacer = null; let abierto = false;
    const nav = navPasosRep('hoteles', ir, { siguiente: () => { ses.add('hoteles'); } });
    const enZona = (x) => !zona.municipios?.[x.provincia]?.length || zona.municipios[x.provincia].includes(x.municipio);
    const lote = async (ids, estado, hecho) => {
      try { await api('POST', '/api/hoteles/lote', { ids, estado }); } catch (e) { alert(e.message); return; }
      deshacer = hecho ? { texto: hecho, ids, estado: estado === 'inactivo' ? 'activo' : 'inactivo' } : null; sel.clear(); await pintar();
    };
    const quitar = (ids) => lote(ids, 'inactivo', `${fmtN.format(ids.length)} hotel(es) quitado(s): ya no se usan para las noches fuera.`);
    const volver = (ids) => lote(ids, 'activo', `${fmtN.format(ids.length)} hotel(es) se vuelven a usar.`);
    async function pintar() {
      const [listas, recs] = await Promise.all([Promise.all(provs.map((p) => api('GET', `/api/hoteles?provincia=${encodeURIComponent(p)}`).then((x) => x.items).catch(() => []))),
        Promise.all(provs.map((p) => api('GET', `/api/hoteles/recomendado?provincia=${encodeURIComponent(p)}`).then((x) => x.item).catch(() => null)))]);
      const todos = listas.flat().filter(enZona);
      const hs = todos.filter((x) => x.estado !== 'inactivo'); const fuera = todos.filter((x) => x.estado === 'inactivo');
      const recIds = new Set(recs.map((x) => x?.hotel?.id).filter(Boolean));
      let vistos = [];
      const todosVis = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los hoteles que se ven' });
      const bMarc = h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', disabled: true });
      const bTodos = h('button', { class: 'btn-sec btn-peq', type: 'button' });
      const contar = () => {
        const n = vistos.filter((x) => sel.has(x.id)).length;
        todosVis.checked = n > 0 && n === vistos.length; todosVis.indeterminate = n > 0 && n < vistos.length;
        bMarc.disabled = !sel.size; bMarc.textContent = sel.size ? `Quitar ${fmtN.format(sel.size)} marcado(s)` : 'Quitar marcados';
        bTodos.textContent = `Quitar todos los que se ven (${fmtN.format(vistos.length)})`; bTodos.disabled = !vistos.length;
      };
      todosVis.addEventListener('change', () => { vistos.forEach((x) => (todosVis.checked ? sel.add(x.id) : sel.delete(x.id))); cont.querySelectorAll('input[data-hotel]').forEach((c) => { c.checked = sel.has(c.dataset.hotel); }); contar(); });
      bMarc.addEventListener('click', () => quitar([...sel]));
      bTodos.addEventListener('click', async () => { if (await confirmar('Quitar todos', `${fmtN.format(vistos.length)} hotel(es) dejarán de usarse para las noches fuera. Su historial se conserva y puedes deshacerlo.`, { okTexto: `Quitar ${fmtN.format(vistos.length)}` })) quitar(vistos.map((x) => x.id)); });
      const precio = (x) => {
        if (!puedeEditar) return Number(x.precioNoche) > 0 ? RD(x.precioNoche) : h('span', { class: 'chip pendiente' }, 'Sin precio');
        const i = h('input', { type: 'number', min: 1, step: 0.01, inputmode: 'decimal', class: 'precio-celda', value: x.precioNoche ?? '', placeholder: 'Sin precio', 'aria-label': `Precio por noche de ${x.nombre} en RD$` });
        const ok = h('small', { class: 'precio-ok', 'aria-live': 'polite' });
        i.addEventListener('change', async () => {
          ok.textContent = 'Guardando…';
          try { await api('POST', `/api/hoteles/${x.id}`, { precioNoche: i.value || null }); x.precioNoche = i.value ? Number(i.value) : null; ok.textContent = 'Guardado'; setTimeout(() => { ok.textContent = ''; }, 2500); }
          catch (e) { ok.textContent = ''; alert(e.message); i.value = x.precioNoche ?? ''; }
        });
        return h('div', { class: 'precio-caja' }, h('span', { 'aria-hidden': 'true' }, 'RD$'), i, ok, x.itbis ? h('small', { class: 'precio-desayuno' }, `+ ITBIS: ${RD(x.precioFinal)} por noche`) : null, x.desayunoIncluido ? h('small', { class: 'precio-desayuno' }, x.valorDesayuno ? `Con desayuno (${RD(x.valorDesayuno)})` : 'Con desayuno') : null);
      };
      const estadoReq = (x) => x.cumple ? h('span', { class: 'chip validado' }, 'Cumple todo') : h('span', { class: 'chip pendiente', title: (x.faltan ?? []).map((k) => reqs.find((q) => q.value === k)?.label ?? k).join(', ') }, `Faltan ${fmtN.format(x.faltan?.length ?? reqs.length)} requisito(s)`);
      const cols = [
        ...(puedeEditar ? [{ t: '', v: (x) => h('input', { type: 'checkbox', 'data-hotel': x.id, checked: sel.has(x.id), 'aria-label': `Marcar ${x.nombre}`, onchange: (e) => { e.target.checked ? sel.add(x.id) : sel.delete(x.id); contar(); } }) }] : []),
        { t: 'Hotel', v: (x) => [h('span', {}, x.nombre, recIds.has(x.id) ? h('span', { class: 'chip ok', style: 'margin-left:.4rem' }, 'Recomendado') : null), h('small', { style: 'display:block;color:var(--texto-2)' }, [x.telefono, x.direccion].filter(Boolean).join('. '))] },
        { t: 'Municipio', v: (x) => `${x.municipio}, ${x.provincia}` },
        { t: 'Precio por noche', v: precio }, { t: 'Requisitos', v: estadoReq },
        ...(puedeEditar ? [{ t: '', v: (x) => h('div', { class: 'acciones-fila' }, h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: async () => { if (await editarHotel(x, reqs)) pintar(); } }, 'Editar'), h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => quitar([x.id]) }, 'Quitar')) }] : []),
      ];
      const campos = [
        { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre, teléfono o dirección', valor: (x) => `${x.nombre} ${x.telefono ?? ''} ${x.direccion ?? ''}` },
        { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: [...new Set(hs.map((x) => x.municipio))].sort((a, b) => a.localeCompare(b, 'es')), valor: (x) => x.municipio },
        { id: 'precio', etiqueta: 'Precio', tipo: 'opciones', opciones: [{ value: 'con', label: 'Con precio' }, { value: 'sin', label: 'Sin precio' }], valor: (x) => (Number(x.precioNoche) > 0 ? 'con' : 'sin') },
      ];
      const lista = hs.length ? listaFiltrada(`asis-hoteles-${rep}`, hs, campos, (vs, activos) => {
        vistos = vs; contar();
        return h('div', {}, puedeEditar ? h('div', { class: 'lote-barra asis-lote' }, h('label', { class: 'check' }, todosVis, h('span', {}, 'Marcar los que se ven')), bMarc, bTodos) : null,
          tabla(cols, vs, activos ? ['Ningún hotel con estos filtros', 'Cambia o limpia los filtros.'] : ['', ''], { porPagina: 10 }));
      }) : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay hoteles en uso en su zona'), 'Si nunca duerme fuera, puedes seguir. Para agregar uno, búscalo abajo.');
      const quitados = fuera.length && puedeEditar ? h('details', { class: 'tarjeta asis-quitados', open: abierto, ontoggle: (e) => { abierto = e.target.open; } }, h('summary', {}, `Hoteles que no se usan (${fmtN.format(fuera.length)})`),
        h('div', { class: 'asis-quitados-cabeza' }, h('p', { class: 'hint' }, 'No se usan para las noches fuera. Su historial se conserva.')),
        listaMarcable({ clave: `asis-hq-${rep}`, filas: fuera, verbo: 'Volver a usar', accion: (ids) => volver(ids),
          campos: [{ id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre o teléfono', valor: (x) => `${x.nombre} ${x.telefono ?? ''}` },
            { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: [...new Set(fuera.map((x) => x.municipio))].sort((a, b) => a.localeCompare(b, 'es')), valor: (x) => x.municipio }],
          cols: [{ t: 'Hotel', v: (x) => x.nombre }, { t: 'Municipio', v: (x) => `${x.municipio}, ${x.provincia}` }, { t: 'Precio', num: true, v: (x) => (Number(x.precioNoche) > 0 ? RD(x.precioNoche) : '') },
            { t: '', v: (x) => h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => volver([x.id]) }, 'Volver a usar') }] })) : null;
      cont.replaceChildren(...[
        deshacer ? h('div', { class: 'asis-deshacer', role: 'status' }, h('span', {}, deshacer.texto), h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => lote(deshacer.ids, deshacer.estado, null) }, 'Deshacer')) : null,
        h('div', { class: 'tarjeta' }, h('h2', {}, `Hoteles de su zona (${fmtN.format(hs.length)})`),
          h('p', { class: 'hint' }, 'Cuando un día del cronograma está marcado "duerme fuera", la noche entra al presupuesto con el hotel recomendado de esa provincia: el más económico con precio confirmado que cumple todos los requisitos. Si ninguno cumple, se usa el precio de referencia.'),
          h('dl', { class: 'rejilla' }, provs.map((p, i) => h('div', { class: 'cifra' }, h('dt', {}, `Recomendado en ${p}`), h('dd', {}, recs[i]?.hotel ? `${recs[i].hotel.nombre}, ${RD(recs[i].hotel.precioFinal ?? recs[i].hotel.precioNoche)}` : 'Sin hotel confirmado')))),
          recs.some((x) => !x) && puedeEditar ? h('p', { class: 'hint' }, 'Para tener recomendado, escribe el precio y marca los requisitos con "Editar".') : null, lista),
        quitados].filter(Boolean));
    }
    await pintar();
    const zm = Object.fromEntries(provs.map((p) => [p, zona.municipios?.[p]?.length ? zona.municipios[p] : div.municipios[p]]));
    const buscador = puedeEditar ? await buscadorGoogle([['hotel', 'Hoteles']], () => pintar(), { provincias: provs, municipios: zm, titulo: 'Buscar y agregar hoteles', nota: 'Busca en Google Maps dentro de su zona y agrega con un clic. Después escribe su precio y marca los requisitos.' }) : null;
    return [cont, buscador, nav.nodo];
  }
  if (paso === 'cronograma') {
    const esAdmin = yo.role === 'administrador';
    const sig = (() => { const [y, m] = mesActual().split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const meses = [[mesActual(), `Este mes (${nombreMesLargo(mesActual())})`], [sig, `Próximo mes (${nombreMesLargo(sig)})`]];
    if (!meses.some(([m]) => m === mes)) meses.push([mes, nombreMesLargo(mes)]);
    const segMes = segmentos('Mes del cronograma', meses, mes, (m) => irA('configurar', { rep, paso: 'cronograma', mes: m }));
    const recargar = () => { ses.add('cronograma'); router(); };
    const nav = navPasosRep('cronograma', ir, { siguiente: () => { ses.add('cronograma'); }, textoSiguiente: 'Ver resumen', bloqueado: !diasAprob.length && esAdmin, motivo: 'Aprueba al menos un día del cronograma de este mes para ver el resumen.' });
    const nLug = diasAprob.reduce((n, c) => n + c.lugares.length, 0); const nNoche = diasAprob.filter((c) => c.duermeFuera).length;
    const partes = [h('div', { class: 'asis-mes' }, h('span', { class: 'asis-mes-etq' }, 'Mes'), segMes),
      h('div', { class: 'tarjeta' }, h('h2', {}, `Días aprobados en ${nombreMesLargo(mes)} (${fmtN.format(diasAprob.length)})`),
        diasAprob.length ? [h('p', { class: 'hint' }, `${fmtN.format(nLug)} visitas programadas${nNoche ? ` y ${fmtN.format(nNoche)} noche(s) fuera` : ''}. Marca las noches que duerme fuera: entran al presupuesto con el hotel elegido o el recomendado de esa provincia.`),
          await nochesFuera(diasAprob, recargar)]
          : h('p', { class: 'hint' }, esAdmin ? 'Aún no tiene días este mes. Copia la ruta del mes anterior o deja que el sistema la proponga; revisas y apruebas.' : 'Aún no tiene días este mes. El administrador programa y aprueba el cronograma.'))];
    if (esAdmin) partes.push(h('div', { class: 'asis-dos' }, await propuestaMes(rep, mes, div, recargar, r?.position), copiarMes(rep, mes, div, recargar)));
    if (!esAdmin && !diasAprob.length) partes.push(h('div', { class: 'aviso' }, 'Sin cronograma, el resumen no tendrá km ni gastos del mes.'));
    partes.push(nav.nodo);
    return partes;
  }
  // ---- resumen
  const [{ calculo: c, guardado: p }, av] = await Promise.all([api('GET', `/api/viaticos/presupuesto?representanteId=${rep}&mes=${mes}`), api('GET', `/api/metas/avance?mes=${mes}&representanteId=${rep}`).catch(() => ({ items: [] }))]);
  const lz = await api('GET', `/api/territorio/zonas/${rep}/lugares`).catch(() => ({ farmacias: [], establecimientos: [] }));
  const v = pf?.vehiculo ?? {};
  const s = c?.supuestos ?? {};
  const pub = v.propiedad === 'ninguno';
  const det = c?.detalle ?? {};
  const cifra = (t, val, extra) => h('div', { class: `cifra${extra ? ' destacada' : ''}` }, h('dt', {}, t), h('dd', {}, val));
  const fila = (t, val) => [h('dt', {}, t), h('dd', {}, val || '—')];
  const zonaTxt = (zona?.provincias ?? []).map((pr) => (zona.municipios?.[pr]?.length ? `${pr} (${zona.municipios[pr].join(', ')})` : pr)).join('; ');
  const vehTxt = pub ? 'Transporte público' : [v.propiedad === 'propio' ? 'Propio' : 'Asignado por FERSUAZ', [v.marca, v.modelo, v.anio].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const rend = v.rendimiento ? `${fmtN.format(v.rendimiento)} km por galón${v.rendimientoFuente === 'epa' ? ' (EPA)' : ''}` : '';
  const metas = av.items?.[0]?.metricas ?? [];
  const diasMes = (s.semanas ?? []).reduce((n, w) => n + (w.dias || 0), 0) || (s.jornadas ?? 0);
  const bloques = [];
  if (c?.faltan?.length) bloques.push(h('div', { class: 'aviso' }, h('strong', {}, 'Para calcular todo falta: '), c.faltan.join(' ')));
  for (const a of c?.avisos ?? []) bloques.push(h('div', { class: 'aviso' }, a));
  bloques.push(h('div', { class: 'tarjeta asis-resumen' }, h('h2', {}, `Viáticos estimados de ${nombreMesLargo(mes)}`),
    h('dl', { class: 'rejilla' },
      pub ? cifra('Transporte', RD(det.transporte ?? 0)) : [cifra('Km a recorrer', `${fmtN.format(s.km ?? 0)} km`), cifra('Combustible', RD(det.combustible ?? 0))],
      cifra('Comida', RD(det.alimentacion ?? 0)), cifra('Hoteles', RD(det.hospedaje ?? 0)),
      ((det.peajes ?? 0) + (det.estacionamiento ?? 0) + (det.otros ?? 0)) ? cifra('Peajes y otros', RD((det.peajes ?? 0) + (det.estacionamiento ?? 0) + (det.otros ?? 0))) : null,
      cifra('Total del mes', RD(c?.total ?? 0), true)),
    h('p', { class: 'hint', style: 'margin-top:.75rem' }, pub ? `${fmtN.format(diasMes)} día(s): ${fmtN.format(s.diasDentro ?? 0)} dentro de su zona y ${fmtN.format(s.diasFuera ?? 0)} fuera. El salario va aparte y no forma parte de estos viáticos.` : `${fmtN.format(diasMes)} día(s) de trabajo, ${fmtN.format(s.km ?? 0)} km (${s.kmTipo ?? 'estimados'})${s.galones ? `, ${fmtN.format(s.galones)} galones` : ''}${s.diasAlimentacion ? `, ${fmtN.format(s.diasAlimentacion)} día(s) de comida` : ''}. El salario va aparte y no forma parte de estos viáticos.`),
    p && !['borrador', 'rechazado'].includes(p.estado) ? h('div', { class: 'aviso ok' }, `Viáticos de este mes: ${EST_P[p.estado].toLowerCase()} por ${RD(p.total)}.`) : null));
  const dc = c?.detalle ? detalleCalculo(c, true) : null;
  if (dc?.semana) bloques.push(dc.semana);
  bloques.push(h('div', { class: 'asis-dos' },
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Perfil'), h('dl', { class: 'asis-ficha' },
      fila('Nombre', r.fullName), fila('Posición', r.position), fila('Teléfono', r.phone), fila('Correo', r.email),
      fila('Vive en', pf?.residencia ? `${pf.residencia.municipio}, ${pf.residencia.provincia}` : ''),
      fila('Vehículo', vehTxt), pub ? null : fila('Rendimiento', rend), pub ? null : fila('Combustible', COMB_NOMBRE[v.combustible] ?? ''),
      fila('Comida por día', pf?.comidaDesglose ? `${RD(pf.tarifaAlimentacion)} (desayuno ${RD(pf.comidaDesglose.desayuno)}, almuerzo ${RD(pf.comidaDesglose.almuerzo)}, cena ${RD(pf.comidaDesglose.cena)})` : pub ? 'Por zona (dentro o fuera)' : pf?.tarifaAlimentacion ? RD(pf.tarifaAlimentacion) : 'Monto de su posición'),
      fila('Tope mensual', pf?.topeCombustible ? RD(pf.topeCombustible) : 'Tope global'))),
    h('div', { class: 'tarjeta' }, h('h2', {}, 'Territorio y ruta'), h('dl', { class: 'asis-ficha' },
      fila('Zona', zonaTxt), fila('Farmacias', fmtN.format(lz.farmacias.length)), fila('Centros de salud', fmtN.format(lz.establecimientos.length)),
      fila('Días aprobados', fmtN.format(diasAprob.length)), fila('Visitas programadas', fmtN.format(diasAprob.reduce((n, x) => n + x.lugares.length, 0))),
      fila('Noches fuera', fmtN.format(diasAprob.filter((x) => x.duermeFuera).length)),
      ...metas.filter((m) => m.meta != null).flatMap((m) => fila(`Meta: ${m.nombre.toLowerCase()}`, `${fmtN.format(m.meta)} ${m.unidad}${m.vecesPorLugar ? ` (${m.vecesPorLugar} por lugar × ${fmtN.format(m.lugares)})` : ''}`))))));
  if (dc?.como) bloques.push(dc.como);
  bloques.push(h('div', { class: 'acciones asis-nav' }, h('button', { class: 'btn-sec', type: 'button', onclick: () => ir('cronograma') }, 'Atrás'),
    h('a', { class: 'btn', href: `#viatico?rep=${rep}&mes=${mes}` }, p && !['borrador', 'rechazado'].includes(p.estado) ? 'Ver sus viáticos' : 'Asignar viáticos del mes'),
    h('button', { class: 'btn-sec', type: 'button', onclick: () => print() }, 'Imprimir resumen')));
  return bloques;
}
/** Lee "19.4517, -70.6970", "19.4517 -70.6970" o un enlace de Google Maps con "@19.45,-70.69". */
function leerPunto(t) {
  const x = String(t ?? '').trim(); if (!x) return {};
  const m = x.match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return { error: 'Escribe la latitud y la longitud separadas por una coma, por ejemplo 19.4517, -70.6970.' };
  const lat = Number(m[1]); const lng = Number(m[2]);
  if (lat < 17.3 || lat > 20.1 || lng < -72.1 || lng > -68.1) return { error: 'Ese punto no está en República Dominicana. La latitud va primero (cerca de 18 o 19) y la longitud después (negativa, cerca de -70).' };
  return { lat, lng };
}
/**
 * Punto exacto desde donde sale: coordenadas, el nombre que da Google y el nombre editable.
 * Las coordenadas hacen exacto el cálculo de km; el nombre es solo para reconocerlo.
 */
function campoPuntoSalida(valor, res) {
  const coords = h('input', { id: 'res-coord', name: 'residencia.coordenadas', autocomplete: 'off', placeholder: '19.4517, -70.6970 o https://maps.app.goo.gl/…', value: valor?.lat != null ? `${valor.lat}, ${valor.lng}` : '' });
  const nombre = h('input', { id: 'res-dir', name: 'residencia.direccion', autocomplete: 'off', maxlength: 160, value: valor?.direccion ?? '', placeholder: 'Ejemplo: Calle 5, Los Jardines, Tamboril' });
  const buscar = h('button', { type: 'button', class: 'btn-sec' }, 'Buscar el lugar');
  const aqui = 'geolocation' in navigator ? h('button', { type: 'button', class: 'btn-sec btn-suave' }, 'Usar mi ubicación actual') : null;
  const res0 = h('div', { class: 'punto-resultado', 'aria-live': 'polite' });
  const mapa = (lat, lng) => h('a', { href: `https://www.google.com/maps?q=${lat},${lng}`, target: '_blank', rel: 'noopener' }, 'Ver en el mapa');
  const pintarGuardado = () => { const p = leerPunto(coords.value); if (p.lat != null) res0.replaceChildren(h('span', {}, 'Punto guardado. '), mapa(p.lat, p.lng)); };
  const esEnlace = (t) => /^\s*https?:\/\//i.test(t);
  const mostrar = (r, lat, lng, nota) => {
    if (!r.item) { res0.replaceChildren(h('span', {}, nota ?? '', r.motivo ?? 'No se encontró un nombre; escríbelo abajo.'), ' ', mapa(lat, lng)); nombre.focus(); return; }
    nombre.value = r.item.nombre;
    // Si Google reconoce la provincia y el municipio, se eligen solos (se pueden cambiar).
    if (r.item.provincia && res.sp.value !== r.item.provincia) { res.sp.value = r.item.provincia; res.sp.dispatchEvent(new Event('change', { bubbles: true })); }
    if (r.item.municipio) { res.sm.value = r.item.municipio; res.sm.dispatchEvent(new Event('change', { bubbles: true })); }
    res0.replaceChildren(h('span', {}, nota ?? '', h('strong', {}, r.item.fuente === 'cercano' ? 'Lugar conocido más cercano: ' : 'Google lo nombra así: '), r.item.nombre, '. Si no es correcto, corrige el nombre abajo. '), mapa(lat, lng));
  };
  const consultar = async () => {
    const err = coords.closest('.field').querySelector('.error');
    const marcar = (t) => { err.textContent = t ?? ''; coords.toggleAttribute('aria-invalid', !!t); };
    const texto = coords.value.trim();
    if (!texto) { marcar('Escribe las coordenadas o pega el enlace.'); return; }
    buscar.disabled = true; const t0 = buscar.textContent; buscar.textContent = 'Buscando…';
    try {
      if (esEnlace(texto)) {
        const r = await api('GET', `/api/territorio/ubicacion-enlace?url=${encodeURIComponent(texto)}`);
        coords.value = `${r.lat}, ${r.lng}`; marcar(null);
        mostrar(r, r.lat, r.lng, h('span', { class: 'punto-desde' }, `Del enlace: ${r.lat}, ${r.lng}${r.aproximado ? ' (centro del mapa; revisa en el mapa)' : ''}. `));
        return;
      }
      const p = leerPunto(texto); marcar(p.error);
      if (p.lat == null) return;
      mostrar(await api('GET', `/api/territorio/ubicacion?lat=${p.lat}&lng=${p.lng}`), p.lat, p.lng);
    } catch (e) { if (e.fields?.['residencia.coordenadas']) marcar(e.fields['residencia.coordenadas']); else res0.replaceChildren(h('span', {}, `${e.message} Escribe el nombre abajo.`)); }
    finally { buscar.disabled = false; buscar.textContent = t0; }
  };
  buscar.addEventListener('click', consultar);
  coords.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); consultar(); } });
  coords.addEventListener('paste', () => setTimeout(() => { if (esEnlace(coords.value) || leerPunto(coords.value).lat != null) consultar(); }, 0));
  aqui?.addEventListener('click', () => {
    aqui.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => { aqui.disabled = false; coords.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`; consultar(); },
      () => { aqui.disabled = false; res0.replaceChildren(h('span', {}, 'No se pudo leer tu ubicación. Permite el acceso a la ubicación o escribe las coordenadas.')); }, { enableHighAccuracy: true, timeout: 15000 });
  });
  pintarGuardado();
  const nodo = h('div', { class: 'punto-salida' },
    h('div', { class: 'field' }, h('label', { for: 'res-coord' }, 'Punto exacto desde donde sale ', h('small', {}, '(coordenadas o enlace de Google Maps; opcional)')),
      h('div', { class: 'punto-fila' }, coords, buscar, aqui), h('p', { class: 'error', dataset: { for: 'residencia.coordenadas' } }),
      h('p', { class: 'hint' }, 'Pega el enlace del lugar (en Google Maps: Compartir → Copiar enlace, o el que te enviaron por WhatsApp), o mantén presionado el punto y copia los números. Con el punto exacto, los km de cada día se calculan desde ahí.')),
    res0,
    h('div', { class: 'field' }, h('label', { for: 'res-dir' }, 'Nombre del lugar de salida ', h('small', {}, '(se puede editar; solo lo ven la gerencia y el representante)')), nombre, h('p', { class: 'error', dataset: { for: 'residencia.direccion' } })));
  return { nodo, leer: () => (esEnlace(coords.value) ? { error: 'Pulsa «Buscar el lugar» para leer el enlace.' } : leerPunto(coords.value)) };
}
/**
 * Lista con filtros y casillas: marcar uno a uno o todos los que se ven, y aplicar una acción a los marcados
 * o a todos los que se ven. `accion(ids)` recibe los ids elegidos.
 */
function listaMarcable({ clave, filas, campos, cols, verbo, accion, porPagina = 10, vacio = ['Nada con estos filtros', 'Cambia o limpia los filtros.'] }) {
  const sel = new Set(); let vistos = [];
  const todos = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los que se ven' });
  const bMarc = h('button', { class: 'btn btn-peq', type: 'button', disabled: true });
  const bTodos = h('button', { class: 'btn-sec btn-peq', type: 'button' });
  const contar = () => {
    const n = vistos.filter((x) => sel.has(x.id)).length;
    todos.checked = n > 0 && n === vistos.length; todos.indeterminate = n > 0 && n < vistos.length;
    bMarc.disabled = !sel.size; bMarc.textContent = sel.size ? `${verbo} ${fmtN.format(sel.size)} marcado(s)` : `${verbo} marcados`;
    bTodos.textContent = `${verbo} todos los que se ven (${fmtN.format(vistos.length)})`; bTodos.disabled = !vistos.length;
  };
  const caja = h('div', {});
  todos.addEventListener('change', () => { vistos.forEach((x) => (todos.checked ? sel.add(x.id) : sel.delete(x.id))); caja.querySelectorAll('input[data-marca]').forEach((c) => { c.checked = sel.has(c.dataset.marca); }); contar(); });
  bMarc.addEventListener('click', () => accion([...sel]));
  bTodos.addEventListener('click', () => accion(vistos.map((x) => x.id)));
  const colsM = [{ t: '', v: (x) => h('input', { type: 'checkbox', 'data-marca': x.id, checked: sel.has(x.id), 'aria-label': `Marcar ${x.nombre ?? ''}`, onchange: (e) => { e.target.checked ? sel.add(x.id) : sel.delete(x.id); contar(); } }) }, ...cols];
  caja.append(listaFiltrada(clave, filas, campos, (vs, activos) => {
    vistos = vs; contar();
    return h('div', {}, h('div', { class: 'lote-barra asis-lote' }, h('label', { class: 'check' }, todos, h('span', {}, 'Marcar los que se ven')), bMarc, bTodos),
      tabla(colsM, vs, activos ? vacio : ['', ''], { porPagina }));
  }));
  return caja;
}
/**
 * Cartera de médicos del visitador o PVC: qué médicos visita (por centro y especialidad), por qué centro empieza
 * y cuántos médicos (y farmacias, si es PVC) por día. La propuesta del cronograma los reparte.
 */
async function pasoMedicosRep({ rep, r, ir, ses }) {
  const nav = navPasosRep('medicos', ir, { siguiente: () => { ses.add('medicos'); } });
  let c = await api('GET', `/api/territorio/zonas/${rep}/cartera`).then((x) => x.item);
  if (!c.aplica) return [h('div', { class: 'tarjeta vacio' }, h('strong', {}, `${r?.position ?? 'Esta posición'}: sin cartera de médicos`), c.posicion === 'Vendedor' ? 'Los vendedores visitan farmacias; sus visitas por día se configuran en Cronogramas → Visitas por día.' : 'Solo los visitadores y los PVC visitan médicos en los centros.'), nav.nodo];
  const vpd = await api('GET', '/api/cronogramas/visitas-por-dia').then((x) => x.item).catch(() => null);
  const nPos = vpd?.porPosicion?.[c.posicion] ?? vpd?.predeterminado ?? 8;
  const cont = h('div', { class: 'asis-lista', 'aria-live': 'polite' }); let deshacer = null;
  const id = (x) => `${x.medicoId}|${x.establecimientoId}`;
  const guardar = async (medicos, extra = {}, hecho = null, previo = null) => {
    try { c = await api('POST', `/api/territorio/zonas/${rep}/cartera`, { medicos: medicos.map((x) => ({ medicoId: x.medicoId, establecimientoId: x.establecimientoId })), centroInicioId: extra.centroInicioId !== undefined ? extra.centroInicioId : c.centroInicioId, visitas: extra.visitas ?? c.visitas }).then((x) => x.item); }
    catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); return; }
    deshacer = hecho ? { texto: hecho, medicos: previo } : null; pintar();
  };
  const esp = (xs) => [...new Set(xs.map((x) => x.especialidad).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const uni = (xs) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'es'));
  const campos = (xs) => [
    { id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre del médico', valor: (x) => `${x.nombre} ${x.especialidad ?? ''}` },
    { id: 'esp', etiqueta: 'Especialidades', tipo: 'opciones', plural: 'especialidades', opciones: esp(xs), valor: (x) => x.especialidad ?? '' },
    { id: 'centro', etiqueta: 'Centros', tipo: 'opciones', plural: 'centros', opciones: uni(xs.map((x) => x.centro)), valor: (x) => x.centro },
    { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: uni(xs.map((x) => x.municipio)), valor: (x) => x.municipio },
  ];
  const cols = [{ t: 'Médico', v: (x) => x.nombre }, { t: 'Especialidad', v: (x) => x.especialidad ?? '' }, { t: 'Centro', v: (x) => [x.centro, h('small', { style: 'display:block;color:var(--texto-2)' }, `${x.municipio}, ${x.provincia}`)] }];
  function pintar() {
    const en = new Set(c.medicos.map(id));
    const libres = c.disponibles.filter((x) => !en.has(id(x))).map((x) => ({ ...x, id: id(x) }));
    const mios = c.medicos.map((x) => ({ ...x, id: id(x) }));
    const centrosC = [...new Map(c.medicos.map((x) => [x.establecimientoId, x])).values()];
    // Visitas por día y centro de inicio
    const fM = campo('vis-med', 'Médicos por día', { type: 'number', min: 0, max: 40, step: 1, inputmode: 'numeric', value: c.visitas.medicos ?? '', placeholder: String(c.posicion === 'PVC' ? Math.max(nPos - Math.floor(nPos / 2), 0) : nPos) });
    const fF = c.posicion === 'PVC' ? campo('vis-far', 'Farmacias por día', { type: 'number', min: 0, max: 40, step: 1, inputmode: 'numeric', value: c.visitas.farmacias ?? '', placeholder: String(Math.floor(nPos / 2)) }) : null;
    const fI = campo('centro-inicio', 'Centro de inicio', { options: centrosC.map((x) => ({ value: x.establecimientoId, label: `${x.centro} (${x.municipio})` })), value: c.centroInicioId ?? '', placeholder: 'El más cercano a su casa' });
    const bG = h('button', { class: 'btn btn-peq', type: 'button' }, 'Guardar');
    bG.addEventListener('click', () => guardar(c.medicos, { centroInicioId: fI.querySelector('select').value || null, visitas: { medicos: fM.querySelector('input').value, farmacias: fF?.querySelector('input').value ?? null } }));
    const nMed = c.visitas.medicos ?? (c.posicion === 'PVC' ? Math.max(nPos - (c.visitas.farmacias ?? Math.floor(nPos / 2)), 0) : nPos);
    const dias = nMed ? Math.ceil(c.medicos.length / nMed) : 0;
    cont.replaceChildren(...[
      deshacer ? h('div', { class: 'asis-deshacer', role: 'status' }, h('span', {}, deshacer.texto), h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => guardar(deshacer.medicos) }, 'Deshacer')) : null,
      h('div', { class: 'tarjeta' }, h('h2', {}, 'Cómo se arma su día'),
        h('p', { class: 'hint' }, c.posicion === 'PVC' ? 'El PVC hace promoción, ventas y cobros: cada día visita médicos de su cartera y también farmacias. Vacío = lo de su posición.' : 'Cada médico visitado cuenta como una visita: puede ver 10 médicos en un solo centro. Vacío = lo de su posición.'),
        h('div', { class: 'form-fila' }, fM, fF, fI), h('div', { class: 'acciones', style: 'margin-top:.25rem' }, bG),
        c.medicos.length ? h('p', { class: 'hint' }, `Con ${fmtN.format(c.medicos.length)} médico(s) a ${fmtN.format(nMed)} por día, necesita unos ${fmtN.format(dias)} día(s) para verlos a todos una vez.`) : null),
      h('div', { class: 'tarjeta' }, h('h2', {}, `Su cartera (${fmtN.format(mios.length)} médicos)`),
        mios.length ? listaMarcable({ clave: `asis-cartera-${rep}`, filas: mios, campos: campos(mios), cols, verbo: 'Quitar', accion: (ids) => { const prev = c.medicos; guardar(c.medicos.filter((x) => !ids.includes(id(x))), {}, `${fmtN.format(ids.length)} médico(s) quitado(s) de su cartera.`, prev); } })
          : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Aún no tiene médicos'), 'Agrégalos abajo. Sin cartera, la propuesta reparte centros y farmacias como antes.')),
      h('div', { class: 'tarjeta' }, h('h2', {}, `Agregar médicos (${fmtN.format(libres.length)} en los centros de su ruta)`),
        h('p', { class: 'hint' }, 'Filtra por especialidad, centro o municipio, marca los que visitará y agrégalos. Si falta un médico, regístralo en ', h('a', { href: '#catalogo?ver=medicos' }, 'Catálogo → Médicos'), ' con su centro.'),
        libres.length ? listaMarcable({ clave: `asis-libres-${rep}`, filas: libres, campos: campos(libres), cols, verbo: 'Agregar', accion: (ids) => { const prev = c.medicos; guardar([...c.medicos, ...libres.filter((x) => ids.includes(x.id))], {}, `${fmtN.format(ids.length)} médico(s) agregado(s) a su cartera.`, prev); } })
          : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay más médicos en los centros de su ruta'), 'Registra médicos en el catálogo con el centro donde trabajan.'))].filter(Boolean));
  }
  pintar();
  return [cont, nav.nodo];
}
let ultimoLoteCartera = null; let repsCartera = []; // se conservan al volver a pintar
/** Asignar médicos (de los cargados) a varios visitadores/PVC a la vez, con filtros y deshacer. */
async function carteraLote() {
  const [mds, ests, reps, zonas] = await Promise.all([api('GET', '/api/catalogo/medicos').then((x) => x.items), api('GET', '/api/territorio/establecimientos').then((x) => x.items).catch(() => []),
    api('GET', '/api/viaticos/representantes').then((x) => x.items), api('GET', '/api/territorio/zonas').then((x) => x.items).catch(() => [])]);
  const repsM = reps.filter((r) => ['Visitador', 'PVC'].includes(r.position)).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  const nombreRep = new Map(reps.map((r) => [r.id, r.fullName]));
  const asignados = new Map(); for (const z of zonas) for (const k of z.cartera ?? []) asignados.set(k, [...(asignados.get(k) ?? []), z.representanteId]);
  const porEst = new Map(ests.map((x) => [x.id, x]));
  const filas = []; let sinCentro = 0;
  for (const m of mds) {
    if (m.estado === 'inactivo') continue;
    const cs = [...new Set([m.establecimientoId, ...(m.lugares ?? []).map((l) => l.establecimientoId)].filter((id) => id && porEst.has(id)))];
    if (!cs.length) { sinCentro++; continue; }
    for (const cid of cs) { const c = porEst.get(cid); const id = `${m.id}|${cid}`; filas.push({ id, medicoId: m.id, establecimientoId: cid, nombre: m.nombre, especialidad: m.especialidad ?? 'Por confirmar', centro: c.nombre, municipio: c.municipio, provincia: c.provincia, reps: asignados.get(id) ?? [] }); }
  }
  filas.sort((a, b) => a.centro.localeCompare(b.centro, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  const msReps = multiSel({ id: 'cart-reps', etiqueta: 'Agregar a', opciones: repsM.map((r) => ({ value: r.id, label: `${r.fullName} (${r.position})` })), valores: repsCartera, todas: 'Elige visitadores o PVC', plural: 'representantes', conAplicar: false, alCambiar: (v) => { repsCartera = v; } });
  let elegidos = repsCartera;
  const salida = h('div', { 'aria-live': 'polite' });
  const uni = (xs) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, 'es'));
  const pintarResultado = (r, deshacer) => salida.replaceChildren(h('div', { class: 'tarjeta' }, h('h2', {}, deshacer ? 'Médicos agregados' : 'Se deshizo'),
    tabla([{ t: 'Representante', v: (x) => x.nombre ?? nombreRep.get(x.representanteId) ?? '' },
      { t: 'Resultado', v: (x) => x.error ?? (x.agregados ? `${fmtN.format(x.agregados.length)} agregado(s)${x.yaTenia ? `, ${fmtN.format(x.yaTenia)} ya los tenía` : ''}${x.fueraDeRuta ? `, ${fmtN.format(x.fueraDeRuta)} fuera de su ruta (no se agregan)` : ''}` : `${fmtN.format(x.quitados?.length ?? 0)} quitado(s)`) },
      { t: '', v: (x) => (x.representanteId && !x.error ? h('a', { class: 'btn-sec btn-peq', href: `#configurar?rep=${x.representanteId}&paso=medicos` }, 'Ver su cartera') : '') }], r.resultados, ['', '']),
    deshacer ? h('div', { class: 'acciones' }, h('button', { class: 'btn-sec', type: 'button', onclick: deshacer }, 'Deshacer')) : null));
  const agregar = async (ids) => {
    elegidos = repsCartera;
    if (!elegidos.length) { alert('Elige primero a qué visitadores o PVC se los agregas (arriba, en "Agregar a").'); return; }
    const medicos = filas.filter((x) => ids.includes(x.id)).map(({ medicoId, establecimientoId }) => ({ medicoId, establecimientoId }));
    try {
      const r = await api('POST', '/api/territorio/cartera/agregar', { representanteIds: elegidos, medicos });
      const n = r.resultados.reduce((t, x) => t + (x.agregados?.length ?? 0), 0);
      aviso(`${fmtN.format(n)} asignación(es) nueva(s).`, 'ok');
      // Se vuelve a pintar la sección (para ver "En la cartera de" al día) conservando el resultado y su Deshacer.
      ultimoLoteCartera = { r, deshacer: async () => {
        const res = [];
        for (const x of r.resultados.filter((y) => y.agregados?.length)) res.push(...(await api('POST', '/api/territorio/cartera/quitar', { representanteIds: [x.representanteId], medicos: x.agregados })).resultados);
        ultimoLoteCartera = { r: { resultados: res }, deshacer: null }; aviso('Se deshizo la asignación.', 'ok'); router();
      } };
      router();
    } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
  };
  if (ultimoLoteCartera) { const u = ultimoLoteCartera; ultimoLoteCartera = null; pintarResultado(u.r, u.deshacer); setTimeout(() => salida.scrollIntoView({ block: 'start' }), 0); }
  const lista = filas.length ? listaMarcable({ clave: 'cartera-lote', filas, verbo: 'Agregar', accion: agregar, porPagina: 25,
    campos: [{ id: 'q', etiqueta: 'Buscar', tipo: 'buscar', placeholder: 'Nombre del médico', valor: (x) => x.nombre },
      { id: 'prov', etiqueta: 'Provincias', tipo: 'opciones', plural: 'provincias', opciones: uni(filas.map((x) => x.provincia)), valor: (x) => x.provincia },
      { id: 'mun', etiqueta: 'Municipios', tipo: 'opciones', plural: 'municipios', opciones: uni(filas.map((x) => x.municipio)), valor: (x) => x.municipio },
      { id: 'centro', etiqueta: 'Establecimientos', tipo: 'opciones', plural: 'establecimientos', opciones: uni(filas.map((x) => x.centro)), valor: (x) => x.centro },
      { id: 'esp', etiqueta: 'Especialidades', tipo: 'opciones', plural: 'especialidades', opciones: uni(filas.map((x) => x.especialidad)), valor: (x) => x.especialidad },
      { id: 'asig', etiqueta: 'Asignación', tipo: 'opciones', opciones: [{ value: 'no', label: 'Sin visitador' }, { value: 'si', label: 'Con visitador' }], valor: (x) => (x.reps.length ? 'si' : 'no') }],
    cols: [{ t: 'Médico', v: (x) => x.nombre }, { t: 'Especialidad', v: (x) => x.especialidad }, { t: 'Establecimiento', v: (x) => [x.centro, h('small', { style: 'display:block;color:var(--texto-2)' }, `${x.municipio}, ${x.provincia}`)] },
      { t: 'En la cartera de', v: (x) => (x.reps.length ? x.reps.map((id) => nombreRep.get(id) ?? '').filter(Boolean).join(', ') : h('span', { class: 'chip pendiente' }, 'Nadie')) }] })
    : h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Aún no hay médicos con establecimiento'), 'Cárgalos en Catálogo → Médicos → Cargar documento.');
  return [
    h('div', { class: 'tarjeta' }, h('h2', {}, '1. Carga médicos y farmacias'),
      h('p', { class: 'hint' }, 'Sube la plantilla de médicos (Nombre, Especialidad, Establecimiento, Provincia, Municipio) o la de farmacias. Solo se cargan los que no están registrados; los repetidos se descartan.'),
      h('div', { class: 'acciones', style: 'margin-top:.25rem' }, h('a', { class: 'btn-sec', href: '#catalogo?ver=medicos&sec=documento' }, 'Cargar médicos'), h('a', { class: 'btn-sec', href: '#catalogo?ver=farmacias&sec=importar' }, 'Cargar farmacias'))),
    h('div', { class: 'tarjeta' }, h('h2', {}, '2. Elige a quién se los agregas'), h('div', { class: 'form-fila' }, msReps),
      h('p', { class: 'hint' }, `${fmtN.format(repsM.length)} visitador(es) y PVC. Los vendedores visitan farmacias: sus farmacias salen solas de su zona.`)),
    h('div', { class: 'tarjeta' }, h('h2', {}, `3. Busca y marca los médicos (${fmtN.format(filas.length)})`),
      sinCentro ? h('p', { class: 'hint' }, `${fmtN.format(sinCentro)} médico(s) sin establecimiento no aparecen: ponles su centro en Catálogo → Médicos.`) : null, lista),
    salida];
}
/** Visitas por día de cada posición: el número con que la propuesta automática reparte los lugares. */
async function formVisitasPorDia() {
  const { item } = await api('GET', '/api/cronogramas/visitas-por-dia');
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar visitas por día');
  const fila = (p, nota) => campo(`porPosicion.${p}`, p, { type: 'number', min: 1, max: 15, step: 1, inputmode: 'numeric', value: item.porPosicion[p] ?? '', placeholder: String(item.predeterminado) }, nota);
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Visitas por día'),
    h('p', { class: 'hint' }, `Cuántos lugares visita cada uno por día en la propuesta automática del cronograma. Vacío = ${item.predeterminado}. Al proponer el mes se puede cambiar para un representante.`),
    h('div', { class: 'form-fila' }, fila('Visitador'), fila('Vendedor'), fila('PVC'), fila('Promotora', '(opcional: solo si alguna vez necesitan cronograma)')),
    h('div', { class: 'acciones' }, b));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await enviar(f, b, () => api('POST', '/api/cronogramas/visitas-por-dia', { porPosicion: Object.fromEntries(POSICIONES.map((p) => [p, f.elements[`porPosicion.${p}`].value])) }))) aviso('Visitas por día guardadas.', 'ok');
  });
  return f;
}
/**
 * Noches fuera de los días aprobados: marcar o quitar una o varias, y elegir el hotel de cada noche
 * (vacío = el recomendado de la provincia). Los días que ya tienen jornada no se cambian aquí.
 */
async function nochesFuera(dias, recargar) {
  const puede = ['administrador', 'gerencia'].includes(yo.role);
  const provs = [...new Set(dias.map((c) => c.lugares.at(-1)?.provincia).filter(Boolean))];
  const hoteles = puede ? (await Promise.all(provs.map((p) => api('GET', `/api/hoteles?provincia=${encodeURIComponent(p)}`).then((x) => x.items).catch(() => [])))).flat().filter((x) => x.estado !== 'inactivo' && Number(x.precioNoche) > 0) : [];
  const sel = new Set();
  const editable = (c) => puede && !c.jornadaId;
  const poner = async (ids, duermeFuera, hotelId = null) => {
    try { for (const id of ids) await api('POST', `/api/cronogramas/${id}/hotel`, { duermeFuera, hotelId }); aviso(duermeFuera ? `${fmtN.format(ids.length)} noche(s) fuera marcada(s).` : `${fmtN.format(ids.length)} noche(s) fuera quitada(s).`, 'ok'); }
    catch (e) { alert(e.message); }
    recargar();
  };
  const bSi = h('button', { class: 'btn btn-peq', type: 'button', disabled: true }, 'Marcar noche fuera');
  const bNo = h('button', { class: 'btn-sec btn-peq', type: 'button', disabled: true }, 'Quitar noche fuera');
  const todos = h('input', { type: 'checkbox', 'aria-label': 'Marcar todos los días' });
  const lista = dias.filter(editable);
  const contar = () => { const n = sel.size; bSi.disabled = bNo.disabled = !n; bSi.textContent = n ? `Marcar noche fuera (${n})` : 'Marcar noche fuera'; bNo.textContent = n ? `Quitar noche fuera (${n})` : 'Quitar noche fuera'; todos.checked = n > 0 && n === lista.length; todos.indeterminate = n > 0 && n < lista.length; };
  todos.addEventListener('change', () => { lista.forEach((c) => (todos.checked ? sel.add(c.id) : sel.delete(c.id))); caja.querySelectorAll('input[data-dia]').forEach((x) => { x.checked = sel.has(x.dataset.dia); }); contar(); });
  bSi.addEventListener('click', () => poner([...sel], true)); bNo.addEventListener('click', () => poner([...sel], false));
  const selHotel = (c) => {
    const prov = c.lugares.at(-1)?.provincia; const mun = c.lugares.at(-1)?.municipio;
    const xs = hoteles.filter((x) => x.provincia === prov).sort((a, b) => (a.municipio === mun ? 0 : 1) - (b.municipio === mun ? 0 : 1) || Number(a.precioNoche) - Number(b.precioNoche));
    const s0 = h('select', { 'aria-label': `Hotel de la noche del ${fecha(c.fecha)}`, 'data-sin-buscador': '1', class: 'noche-hotel' }, h('option', { value: '' }, 'Recomendado (automático)'),
      ...xs.map((x) => h('option', { value: x.id, selected: c.hotelId === x.id }, `${x.nombre}, ${x.municipio}: ${RD(x.precioFinal ?? x.precioNoche)}${x.itbis ? ' con ITBIS' : ''}${x.desayunoIncluido ? ', con desayuno' : ''}`)));
    s0.addEventListener('change', () => poner([c.id], true, s0.value || null));
    return s0;
  };
  const cols = [
    ...(puede ? [{ t: '', v: (c) => editable(c) ? h('input', { type: 'checkbox', 'data-dia': c.id, checked: sel.has(c.id), 'aria-label': `Marcar ${fecha(c.fecha)}`, onchange: (e) => { e.target.checked ? sel.add(c.id) : sel.delete(c.id); contar(); } }) : '' }] : []),
    { t: 'Día', v: (c) => fecha(c.fecha) }, { t: 'Lugares', v: (c) => { const nm = c.lugares.reduce((x, l) => x + (l.medicos?.length ?? 0), 0); return [c.lugares.map((l) => l.lugar).join(', '), h('small', { style: 'display:block;color:var(--texto-2)' }, [...new Set(c.lugares.map((l) => l.municipio))].join(', ') + (nm ? ` · ${nm} médico(s)` : ''))]; } },
    { t: 'Noche fuera', v: (c) => !c.duermeFuera ? (editable(c) ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => poner([c.id], true) }, 'Duerme fuera') : '')
      : h('div', { class: 'noche-celda' }, h('span', { class: 'chip noche' }, 'Duerme fuera'), editable(c) ? selHotel(c) : null, editable(c) ? h('button', { class: 'btn-enlace', type: 'button', onclick: () => poner([c.id], false) }, 'Quitar') : null,
        c.jornadaId ? h('small', { class: 'hint' }, 'Ya tiene jornada: el hotel lo reporta el representante.') : null) },
  ];
  const caja = h('div', {}, puede && lista.length ? h('div', { class: 'lote-barra asis-lote' }, h('label', { class: 'check' }, todos, h('span', {}, 'Marcar todos los días')), bSi, bNo) : null,
    tabla(cols, dias, ['', ''], { porPagina: 15 }));
  return caja;
}
/**
 * Comida por día: un solo monto, o desayuno + almuerzo + cena (la suma es la comida del día). Con el desglose,
 * cuando el hotel incluye desayuno se rebaja exactamente su desayuno.
 */
function camposComida(base) {
  const d = base?.comidaDesglose ?? null;
  const modo = (v, t, det) => h('label', { class: 'opcion-tarjeta' }, h('input', { type: 'radio', name: 'comidaModo', value: v, checked: (v === 'desglose') === !!d }), h('span', {}, h('strong', {}, t), h('small', {}, det)));
  const eleccion = h('div', { class: 'opciones-tarjeta', role: 'radiogroup', 'aria-label': 'Cómo se fija la comida' },
    modo('monto', 'Un monto por día', 'Vehículo: vacío = monto de su posición. Sin vehículo: los montos de comida dentro y fuera de arriba.'),
    modo('desglose', 'Desayuno, almuerzo y cena', 'La comida del día es la suma. Si el hotel incluye desayuno, se le rebaja el desayuno.'));
  const monto = h('div', { class: 'solo-vehiculo' }, campo('tarifaAlimentacion', 'Comida por día RD$', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal', value: d ? '' : base?.tarifaAlimentacion ?? '' }, '(vacío = monto de su posición)'));
  const total = h('p', { class: 'comida-total', 'aria-live': 'polite' });
  const k3 = [['desayuno', 'Desayuno'], ['almuerzo', 'Almuerzo'], ['cena', 'Cena']];
  const filas = h('div', { class: 'form-fila comida-desglose' }, k3.map(([k, l]) => campo(`comidaDesglose.${k}`, `${l} RD$`, { type: 'number', min: 0, step: 0.01, inputmode: 'decimal', value: d?.[k] ?? '' })));
  const desglose = h('div', {}, filas, total);
  const caja = h('div', { class: 'comida-caja' }, eleccion, monto, desglose);
  const v = (k) => caja.querySelector(`[name="comidaDesglose.${k}"]`).value;
  const sumar = () => { const t = k3.reduce((x, [k]) => x + (Number(v(k)) || 0), 0); total.textContent = t ? `Comida por día: ${RD(t)}` : 'Escribe al menos un monto.'; };
  const pintar = () => { const des = caja.querySelector('[name=comidaModo]:checked').value === 'desglose'; desglose.hidden = !des; monto.classList.toggle('oculto-modo', des); if (des) sumar(); };
  caja.addEventListener('change', pintar); caja.addEventListener('input', sumar); pintar();
  return { nodo: caja, leer: () => {
    const des = caja.querySelector('[name=comidaModo]:checked').value === 'desglose';
    return des ? { comidaDesglose: Object.fromEntries(k3.map(([k]) => [k, v(k)])), tarifaAlimentacion: '' } : { comidaDesglose: null, tarifaAlimentacion: caja.querySelector('[name=tarifaAlimentacion]').value };
  } };
}
/**
 * Comprobante fiscal del hotel y si el precio incluye el ITBIS (18%, DGII). Si emite comprobante y el precio no
 * lo incluye, el precio que se usa en los viáticos es precio + 18%. `precio` es el campo de precio por noche.
 */
function camposFiscal(x, precio) {
  const cf = h('input', { type: 'checkbox', id: 'h-comprobante', checked: x.comprobanteFiscal === true });
  const op = (v, t) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'h-itbis', value: v, checked: x.comprobanteFiscal === true && String(x.precioIncluyeItbis) === v }), h('span', {}, t));
  const opciones = h('div', { class: 'desayuno-opciones', role: 'radiogroup', 'aria-label': '¿El precio incluye ITBIS?' }, op('true', 'El precio ya incluye el ITBIS'), op('false', 'El precio no incluye el ITBIS (se suma 18%)'));
  const final = h('p', { class: 'fiscal-final', 'aria-live': 'polite' });
  const caja = h('div', { class: 'desayuno-caja' }, h('label', { class: 'check desayuno-si' }, cf, h('span', {}, h('strong', {}, 'Emite comprobante fiscal'), h('small', {}, 'Factura con NCF de la DGII.'))), opciones, final);
  const pintar = () => {
    opciones.hidden = !cf.checked;
    const p = Number(precio.value.replace(/,/g, '')); const sin = cf.checked && opciones.querySelector('input:checked')?.value === 'false';
    final.textContent = p > 0 ? (sin ? `Precio final por noche: ${RD(p * 1.18)} (${RD(p)} + ITBIS ${RD(p * 0.18)})` : `Precio final por noche: ${RD(p)}`) : '';
    final.hidden = !cf.checked || !(p > 0);
  };
  caja.addEventListener('change', pintar); precio.addEventListener('input', pintar); pintar();
  return { nodo: caja, leer: () => (cf.checked ? { comprobanteFiscal: true, precioIncluyeItbis: opciones.querySelector('input:checked') ? opciones.querySelector('input:checked').value === 'true' : '' } : { comprobanteFiscal: false }) };
}
/** Desayuno incluido en el hotel y su valor (se rebaja de la comida del día de esa noche). */
function camposDesayuno(x) {
  const valor0 = Number(x.valorDesayuno) || null;
  const si = h('input', { type: 'checkbox', id: 'h-desayuno', checked: x.desayunoIncluido === true });
  const op = (v, t) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'h-desayuno-valor', value: v, checked: v === 'otro' ? valor0 != null && ![300, 500].includes(valor0) : v === 'rep' ? x.desayunoIncluido === true && valor0 == null : valor0 === Number(v) }), h('span', {}, t));
  const otro = h('input', { type: 'number', id: 'h-desayuno-otro', min: 1, step: 0.01, inputmode: 'decimal', placeholder: 'RD$', 'aria-label': 'Otro valor del desayuno en RD$', value: valor0 != null && ![300, 500].includes(valor0) ? valor0 : '' });
  const opciones = h('div', { class: 'desayuno-opciones', role: 'radiogroup', 'aria-label': 'Cuánto se rebaja' }, op('rep', 'El desayuno del representante'), op('300', 'RD$300'), op('500', 'RD$500'), h('span', { class: 'desayuno-otro' }, op('otro', 'Otro:'), otro));
  const caja = h('div', { class: 'desayuno-caja' }, h('label', { class: 'check desayuno-si' }, si, h('span', {}, h('strong', {}, 'Incluye desayuno'), h('small', {}, 'Se rebaja de la comida del día de esa noche fuera. Si el representante tiene desayuno en su comida (desayuno, almuerzo y cena), se rebaja ese; si no, el valor que elijas aquí.'))), opciones);
  const pintar = () => { opciones.hidden = !si.checked; if (si.checked && !opciones.querySelector('input:checked')) opciones.querySelector('input[value="rep"]').checked = true; };
  si.addEventListener('change', pintar); otro.addEventListener('focus', () => { opciones.querySelector('input[value="otro"]').checked = true; }); pintar();
  return { nodo: caja, leer: () => {
    if (!si.checked) return { desayunoIncluido: false };
    const v = opciones.querySelector('input:checked')?.value;
    return { desayunoIncluido: true, valorDesayuno: v === 'otro' ? otro.value : v === 'rep' ? null : v };
  } };
}
/** Editar un hotel: nombre, teléfono, dirección, precio por noche, requisitos y notas. Devuelve true si se guardó. */
async function editarHotel(x, reqs) {
  const d = $('#dialogo'); $('#dialogo-titulo').textContent = `Editar ${x.nombre}`;
  const inp = (id, label, props) => [h('label', { for: id, class: 'hint' }, label), h('input', { id, ...props })];
  const cajas = reqs.map((q) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `req-${q.value}`, checked: x.requisitos?.[q.value] === true }), h('span', {}, q.label)));
  const notas = h('textarea', { id: 'eh-notas', rows: 2 }, x.notas ?? '');
  const des = camposDesayuno(x);
  const err = h('p', { class: 'error', role: 'alert' });
  const precioI = h('input', { id: 'eh-precio', type: 'number', min: 1, step: 0.01, inputmode: 'decimal', value: x.precioNoche ?? '' });
  const fis = camposFiscal(x, precioI);
  $('#dialogo-cuerpo').replaceChildren(h('p', { class: 'hint' }, `${x.municipio}, ${x.provincia}. Marca solo lo que hayas verificado por llamada o visita.`),
    ...inp('eh-nombre', 'Nombre', { value: x.nombre, maxlength: 160 }), ...inp('eh-tel', 'Teléfono', { value: x.telefono ?? '', inputmode: 'tel' }),
    ...inp('eh-dir', 'Dirección', { value: x.direccion ?? '', maxlength: 200 }), h('label', { for: 'eh-precio', class: 'hint' }, 'Precio por noche RD$'), precioI,
    fis.nodo, des.nodo, h('div', { class: 'dialogo-checks' }, cajas), h('label', { for: 'eh-notas', class: 'hint' }, 'Notas'), notas, err);
  $('#dialogo-ok').textContent = 'Guardar'; d.showModal();
  for (;;) {
    const ok = await new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
    if (!ok) return false;
    const v = (id) => d.querySelector(`#${id}`).value;
    try {
      await api('POST', `/api/hoteles/${x.id}`, { nombre: v('eh-nombre'), telefono: v('eh-tel'), direccion: v('eh-dir'), precioNoche: v('eh-precio') || null, notas: notas.value, ...des.leer(), ...fis.leer(),
        requisitos: Object.fromEntries(reqs.map((q) => [q.value, d.querySelector(`input[name="req-${q.value}"]`).checked])) });
      aviso('Hotel actualizado.', 'ok'); return true;
    } catch (e) { err.textContent = e.fields ? Object.values(e.fields).join(' ') : e.message; d.showModal(); }
  }
}
/** Errores de un paso: cada campo marcado y un aviso general. */
function errPaso(f, fields, msg = 'Completa este paso para seguir.') {
  mostrarErrores(f, { fields });
  const st = f.querySelector(':scope > .aviso') ?? f.appendChild(h('div', { class: 'aviso', role: 'status' }));
  estado(st, 'error', msg);
}
/** Cuerpo para guardar el perfil sin cambiar nada más que lo indicado. */
function perfilBody(pf) {
  const v = pf.vehiculo ?? {};
  return { vehiculo: v, publico: pf.publico ?? null, comidaDesglose: pf.comidaDesglose ?? null, tarifaAlimentacion: pf.tarifaAlimentacion ?? '', reembolsoPorKm: pf.reembolsoPorKm ?? '', topeCombustible: pf.topeCombustible ?? '' };
}
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMesLargo = (m) => { const [y, n] = m.split('-').map(Number); return `${MESES_L[n - 1]} ${y}`; };

// ---------------------------------------------------------------- panel de inicio (tipo tablero)
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nombreMes = (m) => { const [y, n] = m.split('-').map(Number); return `${MESES[n - 1]} ${String(y).slice(2)}`; };
const pct = (n) => `${fmtN.format(Math.round(n))} %`;
const fmtC = { format: (n) => {
  const a = Math.abs(n); const f = (x) => fmtN.format(Math.round(x * 10) / 10);
  return a >= 1e6 ? `${f(n / 1e6)} M` : a >= 1e3 ? `${f(n / 1e3)} mil` : fmtN.format(Math.round(n));
} };
const RDc = (n) => `RD$ ${fmtC.format(n)}`;

/** Tarjeta de gráfico: título, nota, el gráfico y su tabla de datos (accesible). */
function tg(titulo, nota, grafico, filas, { ancho = 1, cols } = {}) {
  const tabla = filas?.length ? h('details', { class: 'tg-tabla' }, h('summary', {}, 'Ver como tabla'),
    h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, (cols ?? ['Elemento', 'Valor']).map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c) => h('td', {}, c))))))) : null;
  return h('section', { class: `tg tg-${ancho}` }, h('header', {}, h('h2', {}, titulo), nota ? h('p', {}, nota) : null), grafico, tabla);
}

/** Barras horizontales de una serie: etiqueta, barra y valor en la punta. Pasa el cursor o el foco para ver el detalle. */
function barras(items, { fmt = fmtN.format, max, enlace, detalle, vacio = 'Sin datos todavía.' } = {}) {
  if (!items.length) return h('p', { class: 'tg-vacio' }, vacio);
  const tope = max ?? Math.max(...items.map((x) => x.valor), 1);
  return h('ul', { class: 'barras' }, items.map((x) => {
    const w = Math.max(x.valor > 0 ? 1.5 : 0, (x.valor / tope) * 100);
    const contenido = [h('span', { class: 'barras-etq' }, x.nombre), h('span', { class: 'barras-pista' }, h('span', { class: 'barras-fill', style: `--w:${w}%` })), h('span', { class: 'barras-val' }, fmt(x.valor)),
      h('span', { class: 'tip', role: 'tooltip' }, detalle ? detalle(x) : `${x.nombre}: ${fmt(x.valor)}`)];
    return h('li', {}, enlace ? h('a', { href: enlace(x), class: 'barras-fila' }, contenido) : h('div', { class: 'barras-fila', tabindex: '0' }, contenido));
  }));
}

/** Barras apiladas de dos series (farmacias y centros) con leyenda y separación de 2px. */
function barrasDobles(items, series, { enlace } = {}) {
  if (!items.length) return h('p', { class: 'tg-vacio' }, 'Sin datos todavía.');
  const tope = Math.max(...items.map((x) => series.reduce((s, [k]) => s + x[k], 0)), 1);
  return h('div', {}, h('ul', { class: 'leyenda' }, series.map(([, l], i) => h('li', {}, h('span', { class: `sw s${i}` }), l))),
    h('ul', { class: 'barras' }, items.map((x) => {
      const total = series.reduce((s, [k]) => s + x[k], 0);
      const contenido = [h('span', { class: 'barras-etq' }, x.nombre),
        h('span', { class: 'barras-pista apilada' }, series.map(([k], i) => (x[k] ? h('span', { class: `barras-fill s${i}`, style: `--w:${(x[k] / tope) * 100}%` }) : null))),
        h('span', { class: 'barras-val' }, fmtN.format(total)),
        h('span', { class: 'tip', role: 'tooltip' }, `${x.nombre}: ${series.map(([k, l]) => `${fmtN.format(x[k])} ${l.toLowerCase()}`).join(', ')}`)];
      return h('li', {}, enlace ? h('a', { href: enlace(x), class: 'barras-fila' }, contenido) : h('div', { class: 'barras-fila', tabindex: '0' }, contenido));
    })));
}

/** Columnas por mes (una serie), valor en el tope de la columna. */
function columnas(items, { fmt = fmtN.format, corto = fmt } = {}) {
  const tope = Math.max(...items.map((x) => x.valor), 1);
  return h('div', { class: 'columnas', role: 'img', 'aria-label': items.map((x) => `${x.nombre}: ${fmt(x.valor)}`).join('; ') },
    items.map((x) => h('div', { class: 'col', tabindex: '0' }, h('span', { class: 'col-val' }, x.valor ? corto(x.valor) : ''), h('span', { class: 'col-pista' }, h('span', { class: 'col-fill', style: `--h:${x.valor ? Math.max(2, (x.valor / tope) * 100) : 0}%` })), h('span', { class: 'col-etq' }, x.nombre),
      h('span', { class: 'tip', role: 'tooltip' }, `${x.nombre}: ${fmt(x.valor)}`))));
}

/** Medidor: cuánto de un total (cobertura, combustible frente al tope). */
function medidor(valor, total, { etiqueta, fmt = fmtN.format, marca, marcaTexto } = {}) {
  const lim = Math.max(total, valor, marca ?? 0, 1);
  const p = Math.min(100, (valor / lim) * 100);
  return h('div', { class: 'medidor' }, etiqueta ? h('div', { class: 'medidor-cab' }, h('span', {}, etiqueta), h('strong', {}, fmt(valor))) : null,
    h('div', { class: 'medidor-pista', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(lim), 'aria-valuenow': String(valor), 'aria-label': etiqueta ?? 'Avance' },
      h('span', { class: `medidor-fill${marca != null && valor > marca ? ' excede' : ''}`, style: `--w:${p}%` }),
      marca != null ? h('span', { class: 'medidor-marca', style: `left:${Math.min(100, (marca / lim) * 100)}%` }) : null),
    marcaTexto ? h('p', { class: 'medidor-nota' }, marcaTexto) : null);
}

const kpi = (dt, dd, nota, { destacada, enlace } = {}) => {
  const cont = [h('dt', {}, dt), h('dd', {}, dd), nota ? h('p', { class: 'kpi-nota' }, nota) : null];
  return h('div', { class: `cifra kpi${destacada ? ' destacada' : ''}` }, enlace ? h('a', { href: enlace }, cont) : cont);
};
const chipsZona = (z) => z.provincias.length ? h('ul', { class: 'chips-zona' }, z.provincias.map((p) => h('li', {}, h('strong', {}, p), z.municipios?.[p]?.length ? h('span', {}, z.municipios[p].join(', ')) : h('span', {}, 'toda la provincia')))) : h('p', { class: 'kpi-nota' }, 'Sin zona asignada todavía.');

function encabezadoInicio(r, extra) {
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hour12: false }));
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  return h('div', { class: 'inicio-cabeza' }, h('div', {}, h('p', { class: 'inicio-saludo' }, `${saludo}, ${r.usuario.nombre.split(' ')[0]}`),
    h('h1', {}, 'Tu panel'), h('p', { class: 'vista-sub' }, `${ROLES[r.usuario.rol]}${r.usuario.posicion ? `, ${r.usuario.posicion}` : ''}. Todo lo que pasa en tu trabajo, en una sola vista.`)), extra);
}

async function inicioRepresentante(r) {
  const v = r.viaticos; const c = r.cronograma;
  const viat = v.detalle ? Object.entries(CAT).map(([k, l]) => ({ nombre: l, valor: v.detalle[k] ?? 0 })).filter((x) => x.valor > 0) : [];
  const prox = c.proximo;
  const tarjetas = [
    tg('Tu zona', `${fmtN.format(r.lugares.total)} lugares para visitar`, chipsZona(r.zona), null, { ancho: 1 }),
    tg('Próximo día', prox ? fecha(prox.fecha) : 'Sin días pendientes este mes', prox ? h('div', {}, h('ol', { class: 'prox-lista' }, prox.lugares.map((l) => h('li', {}, h('strong', {}, l.lugar), h('span', {}, l.municipio)))),
      h('div', { class: 'acciones' }, prox.jornadaId ? h('a', { class: 'btn-sec', href: `#jornadas?mes=${r.mes}&sec=jornadas` }, 'Ver mi jornada') : h('a', { class: 'btn', href: `#jornadas?mes=${r.mes}&cron=${prox.id}` }, 'Crear mi jornada')))
      : h('p', { class: 'tg-vacio' }, 'El administrador te avisará en la campana cuando programe tus días.'), null, { ancho: 1 }),
    tg('Cobertura del mes', `${fmtN.format(c.lugaresProgramados)} de ${fmtN.format(r.lugares.total)} lugares de tu zona tienen día`, h('div', {}, medidor(c.lugaresProgramados, r.lugares.total, { etiqueta: 'Lugares programados', fmt: (n) => `${fmtN.format(n)} (${pct(c.cobertura)})` }),
      medidor(c.conJornada, c.dias, { etiqueta: 'Días con jornada creada', fmt: (n) => `${fmtN.format(n)} de ${fmtN.format(c.dias)}` })), null, { ancho: 1 }),
    tg('Lugares por tipo', 'Farmacias y centros de salud de tu zona', barras(r.lugares.porTipo), r.lugares.porTipo.map((x) => [x.nombre, fmtN.format(x.valor)]), { ancho: 1 }),
    tg('Lugares por municipio', r.lugares.sinUbicacion ? `${fmtN.format(r.lugares.sinUbicacion)} sin ubicación en el mapa` : 'Todos con ubicación en el mapa', barras(r.lugares.porMunicipio.slice(0, 10), { detalle: (x) => `${x.nombre}, ${x.provincia}: ${fmtN.format(x.valor)} lugares` }), r.lugares.porMunicipio.map((x) => [`${x.nombre}, ${x.provincia}`, fmtN.format(x.valor)]), { ancho: 2 }),
    tg('Viáticos del mes', v.detalle ? `Estimado: ${RD(v.total)}. Estado: ${EST_P[v.estado] ?? v.estado}.` : 'Se calcula cuando tengas jornadas y perfil de viático',
      v.detalle ? h('div', {}, barras(viat, { fmt: RD }), v.tope != null ? medidor(v.combustibleCalculado, v.tope, { etiqueta: 'Combustible calculado frente al tope', fmt: RD, marca: v.tope, marcaTexto: `Tope ${v.topeFuente === 'representante' ? 'propio' : 'global'}: ${RD(v.tope)}${v.combustibleCalculado > v.tope ? '. Se presupuesta el tope.' : ''}` }) : null)
        : h('div', { class: 'tg-vacio' }, v.faltan?.length ? v.faltan.join(' ') : 'Sin datos todavía.'),
      viat.map((x) => [x.nombre, RD(x.valor)]), { ancho: 2 }),
  ];
  return [
    encabezadoInicio(r, filtroMes(r.mes, 'inicio', null, { futuro: true })),
    h('dl', { class: 'rejilla kpis' },
      kpi('Lugares en tu zona', fmtN.format(r.lugares.total), `${fmtN.format(r.zona.provincias.length)} provincia(s)`),
      kpi('Días programados', fmtN.format(c.dias), `${fmtN.format(c.conJornada)} con jornada`, { enlace: `#jornadas?mes=${r.mes}` }),
      kpi('Km del mes', fmtN.format(r.jornadas.km), r.jornadas.kmReales ? `${fmtN.format(r.jornadas.kmReales)} km reales` : `${fmtN.format(r.jornadas.total)} jornada(s)`),
      kpi('Galones', v.galones != null ? fmtN.format(v.galones) : 'Sin calcular', v.tope != null ? `Tope ${RD(v.tope)}` : null),
      r.recetas != null ? kpi('Recetas del mes', fmtN.format(r.recetas), null, { enlace: '#misRecetas' }) : null,
      kpi('Viáticos estimados', v.detalle ? RD(v.total) : 'Sin calcular', EST_P[v.estado] ?? null, { destacada: true, enlace: `#presupuesto?mes=${r.mes}` })),
    ...(v.avisos ?? []).map((a) => h('div', { class: 'aviso' }, a)),
    h('div', { class: 'tablero' }, tarjetas),
  ];
}

async function inicioDependiente(r) {
  const c = r.comision; const f = r.farmacia;
  const cuenta = await api('GET', '/api/banco/mia').then((x) => x.cuenta).catch(() => null);
  let ficha;
  if (f) {
    ficha = h('dl', { class: 'ficha' }, [['Farmacia', f.nombre], ['Provincia', f.provincia], ['Municipio', f.municipio], ['Sector o distrito municipal', f.sector ?? 'Sin registrar'], ['Dirección', f.direccion ?? 'Sin registrar'], ['Teléfono', f.telefono ?? 'Sin registrar']]
      .map(([dt, dd]) => h('div', {}, h('dt', {}, dt), h('dd', {}, dd))));
  } else {
    const sel = campo('farmaciaId', 'Elige tu farmacia', { options: r.candidatas.map((x) => ({ value: x.id, label: `${x.nombre} (${x.municipio}, ${x.provincia})` })), placeholder: r.candidatas.length ? 'Elige tu farmacia' : 'No encontramos coincidencias' });
    const b = h('button', { class: 'btn', type: 'submit', disabled: !r.candidatas.length }, 'Esta es mi farmacia');
    ficha = h('form', { novalidate: true }, h('p', { class: 'hint' }, `Escribiste "${r.farmaciaEscrita.nombre ?? ''}". Elige tu farmacia del catálogo para ubicarla por provincia, municipio y sector. Solo puedes hacerlo una vez; después lo cambia tu supervisor.`), sel, h('div', { class: 'acciones' }, b));
    ficha.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(ficha, b, () => api('POST', `/api/usuarios/${yo.id}/farmacia`, { farmaciaId: ficha.farmaciaId.value }))) router(); });
  }
  const est = r.vouchers.porEstado;
  const porEstado = [['aprobado', 'Aprobados'], ['pendiente', 'Pendientes'], ['rechazado', 'Rechazados'], ['anulado', 'Anulados']].map(([k, l]) => ({ nombre: l, valor: est[k] ?? 0 })).filter((x) => x.valor);
  const porMed = c.configurado ? Object.entries(c.porMedicamento ?? {}).map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor) : [];
  const meses = r.vouchers.ventasPorMes.map((x) => ({ nombre: nombreMes(x.nombre), valor: x.valor }));
  return [
    encabezadoInicio(r, null),
    h('dl', { class: 'rejilla kpis' },
      kpi('Ventas aprobadas', c.configurado ? RD(c.ventasAprobadas) : 'Sin configurar', c.configurado ? `${fecha(c.periodo.desde)} al ${fecha(c.periodo.hasta)}` : null),
      kpi('Comisión del período', c.configurado ? RD(c.comision) : 'Sin configurar', c.configurado ? `${fmtN.format(c.porcentaje)} % de las ventas aprobadas` : c.mensaje, { destacada: true, enlace: '#comision' }),
      kpi('Vouchers por revisar', fmtN.format(c.configurado ? c.vouchers.pendientes : est.pendiente ?? 0), null, { enlace: '#misVouchers' }),
      kpi('Vouchers aprobados', fmtN.format(c.configurado ? c.vouchers.aprobados : est.aprobado ?? 0), c.configurado && c.vouchers.rechazados ? `${fmtN.format(c.vouchers.rechazados)} rechazado(s)` : null)),
    h('div', { class: 'tablero' },
      tg('Tu farmacia', f ? 'Dónde trabajas' : 'Aún no está ligada al catálogo', ficha, null, { ancho: 2 }),
      tg('Cuenta para tu comisión', cuenta ? 'Aquí se te paga' : 'Falta registrarla', cuenta ? h('div', {}, tarjetaCuenta(cuenta), h('div', { class: 'acciones' }, h('a', { class: 'btn-sec', href: '#banco' }, 'Cambiar'))) : h('div', {}, h('p', { class: 'tg-vacio' }, 'Agrega tu cuenta de BHD, Banco Popular o Banreservas para cobrar tu comisión.'), h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#banco' }, 'Agregar cuenta'))), null, { ancho: 2 }),
      tg('Ventas aprobadas por mes', 'Últimos 6 meses, en RD$', columnas(meses, { fmt: RD, corto: (n) => fmtC.format(n) }), meses.map((x) => [x.nombre, RD(x.valor)]), { ancho: 2, cols: ['Mes', 'Ventas'] }),
      tg('Ventas por medicamento', 'Período actual', barras(porMed, { fmt: RD, vacio: c.configurado ? 'Aún no hay vouchers aprobados en este período.' : 'Se muestra cuando la gerencia configure la comisión.' }), porMed.map((x) => [x.nombre, RD(x.valor)]), { ancho: 2 }),
      tg('Tus vouchers', `${fmtN.format(r.vouchers.total)} en total`, barras(porEstado, { enlace: () => '#misVouchers', vacio: 'Aún no has cargado vouchers.' }), porEstado.map((x) => [x.nombre, fmtN.format(x.valor)]), { ancho: 1 }),
      h('section', { class: 'tg tg-1 tg-accion' }, h('h2', {}, '¿Vendiste hoy?'), h('p', {}, 'Carga la foto del voucher; la gerencia lo revisa y suma a tu comisión.'), h('a', { class: 'btn', href: '#voucher' }, 'Cargar voucher'))),
  ];
}

async function inicioGestion(r) {
  const k = r.catalogo; const e = r.equipo; const v = r.viaticos;
  const alertas = [
    e.solicitudes ? h('a', { href: '#solicitudes?sec=pendientes' }, `${fmtN.format(e.solicitudes)} solicitud(es) de cuenta por decidir`) : null,
    e.sinZona ? h('a', { href: '#representantes' }, `${fmtN.format(e.sinZona)} representante(s) sin zona asignada`) : null,
    e.dependientesSinFarmacia ? h('a', { href: '#solicitudes?sec=dependientes' }, `${fmtN.format(e.dependientesSinFarmacia)} dependiente(s) sin farmacia ligada`) : null,
    r.vouchersPendientes ? h('a', { href: '#revisar' }, `${fmtN.format(r.vouchersPendientes)} voucher(s) por revisar`) : null,
    k.sinUbicacion ? h('a', { href: '#establecimientos?sec=auto' }, `${fmtN.format(k.sinUbicacion)} lugar(es) sin ubicación en el mapa`) : null,
  ].filter(Boolean);
  const viajes = v ? v.porRepresentante.filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor) : [];
  return [
    encabezadoInicio(r, filtroMes(r.mes, 'inicio', null, { futuro: true })),
    h('dl', { class: 'rejilla kpis' },
      kpi('Equipo activo', fmtN.format(e.activos), `${fmtN.format(e.porPosicion.reduce((s, x) => s + x.valor, 0))} representantes`),
      kpi('Farmacias', fmtN.format(k.farmacias), null, { enlace: '#catalogo?ver=farmacias' }),
      kpi('Centros de salud', fmtN.format(k.centros), 'Hospitales, clínicas, UNAP y más', { enlace: '#establecimientos' }),
      kpi('Hoteles verificados', `${fmtN.format(k.hotelesVerificados)} de ${fmtN.format(k.hoteles)}`, null, { enlace: '#hoteles' }),
      kpi('Días programados', fmtN.format(r.cronogramas.dias), `${fmtN.format(r.cronogramas.representantesConDias)} representante(s)`, { enlace: '#cronogramas' }),
      v ? kpi('Viáticos solicitados', RD(v.totales.total), `${RD(v.totales.entregado)} entregados`, { destacada: true, enlace: `#viaticos?mes=${r.mes}` }) : null),
    alertas.length ? h('div', { class: 'aviso alertas-inicio' }, h('strong', {}, 'Para atender: '), h('ul', {}, alertas.map((a) => h('li', {}, a)))) : null,
    h('div', { class: 'tablero' },
      tg('Lugares por provincia', 'Toca una provincia para ver sus farmacias', barrasDobles(k.provincias.slice(0, 12), [['farmacias', 'Farmacias'], ['centros', 'Centros de salud']], { enlace: (x) => `#catalogo?ver=farmacias&provincia=${encodeURIComponent(x.nombre)}` }),
        k.provincias.map((x) => [x.nombre, fmtN.format(x.farmacias), fmtN.format(x.centros)]), { ancho: 2, cols: ['Provincia', 'Farmacias', 'Centros'] }),
      tg('Centros de salud por tipo', `${fmtN.format(k.centros)} en total`, barras(k.porTipo), k.porTipo.map((x) => [x.nombre, fmtN.format(x.valor)]), { ancho: 1 }),
      tg('Equipo por posición', 'Representantes activos', barras(e.porPosicion), e.porPosicion.map((x) => [x.nombre, fmtN.format(x.valor)]), { ancho: 1 }),
      tg('Cobertura por representante', 'Lugares de su zona con día este mes', r.cobertura.length ? h('div', { class: 'medidores' }, r.cobertura.map((x) => h('a', { href: `#cronogramas?rep=${x.id}&mes=${r.mes}`, class: 'medidor-enlace' },
        medidor(x.programados, x.lugares, { etiqueta: `${x.nombre}${x.posicion ? `, ${x.posicion}` : ''}`, fmt: () => (x.lugares ? `${fmtN.format(x.programados)} de ${fmtN.format(x.lugares)} (${pct(x.cobertura)})` : 'Sin lugares en su zona') }))))
        : h('p', { class: 'tg-vacio' }, 'Aún no hay representantes activos.'), r.cobertura.map((x) => [x.nombre, `${fmtN.format(x.programados)} de ${fmtN.format(x.lugares)}`, pct(x.cobertura)]), { ancho: 2, cols: ['Representante', 'Programados', 'Cobertura'] }),
      tg('Viáticos por representante', v ? `Presupuestos de ${nombreMes(r.mes)}` : 'Solo para gestión y finanzas', v ? barras(viajes, { fmt: RD, enlace: () => `#viaticos?mes=${r.mes}`, vacio: 'Nadie ha solicitado viáticos este mes.' }) : h('p', { class: 'tg-vacio' }, 'Sin acceso.'), viajes.map((x) => [x.nombre, RD(x.valor), EST_P[x.estado] ?? x.estado]), { ancho: 2, cols: ['Representante', 'Presupuesto', 'Estado'] }),
      tg('Equipo por rol', `${fmtN.format(e.activos)} cuentas activas`, barras(e.porRol.map((x) => ({ nombre: ROLES[x.nombre] ?? x.nombre, valor: x.valor }))), e.porRol.map((x) => [ROLES[x.nombre] ?? x.nombre, fmtN.format(x.valor)]), { ancho: 1 }),
      tg('Ubicación en el mapa', 'Lugares con coordenadas para calcular km', medidor(k.farmacias + k.centros - k.sinUbicacion, k.farmacias + k.centros, { etiqueta: 'Con ubicación', fmt: (n) => `${fmtN.format(n)} de ${fmtN.format(k.farmacias + k.centros)}` }), null, { ancho: 1 }),
      h('section', { class: 'tg tg-2 tg-accion' }, h('h2', {}, 'Accesos rápidos'), h('p', {}, 'Lo que más se usa para mover el trabajo del mes.'),
        h('div', { class: 'accesos' }, [['#cronogramas', 'Programar cronogramas'], ['#representantes', 'Zonas de representantes'], ['#establecimientos?sec=auto', 'Registrar centros de salud'], ['#hoteles', 'Verificar hoteles'], [`#viaticos?mes=${r.mes}`, 'Presupuestos de viáticos']].map(([href, t]) => h('a', { class: 'btn', href }, t))))),
  ];
}

function inicioMedico(r) {
  const n = (k) => fmtN.format(r.recetas?.[k] ?? 0);
  return vista(`Hola, ${r.usuario.nombre.split(' ')[0]}`, r.ficha ? `${r.ficha.especialidad}. Tus recetas de este mes.` : 'Tus recetas de este mes.',
    h('dl', { class: 'rejilla' }, kpi('Recetas cargadas', fmtN.format(r.total ?? 0), null, { destacada: true, enlace: '#misRecetas' }), kpi('Aprobadas', n('aprobada')), kpi('Por revisar', n('pendiente')), kpi('Rechazadas', n('rechazada'))),
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#receta' }, 'Cargar recetas'), h('a', { class: 'btn-sec', href: '#misRecetas' }, 'Ver mis recetas')));
}
V.inicio = async () => {
  const r = await api('GET', `/api/inicio?mes=${mesDe()}`);
  const partes = r.tipo === 'medico' ? inicioMedico(r) : r.tipo === 'representante' ? await inicioRepresentante(r) : r.tipo === 'dependiente' ? await inicioDependiente(r) : r.tipo === 'gestion' ? await inicioGestion(r) : vista('Tu panel', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay módulos para tu rol todavía'), 'Pide a la gerencia que revise los permisos de tu cuenta.'));
  return [h('div', { class: 'inicio' }, partes)];
};

// ---------------------------------------------------------------- menú por rol
let yo;
// Íconos de trazo simple (24×24, esquinas redondeadas), dibujados para FERSUAZ.
const ICONOS = {
  revisarRecetas: '<path d="M7 3.5h10a.5.5 0 0 1 .5.5v16a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/><path d="M9.5 8h3a2 2 0 0 1 0 4h-3V8Zm0 4v4M12 12l3 4"/>',
  miPerfilMedico: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/><path d="M12 14.5v3M10.5 16h3"/>',
  inicio: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  cronogramas: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M8.5 14h2M13.5 14h2M8.5 17h2"/>',
  viaticos: '<rect x="3.5" y="6.5" width="17" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.4"/><path d="M7 9.5v.01M17 14.5v.01"/>',
  revisar: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20Z"/><path d="M14 3.5V8h4"/><path d="m9.5 14 2 2 3.5-4"/>',
  comisiones: '<path d="M5 19 19 5"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  reportes: '<path d="M5 20V10M10 20V5M15 20v-7M20 20v-4"/>',
  misRecetas: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  alertas: '<path d="M12 4 3 19.5h18Z"/><path d="M12 10v4.5M12 17.2v.01"/>',
  perfiles: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.1 3 4.4"/>',
  precios: '<path d="M6 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14"/><path d="M4.5 20h12"/><path d="M8 8h5"/><path d="M15 10h2a1.5 1.5 0 0 1 1.5 1.5V16a1.3 1.3 0 0 0 2.6 0V9l-2.6-2.6"/>',
  representantes: '<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  establecimientos: '<path d="M5 20V8l7-4 7 4v12"/><path d="M3.5 20h17"/><path d="M12 9.5v5M9.5 12h5"/>',
  hoteles: '<path d="M3.5 18V7M3.5 14h17v4"/><path d="M20.5 14v-2.5a3 3 0 0 0-3-3H11v5.5"/><circle cx="7.3" cy="11" r="1.8"/>',
  catalogo: '<path d="m12 3.5 8 4.5-8 4.5L4 8Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16 8 4.5 8-4.5"/>',
  inventario: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  solicitudes: '<circle cx="10" cy="8.5" r="3.3"/><path d="M4 19.5c.7-3.2 3-5 6-5 1.4 0 2.6.4 3.6 1"/><path d="M18 14v6M15 17h6"/>',
  jornadas: '<circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="6.5" r="2"/><path d="M8.5 17.5H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  presupuesto: '<rect x="3.5" y="6.5" width="17" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.4"/><path d="M7 9.5v.01M17 14.5v.01"/>',
  voucher: '<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M9 6 10.5 4h3L15 6"/><circle cx="12" cy="12.5" r="3.2"/>',
  misVouchers: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4Z"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
  comision: '<path d="M5 19 19 5"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  operativo: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  receta: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M12 8.5v6M9 11.5h6"/>',
  territorio: '<path d="M9 4.5 4 6.5v13l5-2 6 2 5-2v-13l-5 2-6-2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  tareas: '<path d="M9 6.5h10M9 12h10M9 17.5h10"/><path d="m4 6.5 1.2 1.2L7.5 5.4M4 12l1.2 1.2L7.5 10.9M4 17.5l1.2 1.2 2.3-2.3"/>',
  metas: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/>',
  pedidos: '<path d="M4.5 5h2l2 10.5h9.5l2-7.5H7.4"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  tienda: '<path d="M4.5 9.5 6 4.5h12l1.5 5"/><path d="M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M5.5 12v7.5h13V12M10 19.5v-4h4v4"/>',
  banco: '<path d="M4 9.5 12 5l8 4.5"/><path d="M5 9.5h14M6.5 10v6.5M10 10v6.5M14 10v6.5M17.5 10v6.5M4.5 19.5h15"/>',
};
const icono = (id) => { const sp = h('span', { class: 'menu-icono', 'aria-hidden': 'true' }); sp.innerHTML = `<svg viewBox="0 0 24 24">${ICONOS[id] ?? ICONOS.inicio}</svg>`; return sp; };

/**
 * Menú por rol: primero accesos directos (sin título), luego hasta 3 grupos de hasta 5 ítems,
 * y utilidades en la base. Formato: [título|null, [[id, etiqueta], ...], 'pie'?]
 */
function menuPara(u) {
  const G = ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(u.role);
  if (u.role === 'medico') return [[null, [['inicio', 'Inicio'], ['receta', 'Cargar recetas'], ['misRecetas', 'Mis recetas'], ['miPerfilMedico', 'Mi perfil']]]];
  if (u.role === 'dependiente') return [[null, [['inicio', 'Inicio'], ['voucher', 'Cargar vouchers'], ['misVouchers', 'Mis vouchers'], ['comision', 'Mi comisión'], ['banco', 'Mi cuenta de banco']]], ['Tienda', [['pedidos', 'Mis pedidos']]]];
  if (u.role === 'representante') {
    const s = [];
    if (u.position === 'Promotora') {
      s.push([null, [['inicio', 'Inicio'], ['operativo', 'Operativo de hoy'], ['receta', 'Cargar recetas'], ['jornadas', 'Mis jornadas'], ['metas', 'Mis metas']]]);
      s.push(['Mi trabajo', [['misRecetas', 'Mis recetas'], ['alertas', 'Alertas'], ['presupuesto', 'Mi presupuesto'], ['establecimientos', 'Establecimientos']]]);
      s.push(['Vouchers', [['voucher', 'Cargar vouchers'], ['misVouchers', 'Vouchers cargados']]]);
    } else {
      s.push([null, [['inicio', 'Inicio'], ['jornadas', 'Mis jornadas'], ['presupuesto', 'Mi presupuesto'], ['metas', 'Mis metas']]]);
      s.push(['Mi zona', [['establecimientos', 'Establecimientos'], ...(u.position === 'Vendedor' ? [['catalogo', 'Farmacias'], ['inventario', 'Inventario']] : []), ...(['Vendedor', 'PVC'].includes(u.position) ? [['pedidos', 'Pedidos de farmacias']] : [])]]);
      if (['Vendedor', 'PVC', 'Visitador'].includes(u.position)) s.push(['Vouchers', [['voucher', 'Cargar vouchers'], ['misVouchers', 'Vouchers cargados']]]);
    }
    return s;
  }
  if (!G) return [[null, [['inicio', 'Inicio']]]];
  return [
    [null, [['inicio', 'Inicio'], ...(u.role !== 'finanzas' ? [['tareas', 'Tareas sugeridas']] : []), ['cronogramas', 'Cronogramas'], ['viaticos', 'Presupuestos'], ['revisar', 'Vouchers por revisar'], ...(u.role !== 'finanzas' ? [['revisarRecetas', 'Recetas por revisar']] : []), ['viatico', null], ['configurar', null]]],
    ['Territorio', [...(u.role !== 'finanzas' ? [['representantes', 'Representantes']] : []), ['establecimientos', 'Establecimientos'], ['hoteles', 'Hoteles'], ['catalogo', 'Catálogo'], ['metas', 'Metas']]],
    ['Ventas y recetas', [['territorio', 'Movimiento por territorio'], ['comisiones', 'Comisiones'], ['reportes', 'Reporte de recetas'], ['misRecetas', 'Recetas'], ['alertas', 'Alertas'], ['inventario', 'Inventario']]],
    ['Viáticos', [['perfiles', 'Perfiles de viático'], ['precios', 'Precios de combustible']]],
    ['Tienda', [['pedidos', 'Pedidos'], ...(['administrador', 'gerencia'].includes(u.role) ? [['tienda', 'Productos en tienda']] : [])]],
    ...(u.role !== 'finanzas' ? [['', [['solicitudes', 'Cuentas y accesos']], 'pie']] : []),
  ];
}
function pintarMenu(secciones, actual) {
  const padre = { viatico: 'viaticos', configurar: 'representantes' }[actual] ?? actual;
  const enlace = ([id, label]) => h('a', { href: `#${id}`, 'aria-current': id === padre ? 'page' : null, 'data-tip': label }, icono(id), h('span', { class: 'etq' }, label));
  const grupo = ([titulo, items]) => {
    const vis = items.filter(([, label]) => label);
    return h('div', { class: 'menu-grupo' }, titulo ? h('h3', {}, titulo) : null, titulo ? h('hr', { class: 'menu-divisor', 'aria-hidden': 'true' }) : null, vis.map(enlace));
  };
  $('#menu').replaceChildren(...secciones.filter((x) => x[2] !== 'pie').map(grupo));
  $('#menu-pie').replaceChildren(...secciones.filter((x) => x[2] === 'pie').flatMap(([, items]) => items.filter(([, l]) => l).map(enlace)));
  $('#menu-pie').hidden = !$('#menu-pie').children.length;
}

// ---------------------------------------------------------------- menú lateral: colapsar, panel deslizable y perfil
const MQ_MOVIL = matchMedia('(max-width: 767px)');
const MQ_TABLETA = matchMedia('(min-width: 768px) and (max-width: 1023px)');
const leerPref = () => { try { return localStorage.getItem('fersuaz.menu'); } catch { return null; } };
const guardarPref = (v) => { try { localStorage.setItem('fersuaz.menu', v); } catch { /* sin almacenamiento */ } };
function aplicarMenu() {
  const panel = $('#panel'); const col = $('#colapsar');
  if (MQ_MOVIL.matches) { panel.classList.remove('colapsado', 'flotante'); cerrarCajon(false); }
  else {
    const pref = leerPref();
    const colapsado = MQ_TABLETA.matches ? !panel.classList.contains('flotante') : pref === 'colapsado';
    panel.classList.toggle('colapsado', colapsado);
  }
  const expandido = !$('#panel').classList.contains('colapsado');
  col.setAttribute('aria-expanded', String(expandido));
  col.setAttribute('aria-label', expandido ? 'Colapsar menú' : 'Expandir menú');
  col.dataset.tip = expandido ? 'Colapsar menú' : 'Expandir menú';
}
function alternarColapso() {
  const panel = $('#panel');
  if (MQ_TABLETA.matches) { panel.classList.toggle('flotante'); $('#velo').hidden = !panel.classList.contains('flotante'); }
  else guardarPref(panel.classList.contains('colapsado') ? 'expandido' : 'colapsado');
  aplicarMenu();
}
function abrirCajon() {
  $('#panel').classList.add('cajon-abierto'); $('#velo').hidden = false;
  $('#abrir-menu').setAttribute('aria-expanded', 'true');
  ($('#menu a[aria-current="page"]') ?? $('#menu a'))?.focus();
}
function cerrarCajon(devolverFoco = true) {
  const panel = $('#panel'); const abierto = panel.classList.contains('cajon-abierto') || panel.classList.contains('flotante');
  panel.classList.remove('cajon-abierto');
  if (MQ_TABLETA.matches) panel.classList.remove('flotante');
  $('#velo').hidden = true;
  $('#abrir-menu').setAttribute('aria-expanded', 'false');
  if (abierto && devolverFoco && MQ_MOVIL.matches) $('#abrir-menu').focus();
}
function iniciarMenu() {
  $('#colapsar').addEventListener('click', alternarColapso);
  $('#abrir-menu').addEventListener('click', abrirCajon);
  $('#cerrar-menu').addEventListener('click', () => cerrarCajon());
  $('#velo').addEventListener('click', () => { cerrarCajon(); aplicarMenu(); });
  // Al elegir una ruta se cierra el panel deslizable o flotante.
  $('#lateral').addEventListener('click', (e) => { if (e.target.closest('#menu a, #menu-pie a')) { cerrarCajon(false); aplicarMenu(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#perfil-menu').hidden) { cerrarPerfil(); $('#perfil').focus(); return; }
    if ($('#panel').classList.contains('cajon-abierto') || $('#panel').classList.contains('flotante')) { cerrarCajon(); aplicarMenu(); }
  });
  // Perfil: menú flotante con la cuenta y Cerrar sesión
  $('#perfil').addEventListener('click', () => { const abierto = !$('#perfil-menu').hidden; abierto ? cerrarPerfil() : abrirPerfil(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.perfil')) cerrarPerfil(); });
  MQ_MOVIL.addEventListener('change', aplicarMenu); MQ_TABLETA.addEventListener('change', aplicarMenu);
  // Globo con el nombre de la sección, solo con el menú colapsado
  const tip = h('div', { id: 'tip-lateral', role: 'tooltip', hidden: true }); document.body.append(tip);
  const mostrar = (e) => {
    const el = e.target.closest?.('#lateral [data-tip]');
    if (!el || !$('#panel').classList.contains('colapsado') || MQ_MOVIL.matches) return;
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip; tip.style.left = `${r.right + 10}px`; tip.style.top = `${r.top + r.height / 2}px`; tip.hidden = false;
    el.setAttribute('aria-describedby', 'tip-lateral');
  };
  const ocultar = (e) => { tip.hidden = true; e.target.closest?.('[data-tip]')?.removeAttribute('aria-describedby'); };
  $('#lateral').addEventListener('pointerover', mostrar); $('#lateral').addEventListener('pointerout', ocultar);
  $('#lateral').addEventListener('focusin', mostrar); $('#lateral').addEventListener('focusout', ocultar);
  $('#menu').addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  aplicarMenu();
}
function abrirPerfil() { $('#perfil-menu').hidden = false; $('#perfil').setAttribute('aria-expanded', 'true'); $('#salir').focus(); }
function cerrarPerfil() { $('#perfil-menu').hidden = true; $('#perfil').setAttribute('aria-expanded', 'false'); }
let secciones;
let rutaPintada = null; let turnoRouter = 0;
/**
 * Cambia de sección sin parpadeo: deja la vista anterior en pantalla (atenuada y con una barra de carga arriba
 * si tarda más de 150 ms) y la reemplaza de una sola vez cuando la nueva está lista. Si se hace clic en otra
 * sección mientras tanto, la respuesta vieja se descarta.
 */
async function router() {
  const ruta = location.hash.slice(1).split('?')[0];
  const permitidas = [...secciones.flatMap(([, i]) => i.map(([id]) => id)), 'cuenta']; // Mi cuenta: para todos, desde el menú del perfil
  const id = permitidas.includes(ruta) ? ruta : permitidas[0];
  if (id !== ruta) { history.replaceState(null, '', `#${id}`); }
  pintarMenu(secciones, id);
  const cont = $('#vista'); const turno = ++turnoRouter;
  const vacia = !cont.querySelector('h1');
  if (vacia) cont.replaceChildren(h('p', { class: 'cargando' }, 'Cargando…'));
  const espera = setTimeout(() => { if (turno === turnoRouter) document.body.classList.add('vista-cargando'); }, 150);
  cont.setAttribute('aria-busy', 'true');
  let nodos;
  try { nodos = (await V[id]()).filter(Boolean); }
  catch (e) { nodos = [h('h1', {}, 'No pudimos cargar esta sección'), h('div', { class: 'aviso error' }, e.message), h('button', { class: 'btn-sec', onclick: router }, 'Intentar de nuevo')]; }
  if (turno !== turnoRouter) return; // ya se pidió otra sección
  clearTimeout(espera); document.body.classList.remove('vista-cargando'); cont.removeAttribute('aria-busy');
  if (!nodos.length) return; // la vista redirigió a otra dirección
  const otraSeccion = rutaPintada !== id; rutaPintada = id;
  cont.replaceChildren(...nodos);
  if (otraSeccion) { scrollTo({ top: 0 }); cont.focus({ preventScroll: true }); }
  document.title = `${cont.querySelector('h1')?.textContent ?? 'Panel'} | FERSUAZ`;
}

// ---------------------------------------------------------------- arranque
$('#salir').addEventListener('click', salir);
(async () => {
  if (!token()) { location.href = 'entrar.html'; return; }
  try { yo = (await api('GET', '/api/auth/me')).user; }
  catch (e) { $('#vista').replaceChildren(h('h1', {}, 'No pudimos abrir tu panel'), h('div', { class: 'aviso error' }, e.message)); return; }
  $('#usuario-nombre').textContent = yo.fullName;
  $('#perfil-nombre').textContent = yo.fullName;
  $('#perfil-correo').textContent = yo.email ?? '';
  $('#avatar').textContent = yo.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  $('#perfil').setAttribute('aria-label', `Tu cuenta: ${yo.fullName}`);
  iniciarMenu();
  $('#usuario-rol').textContent = `${ROLES[yo.role]}${yo.position ? `, ${yo.position}` : ''}`;
  if (yo.debeCambiarClave) { $('#menu').replaceChildren(); $('#menu-pie').hidden = true; $('#campana-caja').hidden = true; $('#vista').replaceChildren(...vistaCambioClave()); return; }
  secciones = menuPara(yo);
  addEventListener('hashchange', router);
  router();
  campana();
})();

activarDesplegables();
activarNumeros();

// Aviso de versión nueva: el panel no se recarga al cambiar de sección, así que una pestaña abierta
// antes de publicar seguiría con la versión anterior. Se compara la versión publicada y se ofrece actualizar.
(function vigilarVersion() {
  let actual = null;
  const revisar = async () => {
    try {
      const r = await fetch('version.txt', { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.text()).trim();
      if (!v) return;
      if (actual === null) { actual = v; return; }
      if (v !== actual && !document.getElementById('nueva-version')) {
        const aviso = h('div', { id: 'nueva-version', class: 'nueva-version', role: 'status' },
          h('span', {}, 'Hay una versión nueva del panel.'),
          h('button', { class: 'btn btn-peq', type: 'button', onclick: () => location.reload() }, 'Actualizar ahora'));
        document.body.append(aviso);
      }
    } catch { /* sin conexión: se revisa después */ }
  };
  revisar();
  setInterval(revisar, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
}());

// Panel de trabajo FERSUAZ. Muestra a cada rol solo lo suyo; el servidor vuelve a comprobar cada permiso.
import { apiBase } from './api.js';
import { activarDesplegables } from './desplegable.js';
import { activarNumeros } from './numeros.js';

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const fmtRD = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = new Intl.NumberFormat('es-DO');
const RD = (n) => `RD$ ${fmtRD.format(Number(n) || 0)}`;
const hoy = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const mesActual = () => hoy().slice(0, 7);
const fecha = (s) => (s ? new Date(`${String(s).slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ROLES = { administrador: 'Administrador', gerencia: 'Gerencia', supervisor: 'Supervisor', representante: 'Representante', finanzas: 'Finanzas', dependiente: 'Dependiente de farmacia' };
const ESTADOS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', anulado: 'Anulado', alerta: 'Alerta', ok: 'Cubierto', sin_inventario: 'Sin inventario', validada: 'Validada', validado: 'Validado' };

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
async function api(method, path, body) {
  if (!API) throw new ApiError(0, { error: 'El panel todavía no está conectado al servidor.' });
  let r;
  try {
    r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` }, body: body && JSON.stringify(body) });
  } catch { throw new ApiError(0, { error: 'No pudimos conectar con el servidor. Revisa tu conexión.' }); }
  if (r.status === 401) { salir(); throw new ApiError(401, { error: 'Tu sesión terminó.' }); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

// ---------------------------------------------------------------- formularios
function campo(name, label, attrs = {}, hint) {
  const id = `f-${name.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const input = attrs.options
    ? h('select', { id, name, required: attrs.required }, h('option', { value: '' }, attrs.placeholder ?? 'Elige una opción'), ...attrs.options.map((o) => h('option', { value: o.value, selected: o.value === attrs.value }, o.label)))
    : h('input', { id, name, type: 'text', ...attrs, 'aria-describedby': `${id}-e` });
  return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), input, h('p', { class: 'error', id: `${id}-e`, dataset: { for: name } }));
}
function mostrarErrores(form, err) {
  form.querySelectorAll('.error').forEach((e) => { e.textContent = ''; });
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
  const txt = boton.textContent; boton.disabled = true; boton.textContent = 'Guardando…';
  try { mostrarErrores(form); const r = await fn(); return r; }
  catch (e) { mostrarErrores(form, e); estado(st, 'error', e.message); return null; }
  finally { boton.disabled = false; boton.textContent = txt; }
}
function confirmar(titulo, cuerpo, { okTexto = 'Confirmar', pedirMotivo = false, casilla = null, campos = null } = {}) {
  const d = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  const c = $('#dialogo-cuerpo'); c.replaceChildren(h('p', {}, cuerpo));
  let motivo; let caja;
  if (pedirMotivo) { motivo = h('textarea', { id: 'motivo', rows: 3 }); c.append(h('label', { for: 'motivo', class: 'hint' }, 'Motivo'), motivo); }
  // Una casilla opcional: la respuesta es { casilla: true | false } en vez de true.
  if (casilla) { caja = h('input', { type: 'checkbox', checked: casilla.marcada !== false }); c.append(h('label', { class: 'check', style: 'margin-top:.75rem' }, caja, h('span', {}, casilla.texto))); }
  // Campos opcionales: la respuesta es { nombre: valor } con lo que se escribió.
  const entradas = (campos ?? []).map((x) => { const el = h('input', { id: `dlg-${x.name}`, name: x.name, type: x.type ?? 'text', value: x.value ?? '', autocomplete: 'off', ...(x.inputmode ? { inputmode: x.inputmode } : {}) }); c.append(h('div', { class: 'field' }, h('label', { for: `dlg-${x.name}` }, x.label), el)); return el; });
  $('#dialogo-ok').textContent = okTexto;
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue !== 'ok' ? null : motivo ? motivo.value : caja ? { casilla: caja.checked } : entradas.length ? Object.fromEntries(entradas.map((x) => [x.name, x.value])) : true), { once: true }));
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
function tabla(cols, filas, vacio, { porPagina = 25 } = {}) {
  if (!filas.length) return h('div', { class: 'tarjeta vacio' }, h('strong', {}, vacio[0]), vacio[1]);
  // Una celda solo con botones o enlaces de acción se muestra como grupo alineado y espaciado.
  const esAccion = (x) => x instanceof Element && /\b(btn|btn-sec|btn-enlace)\b/.test(x.className);
  const celda = (v) => {
    const xs = (Array.isArray(v) ? v : [v]).flat().filter((x) => x != null && x !== '' && x !== false);
    return xs.length && xs.every(esAccion) ? h('span', { class: 'celda acciones-celda' }, xs) : h('span', { class: 'celda' }, v);
  };
  const fila = (f) => h('tr', {}, cols.map((c) => { const v = c.v(f); const cel = celda(v); return h('td', { 'data-label': c.t, class: [c.num ? 'num' : null, cel.classList.contains('acciones-celda') ? 'td-acciones' : null].filter(Boolean).join(' ') || null }, cel); }));
  const cabeza = h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.t))));
  if (filas.length <= porPagina) return h('div', { class: 'tabla-envoltura' }, h('table', { class: 'tabla' }, cabeza, h('tbody', {}, filas.map(fila))));
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
    h('div', { class: 'tabla-barra' }, h('label', { for: id, class: 'sr-only' }, 'Buscar en la tabla'), buscador, estadoTxt), caja, pager);
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
V.voucher = async () => {
  const vendedor = yo.role === 'representante';
  const [meds, deps, pct] = await Promise.all([medicamentos(), vendedor ? api('GET', '/api/vouchers/dependientes').then((x) => x.items) : null, vendedor ? null : api('GET', '/api/vouchers/porcentaje').then((x) => x.item.porcentaje)]);
  if (!meds.length) return vista('Cargar voucher', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Todavía no hay medicamentos en el catálogo'), 'La gerencia debe agregarlos antes de cargar vouchers.'));
  if (vendedor && !deps.length) return vista('Cargar voucher', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay dependientes en farmacias de tu zona'), 'Aparecen aquí cuando una dependiente se registra con una farmacia de tus provincias.'));
  const ed = editorVoucher(meds, pct ?? null);
  const selDep = vendedor ? campo('dependienteId', 'Dependiente', { options: deps.map((d) => ({ value: d.id, label: `${d.nombre} (${d.farmacia}, ${d.municipio})` })), placeholder: 'Elige la dependiente' }) : null;
  selDep?.querySelector('select').addEventListener('change', async (e) => { ed.porcentaje(null); if (e.target.value) { try { ed.porcentaje((await api('GET', `/api/vouchers/porcentaje?dependienteId=${e.target.value}`)).item.porcentaje); } catch { /* sin porcentaje */ } } });
  const boton = h('button', { class: 'btn', type: 'submit' }, 'Enviar a revisión');
  const form = h('form', { class: 'tarjeta', novalidate: true },
    selDep ? h('div', { class: 'form-fila' }, selDep) : null,
    h('div', { class: 'form-fila' }, campo('referencia', 'Número de voucher', { required: true, autocomplete: 'off' }), campo('fecha', 'Fecha', { type: 'date', value: hoy(), max: hoy(), required: true })),
    h('h2', { style: 'margin-top:.5rem' }, 'Medicamentos vendidos'), h('p', { class: 'error', dataset: { for: 'items' } }), ed.el,
    h('div', { class: 'acciones' }, ed.boton), ed.resumen,
    h('p', { class: 'hint' }, 'El voucher queda en revisión hasta que la supervisión o finanzas verifiquen lo vendido. La comisión se suma cuando se aprueba.'),
    h('div', { class: 'acciones' }, boton));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, boton, () => api('POST', '/api/vouchers', { ...(selDep ? { dependienteId: form.dependienteId.value } : {}), referencia: form.referencia.value, fecha: form.fecha.value, items: ed.valores() }));
    if (r) { estado(form.querySelector('.aviso'), 'ok', `Voucher ${r.item.referencia} enviado a revisión por ${RD(r.item.total)}.`); form.referencia.value = ''; ed.reiniciar(); form.referencia.focus(); }
  });
  return vista('Cargar voucher', vendedor ? 'Carga el voucher a nombre de la dependiente de la farmacia. La comisión es de ella; queda constancia de que lo cargaste tú.' : 'Elige los medicamentos del voucher y su precio. Ves el total y tu comisión estimada mientras cargas.', form);
};
V.misVouchers = async () => {
  const { items } = await api('GET', '/api/vouchers');
  const pintar = async () => router();
  const vendedor = yo.role === 'representante';
  return vista(vendedor ? 'Vouchers cargados' : 'Mis vouchers', 'Puedes anular un voucher mientras siga pendiente de revisión.', tabla([
    { t: 'Número', v: (v) => v.referencia }, { t: 'Fecha', v: (v) => fecha(v.fecha) },
    ...(vendedor ? [{ t: 'Dependiente', v: (v) => [v.dependiente, v.farmacia ? h('small', { style: 'display:block;color:var(--texto-2)' }, v.farmacia) : null] }] : [{ t: 'Cargado por', v: (v) => v.cargadoPor ?? 'Tú' }]),
    { t: 'Medicamentos', v: (v) => v.items.map((i) => `${i.medicamento} ×${i.cantidad}`).join(', ') },
    { t: 'Total', num: true, v: (v) => RD(v.total) }, { t: 'Estado', v: (v) => [chip(v.estado), v.motivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, v.motivo) : null] },
    { t: '', v: (v) => v.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: async () => { if (await confirmar('Anular voucher', `¿Anular el voucher ${v.referencia}? No contará para tu comisión.`, { okTexto: 'Anular voucher' })) { await api('POST', `/api/vouchers/${v.id}/anular`).catch((e) => alert(e.message)); pintar(); } } }, 'Anular') : '' },
  ], items.slice().reverse(), ['Aún no has cargado vouchers', 'Cuando cargues uno, aparecerá aquí con su estado.']));
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
    if (await enviar(f, b, () => api('POST', '/api/banco/mia', { banco: f.banco.value, tipo: f.tipo.value, numero: f.numero.value, titular: f.titular.value, correo: f.correo.value }))) router();
  });
  return vista('Mi cuenta de banco', 'Aquí se te paga la comisión. Bancos disponibles: BHD, Banco Popular y Banreservas.', c ? h('div', { class: 'tarjeta' }, h('h2', {}, 'Cuenta registrada'), tarjetaCuenta(c)) : null, f);
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
V.receta = async () => {
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
  let consulta = 0;
  const reiniciarPaciente = () => { inNom.readOnly = false; inNom.value = ''; fNom.classList.remove('paciente-conocido'); pacNota.textContent = 'Escribe primero el teléfono: si el paciente ya está registrado, su nombre aparece solo.'; };
  inTel.addEventListener('input', async () => {
    const d = inTel.value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const n = ++consulta;
    if (d.length < 10) { if (inNom.readOnly) reiniciarPaciente(); return; }
    try {
      const { paciente } = await api('GET', `/api/pacientes?telefono=${d}`);
      if (n !== consulta) return;
      if (paciente) {
        inNom.value = paciente.nombre; inNom.readOnly = true; fNom.classList.add('paciente-conocido');
        pacNota.textContent = `Paciente ya registrado, con ${fmtN.format(paciente.recetas)} receta(s). Esta receta se suma a su historial; no se duplica su contacto.`;
      } else { if (inNom.readOnly) { inNom.readOnly = false; inNom.value = ''; fNom.classList.remove('paciente-conocido'); } pacNota.textContent = 'Paciente nuevo: escribe su nombre.'; }
    } catch { /* si falla la búsqueda, se puede escribir el nombre igual */ }
  });
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
      return api('POST', '/api/recetas', { operativoId: form.operativoId.value, medicoId, items: ed.valores(), adjunto, paciente: { telefono: inTel.value, nombre: inNom.value } });
    });
    if (r) {
      estado(form.querySelector('.aviso'), 'ok', r.paciente?.nuevo === false ? `Receta guardada y sumada a ${r.paciente.nombre}.` : 'Receta guardada.');
      inTel.value = ''; reiniciarPaciente();
      alertas.replaceChildren(...r.alertas.filter((a) => a.estado !== 'ok').map((a) => h('div', { class: `aviso ${a.estado === 'alerta' ? 'error' : ''}` },
        a.estado === 'alerta' ? `Alerta: en ${a.municipio} ya se recetaron ${fmtN.format(a.recetado)} unidades de ${a.medicamento} y las farmacias de la zona tienen ${fmtN.format(a.disponible)}. Coordina compra con el vendedor.` : `${a.medicamento}: ${a.mensaje}`)));
      form.adjunto.value = ''; ed.el.replaceChildren(); ed.boton.click();
      if (nuevoMed.open) { nuevoMed.open = false; const nuevo = campo('medicoId', 'Médico que prescribió', { options: opcionesMedico(), placeholder: 'Elige el médico', required: true }); selMedico.replaceWith(nuevo); selMedico = nuevo; }
    }
  });
  return vista('Cargar receta', 'Registra los medicamentos de la receta y el médico que la prescribió. La foto ayuda a validar.', alertas, form);
};
V.misRecetas = async () => {
  const mes = new URLSearchParams(location.hash.split('?')[1]).get('mes') || mesActual();
  const { items } = await api('GET', `/api/recetas?mes=${mes}`);
  return vista('Recetas', null, filtroMes(mes, 'recetas'), tabla([
    { t: 'Fecha', v: (r) => fecha(r.fecha) }, { t: 'Paciente', v: (r) => r.paciente ? [r.paciente.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, r.paciente.telefono)] : h('span', { style: 'color:var(--texto-2)' }, 'Sin registrar') },
    { t: 'Médico', v: (r) => `${r.medico}, ${r.especialidad}` }, { t: 'Zona', v: (r) => `${r.municipio}, ${r.provincia}` },
    { t: 'Medicamentos', v: (r) => r.items.map((i) => `${i.medicamento} ×${i.unidades}`).join(', ') },
    { t: 'Foto', v: (r) => r.adjunto ? h('button', { class: 'btn-sec btn-peq', onclick: () => verAdjunto(r.adjunto.clave) }, 'Ver') : 'Sin foto' },
  ], items.slice().reverse(), ['No hay recetas en este mes', 'Las recetas que registres aparecerán aquí.']));
};
async function verAdjunto(clave) {
  const r = await fetch(`${API}/api/adjuntos/${encodeURIComponent(clave)}`, { headers: { authorization: `Bearer ${token()}` } });
  if (!r.ok) return alert('No se pudo abrir la foto.');
  window.open(URL.createObjectURL(await r.blob()), '_blank', 'noopener');
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
  const { items } = await api('GET', '/api/vouchers?estado=pendiente');
  const decidir = async (v, aprobar) => {
    const r = aprobar ? await confirmar('Aprobar voucher', `Aprobar el voucher ${v.referencia} de ${v.dependiente} por ${RD(v.total)}.`, { okTexto: 'Aprobar' })
      : await confirmar('Rechazar voucher', `Rechazar el voucher ${v.referencia} de ${v.dependiente}.`, { okTexto: 'Rechazar', pedirMotivo: true });
    if (r == null) return;
    try { await api('POST', `/api/vouchers/${v.id}/${aprobar ? 'aprobar' : 'rechazar'}`, aprobar ? {} : { motivo: r }); } catch (e) { alert(e.message); }
    router();
  };
  return vista('Vouchers por revisar', 'Solo los vouchers aprobados cuentan para la comisión.', tabla([
    { t: 'Dependiente', v: (v) => [v.dependiente, h('small', { style: 'display:block;color:var(--texto-2)' }, v.farmacia ?? '')] },
    { t: 'Número', v: (v) => v.referencia }, { t: 'Fecha', v: (v) => fecha(v.fecha) },
    { t: 'Medicamentos', v: (v) => v.items.map((i) => `${i.medicamento} ×${i.cantidad}`).join(', ') }, { t: 'Total', num: true, v: (v) => RD(v.total) },
    { t: '', v: (v) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' }, h('button', { class: 'btn btn-peq', onclick: () => decidir(v, true) }, 'Aprobar'), h('button', { class: 'btn-sec btn-peq', onclick: () => decidir(v, false) }, 'Rechazar')) },
  ], items, ['No hay vouchers pendientes', 'Cuando un dependiente cargue uno, aparecerá aquí.']));
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
    bloques.push(f);
  }
  if (!cfg.global) bloques.push(h('div', { class: 'aviso' }, 'Todavía no hay porcentaje ni período configurados. Hasta entonces no se calculan comisiones.'));
  const sel = campo('dep', 'Dependiente', { options: deps.items.map((d) => ({ value: d.id, label: `${d.fullName}${d.pharmacy ? `, ${d.pharmacy}` : ''}` })), placeholder: 'Elige un dependiente' });
  const per = campo('per', 'Período', {}, '(ej. 2026-11-Q1 o 2026-11)');
  const detalle = h('div', {});
  const ver = async () => {
    const id = sel.querySelector('select').value; if (!id) return;
    const p = per.querySelector('input').value.trim();
    try {
      const r = await api('GET', `/api/comisiones/resumen?dependienteId=${id}${p ? `&periodo=${encodeURIComponent(p)}` : ''}`);
      const kids = [resumenComision(r)];
      try { const cb = await api('GET', `/api/banco/${id}`); kids.push(h('div', { class: 'tarjeta', style: 'margin-top:1rem' }, h('h2', {}, 'Cuenta para el pago'), tarjetaCuenta(cb.cuenta, deps.items.find((d) => d.id === id)?.fullName))); } catch { /* sin permiso */ }
      if (r.configurado && !r.cierre && puedeConfig) kids.push(h('div', { class: 'acciones' }, h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmar('Cerrar período', `Cerrar ${r.periodo.clave} con una comisión de ${RD(r.comision)}. Después no se pueden aprobar ni cargar vouchers de ese período.`, { okTexto: 'Cerrar período' }))) return;
        try { await api('POST', '/api/comisiones/cierres', { dependienteId: id, periodo: r.periodo.clave }); ver(); } catch (e) { alert(e.message); }
      } }, 'Cerrar período')));
      if (r.cierre) kids.push(h('div', { class: 'aviso ok' }, `Período cerrado el ${fecha(r.cierre.createdAt)}.`));
      detalle.replaceChildren(...kids);
    } catch (e) { detalle.replaceChildren(h('div', { class: 'aviso error' }, e.message)); }
  };
  sel.querySelector('select').addEventListener('change', ver);
  per.querySelector('input').addEventListener('change', ver);
  bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Comisión por dependiente'), deps.items.length ? h('div', { class: 'form-fila' }, sel, per) : h('p', { class: 'vacio' }, 'Aún no hay dependientes con cuenta activa.'), detalle));
  return vista('Comisiones', 'Configura el porcentaje, revisa lo acumulado y cierra cada período para pagarlo.', ...bloques);
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
  return vista('Inventario en farmacias', 'Las alertas de las promotoras comparan las recetas de la zona con el último conteo de cada farmacia.', f);
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
function detalleCalculo(c) {
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
    `Comida: ${s.diasAlimentacion} día(s) de trabajo × ${RD(s.tarifaAlimentacion)} por día.`,
  ];
  como.push(s.hospedajes ? `Hotel: ${s.hospedajes} noche(s) propuesta(s); solo cuentan las autorizadas por la gerencia.` : 'Hotel: no aplica este mes. Se agrega cuando una jornada necesita dormir fuera y la gerencia lo autoriza (se sugiere el hotel más económico que cumple los requisitos).');
  if (s.tope != null) como.push(`Tope mensual de ${pub ? 'transporte' : 'combustible'}: ${RD(s.tope)} (${s.topeFuente === 'representante' ? 'propio del representante' : 'global'}).${s.excedenteTope ? ` Lo calculado pasa el tope por ${RD(s.excedenteTope)}; se presupuesta el tope.` : ''}`);
  como.push(`Origen: ${s.diasCronograma ? `${s.diasCronograma} día(s) del cronograma aprobado` : ''}${s.diasCronograma && s.jornadas ? ' y ' : ''}${s.jornadas ? `${s.jornadas} jornada(s) creada(s)` : ''}. El salario no forma parte de los viáticos.`);
  return h('div', {}, h('div', { class: 'tarjeta' }, h('h2', {}, 'Por semana'), tabla(cols, filas, ['', ''])),
    h('div', { class: 'tarjeta como-se-calcula' }, h('h2', {}, 'Cómo se calcula'), h('ul', {}, como.map((x) => h('li', {}, x)))));
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
    const hosp = h('details', { class: 'tarjeta hotel-jornada', style: 'background:var(--canvas)' }, h('summary', {}, rec ? `¿Duermes fuera? Hotel aprobado: ${rec.hotel.nombre}, ${RD(rec.hotel.precioNoche)} por noche` : '¿Necesitas hotel? La gerencia debe autorizarlo'),
      tarjetaRec, modos, bloqueOtro, precioDistinto,
      h('div', { class: 'form-fila' }, campo('hospedaje.noches', 'Noches', { type: 'number', min: 1, step: 1, inputmode: 'numeric', value: 1 }), campo('hospedaje.cargos', 'Impuestos y cargos RD$', { type: 'number', min: 0, step: 0.01, value: 0 })),
      razon);
    const form = h('form', { class: 'tarjeta', novalidate: true },
      h('h2', {}, `Ruta del ${fecha(r.fecha)}`),
      h('p', { class: 'hint' }, r.optimizado ? 'Ordenada por distancia para que recorras menos y gastes menos combustible.' : r.km != null ? 'Ruta calculada por carretera.' : 'El mapa aún no está conectado: se respeta el orden del cronograma y escribes los km por carretera.'),
      h('ol', { class: 'ruta-orden' }, h('li', { class: 'casa' }, h('span', {}, 'Sales de tu residencia')), ...r.paradas.map((p) => h('li', {}, h('span', {}, h('strong', {}, p.lugar), h('small', { style: 'display:block;color:var(--texto-2)' }, `${p.municipio}, ${p.provincia}`)))), h('li', { class: 'casa' }, h('span', {}, 'Regresas a tu residencia'))),
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
      { t: 'Estado', v: (j) => chipP(j.estado) },
      { t: '', v: (j) => j.estado === 'planificada' ? h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
        j.fecha <= hoy() ? h('button', { class: 'btn btn-peq', onclick: () => accion(j, 'realizada') }, 'Realizada') : null, h('button', { class: 'btn-sec btn-peq', onclick: () => accion(j, 'cancelar') }, 'Cancelar')) : '' },
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
/** Propuesta automática del mes (solo administrador): el sistema reparte los lugares de la zona; el admin ajusta y aprueba. */
async function propuestaMes(rep, mes, div) {
  const fpd = campo('porDia', 'Lugares por día', { type: 'number', min: 1, max: 15, step: 1, value: 8, inputmode: 'numeric' });
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
    h('p', { class: 'hint' }, 'El sistema reparte las farmacias, hospitales, clínicas y UNAP de su zona que aún no tienen día este mes, en los días laborables libres. Empieza por su municipio de residencia y agrupa por cercanía para gastar menos combustible. Nada se guarda hasta que apruebes.'),
    h('div', { class: 'form-fila' }, fpd), sab, fer, h('p', { class: 'error', dataset: { for: 'dias' } }), h('div', { class: 'acciones' }, b), salida);
  const etiqueta = (l) => (l.refTipo === 'farmacia' ? 'Farmacia' : div.tipos[l.tipo] ?? 'Centro');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(f, b, () => api('POST', '/api/cronogramas/propuesta', { representanteId: rep, mes, porDia: Number(f.porDia.value), dias: [...f.querySelectorAll('[name=dia]:checked')].map((x) => Number(x.value)), feriados: [...feriados] }));
    if (!r) return;
    const p = r.item; const quitados = new Set(); const diasFuera = new Set();
    if (!p.dias.length) {
      salida.replaceChildren(h('div', { class: 'tarjeta vacio', style: 'margin-top:1rem' }, h('strong', {}, p.resumen.lugares ? 'No quedan días laborables libres este mes' : 'No hay lugares pendientes'),
        p.resumen.lugares ? 'Elige el mes siguiente o anula algún día.' : 'Todos los lugares de su zona ya tienen día este mes, o su zona no tiene lugares registrados.'));
      return;
    }
    const aprobar = h('button', { class: 'btn', type: 'button' }, `Aprobar ${p.dias.length} día(s)`);
    const contar = () => {
      const n = p.dias.filter((d) => !diasFuera.has(d.fecha) && d.lugares.some((l) => !quitados.has(`${d.fecha}|${l.refId}`))).length;
      aprobar.textContent = `Aprobar ${n} día(s)`; aprobar.disabled = !n;
    };
    const tarjetas = p.dias.map((d) => {
      const lista = h('ol', { class: 'propuesta-lugares' }, d.lugares.map((l) => {
        const k = `${d.fecha}|${l.refId}`;
        const li = h('li', {}, h('span', {}, h('strong', {}, l.lugar), h('small', {}, `${etiqueta(l)} · ${l.municipio}${l.lat == null ? ' · sin ubicación' : ''}`)),
          h('button', { class: 'btn-enlace', type: 'button', 'aria-label': `Quitar ${l.lugar}`, onclick: (ev) => {
            const fuera = !quitados.has(k); fuera ? quitados.add(k) : quitados.delete(k);
            li.classList.toggle('quitado', fuera); ev.target.textContent = fuera ? 'Volver a poner' : 'Quitar'; contar();
          } }, 'Quitar'));
        return li;
      }));
      const muns = [...new Set(d.lugares.map((l) => l.municipio))].join(', ');
      const art = h('article', { class: 'propuesta-dia' });
      const caja = h('input', { type: 'checkbox', checked: true, onchange: (ev) => { ev.target.checked ? diasFuera.delete(d.fecha) : diasFuera.add(d.fecha); art.classList.toggle('quitado', !ev.target.checked); contar(); } });
      art.append(h('label', { class: 'propuesta-cabeza' }, caja, h('span', {}, h('strong', {}, fecha(d.fecha)), h('small', {}, `${d.lugares.length} lugar(es) · ${muns}`))), lista);
      return art;
    });
    aprobar.addEventListener('click', async () => {
      const dias = p.dias.filter((d) => !diasFuera.has(d.fecha))
        .map((d) => ({ fecha: d.fecha, lugares: d.lugares.filter((l) => !quitados.has(`${d.fecha}|${l.refId}`)).map(({ refTipo, refId }) => ({ refTipo, refId })) }))
        .filter((d) => d.lugares.length);
      if (!(await confirmar('Aprobar cronograma', `Se aprobarán ${dias.length} día(s) con ${dias.reduce((n, d) => n + d.lugares.length, 0)} lugares. El representante recibirá un aviso y podrá crear sus jornadas.`, { okTexto: 'Aprobar' }))) return;
      aprobar.disabled = true; aprobar.textContent = 'Aprobando…';
      try { await api('POST', '/api/cronogramas/lote', { representanteId: rep, dias }); irA('cronogramas', { mes, rep, sec: 'dias' }); }
      catch (err) { const a = h('div', { role: 'status' }); estado(a, 'error', err.message); salida.prepend(a); contar(); }
    });
    const avisos = [];
    if (p.sinDia.length) avisos.push(`${fmtN.format(p.sinDia.length)} lugar(es) no caben en los días libres de este mes; quedarán para el próximo.`);
    if (p.resumen.sinUbicacion) avisos.push(`${fmtN.format(p.resumen.sinUbicacion)} lugar(es) no tienen ubicación y van al final de su municipio.`);
    if (p.sinResidencia) avisos.push('Este representante no tiene perfil de viático: el recorrido no empieza en su residencia.');
    salida.replaceChildren(h('p', { class: 'hint', style: 'margin-top:1rem' }, `${fmtN.format(p.resumen.lugares)} lugares pendientes en ${fmtN.format(p.resumen.diasLibres)} día(s) laborable(s) libre(s) (${nombresDias(p.resumen.diasSemana)}, desde ${fecha(p.resumen.desde > `${mes}-01` ? p.resumen.desde : `${mes}-01`)}${p.resumen.feriados?.length ? `, sin ${p.resumen.feriados.length} fecha(s) quitada(s)` : ''}). Quita lo que no quieras antes de aprobar; el orden exacto de cada día lo calcula el mapa cuando el representante crea su jornada.`),
      ...avisos.map((t) => h('div', { class: 'aviso' }, t)), h('div', { class: 'propuesta' }, tarjetas), h('div', { class: 'acciones' }, aprobar));
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
  if (!rep) return vista('Cronogramas', 'Elige un representante para ver y programar sus días.', ...bloques);
  const [{ item: zona }, { items: crons }, lz] = await Promise.all([api('GET', `/api/territorio/zonas/${rep}`), api('GET', `/api/cronogramas?representanteId=${rep}&mes=${mes}`), api('GET', `/api/territorio/zonas/${rep}/lugares`)]);
  if (esAdmin) {
    if (!zona.provincias.length) bloques.push(h('div', { class: 'aviso error' }, 'Este representante no tiene provincias asignadas. ', h('a', { href: `#representantes?rep=${rep}` }, 'Asignar provincias')));
    else {
      bloques.push(S('propuesta', 'Propuesta automática', await propuestaMes(rep, mes, div)));
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
        campo('nota', 'Nota para el representante', {}, '(opcional)'), h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sel = [...f.querySelectorAll('[name=lugar]:checked')].map((x) => { const [refTipo, refId] = x.value.split(':'); return { refTipo, refId }; });
        if (await enviar(f, b, () => api('POST', '/api/cronogramas', { representanteId: rep, fechas: [...elegidos].sort(), lugares: sel, nota: f.nota.value }))) irA('cronogramas', { mes, rep, sec: 'dias' });
      });
      bloques.push(S('mano', 'Programar a mano', f));
    }
  }
  const anular = async (c) => { const m = await confirmar('Anular cronograma', `El representante dejará de ver el día ${fecha(c.fecha)}. Escribe el motivo.`, { okTexto: 'Anular', pedirMotivo: true }); if (m == null) return; try { await api('POST', `/api/cronogramas/${c.id}/anular`, { motivo: m }); } catch (e) { alert(e.message); } router(); };
  bloques.push(S('dias', `Días programados (${fmtN.format(crons.filter((c) => c.estado === 'aprobado').length)})`,
    tabla([{ t: 'Día', v: (c) => fecha(c.fecha) }, { t: 'Lugares', v: (c) => c.lugares.map((l) => l.lugar).join(', ') },
      { t: 'Estado', v: (c) => c.estado === 'anulado' ? [h('span', { class: 'chip anulado' }, 'Anulado'), c.motivo ? h('small', { style: 'display:block;color:var(--texto-2)' }, c.motivo) : null] : c.jornadaId ? h('span', { class: 'chip aprobado' }, 'Jornada creada') : h('span', { class: 'chip pendiente' }, 'Aprobado') },
      { t: '', v: (c) => esAdmin && c.estado === 'aprobado' && !c.jornadaId ? h('button', { class: 'btn-sec btn-peq', onclick: () => anular(c) }, 'Anular') : '' }],
    crons, ['Sin días programados en este mes', esAdmin ? 'Usa la propuesta automática o programa a mano.' : 'El administrador aún no programa este mes.'])));
  return vistaS('cronogramas', ['propuesta', 'mano', 'dias'], 'Cronogramas', 'El administrador programa y aprueba los días y lugares de cada representante.', ...bloques);
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
    { t: '', v: (r) => puede ? h('a', { class: 'btn-sec btn-peq', href: `#perfiles?rep=${r.id}` }, r.perfil ? 'Editar' : 'Configurar') : '' },
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
      const tablaPos = h('div', { class: 'tabla-montos' }, h('table', {}, h('thead', {}, cab),
        h('tbody', {}, ...POSICIONES.map((pos) => h('tr', {}, h('th', { scope: 'row' }, pos), ...TARIFAS_PUB.map(([k]) => h('td', {}, inp(pos, k, tp.porPosicion?.[pos]?.[k]))))))));
      const filaGlobal = h('div', { class: 'tabla-montos' }, h('table', {}, h('thead', {}, cab.cloneNode(true)),
        h('tbody', {}, h('tr', {}, h('th', { scope: 'row' }, 'Todas las posiciones'), ...TARIFAS_PUB.map(([k]) => h('td', {}, inp('global', k, tp.global?.[k])))))));
      const modo = h('fieldset', { class: 'modo-montos' }, h('legend', {}, '¿Cómo se fijan los montos?'),
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'posicion', checked: tp.modo !== 'global' }), h('span', {}, h('strong', {}, 'Por posición'), h('small', {}, 'Un monto para Visitador, otro para Promotora, etc.'))),
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'global', checked: tp.modo === 'global' }), h('span', {}, h('strong', {}, 'Un monto para todos'), h('small', {}, 'El mismo monto sin importar la posición.'))));
      const pintarModo = () => { const g = modo.querySelector('input:checked').value === 'global'; tablaPos.hidden = g; filaGlobal.hidden = !g; };
      modo.addEventListener('change', pintarModo); pintarModo();
      const fp = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Transporte público: montos por día'),
        h('p', { class: 'hint' }, 'Para quienes no tienen vehículo. Un día del cronograma cuenta como "dentro" si todas sus paradas están en su zona de trabajo (las provincias y municipios que le asignaste), aunque no viva allí; si va a un lugar fuera de su zona, cuenta como "fuera". Un representante puede tener montos propios en su perfil.'),
        modo, tablaPos, filaGlobal, h('div', { class: 'acciones' }, bp));
      const leer = (pre) => Object.fromEntries(TARIFAS_PUB.map(([k]) => [k, fp.elements[`${pre}.${k}`].value || null]));
      fp.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(fp, bp, () => api('POST', '/api/viaticos/tarifas-publico', { modo: fp.elements.modo.value, global: leer('global'), porPosicion: Object.fromEntries(POSICIONES.map((p) => [p, leer(p)])) }))) router(); });
      bloques.push(S('tope', 'Montos globales', fp, ft));
    }
    return vistaS('perfiles', ['lista', 'tope'], 'Perfiles de viático', 'Vehículo, residencia, tarifa y tope de cada representante. La dirección exacta solo la ven la gerencia y el propio representante.', S('lista', 'Representantes', lista), ...bloques);
  }
  const r = reps.find((x) => x.id === id);
  const [pf, div, { item: globales }] = await Promise.all([api('GET', `/api/viaticos/perfiles/${id}`).then((x) => x.item), division(), api('GET', '/api/viaticos/tarifas-publico')]);
  const veh = formularioVehiculo(pf, combs, globales, r?.position);
  const res = residenciaCampos(div, pf?.residencia);
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar perfil');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, r?.fullName ?? 'Representante'),
    h('div', { class: 'form-fila' }, res.fp, res.fm, campo('residencia.direccion', 'Dirección desde donde sale', { value: pf?.residencia?.direccion ?? '' }, '(restringida)')),
    h('h3', { class: 'subtitulo-form' }, 'Vehículo'), veh.el,
    h('h3', { class: 'subtitulo-form' }, 'Viáticos'),
    h('div', { class: 'form-fila' }, h('div', { class: 'solo-vehiculo' }, campo('tarifaAlimentacion', 'Comida por día RD$', { type: 'number', min: 0, step: 0.01, value: pf?.tarifaAlimentacion ?? '' })),
      h('div', { class: 'solo-vehiculo' }, campo('reembolsoPorKm', 'Reembolso por km RD$', { type: 'number', min: 0, step: 0.01, value: pf?.reembolsoPorKm ?? '' }, '(solo vehículo propio; reemplaza al combustible)')),
      campo('topeCombustible', 'Tope mensual de combustible o transporte RD$', { type: 'number', min: 0, step: 0.01, value: pf?.topeCombustible ?? '' }, '(vacío = usa el tope global)')),
    h('div', { class: 'acciones' }, b, h('a', { class: 'btn-sec', href: '#perfiles' }, 'Volver')));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const g = (k) => f.elements[k].value;
    const body = { residencia: { provincia: res.sp.value, municipio: res.sm.value, direccion: g('residencia.direccion') }, ...veh.valores(f),
      tarifaAlimentacion: veh.tiene() ? g('tarifaAlimentacion') : '', reembolsoPorKm: veh.tiene() ? g('reembolsoPorKm') : '', topeCombustible: g('topeCombustible') };
    if (await enviar(f, b, () => api('POST', `/api/viaticos/perfiles/${id}`, body))) location.hash = '#perfiles';
  });
  const sincronizar = () => f.querySelectorAll('.solo-vehiculo').forEach((x) => { x.hidden = !veh.tiene(); });
  veh.el.addEventListener('change', sincronizar); sincronizar();
  return vista('Perfil de viático', null, f);
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
  if (hoteles.length) bloques.push(h('h2', { style: 'margin:1rem 0 .75rem;font-size:1.2rem' }, 'Hospedajes'), tabla([
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
  ], hoteles, ['', '']));
  if (!p || ['borrador', 'rechazado'].includes(p.estado)) {
    bloques.push(h('div', { class: 'aviso' }, p?.estado === 'rechazado' ? `Rechazado: ${p.motivo}. Puedes asignarlo de nuevo cuando esté listo.` : 'Aún no tiene viáticos asignados este mes. Asígnalos desde su cronograma aprobado: el representante verá su balance y registrará sus gastos.'));
    if (ger && c.detalle) bloques.push(h('div', { class: 'acciones' }, h('button', { class: 'btn', disabled: c.faltan?.length > 0, title: c.faltan?.length ? c.faltan.join(' ') : null, onclick: async () => {
      if (!(await confirmar('Asignar viáticos del mes', `${nombre} tendrá ${RD(c.total)} de viáticos en ${mes}. Cada gasto que registre rebaja su balance. Los cambios después se hacen con ajustes.`, { okTexto: 'Asignar' }))) return;
      accion(() => api('POST', '/api/viaticos/presupuestos/asignar', { representanteId: rep, mes }));
    } }, `Asignar ${RD(c.total)}`)));
    if (c.faltan?.length) bloques.push(h('div', { class: 'aviso' }, c.faltan.join(' ')));
    for (const a of c.avisos ?? []) bloques.push(h('div', { class: 'aviso' }, a));
    if (c.detalle) bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Cálculo del mes'), desglose(c.detalle, c.total)), detalleCalculo(c));
  } else {
    bloques.push(balanceViaticos(p), h('div', { class: 'tarjeta' }, h('h2', {}, `Presupuesto ${EST_P[p.estado].toLowerCase()}${p.origen === 'asignado' ? ' (asignado por la gerencia)' : ''}`), desglose(p.detalle, p.total),
      h('p', { class: 'hint', style: 'margin-top:1rem' }, `${p.supuestos.jornadas} jornadas, ${fmtN.format(p.supuestos.km)} km (${p.supuestos.kmTipo}).`)), bloqueResumen(p));
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
      bloques.push(f);
    }
    if (fin && p.estado === 'desembolsado') acc.append(h('button', { class: 'btn', onclick: async () => { if (await confirmar('Liquidar viáticos', `Cerrar ${mes} de ${nombre}. Entregado ${RD(p.resumen.entregado)}, justificado ${RD(p.resumen.justificado)}.`, { okTexto: 'Liquidar' })) accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/liquidar`)); } }, 'Liquidar'));
    bloques.push(acc, h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Gastos y comprobantes'),
      tablaGastos(p, fin && p.estado !== 'liquidado' ? (g) => g.estado === 'reportado' ? h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
        h('button', { class: 'btn btn-peq', onclick: () => accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/gastos/${g.id}/aceptar`)) }, 'Aceptar'),
        h('button', { class: 'btn-sec btn-peq', onclick: async () => { const m = await confirmar('No aceptar gasto', 'Explica el motivo.', { okTexto: 'No aceptar', pedirMotivo: true }); if (m != null) accion(() => api('POST', `/api/viaticos/presupuestos/${p.id}/gastos/${g.id}/rechazar`, { motivo: m })); } }, 'No aceptar')) : '' : null));
  }
  bloques.push(h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Jornadas'),
    tabla([{ t: 'Fecha', v: (j) => fecha(j.fecha) }, { t: 'Paradas', v: (j) => j.paradas.map((x) => x.lugar).join(' → ') }, { t: 'Km', num: true, v: (j) => `${fmtN.format(j.kmEstimados)}${j.kmReales != null ? ` / ${fmtN.format(j.kmReales)} real` : ''}` }, { t: 'Estado', v: (j) => chipP(j.estado) }],
      js, ['Sin jornadas en el mes', '']));
  return vista(`${nombre}: viáticos de ${mes}`, null, ...bloques);
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
async function buscadorGoogle(tipos, alAgregar) {
  const [{ activo }, div] = await Promise.all([api('GET', '/api/territorio/google/estado'), division()]);
  if (!activo) return h('div', { class: 'tarjeta' }, h('h2', {}, 'Buscar en Google Maps'), h('p', { class: 'hint' }, 'La búsqueda en Google Maps se activa cuando se configure la clave del mapa (MAPS_API_KEY) en el servidor. Mientras tanto, registra a mano o importa un Excel.'));
  const z = selectorZona(div.provincias, div.municipios);
  const ft = campo('tipo', 'Tipo', { options: tipos.map(([value, label]) => ({ value, label })), value: tipos[0][0] });
  const ftx = campo('texto', 'Nombre o palabra', {}, '(opcional)');
  const b = h('button', { class: 'btn-sec', type: 'submit' }, 'Buscar en Google Maps');
  const res = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Buscar en Google Maps'), h('p', { class: 'hint' }, 'Busca por municipio y agrega con un clic. Cada búsqueda consume cuota de Google.'),
    h('div', { class: 'form-fila' }, z.fp, z.fm, ft, ftx), h('div', { class: 'acciones' }, b), res);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = { tipo: f.tipo.value, provincia: z.sp.value, municipio: z.sm.value, texto: f.texto.value };
    const r = await enviar(f, b, () => api('GET', `/api/territorio/google/buscar?${new URLSearchParams(q)}`));
    if (!r) return;
    res.replaceChildren(tabla([
      { t: 'Nombre', v: (x) => [x.nombre, h('small', { style: 'display:block;color:var(--texto-2)' }, x.direccion)] },
      { t: 'Teléfono', v: (x) => x.telefono ?? '' },
      { t: '', v: (x) => x.registrado ? h('span', { class: 'chip validado' }, 'Ya registrado') : h('button', { class: 'btn btn-peq', type: 'button', onclick: async (ev) => {
        ev.target.disabled = true;
        try { await api('POST', '/api/territorio/google/agregar', { ...q, placeId: x.placeId }); ev.target.replaceWith(h('span', { class: 'chip validado' }, 'Agregado')); alAgregar?.(); }
        catch (err) { ev.target.disabled = false; alert(err.message); }
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
        h('div', { class: 'form-fila' }, campo('nombre', 'Nombre'), campo('linea', 'Línea', {}, '(opcional)'), campo('presentacion', 'Presentación', {}, '(opcional)'), campo('precio', 'Precio RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' }, '(opcional)')),
        h('div', { class: 'acciones' }, b));
      f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/catalogo/medicamentos', { nombre: f.nombre.value, linea: f.linea.value, presentacion: f.presentacion.value, precio: f.precio.value || undefined }))) { cache = {}; irA('catalogo', { ver: 'medicamentos' }); } });
      bloques.push(S('nuevo', 'Nuevo medicamento', f));
    }
    const historial = async (m) => {
      const { items } = await api('GET', `/api/catalogo/medicamentos/${m.id}/precios`);
      await confirmar(`Precios de ${m.nombre}`, items.length ? items.map((p) => `${fecha(p.vigenteDesde)}: ${RD(p.precio)} (${p.fuente})`).join('  ·  ') : 'Sin historial de precios.', { okTexto: 'Cerrar' });
    };
    bloques.push(S('lista', `Medicamentos (${fmtN.format(ms.length)})`, tabla([{ t: 'Nombre', v: (m) => m.nombre }, { t: 'Línea', v: (m) => m.linea ?? '' }, { t: 'Presentación', v: (m) => m.presentacion ?? '' },
        { t: 'Precio', num: true, v: (m) => m.precio != null ? RD(m.precio) : 'Sin precio' },
        { t: '', v: (m) => h('button', { class: 'btn-enlace', type: 'button', onclick: () => historial(m) }, 'Historial') }], ms, ['Catálogo vacío', 'Agrega los medicamentos de FERSUAZ o impórtalos desde Excel.'])));
    if (ES_GER()) bloques.push(S('importar', 'Importar Excel', importador('medicamentos', 'Importar medicamentos y precios', 'Si el medicamento ya existe con esa presentación, se actualiza el precio y el anterior queda en el historial.', router)));
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
        { t: '', v: (x) => ES_GER() && x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar('farmacias', x.id) }, 'Validar') : '' }], lista, ['Aún no hay farmacias', 'Agrégalas a mano, impórtalas desde Excel o búscalas en Google Maps.'])));
    if (GESTION_T()) bloques.push(S('importar', 'Importar Excel', importador('farmacias', 'Importar farmacias', 'Provincia y municipio deben ser oficiales. Las que ya existen en el mismo municipio no se duplican.', router)),
      S('google', 'Buscar en Google', await buscadorGoogle([['farmacia', 'Farmacias']], null)), ES_GER() ? S('auto', 'Registro automático', await registroAutomatico([['farmacia', 'Farmacias']])) : null);
  } else {
    const mds = await api('GET', '/api/catalogo/medicos');
    bloques.push(tabla([{ t: 'Nombre', v: (x) => x.nombre }, { t: 'Especialidad', v: (x) => x.especialidad }, { t: 'Zona', v: (x) => `${x.municipio}, ${x.provincia}` }, { t: 'Estado', v: (x) => chip(x.estado) },
      { t: '', v: (x) => ES_GER() && x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar('medicos', x.id) }, 'Validar') : '' }], mds.items, ['Aún no hay médicos', 'Las promotoras los agregan al cargar recetas.']));
  }
  return vistaS('catalogo', ['lista', 'nuevo', 'nueva', 'importar', 'google', 'auto'], 'Catálogo', 'Lo que agregan las promotoras y los vendedores queda pendiente hasta que la gerencia lo valida.', ...bloques);
};

V.establecimientos = async () => {
  const [div, mias] = await Promise.all([division(), api('GET', '/api/territorio/mis-provincias')]);
  const provincias = mias.items;
  if (!provincias.length) return vista('Establecimientos', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Aún no tienes provincias asignadas'), 'Pide a tu supervisor que te asigne las provincias que visitas.'));
  const fprov = param('provincia') || (provincias.length === 1 ? provincias[0] : '');
  const fmun = param('municipio') || ''; const ftipo = param('tipo') || '';
  const fver = GESTION_T() && ['revisar', 'descartados'].includes(param('ver')) ? param('ver') : '';
  const qs = new URLSearchParams(Object.entries({ provincia: fprov, municipio: fmun, tipo: ftipo, ver: fver }).filter(([, v]) => v));
  const { items } = await api('GET', `/api/territorio/establecimientos?${qs}`);
  const tipos = Object.entries(div.tipos);
  const fz = selectorZona(provincias, div.municipios, { provincia: fprov, municipio: fmun, prefijo: 'f' });
  const ft = campo('ftipo', 'Tipo', { options: tipos.map(([value, label]) => ({ value, label })), value: ftipo, placeholder: 'Todos los tipos' });
  const fv = GESTION_T() ? campo('fver', 'Mostrar', { options: [{ value: '', label: 'Todos los activos' }, { value: 'revisar', label: 'Posibles errores de Google' }, { value: 'descartados', label: 'No son centros de salud' }], value: fver }) : null;
  const aplicar = () => irA('establecimientos', Object.fromEntries(Object.entries({ sec: 'lista', provincia: fz.sp.value, municipio: fz.sm.value, tipo: ft.querySelector('select').value, ver: fv?.querySelector('select').value }).filter(([, v]) => v)));
  fz.sm.addEventListener('change', aplicar); ft.querySelector('select').addEventListener('change', aplicar); fv?.querySelector('select').addEventListener('change', aplicar);
  fz.sp.addEventListener('change', () => { if (!fz.sp.value) aplicar(); });
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
  const contar = () => { bDesc.disabled = !marcados.size; bDesc.textContent = marcados.size ? `Marcar ${fmtN.format(marcados.size)} como no es centro de salud` : 'Marcar como no es centro de salud'; };
  const descartar = async (ids) => {
    if (!(await confirmar('No es un centro de salud', `${fmtN.format(ids.length)} registro(s) saldrán de las zonas, los cronogramas y las propuestas. El registro automático no los volverá a traer. Puedes restaurarlos en "No son centros de salud".`, { okTexto: 'Marcar' }))) return;
    try { await api('POST', '/api/territorio/establecimientos/descartar', { ids }); router(); } catch (e) { alert(e.message); }
  };
  bDesc.addEventListener('click', () => descartar([...marcados]));
  const restaurar = async (x) => { try { await api('POST', `/api/territorio/establecimientos/${x.id}/restaurar`); router(); } catch (e) { alert(e.message); } };
  const columnas = [
    ...(GESTION_T() && fver !== 'descartados' ? [{ t: '', v: (x) => h('input', { type: 'checkbox', class: 'marca', 'aria-label': `Marcar ${x.nombre}`, checked: marcados.has(x.id), onchange: (e) => { e.target.checked ? marcados.add(x.id) : marcados.delete(x.id); contar(); } }) }] : []),
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
    tabla(columnas, items, vacioTxt))];
  if (GESTION_T()) bloques.push(S('importar', 'Importar Excel', importador('establecimientos', 'Importar clínicas, hospitales, UNAP y centros', 'Tipo, nombre, provincia y municipio son obligatorios. Los que ya existen en el mismo municipio no se duplican.', router)),
    S('google', 'Buscar en Google', await buscadorGoogle(tipos, null)), ES_GER() ? S('auto', 'Registro automático', await registroAutomatico([['salud', 'Hospitales, clínicas, UNAP y centros de primer nivel (todo junto)'], ...tipos])) : null);
  return vistaS('establecimientos', ['lista', 'nuevo', 'importar', 'google', 'auto'], 'Establecimientos', 'Clínicas, hospitales, UNAP y centros de primer nivel por municipio. Se usan como paradas exactas de las jornadas.', ...bloques);
};

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
    $('#dialogo-cuerpo').replaceChildren(h('p', { class: 'hint' }, `${x.municipio}, ${x.provincia}${x.telefono ? `. Teléfono ${x.telefono}` : ''}. Confirma el precio y marca solo lo que hayas verificado por llamada o visita.`),
      h('label', { for: 'h-precio', class: 'hint' }, 'Precio por noche RD$'), precio, h('div', { class: 'dialogo-checks' }, cajas), h('label', { for: 'h-notas', class: 'hint' }, 'Notas'), notas, inactivo);
    $('#dialogo-ok').textContent = 'Guardar'; d.showModal();
    const ok = await new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
    if (!ok) return;
    const requisitos = Object.fromEntries(reqs.map((r) => [r.value, d.querySelector(`input[name="req-${r.value}"]`).checked]));
    try { await api('POST', `/api/hoteles/${x.id}`, { precioNoche: precio.value || null, requisitos, notas: notas.value, estado: d.querySelector('input[name=h-inactivo]').checked ? 'inactivo' : 'activo' }); } catch (e) { alert(e.message); }
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
      { t: 'Por noche', num: true, v: (x) => x.precioNoche ? RD(x.precioNoche) : 'Sin confirmar' },
      { t: 'Requisitos', v: (x) => x.estado === 'inactivo' ? h('span', { class: 'chip anulado' }, 'No usar') : x.cumple ? h('span', { class: 'chip validado' }, 'Cumple todo') : h('span', { class: 'chip pendiente', title: x.faltan.map((k) => reqs.find((r) => r.value === k)?.label).join(', ') }, `Faltan ${x.faltan.length}`) },
      { t: '', v: (x) => ES_GER() ? h('button', { class: 'btn-sec btn-peq', onclick: () => editar(x) }, x.precioNoche ? 'Editar' : 'Confirmar') : '' },
    ], items, ['No hay hoteles con estos filtros', ES_GER() ? 'Tráelos de Google Maps en "Registro automático".' : 'La administración los registra y verifica.'])));
  if (ES_GER()) bloques.push(S('google', 'Buscar en Google', await buscadorGoogle([['hotel', 'Hoteles']], null)), S('auto', 'Registro automático', await registroAutomatico([['hotel', 'Hoteles']])));
  return vistaS('hoteles', ['lista', 'google', 'auto'], 'Hoteles', 'Para el hospedaje de los representantes. Google Maps trae los hoteles; la administración confirma precio y requisitos: servicios básicos, aire, agua, cama cómoda, higiene, parqueo y seguridad. Se recomienda el más económico que cumple todo.', ...bloques);
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

/** Alta de representante por la administración: crea usuario y clave temporal, zona, residencia y vehículo. */
async function altaRepresentante(div) {
  const [{ items: combs }, { item: globales }] = await Promise.all([api('GET', '/api/viaticos/combustibles'), api('GET', '/api/viaticos/tarifas-publico')]);
  const veh = formularioVehiculo(null, combs, globales);
  const res = residenciaCampos(div, null);
  const provs = h('div', { class: 'provincias provincias-zona' }, filasZona(div, null));
  const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar representante');
  const salida = h('div', { 'aria-live': 'polite' });
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo representante'),
    h('p', { class: 'hint' }, 'El sistema crea su usuario y una contraseña temporal. Al entrar por primera vez, el representante elige su propia contraseña.'),
    h('div', { class: 'form-fila' }, campo('nombre', 'Nombre', { autocomplete: 'off' }), campo('apellido', 'Apellido', { autocomplete: 'off' }),
      campo('posicion', 'Posición', { options: ['Visitador', 'PVC', 'Vendedor', 'Promotora'].map((x) => ({ value: x, label: x })), placeholder: 'Elige la posición' }),
      campo('telefono', 'Teléfono', { inputmode: 'tel', autocomplete: 'off' }, '(opcional)'), campo('correo', 'Correo', { type: 'email', autocomplete: 'off' }, '(opcional, para recuperar su clave)')),
    h('h3', { class: 'subtitulo-form' }, 'Dónde vive'), h('div', { class: 'form-fila' }, res.fp, res.fm),
    h('h3', { class: 'subtitulo-form' }, 'Provincias que visitará'), h('p', { class: 'hint' }, 'Con esto se conectan sus municipios, farmacias, hospitales, clínicas, UNAP y hoteles. Si solo visita algunos municipios, ábrela y márcalos. Dos representantes de la misma posición no pueden compartir zona; con otra posición sí. Elige primero la posición para ver lo que ya está cubierto.'),
    h('p', { class: 'error', dataset: { for: 'provincias' } }), provs,
    h('h3', { class: 'subtitulo-form' }, 'Vehículo'), veh.el,
    h('div', { class: 'form-fila solo-vehiculo' }, campo('tarifaAlimentacion', 'Comida por día RD$', { type: 'number', min: 0, step: 0.01, inputmode: 'decimal' })),
    h('div', { class: 'acciones' }, b), salida);
  const sincronizar = () => f.querySelectorAll('.solo-vehiculo').forEach((x) => { x.hidden = !veh.tiene(); });
  f.posicion.addEventListener('change', () => marcarOcupadas(provs, f.posicion.value, null));
  veh.el.addEventListener('change', sincronizar); sincronizar();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { nombre: f.nombre.value, apellido: f.apellido.value, posicion: f.posicion.value, telefono: f.telefono.value, correo: f.correo.value,
      residencia: { provincia: res.sp.value, municipio: res.sm.value }, ...zonaDeForm(f),
      tarifaAlimentacion: veh.tiene() ? f.tarifaAlimentacion.value : '', ...veh.valores(f) };
    const r = await enviar(f, b, () => api('POST', '/api/representantes', body));
    if (!r) return;
    const copiar = h('button', { type: 'button', class: 'btn-sec' }, 'Copiar usuario y clave');
    copiar.addEventListener('click', async () => { try { await navigator.clipboard.writeText(`Usuario: ${r.representante.usuario}\nContraseña temporal: ${r.claveTemporal}`); copiar.textContent = 'Copiado'; } catch { copiar.textContent = 'Cópialo a mano'; } });
    salida.replaceChildren(h('div', { class: 'credenciales', role: 'status' }, h('h3', {}, `${r.representante.nombre} quedó registrado`),
      h('dl', {}, h('div', {}, h('dt', {}, 'Usuario'), h('dd', {}, r.representante.usuario)), h('div', {}, h('dt', {}, 'Contraseña temporal'), h('dd', {}, r.claveTemporal))),
      h('p', {}, 'Entrégale estos datos en persona o por un medio seguro. Esta contraseña no se volverá a mostrar; si la pierde, genera una nueva desde la lista de representantes. Al entrar, deberá cambiarla.'),
      h('div', { class: 'acciones' }, copiar, h('a', { class: 'btn', href: `#representantes?rep=${r.representante.id}&sec=lugares` }, 'Ver su zona'))));
    salida.scrollIntoView({ block: 'nearest' });
  });
  return f;
}

/** Primera entrada con contraseña temporal: debe elegir la suya antes de usar el panel. */
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

V.representantes = async () => {
  const ver = param('ver') || 'zonas';
  const seg = segmentos('Representantes', [...(ES_GER() ? [['nuevo', 'Nuevo representante']] : []), ['zonas', 'Zonas por representante'], ['preregistro', 'Pre-registro por Excel']], ver, (id) => irA('representantes', { ver: id }));
  if (ver === 'nuevo' && ES_GER()) return vista('Representantes', 'Registra a cada Promotora, Visitador, Vendedor o PVC: su usuario se crea solo y su zona, cronograma, km, combustible y viáticos quedan conectados.', seg, await altaRepresentante(await division()));
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
    const lugares = h('div', {},
      tabla([{ t: 'Municipio', v: (x) => [x.municipio, h('small', { style: 'display:block;color:var(--texto-2)' }, x.provincia)] },
        { t: 'Farmacias', num: true, v: (x) => T(x.farmacia) }, { t: 'Hospitales', num: true, v: (x) => T(x.hospital) }, { t: 'Clínicas', num: true, v: (x) => T(x.clinica) },
        { t: 'UNAP', num: true, v: (x) => T(x.unap) }, { t: 'Primer nivel', num: true, v: (x) => T(x.cpn) },
        { t: 'Sin ubicación', num: true, v: (x) => x.sinUbicacion ? h('span', { style: 'color:var(--alerta)' }, fmtN.format(x.sinUbicacion)) : '' }],
      lz.resumen, ['Su zona aún no tiene lugares registrados', 'Usa el registro automático en Catálogo → Farmacias y en Establecimientos.']),
      lz.resumen.length ? h('p', { class: 'hint' }, 'Los lugares sin ubicación no entran en el cálculo de distancia; regístralos desde Google Maps para tener km exactos.') : null,
      lz.resumen.length && yo.role === 'administrador' ? h('div', { class: 'acciones' }, h('a', { class: 'btn', href: `#cronogramas?rep=${id}` }, 'Programar su cronograma')) : null);
    return vistaS('representantes', ['zona', 'lugares'], 'Zona del representante', `${r?.fullName ?? ''}: posición, provincias y municipios que visita. De aquí salen sus lugares, su cronograma, los km, el combustible y sus viáticos.`, S('zona', 'Zona y posición', f), S('lugares', `Lugares de su zona (${fmtN.format(lz.farmacias.length + lz.establecimientos.length)})`, lugares));
  }
  const zonas = await Promise.all(reps.map((r) => api('GET', `/api/territorio/zonas/${r.id}`).then((z) => z.item).catch(() => ({ provincias: [], municipios: {} }))));
  const nuevaClave = async (r) => {
    if (!(await confirmar('Nueva contraseña temporal', `Se generará una contraseña temporal para ${r.fullName}. La actual dejará de funcionar y deberá cambiarla al entrar.`, { okTexto: 'Generar' }))) return;
    try {
      const x = await api('POST', `/api/representantes/${r.id}/clave`);
      $('#dialogo-titulo').textContent = 'Contraseña temporal'; $('#dialogo-cuerpo').replaceChildren(h('dl', { class: 'credenciales-lista' }, h('dt', {}, 'Usuario'), h('dd', {}, x.usuario), h('dt', {}, 'Contraseña temporal'), h('dd', {}, x.claveTemporal)), h('p', { class: 'hint' }, 'No se volverá a mostrar. Entrégala por un medio seguro.'));
      $('#dialogo-ok').textContent = 'Listo'; $('#dialogo').showModal();
    } catch (e) { alert(e.message); }
  };
  const texto = (z) => z.provincias.map((p) => (z.municipios?.[p]?.length ? `${p} (${z.municipios[p].join(', ')})` : p)).join('; ');
  const editarDatos = async (r) => {
    const [nombre, ...resto] = (r.fullName ?? '').split(' ');
    const v = await confirmar('Editar datos', `Corrige los datos de ${r.fullName}. Su usuario para entrar no cambia.`, { okTexto: 'Guardar', campos: [
      { name: 'nombre', label: 'Nombre', value: nombre }, { name: 'apellido', label: 'Apellido', value: resto.join(' ') },
      { name: 'telefono', label: 'Teléfono (opcional)', value: r.phone ?? '', type: 'tel', inputmode: 'tel' }, { name: 'correo', label: 'Correo (opcional)', value: r.email ?? '', type: 'email' }] });
    if (!v) return;
    try { await api('POST', `/api/representantes/${r.id}/editar`, v); router(); } catch (e) { alert(e.fields ? Object.values(e.fields).join(' ') : e.message); }
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
      $('#dialogo-titulo').textContent = 'Reactivado'; $('#dialogo-cuerpo').replaceChildren(h('dl', { class: 'credenciales-lista' }, h('dt', {}, 'Usuario'), h('dd', {}, x.usuario), h('dt', {}, 'Contraseña temporal'), h('dd', {}, x.claveTemporal)), h('p', { class: 'hint' }, 'No se volverá a mostrar. Entrégala por un medio seguro.'));
      $('#dialogo-ok').textContent = 'Listo'; $('#dialogo').addEventListener('close', () => router(), { once: true }); $('#dialogo').showModal();
    } catch (e) { alert(e.message); }
  };
  const bajas = inactivos.length ? h('details', { class: 'tarjeta bajas', style: 'margin-top:1.25rem' }, h('summary', {}, `Dados de baja (${fmtN.format(inactivos.length)})`),
    tabla([{ t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] }, { t: 'Usuario', v: (r) => r.username ?? '' },
      { t: '', v: (r) => h('button', { class: 'btn-sec btn-peq', type: 'button', onclick: () => reactivar(r) }, 'Reactivar') }], inactivos, ['', ''])) : null;
  return vista('Representantes', 'Asigna a cada representante su posición y las provincias o municipios que visita.', seg,
    tabla([{ t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] },
      { t: 'Zona', v: (r) => texto(zonas[reps.indexOf(r)]) || 'Sin asignar' },
      { t: '', v: (r) => [GESTION_T() ? h('a', { class: 'btn-sec btn-peq', href: `#representantes?rep=${r.id}` }, 'Editar zona') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => editarDatos(r) }, 'Editar datos') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-suave', type: 'button', onclick: () => nuevaClave(r) }, 'Nueva clave') : null,
        ES_GER() ? h('button', { class: 'btn-sec btn-peq btn-peligro', type: 'button', onclick: () => darBaja(r) }, 'Dar de baja') : null] }], reps, ['Aún no hay representantes activos', 'Regístralos en "Nuevo representante".']), bajas);
};


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

V.inicio = async () => {
  const r = await api('GET', `/api/inicio?mes=${mesDe()}`);
  const partes = r.tipo === 'representante' ? await inicioRepresentante(r) : r.tipo === 'dependiente' ? await inicioDependiente(r) : r.tipo === 'gestion' ? await inicioGestion(r) : vista('Tu panel', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay módulos para tu rol todavía'), 'Pide a la gerencia que revise los permisos de tu cuenta.'));
  return [h('div', { class: 'inicio' }, partes)];
};

// ---------------------------------------------------------------- menú por rol
let yo;
// Íconos de trazo simple (24×24, esquinas redondeadas), dibujados para FERSUAZ.
const ICONOS = {
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
  banco: '<path d="M4 9.5 12 5l8 4.5"/><path d="M5 9.5h14M6.5 10v6.5M10 10v6.5M14 10v6.5M17.5 10v6.5M4.5 19.5h15"/>',
};
const icono = (id) => { const sp = h('span', { class: 'menu-icono', 'aria-hidden': 'true' }); sp.innerHTML = `<svg viewBox="0 0 24 24">${ICONOS[id] ?? ICONOS.inicio}</svg>`; return sp; };

/**
 * Menú por rol: primero accesos directos (sin título), luego hasta 3 grupos de hasta 5 ítems,
 * y utilidades en la base. Formato: [título|null, [[id, etiqueta], ...], 'pie'?]
 */
function menuPara(u) {
  const G = ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(u.role);
  if (u.role === 'dependiente') return [[null, [['inicio', 'Inicio'], ['voucher', 'Cargar voucher'], ['misVouchers', 'Mis vouchers'], ['comision', 'Mi comisión'], ['banco', 'Mi cuenta de banco']]]];
  if (u.role === 'representante') {
    const s = [];
    if (u.position === 'Promotora') {
      s.push([null, [['inicio', 'Inicio'], ['operativo', 'Operativo de hoy'], ['receta', 'Cargar receta'], ['jornadas', 'Mis jornadas']]]);
      s.push(['Mi trabajo', [['misRecetas', 'Mis recetas'], ['alertas', 'Alertas'], ['presupuesto', 'Mi presupuesto'], ['establecimientos', 'Establecimientos']]]);
    } else {
      s.push([null, [['inicio', 'Inicio'], ['jornadas', 'Mis jornadas'], ['presupuesto', 'Mi presupuesto']]]);
      s.push(['Mi zona', [['establecimientos', 'Establecimientos'], ...(u.position === 'Vendedor' ? [['catalogo', 'Farmacias'], ['inventario', 'Inventario']] : [])]]);
      if (['Vendedor', 'PVC'].includes(u.position)) s.push(['Vouchers', [['voucher', 'Cargar voucher'], ['misVouchers', 'Vouchers cargados']]]);
    }
    return s;
  }
  if (!G) return [[null, [['inicio', 'Inicio']]]];
  return [
    [null, [['inicio', 'Inicio'], ['cronogramas', 'Cronogramas'], ['viaticos', 'Presupuestos'], ['revisar', 'Vouchers por revisar'], ['viatico', null]]],
    ['Territorio', [...(u.role !== 'finanzas' ? [['representantes', 'Representantes']] : []), ['establecimientos', 'Establecimientos'], ['hoteles', 'Hoteles'], ['catalogo', 'Catálogo']]],
    ['Ventas y recetas', [['comisiones', 'Comisiones'], ['reportes', 'Reporte de recetas'], ['misRecetas', 'Recetas'], ['alertas', 'Alertas'], ['inventario', 'Inventario']]],
    ['Viáticos', [['perfiles', 'Perfiles de viático'], ['precios', 'Precios de combustible']]],
    ...(u.role !== 'finanzas' ? [['', [['solicitudes', 'Cuentas y accesos']], 'pie']] : []),
  ];
}
function pintarMenu(secciones, actual) {
  const padre = { viatico: 'viaticos' }[actual] ?? actual;
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
async function router() {
  const ruta = location.hash.slice(1).split('?')[0];
  const permitidas = secciones.flatMap(([, i]) => i.map(([id]) => id));
  const id = permitidas.includes(ruta) ? ruta : permitidas[0];
  if (id !== ruta) { history.replaceState(null, '', `#${id}`); }
  pintarMenu(secciones, id);
  const cont = $('#vista');
  cont.replaceChildren(h('p', { class: 'cargando' }, 'Cargando…'));
  try { cont.replaceChildren(...(await V[id]()).filter(Boolean)); }
  catch (e) { cont.replaceChildren(h('h1', {}, 'No pudimos cargar esta sección'), h('div', { class: 'aviso error' }, e.message), h('button', { class: 'btn-sec', onclick: router }, 'Intentar de nuevo')); }
  cont.focus({ preventScroll: true });
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

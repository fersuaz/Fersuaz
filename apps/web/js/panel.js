// Panel de trabajo FERSUAZ. Muestra a cada rol solo lo suyo; el servidor vuelve a comprobar cada permiso.
import { apiBase } from './api.js';

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
function confirmar(titulo, cuerpo, { okTexto = 'Confirmar', pedirMotivo = false } = {}) {
  const d = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  const c = $('#dialogo-cuerpo'); c.replaceChildren(h('p', {}, cuerpo));
  let motivo;
  if (pedirMotivo) { motivo = h('textarea', { id: 'motivo', rows: 3, style: 'width:100%;border:1.5px solid var(--linea);border-radius:12px;padding:.7rem;font:inherit' }); c.append(h('label', { for: 'motivo', class: 'hint' }, 'Motivo'), motivo); }
  $('#dialogo-ok').textContent = okTexto;
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok' ? (motivo ? motivo.value : true) : null), { once: true }));
}
const tabla = (cols, filas, vacio) => filas.length
  ? h('div', { class: 'tabla-envoltura' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.t)))),
      h('tbody', {}, filas.map((f) => h('tr', {}, cols.map((c) => h('td', { 'data-label': c.t, class: c.num ? 'num' : null }, h('span', { class: 'celda' }, c.v(f)))))))))
  : h('div', { class: 'tarjeta vacio' }, h('strong', {}, vacio[0]), vacio[1]);
const vista = (titulo, sub, ...contenido) => [h('h1', {}, titulo), sub ? h('p', { class: 'vista-sub' }, sub) : null, ...contenido];

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
V.voucher = async () => {
  const ed = lineasEditor({ conMonto: true }); await ed.init();
  if (!ed.hayMeds()) return vista('Cargar voucher', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'Todavía no hay medicamentos en el catálogo'), 'La gerencia debe agregarlos antes de que puedas cargar vouchers.'));
  const boton = h('button', { class: 'btn', type: 'submit' }, 'Guardar voucher');
  const form = h('form', { class: 'tarjeta', novalidate: true },
    h('div', { class: 'form-fila' }, campo('referencia', 'Número de voucher', { required: true, autocomplete: 'off' }), campo('fecha', 'Fecha', { type: 'date', value: hoy(), max: hoy(), required: true })),
    h('h2', {}, 'Medicamentos vendidos'), h('p', { class: 'error', dataset: { for: 'items' } }), ed.el,
    h('div', { class: 'acciones' }, ed.boton, ed.total), h('div', { class: 'acciones' }, boton));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await enviar(form, boton, () => api('POST', '/api/vouchers', { referencia: form.referencia.value, fecha: form.fecha.value, items: ed.valores() }));
    if (r) { estado(form.querySelector('.aviso'), 'ok', `Voucher ${r.item.referencia} guardado por ${RD(r.item.total)}. Queda pendiente de revisión.`); form.referencia.value = ''; form.referencia.focus(); }
  });
  return vista('Cargar voucher', 'Cada voucher suma a tu comisión cuando tu supervisor o finanzas lo aprueban.', form);
};
V.misVouchers = async () => {
  const { items } = await api('GET', '/api/vouchers');
  const pintar = async () => router();
  return vista('Mis vouchers', 'Puedes anular un voucher mientras siga pendiente de revisión.', tabla([
    { t: 'Número', v: (v) => v.referencia }, { t: 'Fecha', v: (v) => fecha(v.fecha) },
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
  const form = h('form', { class: 'tarjeta', novalidate: true },
    campo('operativoId', 'Operativo', { options: recientes.map((o) => ({ value: o.id, label: `${o.centro}, ${o.municipio} (${fecha(o.fecha)})` })), value: recientes[0].id, required: true }),
    selMedico, nuevoMed,
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
      return api('POST', '/api/recetas', { operativoId: form.operativoId.value, medicoId, items: ed.valores(), adjunto });
    });
    if (r) {
      estado(form.querySelector('.aviso'), 'ok', 'Receta guardada.');
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
    { t: 'Fecha', v: (r) => fecha(r.fecha) }, { t: 'Médico', v: (r) => `${r.medico}, ${r.especialidad}` }, { t: 'Zona', v: (r) => `${r.municipio}, ${r.provincia}` },
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
V.catalogo = async () => {
  const esGer = ['administrador', 'gerencia'].includes(yo.role);
  const [ms, fs, mds] = await Promise.all([medicamentos(), api('GET', '/api/catalogo/farmacias'), api('GET', '/api/catalogo/medicos')]);
  const validar = async (col, id) => { try { await api('POST', `/api/catalogo/${col}/${id}/validar`); router(); } catch (e) { alert(e.message); } };
  const bloques = [];
  if (esGer) {
    const b = h('button', { class: 'btn', type: 'submit' }, 'Agregar medicamento');
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo medicamento'),
      h('div', { class: 'form-fila' }, campo('nombre', 'Nombre'), campo('linea', 'Línea', {}, '(opcional)'), campo('presentacion', 'Presentación', {}, '(opcional)')), h('div', { class: 'acciones' }, b));
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/catalogo/medicamentos', { nombre: f.nombre.value, linea: f.linea.value, presentacion: f.presentacion.value }))) { cache = {}; router(); } });
    bloques.push(f);
  }
  bloques.push(h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Medicamentos'),
    tabla([{ t: 'Nombre', v: (m) => m.nombre }, { t: 'Línea', v: (m) => m.linea ?? '' }, { t: 'Presentación', v: (m) => m.presentacion ?? '' }], ms, ['Catálogo vacío', 'Agrega los medicamentos de FERSUAZ para que se puedan usar en vouchers y recetas.']));
  if (['administrador', 'gerencia', 'supervisor'].includes(yo.role) || (yo.role === 'representante' && yo.position === 'Vendedor')) {
    const b = h('button', { class: 'btn', type: 'submit' }, 'Agregar farmacia');
    const f = h('form', { class: 'tarjeta', novalidate: true, style: 'margin-top:1.5rem' }, h('h2', {}, 'Nueva farmacia'),
      h('div', { class: 'form-fila' }, campo('nombre', 'Nombre'), campo('provincia', 'Provincia'), campo('municipio', 'Municipio'), campo('sector', 'Sector', {}, '(opcional)')), h('div', { class: 'acciones' }, b));
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/catalogo/farmacias', { nombre: f.nombre.value, provincia: f.provincia.value, municipio: f.municipio.value, sector: f.sector.value }))) router(); });
    bloques.push(f);
  }
  bloques.push(h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Farmacias'),
    tabla([{ t: 'Nombre', v: (x) => x.nombre }, { t: 'Zona', v: (x) => `${x.municipio}, ${x.provincia}` }, { t: 'Estado', v: (x) => chip(x.estado) },
      { t: '', v: (x) => esGer && x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar('farmacias', x.id) }, 'Validar') : '' }], fs.items, ['Aún no hay farmacias', 'Los vendedores y supervisores pueden agregarlas.']),
    h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Médicos'),
    tabla([{ t: 'Nombre', v: (x) => x.nombre }, { t: 'Especialidad', v: (x) => x.especialidad }, { t: 'Zona', v: (x) => `${x.municipio}, ${x.provincia}` }, { t: 'Estado', v: (x) => chip(x.estado) },
      { t: '', v: (x) => esGer && x.estado === 'pendiente' ? h('button', { class: 'btn-sec btn-peq', onclick: () => validar('medicos', x.id) }, 'Validar') : '' }], mds.items, ['Aún no hay médicos', 'Las promotoras los agregan al cargar recetas.']));
  return vista('Catálogo', 'Medicamentos, farmacias y médicos. Lo que agregan las promotoras y los vendedores queda pendiente hasta que la gerencia lo valida.', ...bloques);
};
V.solicitudes = async () => {
  const { pending } = await api('GET', '/api/auth/pending');
  const decidir = async (u, ok) => {
    if (!(await confirmar(ok ? 'Aprobar cuenta' : 'Rechazar cuenta', `${ok ? 'Aprobar' : 'Rechazar'} la solicitud de ${u.fullName} como ${ROLES[u.role]}.`, { okTexto: ok ? 'Aprobar cuenta' : 'Rechazar cuenta' }))) return;
    try { await api('POST', `/api/auth/requests/${u.id}/${ok ? 'aprobar' : 'rechazar'}`); } catch (e) { alert(e.message); }
    router();
  };
  return vista('Solicitudes de cuenta', 'Solo puedes decidir las solicitudes que tu rol permite aprobar.', tabla([
    { t: 'Nombre', v: (u) => [u.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, u.email)] },
    { t: 'Rol', v: (u) => `${ROLES[u.role]}${u.position ? `, ${u.position}` : ''}` }, { t: 'Farmacia', v: (u) => u.pharmacy ? `${u.pharmacy}, ${u.province}` : '' },
    { t: 'Fecha', v: (u) => fecha(u.createdAt) },
    { t: '', v: (u) => h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' }, h('button', { class: 'btn btn-peq', onclick: () => decidir(u, true) }, 'Aprobar'), h('button', { class: 'btn-sec btn-peq', onclick: () => decidir(u, false) }, 'Rechazar')) },
  ], pending, ['No hay solicitudes pendientes', 'Las nuevas cuentas aparecerán aquí.']));
};
V.pronto = async () => vista('Tu panel', null, h('div', { class: 'tarjeta vacio' }, h('strong', {}, 'No hay módulos para tu rol todavía'), 'Pide a la gerencia que revise los permisos de tu cuenta.'));

// ---------------------------------------------------------------- vistas: rutas y viáticos
const CAT = { combustible: 'Combustible', alimentacion: 'Alimentación', hospedaje: 'Hospedaje', peajes: 'Peajes', estacionamiento: 'Estacionamiento', otros: 'Otros' };
const EST_P = { sin_solicitud: 'Sin solicitud', borrador: 'Borrador', solicitado: 'Solicitado', aprobado: 'Aprobado', rechazado: 'Rechazado', desembolsado: 'Desembolsado', liquidado: 'Liquidado', planificada: 'Planificada', realizada: 'Realizada', cancelada: 'Cancelada', propuesto: 'Por autorizar', reportado: 'Por revisar', aceptado: 'Aceptado' };
const chipP = (e) => h('span', { class: `chip ${({ aprobado: 'aprobado', liquidado: 'aprobado', realizada: 'aprobado', aceptado: 'aprobado', solicitado: 'pendiente', propuesto: 'pendiente', reportado: 'pendiente', desembolsado: 'ok', rechazado: 'rechazado', cancelada: 'anulado' })[e] ?? ''}` }, EST_P[e] ?? e);
const mesDe = () => new URLSearchParams(location.hash.split('?')[1]).get('mes') || mesActual();
const archivoB64 = (file) => new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(file); });
function desglose(d, total) {
  return h('dl', { class: 'rejilla' }, ...Object.entries(CAT).map(([k, l]) => h('div', { class: 'cifra' }, h('dt', {}, l), h('dd', {}, RD(d[k] ?? 0)))),
    h('div', { class: 'cifra destacada' }, h('dt', {}, 'Total'), h('dd', {}, RD(total))));
}

V.jornadas = async () => {
  const mes = mesDe();
  const [{ items }, est] = await Promise.all([api('GET', `/api/viaticos/jornadas?mes=${mes}`), api('GET', '/api/viaticos/estado')]);
  const paradas = h('div', { class: 'lineas' }); let n = 0;
  const addParada = () => { const i = n++; const f = h('div', { class: 'linea' }, campo(`paradas.${i}.lugar`, 'Lugar (clínica, hospital, farmacia)'), campo(`paradas.${i}.municipio`, 'Municipio'), campo(`paradas.${i}.provincia`, 'Provincia'),
    h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar parada', onclick: () => { if (paradas.children.length > 1) f.remove(); } }, 'Quitar')); paradas.append(f); };
  addParada();
  const hosp = h('details', { class: 'tarjeta', style: 'background:var(--canvas)' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--marino)' }, '¿Necesitas hotel? La gerencia debe autorizarlo'),
    h('div', { class: 'form-fila', style: 'margin-top:1rem' }, campo('hospedaje.noches', 'Noches', { type: 'number', min: 1, step: 1, inputmode: 'numeric' }), campo('hospedaje.tarifaNoche', 'Tarifa por noche RD$', { type: 'number', min: 0, step: 0.01 }),
      campo('hospedaje.cargos', 'Impuestos y cargos RD$', { type: 'number', min: 0, step: 0.01, value: 0 }), campo('hospedaje.hotel', 'Hotel', {}, '(si lo sabes)')),
    campo('hospedaje.motivo', 'Motivo del hospedaje'));
  const kmInfo = h('p', { class: 'hint', 'aria-live': 'polite' }, est.mapas ? 'Calcula los km por carretera desde tu residencia, con regreso.' : 'El mapa aún no está conectado: escribe los km por carretera (ida, paradas y regreso). Quedan marcados como estimado manual.');
  let kmFuente = 'manual';
  const calc = est.mapas ? h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: async () => {
    calc.disabled = true; calc.textContent = 'Calculando…';
    try { const r = await api('POST', '/api/viaticos/calcular-km', { paradas: leerParadas() }); form.kmEstimados.value = r.km; kmFuente = 'google'; kmInfo.textContent = `Ruta por carretera: ${fmtN.format(r.km)} km, unos ${fmtN.format(r.minutos)} minutos de manejo.`; }
    catch (e) { mostrarErrores(form, e); kmInfo.textContent = e.message; }
    finally { calc.disabled = false; calc.textContent = 'Calcular km con el mapa'; }
  } }, 'Calcular km con el mapa') : null;
  const boton = h('button', { class: 'btn', type: 'submit' }, 'Guardar jornada');
  const form = h('form', { class: 'tarjeta', novalidate: true },
    h('div', { class: 'form-fila' }, campo('fecha', 'Fecha', { type: 'date', value: hoy(), required: true })),
    h('h2', {}, 'Paradas en orden'), h('p', { class: 'error', dataset: { for: 'paradas' } }), paradas, h('div', { class: 'acciones' }, h('button', { type: 'button', class: 'btn-sec btn-peq', onclick: addParada }, 'Agregar parada')),
    h('div', { class: 'form-fila', style: 'margin-top:1rem' }, campo('kmEstimados', 'Km por carretera', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', oninput: () => { kmFuente = 'manual'; } }),
      campo('peajes', 'Peajes RD$', { type: 'number', min: 0, step: 0.01, value: 0 }), campo('estacionamiento', 'Estacionamiento RD$', { type: 'number', min: 0, step: 0.01, value: 0 }), campo('otros', 'Otros RD$', { type: 'number', min: 0, step: 0.01, value: 0 })),
    kmInfo, calc ? h('div', { class: 'acciones', style: 'margin-top:0' }, calc) : null,
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'conAlimentacion', checked: true }), h('span', {}, 'Este día lleva gasto de alimentación')),
    hosp, h('div', { class: 'acciones' }, boton));
  function leerParadas() { return [...paradas.children].map((f) => ({ lugar: f.querySelector('[name$=".lugar"]').value, municipio: f.querySelector('[name$=".municipio"]').value, provincia: f.querySelector('[name$=".provincia"]').value })); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (k) => form.elements[k]?.value;
    const body = { fecha: g('fecha'), paradas: leerParadas(), kmEstimados: g('kmEstimados'), kmFuente, peajes: g('peajes'), estacionamiento: g('estacionamiento'), otros: g('otros'), conAlimentacion: form.conAlimentacion.checked,
      hospedaje: hosp.open && g('hospedaje.noches') ? { noches: Number(g('hospedaje.noches')), tarifaNoche: g('hospedaje.tarifaNoche'), cargos: g('hospedaje.cargos'), hotel: g('hospedaje.hotel'), motivo: g('hospedaje.motivo') } : null };
    if (await enviar(form, boton, () => api('POST', '/api/viaticos/jornadas', body))) { location.hash = `#jornadas?mes=${body.fecha.slice(0, 7)}`; router(); }
  });
  const accion = async (j, a) => {
    if (a === 'realizada') {
      const km = await confirmar('Marcar jornada realizada', `Escribe los km reales del ${fecha(j.fecha)} según el odómetro.`, { okTexto: 'Guardar', pedirMotivo: true });
      if (km == null) return; try { await api('POST', `/api/viaticos/jornadas/${j.id}/realizada`, { kmReales: Number(String(km).replace(',', '.')) }); } catch (e) { alert(e.message); }
    } else if (await confirmar('Cancelar jornada', `¿Cancelar la jornada del ${fecha(j.fecha)}? No contará en el presupuesto.`, { okTexto: 'Cancelar jornada' })) {
      try { await api('POST', `/api/viaticos/jornadas/${j.id}/cancelar`); } catch (e) { alert(e.message); }
    }
    router();
  };
  return vista('Mis jornadas', 'Planifica tus rutas del mes. El presupuesto de viáticos se calcula con estas jornadas.', form,
    h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Jornadas del mes'), filtroMes(mes, 'jornadas', null, { futuro: true }),
    tabla([
      { t: 'Fecha', v: (j) => fecha(j.fecha) }, { t: 'Paradas', v: (j) => j.paradas.map((p) => `${p.lugar} (${p.municipio})`).join(' → ') },
      { t: 'Km', num: true, v: (j) => [fmtN.format(j.kmEstimados), h('small', { style: 'display:block;color:var(--texto-2)' }, j.kmFuente === 'google' ? 'mapa' : 'manual'), j.kmReales != null ? h('small', { style: 'display:block' }, `real ${fmtN.format(j.kmReales)}`) : null] },
      { t: 'Hotel', v: (j) => j.hospedaje ? [`${j.hospedaje.noches} noche(s)`, ' ', chipP(j.hospedaje.estado)] : 'No' },
      { t: 'Estado', v: (j) => chipP(j.estado) },
      { t: '', v: (j) => j.estado === 'planificada' ? h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
        j.fecha <= hoy() ? h('button', { class: 'btn btn-peq', onclick: () => accion(j, 'realizada') }, 'Realizada') : null, h('button', { class: 'btn-sec btn-peq', onclick: () => accion(j, 'cancelar') }, 'Cancelar')) : '' },
    ], items, ['No hay jornadas en este mes', 'Planifica tu primera jornada con el formulario de arriba.']));
};

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
      bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Presupuesto calculado'), desglose(c.detalle, c.total),
        h('p', { class: 'hint', style: 'margin-top:1rem' }, `${c.supuestos.jornadas} jornadas, ${fmtN.format(c.supuestos.km)} km (${c.supuestos.kmTipo}), ${c.supuestos.diasAlimentacion} días de alimentación a ${RD(c.supuestos.tarifaAlimentacion)}.${c.supuestos.reembolsoPorKm ? ` Reembolso de ${RD(c.supuestos.reembolsoPorKm)} por km.` : c.supuestos.galones ? ` ${fmtN.format(c.supuestos.galones)} galones a ${c.supuestos.rendimiento} km/gal.` : ''} Tu salario no forma parte de este presupuesto.`),
        h('div', { class: 'acciones' }, h('button', { class: 'btn', disabled: c.faltan?.length > 0, onclick: async (ev) => {
          if (!(await confirmar('Solicitar viáticos', `Enviar a la gerencia el presupuesto de ${mes} por ${RD(c.total)}. Después no podrás cambiar las jornadas del mes.`, { okTexto: 'Solicitar' }))) return;
          ev.target.disabled = true; try { await api('POST', '/api/viaticos/presupuesto/solicitar', { mes }); } catch (e) { alert(e.message); } router();
        } }, 'Solicitar viáticos'))));
    }
  } else {
    bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Presupuesto solicitado'), desglose(p.detalle, p.total)), bloqueResumen(p));
    if (['aprobado', 'desembolsado'].includes(p.estado)) {
      const b = h('button', { class: 'btn', type: 'submit' }, 'Reportar gasto');
      const f = h('form', { class: 'tarjeta', novalidate: true, style: 'margin-top:1.25rem' }, h('h2', {}, 'Reportar un gasto'),
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
      bloques.push(f);
    }
    bloques.push(h('h2', { style: 'margin:1.5rem 0 .75rem;font-size:1.2rem' }, 'Gastos reportados'), tablaGastos(p));
  }
  return vista('Mi presupuesto de viáticos', 'Se calcula con tus jornadas del mes, el rendimiento de tu vehículo y el precio vigente del combustible.', ...bloques);
};

V.perfiles = async () => {
  const [{ items: reps }, { items: combs }] = await Promise.all([api('GET', '/api/viaticos/representantes'), api('GET', '/api/viaticos/combustibles')]);
  const puede = ['administrador', 'gerencia', 'supervisor'].includes(yo.role);
  const id = new URLSearchParams(location.hash.split('?')[1]).get('rep');
  const lista = tabla([
    { t: 'Representante', v: (r) => [r.fullName, h('small', { style: 'display:block;color:var(--texto-2)' }, r.position ?? '')] },
    { t: 'Residencia', v: (r) => r.perfil ? `${r.perfil.residencia.municipio}, ${r.perfil.residencia.provincia}` : 'Sin perfil' },
    { t: 'Vehículo', v: (r) => r.perfil ? `${r.perfil.vehiculo.propiedad === 'propio' ? 'Propio' : 'Asignado'}, ${combs.find((c) => c.value === r.perfil.vehiculo.combustible)?.label ?? ''}${r.perfil.vehiculo.rendimiento ? `, ${r.perfil.vehiculo.rendimiento} km/gal` : ''}` : '' },
    { t: 'Comida/día', num: true, v: (r) => r.perfil ? RD(r.perfil.tarifaAlimentacion) : '' },
    { t: '', v: (r) => puede ? h('a', { class: 'btn-sec btn-peq', href: `#perfiles?rep=${r.id}` }, r.perfil ? 'Editar' : 'Configurar') : '' },
  ], reps, ['Aún no hay representantes activos', 'Aparecen aquí cuando se aprueban sus cuentas.']);
  if (!id || !puede) return vista('Perfiles de viático', 'Vehículo, residencia y tarifa de cada representante. La dirección exacta solo la ven la gerencia y el propio representante.', lista);
  const r = reps.find((x) => x.id === id); const pf = (await api('GET', `/api/viaticos/perfiles/${id}`)).item;
  const b = h('button', { class: 'btn', type: 'submit' }, 'Guardar perfil');
  const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, r?.fullName ?? 'Representante'),
    h('div', { class: 'form-fila' }, campo('residencia.provincia', 'Provincia de residencia', { value: pf?.residencia?.provincia ?? '' }), campo('residencia.municipio', 'Municipio de residencia', { value: pf?.residencia?.municipio ?? '' }),
      campo('residencia.direccion', 'Dirección desde donde sale', { value: pf?.residencia?.direccion ?? '' }, '(restringida)')),
    h('h2', { style: 'margin-top:1rem' }, 'Vehículo'),
    h('div', { class: 'form-fila' }, campo('vehiculo.propiedad', 'Propiedad', { options: [{ value: 'asignado', label: 'Asignado por FERSUAZ' }, { value: 'propio', label: 'Propio' }], value: pf?.vehiculo?.propiedad }),
      campo('vehiculo.combustible', 'Combustible', { options: combs, value: pf?.vehiculo?.combustible }), campo('vehiculo.rendimiento', 'Rendimiento real km/galón', { type: 'number', min: 1, step: 0.1, value: pf?.vehiculo?.rendimiento ?? '' }),
      campo('vehiculo.marca', 'Marca', { value: pf?.vehiculo?.marca ?? '' }), campo('vehiculo.modelo', 'Modelo', { value: pf?.vehiculo?.modelo ?? '' }), campo('vehiculo.anio', 'Año', { type: 'number', value: pf?.vehiculo?.anio ?? '' }), campo('vehiculo.placa', 'Placa', { value: pf?.vehiculo?.placa ?? '' }, '(restringida)')),
    h('h2', { style: 'margin-top:1rem' }, 'Viáticos'),
    h('div', { class: 'form-fila' }, campo('tarifaAlimentacion', 'Alimentación por día RD$', { type: 'number', min: 0, step: 0.01, value: pf?.tarifaAlimentacion ?? '' }),
      campo('reembolsoPorKm', 'Reembolso por km RD$', { type: 'number', min: 0, step: 0.01, value: pf?.reembolsoPorKm ?? '' }, '(solo vehículo propio; reemplaza al combustible)')),
    h('div', { class: 'acciones' }, b, h('a', { class: 'btn-sec', href: '#perfiles' }, 'Volver')));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const g = (k) => f.elements[k].value;
    const body = { residencia: { provincia: g('residencia.provincia'), municipio: g('residencia.municipio'), direccion: g('residencia.direccion') },
      vehiculo: { propiedad: g('vehiculo.propiedad'), combustible: g('vehiculo.combustible'), rendimiento: g('vehiculo.rendimiento'), marca: g('vehiculo.marca'), modelo: g('vehiculo.modelo'), anio: g('vehiculo.anio'), placa: g('vehiculo.placa') },
      tarifaAlimentacion: g('tarifaAlimentacion'), reembolsoPorKm: g('reembolsoPorKm') };
    if (await enviar(f, b, () => api('POST', `/api/viaticos/perfiles/${id}`, body))) location.hash = '#perfiles';
  });
  return vista('Perfil de viático', null, f);
};

V.precios = async () => {
  const [{ items }, { items: combs }] = await Promise.all([api('GET', '/api/viaticos/precios'), api('GET', '/api/viaticos/combustibles')]);
  const bloques = [];
  if (['administrador', 'gerencia', 'finanzas'].includes(yo.role)) {
    const b = h('button', { class: 'btn', type: 'submit' }, 'Registrar precio');
    const f = h('form', { class: 'tarjeta', novalidate: true }, h('h2', {}, 'Nuevo precio'),
      h('div', { class: 'form-fila' }, campo('combustible', 'Combustible', { options: combs.filter((c) => !['hibrido', 'electrico'].includes(c.value)) }),
        campo('precioGalon', 'Precio por galón RD$', { type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' }), campo('vigenteDesde', 'Vigente desde', { type: 'date', value: hoy() })),
      h('div', { class: 'acciones' }, b));
    f.addEventListener('submit', async (e) => { e.preventDefault(); if (await enviar(f, b, () => api('POST', '/api/viaticos/precios', { combustible: f.combustible.value, precioGalon: f.precioGalon.value, vigenteDesde: f.vigenteDesde.value }))) router(); });
    bloques.push(f);
  }
  bloques.push(tabla([{ t: 'Combustible', v: (p) => combs.find((c) => c.value === p.combustible)?.label ?? p.combustible }, { t: 'Precio por galón', num: true, v: (p) => RD(p.precioGalon) }, { t: 'Vigente desde', v: (p) => fecha(p.vigenteDesde) }],
    items, ['Aún no hay precios registrados', 'Registra los precios oficiales semanales del MICM para que se calcule el combustible.']));
  return vista('Precios de combustible', 'Cada jornada usa el precio vigente en su fecha. Los presupuestos ya aprobados no cambian.', ...bloques);
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
  if (hoteles.length) bloques.push(h('h2', { style: 'margin:1rem 0 .75rem;font-size:1.2rem' }, 'Hospedajes'), tabla([
    { t: 'Fecha', v: (j) => fecha(j.fecha) }, { t: 'Destino', v: (j) => j.paradas.at(-1)?.municipio ?? '' }, { t: 'Motivo', v: (j) => j.hospedaje.motivo },
    { t: 'Costo', num: true, v: (j) => RD(j.hospedaje.noches * j.hospedaje.tarifaNoche + j.hospedaje.cargos) }, { t: 'Estado', v: (j) => chipP(j.hospedaje.estado) },
    { t: '', v: (j) => ger && j.hospedaje.estado === 'propuesto' ? h('span', { class: 'acciones', style: 'margin:0;flex-wrap:nowrap' },
      h('button', { class: 'btn btn-peq', onclick: () => accion(() => api('POST', `/api/viaticos/jornadas/${j.id}/hospedaje`, { aprobar: true })) }, 'Autorizar'),
      h('button', { class: 'btn-sec btn-peq', onclick: () => accion(() => api('POST', `/api/viaticos/jornadas/${j.id}/hospedaje`, { aprobar: false })) }, 'No autorizar')) : '' },
  ], hoteles, ['', '']));
  if (!p || ['borrador', 'rechazado'].includes(p.estado)) {
    bloques.push(h('div', { class: 'aviso' }, p?.estado === 'rechazado' ? `Rechazado: ${p.motivo}. El representante puede ajustar y volver a solicitar.` : 'El representante todavía no ha solicitado este presupuesto.'));
    if (c.detalle) bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, 'Cálculo actual'), desglose(c.detalle, c.total)));
    if (c.faltan?.length) bloques.push(h('div', { class: 'aviso' }, c.faltan.join(' ')));
  } else {
    bloques.push(h('div', { class: 'tarjeta' }, h('h2', {}, `Presupuesto ${EST_P[p.estado].toLowerCase()}`), desglose(p.detalle, p.total),
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

// ---------------------------------------------------------------- menú por rol
let yo;
function menuPara(u) {
  const G = ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(u.role);
  const s = [];
  if (u.role === 'dependiente') s.push(['Mi trabajo', [['voucher', 'Cargar voucher'], ['misVouchers', 'Mis vouchers'], ['comision', 'Mi comisión']]]);
  if (u.role === 'representante' && u.position === 'Promotora') s.push(['Mi trabajo', [['operativo', 'Operativo de hoy'], ['receta', 'Cargar receta'], ['misRecetas', 'Mis recetas'], ['alertas', 'Alertas']]]);
  if (u.role === 'representante' && u.position === 'Vendedor') s.push(['Mi trabajo', [['inventario', 'Inventario'], ['catalogo', 'Farmacias']]]);
  if (u.role === 'representante') s.push(['Rutas y viáticos', [['jornadas', 'Mis jornadas'], ['presupuesto', 'Mi presupuesto']]]);
  if (G) {
    s.push(['Dependientes', [['revisar', 'Vouchers por revisar'], ['comisiones', 'Comisiones']]]);
    s.push(['Promotoras', [['reportes', 'Reporte de recetas'], ['misRecetas', 'Recetas'], ['alertas', 'Alertas']]]);
    s.push(['Rutas y viáticos', [['viaticos', 'Presupuestos'], ['perfiles', 'Perfiles de viático'], ['precios', 'Precios de combustible'], ['viatico', null]]]);
    s.push(['Administración', [['inventario', 'Inventario'], ['catalogo', 'Catálogo'], ...(u.role !== 'finanzas' ? [['solicitudes', 'Solicitudes de cuenta']] : [])]]);
  }
  if (!s.length) s.push(['Mi trabajo', [['pronto', 'Inicio']]]);
  return s;
}
function pintarMenu(secciones, actual) {
  const padre = { viatico: 'viaticos' }[actual] ?? actual;
  $('#menu').replaceChildren(...secciones.flatMap(([titulo, items]) => [h('h3', {}, titulo), ...items.filter(([, label]) => label).map(([id, label]) => h('a', { href: `#${id}`, 'aria-current': id === padre ? 'page' : null }, label))]));
}
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
  $('#usuario-rol').textContent = `${ROLES[yo.role]}${yo.position ? `, ${yo.position}` : ''}`;
  secciones = menuPara(yo);
  addEventListener('hashchange', router);
  router();
})();

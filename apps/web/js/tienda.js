// Tienda para farmacias: catálogo, ficha con galería y pedido (sin pago en línea).
// El precio solo llega del servidor a cuentas con sesión; el total final lo calcula el servidor.
import { apiBase } from './api.js';

const BASE = apiBase() || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8080' : '');
const CLAVE = 'fersuaz.pedido';
const RD = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', currencyDisplay: 'code' });
const dinero = (n) => RD.format(n).replace('DOP', 'RD$').replace(/ /g, ' ');
const $ = (s) => document.querySelector(s);
const PAGOS = [['transferencia', 'Transferencia bancaria', 'Puedes subir el comprobante ahora o después, desde Mis pedidos.'], ['credito', 'Crédito', 'Según las condiciones de crédito de tu farmacia.'], ['contra_entrega', 'Pago al entregar', 'Pagas cuando recibes el pedido.']];

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const token = () => { try { return sessionStorage.getItem('fersuaz.token') || localStorage.getItem('fersuaz.token'); } catch { return null; } };
async function api(metodo, ruta, cuerpo) {
  const t = token();
  const r = await fetch(BASE + ruta, { method: metodo, headers: { 'content-type': 'application/json', ...(t && { authorization: `Bearer ${t}` }) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'No se pudo completar. Intenta de nuevo.'); e.fields = j.fields; e.status = r.status; throw e; }
  return j;
}
const img = (u) => (u.startsWith('/api/') ? BASE + u : u);

// ---------------------------------------------------------------- sesión
let yo = null;
async function sesion() {
  if (!token()) return null;
  try { yo = (await api('GET', '/api/auth/me')).user; } catch { yo = null; }
  const enlace = document.querySelector('[data-sesion]');
  if (yo && enlace) { enlace.textContent = 'Mi panel'; enlace.href = 'panel.html'; }
  return yo;
}
const puedePedir = () => yo?.role === 'dependiente';
function avisoSesion() {
  const p = $('#aviso-sesion'); if (!p) return;
  p.hidden = false;
  if (!yo) p.replaceChildren('Los precios se ven al ', h('a', { href: 'entrar.html?volver=tienda.html' }, 'iniciar sesión'), ' con la cuenta de tu farmacia. ¿Aún no tienes cuenta? ', h('a', { href: 'registro.html?rol=dependiente' }, 'Regístrate como dependiente'), '.');
  else if (!puedePedir()) p.textContent = 'Ves los precios del catálogo. Los pedidos los hace la dependiente con la cuenta de su farmacia.';
  else p.textContent = `Pides para tu farmacia${yo.pharmacy ? `: ${yo.pharmacy}` : ''}.`;
}

// ---------------------------------------------------------------- pedido (carrito)
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) ?? []; } catch { return []; } };
const guardar = (x) => { try { localStorage.setItem(CLAVE, JSON.stringify(x)); } catch { /* sin almacenamiento: queda en memoria */ } pintarBoton(); };
function agregar(p, cantidad) {
  const items = leer(); const ya = items.find((x) => x.id === p.id);
  if (ya) ya.cantidad = Math.min(10000, ya.cantidad + cantidad);
  else items.push({ id: p.id, nombre: p.nombre, presentacion: p.presentacion, precio: p.precio, imagen: p.imagenes[0]?.url ?? null, cantidad });
  guardar(items);
}
function pintarBoton() {
  const b = $('#abrir-carrito'); if (!b) return;
  const n = leer().reduce((s, x) => s + x.cantidad, 0);
  b.hidden = !puedePedir(); $('#carrito-n').textContent = n;
}
let volverFoco = null;
function abrirCarrito() {
  volverFoco = document.activeElement;
  const c = $('#carrito'); c.hidden = false; pintarCarrito();
  requestAnimationFrame(() => c.classList.add('abierto'));
  $('#cerrar-carrito').focus();
}
function cerrarCarrito() {
  const c = $('#carrito'); c.classList.remove('abierto'); c.hidden = true;
  volverFoco?.focus?.();
}
function pintarCarrito(listo) {
  const cuerpo = $('#carrito-cuerpo');
  if (listo) {
    cuerpo.replaceChildren(h('div', { class: 'carrito-listo', role: 'status' }, h('h3', {}, `Pedido ${listo.numero} enviado`),
      h('p', {}, `Total ${dinero(listo.total)} por ${listo.unidades} unidad(es). Tu vendedor de zona y la gerencia ya recibieron el aviso; te notificaremos cada cambio de estado.`),
      h('a', { class: 'boton-marino', href: `panel.html#pedidos?id=${listo.id}` }, 'Ver en Mis pedidos')));
    return;
  }
  const items = leer();
  if (!items.length) { cuerpo.replaceChildren(h('p', { class: 'estado' }, 'Tu pedido está vacío. Agrega productos desde la tienda.'), h('a', { class: 'boton-borde', href: 'tienda.html' }, 'Ir a la tienda')); return; }
  const total = items.reduce((s, x) => s + (x.precio ?? 0) * x.cantidad, 0);
  const lista = h('ul', { class: 'carrito-lista' }, items.map((x) => h('li', {},
    x.imagen ? h('img', { src: img(x.imagen), alt: '', width: 64, height: 64, loading: 'lazy' }) : h('span', { class: 'sin-foto', 'aria-hidden': 'true' }),
    h('div', {}, h('p', { class: 'n' }, x.nombre), x.presentacion ? h('p', { class: 'p' }, x.presentacion) : null, h('p', { class: 'p' }, x.precio != null ? `${dinero(x.precio)} c/u` : '')),
    h('div', { class: 'cant' },
      h('label', { class: 'sr-only', for: `c-${x.id}` }, `Cantidad de ${x.nombre}`),
      h('input', { id: `c-${x.id}`, type: 'number', min: 1, max: 10000, step: 1, value: x.cantidad, inputmode: 'numeric', onchange: (e) => { const v = Math.max(1, Math.min(10000, Math.round(Number(e.target.value) || 1))); guardar(leer().map((y) => (y.id === x.id ? { ...y, cantidad: v } : y))); pintarCarrito(); } }),
      h('button', { type: 'button', class: 'quitar', onclick: () => { guardar(leer().filter((y) => y.id !== x.id)); pintarCarrito(); } }, 'Quitar')))));
  const error = h('div', { class: 'error', role: 'alert', hidden: true });
  const comp = h('div', { class: 'campo-comp' }, h('label', { for: 'comprobante' }, 'Comprobante de la transferencia (opcional)'), h('input', { id: 'comprobante', name: 'comprobante', type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf' }));
  const enviar = h('button', { class: 'boton-marino', type: 'submit' }, 'Enviar pedido');
  const form = h('form', { class: 'carrito-form', novalidate: true },
    h('fieldset', {}, h('legend', {}, '¿Cómo vas a pagar?'), PAGOS.map(([v, t, ayuda], i) => h('label', { class: 'opcion-pago' }, h('input', { type: 'radio', name: 'pago', value: v, checked: i === 0 }), h('span', {}, h('strong', {}, t), h('small', {}, ayuda))))),
    comp,
    h('label', { for: 'nota' }, 'Nota para tu vendedor (opcional)'), h('textarea', { id: 'nota', name: 'nota', rows: 2, maxlength: 1000, placeholder: 'Ej.: entregar en la mañana' }),
    error, enviar);
  form.addEventListener('change', () => { comp.hidden = form.pago.value !== 'transferencia'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); error.hidden = true; enviar.disabled = true; enviar.textContent = 'Enviando…';
    try {
      let comprobante = null;
      const f = form.comprobante.files[0];
      if (f && form.pago.value === 'transferencia') {
        if (f.size > 5 * 1024 * 1024) throw new Error('El comprobante no puede pasar de 5 MB.');
        comprobante = { tipo: f.type, nombre: f.name, base64: await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(f); }) };
      }
      const { item } = await api('POST', '/api/pedidos', { items: leer().map((x) => ({ medicamentoId: x.id, cantidad: x.cantidad })), pago: form.pago.value, nota: form.nota.value, comprobante });
      guardar([]); pintarCarrito(item);
    } catch (err) {
      error.hidden = false; error.textContent = err.fields ? Object.values(err.fields).join(' ') : err.message;
      enviar.disabled = false; enviar.textContent = 'Enviar pedido';
    }
  });
  cuerpo.replaceChildren(lista, h('p', { class: 'carrito-total' }, h('span', {}, 'Total estimado'), h('strong', {}, dinero(total))),
    h('p', { class: 'nota-precio' }, 'El total final se calcula con el precio vigente del catálogo al enviar.'), form);
}
function prepararCarrito() {
  if (!$('#carrito')) return;
  $('#abrir-carrito').addEventListener('click', abrirCarrito);
  $('#cerrar-carrito').addEventListener('click', cerrarCarrito);
  $('#carrito').addEventListener('click', (e) => { if (e.target.id === 'carrito') cerrarCarrito(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#carrito').hidden) cerrarCarrito(); });
  pintarBoton();
}

// ---------------------------------------------------------------- vistas
function precioOAcceso(p) {
  if (p.precio != null) return h('p', { class: 'precio' }, dinero(p.precio));
  if (!yo) return h('p', { class: 'precio-acceso' }, h('a', { href: `entrar.html?volver=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}` }, 'Inicia sesión para ver el precio'));
  return h('p', { class: 'precio-acceso' }, 'Precio por confirmar');
}
function error(contenedor, msg, reintentar) {
  contenedor.setAttribute('aria-busy', 'false');
  contenedor.replaceChildren(h('div', { class: 'estado estado-error', role: 'alert' }, h('p', {}, msg), h('button', { class: 'boton-borde', type: 'button', onclick: reintentar }, 'Intentar de nuevo')));
}

async function vistaTienda() {
  const cont = $('#productos');
  let items;
  try { ({ items } = await api('GET', '/api/tienda/productos')); } catch { return error(cont, 'No pudimos cargar los productos. Revisa tu conexión.', vistaTienda); }
  cont.setAttribute('aria-busy', 'false');
  if (!items.length) { cont.replaceChildren(h('p', { class: 'estado' }, 'Pronto publicaremos aquí los productos de FERSUAZ.')); return; }
  const tarjeta = (p) => h('article', { class: 'tarjeta-prod' },
    h('a', { class: 'foto', href: `producto.html?id=${p.id}`, tabindex: -1, 'aria-hidden': 'true' }, p.imagenes[0] ? h('img', { src: img(p.imagenes[0].url), alt: '', loading: 'lazy', width: 480, height: 480 }) : h('span', { class: 'sin-foto' })),
    h('div', { class: 'texto' }, p.linea ? h('p', { class: 'linea' }, p.linea) : null, h('h2', {}, h('a', { href: `producto.html?id=${p.id}` }, p.nombre)), p.presentacion ? h('p', { class: 'pres' }, p.presentacion) : null, precioOAcceso(p)));
  const pintar = (q = '') => {
    const t = q.trim().toLowerCase();
    const vis = items.filter((p) => !t || `${p.nombre} ${p.presentacion ?? ''} ${p.linea ?? ''}`.toLowerCase().includes(t));
    cont.replaceChildren(...(vis.length ? vis.map(tarjeta) : [h('p', { class: 'estado' }, `Ningún producto coincide con "${q}".`)]));
  };
  if (items.length > 6) { $('#filtro').hidden = false; $('#buscar').addEventListener('input', (e) => pintar(e.target.value)); }
  pintar();
}

function galeria(p) {
  const fotos = p.imagenes.length ? p.imagenes : [{ url: null, nombre: p.nombre }];
  let i = 0;
  const grande = h('img', { alt: '', width: 900, height: 900 });
  const contador = h('p', { class: 'contador', 'aria-live': 'polite' });
  const miniaturas = fotos.length > 1 ? h('div', { class: 'miniaturas', role: 'group', 'aria-label': 'Fotos del producto' }, fotos.map((f, k) => h('button', { type: 'button', 'aria-label': `Foto ${k + 1} de ${fotos.length}`, onclick: () => ir(k) }, h('img', { src: img(f.url), alt: '', width: 96, height: 96, loading: 'lazy' })))) : null;
  function ir(k) {
    i = (k + fotos.length) % fotos.length;
    if (fotos[i].url) { grande.src = img(fotos[i].url); grande.alt = `${p.nombre}, foto ${i + 1} de ${fotos.length}`; }
    contador.textContent = `${i + 1} / ${fotos.length}`;
    miniaturas?.querySelectorAll('button').forEach((b, k2) => b.setAttribute('aria-current', k2 === i ? 'true' : 'false'));
  }
  const flecha = (dir, etq, d) => h('button', { type: 'button', class: `flecha ${dir}`, 'aria-label': etq, onclick: () => ir(i + d) }, h('span', { 'aria-hidden': 'true' }, d < 0 ? '‹' : '›'));
  const marco = h('div', { class: 'marco', tabindex: fotos.length > 1 ? 0 : null, 'aria-label': fotos.length > 1 ? 'Galería: usa las flechas del teclado para cambiar de foto' : null,
    onkeydown: (e) => { if (e.key === 'ArrowLeft') ir(i - 1); if (e.key === 'ArrowRight') ir(i + 1); } },
  fotos[0].url ? grande : h('span', { class: 'sin-foto' }), fotos.length > 1 ? [flecha('izq', 'Foto anterior', -1), flecha('der', 'Foto siguiente', 1), contador] : null);
  // Deslizar con el dedo en el celular
  let x0 = null;
  marco.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  marco.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 40) ir(i + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  ir(0);
  return h('div', { class: 'galeria' }, marco, miniaturas);
}

async function vistaProducto() {
  const cont = $('#ficha');
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { cont.setAttribute('aria-busy', 'false'); cont.replaceChildren(h('div', { class: 'estado' }, h('p', {}, 'Ese producto no existe.'), h('a', { class: 'boton-borde', href: 'tienda.html' }, 'Volver a la tienda'))); return; }
  let p;
  try { ({ item: p } = await api('GET', `/api/tienda/productos/${encodeURIComponent(id)}`)); } catch (e) {
    if (e.status === 404) { cont.setAttribute('aria-busy', 'false'); cont.replaceChildren(h('div', { class: 'estado' }, h('p', {}, 'Ese producto ya no está en la tienda.'), h('a', { class: 'boton-borde', href: 'tienda.html' }, 'Volver a la tienda'))); return; }
    return error(cont, 'No pudimos cargar el producto. Revisa tu conexión.', vistaProducto);
  }
  document.title = `${p.nombre}, tienda FERSUAZ`;
  $('#miga-nombre').textContent = p.nombre;
  let accion = null;
  if (puedePedir() && p.precio != null) {
    const cant = h('input', { id: 'cantidad', type: 'number', min: 1, max: 10000, step: 1, value: 1, inputmode: 'numeric' });
    const cambiar = (d) => { cant.value = Math.max(1, Math.min(10000, (Math.round(Number(cant.value)) || 1) + d)); };
    const listo = h('p', { class: 'agregado', role: 'status' });
    accion = h('div', { class: 'comprar' },
      h('div', { class: 'stepper' }, h('label', { class: 'sr-only', for: 'cantidad' }, 'Cantidad'),
        h('button', { type: 'button', 'aria-label': 'Una menos', onclick: () => cambiar(-1) }, '−'), cant, h('button', { type: 'button', 'aria-label': 'Una más', onclick: () => cambiar(1) }, '+')),
      h('button', { class: 'boton-marino', type: 'button', onclick: () => { const n = Math.max(1, Math.min(10000, Math.round(Number(cant.value)) || 1)); agregar(p, n); listo.textContent = `Agregado: ${n} × ${p.nombre}.`; } }, 'Agregar al pedido'),
      listo);
  } else if (yo && !puedePedir()) accion = h('p', { class: 'nota-precio' }, 'Los pedidos los hace la dependiente con la cuenta de su farmacia.');
  cont.setAttribute('aria-busy', 'false');
  cont.replaceChildren(galeria(p), h('div', { class: 'ficha-texto' },
    h('p', { class: 'producto-marca' }, p.linea || 'Laboratorio FERSUAZ'),
    h('h1', {}, p.nombre), p.presentacion ? h('p', { class: 'producto-tipo' }, p.presentacion) : null,
    precioOAcceso(p), accion,
    p.ficha.length ? h('dl', { class: 'producto-datos' }, p.ficha.map((x) => h('div', {}, h('dt', {}, x.dato), h('dd', {}, x.valor)))) : null,
    p.descripcion ? h('div', { class: 'descripcion' }, p.descripcion.split(/\n{2,}/).map((t) => h('p', {}, t))) : null,
    h('p', { class: 'producto-aviso' }, 'Lea el prospecto y consulte a su médico.')));
}

await sesion();
avisoSesion();
prepararCarrito();
if ($('#productos')) vistaTienda();
if ($('#ficha')) vistaProducto();

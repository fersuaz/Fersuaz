/**
 * Visor de fotos en la misma pestaña: acercar, alejar, mover, girar.
 * Rueda del ratón o pellizco para acercar; arrastrar para mover; doble clic alterna 1× y 2.5×.
 * Teclado: + y − acercan y alejan, 0 ajusta, R gira, flechas mueven, Esc cierra.
 */
const MIN = 1; const MAX = 8;
let dlg; let img; let marco; let pdf; let titulo; let nivel; let btnMenos; let btnMas; let btnAnt; let btnSig; let posicion; let detalle;
let galeria = []; let actual = 0; let turno = 0; let alCerrar = null; let etiquetas; let acciones; let panel; let conPanel = null;
let z = 1; let x = 0; let y = 0; let giro = 0;
const punteros = new Map(); let pellizco = null; let arrastre = null;

function crear() {
  dlg = document.createElement('dialog');
  dlg.className = 'visor';
  dlg.setAttribute('aria-label', 'Ver foto');
  dlg.innerHTML = `
    <div class="visor-barra">
      <div class="visor-info"><strong class="visor-titulo"></strong><span class="visor-detalle"></span></div>
      <div class="visor-nav" role="group" aria-label="Fotos">
        <button type="button" data-a="ant" aria-label="Foto anterior">‹ Anterior</button>
        <span class="visor-pos" aria-live="polite"></span>
        <button type="button" data-a="sig" aria-label="Foto siguiente">Siguiente ›</button>
      </div>
      <div class="visor-ctrl" role="group" aria-label="Zoom">
        <button type="button" data-a="menos" aria-label="Alejar">−</button>
        <span class="visor-nivel" aria-live="polite">100%</span>
        <button type="button" data-a="mas" aria-label="Acercar">+</button>
        <button type="button" data-a="ajustar">Ajustar</button>
        <button type="button" data-a="girar" aria-label="Girar la foto">Girar</button>
        <button type="button" data-a="cerrar" class="visor-cerrar">Cerrar</button>
      </div>
    </div>
    <div class="visor-cuerpo">
      <div class="visor-marco" tabindex="0" aria-label="Foto. Usa + y − para acercar o alejar, y las flechas para moverla."><img alt="" draggable="false"></div>
      <iframe class="visor-pdf" title="Documento" hidden></iframe>
      <aside class="visor-etiquetas" aria-label="Lo que cargó el usuario" hidden></aside>
      <section class="visor-panel" aria-label="Datos de esta foto" hidden></section>
    </div>
    <div class="visor-pie">
      <div class="visor-acciones" hidden></div>
      <p class="visor-ayuda">Rueda o pellizco para acercar. Arrastra para mover. Doble clic para acercar o volver. Flechas ← → para pasar de foto (cuando no estás escribiendo en un campo).</p>
    </div>`;
  document.body.append(dlg);
  img = dlg.querySelector('img'); marco = dlg.querySelector('.visor-marco'); pdf = dlg.querySelector('.visor-pdf');
  titulo = dlg.querySelector('.visor-titulo'); nivel = dlg.querySelector('.visor-nivel');
  btnMenos = dlg.querySelector('[data-a=menos]'); btnMas = dlg.querySelector('[data-a=mas]');
  btnAnt = dlg.querySelector('[data-a=ant]'); btnSig = dlg.querySelector('[data-a=sig]');
  posicion = dlg.querySelector('.visor-pos'); detalle = dlg.querySelector('.visor-detalle');
  etiquetas = dlg.querySelector('.visor-etiquetas'); acciones = dlg.querySelector('.visor-acciones'); panel = dlg.querySelector('.visor-panel');
  dlg.querySelector('.visor-nav').addEventListener('click', (e) => { const a = e.target.closest('button')?.dataset.a; if (a === 'ant') ir(actual - 1); else if (a === 'sig') ir(actual + 1); });

  dlg.querySelector('.visor-ctrl').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'mas') zoomEn(z * 1.5); else if (a === 'menos') zoomEn(z / 1.5);
    else if (a === 'ajustar') reiniciar(); else if (a === 'girar') { giro = (giro + 90) % 360; x = 0; y = 0; pintar(); }
    else if (a === 'cerrar') dlg.close();
  });
  // clic en el fondo oscuro (fuera de la foto) cierra
  marco.addEventListener('click', (e) => { if (e.target === marco && z === 1 && !movio) dlg.close(); });
  dlg.addEventListener('close', () => { img.removeAttribute('src'); pdf.removeAttribute('src'); document.body.classList.remove('visor-abierto'); soltarPanel(); galeria = []; const f = alCerrar; alCerrar = null; f?.(); });

  marco.addEventListener('wheel', (e) => { e.preventDefault(); zoomEn(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
  marco.addEventListener('dblclick', (e) => { if (z > 1) reiniciar(); else zoomEn(2.5, e.clientX, e.clientY); });
  marco.addEventListener('pointerdown', (e) => {
    marco.setPointerCapture(e.pointerId); punteros.set(e.pointerId, { x: e.clientX, y: e.clientY }); movio = false;
    if (punteros.size === 2) { const [a, b] = [...punteros.values()]; pellizco = { d: Math.hypot(a.x - b.x, a.y - b.y), z }; arrastre = null; }
    else arrastre = { px: e.clientX, py: e.clientY, x, y };
  });
  marco.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId)) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pellizco && punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      zoomEn(pellizco.z * (Math.hypot(a.x - b.x, a.y - b.y) / pellizco.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (arrastre && z > 1) {
      const dx = e.clientX - arrastre.px; const dy = e.clientY - arrastre.py;
      if (Math.abs(dx) + Math.abs(dy) > 3) movio = true;
      x = arrastre.x + dx; y = arrastre.y + dy; limitar(); pintar();
    }
  });
  const soltar = (e) => { punteros.delete(e.pointerId); if (punteros.size < 2) pellizco = null; if (!punteros.size) arrastre = null; };
  marco.addEventListener('pointerup', soltar); marco.addEventListener('pointercancel', soltar);
  // En todo el documento: si el foco se pierde (un botón que se deshabilita o se reemplaza), las flechas siguen funcionando.
  document.addEventListener('keydown', (e) => {
    if (!dlg.open || e.defaultPrevented) return;
    if ([...document.querySelectorAll('dialog[open]')].some((d) => d !== dlg)) return; // hay una confirmación encima
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return;
    if (!dlg.contains(document.activeElement)) marco.focus({ preventScroll: true });
    const paso = 60;
    // Sin zoom, las flechas izquierda y derecha pasan de foto; con zoom, mueven la foto. AvPág/RePág siempre pasan.
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && z === 1)) { e.preventDefault(); ir(actual + 1); return; }
    if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && z === 1)) { e.preventDefault(); ir(actual - 1); return; }
    const k = { '+': () => zoomEn(z * 1.5), '=': () => zoomEn(z * 1.5), '-': () => zoomEn(z / 1.5), '0': reiniciar, r: () => { giro = (giro + 90) % 360; pintar(); },
      ArrowLeft: () => mover(paso, 0), ArrowRight: () => mover(-paso, 0), ArrowUp: () => mover(0, paso), ArrowDown: () => mover(0, -paso) }[e.key];
    if (k) { e.preventDefault(); k(); }
  });
}
let movio = false;
function mover(dx, dy) { if (z <= 1) return; x += dx; y += dy; limitar(); pintar(); }
function limitar() {
  const r = marco.getBoundingClientRect();
  const mx = (r.width * (z - 1)) / 2 + r.width * 0.25; const my = (r.height * (z - 1)) / 2 + r.height * 0.25;
  x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
}
function zoomEn(nz, cx, cy) {
  nz = Math.max(MIN, Math.min(MAX, nz));
  const r = marco.getBoundingClientRect();
  // acerca hacia el punto del cursor o los dedos
  const px = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2); const py = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2);
  x = px - ((px - x) * nz) / z; y = py - ((py - y) * nz) / z; z = nz;
  if (z === 1) { x = 0; y = 0; }
  limitar(); pintar();
}
function reiniciar() { z = 1; x = 0; y = 0; pintar(); }
function pintar() {
  img.style.transform = `translate(${x}px, ${y}px) scale(${z}) rotate(${giro}deg)`;
  nivel.textContent = `${Math.round(z * 100)}%`;
  btnMenos.disabled = z <= MIN; btnMas.disabled = z >= MAX;
  marco.classList.toggle('acercado', z > 1);
}

/** Muestra la foto número i de la galería. Cada elemento: { url } o { cargar: async () => ({ url, tipo }) }, nombre, tipo, detalle. */
async function ir(i) {
  if (i < 0 || i >= galeria.length) return;
  actual = i; const g = galeria[i]; const yo = ++turno;
  marco.querySelector('.visor-error')?.remove();
  z = 1; x = 0; y = 0; giro = 0;
  titulo.textContent = g.nombre ?? 'Foto';
  detalle.textContent = (typeof g.detalle === 'function' ? g.detalle() : g.detalle) ?? '';
  posicion.textContent = galeria.length > 1 ? `${i + 1} de ${galeria.length}` : '';
  dlg.querySelector('.visor-nav').hidden = galeria.length < 2;
  btnAnt.disabled = i === 0; btnSig.disabled = i === galeria.length - 1;
  pintarEtiquetas(g); pintarAcciones(g); ponerPanel(g);
  let { url, tipo } = g;
  if (!url && g.cargar) {
    img.removeAttribute('src'); titulo.textContent = `${g.nombre ?? 'Foto'} (cargando…)`;
    let error = null;
    for (const intento of [g.precarga, null, null]) { // la precarga, y dos intentos más si falla
      try { const r = await (intento ?? g.cargar()); if (r?.url) { ({ url, tipo } = r); error = null; break; } } catch (e) { error = e; }
      if (yo !== turno) return;
    }
    g.precarga = null;
    if (!url) { if (yo === turno) mostrarError(g, error); return; }
    if (yo !== turno) return; // ya pasó a otra
    Object.assign(g, { url, tipo }); titulo.textContent = g.nombre ?? 'Foto';
  }
  const esPdf = /pdf/i.test(tipo ?? '');
  marco.hidden = esPdf; pdf.hidden = !esPdf;
  dlg.querySelector('.visor-ctrl').querySelectorAll('[data-a]:not([data-a=cerrar])').forEach((b) => { b.hidden = esPdf; });
  nivel.hidden = esPdf; dlg.querySelector('.visor-ayuda').hidden = esPdf;
  if (esPdf) { img.removeAttribute('src'); pdf.src = url; } else { pdf.removeAttribute('src'); img.src = url; img.alt = g.nombre ?? 'Foto'; pintar(); }
  // la siguiente se va preparando para que pasar sea inmediato
  const sig = galeria[i + 1]; if (sig && !sig.url && sig.cargar && !sig.precarga) sig.precarga = sig.cargar().then((r) => Object.assign(sig, r)).catch(() => {});
}

/**
 * Panel para editar junto a la foto (por ejemplo, medicamentos y médico de un voucher que se está cargando).
 * g.panel = { nodo: () => elemento, devolver: () => void }: el elemento se presta al visor y se devuelve al pasar de foto o cerrar.
 */
function soltarPanel() { if (conPanel) { conPanel.panel.devolver(); conPanel = null; } panel.replaceChildren(); }
function ponerPanel(g) {
  soltarPanel();
  dlg.classList.toggle('con-panel', Boolean(g.panel));
  panel.hidden = !g.panel;
  if (!g.panel) return;
  panel.append(g.panel.nodo()); conPanel = g;
  panel.oninput = panel.onchange = () => { detalle.textContent = (typeof g.detalle === 'function' ? g.detalle() : g.detalle) ?? ''; };
}

/** La foto no se pudo traer: se dice por qué y se puede reintentar sin cerrar. */
function mostrarError(g, error) {
  titulo.textContent = g.nombre ?? 'Foto';
  pdf.hidden = true; marco.hidden = false; img.removeAttribute('src');
  marco.querySelector('.visor-error')?.remove();
  const caja = nodo('div', 'visor-error');
  caja.append(nodo('strong', null, 'No se pudo abrir esta foto'), nodo('span', null, error?.message || 'Revisa tu conexión e inténtalo otra vez.'));
  const b = nodo('button', 'visor-accion ok', 'Reintentar'); b.type = 'button';
  b.addEventListener('click', () => { caja.remove(); ir(actual); });
  caja.append(b); marco.append(caja);
}
const nodo = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
/** Etiqueta encima de la foto con lo que escribió el usuario: así se compara sin salir de la foto. */
function pintarEtiquetas(g) {
  const et = typeof g.etiquetas === 'function' ? g.etiquetas() : g.etiquetas;
  etiquetas.replaceChildren();
  etiquetas.hidden = !et?.lineas?.length && !et?.titulo;
  if (etiquetas.hidden) return;
  if (et.titulo) etiquetas.append(nodo('strong', 'visor-et-tit', et.titulo));
  const ul = nodo('ul', 'visor-et-lista');
  for (const l of et.lineas ?? []) { const li = nodo('li'); li.append(nodo('span', 'visor-et-med', l.texto)); if (l.extra) li.append(nodo('span', 'visor-et-extra', l.extra)); ul.append(li); }
  etiquetas.append(ul);
  for (const x of et.notas ?? []) etiquetas.append(nodo('small', 'visor-et-nota', x));
  if (et.total) etiquetas.append(nodo('p', 'visor-et-total', et.total));
}
/** Botones de decisión (aprobar, rechazar) sobre la foto. Al terminar, pasa sola a la siguiente pendiente. */
function pintarAcciones(g) {
  acciones.replaceChildren();
  acciones.hidden = !g.acciones?.length;
  if (acciones.hidden) return;
  if (g.hecho) { acciones.append(nodo('span', 'visor-hecho', g.hecho)); return; }
  for (const a of g.acciones) {
    const b = nodo('button', `visor-accion ${a.clase ?? ''}`, a.texto); b.type = 'button';
    b.addEventListener('click', async () => {
      acciones.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      let r = null;
      try { r = await a.accion(); } finally { acciones.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
      if (!r) return; // cancelado o con error: se queda en esta foto
      g.hecho = r; pintarAcciones(g);
      const sig = galeria.findIndex((x, j) => j > actual && !x.hecho && x.acciones?.length);
      const otra = sig >= 0 ? sig : galeria.findIndex((x) => !x.hecho && x.acciones?.length);
      if (otra >= 0) setTimeout(() => ir(otra), 450);
    });
    acciones.append(b);
  }
}

/** Abre varias fotos encima de la página: se pasa de una a otra sin cerrar. */
export function verGaleria(items, indice = 0, { onClose = null } = {}) {
  if (!dlg) crear();
  alCerrar = onClose;
  galeria = items.map((x) => ({ ...x }));
  document.body.classList.add('visor-abierto');
  if (!dlg.open) dlg.showModal();
  ir(Math.max(0, Math.min(indice, galeria.length - 1)));
  marco.focus();
}

/** Abre una foto (o un PDF) encima de la página, sin salir de ella. */
export function verImagen(url, { nombre = 'Foto', tipo = '', detalle = '' } = {}) {
  verGaleria([{ url, nombre, tipo, detalle }], 0);
}

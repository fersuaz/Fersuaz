/**
 * Desplegables con buscador.
 * Todo <select> con muchas opciones se muestra como un botón que abre una lista con buscador.
 * El <select> original se queda en el formulario (oculto): sigue dando el valor, los eventos
 * "change" y la validación, así que el resto del código no cambia.
 */
const MINIMO = 9; // con 9 opciones o más aparece el buscador
const sinTilde = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CHEVRON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5.5 7.75 10 12.25l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LUPA = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.75" cy="8.75" r="5.25" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m12.75 12.75 3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const valorProto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const indiceProto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
let contador = 0;
let abierto = null;

function etiquetaDe(sel) {
  if (sel.labels?.[0]) return sel.labels[0].childNodes[0]?.textContent?.trim() || sel.labels[0].textContent.trim();
  return sel.getAttribute('aria-label') || '';
}

function mejorar(sel) {
  if (sel.dataset.buscador || sel.multiple || sel.size > 1) return;
  sel.dataset.buscador = '1';
  const id = `dsp-${++contador}`;
  const caja = document.createElement('div'); caja.className = 'dsp';
  const boton = document.createElement('button');
  boton.type = 'button'; boton.className = 'dsp-boton'; boton.id = `${id}-b`;
  boton.setAttribute('aria-haspopup', 'listbox'); boton.setAttribute('aria-expanded', 'false');
  boton.innerHTML = `<span class="dsp-texto"></span><span class="dsp-flecha">${CHEVRON}</span>`;
  const panel = document.createElement('div'); panel.className = 'dsp-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="dsp-buscar">${LUPA}<input type="search" autocomplete="off" spellcheck="false" placeholder="Buscar" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${id}-l"></div><ul class="dsp-lista" role="listbox" id="${id}-l"></ul><p class="dsp-vacio" hidden>Sin resultados. Prueba con otra palabra.</p>`;
  const buscar = panel.querySelector('input'); const lista = panel.querySelector('ul'); const vacio = panel.querySelector('.dsp-vacio');
  // El desplegable puede estar dentro de un <label>: sin esto, el clic en una opción lo "reenvía" al
  // control de la etiqueta y la lista se vuelve a abrir sola después de elegir.
  panel.addEventListener('click', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  sel.parentNode.insertBefore(caja, sel);
  caja.append(sel, boton, panel);
  sel.classList.add('dsp-nativo'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');

  let activo = -1; let visibles = [];
  const opciones = () => [...sel.options].filter((o) => !o.hidden);
  function pintarBoton() {
    const o = sel.options[sel.selectedIndex];
    const vacioSel = !o || o.value === '';
    boton.querySelector('.dsp-texto').textContent = o ? o.textContent : '';
    boton.classList.toggle('dsp-placeholder', vacioSel);
    boton.disabled = sel.disabled;
    const nombre = etiquetaDe(sel);
    boton.setAttribute('aria-label', `${nombre}${nombre ? ': ' : ''}${o ? o.textContent : ''}`);
    if (sel.getAttribute('aria-invalid') === 'true') boton.setAttribute('aria-invalid', 'true'); else boton.removeAttribute('aria-invalid');
    buscar.setAttribute('aria-label', `Buscar ${nombre.toLowerCase() || 'opción'}`);
  }
  function filtrar() {
    const q = sinTilde(buscar.value.trim());
    lista.replaceChildren();
    visibles = opciones().filter((o) => !(o.value === '' && q) && (!q || sinTilde(o.textContent).includes(q)));
    visibles.forEach((o, i) => {
      const li = document.createElement('li');
      li.id = `${id}-o${i}`; li.role = 'option'; li.className = 'dsp-op';
      li.setAttribute('aria-selected', String(o.selected && o.value !== ''));
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      if (o.value === '') li.classList.add('dsp-op-vacia');
      // resalta lo que coincide
      const t = o.textContent; const k = q ? sinTilde(t).indexOf(q) : -1;
      if (k >= 0) li.append(t.slice(0, k), Object.assign(document.createElement('mark'), { textContent: t.slice(k, k + q.length) }), t.slice(k + q.length));
      else li.textContent = t;
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => elegir(o));
      li.addEventListener('mousemove', () => marcar(i, false));
      lista.append(li);
    });
    vacio.hidden = visibles.length > 0;
    const actual = visibles.findIndex((o) => o.selected && o.value !== '');
    marcar(actual >= 0 ? actual : (visibles[0]?.value === '' && visibles.length > 1 ? 1 : 0), true);
  }
  function marcar(i, desplazar) {
    lista.querySelector('.dsp-activa')?.classList.remove('dsp-activa');
    activo = Math.max(0, Math.min(i, visibles.length - 1));
    const li = lista.children[activo];
    if (!li) { buscar.removeAttribute('aria-activedescendant'); return; }
    li.classList.add('dsp-activa'); buscar.setAttribute('aria-activedescendant', li.id);
    if (desplazar) li.scrollIntoView({ block: 'nearest' });
  }
  function elegir(o) {
    if (!o || o.disabled) return;
    const cambio = sel.value !== o.value;
    valorProto.set.call(sel, o.value);
    pintarBoton(); cerrar(true);
    if (cambio) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function abrir() {
    if (sel.disabled) return;
    if (abierto && abierto !== cerrar) abierto(false);
    abierto = cerrar;
    panel.hidden = false; caja.classList.add('dsp-abierto'); boton.setAttribute('aria-expanded', 'true');
    // abre hacia arriba si no cabe abajo (dentro de la caja con desplazamiento que lo contiene, o de la ventana)
    const r = boton.getBoundingClientRect();
    const cont = caja.closest('.visor-panel');
    const lim = cont ? cont.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    // dentro del visor siempre abre hacia abajo: la caja de datos se desplaza para mostrar la lista entera
    caja.classList.toggle('dsp-arriba', !cont && lim.bottom - r.bottom < 300 && r.top - lim.top > lim.bottom - r.bottom);
    buscar.value = ''; filtrar(); buscar.focus({ preventScroll: true });
    if (cont) requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest' }));
  }
  function cerrar(devolverFoco) {
    if (panel.hidden) return;
    panel.hidden = true; caja.classList.remove('dsp-abierto', 'dsp-arriba'); boton.setAttribute('aria-expanded', 'false');
    if (abierto === cerrar) abierto = null;
    if (devolverFoco) boton.focus();
  }
  boton.addEventListener('click', () => (panel.hidden ? abrir() : cerrar(true)));
  boton.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); return; }
    // empezar a escribir abre la búsqueda con esa letra
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); abrir(); buscar.value = e.key; filtrar(); }
  });
  buscar.addEventListener('input', filtrar);
  buscar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(activo + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(activo - 1, true); }
    else if (e.key === 'Home' && !buscar.value) { e.preventDefault(); marcar(0, true); }
    else if (e.key === 'End' && !buscar.value) { e.preventDefault(); marcar(visibles.length - 1, true); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(visibles[activo]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (e.key === 'Tab') cerrar(false);
  });
  caja.addEventListener('focusout', (e) => { if (!caja.contains(e.relatedTarget)) cerrar(false); });
  // el foco que llega al select (clic en su etiqueta, o error de validación) pasa al botón
  sel.addEventListener('focus', () => boton.focus());
  sel.addEventListener('change', pintarBoton);
  // si el código cambia el valor o el índice directamente, el botón se actualiza igual
  Object.defineProperty(sel, 'value', { configurable: true, get() { return valorProto.get.call(this); }, set(v) { valorProto.set.call(this, v); pintarBoton(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indiceProto.get.call(this); }, set(v) { indiceProto.set.call(this, v); pintarBoton(); } });
  new MutationObserver(() => { pintarBoton(); if (!panel.hidden) filtrar(); })
    .observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-invalid', 'selected'] });
  pintarBoton();
}

function revisar(raiz) {
  if (raiz.querySelectorAll) for (const g of [...(raiz.matches?.('.provincias') ? [raiz] : []), ...raiz.querySelectorAll('.provincias')]) filtroCasillas(g);
  const lista = raiz.matches?.('select') ? [raiz] : raiz.querySelectorAll?.('select') ?? [];
  for (const s of lista) {
    if (s.dataset.buscador || s.closest('[data-sin-buscador]')) continue;
    if (s.options.length >= MINIMO) mejorar(s);
    else if (!s.dataset.vigilado) { // un select corto que luego se llena (municipios) también recibe buscador
      s.dataset.vigilado = '1';
      const mo = new MutationObserver(() => { if (s.options.length >= MINIMO) { mo.disconnect(); mejorar(s); } });
      mo.observe(s, { childList: true });
    }
  }
}

/** Listas largas de casillas (por ejemplo, provincias): un buscador arriba que filtra las opciones. */
function filtroCasillas(grupo) {
  if (grupo.dataset.buscador) return;
  const opciones = [...grupo.children].filter((x) => (x.tagName === 'LABEL' || x.classList.contains('prov-item')) && x.querySelector('input[type=checkbox]'));
  const textoDe = (l) => l.dataset.prov ?? l.textContent;
  if (opciones.length < 12) return;
  grupo.dataset.buscador = '1';
  const caja = document.createElement('div'); caja.className = 'dsp-buscar dsp-buscar-casillas';
  caja.innerHTML = `${LUPA}<input type="search" autocomplete="off" spellcheck="false" placeholder="Buscar en la lista">`;
  const input = caja.querySelector('input');
  const nombre = grupo.closest('fieldset')?.querySelector('legend')?.textContent?.trim() || grupo.previousElementSibling?.textContent?.trim() || 'la lista';
  input.setAttribute('aria-label', `Buscar en ${nombre.toLowerCase()}`);
  const vacio = document.createElement('p'); vacio.className = 'dsp-vacio'; vacio.hidden = true; vacio.textContent = 'Sin resultados. Prueba con otra palabra.';
  const contar = document.createElement('p'); contar.className = 'dsp-contar'; contar.setAttribute('aria-live', 'polite');
  const marcadas = () => { const n = opciones.filter((l) => l.querySelector('input').checked).length; contar.textContent = n ? `${n} marcada(s)` : ''; };
  grupo.before(caja); grupo.after(vacio); caja.append(contar);
  input.addEventListener('input', () => {
    const q = sinTilde(input.value.trim()); let n = 0;
    for (const l of opciones) { const ok = !q || sinTilde(textoDe(l)).includes(q); l.hidden = !ok; n += ok; }
    vacio.hidden = n > 0;
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = opciones.filter((l) => !l.hidden); if (v.length === 1) { v[0].querySelector('input').click(); input.select(); } } });
  grupo.addEventListener('change', marcadas); marcadas();
}

/** Activa los desplegables con buscador en la página, incluidos los que se agreguen después. */
export function activarDesplegables(raiz = document.body) {
  revisar(raiz);
  new MutationObserver((cambios) => {
    for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) revisar(n);
  }).observe(raiz, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (e) => { if (abierto && !e.target.closest('.dsp-abierto')) abierto(false); });
}

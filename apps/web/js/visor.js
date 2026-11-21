/**
 * Visor de fotos en la misma pestaña: acercar, alejar, mover, girar.
 * Rueda del ratón o pellizco para acercar; arrastrar para mover; doble clic alterna 1× y 2.5×.
 * Teclado: + y − acercan y alejan, 0 ajusta, R gira, flechas mueven, Esc cierra.
 */
const MIN = 1; const MAX = 8;
let dlg; let img; let marco; let pdf; let titulo; let nivel; let btnMenos; let btnMas;
let z = 1; let x = 0; let y = 0; let giro = 0;
const punteros = new Map(); let pellizco = null; let arrastre = null;

function crear() {
  dlg = document.createElement('dialog');
  dlg.className = 'visor';
  dlg.setAttribute('aria-label', 'Ver foto');
  dlg.innerHTML = `
    <div class="visor-barra">
      <strong class="visor-titulo"></strong>
      <div class="visor-ctrl" role="group" aria-label="Zoom">
        <button type="button" data-a="menos" aria-label="Alejar">−</button>
        <span class="visor-nivel" aria-live="polite">100%</span>
        <button type="button" data-a="mas" aria-label="Acercar">+</button>
        <button type="button" data-a="ajustar">Ajustar</button>
        <button type="button" data-a="girar" aria-label="Girar la foto">Girar</button>
        <button type="button" data-a="cerrar" class="visor-cerrar">Cerrar</button>
      </div>
    </div>
    <div class="visor-marco" tabindex="0" aria-label="Foto. Usa + y − para acercar o alejar, y las flechas para moverla."><img alt="" draggable="false"></div>
    <iframe class="visor-pdf" title="Documento" hidden></iframe>
    <p class="visor-ayuda">Rueda o pellizco para acercar. Arrastra para mover. Doble clic para acercar o volver.</p>`;
  document.body.append(dlg);
  img = dlg.querySelector('img'); marco = dlg.querySelector('.visor-marco'); pdf = dlg.querySelector('.visor-pdf');
  titulo = dlg.querySelector('.visor-titulo'); nivel = dlg.querySelector('.visor-nivel');
  btnMenos = dlg.querySelector('[data-a=menos]'); btnMas = dlg.querySelector('[data-a=mas]');

  dlg.querySelector('.visor-ctrl').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'mas') zoomEn(z * 1.5); else if (a === 'menos') zoomEn(z / 1.5);
    else if (a === 'ajustar') reiniciar(); else if (a === 'girar') { giro = (giro + 90) % 360; x = 0; y = 0; pintar(); }
    else if (a === 'cerrar') dlg.close();
  });
  // clic en el fondo oscuro (fuera de la foto) cierra
  marco.addEventListener('click', (e) => { if (e.target === marco && z === 1 && !movio) dlg.close(); });
  dlg.addEventListener('close', () => { img.removeAttribute('src'); pdf.removeAttribute('src'); document.body.classList.remove('visor-abierto'); });

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
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
    const paso = 60;
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

/** Abre una foto (o un PDF) encima de la página, sin salir de ella. */
export function verImagen(url, { nombre = 'Foto', tipo = '' } = {}) {
  if (!dlg) crear();
  z = 1; x = 0; y = 0; giro = 0;
  titulo.textContent = nombre;
  const esPdf = /pdf/i.test(tipo);
  marco.hidden = esPdf; pdf.hidden = !esPdf;
  dlg.querySelector('.visor-ctrl').querySelectorAll('[data-a]:not([data-a=cerrar])').forEach((b) => { b.hidden = esPdf; });
  nivel.hidden = esPdf; dlg.querySelector('.visor-ayuda').hidden = esPdf;
  if (esPdf) pdf.src = url; else { img.src = url; img.alt = nombre; pintar(); }
  document.body.classList.add('visor-abierto');
  dlg.showModal();
  (esPdf ? dlg.querySelector('.visor-cerrar') : marco).focus();
}

/**
 * Números separados solos mientras se escribe, en todas las pantallas:
 * - Teléfonos: 8492522828 → 849-252-2828
 * - Cédula: 00112345678 → 001-1234567-8
 * - Montos y cantidades: 1500.5 → 1,500.5 (separador de miles)
 * El valor que lee el código (input.value) sale sin comas, así que los cálculos y el servidor no cambian.
 * Los años y los números de cuenta de banco no se agrupan.
 */
import { formatoTelefono, activarTelefono } from './campos.js';

const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

export function formatoCedula(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 11);
  return [d.slice(0, 3), d.slice(3, 10), d.slice(10, 11)].filter(Boolean).join('-');
}

/** 1234567.891 → "1,234,567.89" (con decimales hasta `dec`). Deja escribir un punto al final. */
export function formatoMiles(v, dec = 2, negativo = false) {
  let t = String(v ?? '').replace(/[^\d.-]/g, '');
  const neg = negativo && t.startsWith('-');
  t = t.replace(/-/g, '');
  const i = t.indexOf('.');
  let ent = i < 0 ? t : t.slice(0, i);
  const fr = i < 0 ? null : t.slice(i + 1).replace(/\./g, '').slice(0, dec);
  ent = ent.replace(/^0+(?=\d)/, '');
  const conComas = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${conComas}${dec > 0 && fr !== null ? `.${fr}` : ''}`;
}

/** Reaplica el formato conservando la posición del cursor (contando solo dígitos). */
function enVivo(input, formatear) {
  input.addEventListener('input', () => {
    const antes = proto.get.call(input); const pos = input.selectionStart ?? antes.length;
    const digitos = antes.slice(0, pos).replace(/[^\d.]/g, '').length;
    const nuevo = formatear(antes);
    if (nuevo === antes) return;
    proto.set.call(input, nuevo);
    let i = 0, n = 0; while (i < nuevo.length && n < digitos) { if (/[\d.]/.test(nuevo[i])) n++; i++; }
    try { input.setSelectionRange(i, i); } catch { /* algunos tipos no lo permiten */ }
  });
}

function esAnio(input) {
  const n = `${input.name} ${input.id}`.toLowerCase();
  if (/anio|año|year|mes|dia\b/.test(n)) return true;
  const min = Number(input.min); const max = Number(input.max);
  return input.min !== '' && input.max !== '' && min >= 1900 && max <= 2200;
}

function decimales(input) {
  if (input.dataset.decimales) return Number(input.dataset.decimales);
  const step = input.getAttribute('step');
  if (!step || step === 'any') return input.inputMode === 'numeric' ? 0 : 2;
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function numero(input) {
  if (input.dataset.formato || esAnio(input)) return;
  input.dataset.formato = 'miles';
  const dec = decimales(input);
  const negativo = input.min === '' || Number(input.min) < 0;
  const actual = proto.get.call(input);
  input.type = 'text';
  input.inputMode = dec > 0 ? 'decimal' : 'numeric';
  input.autocomplete = 'off';
  const f = (v) => formatoMiles(v, dec, negativo);
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return proto.get.call(this).replace(/,/g, '').replace(/\.$/, ''); },
    set(v) { proto.set.call(this, v === '' || v == null ? '' : f(v)); },
  });
  input.value = actual;
  enVivo(input, f);
  // Al salir del campo, un punto suelto al final se quita
  input.addEventListener('blur', () => { const t = proto.get.call(input); if (t.endsWith('.')) proto.set.call(input, t.slice(0, -1)); });
}

function revisar(raiz) {
  if (!raiz.querySelectorAll) return;
  const todos = [...(raiz.matches?.('input') ? [raiz] : []), ...raiz.querySelectorAll('input')];
  for (const input of todos) {
    if (input.dataset.formato || input.closest('[data-sin-formato]')) continue;
    const n = `${input.name} ${input.id}`.toLowerCase();
    if (input.type === 'tel' || input.inputMode === 'tel' || /telefono|phone|celular/.test(n)) {
      input.dataset.formato = 'telefono';
      if (proto.get.call(input)) proto.set.call(input, formatoTelefono(proto.get.call(input)));
      activarTelefono(input);
    } else if (/cedula/.test(n)) {
      input.dataset.formato = 'cedula'; input.inputMode = 'numeric'; input.maxLength = 13; input.placeholder ||= '000-0000000-0';
      enVivo(input, formatoCedula);
    } else if (input.type === 'number') numero(input);
  }
}

/** Activa el formato de números en la página, incluidos los campos que se agreguen después. */
export function activarNumeros(raiz = document.body) {
  revisar(raiz);
  new MutationObserver((cambios) => { for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) revisar(n); })
    .observe(raiz, { childList: true, subtree: true });
}

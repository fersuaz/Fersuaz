// Ayudas de escritura compartidas: teléfono dominicano con guiones y revisión de correo.
// Solo ayudan; el servidor vuelve a validar todo.

/** 8492522828 → 849-252-2828 mientras se escribe. Acepta pegar con +1, espacios o paréntesis. */
export function formatoTelefono(valor) {
  let d = String(valor ?? '').replace(/\D/g, '');
  if (d.startsWith('1')) d = d.slice(1); // código de país +1; los números dominicanos empiezan por 8
  d = d.slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join('-');
}
export function activarTelefono(input) {
  if (!input) return;
  input.setAttribute('maxlength', '12'); input.setAttribute('placeholder', '809-555-0000');
  input.addEventListener('input', () => {
    const antes = input.value; const pos = input.selectionStart ?? antes.length;
    const digitosAntes = antes.slice(0, pos).replace(/\D/g, '').length;
    input.value = formatoTelefono(antes);
    let i = 0, n = 0; while (i < input.value.length && n < digitosAntes) { if (/\d/.test(input.value[i])) n++; i++; }
    input.setSelectionRange(i, i);
  });
}

const DOMINIOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'msn.com', 'fersuaz.net', 'claro.net.do'];
function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
/** Formato válido: usuario@dominio.ext, sin espacios, sin puntos dobles ni en los extremos. */
export function correoValido(c) {
  const s = String(c ?? '').trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s) && !/\.\.|^\.|\.@|@\.|@-|-\./.test(s);
}
/** Si el dominio parece un error típico (gmial.con), devuelve el correo corregido. */
export function sugerirCorreo(c) {
  const s = String(c ?? '').trim().toLowerCase(); const at = s.lastIndexOf('@');
  if (at < 1) return null;
  const dom = s.slice(at + 1).replace(/\.(con|cm|co|om|comm|cpm|xom)$/, '.com');
  if (DOMINIOS.includes(dom)) return dom === s.slice(at + 1) ? null : `${s.slice(0, at)}@${dom}`;
  let mejor = null, d = 3;
  for (const x of DOMINIOS) { const k = distancia(dom, x); if (k < d) { d = k; mejor = x; } }
  return mejor && d <= 2 ? `${s.slice(0, at)}@${mejor}` : null;
}
/** Revisa el correo al salir del campo y ofrece la corrección con un botón. */
export function activarCorreo(input, salida) {
  if (!input || !salida) return;
  const revisar = () => {
    salida.replaceChildren();
    const v = input.value.trim(); if (!v) return;
    if (!correoValido(v)) { salida.textContent = 'Revisa el correo: debe ser como nombre@dominio.com, sin espacios.'; input.setAttribute('aria-invalid', 'true'); return; }
    input.removeAttribute('aria-invalid');
    const s = sugerirCorreo(v);
    if (s) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sugerencia'; b.textContent = `Usar ${s}`;
      b.addEventListener('click', () => { input.value = s; salida.replaceChildren(); input.focus(); });
      salida.append(`¿Quisiste decir ${s}? `, b);
    }
  };
  input.addEventListener('blur', revisar);
  input.addEventListener('input', () => { if (salida.textContent) salida.replaceChildren(); });
}

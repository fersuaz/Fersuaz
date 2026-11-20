// Períodos de pago de comisiones: quincenal (1-15 y 16-fin de mes) o mensual.
const pad = (n) => String(n).padStart(2, '0');
const finDeMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

export function esFechaISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Devuelve { clave, desde, hasta } del período que contiene la fecha. */
export function periodoDe(fecha, tipo) {
  if (!esFechaISO(fecha)) throw new Error('Fecha inválida.');
  const [y, m, d] = fecha.split('-').map(Number);
  if (tipo === 'mensual') {
    return { clave: `${y}-${pad(m)}`, desde: `${y}-${pad(m)}-01`, hasta: `${y}-${pad(m)}-${pad(finDeMes(y, m))}` };
  }
  if (tipo === 'quincenal') {
    const q = d <= 15 ? 1 : 2;
    return q === 1
      ? { clave: `${y}-${pad(m)}-Q1`, desde: `${y}-${pad(m)}-01`, hasta: `${y}-${pad(m)}-15` }
      : { clave: `${y}-${pad(m)}-Q2`, desde: `${y}-${pad(m)}-16`, hasta: `${y}-${pad(m)}-${pad(finDeMes(y, m))}` };
  }
  throw new Error('Tipo de período inválido.');
}

/** Clave de período a rango: '2026-11-Q1' | '2026-11'. */
export function rangoDe(clave) {
  const m = /^(\d{4})-(\d{2})(?:-Q([12]))?$/.exec(String(clave));
  if (!m) throw new Error('Período inválido.');
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error('Período inválido.');
  if (!m[3]) return periodoDe(`${m[1]}-${m[2]}-01`, 'mensual');
  return periodoDe(`${m[1]}-${m[2]}-${m[3] === '1' ? '01' : '16'}`, 'quincenal');
}

export function hoyRD(now = new Date()) {
  // America/Santo_Domingo es UTC-4 todo el año (sin horario de verano).
  return new Date(now.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

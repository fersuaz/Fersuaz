// Propuesta automática del cronograma del mes: reparte los lugares de la zona del representante
// en los días laborables, agrupando por municipio y por cercanía para gastar menos combustible.
// Es solo una propuesta: no guarda nada. El administrador la revisa y la aprueba.

const R = 6371; // radio de la Tierra en km
const rad = (g) => (g * Math.PI) / 180;
/** Distancia en línea recta (km) entre dos puntos { lat, lng }. Solo sirve para ordenar, no para pagar km. */
export function distanciaKm(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const conUbicacion = (x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lng);

/** Días laborables (lunes a viernes; sábado si se pide) del mes, desde `desde`, sin los excluidos. */
/**
 * Días de trabajo del mes. `dias` son los días de la semana que trabaja (0 domingo … 6 sábado);
 * por defecto, de lunes a viernes. `excluir` quita fechas (feriados, vacaciones o días ya programados).
 */
export function diasLaborables(mes, { desde, excluir = [], sabados = false, dias } = {}) {
  const semana = new Set(Array.isArray(dias) && dias.length ? dias.map(Number) : [1, 2, 3, 4, 5, ...(sabados ? [6] : [])]);
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = [];
  for (let d = 1; d <= fin; d++) {
    const f = `${mes}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (!semana.has(dow)) continue;
    if (desde && f < desde) continue;
    if (excluir.includes(f)) continue;
    out.push(f);
  }
  return out;
}

/** Ordena una lista de lugares por vecino más cercano, empezando cerca de `inicio` (si hay ubicación). */
function vecinoMasCercano(lugares, inicio) {
  const con = lugares.filter(conUbicacion); const sin = lugares.filter((x) => !conUbicacion(x));
  const orden = []; let actual = inicio && conUbicacion(inicio) ? inicio : null;
  const resto = [...con];
  while (resto.length) {
    let i = 0;
    if (actual) { let mejor = Infinity; resto.forEach((x, k) => { const d = distanciaKm(actual, x); if (d < mejor) { mejor = d; i = k; } }); }
    actual = resto.splice(i, 1)[0]; orden.push(actual);
  }
  return [...orden, ...sin.sort((a, b) => a.lugar.localeCompare(b.lugar, 'es'))];
}

/**
 * Arma la propuesta.
 * lugares: [{ refTipo, refId, lugar, provincia, municipio, lat?, lng? }]
 * residencia: { provincia, municipio } del perfil de viático (punto de partida).
 * Devuelve { dias: [{ fecha, lugares }], sinDia: [lugares que no cupieron] }.
 */
export function proponer({ lugares, residencia, fechas, porDia }) {
  const grupos = new Map();
  for (const l of lugares) { const k = `${l.provincia}|${l.municipio}`; grupos.set(k, [...(grupos.get(k) ?? []), l]); }
  const centro = (xs) => { const c = xs.filter(conUbicacion); return c.length ? { lat: c.reduce((s, x) => s + x.lat, 0) / c.length, lng: c.reduce((s, x) => s + x.lng, 0) / c.length } : null; };
  const lista = [...grupos.entries()].map(([k, xs]) => ({ k, provincia: xs[0].provincia, municipio: xs[0].municipio, xs, centro: centro(xs) }));
  // Primer municipio: el de residencia; si no tiene lugares, uno de su provincia; si no, el más grande.
  const primero = lista.find((g) => g.provincia === residencia?.provincia && g.municipio === residencia?.municipio)
    ?? lista.filter((g) => g.provincia === residencia?.provincia).sort((a, b) => b.xs.length - a.xs.length)[0]
    ?? [...lista].sort((a, b) => b.xs.length - a.xs.length || a.k.localeCompare(b.k, 'es'))[0];
  const ordenGrupos = [];
  let resto = lista.filter((g) => g !== primero); let actual = primero;
  while (actual) {
    ordenGrupos.push(actual);
    if (!resto.length) break;
    let i = 0;
    if (actual.centro) {
      let mejor = Infinity;
      resto.forEach((g, k) => { const d = g.centro ? distanciaKm(actual.centro, g.centro) : (g.provincia === actual.provincia ? 5e3 : 1e4); if (d < mejor) { mejor = d; i = k; } });
    } else {
      const misma = resto.findIndex((g) => g.provincia === actual.provincia); i = misma >= 0 ? misma : 0;
    }
    actual = resto.splice(i, 1)[0];
  }
  // Dentro de cada municipio, vecino más cercano partiendo del último lugar visitado.
  const ordenados = []; let ultimo = null;
  for (const g of ordenGrupos) { const xs = vecinoMasCercano(g.xs, ultimo ?? g.centro); ordenados.push(...xs); ultimo = [...xs].reverse().find(conUbicacion) ?? ultimo; }
  const dias = [];
  let i = 0;
  for (const fecha of fechas) {
    if (i >= ordenados.length) break;
    dias.push({ fecha, lugares: ordenados.slice(i, i + porDia) });
    i += porDia;
  }
  return { dias, sinDia: ordenados.slice(i) };
}

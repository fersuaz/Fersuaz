// Metas mensuales por posición (globales) y por representante (reemplazan la de su posición).
// - Vendedor y PVC: visitas a farmacias.
// - Visitador: visitas a farmacias y a centros de salud.
// - Promotora: recetas, medicamentos por receta, volumen recetado (RD$, precio del catálogo) y pacientes.
// Una visita cuenta solo cuando el representante la marca como hecha en su jornada.
import { AuthError as HttpError } from './auth.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const METRICAS = Object.freeze({
  visitasFarmacias: { nombre: 'Visitas a farmacias', unidad: 'visitas' },
  visitasCentros: { nombre: 'Visitas a centros de salud', unidad: 'visitas' },
  recetas: { nombre: 'Recetas', unidad: 'recetas' },
  medicamentosPorReceta: { nombre: 'Medicamentos por receta', unidad: 'promedio', decimal: true },
  volumen: { nombre: 'Volumen recetado', unidad: 'RD$', decimal: true },
  pacientes: { nombre: 'Pacientes', unidad: 'pacientes' },
});
export const METRICAS_POSICION = Object.freeze({
  Vendedor: ['visitasFarmacias'], PVC: ['visitasFarmacias'],
  Visitador: ['visitasFarmacias', 'visitasCentros'],
  Promotora: ['recetas', 'medicamentosPorReceta', 'volumen', 'pacientes'],
});

/** Valores del mes de un representante, a partir de sus jornadas (visitas hechas) y sus recetas. */
export function valoresDelMes({ jornadas = [], recetas = [], precios = new Map() }) {
  const paradas = jornadas.filter((j) => j.estado !== 'cancelada').flatMap((j) => j.paradas ?? []).filter((p) => p.hecha === true);
  const lineas = recetas.flatMap((r) => r.items ?? []);
  return {
    visitasFarmacias: paradas.filter((p) => p.refTipo === 'farmacia').length,
    visitasCentros: paradas.filter((p) => p.refTipo === 'establecimiento').length,
    recetas: recetas.length,
    medicamentosPorReceta: recetas.length ? r2(lineas.length / recetas.length) : 0,
    volumen: r2(lineas.reduce((s, l) => s + (Number(l.unidades) || 0) * (precios.get(l.medicamentoId) ?? 0), 0)),
    pacientes: new Set(recetas.map((r) => r.pacienteId).filter(Boolean)).size,
  };
}
/** Meta efectiva por métrica: la del representante, si tiene; si no, la de su posición. */
export function metaEfectiva(config, rep) {
  const claves = METRICAS_POSICION[rep.position] ?? [];
  const pos = config.porPosicion?.[rep.position] ?? {}; const pr = config.porRep?.[rep.id] ?? {};
  return Object.fromEntries(claves.map((k) => [k, pr[k] != null ? { meta: pr[k], fuente: 'representante' } : pos[k] != null ? { meta: pos[k], fuente: 'posicion' } : { meta: null, fuente: null }]));
}

export function createMetas({ data, users, audit, hoy }) {
  const activo = (u) => u?.status === 'activo';
  const GESTION = ['administrador', 'gerencia'];
  const permitir = (ok, msg = 'No tienes permiso para esto.') => { if (!ok) throw new HttpError(403, msg); };
  const invalido = (f) => { throw new HttpError(422, 'Revisa los campos marcados.', f); };

  async function leer() { const [c] = await data.list('configuracion', { clave: 'metas' }); return { fila: c ?? null, valor: c?.valor ?? { porPosicion: {}, porRep: {} } }; }
  async function escribir(actor, valor, antes, detalle) {
    const { fila } = await leer();
    if (fila) await data.update('configuracion', fila.id, { valor, actualizadoPor: actor.id }); else await data.insert('configuracion', { clave: 'metas', valor, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'metas_guardadas', entity: 'configuracion', entityId: 'metas', before: antes, after: detalle });
  }
  function limpiarValores(posicion, input = {}) {
    const e = {}; const out = {};
    for (const k of METRICAS_POSICION[posicion] ?? []) {
      const v = input[k];
      if (v === '' || v == null) continue;
      const n = Number(String(v).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 100_000_000) { e[k] = `${METRICAS[k].nombre}: escribe un número válido.`; continue; }
      if (!METRICAS[k].decimal && !Number.isInteger(n)) { e[k] = `${METRICAS[k].nombre}: debe ser un número entero.`; continue; }
      out[k] = METRICAS[k].decimal ? r2(n) : n;
    }
    if (Object.keys(e).length) invalido(e);
    return out;
  }

  async function verConfig(actor) {
    permitir(activo(actor) && [...GESTION, 'supervisor'].includes(actor.role));
    return { metricas: METRICAS, porPosicionMetricas: METRICAS_POSICION, ...(await leer()).valor };
  }
  async function guardarPosicion(actor, { posicion, valores } = {}) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia fijan metas.');
    if (!METRICAS_POSICION[posicion]) invalido({ posicion: 'Elige la posición.' });
    const limpio = limpiarValores(posicion, valores);
    const { valor } = await leer();
    const antes = valor.porPosicion?.[posicion] ?? null;
    await escribir(actor, { ...valor, porPosicion: { ...(valor.porPosicion ?? {}), [posicion]: limpio } }, antes, { posicion, valores: limpio });
    return limpio;
  }
  async function guardarRepresentante(actor, id, { valores, quitar = false } = {}) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia fijan metas.');
    const rep = await users.findUserById(String(id));
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    if (!METRICAS_POSICION[rep.position]) invalido({ valores: `La posición ${rep.position ?? ''} no tiene metas.` });
    const { valor } = await leer();
    const porRep = { ...(valor.porRep ?? {}) }; const antes = porRep[rep.id] ?? null;
    if (quitar) delete porRep[rep.id];
    else { const limpio = limpiarValores(rep.position, valores); if (Object.keys(limpio).length) porRep[rep.id] = limpio; else delete porRep[rep.id]; }
    await escribir(actor, { ...valor, porRep }, antes, { representanteId: rep.id, valores: porRep[rep.id] ?? null });
    return porRep[rep.id] ?? null;
  }

  /** Avance del mes: el representante ve el suyo; la gestión y la supervisión, el de todos. */
  async function avance(actor, { mes = hoy().slice(0, 7), representanteId } = {}) {
    permitir(activo(actor));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) invalido({ mes: 'Mes no válido.' });
    let reps;
    if (actor.role === 'representante') reps = [actor];
    else {
      permitir([...GESTION, 'supervisor', 'finanzas'].includes(actor.role));
      reps = (await users.listUsers()).filter((u) => u.role === 'representante' && u.status === 'activo' && METRICAS_POSICION[u.position] && (!representanteId || u.id === representanteId));
    }
    const { valor: config } = await leer();
    const precios = new Map((await data.list('medicamentos')).map((m) => [m.id, Number(m.precio) || 0]));
    const jornadas = (await data.list('jornadas')).filter((j) => j.fecha.startsWith(mes));
    const recetas = (await data.list('recetas')).filter((r) => String(r.fecha).startsWith(mes));
    const dias = (() => { const [y, m] = mes.split('-').map(Number); const total = new Date(Date.UTC(y, m, 0)).getUTCDate(); const h = hoy(); const trans = h.slice(0, 7) === mes ? Number(h.slice(8)) : h.slice(0, 7) > mes ? total : 0; return { total, transcurridos: trans }; })();
    const items = reps.map((rep) => {
      const val = valoresDelMes({ jornadas: jornadas.filter((j) => j.representanteId === rep.id), recetas: recetas.filter((r) => r.promotoraId === rep.id), precios });
      const metas = metaEfectiva(config, rep);
      const metricas = Object.entries(metas).map(([k, m]) => ({
        clave: k, ...METRICAS[k], meta: m.meta, fuente: m.fuente, valor: val[k],
        porcentaje: m.meta ? Math.round((val[k] / m.meta) * 100) : null,
      }));
      const conMeta = metricas.filter((m) => m.porcentaje != null);
      return { representante: { id: rep.id, nombre: rep.fullName, posicion: rep.position }, metricas, promedio: conMeta.length ? Math.round(conMeta.reduce((s, m) => s + Math.min(m.porcentaje, 100), 0) / conMeta.length) : null };
    }).sort((a, b) => (b.promedio ?? -1) - (a.promedio ?? -1) || a.representante.nombre.localeCompare(b.representante.nombre, 'es'));
    return { mes, dias, items };
  }

  return { verConfig, guardarPosicion, guardarRepresentante, avance };
}

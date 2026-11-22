// Metas mensuales por posición (globales) y por representante (reemplazan la de su posición).
// - Vendedor: visitas a farmacias.
// - Visitador y PVC (visitador y vendedor a la vez): visitas a farmacias y a centros de salud.
// Las metas de visitas son "veces al mes por lugar": la meta del mes = veces × lugares de su zona
// (por ejemplo, 2 veces × 100 farmacias = 200 visitas). También se mide cuántos lugares recibieron todas sus visitas.
// - Promotora: recetas, medicamentos por receta, volumen recetado (RD$, precio del catálogo) y pacientes.
// Una visita cuenta solo cuando el representante la marca como hecha en su jornada.
import { AuthError as HttpError } from './auth.js';
import { solapes, dentroDeZona, textoSolapes } from './territorio.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const METRICAS = Object.freeze({
  visitasFarmacias: { nombre: 'Visitas a farmacias', unidad: 'visitas', porLugar: 'farmacia', etiquetaMeta: 'Veces al mes por farmacia' },
  visitasCentros: { nombre: 'Visitas a centros de salud', unidad: 'visitas', porLugar: 'centro', etiquetaMeta: 'Veces al mes por centro de salud' },
  recetas: { nombre: 'Recetas', unidad: 'recetas' },
  medicamentosPorReceta: { nombre: 'Medicamentos por receta', unidad: 'promedio', decimal: true },
  volumen: { nombre: 'Volumen recetado', unidad: 'RD$', decimal: true },
  pacientes: { nombre: 'Pacientes', unidad: 'pacientes' },
});
export const METRICAS_POSICION = Object.freeze({
  Vendedor: ['visitasFarmacias'], PVC: ['visitasFarmacias', 'visitasCentros'],
  Visitador: ['visitasFarmacias', 'visitasCentros'],
  Promotora: ['recetas', 'medicamentosPorReceta', 'volumen', 'pacientes'],
});

/** Valores del mes de un representante, a partir de sus jornadas (visitas hechas) y sus recetas. */
/** Meta de visitas del mes: veces por lugar × lugares de la zona. Unidad de cálculo con prueba. */
export function metaVisitas(vecesPorLugar, lugares) {
  if (vecesPorLugar == null || !Number.isFinite(Number(lugares))) return null;
  return Number(vecesPorLugar) * Number(lugares);
}
/** Lugares que recibieron al menos `veces` visitas hechas en el mes. */
export function lugaresCubiertos(paradas, tipo, veces) {
  if (!veces) return 0;
  const n = new Map();
  for (const p of paradas) if (p.hecha === true && (tipo === 'farmacia' ? p.refTipo === 'farmacia' : p.refTipo === 'establecimiento')) n.set(p.refId, (n.get(p.refId) ?? 0) + 1);
  return [...n.values()].filter((x) => x >= veces).length;
}
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

  const diasDe = (mes) => { const [y, m] = mes.split('-').map(Number); const total = new Date(Date.UTC(y, m, 0)).getUTCDate(); const h = hoy(); const trans = h.slice(0, 7) === mes ? Number(h.slice(8)) : h.slice(0, 7) > mes ? total : 0; return { total, transcurridos: trans }; };
  async function calcular(reps, mes) {
    const { valor: config } = await leer();
    const precios = new Map((await data.list('medicamentos')).map((m) => [m.id, Number(m.precio) || 0]));
    const jornadas = (await data.list('jornadas')).filter((j) => j.fecha.startsWith(mes));
    const recetas = (await data.list('recetas')).filter((r) => String(r.fecha).startsWith(mes));
    const dias = diasDe(mes);
    const zonas = new Map((await data.list('zonas')).map((z) => [z.representanteId, z]));
    const vivo = (x) => !['inactivo', 'inactiva'].includes(x.estado);
    const farmacias = (await data.list('farmacias')).filter(vivo);
    const centros = (await data.list('establecimientos')).filter(vivo);
    const items = reps.map((rep) => {
      const js = jornadas.filter((j) => j.representanteId === rep.id);
      const val = valoresDelMes({ jornadas: js, recetas: recetas.filter((r) => r.promotoraId === rep.id), precios });
      const paradas = js.filter((j) => j.estado !== 'cancelada').flatMap((j) => j.paradas ?? []);
      const z = zonas.get(rep.id);
      const enZona = { farmacia: z ? farmacias.filter((x) => dentroDeZona(z, x.provincia, x.municipio)).length : 0, centro: z ? centros.filter((x) => dentroDeZona(z, x.provincia, x.municipio)).length : 0 };
      const metas = metaEfectiva(config, rep);
      const metricas = Object.entries(metas).map(([k, m]) => {
        const lugar = METRICAS[k].porLugar;
        const meta = lugar ? metaVisitas(m.meta, enZona[lugar]) : m.meta;
        return {
          clave: k, ...METRICAS[k], meta, fuente: m.fuente, valor: val[k],
          ...(lugar ? { vecesPorLugar: m.meta, lugares: enZona[lugar], cubiertos: lugaresCubiertos(paradas, lugar, m.meta) } : {}),
          porcentaje: meta ? Math.round((val[k] / meta) * 100) : null,
        };
      });
      const conMeta = metricas.filter((m) => m.porcentaje != null);
      return { representante: { id: rep.id, nombre: rep.fullName, posicion: rep.position }, metricas, promedio: conMeta.length ? Math.round(conMeta.reduce((s, m) => s + Math.min(m.porcentaje, 100), 0) / conMeta.length) : null };
    }).sort((a, b) => (b.promedio ?? -1) - (a.promedio ?? -1) || a.representante.nombre.localeCompare(b.representante.nombre, 'es'));
    return { dias, items };
  }

  /**
   * Equipos por zona: el vendedor y los visitadores, promotoras y PVC cuya zona comparte territorio con la suya.
   * Cada uno tiene su meta; juntos persiguen un objetivo: las ventas del equipo en su zona
   * (vouchers de las farmacias de la zona + ventas del laboratorio), frente a la meta de ventas del equipo.
   */
  async function equipos(actor, { mes = hoy().slice(0, 7) } = {}) {
    permitir(activo(actor));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) invalido({ mes: 'Mes no válido.' });
    if (actor.role !== 'representante') permitir([...GESTION, 'supervisor', 'finanzas'].includes(actor.role));
    const usuarios = await users.listUsers();
    const reps = usuarios.filter((u) => u.role === 'representante' && u.status === 'activo' && METRICAS_POSICION[u.position]);
    const zonas = new Map((await data.list('zonas')).map((z) => [z.representanteId, z]));
    const { dias, items } = await calcular(reps, mes);
    const avancePor = new Map(items.map((x) => [x.representante.id, x]));
    const { valor: config } = await leer();
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    const usuariosPor = new Map(usuarios.map((u) => [u.id, u]));
    const precios = new Map((await data.list('medicamentos')).map((m) => [m.id, Number(m.precio) || 0]));
    const vouchers = (await data.list('vouchers')).filter((v) => String(v.fecha).startsWith(mes) && !['rechazado', 'anulado'].includes(v.estado));
    const ventas = (await data.list('ventasFarmacia')).filter((v) => String(v.fecha).startsWith(mes));
    const recetas = (await data.list('recetas')).filter((r) => String(r.fecha).startsWith(mes));
    const enEquipo = new Set();
    const lista = reps.filter((u) => u.position === 'Vendedor' && zonas.get(u.id)?.provincias?.length).map((ven) => {
      const zv = zonas.get(ven.id);
      const miembros = reps.filter((u) => u.id !== ven.id && u.position !== 'Vendedor' && zonas.get(u.id) && solapes(zv, zonas.get(u.id)).length);
      [ven, ...miembros].forEach((u) => enEquipo.add(u.id));
      const vVouchers = r2(vouchers.reduce((s, v) => { const f = farmacias.get(usuariosPor.get(v.dependienteId)?.farmaciaId); return f && dentroDeZona(zv, f.provincia, f.municipio) ? s + Number(v.total || 0) : s; }, 0));
      const vLab = r2(ventas.filter((v) => dentroDeZona(zv, v.provincia, v.municipio)).reduce((s, v) => s + (Number(v.monto) || (Number(v.unidades) || 0) * (Number(v.precioUnitario) || 0)), 0));
      const recetado = r2(recetas.filter((r) => dentroDeZona(zv, r.provincia, r.municipio)).reduce((s, r) => s + (r.items ?? []).reduce((t, l) => t + (Number(l.unidades) || 0) * (precios.get(l.medicamentoId) ?? 0), 0), 0));
      const meta = config.porEquipo?.[ven.id] ?? config.equipoGlobal ?? null;
      const total = r2(vVouchers + vLab);
      const integrantes = [ven, ...miembros].map((u) => ({ id: u.id, nombre: u.fullName, posicion: u.position, promedio: avancePor.get(u.id)?.promedio ?? null, metricas: avancePor.get(u.id)?.metricas ?? [] }));
      const conProm = integrantes.filter((x) => x.promedio != null);
      return {
        vendedor: { id: ven.id, nombre: ven.fullName }, zona: textoSolapes(solapes(zv, zv)), integrantes,
        ventas: { vouchers: vVouchers, laboratorio: vLab, total }, recetado, meta, metaFuente: config.porEquipo?.[ven.id] != null ? 'equipo' : meta != null ? 'global' : null,
        porcentaje: meta ? Math.round((total / meta) * 100) : null,
        promedioMetas: conProm.length ? Math.round(conProm.reduce((s, x) => s + x.promedio, 0) / conProm.length) : null,
        faltan: ['Visitador', 'Promotora'].filter((pos) => !miembros.some((m) => m.position === pos)),
      };
    }).sort((a, b) => (b.porcentaje ?? -1) - (a.porcentaje ?? -1) || b.ventas.total - a.ventas.total);
    const visibles = actor.role === 'representante' ? lista.filter((e) => e.integrantes.some((x) => x.id === actor.id)) : lista;
    const sinEquipo = actor.role === 'representante' ? [] : reps.filter((u) => !enEquipo.has(u.id)).map((u) => ({ id: u.id, nombre: u.fullName, posicion: u.position, conZona: Boolean(zonas.get(u.id)?.provincias?.length) }));
    return { mes, dias, equipos: visibles, sinEquipo, equipoGlobal: config.equipoGlobal ?? null };
  }
  async function guardarMetaEquipo(actor, vendedorId, { monto } = {}) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia fijan metas.');
    const n = monto === '' || monto == null ? null : Number(String(monto).replace(/,/g, ''));
    if (n != null && (!Number.isFinite(n) || n <= 0 || n > 1e9)) invalido({ monto: 'Escribe la meta de ventas en RD$.' });
    const { valor } = await leer();
    let nuevo;
    if (vendedorId === 'global') nuevo = { ...valor, equipoGlobal: n == null ? null : r2(n) };
    else {
      const v = await users.findUserById(String(vendedorId));
      if (!v || v.role !== 'representante' || v.position !== 'Vendedor') throw new HttpError(404, 'El vendedor no existe.');
      const porEquipo = { ...(valor.porEquipo ?? {}) };
      if (n == null) delete porEquipo[v.id]; else porEquipo[v.id] = r2(n);
      nuevo = { ...valor, porEquipo };
    }
    await escribir(actor, nuevo, vendedorId === 'global' ? valor.equipoGlobal ?? null : valor.porEquipo?.[vendedorId] ?? null, { equipo: vendedorId, monto: n });
    return { monto: n };
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
    const { dias, items } = await calcular(reps, mes);
    return { mes, dias, items };
  }

  return { verConfig, guardarPosicion, guardarRepresentante, avance, equipos, guardarMetaEquipo };
}

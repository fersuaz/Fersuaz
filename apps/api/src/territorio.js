import { centrosDeMedico } from './propuesta-cronograma.js';
// Territorio: provincias y municipios oficiales, establecimientos de salud, zonas de cada representante,
// pre-registro de representantes e importación por Excel. Toda regla de permiso vive aquí, en el servidor.
import { AuthError as HttpError } from './auth.js';
import { STATUS, POSITIONS } from './roles.js';
import { DIVISION, PROVINCIAS } from './datos/division-territorial.js';
import { claveMed, codigoMed } from './medicamentos-dup.js';
import { leerHoja } from './hojas.js';
import { esFechaISO, hoyRD } from './periodos.js';
import { normalizeName } from './validation.js';

export const TIPOS_ESTABLECIMIENTO = {
  clinica: 'Clínica', hospital: 'Hospital', unap: 'UNAP', cpn: 'Centro de primer nivel', diagnostico: 'Centro diagnóstico', consultorio: 'Consultorio',
};
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Nombres comunes → nombre oficial
const ALIAS_PROV = { montecristi: 'Monte Cristi', dn: 'Distrito Nacional', 'd n': 'Distrito Nacional', 'distrito': 'Distrito Nacional', salcedo: 'Hermanas Mirabal', baoruco: 'Bahoruco', 'santiago de los caballeros': 'Santiago', 'samana': 'Samaná' };
export const ALIAS_MUN = {
  santiago: 'Santiago de los Caballeros', 'la vega': 'Concepción de La Vega', higuey: 'Salvaleón de Higüey', 'puerto plata': 'San Felipe de Puerto Plata',
  barahona: 'Santa Cruz de Barahona', 'el seibo': 'Santa Cruz de El Seibo', 'monte cristi': 'San Fernando de Monte Cristi', montecristi: 'San Fernando de Monte Cristi',
  samana: 'Santa Bárbara de Samaná', sabaneta: 'San Ignacio de Sabaneta', azua: 'Azua de Compostela', 'san juan': 'San Juan de la Maguana',
  'hato mayor': 'Hato Mayor del Rey', 'santo domingo': 'Santo Domingo de Guzmán', 'distrito nacional': 'Santo Domingo de Guzmán', 'san francisco': 'San Francisco de Macorís',
};
const PROV_POR_CLAVE = Object.fromEntries(PROVINCIAS.map((p) => [sinAcentos(p), p]));

/** Devuelve el nombre oficial de la provincia o null. */
export function provinciaOficial(v) {
  const k = sinAcentos(v); if (!k) return null;
  return PROV_POR_CLAVE[k] ?? (ALIAS_PROV[k] && PROV_POR_CLAVE[sinAcentos(ALIAS_PROV[k])]) ?? null;
}
/** Devuelve el nombre oficial del municipio dentro de la provincia, o null. */
export function municipioOficial(provincia, v) {
  const lista = DIVISION[provincia]; const k = sinAcentos(v);
  if (!lista || !k) return null;
  const directo = lista.find((m) => sinAcentos(m) === k);
  if (directo) return directo;
  const alias = ALIAS_MUN[k];
  return alias && lista.includes(alias) ? alias : null;
}
// Palabras que indican un centro de salud, y palabras de negocios que no lo son.
const SALUD = /(clinic|hospital|centro|unap|medic|salud|diagnost|consult|policlin|dental|odonto|pediatr|laborator|materno|ginec|cardio|oftalm|ortop|emergenc|especialid|sanatori|instituto|imagen|radiolog|terapia|rehabilit|dr\.?\s|dra\.?\s|doctor|enfermer|vacun|dispensari|cruz roja|dermat|neumo|nefro|oncolog|psiq|psicolog|fisiat|urolog|otorrin|endocrin|gastro|traumat|cirug|maternidad|atencion primaria|primer nivel|sonograf|mamograf|rayos|resonancia|tomograf)/;
const AJENO = /(\bspa\b|hotel|motel|restaurant|bar\b|salon|gym|gimnasio|iglesia|colegio|escuela|liceo|banco|tienda|supermercado|colmado|ferreter|bomba|estacion de|parque|hostal|villa\b|apartament|residencial|plaza\b|recovery|experience|estetica|spa\b|barber|unas|nails|veterin)/;
/** ¿El nombre parece no ser un centro de salud? (dirección en vez de nombre, negocio ajeno o sin palabra de salud) */
export function posibleError(nombre) {
  const n = String(nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!n) return true;
  if (/^\d|^(calle|c\/|av\.?|avenida|carretera|km\b|#)/.test(n) || /^[a-z0-9]{4}\+[a-z0-9]{2,3}/.test(n)) return true;
  if (AJENO.test(n)) return true;
  return !SALUD.test(`${n} `);
}

/** ¿Ese municipio está dentro de la zona? Una provincia sin lista de municipios cubre todos los suyos. */
/** El lugar fue quitado de la ruta de ese representante (aunque esté en su zona). */
export const excluidoDeRuta = (z, id) => Boolean(z?.excluidos?.includes?.(id));
export function dentroDeZona(zona, provincia, municipio) {
  if (!zona?.provincias?.includes(provincia)) return false;
  const ms = zona.municipios?.[provincia];
  return !ms?.length || ms.includes(municipio);
}
/**
 * Partes del territorio que comparten dos zonas. Un municipio vacío en una provincia significa
 * "toda la provincia". Devuelve [{ provincia, municipios: null (toda) | [comunes] }].
 */
export function solapes(a, b) {
  const r = [];
  for (const p of a?.provincias ?? []) {
    if (!(b?.provincias ?? []).includes(p)) continue;
    const ma = a.municipios?.[p]?.length ? a.municipios[p] : null;
    const mb = b.municipios?.[p]?.length ? b.municipios[p] : null;
    if (!ma && !mb) r.push({ provincia: p, municipios: null });
    else { const comunes = !ma ? mb : !mb ? ma : ma.filter((m) => mb.includes(m)); if (comunes.length) r.push({ provincia: p, municipios: comunes }); }
  }
  return r;
}
export const textoSolapes = (xs) => xs.map((x) => x.municipios ? `${x.provincia} (${x.municipios.join(', ')})` : `${x.provincia} (toda la provincia)`).join('; ');

export function tipoEstablecimiento(v) {
  const k = sinAcentos(v);
  if (TIPOS_ESTABLECIMIENTO[k]) return k;
  const e = Object.entries(TIPOS_ESTABLECIMIENTO).find(([, l]) => sinAcentos(l) === k);
  if (e) return e[0];
  if (/primer nivel|cpn/.test(k)) return 'cpn';
  if (/diagnost/.test(k)) return 'diagnostico';
  return null;
}
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const esEjemplo = (fila) => Object.values(fila).some((v) => typeof v === 'string' && /^ejemplo\b/i.test(v.trim()));
function numero(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).replace(/RD\$|\$|\s/gi, '');
  const n = Number(/,\d{1,2}$/.test(s) && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
function fechaDe(v) {
  const s = String(v ?? '').trim(); if (!s) return null;
  if (esFechaISO(s)) return s;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().slice(0, 10); }
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return esFechaISO(iso) ? iso : undefined; }
  return undefined;
}

export function createTerritorio({ data, users, audit, now = () => new Date() }) {
  const activo = (u) => u && u.status === STATUS.ACTIVO;
  const rol = (u, roles) => activo(u) && roles.includes(u.role);
  const esRep = (u) => activo(u) && u.role === 'representante';
  function permitir(cond, msg = 'No tienes permiso para esta acción.') { if (!cond) throw new HttpError(403, msg); }
  function invalido(fields) { throw new HttpError(422, 'Revisa los campos marcados.', fields); }
  const GESTION = ['administrador', 'gerencia', 'supervisor'];

  // ------------------------------------------------------------ zonas
  async function zonaDe(repId) { return (await data.list('zonas', { representanteId: repId }))[0] ?? null; }
  /** Zonas de los representantes activos de una posición (para no repetir territorio en la misma posición). */
  async function zonasDePosicion(posicion, excluirId) {
    if (!posicion) return [];
    const reps = (await users.listUsers()).filter((u) => u.role === 'representante' && u.status === 'activo' && u.position === posicion && u.id !== excluirId);
    const zonas = await data.list('zonas');
    return reps.map((u) => ({ rep: u, zona: zonas.find((z) => z.representanteId === u.id) })).filter((x) => x.zona?.provincias?.length);
  }
  /** Conflictos de una zona con otros representantes de la misma posición. Posiciones distintas sí pueden compartir. */
  async function conflictosZona(zona, posicion, excluirId) {
    const r = [];
    for (const { rep, zona: z } of await zonasDePosicion(posicion, excluirId)) {
      const xs = solapes(zona, { provincias: z.provincias, municipios: z.municipios ?? {} });
      if (xs.length) r.push({ representante: rep.fullName, representanteId: rep.id, partes: xs });
    }
    return r;
  }
  const mensajeConflicto = (cs, posicion) => `${cs.map((c) => `${c.representante} ya cubre ${textoSolapes(c.partes)}`).join('. ')}. Dos representantes de la posición ${posicion} no pueden compartir zona; con otra posición sí se puede.`;
  /** Territorio ya ocupado por una posición, para avisar en pantalla antes de guardar. */
  async function zonasOcupadas(actor, posicion, excluirId) {
    permitir(rol(actor, GESTION));
    if (!POSITIONS.includes(posicion)) invalido({ posicion: 'Elige la posición.' });
    return (await zonasDePosicion(posicion, excluirId)).map(({ rep, zona }) => ({ representanteId: rep.id, representante: rep.fullName, provincias: zona.provincias, municipios: zona.municipios ?? {} }));
  }
  /** Zona del actor: null = sin límite (gestión); objeto { provincias, municipios } para representantes. */
  async function zonaActor(actor) {
    if (rol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas'])) return null;
    if (esRep(actor)) return (await zonaDe(actor.id)) ?? { provincias: [], municipios: {} };
    return { provincias: [], municipios: {} };
  }
  async function provinciasDe(actor) {
    if (rol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas'])) return PROVINCIAS;
    if (esRep(actor)) return (await zonaDe(actor.id))?.provincias ?? [];
    return [];
  }
  /**
   * Asigna la zona de un representante: provincias completas o, dentro de una provincia, solo algunos municipios.
   * `municipios` = { Provincia: ['Municipio', ...] }; una provincia sin lista (o lista vacía) cubre todos sus municipios.
   * También permite cambiar su posición (Visitador, PVC, Vendedor, Promotora).
   */
  async function asignarZona(actor, repId, input = {}) {
    permitir(rol(actor, GESTION));
    const rep = await users.findUserById(repId);
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const entrada = Array.isArray(input) ? { provincias: input } : input;
    const lista = [...new Set((Array.isArray(entrada.provincias) ? entrada.provincias : []).map(provinciaOficial))];
    if (lista.includes(null)) invalido({ provincias: 'Hay provincias que no son oficiales.' });
    const municipios = {};
    for (const [p0, ms] of Object.entries(entrada.municipios ?? {})) {
      const p = provinciaOficial(p0);
      if (!p || !lista.includes(p) || !Array.isArray(ms) || !ms.length) continue;
      const oficiales = [...new Set(ms.map((m) => municipioOficial(p, m)))];
      if (oficiales.includes(null)) invalido({ municipios: `Hay municipios que no pertenecen a ${p}.` });
      if (oficiales.length < DIVISION[p].length) municipios[p] = oficiales.sort((a, b) => a.localeCompare(b, 'es'));
    }
    let posicion = rep.position;
    const cambiaPosicion = entrada.posicion !== undefined && entrada.posicion !== rep.position;
    if (cambiaPosicion && !POSITIONS.includes(entrada.posicion)) invalido({ posicion: 'Elige la posición: Visitador, PVC, Vendedor o Promotora.' });
    const conflictos = await conflictosZona({ provincias: lista, municipios }, cambiaPosicion ? entrada.posicion : rep.position, repId);
    if (conflictos.length) throw new HttpError(409, mensajeConflicto(conflictos, cambiaPosicion ? entrada.posicion : rep.position), { provincias: 'Esta zona ya la cubre otro representante de la misma posición.' });
    if (cambiaPosicion) {
      await users.updateUser(repId, { position: entrada.posicion });
      await audit({ actorId: actor.id, action: 'posicion_cambiada', entity: 'user', entityId: repId, before: { posicion: rep.position }, after: { posicion: entrada.posicion } });
      posicion = entrada.posicion;
    }
    const antes = await zonaDe(repId);
    const datos = { provincias: lista, municipios, actualizadoPor: actor.id };
    const z = antes ? await data.update('zonas', antes.id, datos) : await data.insert('zonas', { representanteId: repId, ...datos });
    await audit({ actorId: actor.id, action: 'zona_asignada', entity: 'user', entityId: repId, before: antes ? { provincias: antes.provincias, municipios: antes.municipios ?? {} } : null, after: { provincias: lista, municipios } });
    return { ...z, municipios: z.municipios ?? {}, posicion };
  }
  /** Todas las zonas de una vez (para listas: evita un pedido por representante). */
  async function listarZonas(actor) {
    permitir(rol(actor, [...GESTION, 'finanzas']));
    return (await data.list('zonas')).map((z) => ({ representanteId: z.representanteId, provincias: z.provincias ?? [], municipios: z.municipios ?? {}, cartera: (z.cartera?.medicos ?? []).map(clave) }));
  }
  async function verZona(actor, repId) {
    permitir(actor.id === repId || rol(actor, [...GESTION, 'finanzas']));
    const z = await zonaDe(repId);
    return { representanteId: repId, provincias: z?.provincias ?? [], municipios: z?.municipios ?? {} };
  }
  /** Farmacias y centros de salud que caen dentro de la zona del representante (lo que puede visitar). */
  async function lugaresDeZona(actor, repId) {
    permitir(actor.id === repId || rol(actor, [...GESTION, 'finanzas']));
    const z = await zonaDe(repId);
    if (!z?.provincias?.length) return { zona: { provincias: [], municipios: {} }, farmacias: [], establecimientos: [], resumen: [] };
    const activo = (x) => !['inactivo', 'inactiva'].includes(x.estado);
    const fuera = new Set(z.excluidos ?? []);
    const todasF = (await data.list('farmacias')).filter((x) => activo(x) && dentroDeZona(z, x.provincia, x.municipio));
    const todosE = (await data.list('establecimientos')).filter((x) => activo(x) && dentroDeZona(z, x.provincia, x.municipio));
    const farmacias = todasF.filter((x) => !fuera.has(x.id)); const establecimientos = todosE.filter((x) => !fuera.has(x.id));
    // Quitados solo de su ruta (siguen en el catálogo y en la zona de otros): se pueden volver a agregar.
    const excluidos = [...todasF.filter((x) => fuera.has(x.id)).map((x) => ({ ...x, tipo: 'farmacia' })), ...todosE.filter((x) => fuera.has(x.id))];
    const porMun = new Map();
    for (const x of [...farmacias.map((f) => ({ ...f, tipo: 'farmacia' })), ...establecimientos]) {
      const k = `${x.provincia}|${x.municipio}`;
      const r = porMun.get(k) ?? { provincia: x.provincia, municipio: x.municipio, farmacia: 0, hospital: 0, clinica: 0, unap: 0, cpn: 0, otros: 0, sinUbicacion: 0 };
      if (x.tipo in r) r[x.tipo]++; else r.otros++;
      if (x.lat == null || x.lng == null) r.sinUbicacion++;
      porMun.set(k, r);
    }
    const resumen = [...porMun.values()].sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es'));
    return { zona: { provincias: z.provincias, municipios: z.municipios ?? {} }, farmacias, establecimientos, resumen, excluidos };
  }
  // ------------------------------------------------------------ cartera de médicos (visitador y PVC)
  const CON_MEDICOS = ['Visitador', 'PVC'];
  /** Médicos que trabajan en los centros de su ruta: uno por cada centro donde trabaja. */
  async function medicosDeRuta(z) {
    const fuera = new Set(z.excluidos ?? []);
    const centros = new Map((await data.list('establecimientos')).filter((x) => !['inactivo', 'inactiva'].includes(x.estado) && dentroDeZona(z, x.provincia, x.municipio) && !fuera.has(x.id)).map((x) => [x.id, x]));
    const out = [];
    for (const m of await data.list('medicos')) {
      if (m.estado === 'inactivo') continue;
      for (const cid of centrosDeMedico(m)) {
        const c = centros.get(cid); if (!c) continue;
        out.push({ medicoId: m.id, nombre: m.nombre, especialidad: m.especialidad ?? null, establecimientoId: c.id, centro: c.nombre, tipoCentro: c.tipo, municipio: c.municipio, provincia: c.provincia });
      }
    }
    return out.sort((a, b) => a.centro.localeCompare(b.centro, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  }
  const clave = (x) => `${x.medicoId}|${x.establecimientoId}`;
  async function verCartera(actor, repId) {
    permitir(actor.id === repId || rol(actor, [...GESTION, 'finanzas']));
    const rep = await users.findUserById(repId);
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const z = await zonaDe(repId);
    const disponibles = z?.provincias?.length ? await medicosDeRuta(z) : [];
    const por = new Map(disponibles.map((x) => [clave(x), x]));
    const c = z?.cartera ?? {};
    const medicos = (c.medicos ?? []).map((x) => por.get(clave(x))).filter(Boolean);
    return { aplica: CON_MEDICOS.includes(rep.position), posicion: rep.position, medicos, centroInicioId: medicos.some((m) => m.establecimientoId === c.centroInicioId) ? c.centroInicioId : null,
      visitas: { medicos: c.visitas?.medicos ?? null, farmacias: c.visitas?.farmacias ?? null }, disponibles };
  }
  async function guardarCartera(actor, repId, input = {}) {
    permitir(rol(actor, GESTION), 'Solo la administración, la gerencia o la supervisión arman la cartera de médicos.');
    const rep = await users.findUserById(repId);
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    if (!CON_MEDICOS.includes(rep.position)) throw new HttpError(409, 'Solo los visitadores y los PVC tienen cartera de médicos. Los vendedores visitan farmacias.');
    const z = await zonaDe(repId);
    if (!z?.provincias?.length) throw new HttpError(409, 'Asigna primero su zona de trabajo.');
    const e = {};
    const por = new Map((await medicosDeRuta(z)).map((x) => [clave(x), x]));
    const lista = Array.isArray(input.medicos) ? input.medicos : [];
    if (lista.length > 1000) e.medicos = 'Máximo 1,000 médicos.';
    const medicos = []; const vistos = new Set();
    for (const x of lista) {
      const k = clave({ medicoId: String(x?.medicoId ?? ''), establecimientoId: String(x?.establecimientoId ?? '') });
      if (!por.has(k)) { e.medicos = 'Hay médicos que no trabajan en un centro de su ruta.'; continue; }
      if (!vistos.has(k)) { vistos.add(k); medicos.push({ medicoId: por.get(k).medicoId, establecimientoId: por.get(k).establecimientoId }); }
    }
    const ini = input.centroInicioId ? String(input.centroInicioId) : null;
    if (ini && !medicos.some((m) => m.establecimientoId === ini)) e.centroInicioId = 'El centro de inicio debe tener médicos en su cartera.';
    const visitas = {};
    for (const k of ['medicos', 'farmacias']) {
      const v = input.visitas?.[k];
      if (v === '' || v == null) { visitas[k] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 40) e[`visitas.${k}`] = 'Escribe entre 0 y 40.'; else visitas[k] = n;
    }
    if (rep.position === 'Visitador') visitas.farmacias = null;
    if (Object.keys(e).length) invalido(e);
    const antes = z.cartera ?? null;
    const cartera = { medicos, centroInicioId: ini, visitas };
    await data.update('zonas', z.id, { cartera, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'cartera_medicos', entity: 'user', entityId: repId, before: antes ? { medicos: antes.medicos?.length ?? 0, centroInicioId: antes.centroInicioId ?? null, visitas: antes.visitas ?? null } : null, after: { medicos: medicos.length, centroInicioId: ini, visitas } });
    return verCartera(actor, repId);
  }
  /**
   * Agregar (o quitar) los mismos médicos a varios visitadores/PVC a la vez. A cada uno solo se le agregan los
   * que trabajan en un centro de su ruta; el resto se informa como "fuera de su ruta".
   */
  async function carteraLote(actor, input = {}, quitar = false) {
    permitir(rol(actor, GESTION), 'Solo la administración, la gerencia o la supervisión arman la cartera de médicos.');
    const reps = [...new Set((Array.isArray(input.representanteIds) ? input.representanteIds : []).map(String))];
    const pares = (Array.isArray(input.medicos) ? input.medicos : []).map((x) => ({ medicoId: String(x?.medicoId ?? ''), establecimientoId: String(x?.establecimientoId ?? '') })).filter((x) => x.medicoId && x.establecimientoId);
    const e = {};
    if (!reps.length) e.representanteIds = 'Elige al menos un visitador o PVC.';
    if (reps.length > 100) e.representanteIds = 'Máximo 100 representantes por vez.';
    if (!pares.length) e.medicos = 'Elige al menos un médico.';
    if (pares.length > 2000) e.medicos = 'Máximo 2,000 médicos por vez.';
    if (Object.keys(e).length) invalido(e);
    const resultados = [];
    for (const id of reps) {
      const rep = await users.findUserById(id);
      if (!rep || rep.role !== 'representante') { resultados.push({ representanteId: id, error: 'No existe.' }); continue; }
      if (!CON_MEDICOS.includes(rep.position)) { resultados.push({ representanteId: id, nombre: rep.fullName, error: `${rep.position}: no tiene cartera de médicos.` }); continue; }
      const z = await zonaDe(id);
      if (!z?.provincias?.length) { resultados.push({ representanteId: id, nombre: rep.fullName, error: 'No tiene zona de trabajo.' }); continue; }
      const actual = z.cartera?.medicos ?? []; const tiene = new Set(actual.map(clave));
      let medicos; let cambiados = [];
      if (quitar) { const q = new Set(pares.map(clave)); cambiados = actual.filter((x) => q.has(clave(x))); medicos = actual.filter((x) => !q.has(clave(x))); }
      else {
        const validos = new Set((await medicosDeRuta(z)).map(clave));
        cambiados = pares.filter((x) => validos.has(clave(x)) && !tiene.has(clave(x)));
        cambiados = [...new Map(cambiados.map((x) => [clave(x), x])).values()];
        medicos = [...actual, ...cambiados];
        resultados.push({ representanteId: id, nombre: rep.fullName, agregados: cambiados, yaTenia: pares.filter((x) => tiene.has(clave(x))).length, fueraDeRuta: pares.filter((x) => !validos.has(clave(x))).length });
      }
      if (quitar) resultados.push({ representanteId: id, nombre: rep.fullName, quitados: cambiados });
      if (cambiados.length) {
        await data.update('zonas', z.id, { cartera: { medicos, centroInicioId: medicos.some((m) => m.establecimientoId === z.cartera?.centroInicioId) ? z.cartera.centroInicioId : null, visitas: z.cartera?.visitas ?? { medicos: null, farmacias: null } }, actualizadoPor: actor.id });
        await audit({ actorId: actor.id, action: quitar ? 'cartera_medicos_quitados' : 'cartera_medicos_agregados', entity: 'user', entityId: id, after: { medicos: cambiados.length, total: medicos.length } });
      }
    }
    return { resultados };
  }
  /**
   * Quita lugares de la ruta de un representante (o los vuelve a poner). No toca el catálogo ni a otros
   * representantes: sale de su propuesta de cronograma y de su meta de visitas. Queda auditado.
   */
  async function excluirLugares(actor, repId, input = {}) {
    permitir(rol(actor, GESTION), 'Solo la administración, la gerencia o la supervisión cambian los lugares de una ruta.');
    const z = await zonaDe(repId);
    if (!z?.provincias?.length) throw new HttpError(409, 'Asigna primero su zona de trabajo.');
    const ids = (x) => [...new Set((Array.isArray(x) ? x : []).map(String).filter((s) => /^[\w-]{1,64}$/.test(s)))];
    const quitar = ids(input.quitar); const volver = ids(input.volver);
    if (!quitar.length && !volver.length) invalido({ ids: 'Elige al menos un lugar.' });
    if (quitar.length + volver.length > 2000) invalido({ ids: 'Máximo 2,000 lugares por vez.' });
    const antes = new Set(z.excluidos ?? []);
    const nuevo = new Set(antes); quitar.forEach((i) => nuevo.add(i)); volver.forEach((i) => nuevo.delete(i));
    const lista = [...nuevo];
    await data.update('zonas', z.id, { excluidos: lista, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'ruta_lugares_cambiados', entity: 'user', entityId: repId, before: { excluidos: antes.size }, after: { quitados: quitar.filter((i) => !antes.has(i)).length, devueltos: volver.filter((i) => antes.has(i)).length, excluidos: lista.length } });
    return { excluidos: lista.length, quitados: quitar.filter((i) => !antes.has(i)).length, devueltos: volver.filter((i) => antes.has(i)).length };
  }

  // ------------------------------------------------------------ establecimientos
  function validarEst(input, e, { tipoLibre = false } = {}) {
    const tipo = tipoLibre ? 'farmacia' : tipoEstablecimiento(input.tipo);
    if (!tipo) e.tipo = 'Elige el tipo: clínica, hospital, UNAP, centro de primer nivel, centro diagnóstico o consultorio.';
    const nombre = normalizeName(input.nombre);
    if (!nombre || nombre.length < 2) e.nombre = 'Escribe el nombre.';
    else if (nombre.length > 160) e.nombre = 'El nombre es demasiado largo.';
    const provincia = provinciaOficial(input.provincia);
    if (!provincia) e.provincia = 'Elige una provincia oficial.';
    const municipio = provincia && municipioOficial(provincia, input.municipio);
    if (provincia && !municipio) e.municipio = `Ese municipio no pertenece a ${provincia}.`;
    const corto = (v, n) => { const s = normalizeName(v); return s ? s.slice(0, n) : null; };
    const lat = input.lat == null || input.lat === '' ? null : Number(input.lat);
    const lng = input.lng == null || input.lng === '' ? null : Number(input.lng);
    if (lat != null && !(lat > 17 && lat < 20.5)) e.lat = 'Ubicación fuera de República Dominicana.';
    if (lng != null && !(lng > -72.2 && lng < -68)) e.lng = 'Ubicación fuera de República Dominicana.';
    return { tipo, nombre, provincia, municipio, sector: corto(input.sector, 80), direccion: corto(input.direccion, 200), telefono: corto(input.telefono, 30), lat, lng, placeId: input.placeId ? String(input.placeId).slice(0, 200) : null };
  }
  const claveLugar = (x) => `${sinAcentos(x.nombre)}|${sinAcentos(x.municipio)}`;

  async function crearEstablecimiento(actor, input, { fuente = 'manual', verificado = false } = {}) {
    if (!verificado) input = { ...input, lat: null, lng: null, placeId: null };
    const zona = await zonaActor(actor);
    permitir(rol(actor, GESTION) || esRep(actor), 'No puedes registrar establecimientos.');
    const e = {}; const d = validarEst(input, e);
    if (Object.keys(e).length) invalido(e);
    permitir(!zona || dentroDeZona(zona, d.provincia, d.municipio), 'Ese municipio no está asignado a tu zona.');
    const existentes = await data.list('establecimientos', { municipio: d.municipio });
    const dup = existentes.find((x) => claveLugar(x) === claveLugar(d) || (d.placeId && x.placeId === d.placeId));
    if (dup) throw new HttpError(409, `${dup.nombre} ya está registrado en ${dup.municipio}.`, { nombre: 'Ya existe en este municipio.' });
    const estado = rol(actor, GESTION) ? 'validado' : 'pendiente';
    const x = await data.insert('establecimientos', { ...d, fuente, estado, creadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'establecimiento_creado', entity: 'establecimiento', entityId: x.id, after: { nombre: x.nombre, municipio: x.municipio, fuente } });
    return x;
  }
  /**
   * Lista establecimientos. `ver`: 'activos' (por defecto), 'revisar' (posibles errores de Google) o
   * 'descartados' (marcados como "no es un centro de salud"; solo gestión).
   */
  async function listarEstablecimientos(actor, { provincia, municipio, tipo, q, ver = 'activos' } = {}) {
    permitir(activo(actor));
    const zona = await zonaActor(actor);
    // Cada filtro acepta varios valores separados por coma (varias provincias, municipios o tipos a la vez).
    const lista = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);
    const [provs, muns, tipos] = [lista(provincia), lista(municipio), lista(tipo)];
    const filtro = {};
    if (muns.length === 1) filtro.municipio = muns[0];
    let xs = await data.list('establecimientos', filtro);
    const descartados = ver === 'descartados' && rol(actor, GESTION);
    xs = xs.filter((x) => (!zona || dentroDeZona(zona, x.provincia, x.municipio)) && (!provs.length || provs.includes(x.provincia)) && (!muns.length || muns.includes(x.municipio)) && (!tipos.length || tipos.includes(x.tipo)) && (descartados ? x.estado === 'inactivo' : x.estado !== 'inactivo'));
    if (q) { const k = sinAcentos(q); xs = xs.filter((x) => sinAcentos(`${x.nombre} ${x.sector ?? ''} ${x.direccion ?? ''}`).includes(k)); }
    xs = xs.map((x) => ({ ...x, revisar: x.estado !== 'inactivo' && posibleError(x.nombre) }));
    if (ver === 'revisar') xs = xs.filter((x) => x.revisar);
    return xs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  /** Marca uno o varios registros como "no es un centro de salud": salen de zonas, cronogramas y propuestas. Reversible. */
  async function descartarEstablecimientos(actor, ids, motivo) {
    permitir(rol(actor, GESTION), 'Solo la administración, la gerencia o la supervisión pueden descartar registros.');
    const lista = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
    if (!lista.length) invalido({ ids: 'Elige al menos un registro.' });
    if (lista.length > 500) invalido({ ids: 'Máximo 500 registros por vez.' });
    const m = normalizeName(motivo).slice(0, 200) || 'No es un centro de salud';
    let n = 0;
    for (const id of lista) {
      const x = await data.get('establecimientos', id);
      if (x && x.estado !== 'inactivo') {
        await data.update('establecimientos', id, { estado: 'inactivo', descarteMotivo: m, descartadoPor: actor.id });
        await audit({ actorId: actor.id, action: 'establecimiento_descartado', entity: 'establecimiento', entityId: id, before: { estado: x.estado, nombre: x.nombre }, after: { estado: 'inactivo', motivo: m } });
        n++; continue;
      }
      // También farmacias (desde "Lugares de su zona"): salen de las zonas y cronogramas; el historial se conserva.
      const f = x ? null : await data.get('farmacias', id);
      if (f && f.estado !== 'inactiva') {
        await data.update('farmacias', id, { estado: 'inactiva' });
        await audit({ actorId: actor.id, action: 'farmacia_descartada', entity: 'farmacia', entityId: id, before: { estado: f.estado, nombre: f.nombre }, after: { estado: 'inactiva', motivo: m } });
        n++;
      }
    }
    return { descartados: n };
  }
  async function restaurarEstablecimiento(actor, id) {
    permitir(rol(actor, GESTION));
    const x = await data.get('establecimientos', id);
    if (!x) throw new HttpError(404, 'El establecimiento no existe.');
    if (x.estado !== 'inactivo') return x;
    const out = await data.update('establecimientos', id, { estado: 'validado', descarteMotivo: null, descartadoPor: null });
    await audit({ actorId: actor.id, action: 'establecimiento_restaurado', entity: 'establecimiento', entityId: id, before: { estado: 'inactivo', motivo: x.descarteMotivo ?? null }, after: { estado: 'validado' } });
    return out;
  }
  async function validarEstablecimiento(actor, id) {
    permitir(rol(actor, ['administrador', 'gerencia', 'supervisor']));
    const x = await data.get('establecimientos', id);
    if (!x) throw new HttpError(404, 'El establecimiento no existe.');
    const out = await data.update('establecimientos', id, { estado: 'validado' });
    await audit({ actorId: actor.id, action: 'establecimiento_validado', entity: 'establecimiento', entityId: id });
    return out;
  }

  // ------------------------------------------------------------ pre-registro de representantes
  async function preregistroPara(email) {
    const e = String(email ?? '').trim().toLowerCase();
    return (await data.list('preregistros', { email: e })).find((p) => p.estado === 'pendiente') ?? null;
  }
  /** Registro, paso 1: si el correo está pre-registrado como representante, devuelve su cargo (la cuenta nace activa). */
  async function buscarPreregistro(email, role) {
    if (role !== 'representante') return null;
    return preregistroPara(email);
  }
  /** Registro, paso 2: marca el pre-registro como usado y asigna sus provincias. */
  async function confirmarPreregistro(user, p) {
    await data.update('preregistros', p.id, { estado: 'usado', usuarioId: user.id });
    if (p.provincias?.length && !(await zonaDe(user.id))) {
      // Solo las provincias que no cubre ya otro representante de la misma posición
      const libres = [];
      for (const prov of p.provincias) if (!(await conflictosZona({ provincias: [prov], municipios: {} }, p.posicion, user.id)).length) libres.push(prov);
      if (libres.length) await data.insert('zonas', { representanteId: user.id, provincias: libres, actualizadoPor: p.creadoPor });
    }
    await audit({ actorId: p.creadoPor, action: 'preregistro_aplicado', entity: 'user', entityId: user.id, after: { posicion: p.posicion, provincias: p.provincias } });
  }
  async function listarPreregistros(actor) {
    permitir(rol(actor, GESTION));
    return (await data.list('preregistros')).filter((p) => p.estado !== 'anulado').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function anularPreregistro(actor, id) {
    permitir(rol(actor, GESTION));
    const p = await data.get('preregistros', id);
    if (!p) throw new HttpError(404, 'El pre-registro no existe.');
    if (p.estado !== 'pendiente') throw new HttpError(409, 'Ese pre-registro ya se usó.');
    await audit({ actorId: actor.id, action: 'preregistro_anulado', entity: 'preregistro', entityId: id, before: { email: p.email } });
    return data.update('preregistros', id, { estado: 'anulado' });
  }

  /** Código de medicamento normalizado: mayúsculas, sin espacios ("zitro 002" → "ZITRO002"). */
  // ------------------------------------------------------------ importación por Excel
  const IMPORTADORES = {
    medicamentos: {
      roles: ['administrador', 'gerencia'],
      // Plantilla oficial: #, Código, Medicamento / Producto, Precio Final ($). También acepta la anterior (Nombre, Presentación, Precio RD).
      columnas: [],
      columnasOk(cols) {
        const nombre = cols.some((c) => ['medicamento producto', 'medicamento', 'producto', 'nombre'].includes(c));
        const precio = cols.some((c) => ['precio final', 'precio', 'precio rd'].includes(c));
        return nombre && precio ? null : 'Faltan columnas: Código, Medicamento / Producto y Precio Final. Usa la plantilla.';
      },
      async preparar() {
        const ms = await data.list('medicamentos');
        // Los activos primero: si hay un repetido dado de baja, se actualiza el activo.
        const orden = [...ms].sort((a, b) => Number(a.activo === false) - Number(b.activo === false));
        const porCodigo = new Map(); const porNombre = new Map();
        for (const m of [...orden].reverse()) { if (m.codigo) porCodigo.set(codigoMed(m.codigo), m); porNombre.set(claveMed(m.nombre, m.presentacion), m); }
        return { porCodigo, porNombre };
      },
      fila(f, ctx, vistos) {
        const e = [];
        const nombre = normalizeName(f['medicamento producto'] ?? f.medicamento ?? f.producto ?? f.nombre); if (!nombre) e.push('Falta el nombre del medicamento.');
        const presentacion = normalizeName(f.presentacion) || null;
        const codigo = String(f.codigo ?? '').trim() ? codigoMed(f.codigo) : null;
        if (codigo && !/^[A-Z0-9-]{2,30}$/.test(codigo)) e.push('El código solo lleva letras, números y guiones.');
        const precio = numero(f['precio final'] ?? f['precio rd'] ?? f.precio);
        if (precio == null) e.push('Falta el precio.'); else if (!(precio > 0) || precio > 1e7) e.push('El precio debe ser un número mayor que cero.');
        const vigente = fechaDe(f['vigente desde']);
        if (vigente === undefined) e.push('La fecha "Vigente desde" debe ser AAAA-MM-DD.');
        const kNom = claveMed(nombre, presentacion);
        // Repetidos en el archivo: si la fila es idéntica a otra, se omite sola; si no coincide, es un error.
        let repetida = false;
        for (const k of [codigo && `c:${codigo}`, `n:${kNom}`].filter(Boolean)) {
          const prev = vistos.get(k);
          if (prev) { if (prev.firma === `${codigo}|${kNom}|${r2(precio ?? 0)}`) repetida = prev.fila; else e.push(`${k.startsWith('c:') ? 'Código' : 'Medicamento'} repetido en la fila ${prev.fila} con otros datos.`); }
        }
        if (!repetida) for (const k of [codigo && `c:${codigo}`, `n:${kNom}`].filter(Boolean)) if (!vistos.has(k)) vistos.set(k, { fila: f._fila, firma: `${codigo}|${kNom}|${r2(precio ?? 0)}` });
        if (repetida && !e.length) return { e, d: { codigo, nombre, precio: r2(precio ?? 0) }, accion: `repetido (igual a la fila ${repetida}, se omite)`, actual: null, cambios: [] };
        // Primero por código; si no lo tiene, por nombre (y se le pone el código).
        const actual = (codigo && ctx.porCodigo.get(codigo)) || ctx.porNombre.get(kNom) || null;
        if (actual && codigo && actual.codigo && codigoMed(actual.codigo) !== codigo) e.push(`"${nombre}" ya existe con el código ${actual.codigo}.`);
        const cambios = [];
        if (actual) {
          if (codigo && codigoMed(actual.codigo ?? '') !== codigo) cambios.push('código');
          // Nombre: cambia si es otro texto (no solo mayúsculas). Si el nombre nuevo ya trae la presentación, esta se une al nombre.
          if (claveMed(actual.nombre, null) !== claveMed(nombre, null) || (actual.presentacion && !presentacion && claveMed(nombre, null) === claveMed(actual.nombre, actual.presentacion))) cambios.push('nombre');
          if (actual.activo === false) cambios.push('volver a activar');
          if (r2(actual.precio ?? 0) !== r2(precio ?? 0)) cambios.push('precio');
        }
        const accion = !actual ? 'crear' : cambios.length ? `actualizar ${cambios.join(', ')}` : 'sin cambio';
        return { e, d: { codigo, nombre, linea: normalizeName(f.linea) || null, presentacion, precio: r2(precio ?? 0), vigenteDesde: vigente || hoyRD(now()), antes: actual ? { codigo: actual.codigo ?? null, nombre: actual.nombre, precio: actual.precio ?? null } : null }, accion, actual, cambios };
      },
      async guardar(actor, { d, accion, actual, cambios }) {
        if (accion.startsWith('repetido')) return;
        if (accion === 'crear') {
          const m = await data.insert('medicamentos', { codigo: d.codigo, nombre: d.nombre, linea: d.linea, presentacion: d.presentacion, precio: d.precio, activo: true });
          await data.insert('preciosMedicamento', { medicamentoId: m.id, precio: d.precio, vigenteDesde: d.vigenteDesde, fuente: 'excel', registradoPor: actor.id });
        } else if (cambios?.length) {
          await data.update('medicamentos', actual.id, { ...(cambios.includes('código') ? { codigo: d.codigo } : {}), ...(cambios.includes('nombre') ? { nombre: d.nombre, ...(!d.presentacion && actual.presentacion && claveMed(d.nombre, null) === claveMed(actual.nombre, actual.presentacion) ? { presentacion: null } : {}) } : {}), ...(cambios.includes('volver a activar') ? { activo: true } : {}), ...(cambios.includes('precio') ? { precio: d.precio } : {}), ...(d.linea && !actual.linea ? { linea: d.linea } : {}) });
          if (cambios.includes('precio')) await data.insert('preciosMedicamento', { medicamentoId: actual.id, precio: d.precio, vigenteDesde: d.vigenteDesde, fuente: 'excel', registradoPor: actor.id });
        }
      },
    },
    farmacias: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['nombre', 'provincia', 'municipio'],
      async preparar() { return { claves: new Set((await data.list('farmacias')).map(claveLugar)) }; },
      fila(f, ctx, vistos) {
        const err = {}; const d = validarEst(f, err, { tipoLibre: true });
        const e = Object.values(err);
        const k = d.municipio ? claveLugar(d) : null;
        if (k && vistos.has(k)) e.push(`Repetida en la fila ${vistos.get(k)}.`); else if (k) vistos.set(k, f._fila);
        return { e, d, accion: k && ctx.claves.has(k) ? 'ya existe' : 'crear' };
      },
      async guardar(actor, { d, accion }) {
        if (accion !== 'crear') return;
        await data.insert('farmacias', { nombre: d.nombre, provincia: d.provincia, municipio: d.municipio, sector: d.sector, direccion: d.direccion, telefono: d.telefono, fuente: 'excel', estado: 'validada', creadoPor: actor.id });
      },
    },
    establecimientos: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['tipo', 'nombre', 'provincia', 'municipio'],
      async preparar() { return { claves: new Set((await data.list('establecimientos')).map(claveLugar)) }; },
      fila(f, ctx, vistos) {
        const err = {}; const d = validarEst(f, err);
        const e = Object.values(err);
        const k = d.municipio ? claveLugar(d) : null;
        if (k && vistos.has(k)) e.push(`Repetido en la fila ${vistos.get(k)}.`); else if (k) vistos.set(k, f._fila);
        return { e, d, accion: k && ctx.claves.has(k) ? 'ya existe' : 'crear' };
      },
      async guardar(actor, { d, accion }) {
        if (accion !== 'crear') return;
        await data.insert('establecimientos', { ...d, fuente: 'excel', estado: 'validado', creadoPor: actor.id });
      },
    },
    representantes: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['nombre completo', 'correo', 'cargo'],
      async preparar() {
        const pre = await data.list('preregistros');
        return { pendientes: new Map(pre.filter((p) => p.estado === 'pendiente').map((p) => [p.email, p])), cuentas: new Set((await users.listUsers()).map((u) => u.email)) };
      },
      fila(f, ctx, vistos) {
        const e = [];
        const nombre = normalizeName(f['nombre completo'] ?? f.nombre); if (!nombre || nombre.split(' ').length < 2) e.push('Escribe nombre y apellido.');
        const email = String(f.correo ?? '').trim().toLowerCase(); if (!CORREO.test(email)) e.push('El correo no es válido.');
        const posicion = POSITIONS.find((p) => sinAcentos(p) === sinAcentos(f.cargo)) ?? (sinAcentos(f.cargo) === 'promotor' ? 'Promotora' : null);
        if (!posicion) e.push(`Cargo inválido. Usa: ${POSITIONS.join(', ')}.`);
        const crudas = String(f.provincias ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
        const provincias = [...new Set(crudas.map(provinciaOficial))];
        const malas = crudas.filter((s) => !provinciaOficial(s));
        if (malas.length) e.push(`Provincias no reconocidas: ${malas.join(', ')}.`);
        if (email && vistos.has(email)) e.push(`Correo repetido en la fila ${vistos.get(email)}.`); else if (email) vistos.set(email, f._fila);
        const accion = ctx.cuentas.has(email) ? 'ya tiene cuenta' : ctx.pendientes.has(email) ? 'actualizar' : 'pre-registrar';
        return { e, d: { nombre, email, telefono: normalizeName(f.telefono) || null, posicion, provincias: provincias.filter(Boolean) }, accion, actual: ctx.pendientes.get(email) };
      },
      async guardar(actor, { d, accion, actual }) {
        if (accion === 'pre-registrar') await data.insert('preregistros', { ...d, estado: 'pendiente', creadoPor: actor.id });
        else if (accion === 'actualizar') await data.update('preregistros', actual.id, { nombre: d.nombre, telefono: d.telefono, posicion: d.posicion, provincias: d.provincias });
      },
    },
  };

  /**
   * Importa un archivo. Sin `confirmar` devuelve la vista previa (nada se guarda).
   * Con `confirmar` guarda solo si no hay filas con errores (todo o nada).
   */
  async function importar(actor, tipo, { archivo, nombre, confirmar = false } = {}) {
    const imp = IMPORTADORES[tipo];
    if (!imp) throw new HttpError(404, 'Tipo de importación desconocido.');
    permitir(rol(actor, imp.roles));
    let buf;
    try { buf = Buffer.from(String(archivo ?? ''), 'base64'); } catch { buf = Buffer.alloc(0); }
    if (!buf.length) invalido({ archivo: 'Elige un archivo .xlsx o .csv.' });
    if (buf.length > 8 * 1024 * 1024) invalido({ archivo: 'El archivo no puede pasar de 8 MB.' });
    let hoja;
    try { hoja = leerHoja(buf, nombre); } catch (err) { invalido({ archivo: err.message }); }
    const faltan = imp.columnas.filter((c) => !hoja.columnas.includes(c));
    if (faltan.length) invalido({ archivo: `Faltan columnas: ${faltan.join(', ')}. Usa la plantilla.` });
    const malCols = imp.columnasOk?.(hoja.columnas);
    if (malCols) invalido({ archivo: malCols });
    const ctx = await imp.preparar();
    const vistos = new Map();
    const filas = hoja.filas.filter((f) => !esEjemplo(f)).map((f) => ({ fila: f._fila, ...imp.fila(f, ctx, vistos) }));
    const errores = filas.filter((f) => f.e.length).map((f) => ({ fila: f.fila, errores: f.e }));
    const resumen = {};
    for (const f of filas) if (!f.e.length) resumen[f.accion] = (resumen[f.accion] ?? 0) + 1;
    const vista = filas.slice(0, 200).map((f) => ({ fila: f.fila, accion: f.e.length ? 'error' : f.accion, datos: f.d, errores: f.e }));
    if (!confirmar) return { tipo, total: filas.length, resumen, errores, vista, guardado: false };
    if (!filas.length) invalido({ archivo: 'El archivo no tiene filas para importar.' });
    if (errores.length) throw new HttpError(422, `Hay ${errores.length} fila(s) con errores. Corrígelas y vuelve a subir el archivo.`, { archivo: 'Hay filas con errores.' });
    for (const f of filas) await imp.guardar(actor, f);
    await audit({ actorId: actor.id, action: 'importacion', entity: tipo, entityId: nombre ?? tipo, after: { archivo: nombre ?? null, resumen } });
    return { tipo, total: filas.length, resumen, errores: [], guardado: true };
  }

  /** Poner o cambiar el precio de un medicamento; el anterior queda en su historial. */
  async function cambiarPrecio(actor, medicamentoId, input = {}) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia cambian precios.');
    const m = await data.get('medicamentos', medicamentoId);
    if (!m) throw new HttpError(404, 'El medicamento no existe.');
    const precio = Number(String(input.precio ?? '').replace(/,/g, ''));
    const vigenteDesde = input.vigenteDesde || hoyRD(now());
    const e = {};
    if (!Number.isFinite(precio) || precio <= 0) e.precio = 'Escribe el precio en RD$.';
    if (!esFechaISO(vigenteDesde)) e.vigenteDesde = 'Elige la fecha.';
    if (Object.keys(e).length) invalido(e);
    const out = await data.update('medicamentos', m.id, { precio: r2(precio) });
    await data.insert('preciosMedicamento', { medicamentoId: m.id, precio: r2(precio), vigenteDesde, fuente: 'manual', registradoPor: actor.id });
    await audit({ actorId: actor.id, action: 'precio_medicamento', entity: 'medicamento', entityId: m.id, before: { precio: m.precio ?? null }, after: { precio: r2(precio), vigenteDesde } });
    return out;
  }
  async function historialPrecio(actor, medicamentoId) {
    permitir(activo(actor));
    return (await data.list('preciosMedicamento', { medicamentoId })).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  }

  return {
    division: () => ({ provincias: PROVINCIAS, municipios: DIVISION, tipos: TIPOS_ESTABLECIMIENTO }),
    provinciasDe, zonaActor, asignarZona, verZona, listarZonas, conflictosZona, mensajeConflicto, zonasOcupadas, lugaresDeZona, excluirLugares, verCartera, guardarCartera, carteraAgregar: (a, i) => carteraLote(a, i, false), carteraQuitar: (a, i) => carteraLote(a, i, true), descartarEstablecimientos, restaurarEstablecimiento,
    crearEstablecimiento, listarEstablecimientos, validarEstablecimiento,
    buscarPreregistro, confirmarPreregistro, listarPreregistros, anularPreregistro,
    importar, historialPrecio, cambiarPrecio,
  };
}

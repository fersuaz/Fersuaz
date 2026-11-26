// Hoteles para el hospedaje de los representantes. No se visitan: se usan para el viático de hospedaje.
// Google Maps aporta nombre, dirección, teléfono, ubicación y calificación; el precio por noche y los
// requisitos (aire, agua, cama, higiene, parqueo, seguridad) los confirma la administración.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';
import { provinciaOficial, municipioOficial } from './territorio.js';
import { normalizeName } from './validation.js';

export const REQUISITOS = Object.freeze({
  basicos: 'Servicios básicos (luz y baño privado)',
  aire: 'Aire acondicionado',
  agua: 'Agua corriente',
  cama: 'Cama cómoda',
  higiene: 'Buena higiene',
  parqueo: 'Parqueo',
  seguridad: 'Zona y acceso seguros',
});
const CLAVES = Object.keys(REQUISITOS);
const sin = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;

/** Qué requisitos le faltan a un hotel (los no confirmados cuentan como faltantes). */
export function requisitosFaltantes(h) { return CLAVES.filter((k) => h?.requisitos?.[k] !== true); }
export const cumpleTodo = (h) => requisitosFaltantes(h).length === 0;

/** ITBIS de la DGII. */
export const ITBIS = 0.18;
/**
 * Precio por noche que se usa en los viáticos: si el hotel emite comprobante fiscal y su precio NO incluye el
 * ITBIS, se le suma el 18%. Si no emite comprobante, o el precio ya lo incluye, es el precio tal cual. null sin precio.
 */
export function precioFinal(h) {
  const p = Number(h?.precioNoche);
  if (!(p > 0)) return null;
  return h.comprobanteFiscal === true && h.precioIncluyeItbis === false ? Math.round(p * (1 + ITBIS) * 100) / 100 : Math.round(p * 100) / 100;
}
/**
 * Elige el hotel recomendado: activo, con precio confirmado y que cumple todos los requisitos.
 * Prefiere el mismo municipio; si no hay, la misma provincia. Entre esos, el más económico;
 * a igual precio, el de mejor calificación. Devuelve { hotel, alcance } o null.
 */
export function elegirHotel(hoteles, provincia, municipio) {
  const aptos = hoteles.filter((h) => h.estado !== 'inactivo' && h.provincia === provincia && Number(h.precioNoche) > 0 && cumpleTodo(h));
  const orden = (a, b) => precioFinal(a) - precioFinal(b) || (Number(b.calificacion) || 0) - (Number(a.calificacion) || 0) || a.nombre.localeCompare(b.nombre, 'es');
  const mismo = aptos.filter((h) => h.municipio === municipio).sort(orden);
  if (municipio && mismo.length) return { hotel: mismo[0], alcance: 'municipio' };
  const prov = aptos.sort(orden);
  return prov.length ? { hotel: prov[0], alcance: 'provincia' } : null;
}

export function createHoteles({ data, audit, now = () => new Date() }) {
  const activo = (a) => a?.status === STATUS.ACTIVO;
  const gestion = (a) => activo(a) && ['administrador', 'gerencia'].includes(a.role);
  const permitir = (ok, msg = 'No tienes permiso para esta acción.') => { if (!ok) throw new HttpError(403, msg); };
  const invalido = (fields) => { throw new HttpError(422, 'Revisa los campos marcados.', fields); };
  const vista = (h) => { const pf = precioFinal(h); return { ...h, faltan: requisitosFaltantes(h), cumple: cumpleTodo(h), precioFinal: pf, itbis: pf != null && h.precioNoche ? Math.round((pf - Number(h.precioNoche)) * 100) / 100 : 0 }; };

  async function crear(actor, input, { fuente = 'manual' } = {}) {
    permitir(gestion(actor), 'Solo la administración o la gerencia registran hoteles.');
    const e = {};
    const nombre = normalizeName(input.nombre);
    if (nombre.length < 2) e.nombre = 'Escribe el nombre del hotel.';
    const provincia = provinciaOficial(input.provincia);
    if (!provincia) e.provincia = 'Elige una provincia oficial.';
    const municipio = provincia && municipioOficial(provincia, input.municipio);
    if (provincia && !municipio) e.municipio = `Ese municipio no pertenece a ${provincia}.`;
    if (Object.keys(e).length) invalido(e);
    // El mismo lugar de Google solo se registra una vez (aunque se busque desde otro municipio).
    const mismo = fuente === 'google' && input.placeId ? (await data.list('hoteles')).find((h) => h.placeId === input.placeId) : null;
    if (mismo) throw new HttpError(409, `${mismo.nombre} ya está registrado en ${mismo.municipio}, ${mismo.provincia}.`, { nombre: 'Ya está registrado.' });
    const todos = await data.list('hoteles', { municipio });
    if (todos.some((h) => sin(h.nombre) === sin(nombre))) throw new HttpError(409, `${nombre} ya está registrado en ${municipio}.`, { nombre: 'Ya existe en este municipio.' });
    const ok = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
    const h = await data.insert('hoteles', {
      nombre, provincia, municipio, direccion: normalizeName(input.direccion) || null, telefono: normalizeName(input.telefono) || null,
      lat: fuente === 'google' ? ok(input.lat) : null, lng: fuente === 'google' ? ok(input.lng) : null, placeId: fuente === 'google' ? input.placeId ?? null : null,
      calificacion: fuente === 'google' ? ok(input.calificacion) : null, fuente, precioNoche: null, requisitos: {}, notas: null, estado: 'activo', creadoPor: actor.id,
    });
    await audit({ actorId: actor.id, action: 'hotel_creado', entity: 'hotel', entityId: h.id, after: { nombre, municipio, fuente } });
    return vista(h);
  }

  async function listar(actor, { provincia, municipio } = {}) {
    permitir(activo(actor));
    let xs = await data.list('hoteles', municipio ? { municipio } : {});
    if (provincia) xs = xs.filter((h) => h.provincia === provincia);
    if (!gestion(actor)) xs = xs.filter((h) => h.estado !== 'inactivo');
    return xs.map(vista).sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es') || (Number(a.precioNoche) || 1e9) - (Number(b.precioNoche) || 1e9));
  }

  /** La administración confirma precio por noche y requisitos. Queda auditado (antes y después). */
  async function actualizar(actor, id, input) {
    permitir(gestion(actor), 'Solo la administración o la gerencia confirman precio y requisitos.');
    const h = await data.get('hoteles', id);
    if (!h) throw new HttpError(404, 'El hotel no existe.');
    const e = {}; const cambios = {};
    if (input.precioNoche !== undefined) {
      const p = input.precioNoche === null || input.precioNoche === '' ? null : Number(input.precioNoche);
      if (p !== null && (!Number.isFinite(p) || p <= 0 || p > 100000)) e.precioNoche = 'Escribe el precio por noche en RD$.';
      else cambios.precioNoche = p === null ? null : r2(p);
    }
    if (input.requisitos !== undefined) {
      cambios.requisitos = Object.fromEntries(CLAVES.map((k) => [k, input.requisitos?.[k] === true]));
    }
    if (input.notas !== undefined) cambios.notas = normalizeName(input.notas).slice(0, 300) || null;
    if (input.nombre !== undefined) {
      const n = normalizeName(input.nombre);
      if (n.length < 2 || n.length > 160) e.nombre = 'Escribe el nombre del hotel.'; else if (n !== h.nombre) cambios.nombre = n;
    }
    if (input.telefono !== undefined) {
      const t = normalizeName(input.telefono);
      if (t && !/^[\d\s()+-]{7,20}$/.test(t)) e.telefono = 'Escribe un teléfono válido o déjalo vacío.'; else cambios.telefono = t || null;
    }
    if (input.comprobanteFiscal !== undefined) {
      const si = input.comprobanteFiscal === true || input.comprobanteFiscal === 'true';
      cambios.comprobanteFiscal = si;
      if (!si) cambios.precioIncluyeItbis = null;
      else if (input.precioIncluyeItbis === undefined || input.precioIncluyeItbis === null || input.precioIncluyeItbis === '') e.precioIncluyeItbis = 'Indica si el precio ya incluye el ITBIS.';
      else cambios.precioIncluyeItbis = input.precioIncluyeItbis === true || input.precioIncluyeItbis === 'true';
    }
    if (input.desayunoIncluido !== undefined) {
      const si = input.desayunoIncluido === true || input.desayunoIncluido === 'true';
      cambios.desayunoIncluido = si;
      // El valor es opcional: si el representante tiene su desayuno en la comida desglosada, se rebaja ese.
      const vacio = input.valorDesayuno == null || input.valorDesayuno === '';
      const v = Number(input.valorDesayuno);
      if (si && !vacio && (!Number.isFinite(v) || v <= 0 || v > 5000)) e.valorDesayuno = 'Escribe el valor del desayuno en RD$ o déjalo vacío.';
      else cambios.valorDesayuno = si && !vacio ? r2(v) : null;
    }
    // Corregir dónde está (por ejemplo, Google lo trajo en otro municipio).
    if (input.provincia !== undefined || input.municipio !== undefined) {
      const prov = provinciaOficial(input.provincia ?? h.provincia);
      const mun = prov && municipioOficial(prov, input.municipio ?? h.municipio);
      if (!prov) e.provincia = 'Elige una provincia oficial.';
      else if (!mun) e.municipio = `Ese municipio no pertenece a ${prov}.`;
      else if (mun !== h.municipio || prov !== h.provincia) {
        const dup = (await data.list('hoteles', { municipio: mun })).find((x) => x.id !== h.id && sin(x.nombre) === sin(cambios.nombre ?? h.nombre));
        if (dup) e.municipio = `Ya hay un hotel con ese nombre en ${mun}.`; else { cambios.provincia = prov; cambios.municipio = mun; }
      }
    }
    if (input.direccion !== undefined) cambios.direccion = normalizeName(input.direccion).slice(0, 200) || null;
    if (input.estado !== undefined) {
      if (!['activo', 'inactivo'].includes(input.estado)) e.estado = 'Estado no válido.'; else cambios.estado = input.estado;
    }
    if (Object.keys(e).length) invalido(e);
    if (!Object.keys(cambios).length) return vista(h);
    const out = await data.update('hoteles', id, { ...cambios, verificadoPor: actor.id, verificadoEn: now().toISOString() });
    await audit({ actorId: actor.id, action: 'hotel_verificado', entity: 'hotel', entityId: id,
      before: { precioNoche: h.precioNoche ?? null, requisitos: h.requisitos ?? {}, estado: h.estado, ...('desayunoIncluido' in cambios ? { desayunoIncluido: h.desayunoIncluido ?? false, valorDesayuno: h.valorDesayuno ?? null } : {}), ...('municipio' in cambios ? { provincia: h.provincia, municipio: h.municipio } : {}), ...('comprobanteFiscal' in cambios ? { comprobanteFiscal: h.comprobanteFiscal ?? false, precioIncluyeItbis: h.precioIncluyeItbis ?? null } : {}), ...(cambios.nombre ? { nombre: h.nombre } : {}), ...('telefono' in cambios ? { telefono: h.telefono ?? null } : {}) }, after: cambios });
    return vista(out);
  }

  /** Quitar (no usar) o volver a usar varios hoteles a la vez. Nada se borra: el historial de hospedajes se conserva. */
  async function estadoLote(actor, ids, estado) {
    permitir(gestion(actor), 'Solo la administración o la gerencia cambian hoteles.');
    if (!['activo', 'inactivo'].includes(estado)) invalido({ estado: 'Estado no válido.' });
    const lista = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!lista.length) invalido({ ids: 'Elige al menos un hotel.' });
    if (lista.length > 500) invalido({ ids: 'Máximo 500 hoteles por vez.' });
    let n = 0;
    for (const id of lista) {
      const h = await data.get('hoteles', id);
      if (!h || h.estado === estado) continue;
      await data.update('hoteles', id, { estado });
      await audit({ actorId: actor.id, action: estado === 'inactivo' ? 'hotel_quitado' : 'hotel_reactivado', entity: 'hotel', entityId: id, before: { estado: h.estado }, after: { estado } });
      n++;
    }
    return { cambiados: n };
  }

  async function recomendado(actor, { provincia, municipio }) {
    permitir(activo(actor));
    const p = provinciaOficial(provincia);
    if (!p) invalido({ provincia: 'Elige una provincia oficial.' });
    const m = municipio ? municipioOficial(p, municipio) : null;
    const r = elegirHotel(await data.list('hoteles'), p, m);
    return r ? { hotel: vista(r.hotel), alcance: r.alcance } : null;
  }

  /** Para el hospedaje de una jornada: el hotel elegido debe cumplir todo y su precio sale de aquí, no del navegador. */
  async function paraHospedaje(id) {
    const h = await data.get('hoteles', String(id));
    if (!h || h.estado === 'inactivo') throw new HttpError(422, 'Ese hotel no está disponible.', { 'hospedaje.hotelId': 'Elige otro hotel.' });
    if (!(Number(h.precioNoche) > 0) || !cumpleTodo(h)) throw new HttpError(422, `${h.nombre} todavía no tiene precio y requisitos confirmados.`, { 'hospedaje.hotelId': 'Elige un hotel verificado.' });
    return h;
  }

  return { crear, listar, actualizar, estadoLote, recomendado, paraHospedaje };
}

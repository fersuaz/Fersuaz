// Rutas y viáticos (prompt maestro, módulos 6, 7, 9 a 13).
// Reglas: el salario no entra; nada se inventa (si falta un dato, se dice cuál); el hotel nunca se aprueba solo;
// los movimientos aprobados no se borran; los km son estimados manuales hasta conectar un proveedor de mapas.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';
import { calcularCombustible, calcularAlimentacion, calcularHospedaje, calcularPresupuesto, detectarDuplicados, aplicarTope } from './calculos.js';
import { esFechaISO, hoyRD } from './periodos.js';
import { normalizeName } from './validation.js';
import { guardarAdjunto } from './adjuntos.js';
import { dentroDeZona } from './territorio.js';
import { proponer, diasLaborables } from './propuesta-cronograma.js';

const COMBUSTIBLES = ['gasolina_premium', 'gasolina_regular', 'gasoil_optimo', 'gasoil_regular', 'glp', 'hibrido', 'electrico'];
export const COMBUSTIBLE_LABEL = {
  gasolina_premium: 'Gasolina premium', gasolina_regular: 'Gasolina regular', gasoil_optimo: 'Gasoil óptimo',
  gasoil_regular: 'Gasoil regular', glp: 'GLP', hibrido: 'Híbrido (gasolina)', electrico: 'Eléctrico',
};
// Un híbrido consume gasolina: se presupuesta con el precio de la gasolina que indique su perfil.
const CATEGORIAS_GASTO = ['combustible', 'alimentacion', 'hospedaje', 'peajes', 'estacionamiento', 'otros'];

const activo = (u) => u && u.status === STATUS.ACTIVO;
const rol = (u, roles) => activo(u) && roles.includes(u.role);
const esRep = (u) => activo(u) && u.role === 'representante';
const VEN_PERFIL = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
const permitir = (c, m = 'No tienes permiso para esta acción.') => { if (!c) throw new HttpError(403, m); };
const invalido = (f) => { throw new HttpError(422, 'Revisa los campos marcados.', f); };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => (v === '' || v == null ? null : Number(v));

export function createViaticos({ data, users, files, audit, mapas, notificar, hoteles, now = () => new Date() }) {
  const hoy = () => hoyRD(now());
  async function rep(id) {
    const u = await users.findUserById(id);
    if (!u || u.role !== 'representante') throw new HttpError(404, 'Ese representante no existe.');
    return u;
  }
  async function perfilDe(id) { return (await data.list('perfiles', { representanteId: id }))[0] ?? null; }
  function ocultarDireccion(actor, p) {
    if (!p) return p;
    const puede = actor.id === p.representanteId || rol(actor, ['administrador', 'gerencia']);
    return puede ? p : { ...p, residencia: p.residencia ? { provincia: p.residencia.provincia, municipio: p.residencia.municipio } : null };
  }

  // ------------------------------------------------------------ perfiles
  async function guardarPerfil(actor, representanteId, input) {
    permitir(rol(actor, ['administrador', 'gerencia', 'supervisor']), 'Solo la gerencia o los supervisores configuran perfiles de viático.');
    await rep(representanteId);
    const e = {};
    const res = input.residencia ?? {};
    const residencia = { provincia: normalizeName(res.provincia), municipio: normalizeName(res.municipio), direccion: normalizeName(res.direccion) || null };
    if (!residencia.provincia) e['residencia.provincia'] = 'Escribe la provincia de residencia.';
    if (!residencia.municipio) e['residencia.municipio'] = 'Escribe el municipio de residencia.';
    const v = input.vehiculo ?? {};
    const vehiculo = {
      propiedad: v.propiedad, marca: normalizeName(v.marca) || null, modelo: normalizeName(v.modelo) || null,
      anio: num(v.anio), combustible: v.combustible, rendimiento: num(v.rendimiento), placa: normalizeName(v.placa) || null,
      combustibleHibrido: v.combustible === 'hibrido' ? (v.combustibleHibrido || 'gasolina_regular') : null,
    };
    if (!['propio', 'asignado'].includes(vehiculo.propiedad)) e['vehiculo.propiedad'] = 'Elige si el vehículo es propio o asignado.';
    if (!COMBUSTIBLES.includes(vehiculo.combustible)) e['vehiculo.combustible'] = 'Elige el tipo de combustible.';
    if (vehiculo.combustible !== 'electrico' && (!Number.isFinite(vehiculo.rendimiento) || vehiculo.rendimiento <= 0 || vehiculo.rendimiento > 200)) e['vehiculo.rendimiento'] = 'Escribe el rendimiento real en km por galón.';
    if (vehiculo.anio != null && (!Number.isInteger(vehiculo.anio) || vehiculo.anio < 1980 || vehiculo.anio > Number(hoy().slice(0, 4)) + 1)) e['vehiculo.anio'] = 'Año no válido.';
    const tarifaAlimentacion = num(input.tarifaAlimentacion);
    if (!Number.isFinite(tarifaAlimentacion) || tarifaAlimentacion < 0) e.tarifaAlimentacion = 'Escribe la tarifa diaria de alimentación en RD$.';
    const reembolsoPorKm = num(input.reembolsoPorKm);
    if (reembolsoPorKm != null && (!Number.isFinite(reembolsoPorKm) || reembolsoPorKm <= 0)) e.reembolsoPorKm = 'Escribe un monto por km mayor que cero, o déjalo vacío.';
    if (reembolsoPorKm != null && vehiculo.propiedad !== 'propio') e.reembolsoPorKm = 'El reembolso por km solo aplica a vehículos propios.';
    const topeCombustible = num(input.topeCombustible);
    if (topeCombustible != null && (!Number.isFinite(topeCombustible) || topeCombustible <= 0)) e.topeCombustible = 'Escribe un tope mensual mayor que cero, o déjalo vacío para usar el global.';
    if (Object.keys(e).length) invalido(e);
    const antes = await perfilDe(representanteId);
    const datos = { representanteId, residencia, vehiculo, tarifaAlimentacion: r2(tarifaAlimentacion), reembolsoPorKm: reembolsoPorKm == null ? null : r2(reembolsoPorKm), topeCombustible: topeCombustible == null ? null : r2(topeCombustible), actualizadoPor: actor.id };
    const p = antes ? await data.update('perfiles', antes.id, datos) : await data.insert('perfiles', datos);
    await audit({ actorId: actor.id, action: 'perfil_viatico_guardado', entity: 'perfil_viatico', entityId: p.id,
      before: antes ? { vehiculo: antes.vehiculo, tarifaAlimentacion: antes.tarifaAlimentacion, reembolsoPorKm: antes.reembolsoPorKm, topeCombustible: antes.topeCombustible ?? null } : null,
      after: { vehiculo, tarifaAlimentacion: datos.tarifaAlimentacion, reembolsoPorKm: datos.reembolsoPorKm, topeCombustible: datos.topeCombustible } });
    return p;
  }
  async function verPerfil(actor, representanteId) {
    permitir(actor.id === representanteId || rol(actor, VEN_PERFIL));
    return ocultarDireccion(actor, await perfilDe(representanteId));
  }
  async function listarRepresentantes(actor) {
    permitir(rol(actor, VEN_PERFIL));
    const reps = (await users.listUsers()).filter((u) => u.role === 'representante' && u.status === 'activo');
    const out = [];
    for (const u of reps) out.push({ id: u.id, fullName: u.fullName, position: u.position, perfil: ocultarDireccion(actor, await perfilDe(u.id)) });
    return out;
  }

  // ------------------------------------------------------------ precios de combustible
  async function registrarPrecio(actor, input) {
    permitir(rol(actor, ['administrador', 'gerencia', 'finanzas']), 'Solo finanzas o la gerencia registran precios de combustible.');
    const e = {};
    if (!COMBUSTIBLES.includes(input.combustible) || ['hibrido', 'electrico'].includes(input.combustible)) e.combustible = 'Elige el combustible.';
    const p = num(input.precioGalon);
    if (!Number.isFinite(p) || p <= 0 || p > 5000) e.precioGalon = 'Escribe el precio por galón en RD$.';
    if (!esFechaISO(input.vigenteDesde)) e.vigenteDesde = 'Elige desde cuándo rige el precio.';
    if (Object.keys(e).length) invalido(e);
    if ((await data.list('precios', { combustible: input.combustible })).some((x) => x.vigenteDesde === input.vigenteDesde)) {
      throw new HttpError(409, 'Ya hay un precio para ese combustible en esa fecha.', { vigenteDesde: 'Ya existe un precio con esa fecha.' });
    }
    const out = await data.insert('precios', { combustible: input.combustible, precioGalon: r2(p), vigenteDesde: input.vigenteDesde, fuente: 'manual', registradoPor: actor.id });
    await audit({ actorId: actor.id, action: 'precio_combustible', entity: 'precio', entityId: out.id, after: out });
    return out;
  }
  async function precioVigente(combustible, fecha) {
    const ps = (await data.list('precios', { combustible })).filter((p) => p.vigenteDesde <= fecha).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
    return ps[0] ?? null;
  }

  // ------------------------------------------------------------ jornadas (rutas)
  function validarJornada(input, e) {
    const paradas = (Array.isArray(input.paradas) ? input.paradas : []).map((p) => ({
      lugar: normalizeName(p.lugar), municipio: normalizeName(p.municipio), provincia: normalizeName(p.provincia),
      ...(p.refId && ['establecimiento', 'farmacia'].includes(p.refTipo) ? { refTipo: p.refTipo, refId: String(p.refId) } : {}),
      ...(Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : {}),
    }));
    if (!paradas.length) e.paradas = 'Agrega al menos una parada.';
    paradas.forEach((p, i) => {
      if (!p.lugar) e[`paradas.${i}.lugar`] = 'Escribe el lugar.';
      if (!p.municipio) e[`paradas.${i}.municipio`] = 'Escribe el municipio.';
      if (!p.provincia) e[`paradas.${i}.provincia`] = 'Escribe la provincia.';
    });
    const km = num(input.kmEstimados);
    if (!Number.isFinite(km) || km < 0 || km > 2000) e.kmEstimados = 'Escribe los km por carretera (ida, paradas y regreso) o calcúlalos con el mapa.';
    const monto = (k) => { const v = num(input[k]) ?? 0; if (!Number.isFinite(v) || v < 0) e[k] = 'Escribe un monto válido o déjalo en 0.'; return r2(v || 0); };
    let hospedaje = null;
    if (input.hospedaje) {
      const hsp = input.hospedaje;
      const noches = Number(hsp.noches); const tarifa = num(hsp.tarifaNoche); const cargos = num(hsp.cargos) ?? 0;
      if (!Number.isInteger(noches) || noches < 1 || noches > 31) e['hospedaje.noches'] = 'Escribe las noches.';
      if (!Number.isFinite(tarifa) || tarifa <= 0) e['hospedaje.tarifaNoche'] = 'Escribe la tarifa por noche.';
      if (!Number.isFinite(cargos) || cargos < 0) e['hospedaje.cargos'] = 'Impuestos y cargos no válidos.';
      const motivo = normalizeName(hsp.motivo);
      if (motivo.length < 3) e['hospedaje.motivo'] = 'Explica por qué hace falta el hotel.';
      hospedaje = { noches, tarifaNoche: r2(tarifa || 0), cargos: r2(cargos || 0), hotel: normalizeName(hsp.hotel) || null, municipio: normalizeName(hsp.municipio) || paradas.at(-1)?.municipio || null, motivo, estado: 'propuesto' };
    }
    const kmFuente = input.kmFuente === 'google' ? 'google' : 'manual';
    return { paradas, kmEstimados: r2(km || 0), kmFuente, conAlimentacion: input.conAlimentacion !== false, hospedaje, peajes: monto('peajes'), estacionamiento: monto('estacionamiento'), otros: monto('otros') };
  }
  // ------------------------------------------------------------ cronogramas (los crea y aprueba el administrador)
  const MAX_LUGARES = 15;
  async function lugarDe(ref) {
    const col = ref?.refTipo === 'farmacia' ? 'farmacias' : ref?.refTipo === 'establecimiento' ? 'establecimientos' : null;
    const x = col && ref.refId && (await data.get(col, String(ref.refId)));
    if (!x || ['inactivo', 'inactiva'].includes(x.estado)) return null;
    return { refTipo: ref.refTipo, refId: x.id, lugar: x.nombre, municipio: x.municipio, provincia: x.provincia, ...(x.lat != null && x.lng != null ? { lat: Number(x.lat), lng: Number(x.lng) } : {}) };
  }
  /** Valida un día de cronograma sin guardarlo. Devuelve { rep, fechas, lugares, nota }. */
  async function prepararCronograma(actor, input) {
    permitir(rol(actor, ['administrador']), 'Solo el administrador crea cronogramas.');
    const rep = await users.findUserById(String(input.representanteId ?? ''));
    if (!rep || rep.role !== 'representante' || rep.status !== 'activo') throw new HttpError(404, 'El representante no existe o no está activo.');
    const e = {};
    const fechas = [...new Set((Array.isArray(input.fechas) ? input.fechas : [input.fecha]).filter(Boolean).map(String))].sort();
    if (!fechas.length || fechas.some((f) => !esFechaISO(f))) e.fechas = 'Elige al menos una fecha.';
    else if (fechas.length > 31) e.fechas = 'Máximo 31 fechas por vez.';
    else if (fechas[0] < `${hoy().slice(0, 7)}-01`) e.fechas = 'Solo se programan fechas desde el inicio del mes en curso.';
    const refs = Array.isArray(input.lugares) ? input.lugares : [];
    if (!refs.length) e.lugares = 'Agrega al menos un lugar.';
    else if (refs.length > MAX_LUGARES) e.lugares = `Máximo ${MAX_LUGARES} lugares por día.`;
    if (Object.keys(e).length) invalido(e);
    const zonaRep = (await data.list('zonas', { representanteId: rep.id }))[0] ?? null;
    if (!zonaRep?.provincias?.length) throw new HttpError(409, `${rep.fullName} no tiene provincias asignadas. Asígnalas antes de programar su cronograma.`);
    const lugares = [];
    for (const r of refs) {
      const l = await lugarDe(r);
      if (!l) invalido({ lugares: 'Uno de los lugares ya no existe en el catálogo.' });
      if (!dentroDeZona(zonaRep, l.provincia, l.municipio)) invalido({ lugares: `${l.lugar} está en ${l.municipio}, ${l.provincia}, fuera de la zona de ${rep.fullName}.` });
      if (lugares.some((x) => x.refId === l.refId)) continue;
      lugares.push(l);
    }
    const ya = (await data.list('cronogramas', { representanteId: rep.id })).filter((c) => c.estado === 'aprobado' && fechas.includes(c.fecha)).map((c) => c.fecha);
    if (ya.length) throw new HttpError(409, `Ya hay cronograma aprobado para: ${ya.join(', ')}. Anúlalo primero si quieres cambiarlo.`, { fechas: 'Hay fechas ya programadas.' });
    return { rep, fechas, lugares, nota: normalizeName(input.nota) || null };
  }
  async function crearCronograma(actor, input) {
    const { rep, fechas, lugares, nota } = await prepararCronograma(actor, input);
    const creados = [];
    for (const fecha of fechas) creados.push(await data.insert('cronogramas', { representanteId: rep.id, fecha, lugares, nota, estado: 'aprobado', creadoPor: actor.id }));
    await audit({ actorId: actor.id, action: 'cronograma_aprobado', entity: 'user', entityId: rep.id, after: { fechas, lugares: lugares.map((l) => l.lugar) } });
    await notificar?.(rep.id, { tipo: 'cronograma', titulo: 'Nuevo cronograma', texto: `Tienes ${fechas.length} día(s) programado(s) desde el ${fechas[0]}.`, enlace: '#jornadas' });
    return creados;
  }
  /** Aprueba varios días distintos de una vez (la propuesta del mes): se valida todo antes de guardar nada. */
  async function crearCronogramaLote(actor, { representanteId, dias, nota }) {
    if (!Array.isArray(dias) || !dias.length) invalido({ dias: 'No hay días para aprobar.' });
    if (dias.length > 31) invalido({ dias: 'Máximo 31 días por vez.' });
    const fechas = dias.map((d) => String(d.fecha));
    if (new Set(fechas).size !== fechas.length) invalido({ dias: 'Hay días repetidos.' });
    const listos = [];
    for (const d of dias) listos.push(await prepararCronograma(actor, { representanteId, fechas: [d.fecha], lugares: d.lugares, nota }));
    const rep = listos[0].rep; const creados = [];
    for (const x of listos) creados.push(await data.insert('cronogramas', { representanteId: rep.id, fecha: x.fechas[0], lugares: x.lugares, nota: x.nota, estado: 'aprobado', creadoPor: actor.id }));
    await audit({ actorId: actor.id, action: 'cronograma_aprobado', entity: 'user', entityId: rep.id, after: { fechas: fechas.sort(), lugares: listos.reduce((n, x) => n + x.lugares.length, 0), origen: 'propuesta' } });
    await notificar?.(rep.id, { tipo: 'cronograma', titulo: 'Nuevo cronograma', texto: `Tienes ${creados.length} día(s) programado(s) desde el ${fechas.sort()[0]}.`, enlace: '#jornadas' });
    return creados;
  }
  /**
   * Propuesta del mes para un representante: lugares de su zona que aún no están programados ese mes,
   * repartidos en los días laborables libres, por municipio y cercanía. No guarda nada.
   */
  async function proponerCronograma(actor, { representanteId, mes, porDia = 8, sabados = false }) {
    permitir(rol(actor, ['administrador']), 'Solo el administrador crea cronogramas.');
    const rep = await users.findUserById(String(representanteId ?? ''));
    if (!rep || rep.role !== 'representante' || rep.status !== 'activo') throw new HttpError(404, 'El representante no existe o no está activo.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes)) || mes < hoy().slice(0, 7)) invalido({ mes: 'Elige el mes en curso o uno futuro.' });
    const n = Number(porDia);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LUGARES) invalido({ porDia: `Escribe entre 1 y ${MAX_LUGARES} lugares por día.` });
    const zona = (await data.list('zonas', { representanteId: rep.id }))[0] ?? null;
    if (!zona?.provincias?.length) throw new HttpError(409, `${rep.fullName} no tiene provincias asignadas. Asígnalas antes de programar su cronograma.`);
    const crons = (await data.list('cronogramas', { representanteId: rep.id })).filter((c) => c.estado === 'aprobado' && c.fecha.startsWith(mes));
    const programados = new Set(crons.flatMap((c) => c.lugares.map((l) => `${l.refTipo}:${l.refId}`)));
    const activo = (x) => !['inactivo', 'inactiva'].includes(x.estado);
    const aRef = (refTipo) => (x) => ({ refTipo, refId: x.id, lugar: x.nombre, provincia: x.provincia, municipio: x.municipio, tipo: refTipo === 'farmacia' ? 'farmacia' : x.tipo, ...(x.lat != null && x.lng != null ? { lat: Number(x.lat), lng: Number(x.lng) } : {}) });
    const lugares = [
      ...(await data.list('farmacias')).filter((x) => activo(x) && dentroDeZona(zona, x.provincia, x.municipio)).map(aRef('farmacia')),
      ...(await data.list('establecimientos')).filter((x) => activo(x) && dentroDeZona(zona, x.provincia, x.municipio)).map(aRef('establecimiento')),
    ].filter((l) => !programados.has(`${l.refTipo}:${l.refId}`));
    const fechas = diasLaborables(mes, { desde: hoy(), excluir: crons.map((c) => c.fecha), sabados: sabados === true || sabados === 'true' });
    const perfil = await perfilDe(rep.id);
    const r = proponer({ lugares, residencia: perfil?.residencia, fechas, porDia: n });
    return {
      representanteId: rep.id, mes, porDia: n, dias: r.dias, sinDia: r.sinDia,
      resumen: { lugares: lugares.length, yaProgramados: programados.size, diasLibres: fechas.length, diasPropuestos: r.dias.length, sinUbicacion: lugares.filter((l) => l.lat == null).length },
      sinResidencia: !perfil,
    };
  }
  async function listarCronogramas(actor, { representanteId, mes } = {}) {
    const id = esRep(actor) ? actor.id : representanteId;
    permitir(esRep(actor) || rol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas']));
    let xs = id ? await data.list('cronogramas', { representanteId: id }) : await data.list('cronogramas');
    if (mes) xs = xs.filter((c) => c.fecha.startsWith(mes));
    if (esRep(actor)) xs = xs.filter((c) => c.estado === 'aprobado');
    const jornadas = id ? await data.list('jornadas', { representanteId: id }) : await data.list('jornadas');
    return xs.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((c) => ({ ...c, jornadaId: jornadas.find((j) => j.cronogramaId === c.id && j.estado !== 'cancelada')?.id ?? null }));
  }
  async function anularCronograma(actor, id, motivo) {
    permitir(rol(actor, ['administrador']), 'Solo el administrador anula cronogramas.');
    const c = await data.get('cronogramas', id);
    if (!c) throw new HttpError(404, 'El cronograma no existe.');
    if (c.estado !== 'aprobado') throw new HttpError(409, 'Ese cronograma ya está anulado.');
    const m = normalizeName(motivo); if (!m || m.length < 3) invalido({ motivo: 'Escribe el motivo.' });
    if ((await data.list('jornadas', { representanteId: c.representanteId })).some((j) => j.cronogramaId === id && j.estado !== 'cancelada')) {
      throw new HttpError(409, 'El representante ya creó su jornada de ese día. Cancela la jornada primero.');
    }
    const out = await data.update('cronogramas', id, { estado: 'anulado', motivo: m });
    await audit({ actorId: actor.id, action: 'cronograma_anulado', entity: 'cronograma', entityId: id, before: { estado: c.estado }, after: { estado: 'anulado', motivo: m } });
    await notificar?.(c.representanteId, { tipo: 'cronograma', titulo: 'Cronograma anulado', texto: `El cronograma del ${c.fecha} fue anulado: ${m}`, enlace: '#jornadas' });
    return out;
  }
  /** Paradas del cronograma en el orden que menos recorre: Google Routes si está conectado; si no, el orden del administrador. */
  async function rutaDeCronograma(actor, cronogramaId) {
    const c = await data.get('cronogramas', String(cronogramaId ?? ''));
    if (!c || c.representanteId !== actor.id || c.estado !== 'aprobado') throw new HttpError(404, 'No tienes un cronograma aprobado con ese id.');
    const lugares = [];
    for (const l of c.lugares) lugares.push((await lugarDe(l)) ?? l);
    if (!mapas?.activo) return { cronograma: c, paradas: lugares, km: null, kmFuente: 'manual', optimizado: false };
    const perfil = await perfilDe(actor.id);
    if (!perfil?.residencia?.municipio) throw new HttpError(409, 'Tu perfil no tiene residencia registrada. Pide a tu supervisor que la complete.');
    let r;
    try { r = await mapas.ruta(perfil.residencia, lugares, { regresar: true, optimizar: true }); } catch (err) { throw new HttpError(502, err.message); }
    const orden = Array.isArray(r.orden) && r.orden.length === lugares.length ? r.orden : lugares.map((_, i) => i);
    return { cronograma: c, paradas: orden.map((i) => lugares[i]), km: r.km, minutos: r.minutos, kmFuente: 'google', optimizado: lugares.length > 1 };
  }

  async function crearJornada(actor, input) {
    permitir(esRep(actor), 'Solo los representantes planifican jornadas.');
    const e = {};
    // La jornada sale del cronograma aprobado por el administrador: fecha y lugares no los decide el representante.
    if (!input.cronogramaId) throw new HttpError(422, 'Elige el día de tu cronograma aprobado.', { cronogramaId: 'Elige un día del cronograma.' });
    const ruta = await rutaDeCronograma(actor, input.cronogramaId);
    input = { ...input, fecha: ruta.cronograma.fecha, paradas: ruta.paradas };
    // Con mapa, los km son los del servidor; nunca la cifra que envía el navegador.
    // Hotel del catálogo: nombre, municipio y precio por noche salen del hotel verificado, no del navegador.
    let hotel = null;
    if (input.hospedaje?.hotelId && hoteles) {
      hotel = await hoteles.paraHospedaje(input.hospedaje.hotelId);
      input = { ...input, hospedaje: { ...input.hospedaje, tarifaNoche: hotel.precioNoche, hotel: hotel.nombre, municipio: hotel.municipio } };
    }
    const entrada = ruta.km != null ? { ...input, kmEstimados: ruta.km, kmFuente: 'google' } : { ...input, kmFuente: 'manual' };
    const d = validarJornada(entrada, e);
    if (hotel && d.hospedaje) d.hospedaje = { ...d.hospedaje, hotelId: hotel.id };
    if (Object.keys(e).length) invalido(e);
    if ((await data.list('jornadas', { representanteId: actor.id, fecha: input.fecha })).some((j) => j.estado !== 'cancelada')) {
      throw new HttpError(409, 'Ya tienes una jornada ese día. Edítala en vez de crear otra.', { fecha: 'Ya hay una jornada ese día.' });
    }
    if (await presupuestoBloqueado(actor.id, input.fecha.slice(0, 7))) throw new HttpError(409, 'El presupuesto de ese mes ya fue solicitado; pide a la gerencia que lo devuelva para cambiar jornadas.');
    const j = await data.insert('jornadas', { representanteId: actor.id, cronogramaId: ruta.cronograma.id, fecha: input.fecha, ...d, kmReales: null, estado: 'planificada' });
    await audit({ actorId: actor.id, action: 'jornada_planificada', entity: 'jornada', entityId: j.id, after: { fecha: j.fecha, km: j.kmEstimados } });
    return j;
  }
  async function presupuestoBloqueado(repId, mes) {
    const p = (await data.list('presupuestos', { representanteId: repId, mes }))[0];
    return p && p.estado !== 'borrador' && p.estado !== 'rechazado';
  }
  async function actualizarJornada(actor, id, accion, input = {}) {
    const j = await data.get('jornadas', id);
    if (!j) throw new HttpError(404, 'La jornada no existe.');
    permitir(actor.id === j.representanteId || rol(actor, ['administrador', 'gerencia', 'supervisor']));
    if (accion === 'realizada') {
      const km = num(input.kmReales);
      if (!Number.isFinite(km) || km < 0 || km > 2000) invalido({ kmReales: 'Escribe los km reales según el odómetro.' });
      if (j.fecha > hoy()) throw new HttpError(409, 'No puedes marcar como realizada una jornada futura.');
      const out = await data.update('jornadas', id, { kmReales: r2(km), estado: 'realizada' });
      await audit({ actorId: actor.id, action: 'jornada_realizada', entity: 'jornada', entityId: id, before: { estado: j.estado }, after: { kmReales: r2(km) } });
      return out;
    }
    if (accion === 'cancelar') {
      if (j.estado !== 'planificada') throw new HttpError(409, 'Solo se cancelan jornadas planificadas.');
      if (await presupuestoBloqueado(j.representanteId, j.fecha.slice(0, 7))) throw new HttpError(409, 'El presupuesto de ese mes ya fue solicitado.');
      const out = await data.update('jornadas', id, { estado: 'cancelada' });
      await audit({ actorId: actor.id, action: 'jornada_cancelada', entity: 'jornada', entityId: id, before: { estado: j.estado }, after: { estado: 'cancelada' } });
      return out;
    }
    if (accion === 'hospedaje') {
      permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la gerencia autoriza hospedaje.');
      if (!j.hospedaje) throw new HttpError(409, 'Esta jornada no tiene hospedaje propuesto.');
      const estado = input.aprobar ? 'aprobado' : 'rechazado';
      const out = await data.update('jornadas', id, { hospedaje: { ...j.hospedaje, estado, decididoPor: actor.id } });
      await audit({ actorId: actor.id, action: `hospedaje_${estado}`, entity: 'jornada', entityId: id, before: { estado: j.hospedaje.estado }, after: { estado } });
      return out;
    }
    throw new HttpError(404, 'Acción no válida.');
  }
  /** Las paradas elegidas del catálogo toman nombre, zona y coordenadas de la base, no del navegador. */
  async function enriquecerParadas(input) {
    if (!Array.isArray(input.paradas)) return input;
    const paradas = [];
    for (const p of input.paradas) {
      const { lat, lng, ...resto } = p ?? {};
      if (p?.refId && ['establecimiento', 'farmacia'].includes(p.refTipo)) {
        const x = await data.get(p.refTipo === 'farmacia' ? 'farmacias' : 'establecimientos', p.refId);
        if (!x) throw new HttpError(422, 'Una de las paradas ya no existe en el catálogo.');
        paradas.push({ refTipo: p.refTipo, refId: x.id, lugar: x.nombre, municipio: x.municipio, provincia: x.provincia, ...(x.lat != null && x.lng != null ? { lat: Number(x.lat), lng: Number(x.lng) } : {}) });
      } else paradas.push(resto);
    }
    return { ...input, paradas };
  }

  /** Calcula km por carretera con el proveedor de mapas: residencia → paradas → residencia. */
  async function calcularKm(actor, input) {
    permitir(esRep(actor), 'Solo los representantes calculan sus rutas.');
    if (!mapas?.activo) throw new HttpError(503, 'El proveedor de mapas no está conectado. Escribe los km a mano.');
    const perfil = await perfilDe(actor.id);
    if (!perfil?.residencia?.municipio) throw new HttpError(409, 'Tu perfil no tiene residencia registrada. Pide a tu supervisor que la complete.');
    input = await enriquecerParadas(input);
    const e = {}; const { paradas } = validarJornada({ ...input, kmEstimados: 0 }, e);
    delete e.kmEstimados;
    if (Object.keys(e).length) invalido(e);
    try {
      const r = await mapas.ruta(perfil.residencia, paradas, { regresar: input.regresar !== false });
      return { ...r, kmFuente: r.proveedor };
    } catch (err) { throw new HttpError(502, err.message); }
  }

  async function listarJornadas(actor, { representanteId, mes }) {
    const id = representanteId || actor.id;
    permitir(actor.id === id || rol(actor, VEN_PERFIL));
    return (await data.list('jornadas', { representanteId: id })).filter((j) => !mes || j.fecha.startsWith(mes)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  // ------------------------------------------------------------ presupuesto
  /** Calcula el presupuesto del mes a partir de las jornadas planificadas. Si falta un dato, lo nombra. */
  // ------------------------------------------------------------ tope mensual de combustible / transporte
  async function verTopeGlobal() {
    const [c] = await data.list('configuracion', { clave: 'tope_combustible' });
    return c?.valor?.monto ?? null;
  }
  async function guardarTopeGlobal(actor, monto) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia fijan el tope de combustible.');
    const m = monto === null || monto === '' ? null : num(monto);
    if (m !== null && (!Number.isFinite(m) || m <= 0)) invalido({ monto: 'Escribe un monto mensual mayor que cero, o déjalo vacío para no usar tope.' });
    const [c] = await data.list('configuracion', { clave: 'tope_combustible' });
    const valor = { monto: m === null ? null : r2(m), actualizadoEn: now().toISOString() };
    if (c) await data.update('configuracion', c.id, { valor, actualizadoPor: actor.id }); else await data.insert('configuracion', { clave: 'tope_combustible', valor, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'tope_combustible_global', entity: 'configuracion', entityId: 'tope_combustible', before: { monto: c?.valor?.monto ?? null }, after: { monto: valor.monto } });
    return { monto: valor.monto };
  }

  async function calcular(repId, mes) {
    const faltan = [];
    const perfil = await perfilDe(repId);
    if (!perfil) return { faltan: ['El perfil de viático (vehículo, residencia y tarifa de comida) no está configurado.'] };
    const js = (await data.list('jornadas', { representanteId: repId })).filter((j) => j.fecha.startsWith(mes) && j.estado !== 'cancelada');
    if (!js.length) return { faltan: ['No hay jornadas planificadas en ese mes.'] };
    const v = perfil.vehiculo;
    let combustible = 0; let galones = 0; const preciosUsados = {};
    const km = r2(js.reduce((s, j) => s + j.kmEstimados, 0));
    const usaReembolso = v.propiedad === 'propio' && perfil.reembolsoPorKm != null;
    if (usaReembolso) {
      combustible = r2(km * perfil.reembolsoPorKm); // política expresa: reembolso por km sustituye al combustible, no se suman
    } else if (v.combustible === 'electrico') {
      faltan.push('El vehículo es eléctrico: el cálculo de costo energético (kWh) aún no está configurado.');
    } else {
      const tipo = v.combustible === 'hibrido' ? v.combustibleHibrido : v.combustible;
      // Se agrupan los km por precio vigente y se redondea una sola vez por grupo (no jornada por jornada).
      const kmPorPrecio = new Map();
      for (const j of js) {
        const p = await precioVigente(tipo, j.fecha);
        if (!p) { faltan.push(`No hay precio de ${COMBUSTIBLE_LABEL[tipo].toLowerCase()} vigente para el ${j.fecha}.`); continue; }
        kmPorPrecio.set(p.vigenteDesde, { precio: p.precioGalon, km: (kmPorPrecio.get(p.vigenteDesde)?.km ?? 0) + j.kmEstimados });
        preciosUsados[p.vigenteDesde] = p.precioGalon;
      }
      for (const { precio, km: k } of kmPorPrecio.values()) {
        const c = calcularCombustible({ kilometros: r2(k), rendimientoKmGalon: v.rendimiento, precioGalon: precio });
        combustible += c.costo; galones += c.galones;
      }
    }
    // Tope mensual: el del representante si lo tiene; si no, el global. Lo calculado por km se paga hasta el tope.
    const topeRep = perfil.topeCombustible ?? null;
    const tope = topeRep ?? (await verTopeGlobal());
    const combustibleCalculado = r2(combustible);
    const topado = aplicarTope({ calculado: combustibleCalculado, tope });
    combustible = topado.aplicado;
    const dias = new Set(js.filter((j) => j.conAlimentacion).map((j) => j.fecha)).size;
    const alimentacion = calcularAlimentacion({ tarifaDiaria: perfil.tarifaAlimentacion, diasElegibles: dias });
    const hoteles = js.filter((j) => j.hospedaje);
    const sinAprobar = hoteles.filter((j) => j.hospedaje.estado !== 'aprobado');
    if (sinAprobar.length) faltan.push(`Hay ${sinAprobar.length} hospedaje(s) sin autorizar por la gerencia.`);
    const hospedaje = hoteles.filter((j) => j.hospedaje.estado === 'aprobado')
      .reduce((s, j) => s + calcularHospedaje({ noches: j.hospedaje.noches, tarifaNoche: j.hospedaje.tarifaNoche, cargos: j.hospedaje.cargos }), 0);
    const sum = (k) => r2(js.reduce((s, j) => s + (j[k] || 0), 0));
    const detalle = calcularPresupuesto({ combustible: r2(combustible), alimentacion, hospedaje: r2(hospedaje), peajes: sum('peajes'), estacionamiento: sum('estacionamiento'), otros: sum('otros') });
    return {
      faltan, detalle: detalle.detalle, total: detalle.total,
      supuestos: {
        jornadas: js.length, km, kmTipo: js.every((j) => j.kmFuente === 'google') ? 'por carretera (Google)' : js.some((j) => j.kmFuente === 'google') ? 'mixto: mapa y manual' : 'estimado manual', galones: r2(galones), rendimiento: v.rendimiento ?? null,
        combustible: v.combustible, preciosUsados, diasAlimentacion: dias, tarifaAlimentacion: perfil.tarifaAlimentacion,
        reembolsoPorKm: usaReembolso ? perfil.reembolsoPorKm : null, hospedajes: hoteles.length,
        combustibleCalculado, tope, topeFuente: tope == null ? null : topeRep != null ? 'representante' : 'global', excedenteTope: topado.excedente,
      },
      avisos: topado.topado ? [`El combustible calculado (RD$${combustibleCalculado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}) pasa del tope mensual; se presupuesta el tope de RD$${tope.toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`] : [],
    };
  }
  const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
  async function verPresupuesto(actor, repId, mes) {
    permitir(actor.id === repId || rol(actor, VEN_PERFIL));
    if (!MES.test(String(mes))) throw new HttpError(422, 'Elige el mes.');
    const guardado = (await data.list('presupuestos', { representanteId: repId, mes }))[0] ?? null;
    const calculo = await calcular(repId, mes);
    return { guardado: guardado && conSaldo(guardado), calculo };
  }
  function conSaldo(p) {
    const entregado = r2((p.desembolsos ?? []).reduce((s, d) => s + d.monto, 0));
    const reportado = r2((p.gastos ?? []).filter((g) => g.estado !== 'rechazado').reduce((s, g) => s + g.monto, 0));
    const justificado = r2((p.gastos ?? []).filter((g) => g.estado === 'aceptado').reduce((s, g) => s + g.monto, 0));
    return { ...p, resumen: { aprobado: p.montoAprobado ?? null, entregado, reportado, justificado, saldo: r2(entregado - justificado), diferenciaPresupuesto: r2(p.total - justificado) } };
  }
  async function solicitar(actor, mes) {
    permitir(esRep(actor), 'Solo el representante solicita su presupuesto.');
    if (!MES.test(String(mes))) throw new HttpError(422, 'Elige el mes.');
    const c = await calcular(actor.id, mes);
    if (c.faltan.length) throw new HttpError(409, `No se puede solicitar todavía: ${c.faltan.join(' ')}`);
    const prev = (await data.list('presupuestos', { representanteId: actor.id, mes }))[0];
    if (prev && !['borrador', 'rechazado'].includes(prev.estado)) throw new HttpError(409, 'Ese presupuesto ya fue solicitado.');
    const datos = { representanteId: actor.id, mes, detalle: c.detalle, supuestos: c.supuestos, total: c.total, estado: 'solicitado', montoAprobado: null, motivo: null, desembolsos: [], gastos: [] };
    const p = prev ? await data.update('presupuestos', prev.id, datos) : await data.insert('presupuestos', datos);
    await audit({ actorId: actor.id, action: 'presupuesto_solicitado', entity: 'presupuesto', entityId: p.id, after: { total: p.total } });
    return conSaldo(p);
  }
  async function decidirPresupuesto(actor, id, aprobar, input) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la gerencia aprueba presupuestos de viáticos.');
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    if (p.estado !== 'solicitado') throw new HttpError(409, 'Este presupuesto no está esperando aprobación.');
    if (aprobar) {
      const m = input.montoAprobado == null || input.montoAprobado === '' ? p.total : Number(input.montoAprobado);
      if (!Number.isFinite(m) || m <= 0) invalido({ montoAprobado: 'Escribe el monto aprobado.' });
      if (m > p.total) invalido({ montoAprobado: 'No puede ser mayor que el presupuesto calculado.' });
      const out = await data.update('presupuestos', id, { estado: 'aprobado', montoAprobado: r2(m), aprobadoPor: actor.id });
      await audit({ actorId: actor.id, action: 'presupuesto_aprobado', entity: 'presupuesto', entityId: id, before: { estado: p.estado }, after: { montoAprobado: r2(m) } });
      return conSaldo(out);
    }
    const motivo = normalizeName(input.motivo);
    if (motivo.length < 3) invalido({ motivo: 'Escribe el motivo.' });
    const out = await data.update('presupuestos', id, { estado: 'rechazado', motivo, aprobadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'presupuesto_rechazado', entity: 'presupuesto', entityId: id, before: { estado: p.estado }, after: { motivo } });
    return conSaldo(out);
  }
  async function desembolsar(actor, id, input) {
    permitir(rol(actor, ['administrador', 'finanzas']), 'Solo finanzas registra desembolsos.');
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    if (!['aprobado', 'desembolsado'].includes(p.estado)) throw new HttpError(409, 'Solo se desembolsa un presupuesto aprobado.');
    const e = {};
    const monto = num(input.monto);
    const ya = (p.desembolsos ?? []).reduce((s, d) => s + d.monto, 0);
    if (!Number.isFinite(monto) || monto <= 0) e.monto = 'Escribe el monto entregado.';
    else if (r2(ya + monto) > p.montoAprobado) e.monto = `No puede pasar del monto aprobado (${p.montoAprobado}). Ya se entregó ${r2(ya)}.`;
    const fecha = input.fecha ?? hoy();
    if (!esFechaISO(fecha) || fecha > hoy()) e.fecha = 'Fecha no válida.';
    const referencia = normalizeName(input.referencia);
    if (referencia.length < 2) e.referencia = 'Escribe la referencia (transferencia, cheque o recibo).';
    if (Object.keys(e).length) invalido(e);
    const d = { monto: r2(monto), fecha, referencia, registradoPor: actor.id, registradoEn: now().toISOString() };
    const out = await data.update('presupuestos', id, { estado: 'desembolsado', desembolsos: [...(p.desembolsos ?? []), d] });
    await audit({ actorId: actor.id, action: 'viatico_desembolsado', entity: 'presupuesto', entityId: id, after: d });
    return conSaldo(out);
  }
  async function reportarGasto(actor, id, input) {
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    permitir(actor.id === p.representanteId, 'Solo el representante reporta sus gastos.');
    if (!['aprobado', 'desembolsado'].includes(p.estado)) throw new HttpError(409, 'Solo se reportan gastos de un presupuesto aprobado.');
    const e = {};
    if (!CATEGORIAS_GASTO.includes(input.categoria)) e.categoria = 'Elige la categoría.';
    const monto = num(input.monto);
    if (!Number.isFinite(monto) || monto <= 0) e.monto = 'Escribe el monto del gasto.';
    if (!esFechaISO(input.fecha) || !input.fecha.startsWith(p.mes) || input.fecha > hoy()) e.fecha = 'La fecha debe estar dentro del mes del presupuesto.';
    const referencia = normalizeName(input.referencia);
    if (referencia.length < 2) e.referencia = 'Escribe el número de factura o comprobante (NCF).';
    if (Object.keys(e).length) invalido(e);
    const g = { id: crypto.randomUUID(), categoria: input.categoria, monto: r2(monto), fecha: input.fecha, referencia, nota: normalizeName(input.nota) || null, estado: 'reportado', adjunto: null };
    if (detectarDuplicados([...(p.gastos ?? []).filter((x) => x.estado !== 'rechazado'), g]).length) {
      throw new HttpError(409, 'Ese comprobante ya está reportado.', { referencia: 'Comprobante duplicado.' });
    }
    if (input.adjunto) g.adjunto = await guardarAdjunto(files, actor, input.adjunto, 'comprobante');
    const out = await data.update('presupuestos', id, { gastos: [...(p.gastos ?? []), g] });
    await audit({ actorId: actor.id, action: 'gasto_reportado', entity: 'presupuesto', entityId: id, after: { categoria: g.categoria, monto: g.monto } });
    return conSaldo(out);
  }
  async function revisarGasto(actor, id, gastoId, aceptar, motivo) {
    permitir(rol(actor, ['administrador', 'finanzas']), 'Solo finanzas revisa comprobantes.');
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    if (p.estado === 'liquidado') throw new HttpError(409, 'El presupuesto ya está liquidado.');
    const g = (p.gastos ?? []).find((x) => x.id === gastoId);
    if (!g) throw new HttpError(404, 'El gasto no existe.');
    if (g.estado !== 'reportado') throw new HttpError(409, 'Ese gasto ya fue revisado.');
    const m = normalizeName(motivo);
    if (!aceptar && m.length < 3) invalido({ motivo: 'Escribe por qué no se acepta.' });
    const nuevo = { ...g, estado: aceptar ? 'aceptado' : 'rechazado', motivo: aceptar ? null : m, revisadoPor: actor.id };
    const out = await data.update('presupuestos', id, { gastos: p.gastos.map((x) => (x.id === gastoId ? nuevo : x)) });
    await audit({ actorId: actor.id, action: `gasto_${nuevo.estado}`, entity: 'presupuesto', entityId: id, after: { gastoId, monto: g.monto } });
    return conSaldo(out);
  }
  async function liquidar(actor, id) {
    permitir(rol(actor, ['administrador', 'finanzas']), 'Solo finanzas liquida viáticos.');
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    if (p.estado !== 'desembolsado') throw new HttpError(409, 'Solo se liquida un presupuesto con desembolsos.');
    if ((p.gastos ?? []).some((g) => g.estado === 'reportado')) throw new HttpError(409, 'Hay comprobantes sin revisar.');
    const { resumen } = conSaldo(p);
    const liquidacion = {
      entregado: resumen.entregado, justificado: resumen.justificado, saldo: resumen.saldo,
      resultado: resumen.saldo > 0 ? 'el representante devuelve' : resumen.saldo < 0 ? 'FERSUAZ reembolsa' : 'cuadrado',
      liquidadoPor: actor.id, fecha: hoy(),
    };
    const out = await data.update('presupuestos', id, { estado: 'liquidado', liquidacion });
    await audit({ actorId: actor.id, action: 'viatico_liquidado', entity: 'presupuesto', entityId: id, after: liquidacion });
    return conSaldo(out);
  }
  async function consolidado(actor, mes) {
    permitir(rol(actor, VEN_PERFIL));
    if (!MES.test(String(mes))) throw new HttpError(422, 'Elige el mes.');
    const reps = (await users.listUsers()).filter((u) => u.role === 'representante' && u.status === 'activo');
    const filas = [];
    for (const u of reps) {
      const p = (await data.list('presupuestos', { representanteId: u.id, mes }))[0];
      const js = (await data.list('jornadas', { representanteId: u.id })).filter((j) => j.fecha.startsWith(mes) && j.estado !== 'cancelada');
      const s = p ? conSaldo(p) : null;
      filas.push({
        representanteId: u.id, nombre: u.fullName, posicion: u.position, jornadas: js.length,
        kmEstimados: r2(js.reduce((a, j) => a + j.kmEstimados, 0)), kmReales: r2(js.reduce((a, j) => a + (j.kmReales ?? 0), 0)),
        estado: p?.estado ?? 'sin_solicitud', presupuestoId: p?.id ?? null, total: p?.total ?? null, aprobado: p?.montoAprobado ?? null,
        entregado: s?.resumen.entregado ?? 0, justificado: s?.resumen.justificado ?? 0, saldo: s?.resumen.saldo ?? 0,
        porRevisar: (p?.gastos ?? []).filter((g) => g.estado === 'reportado').length,
      });
    }
    const t = (k) => r2(filas.reduce((a, f) => a + (f[k] ?? 0), 0));
    return { mes, filas, totales: { total: t('total'), aprobado: t('aprobado'), entregado: t('entregado'), justificado: t('justificado'), saldo: t('saldo'), kmEstimados: t('kmEstimados'), kmReales: t('kmReales') } };
  }
  async function presupuestoPorId(actor, id) {
    const p = await data.get('presupuestos', id);
    if (!p) throw new HttpError(404, 'El presupuesto no existe.');
    permitir(actor.id === p.representanteId || rol(actor, VEN_PERFIL));
    return conSaldo(p);
  }

  return {
    guardarPerfil, verPerfil, listarRepresentantes, registrarPrecio,
    listarPrecios: async (actor) => { permitir(activo(actor)); return (await data.list('precios')).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde)); },
    crearJornada, actualizarJornada, listarJornadas, calcularKm,
    crearCronograma, listarCronogramas, anularCronograma,
    vistaPreviaRuta: async (actor, id) => { permitir(esRep(actor)); const r = await rutaDeCronograma(actor, id); return { fecha: r.cronograma.fecha, paradas: r.paradas, km: r.km, minutos: r.minutos ?? null, kmFuente: r.kmFuente, optimizado: r.optimizado }; }, mapasActivo: () => Boolean(mapas?.activo),
    crearCronogramaLote, proponerCronograma, verTopeGlobal, guardarTopeGlobal,
    verPresupuesto, solicitar, decidirPresupuesto, desembolsar, reportarGasto, revisarGasto, liquidar, consolidado, presupuestoPorId,
  };
}

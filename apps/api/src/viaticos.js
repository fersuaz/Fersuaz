// Rutas y viáticos (prompt maestro, módulos 6, 7, 9 a 13).
// Reglas: el salario no entra; nada se inventa (si falta un dato, se dice cuál); el hotel nunca se aprueba solo;
// los movimientos aprobados no se borran; los km son estimados manuales hasta conectar un proveedor de mapas.
import { AuthError as HttpError } from './auth.js';
import { STATUS, POSITIONS } from './roles.js';
import { calcularCombustible, calcularAlimentacion, calcularHospedaje, calcularPresupuesto, detectarDuplicados, aplicarTope, calcularTransportePublico, semanasDelMes } from './calculos.js';
import { esFechaISO, hoyRD } from './periodos.js';
import { normalizeName } from './validation.js';
import { guardarAdjunto } from './adjuntos.js';
import { dentroDeZona } from './territorio.js';
import { proponer, diasLaborables, copiarFechas } from './propuesta-cronograma.js';
import { elegirHotel } from './hoteles.js';

const COMBUSTIBLES = ['gasolina_premium', 'gasolina_regular', 'gasoil_optimo', 'gasoil_regular', 'glp', 'hibrido', 'electrico'];
export const COMBUSTIBLE_LABEL = {
  gasolina_premium: 'Gasolina premium', gasolina_regular: 'Gasolina regular', gasoil_optimo: 'Gasoil óptimo',
  gasoil_regular: 'Gasoil regular', glp: 'GLP', hibrido: 'Híbrido (gasolina)', electrico: 'Eléctrico',
};
// Un híbrido consume gasolina: se presupuesta con el precio de la gasolina que indique su perfil.
const CATEGORIAS_GASTO = ['combustible', 'transporte', 'alimentacion', 'hospedaje', 'peajes', 'estacionamiento', 'otros'];

const activo = (u) => u && u.status === STATUS.ACTIVO;
const rol = (u, roles) => activo(u) && roles.includes(u.role);
const esRep = (u) => activo(u) && u.role === 'representante';
const VEN_PERFIL = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
const permitir = (c, m = 'No tienes permiso para esta acción.') => { if (!c) throw new HttpError(403, m); };
const invalido = (f) => { throw new HttpError(422, 'Revisa los campos marcados.', f); };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => (v === '' || v == null ? null : Number(v));

/**
 * Precio de una noche para un día del cronograma marcado "duerme fuera":
 * 1) el hotel elegido por la gerencia; 2) el hotel verificado más económico del municipio o provincia;
 * 3) el precio de referencia de la provincia; 4) el precio de referencia general. Si no hay ninguno, `precio` es null.
 */
export function precioHotelPlan({ hoteles = [], referencia = {}, provincia, municipio, hotelId }) {
  const h = hotelId ? hoteles.find((x) => x.id === hotelId && x.estado !== 'inactivo' && Number(x.precioNoche) > 0) : null;
  if (h) return { precio: r2(Number(h.precioNoche)), hotel: h.nombre, hotelId: h.id, fuente: 'hotel' };
  const r = provincia ? elegirHotel(hoteles, provincia, municipio) : null;
  if (r) return { precio: r2(Number(r.hotel.precioNoche)), hotel: r.hotel.nombre, hotelId: r.hotel.id, fuente: 'verificado' };
  const p = Number(referencia?.porProvincia?.[provincia]);
  if (p > 0) return { precio: r2(p), hotel: null, hotelId: null, fuente: 'referencia-provincia' };
  const g = Number(referencia?.global);
  if (g > 0) return { precio: r2(g), hotel: null, hotelId: null, fuente: 'referencia-global' };
  return { precio: null, hotel: null, hotelId: null, fuente: null };
}

export function createViaticos({ data, users, files, audit, mapas, notificar, notificarRoles, hoteles, now = () => new Date() }) {
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
  const TIPOS_VEHICULO = ['carro', 'jeepeta', 'camioneta', 'motocicleta'];
  const TARIFAS_PUBLICO = ['transporteDentro', 'comidaDentro', 'transporteFuera', 'comidaFuera'];
  /** Valida un perfil sin guardarlo. Sin vehículo (propiedad "ninguno") se usa transporte público. */
  function prepararPerfil(input) {
    const e = {};
    const res = input.residencia ?? {};
    const residencia = { provincia: normalizeName(res.provincia), municipio: normalizeName(res.municipio), direccion: normalizeName(res.direccion) || null };
    if (!residencia.provincia) e['residencia.provincia'] = 'Escribe la provincia de residencia.';
    if (!residencia.municipio) e['residencia.municipio'] = 'Escribe el municipio de residencia.';
    const v = input.vehiculo ?? {};
    const sinVehiculo = v.propiedad === 'ninguno';
    const vehiculo = sinVehiculo ? { propiedad: 'ninguno' } : {
      propiedad: v.propiedad, tipo: v.tipo || null, marca: normalizeName(v.marca) || null, modelo: normalizeName(v.modelo) || null,
      anio: num(v.anio), combustible: v.combustible, rendimiento: num(v.rendimiento), placa: normalizeName(v.placa) || null,
      combustibleHibrido: v.combustible === 'hibrido' ? (v.combustibleHibrido || 'gasolina_regular') : null,
      epaId: v.epaId ? String(v.epaId).slice(0, 12) : null, rendimientoFuente: v.epaId && v.rendimientoFuente === 'epa' ? 'epa' : 'manual',
    };
    if (!['propio', 'asignado', 'ninguno'].includes(v.propiedad)) e['vehiculo.propiedad'] = 'Elige si el vehículo es propio, asignado o si no tiene vehículo.';
    if (!sinVehiculo) {
      if (vehiculo.tipo && !TIPOS_VEHICULO.includes(vehiculo.tipo)) e['vehiculo.tipo'] = 'Elige el tipo de vehículo.';
      if (!COMBUSTIBLES.includes(vehiculo.combustible)) e['vehiculo.combustible'] = 'Elige el tipo de combustible.';
      if (vehiculo.combustible !== 'electrico' && (!Number.isFinite(vehiculo.rendimiento) || vehiculo.rendimiento <= 0 || vehiculo.rendimiento > 200)) e['vehiculo.rendimiento'] = 'Escribe el rendimiento real en km por galón.';
      if (vehiculo.anio != null && (!Number.isInteger(vehiculo.anio) || vehiculo.anio < 1980 || vehiculo.anio > Number(hoy().slice(0, 4)) + 1)) e['vehiculo.anio'] = 'Año no válido.';
    }
    const tarifaAlimentacion = sinVehiculo && (input.tarifaAlimentacion == null || input.tarifaAlimentacion === '') ? 0 : num(input.tarifaAlimentacion);
    if (!Number.isFinite(tarifaAlimentacion) || tarifaAlimentacion < 0) e.tarifaAlimentacion = 'Escribe la tarifa diaria de alimentación en RD$.';
    const reembolsoPorKm = num(input.reembolsoPorKm);
    if (reembolsoPorKm != null && (!Number.isFinite(reembolsoPorKm) || reembolsoPorKm <= 0)) e.reembolsoPorKm = 'Escribe un monto por km mayor que cero, o déjalo vacío.';
    if (reembolsoPorKm != null && vehiculo.propiedad !== 'propio') e.reembolsoPorKm = 'El reembolso por km solo aplica a vehículos propios.';
    const topeCombustible = num(input.topeCombustible);
    if (topeCombustible != null && (!Number.isFinite(topeCombustible) || topeCombustible <= 0)) e.topeCombustible = 'Escribe un tope mensual mayor que cero, o déjalo vacío para usar el global.';
    // Montos propios de transporte público (vacío = se usa el monto global)
    let publico = null;
    if (sinVehiculo) {
      publico = {};
      for (const k of TARIFAS_PUBLICO) {
        const x = num(input.publico?.[k]);
        if (x != null && (!Number.isFinite(x) || x < 0)) e[`publico.${k}`] = 'Escribe un monto en RD$, o déjalo vacío para usar el global.';
        publico[k] = x == null ? null : r2(x);
      }
    }
    if (Object.keys(e).length) invalido(e);
    return { residencia, vehiculo, tarifaAlimentacion: r2(tarifaAlimentacion), reembolsoPorKm: reembolsoPorKm == null ? null : r2(reembolsoPorKm), topeCombustible: topeCombustible == null ? null : r2(topeCombustible), publico };
  }
  async function guardarPerfil(actor, representanteId, input) {
    permitir(rol(actor, ['administrador', 'gerencia', 'supervisor']), 'Solo la gerencia o los supervisores configuran perfiles de viático.');
    await rep(representanteId);
    const d = prepararPerfil(input);
    const antes = await perfilDe(representanteId);
    const datos = { representanteId, ...d, actualizadoPor: actor.id };
    const p = antes ? await data.update('perfiles', antes.id, datos) : await data.insert('perfiles', datos);
    await audit({ actorId: actor.id, action: 'perfil_viatico_guardado', entity: 'perfil_viatico', entityId: p.id,
      before: antes ? { vehiculo: antes.vehiculo, tarifaAlimentacion: antes.tarifaAlimentacion, reembolsoPorKm: antes.reembolsoPorKm, topeCombustible: antes.topeCombustible ?? null, publico: antes.publico ?? null } : null,
      after: { vehiculo: d.vehiculo, tarifaAlimentacion: d.tarifaAlimentacion, reembolsoPorKm: d.reembolsoPorKm, topeCombustible: d.topeCombustible, publico: d.publico } });
    return p;
  }
  // ------------------------------------------------------------ montos globales de transporte público
  // Montos por día: por posición (por defecto) o uno global para todos. El perfil del representante manda sobre ambos.
  const montos = (o) => Object.fromEntries(TARIFAS_PUBLICO.map((k) => [k, o?.[k] ?? null]));
  async function verTarifasPublico() {
    const [c] = await data.list('configuracion', { clave: 'tarifas_publico' });
    const v = c?.valor ?? {};
    if (!v.modo && TARIFAS_PUBLICO.some((k) => v[k] != null)) return { modo: 'global', global: montos(v), porPosicion: Object.fromEntries(POSITIONS.map((p) => [p, montos()])) }; // formato anterior
    return { modo: v.modo === 'global' ? 'global' : 'posicion', global: montos(v.global), porPosicion: Object.fromEntries(POSITIONS.map((p) => [p, montos(v.porPosicion?.[p])])) };
  }
  /** Montos que aplican a una posición: los de su posición o los globales, según el modo elegido. */
  async function tarifasDePosicion(posicion) {
    const t = await verTarifasPublico();
    if (t.modo === 'posicion' && POSITIONS.includes(posicion)) return { montos: t.porPosicion[posicion], fuente: 'posicion' };
    return { montos: t.global, fuente: 'global' };
  }
  async function guardarTarifasPublico(actor, input) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia fijan los montos de transporte público.');
    const e = {};
    const leer = (o, pre) => Object.fromEntries(TARIFAS_PUBLICO.map((k) => {
      const x = o?.[k] === '' || o?.[k] == null ? null : num(o[k]);
      if (x != null && (!Number.isFinite(x) || x < 0)) e[`${pre}${k}`] = 'Escribe un monto en RD$.';
      return [k, x == null ? null : r2(x)];
    }));
    // Formato anterior (cuatro montos sueltos, de una pantalla abierta antes de actualizar): es un monto global.
    if (!input?.modo && !input?.global && !input?.porPosicion && TARIFAS_PUBLICO.some((k) => input?.[k] != null && input[k] !== '')) input = { modo: 'global', global: input };
    const modo = input?.modo === 'global' ? 'global' : 'posicion';
    const valor = { modo, global: leer(input?.global, 'global.'), porPosicion: Object.fromEntries(POSITIONS.map((p) => [p, leer(input?.porPosicion?.[p], `${p}.`)])) };
    if (Object.keys(e).length) invalido(e);
    const antes = await verTarifasPublico();
    const [c] = await data.list('configuracion', { clave: 'tarifas_publico' });
    if (c) await data.update('configuracion', c.id, { valor, actualizadoPor: actor.id }); else await data.insert('configuracion', { clave: 'tarifas_publico', valor, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'tarifas_publico_global', entity: 'configuracion', entityId: 'tarifas_publico', before: antes, after: valor });
    return valor;
  }
  async function verPerfil(actor, representanteId) {
    permitir(actor.id === representanteId || rol(actor, VEN_PERFIL));
    return ocultarDireccion(actor, await perfilDe(representanteId));
  }
  async function listarRepresentantes(actor) {
    permitir(rol(actor, VEN_PERFIL));
    const reps = (await users.listUsers()).filter((u) => u.role === 'representante' && u.status === 'activo');
    const out = [];
    const contacto = rol(actor, ['administrador', 'gerencia']); // teléfono y correo, para corregirlos
    for (const u of reps) out.push({ id: u.id, fullName: u.fullName, position: u.position, ...(contacto ? { phone: u.phone ?? null, email: u.email ?? null } : {}), perfil: ocultarDireccion(actor, await perfilDe(u.id)) });
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
    const duermeFuera = input.duermeFuera === true;
    let hotelId = null;
    if (duermeFuera && input.hotelId) {
      const h = await data.get('hoteles', String(input.hotelId));
      if (!h || h.estado === 'inactivo' || !(Number(h.precioNoche) > 0)) invalido({ hotelId: 'Ese hotel no está disponible o no tiene precio.' });
      hotelId = h.id;
    }
    return { rep, fechas, lugares, nota: normalizeName(input.nota) || null, duermeFuera, hotelId };
  }
  async function crearCronograma(actor, input) {
    const { rep, fechas, lugares, nota, duermeFuera, hotelId } = await prepararCronograma(actor, input);
    const creados = [];
    for (const fecha of fechas) creados.push(await data.insert('cronogramas', { representanteId: rep.id, fecha, lugares, nota, estado: 'aprobado', creadoPor: actor.id, duermeFuera, hotelId }));
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
    for (const d of dias) listos.push(await prepararCronograma(actor, { representanteId, fechas: [d.fecha], lugares: d.lugares, nota, duermeFuera: d.duermeFuera === true, hotelId: d.hotelId }));
    const rep = listos[0].rep; const creados = [];
    for (const x of listos) creados.push(await data.insert('cronogramas', { representanteId: rep.id, fecha: x.fechas[0], lugares: x.lugares, nota: x.nota, estado: 'aprobado', creadoPor: actor.id, duermeFuera: x.duermeFuera, hotelId: x.hotelId }));
    await audit({ actorId: actor.id, action: 'cronograma_aprobado', entity: 'user', entityId: rep.id, after: { fechas: fechas.sort(), lugares: listos.reduce((n, x) => n + x.lugares.length, 0), origen: 'propuesta' } });
    await notificar?.(rep.id, { tipo: 'cronograma', titulo: 'Nuevo cronograma', texto: `Tienes ${creados.length} día(s) programado(s) desde el ${fechas.sort()[0]}.`, enlace: '#jornadas' });
    return creados;
  }
  /**
   * Propuesta del mes para un representante: lugares de su zona que aún no están programados ese mes,
   * repartidos en los días laborables libres, por municipio y cercanía. No guarda nada.
   */
  async function proponerCronograma(actor, { representanteId, mes, porDia = 8, sabados = false, dias, feriados = [] }) {
    permitir(rol(actor, ['administrador']), 'Solo el administrador crea cronogramas.');
    const rep = await users.findUserById(String(representanteId ?? ''));
    if (!rep || rep.role !== 'representante' || rep.status !== 'activo') throw new HttpError(404, 'El representante no existe o no está activo.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes)) || mes < hoy().slice(0, 7)) invalido({ mes: 'Elige el mes en curso o uno futuro.' });
    const n = Number(porDia);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LUGARES) invalido({ porDia: `Escribe entre 1 y ${MAX_LUGARES} lugares por día.` });
    let semana = null;
    if (dias !== undefined) {
      semana = [...new Set((Array.isArray(dias) ? dias : []).map(Number))];
      if (!semana.length || semana.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) invalido({ dias: 'Elige al menos un día de la semana.' });
    }
    const libresQuitados = [...new Set((Array.isArray(feriados) ? feriados : []).map(String))];
    if (libresQuitados.some((f) => !esFechaISO(f) || !f.startsWith(mes))) invalido({ feriados: 'Las fechas a quitar deben ser de este mes.' });
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
    const fechas = diasLaborables(mes, { desde: hoy(), excluir: [...crons.map((c) => c.fecha), ...libresQuitados], sabados: sabados === true || sabados === 'true', dias: semana ?? undefined });
    const perfil = await perfilDe(rep.id);
    const r = proponer({ lugares, residencia: perfil?.residencia, fechas, porDia: n });
    return {
      representanteId: rep.id, mes, porDia: n, dias: r.dias, sinDia: r.sinDia,
      resumen: { lugares: lugares.length, yaProgramados: programados.size, diasLibres: fechas.length, diasSemana: semana ?? [1, 2, 3, 4, 5, ...(sabados === true || sabados === 'true' ? [6] : [])], feriados: libresQuitados, desde: hoy(), diasPropuestos: r.dias.length, sinUbicacion: lugares.filter((l) => l.lat == null).length },
      sinResidencia: !perfil,
    };
  }
  /**
   * Propuesta copiada del mes anterior: mismos lugares y mismas noches fuera, en el mismo día de la semana
   * (2.º martes → 2.º martes). No guarda nada: se revisa y se aprueba con el lote, igual que la propuesta.
   */
  async function copiarMesAnterior(actor, { representanteId, mes }) {
    permitir(rol(actor, ['administrador']), 'Solo el administrador crea cronogramas.');
    const rep = await users.findUserById(String(representanteId ?? ''));
    if (!rep || rep.role !== 'representante' || rep.status !== 'activo') throw new HttpError(404, 'El representante no existe o no está activo.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes)) || mes < hoy().slice(0, 7)) invalido({ mes: 'Elige el mes en curso o uno futuro.' });
    const [y, m] = mes.split('-').map(Number);
    const anterior = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const todos = (await data.list('cronogramas', { representanteId: rep.id })).filter((c) => c.estado === 'aprobado');
    const origen = todos.filter((c) => c.fecha.startsWith(anterior)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!origen.length) throw new HttpError(409, `${rep.fullName} no tiene cronograma aprobado en ${anterior}. Usa la propuesta automática.`);
    const ocupadas = new Set(todos.filter((c) => c.fecha.startsWith(mes)).map((c) => c.fecha));
    const { mapa, sinDia } = copiarFechas(mes, origen.map((c) => c.fecha));
    const desde = hoy(); const dias = []; const omitidos = sinDia.map((f) => ({ desde: f, razon: 'Ese día no existe en el mes (ej. un 5.º lunes).' }));
    for (const { desde: f, fecha } of mapa) {
      const c = origen.find((x) => x.fecha === f);
      if (fecha < desde) { omitidos.push({ desde: f, fecha, razon: 'La fecha ya pasó.' }); continue; }
      if (ocupadas.has(fecha)) { omitidos.push({ desde: f, fecha, razon: 'Ya tiene cronograma ese día.' }); continue; }
      const lugares = []; const quitados = [];
      for (const l of c.lugares) { const x = await lugarDe(l); if (x) lugares.push(x); else quitados.push(l.lugar); }
      if (!lugares.length) { omitidos.push({ desde: f, fecha, razon: 'Sus lugares ya no están activos.' }); continue; }
      dias.push({ fecha, desde: f, lugares, duermeFuera: c.duermeFuera === true, hotelId: c.hotelId ?? null, quitados });
    }
    return { representanteId: rep.id, mes, anterior, dias, omitidos, resumen: { origen: origen.length, copiados: dias.length, nochesFuera: dias.filter((d) => d.duermeFuera).length } };
  }
  /** Marca o desmarca la noche fuera de un día ya aprobado (y opcionalmente el hotel). */
  async function hotelDeCronograma(actor, id, { duermeFuera, hotelId } = {}) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la gerencia programa las noches fuera.');
    const c = await data.get('cronogramas', id);
    if (!c || c.estado !== 'aprobado') throw new HttpError(404, 'Ese día del cronograma no existe.');
    const fuera = duermeFuera === true; let hid = null;
    if (fuera && hotelId) {
      const h = await data.get('hoteles', String(hotelId));
      if (!h || h.estado === 'inactivo' || !(Number(h.precioNoche) > 0)) invalido({ hotelId: 'Ese hotel no está disponible o no tiene precio.' });
      hid = h.id;
    }
    const out = await data.update('cronogramas', id, { duermeFuera: fuera, hotelId: hid });
    await audit({ actorId: actor.id, action: 'cronograma_noche_fuera', entity: 'cronograma', entityId: id, before: { duermeFuera: c.duermeFuera ?? false, hotelId: c.hotelId ?? null }, after: { duermeFuera: fuera, hotelId: hid } });
    return out;
  }
  async function referenciaHotel() { return (await data.list('configuracion', { clave: 'hotel_referencia' }))[0]?.valor ?? { global: null, porProvincia: {} }; }
  async function verReferenciaHotel(actor) { permitir(rol(actor, ['administrador', 'gerencia', 'finanzas'])); return referenciaHotel(); }
  async function guardarReferenciaHotel(actor, input = {}) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la gerencia fija el precio de referencia de hotel.');
    const e = {}; const porProvincia = {};
    const g = input.global === '' || input.global == null ? null : num(input.global);
    if (g != null && (!Number.isFinite(g) || g <= 0 || g > 100000)) e.global = 'Escribe un precio por noche válido.';
    for (const [p, v] of Object.entries(input.porProvincia ?? {})) {
      if (v === '' || v == null) continue;
      const n = num(v);
      if (!Number.isFinite(n) || n <= 0 || n > 100000) { e[`porProvincia.${p}`] = `Precio no válido para ${p}.`; continue; }
      porProvincia[p] = r2(n);
    }
    if (Object.keys(e).length) invalido(e);
    const valor = { global: g == null ? null : r2(g), porProvincia };
    const [c] = await data.list('configuracion', { clave: 'hotel_referencia' });
    if (c) await data.update('configuracion', c.id, { valor, actualizadoPor: actor.id }); else await data.insert('configuracion', { clave: 'hotel_referencia', valor, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'hotel_referencia', entity: 'configuracion', entityId: 'hotel_referencia', before: c?.valor ?? null, after: valor });
    return valor;
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
    // Hotel aprobado por la gerencia (verificado, el más económico que cumple todo) a su precio: queda autorizado.
    // Otro hotel exige la razón del cambio; un precio distinto exige además el comprobante. Ambos esperan a la gerencia.
    let hotel = null; let cambio = null;
    if (input.hospedaje) {
      const hs = input.hospedaje;
      const fin = ruta.paradas.at(-1) ?? {};
      const rec = hoteles && fin.provincia ? await hoteles.recomendado(actor, { provincia: fin.provincia, municipio: fin.municipio }).catch(() => null) : null;
      if (hs.hotelId && hoteles) hotel = await hoteles.paraHospedaje(hs.hotelId);
      const cobrada = hs.tarifaCobrada == null || hs.tarifaCobrada === '' ? null : num(hs.tarifaCobrada);
      const cambioHotel = !!rec && (!hotel || hotel.id !== rec.hotel.id); // sin hotel aprobado en la zona no hay "cambio"
      const cambioPrecio = !!hotel && cobrada != null && r2(cobrada) !== r2(Number(hotel.precioNoche));
      const motivoCambio = normalizeName(hs.motivoCambio);
      if (cobrada != null && (!Number.isFinite(cobrada) || cobrada <= 0)) e['hospedaje.tarifaCobrada'] = 'Escribe lo que cobró el hotel por noche.';
      if ((cambioHotel || cambioPrecio) && motivoCambio.length < 5) e['hospedaje.motivoCambio'] = cambioPrecio ? 'Explica por qué el precio es distinto.' : 'Explica por qué cambias el hotel aprobado.';
      if (cambioPrecio && !hs.comprobante) e['hospedaje.comprobante'] = 'Sube el comprobante (voucher) con el precio cobrado.';
      cambio = { cambioHotel, cambioPrecio, motivoCambio: motivoCambio || null, recomendadoId: rec?.hotel?.id ?? null, recomendado: rec?.hotel?.nombre ?? null,
        tarifaAprobada: hotel ? r2(Number(hotel.precioNoche)) : null, telefonoHotel: hotel?.telefono ?? null, comprobanteEntrada: hs.comprobante ?? null };
      const motivo = normalizeName(hs.motivo) || (hotel && rec && !cambioHotel && !cambioPrecio ? 'Hotel programado por la gerencia' : motivoCambio);
      input = { ...input, hospedaje: { ...hs, motivo, ...(hotel ? { tarifaNoche: cambioPrecio ? cobrada : hotel.precioNoche, hotel: hotel.nombre, municipio: hotel.municipio } : {}) } };
    }
    const entrada = ruta.km != null ? { ...input, kmEstimados: ruta.km, kmFuente: 'google' } : { ...input, kmFuente: 'manual' };
    const d = validarJornada(entrada, e);
    if (Object.keys(e).length) invalido(e);
    if (d.hospedaje && cambio) {
      const { comprobanteEntrada, ...resto } = cambio;
      const comprobante = resto.cambioPrecio ? await guardarAdjunto(files, actor, comprobanteEntrada, 'comprobante') : null;
      const auto = !!hotel && !!resto.recomendadoId && !resto.cambioHotel && !resto.cambioPrecio;
      d.hospedaje = { ...d.hospedaje, hotelId: hotel?.id ?? null, ...resto, comprobante, estado: auto ? 'aprobado' : 'propuesto', decididoPor: auto ? 'hotel-aprobado' : null };
    }
    if ((await data.list('jornadas', { representanteId: actor.id, fecha: input.fecha })).some((j) => j.estado !== 'cancelada')) {
      throw new HttpError(409, 'Ya tienes una jornada ese día. Edítala en vez de crear otra.', { fecha: 'Ya hay una jornada ese día.' });
    }
    if (await presupuestoBloqueado(actor.id, input.fecha.slice(0, 7))) throw new HttpError(409, 'El presupuesto de ese mes está esperando aprobación; cuando la gerencia decida, podrás crear tus jornadas.');
    const j = await data.insert('jornadas', { representanteId: actor.id, cronogramaId: ruta.cronograma.id, fecha: input.fecha, ...d, kmReales: null, estado: 'planificada' });
    await audit({ actorId: actor.id, action: 'jornada_planificada', entity: 'jornada', entityId: j.id, after: { fecha: j.fecha, km: j.kmEstimados, hospedaje: j.hospedaje?.estado ?? null } });
    if (j.hospedaje?.estado === 'aprobado') await ajustarPorHospedaje(j, actor.id);
    if (j.hospedaje?.estado === 'propuesto') {
      const hs = j.hospedaje;
      const texto = hs.cambioPrecio
        ? `${actor.fullName}: ${hs.hotel} cobró ${RDtxt(hs.tarifaNoche)} por noche; el precio aprobado es ${RDtxt(hs.tarifaAprobada)}. Motivo: ${hs.motivoCambio}${hs.telefonoHotel ? `. Teléfono del hotel: ${hs.telefonoHotel}` : ''}. Llama para verificar y aprueba o no.`
        : `${actor.fullName} pidió ${hs.hotel ?? 'otro hotel'} (${RDtxt(hs.tarifaNoche)} por noche) en vez de ${hs.recomendado ?? 'el aprobado'}. Motivo: ${hs.motivoCambio}.`;
      await notificarRoles?.(['administrador', 'gerencia'], { tipo: 'viaticos', titulo: hs.cambioPrecio ? 'Hotel con precio distinto' : 'Cambio de hotel por aprobar', texto, enlace: `#viatico?rep=${actor.id}&mes=${j.fecha.slice(0, 7)}` });
    }
    return j;
  }
  // Mientras la gerencia decide una solicitud, las jornadas no cambian. Aprobado o asignado, el representante
  // sigue creando las jornadas de su cronograma (ya están contadas en el presupuesto).
  async function presupuestoBloqueado(repId, mes) {
    const p = (await data.list('presupuestos', { representanteId: repId, mes }))[0];
    return p?.estado === 'solicitado';
  }
  const RDtxt = (n) => `RD$${Number(n ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  /** Un hotel autorizado después de aprobar el presupuesto suma un ajuste auditable al monto aprobado. */
  async function ajustarPorHospedaje(j, actorId) {
    const p = (await data.list('presupuestos', { representanteId: j.representanteId, mes: j.fecha.slice(0, 7) }))[0];
    if (!p || !['aprobado', 'desembolsado'].includes(p.estado)) return;
    const hs = j.hospedaje;
    const monto = calcularHospedaje({ noches: hs.noches, tarifaNoche: hs.tarifaNoche, cargos: hs.cargos });
    if ((p.ajustes ?? []).some((a) => a.jornadaId === j.id)) return;
    const ajuste = { id: crypto.randomUUID(), jornadaId: j.id, categoria: 'hospedaje', monto, motivo: `Hotel ${hs.hotel ?? ''} del ${j.fecha}, ${hs.noches} noche(s)`, por: actorId, fecha: hoy() };
    await data.update('presupuestos', p.id, { ajustes: [...(p.ajustes ?? []), ajuste], montoAprobado: r2((p.montoAprobado ?? 0) + monto), total: r2((p.total ?? 0) + monto) });
    await audit({ actorId, action: 'presupuesto_ajuste', entity: 'presupuesto', entityId: p.id, before: { montoAprobado: p.montoAprobado }, after: { ajuste: monto, motivo: ajuste.motivo } });
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
    if (accion === 'visita') {
      // Las visitas las marca el propio representante, el día de la jornada o después: es lo que cuenta para sus metas.
      permitir(actor.id === j.representanteId, 'Solo el representante marca sus visitas.');
      if (j.estado === 'cancelada') throw new HttpError(409, 'La jornada está cancelada.');
      if (j.fecha > hoy()) throw new HttpError(409, 'Las visitas se marcan el día de la jornada o después.');
      const marcar = Array.isArray(input.hechas) ? input.hechas.map(Number) : null;
      if (!marcar || marcar.some((i) => !Number.isInteger(i) || i < 0 || i >= j.paradas.length)) invalido({ hechas: 'Marca los lugares visitados.' });
      const ahora = new Date().toISOString();
      const paradas = j.paradas.map((p, i) => (marcar.includes(i) ? { ...p, hecha: true, hechaEn: p.hecha ? p.hechaEn ?? ahora : ahora } : { ...p, hecha: false, hechaEn: null }));
      const out = await data.update('jornadas', id, { paradas });
      await audit({ actorId: actor.id, action: 'visitas_marcadas', entity: 'jornada', entityId: id, before: { hechas: j.paradas.filter((p) => p.hecha).length }, after: { hechas: marcar.length, de: j.paradas.length } });
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
      if (j.hospedaje.estado !== 'propuesto') throw new HttpError(409, 'Este hospedaje ya fue decidido.');
      const estado = input.aprobar ? 'aprobado' : 'rechazado';
      const nota = normalizeName(input.nota) || null;
      if (!input.aprobar && (nota ?? '').length < 3) invalido({ nota: 'Explica por qué no se autoriza.' });
      const out = await data.update('jornadas', id, { hospedaje: { ...j.hospedaje, estado, decididoPor: actor.id, nota } });
      await audit({ actorId: actor.id, action: `hospedaje_${estado}`, entity: 'jornada', entityId: id, before: { estado: j.hospedaje.estado }, after: { estado, nota } });
      // Precio nuevo confirmado con el hotel: se puede actualizar en el catálogo para los próximos.
      if (input.aprobar && input.actualizarPrecio && j.hospedaje.cambioPrecio && j.hospedaje.hotelId && hoteles) {
        await hoteles.actualizar(actor, j.hospedaje.hotelId, { precioNoche: j.hospedaje.tarifaNoche });
      }
      if (input.aprobar) await ajustarPorHospedaje(out, actor.id);
      await notificar?.(j.representanteId, { tipo: 'viaticos', titulo: input.aprobar ? 'Hotel autorizado' : 'Hotel no autorizado', texto: input.aprobar ? `Tu hotel del ${j.fecha} fue autorizado.` : `Tu hotel del ${j.fecha} no fue autorizado: ${nota}`, enlace: `#jornadas?mes=${j.fecha.slice(0, 7)}` });
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

  // ------------------------------------------------------------ días del mes: jornadas y cronograma aprobado
  const claveOrigen = (r) => [r?.provincia, r?.municipio, r?.direccion ?? ''].join('|');
  /** Km por carretera de un día aprobado del cronograma: residencia → lugares → residencia. Se calcula una vez. */
  async function kmDeCronograma(c, perfil) {
    const origen = claveOrigen(perfil.residencia);
    if (c.kmEstimado != null && c.kmOrigen === origen) return { km: Number(c.kmEstimado), minutos: c.minutosEstimados ?? null };
    if (!mapas?.activo) return { error: 'el cálculo por mapa no está activo' };
    try {
      const r = await mapas.ruta(perfil.residencia, c.lugares, { regresar: true, optimizar: true });
      await data.update('cronogramas', c.id, { kmEstimado: r.km, minutosEstimados: r.minutos ?? null, kmOrigen: origen });
      return { km: r.km, minutos: r.minutos ?? null };
    } catch (err) { return { error: err.message }; }
  }
  /**
   * Días del mes que cuentan para los viáticos: cada jornada creada y cada día aprobado del cronograma
   * que aún no tiene jornada (con sus km estimados por mapa). Así el presupuesto sale desde que se aprueba el cronograma.
   */
  async function diasDelMes(repId, mes, perfil) {
    const todas = (await data.list('jornadas', { representanteId: repId })).filter((j) => j.fecha.startsWith(mes));
    const js = todas.filter((j) => j.estado !== 'cancelada');
    // Un día con jornada (aunque se haya cancelado) ya no se estima desde el cronograma.
    const conJornada = new Set(todas.map((j) => j.cronogramaId).filter(Boolean)); const fechasJ = new Set(todas.map((j) => j.fecha));
    const crons = (await data.list('cronogramas', { representanteId: repId }))
      .filter((c) => c.estado === 'aprobado' && c.fecha.startsWith(mes) && !conJornada.has(c.id) && !fechasJ.has(c.fecha));
    const dias = js.map((j) => ({ fecha: j.fecha, origen: 'jornada', km: j.kmEstimados, kmFuente: j.kmFuente, conAlimentacion: j.conAlimentacion !== false, hospedaje: j.hospedaje ?? null,
      peajes: j.peajes || 0, estacionamiento: j.estacionamiento || 0, otros: j.otros || 0, paradas: j.paradas ?? [], lugares: (j.paradas ?? []).length }));
    const errores = new Set();
    const necesitaKm = perfil.vehiculo?.propiedad !== 'ninguno';
    const fuera = crons.filter((c) => c.duermeFuera === true); const sinHotel = new Set();
    const hotelesTodos = fuera.length ? await data.list('hoteles') : [];
    const referencia = fuera.length ? await referenciaHotel() : null;
    const hotelPlan = (c) => {
      if (c.duermeFuera !== true) return null;
      const fin = c.lugares?.at(-1) ?? {};
      const p = precioHotelPlan({ hoteles: hotelesTodos, referencia, provincia: fin.provincia, municipio: fin.municipio, hotelId: c.hotelId });
      if (p.precio == null) { sinHotel.add(`Noche fuera del ${c.fecha} en ${fin.municipio ?? fin.provincia}: no hay hotel verificado ni precio de referencia. Ponlo en Hoteles → Precio de referencia.`); return null; }
      return { estado: 'aprobado', plan: true, noches: 1, tarifaNoche: p.precio, cargos: 0, hotel: p.hotel, hotelId: p.hotelId, fuente: p.fuente, municipio: fin.municipio ?? null, provincia: fin.provincia ?? null };
    };
    for (let i = 0; i < crons.length; i += 4) { // de 4 en 4 para no saturar el proveedor de mapas
      const lote = crons.slice(i, i + 4);
      const kms = necesitaKm ? await Promise.all(lote.map((c) => kmDeCronograma(c, perfil))) : lote.map(() => ({ km: 0 }));
      lote.forEach((c, k) => {
        if (kms[k].error) errores.add(kms[k].error);
        dias.push({ fecha: c.fecha, origen: 'cronograma', km: kms[k].km ?? null, kmFuente: kms[k].km != null ? 'google' : null, conAlimentacion: true, hospedaje: hotelPlan(c),
          peajes: 0, estacionamiento: 0, otros: 0, paradas: c.lugares ?? [], lugares: (c.lugares ?? []).length });
      });
    }
    return { dias: dias.sort((a, b) => a.fecha.localeCompare(b.fecha)), errores: [...errores], sinHotel: [...sinHotel] };
  }
  /** Agrupa los días por semana y suma cada partida (el combustible, por precio vigente dentro de la semana). */
  async function porSemana(mes, dias, { costoCombustible, comidaDia }) {
    const semanas = semanasDelMes(mes, dias.map((d) => d.fecha));
    const out = [];
    for (const s of semanas) {
      const ds = dias.filter((d) => s.fechas.includes(d.fecha));
      const c = await costoCombustible(ds);
      const hosp = ds.filter((d) => d.hospedaje?.estado === 'aprobado').reduce((x, d) => x + calcularHospedaje({ noches: d.hospedaje.noches, tarifaNoche: d.hospedaje.tarifaNoche, cargos: d.hospedaje.cargos }), 0);
      out.push({
        n: s.n, desde: s.desde, hasta: s.hasta, dias: new Set(ds.map((d) => d.fecha)).size, lugares: ds.reduce((x, d) => x + d.lugares, 0),
        km: r2(ds.reduce((x, d) => x + (d.km || 0), 0)), galones: c.galones, combustible: c.costo, transporte: c.transporte ?? 0,
        alimentacion: r2(comidaDia(ds)), hospedaje: r2(hosp), otros: r2(ds.reduce((x, d) => x + d.peajes + d.estacionamiento + d.otros, 0)),
      });
    }
    return out.map((w) => ({ ...w, total: r2(w.combustible + w.transporte + w.alimentacion + w.hospedaje + w.otros) }));
  }

  async function calcular(repId, mes) {
    const faltan = [];
    const perfil = await perfilDe(repId);
    if (!perfil) return { faltan: ['El perfil de viático (vehículo, residencia y tarifa de comida) no está configurado.'] };
    const { dias, errores, sinHotel } = await diasDelMes(repId, mes, perfil);
    faltan.push(...sinHotel);
    if (!dias.length) return { faltan: ['No hay días aprobados en el cronograma ni jornadas en ese mes.'] };
    const v = perfil.vehiculo;
    if (v.propiedad === 'ninguno') return calcularPublico(repId, perfil, mes, dias, faltan);
    const sinKm = dias.filter((d) => d.km == null);
    if (sinKm.length) faltan.push(`${sinKm.length} día(s) del cronograma no tienen km por carretera (${errores.join('; ') || 'sin datos del mapa'}). Se calculan cuando el representante crea la jornada de ese día.`);
    const km = r2(dias.reduce((s, d) => s + (d.km || 0), 0));
    const usaReembolso = v.propiedad === 'propio' && perfil.reembolsoPorKm != null;
    const tipo = v.combustible === 'hibrido' ? v.combustibleHibrido : v.combustible;
    const preciosUsados = {}; const sinPrecio = new Set();
    if (!usaReembolso && v.combustible === 'electrico') faltan.push('El vehículo es eléctrico: el cálculo de costo energético (kWh) aún no está configurado.');
    // Combustible de un grupo de días: los km se agrupan por precio vigente y se redondea una sola vez por grupo.
    async function costoCombustible(ds) {
      if (usaReembolso) return { galones: 0, costo: r2(ds.reduce((s, d) => s + (d.km || 0), 0) * perfil.reembolsoPorKm) }; // el reembolso por km sustituye al combustible
      if (v.combustible === 'electrico') return { galones: 0, costo: 0 };
      const grupos = new Map();
      for (const d of ds) {
        if (!d.km) continue;
        const p = await precioVigente(tipo, d.fecha);
        if (!p) { sinPrecio.add(d.fecha); continue; }
        grupos.set(p.vigenteDesde, { precio: p.precioGalon, km: (grupos.get(p.vigenteDesde)?.km ?? 0) + d.km });
        preciosUsados[p.vigenteDesde] = p.precioGalon;
      }
      let galones = 0; let costo = 0;
      for (const { precio, km: k } of grupos.values()) { const c = calcularCombustible({ kilometros: r2(k), rendimientoKmGalon: v.rendimiento, precioGalon: precio }); galones += c.galones; costo += c.costo; }
      return { galones: r2(galones), costo: r2(costo) };
    }
    const fechasComida = (ds) => new Set(ds.filter((d) => d.conAlimentacion).map((d) => d.fecha)).size;
    // Comida por día: dentro o fuera de su zona de trabajo. Orden: monto propio del representante,
    // luego el de su posición (Montos globales) y, si no hay, la tarifa diaria de su perfil.
    const rep = await users.findUserById(repId);
    const base = await tarifasDePosicion(rep?.position);
    const zonaC = (await data.list('zonas', { representanteId: repId }))[0] ?? null;
    const esDentroC = zonaC?.provincias?.length ? (p) => dentroDeZona(zonaC, p.provincia, p.municipio) : (p) => p.provincia === perfil.residencia?.provincia && p.municipio === perfil.residencia?.municipio;
    const comidaDentro = perfil.publico?.comidaDentro ?? base.montos.comidaDentro ?? perfil.tarifaAlimentacion;
    const comidaFuera = perfil.publico?.comidaFuera ?? base.montos.comidaFuera ?? perfil.tarifaAlimentacion;
    const fuentesComida = perfil.publico?.comidaDentro != null || perfil.publico?.comidaFuera != null ? 'representante' : base.montos.comidaDentro != null || base.montos.comidaFuera != null ? base.fuente : 'perfil';
    const comidaDe = (ds) => {
      const porFecha = new Map();
      for (const d of ds) { if (!d.conAlimentacion) continue; const f = porFecha.get(d.fecha) ?? false; porFecha.set(d.fecha, f || (d.paradas ?? []).some((p) => !esDentroC(p))); }
      let dentro = 0; let fuera = 0; for (const x of porFecha.values()) { if (x) fuera++; else dentro++; }
      return { dentro, fuera, monto: r2(dentro * (comidaDentro ?? 0) + fuera * (comidaFuera ?? 0)) };
    };
    const semanas = await porSemana(mes, dias, { costoCombustible, comidaDia: (ds) => comidaDe(ds).monto });
    if (sinPrecio.size) faltan.push(`No hay precio de ${COMBUSTIBLE_LABEL[tipo]?.toLowerCase() ?? 'combustible'} vigente para ${sinPrecio.size} día(s). Regístralo en Precios de combustible.`);
    // Tope mensual: el del representante si lo tiene; si no, el global. Lo calculado por km se paga hasta el tope.
    const topeRep = perfil.topeCombustible ?? null;
    const tope = topeRep ?? (await verTopeGlobal());
    const combustibleCalculado = r2(semanas.reduce((s, w) => s + w.combustible, 0));
    const galones = r2(semanas.reduce((s, w) => s + w.galones, 0));
    const topado = aplicarTope({ calculado: combustibleCalculado, tope });
    const diasComida = fechasComida(dias);
    const cm = comidaDe(dias);
    const alimentacion = cm.monto;
    const hoteles = dias.filter((d) => d.hospedaje);
    const sinAprobar = hoteles.filter((d) => d.hospedaje.estado !== 'aprobado');
    if (sinAprobar.length) faltan.push(`Hay ${sinAprobar.length} hospedaje(s) sin autorizar por la gerencia.`);
    const hospedaje = r2(semanas.reduce((s, w) => s + w.hospedaje, 0));
    const sum = (k) => r2(dias.reduce((s, d) => s + (d[k] || 0), 0));
    const detalle = calcularPresupuesto({ combustible: topado.aplicado, alimentacion, hospedaje, peajes: sum('peajes'), estacionamiento: sum('estacionamiento'), otros: sum('otros') });
    const nJ = dias.filter((d) => d.origen === 'jornada').length;
    return {
      faltan, detalle: detalle.detalle, total: detalle.total,
      supuestos: {
        jornadas: nJ, diasCronograma: dias.length - nJ, dias: new Set(dias.map((d) => d.fecha)).size, lugares: dias.reduce((s, d) => s + d.lugares, 0),
        km, kmTipo: dias.every((d) => d.kmFuente === 'google') ? 'por carretera (Google)' : dias.some((d) => d.kmFuente === 'google') ? 'mixto: mapa y manual' : 'estimado manual',
        galones, rendimiento: v.rendimiento ?? null, combustible: v.combustible, preciosUsados, diasAlimentacion: diasComida, tarifaAlimentacion: comidaDentro, comidaDentro, comidaFuera, diasComidaDentro: cm.dentro, diasComidaFuera: cm.fuera, comidaFuente: fuentesComida, posicion: rep?.position ?? null,
        reembolsoPorKm: usaReembolso ? perfil.reembolsoPorKm : null, hospedajes: hoteles.length,
        combustibleCalculado, tope, topeFuente: tope == null ? null : topeRep != null ? 'representante' : 'global', excedenteTope: topado.excedente,
        semanas, porDia: dias.map((d) => ({ fecha: d.fecha, origen: d.origen, km: d.km, lugares: d.lugares, ...(d.hospedaje?.plan ? { noche: { precio: d.hospedaje.tarifaNoche, hotel: d.hospedaje.hotel, fuente: d.hospedaje.fuente, municipio: d.hospedaje.municipio } } : {}) })),
      },
      avisos: topado.topado ? [`El combustible calculado (RD$${combustibleCalculado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}) pasa del tope mensual; se presupuesta el tope de RD$${tope.toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`] : [],
    };
  }
  /** Sin vehículo: transporte y comida por día, dentro o fuera de su zona de trabajo, según el cronograma. */
  async function calcularPublico(repId, perfil, mes, dias, faltan) {
    const rep = await users.findUserById(repId);
    const base = await tarifasDePosicion(rep?.position);
    const tarifas = {}; const fuente = {};
    for (const k of TARIFAS_PUBLICO) {
      const propio = perfil.publico?.[k];
      tarifas[k] = propio ?? base.montos[k]; fuente[k] = propio != null ? 'representante' : base.fuente;
    }
    const sinMonto = TARIFAS_PUBLICO.filter((k) => tarifas[k] == null);
    if (sinMonto.length) return { faltan: [...faltan, `Faltan los montos de transporte público (transporte y comida, dentro y fuera de su zona)${base.fuente === 'posicion' && rep?.position ? ` para la posición ${rep.position}` : ''}. Configúralos en Perfiles de viático → Montos globales.`] };
    const zona = (await data.list('zonas', { representanteId: repId }))[0] ?? null;
    const conZona = !!zona?.provincias?.length;
    const avisosZona = conZona ? [] : ['No tiene zona asignada: se tomó su municipio de residencia como "dentro". Asígnale su zona en Representantes.'];
    const esDentro = conZona ? (p) => dentroDeZona(zona, p.provincia, p.municipio) : undefined;
    const r = calcularTransportePublico({ jornadas: dias, esDentro, residencia: perfil.residencia, tarifas });
    const topeRep = perfil.topeCombustible ?? null;
    const tope = topeRep ?? (await verTopeGlobal());
    const topado = aplicarTope({ calculado: r.transporte, tope });
    const semanas = await porSemana(mes, dias, {
      costoCombustible: async (ds) => ({ galones: 0, costo: 0, transporte: calcularTransportePublico({ jornadas: ds, esDentro, residencia: perfil.residencia, tarifas }).transporte }),
      comidaDia: (ds) => calcularTransportePublico({ jornadas: ds, esDentro, residencia: perfil.residencia, tarifas }).alimentacion,
    });
    const hoteles = dias.filter((d) => d.hospedaje);
    const sinAprobar = hoteles.filter((d) => d.hospedaje.estado !== 'aprobado');
    if (sinAprobar.length) faltan.push(`Hay ${sinAprobar.length} hospedaje(s) sin autorizar por la gerencia.`);
    const hospedaje = r2(semanas.reduce((s, w) => s + w.hospedaje, 0));
    const sum = (k) => r2(dias.reduce((s, d) => s + (d[k] || 0), 0));
    const detalle = calcularPresupuesto({ combustible: 0, transporte: topado.aplicado, alimentacion: r.alimentacion, hospedaje, peajes: sum('peajes'), estacionamiento: sum('estacionamiento'), otros: sum('otros') });
    const nJ = dias.filter((d) => d.origen === 'jornada').length;
    return {
      faltan, detalle: detalle.detalle, total: detalle.total,
      supuestos: {
        jornadas: nJ, diasCronograma: dias.length - nJ, dias: r.diasDentro + r.diasFuera, lugares: dias.reduce((s, d) => s + d.lugares, 0),
        km: r2(dias.reduce((s, d) => s + (d.km || 0), 0)), kmTipo: 'transporte público', galones: null, rendimiento: null, combustible: null, preciosUsados: {},
        transportePublico: true, diasDentro: r.diasDentro, diasFuera: r.diasFuera, tarifas, tarifasFuente: fuente, diasDetalle: r.dias,
        posicion: rep?.position ?? null, dentroSegun: conZona ? 'zona' : 'residencia',
        diasAlimentacion: r.diasDentro + r.diasFuera, tarifaAlimentacion: null, reembolsoPorKm: null, hospedajes: hoteles.length,
        combustibleCalculado: r.transporte, tope, topeFuente: tope == null ? null : topeRep != null ? 'representante' : 'global', excedenteTope: topado.excedente,
        semanas, porDia: dias.map((d) => ({ fecha: d.fecha, origen: d.origen, km: d.km, lugares: d.lugares, ...(d.hospedaje?.plan ? { noche: { precio: d.hospedaje.tarifaNoche, hotel: d.hospedaje.hotel, fuente: d.hospedaje.fuente, municipio: d.hospedaje.municipio } } : {}) })),
      },
      avisos: [...avisosZona, ...(topado.topado ? [`El transporte calculado (RD$${r.transporte.toLocaleString('es-DO', { minimumFractionDigits: 2 })}) pasa del tope mensual; se presupuesta el tope de RD$${tope.toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`] : [])],
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
    // Balance: lo asignado menos lo que el representante ya registró como gastado (sin contar lo rechazado).
    const porCategoria = Object.fromEntries(CATEGORIAS_GASTO.map((k) => {
      const asignado = r2((p.detalle?.[k] ?? 0) + (p.ajustes ?? []).filter((a) => a.categoria === k).reduce((s, a) => s + a.monto, 0));
      const gastado = r2((p.gastos ?? []).filter((g) => g.estado !== 'rechazado' && g.categoria === k).reduce((s, g) => s + g.monto, 0));
      return [k, { asignado, gastado, disponible: r2(asignado - gastado) }];
    }));
    const disponible = p.montoAprobado == null ? null : r2(p.montoAprobado - reportado);
    return { ...p, resumen: { aprobado: p.montoAprobado ?? null, entregado, reportado, justificado, disponible, porCategoria, saldo: r2(entregado - justificado), diferenciaPresupuesto: r2(p.total - justificado) } };
  }
  /** La gerencia asigna los viáticos del mes desde el cronograma aprobado: queda aprobado y el representante ve su balance. */
  async function asignarPresupuesto(actor, repId, mes) {
    permitir(rol(actor, ['administrador', 'gerencia']), 'Solo la gerencia asigna viáticos.');
    if (!MES.test(String(mes))) throw new HttpError(422, 'Elige el mes.');
    const rep = repId && await users.findUserById(repId);
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const c = await calcular(repId, mes);
    if (c.faltan?.length) throw new HttpError(409, `Todavía no se puede asignar: ${c.faltan.join(' ')}`);
    const prev = (await data.list('presupuestos', { representanteId: repId, mes }))[0];
    if (prev && !['borrador', 'rechazado', 'solicitado'].includes(prev.estado)) throw new HttpError(409, 'Ese mes ya tiene viáticos aprobados. Los cambios se hacen con ajustes.');
    const datos = { representanteId: repId, mes, detalle: c.detalle, supuestos: c.supuestos, total: c.total, estado: 'aprobado', montoAprobado: c.total, aprobadoPor: actor.id, motivo: null, desembolsos: prev?.desembolsos ?? [], gastos: prev?.gastos ?? [], ajustes: prev?.ajustes ?? [], origen: 'asignado' };
    const p = prev ? await data.update('presupuestos', prev.id, datos) : await data.insert('presupuestos', datos);
    await audit({ actorId: actor.id, action: 'presupuesto_asignado', entity: 'presupuesto', entityId: p.id, before: prev ? { estado: prev.estado } : null, after: { total: p.total } });
    return conSaldo(p);
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
    crearCronogramaLote, proponerCronograma, copiarMesAnterior, hotelDeCronograma, verReferenciaHotel, guardarReferenciaHotel, verTopeGlobal, guardarTopeGlobal, prepararPerfil, verTarifasPublico, guardarTarifasPublico,
    verPresupuesto, solicitar, asignarPresupuesto, decidirPresupuesto, desembolsar, reportarGasto, revisarGasto, liquidar, consolidado, presupuestoPorId,
  };
}

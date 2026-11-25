// Panel de inicio: un resumen por rol con cifras reales del sistema (nada inventado).
// Representante: su zona, lugares, cronograma, km, combustible, tope y viáticos del mes.
// Dependiente: su farmacia (provincia, municipio, sector), vouchers y comisión.
// Gestión: equipo, catálogo, cobertura y viáticos del mes.
import { AuthError as HttpError } from './auth.js';
import { dentroDeZona, excluidoDeRuta, TIPOS_ESTABLECIMIENTO } from './territorio.js';
import { cumpleTodo } from './hoteles.js';
import { hoyRD } from './periodos.js';

const GESTION = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
const r2 = (n) => Math.round(n * 100) / 100;
const sin = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const activoLugar = (x) => !['inactivo', 'inactiva'].includes(x.estado);
const contar = (xs, k) => xs.reduce((m, x) => { const c = typeof k === 'function' ? k(x) : x[k]; m[c] = (m[c] ?? 0) + 1; return m; }, {});
const ordenar = (obj) => Object.entries(obj).map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor || a.nombre.localeCompare(b.nombre, 'es'));

export function createInicio({ data, users, v, c, t, now = () => new Date() }) {
  const hoy = () => hoyRD(now());

  /** Farmacia de la dependiente; si no está ligada, candidatas del catálogo por nombre (y provincia si la escribió). */
  async function farmaciaDe(u) {
    if (u.farmaciaId) {
      const f = await data.get('farmacias', u.farmaciaId);
      if (f) return { farmacia: f, candidatas: [] };
    }
    const k = sin(u.pharmacy);
    if (!k) return { farmacia: null, candidatas: [] };
    const prov = sin(u.province);
    const candidatas = (await data.list('farmacias')).filter((f) => activoLugar(f) && (sin(f.nombre).includes(k) || k.includes(sin(f.nombre))))
      .sort((a, b) => Number(sin(b.provincia) === prov) - Number(sin(a.provincia) === prov) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 8);
    return { farmacia: null, candidatas };
  }

  async function representante(me, mes) {
    const zona = await t.verZona(me, me.id);
    const lz = await t.lugaresDeZona(me, me.id);
    const crons = await v.listarCronogramas(me, { mes });
    const jornadas = (await v.listarJornadas(me, { mes })).filter((j) => j.estado !== 'cancelada');
    let presupuesto = null;
    try { presupuesto = await v.verPresupuesto(me, me.id, mes); } catch { presupuesto = null; }
    const lugares = [...lz.farmacias.map((f) => ({ ...f, tipo: 'farmacia' })), ...lz.establecimientos];
    const programados = new Set(crons.flatMap((x) => x.lugares.map((l) => `${l.refTipo}:${l.refId}`)));
    const porTipo = contar(lugares, (x) => (x.tipo === 'farmacia' ? 'Farmacias' : TIPOS_ESTABLECIMIENTO[x.tipo] ?? 'Otros'));
    const proximo = crons.filter((x) => x.fecha >= hoy()).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
    const calc = presupuesto?.calculo ?? null;
    const extra = {};
    if (me.position === 'Promotora') extra.recetas = (await c.promotoras.listarRecetas(me, { mes })).length;
    return {
      tipo: 'representante', mes, posicion: me.position,
      zona: { provincias: zona.provincias, municipios: zona.municipios },
      lugares: { total: lugares.length, porTipo: ordenar(porTipo), porMunicipio: lz.resumen.map((r) => ({ nombre: r.municipio, provincia: r.provincia, valor: r.farmacia + r.hospital + r.clinica + r.unap + r.cpn + r.otros })).sort((a, b) => b.valor - a.valor), sinUbicacion: lugares.filter((x) => x.lat == null).length },
      cronograma: {
        dias: crons.length, conJornada: crons.filter((x) => x.jornadaId).length, lugaresProgramados: programados.size,
        cobertura: lugares.length ? r2((programados.size / lugares.length) * 100) : 0,
        proximo: proximo && { fecha: proximo.fecha, lugares: proximo.lugares.map((l) => ({ lugar: l.lugar, municipio: l.municipio })), jornadaId: proximo.jornadaId, id: proximo.id },
        dias_lista: crons.map((x) => ({ fecha: x.fecha, lugares: x.lugares.length, jornada: Boolean(x.jornadaId) })),
      },
      jornadas: { total: jornadas.length, realizadas: jornadas.filter((j) => j.estado === 'realizada').length, km: r2(jornadas.reduce((s, j) => s + j.kmEstimados, 0)), kmReales: r2(jornadas.reduce((s, j) => s + (j.kmReales ?? 0), 0)) },
      viaticos: calc?.detalle ? {
        detalle: calc.detalle, total: calc.total, faltan: calc.faltan, avisos: calc.avisos ?? [],
        galones: calc.supuestos.galones, combustibleCalculado: calc.supuestos.combustibleCalculado, tope: calc.supuestos.tope, topeFuente: calc.supuestos.topeFuente,
        estado: presupuesto.guardado?.estado ?? 'sin_solicitud', entregado: presupuesto.guardado?.resumen?.entregado ?? 0,
      } : { faltan: calc?.faltan ?? [], estado: presupuesto?.guardado?.estado ?? 'sin_solicitud' },
      ...extra,
    };
  }

  async function dependiente(me) {
    const { farmacia, candidatas } = await farmaciaDe(me);
    const resumen = await c.comisiones.resumen(me, me.id);
    const vs = await c.vouchers.listar(me, {});
    const meses = {};
    for (const x of vs.filter((y) => y.estado === 'aprobado')) { const m = x.fecha.slice(0, 7); meses[m] = r2((meses[m] ?? 0) + x.total); }
    const ultimos = [];
    const [y, m] = hoy().split('-').map(Number);
    for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); const k = d.toISOString().slice(0, 7); ultimos.push({ nombre: k, valor: meses[k] ?? 0 }); }
    return {
      tipo: 'dependiente',
      farmacia: farmacia && { id: farmacia.id, nombre: farmacia.nombre, provincia: farmacia.provincia, municipio: farmacia.municipio, sector: farmacia.sector ?? null, direccion: farmacia.direccion ?? null, telefono: farmacia.telefono ?? null, lat: farmacia.lat ?? null, lng: farmacia.lng ?? null },
      farmaciaEscrita: { nombre: me.pharmacy ?? null, provincia: me.province ?? null },
      candidatas: candidatas.map((f) => ({ id: f.id, nombre: f.nombre, provincia: f.provincia, municipio: f.municipio, sector: f.sector ?? null })),
      comision: resumen,
      vouchers: { total: vs.length, porEstado: contar(vs, 'estado'), ventasPorMes: ultimos },
    };
  }

  async function gestion(me, mes) {
    const todos = await users.listUsers();
    const activos = todos.filter((u) => u.status === 'activo');
    const reps = activos.filter((u) => u.role === 'representante');
    const farmacias = (await data.list('farmacias')).filter(activoLugar);
    const ests = (await data.list('establecimientos')).filter(activoLugar);
    const hoteles = (await data.list('hoteles')).filter((h) => h.estado !== 'inactivo');
    const crons = (await data.list('cronogramas')).filter((x) => x.estado === 'aprobado' && x.fecha.startsWith(mes));
    const zonas = await data.list('zonas');
    const cobertura = reps.map((u) => {
      const z = zonas.find((x) => x.representanteId === u.id);
      const enZona = z ? farmacias.filter((f) => dentroDeZona(z, f.provincia, f.municipio) && !excluidoDeRuta(z, f.id)).length + ests.filter((e) => dentroDeZona(z, e.provincia, e.municipio) && !excluidoDeRuta(z, e.id)).length : 0;
      const prog = new Set(crons.filter((x) => x.representanteId === u.id).flatMap((x) => x.lugares.map((l) => `${l.refTipo}:${l.refId}`))).size;
      return { id: u.id, nombre: u.fullName, posicion: u.position, provincias: z?.provincias ?? [], lugares: enZona, programados: prog, dias: crons.filter((x) => x.representanteId === u.id).length, cobertura: enZona ? r2((prog / enZona) * 100) : 0 };
    });
    let viaticos = null;
    if (GESTION.includes(me.role)) {
      try { const k = await v.consolidado(me, mes); viaticos = { totales: k.totales, porRepresentante: k.filas.map((f) => ({ nombre: f.nombre, valor: f.total ?? 0, estado: f.estado, entregado: f.entregado })), porEstado: contar(k.filas, 'estado') }; } catch { viaticos = null; }
    }
    const pendientes = (await data.list('vouchers')).filter((x) => x.estado === 'pendiente').length;
    const porProv = contar(farmacias, 'provincia');
    const estsPorProv = contar(ests, 'provincia');
    const provincias = Object.keys({ ...porProv, ...estsPorProv }).map((p) => ({ nombre: p, farmacias: porProv[p] ?? 0, centros: estsPorProv[p] ?? 0, valor: (porProv[p] ?? 0) + (estsPorProv[p] ?? 0) })).sort((a, b) => b.valor - a.valor);
    return {
      tipo: 'gestion', mes,
      equipo: {
        activos: activos.length, porRol: ordenar(contar(activos, 'role')), porPosicion: ordenar(contar(reps, (u) => u.position ?? 'Sin posición')),
        solicitudes: todos.filter((u) => u.status === 'pendiente_aprobacion').length, sinZona: cobertura.filter((x) => !x.provincias.length).length,
        dependientesSinFarmacia: activos.filter((u) => u.role === 'dependiente' && !u.farmaciaId).length,
      },
      catalogo: {
        farmacias: farmacias.length, centros: ests.length, porTipo: ordenar(contar(ests, (e) => TIPOS_ESTABLECIMIENTO[e.tipo] ?? e.tipo)),
        sinUbicacion: farmacias.filter((f) => f.lat == null).length + ests.filter((e) => e.lat == null).length,
        hoteles: hoteles.length, hotelesVerificados: hoteles.filter((h) => Number(h.precioNoche) > 0 && cumpleTodo(h)).length,
        provincias,
      },
      cronogramas: { dias: crons.length, representantesConDias: new Set(crons.map((x) => x.representanteId)).size },
      cobertura: cobertura.sort((a, b) => a.cobertura - b.cobertura || a.nombre.localeCompare(b.nombre, 'es')),
      viaticos, vouchersPendientes: pendientes,
    };
  }

  async function resumen(me, mes) {
    if (!me || me.status !== 'activo') throw new HttpError(403, 'No tienes permiso para esta acción.');
    const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes)) ? mes : hoy().slice(0, 7);
    const base = { usuario: { nombre: me.fullName, rol: me.role, posicion: me.position ?? null }, hoy: hoy() };
    if (me.role === 'representante') return { ...base, ...(await representante(me, m)) };
    if (me.role === 'dependiente') return { ...base, ...(await dependiente(me)) };
    if (me.role === 'medico') {
      const ficha = (await data.list('medicos')).find((x) => x.usuarioId === me.id) ?? null;
      const rs = (await c.promotoras.listarRecetas(me, { mes: m }));
      return { ...base, tipo: 'medico', mes: m, ficha: ficha && { nombre: ficha.nombre, especialidad: ficha.especialidad, lugares: ficha.lugares ?? [] },
        recetas: contar(rs, (r) => r.estado), total: rs.length };
    }
    if (GESTION.includes(me.role)) return { ...base, ...(await gestion(me, m)) };
    return { ...base, tipo: 'vacio' };
  }

  /** Liga una dependiente con su farmacia. Ella puede hacerlo una vez; la gestión puede cambiarlo siempre. */
  async function ligarFarmacia(actor, usuarioId, farmaciaId, audit) {
    const u = await users.findUserById(usuarioId);
    if (!u || u.role !== 'dependiente') throw new HttpError(404, 'La dependiente no existe.');
    const gest = actor.status === 'activo' && ['administrador', 'gerencia', 'supervisor'].includes(actor.role);
    const propia = actor.id === u.id && actor.status === 'activo' && !u.farmaciaId;
    if (!gest && !propia) throw new HttpError(403, u.farmaciaId && actor.id === u.id ? 'Tu farmacia ya está ligada; pide a tu supervisor que la cambie.' : 'No tienes permiso para esta acción.');
    const f = farmaciaId ? await data.get('farmacias', String(farmaciaId)) : null;
    if (!f || !activoLugar(f)) throw new HttpError(422, 'Elige una farmacia del catálogo.', { farmaciaId: 'Elige una farmacia.' });
    await users.updateUser(u.id, { farmaciaId: f.id });
    await audit({ actorId: actor.id, action: 'dependiente_farmacia', entity: 'user', entityId: u.id, before: { farmaciaId: u.farmaciaId ?? null }, after: { farmaciaId: f.id, farmacia: f.nombre } });
    return { usuarioId: u.id, farmacia: { id: f.id, nombre: f.nombre, provincia: f.provincia, municipio: f.municipio, sector: f.sector ?? null } };
  }

  async function dependientes(actor) {
    if (!(actor?.status === 'activo' && ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(actor.role))) throw new HttpError(403, 'No tienes permiso para esta acción.');
    const ds = (await users.listUsers()).filter((u) => u.role === 'dependiente' && u.status === 'activo');
    const out = [];
    for (const u of ds) { const { farmacia, candidatas } = await farmaciaDe(u); out.push({ id: u.id, nombre: u.fullName, escrita: u.pharmacy ?? null, provinciaEscrita: u.province ?? null, farmacia: farmacia && { id: farmacia.id, nombre: farmacia.nombre, provincia: farmacia.provincia, municipio: farmacia.municipio, sector: farmacia.sector ?? null }, candidatas: candidatas.map((f) => ({ id: f.id, nombre: f.nombre, provincia: f.provincia, municipio: f.municipio })) }); }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  return { resumen, ligarFarmacia, dependientes };
}

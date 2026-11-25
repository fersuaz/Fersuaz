import { createHash } from 'node:crypto';
// Módulo comercial: dependientes (vouchers y comisiones) y promotoras (recetas e inventario).
// Toda regla de permiso vive aquí, en el servidor.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';
import { calcularComisionVouchers, evaluarAlertaInventario } from './calculos.js';
import { esFechaISO, hoyRD, periodoDe, rangoDe } from './periodos.js';
import { normalizeName } from './validation.js';
import { guardarAdjunto } from './adjuntos.js';
import { claveMed, codigoMed, gruposRepetidos } from './medicamentos-dup.js';
import { buscarRepetida, textoRepetida, esHuella, esDhash } from './fotos.js';
import { provinciaOficial, municipioOficial, dentroDeZona } from './territorio.js';

const GESTION = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
const esActivo = (u) => u && u.status === STATUS.ACTIVO;
export const esPromotora = (u) => esActivo(u) && u.role === 'representante' && u.position === 'Promotora';
export const esMedico = (u) => esActivo(u) && u.role === 'medico';
/** Solo las recetas aprobadas cuentan en metas, reportes y alertas. Las de antes de la revisión quedaron aprobadas. */
export const recetaAprobada = (r) => (r.estado ?? 'aprobada') === 'aprobada';
export const esVendedor = (u) => esActivo(u) && u.role === 'representante' && u.position === 'Vendedor';
export const esDependiente = (u) => esActivo(u) && u.role === 'dependiente';
/** Vendedor o PVC: también cargan vouchers a nombre de una dependiente de su zona. */
export const esVendedorPVC = (u) => esActivo(u) && u.role === 'representante' && ['Vendedor', 'PVC'].includes(u.position);
/** Quienes cargan vouchers a nombre de la dependiente de una farmacia de su zona. */
const cargaPorDependiente = (u) => esActivo(u) && u.role === 'representante' && ['Vendedor', 'PVC', 'Promotora', 'Visitador'].includes(u.position);
const tieneRol = (u, roles) => esActivo(u) && roles.includes(u.role);

function permitir(cond, msg = 'No tienes permiso para esta acción.') { if (!cond) throw new HttpError(403, msg); }
function invalido(fields) { throw new HttpError(422, 'Revisa los campos marcados.', fields); }
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function texto(errors, campo, v, { min = 2, max = 120, requerido = true, etiqueta = 'Este campo' } = {}) {
  const s = normalizeName(v);
  if (!s) { if (requerido) errors[campo] = `${etiqueta} es obligatorio.`; return null; }
  if (s.length < min) errors[campo] = `${etiqueta} es demasiado corto.`;
  if (s.length > max) errors[campo] = `${etiqueta} no puede pasar de ${max} caracteres.`;
  return s;
}


/** Teléfono dominicano a 10 dígitos (sin +1, espacios ni guiones), o null si no es válido. */
export function telefonoRD(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return /^(809|829|849)\d{7}$/.test(d) ? d : null;
}
export const telefonoVisible = (d) => (d ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : '');
const telefonoOculto = (d) => (d ? `···-···-${d.slice(6)}` : '');

export function createComercial({ data, users, files, audit, now = () => new Date() }) {
  const hoy = () => hoyRD(now());
  /** Mes (AAAA-MM) en hora de Santo Domingo de una fecha ISO. */
  const mesDe = (iso) => hoyRD(new Date(iso)).slice(0, 7);

  async function config(clave) {
    const [c] = await data.list('configuracion', { clave });
    return c ? c.valor : null;
  }
  async function setConfig(actor, clave, valor) {
    const [c] = await data.list('configuracion', { clave });
    const out = c ? await data.update('configuracion', c.id, { valor, actualizadoPor: actor.id })
      : await data.insert('configuracion', { clave, valor, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'config_actualizada', entity: 'configuracion', entityId: clave, before: c?.valor ?? null, after: valor });
    return out;
  }

  async function medicamentoActivo(id) {
    const m = id && (await data.get('medicamentos', id));
    return m && m.activo ? m : null;
  }

  // ------------------------------------------------------------ catálogos
  const catalogo = {
    async crearMedicamento(actor, input) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']));
      const e = {};
      const nombre = texto(e, 'nombre', input.nombre, { etiqueta: 'El nombre' });
      const linea = texto(e, 'linea', input.linea, { etiqueta: 'La línea', requerido: false });
      const presentacion = texto(e, 'presentacion', input.presentacion, { etiqueta: 'La presentación', requerido: false });
      const precio = input.precio == null || input.precio === '' ? null : Number(input.precio);
      if (precio != null && !(precio > 0 && precio < 1e7)) e.precio = 'Escribe un precio mayor que cero o déjalo vacío.';
      if (Object.keys(e).length) invalido(e);
      const codigo = codigoMed(input.codigo);
      if (codigo && !/^[A-Z0-9-]{2,30}$/.test(codigo)) e.codigo = 'El código solo lleva letras, números y guiones.';
      if (Object.keys(e).length) invalido(e);
      const todos = await data.list('medicamentos');
      const dup = todos.find((m) => m.activo !== false && claveMed(m.nombre, m.presentacion) === claveMed(nombre, presentacion));
      if (dup) throw new HttpError(409, `Ese medicamento ya está en el catálogo: ${dup.nombre}${dup.presentacion ? `, ${dup.presentacion}` : ''}.`, { nombre: 'Repetido: ya existe.' });
      if (codigo && todos.some((m) => m.activo !== false && codigoMed(m.codigo) === codigo)) throw new HttpError(409, 'Ese código ya lo usa otro medicamento.', { codigo: 'Código repetido.' });
      const m = await data.insert('medicamentos', { codigo: codigo || null, nombre, linea, presentacion, precio: precio == null ? null : round2(precio), activo: true });
      if (precio != null) await data.insert('preciosMedicamento', { medicamentoId: m.id, precio: round2(precio), vigenteDesde: hoy(), fuente: 'manual', registradoPor: actor.id });
      await audit({ actorId: actor.id, action: 'medicamento_creado', entity: 'medicamento', entityId: m.id, after: m });
      return m;
    },
    /** Editar código, nombre, presentación o línea. El precio se cambia aparte para que quede su historial. */
    async editarMedicamento(actor, id, input = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia editan medicamentos.');
      const m = await data.get('medicamentos', String(id));
      if (!m) throw new HttpError(404, 'El medicamento no existe.');
      const e = {}; const patch = {};
      if (input.nombre !== undefined) patch.nombre = texto(e, 'nombre', input.nombre, { etiqueta: 'El nombre' });
      if (input.presentacion !== undefined) patch.presentacion = texto(e, 'presentacion', input.presentacion, { etiqueta: 'La presentación', requerido: false }) || null;
      if (input.linea !== undefined) patch.linea = texto(e, 'linea', input.linea, { etiqueta: 'La línea', requerido: false }) || null;
      if (input.codigo !== undefined) {
        const c = codigoMed(input.codigo);
        if (c && !/^[A-Z0-9-]{2,30}$/.test(c)) e.codigo = 'El código solo lleva letras, números y guiones.';
        patch.codigo = c || null;
      }
      if (Object.keys(e).length) invalido(e);
      const otros = (await data.list('medicamentos')).filter((x) => x.id !== m.id && x.activo !== false);
      if (patch.codigo && otros.some((x) => codigoMed(x.codigo) === patch.codigo)) throw new HttpError(409, 'Ese código ya lo usa otro medicamento.', { codigo: 'Código repetido.' });
      const nombre = patch.nombre ?? m.nombre; const pres = patch.presentacion !== undefined ? patch.presentacion : m.presentacion;
      if (otros.some((x) => claveMed(x.nombre, x.presentacion) === claveMed(nombre, pres))) throw new HttpError(409, 'Ya hay otro medicamento con ese nombre y presentación.', { nombre: 'Nombre repetido.' });
      const out = await data.update('medicamentos', m.id, patch);
      await audit({ actorId: actor.id, action: 'medicamento_editado', entity: 'medicamento', entityId: m.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, m[k] ?? null])), after: patch });
      return out;
    },
    /**
     * Eliminar del catálogo: deja de aparecer para cargar recetas, vouchers, pedidos y la tienda.
     * Las recetas, vouchers y ventas que ya lo usan se conservan (no se borra el historial).
     */
    async eliminarMedicamento(actor, id, { motivo } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia eliminan medicamentos.');
      const m = await data.get('medicamentos', String(id));
      if (!m || m.activo === false) throw new HttpError(404, 'El medicamento no existe.');
      const out = await data.update('medicamentos', m.id, { activo: false, publicado: false });
      await audit({ actorId: actor.id, action: 'medicamento_eliminado', entity: 'medicamento', entityId: m.id, before: { activo: true }, after: { activo: false, motivo: normalizeName(motivo) || null } });
      return out;
    },
    async repetidosMedicamentos(actor) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']));
      return { grupos: gruposRepetidos(await data.list('medicamentos')) };
    },
    /**
     * Quitar repetidos: en cada grupo se conserva uno y los demás se eliminan del catálogo. Al conservado se le
     * pasan el código, el precio y la línea que le falten. `auto`: solo los repetidos exactos, sin preguntar.
     */
    async limpiarRepetidos(actor, { auto = false, grupos: elegidos = [] } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']), 'Solo la administración o la gerencia eliminan medicamentos.');
      const todos = await data.list('medicamentos');
      const porId = new Map(todos.map((m) => [m.id, m]));
      let trabajo;
      if (auto) trabajo = gruposRepetidos(todos).filter((g) => g.exacto).map((g) => ({ conservar: g.conservar, quitar: g.items.map((m) => m.id).filter((x) => x !== g.conservar) }));
      else {
        const vigentes = gruposRepetidos(todos);
        trabajo = (Array.isArray(elegidos) ? elegidos : []).map((g) => {
          const grupo = vigentes.find((v) => v.items.some((m) => m.id === g.conservar));
          if (!grupo) invalido({ grupos: 'Ese grupo de repetidos ya no existe. Vuelve a cargar la lista.' });
          const ids = new Set(grupo.items.map((m) => m.id));
          const quitar = (g.quitar ?? []).filter((x) => ids.has(x) && x !== g.conservar);
          return { conservar: g.conservar, quitar };
        });
      }
      let eliminados = 0;
      for (const g of trabajo) {
        const k = porId.get(g.conservar); if (!k) continue;
        const patch = {};
        for (const id of g.quitar) {
          const x = porId.get(id); if (!x || x.activo === false) continue;
          if (!k.codigo && !patch.codigo && x.codigo) patch.codigo = x.codigo;
          if (k.precio == null && patch.precio == null && x.precio != null) patch.precio = x.precio;
          if (!k.linea && !patch.linea && x.linea) patch.linea = x.linea;
          await data.update('medicamentos', x.id, { activo: false, publicado: false, ...(x.codigo && (patch.codigo === x.codigo) ? { codigo: null } : {}) });
          await audit({ actorId: actor.id, action: 'medicamento_repetido_eliminado', entity: 'medicamento', entityId: x.id, after: { conservado: k.id, nombre: x.nombre, automatico: auto } });
          eliminados++;
        }
        if (Object.keys(patch).length) await data.update('medicamentos', k.id, patch);
      }
      return { eliminados, grupos: trabajo.length };
    },
    async listarMedicamentos() { return (await data.list('medicamentos')).filter((m) => m.activo); },

    /** `google`: datos verificados en el servidor (coordenadas, place id); nunca vienen del navegador. */
    async crearFarmacia(actor, input, google = null, { revisado = false } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor']) || esVendedor(actor));
      const e = {};
      const nombre = texto(e, 'nombre', input.nombre, { etiqueta: 'El nombre', max: 160 });
      const provincia = provinciaOficial(input.provincia);
      if (!provincia) e.provincia = 'Elige una provincia oficial.';
      const municipio = provincia && municipioOficial(provincia, input.municipio);
      if (provincia && !municipio) e.municipio = `Ese municipio no pertenece a ${provincia}.`;
      const sector = texto(e, 'sector', input.sector, { etiqueta: 'El sector', requerido: false });
      const direccion = texto(e, 'direccion', input.direccion, { etiqueta: 'La dirección', requerido: false, max: 200 });
      const telefono = texto(e, 'telefono', input.telefono, { etiqueta: 'El teléfono', requerido: false, max: 30 });
      if (Object.keys(e).length) invalido(e);
      const sin = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const dup = !revisado && (await data.list('farmacias')).find((f) => (sin(f.nombre) === sin(nombre) && f.municipio === municipio) || (google?.placeId && f.placeId === google.placeId));
      if (dup) throw new HttpError(409, 'Esa farmacia ya está registrada en ese municipio.', { nombre: 'Ya existe en ese municipio.' });
      const estado = tieneRol(actor, ['administrador', 'gerencia', 'supervisor']) ? 'validada' : 'pendiente';
      const f = await data.insert('farmacias', {
        nombre, provincia, municipio, sector, direccion: direccion ?? google?.direccion ?? null, telefono: telefono ?? google?.telefono ?? null,
        lat: google?.lat ?? null, lng: google?.lng ?? null, placeId: google?.placeId ?? null, fuente: google ? 'google' : 'manual', estado, creadoPor: actor.id,
      });
      await audit({ actorId: actor.id, action: 'farmacia_creada', entity: 'farmacia', entityId: f.id, after: { nombre, municipio, fuente: f.fuente } });
      return f;
    },
    async listarFarmacias(where = {}) { return data.list('farmacias', where); },

    async crearMedico(actor, input) {
      permitir(tieneRol(actor, GESTION) || esPromotora(actor));
      const e = {};
      const nombre = texto(e, 'nombre', input.nombre, { etiqueta: 'El nombre', min: 3 });
      const especialidad = texto(e, 'especialidad', input.especialidad, { etiqueta: 'La especialidad' });
      const centro = texto(e, 'centro', input.centro, { etiqueta: 'El centro', requerido: false });
      const provincia = texto(e, 'provincia', input.provincia, { etiqueta: 'La provincia' });
      const municipio = texto(e, 'municipio', input.municipio, { etiqueta: 'El municipio' });
      if (Object.keys(e).length) invalido(e);
      const dup = (await data.list('medicos')).find((m) => m.nombre.toLowerCase() === nombre.toLowerCase() && m.municipio.toLowerCase() === municipio.toLowerCase());
      if (dup) return dup; // mismo médico: se reutiliza, no se duplica
      const estado = tieneRol(actor, ['administrador', 'gerencia']) ? 'validado' : 'pendiente';
      const m = await data.insert('medicos', { nombre, especialidad, centro, provincia, municipio, estado, creadoPor: actor.id });
      await audit({ actorId: actor.id, action: 'medico_creado', entity: 'medico', entityId: m.id, after: m });
      return m;
    },
    async listarMedicos() { return data.list('medicos'); },

    async validar(actor, col, id) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']));
      if (!['farmacias', 'medicos'].includes(col)) throw new HttpError(404, 'Ruta no encontrada.');
      const r = await data.get(col, id);
      if (!r) throw new HttpError(404, 'El registro no existe.');
      const estado = col === 'farmacias' ? 'validada' : 'validado';
      const out = await data.update(col, id, { estado });
      await audit({ actorId: actor.id, action: 'registro_validado', entity: col, entityId: id, before: { estado: r.estado }, after: { estado } });
      return out;
    },
  };

  // ------------------------------------------------------------ comisiones
  async function configComision(dependienteId) {
    const global = await config('comision_global');
    const propio = await config(`comision_dep_${dependienteId}`);
    if (!global) return null;
    return { periodo: global.periodo, porcentaje: propio?.porcentaje ?? global.porcentaje, origen: propio ? 'dependiente' : 'global' };
  }
  async function periodoCerrado(dependienteId, fecha) {
    const cierres = await data.list('cierres', { dependienteId });
    return cierres.find((c) => fecha >= c.desde && fecha <= c.hasta) ?? null;
  }

  const comisiones = {
    async configurar(actor, input) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'finanzas']));
      const e = {};
      const pct = Number(input.porcentaje);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) e.porcentaje = 'Escribe un porcentaje entre 0 y 100.';
      if (input.dependienteId) {
        const d = await users.findUserById(input.dependienteId);
        if (!d || d.role !== 'dependiente') e.dependienteId = 'Ese dependiente no existe.';
        if (Object.keys(e).length) invalido(e);
        return setConfig(actor, `comision_dep_${input.dependienteId}`, { porcentaje: round2(pct) });
      }
      if (!['quincenal', 'mensual'].includes(input.periodo)) e.periodo = 'Elige quincenal o mensual.';
      if (Object.keys(e).length) invalido(e);
      return setConfig(actor, 'comision_global', { porcentaje: round2(pct), periodo: input.periodo });
    },
    async verConfig(actor) {
      permitir(tieneRol(actor, GESTION));
      const global = await config('comision_global');
      const deps = (await users.listUsers()).filter((u) => u.role === 'dependiente');
      const propios = [];
      for (const d of deps) {
        const c = await config(`comision_dep_${d.id}`);
        if (c) propios.push({ dependienteId: d.id, nombre: d.fullName, porcentaje: c.porcentaje });
      }
      return { global, propios };
    },

    async resumen(actor, dependienteId, clavePeriodo) {
      const propio = esDependiente(actor) && actor.id === dependienteId;
      permitir(propio || tieneRol(actor, GESTION));
      const cfg = await configComision(dependienteId);
      if (!cfg) return { configurado: false, mensaje: 'La gerencia todavía no ha configurado el porcentaje ni el período de comisión.' };
      const rango = clavePeriodo ? rangoDe(clavePeriodo) : periodoDe(hoy(), cfg.periodo);
      const todos = (await data.list('vouchers', { dependienteId })).filter((v) => v.fecha >= rango.desde && v.fecha <= rango.hasta);
      const aprobados = todos.filter((v) => v.estado === 'aprobado');
      const calc = aprobados.length ? calcularComisionVouchers(aprobados, cfg.porcentaje) : { ventas: 0, comision: 0, porMedicamento: {} };
      const cierre = (await data.list('cierres', { dependienteId })).find((c) => c.periodo === rango.clave) ?? null;
      return {
        configurado: true, periodo: rango, porcentaje: cfg.porcentaje, origen: cfg.origen, tipo: cfg.periodo,
        ventasAprobadas: calc.ventas, comision: calc.comision, porMedicamento: calc.porMedicamento,
        vouchers: { aprobados: aprobados.length, pendientes: todos.filter((v) => v.estado === 'pendiente').length, rechazados: todos.filter((v) => v.estado === 'rechazado').length },
        cierre,
      };
    },

    async cerrar(actor, dependienteId, clavePeriodo) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'finanzas']), 'Solo finanzas o la gerencia pueden cerrar un período.');
      const d = await users.findUserById(dependienteId);
      if (!d || d.role !== 'dependiente') throw new HttpError(404, 'Ese dependiente no existe.');
      const cfg = await configComision(dependienteId);
      if (!cfg) throw new HttpError(409, 'Configura primero el porcentaje y el período de comisión.');
      const rango = rangoDe(clavePeriodo);
      if (rango.hasta >= hoy()) throw new HttpError(409, 'El período todavía no ha terminado.');
      if ((await data.list('cierres', { dependienteId })).some((c) => c.periodo === rango.clave)) throw new HttpError(409, 'Ese período ya está cerrado.');
      const vs = (await data.list('vouchers', { dependienteId })).filter((v) => v.fecha >= rango.desde && v.fecha <= rango.hasta);
      if (vs.some((v) => v.estado === 'pendiente')) throw new HttpError(409, 'Hay vouchers pendientes de revisar en ese período.');
      const aprobados = vs.filter((v) => v.estado === 'aprobado');
      const calc = aprobados.length ? calcularComisionVouchers(aprobados, cfg.porcentaje) : { ventas: 0, comision: 0 };
      const c = await data.insert('cierres', {
        dependienteId, periodo: rango.clave, desde: rango.desde, hasta: rango.hasta,
        ventas: calc.ventas, porcentaje: cfg.porcentaje, comision: calc.comision, voucherIds: aprobados.map((v) => v.id), cerradoPor: actor.id,
      });
      await audit({ actorId: actor.id, action: 'periodo_cerrado', entity: 'cierre', entityId: c.id, after: c });
      return c;
    },
    async listarCierres(actor, dependienteId) {
      permitir((esDependiente(actor) && actor.id === dependienteId) || tieneRol(actor, GESTION));
      return data.list('cierres', dependienteId ? { dependienteId } : {});
    },
  };

  // ------------------------------------------------------------ vouchers
  /** Dependientes cuya farmacia está en la zona del Vendedor o PVC. */
  /** Pacientes que puede ver la promotora: los que registró ella o los que tienen recetas en su zona. */
  async function pacientesVisibles(actor, recetas) {
    // El médico ve los pacientes que registró él o los de sus propias recetas.
    if (esMedico(actor)) { const suyos = new Set(recetas.filter((r) => r.cargadoPor === actor.id).map((r) => r.pacienteId)); return (p) => p.creadoPor === actor.id || suyos.has(p.id); }
    if (!esPromotora(actor)) return () => true;
    const zona = (await data.list('zonas', { representanteId: actor.id }))[0] ?? null;
    const enZona = new Set(recetas.filter((r) => r.promotoraId === actor.id || (zona && dentroDeZona(zona, r.provincia, r.municipio))).map((r) => r.pacienteId));
    return (p) => p.creadoPor === actor.id || enZona.has(p.id);
  }
  async function dependientesDeZona(actor) {
    const zona = (await data.list('zonas', { representanteId: actor.id }))[0] ?? null;
    if (!zona?.provincias?.length) return [];
    const out = [];
    for (const d of (await users.listUsers()).filter((u) => u.role === 'dependiente' && u.status === STATUS.ACTIVO && u.farmaciaId)) {
      const f = await data.get('farmacias', d.farmaciaId);
      if (f && dentroDeZona(zona, f.provincia, f.municipio)) out.push({ id: d.id, nombre: d.fullName, farmaciaId: f.id, farmacia: f.nombre, provincia: f.provincia, municipio: f.municipio });
    }
    return out.sort((a, b) => a.farmacia.localeCompare(b.farmacia, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function nombreFarmacia(u) {
    if (u.farmaciaId) { const f = await data.get('farmacias', u.farmaciaId); if (f) return f.nombre; }
    return u.pharmacy ?? null;
  }

  /** Medicamentos (cantidad × precio) y médico de un voucher: lo mismo al cargarlo y al corregirlo. */
  async function contenidoVoucher(input, e) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) e.items = 'Agrega al menos un medicamento.';
    if (items.length > 50) e.items = 'Máximo 50 medicamentos por voucher.';
    const lineas = [];
    for (const [i, it] of items.entries()) {
      const med = await medicamentoActivo(it.medicamentoId);
      const cantidad = Number(it.cantidad);
      // Precio por unidad: el subtotal es precio × cantidad. Se acepta también el monto de la línea (versión anterior).
      const precio = it.precio != null && it.precio !== '' ? Number(it.precio) : null;
      const monto = precio != null ? precio * cantidad : Number(it.monto);
      if (!med) e[`items.${i}.medicamentoId`] = 'Elige un medicamento del catálogo.';
      if (!Number.isInteger(cantidad) || cantidad < 1) e[`items.${i}.cantidad`] = 'La cantidad debe ser un número entero mayor que cero.';
      if (precio != null && (!Number.isFinite(precio) || precio <= 0)) e[`items.${i}.precio`] = 'Escribe el precio en RD$, mayor que cero.';
      else if (!Number.isFinite(monto) || monto <= 0) e[`items.${i}.${precio != null ? 'precio' : 'monto'}`] = 'Escribe el precio en RD$, mayor que cero.';
      if (med) lineas.push({ medicamentoId: med.id, medicamento: med.nombre, presentacion: med.presentacion ?? null, cantidad, ...(precio != null ? { precio: round2(precio) } : {}), monto: round2(monto) });
    }
    // Médico que prescribió (opcional): uno ya registrado.
    let medico = null;
    if (input.medicoId) { medico = await data.get('medicos', String(input.medicoId)); if (!medico || medico.estado === 'rechazado') e.medicoId = 'Ese médico no está registrado. Elígelo de la lista o agrégalo.'; }
    return { lineas, medico };
  }
  const vouchers = {
    dependientesDeZona: async (actor) => { permitir(cargaPorDependiente(actor), 'Solo los representantes cargan vouchers a nombre de una dependiente.'); return dependientesDeZona(actor); },
    /** Porcentaje de comisión que aplica a una dependiente (para mostrar la comisión estimada mientras se carga). */
    async porcentaje(actor, dependienteId) {
      const id = String(dependienteId || actor.id);
      const permitido = (esDependiente(actor) && actor.id === id) || tieneRol(actor, GESTION) || (cargaPorDependiente(actor) && (await dependientesDeZona(actor)).some((d) => d.id === id));
      permitir(permitido);
      const cfg = await configComision(id);
      return cfg ? { porcentaje: cfg.porcentaje, periodo: cfg.periodo } : { porcentaje: null, periodo: null };
    },
    async crear(actor, input) {
      permitir(esDependiente(actor) || cargaPorDependiente(actor), 'Solo los dependientes de farmacia y los representantes (vendedor, PVC, visitador o promotora) cargan vouchers.');
      let dep = actor;
      if (!esDependiente(actor)) {
        const id = String(input.dependienteId ?? '');
        if (!id) invalido({ dependienteId: 'Elige la dependiente a quien pertenece el voucher.' });
        if (!(await dependientesDeZona(actor)).some((d) => d.id === id)) throw new HttpError(403, 'Esa dependiente no está en una farmacia de tu zona.', { dependienteId: 'Elige una dependiente de tu zona.' });
        dep = await users.findUserById(id);
      }
      const e = {};
      // El número de voucher es opcional: la foto identifica el voucher.
      const referencia = String(input.referencia ?? '').trim() ? texto(e, 'referencia', input.referencia, { etiqueta: 'El número de voucher', min: 1, max: 40 }) : null;
      if (!input.foto && !referencia) e.foto = 'Sube la foto del voucher.';
      let huella = null;
      if (input.foto) {
        const bytes = Buffer.from(String(input.foto.base64 ?? ''), 'base64');
        huella = esHuella(input.fotoHuella) ? input.fotoHuella : createHash('sha256').update(bytes).digest('hex');
      }
      const dhash = input.foto && esDhash(input.fotoDhash) ? input.fotoDhash : null;
      if (!esFechaISO(input.fecha)) e.fecha = 'Elige la fecha del voucher.';
      else if (input.fecha > hoy()) e.fecha = 'La fecha no puede ser futura.';
      const { lineas, medico } = await contenidoVoucher(input, e);
      if (Object.keys(e).length) invalido(e);
      const previos = (await data.list('vouchers', { dependienteId: dep.id })).filter((v) => v.estado !== 'anulado');
      if (referencia && previos.some((v) => (v.referencia ?? '').toLowerCase() === referencia.toLowerCase())) {
        throw new HttpError(409, 'Ya hay un voucher con ese número para esta dependiente.', { referencia: 'Ese número de voucher ya está registrado.' });
      }
      // La misma foto no entra dos veces, la cargue quien la cargue (los rechazados y anulados se pueden volver a subir).
      const rep = (huella || dhash) && buscarRepetida((await data.list('vouchers')).filter((v) => !['anulado', 'rechazado'].includes(v.estado)), { huella, dhash });
      if (rep) throw new HttpError(409, textoRepetida(rep, 'voucher', actor.id), { foto: 'Foto repetida.' });
      if (await periodoCerrado(dep.id, input.fecha)) throw new HttpError(409, 'Ese período de comisión ya está cerrado.', { fecha: 'El período de esa fecha ya se cerró.' });
      const foto = input.foto ? await guardarAdjunto(files, actor, input.foto, 'voucher') : null;
      const v = await data.insert('vouchers', {
        dependienteId: dep.id, farmacia: await nombreFarmacia(dep), referencia, fecha: input.fecha, foto, fotoHuella: huella, fotoDhash: dhash,
        items: lineas, total: round2(lineas.reduce((s, l) => s + l.monto, 0)), estado: 'pendiente', registradoPor: actor.id,
        medicoId: medico?.id ?? null, medico: medico ? `${medico.nombre}${medico.especialidad ? `, ${medico.especialidad}` : ''}` : null,
      });
      await audit({ actorId: actor.id, action: 'voucher_cargado', entity: 'voucher', entityId: v.id, after: { total: v.total, dependienteId: dep.id, ...(dep.id !== actor.id ? { cargadoPor: actor.fullName } : {}) } });
      return v;
    },
    async listar(actor, filtro = {}) {
      const nombres = async () => Object.fromEntries((await users.listUsers()).map((u) => [u.id, u.fullName]));
      const conNombres = async (vs) => {
        const us = await users.listUsers(); const n = Object.fromEntries(us.map((u) => [u.id, u.fullName]));
        // provincia y municipio de la farmacia de cada dependiente, para filtrar por zona
        const farmaciaDe = Object.fromEntries(us.filter((u) => u.farmaciaId).map((u) => [u.id, u.farmaciaId]));
        const fs = Object.fromEntries((await data.list('farmacias')).map((f) => [f.id, f]));
        return vs.map((v) => { const f = fs[farmaciaDe[v.dependienteId]]; return { ...v, dependiente: n[v.dependienteId] ?? '', cargadoPor: v.registradoPor && v.registradoPor !== v.dependienteId ? n[v.registradoPor] ?? '' : null, provincia: f?.provincia ?? null, municipio: f?.municipio ?? null }; });
      };
      if (esDependiente(actor)) return conNombres(await data.list('vouchers', { dependienteId: actor.id, ...(filtro.estado ? { estado: filtro.estado } : {}) }));
      if (cargaPorDependiente(actor)) return conNombres(await data.list('vouchers', { registradoPor: actor.id, ...(filtro.estado ? { estado: filtro.estado } : {}) }));
      permitir(tieneRol(actor, GESTION));
      const where = {}; if (filtro.estado) where.estado = filtro.estado; if (filtro.dependienteId) where.dependienteId = filtro.dependienteId;
      return conNombres(await data.list('vouchers', where));
    },
    async decidir(actor, id, aprobar, motivo, { corregible = false } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas']), 'No tienes permiso para revisar vouchers.');
      const v = await data.get('vouchers', id);
      if (!v) throw new HttpError(404, 'El voucher no existe.');
      if (v.estado !== 'pendiente') throw new HttpError(409, 'Este voucher ya fue revisado.');
      if (await periodoCerrado(v.dependienteId, v.fecha)) throw new HttpError(409, 'Ese período de comisión ya está cerrado.');
      const m = normalizeName(motivo);
      if (!aprobar && m.length < 3) throw new HttpError(422, 'Explica por qué se rechaza.', { motivo: 'Escribe el motivo del rechazo.' });
      const estado = aprobar ? 'aprobado' : 'rechazado';
      // Al aprobar, el motivo es una nota opcional. Al rechazar, `corregible` deja que el usuario lo corrija y lo reenvíe
      // dentro del mes; si no lo hace, se elimina al cerrar el mes (ver limpiarRechazados).
      const out = await data.update('vouchers', id, { estado, decididoPor: actor.id, decididoAt: now().toISOString(), motivo: aprobar ? null : m, nota: aprobar ? (m || null) : null, corregible: !aprobar && Boolean(corregible) });
      await audit({ actorId: actor.id, action: `voucher_${estado}`, entity: 'voucher', entityId: id, before: { estado: v.estado }, after: { estado, motivo: m || null, corregible: !aprobar && Boolean(corregible) } });
      return out;
    },
    /** Aprobar o rechazar varios a la vez. Cada uno pasa por las mismas reglas que uno solo. */
    async decidirLote(actor, { ids, aprobar, motivo, corregible } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas']), 'No tienes permiso para revisar vouchers.');
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000) invalido({ ids: 'Elige de 1 a 1,000 vouchers.' });
      if (!aprobar && normalizeName(motivo).length < 3) throw new HttpError(422, 'Explica por qué se rechazan.', { motivo: 'Escribe el motivo del rechazo.' });
      let hechos = 0; const errores = []; const hechosIds = [];
      for (const id of [...new Set(ids.map(String))]) {
        try { await this.decidir(actor, id, Boolean(aprobar), motivo, { corregible }); hechos++; hechosIds.push(id); } catch (e) { errores.push({ id, error: e.message }); }
      }
      return { hechos, errores, ids: hechosIds };
    },
    /**
     * Corregir un voucher rechazado con opción de corrección: fecha, medicamentos y médico. Vuelve a "pendiente"
     * para que lo revisen otra vez. La foto no cambia. Solo la dueña o quien lo cargó, y solo en el mes del rechazo.
     */
    async corregir(actor, id, input = {}) {
      const v = await data.get('vouchers', String(id));
      if (!v) throw new HttpError(404, 'El voucher no existe.');
      permitir((esDependiente(actor) && v.dependienteId === actor.id) || (cargaPorDependiente(actor) && v.registradoPor === actor.id), 'Solo quien cargó el voucher puede corregirlo.');
      if (v.estado !== 'rechazado' || !v.corregible) throw new HttpError(409, 'Este voucher no se puede corregir.');
      if (mesDe(v.decididoAt ?? v.updatedAt) !== mesDe(now().toISOString())) throw new HttpError(409, 'El plazo para corregirlo terminó con el mes.');
      const e = {};
      if (!esFechaISO(input.fecha)) e.fecha = 'Elige la fecha del voucher.';
      else if (input.fecha > hoy()) e.fecha = 'La fecha no puede ser futura.';
      const { lineas, medico } = await contenidoVoucher(input, e);
      if (Object.keys(e).length) invalido(e);
      if (await periodoCerrado(v.dependienteId, input.fecha)) throw new HttpError(409, 'Ese período de comisión ya está cerrado.', { fecha: 'El período de esa fecha ya se cerró.' });
      const out = await data.update('vouchers', v.id, {
        fecha: input.fecha, items: lineas, total: round2(lineas.reduce((s, l) => s + l.monto, 0)), estado: 'pendiente', corregible: false, motivo: null,
        medicoId: medico?.id ?? null, medico: medico ? `${medico.nombre}${medico.especialidad ? `, ${medico.especialidad}` : ''}` : null,
        correcciones: (v.correcciones ?? 0) + 1,
      });
      await audit({ actorId: actor.id, action: 'voucher_corregido', entity: 'voucher', entityId: v.id, before: { estado: 'rechazado', motivo: v.motivo, fecha: v.fecha, total: v.total }, after: { estado: 'pendiente', fecha: out.fecha, total: out.total } });
      return out;
    },
    /**
     * Al cambiar de mes se eliminan los vouchers rechazados en meses anteriores que nadie corrigió: el registro y su foto.
     * No toca aprobados ni pendientes. Queda constancia en la auditoría.
     */
    async limpiarRechazados(ahora = now()) {
      const mes = mesDe(ahora.toISOString());
      let eliminados = 0;
      for (const v of await data.list('vouchers', { estado: 'rechazado' })) {
        const cuando = v.decididoAt ?? v.updatedAt ?? v.createdAt;
        if (!cuando || mesDe(cuando) >= mes) continue;
        if (v.foto?.clave) await files.remove?.(v.foto.clave).catch(() => {});
        await data.remove('vouchers', v.id);
        await audit({ actorId: null, action: 'voucher_rechazado_eliminado', entity: 'voucher', entityId: v.id, before: { dependienteId: v.dependienteId, fecha: v.fecha, total: v.total, motivo: v.motivo }, after: { razon: 'No se corrigió en el mes del rechazo.' } });
        eliminados++;
      }
      return { eliminados };
    },
    async anular(actor, id) {
      const v = await data.get('vouchers', id);
      if (!v) throw new HttpError(404, 'El voucher no existe.');
      permitir((esDependiente(actor) && v.dependienteId === actor.id) || (cargaPorDependiente(actor) && v.registradoPor === actor.id));
      if (v.estado !== 'pendiente') throw new HttpError(409, 'Solo puedes anular un voucher que todavía no se ha revisado.');
      const out = await data.update('vouchers', id, { estado: 'anulado' });
      await audit({ actorId: actor.id, action: 'voucher_anulado', entity: 'voucher', entityId: id, before: { estado: 'pendiente' }, after: { estado: 'anulado' } });
      return out;
    },
  };

  // ------------------------------------------------------------ promotoras
  const promotoras = {
    async crearOperativo(actor, input) {
      permitir(esPromotora(actor), 'Solo las promotoras registran operativos.');
      const e = {};
      const fecha = input.fecha ?? hoy();
      if (!esFechaISO(fecha)) e.fecha = 'Elige la fecha del operativo.'; else if (fecha > hoy()) e.fecha = 'La fecha no puede ser futura.';
      const provincia = texto(e, 'provincia', input.provincia, { etiqueta: 'La provincia' });
      const municipio = texto(e, 'municipio', input.municipio, { etiqueta: 'El municipio' });
      const centro = texto(e, 'centro', input.centro, { etiqueta: 'El centro de salud' });
      if (Object.keys(e).length) invalido(e);
      const dup = (await data.list('operativos', { promotoraId: actor.id, fecha })).find((o) => o.centro.toLowerCase() === centro.toLowerCase());
      if (dup) return dup;
      const o = await data.insert('operativos', { promotoraId: actor.id, fecha, provincia, municipio, centro });
      await audit({ actorId: actor.id, action: 'operativo_creado', entity: 'operativo', entityId: o.id, after: o });
      return o;
    },
    async listarOperativos(actor, { fecha } = {}) {
      if (esPromotora(actor)) return data.list('operativos', { promotoraId: actor.id, ...(fecha ? { fecha } : {}) });
      permitir(tieneRol(actor, GESTION));
      return data.list('operativos', fecha ? { fecha } : {});
    },
    /**
     * Receta de una promotora (en un operativo) o de un médico (en uno de sus lugares de trabajo).
     * El médico queda puesto solo: es quien la prescribió; si fue otro médico, puede elegirlo. El paciente
     * es obligatorio para la promotora y opcional para el médico. Todas quedan pendientes de revisión.
     */
    async crearReceta(actor, input) {
      const promotora = esPromotora(actor); const medicoCuenta = esMedico(actor);
      permitir(promotora || medicoCuenta, 'Solo las promotoras y los médicos registran recetas.');
      const e = {};
      let op = null; let lugar = null; let fecha = null; let med = null;
      if (promotora) {
        op = input.operativoId && (await data.get('operativos', input.operativoId));
        if (!op || op.promotoraId !== actor.id) e.operativoId = 'Elige uno de tus operativos.';
        else fecha = op.fecha;
        med = input.medicoId && (await data.get('medicos', input.medicoId));
        if (!med) e.medicoId = 'Elige el médico que prescribió.';
      } else {
        const ficha = (await data.list('medicos')).find((m) => m.usuarioId === actor.id);
        if (!ficha) throw new HttpError(409, 'Tu cuenta de médico no tiene ficha. Pide a la gerencia que la revise.');
        const lugares = ficha.lugares ?? [];
        lugar = (input.establecimientoId ? lugares.find((l) => l.establecimientoId === input.establecimientoId) : lugares[0]) ?? null;
        if (!lugar) e.establecimientoId = 'Elige uno de tus lugares de trabajo.';
        fecha = input.fecha ?? hoy();
        if (!esFechaISO(fecha)) e.fecha = 'Elige la fecha de la receta.'; else if (fecha > hoy()) e.fecha = 'La fecha no puede ser futura.';
        if (input.medicoId && input.medicoId !== ficha.id) { med = await data.get('medicos', String(input.medicoId)); if (!med || med.estado === 'inactivo') e.medicoId = 'Ese médico no está registrado. Elígelo de la lista o agrégalo.'; }
        else med = ficha;
      }
      const items = Array.isArray(input.items) ? input.items : [];
      if (!items.length) e.items = 'Agrega al menos un medicamento.';
      // Paciente: el teléfono lo identifica. Si ya existe, se usa el mismo (no se duplica su contacto).
      // También se puede elegir por nombre un paciente ya registrado (su teléfono queda guardado, no se reescribe).
      let paciente = null; let tel = null;
      const conPaciente = promotora || input.paciente?.id || String(input.paciente?.telefono ?? '').replace(/\D/g, '') || normalizeName(input.paciente?.nombre);
      if (conPaciente && input.paciente?.id) {
        const p = await data.get('pacientes', String(input.paciente.id));
        if (!p || !(await pacientesVisibles(actor, await data.list('recetas')))(p)) e['paciente.nombre'] = 'Ese paciente no está en tu zona. Escribe su teléfono.';
        else { paciente = p; tel = p.telefono; }
      } else if (conPaciente) {
        tel = telefonoRD(input.paciente?.telefono);
        if (!tel) e['paciente.telefono'] = 'Escribe el teléfono del paciente (809, 829 u 849 y 7 dígitos).';
        else paciente = (await data.list('pacientes', { telefono: tel }))[0] ?? null;
      }
      const nombrePaciente = normalizeName(input.paciente?.nombre);
      if (tel && !paciente && nombrePaciente.length < 3) e['paciente.nombre'] = 'Escribe el nombre del paciente.';
      const lineas = []; const vistos = new Set();
      for (const [i, it] of items.entries()) {
        const m = await medicamentoActivo(it.medicamentoId);
        const unidades = Number(it.unidades);
        if (!m) e[`items.${i}.medicamentoId`] = 'Elige un medicamento del catálogo.';
        else if (vistos.has(m.id)) e[`items.${i}.medicamentoId`] = 'Ese medicamento ya está en la receta.';
        if (!Number.isInteger(unidades) || unidades < 1 || unidades > 999) e[`items.${i}.unidades`] = 'Escribe las unidades, entre 1 y 999.';
        if (m) { vistos.add(m.id); lineas.push({ medicamentoId: m.id, medicamento: m.nombre, linea: m.linea ?? null, unidades }); }
      }
      let huella = null;
      if (input.adjunto) huella = esHuella(input.fotoHuella) ? input.fotoHuella : createHash('sha256').update(Buffer.from(String(input.adjunto.base64 ?? ''), 'base64')).digest('hex');
      const dhash = input.adjunto && esDhash(input.fotoDhash) ? input.fotoDhash : null;
      if (medicoCuenta && !input.adjunto) e.adjunto = 'Sube la foto de la receta.';
      if (Object.keys(e).length) invalido(e);
      const repetida = (huella || dhash) && buscarRepetida((await data.list('recetas')).filter((r) => r.estado !== 'rechazada'), { huella, dhash });
      if (repetida) throw new HttpError(409, textoRepetida(repetida, 'receta', actor.id), { adjunto: 'Foto repetida.' });
      const adjunto = await guardarAdjunto(files, actor, input.adjunto, 'receta');
      let pacienteNuevo = false;
      if (tel && !paciente) {
        try { paciente = await data.insert('pacientes', { telefono: tel, nombre: nombrePaciente, creadoPor: actor.id }); pacienteNuevo = true; }
        catch { paciente = (await data.list('pacientes', { telefono: tel }))[0]; } // otro usuario lo registró en ese instante
      }
      const r = await data.insert('recetas', {
        promotoraId: promotora ? actor.id : null, cargadoPor: actor.id, operativoId: op?.id ?? null, establecimientoId: lugar?.establecimientoId ?? null,
        medicoId: med.id, fecha, provincia: op?.provincia ?? lugar.provincia, municipio: op?.municipio ?? lugar.municipio,
        items: lineas, adjunto, pacienteId: paciente?.id ?? null, fotoHuella: huella, fotoDhash: dhash, estado: 'pendiente',
      });
      await audit({ actorId: actor.id, action: 'receta_registrada', entity: 'receta', entityId: r.id, after: { items: lineas.length, pacienteNuevo, por: promotora ? 'promotora' : 'medico' } });
      const alertas = promotora ? await promotoras.alertasZona(op.provincia, op.municipio, op.fecha.slice(0, 7), lineas.map((l) => l.medicamentoId)) : [];
      return { receta: r, alertas, paciente: paciente ? { id: paciente.id, nombre: paciente.nombre, nuevo: pacienteNuevo } : null };
    },
    /** Revisión de recetas: la gestión aprueba o rechaza (con motivo). Solo las aprobadas cuentan. */
    async decidirReceta(actor, id, aprobar, motivo, { corregible = false } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor']), 'No tienes permiso para revisar recetas.');
      const r = await data.get('recetas', String(id));
      if (!r) throw new HttpError(404, 'La receta no existe.');
      if (r.estado && r.estado !== 'pendiente') throw new HttpError(409, 'Esta receta ya fue revisada.');
      const m = normalizeName(motivo);
      if (!aprobar && m.length < 3) throw new HttpError(422, 'Explica por qué se rechaza.', { motivo: 'Escribe el motivo del rechazo.' });
      const estado = aprobar ? 'aprobada' : 'rechazada';
      const out = await data.update('recetas', r.id, { estado, decididoPor: actor.id, decididoAt: now().toISOString(), motivo: aprobar ? null : m, nota: aprobar ? (m || null) : null, corregible: !aprobar && Boolean(corregible) });
      await audit({ actorId: actor.id, action: `receta_${estado}`, entity: 'receta', entityId: r.id, before: { estado: r.estado ?? 'pendiente' }, after: { estado, motivo: m || null } });
      return out;
    },
    async decidirRecetasLote(actor, { ids, aprobar, motivo, corregible } = {}) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor']), 'No tienes permiso para revisar recetas.');
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000) invalido({ ids: 'Elige de 1 a 1,000 recetas.' });
      if (!aprobar && normalizeName(motivo).length < 3) throw new HttpError(422, 'Explica por qué se rechazan.', { motivo: 'Escribe el motivo del rechazo.' });
      let hechos = 0; const errores = []; const hechosIds = [];
      for (const id of [...new Set(ids.map(String))]) {
        try { await this.decidirReceta(actor, id, Boolean(aprobar), motivo, { corregible }); hechos++; hechosIds.push(id); } catch (e) { errores.push({ id, error: e.message }); }
      }
      return { hechos, errores, ids: hechosIds };
    },
    /** Al escribir el teléfono completo, la promotora ve si el paciente ya existe y su nombre se completa solo. */
    async buscarPaciente(actor, telefono) {
      permitir(esPromotora(actor) || esMedico(actor) || tieneRol(actor, ['administrador', 'gerencia']));
      const tel = telefonoRD(telefono);
      if (!tel) return { paciente: null };
      const p = (await data.list('pacientes', { telefono: tel }))[0];
      if (!p) return { paciente: null };
      const recetas = (await data.list('recetas', { pacienteId: p.id })).length;
      return { paciente: { id: p.id, nombre: p.nombre, telefono: telefonoVisible(tel), recetas } };
    },
    /**
     * Pacientes por nombre (desde 3 letras), para no duplicarlos al cargar recetas. La promotora solo ve
     * los que ella registró o los que tienen recetas en su zona; el teléfono va oculto salvo los 4 últimos.
     */
    async buscarPacientesPorNombre(actor, nombre) {
      permitir(esPromotora(actor) || esMedico(actor) || tieneRol(actor, ['administrador', 'gerencia']));
      const sin = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const q = sin(nombre);
      if (q.length < 3) return { pacientes: [] };
      const palabras = q.split(' ');
      const recetas = await data.list('recetas');
      const visibles = await pacientesVisibles(actor, recetas);
      const out = [];
      for (const p of await data.list('pacientes')) {
        if (!visibles(p)) continue;
        const n = sin(p.nombre);
        if (!palabras.every((w) => n.split(' ').some((x) => x.startsWith(w)))) continue;
        const suyas = recetas.filter((r) => r.pacienteId === p.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        out.push({ id: p.id, nombre: p.nombre, telefono: telefonoOculto(p.telefono), recetas: suyas.length, ultima: suyas[0]?.fecha ?? null, municipio: suyas[0]?.municipio ?? null });
        if (out.length >= 8) break;
      }
      return { pacientes: out.sort((a, b) => b.recetas - a.recetas || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 6) };
    },
    async listarRecetas(actor, { mes, estado } = {}) {
      let rs;
      if (esPromotora(actor) || esMedico(actor)) rs = (await data.list('recetas')).filter((r) => (r.cargadoPor ?? r.promotoraId) === actor.id);
      else { permitir(tieneRol(actor, GESTION)); rs = await data.list('recetas'); }
      if (mes) rs = rs.filter((r) => r.fecha.startsWith(mes));
      if (estado) rs = rs.filter((r) => (r.estado ?? 'aprobada') === estado);
      const nombres = Object.fromEntries((await users.listUsers()).map((u) => [u.id, { nombre: u.fullName, rol: u.role, posicion: u.position }]));
      const lugaresE = Object.fromEntries((await data.list('establecimientos')).map((x) => [x.id, x.nombre]));
      const medicos = Object.fromEntries((await data.list('medicos')).map((m) => [m.id, m]));
      const pacientes = Object.fromEntries((await data.list('pacientes')).map((p) => [p.id, p]));
      // El teléfono completo lo ven la promotora, la administración y la gerencia; la supervisión, oculto.
      const completo = esPromotora(actor) || esMedico(actor) || tieneRol(actor, ['administrador', 'gerencia']);
      return rs.map((r) => {
        const p = pacientes[r.pacienteId];
        const quien = nombres[r.cargadoPor ?? r.promotoraId];
        return { ...r, estado: r.estado ?? 'aprobada', cargadoPorNombre: quien?.nombre ?? '', cargadoPorRol: quien?.rol === 'medico' ? 'Médico' : quien?.posicion ?? '', lugar: lugaresE[r.establecimientoId] ?? null,
          medico: medicos[r.medicoId]?.nombre ?? '', especialidad: medicos[r.medicoId]?.especialidad ?? '',
          paciente: p ? { nombre: p.nombre, telefono: completo ? telefonoVisible(p.telefono) : telefonoOculto(p.telefono) } : null };
      });
    },

    async registrarInventario(actor, input) {
      permitir(tieneRol(actor, ['administrador', 'gerencia', 'supervisor']) || esVendedor(actor), 'No tienes permiso para registrar inventario.');
      const e = {};
      const f = input.farmaciaId && (await data.get('farmacias', input.farmaciaId));
      if (!f) e.farmaciaId = 'Elige la farmacia.';
      const m = await medicamentoActivo(input.medicamentoId);
      if (!m) e.medicamentoId = 'Elige el medicamento.';
      const unidades = Number(input.unidades);
      if (!Number.isInteger(unidades) || unidades < 0) e.unidades = 'Escribe las unidades disponibles (0 o más).';
      const fechaCorte = input.fechaCorte ?? hoy();
      if (!esFechaISO(fechaCorte) || fechaCorte > hoy()) e.fechaCorte = 'Elige una fecha de corte válida.';
      if (Object.keys(e).length) invalido(e);
      const i = await data.insert('inventario', { farmaciaId: f.id, medicamentoId: m.id, unidades, fechaCorte, registradoPor: actor.id });
      await audit({ actorId: actor.id, action: 'inventario_registrado', entity: 'inventario', entityId: i.id, after: { unidades } });
      return i;
    },

    async umbral() { return (await config('umbral_alerta_inventario'))?.valor ?? 0.75; },
    async configurarUmbral(actor, valor) {
      permitir(tieneRol(actor, ['administrador', 'gerencia']));
      const v = Number(valor);
      if (!Number.isFinite(v) || v <= 0 || v > 1) invalido({ umbral: 'Escribe un porcentaje entre 1 y 100.' });
      return setConfig(actor, 'umbral_alerta_inventario', { valor: round2(v) });
    },

    /** Compara lo recetado en la zona y el mes contra las unidades disponibles en las farmacias de la zona. */
    async alertasZona(provincia, municipio, mes, medicamentoIds) {
      const umbral = await promotoras.umbral();
      const zona = (x) => x.provincia.toLowerCase() === provincia.toLowerCase() && x.municipio.toLowerCase() === municipio.toLowerCase();
      const recetas = (await data.list('recetas')).filter((r) => r.estado !== 'rechazada' && zona(r) && r.fecha.startsWith(mes)); // aviso de operación: pendientes y aprobadas
      const farmacias = (await data.list('farmacias')).filter(zona);
      const inv = await data.list('inventario');
      const meds = Object.fromEntries((await data.list('medicamentos')).map((m) => [m.id, m.nombre]));
      return medicamentoIds.map((id) => {
        const recetado = recetas.reduce((s, r) => s + r.items.filter((it) => it.medicamentoId === id).reduce((a, it) => a + it.unidades, 0), 0);
        let disponible = 0; let conDatos = 0;
        for (const f of farmacias) {
          const ult = inv.filter((x) => x.farmaciaId === f.id && x.medicamentoId === id).sort((a, b) => b.fechaCorte.localeCompare(a.fechaCorte) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
          if (ult) { disponible += ult.unidades; conDatos += 1; }
        }
        const base = { medicamentoId: id, medicamento: meds[id] ?? '', provincia, municipio, mes, recetado, umbral };
        if (!conDatos) return { ...base, estado: 'sin_inventario', mensaje: 'No hay inventario registrado en farmacias de esta zona.' };
        const r = evaluarAlertaInventario({ unidadesRecetadas: recetado, unidadesDisponibles: disponible, umbral });
        return { ...base, disponible, farmaciasConDatos: conDatos, estado: r.alerta ? 'alerta' : 'ok', cobertura: Number.isFinite(r.cobertura) ? r.cobertura : null, faltante: r.faltante };
      });
    },
    async misAlertas(actor, mes) {
      permitir(esPromotora(actor) || tieneRol(actor, GESTION));
      const m = mes ?? hoy().slice(0, 7);
      const rs = (await data.list('recetas', esPromotora(actor) ? { promotoraId: actor.id } : {})).filter((r) => r.fecha.startsWith(m));
      const zonas = new Map();
      for (const r of rs) {
        const k = `${r.provincia.toLowerCase()}|${r.municipio.toLowerCase()}`;
        const z = zonas.get(k) ?? { provincia: r.provincia, municipio: r.municipio, meds: new Set() };
        r.items.forEach((it) => z.meds.add(it.medicamentoId)); zonas.set(k, z);
      }
      const out = [];
      for (const z of zonas.values()) out.push(...(await promotoras.alertasZona(z.provincia, z.municipio, m, [...z.meds])));
      const orden = { alerta: 0, sin_inventario: 1, ok: 2 };
      return out.sort((a, b) => orden[a.estado] - orden[b.estado]);
    },
  };

  // ------------------------------------------------------------ reportes
  const AGRUPAR = ['promotora', 'medicamento', 'linea', 'medico', 'especialidad', 'provincia', 'municipio', 'centro'];
  async function reporteRecetas(actor, { mes, agrupar }) {
    permitir(tieneRol(actor, GESTION));
    if (!AGRUPAR.includes(agrupar)) throw new HttpError(422, 'Agrupación no válida.');
    if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new HttpError(422, 'Elige el mes.');
    const rs = (await data.list('recetas')).filter((r) => recetaAprobada(r) && r.fecha.startsWith(mes));
    const medicos = Object.fromEntries((await data.list('medicos')).map((m) => [m.id, m]));
    const ops = Object.fromEntries((await data.list('operativos')).map((o) => [o.id, o]));
    const nombres = Object.fromEntries((await users.listUsers()).map((u) => [u.id, u.fullName]));
    const filas = new Map();
    const sumar = (clave, recetaId, unidades) => {
      const f = filas.get(clave) ?? { clave, recetas: new Set(), unidades: 0 };
      f.recetas.add(recetaId); f.unidades += unidades; filas.set(clave, f);
    };
    for (const r of rs) {
      for (const it of r.items) {
        const k = {
          promotora: nombres[r.cargadoPor ?? r.promotoraId] ?? 'Sin nombre', medicamento: it.medicamento, linea: it.linea ?? 'Sin línea',
          medico: medicos[r.medicoId]?.nombre ?? 'Sin médico', especialidad: medicos[r.medicoId]?.especialidad ?? 'Sin especialidad',
          provincia: r.provincia, municipio: `${r.municipio}, ${r.provincia}`, centro: ops[r.operativoId]?.centro ?? 'Sin centro',
        }[agrupar];
        sumar(k, r.id, it.unidades);
      }
    }
    return { mes, agrupar, totalRecetas: rs.length, filas: [...filas.values()].map((f) => ({ clave: f.clave, recetas: f.recetas.size, unidades: f.unidades })).sort((a, b) => b.unidades - a.unidades) };
  }

  /** Antes de enviar: cuáles de estas fotos ya están cargadas (exactas o muy parecidas). */
  async function verificarFotos(actor, { tipo, fotos } = {}) {
    if (tipo === 'receta') permitir(esPromotora(actor) || esMedico(actor), 'Solo las promotoras y los médicos cargan recetas.');
    else if (tipo === 'voucher') permitir(esDependiente(actor) || cargaPorDependiente(actor), 'No tienes permiso para cargar vouchers.');
    else invalido({ tipo: 'Tipo no válido.' });
    if (!Array.isArray(fotos) || fotos.length > 1000) invalido({ fotos: 'Envía hasta 1,000 fotos por vez.' });
    const registros = tipo === 'receta' ? (await data.list('recetas')).filter((r) => r.estado !== 'rechazada') : (await data.list('vouchers')).filter((v) => !['anulado', 'rechazado'].includes(v.estado));
    const repetidas = [];
    fotos.forEach((f, indice) => {
      const huella = esHuella(f?.huella) ? f.huella : null; const dhash = esDhash(f?.dhash) ? f.dhash : null;
      const rep = (huella || dhash) && buscarRepetida(registros, { huella, dhash });
      if (rep) repetidas.push({ indice, motivo: rep.motivo, fecha: rep.registro.fecha, cargado: rep.registro.createdAt, texto: textoRepetida(rep, tipo === 'receta' ? 'receta' : 'voucher', actor.id) });
    });
    return { repetidas };
  }
  return { catalogo, comisiones, vouchers, promotoras, reporteRecetas, verificarFotos };
}

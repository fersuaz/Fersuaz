import { randomUUID } from 'node:crypto';

/**
 * Colecciones del módulo comercial (dependientes y promotoras).
 * Cada una tiene tabla propia en PostgreSQL (migración 002). `json` = columnas JSONB.
 */
export const COLECCIONES = {
  medicamentos: { tabla: 'medicamentos', campos: ['nombre', 'linea', 'presentacion', 'precio', 'activo', 'descripcion', 'ficha', 'imagenes', 'publicado'], json: ['ficha', 'imagenes'] },
  pedidos: { tabla: 'pedidos', campos: ['numero', 'farmaciaId', 'creadoPor', 'items', 'total', 'unidades', 'pago', 'comprobante', 'nota', 'estado', 'historial', 'vendedorId', 'provincia', 'municipio'], json: ['items', 'comprobante', 'historial'] },
  farmacias: { tabla: 'farmacias', campos: ['nombre', 'provincia', 'municipio', 'sector', 'direccion', 'telefono', 'lat', 'lng', 'placeId', 'fuente', 'estado', 'creadoPor'], json: [] },
  medicos: { tabla: 'medicos', campos: ['nombre', 'especialidad', 'centro', 'provincia', 'municipio', 'estado', 'creadoPor'], json: [] },
  vouchers: { tabla: 'vouchers', campos: ['dependienteId', 'farmacia', 'referencia', 'fecha', 'periodo', 'items', 'total', 'estado', 'decididoPor', 'motivo', 'registradoPor'], json: ['items'] },
  cierres: { tabla: 'cierres_comision', campos: ['dependienteId', 'periodo', 'desde', 'hasta', 'ventas', 'porcentaje', 'comision', 'voucherIds', 'cerradoPor'], json: ['voucherIds'] },
  operativos: { tabla: 'operativos', campos: ['promotoraId', 'fecha', 'provincia', 'municipio', 'centro'], json: [] },
  recetas: { tabla: 'recetas', campos: ['promotoraId', 'operativoId', 'medicoId', 'fecha', 'provincia', 'municipio', 'items', 'adjunto', 'pacienteId'], json: ['items', 'adjunto'] },
  pacientes: { tabla: 'pacientes', campos: ['telefono', 'nombre', 'creadoPor'], json: [] },
  inventario: { tabla: 'inventario', campos: ['farmaciaId', 'medicamentoId', 'unidades', 'fechaCorte', 'registradoPor', 'fuente', 'loteVenta'], json: [] },
  planDias: { tabla: 'plan_dias_representante', campos: ['representanteId', 'diasDentro', 'diasFuera', 'fuente', 'actualizadoPor'], json: [] },
  ventasFarmacia: { tabla: 'ventas_farmacia', campos: ['farmaciaId', 'medicamentoId', 'unidades', 'precioUnitario', 'monto', 'fecha', 'factura', 'provincia', 'municipio', 'lote', 'fuente', 'archivo', 'cargadoPor'], json: [] },
  configuracion: { tabla: 'configuracion', campos: ['clave', 'valor', 'actualizadoPor'], json: ['valor'] },
  perfiles: { tabla: 'perfiles_viatico', campos: ['representanteId', 'residencia', 'vehiculo', 'tarifaAlimentacion', 'reembolsoPorKm', 'topeCombustible', 'publico', 'actualizadoPor'], json: ['residencia', 'vehiculo', 'publico'] },
  precios: { tabla: 'precios_combustible', campos: ['combustible', 'precioGalon', 'vigenteDesde', 'fuente', 'enlace', 'registradoPor'], json: [] },
  jornadas: { tabla: 'jornadas', campos: ['representanteId', 'cronogramaId', 'fecha', 'paradas', 'kmEstimados', 'kmFuente', 'kmReales', 'conAlimentacion', 'hospedaje', 'peajes', 'estacionamiento', 'otros', 'estado'], json: ['paradas', 'hospedaje'] },
  establecimientos: { tabla: 'establecimientos', campos: ['tipo', 'nombre', 'provincia', 'municipio', 'sector', 'direccion', 'telefono', 'lat', 'lng', 'placeId', 'fuente', 'estado', 'creadoPor', 'descarteMotivo', 'descartadoPor'], json: [] },
  zonas: { tabla: 'zonas_representante', campos: ['representanteId', 'provincias', 'municipios', 'actualizadoPor'], json: ['provincias', 'municipios'] },
  vehiculosAgregados: { tabla: 'vehiculos_agregados', campos: ['anio', 'marca', 'modelo', 'version', 'kmPorGalon', 'combustible', 'creadoPor'], json: [] },
  cuentasBanco: { tabla: 'cuentas_banco', campos: ['usuarioId', 'banco', 'tipo', 'numero', 'titular', 'correo', 'actualizadoPor'], json: [] },
  hoteles: { tabla: 'hoteles', campos: ['nombre', 'provincia', 'municipio', 'direccion', 'telefono', 'lat', 'lng', 'placeId', 'calificacion', 'fuente', 'precioNoche', 'requisitos', 'notas', 'verificadoPor', 'verificadoEn', 'estado', 'creadoPor'], json: ['requisitos'] },
  preregistros: { tabla: 'preregistros', campos: ['email', 'nombre', 'telefono', 'posicion', 'provincias', 'estado', 'usuarioId', 'creadoPor'], json: ['provincias'] },
  preciosMedicamento: { tabla: 'precios_medicamento', campos: ['medicamentoId', 'precio', 'vigenteDesde', 'fuente', 'registradoPor'], json: [] },
  cronogramas: { tabla: 'cronogramas', campos: ['representanteId', 'fecha', 'lugares', 'nota', 'estado', 'motivo', 'creadoPor', 'kmEstimado', 'minutosEstimados', 'kmOrigen', 'duermeFuera', 'hotelId'], json: ['lugares'] },
  notificaciones: { tabla: 'notificaciones', campos: ['usuarioId', 'tipo', 'titulo', 'texto', 'enlace', 'leida', 'correo'], json: [] },
  presupuestos: { tabla: 'presupuestos_viatico', campos: ['representanteId', 'mes', 'detalle', 'supuestos', 'total', 'estado', 'montoAprobado', 'aprobadoPor', 'motivo', 'desembolsos', 'gastos', 'liquidacion', 'ajustes', 'origen'], json: ['detalle', 'supuestos', 'desembolsos', 'gastos', 'liquidacion', 'ajustes'] },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

function check(col) {
  const c = COLECCIONES[col];
  if (!c) throw new Error(`Colección desconocida: ${col}`);
  return c;
}

/** Implementación en memoria (pruebas y desarrollo). */
export class MemoryData {
  constructor() { this.db = Object.fromEntries(Object.keys(COLECCIONES).map((k) => [k, new Map()])); }
  async insert(col, obj) {
    check(col);
    const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...structuredClone(obj) };
    this.db[col].set(row.id, row);
    return structuredClone(row);
  }
  async get(col, id) { check(col); const r = this.db[col].get(id); return r ? structuredClone(r) : null; }
  async update(col, id, patch) {
    check(col);
    const cur = this.db[col].get(id); if (!cur) return null;
    const row = { ...cur, ...structuredClone(patch), updatedAt: new Date().toISOString() };
    this.db[col].set(id, row);
    return structuredClone(row);
  }
  async list(col, where = {}) {
    check(col);
    return [...this.db[col].values()]
      .filter((r) => Object.entries(where).every(([k, v]) => r[k] === v))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((r) => structuredClone(r));
  }
}

/** Implementación PostgreSQL. Solo columnas de la lista blanca; consultas parametrizadas. */
export class PgData {
  constructor(pool) { this.pool = pool; }
  #row(col, r) {
    if (!r) return null;
    const c = check(col);
    const out = { id: r.id, createdAt: r.created_at, updatedAt: r.updated_at ?? undefined };
    for (const f of c.campos) {
      let v = r[snake(f)];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && ['total', 'ventas', 'porcentaje', 'comision', 'precioGalon', 'kmEstimados', 'kmReales', 'peajes', 'estacionamiento', 'otros', 'tarifaAlimentacion', 'reembolsoPorKm', 'montoAprobado', 'precio', 'lat', 'lng', 'precioNoche', 'calificacion', 'topeCombustible', 'kmPorGalon', 'kmEstimado', 'precioUnitario', 'monto'].includes(f)) v = Number(v);
      out[f] = v;
    }
    return out;
  }
  async insert(col, obj) {
    const c = check(col);
    const keys = c.campos.filter((f) => obj[f] !== undefined);
    const vals = keys.map((f) => (c.json.includes(f) ? JSON.stringify(obj[f]) : obj[f]));
    const sql = `INSERT INTO ${c.tabla} (${keys.map(snake).join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`;
    const { rows } = await this.pool.query(sql, vals);
    return this.#row(col, rows[0]);
  }
  async get(col, id) {
    const c = check(col);
    if (!UUID.test(String(id))) return null;
    const { rows } = await this.pool.query(`SELECT * FROM ${c.tabla} WHERE id = $1`, [id]);
    return this.#row(col, rows[0]);
  }
  async update(col, id, patch) {
    const c = check(col);
    if (!UUID.test(String(id))) return null;
    const keys = c.campos.filter((f) => patch[f] !== undefined);
    if (!keys.length) return this.get(col, id);
    const vals = keys.map((f) => (c.json.includes(f) ? JSON.stringify(patch[f]) : patch[f]));
    const sql = `UPDATE ${c.tabla} SET ${keys.map((f, i) => `${snake(f)} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`;
    const { rows } = await this.pool.query(sql, [id, ...vals]);
    return this.#row(col, rows[0]);
  }
  async list(col, where = {}) {
    const c = check(col);
    const keys = Object.keys(where).filter((k) => c.campos.includes(k));
    const cond = keys.length ? 'WHERE ' + keys.map((k, i) => `${snake(k)} = $${i + 1}`).join(' AND ') : '';
    const { rows } = await this.pool.query(`SELECT * FROM ${c.tabla} ${cond} ORDER BY created_at`, keys.map((k) => where[k]));
    return rows.map((r) => this.#row(col, r));
  }
}

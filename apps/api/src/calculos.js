// Cálculos de viáticos. Montos en RD$, redondeo a 2 decimales (centavos).
// Ningún valor predeterminado real: todo llega como parámetro.

export class CalculoError extends Error {}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function requireNumber(name, v, { min = 0, allowZero = true } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalculoError(`${name} debe ser un número.`);
  if (v < min || (!allowZero && v === 0)) throw new CalculoError(`${name} no es válido.`);
  return v;
}

/** Combustible para vehículos de combustión (km/galón). No aplica a eléctricos. */
export function calcularCombustible({ kilometros, rendimientoKmGalon, precioGalon }) {
  requireNumber('Kilómetros', kilometros);
  requireNumber('Rendimiento', rendimientoKmGalon, { allowZero: false });
  requireNumber('Precio por galón', precioGalon);
  const galones = kilometros / rendimientoKmGalon;
  return { galones: round2(galones), costo: round2(galones * precioGalon) };
}

export function calcularAlimentacion({ tarifaDiaria, diasElegibles }) {
  requireNumber('Tarifa diaria', tarifaDiaria);
  if (!Number.isInteger(diasElegibles) || diasElegibles < 0) throw new CalculoError('Días elegibles no es válido.');
  return round2(tarifaDiaria * diasElegibles);
}

/** Noches reales entre entrada y salida (fechas ISO YYYY-MM-DD). */
export function calcularNoches(entrada, salida) {
  const a = Date.parse(`${entrada}T00:00:00Z`); const b = Date.parse(`${salida}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new CalculoError('Fecha inválida.');
  if (b <= a) throw new CalculoError('La salida debe ser posterior a la entrada.');
  return Math.round((b - a) / 86_400_000);
}

export function calcularHospedaje({ noches, tarifaNoche, cargos = 0 }) {
  if (!Number.isInteger(noches) || noches < 0) throw new CalculoError('Noches no es válido.');
  requireNumber('Tarifa por noche', tarifaNoche);
  requireNumber('Cargos', cargos);
  return round2(noches * tarifaNoche + cargos);
}

/**
 * Tope mensual de combustible o transporte. Lo calculado por km se paga hasta el tope;
 * lo que pase del tope queda como excedente (no se paga, se avisa). Sin tope, se paga lo calculado.
 */
export function aplicarTope({ calculado, tope }) {
  requireNumber('Combustible calculado', calculado);
  if (tope == null) return { aplicado: round2(calculado), excedente: 0, topado: false };
  requireNumber('Tope', tope, { allowZero: false });
  const aplicado = Math.min(calculado, tope);
  return { aplicado: round2(aplicado), excedente: round2(calculado - aplicado), topado: calculado > tope };
}

const CATEGORIAS = ['combustible', 'transporte', 'alimentacion', 'hospedaje', 'peajes', 'estacionamiento', 'otros'];

const mismoLugar = (a, b) => a && b && String(a.provincia) === String(b.provincia) && String(a.municipio) === String(b.municipio);
/**
 * Representante sin vehículo (transporte público). Cada día de trabajo es "dentro" si todas sus paradas
 * están en su municipio de residencia, y "fuera" si alguna está en otro municipio.
 * Transporte: un monto por día (dentro o fuera). Comida: un monto por día, solo si la jornada lleva alimentación.
 * tarifas = { transporteDentro, comidaDentro, transporteFuera, comidaFuera } en RD$ por día.
 */
/**
 * Transporte público por día. Un día es "dentro" si todas sus paradas están en la zona de trabajo
 * del representante (esDentro); si una parada sale de la zona, el día es "fuera".
 * Sin zona se usa su municipio de residencia (residencia).
 */
export function calcularTransportePublico({ jornadas, esDentro, residencia, tarifas }) {
  for (const k of ['transporteDentro', 'comidaDentro', 'transporteFuera', 'comidaFuera']) requireNumber(k, tarifas[k]);
  const dentroDe = esDentro ?? ((p) => mismoLugar(p, residencia));
  const dias = new Map();
  for (const j of jornadas) {
    const fuera = (j.paradas ?? []).some((p) => !dentroDe(p));
    const d = dias.get(j.fecha) ?? { fecha: j.fecha, fuera: false, comida: false };
    d.fuera = d.fuera || fuera; d.comida = d.comida || j.conAlimentacion !== false;
    dias.set(j.fecha, d);
  }
  const lista = [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const dentro = lista.filter((d) => !d.fuera); const fuera = lista.filter((d) => d.fuera);
  const transporte = dentro.length * tarifas.transporteDentro + fuera.length * tarifas.transporteFuera;
  const alimentacion = dentro.filter((d) => d.comida).length * tarifas.comidaDentro + fuera.filter((d) => d.comida).length * tarifas.comidaFuera;
  return { diasDentro: dentro.length, diasFuera: fuera.length, transporte: round2(transporte), alimentacion: round2(alimentacion), dias: lista.map((d) => ({ fecha: d.fecha, fuera: d.fuera })) };
}

/** Millas por galón (EPA, galón de EE. UU., el mismo que se vende en RD) a km por galón, con un decimal. */
export function mpgAKmPorGalon(mpg) {
  requireNumber('Millas por galón', mpg, { allowZero: false });
  return Math.round(mpg * 1.609344 * 10) / 10;
}

/** Suma categorías de presupuesto. El salario no es una categoría y se rechaza. */
export function calcularPresupuesto(partidas) {
  if ('salario' in partidas) throw new CalculoError('El salario no forma parte de los viáticos.');
  let total = 0; const detalle = {};
  for (const c of CATEGORIAS) {
    const v = partidas[c] ?? 0;
    requireNumber(c, v);
    detalle[c] = round2(v); total += v;
  }
  return { detalle, total: round2(total) };
}

/** Detecta gastos duplicados (misma fecha, categoría, monto y referencia). */
export function detectarDuplicados(gastos) {
  const vistos = new Map(); const duplicados = [];
  for (const g of gastos) {
    const k = [g.fecha, g.categoria, round2(g.monto), (g.referencia ?? '').trim().toLowerCase()].join('|');
    if (vistos.has(k)) duplicados.push({ original: vistos.get(k), duplicado: g }); else vistos.set(k, g);
  }
  return duplicados;
}

// ── Estructura del departamento comercial (PDF): vouchers y recetas ──

/**
 * Comisión de dependientes por vouchers. porcentaje es configurable (ej. 10 = 10 %).
 * vouchers: [{ items: [{ medicamento, monto }] }]
 */
export function calcularComisionVouchers(vouchers, porcentaje) {
  requireNumber('Porcentaje de comisión', porcentaje);
  if (porcentaje > 100) throw new CalculoError('Porcentaje de comisión no es válido.');
  let ventas = 0; const porMedicamento = {};
  for (const v of vouchers) {
    if (!Array.isArray(v.items) || v.items.length === 0) throw new CalculoError('Cada voucher necesita al menos un medicamento.');
    for (const it of v.items) {
      requireNumber(`Monto de ${it.medicamento}`, it.monto);
      ventas += it.monto;
      porMedicamento[it.medicamento] = round2((porMedicamento[it.medicamento] ?? 0) + it.monto);
    }
  }
  return { ventas: round2(ventas), comision: round2(ventas * porcentaje / 100), porMedicamento };
}

/**
 * Alerta de abastecimiento: compara unidades recetadas en la zona contra
 * unidades disponibles en farmacias de la zona. Se alerta cuando lo recetado
 * alcanza el umbral (75 % configurable) del inventario disponible.
 */
export function evaluarAlertaInventario({ unidadesRecetadas, unidadesDisponibles, umbral = 0.75 }) {
  requireNumber('Unidades recetadas', unidadesRecetadas);
  requireNumber('Unidades disponibles', unidadesDisponibles);
  if (umbral <= 0 || umbral > 1) throw new CalculoError('Umbral no es válido.');
  if (unidadesDisponibles === 0) return { alerta: unidadesRecetadas > 0, cobertura: unidadesRecetadas > 0 ? Infinity : 0, faltante: unidadesRecetadas };
  const cobertura = unidadesRecetadas / unidadesDisponibles;
  return { alerta: cobertura >= umbral, cobertura: round2(cobertura), faltante: Math.max(0, unidadesRecetadas - unidadesDisponibles) };
}

/**
 * Semanas del mes (de lunes a domingo, recortadas al mes) para las fechas dadas.
 * Devuelve [{ n, desde, hasta, fechas }] solo con las semanas que tienen alguna fecha.
 */
export function semanasDelMes(mes, fechas) {
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const semanas = []; let actual = null;
  for (let d = 1; d <= fin; d++) {
    const f = `${mes}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (!actual || dow === 1) { actual = { n: semanas.length + 1, desde: f, hasta: f, fechas: [] }; semanas.push(actual); }
    actual.hasta = f;
  }
  const set = new Set(fechas);
  for (const s of semanas) s.fechas = [...set].filter((f) => f >= s.desde && f <= s.hasta).sort();
  return semanas.filter((s) => s.fechas.length).map((s, i) => ({ ...s, n: semanas.indexOf(s) + 1 }));
}

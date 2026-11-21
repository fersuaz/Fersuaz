// Ventas a farmacias (lo que FERSUAZ le vendió a cada farmacia): se cargan desde un archivo.
// La plantilla de Excel se lee directamente; facturas, PDF, fotos u hojas con otro formato se leen con
// inteligencia artificial. Siempre se muestra una vista previa para revisar antes de guardar.
// Al guardar: cada línea queda registrada y el inventario de la farmacia sube con las unidades vendidas.
import { AuthError as HttpError } from './auth.js';
import { leerHoja, clave } from './hojas.js';
import { esFechaISO } from './periodos.js';
import { dentroDeZona } from './territorio.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const GESTION = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
const MAX_FILAS = 2000;

/** Nombres de columna aceptados en la plantilla (y en hojas parecidas). */
const COLUMNAS = {
  fecha: ['fecha', 'fecha venta', 'fecha de venta', 'fecha factura'],
  farmacia: ['farmacia', 'cliente', 'nombre farmacia', 'farmacia cliente'],
  municipio: ['municipio', 'ciudad'],
  medicamento: ['medicamento', 'producto', 'descripcion', 'articulo', 'item'],
  unidades: ['unidades', 'cantidad', 'cant', 'unidades vendidas'],
  precio: ['precio unitario', 'precio', 'precio unit', 'precio rd'],
  factura: ['factura', 'ncf', 'numero factura', 'no factura', 'factura ncf'],
};

/** Convierte "21/11/2026", "2026-11-21" o un número de fecha de Excel en AAAA-MM-DD. */
export function fechaISO(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000); return d.toISOString().slice(0, 10); }
  return null;
}
const numero = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };

/** Si la hoja tiene las columnas de la plantilla, devuelve las filas sin necesidad de IA. */
export function filasDePlantilla({ columnas, filas }) {
  const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, nombres]) => [k, columnas.find((c) => nombres.includes(c)) ?? null]));
  if (!col.farmacia || !col.medicamento || !col.unidades) return null;
  return filas.map((f) => ({
    fila: f._fila, fecha: col.fecha ? f[col.fecha] : null, farmacia: f[col.farmacia], municipio: col.municipio ? f[col.municipio] : null,
    medicamento: f[col.medicamento], unidades: f[col.unidades], precioUnitario: col.precio ? f[col.precio] : null, factura: col.factura ? f[col.factura] : null,
  })).filter((f) => String(f.farmacia ?? '').trim() || String(f.medicamento ?? '').trim());
}

/** Parecido entre dos nombres (0 a 1): palabras en común, sin tildes ni mayúsculas. */
export function parecido(a, b) {
  const A = new Set(clave(a).split(' ').filter((x) => x.length > 1)); const B = new Set(clave(b).split(' ').filter((x) => x.length > 1));
  if (!A.size || !B.size) return 0;
  if (clave(a) === clave(b)) return 1;
  let comun = 0; for (const x of A) if (B.has(x)) comun++;
  const base = comun / Math.max(A.size, B.size);
  // "Tio-Dex" dentro de "Tio-Dex Jarabe 120 mL": todas las palabras del nombre corto están en el largo.
  return comun === Math.min(A.size, B.size) ? Math.max(base, 0.75) : base;
}
/** Las 3 mejores coincidencias; la primera se elige sola si es clara (≥ 0.6). */
export function emparejar(texto, opciones, nombreDe) {
  const top = opciones.map((o) => ({ o, s: parecido(texto, nombreDe(o)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  return { elegido: top[0] && top[0].s >= 0.6 ? top[0].o : null, opciones: top.map((x) => x.o), confianza: top[0]?.s ?? 0 };
}

export function createVentas({ data, audit, lector, territorio, hoy }) {
  const permitir = (ok, msg = 'No tienes permiso para cargar ventas.') => { if (!ok) throw new HttpError(403, msg); };
  const activo = (u) => u?.status === 'activo';
  const puedeCargar = (u) => activo(u) && (GESTION.includes(u.role) || (u.role === 'representante' && ['Vendedor', 'PVC'].includes(u.position)));
  /** Vendedor y PVC solo cargan ventas de farmacias de su zona. */
  async function filtroZona(actor) {
    if (GESTION.includes(actor.role)) return () => true;
    const zona = await territorio.zonaActor(actor);
    if (!zona?.provincias?.length) throw new HttpError(409, 'Aún no tienes zona asignada; pide a la gerencia que te la asigne.');
    return (f) => dentroDeZona(zona, f.provincia, f.municipio);
  }

  async function leer(actor, archivo) {
    permitir(puedeCargar(actor));
    if (!archivo?.base64) throw new HttpError(422, 'Elige el archivo.', { archivo: 'Elige el archivo.' });
    const buf = Buffer.from(archivo.base64, 'base64');
    if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'El archivo no puede pasar de 6 MB.', { archivo: 'Archivo demasiado grande.' });
    const enZona = await filtroZona(actor);
    const farmacias = (await data.list('farmacias')).filter((f) => f.estado !== 'inactiva' && enZona(f));
    const medicamentos = (await data.list('medicamentos')).filter((m) => m.activo !== false);
    const nombreMed = (m) => `${m.nombre} ${m.presentacion ?? ''}`.trim();
    const tipo = String(archivo.tipo ?? '');
    const esHoja = /\.(xlsx|csv)$/i.test(archivo.nombre ?? '') || /spreadsheet|csv/.test(tipo);
    let crudas; let fuente; let notas = null;
    if (esHoja) {
      let hoja;
      try { hoja = leerHoja(buf, archivo.nombre); } catch (err) { throw new HttpError(422, err.message, { archivo: err.message }); }
      crudas = filasDePlantilla(hoja); fuente = 'plantilla';
      if (!crudas) {
        if (!lector?.activo) throw new HttpError(422, 'La hoja no tiene las columnas de la plantilla (Farmacia, Medicamento, Unidades). Usa la plantilla o activa la lectura con inteligencia artificial.', { archivo: 'Columnas no reconocidas.' });
        const texto = [hoja.columnas.join(' | '), ...hoja.filas.slice(0, 1500).map((f) => hoja.columnas.map((c) => f[c] ?? '').join(' | '))].join('\n');
        ({ filas: crudas, notas } = await lector.leerVentas({ texto, medicamentos: medicamentos.map(nombreMed) }).catch((e) => { throw new HttpError(e.status ?? 502, e.message); }));
        fuente = 'ia';
      }
    } else {
      if (!lector?.activo) throw new HttpError(503, 'La lectura de PDF y fotos con inteligencia artificial no está configurada. Usa la plantilla de Excel.', { archivo: 'Usa la plantilla de Excel.' });
      ({ filas: crudas, notas } = await lector.leerVentas({ tipo, base64: archivo.base64, medicamentos: medicamentos.map(nombreMed), farmacias: farmacias.slice(0, 300).map((f) => `${f.nombre} (${f.municipio})`) }).catch((e) => { throw new HttpError(e.status ?? 502, e.message); }));
      fuente = 'ia';
    }
    if (!crudas.length) throw new HttpError(422, 'No se encontraron líneas de venta en el archivo.', { archivo: 'Sin líneas de venta.' });
    if (crudas.length > MAX_FILAS) throw new HttpError(422, `El archivo tiene más de ${MAX_FILAS} líneas; divídelo en partes.`);
    const filas = crudas.map((c, i) => {
      const deMun = c.municipio ? farmacias.filter((f) => clave(f.municipio) === clave(c.municipio)) : farmacias;
      const fa = emparejar(c.farmacia, deMun.length ? deMun : farmacias, (f) => f.nombre);
      const me = emparejar(c.medicamento, medicamentos, nombreMed);
      const unidades = numero(c.unidades); const precio = numero(c.precioUnitario);
      const avisos = [];
      if (!fa.elegido) avisos.push('Elige la farmacia');
      if (!me.elegido) avisos.push('Elige el medicamento');
      if (!(Number.isInteger(unidades) && unidades > 0)) avisos.push('Revisa las unidades');
      const f = fechaISO(c.fecha);
      if (!f) avisos.push('Falta la fecha');
      return {
        n: i + 1, fila: c.fila ?? null, original: { farmacia: c.farmacia ?? '', municipio: c.municipio ?? '', medicamento: c.medicamento ?? '' },
        farmaciaId: fa.elegido?.id ?? null, farmaciaOpciones: fa.opciones.map((x) => ({ id: x.id, nombre: x.nombre, municipio: x.municipio })),
        medicamentoId: me.elegido?.id ?? null, medicamentoOpciones: me.opciones.map((x) => ({ id: x.id, nombre: nombreMed(x), precio: x.precio ?? null })),
        unidades, precioUnitario: precio, fecha: f, factura: c.factura ? String(c.factura).trim() : null, avisos,
      };
    });
    return { fuente, notas, archivo: archivo.nombre ?? null, filas, listas: filas.filter((f) => !f.avisos.length).length };
  }

  /** Guarda las líneas revisadas, evita duplicados y suma las unidades al inventario de cada farmacia. */
  async function confirmar(actor, { filas, archivo, fuente } = {}, { interno = false } = {}) {
    if (!interno) permitir(puedeCargar(actor));
    if (!Array.isArray(filas) || !filas.length) throw new HttpError(422, 'No hay líneas para guardar.');
    if (filas.length > MAX_FILAS) throw new HttpError(422, `Máximo ${MAX_FILAS} líneas por carga.`);
    const enZona = interno ? () => true : await filtroZona(actor);
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    const medicamentos = new Map((await data.list('medicamentos')).map((m) => [m.id, m]));
    const errores = {};
    const limpias = filas.map((f, i) => {
      const fa = farmacias.get(f.farmaciaId); const me = medicamentos.get(f.medicamentoId);
      const unidades = Number(f.unidades); const precio = f.precioUnitario == null || f.precioUnitario === '' ? null : Number(f.precioUnitario);
      const e = [];
      if (!fa) e.push('farmacia'); else if (!enZona(fa)) e.push('farmacia fuera de tu zona');
      if (!me) e.push('medicamento');
      if (!Number.isInteger(unidades) || unidades <= 0 || unidades > 100000) e.push('unidades');
      if (precio != null && (!Number.isFinite(precio) || precio < 0)) e.push('precio');
      if (!esFechaISO(f.fecha) || f.fecha > hoy()) e.push('fecha');
      if (e.length) errores[`filas.${i}`] = `Línea ${i + 1}: revisa ${e.join(', ')}.`;
      const precioUnitario = precio ?? (me?.precio != null ? Number(me.precio) : null);
      return { fa, me, unidades, precioUnitario, fecha: f.fecha, factura: f.factura ? String(f.factura).trim() : null };
    });
    if (Object.keys(errores).length) throw new HttpError(422, 'Revisa las líneas marcadas.', errores);
    const existentes = await data.list('ventasFarmacia');
    const llave = (v) => [v.farmaciaId, v.medicamentoId, v.fecha, v.factura ?? '', v.unidades].join('|');
    const ya = new Set(existentes.map(llave));
    const lote = crypto.randomUUID();
    let insertadas = 0; let duplicadas = 0; let unidadesTot = 0; let monto = 0;
    const porInventario = new Map();
    for (const x of limpias) {
      const v = { farmaciaId: x.fa.id, medicamentoId: x.me.id, unidades: x.unidades, fecha: x.fecha, factura: x.factura };
      if (ya.has(llave(v))) { duplicadas++; continue; }
      ya.add(llave(v));
      const m = x.precioUnitario != null ? r2(x.precioUnitario * x.unidades) : null;
      await data.insert('ventasFarmacia', { ...v, precioUnitario: x.precioUnitario, monto: m, provincia: x.fa.provincia, municipio: x.fa.municipio, lote, fuente: ['ia', 'pedido'].includes(fuente) ? fuente : 'plantilla', archivo: archivo ?? null, cargadoPor: actor.id });
      insertadas++; unidadesTot += x.unidades; monto += m ?? 0;
      const k = `${x.fa.id}|${x.me.id}`;
      const acc = porInventario.get(k) ?? { farmaciaId: x.fa.id, medicamentoId: x.me.id, unidades: 0, fecha: x.fecha };
      acc.unidades += x.unidades; if (x.fecha > acc.fecha) acc.fecha = x.fecha;
      porInventario.set(k, acc);
    }
    // Inventario: último conteo de esa farmacia y medicamento + lo vendido. Queda marcado como "por venta".
    const inv = await data.list('inventario');
    for (const a of porInventario.values()) {
      const ult = inv.filter((x) => x.farmaciaId === a.farmaciaId && x.medicamentoId === a.medicamentoId).sort((p, q) => q.fechaCorte.localeCompare(p.fechaCorte) || String(q.createdAt).localeCompare(String(p.createdAt)))[0];
      await data.insert('inventario', { farmaciaId: a.farmaciaId, medicamentoId: a.medicamentoId, unidades: (ult?.unidades ?? 0) + a.unidades, fechaCorte: ult && ult.fechaCorte > a.fecha ? ult.fechaCorte : a.fecha, registradoPor: actor.id, fuente: 'venta', loteVenta: lote });
    }
    await audit({ actorId: actor.id, action: 'ventas_cargadas', entity: 'ventas', entityId: lote, after: { insertadas, duplicadas, unidades: unidadesTot, monto: r2(monto), fuente, archivo: archivo ?? null } });
    return { lote, insertadas, duplicadas, unidades: unidadesTot, monto: r2(monto), inventarioActualizado: porInventario.size };
  }

  async function listar(actor, { mes } = {}) {
    permitir(puedeCargar(actor));
    const enZona = await filtroZona(actor);
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    const medicamentos = new Map((await data.list('medicamentos')).map((m) => [m.id, m]));
    return (await data.list('ventasFarmacia')).filter((v) => (!mes || v.fecha.startsWith(mes)) && enZona(farmacias.get(v.farmaciaId) ?? {}))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((v) => ({ ...v, farmacia: farmacias.get(v.farmaciaId)?.nombre ?? '', medicamento: medicamentos.get(v.medicamentoId)?.nombre ?? '' }));
  }
  /** Lo usa la tienda al entregar un pedido: misma lógica de venta e inventario, sin filtro de zona. */
  const registrarInterno = (actor, x) => confirmar(actor, x, { interno: true });
  return { leer, confirmar, registrarInterno, listar, iaActiva: () => Boolean(lector?.activo) };
}

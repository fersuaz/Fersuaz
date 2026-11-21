// Movimiento por territorio: qué medicamentos y cuánto volumen se movió en cada provincia y municipio.
// Junta tres fuentes del mes:
// - Recetas (prescripciones de las promotoras): unidades y volumen a precio del catálogo.
// - Vouchers de farmacia (dependientes, vendedores, PVC y promotoras): unidades y monto real vendido.
//   Cuentan los aprobados y los pendientes de revisión; no los rechazados ni los anulados.
// - Ventas a farmacias importadas (Excel o IA): unidades y monto facturado por el laboratorio.
// Además: ranking de médicos que más prescriben en el territorio.
import { AuthError as HttpError } from './auth.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Pura: agrega por provincia → municipio → medicamento. */
export function agruparMovimiento({ recetas = [], vouchers = [], ventas = [], farmaciaDe = () => null, precios = new Map(), nombres = new Map() }) {
  const filas = new Map();
  const fila = (provincia, municipio, medicamentoId, nombre) => {
    const k = `${provincia}|${municipio}|${medicamentoId}`;
    if (!filas.has(k)) filas.set(k, { provincia, municipio, medicamentoId, medicamento: nombres.get(medicamentoId) ?? nombre ?? 'Medicamento', recetadas: 0, recetas: 0, volumenRecetado: 0, vendidasVoucher: 0, montoVoucher: 0, vouchersPendientes: 0, vendidasLaboratorio: 0, montoLaboratorio: 0 });
    return filas.get(k);
  };
  for (const r of recetas) for (const l of r.items ?? []) {
    const f = fila(r.provincia, r.municipio, l.medicamentoId, l.medicamento);
    f.recetadas += Number(l.unidades) || 0; f.recetas += 1;
    f.volumenRecetado += (Number(l.unidades) || 0) * (precios.get(l.medicamentoId) ?? 0);
  }
  let sinUbicacion = 0;
  for (const v of vouchers) {
    if (['rechazado', 'anulado'].includes(v.estado)) continue;
    const far = farmaciaDe(v);
    if (!far) { sinUbicacion++; continue; }
    for (const l of v.items ?? []) {
      const f = fila(far.provincia, far.municipio, l.medicamentoId, l.medicamento);
      f.vendidasVoucher += Number(l.cantidad) || 0; f.montoVoucher += Number(l.monto) || 0;
      if (v.estado === 'pendiente') f.vouchersPendientes += 1;
    }
  }
  for (const s of ventas) {
    if (!s.provincia || !s.medicamentoId) continue;
    const f = fila(s.provincia, s.municipio, s.medicamentoId, null);
    f.vendidasLaboratorio += Number(s.unidades) || 0; f.montoLaboratorio += Number(s.monto) || (Number(s.unidades) || 0) * (Number(s.precioUnitario) || 0);
  }
  const lista = [...filas.values()].map((f) => ({ ...f, volumenRecetado: r2(f.volumenRecetado), montoVoucher: r2(f.montoVoucher), montoLaboratorio: r2(f.montoLaboratorio),
    // Se recetó más de lo que salió por las farmacias de la zona: posible venta perdida o farmacia sin inventario.
    alerta: f.recetadas > 0 && f.recetadas > f.vendidasVoucher + f.vendidasLaboratorio }))
    .sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es') || a.medicamento.localeCompare(b.medicamento, 'es'));
  const provincias = new Map();
  for (const f of lista) {
    const p = provincias.get(f.provincia) ?? { provincia: f.provincia, municipios: new Set(), recetadas: 0, volumenRecetado: 0, vendidasVoucher: 0, montoVoucher: 0, vendidasLaboratorio: 0, montoLaboratorio: 0, alertas: 0 };
    p.municipios.add(f.municipio);
    for (const k of ['recetadas', 'volumenRecetado', 'vendidasVoucher', 'montoVoucher', 'vendidasLaboratorio', 'montoLaboratorio']) p[k] += f[k];
    if (f.alerta) p.alertas++;
    provincias.set(f.provincia, p);
  }
  const porProvincia = [...provincias.values()].map((p) => ({ ...p, municipios: p.municipios.size, volumenRecetado: r2(p.volumenRecetado), montoVoucher: r2(p.montoVoucher), montoLaboratorio: r2(p.montoLaboratorio) }))
    .sort((a, b) => b.volumenRecetado + b.montoVoucher - (a.volumenRecetado + a.montoVoucher));
  return { filas: lista, porProvincia, sinUbicacion };
}

export function createMovimiento({ data, users }) {
  const permitir = (ok) => { if (!ok) throw new HttpError(403, 'No tienes permiso para ver este reporte.'); };
  async function reporte(actor, { mes, provincia } = {}) {
    permitir(actor?.status === 'activo' && ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(actor.role));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) throw new HttpError(422, 'Elige el mes.', { mes: 'Mes no válido.' });
    const meds = await data.list('medicamentos');
    const precios = new Map(meds.map((m) => [m.id, Number(m.precio) || 0]));
    const nombres = new Map(meds.map((m) => [m.id, m.presentacion ? `${m.nombre}, ${m.presentacion}` : m.nombre]));
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    const usuarios = new Map((await users.listUsers()).map((u) => [u.id, u]));
    const enProv = (x) => !provincia || x.provincia === provincia;
    const recetas = (await data.list('recetas')).filter((r) => String(r.fecha).startsWith(mes) && enProv(r));
    const farmaciaDe = (v) => { const d = usuarios.get(v.dependienteId); const f = d?.farmaciaId ? farmacias.get(d.farmaciaId) : null; return f && enProv(f) ? f : null; };
    const vouchers = (await data.list('vouchers')).filter((v) => String(v.fecha).startsWith(mes));
    const ventas = (await data.list('ventasFarmacia')).filter((s) => String(s.fecha).startsWith(mes) && enProv(s));
    const out = agruparMovimiento({ recetas, vouchers, ventas, farmaciaDe, precios, nombres });
    if (provincia) out.sinUbicacion = 0; // con filtro, los vouchers de otras provincias no son "sin ubicación"
    // Ranking de médicos del territorio
    const medicos = new Map((await data.list('medicos')).map((m) => [m.id, m]));
    const rk = new Map();
    for (const r of recetas) {
      const x = rk.get(r.medicoId) ?? { medicoId: r.medicoId, recetas: 0, unidades: 0, volumen: 0, ultima: null, municipios: new Set() };
      x.recetas++; x.municipios.add(`${r.municipio}, ${r.provincia}`);
      for (const l of r.items ?? []) { x.unidades += Number(l.unidades) || 0; x.volumen += (Number(l.unidades) || 0) * (precios.get(l.medicamentoId) ?? 0); }
      if (!x.ultima || r.fecha > x.ultima) x.ultima = r.fecha;
      rk.set(r.medicoId, x);
    }
    const ranking = [...rk.values()].map((x) => { const m = medicos.get(x.medicoId); return { medicoId: x.medicoId, medico: m?.nombre ?? 'Médico', especialidad: m?.especialidad ?? null, centro: m?.centro ?? null, recetas: x.recetas, unidades: x.unidades, volumen: r2(x.volumen), ultima: x.ultima, zona: [...x.municipios].join('; ') }; })
      .sort((a, b) => b.volumen - a.volumen || b.recetas - a.recetas).slice(0, 50);
    // Farmacias que más venden según los vouchers de sus dependientes
    const fx = new Map();
    for (const v of vouchers) {
      if (['rechazado', 'anulado'].includes(v.estado)) continue;
      const d = usuarios.get(v.dependienteId); const f = d?.farmaciaId ? farmacias.get(d.farmaciaId) : null;
      if (!f || !enProv(f)) continue;
      const x = fx.get(f.id) ?? { farmaciaId: f.id, farmacia: f.nombre, municipio: f.municipio, provincia: f.provincia, dependientes: new Set(), vouchers: 0, unidades: 0, monto: 0, meds: new Map() };
      x.dependientes.add(v.dependienteId); x.vouchers++;
      for (const l of v.items ?? []) { x.unidades += Number(l.cantidad) || 0; x.monto += Number(l.monto) || 0; x.meds.set(l.medicamentoId, (x.meds.get(l.medicamentoId) ?? 0) + (Number(l.cantidad) || 0)); }
      fx.set(f.id, x);
    }
    const farmaciasTop = [...fx.values()].map((x) => { const top = [...x.meds.entries()].sort((a, b) => b[1] - a[1])[0]; return { farmaciaId: x.farmaciaId, farmacia: x.farmacia, municipio: x.municipio, provincia: x.provincia, dependientes: x.dependientes.size, vouchers: x.vouchers, unidades: x.unidades, monto: r2(x.monto), masVendido: top ? nombres.get(top[0]) ?? null : null }; })
      .sort((a, b) => b.monto - a.monto).slice(0, 50);
    // Medicamentos y municipios que más se venden (vouchers + laboratorio)
    const porMed = new Map(); const porMun = new Map();
    for (const f of out.filas) {
      const m = porMed.get(f.medicamentoId) ?? { medicamentoId: f.medicamentoId, medicamento: f.medicamento, unidades: 0, monto: 0, recetadas: 0, municipios: new Set() };
      m.unidades += f.vendidasVoucher + f.vendidasLaboratorio; m.monto += f.montoVoucher + f.montoLaboratorio; m.recetadas += f.recetadas; if (f.vendidasVoucher + f.vendidasLaboratorio) m.municipios.add(f.municipio);
      porMed.set(f.medicamentoId, m);
      const k = `${f.provincia}|${f.municipio}`;
      const u = porMun.get(k) ?? { provincia: f.provincia, municipio: f.municipio, unidades: 0, monto: 0, recetado: 0 };
      u.unidades += f.vendidasVoucher + f.vendidasLaboratorio; u.monto += f.montoVoucher + f.montoLaboratorio; u.recetado += f.volumenRecetado;
      porMun.set(k, u);
    }
    const medicamentosTop = [...porMed.values()].map((m) => ({ ...m, monto: r2(m.monto), municipios: m.municipios.size })).sort((a, b) => b.monto - a.monto || b.unidades - a.unidades);
    const municipiosTop = [...porMun.values()].map((u) => ({ ...u, monto: r2(u.monto), recetado: r2(u.recetado) })).sort((a, b) => b.monto - a.monto || b.recetado - a.recetado);
    const total = (k) => r2(out.filas.reduce((s, f) => s + f[k], 0));
    return { mes, provincia: provincia || null, ...out, ranking, farmaciasTop, medicamentosTop, municipiosTop, totales: { recetadas: total('recetadas'), volumenRecetado: total('volumenRecetado'), vendidasVoucher: total('vendidasVoucher'), montoVoucher: total('montoVoucher'), vendidasLaboratorio: total('vendidasLaboratorio'), montoLaboratorio: total('montoLaboratorio'), recetas: recetas.length, vouchers: vouchers.filter((v) => !['rechazado', 'anulado'].includes(v.estado)).length } };
  }
  return { reporte };
}

// Tareas sugeridas para vender más. Salen de los datos ya conectados (recetas, vouchers, ventas, metas,
// equipos, farmacias, médicos, pedidos). Cada tarea dice qué hacer, por qué (el dato que la origina),
// quién del equipo debería hacerlo y adónde ir en el panel. Ordenadas por prioridad e impacto en RD$.
import { AuthError as HttpError } from './auth.js';
import { dentroDeZona } from './territorio.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const RD = (n) => `RD$${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mesAnterior = (mes) => { const [y, m] = mes.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const PRIORIDAD = { alta: 0, media: 1, baja: 2 };

export function createSugerencias({ data, users, movimiento, metas, hoy }) {
  async function tareas(actor, { mes = hoy().slice(0, 7) } = {}) {
    if (!(actor?.status === 'activo' && ['administrador', 'gerencia', 'supervisor'].includes(actor.role))) throw new HttpError(403, 'No tienes permiso para ver las tareas sugeridas.');
    const out = [];
    const add = (t) => out.push({ id: `${t.tipo}:${t.clave ?? out.length}`, ...t });
    const usuarios = await users.listUsers();
    const reps = usuarios.filter((u) => u.role === 'representante' && u.status === 'activo');
    const zonas = new Map((await data.list('zonas')).map((z) => [z.representanteId, z]));
    const responsable = (provincia, municipio, posicion) => reps.find((u) => u.position === posicion && dentroDeZona(zonas.get(u.id), provincia, municipio)) ?? null;
    const nombreDe = (u) => (u ? u.fullName : null);

    // 1. Recetado sin venta en el municipio: venta perdida o farmacias sin inventario.
    const mov = await movimiento.reporte(actor, { mes });
    for (const f of mov.filas.filter((x) => x.alerta).sort((a, b) => (b.recetadas - b.vendidasVoucher - b.vendidasLaboratorio) - (a.recetadas - a.vendidasVoucher - a.vendidasLaboratorio)).slice(0, 8)) {
      const ven = responsable(f.provincia, f.municipio, 'Vendedor');
      const faltan = f.recetadas - f.vendidasVoucher - f.vendidasLaboratorio;
      add({ tipo: 'recetado_sin_venta', clave: `${f.municipio}|${f.medicamentoId}`, prioridad: faltan >= 20 ? 'alta' : 'media', impacto: r2(faltan * (f.volumenRecetado / Math.max(1, f.recetadas))),
        titulo: `Surtir ${f.medicamento} en las farmacias de ${f.municipio}`,
        porque: `Se recetaron ${f.recetadas} unidades este mes y en las farmacias de ${f.municipio} solo salieron ${f.vendidasVoucher + f.vendidasLaboratorio}. Los pacientes pueden estar comprando otra marca o no encontrarlo.`,
        quien: ven ? `${nombreDe(ven)} (vendedor)` : `Asigna un vendedor a ${f.municipio}`, enlace: `#territorio?mes=${mes}&provincia=${encodeURIComponent(f.provincia)}&sec=detalle` });
    }
    // 2. Farmacias que vendían el mes pasado y este mes no.
    const ant = await movimiento.reporte(actor, { mes: mesAnterior(mes) });
    const ahora = new Set(mov.farmaciasTop.map((f) => f.farmaciaId));
    for (const f of ant.farmaciasTop.filter((x) => !ahora.has(x.farmaciaId)).slice(0, 6)) {
      const ven = responsable(f.provincia, f.municipio, 'Vendedor');
      add({ tipo: 'farmacia_sin_venta', clave: f.farmaciaId, prioridad: f.monto >= 10000 ? 'alta' : 'media', impacto: f.monto,
        titulo: `Visitar ${f.farmacia} (${f.municipio})`,
        porque: `El mes pasado vendió ${RD(f.monto)} (${f.unidades} unidades${f.masVendido ? `, sobre todo ${f.masVendido}` : ''}) y este mes no tiene vouchers.`,
        quien: ven ? `${nombreDe(ven)} (vendedor)` : 'El vendedor de la zona', enlace: '#catalogo?ver=farmacias' });
    }
    // 3. Médicos que más recetaban y este mes no.
    const recetanAhora = new Set(mov.ranking.map((m) => m.medicoId));
    for (const m of ant.ranking.filter((x) => !recetanAhora.has(x.medicoId)).slice(0, 5)) {
      const [mun, prov] = String(m.zona.split('; ')[0] ?? '').split(', ');
      const vis = responsable(prov, mun, 'Visitador'); const pro = responsable(prov, mun, 'Promotora');
      add({ tipo: 'medico_sin_recetas', clave: m.medicoId, prioridad: 'media', impacto: m.volumen,
        titulo: `Visitar a ${m.medico}${m.especialidad ? `, ${m.especialidad}` : ''}`,
        porque: `El mes pasado recetó ${m.unidades} unidades (${RD(m.volumen)}) en ${m.recetas} receta(s); este mes aún no aparece.${m.centro ? ` Labora en ${m.centro}.` : ''}`,
        quien: [vis && `${nombreDe(vis)} (visitador)`, pro && `${nombreDe(pro)} (promotora)`].filter(Boolean).join(' y ') || 'El visitador de la zona', enlace: `#territorio?mes=${mesAnterior(mes)}&sec=medicos` });
    }
    // 4. Representantes por debajo del ritmo de sus metas.
    const av = await metas.avance(actor, { mes });
    const ritmo = av.dias.total ? Math.round((av.dias.transcurridos / av.dias.total) * 100) : 0;
    if (ritmo > 0 && ritmo < 100) {
      for (const x of av.items) {
        const bajas = x.metricas.filter((m) => m.porcentaje != null && m.clave !== 'medicamentosPorReceta' && m.porcentaje < ritmo * 0.8);
        if (!bajas.length) continue;
        add({ tipo: 'meta_atrasada', clave: x.representante.id, prioridad: bajas.some((m) => m.porcentaje < ritmo * 0.5) ? 'alta' : 'media', impacto: 0,
          titulo: `Revisar el plan de ${x.representante.nombre} (${x.representante.posicion})`,
          porque: `Va por debajo del ritmo: ${bajas.map((m) => `${m.nombre.toLowerCase()} ${m.porcentaje}%`).join(', ')}, y a hoy debería ir cerca del ${ritmo}%.`,
          quien: 'Supervisión', enlace: `#metas?mes=${mes}` });
      }
    }
    // 5. Equipos lejos de su meta de ventas; equipos incompletos.
    const eq = await metas.equipos(actor, { mes });
    for (const e of eq.equipos) {
      if (e.porcentaje != null && ritmo > 0 && e.porcentaje < ritmo * 0.8) add({ tipo: 'equipo_atrasado', clave: e.vendedor.id, prioridad: 'alta', impacto: r2(Math.max(0, (e.meta * ritmo) / 100 - e.ventas.total)),
        titulo: `Reunir al equipo de ${e.vendedor.nombre}`, porque: `Las ventas del equipo van en ${RD(e.ventas.total)} (${e.porcentaje}% de ${RD(e.meta)}); a hoy deberían ir cerca del ${ritmo}%. Recetaron ${RD(e.recetado)} en la zona.`,
        quien: e.integrantes.map((i) => i.nombre).join(', '), enlace: `#metas?mes=${mes}&sec=equipos` });
      if (e.faltan.length) add({ tipo: 'equipo_incompleto', clave: `inc:${e.vendedor.id}`, prioridad: 'media', impacto: 0,
        titulo: `Completar el equipo de ${e.vendedor.nombre}`, porque: `Su zona (${e.zona}) no tiene ${e.faltan.join(' ni ').toLowerCase()}. Sin ese rol, se pierden visitas a médicos o recetas.`,
        quien: 'Gerencia', enlace: '#representantes?ver=zonas' });
    }
    for (const u of eq.sinEquipo.filter((x) => !x.conZona)) add({ tipo: 'sin_zona', clave: u.id, prioridad: 'media', impacto: 0, titulo: `Asignar zona a ${u.nombre} (${u.posicion})`, porque: 'Sin zona no tiene cronograma, metas de su equipo ni farmacias para vouchers.', quien: 'Gerencia', enlace: `#representantes?rep=${u.id}` });
    // 6. Datos que faltan para medir bien.
    const sinFarmacia = usuarios.filter((u) => u.role === 'dependiente' && u.status === 'activo' && !u.farmaciaId);
    if (sinFarmacia.length) add({ tipo: 'dependientes_sin_farmacia', clave: 'dep', prioridad: 'alta', impacto: 0, titulo: `Ligar ${sinFarmacia.length} dependiente(s) a su farmacia`, porque: 'Sus vouchers no se pueden ubicar en provincia, municipio ni equipo, y no cuentan para las metas de la zona.', quien: 'Supervisión', enlace: '#solicitudes?sec=dependientes' });
    const pendFarm = (await data.list('farmacias')).filter((f) => f.estado === 'pendiente');
    if (pendFarm.length) add({ tipo: 'farmacias_pendientes', clave: 'far', prioridad: 'baja', impacto: 0, titulo: `Validar ${pendFarm.length} farmacia(s) nueva(s)`, porque: 'Las agregaron dependientes o el equipo; validarlas las suma a las rutas y a la tienda.', quien: 'Gerencia', enlace: '#catalogo?ver=farmacias' });
    // 7. Operación del día: vouchers por revisar y pedidos sin confirmar.
    const pend = (await data.list('vouchers')).filter((v) => v.estado === 'pendiente');
    if (pend.length) add({ tipo: 'vouchers_pendientes', clave: 'vou', prioridad: pend.length >= 20 ? 'alta' : 'media', impacto: r2(pend.reduce((s, v) => s + Number(v.total || 0), 0)), titulo: `Revisar ${pend.length} voucher(s)`, porque: `Suman ${RD(pend.reduce((s, v) => s + Number(v.total || 0), 0))}. Las dependientes ven su comisión cuando se aprueban; aprobar a tiempo las motiva a seguir vendiendo.`, quien: 'Supervisión o finanzas', enlace: '#revisar' });
    const hace1d = new Date(Date.now() - 864e5).toISOString();
    const pedidos = (await data.list('pedidos')).filter((p) => p.estado === 'recibido' && String(p.createdAt) < hace1d);
    if (pedidos.length) add({ tipo: 'pedidos_sin_confirmar', clave: 'ped', prioridad: 'alta', impacto: r2(pedidos.reduce((s, p) => s + Number(p.total || 0), 0)), titulo: `Confirmar ${pedidos.length} pedido(s) de la tienda`, porque: `Llevan más de un día sin confirmar y suman ${RD(pedidos.reduce((s, p) => s + Number(p.total || 0), 0))}.`, quien: 'El vendedor de cada zona', enlace: '#pedidos?estado=recibido' });
    // 8. Lo que más se vende: asegurar inventario y llevarlo a otras zonas.
    const top = mov.medicamentosTop[0];
    if (top && top.monto > 0 && top.unidades > 0) add({ tipo: 'producto_estrella', clave: top.medicamentoId, prioridad: 'baja', impacto: top.monto, titulo: `Empujar ${top.medicamento} en más municipios`, porque: `Es el que más se vende este mes (${RD(top.monto)}, ${top.unidades} unidades) y solo se mueve en ${top.municipios} municipio(s).`, quien: 'Vendedores y promotoras', enlace: `#territorio?mes=${mes}&sec=medicamentos` });

    out.sort((a, b) => PRIORIDAD[a.prioridad] - PRIORIDAD[b.prioridad] || b.impacto - a.impacto);
    return { mes, tareas: out.slice(0, 30), total: out.length };
  }
  return { tareas };
}

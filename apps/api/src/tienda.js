// Tienda en línea para farmacias: catálogo con fotos y ficha, y pedidos sin pago en línea.
// - El catálogo es público (nombre, fotos, ficha); el precio solo lo ve una cuenta activa
//   (la dependiente ligada a su farmacia, el equipo y la gestión).
// - La dependiente pide para su farmacia. El pedido le llega al vendedor de la zona y a la gestión.
// - Pago: transferencia (con comprobante), crédito o al entregar. No se cobra en línea.
// - Al marcar "entregado", lo pedido queda como venta a la farmacia y su inventario sube.
import { AuthError as HttpError } from './auth.js';
import { guardarAdjunto } from './adjuntos.js';
import { normalizeName } from './validation.js';
import { dentroDeZona } from './territorio.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const GESTION = ['administrador', 'gerencia'];
const VEN_TODO = ['administrador', 'gerencia', 'supervisor', 'finanzas'];
export const PAGOS = Object.freeze({ transferencia: 'Transferencia bancaria', credito: 'Crédito', contra_entrega: 'Pago al entregar' });
export const ESTADOS = Object.freeze({ recibido: 'Recibido', confirmado: 'Confirmado', despachado: 'Despachado', entregado: 'Entregado', cancelado: 'Cancelado' });
const SIGUIENTE = { recibido: ['confirmado', 'cancelado'], confirmado: ['despachado', 'cancelado'], despachado: ['entregado'], entregado: [], cancelado: [] };
/** Fotos del sitio que se pueden usar como fotos de producto (ya publicadas en la página principal). */
export const FOTOS_SITIO = Object.freeze([
  { url: 'assets/producto/tio-dex-frasco-y-caja.jpg', nombre: 'Tio-Dex: frasco y caja' },
  { url: 'assets/producto/tio-dex-caja.jpg', nombre: 'Tio-Dex: caja' },
]);
const MAX_FOTOS = 8;

/** Total de un pedido con los precios del catálogo (nunca los del navegador). */
export function totalPedido(lineas) {
  const items = lineas.map((l) => ({ ...l, subtotal: r2(l.precio * l.cantidad) }));
  return { items, total: r2(items.reduce((s, x) => s + x.subtotal, 0)), unidades: items.reduce((s, x) => s + x.cantidad, 0) };
}

export function createTienda({ data, users, files, audit, notificar, notificarRoles, ventas, hoy }) {
  const activo = (u) => u?.status === 'activo';
  const permitir = (ok, msg = 'No tienes permiso para esto.') => { if (!ok) throw new HttpError(403, msg); };
  const invalido = (fields) => { throw new HttpError(422, 'Revisa los campos marcados.', fields); };
  const esVendedorZona = (u) => activo(u) && u.role === 'representante' && ['Vendedor', 'PVC'].includes(u.position);
  const fotoUrl = (f) => (f.url ? f.url : `/api/tienda/imagen/${f.clave}`);

  function vistaProducto(m, conPrecio) {
    return {
      id: m.id, nombre: m.nombre, presentacion: m.presentacion ?? null, linea: m.linea ?? null,
      descripcion: m.descripcion ?? null, ficha: Array.isArray(m.ficha) ? m.ficha : [],
      imagenes: (Array.isArray(m.imagenes) ? m.imagenes : []).map((f) => ({ url: fotoUrl(f), nombre: f.nombre ?? m.nombre })),
      ...(conPrecio ? { precio: m.precio != null ? Number(m.precio) : null } : {}),
    };
  }
  const publicados = async () => (await data.list('medicamentos')).filter((m) => m.activo !== false && m.publicado === true).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // ---------------------------------------------------------------- catálogo público
  async function productos(me) { return (await publicados()).map((m) => vistaProducto(m, activo(me))); }
  async function producto(me, id) {
    const m = await data.get('medicamentos', id);
    if (!m || m.activo === false || m.publicado !== true) throw new HttpError(404, 'Ese producto no está en la tienda.');
    return vistaProducto(m, activo(me));
  }
  /** Las fotos subidas se ven sin sesión solo si pertenecen a un producto publicado. */
  async function imagen(clave) {
    const ok = (await publicados()).some((m) => (m.imagenes ?? []).some((f) => f.clave === clave));
    const f = ok ? await files.get(clave) : null;
    if (!f || !/^image\//.test(f.tipo ?? f.type ?? 'image/')) throw new HttpError(404, 'Imagen no encontrada.');
    return f;
  }

  // ---------------------------------------------------------------- administración de la ficha
  async function editarProducto(actor, id, input = {}) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia publican en la tienda.');
    const m = await data.get('medicamentos', id);
    if (!m) throw new HttpError(404, 'El medicamento no existe.');
    const e = {}; const patch = {};
    if (input.descripcion !== undefined) {
      const d = String(input.descripcion ?? '').trim();
      if (d.length > 4000) e.descripcion = 'La descripción no puede pasar de 4,000 caracteres.';
      patch.descripcion = d || null;
    }
    if (input.ficha !== undefined) {
      const ficha = (Array.isArray(input.ficha) ? input.ficha : []).map((x) => ({ dato: normalizeName(x?.dato), valor: normalizeName(x?.valor) })).filter((x) => x.dato && x.valor);
      if (ficha.length > 20) e.ficha = 'Máximo 20 datos en la ficha.';
      patch.ficha = ficha;
    }
    if (input.fotosSitio !== undefined) {
      const urls = new Set(FOTOS_SITIO.map((f) => f.url));
      const nuevas = (Array.isArray(input.fotosSitio) ? input.fotosSitio : []).filter((u) => urls.has(u));
      const actuales = (m.imagenes ?? []).filter((f) => !f.url);
      patch.imagenes = [...nuevas.map((u) => ({ url: u, nombre: FOTOS_SITIO.find((f) => f.url === u).nombre })), ...actuales].slice(0, MAX_FOTOS);
    }
    if (input.orden !== undefined) {
      const lista = patch.imagenes ?? m.imagenes ?? [];
      const id2 = (f) => f.clave ?? f.url;
      const orden = (Array.isArray(input.orden) ? input.orden : []).map(String);
      patch.imagenes = [...orden.map((k) => lista.find((f) => id2(f) === k)).filter(Boolean), ...lista.filter((f) => !orden.includes(id2(f)))];
    }
    if (input.quitar !== undefined) patch.imagenes = (patch.imagenes ?? m.imagenes ?? []).filter((f) => (f.clave ?? f.url) !== String(input.quitar));
    if (input.publicado !== undefined) {
      const pub = input.publicado === true;
      const fotos = patch.imagenes ?? m.imagenes ?? [];
      if (pub && !fotos.length) e.publicado = 'Agrega al menos una foto antes de publicarlo.';
      if (pub && m.precio == null) e.publicado = 'Ponle precio antes de publicarlo.';
      patch.publicado = pub;
    }
    if (Object.keys(e).length) invalido(e);
    const out = await data.update('medicamentos', id, patch);
    await audit({ actorId: actor.id, action: 'tienda_producto', entity: 'medicamento', entityId: id, after: { publicado: out.publicado ?? false, fotos: (out.imagenes ?? []).length } });
    return { ...vistaProducto(out, true), publicado: out.publicado === true };
  }
  async function agregarFoto(actor, id, archivo) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia publican en la tienda.');
    const m = await data.get('medicamentos', id);
    if (!m) throw new HttpError(404, 'El medicamento no existe.');
    if ((m.imagenes ?? []).length >= MAX_FOTOS) throw new HttpError(409, `Máximo ${MAX_FOTOS} fotos por producto.`);
    if (!/^image\/(jpeg|png|webp)$/.test(String(archivo?.tipo ?? ''))) invalido({ foto: 'La foto debe ser JPG, PNG o WEBP.' });
    const f = await guardarAdjunto(files, actor, archivo, 'foto');
    const out = await data.update('medicamentos', id, { imagenes: [...(m.imagenes ?? []), { clave: f.clave, nombre: f.nombre }] });
    await audit({ actorId: actor.id, action: 'tienda_foto', entity: 'medicamento', entityId: id, after: { fotos: out.imagenes.length } });
    return { ...vistaProducto(out, true), publicado: out.publicado === true };
  }
  async function fichaAdmin(actor) {
    permitir(activo(actor) && GESTION.includes(actor.role));
    return (await data.list('medicamentos')).filter((m) => m.activo !== false).map((m) => ({ ...vistaProducto(m, true), publicado: m.publicado === true, fotos: (m.imagenes ?? []).map((f) => ({ id: f.clave ?? f.url, url: fotoUrl(f), nombre: f.nombre ?? m.nombre, delSitio: Boolean(f.url) })) }));
  }

  // ---------------------------------------------------------------- pedidos
  async function farmaciaDe(actor) {
    if (!(activo(actor) && actor.role === 'dependiente')) throw new HttpError(403, 'Los pedidos los hace la dependiente con la cuenta de su farmacia.');
    if (!actor.farmaciaId) throw new HttpError(409, 'Tu cuenta aún no está ligada a una farmacia del catálogo. Pide a la gerencia que la ligue.');
    const f = await data.get('farmacias', actor.farmaciaId);
    if (!f) throw new HttpError(409, 'Tu farmacia no está en el catálogo.');
    return f;
  }
  async function vendedorDe(f) {
    const zonas = await data.list('zonas');
    for (const u of (await users.listUsers()).filter((x) => activo(x) && x.role === 'representante' && x.position === 'Vendedor')) {
      const z = zonas.find((y) => y.representanteId === u.id);
      if (z && dentroDeZona(z, f.provincia, f.municipio)) return u;
    }
    return null;
  }
  async function crearPedido(actor, input = {}) {
    const f = await farmaciaDe(actor);
    const e = {};
    const lineasIn = Array.isArray(input.items) ? input.items : [];
    if (!lineasIn.length) e.items = 'Agrega al menos un producto.';
    if (lineasIn.length > 60) e.items = 'Máximo 60 productos por pedido.';
    const pago = String(input.pago ?? '');
    if (!PAGOS[pago]) e.pago = 'Elige cómo vas a pagar.';
    const meds = new Map((await publicados()).map((m) => [m.id, m]));
    const vistos = new Set();
    const lineas = [];
    lineasIn.forEach((l, i) => {
      const m = meds.get(l?.medicamentoId); const cantidad = Number(l?.cantidad);
      if (!m) { e[`items.${i}`] = 'Ese producto ya no está en la tienda.'; return; }
      if (m.precio == null) { e[`items.${i}`] = `${m.nombre} no tiene precio todavía.`; return; }
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) { e[`items.${i}`] = `Revisa la cantidad de ${m.nombre}.`; return; }
      if (vistos.has(m.id)) { e[`items.${i}`] = `${m.nombre} está repetido.`; return; }
      vistos.add(m.id);
      lineas.push({ medicamentoId: m.id, nombre: m.nombre, presentacion: m.presentacion ?? null, precio: Number(m.precio), cantidad });
    });
    const nota = String(input.nota ?? '').trim().slice(0, 1000) || null;
    if (Object.keys(e).length) invalido(e);
    const comprobante = input.comprobante ? await guardarAdjunto(files, actor, input.comprobante, 'comprobante') : null;
    const { items, total, unidades } = totalPedido(lineas);
    const n = (await data.list('pedidos')).length + 1;
    const numero = `P-${String(n).padStart(6, '0')}`;
    const vendedor = await vendedorDe(f);
    const ahora = new Date().toISOString();
    const p = await data.insert('pedidos', {
      numero, farmaciaId: f.id, creadoPor: actor.id, items, total, unidades, pago, comprobante, nota, estado: 'recibido',
      historial: [{ estado: 'recibido', por: actor.id, fecha: ahora, nota: null }], vendedorId: vendedor?.id ?? null, provincia: f.provincia, municipio: f.municipio,
    });
    await audit({ actorId: actor.id, action: 'pedido_creado', entity: 'pedido', entityId: p.id, after: { numero, total, unidades, pago } });
    const texto = `${f.nombre} (${f.municipio}) pidió ${unidades} unidad(es) por RD$${total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Pago: ${PAGOS[pago].toLowerCase()}.`;
    if (vendedor) await notificar?.(vendedor.id, { tipo: 'pedido', titulo: `Pedido nuevo ${numero}`, texto, enlace: `#pedidos?id=${p.id}` });
    await notificarRoles?.(GESTION, { tipo: 'pedido', titulo: `Pedido nuevo ${numero}`, texto: `${texto}${vendedor ? '' : ' Su zona no tiene vendedor asignado.'}`, enlace: `#pedidos?id=${p.id}` });
    return vista(p, new Map([[f.id, f]]));
  }
  function vista(p, farmacias) {
    const f = farmacias.get(p.farmaciaId);
    return { ...p, farmacia: f ? { id: f.id, nombre: f.nombre, municipio: f.municipio, provincia: f.provincia } : null, estadoNombre: ESTADOS[p.estado], pagoNombre: PAGOS[p.pago] };
  }
  async function puedeVer(actor, p) {
    if (activo(actor) && VEN_TODO.includes(actor.role)) return true;
    if (activo(actor) && actor.role === 'dependiente') return p.farmaciaId === actor.farmaciaId;
    if (esVendedorZona(actor)) {
      if (p.vendedorId === actor.id) return true;
      const z = (await data.list('zonas', { representanteId: actor.id }))[0];
      return Boolean(z && dentroDeZona(z, p.provincia, p.municipio));
    }
    return false;
  }
  async function listarPedidos(actor, { estado } = {}) {
    permitir(activo(actor) && (VEN_TODO.includes(actor.role) || actor.role === 'dependiente' || esVendedorZona(actor)));
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    const out = [];
    for (const p of await data.list('pedidos')) if ((!estado || p.estado === estado) && await puedeVer(actor, p)) out.push(vista(p, farmacias));
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async function cambiarEstado(actor, id, input = {}) {
    const p = await data.get('pedidos', id);
    if (!p || !(await puedeVer(actor, p))) throw new HttpError(404, 'El pedido no existe.');
    const estado = String(input.estado ?? '');
    if (!ESTADOS[estado]) invalido({ estado: 'Estado no válido.' });
    const esDueno = actor.role === 'dependiente';
    const gestionOVendedor = (activo(actor) && GESTION.includes(actor.role)) || esVendedorZona(actor);
    if (esDueno) permitir(estado === 'cancelado' && p.estado === 'recibido', 'Solo puedes cancelar tu pedido mientras está recibido.');
    else permitir(gestionOVendedor, 'Solo la gerencia o el vendedor de la zona cambian el estado del pedido.');
    if (!SIGUIENTE[p.estado].includes(estado)) throw new HttpError(409, `Un pedido ${ESTADOS[p.estado].toLowerCase()} no puede pasar a ${ESTADOS[estado].toLowerCase()}.`);
    const nota = String(input.nota ?? '').trim().slice(0, 500) || null;
    if (estado === 'cancelado' && !nota) invalido({ nota: 'Escribe el motivo de la cancelación.' });
    const ahora = new Date().toISOString();
    let venta = null;
    // Entregado: lo pedido pasa a ser venta a la farmacia y sube su inventario (una sola vez).
    if (estado === 'entregado' && ventas) {
      venta = await ventas.registrarInterno(actor, { filas: p.items.map((l) => ({ farmaciaId: p.farmaciaId, medicamentoId: l.medicamentoId, unidades: l.cantidad, precioUnitario: l.precio, fecha: hoy(), factura: p.numero })), fuente: 'pedido', archivo: p.numero });
    }
    const out = await data.update('pedidos', id, { estado, historial: [...(p.historial ?? []), { estado, por: actor.id, fecha: ahora, nota }] });
    await audit({ actorId: actor.id, action: `pedido_${estado}`, entity: 'pedido', entityId: id, before: { estado: p.estado }, after: { estado, nota } });
    if (!esDueno) await notificar?.(p.creadoPor, { tipo: 'pedido', titulo: `Pedido ${p.numero}: ${ESTADOS[estado].toLowerCase()}`, texto: nota ? `Nota: ${nota}` : `Tu pedido ${p.numero} está ${ESTADOS[estado].toLowerCase()}.`, enlace: `#pedidos?id=${id}` });
    else await notificarRoles?.(GESTION, { tipo: 'pedido', titulo: `Pedido ${p.numero} cancelado por la farmacia`, texto: nota, enlace: `#pedidos?id=${id}` });
    const farmacias = new Map((await data.list('farmacias')).map((f) => [f.id, f]));
    return { ...vista(out, farmacias), venta };
  }
  async function subirComprobante(actor, id, archivo) {
    const p = await data.get('pedidos', id);
    if (!p || actor.role !== 'dependiente' || p.farmaciaId !== actor.farmaciaId) throw new HttpError(404, 'El pedido no existe.');
    if (['entregado', 'cancelado'].includes(p.estado)) throw new HttpError(409, 'Ese pedido ya está cerrado.');
    const comprobante = await guardarAdjunto(files, actor, archivo, 'comprobante');
    const out = await data.update('pedidos', id, { comprobante });
    await audit({ actorId: actor.id, action: 'pedido_comprobante', entity: 'pedido', entityId: id });
    await notificarRoles?.(GESTION, { tipo: 'pedido', titulo: `Comprobante del pedido ${p.numero}`, texto: 'La farmacia subió el comprobante de la transferencia.', enlace: `#pedidos?id=${id}` });
    return vista(out, new Map((await data.list('farmacias')).map((f) => [f.id, f])));
  }
  return { productos, producto, imagen, editarProducto, agregarFoto, fichaAdmin, crearPedido, listarPedidos, cambiarEstado, subirComprobante, fotosSitio: () => FOTOS_SITIO, PAGOS, ESTADOS };
}

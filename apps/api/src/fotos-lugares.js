// Fotos de Google Maps de establecimientos, farmacias y hoteles.
// Se guarda solo el nombre de cada foto (y su atribución); la imagen la pide el servidor a Google con la
// clave (que nunca llega al navegador) y la entrega con caché. Solo se sirven fotos de lugares registrados.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';

export const COL_FOTOS = { establecimiento: 'establecimientos', farmacia: 'farmacias', hotel: 'hoteles' };
const RE_FOTO = /^places\/([\w-]+)\/photos\/[\w-]+$/;

export function createFotosLugares({ data, lugares, audit, now = () => new Date() }) {
  const gestion = (a) => a?.status === STATUS.ACTIVO && ['administrador', 'gerencia', 'supervisor'].includes(a.role);
  const cache = new Map(); // nombre|ancho -> { tipo, buf }
  const MAX_CACHE = 300;

  /** Guarda las fotos de un lugar (las que trajo Google al registrarlo o al consultarlo). */
  async function guardar(tipo, id, fotos) {
    const col = COL_FOTOS[tipo]; if (!col || !id) return;
    await data.update(col, id, { fotos: { items: Array.isArray(fotos) ? fotos : [], consultado: now().toISOString() } });
  }

  /**
   * Trae de Google las fotos de los lugares registrados que tienen placeId y aún no se consultaron
   * (o de los `ids` indicados). Va por tandas: devuelve cuántos faltan para seguir.
   */
  async function traer(actor, { tipo, ids, limite = 40 } = {}) {
    if (!gestion(actor)) throw new HttpError(403, 'Solo la administración, la gerencia o la supervisión traen fotos.');
    const col = COL_FOTOS[tipo];
    if (!col) throw new HttpError(422, 'Elige qué lugares.', { tipo: 'Tipo no válido.' });
    if (!lugares.activo) throw new HttpError(503, 'La búsqueda en Google Maps no está conectada todavía.');
    const elegidos = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    const todos = (await data.list(col)).filter((x) => x.placeId && !['inactivo', 'inactiva'].includes(x.estado));
    const pendientes = todos.filter((x) => (elegidos ? elegidos.has(x.id) : !x.fotos?.consultado));
    const lote = pendientes.slice(0, Math.min(Math.max(Number(limite) || 40, 1), 60));
    let conFotos = 0; let errores = 0;
    for (const x of lote) {
      try { const f = await lugares.fotos(x.placeId); await guardar(tipo, x.id, f); if (f.length) conFotos++; }
      catch { errores++; }
    }
    if (lote.length) await audit?.({ actorId: actor.id, action: 'fotos_google', entity: col, entityId: tipo, after: { consultados: lote.length, conFotos, errores } });
    return { consultados: lote.length, conFotos, errores, faltan: Math.max(pendientes.length - lote.length, 0), sinGoogle: (await data.list(col)).filter((x) => !x.placeId).length };
  }

  /** Imagen de una foto guardada. Solo de lugares registrados en FERSUAZ (evita usar la clave para otras cosas). */
  async function imagen(nombre, ancho) {
    const m = RE_FOTO.exec(String(nombre ?? ''));
    if (!m) throw new HttpError(404, 'Foto no encontrada.');
    const w = [200, 400, 800, 1200].includes(Number(ancho)) ? Number(ancho) : 800;
    const k = `${nombre}|${w}`;
    if (cache.has(k)) return cache.get(k);
    let es = false;
    for (const col of Object.values(COL_FOTOS)) {
      const xs = await data.list(col, { placeId: m[1] });
      if (xs.some((x) => x.fotos?.items?.some((f) => f.nombre === nombre))) { es = true; break; }
    }
    if (!es) throw new HttpError(404, 'Foto no encontrada.');
    const img = await lugares.imagen(nombre, w);
    if (!img) throw new HttpError(404, 'Google ya no tiene esa foto. Vuelve a traer las fotos del lugar.');
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(k, img);
    return img;
  }

  return { guardar, traer, imagen };
}

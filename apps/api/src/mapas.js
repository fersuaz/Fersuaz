// Servicio de mapas intercambiable (prompt maestro, módulo 7 y §10).
// Distancias por carretera, nunca en línea recta. La clave vive solo en el servidor (MAPS_API_KEY).
// Sin proveedor conectado, el cálculo queda "pendiente" y los km se escriben a mano.

const PAIS = 'República Dominicana';
const direccion = (p) => [p.lugar ?? p.direccion, p.municipio, p.provincia, PAIS].filter(Boolean).join(', ');

/** Sin proveedor: no calcula nada (no se inventan distancias). */
export class SinMapas {
  nombre = 'manual';
  activo = false;
  async ruta() { return null; }
}

/** Google Maps Platform, Routes API (Compute Routes, categoría Essentials). */
export class GoogleRoutes {
  nombre = 'google';
  activo = true;
  constructor(apiKey, { fetchImpl = fetch } = {}) {
    if (!apiKey) throw new Error('MAPS_API_KEY es obligatoria para GoogleRoutes.');
    this.apiKey = apiKey; this.fetch = fetchImpl;
  }
  /**
   * Ruta en auto desde la residencia, por las paradas en orden y de regreso a la residencia.
   * Devuelve { km, minutos, tramos: [{ km, minutos }] } o lanza un Error con mensaje en español.
   */
  async ruta(origen, paradas, { regresar = true } = {}) {
    if (!paradas.length) throw new Error('No hay paradas para calcular.');
    const punto = (p) => (Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { location: { latLng: { latitude: p.lat, longitude: p.lng } } } : { address: direccion(p) });
    const pts = [origen, ...paradas, ...(regresar ? [origen] : [])].map(punto);
    const body = {
      origin: pts[0], destination: pts.at(-1), intermediates: pts.slice(1, -1),
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'es-419', regionCode: 'DO', units: 'METRIC',
    };
    let r;
    try {
      r = await this.fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('No se pudo contactar al proveedor de mapas.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 403) throw new Error('El proveedor de mapas rechazó la clave. Revisa que Routes API esté habilitada.');
      if (r.status === 429) throw new Error('Se alcanzó el límite de consultas de mapas. Intenta más tarde.');
      throw new Error('El proveedor de mapas no pudo calcular la ruta. Revisa las direcciones.');
    }
    const ruta = data.routes?.[0];
    if (!ruta || !ruta.distanceMeters) throw new Error('No se encontró una ruta por carretera para esas paradas.');
    const seg = (d) => Math.round(Number(String(d ?? '0s').replace('s', '')) / 60);
    return {
      km: Math.round(ruta.distanceMeters / 10) / 100,
      minutos: seg(ruta.duration),
      tramos: (ruta.legs ?? []).map((l) => ({ km: Math.round((l.distanceMeters ?? 0) / 10) / 100, minutos: seg(l.duration) })),
      proveedor: 'google',
    };
  }
}

export function crearMapas(env = process.env) {
  return env.MAPS_API_KEY ? new GoogleRoutes(env.MAPS_API_KEY) : new SinMapas();
}

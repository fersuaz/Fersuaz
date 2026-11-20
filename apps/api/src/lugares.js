// Búsqueda de establecimientos en Google Maps (Places API, Text Search y Place Details).
// La clave vive solo en el servidor (MAPS_API_KEY). Sin clave, la búsqueda queda desactivada.

const CONSULTA = {
  farmacia: 'farmacias', clinica: 'clínicas', hospital: 'hospitales', unap: 'UNAP unidad de atención primaria',
  cpn: 'centro de primer nivel de atención', diagnostico: 'centro diagnóstico', consultorio: 'consultorio médico',
};
const CAMPOS = 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.businessStatus';

export class SinLugares { activo = false; async buscar() { return []; } async pagina() { return { items: [], siguiente: null }; } async detalle() { return null; } }

export class GooglePlaces {
  activo = true;
  constructor(apiKey, { fetchImpl = fetch } = {}) {
    if (!apiKey) throw new Error('MAPS_API_KEY es obligatoria para GooglePlaces.');
    this.apiKey = apiKey; this.fetch = fetchImpl;
  }
  async #pedir(url, init) {
    let r;
    try { r = await this.fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); } catch { throw new Error('No se pudo contactar a Google Maps.'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 403) throw new Error('Google rechazó la clave. Revisa que Places API (New) esté habilitada.');
    if (r.status === 429) throw new Error('Se alcanzó el límite de búsquedas de Google Maps. Intenta más tarde.');
    if (!r.ok) throw new Error('Google Maps no pudo completar la búsqueda.');
    return data;
  }
  static #lugar(p) {
    return {
      placeId: p.id, nombre: p.displayName?.text ?? '', direccion: p.formattedAddress ?? '',
      lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null, telefono: p.nationalPhoneNumber ?? null,
      cerrado: p.businessStatus === 'CLOSED_PERMANENTLY',
    };
  }
  /** Busca un tipo de establecimiento dentro de un municipio (primera página). */
  async buscar(criterio) { return (await this.pagina(criterio)).items; }
  /** Una página de resultados (hasta 20). `siguiente` trae el token de la próxima página, si la hay. */
  async pagina({ tipo, municipio, provincia, texto }, pageToken) {
    const q = `${texto ? `${texto} ` : ''}${CONSULTA[tipo] ?? tipo} en ${municipio}, ${provincia}, República Dominicana`;
    const data = await this.#pedir('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': `${CAMPOS},nextPageToken` },
      body: JSON.stringify({ textQuery: q, languageCode: 'es', regionCode: 'DO', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    });
    return { items: (data.places ?? []).map(GooglePlaces.#lugar).filter((p) => !p.cerrado), siguiente: data.nextPageToken || null };
  }
  /** Datos oficiales de un lugar por su id (se usa al agregar, para no confiar en lo que envía el navegador). */
  async detalle(placeId) {
    if (!/^[\w-]{10,200}$/.test(String(placeId))) return null;
    const p = await this.#pedir(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es&regionCode=DO`, {
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': CAMPOS.replaceAll('places.', '') },
    });
    return p?.id ? GooglePlaces.#lugar(p) : null;
  }
}

export function crearLugares(env = process.env) {
  return env.MAPS_API_KEY ? new GooglePlaces(env.MAPS_API_KEY) : new SinLugares();
}

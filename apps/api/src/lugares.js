// Búsqueda de establecimientos en Google Maps (Places API, Text Search y Place Details).
// La clave vive solo en el servidor (MAPS_API_KEY). Sin clave, la búsqueda queda desactivada.

const CONSULTA = {
  farmacia: 'farmacias', clinica: 'clínicas', hospital: 'hospitales', unap: 'UNAP unidad de atención primaria',
  cpn: 'centro de primer nivel de atención', diagnostico: 'centro diagnóstico', consultorio: 'consultorio médico', hotel: 'hoteles', medico: 'médicos especialistas consultorio',
};
const CAMPOS = 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.businessStatus,places.rating,places.websiteUri,places.addressComponents';

export class SinLugares { activo = false; async buscar() { return []; } async pagina() { return { items: [], siguiente: null }; } async detalle() { return null; } async ubicacion() { return null; } async coordsDe() { return null; } }

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
      lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null, telefono: p.nationalPhoneNumber ?? null, calificacion: p.rating ?? null, web: p.websiteUri ?? null,
      cerrado: p.businessStatus === 'CLOSED_PERMANENTLY',
      // Provincia y municipio según Google (la búsqueda por texto a veces trae lugares de otro municipio).
      zona: p.addressComponents ? zonaDeComponentes(p.addressComponents) : null,
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
  /** Coordenadas de un lugar por su nombre (enlaces de Google Maps que no traen el punto). */
  async coordsDe(nombre) {
    const d = await this.#pedir('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'places.location' },
      body: JSON.stringify({ textQuery: `${nombre}, República Dominicana`, languageCode: 'es', regionCode: 'DO', pageSize: 1 }),
    });
    const l = d.places?.[0]?.location;
    return l ? { lat: Math.round(l.latitude * 1e6) / 1e6, lng: Math.round(l.longitude * 1e6) / 1e6 } : null;
  }
  /**
   * Nombre del lugar en unas coordenadas: primero la dirección (Geocoding inverso) y, si esa API no está
   * habilitada, el lugar conocido más cercano (Places, búsqueda cercana). Devuelve null si no hay nada.
   */
  async ubicacion(lat, lng) {
    try {
      const r = await this.fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=es&region=do&key=${encodeURIComponent(this.apiKey)}`, { signal: AbortSignal.timeout(15000) });
      const d = await r.json().catch(() => ({}));
      const x = d.status === 'OK' ? d.results?.[0] : null;
      if (x) return { nombre: sinPais(x.formatted_address), ...zonaDeComponentes(x.address_components), fuente: 'direccion' };
      if (d.status === 'ZERO_RESULTS') return null;
    } catch { /* se intenta con Places */ }
    const d = await this.#pedir('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents' },
      body: JSON.stringify({ locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } }, maxResultCount: 1, rankPreference: 'DISTANCE', languageCode: 'es', regionCode: 'DO' }),
    });
    const p = d.places?.[0]; if (!p) return null;
    return { nombre: `Cerca de ${p.displayName?.text ?? ''}, ${sinPais(p.formattedAddress)}`.replace(/,\s*$/, ''), ...zonaDeComponentes(p.addressComponents), fuente: 'cercano' };
  }
}

/** Quita "Provincia", "Province", "Municipio" y el país de un nombre de Google. */
const limpiarZona = (t) => String(t ?? '').replace(/^(Provincia|Municipio)( de)?\s+/i, '').replace(/\s+Province$/i, '').trim() || null;
/** Lee provincia, municipio y sector de los componentes de una dirección (Geocoding o Places). */
export function zonaDeComponentes(cs = []) {
  const de = (...tipos) => { for (const t of tipos) { const c = cs.find((x) => (x.types ?? []).includes(t)); if (c) return c.long_name ?? c.longText ?? null; } return null; };
  return { provincia: limpiarZona(de('administrative_area_level_1')), municipio: limpiarZona(de('administrative_area_level_2', 'locality')), sector: de('sublocality_level_1', 'sublocality', 'neighborhood') };
}
const sinPais = (t) => String(t ?? '').replace(/,?\s*(República Dominicana|Dominican Republic)\s*$/i, '').trim();

export function crearLugares(env = process.env) {
  return env.MAPS_API_KEY ? new GooglePlaces(env.MAPS_API_KEY) : new SinLugares();
}

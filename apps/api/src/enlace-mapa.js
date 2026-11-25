// Enlaces de ubicación de Google Maps → latitud y longitud.
// Acepta enlaces largos (con @lat,lng, !3d…!4d…, ?q=lat,lng) y cortos (maps.app.goo.gl, goo.gl/maps), que se
// abren en el servidor siguiendo solo redirecciones hacia dominios de Google (nunca a otro sitio).

const HOSTS = [/^maps\.app\.goo\.gl$/, /^goo\.gl$/, /^g\.co$/, /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/, /^consent\.google\.[a-z]{2,3}(\.[a-z]{2})?$/];
export const esHostGoogle = (host) => HOSTS.some((r) => r.test(String(host).toLowerCase()));

const par = (a, b) => {
  const lat = Number(a); const lng = Number(b);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

/**
 * Coordenadas dentro de un enlace de Google Maps, sin abrirlo. Prioridad: el punto del lugar (!3d…!4d…),
 * luego q/query/ll/destination, luego /place|search/lat,lng y por último el centro del mapa (@lat,lng).
 * Devuelve { lat, lng } o { nombre } (lugar sin coordenadas en el enlace) o null.
 */
export function coordsDeEnlace(texto) {
  let u; try { u = new URL(String(texto).trim()); } catch { return null; }
  if (!esHostGoogle(u.hostname)) return null;
  const cont = u.searchParams.get('continue'); // página de consentimiento: el enlace real va en "continue"
  if (cont && /consent\./.test(u.hostname)) return coordsDeEnlace(cont);
  const todo = decodeURIComponent(u.href);
  let m = todo.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (m) return par(m[1], m[2]);
  for (const k of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const v = u.searchParams.get(k); if (!v) continue;
    m = v.match(new RegExp(`^\\s*(?:loc:)?${NUM}\\s*,\\s*${NUM}\\s*$`));
    if (m) return par(m[1], m[2]);
  }
  m = decodeURIComponent(u.pathname).match(new RegExp(`/(?:place|search|dir)/(?:[^/]*/)*?${NUM}\\s*,\\s*\\+?${NUM}`));
  if (m) return par(m[1], m[2]);
  m = todo.match(new RegExp(`@${NUM},${NUM}`));
  const nombre = decodeURIComponent(u.pathname).match(/\/place\/([^/@]+)/)?.[1]?.replace(/\+/g, ' ').trim() || u.searchParams.get('q') || null;
  if (m) return { ...par(m[1], m[2]), aproximado: true, ...(nombre ? { nombre } : {}) };
  return nombre ? { nombre } : null;
}

/** Abre un enlace corto siguiendo hasta 6 redirecciones, todas dentro de Google. Devuelve la URL final. */
export async function abrirEnlace(texto, fetchImpl = fetch) {
  let url; try { url = new URL(String(texto).trim()); } catch { return null; }
  for (let i = 0; i < 6; i++) {
    if (url.protocol !== 'https:' || !esHostGoogle(url.hostname)) return null;
    let r;
    try { r = await fetchImpl(url.href, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (FERSUAZ)', 'accept-language': 'es' }, signal: AbortSignal.timeout(10000) }); } catch { return null; }
    const loc = r.headers?.get?.('location');
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url); continue; }
    return url.href;
  }
  return null;
}

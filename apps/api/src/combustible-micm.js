// Actualización automática de precios de combustible desde el aviso semanal oficial del MICM.
// Fuente: https://micm.gob.do/direcciones/combustibles/avisos-semanales-de-precios/avisos-semanales-de-precios-de-combustibles/
// Regla de seguridad: un precio solo se registra si los seis componentes del aviso suman el precio oficial
// (precio al público = precio oficial + ajuste). Si algo no cuadra, no se registra nada y se avisa.
import { lineasPdf } from './pdf-texto.js';

export const URL_AVISOS = 'https://micm.gob.do/direcciones/combustibles/avisos-semanales-de-precios/avisos-semanales-de-precios-de-combustibles/';
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const sin = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = (n) => String(n).padStart(2, '0');

const ETIQUETAS = [
  ['gasolina_premium', /^gasolina premium\b/],
  ['gasolina_regular', /^gasolina regular\b/],
  ['gasoil_optimo', /^gasoil (optimo|premium)\b/],
  ['gasoil_regular', /^gasoil regular\b/],
  ['glp', /^(gas licuado|glp\b)/],
];

/** "del 14 al 20 de noviembre del 2026" · "del 31 de octubre al 06 noviembre del 2026" · "del 27 de diciembre del 2025 al 02 de enero del 2026" */
export function vigenciaDeTitulo(titulo) {
  const t = sin(titulo).replace(/\s+/g, ' ');
  const m = t.match(/del? (\d{1,2})(?: de)? ?([a-z]+)?(?: (?:de|del) (\d{4}))? al (\d{1,2})(?: de)? ([a-z]+)(?: (?:de|del) (\d{4}))?/);
  if (!m) return null;
  const [, d1, m1, y1, d2, m2, y2] = m;
  const mesFin = MESES[m2]; const mesIni = m1 && MESES[m1] ? MESES[m1] : mesFin;
  if (!mesFin || !mesIni) return null;
  const anioFin = Number(y2 ?? y1); if (!anioFin) return null;
  const anioIni = Number(y1 ?? (mesIni > mesFin ? anioFin - 1 : anioFin));
  const desde = `${anioIni}-${pad(mesIni)}-${pad(d1)}`; const hasta = `${anioFin}-${pad(mesFin)}-${pad(d2)}`;
  return Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta)) ? null : { desde, hasta };
}

/** Primer aviso del listado: título, enlace al PDF y vigencia. */
export function avisoMasReciente(html) {
  const limpio = String(html).replace(/\s+/g, ' ');
  const re = /Aviso Precios Combustibles ([^<]{6,120}?)\s*<\/h\d>[\s\S]{0,3000}?href="([^"]+\.pdf)"/i;
  const m = limpio.match(re);
  if (!m) return null;
  const titulo = `Aviso Precios Combustibles ${m[1].trim()}`;
  const v = vigenciaDeTitulo(m[1]);
  if (!v) return null;
  const pdf = new URL(m[2].replace(/&amp;/g, '&'), URL_AVISOS).href;
  return { titulo, pdf, ...v };
}

const NUM = /^\(?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$|^\(?-?\d+(?:\.\d+)?\)?$/;
const valor = (s) => { const neg = /^\(.*\)$/.test(s) || s.startsWith('-'); const n = Number(s.replace(/[(),\-]/g, '')); return neg ? -n : n; };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** De las líneas del PDF obtiene el precio al público de cada combustible, verificando la suma de componentes. */
export function preciosDeLineas(paginas) {
  const out = {}; const detalle = {};
  for (const lineas of paginas) {
    for (const l of lineas) {
      const txt = sin(l.texto);
      const e = ETIQUETAS.find(([k, re]) => !out[k] && re.test(txt));
      if (!e) continue;
      const nums = l.texto.split(/\s+/).filter((t) => NUM.test(t)).map(valor);
      for (let i = 0; i + 6 < nums.length; i++) {
        const suma = nums.slice(i, i + 6).reduce((a, b) => a + b, 0);
        if (Math.abs(suma - nums[i + 6]) <= 0.05 && nums[i + 6] > 0) {
          const oficial = nums[i + 6]; const resto = nums.slice(i + 7);
          // Precio al público: si la fila lo trae explícito (cerca del oficial) y cuadra con oficial + algún ajuste, se usa;
          // si no, es el oficial más el primer ajuste pequeño (puede ser negativo).
          let publico = oficial; let ajuste = 0;
          const explicito = resto.find((x) => x !== oficial && Math.abs(x - oficial) <= oficial * 0.2 && resto.some((y) => Math.abs(oficial + y - x) <= 0.05));
          if (explicito != null) { publico = explicito; ajuste = r2(explicito - oficial); }
          else { const aj = resto.find((x) => x !== 0 && Math.abs(x) < oficial * 0.2); if (aj != null) { ajuste = aj; publico = oficial + aj; } }
          out[e[0]] = r2(publico);
          detalle[e[0]] = { oficial, ajuste, componentes: nums.slice(i, i + 6) };
          break;
        }
      }
    }
  }
  return { precios: out, detalle };
}

export function preciosDePdf(buf) { return preciosDeLineas(lineasPdf(buf)); }

async function bajar(fetchImpl, url, tipo, limite) {
  let r;
  try { r = await fetchImpl(url, { headers: { 'user-agent': 'FERSUAZ.NET/1.0 (precios de combustible)' }, signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error(`No se pudo contactar al MICM (${tipo}).`); }
  if (!r.ok) throw new Error(`El MICM respondió ${r.status} al pedir el ${tipo}.`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > limite) throw new Error(`El ${tipo} del MICM es demasiado grande.`);
  return b;
}

/**
 * Revisa el aviso más reciente y registra los precios que falten. Nunca sobrescribe un precio existente.
 * Devuelve { estado: 'registrado' | 'al dia' | 'error', ... } y lo guarda en configuración (clave micm_estado).
 */
export async function actualizarDesdeMicm({ data, audit, fetchImpl = fetch, now = () => new Date() }) {
  const informe = { revisado: now().toISOString(), fuente: URL_AVISOS };
  try {
    const aviso = avisoMasReciente((await bajar(fetchImpl, URL_AVISOS, 'listado de avisos', 3e6)).toString('utf8'));
    if (!aviso) throw new Error('No se encontró el aviso más reciente en la página del MICM (pudo cambiar su diseño).');
    Object.assign(informe, { aviso: aviso.titulo, pdf: aviso.pdf, vigenteDesde: aviso.desde, vigenteHasta: aviso.hasta });
    const existentes = await data.list('precios');
    const faltan = ETIQUETAS.map(([k]) => k).filter((k) => !existentes.some((p) => p.combustible === k && p.vigenteDesde === aviso.desde));
    if (!faltan.length) { informe.estado = 'al dia'; informe.mensaje = `Los precios del ${aviso.desde} ya estaban registrados.`; return await guardar(informe); }
    const { precios, detalle } = preciosDePdf(await bajar(fetchImpl, aviso.pdf, 'aviso PDF', 8e6));
    const noLeidos = ETIQUETAS.map(([k]) => k).filter((k) => precios[k] == null);
    if (noLeidos.length) throw new Error(`No se pudo verificar en el aviso el precio de: ${noLeidos.join(', ')}. Regístralo a mano con el PDF.`);
    for (const k of faltan) {
      const p = precios[k];
      if (!(p >= 80 && p <= 800)) throw new Error(`Precio fuera de rango para ${k}: RD$${p}. No se registró nada.`);
      const previo = existentes.filter((x) => x.combustible === k && x.vigenteDesde < aviso.desde).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
      if (previo && Math.abs(p - previo.precioGalon) / previo.precioGalon > 0.25) throw new Error(`El precio de ${k} cambia más de 25 % (RD$${previo.precioGalon} → RD$${p}). Revísalo a mano; no se registró nada.`);
    }
    const registrados = [];
    for (const k of faltan) {
      const x = await data.insert('precios', { combustible: k, precioGalon: precios[k], vigenteDesde: aviso.desde, fuente: 'micm', enlace: aviso.pdf, registradoPor: null });
      registrados.push({ combustible: k, precio: x.precioGalon });
    }
    await audit({ actorId: null, action: 'precios_micm_registrados', entity: 'precio', entityId: aviso.desde, after: { aviso: aviso.titulo, pdf: aviso.pdf, registrados, detalle } });
    Object.assign(informe, { estado: 'registrado', registrados, mensaje: `Se registraron ${registrados.length} precio(s) vigentes desde el ${aviso.desde}.` });
    return await guardar(informe);
  } catch (err) {
    Object.assign(informe, { estado: 'error', mensaje: err.message });
    return await guardar(informe);
  }

  async function guardar(v) {
    const [c] = await data.list('configuracion', { clave: 'micm_estado' });
    if (c) await data.update('configuracion', c.id, { valor: v }); else await data.insert('configuracion', { clave: 'micm_estado', valor: v });
    return v;
  }
}

// Rendimiento de vehículos desde FuelEconomy.gov (EPA, Departamento de Energía de EE. UU., dominio público).
// Menús: año → marca → modelo → versión (motor y transmisión) → ficha con el rendimiento combinado (comb08, millas
// por galón de EE. UU., el mismo galón que se vende en RD). Se convierte a km por galón. Si un modelo no se vende en
// EE. UU. (o es motocicleta), no estará aquí: el rendimiento se escribe a mano.
import { mpgAKmPorGalon } from './calculos.js';

const BASE = 'https://www.fueleconomy.gov/ws/rest/vehicle';
const DIA = 24 * 3600 * 1000;

/** Convierte la respuesta de un menú (JSON o XML) en [{ texto, valor }]. */
export function leerMenu(cuerpo) {
  if (cuerpo == null) return [];
  if (typeof cuerpo === 'object') {
    const m = cuerpo.menuItem ?? [];
    return (Array.isArray(m) ? m : [m]).filter(Boolean).map((x) => ({ texto: String(x.text), valor: String(x.value) }));
  }
  const out = [];
  for (const m of String(cuerpo).matchAll(/<menuItem>\s*<text>([^<]*)<\/text>\s*<value>([^<]*)<\/value>\s*<\/menuItem>/g)) out.push({ texto: decodificar(m[1]), valor: decodificar(m[2]) });
  return out;
}
const decodificar = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Ficha de un vehículo: rendimiento combinado, ciudad y carretera, y combustible. */
export function leerFicha(cuerpo) {
  const campo = (k) => {
    if (cuerpo && typeof cuerpo === 'object') return cuerpo[k] ?? null;
    const m = String(cuerpo ?? '').match(new RegExp(`<${k}>([^<]*)</${k}>`));
    return m ? decodificar(m[1]) : null;
  };
  const comb = Number(campo('comb08'));
  if (!Number.isFinite(comb) || comb <= 0) return null;
  const tipo = String(campo('fuelType1') ?? campo('fuelType') ?? '');
  return {
    id: String(campo('id')), anio: Number(campo('year')), marca: campo('make'), modelo: campo('model'),
    motor: [campo('displ') ? `${campo('displ')} L` : null, campo('cylinders') ? `${campo('cylinders')} cil.` : null, campo('trany')].filter(Boolean).join(', '),
    mpgCombinado: comb, mpgCiudad: Number(campo('city08')) || null, mpgCarretera: Number(campo('highway08')) || null,
    kmPorGalon: mpgAKmPorGalon(comb), kmPorGalonCiudad: Number(campo('city08')) > 0 ? mpgAKmPorGalon(Number(campo('city08'))) : null,
    combustibleEpa: tipo,
    // Propuesta de combustible local; quien registra puede cambiarla (p. ej., gasoil regular u óptimo).
    combustible: /premium/i.test(tipo) ? 'gasolina_premium' : /diesel/i.test(tipo) ? 'gasoil_regular' : /electric/i.test(tipo) ? 'electrico' : /regular|gasoline/i.test(tipo) ? 'gasolina_regular' : null,
    hibrido: /hybrid/i.test(String(campo('atvType') ?? '')),
    fuente: 'FuelEconomy.gov (EPA)',
  };
}

export function createVehiculos({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  async function pedir(ruta) {
    const k = ruta; const c = cache.get(k);
    if (c && now() - c.t < DIA) return c.v;
    let r;
    try { r = await fetchImpl(`${BASE}${ruta}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
    catch { throw Object.assign(new Error('No pudimos consultar FuelEconomy.gov. Escribe el rendimiento a mano o intenta más tarde.'), { status: 503 }); }
    if (!r.ok) throw Object.assign(new Error('FuelEconomy.gov no respondió. Escribe el rendimiento a mano o intenta más tarde.'), { status: 503 });
    const texto = await r.text();
    let v; try { v = JSON.parse(texto); } catch { v = texto; }
    cache.set(k, { t: now(), v });
    return v;
  }
  const q = encodeURIComponent;
  return {
    anios: async () => leerMenu(await pedir('/menu/year')).map((x) => x.valor).filter((a) => Number(a) >= 1990).sort((a, b) => b - a),
    marcas: async (anio) => leerMenu(await pedir(`/menu/make?year=${q(anio)}`)).map((x) => x.texto),
    modelos: async (anio, marca) => leerMenu(await pedir(`/menu/model?year=${q(anio)}&make=${q(marca)}`)).map((x) => x.texto),
    versiones: async (anio, marca, modelo) => leerMenu(await pedir(`/menu/options?year=${q(anio)}&make=${q(marca)}&model=${q(modelo)}`)).map((x) => ({ id: x.valor, texto: x.texto })),
    ficha: async (id) => {
      if (!/^\d{1,8}$/.test(String(id))) throw Object.assign(new Error('Versión no válida.'), { status: 422 });
      const f = leerFicha(await pedir(`/${id}`));
      if (!f) throw Object.assign(new Error('Esa versión no tiene rendimiento publicado. Escríbelo a mano.'), { status: 404 });
      return f;
    },
  };
}

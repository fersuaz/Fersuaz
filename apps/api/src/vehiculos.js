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

/**
 * Versión de la EPA en palabras claras: "Auto 8-spd, 6 cyl, 3.8 L" → "Automática de 8 velocidades, 6 cilindros, motor de 3.8 L".
 * La versión es el motor y la caja de cambios; de ella sale el rendimiento.
 */
export function traducirVersion(texto) {
  const partes = String(texto ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of partes) {
    let m;
    if (/^(auto|man)/i.test(p)) {
      const manual = /^man/i.test(p);
      const vel = p.match(/(\d+)-spd/i)?.[1] ?? p.match(/\((?:[A-Z]+-)?[A-Z]*?(\d+)\)/i)?.[1] ?? null;
      if (/AV|variable gear|CVT/i.test(p)) out.push('Automática CVT (sin cambios fijos)');
      else if (/\bAM/i.test(p)) out.push(`Automática de doble embrague${vel ? ` de ${vel} velocidades` : ''}`);
      else if (/\(A1\)/i.test(p)) out.push('Automática de una velocidad');
      else out.push(`${manual ? 'Manual' : 'Automática'}${vel ? ` de ${vel} velocidades` : ''}`);
    } else if ((m = p.match(/^(\d+)\s*cyl/i))) out.push(`${m[1]} cilindros`);
    else if ((m = p.match(/^(\d+(?:\.\d+)?)\s*L$/i))) out.push(`motor de ${m[1]} L`);
    else if (/^turbo$/i.test(p)) out.push('turbo');
    else if (/^s-?charge|supercharg/i.test(p)) out.push('supercargado');
    else if (/^PHEV$/i.test(p)) out.push('híbrido enchufable');
    else if (/hybrid|^HEV$/i.test(p)) out.push('híbrido');
    else if (/^FFV$/i.test(p)) out.push('acepta etanol');
    else if (/^(4WD|AWD)$/i.test(p)) out.push('tracción en las 4 ruedas');
    else if (/^(2WD|FWD)$/i.test(p)) out.push('tracción delantera');
    else if (/^RWD$/i.test(p)) out.push('tracción trasera');
    // códigos técnicos de la EPA (SIDI, FFS, PZEV, CA model, etc.) no ayudan a elegir: se omiten
  }
  return out.join(', ') || String(texto ?? '');
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
    versiones: async (anio, marca, modelo) => leerMenu(await pedir(`/menu/options?year=${q(anio)}&make=${q(marca)}&model=${q(modelo)}`)).map((x) => ({ id: x.valor, texto: traducirVersion(x.texto), original: x.texto })),
    /**
     * Referencia de km por galón para un vehículo escrito a mano: el mismo modelo en la EPA en el año más
     * cercano (hasta 8 años antes o después). Solo datos oficiales; si no hay, devuelve null.
     */
    referencia: async (marca, modelo, anio) => {
      const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
      const mBuscado = norm(modelo); const a0 = Number(anio);
      if (!mBuscado || !Number.isInteger(a0)) return null;
      const orden = [a0]; for (let d = 1; d <= 8; d++) orden.push(a0 + d, a0 - d);
      const anios = new Set(leerMenu(await pedir('/menu/year')).map((x) => Number(x.valor)));
      for (const a of orden.filter((x) => anios.has(x))) {
        const marcas = leerMenu(await pedir(`/menu/make?year=${a}`)).map((x) => x.texto);
        const mk = marcas.find((x) => norm(x) === norm(marca)); if (!mk) continue;
        const modelos = leerMenu(await pedir(`/menu/model?year=${a}&make=${q(mk)}`)).map((x) => x.texto);
        const exactos = modelos.filter((x) => norm(x) === mBuscado);
        const parecidos = modelos.filter((x) => norm(x).startsWith(mBuscado) && !/electric|ev$|plugin|phev/i.test(x));
        const md = exactos[0] ?? parecidos[0]; if (!md) continue;
        const vers = leerMenu(await pedir(`/menu/options?year=${a}&make=${q(mk)}&model=${q(md)}`)).slice(0, 4);
        const fichas = [];
        for (const v of vers) { const f = leerFicha(await pedir(`/${v.valor}`)); if (f) fichas.push({ version: traducirVersion(v.texto), kmPorGalon: f.kmPorGalon, combustibleEpa: f.combustibleEpa }); }
        if (!fichas.length) continue;
        const kms = fichas.map((f) => f.kmPorGalon).sort((x, y) => x - y);
        return { anio: a, marca: mk, modelo: md, mismoAnio: a === a0, versiones: fichas, minimo: kms[0], maximo: kms.at(-1), fuente: 'FuelEconomy.gov (EPA)' };
      }
      return null;
    },
    ficha: async (id) => {
      if (!/^\d{1,8}$/.test(String(id))) throw Object.assign(new Error('Versión no válida.'), { status: 422 });
      const f = leerFicha(await pedir(`/${id}`));
      if (!f) throw Object.assign(new Error('Esa versión no tiene rendimiento publicado. Escríbelo a mano.'), { status: 404 });
      return f;
    },
  };
}

/** Modelos que no están en la EPA (por ejemplo, de venta solo en Corea o Latinoamérica), guardados para todos. */
export function createVehiculosAgregados({ data, audit }) {
  const limpio = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
  const igual = (a, b) => limpio(a).toLowerCase() === limpio(b).toLowerCase();
  async function listar(anio, marca) {
    const a = Number(anio);
    return (await data.list('vehiculosAgregados')).filter((v) => v.anio === a && (!marca || igual(v.marca, marca)))
      .sort((x, y) => x.modelo.localeCompare(y.modelo, 'es'))
      .map((v) => ({ id: v.id, anio: v.anio, marca: v.marca, modelo: v.modelo, version: v.version ?? null, kmPorGalon: v.kmPorGalon, combustible: v.combustible ?? null }));
  }
  async function agregar(actor, input = {}) {
    const e = {};
    const anio = Number(input.anio); const marca = limpio(input.marca); const modelo = limpio(input.modelo); const version = limpio(input.version) || null;
    const km = Number(String(input.kmPorGalon ?? '').replace(/,/g, ''));
    if (!Number.isInteger(anio) || anio < 1980 || anio > 2100) e.anio = 'Elige el año.';
    if (marca.length < 2) e.marca = 'Escribe la marca.';
    if (modelo.length < 1 || modelo.length > 60) e.modelo = 'Escribe el modelo (por ejemplo, K5).';
    if (!Number.isFinite(km) || km <= 0 || km >= 400) e.kmPorGalon = 'Escribe los kilómetros por galón (por ejemplo, 45).';
    if (Object.keys(e).length) throw Object.assign(new Error('Revisa los campos marcados.'), { status: 422, fields: e });
    const existentes = await data.list('vehiculosAgregados');
    if (existentes.some((v) => v.anio === anio && igual(v.marca, marca) && igual(v.modelo, modelo) && igual(v.version ?? '', version ?? ''))) {
      throw Object.assign(new Error(`${marca} ${modelo} ${anio} ya está agregado.`), { status: 409, fields: { modelo: 'Ese modelo ya está en la lista.' } });
    }
    const combustible = ['gasolina_regular', 'gasolina_premium', 'gasoil_regular', 'gasoil_optimo', 'glp', 'hibrido'].includes(input.combustible) ? input.combustible : null;
    const v = await data.insert('vehiculosAgregados', { anio, marca, modelo, version, kmPorGalon: Math.round(km * 10) / 10, combustible, creadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'vehiculo_agregado', entity: 'vehiculo', entityId: v.id, after: { anio, marca, modelo, version, kmPorGalon: v.kmPorGalon } });
    return { id: v.id, anio, marca, modelo, version, kmPorGalon: Number(v.kmPorGalon), combustible };
  }
  return { listar, agregar };
}

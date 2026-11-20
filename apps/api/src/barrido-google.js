// Registro automático desde Google Maps: recorre los municipios de un municipio, una provincia o todo el país,
// busca un tipo de lugar (farmacias, clínicas, hospitales, UNAP, centros de primer nivel) y guarda los que falten.
// No duplica: compara por id de Google y por nombre dentro del municipio. El avance se guarda en configuración
// (clave google_barrido) para poder verlo desde el panel y continuar si el servidor se reinicia.
import { DIVISION, PROVINCIAS } from './datos/division-territorial.js';
import { ALIAS_MUN } from './territorio.js';

export const PAGINAS_POR_MUNICIPIO = 3; // Google entrega como máximo 60 resultados (3 páginas de 20) por búsqueda
/** 'salud' recorre en una sola pasada hospitales, clínicas, UNAP y centros de primer nivel. */
export const GRUPOS = { salud: ['hospital', 'clinica', 'unap', 'cpn'] };
export const subtipos = (tipo) => GRUPOS[tipo] ?? [tipo];
export const coleccionDe = (tipo) => (tipo === 'farmacia' ? 'farmacias' : tipo === 'hotel' ? 'hoteles' : 'establecimientos');
const CLAVE = 'google_barrido';
const sin = (s) => ` ${String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// Formas en que Google suele escribir cada municipio dentro de la dirección (nombre oficial y alias cortos).
const FORMAS = {};
for (const p of PROVINCIAS) for (const m of DIVISION[p]) (FORMAS[`${p}|${m}`] = [sin(m)]);
for (const [alias, oficial] of Object.entries(ALIAS_MUN)) for (const p of PROVINCIAS) if (DIVISION[p].includes(oficial)) FORMAS[`${p}|${oficial}`].push(sin(alias));

function mejor(direccion, provincias) {
  const d = sin(direccion); let hallado = null; let largo = 0;
  for (const p of provincias) for (const m of DIVISION[p]) for (const f of FORMAS[`${p}|${m}`]) {
    if (f.length > largo && d.includes(f)) { hallado = { provincia: p, municipio: m }; largo = f.length; }
  }
  return hallado;
}

/**
 * Decide a qué municipio pertenece un resultado según su dirección.
 * 1) Si la dirección nombra un municipio de la provincia buscada, ese.
 * 2) Si nombra un municipio de otra provincia, se descarta (Google trajo algo de fuera).
 * 3) Si no nombra ninguno, se queda en el municipio buscado.
 */
export function ubicarResultado(direccion, provincia, municipioBuscado) {
  const propio = mejor(direccion, [provincia]);
  if (propio) return propio.municipio;
  if (mejor(direccion, PROVINCIAS.filter((p) => p !== provincia))) return null;
  return municipioBuscado;
}

/** Lista de [provincia, municipio] a recorrer según el alcance pedido. */
export function municipiosDe({ provincia, municipio }) {
  if (!provincia || provincia === 'todas') return PROVINCIAS.flatMap((p) => DIVISION[p].map((m) => [p, m]));
  if (!DIVISION[provincia]) return [];
  if (municipio) return DIVISION[provincia].includes(municipio) ? [[provincia, municipio]] : [];
  return DIVISION[provincia].map((m) => [provincia, m]);
}

export function createBarrido({ data, lugares, guardar, notificar = async () => {}, audit = async () => {}, now = () => new Date(), pausa = 250 }) {
  let enCurso = null; // promesa del recorrido activo en este servidor

  async function leer() { const [c] = await data.list('configuracion', { clave: CLAVE }); return c ?? null; }
  async function escribir(valor) {
    const c = await leer();
    if (c) await data.update('configuracion', c.id, { valor }); else await data.insert('configuracion', { clave: CLAVE, valor });
    return valor;
  }

  async function estado() {
    const c = await leer(); const v = c?.valor ?? null;
    if (v?.estado === 'en_curso' && !enCurso) return { ...v, estado: 'interrumpido' }; // el servidor se reinició a mitad
    return v;
  }

  function estimar(alcance) {
    const lista = municipiosDe(alcance);
    return { municipios: lista.length, tipos: subtipos(alcance.tipo).length, consultasMaximas: lista.length * subtipos(alcance.tipo).length * PAGINAS_POR_MUNICIPIO };
  }

  async function iniciar(actor, { tipo, provincia, municipio, continuar = false }) {
    if (enCurso) throw Object.assign(new Error('Ya hay un registro automático en marcha. Espera a que termine.'), { status: 409 });
    const lista = municipiosDe({ provincia, municipio });
    if (!lista.length) throw Object.assign(new Error('Elige una provincia o municipio oficial.'), { status: 422 });
    const previo = await estado();
    const hechos = new Set(continuar && previo && previo.tipo === tipo && previo.alcance?.provincia === (provincia || 'todas') && previo.alcance?.municipio === (municipio || null) ? previo.hechos ?? [] : []);
    const base = continuar && hechos.size ? previo : { agregados: 0, existentes: 0, descartados: 0, errores: 0, consultas: 0, mensajes: [] };
    const informe = {
      estado: 'en_curso', tipo, alcance: { provincia: provincia || 'todas', municipio: municipio || null }, iniciadoPor: actor.id,
      iniciado: now().toISOString(), terminado: null, total: lista.length, hechos: [...hechos], actual: null,
      agregados: base.agregados, existentes: base.existentes, descartados: base.descartados, errores: base.errores, consultas: base.consultas, mensajes: base.mensajes ?? [],
    };
    await escribir(informe);
    await audit({ actorId: actor.id, action: 'barrido_google_iniciado', entity: 'configuracion', entityId: CLAVE, after: { tipo, alcance: informe.alcance } });
    enCurso = recorrer(actor, lista, informe).finally(() => { enCurso = null; });
    return informe;
  }

  async function recorrer(actor, lista, informe) {
    const vistos = {}; // por colección: ids de Google y nombre+municipio ya registrados
    for (const t of subtipos(informe.tipo)) {
      const col = coleccionDe(t);
      if (vistos[col]) continue;
      const todos = await data.list(col);
      vistos[col] = { ids: new Set(todos.map((x) => x.placeId).filter(Boolean)), nombres: new Set(todos.map((x) => `${x.municipio}|${sin(x.nombre)}`)) };
    }
    let ultimoGuardado = Date.now();
    try {
      for (const [provincia, municipio] of lista) {
        const k = `${provincia}|${municipio}`;
        if (informe.hechos.includes(k)) continue;
        informe.actual = `${municipio}, ${provincia}`;
        for (const tipo of subtipos(informe.tipo)) {
        const { ids, nombres } = vistos[coleccionDe(tipo)];
        let token = null; let paginas = 0;
        do {
          let r;
          try { r = await lugares.pagina({ tipo, municipio, provincia }, token); }
          catch (err) {
            informe.errores++; informe.mensajes = [...informe.mensajes, `${municipio}: ${err.message}`].slice(-5);
            if (/clave|límite/i.test(err.message)) throw err; // sin clave o sin cuota no tiene sentido seguir
            break;
          }
          informe.consultas++; paginas++; token = r.siguiente;
          for (const lugar of r.items) {
            if (ids.has(lugar.placeId)) { informe.existentes++; continue; }
            const mun = ubicarResultado(lugar.direccion, provincia, municipio);
            if (!mun) { informe.descartados++; continue; }
            if (nombres.has(`${mun}|${sin(lugar.nombre)}`)) { informe.existentes++; ids.add(lugar.placeId); continue; }
            try {
              await guardar(actor, tipo, { ...lugar, provincia, municipio: mun });
              informe.agregados++;
            } catch (err) {
              if (err.status === 409) informe.existentes++;
              else { informe.errores++; informe.mensajes = [...informe.mensajes, `${lugar.nombre}: ${err.message}`].slice(-5); }
            }
            ids.add(lugar.placeId); nombres.add(`${mun}|${sin(lugar.nombre)}`);
          }
          if (token && pausa) await new Promise((ok) => setTimeout(ok, pausa * 8)); // Google pide una breve espera antes de usar el token
        } while (token && paginas < PAGINAS_POR_MUNICIPIO);
        }
        informe.hechos.push(k);
        if (Date.now() - ultimoGuardado > 2000) { await escribir(informe); ultimoGuardado = Date.now(); }
        if (pausa) await new Promise((ok) => setTimeout(ok, pausa));
      }
      informe.estado = 'terminado';
    } catch (err) {
      informe.estado = 'error'; informe.mensajes = [...informe.mensajes, err.message].slice(-5);
    }
    informe.actual = null; informe.terminado = now().toISOString();
    await escribir(informe);
    await audit({ actorId: actor.id, action: 'barrido_google_terminado', entity: 'configuracion', entityId: CLAVE, after: { estado: informe.estado, agregados: informe.agregados, consultas: informe.consultas } });
    const zona = informe.alcance.municipio ?? (informe.alcance.provincia === 'todas' ? 'todo el país' : informe.alcance.provincia);
    await notificar(actor.id, {
      tipo: 'territorio', enlace: { farmacia: '#catalogo?ver=farmacias', hotel: '#hoteles' }[informe.tipo] ?? '#establecimientos',
      titulo: informe.estado === 'terminado' ? 'Registro automático terminado' : 'El registro automático se detuvo',
      texto: `${zona}: ${informe.agregados} nuevos, ${informe.existentes} ya registrados${informe.errores ? `, ${informe.errores} con error` : ''}.`,
    }).catch(() => {});
    return informe;
  }

  return { estado, estimar, iniciar, esperar: () => enCurso };
}

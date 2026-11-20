// Territorio: provincias y municipios oficiales, establecimientos de salud, zonas de cada representante,
// pre-registro de representantes e importación por Excel. Toda regla de permiso vive aquí, en el servidor.
import { AuthError as HttpError } from './auth.js';
import { STATUS, POSITIONS } from './roles.js';
import { DIVISION, PROVINCIAS } from './datos/division-territorial.js';
import { leerHoja } from './hojas.js';
import { esFechaISO, hoyRD } from './periodos.js';
import { normalizeName } from './validation.js';

export const TIPOS_ESTABLECIMIENTO = {
  clinica: 'Clínica', hospital: 'Hospital', unap: 'UNAP', cpn: 'Centro de primer nivel', diagnostico: 'Centro diagnóstico', consultorio: 'Consultorio',
};
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Nombres comunes → nombre oficial
const ALIAS_PROV = { montecristi: 'Monte Cristi', dn: 'Distrito Nacional', 'd n': 'Distrito Nacional', 'distrito': 'Distrito Nacional', salcedo: 'Hermanas Mirabal', baoruco: 'Bahoruco', 'santiago de los caballeros': 'Santiago', 'samana': 'Samaná' };
export const ALIAS_MUN = {
  santiago: 'Santiago de los Caballeros', 'la vega': 'Concepción de La Vega', higuey: 'Salvaleón de Higüey', 'puerto plata': 'San Felipe de Puerto Plata',
  barahona: 'Santa Cruz de Barahona', 'el seibo': 'Santa Cruz de El Seibo', 'monte cristi': 'San Fernando de Monte Cristi', montecristi: 'San Fernando de Monte Cristi',
  samana: 'Santa Bárbara de Samaná', sabaneta: 'San Ignacio de Sabaneta', azua: 'Azua de Compostela', 'san juan': 'San Juan de la Maguana',
  'hato mayor': 'Hato Mayor del Rey', 'santo domingo': 'Santo Domingo de Guzmán', 'distrito nacional': 'Santo Domingo de Guzmán', 'san francisco': 'San Francisco de Macorís',
};
const PROV_POR_CLAVE = Object.fromEntries(PROVINCIAS.map((p) => [sinAcentos(p), p]));

/** Devuelve el nombre oficial de la provincia o null. */
export function provinciaOficial(v) {
  const k = sinAcentos(v); if (!k) return null;
  return PROV_POR_CLAVE[k] ?? (ALIAS_PROV[k] && PROV_POR_CLAVE[sinAcentos(ALIAS_PROV[k])]) ?? null;
}
/** Devuelve el nombre oficial del municipio dentro de la provincia, o null. */
export function municipioOficial(provincia, v) {
  const lista = DIVISION[provincia]; const k = sinAcentos(v);
  if (!lista || !k) return null;
  const directo = lista.find((m) => sinAcentos(m) === k);
  if (directo) return directo;
  const alias = ALIAS_MUN[k];
  return alias && lista.includes(alias) ? alias : null;
}
export function tipoEstablecimiento(v) {
  const k = sinAcentos(v);
  if (TIPOS_ESTABLECIMIENTO[k]) return k;
  const e = Object.entries(TIPOS_ESTABLECIMIENTO).find(([, l]) => sinAcentos(l) === k);
  if (e) return e[0];
  if (/primer nivel|cpn/.test(k)) return 'cpn';
  if (/diagnost/.test(k)) return 'diagnostico';
  return null;
}
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const esEjemplo = (fila) => Object.values(fila).some((v) => typeof v === 'string' && /^ejemplo\b/i.test(v.trim()));
function numero(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).replace(/RD\$|\$|\s/gi, '');
  const n = Number(/,\d{1,2}$/.test(s) && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
function fechaDe(v) {
  const s = String(v ?? '').trim(); if (!s) return null;
  if (esFechaISO(s)) return s;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().slice(0, 10); }
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return esFechaISO(iso) ? iso : undefined; }
  return undefined;
}

export function createTerritorio({ data, users, audit, now = () => new Date() }) {
  const activo = (u) => u && u.status === STATUS.ACTIVO;
  const rol = (u, roles) => activo(u) && roles.includes(u.role);
  const esRep = (u) => activo(u) && u.role === 'representante';
  function permitir(cond, msg = 'No tienes permiso para esta acción.') { if (!cond) throw new HttpError(403, msg); }
  function invalido(fields) { throw new HttpError(422, 'Revisa los campos marcados.', fields); }
  const GESTION = ['administrador', 'gerencia', 'supervisor'];

  // ------------------------------------------------------------ zonas
  async function zonaDe(repId) { return (await data.list('zonas', { representanteId: repId }))[0] ?? null; }
  async function provinciasDe(actor) {
    if (rol(actor, ['administrador', 'gerencia', 'supervisor', 'finanzas'])) return PROVINCIAS;
    if (esRep(actor)) return (await zonaDe(actor.id))?.provincias ?? [];
    return [];
  }
  async function asignarZona(actor, repId, provincias) {
    permitir(rol(actor, GESTION));
    const rep = await users.findUserById(repId);
    if (!rep || rep.role !== 'representante') throw new HttpError(404, 'El representante no existe.');
    const lista = [...new Set((Array.isArray(provincias) ? provincias : []).map(provinciaOficial))];
    if (lista.includes(null)) invalido({ provincias: 'Hay provincias que no son oficiales.' });
    const antes = await zonaDe(repId);
    const z = antes ? await data.update('zonas', antes.id, { provincias: lista, actualizadoPor: actor.id })
      : await data.insert('zonas', { representanteId: repId, provincias: lista, actualizadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'zona_asignada', entity: 'user', entityId: repId, before: antes?.provincias ?? null, after: lista });
    return z;
  }
  async function verZona(actor, repId) {
    permitir(actor.id === repId || rol(actor, [...GESTION, 'finanzas']));
    return { representanteId: repId, provincias: (await zonaDe(repId))?.provincias ?? [] };
  }

  // ------------------------------------------------------------ establecimientos
  function validarEst(input, e, { tipoLibre = false } = {}) {
    const tipo = tipoLibre ? 'farmacia' : tipoEstablecimiento(input.tipo);
    if (!tipo) e.tipo = 'Elige el tipo: clínica, hospital, UNAP, centro de primer nivel, centro diagnóstico o consultorio.';
    const nombre = normalizeName(input.nombre);
    if (!nombre || nombre.length < 2) e.nombre = 'Escribe el nombre.';
    else if (nombre.length > 160) e.nombre = 'El nombre es demasiado largo.';
    const provincia = provinciaOficial(input.provincia);
    if (!provincia) e.provincia = 'Elige una provincia oficial.';
    const municipio = provincia && municipioOficial(provincia, input.municipio);
    if (provincia && !municipio) e.municipio = `Ese municipio no pertenece a ${provincia}.`;
    const corto = (v, n) => { const s = normalizeName(v); return s ? s.slice(0, n) : null; };
    const lat = input.lat == null || input.lat === '' ? null : Number(input.lat);
    const lng = input.lng == null || input.lng === '' ? null : Number(input.lng);
    if (lat != null && !(lat > 17 && lat < 20.5)) e.lat = 'Ubicación fuera de República Dominicana.';
    if (lng != null && !(lng > -72.2 && lng < -68)) e.lng = 'Ubicación fuera de República Dominicana.';
    return { tipo, nombre, provincia, municipio, sector: corto(input.sector, 80), direccion: corto(input.direccion, 200), telefono: corto(input.telefono, 30), lat, lng, placeId: input.placeId ? String(input.placeId).slice(0, 200) : null };
  }
  const claveLugar = (x) => `${sinAcentos(x.nombre)}|${sinAcentos(x.municipio)}`;

  async function crearEstablecimiento(actor, input, { fuente = 'manual', verificado = false } = {}) {
    if (!verificado) input = { ...input, lat: null, lng: null, placeId: null };
    const zona = await provinciasDe(actor);
    permitir(rol(actor, GESTION) || esRep(actor), 'No puedes registrar establecimientos.');
    const e = {}; const d = validarEst(input, e);
    if (Object.keys(e).length) invalido(e);
    permitir(zona.includes(d.provincia), 'Esa provincia no está asignada a tu zona.');
    const existentes = await data.list('establecimientos', { municipio: d.municipio });
    const dup = existentes.find((x) => claveLugar(x) === claveLugar(d) || (d.placeId && x.placeId === d.placeId));
    if (dup) throw new HttpError(409, `${dup.nombre} ya está registrado en ${dup.municipio}.`, { nombre: 'Ya existe en este municipio.' });
    const estado = rol(actor, GESTION) ? 'validado' : 'pendiente';
    const x = await data.insert('establecimientos', { ...d, fuente, estado, creadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'establecimiento_creado', entity: 'establecimiento', entityId: x.id, after: { nombre: x.nombre, municipio: x.municipio, fuente } });
    return x;
  }
  async function listarEstablecimientos(actor, { provincia, municipio, tipo, q } = {}) {
    permitir(activo(actor));
    const zona = await provinciasDe(actor);
    const filtro = {};
    if (municipio) filtro.municipio = municipio;
    let xs = await data.list('establecimientos', filtro);
    xs = xs.filter((x) => zona.includes(x.provincia) && (!provincia || x.provincia === provincia) && (!tipo || x.tipo === tipo) && x.estado !== 'inactivo');
    if (q) { const k = sinAcentos(q); xs = xs.filter((x) => sinAcentos(`${x.nombre} ${x.sector ?? ''} ${x.direccion ?? ''}`).includes(k)); }
    return xs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function validarEstablecimiento(actor, id) {
    permitir(rol(actor, ['administrador', 'gerencia', 'supervisor']));
    const x = await data.get('establecimientos', id);
    if (!x) throw new HttpError(404, 'El establecimiento no existe.');
    const out = await data.update('establecimientos', id, { estado: 'validado' });
    await audit({ actorId: actor.id, action: 'establecimiento_validado', entity: 'establecimiento', entityId: id });
    return out;
  }

  // ------------------------------------------------------------ pre-registro de representantes
  async function preregistroPara(email) {
    const e = String(email ?? '').trim().toLowerCase();
    return (await data.list('preregistros', { email: e })).find((p) => p.estado === 'pendiente') ?? null;
  }
  /** Registro, paso 1: si el correo está pre-registrado como representante, devuelve su cargo (la cuenta nace activa). */
  async function buscarPreregistro(email, role) {
    if (role !== 'representante') return null;
    return preregistroPara(email);
  }
  /** Registro, paso 2: marca el pre-registro como usado y asigna sus provincias. */
  async function confirmarPreregistro(user, p) {
    await data.update('preregistros', p.id, { estado: 'usado', usuarioId: user.id });
    if (p.provincias?.length && !(await zonaDe(user.id))) await data.insert('zonas', { representanteId: user.id, provincias: p.provincias, actualizadoPor: p.creadoPor });
    await audit({ actorId: p.creadoPor, action: 'preregistro_aplicado', entity: 'user', entityId: user.id, after: { posicion: p.posicion, provincias: p.provincias } });
  }
  async function listarPreregistros(actor) {
    permitir(rol(actor, GESTION));
    return (await data.list('preregistros')).filter((p) => p.estado !== 'anulado').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  async function anularPreregistro(actor, id) {
    permitir(rol(actor, GESTION));
    const p = await data.get('preregistros', id);
    if (!p) throw new HttpError(404, 'El pre-registro no existe.');
    if (p.estado !== 'pendiente') throw new HttpError(409, 'Ese pre-registro ya se usó.');
    await audit({ actorId: actor.id, action: 'preregistro_anulado', entity: 'preregistro', entityId: id, before: { email: p.email } });
    return data.update('preregistros', id, { estado: 'anulado' });
  }

  // ------------------------------------------------------------ importación por Excel
  const IMPORTADORES = {
    medicamentos: {
      roles: ['administrador', 'gerencia'],
      columnas: ['nombre', 'presentacion', 'precio rd'],
      async preparar() {
        const ms = await data.list('medicamentos');
        return { porClave: new Map(ms.map((m) => [`${sinAcentos(m.nombre)}|${sinAcentos(m.presentacion ?? '')}`, m])) };
      },
      fila(f, ctx, vistos) {
        const e = [];
        const nombre = normalizeName(f.nombre); if (!nombre) e.push('Falta el nombre.');
        const presentacion = normalizeName(f.presentacion) || null;
        const precio = numero(f['precio rd'] ?? f.precio);
        if (precio == null) e.push('Falta el precio.'); else if (!(precio > 0) || precio > 1e7) e.push('El precio debe ser un número mayor que cero.');
        const vigente = fechaDe(f['vigente desde']);
        if (vigente === undefined) e.push('La fecha "Vigente desde" debe ser AAAA-MM-DD.');
        const k = `${sinAcentos(nombre)}|${sinAcentos(presentacion ?? '')}`;
        if (vistos.has(k)) e.push(`Repetido en la fila ${vistos.get(k)}.`); else vistos.set(k, f._fila);
        const actual = ctx.porClave.get(k);
        const accion = !actual ? 'crear' : r2(actual.precio ?? 0) === r2(precio) ? 'sin cambio' : 'actualizar precio';
        return { e, d: { nombre, linea: normalizeName(f.linea) || null, presentacion, precio: r2(precio), vigenteDesde: vigente || hoyRD(now()) }, accion, actual };
      },
      async guardar(actor, { d, accion, actual }) {
        if (accion === 'crear') {
          const m = await data.insert('medicamentos', { nombre: d.nombre, linea: d.linea, presentacion: d.presentacion, precio: d.precio, activo: true });
          await data.insert('preciosMedicamento', { medicamentoId: m.id, precio: d.precio, vigenteDesde: d.vigenteDesde, fuente: 'excel', registradoPor: actor.id });
        } else if (accion === 'actualizar precio') {
          await data.update('medicamentos', actual.id, { precio: d.precio, ...(d.linea && !actual.linea ? { linea: d.linea } : {}) });
          await data.insert('preciosMedicamento', { medicamentoId: actual.id, precio: d.precio, vigenteDesde: d.vigenteDesde, fuente: 'excel', registradoPor: actor.id });
        }
      },
    },
    farmacias: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['nombre', 'provincia', 'municipio'],
      async preparar() { return { claves: new Set((await data.list('farmacias')).map(claveLugar)) }; },
      fila(f, ctx, vistos) {
        const err = {}; const d = validarEst(f, err, { tipoLibre: true });
        const e = Object.values(err);
        const k = d.municipio ? claveLugar(d) : null;
        if (k && vistos.has(k)) e.push(`Repetida en la fila ${vistos.get(k)}.`); else if (k) vistos.set(k, f._fila);
        return { e, d, accion: k && ctx.claves.has(k) ? 'ya existe' : 'crear' };
      },
      async guardar(actor, { d, accion }) {
        if (accion !== 'crear') return;
        await data.insert('farmacias', { nombre: d.nombre, provincia: d.provincia, municipio: d.municipio, sector: d.sector, direccion: d.direccion, telefono: d.telefono, fuente: 'excel', estado: 'validada', creadoPor: actor.id });
      },
    },
    establecimientos: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['tipo', 'nombre', 'provincia', 'municipio'],
      async preparar() { return { claves: new Set((await data.list('establecimientos')).map(claveLugar)) }; },
      fila(f, ctx, vistos) {
        const err = {}; const d = validarEst(f, err);
        const e = Object.values(err);
        const k = d.municipio ? claveLugar(d) : null;
        if (k && vistos.has(k)) e.push(`Repetido en la fila ${vistos.get(k)}.`); else if (k) vistos.set(k, f._fila);
        return { e, d, accion: k && ctx.claves.has(k) ? 'ya existe' : 'crear' };
      },
      async guardar(actor, { d, accion }) {
        if (accion !== 'crear') return;
        await data.insert('establecimientos', { ...d, fuente: 'excel', estado: 'validado', creadoPor: actor.id });
      },
    },
    representantes: {
      roles: ['administrador', 'gerencia', 'supervisor'],
      columnas: ['nombre completo', 'correo', 'cargo'],
      async preparar() {
        const pre = await data.list('preregistros');
        return { pendientes: new Map(pre.filter((p) => p.estado === 'pendiente').map((p) => [p.email, p])), cuentas: new Set((await users.listUsers()).map((u) => u.email)) };
      },
      fila(f, ctx, vistos) {
        const e = [];
        const nombre = normalizeName(f['nombre completo'] ?? f.nombre); if (!nombre || nombre.split(' ').length < 2) e.push('Escribe nombre y apellido.');
        const email = String(f.correo ?? '').trim().toLowerCase(); if (!CORREO.test(email)) e.push('El correo no es válido.');
        const posicion = POSITIONS.find((p) => sinAcentos(p) === sinAcentos(f.cargo)) ?? (sinAcentos(f.cargo) === 'promotor' ? 'Promotora' : null);
        if (!posicion) e.push(`Cargo inválido. Usa: ${POSITIONS.join(', ')}.`);
        const crudas = String(f.provincias ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
        const provincias = [...new Set(crudas.map(provinciaOficial))];
        const malas = crudas.filter((s) => !provinciaOficial(s));
        if (malas.length) e.push(`Provincias no reconocidas: ${malas.join(', ')}.`);
        if (email && vistos.has(email)) e.push(`Correo repetido en la fila ${vistos.get(email)}.`); else if (email) vistos.set(email, f._fila);
        const accion = ctx.cuentas.has(email) ? 'ya tiene cuenta' : ctx.pendientes.has(email) ? 'actualizar' : 'pre-registrar';
        return { e, d: { nombre, email, telefono: normalizeName(f.telefono) || null, posicion, provincias: provincias.filter(Boolean) }, accion, actual: ctx.pendientes.get(email) };
      },
      async guardar(actor, { d, accion, actual }) {
        if (accion === 'pre-registrar') await data.insert('preregistros', { ...d, estado: 'pendiente', creadoPor: actor.id });
        else if (accion === 'actualizar') await data.update('preregistros', actual.id, { nombre: d.nombre, telefono: d.telefono, posicion: d.posicion, provincias: d.provincias });
      },
    },
  };

  /**
   * Importa un archivo. Sin `confirmar` devuelve la vista previa (nada se guarda).
   * Con `confirmar` guarda solo si no hay filas con errores (todo o nada).
   */
  async function importar(actor, tipo, { archivo, nombre, confirmar = false } = {}) {
    const imp = IMPORTADORES[tipo];
    if (!imp) throw new HttpError(404, 'Tipo de importación desconocido.');
    permitir(rol(actor, imp.roles));
    let buf;
    try { buf = Buffer.from(String(archivo ?? ''), 'base64'); } catch { buf = Buffer.alloc(0); }
    if (!buf.length) invalido({ archivo: 'Elige un archivo .xlsx o .csv.' });
    if (buf.length > 8 * 1024 * 1024) invalido({ archivo: 'El archivo no puede pasar de 8 MB.' });
    let hoja;
    try { hoja = leerHoja(buf, nombre); } catch (err) { invalido({ archivo: err.message }); }
    const faltan = imp.columnas.filter((c) => !hoja.columnas.includes(c));
    if (faltan.length) invalido({ archivo: `Faltan columnas: ${faltan.join(', ')}. Usa la plantilla.` });
    const ctx = await imp.preparar();
    const vistos = new Map();
    const filas = hoja.filas.filter((f) => !esEjemplo(f)).map((f) => ({ fila: f._fila, ...imp.fila(f, ctx, vistos) }));
    const errores = filas.filter((f) => f.e.length).map((f) => ({ fila: f.fila, errores: f.e }));
    const resumen = {};
    for (const f of filas) if (!f.e.length) resumen[f.accion] = (resumen[f.accion] ?? 0) + 1;
    const vista = filas.slice(0, 200).map((f) => ({ fila: f.fila, accion: f.e.length ? 'error' : f.accion, datos: f.d, errores: f.e }));
    if (!confirmar) return { tipo, total: filas.length, resumen, errores, vista, guardado: false };
    if (!filas.length) invalido({ archivo: 'El archivo no tiene filas para importar.' });
    if (errores.length) throw new HttpError(422, `Hay ${errores.length} fila(s) con errores. Corrígelas y vuelve a subir el archivo.`, { archivo: 'Hay filas con errores.' });
    for (const f of filas) await imp.guardar(actor, f);
    await audit({ actorId: actor.id, action: 'importacion', entity: tipo, entityId: nombre ?? tipo, after: { archivo: nombre ?? null, resumen } });
    return { tipo, total: filas.length, resumen, errores: [], guardado: true };
  }

  async function historialPrecio(actor, medicamentoId) {
    permitir(activo(actor));
    return (await data.list('preciosMedicamento', { medicamentoId })).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  }

  return {
    division: () => ({ provincias: PROVINCIAS, municipios: DIVISION, tipos: TIPOS_ESTABLECIMIENTO }),
    provinciasDe, asignarZona, verZona,
    crearEstablecimiento, listarEstablecimientos, validarEstablecimiento,
    buscarPreregistro, confirmarPreregistro, listarPreregistros, anularPreregistro,
    importar, historialPrecio,
  };
}

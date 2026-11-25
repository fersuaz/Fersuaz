// Registro de médicos: a mano, desde un documento (plantilla de Excel, o PDF/foto leído con IA)
// y automático desde Google Maps. Cada médico queda ligado, si se sabe, al establecimiento donde labora:
// la provincia y el municipio salen de ahí. No se duplica: se compara por id de Google, teléfono y
// nombre dentro del municipio; si ya existe, solo se completan los datos que le faltan.
import { AuthError as HttpError } from './auth.js';
import { normalizeName } from './validation.js';
import { telefonoRD } from './comercial.js';
import { provinciaOficial, municipioOficial } from './territorio.js';
import { leerHoja } from './hojas.js';
import { emparejar } from './ventas.js';

export const ESPECIALIDADES = Object.freeze([
  'Medicina general', 'Medicina familiar', 'Medicina interna', 'Pediatría', 'Ginecología y obstetricia', 'Cardiología', 'Neumología',
  'Gastroenterología', 'Endocrinología', 'Neurología', 'Psiquiatría', 'Dermatología', 'Otorrinolaringología', 'Oftalmología',
  'Urología', 'Nefrología', 'Ortopedia y traumatología', 'Reumatología', 'Alergología e inmunología', 'Infectología',
  'Geriatría', 'Cirugía general', 'Oncología', 'Hematología', 'Odontología', 'Fisiatría',
]);
/** Palabra en el nombre de Google o del documento → especialidad. */
const PISTAS = [
  [/pediatr/i, 'Pediatría'], [/ginec|obstet/i, 'Ginecología y obstetricia'], [/cardi[oó]/i, 'Cardiología'], [/neum[oó]|pulmon/i, 'Neumología'],
  [/gastro/i, 'Gastroenterología'], [/endocrin|diabet/i, 'Endocrinología'], [/neur[oó]l/i, 'Neurología'], [/psiquiatr/i, 'Psiquiatría'],
  [/dermat/i, 'Dermatología'], [/otorrino|\borl\b/i, 'Otorrinolaringología'], [/oftalm/i, 'Oftalmología'], [/urol[oó]/i, 'Urología'],
  [/nefr[oó]/i, 'Nefrología'], [/ortoped|traumat/i, 'Ortopedia y traumatología'], [/reumat/i, 'Reumatología'], [/alerg/i, 'Alergología e inmunología'],
  [/infect/i, 'Infectología'], [/geriatr/i, 'Geriatría'], [/onc[oó]l/i, 'Oncología'], [/hemat[oó]l/i, 'Hematología'], [/odont|dentist/i, 'Odontología'],
  [/internist|medicina interna/i, 'Medicina interna'], [/familiar/i, 'Medicina familiar'], [/cirujan|cirug/i, 'Cirugía general'], [/fisiatr/i, 'Fisiatría'],
  [/medicina general|m[eé]dico general/i, 'Medicina general'],
];
export const POR_CONFIRMAR = 'Por confirmar';
const NO_PERSONA = /\b(cl[ií]nica|centro|hospital|farmacia|laboratorio|policl[ií]nica|unap|instituto|grupo|consultorios|servicios|s\.?r\.?l|cdd|diagn[oó]stic|emergencia|ambulancia|seguro|ars)\b/i;

export function especialidadDe(texto) {
  const t = String(texto ?? '');
  const exacta = ESPECIALIDADES.find((e) => e.toLowerCase() === t.trim().toLowerCase());
  if (exacta) return exacta;
  return PISTAS.find(([re]) => re.test(t))?.[1] ?? null;
}
/** "Dra. Ana Pérez - Pediatra" → { nombre: 'Ana Pérez', especialidad: 'Pediatría' }. */
export function limpiarNombre(crudo) {
  const t = String(crudo ?? '').replace(/\s+/g, ' ').trim();
  const [parte, ...resto] = t.split(/\s*[,|]\s|\s[-–]\s|\s\(/);
  const nombre = normalizeName(parte.replace(/^(dr|dra|doctor|doctora|lic|licda)\.?\s+/i, '').replace(/\)$/, ''));
  return { nombre, especialidad: especialidadDe(t) ?? (resto.length ? especialidadDe(resto.join(' ')) : null) };
}
/** En Google, "médicos" trae también clínicas y centros: solo se queda lo que parece una persona. */
export function pareceMedico(nombre) {
  const t = String(nombre ?? '');
  if (NO_PERSONA.test(t)) return false;
  return /^(dr|dra|doctor|doctora)\.?\s/i.test(t) || Boolean(especialidadDe(t)) || /\b(md|m\.d\.)\b/i.test(t);
}
/** Redes en forma de enlace. Acepta "@usuario", "instagram.com/usuario" o el enlace completo. */
export function redesDe({ instagram, facebook, web } = {}) {
  const out = {};
  const limpio = (v) => String(v ?? '').trim();
  const usuario = (v) => limpio(v).replace(/^@/, '').replace(/^https?:\/\/(www\.)?/i, '').replace(/^(instagram\.com|facebook\.com|fb\.com)\//i, '').replace(/[/?#].*$/, '');
  for (const [k, v] of [['instagram', instagram], ['facebook', facebook], ['web', web]]) {
    const t = limpio(v); if (!t) continue;
    if (k === 'web') {
      if (/instagram\.com/i.test(t)) out.instagram ??= `https://instagram.com/${usuario(t)}`;
      else if (/facebook\.com|fb\.com/i.test(t)) out.facebook ??= `https://facebook.com/${usuario(t)}`;
      else if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t)) out.web = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      continue;
    }
    const u = usuario(t);
    if (/^[\w.]{2,60}$/.test(u)) out[k] = `https://${k === 'instagram' ? 'instagram.com' : 'facebook.com'}/${u}`;
  }
  return out;
}
const sinTilde = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const distanciaM = (a, b) => {
  const R = 6371000; const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat); const dLng = r(b.lng - a.lng);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2));
};

export function createMedicos({ data, audit, lector, users }) {
  const activo = (u) => u?.status === 'activo';
  const GESTION = ['administrador', 'gerencia'];
  const permitir = (ok, msg = 'No tienes permiso para esto.') => { if (!ok) throw new HttpError(403, msg); };
  const invalido = (f) => { throw new HttpError(422, 'Revisa los campos marcados.', f); };
  // Las dependientes y todos los representantes también registran: así el médico de un voucher o una receta
// se agrega una vez y después solo se elige.
  const puedeRegistrar = (u) => activo(u) && (GESTION.includes(u.role) || ['supervisor', 'representante', 'dependiente', 'medico'].includes(u.role));
  /** Provincia y municipio cuando no se dicen: los de la farmacia de la dependiente o los del operativo. */
  async function ubicacionPorDefecto(actor, input) {
    if (input.operativoId) {
      const o = await data.get('operativos', String(input.operativoId));
      if (o && (o.promotoraId === actor.id || GESTION.includes(actor.role) || actor.role === 'supervisor')) return { provincia: o.provincia, municipio: o.municipio };
    }
    const depId = actor.role === 'dependiente' ? actor.id : input.dependienteId ? String(input.dependienteId) : null;
    if (depId && users) {
      const d = actor.id === depId ? actor : await users.findUserById(depId);
      const f = d?.farmaciaId ? await data.get('farmacias', d.farmaciaId) : null;
      if (f) return { provincia: f.provincia, municipio: f.municipio };
    }
    return null;
  }

  /** Establecimiento donde labora: por id, o por cercanía (≤ 150 m) / nombre en la dirección cuando viene de Google. */
  function centroDe(establecimientos, { establecimientoId, lat, lng, direccion, municipio, nombreCentro }) {
    if (establecimientoId) return establecimientos.find((x) => x.id === establecimientoId) ?? null;
    const delMun = establecimientos.filter((x) => !municipio || x.municipio === municipio);
    if (lat != null && lng != null) {
      const cerca = delMun.filter((x) => x.lat != null && x.lng != null).map((x) => ({ x, d: distanciaM({ lat, lng }, { lat: Number(x.lat), lng: Number(x.lng) }) })).filter((y) => y.d <= 150).sort((a, b) => a.d - b.d)[0];
      if (cerca) return cerca.x;
    }
    const dir = sinTilde(direccion);
    if (dir) { const x = delMun.find((e) => e.nombre.length > 5 && dir.includes(sinTilde(e.nombre))); if (x) return x; }
    if (nombreCentro) return emparejar(nombreCentro, delMun.length ? delMun : establecimientos, (e) => e.nombre).elegido;
    return null;
  }

  /**
   * Registra o completa un médico. Devuelve { item, accion: 'creado' | 'completado' | 'existente' }.
   * `fuente`: manual, google, documento, ia o receta.
   */
  async function registrar(actor, input = {}, { fuente = 'manual', google = null, establecimientos: ests } = {}) {
    permitir(puedeRegistrar(actor), 'No tienes permiso para registrar médicos.');
    const e = {};
    if (!input.provincia && !input.establecimientoId && !google) {
      const u = await ubicacionPorDefecto(actor, input);
      if (u) input = { ...input, ...u };
    }
    if (input.apellido) input = { ...input, nombre: `${normalizeName(input.nombre)} ${normalizeName(input.apellido)}` };
    const establecimientos = ests ?? await data.list('establecimientos');
    const limpio = limpiarNombre(input.nombre ?? google?.nombre);
    const nombre = limpio.nombre;
    if (!nombre || nombre.length < 3) e.nombre = 'Escribe el nombre del médico.';
    let especialidad = normalizeName(input.especialidad) ? especialidadDe(input.especialidad) ?? normalizeName(input.especialidad) : limpio.especialidad;
    if (!especialidad) { if (fuente === 'manual') e.especialidad = 'Elige la especialidad.'; else especialidad = POR_CONFIRMAR; }
    const est = centroDe(establecimientos, { establecimientoId: input.establecimientoId ? String(input.establecimientoId) : null, lat: google?.lat, lng: google?.lng, direccion: google?.direccion, municipio: input.municipio, nombreCentro: input.centro });
    if (input.establecimientoId && !est) e.establecimientoId = 'Ese establecimiento no existe.';
    const provincia = est?.provincia ?? provinciaOficial(input.provincia);
    const municipio = est?.municipio ?? (provincia ? municipioOficial(provincia, input.municipio) : null);
    if (!provincia) e.provincia = 'Elige el establecimiento donde labora, o la provincia.';
    else if (!municipio) e.municipio = 'Elige el municipio.';
    const telIn = input.telefono ?? google?.telefono;
    const telefono = telIn ? telefonoRD(telIn) : null;
    if (telIn && !telefono && fuente === 'manual') e.telefono = 'Escribe un teléfono dominicano de 10 dígitos (809, 829 u 849).';
    const redes = redesDe({ instagram: input.instagram ?? input.redes?.instagram, facebook: input.facebook ?? input.redes?.facebook, web: input.web ?? input.redes?.web ?? google?.web });
    if (Object.keys(e).length) invalido(e);
    const datos = {
      nombre, especialidad, centro: est?.nombre ?? (normalizeName(input.centro) || null), establecimientoId: est?.id ?? null, provincia, municipio, telefono, redes,
      direccion: normalizeName(input.direccion ?? google?.direccion) || null, lat: google?.lat ?? null, lng: google?.lng ?? null, placeId: google?.placeId ?? null,
    };
    // ¿Ya existe? Por id de Google, por teléfono o por nombre en el mismo municipio.
    const todos = await data.list('medicos');
    const dup = (datos.placeId && todos.find((m) => m.placeId === datos.placeId))
      || (telefono && todos.find((m) => m.telefono === telefono && sinTilde(m.nombre) === sinTilde(nombre)))
      || todos.find((m) => sinTilde(m.nombre) === sinTilde(nombre) && sinTilde(m.municipio) === sinTilde(municipio));
    if (dup) {
      const patch = {};
      for (const k of ['telefono', 'establecimientoId', 'centro', 'direccion', 'lat', 'lng', 'placeId']) if (!dup[k] && datos[k] != null) patch[k] = datos[k];
      if ((!dup.especialidad || dup.especialidad === POR_CONFIRMAR) && especialidad !== POR_CONFIRMAR) patch.especialidad = especialidad;
      const r = { ...(dup.redes ?? {}) }; let nuevasRedes = false;
      for (const [k, v] of Object.entries(redes)) if (!r[k]) { r[k] = v; nuevasRedes = true; }
      if (nuevasRedes) patch.redes = r;
      if (!Object.keys(patch).length) return { item: dup, accion: 'existente' };
      const out = await data.update('medicos', dup.id, patch);
      await audit({ actorId: actor.id, action: 'medico_completado', entity: 'medico', entityId: dup.id, after: { campos: Object.keys(patch), fuente } });
      return { item: out, accion: 'completado' };
    }
    // Lo que registra la gerencia queda validado; lo de Google sin especialidad clara y lo del equipo, pendiente.
    const estado = GESTION.includes(actor.role) && especialidad !== POR_CONFIRMAR ? 'validado' : 'pendiente';
    const m = await data.insert('medicos', { ...datos, estado, fuente, creadoPor: actor.id });
    await audit({ actorId: actor.id, action: 'medico_creado', entity: 'medico', entityId: m.id, after: { nombre, especialidad, municipio, fuente } });
    return { item: m, accion: 'creado' };
  }

  // ---- Médico con cuenta: registro, perfil y lugares de trabajo ----
  const TIPOS_TRABAJO = ['hospital', 'clinica', 'consultorio', 'diagnostico', 'cpn', 'unap'];
  /** Lugares para el registro del médico: clínicas, hospitales y consultorios de las provincias y municipios elegidos. */
  async function lugaresParaRegistro({ provincias = [], municipios = [] } = {}) {
    const ps = new Set(provincias); const ms = new Set(municipios);
    return (await data.list('establecimientos')).filter((x) => x.estado !== 'inactivo' && TIPOS_TRABAJO.includes(x.tipo) && (!ps.size || ps.has(x.provincia)) && (!ms.size || ms.has(x.municipio)))
      .sort((a, b) => a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
      .map((x) => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, provincia: x.provincia, municipio: x.municipio }));
  }
  /** Revisa especialidad y lugares. lugares: [{ establecimientoId }] o [{ nombre, tipo, provincia, municipio }] si no está en la lista. */
  async function validarRegistro(input = {}) {
    const e = {};
    const especialidad = ESPECIALIDADES.find((x) => x.toLowerCase() === String(input.especialidad ?? '').trim().toLowerCase());
    if (!especialidad || especialidad === POR_CONFIRMAR) e.especialidad = 'Elige tu especialidad.';
    const lista = Array.isArray(input.lugares) ? input.lugares.slice(0, 20) : [];
    const lugares = [];
    for (const [i, l] of lista.entries()) {
      if (l?.establecimientoId) {
        const x = await data.get('establecimientos', String(l.establecimientoId));
        if (!x || x.estado === 'inactivo') { e[`lugares.${i}`] = 'Ese lugar ya no está en la lista.'; continue; }
        if (!lugares.some((y) => y.establecimientoId === x.id)) lugares.push({ establecimientoId: x.id, nombre: x.nombre, tipo: x.tipo, provincia: x.provincia, municipio: x.municipio });
      } else {
        const nombre = normalizeName(l?.nombre);
        const tipo = TIPOS_TRABAJO.includes(l?.tipo) ? l.tipo : 'clinica';
        if (nombre.length < 3) { e[`lugares.${i}`] = 'Escribe el nombre del lugar donde trabajas.'; continue; }
        const prov = provinciaOficial(l?.provincia); const mun = prov && municipioOficial(prov, l?.municipio);
        if (!mun) { e[`lugares.${i}`] = 'Elige la provincia y el municipio de ese lugar.'; continue; }
        lugares.push({ nuevo: true, nombre, tipo, provincia: prov, municipio: mun });
      }
    }
    if (!lugares.length && !Object.keys(e).some((k) => k.startsWith('lugares.'))) e.lugares = 'Elige al menos un lugar donde trabajas.';
    return Object.keys(e).length ? { errores: e } : { datos: { especialidad, lugares } };
  }
  /** Al registrarse: crea los lugares nuevos (pendientes) y su ficha de médico ligada a la cuenta, o la liga a una que ya existía. */
  async function crearDesdeRegistro(user, { especialidad, lugares }) {
    const finales = [];
    for (const l of lugares) {
      if (!l.nuevo) { finales.push(l); continue; }
      const x = await data.insert('establecimientos', { nombre: l.nombre, tipo: l.tipo, provincia: l.provincia, municipio: l.municipio, estado: 'pendiente', fuente: 'manual', creadoPor: user.id });
      finales.push({ establecimientoId: x.id, nombre: x.nombre, tipo: x.tipo, provincia: x.provincia, municipio: x.municipio });
    }
    const clave = sinTilde(limpiarNombre(user.fullName).nombre);
    const munis = new Set(finales.map((l) => l.municipio));
    const existente = (await data.list('medicos')).find((m) => !m.usuarioId && m.estado !== 'inactivo' && sinTilde(limpiarNombre(m.nombre).nombre) === clave && munis.has(m.municipio));
    const base = { especialidad, lugares: finales, usuarioId: user.id, establecimientoId: finales[0].establecimientoId, centro: finales[0].nombre, provincia: finales[0].provincia, municipio: finales[0].municipio };
    const m = existente ? await data.update('medicos', existente.id, base) : await data.insert('medicos', { nombre: limpiarNombre(user.fullName).nombre, ...base, estado: 'pendiente', fuente: 'registro', creadoPor: user.id });
    await audit({ actorId: user.id, action: existente ? 'medico_ligado_cuenta' : 'medico_registro', entity: 'medico', entityId: m.id, after: { especialidad, lugares: finales.length } });
    return m;
  }
  async function alDecidirCuenta(user, aprobado) {
    const m = (await data.list('medicos')).find((x) => x.usuarioId === user.id);
    if (m && aprobado && m.estado === 'pendiente') await data.update('medicos', m.id, { estado: 'validado' });
  }
  /** Ficha del médico de una cuenta. */
  async function deCuenta(userId) { return (await data.list('medicos')).find((x) => x.usuarioId === userId) ?? null; }
  /** El médico cambia sus lugares de trabajo y su especialidad. */
  async function actualizarMiPerfil(actor, input = {}) {
    permitir(activo(actor) && actor.role === 'medico', 'Solo el médico cambia su perfil.');
    const m = await deCuenta(actor.id);
    if (!m) throw new HttpError(404, 'No encontramos tu ficha de médico.');
    const r = await validarRegistro({ especialidad: input.especialidad ?? m.especialidad, lugares: input.lugares ?? m.lugares });
    if (r.errores) invalido(r.errores);
    const finales = [];
    for (const l of r.datos.lugares) {
      if (!l.nuevo) { finales.push(l); continue; }
      const x = await data.insert('establecimientos', { nombre: l.nombre, tipo: l.tipo, provincia: l.provincia, municipio: l.municipio, estado: 'pendiente', fuente: 'manual', creadoPor: actor.id });
      finales.push({ establecimientoId: x.id, nombre: x.nombre, tipo: x.tipo, provincia: x.provincia, municipio: x.municipio });
    }
    const out = await data.update('medicos', m.id, { especialidad: r.datos.especialidad, lugares: finales, establecimientoId: finales[0].establecimientoId, centro: finales[0].nombre, provincia: finales[0].provincia, municipio: finales[0].municipio });
    await audit({ actorId: actor.id, action: 'medico_perfil', entity: 'medico', entityId: m.id, after: { especialidad: out.especialidad, lugares: finales.length } });
    return out;
  }

  async function editar(actor, id, input = {}) {
    permitir(activo(actor) && GESTION.includes(actor.role), 'Solo la administración o la gerencia editan médicos.');
    const m = await data.get('medicos', id);
    if (!m) throw new HttpError(404, 'El médico no existe.');
    const e = {}; const patch = {};
    if (input.nombre !== undefined) { const n = limpiarNombre(input.nombre).nombre; if (!n || n.length < 3) e.nombre = 'Escribe el nombre.'; else patch.nombre = n; }
    if (input.especialidad !== undefined) { const s = especialidadDe(input.especialidad) ?? normalizeName(input.especialidad); if (!s) e.especialidad = 'Elige la especialidad.'; else patch.especialidad = s; }
    if (input.establecimientoId !== undefined) {
      if (input.establecimientoId) {
        const est = await data.get('establecimientos', String(input.establecimientoId));
        if (!est) e.establecimientoId = 'Ese establecimiento no existe.';
        else Object.assign(patch, { establecimientoId: est.id, centro: est.nombre, provincia: est.provincia, municipio: est.municipio });
      } else Object.assign(patch, { establecimientoId: null });
    }
    if (input.telefono !== undefined) { const t = input.telefono ? telefonoRD(input.telefono) : null; if (input.telefono && !t) e.telefono = 'Teléfono dominicano de 10 dígitos.'; else patch.telefono = t; }
    if (input.instagram !== undefined || input.facebook !== undefined || input.web !== undefined) patch.redes = redesDe({ instagram: input.instagram, facebook: input.facebook, web: input.web });
    if (input.estado !== undefined) { if (!['pendiente', 'validado', 'inactivo'].includes(input.estado)) e.estado = 'Estado no válido.'; else patch.estado = input.estado; }
    if (Object.keys(e).length) invalido(e);
    const out = await data.update('medicos', id, patch);
    await audit({ actorId: actor.id, action: 'medico_editado', entity: 'medico', entityId: id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, m[k] ?? null])), after: patch });
    return out;
  }

  async function listar() {
    return (await data.list('medicos')).sort((a, b) => a.provincia.localeCompare(b.provincia, 'es') || a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  }

  // ---------------------------------------------------------------- documento
  const COLS = { nombre: /^(nombre|medico|doctor)/, especialidad: /^especialidad/, establecimiento: /^(establecimiento|centro|hospital|clinica|lugar)/, provincia: /^provincia/, municipio: /^(municipio|ciudad)/, telefono: /^(telefono|celular|tel)/, instagram: /^instagram/, facebook: /^facebook/, web: /^(web|pagina|sitio)/ };
  function deHoja(hoja) {
    const col = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, hoja.columnas.find((c) => re.test(c))]));
    if (!col.nombre) return null;
    return hoja.filas.filter((f) => !/^ejemplo/i.test(String(f[col.nombre] ?? ''))).map((f) => Object.fromEntries(Object.entries(col).map(([k, c]) => [k, c ? f[c] ?? '' : '']))).filter((x) => String(x.nombre).trim());
  }
  /** Lee el documento y devuelve la vista previa (no guarda). */
  async function leerDocumento(actor, archivo) {
    permitir(puedeRegistrar(actor), 'No tienes permiso para registrar médicos.');
    if (!archivo?.base64) invalido({ archivo: 'Elige el archivo.' });
    const buf = Buffer.from(archivo.base64, 'base64');
    if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'El archivo no puede pasar de 6 MB.', { archivo: 'Archivo demasiado grande.' });
    const establecimientos = (await data.list('establecimientos')).filter((x) => x.estado !== 'inactivo');
    const tipo = String(archivo.tipo ?? '');
    const esHoja = /\.(xlsx|csv)$/i.test(archivo.nombre ?? '') || /spreadsheet|csv/.test(tipo);
    let crudas; let fuente = 'documento'; let notas = null;
    const nombresEst = establecimientos.slice(0, 300).map((x) => `${x.nombre} (${x.municipio})`);
    if (esHoja) {
      let hoja;
      try { hoja = leerHoja(buf, archivo.nombre); } catch (err) { invalido({ archivo: err.message }); }
      crudas = deHoja(hoja);
      if (!crudas) {
        if (!lector?.activo) invalido({ archivo: 'La hoja no tiene la columna "Nombre". Usa la plantilla, o activa la lectura con inteligencia artificial.' });
        const texto = [hoja.columnas.join(' | '), ...hoja.filas.slice(0, 1500).map((f) => hoja.columnas.map((c) => f[c] ?? '').join(' | '))].join('\n');
        ({ filas: crudas, notas } = await lector.leerMedicos({ texto, establecimientos: nombresEst }).catch((er) => { throw new HttpError(er.status ?? 502, er.message); }));
        fuente = 'ia';
      }
    } else {
      if (!lector?.activo) throw new HttpError(503, 'La lectura de PDF y fotos con inteligencia artificial no está configurada. Usa la plantilla de Excel.', { archivo: 'Usa la plantilla de Excel.' });
      ({ filas: crudas, notas } = await lector.leerMedicos({ tipo, base64: archivo.base64, establecimientos: nombresEst }).catch((er) => { throw new HttpError(er.status ?? 502, er.message); }));
      fuente = 'ia';
    }
    if (!crudas.length) invalido({ archivo: 'No se encontraron médicos en el archivo.' });
    if (crudas.length > 1000) invalido({ archivo: 'Máximo 1,000 médicos por archivo; divídelo en partes.' });
    const todos = await data.list('medicos');
    const filas = crudas.map((c, i) => {
      const { nombre, especialidad: espNombre } = limpiarNombre(c.nombre);
      const especialidad = especialidadDe(c.especialidad) ?? (normalizeName(c.especialidad) || espNombre || null);
      const prov = provinciaOficial(c.provincia); const mun = prov ? municipioOficial(prov, c.municipio) : null;
      const delMun = establecimientos.filter((x) => (!mun || x.municipio === mun) && (!prov || x.provincia === prov));
      const m = c.establecimiento ? emparejar(c.establecimiento, delMun.length ? delMun : establecimientos, (x) => x.nombre) : { elegido: null, opciones: [] };
      const est = m.elegido;
      const municipio = est?.municipio ?? mun; const provincia = est?.provincia ?? prov;
      const telefono = c.telefono ? telefonoRD(c.telefono) : null;
      const avisos = [];
      if (!especialidad) avisos.push('Sin especialidad: queda "Por confirmar".');
      if (c.establecimiento && !est) avisos.push(`No encontramos "${c.establecimiento}" en Establecimientos: elígelo o regístralo.`);
      if (!provincia || !municipio) avisos.push('Falta la provincia o el municipio: elige el establecimiento.');
      if (c.telefono && !telefono) avisos.push(`Teléfono "${c.telefono}" no válido: se omite.`);
      const ya = todos.find((x) => sinTilde(x.nombre) === sinTilde(nombre) && (!municipio || sinTilde(x.municipio) === sinTilde(municipio)));
      return {
        fila: i + 1, nombre, especialidad, establecimientoId: est?.id ?? null, centroLeido: normalizeName(c.establecimiento) || null,
        opciones: m.opciones.map((x) => ({ id: x.id, nombre: x.nombre, municipio: x.municipio })), provincia, municipio, telefono,
        redes: redesDe({ instagram: c.instagram, facebook: c.facebook, web: c.web }), existe: ya ? ya.id : null, avisos,
      };
    });
    return { fuente, notas, filas };
  }
  /** Guarda las filas revisadas en pantalla. */
  async function confirmarDocumento(actor, { filas, fuente } = {}) {
    permitir(puedeRegistrar(actor), 'No tienes permiso para registrar médicos.');
    if (!Array.isArray(filas) || !filas.length) invalido({ filas: 'No hay médicos para guardar.' });
    if (filas.length > 1000) invalido({ filas: 'Máximo 1,000 médicos por vez.' });
    const establecimientos = await data.list('establecimientos');
    const resumen = { creado: 0, completado: 0, existente: 0, error: 0 }; const errores = [];
    for (const [i, f] of filas.entries()) {
      try {
        const r = await registrar(actor, { nombre: f.nombre, especialidad: f.especialidad || POR_CONFIRMAR, establecimientoId: f.establecimientoId || undefined, provincia: f.provincia, municipio: f.municipio, telefono: f.telefono, ...(f.redes ?? {}) }, { fuente: fuente === 'ia' ? 'ia' : 'documento', establecimientos });
        resumen[r.accion]++;
      } catch (err) { resumen.error++; errores.push({ fila: f.fila ?? i + 1, nombre: f.nombre, error: err.fields ? Object.values(err.fields).join(' ') : err.message }); }
    }
    await audit({ actorId: actor.id, action: 'importacion', entity: 'medicos', entityId: fuente ?? 'documento', after: resumen });
    return { resumen, errores };
  }

  return { registrar, editar, listar, leerDocumento, confirmarDocumento, especialidades: () => ESPECIALIDADES, iaActiva: () => Boolean(lector?.activo),
    lugaresParaRegistro, validarRegistro, crearDesdeRegistro, alDecidirCuenta, deCuenta, actualizarMiPerfil };
}

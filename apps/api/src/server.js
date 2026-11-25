import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore, PostgresStore } from './store.js';
import { MemoryData, PgData } from './data.js';
import { MemoryFiles, crearArchivos } from './files.js';
import { createAuthService, AuthError } from './auth.js';
import { createComercial } from './comercial.js';
import { createViaticos, COMBUSTIBLE_LABEL } from './viaticos.js';
import { SinMapas, crearMapas } from './mapas.js';
import { createTerritorio, provinciaOficial, municipioOficial } from './territorio.js';
import { normalizeName, leerCoordenadas } from './validation.js';
import { coordsDeEnlace, abrirEnlace, esHostGoogle } from './enlace-mapa.js';
import { createNotificaciones } from './notificaciones.js';
import { SinCorreo, crearCorreo, bienvenida } from './correo.js';
import { canApprove } from './roles.js';
import { actualizarDesdeMicm } from './combustible-micm.js';
import { SinLugares, crearLugares } from './lugares.js';
import { createBarrido } from './barrido-google.js';
import { createHoteles, REQUISITOS } from './hoteles.js';
import { createInicio } from './inicio.js';
import { createVehiculos, createVehiculosAgregados } from './vehiculos.js';
import { createVentas } from './ventas.js';
import { hoyRD } from './periodos.js';
import { createLectorIA } from './lector-ia.js';
import { createAltaRepresentantes } from './representantes.js';
import { createBanco, BANCOS, TIPOS_CUENTA } from './banco.js';
import { createTienda } from './tienda.js';
import { createMedicos, pareceMedico } from './medicos.js';
import { createMetas } from './metas.js';
import { createMovimiento } from './movimiento.js';
import { createSugerencias } from './sugerencias.js';
import { signSession, verifySession } from './security.js';
import { POSITIONS, ROLE_LABELS, SELF_REGISTERABLE } from './roles.js';

const MAX_BODY = 32 * 1024;
const MAX_BODY_ADJUNTO = 8 * 1024 * 1024; // receta con foto de hasta 5 MB en base64

async function readJson(req, limit = MAX_BODY) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new AuthError(413, 'La solicitud es demasiado grande.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new AuthError(400, 'El cuerpo no es JSON válido.'); }
}

const publico = ({ passwordHash, ...u }) => u;

export function createApp({ store, data = new MemoryData(), files = new MemoryFiles(), mapas = new SinMapas(), lugares = new SinLugares(), correo = new SinCorreo(), sitio = 'https://fersuaz.net', micmFetch = fetch, vehiculosFetch = fetch, enlaceFetch = fetch, barridoPausa, sessionSecret, allowedOrigins = [], now, lectorIA = null }) {
  const n = createNotificaciones({ data, users: store, correo, sitio });
  const avisar = (fn) => fn().catch((e) => console.error('Notificación:', e.message));
  const t = createTerritorio({ data, users: store, audit: (e) => store.addAudit(e), now });
  const farmaciaActiva = async (id) => { const f = await data.get('farmacias', id); return f && !['inactiva', 'inactivo'].includes(f.estado) ? f : null; };
  /** Farmacia escrita por una dependiente que no la encontró: se crea pendiente de validar (o se reutiliza si ya existe). */
  const farmaciaNueva = async ({ nombre, provincia, municipio }) => {
    const n = normalizeName(nombre); const p = provinciaOficial(provincia); const m = p ? municipioOficial(p, municipio) : null;
    const errores = {};
    if (n.length < 2) errores.pharmacy = 'Escribe el nombre de la farmacia donde trabajas.';
    if (!p) errores.province = 'Elige la provincia de tu farmacia.';
    else if (!m) errores.municipio = 'Elige el municipio de tu farmacia.';
    if (Object.keys(errores).length) return { errores };
    const sin = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const ya = (await data.list('farmacias', { municipio: m })).find((f) => sin(f.nombre) === sin(n) && f.estado !== 'inactiva');
    if (ya) return { farmacia: ya };
    const f = await data.insert('farmacias', { nombre: n, provincia: p, municipio: m, fuente: 'manual', estado: 'pendiente' });
    await store.addAudit({ action: 'farmacia_creada', entity: 'farmacia', entityId: f.id, after: { nombre: n, municipio: m, fuente: 'registro_dependiente' } });
    return { farmacia: f };
  };
  // El servicio de médicos se crea más abajo; el registro lo usa al llamar (después de crearse).
  const auth = createAuthService(store, { preregistro: { buscar: t.buscarPreregistro, confirmar: t.confirmarPreregistro }, farmaciaPara: farmaciaActiva, farmaciaNueva,
    registroMedico: { validar: (i) => medicos.validarRegistro(i), crear: (u, d) => medicos.crearDesdeRegistro(u, d), alDecidir: (u, ok) => medicos.alDecidirCuenta(u, ok) } });
  const c = createComercial({ data, users: store, files, audit: (e) => store.addAudit(e), now });
  const hoteles = createHoteles({ data, audit: (e) => store.addAudit(e), now: now ?? (() => new Date()) });
  const v = createViaticos({ data, users: store, files, mapas, hoteles, notificar: n.notificar, notificarRoles: n.notificarRoles, audit: (e) => store.addAudit(e), now });

  const GESTION_LUGARES = ['administrador', 'gerencia', 'supervisor'];
  const sinAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  async function buscarGoogle(me, q) {
    if (!me || me.status !== 'activo' || !GESTION_LUGARES.includes(me.role)) throw new AuthError(403, 'No tienes permiso para esta acción.');
    if (!lugares.activo) throw new AuthError(503, 'La búsqueda en Google Maps no está conectada todavía (falta MAPS_API_KEY).');
    const { provincias, municipios, tipos } = t.division();
    const provincia = q.get('provincia'); const municipio = q.get('municipio'); const tipo = q.get('tipo');
    if (!provincias.includes(provincia) || !municipios[provincia].includes(municipio)) throw new AuthError(422, 'Elige provincia y municipio.');
    if (tipo !== 'farmacia' && tipo !== 'hotel' && !tipos[tipo]) throw new AuthError(422, 'Elige el tipo de establecimiento.');
    let res;
    try { res = await lugares.buscar({ tipo, municipio, provincia, texto: (q.get('texto') || '').slice(0, 60) }); } catch (err) { throw new AuthError(502, err.message); }
    const col = tipo === 'farmacia' ? 'farmacias' : tipo === 'hotel' ? 'hoteles' : 'establecimientos';
    const existentes = await data.list(col, { municipio });
    const ids = new Set(existentes.map((x) => x.placeId).filter(Boolean)); const nombres = new Set(existentes.map((x) => sinAcento(x.nombre)));
    return { items: res.map((r) => ({ ...r, registrado: ids.has(r.placeId) || nombres.has(sinAcento(r.nombre)) })) };
  }
  /** Nombre del lugar en unas coordenadas exactas (para la dirección desde donde sale un representante). */
  async function ubicacionGoogle(me, q) {
    if (!me || me.status !== 'activo' || !GESTION_LUGARES.includes(me.role)) throw new AuthError(403, 'No tienes permiso para esta acción.');
    const c = leerCoordenadas(q.get('lat'), q.get('lng'));
    if (c.error) throw new AuthError(422, c.error, { 'residencia.coordenadas': c.error });
    if (!lugares.activo || typeof lugares.ubicacion !== 'function') return { item: null, ...c, motivo: 'La búsqueda en Google Maps no está conectada; escribe el nombre del lugar.' };
    let x;
    try { x = await lugares.ubicacion(c.lat, c.lng); } catch (err) { return { item: null, ...c, motivo: `${err.message} Escribe el nombre del lugar.` }; }
    const { provincias, municipios } = t.division();
    const base = (s) => sinAcento(s).replace(/^(provincia|municipio)( de)? /, '').replace(/ province$/, '');
    const prov = x?.provincia ? provincias.find((p) => base(p) === base(x.provincia)) ?? null : null;
    const mun = prov && x?.municipio ? municipios[prov].find((m) => base(m) === base(x.municipio)) ?? null : null;
    return { item: x ? { ...x, provincia: prov, municipio: mun } : null, ...c, motivo: x ? null : 'Google no encontró un nombre para ese punto; escríbelo.' };
  }
  /** Ubicación desde un enlace de Google Maps (largo o corto): coordenadas y nombre del lugar. */
  async function enlaceGoogle(me, q) {
    if (!me || me.status !== 'activo' || !GESTION_LUGARES.includes(me.role)) throw new AuthError(403, 'No tienes permiso para esta acción.');
    const texto = String(q.get('url') ?? '').trim().slice(0, 2000);
    const malo = 'Pega un enlace de Google Maps (Compartir → Copiar enlace).';
    let u; try { u = new URL(texto); } catch { throw new AuthError(422, malo, { 'residencia.coordenadas': malo }); }
    if (!esHostGoogle(u.hostname)) throw new AuthError(422, malo, { 'residencia.coordenadas': malo });
    let c = coordsDeEnlace(texto);
    if (!c || c.lat == null || c.aproximado) {
      const fin = await abrirEnlace(texto, enlaceFetch);
      const c2 = fin ? coordsDeEnlace(fin) : null;
      if (c2?.lat != null && (!c2.aproximado || c?.lat == null)) c = c2;
      else if (c2?.nombre && !c?.nombre) c = { ...(c ?? {}), nombre: c2.nombre };
    }
    // Si el enlace solo trae el nombre del lugar (o el centro del mapa), se busca el punto del lugar en Google.
    if ((c?.lat == null || c.aproximado) && c?.nombre && lugares.activo && typeof lugares.coordsDe === 'function') {
      try { const p = await lugares.coordsDe(c.nombre); if (p) c = { ...p, nombre: c.nombre }; } catch { /* se queda lo que haya */ }
    }
    if (c?.lat == null) { const m = 'No pudimos leer la ubicación de ese enlace. Abre el lugar en Google Maps, mantén presionado el punto y copia los números.'; throw new AuthError(422, m, { 'residencia.coordenadas': m }); }
    const sp = new URLSearchParams({ lat: String(c.lat), lng: String(c.lng) });
    return { ...(await ubicacionGoogle(me, sp)), desdeEnlace: true, aproximado: Boolean(c.aproximado) };
  }
  async function agregarGoogle(me, body) {
    if (!me || me.status !== 'activo' || !GESTION_LUGARES.includes(me.role)) throw new AuthError(403, 'No tienes permiso para esta acción.');
    if (!lugares.activo) throw new AuthError(503, 'La búsqueda en Google Maps no está conectada todavía.');
    let d;
    try { d = await lugares.detalle(body.placeId); } catch (err) { throw new AuthError(502, err.message); }
    if (!d) throw new AuthError(404, 'Google no encontró ese lugar.');
    const base = { nombre: d.nombre, provincia: body.provincia, municipio: body.municipio, direccion: d.direccion, telefono: d.telefono, lat: d.lat, lng: d.lng, placeId: d.placeId };
    if (body.tipo === 'farmacia') {
      const item = await c.catalogo.crearFarmacia(me, { nombre: d.nombre, provincia: body.provincia, municipio: body.municipio }, d);
      return { item };
    }
    if (body.tipo === 'hotel') return { item: await hoteles.crear(me, { ...base, calificacion: d.calificacion }, { fuente: 'google' }) };
    return { item: await t.crearEstablecimiento(me, { ...base, tipo: body.tipo }, { fuente: 'google', verificado: true }) };
  }

  const vehiculos = createVehiculos({ fetchImpl: vehiculosFetch });
  const agregados = createVehiculosAgregados({ data, audit: (e) => store.addAudit(e) });
  const ventas = createVentas({ data, audit: (e) => store.addAudit(e), lector: lectorIA, territorio: t, hoy: () => hoyRD(now ? now() : new Date()) });
  const medicos = createMedicos({ data, audit: (e) => store.addAudit(e), lector: lectorIA, users: store });
  const movimiento = createMovimiento({ data, users: store });
  const metas = createMetas({ data, users: store, audit: (e) => store.addAudit(e), hoy: () => hoyRD(now ? now() : new Date()) });
  const sugerencias = createSugerencias({ data, users: store, movimiento, metas, hoy: () => hoyRD(now ? now() : new Date()) });
  const tienda = createTienda({ data, users: store, files, audit: (e) => store.addAudit(e), notificar: (id, m) => n.notificar(id, m), notificarRoles: (r, m) => n.notificarRoles(r, m), ventas, hoy: () => hoyRD(now ? now() : new Date()) });
  const banco = createBanco({ data, users: store, audit: (e) => store.addAudit(e) });
  const altas = createAltaRepresentantes({ store, t, v, data });
  const inicio = createInicio({ data, users: store, v, c, t, now: now ?? (() => new Date()) });

  // Registro automático desde Google Maps (recorre municipios y guarda lo que falte)
  const barrido = createBarrido({
    data, lugares, now: now ?? (() => new Date()), pausa: barridoPausa ?? 250, aceptar: (tipo, l) => tipo !== 'medico' || pareceMedico(l.nombre), notificar: n.notificar, audit: (e) => store.addAudit(e),
    guardar: (actor, tipo, l) => tipo === 'farmacia'
      ? c.catalogo.crearFarmacia(actor, { nombre: l.nombre, provincia: l.provincia, municipio: l.municipio }, l, { revisado: true })
      : tipo === 'hotel' ? hoteles.crear(actor, l, { fuente: 'google' })
      : tipo === 'medico' ? medicos.registrar(actor, { provincia: l.provincia, municipio: l.municipio }, { fuente: 'google', google: l })
      : t.crearEstablecimiento(actor, { nombre: l.nombre, tipo, provincia: l.provincia, municipio: l.municipio, direccion: l.direccion, telefono: l.telefono, lat: l.lat, lng: l.lng, placeId: l.placeId }, { fuente: 'google', verificado: true }),
  });
  const puedeBarrido = (me) => {
    if (!me || me.status !== 'activo' || !['administrador', 'gerencia'].includes(me.role)) throw new AuthError(403, 'Solo la administración o la gerencia pueden usar el registro automático.');
  };
  function alcanceBarrido(src) {
    const provincia = src.provincia || 'todas'; const municipio = src.municipio || null;
    const { provincias, municipios, tipos } = t.division();
    if (provincia !== 'todas' && !provincias.includes(provincia)) throw new AuthError(422, 'Elige una provincia oficial.');
    if (municipio && (provincia === 'todas' || !municipios[provincia].includes(municipio))) throw new AuthError(422, 'Ese municipio no pertenece a la provincia.');
    if (!['farmacia', 'hotel', 'salud', 'medico'].includes(src.tipo) && !tipos[src.tipo]) throw new AuthError(422, 'Elige el tipo de establecimiento.');
    return { tipo: src.tipo, provincia, municipio };
  }

  function send(res, status, body, origin, raw) {
    const headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    if (origin && allowedOrigins.includes(origin)) {
      Object.assign(headers, {
        'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin',
      });
    }
    if (raw) { headers['content-type'] = raw.tipo; res.writeHead(status, headers); return res.end(raw.buf); }
    headers['content-type'] = 'application/json; charset=utf-8';
    res.writeHead(status, headers);
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }

  async function currentUser(req) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const s = verifySession(token, sessionSecret);
    return s ? store.findUserById(s.sub) : null;
  }

  // [método, patrón, manejador(ctx), { auth, limite }]
  const R = [];
  const ruta = (m, p, h, o = {}) => R.push([m, typeof p === 'string' ? new RegExp(`^${p}$`) : p, h, { auth: true, ...o }]);

  // `archivos`: dónde se guardan las fotos. En producción debe ser "spaces": en disco se pierden en cada despliegue.
  ruta('GET', '/api/health', () => ({ ok: true, archivos: files.constructor.name === 'SpacesFiles' ? 'spaces' : files.constructor.name === 'LocalFiles' ? 'disco' : 'memoria' }), { auth: false });
  ruta('GET', '/api/auth/options', () => ({ roles: SELF_REGISTERABLE.map((r) => ({ value: r, label: ROLE_LABELS[r] })), positions: POSITIONS }), { auth: false });
  ruta('POST', '/api/auth/register', async ({ body }) => {
    const user = await auth.register(body);
    const roles = ['administrador', 'gerencia', 'supervisor'].filter((r) => canApprove(r, user.role));
    if (user.status !== 'activo') {
      avisar(() => n.notificarRoles(roles, { tipo: 'solicitud', titulo: 'Nueva solicitud de cuenta', texto: `${user.fullName} pidió acceso como ${user.role}${user.position ? ` (${user.position})` : ''}.`, enlace: '#solicitudes' }));
    } else if (user.role === 'dependiente') {
      avisar(() => n.notificarRoles(roles, { tipo: 'solicitud', titulo: 'Nueva dependiente', texto: `${user.fullName} se registró en ${user.pharmacy}${user.province ? `, ${user.province}` : ''}.`, enlace: '#solicitudes?sec=dependientes' }));
    }
    const message = user.status !== 'activo' ? 'Solicitud recibida. Te avisaremos cuando la gerencia la apruebe.'
      : user.role === 'dependiente' ? `Tu cuenta ya está activa y ligada a ${user.pharmacy}. Inicia sesión.` : 'Tu cuenta ya está activa: la gerencia te había pre-registrado. Inicia sesión.';
    return [201, { user, message }];
  }, { auth: false });
  // Público (registro de dependientes): división territorial y farmacias del catálogo, solo datos de la farmacia.
  ruta('GET', '/api/publico/division', () => { const d = t.division(); return { provincias: d.provincias, municipios: d.municipios }; }, { auth: false });
  // Público (registro de médicos): clínicas, hospitales y consultorios de las provincias y municipios elegidos.
  ruta('GET', '/api/publico/establecimientos', async ({ q }) => {
    const lista = (k) => String(q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const provincias = lista('provincia'); const municipios = lista('municipio');
    if (!provincias.length) throw new AuthError(422, 'Elige al menos una provincia.');
    return { items: (await medicos.lugaresParaRegistro({ provincias, municipios })).slice(0, 800) };
  }, { auth: false });
  ruta('GET', '/api/publico/especialidades', () => ({ items: medicos.especialidades().filter((x) => x !== 'Por confirmar') }), { auth: false });
  ruta('GET', '/api/publico/farmacias', async ({ q }) => {
    const provincia = q.get('provincia'); const municipio = q.get('municipio'); const texto = String(q.get('q') ?? '').trim();
    if (!provincia || !municipio) throw new AuthError(422, 'Elige la provincia y el municipio.');
    const k = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const xs = (await data.list('farmacias', { municipio })).filter((f) => f.provincia === provincia && !['inactiva', 'inactivo'].includes(f.estado)
      && (!k || `${f.nombre} ${f.sector ?? ''} ${f.direccion ?? ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(k)));
    return { items: xs.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).slice(0, 60).map((f) => ({ id: f.id, nombre: f.nombre, sector: f.sector ?? null, direccion: f.direccion ?? null })), total: xs.length };
  }, { auth: false });
  ruta('POST', '/api/auth/login', async ({ body }) => {
    const user = await auth.login(body.email, body.password);
    return { user, token: signSession({ sub: user.id, role: user.role }, sessionSecret) };
  }, { auth: false });
  ruta('GET', '/api/auth/me', ({ me }) => ({ user: publico(me) }));
  // Cuenta de banco de la dependiente
  ruta('GET', '/api/banco/opciones', () => ({ bancos: Object.entries(BANCOS).map(([value, label]) => ({ value, label })), tipos: Object.entries(TIPOS_CUENTA).map(([value, label]) => ({ value, label })) }));
  ruta('GET', '/api/banco/mia', async ({ me }) => banco.ver(me, me.id));
  ruta('POST', '/api/banco/mia', async ({ me, body }) => ({ item: await banco.guardar(me, me.id, body ?? {}) }));
  ruta('GET', '/api/banco/cuentas', async ({ me }) => ({ items: await banco.listar(me) }));
  ruta('GET', /^\/api\/banco\/([\w-]+)$/, async ({ me, p }) => banco.ver(me, p[1]));
  ruta('POST', /^\/api\/banco\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await banco.guardar(me, p[1], body ?? {}) }));
  // Mi cuenta: cada persona corrige su teléfono y su correo.
  ruta('POST', '/api/auth/mis-datos', async ({ me, body }) => {
    const e = {}; const patch = {};
    if (body?.telefono !== undefined) {
      const d = String(body.telefono ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (d && !/^(809|829|849)\d{7}$/.test(d)) e.telefono = 'Escribe un teléfono dominicano (809, 829 u 849).';
      else if (d) patch.phone = `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (body?.correo !== undefined && String(body.correo).trim()) {
      const c = String(body.correo).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(c)) e.correo = 'Escribe un correo válido.';
      else { const otro = await store.findUserByEmail(c); if (otro && otro.id !== me.id) e.correo = 'Ese correo ya lo usa otra cuenta.'; else patch.email = c; }
    }
    if (Object.keys(e).length) throw new AuthError(422, 'Revisa los campos marcados.', e);
    const u = Object.keys(patch).length ? await store.updateUser(me.id, patch) : me;
    if (Object.keys(patch).length) await store.addAudit({ actorId: me.id, action: 'mis_datos', entity: 'user', entityId: me.id, before: { phone: me.phone ?? null, email: me.email ?? null }, after: patch });
    return { item: { fullName: u.fullName, username: u.username ?? null, email: u.email ?? null, phone: u.phone ?? null } };
  });
  ruta('POST', '/api/auth/cambiar-clave', async ({ me, body }) => ({ item: await auth.cambiarMiClave(me, body?.actual, body?.nueva) }));
  // Alta de representantes por el administrador
  /** Envía al representante su usuario, los pasos y el enlace (si tiene correo). Responde cómo quedó el envío. */
  async function correoBienvenida(userId, cred, motivo) {
    const u = await store.findUserById(userId);
    if (!u?.email) return 'sin_correo';
    if (!correo?.activo) return 'no_configurado';
    try {
      const m = bienvenida({ nombre: u.fullName, usuario: cred.usuario, claveTemporal: cred.claveTemporal, claveInicialGlobal: cred.claveInicialGlobal, sitio, motivo });
      await correo.enviar({ para: u.email, asunto: m.asunto, texto: m.texto, html: m.html });
      await store.addAudit({ actorId: userId, action: 'correo_bienvenida', entity: 'user', entityId: userId, after: { motivo } });
      return 'enviado';
    } catch (err) { console.error('correo de bienvenida:', err.message); return 'error'; }
  }
  ruta('POST', '/api/representantes', async ({ me, body }) => {
    const r = await altas.alta(me, body ?? {});
    return [201, { ...r, correoBienvenida: await correoBienvenida(r.representante.id, r, 'alta') }];
  });
  ruta('POST', /^\/api\/representantes\/([\w-]+)\/editar$/, async ({ me, p, body }) => { const r = await altas.editar(me, p[1], body ?? {}); return r.usuario ? { ...r, correoBienvenida: await correoBienvenida(p[1], r, 'nombre') } : r; });
  ruta('POST', /^\/api\/representantes\/([\w-]+)\/baja$/, async ({ me, p, body }) => altas.baja(me, p[1], body?.motivo));
  ruta('POST', /^\/api\/representantes\/([\w-]+)\/reactivar$/, async ({ me, p }) => { const r = await altas.reactivar(me, p[1]); return { ...r, correoBienvenida: await correoBienvenida(p[1], r, 'alta') }; });
  ruta('GET', '/api/representantes/clave-inicial', async ({ me }) => altas.verClaveInicial(me));
  ruta('POST', '/api/representantes/clave-inicial', async ({ me, body }) => altas.guardarClaveInicial(me, body ?? {}));
  ruta('POST', '/api/representantes/importar-paquete', async ({ me, body }) => altas.importarPaquete(me, body ?? {}), { limite: 12 * 1024 * 1024 });
  ruta('GET', '/api/representantes/plan-dias', async ({ me }) => ({ items: await altas.planesDias(me) }));
  ruta('GET', /^\/api\/representantes\/([\w-]+)\/plan-dias$/, async ({ me, p }) => ({ item: await altas.planDias(me, p[1]) }));
  ruta('GET', '/api/representantes/inactivos', async ({ me }) => {
    if (!['administrador', 'gerencia'].includes(me.role)) throw new AuthError(403, 'Sin permiso.');
    return { items: (await store.listUsersByStatus('inactivo')).filter((u) => u.role === 'representante').map((u) => ({ id: u.id, fullName: u.fullName, position: u.position ?? null, username: u.username ?? null })) };
  });
  ruta('POST', /^\/api\/representantes\/([\w-]+)\/clave$/, async ({ me, p }) => { const r = await altas.restablecerClave(me, p[1]); return { ...r, correoBienvenida: await correoBienvenida(p[1], r, 'clave') }; });
  // Vehículos: rendimiento de FuelEconomy.gov (EPA)
  const soloGestion = (me) => { if (!['administrador', 'gerencia', 'supervisor'].includes(me?.role)) throw new AuthError(403, 'No tienes permiso para esta acción.'); };
  const conVehiculos = async (fn) => { try { return await fn(); } catch (err) { throw new AuthError(err.status ?? 503, err.message, err.fields); } };
  // Si la EPA no responde, igual se muestran los modelos agregados por la gestión.
  const epaOVacio = async (fn, hayLocales) => { try { return await fn(); } catch (err) { if (hayLocales) return []; throw new AuthError(err.status ?? 503, err.message); } };
  ruta('GET', '/api/vehiculos/anios', async ({ me }) => { soloGestion(me); return { items: await conVehiculos(() => vehiculos.anios()) }; });
  ruta('GET', '/api/vehiculos/marcas', async ({ me, q }) => {
    soloGestion(me);
    const locales = [...new Set((await agregados.listar(q.get('anio'))).map((v) => v.marca))];
    const epa = await epaOVacio(() => vehiculos.marcas(q.get('anio')), locales.length);
    const extra = locales.filter((m) => !epa.some((x) => x.toLowerCase() === m.toLowerCase()));
    return { items: [...epa, ...extra].sort((a, b) => a.localeCompare(b, 'es')) };
  });
  ruta('GET', '/api/vehiculos/modelos', async ({ me, q }) => {
    soloGestion(me);
    const locales = await agregados.listar(q.get('anio'), q.get('marca'));
    return { items: await epaOVacio(() => vehiculos.modelos(q.get('anio'), q.get('marca')), locales.length), agregados: locales };
  });
  ruta('GET', '/api/vehiculos/referencia', async ({ me, q }) => {
    soloGestion(me);
    const marca = q.get('marca'); const modelo = q.get('modelo'); const anio = Number(q.get('anio'));
    const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // 1) un modelo ya agregado por la gestión, del año más cercano
    const propios = [];
    for (let d = 0; d <= 8 && !propios.length; d++) for (const a of new Set([anio - d, anio + d])) propios.push(...(await agregados.listar(a, marca)).filter((v) => norm(v.modelo) === norm(modelo)));
    const agregado = propios[0] ? { anio: propios[0].anio, marca: propios[0].marca, modelo: propios[0].modelo, kmPorGalon: propios[0].kmPorGalon, fuente: 'agregado' } : null;
    // 2) el dato oficial de la EPA
    let epa = null; let epaError = null;
    try { epa = await vehiculos.referencia(marca, modelo, anio); } catch (err) { epaError = err.message; }
    return { agregado, epa, epaError };
  });
  ruta('POST', '/api/vehiculos/agregados', async ({ me, body }) => { soloGestion(me); return [201, { item: await conVehiculos(() => agregados.agregar(me, body ?? {})) }]; });
  ruta('GET', '/api/vehiculos/versiones', async ({ me, q }) => { soloGestion(me); return { items: await conVehiculos(() => vehiculos.versiones(q.get('anio'), q.get('marca'), q.get('modelo'))) }; });
  ruta('GET', /^\/api\/vehiculos\/ficha\/(\d+)$/, async ({ me, p }) => { soloGestion(me); return { item: await conVehiculos(() => vehiculos.ficha(p[1])) }; });
  // Panel de inicio por rol
  ruta('GET', '/api/inicio', async ({ me, q }) => inicio.resumen(me, q.get('mes')));
  ruta('GET', '/api/usuarios/dependientes', async ({ me }) => ({ items: await inicio.dependientes(me) }));
  ruta('POST', /^\/api\/usuarios\/([\w-]+)\/farmacia$/, async ({ me, p, body }) => ({ item: await inicio.ligarFarmacia(me, p[1], body?.farmaciaId, (e) => store.addAudit(e)) }));
  ruta('GET', '/api/auth/pending', async ({ me }) => ({
    pending: (await store.listUsersByStatus('pendiente_aprobacion')).map(publico).filter((u) => u.id !== me.id),
  }));
  ruta('POST', /^\/api\/auth\/requests\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p }) => {
    const user = await auth.decide(me, p[1], p[2] === 'aprobar');
    avisar(() => n.notificar(user.id, user.status === 'activo'
      ? { tipo: 'cuenta', titulo: 'Tu cuenta fue aprobada', texto: 'Ya puedes iniciar sesión en FERSUAZ.NET con tu correo y contraseña.' }
      : { tipo: 'cuenta', titulo: 'Tu solicitud no fue aprobada', texto: 'Si crees que es un error, comunícate con tu supervisor o la gerencia.' }));
    return { user };
  });

  // Catálogos
  ruta('GET', '/api/catalogo/medicamentos', async () => ({ items: await c.catalogo.listarMedicamentos() }));
  ruta('POST', '/api/catalogo/medicamentos', async ({ me, body }) => [201, { item: await c.catalogo.crearMedicamento(me, body) }]);
  ruta('GET', '/api/catalogo/medicamentos/repetidos', async ({ me }) => c.catalogo.repetidosMedicamentos(me));
  ruta('POST', '/api/catalogo/medicamentos/repetidos', async ({ me, body }) => c.catalogo.limpiarRepetidos(me, body ?? {}));
  ruta('POST', /^\/api\/catalogo\/medicamentos\/([\w-]+)\/eliminar$/, async ({ me, p, body }) => ({ item: await c.catalogo.eliminarMedicamento(me, p[1], body ?? {}) }));
  ruta('POST', /^\/api\/catalogo\/medicamentos\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await c.catalogo.editarMedicamento(me, p[1], body ?? {}) }));
  ruta('GET', '/api/catalogo/farmacias', async () => ({ items: await c.catalogo.listarFarmacias() }));
  ruta('POST', '/api/catalogo/farmacias', async ({ me, body }) => [201, { item: await c.catalogo.crearFarmacia(me, body) }]);
  ruta('GET', '/api/catalogo/medicos', async () => ({ items: await medicos.listar(), especialidades: medicos.especialidades(), iaActiva: medicos.iaActiva() }));
  ruta('POST', '/api/catalogo/medicos', async ({ me, body }) => { const r = await medicos.registrar(me, body ?? {}); return [r.accion === 'creado' ? 201 : 200, r]; });
  ruta('POST', /^\/api\/catalogo\/medicos\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await medicos.editar(me, p[1], body ?? {}) }));
  ruta('GET', '/api/tareas', async ({ me, q }) => sugerencias.tareas(me, { mes: q.get('mes') || undefined }));
  ruta('GET', '/api/reportes/territorio', async ({ me, q }) => movimiento.reporte(me, { mes: q.get('mes'), provincia: q.get('provincia') || undefined }));
  ruta('GET', '/api/metas', async ({ me }) => ({ item: await metas.verConfig(me) }));
  ruta('POST', '/api/metas/posicion', async ({ me, body }) => ({ item: await metas.guardarPosicion(me, body ?? {}) }));
  ruta('POST', /^\/api\/metas\/representante\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await metas.guardarRepresentante(me, p[1], body ?? {}) }));
  ruta('GET', '/api/metas/equipos', async ({ me, q }) => metas.equipos(me, { mes: q.get('mes') || undefined }));
  ruta('POST', /^\/api\/metas\/equipo\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await metas.guardarMetaEquipo(me, p[1], body ?? {}) }));
  ruta('GET', '/api/metas/avance', async ({ me, q }) => metas.avance(me, { mes: q.get('mes') || undefined, representanteId: q.get('representanteId') || undefined }));
  ruta('POST', '/api/medicos/documento/leer', async ({ me, body }) => medicos.leerDocumento(me, body?.archivo), { limite: 9 * 1024 * 1024 });
  ruta('POST', '/api/medicos/documento/confirmar', async ({ me, body }) => medicos.confirmarDocumento(me, body ?? {}), { limite: 4 * 1024 * 1024 });
  ruta('POST', /^\/api\/catalogo\/(farmacias|medicos)\/([\w-]+)\/validar$/, async ({ me, p }) => ({ item: await c.catalogo.validar(me, p[1], p[2]) }));

  // Dependientes: vouchers y comisiones
  ruta('GET', '/api/vouchers', async ({ me, q }) => ({ items: await c.vouchers.listar(me, { estado: q.get('estado') || undefined, dependienteId: q.get('dependienteId') || undefined }) }));
  ruta('POST', '/api/vouchers', async ({ me, body }) => {
    const item = await c.vouchers.crear(me, body ?? {});
    if (item.dependienteId !== me.id) avisar(() => n.notificar(item.dependienteId, { tipo: 'voucher', titulo: 'Voucher cargado a tu nombre', texto: `${me.fullName} cargó un voucher${item.referencia ? ` (${item.referencia})` : ''} por RD$${item.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Queda en revisión.`, enlace: '#misVouchers' }));
    return [201, { item }];
  }, { limite: 7 * 1024 * 1024 });
  ruta('POST', '/api/fotos/verificar', async ({ me, body }) => c.verificarFotos(me, body ?? {}), { limite: 512 * 1024 });
  ruta('POST', /^\/api\/vouchers\/([\w-]+)\/corregir$/, async ({ me, p, body }) => ({ item: await c.vouchers.corregir(me, p[1], body ?? {}) }));
  ruta('POST', '/api/vouchers/decidir', async ({ me, body }) => {
    const r = await c.vouchers.decidirLote(me, body ?? {});
    for (const id of r.ids ?? []) {
      avisar(async () => { const item = await data.get('vouchers', id); if (item) await n.notificar(item.dependienteId, { tipo: 'voucher', titulo: item.estado === 'aprobado' ? 'Voucher aprobado' : 'Voucher rechazado', texto: `Tu voucher del ${item.fecha} por RD$${Number(item.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })} fue ${item.estado}${item.motivo ? `: ${item.motivo}` : '.'}${item.corregible ? ' Corrígelo en Mis vouchers antes de que termine el mes; si no, se elimina.' : ''}`, enlace: '#misVouchers' }); });
    }
    return { hechos: r.hechos, errores: r.errores };
  }, { limite: 512 * 1024 });
  ruta('GET', '/api/vouchers/dependientes', async ({ me }) => ({ items: await c.vouchers.dependientesDeZona(me) }));
  ruta('GET', '/api/vouchers/porcentaje', async ({ me, q }) => ({ item: await c.vouchers.porcentaje(me, q.get('dependienteId')) }));
  ruta('POST', /^\/api\/vouchers\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => {
    const item = await c.vouchers.decidir(me, p[1], p[2] === 'aprobar', body?.motivo, { corregible: body?.corregible });
    avisar(() => n.notificar(item.dependienteId, { tipo: 'voucher', titulo: item.estado === 'aprobado' ? 'Voucher aprobado' : 'Voucher rechazado', texto: `Tu voucher del ${item.fecha}${item.referencia ? ` (${item.referencia})` : ''} por RD$${Number(item.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })} fue ${item.estado}${item.motivo ? `: ${item.motivo}` : '.'}${item.corregible ? ' Corrígelo en Mis vouchers antes de que termine el mes; si no, se elimina.' : ''}`, enlace: '#misVouchers' }));
    return { item };
  });
  ruta('POST', /^\/api\/vouchers\/([\w-]+)\/anular$/, async ({ me, p }) => ({ item: await c.vouchers.anular(me, p[1]) }));
  ruta('GET', '/api/comisiones/config', async ({ me }) => c.comisiones.verConfig(me));
  ruta('POST', '/api/comisiones/config', async ({ me, body }) => ({ item: await c.comisiones.configurar(me, body) }));
  ruta('GET', '/api/comisiones/resumen', async ({ me, q }) => c.comisiones.resumen(me, q.get('dependienteId') || me.id, q.get('periodo') || undefined));
  ruta('GET', '/api/comisiones/cierres', async ({ me, q }) => ({ items: await c.comisiones.listarCierres(me, q.get('dependienteId') || (me.role === 'dependiente' ? me.id : undefined)) }));
  ruta('POST', '/api/comisiones/cierres', async ({ me, body }) => [201, { item: await c.comisiones.cerrar(me, body.dependienteId, body.periodo) }]);
  ruta('GET', '/api/dependientes', async ({ me }) => {
    if (!['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(me.role) || me.status !== 'activo') throw new AuthError(403, 'No tienes permiso para esta acción.');
    return { items: (await store.listUsers()).filter((u) => u.role === 'dependiente' && u.status === 'activo').map(publico) };
  });

  // Promotoras: operativos, recetas, inventario y alertas
  ruta('GET', '/api/operativos', async ({ me, q }) => ({ items: await c.promotoras.listarOperativos(me, { fecha: q.get('fecha') || undefined }) }));
  ruta('POST', '/api/operativos', async ({ me, body }) => [201, { item: await c.promotoras.crearOperativo(me, body) }]);
  ruta('GET', '/api/recetas', async ({ me, q }) => ({ items: await c.promotoras.listarRecetas(me, { mes: q.get('mes') || undefined, estado: q.get('estado') || undefined }) }));
  // Revisión de recetas (promotoras y médicos): aprobar, rechazar, en lote. Aviso a quien la cargó.
  const avisoReceta = (id) => avisar(async () => {
    const r = await data.get('recetas', id); if (!r) return;
    const est = r.estado === 'aprobada' ? 'aprobada' : 'rechazada';
    await n.notificar(r.cargadoPor ?? r.promotoraId, { tipo: 'receta', titulo: `Receta ${est}`, texto: `Tu receta del ${r.fecha} fue ${est}${r.motivo ? `: ${r.motivo}` : '.'}`, enlace: '#misRecetas' });
  });
  ruta('POST', /^\/api\/recetas\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => {
    const item = await c.promotoras.decidirReceta(me, p[1], p[2] === 'aprobar', body?.motivo, { corregible: body?.corregible });
    avisoReceta(item.id); return { item };
  });
  ruta('POST', '/api/recetas/decidir', async ({ me, body }) => {
    const r = await c.promotoras.decidirRecetasLote(me, body ?? {});
    for (const id of r.ids) avisoReceta(id);
    return { hechos: r.hechos, errores: r.errores };
  }, { limite: 512 * 1024 });
  // Médico: su ficha (especialidad y lugares de trabajo)
  ruta('GET', '/api/medico/perfil', async ({ me }) => { if (me.role !== 'medico') throw new AuthError(403, 'Solo para médicos.'); return { item: await medicos.deCuenta(me.id), especialidades: medicos.especialidades() }; });
  ruta('POST', '/api/medico/perfil', async ({ me, body }) => ({ item: await medicos.actualizarMiPerfil(me, body ?? {}) }));
  ruta('GET', '/api/ventas/estado', async () => ({ ia: ventas.iaActiva() }));
  ruta('POST', '/api/ventas/leer', async ({ me, body }) => ventas.leer(me, body?.archivo), { limite: MAX_BODY_ADJUNTO + 1024 * 1024 });
  ruta('POST', '/api/ventas/confirmar', async ({ me, body }) => [201, await ventas.confirmar(me, body ?? {})], { limite: 4 * 1024 * 1024 });
  ruta('GET', '/api/ventas', async ({ me, q }) => ({ items: await ventas.listar(me, { mes: q.get('mes') || undefined }) }));
  ruta('GET', '/api/pacientes', async ({ me, q }) => (q.get('nombre') != null ? c.promotoras.buscarPacientesPorNombre(me, q.get('nombre')) : c.promotoras.buscarPaciente(me, q.get('telefono'))));
  ruta('POST', '/api/recetas', async ({ me, body }) => [201, await c.promotoras.crearReceta(me, body)], { limite: MAX_BODY_ADJUNTO });
  ruta('POST', '/api/inventario', async ({ me, body }) => [201, { item: await c.promotoras.registrarInventario(me, body) }]);
  ruta('GET', '/api/alertas', async ({ me, q }) => ({ umbral: await c.promotoras.umbral(), items: await c.promotoras.misAlertas(me, q.get('mes') || undefined) }));
  ruta('POST', '/api/alertas/umbral', async ({ me, body }) => ({ item: await c.promotoras.configurarUmbral(me, body.umbral) }));
  ruta('GET', '/api/reportes/recetas', async ({ me, q }) => c.reporteRecetas(me, { mes: q.get('mes'), agrupar: q.get('agrupar') }));

  // Cronogramas (los crea y aprueba el administrador)
  ruta('GET', '/api/cronogramas', async ({ me, q }) => ({ items: await v.listarCronogramas(me, { representanteId: q.get('representanteId') || undefined, mes: q.get('mes') || undefined }) }));
  ruta('POST', '/api/cronogramas', async ({ me, body }) => [201, { items: await v.crearCronograma(me, body) }]);
  ruta('POST', '/api/cronogramas/propuesta', async ({ me, body }) => ({ item: await v.proponerCronograma(me, body ?? {}) }));
  ruta('POST', '/api/cronogramas/copiar-mes-anterior', async ({ me, body }) => ({ item: await v.copiarMesAnterior(me, body ?? {}) }));
  ruta('POST', /^\/api\/cronogramas\/([\w-]+)\/hotel$/, async ({ me, p, body }) => ({ item: await v.hotelDeCronograma(me, p[1], body ?? {}) }));
  ruta('GET', '/api/viaticos/hotel-referencia', async ({ me }) => ({ item: await v.verReferenciaHotel(me) }));
  ruta('POST', '/api/viaticos/hotel-referencia', async ({ me, body }) => ({ item: await v.guardarReferenciaHotel(me, body ?? {}) }));
  ruta('POST', '/api/cronogramas/lote', async ({ me, body }) => [201, { items: await v.crearCronogramaLote(me, body ?? {}) }]);
  // Hoteles (hospedaje): Google aporta los datos; la administración confirma precio y requisitos
  ruta('GET', '/api/hoteles/requisitos', () => ({ items: Object.entries(REQUISITOS).map(([value, label]) => ({ value, label })) }));
  ruta('GET', '/api/hoteles', async ({ me, q }) => ({ items: await hoteles.listar(me, { provincia: q.get('provincia') || undefined, municipio: q.get('municipio') || undefined }) }));
  ruta('GET', '/api/hoteles/recomendado', async ({ me, q }) => ({ item: await hoteles.recomendado(me, { provincia: q.get('provincia'), municipio: q.get('municipio') || undefined }) }));
  ruta('POST', '/api/hoteles', async ({ me, body }) => [201, { item: await hoteles.crear(me, body ?? {}) }]);
  ruta('POST', '/api/hoteles/lote', async ({ me, body }) => ({ item: await hoteles.estadoLote(me, body?.ids, body?.estado) }));
  ruta('POST', /^\/api\/hoteles\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await hoteles.actualizar(me, p[1], body ?? {}) }));
  // Tope mensual global de combustible / transporte
  ruta('GET', '/api/viaticos/tarifas-publico', async ({ me }) => { if (me?.status !== 'activo') throw new AuthError(403, 'No tienes permiso para esta acción.'); return { item: await v.verTarifasPublico() }; });
  ruta('POST', '/api/viaticos/tarifas-publico', async ({ me, body }) => ({ item: await v.guardarTarifasPublico(me, body ?? {}) }));
  ruta('GET', '/api/viaticos/tope-global', async ({ me }) => { if (me?.status !== 'activo') throw new AuthError(403, 'No tienes permiso para esta acción.'); return { item: { monto: await v.verTopeGlobal() } }; });
  ruta('POST', '/api/viaticos/tope-global', async ({ me, body }) => ({ item: await v.guardarTopeGlobal(me, body?.monto ?? null) }));
  ruta('POST', /^\/api\/cronogramas\/([\w-]+)\/anular$/, async ({ me, p, body }) => ({ item: await v.anularCronograma(me, p[1], body.motivo) }));
  ruta('GET', /^\/api\/cronogramas\/([\w-]+)\/ruta$/, async ({ me, p }) => v.vistaPreviaRuta(me, p[1]));
  // Notificaciones (campana)
  ruta('GET', '/api/notificaciones', async ({ me, q }) => n.listar(me, { limite: q.get('limite') }));
  ruta('POST', '/api/notificaciones/leer-todas', async ({ me }) => n.marcarTodas(me));
  ruta('POST', /^\/api\/notificaciones\/([\w-]+)\/leer$/, async ({ me, p }) => ({ item: await n.marcar(me, p[1]) }));

  // Territorio, establecimientos, zonas, pre-registro e importación
  ruta('GET', '/api/territorio/division', () => t.division(), { auth: false });
  ruta('GET', '/api/territorio/mis-provincias', async ({ me }) => { const z = await t.zonaActor(me); return { items: await t.provinciasDe(me), municipios: z?.municipios ?? null }; });
  ruta('GET', '/api/territorio/establecimientos', async ({ me, q }) => ({ items: await t.listarEstablecimientos(me, { provincia: q.get('provincia') || undefined, municipio: q.get('municipio') || undefined, tipo: q.get('tipo') || undefined, q: q.get('q') || undefined, ver: q.get('ver') || undefined }) }));
  ruta('POST', '/api/territorio/establecimientos/descartar', async ({ me, body }) => ({ item: await t.descartarEstablecimientos(me, body?.ids, body?.motivo) }));
  ruta('POST', /^\/api\/territorio\/establecimientos\/([\w-]+)\/restaurar$/, async ({ me, p }) => ({ item: await t.restaurarEstablecimiento(me, p[1]) }));
  ruta('POST', '/api/territorio/establecimientos', async ({ me, body }) => [201, { item: await t.crearEstablecimiento(me, body) }]);
  ruta('POST', /^\/api\/territorio\/establecimientos\/([\w-]+)\/validar$/, async ({ me, p }) => ({ item: await t.validarEstablecimiento(me, p[1]) }));
  ruta('GET', '/api/territorio/zonas', async ({ me }) => ({ items: await t.listarZonas(me) }));
  ruta('GET', /^\/api\/territorio\/zonas\/([\w-]+)$/, async ({ me, p }) => ({ item: await t.verZona(me, p[1]) }));
  ruta('GET', '/api/territorio/zonas-ocupadas', async ({ me, q }) => ({ items: await t.zonasOcupadas(me, q.get('posicion'), q.get('excluir') || null) }));
  ruta('POST', /^\/api\/territorio\/zonas\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await t.asignarZona(me, p[1], body ?? {}) }));
  ruta('GET', /^\/api\/territorio\/zonas\/([\w-]+)\/lugares$/, async ({ me, p }) => t.lugaresDeZona(me, p[1]));
  ruta('POST', /^\/api\/territorio\/zonas\/([\w-]+)\/excluidos$/, async ({ me, p, body }) => ({ item: await t.excluirLugares(me, p[1], body ?? {}) }));
  ruta('POST', /^\/api\/territorio\/zonas\/([\w-]+)\/excluidos$/, async ({ me, p, body }) => ({ item: await t.excluirLugares(me, p[1], body ?? {}) }));
  ruta('GET', '/api/territorio/preregistros', async ({ me }) => ({ items: await t.listarPreregistros(me) }));
  ruta('POST', /^\/api\/territorio\/preregistros\/([\w-]+)\/anular$/, async ({ me, p }) => ({ item: await t.anularPreregistro(me, p[1]) }));
  ruta('POST', /^\/api\/importar\/(medicamentos|farmacias|establecimientos|representantes)$/, async ({ me, p, body }) => t.importar(me, p[1], body), { limite: 12 * 1024 * 1024 });
  ruta('POST', /^\/api\/catalogo\/medicamentos\/([\w-]+)\/precios$/, async ({ me, p, body }) => ({ item: await t.cambiarPrecio(me, p[1], body ?? {}) }));
  ruta('GET', /^\/api\/catalogo\/medicamentos\/([\w-]+)\/precios$/, async ({ me, p }) => ({ items: await t.historialPrecio(me, p[1]) }));
  // Búsqueda en Google Maps (solo gestión, cuesta por consulta)
  ruta('GET', '/api/territorio/google/estado', () => ({ activo: lugares.activo }));
  ruta('GET', '/api/territorio/ubicacion', async ({ me, q }) => ubicacionGoogle(me, q));
  ruta('GET', '/api/territorio/ubicacion-enlace', async ({ me, q }) => enlaceGoogle(me, q));
  ruta('GET', '/api/territorio/google/buscar', async ({ me, q }) => buscarGoogle(me, q));
  ruta('POST', '/api/territorio/google/agregar', async ({ me, body }) => [201, await agregarGoogle(me, body)]);
  ruta('GET', '/api/territorio/google/barrido', async ({ me }) => { puedeBarrido(me); return { item: await barrido.estado() }; });
  ruta('GET', '/api/territorio/google/barrido/estimar', async ({ me, q }) => {
    puedeBarrido(me); const a = alcanceBarrido({ tipo: q.get('tipo'), provincia: q.get('provincia'), municipio: q.get('municipio') });
    return { item: barrido.estimar(a) };
  });
  ruta('POST', '/api/territorio/google/barrido', async ({ me, body }) => {
    puedeBarrido(me);
    if (!lugares.activo) throw new AuthError(503, 'La búsqueda en Google Maps no está conectada todavía (falta MAPS_API_KEY).');
    const a = alcanceBarrido(body ?? {});
    try { return [202, { item: await barrido.iniciar(me, { ...a, continuar: body.continuar === true }) }]; }
    catch (err) { throw new AuthError(err.status ?? 500, err.message); }
  });

  // Rutas y viáticos
  ruta('GET', '/api/viaticos/combustibles', () => ({ items: Object.entries(COMBUSTIBLE_LABEL).map(([value, label]) => ({ value, label })) }));
  ruta('GET', '/api/viaticos/estado', () => ({ mapas: v.mapasActivo() }));
  ruta('POST', '/api/viaticos/calcular-km', async ({ me, body }) => v.calcularKm(me, body));
  ruta('GET', '/api/viaticos/representantes', async ({ me }) => ({ items: await v.listarRepresentantes(me) }));
  ruta('GET', /^\/api\/viaticos\/perfiles\/([\w-]+)$/, async ({ me, p }) => ({ item: await v.verPerfil(me, p[1]) }));
  ruta('POST', /^\/api\/viaticos\/perfiles\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await v.guardarPerfil(me, p[1], body) }));
  ruta('GET', '/api/viaticos/precios', async ({ me }) => ({ items: await v.listarPrecios(me) }));
  // Precios automáticos desde el aviso semanal del MICM
  const puedePrecios = (me) => me?.status === 'activo' && ['administrador', 'gerencia', 'finanzas'].includes(me.role);
  ruta('GET', '/api/viaticos/precios/micm', async ({ me }) => {
    if (me?.status !== 'activo') throw new AuthError(403, 'No tienes permiso para esta acción.');
    const [c] = await data.list('configuracion', { clave: 'micm_estado' });
    return { item: c?.valor ?? null };
  });
  ruta('POST', '/api/viaticos/precios/micm', async ({ me }) => {
    if (!puedePrecios(me)) throw new AuthError(403, 'Solo finanzas o la gerencia actualizan precios.');
    return { item: await actualizarDesdeMicm({ data, audit: (e) => store.addAudit({ ...e, actorId: me.id }), fetchImpl: micmFetch, now: now ?? (() => new Date()) }) };
  });
  ruta('POST', '/api/viaticos/precios', async ({ me, body }) => [201, { item: await v.registrarPrecio(me, body) }]);
  ruta('GET', '/api/viaticos/jornadas', async ({ me, q }) => ({ items: await v.listarJornadas(me, { representanteId: q.get('representanteId') || undefined, mes: q.get('mes') || undefined }) }));
  ruta('POST', '/api/viaticos/jornadas', async ({ me, body }) => [201, { item: await v.crearJornada(me, body) }]);
  ruta('POST', /^\/api\/viaticos\/jornadas\/([\w-]+)\/(realizada|cancelar|hospedaje|visita)$/, async ({ me, p, body }) => ({ item: await v.actualizarJornada(me, p[1], p[2], body) }));
  ruta('GET', '/api/viaticos/presupuesto', async ({ me, q }) => v.verPresupuesto(me, q.get('representanteId') || me.id, q.get('mes')));
  ruta('POST', '/api/viaticos/presupuestos/asignar', async ({ me, body }) => {
    const item = await v.asignarPresupuesto(me, body?.representanteId, body?.mes);
    avisar(() => n.notificar(item.representanteId, { tipo: 'viaticos', titulo: 'Viáticos del mes asignados', texto: `La gerencia asignó tus viáticos de ${item.mes}: RD$${item.montoAprobado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Registra tus gastos a medida que cumples tus jornadas.`, enlace: `#presupuesto?mes=${item.mes}` }));
    return [201, { item }];
  });
  ruta('POST', '/api/viaticos/presupuesto/solicitar', async ({ me, body }) => {
    const item = await v.solicitar(me, body.mes);
    avisar(() => n.notificarRoles(['administrador', 'gerencia'], { tipo: 'viaticos', titulo: 'Presupuesto de viáticos por aprobar', texto: `${me.fullName} solicitó el presupuesto de ${item.mes}.`, enlace: `#viatico?rep=${me.id}&mes=${item.mes}` }));
    return { item };
  });
  ruta('GET', /^\/api\/viaticos\/presupuestos\/([\w-]+)$/, async ({ me, p }) => ({ item: await v.presupuestoPorId(me, p[1]) }));
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => {
    const item = await v.decidirPresupuesto(me, p[1], p[2] === 'aprobar', body);
    avisar(() => n.notificar(item.representanteId, { tipo: 'viaticos', titulo: item.estado === 'aprobado' ? 'Viáticos aprobados' : 'Viáticos rechazados', texto: item.estado === 'aprobado' ? `Tu presupuesto de ${item.mes} fue aprobado.` : `Tu presupuesto de ${item.mes} fue rechazado: ${item.motivo}`, enlace: `#presupuesto?mes=${item.mes}` }));
    if (item.estado === 'aprobado') avisar(() => n.notificarRoles(['finanzas'], { tipo: 'viaticos', titulo: 'Viáticos por desembolsar', texto: `El presupuesto de ${item.mes} está aprobado y espera desembolso.`, enlace: `#viatico?rep=${item.representanteId}&mes=${item.mes}` }));
    return { item };
  });
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/desembolsos$/, async ({ me, p, body }) => {
    const item = await v.desembolsar(me, p[1], body);
    avisar(() => n.notificar(item.representanteId, { tipo: 'viaticos', titulo: 'Desembolso registrado', texto: `Finanzas registró un desembolso de tus viáticos de ${item.mes}.`, enlace: `#presupuesto?mes=${item.mes}` }));
    return { item };
  });
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/gastos$/, async ({ me, p, body }) => [201, { item: await v.reportarGasto(me, p[1], body) }], { limite: MAX_BODY_ADJUNTO });
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/gastos\/([\w-]+)\/(aceptar|rechazar)$/, async ({ me, p, body }) => ({ item: await v.revisarGasto(me, p[1], p[2], p[3] === 'aceptar', body.motivo) }));
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/liquidar$/, async ({ me, p }) => ({ item: await v.liquidar(me, p[1]) }));
  ruta('GET', '/api/viaticos/consolidado', async ({ me, q }) => v.consolidado(me, q.get('mes')));

  // ---------------------------------------------------------------- tienda para farmacias
  ruta('GET', '/api/tienda/productos', async ({ me }) => ({ items: await tienda.productos(me), conPrecio: Boolean(me) }), { auth: 'opcional' });
  ruta('GET', /^\/api\/tienda\/productos\/([\w-]+)$/, async ({ me, p }) => ({ item: await tienda.producto(me, p[1]), conPrecio: Boolean(me) }), { auth: 'opcional' });
  ruta('GET', /^\/api\/tienda\/imagen\/([\w.-]+)$/, async ({ p }) => ({ raw: await tienda.imagen(p[1]) }), { auth: false });
  ruta('GET', '/api/tienda/admin', async ({ me }) => ({ items: await tienda.fichaAdmin(me), fotosSitio: tienda.fotosSitio() }));
  ruta('POST', /^\/api\/tienda\/admin\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await tienda.editarProducto(me, p[1], body ?? {}) }));
  ruta('POST', /^\/api\/tienda\/admin\/([\w-]+)\/foto$/, async ({ me, p, body }) => ({ item: await tienda.agregarFoto(me, p[1], body?.foto) }), { limite: 8 * 1024 * 1024 });
  ruta('GET', '/api/pedidos', async ({ me, q }) => ({ items: await tienda.listarPedidos(me, { estado: q.get('estado') || undefined }), pagos: tienda.PAGOS, estados: tienda.ESTADOS }));
  ruta('POST', '/api/pedidos', async ({ me, body }) => [201, { item: await tienda.crearPedido(me, body ?? {}) }], { limite: 8 * 1024 * 1024 });
  ruta('POST', /^\/api\/pedidos\/([\w-]+)\/estado$/, async ({ me, p, body }) => ({ item: await tienda.cambiarEstado(me, p[1], body ?? {}) }));
  ruta('POST', /^\/api\/pedidos\/([\w-]+)\/comprobante$/, async ({ me, p, body }) => ({ item: await tienda.subirComprobante(me, p[1], body?.comprobante) }), { limite: 8 * 1024 * 1024 });

  ruta('GET', /^\/api\/adjuntos\/([\w.-]+)$/, async ({ me, p }) => {
    const f = await files.get(p[1]);
    const gestion = ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(me.role) && me.status === 'activo';
    if (!f || (!gestion && f.ownerId !== me.id)) throw new AuthError(404, 'Archivo no encontrado.');
    return { raw: f };
  });

  const manejador = async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null, origin);
      const r = R.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Ruta no encontrada.' }, origin);
      const [, re, h, o] = r;
      let me = null;
      if (o.auth === 'opcional') {
        // Público, pero con sesión válida muestra más (ej. precios de la tienda).
        me = await currentUser(req).catch(() => null);
        if (me && (me.status !== 'activo' || me.debeCambiarClave)) me = null;
      } else if (o.auth) {
        me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Inicia sesión.' }, origin);
        if (me.status !== 'activo') return send(res, 403, { error: 'Tu cuenta no está activa.' }, origin);
        // Con contraseña temporal solo puede ver su sesión y cambiarla.
        if (me.debeCambiarClave && !['/api/auth/me', '/api/auth/cambiar-clave'].includes(url.pathname)) return send(res, 403, { error: 'Cambia tu contraseña temporal para continuar.', cambiarClave: true }, origin);
      }
      const body = req.method === 'POST' ? await readJson(req, o.limite ?? MAX_BODY) : {};
      const out = await h({ me, body, q: url.searchParams, p: url.pathname.match(re) });
      if (out && out.raw) return send(res, 200, null, origin, out.raw);
      const [status, payload] = Array.isArray(out) ? out : [200, out];
      return send(res, status, payload, origin);
    } catch (err) {
      if (err instanceof AuthError) return send(res, err.status, { error: err.message, fields: err.fields }, origin);
      if (err && /^(Fecha|Período|Tipo de período) inválid/.test(err.message)) return send(res, 422, { error: err.message }, origin);
      console.error(err);
      return send(res, 500, { error: 'Error interno. Intenta de nuevo.' }, origin);
    }
  };
  manejador.comercial = c; // para tareas programadas (limpieza mensual)
  return manejador;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DATABASE_URL, SESSION_SECRET, ALLOWED_ORIGINS = '', PORT = 8080, NODE_ENV, UPLOAD_DIR = './uploads' } = process.env;
  if (NODE_ENV === 'production' && !DATABASE_URL) { console.error('DATABASE_URL es obligatorio en producción.'); process.exit(1); }
  let store, data;
  if (DATABASE_URL) { store = await PostgresStore.connect(DATABASE_URL); data = new PgData(store.pool); }
  else { store = new MemoryStore(); data = new MemoryData(); console.warn('⚠ Sin DATABASE_URL: usando memoria (solo desarrollo, los datos se pierden).'); }
  const secret = SESSION_SECRET ?? (NODE_ENV === 'production' ? null : 'dev-only-secret-change-me-0123456789abcdef');
  if (!secret) { console.error('SESSION_SECRET es obligatorio.'); process.exit(1); }
  const app = createApp({ store, data, files: crearArchivos(process.env, UPLOAD_DIR), mapas: crearMapas(), lugares: crearLugares(), correo: crearCorreo(), lectorIA: createLectorIA({ apiKey: process.env.ANTHROPIC_API_KEY, modelo: process.env.ANTHROPIC_MODELO || undefined }), sitio: process.env.SITIO_URL || 'https://fersuaz-web.pages.dev', sessionSecret: secret, allowedOrigins: ALLOWED_ORIGINS.split(',').filter(Boolean) });
  createServer(app).listen(PORT, () => console.log(`API FERSUAZ en :${PORT}`));
  // Vouchers rechazados que no se corrigieron en su mes: se eliminan al empezar el mes siguiente (al arrancar y cada 6 horas).
  if (DATABASE_URL) {
    const limpiar = () => app.comercial.vouchers.limpiarRechazados()
      .then((r) => { if (r?.eliminados) console.log(`Vouchers rechazados eliminados: ${r.eliminados}`); }).catch((e) => console.error('Limpieza de vouchers:', e.message));
    setTimeout(limpiar, 90_000).unref();
    setInterval(limpiar, 6 * 3600_000).unref();
  }
  // Revisión automática del aviso semanal del MICM: al arrancar y cada 6 horas (desactivar con MICM_AUTO=off).
  if (DATABASE_URL && process.env.MICM_AUTO !== 'off') {
    const revisar = () => actualizarDesdeMicm({ data, audit: (e) => store.addAudit(e) })
      .then((r) => console.log(`MICM: ${r.estado}. ${r.mensaje ?? ''}`)).catch((e) => console.error('MICM:', e.message));
    setTimeout(revisar, 60_000).unref();
    setInterval(revisar, 6 * 3600_000).unref();
  }
}

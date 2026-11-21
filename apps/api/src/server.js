import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore, PostgresStore } from './store.js';
import { MemoryData, PgData } from './data.js';
import { MemoryFiles, crearArchivos } from './files.js';
import { createAuthService, AuthError } from './auth.js';
import { createComercial } from './comercial.js';
import { createViaticos, COMBUSTIBLE_LABEL } from './viaticos.js';
import { SinMapas, crearMapas } from './mapas.js';
import { createTerritorio } from './territorio.js';
import { createNotificaciones } from './notificaciones.js';
import { SinCorreo, crearCorreo } from './correo.js';
import { canApprove } from './roles.js';
import { actualizarDesdeMicm } from './combustible-micm.js';
import { SinLugares, crearLugares } from './lugares.js';
import { createBarrido } from './barrido-google.js';
import { createHoteles, REQUISITOS } from './hoteles.js';
import { createInicio } from './inicio.js';
import { createVehiculos, createVehiculosAgregados } from './vehiculos.js';
import { createAltaRepresentantes } from './representantes.js';
import { createBanco, BANCOS, TIPOS_CUENTA } from './banco.js';
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

export function createApp({ store, data = new MemoryData(), files = new MemoryFiles(), mapas = new SinMapas(), lugares = new SinLugares(), correo = new SinCorreo(), sitio = 'https://fersuaz.net', micmFetch = fetch, vehiculosFetch = fetch, barridoPausa, sessionSecret, allowedOrigins = [], now }) {
  const n = createNotificaciones({ data, users: store, correo, sitio });
  const avisar = (fn) => fn().catch((e) => console.error('Notificación:', e.message));
  const t = createTerritorio({ data, users: store, audit: (e) => store.addAudit(e), now });
  const farmaciaActiva = async (id) => { const f = await data.get('farmacias', id); return f && !['inactiva', 'inactivo'].includes(f.estado) ? f : null; };
  const auth = createAuthService(store, { preregistro: { buscar: t.buscarPreregistro, confirmar: t.confirmarPreregistro }, farmaciaPara: farmaciaActiva });
  const c = createComercial({ data, users: store, files, audit: (e) => store.addAudit(e), now });
  const hoteles = createHoteles({ data, audit: (e) => store.addAudit(e), now: now ?? (() => new Date()) });
  const v = createViaticos({ data, users: store, files, mapas, hoteles, notificar: n.notificar, audit: (e) => store.addAudit(e), now });

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
  const banco = createBanco({ data, users: store, audit: (e) => store.addAudit(e) });
  const altas = createAltaRepresentantes({ store, t, v });
  const inicio = createInicio({ data, users: store, v, c, t, now: now ?? (() => new Date()) });

  // Registro automático desde Google Maps (recorre municipios y guarda lo que falte)
  const barrido = createBarrido({
    data, lugares, now: now ?? (() => new Date()), pausa: barridoPausa ?? 250, notificar: n.notificar, audit: (e) => store.addAudit(e),
    guardar: (actor, tipo, l) => tipo === 'farmacia'
      ? c.catalogo.crearFarmacia(actor, { nombre: l.nombre, provincia: l.provincia, municipio: l.municipio }, l, { revisado: true })
      : tipo === 'hotel' ? hoteles.crear(actor, l, { fuente: 'google' })
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
    if (!['farmacia', 'hotel', 'salud'].includes(src.tipo) && !tipos[src.tipo]) throw new AuthError(422, 'Elige el tipo de establecimiento.');
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

  ruta('GET', '/api/health', () => ({ ok: true }), { auth: false });
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
  ruta('POST', '/api/auth/cambiar-clave', async ({ me, body }) => ({ item: await auth.cambiarMiClave(me, body?.actual, body?.nueva) }));
  // Alta de representantes por el administrador
  ruta('POST', '/api/representantes', async ({ me, body }) => [201, await altas.alta(me, body ?? {})]);
  ruta('POST', /^\/api\/representantes\/([\w-]+)\/clave$/, async ({ me, p }) => altas.restablecerClave(me, p[1]));
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
  ruta('GET', '/api/catalogo/farmacias', async () => ({ items: await c.catalogo.listarFarmacias() }));
  ruta('POST', '/api/catalogo/farmacias', async ({ me, body }) => [201, { item: await c.catalogo.crearFarmacia(me, body) }]);
  ruta('GET', '/api/catalogo/medicos', async () => ({ items: await c.catalogo.listarMedicos() }));
  ruta('POST', '/api/catalogo/medicos', async ({ me, body }) => [201, { item: await c.catalogo.crearMedico(me, body) }]);
  ruta('POST', /^\/api\/catalogo\/(farmacias|medicos)\/([\w-]+)\/validar$/, async ({ me, p }) => ({ item: await c.catalogo.validar(me, p[1], p[2]) }));

  // Dependientes: vouchers y comisiones
  ruta('GET', '/api/vouchers', async ({ me, q }) => ({ items: await c.vouchers.listar(me, { estado: q.get('estado') || undefined, dependienteId: q.get('dependienteId') || undefined }) }));
  ruta('POST', '/api/vouchers', async ({ me, body }) => {
    const item = await c.vouchers.crear(me, body ?? {});
    if (item.dependienteId !== me.id) avisar(() => n.notificar(item.dependienteId, { tipo: 'voucher', titulo: 'Voucher cargado a tu nombre', texto: `${me.fullName} cargó el voucher ${item.referencia} por RD$${item.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Queda en revisión.`, enlace: '#misVouchers' }));
    return [201, { item }];
  });
  ruta('GET', '/api/vouchers/dependientes', async ({ me }) => ({ items: await c.vouchers.dependientesDeZona(me) }));
  ruta('GET', '/api/vouchers/porcentaje', async ({ me, q }) => ({ item: await c.vouchers.porcentaje(me, q.get('dependienteId')) }));
  ruta('POST', /^\/api\/vouchers\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => {
    const item = await c.vouchers.decidir(me, p[1], p[2] === 'aprobar', body.motivo);
    avisar(() => n.notificar(item.dependienteId, { tipo: 'voucher', titulo: item.estado === 'aprobado' ? 'Voucher aprobado' : 'Voucher rechazado', texto: `Tu voucher ${item.referencia} fue ${item.estado}${item.motivo ? `: ${item.motivo}` : '.'}`, enlace: '#misVouchers' }));
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
  ruta('GET', '/api/recetas', async ({ me, q }) => ({ items: await c.promotoras.listarRecetas(me, { mes: q.get('mes') || undefined }) }));
  ruta('GET', '/api/pacientes', async ({ me, q }) => c.promotoras.buscarPaciente(me, q.get('telefono')));
  ruta('POST', '/api/recetas', async ({ me, body }) => [201, await c.promotoras.crearReceta(me, body)], { limite: MAX_BODY_ADJUNTO });
  ruta('POST', '/api/inventario', async ({ me, body }) => [201, { item: await c.promotoras.registrarInventario(me, body) }]);
  ruta('GET', '/api/alertas', async ({ me, q }) => ({ umbral: await c.promotoras.umbral(), items: await c.promotoras.misAlertas(me, q.get('mes') || undefined) }));
  ruta('POST', '/api/alertas/umbral', async ({ me, body }) => ({ item: await c.promotoras.configurarUmbral(me, body.umbral) }));
  ruta('GET', '/api/reportes/recetas', async ({ me, q }) => c.reporteRecetas(me, { mes: q.get('mes'), agrupar: q.get('agrupar') }));

  // Cronogramas (los crea y aprueba el administrador)
  ruta('GET', '/api/cronogramas', async ({ me, q }) => ({ items: await v.listarCronogramas(me, { representanteId: q.get('representanteId') || undefined, mes: q.get('mes') || undefined }) }));
  ruta('POST', '/api/cronogramas', async ({ me, body }) => [201, { items: await v.crearCronograma(me, body) }]);
  ruta('POST', '/api/cronogramas/propuesta', async ({ me, body }) => ({ item: await v.proponerCronograma(me, body ?? {}) }));
  ruta('POST', '/api/cronogramas/lote', async ({ me, body }) => [201, { items: await v.crearCronogramaLote(me, body ?? {}) }]);
  // Hoteles (hospedaje): Google aporta los datos; la administración confirma precio y requisitos
  ruta('GET', '/api/hoteles/requisitos', () => ({ items: Object.entries(REQUISITOS).map(([value, label]) => ({ value, label })) }));
  ruta('GET', '/api/hoteles', async ({ me, q }) => ({ items: await hoteles.listar(me, { provincia: q.get('provincia') || undefined, municipio: q.get('municipio') || undefined }) }));
  ruta('GET', '/api/hoteles/recomendado', async ({ me, q }) => ({ item: await hoteles.recomendado(me, { provincia: q.get('provincia'), municipio: q.get('municipio') || undefined }) }));
  ruta('POST', '/api/hoteles', async ({ me, body }) => [201, { item: await hoteles.crear(me, body ?? {}) }]);
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
  ruta('GET', /^\/api\/territorio\/zonas\/([\w-]+)$/, async ({ me, p }) => ({ item: await t.verZona(me, p[1]) }));
  ruta('GET', '/api/territorio/zonas-ocupadas', async ({ me, q }) => ({ items: await t.zonasOcupadas(me, q.get('posicion'), q.get('excluir') || null) }));
  ruta('POST', /^\/api\/territorio\/zonas\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await t.asignarZona(me, p[1], body ?? {}) }));
  ruta('GET', /^\/api\/territorio\/zonas\/([\w-]+)\/lugares$/, async ({ me, p }) => t.lugaresDeZona(me, p[1]));
  ruta('GET', '/api/territorio/preregistros', async ({ me }) => ({ items: await t.listarPreregistros(me) }));
  ruta('POST', /^\/api\/territorio\/preregistros\/([\w-]+)\/anular$/, async ({ me, p }) => ({ item: await t.anularPreregistro(me, p[1]) }));
  ruta('POST', /^\/api\/importar\/(medicamentos|farmacias|establecimientos|representantes)$/, async ({ me, p, body }) => t.importar(me, p[1], body), { limite: 12 * 1024 * 1024 });
  ruta('GET', /^\/api\/catalogo\/medicamentos\/([\w-]+)\/precios$/, async ({ me, p }) => ({ items: await t.historialPrecio(me, p[1]) }));
  // Búsqueda en Google Maps (solo gestión, cuesta por consulta)
  ruta('GET', '/api/territorio/google/estado', () => ({ activo: lugares.activo }));
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
  ruta('POST', /^\/api\/viaticos\/jornadas\/([\w-]+)\/(realizada|cancelar|hospedaje)$/, async ({ me, p, body }) => ({ item: await v.actualizarJornada(me, p[1], p[2], body) }));
  ruta('GET', '/api/viaticos/presupuesto', async ({ me, q }) => v.verPresupuesto(me, q.get('representanteId') || me.id, q.get('mes')));
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

  ruta('GET', /^\/api\/adjuntos\/([\w.-]+)$/, async ({ me, p }) => {
    const f = await files.get(p[1]);
    const gestion = ['administrador', 'gerencia', 'supervisor', 'finanzas'].includes(me.role) && me.status === 'activo';
    if (!f || (!gestion && f.ownerId !== me.id)) throw new AuthError(404, 'Archivo no encontrado.');
    return { raw: f };
  });

  return async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null, origin);
      const r = R.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!r) return send(res, 404, { error: 'Ruta no encontrada.' }, origin);
      const [, re, h, o] = r;
      let me = null;
      if (o.auth) {
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DATABASE_URL, SESSION_SECRET, ALLOWED_ORIGINS = '', PORT = 8080, NODE_ENV, UPLOAD_DIR = './uploads' } = process.env;
  if (NODE_ENV === 'production' && !DATABASE_URL) { console.error('DATABASE_URL es obligatorio en producción.'); process.exit(1); }
  let store, data;
  if (DATABASE_URL) { store = await PostgresStore.connect(DATABASE_URL); data = new PgData(store.pool); }
  else { store = new MemoryStore(); data = new MemoryData(); console.warn('⚠ Sin DATABASE_URL: usando memoria (solo desarrollo, los datos se pierden).'); }
  const secret = SESSION_SECRET ?? (NODE_ENV === 'production' ? null : 'dev-only-secret-change-me-0123456789abcdef');
  if (!secret) { console.error('SESSION_SECRET es obligatorio.'); process.exit(1); }
  const app = createApp({ store, data, files: crearArchivos(process.env, UPLOAD_DIR), mapas: crearMapas(), lugares: crearLugares(), correo: crearCorreo(), sitio: process.env.SITIO_URL || 'https://fersuaz-web.pages.dev', sessionSecret: secret, allowedOrigins: ALLOWED_ORIGINS.split(',').filter(Boolean) });
  createServer(app).listen(PORT, () => console.log(`API FERSUAZ en :${PORT}`));
  // Revisión automática del aviso semanal del MICM: al arrancar y cada 6 horas (desactivar con MICM_AUTO=off).
  if (DATABASE_URL && process.env.MICM_AUTO !== 'off') {
    const revisar = () => actualizarDesdeMicm({ data, audit: (e) => store.addAudit(e) })
      .then((r) => console.log(`MICM: ${r.estado}. ${r.mensaje ?? ''}`)).catch((e) => console.error('MICM:', e.message));
    setTimeout(revisar, 60_000).unref();
    setInterval(revisar, 6 * 3600_000).unref();
  }
}

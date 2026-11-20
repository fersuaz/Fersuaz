import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore, PostgresStore } from './store.js';
import { MemoryData, PgData } from './data.js';
import { MemoryFiles, LocalFiles } from './files.js';
import { createAuthService, AuthError } from './auth.js';
import { createComercial } from './comercial.js';
import { createViaticos, COMBUSTIBLE_LABEL } from './viaticos.js';
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

export function createApp({ store, data = new MemoryData(), files = new MemoryFiles(), sessionSecret, allowedOrigins = [], now }) {
  const auth = createAuthService(store);
  const c = createComercial({ data, users: store, files, audit: (e) => store.addAudit(e), now });
  const v = createViaticos({ data, users: store, files, audit: (e) => store.addAudit(e), now });

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
  ruta('POST', '/api/auth/register', async ({ body }) => [201, { user: await auth.register(body), message: 'Solicitud recibida. Te avisaremos cuando la gerencia la apruebe.' }], { auth: false });
  ruta('POST', '/api/auth/login', async ({ body }) => {
    const user = await auth.login(body.email, body.password);
    return { user, token: signSession({ sub: user.id, role: user.role }, sessionSecret) };
  }, { auth: false });
  ruta('GET', '/api/auth/me', ({ me }) => ({ user: publico(me) }));
  ruta('GET', '/api/auth/pending', async ({ me }) => ({
    pending: (await store.listUsersByStatus('pendiente_aprobacion')).map(publico).filter((u) => u.id !== me.id),
  }));
  ruta('POST', /^\/api\/auth\/requests\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p }) => ({ user: await auth.decide(me, p[1], p[2] === 'aprobar') }));

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
  ruta('POST', '/api/vouchers', async ({ me, body }) => [201, { item: await c.vouchers.crear(me, body) }]);
  ruta('POST', /^\/api\/vouchers\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => ({ item: await c.vouchers.decidir(me, p[1], p[2] === 'aprobar', body.motivo) }));
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
  ruta('POST', '/api/recetas', async ({ me, body }) => [201, await c.promotoras.crearReceta(me, body)], { limite: MAX_BODY_ADJUNTO });
  ruta('POST', '/api/inventario', async ({ me, body }) => [201, { item: await c.promotoras.registrarInventario(me, body) }]);
  ruta('GET', '/api/alertas', async ({ me, q }) => ({ umbral: await c.promotoras.umbral(), items: await c.promotoras.misAlertas(me, q.get('mes') || undefined) }));
  ruta('POST', '/api/alertas/umbral', async ({ me, body }) => ({ item: await c.promotoras.configurarUmbral(me, body.umbral) }));
  ruta('GET', '/api/reportes/recetas', async ({ me, q }) => c.reporteRecetas(me, { mes: q.get('mes'), agrupar: q.get('agrupar') }));

  // Rutas y viáticos
  ruta('GET', '/api/viaticos/combustibles', () => ({ items: Object.entries(COMBUSTIBLE_LABEL).map(([value, label]) => ({ value, label })) }));
  ruta('GET', '/api/viaticos/representantes', async ({ me }) => ({ items: await v.listarRepresentantes(me) }));
  ruta('GET', /^\/api\/viaticos\/perfiles\/([\w-]+)$/, async ({ me, p }) => ({ item: await v.verPerfil(me, p[1]) }));
  ruta('POST', /^\/api\/viaticos\/perfiles\/([\w-]+)$/, async ({ me, p, body }) => ({ item: await v.guardarPerfil(me, p[1], body) }));
  ruta('GET', '/api/viaticos/precios', async ({ me }) => ({ items: await v.listarPrecios(me) }));
  ruta('POST', '/api/viaticos/precios', async ({ me, body }) => [201, { item: await v.registrarPrecio(me, body) }]);
  ruta('GET', '/api/viaticos/jornadas', async ({ me, q }) => ({ items: await v.listarJornadas(me, { representanteId: q.get('representanteId') || undefined, mes: q.get('mes') || undefined }) }));
  ruta('POST', '/api/viaticos/jornadas', async ({ me, body }) => [201, { item: await v.crearJornada(me, body) }]);
  ruta('POST', /^\/api\/viaticos\/jornadas\/([\w-]+)\/(realizada|cancelar|hospedaje)$/, async ({ me, p, body }) => ({ item: await v.actualizarJornada(me, p[1], p[2], body) }));
  ruta('GET', '/api/viaticos/presupuesto', async ({ me, q }) => v.verPresupuesto(me, q.get('representanteId') || me.id, q.get('mes')));
  ruta('POST', '/api/viaticos/presupuesto/solicitar', async ({ me, body }) => ({ item: await v.solicitar(me, body.mes) }));
  ruta('GET', /^\/api\/viaticos\/presupuestos\/([\w-]+)$/, async ({ me, p }) => ({ item: await v.presupuestoPorId(me, p[1]) }));
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/(aprobar|rechazar)$/, async ({ me, p, body }) => ({ item: await v.decidirPresupuesto(me, p[1], p[2] === 'aprobar', body) }));
  ruta('POST', /^\/api\/viaticos\/presupuestos\/([\w-]+)\/desembolsos$/, async ({ me, p, body }) => ({ item: await v.desembolsar(me, p[1], body) }));
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
  const app = createApp({ store, data, files: new LocalFiles(UPLOAD_DIR), sessionSecret: secret, allowedOrigins: ALLOWED_ORIGINS.split(',').filter(Boolean) });
  createServer(app).listen(PORT, () => console.log(`API FERSUAZ en :${PORT}`));
}

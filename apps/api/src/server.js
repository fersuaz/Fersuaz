import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore, PostgresStore } from './store.js';
import { createAuthService, AuthError } from './auth.js';
import { signSession, verifySession } from './security.js';
import { POSITIONS, ROLE_LABELS, SELF_REGISTERABLE } from './roles.js';

const MAX_BODY = 32 * 1024;

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new AuthError(413, 'La solicitud es demasiado grande.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new AuthError(400, 'El cuerpo no es JSON válido.'); }
}

export function createApp({ store, sessionSecret, allowedOrigins = [] }) {
  const auth = createAuthService(store);

  function send(res, status, body, origin) {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    };
    if (origin && allowedOrigins.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-headers'] = 'content-type, authorization';
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      headers.vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }

  async function currentUser(req) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const s = verifySession(token, sessionSecret);
    return s ? store.findUserById(s.sub) : null;
  }

  return async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null, origin);

      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true }, origin);

      if (req.method === 'GET' && url.pathname === '/api/auth/options') {
        return send(res, 200, {
          roles: SELF_REGISTERABLE.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
          positions: POSITIONS,
        }, origin);
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        const user = await auth.register(await readJson(req));
        return send(res, 201, { user, message: 'Solicitud recibida. Te avisaremos cuando la gerencia la apruebe.' }, origin);
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const { email, password } = await readJson(req);
        const user = await auth.login(email, password);
        return send(res, 200, { user, token: signSession({ sub: user.id, role: user.role }, sessionSecret) }, origin);
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/pending') {
        const me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Inicia sesión.' }, origin);
        const pending = (await store.listUsersByStatus('pendiente_aprobacion'))
          .map(({ passwordHash, ...u }) => u)
          .filter((u) => u.id !== me.id);
        return send(res, 200, { pending }, origin);
      }

      const m = url.pathname.match(/^\/api\/auth\/requests\/([\w-]+)\/(aprobar|rechazar)$/);
      if (req.method === 'POST' && m) {
        const me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Inicia sesión.' }, origin);
        const user = await auth.decide(me, m[1], m[2] === 'aprobar');
        return send(res, 200, { user }, origin);
      }

      return send(res, 404, { error: 'Ruta no encontrada.' }, origin);
    } catch (err) {
      if (err instanceof AuthError) return send(res, err.status, { error: err.message, fields: err.fields }, origin);
      console.error(err);
      return send(res, 500, { error: 'Error interno. Intenta de nuevo.' }, origin);
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DATABASE_URL, SESSION_SECRET, ALLOWED_ORIGINS = '', PORT = 8080, NODE_ENV } = process.env;
  if (NODE_ENV === 'production' && !DATABASE_URL) {
    console.error('DATABASE_URL es obligatorio en producción.'); process.exit(1);
  }
  const store = DATABASE_URL ? await PostgresStore.connect(DATABASE_URL) : new MemoryStore();
  if (!DATABASE_URL) console.warn('⚠ Sin DATABASE_URL: usando memoria (solo desarrollo, los datos se pierden).');
  const secret = SESSION_SECRET ?? (NODE_ENV === 'production' ? null : 'dev-only-secret-change-me-0123456789abcdef');
  if (!secret) { console.error('SESSION_SECRET es obligatorio.'); process.exit(1); }
  const app = createApp({ store, sessionSecret: secret, allowedOrigins: ALLOWED_ORIGINS.split(',').filter(Boolean) });
  createServer(app).listen(PORT, () => console.log(`API FERSUAZ en :${PORT}`));
}

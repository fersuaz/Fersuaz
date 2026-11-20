// Notificaciones del sistema: campana en el panel y, si SES está configurado, correo al usuario.
import { AuthError as HttpError } from './auth.js';
import { STATUS } from './roles.js';
import { plantilla } from './correo.js';

export function createNotificaciones({ data, users, correo, sitio = 'https://fersuaz.net', log = console }) {
  const activo = (u) => u && u.status === STATUS.ACTIVO;

  /** Crea la notificación y envía el correo en segundo plano (si falla, queda marcado; la campana no se pierde). */
  async function notificar(usuarioId, { tipo, titulo, texto, enlace = null }, { conCorreo = true } = {}) {
    const n = await data.insert('notificaciones', { usuarioId, tipo, titulo, texto, enlace, leida: false, correo: conCorreo && correo?.activo ? 'pendiente' : 'no' });
    if (n.correo === 'pendiente') {
      (async () => {
        const u = await users.findUserById(usuarioId);
        if (!u?.email) return data.update('notificaciones', n.id, { correo: 'error' });
        const p = plantilla({ nombre: u.fullName.split(' ')[0], titulo, texto, enlace, sitio });
        try { await correo.enviar({ para: u.email, asunto: `FERSUAZ · ${titulo}`, texto: p.texto, html: p.html }); await data.update('notificaciones', n.id, { correo: 'enviado' }); }
        catch (e) { log.error?.(`Correo no enviado (${tipo}):`, e.message); await data.update('notificaciones', n.id, { correo: 'error' }); }
      })().catch(() => {});
    }
    return n;
  }
  /** Notifica a todos los usuarios activos de los roles indicados (por ejemplo, quienes aprueban). */
  async function notificarRoles(roles, payload, opciones) {
    const us = (await users.listUsers()).filter((u) => u.status === STATUS.ACTIVO && roles.includes(u.role));
    for (const u of us) await notificar(u.id, payload, opciones);
    return us.length;
  }
  async function listar(actor, { limite = 30 } = {}) {
    if (!activo(actor)) throw new HttpError(403, 'Inicia sesión.');
    const xs = (await data.list('notificaciones', { usuarioId: actor.id })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { items: xs.slice(0, Math.min(Number(limite) || 30, 100)), sinLeer: xs.filter((x) => !x.leida).length };
  }
  async function marcar(actor, id) {
    const n = await data.get('notificaciones', id);
    if (!n || n.usuarioId !== actor?.id) throw new HttpError(404, 'La notificación no existe.');
    return data.update('notificaciones', id, { leida: true });
  }
  async function marcarTodas(actor) {
    if (!activo(actor)) throw new HttpError(403, 'Inicia sesión.');
    const xs = (await data.list('notificaciones', { usuarioId: actor.id })).filter((x) => !x.leida);
    for (const x of xs) await data.update('notificaciones', x.id, { leida: true });
    return { marcadas: xs.length };
  }
  return { notificar, notificarRoles, listar, marcar, marcarTodas };
}

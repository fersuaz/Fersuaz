// Envío de correos con Amazon SES (API v2), firmado con SigV4 propio. Sin dependencias.
// Variables: SES_ACCESS_KEY, SES_SECRET_KEY, SES_REGION (us-east-1), SES_REMITENTE ("FERSUAZ <notificaciones@fersuaz.net>").
import { firmarS3, sha256Hex } from './files.js';

export class SinCorreo { activo = false; async enviar() { return { enviado: false }; } }

export class SesCorreo {
  activo = true;
  constructor({ accessKey, secretKey, region = 'us-east-1', remitente, fetchImpl = fetch }) {
    if (!accessKey || !secretKey || !remitente) throw new Error('SES necesita clave, secreto y remitente.');
    Object.assign(this, { accessKey, secretKey, region, remitente, fetch: fetchImpl });
    this.host = `email.${region}.amazonaws.com`;
  }
  async enviar({ para, asunto, texto, html }) {
    const body = JSON.stringify({
      FromEmailAddress: this.remitente,
      Destination: { ToAddresses: [para] },
      Content: { Simple: { Subject: { Data: asunto, Charset: 'UTF-8' }, Body: { Text: { Data: texto, Charset: 'UTF-8' }, ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}) } } },
    });
    const path = '/v2/email/outbound-emails';
    const headers = firmarS3({ method: 'POST', host: this.host, path, region: this.region, accessKey: this.accessKey, secretKey: this.secretKey,
      headers: { 'content-type': 'application/json' }, payloadHash: sha256Hex(body), servicio: 'ses' });
    let r;
    try { r = await this.fetch(`https://${this.host}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('No se pudo contactar a Amazon SES.'); }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(`SES respondió ${r.status}: ${d.message ?? 'error'}`);
    }
    return { enviado: true };
  }
}

export function crearCorreo(env = process.env) {
  const { SES_ACCESS_KEY, SES_SECRET_KEY, SES_REGION, SES_REMITENTE } = env;
  return SES_ACCESS_KEY && SES_SECRET_KEY && SES_REMITENTE
    ? new SesCorreo({ accessKey: SES_ACCESS_KEY, secretKey: SES_SECRET_KEY, region: SES_REGION || 'us-east-1', remitente: SES_REMITENTE })
    : new SinCorreo();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Plantilla de correo con la marca (colores corporativos, sin imágenes remotas). */
export function plantilla({ nombre, titulo, texto, enlace, sitio }) {
  const url = enlace ? `${sitio}/panel.html${enlace}` : `${sitio}/panel.html`;
  const plano = `Hola ${nombre},\n\n${titulo}\n${texto}\n\nAbrir FERSUAZ.NET: ${url}\n\nEste aviso se envió automáticamente. Puedes ver todas tus notificaciones en la campana del panel.`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F5F8FB;font-family:Arial,Helvetica,sans-serif;color:#0F2A44">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FB;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #C7D6E3">
<tr><td style="background:#003463;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.5px"><span style="color:#8FC3DB">FER</span>SUAZ</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;color:#52677A;font-size:14px">Hola ${esc(nombre)},</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#003463">${esc(titulo)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${esc(texto)}</p>
<a href="${esc(url)}" style="display:inline-block;background:#003463;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Abrir FERSUAZ.NET</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#E9F0F6;color:#52677A;font-size:12px">Aviso automático de FERSUAZ.NET. Todas tus notificaciones están en la campana del panel.</td></tr>
</table></td></tr></table></body></html>`;
  return { texto: plano, html };
}

/** Correo de bienvenida al representante: su usuario, los pasos para entrar y el enlace a la plataforma. */
export function bienvenida({ nombre, usuario, claveTemporal, claveInicialGlobal, sitio, motivo = 'alta' }) {
  const entrar = `${sitio}/entrar.html`;
  const cuenta = `${sitio}/panel.html#cuenta`;
  const titulo = motivo === 'nombre' ? 'Tu acceso a FERSUAZ.NET cambió' : motivo === 'clave' ? 'Tu contraseña de FERSUAZ.NET se restableció' : 'Bienvenido a FERSUAZ.NET';
  const clave = claveInicialGlobal ? 'la contraseña inicial que te dio la administración de FERSUAZ' : claveTemporal ? `esta contraseña temporal: ${claveTemporal}` : 'la contraseña que te dio la administración';
  const pasos = [
    `Entra en ${entrar}`,
    `Escribe tu usuario: ${usuario} (también puedes usar este correo).`,
    `Escribe ${clave}.`,
    'El sistema te pedirá crear tu propia contraseña (10 o más caracteres, con letras y números). No la compartas.',
    `Revisa y actualiza tus datos (teléfono y correo) en "Mi cuenta": ${cuenta}`,
    'Después, en "Mis jornadas" verás el cronograma que te programó la gerencia; desde cada día creas tu jornada y registras tus gastos.',
  ];
  const plano = `Hola ${nombre},\n\n${titulo}.\n\n${pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nSi no esperabas este correo, avisa a la administración de FERSUAZ.`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#F5F8FB;font-family:Arial,Helvetica,sans-serif;color:#0F2A44">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FB;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #C7D6E3">
<tr><td style="background:#003463;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.5px"><span style="color:#8FC3DB">FER</span>SUAZ</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;color:#52677A;font-size:14px">Hola ${esc(nombre)},</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#003463">${esc(titulo)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#E9F0F6;border-radius:12px;width:100%"><tr><td style="padding:14px 18px;font-size:15px">
<div style="color:#52677A;font-size:13px">Tu usuario</div><div style="font-size:20px;font-weight:bold;color:#003463;font-family:Consolas,Menlo,monospace">${esc(usuario)}</div>
${claveTemporal && !claveInicialGlobal ? `<div style="color:#52677A;font-size:13px;margin-top:8px">Contraseña temporal</div><div style="font-size:18px;font-weight:bold;color:#003463;font-family:Consolas,Menlo,monospace">${esc(claveTemporal)}</div>` : ''}
</td></tr></table>
<ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.6">${pasos.map((p) => `<li style="margin-bottom:6px">${esc(p)}</li>`).join('')}</ol>
<a href="${esc(entrar)}" style="display:inline-block;background:#003463;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Entrar a FERSUAZ.NET</a>
</td></tr>
<tr><td style="padding:16px 28px;background:#E9F0F6;color:#52677A;font-size:12px">Si no esperabas este correo, avisa a la administración de FERSUAZ. Nunca te pediremos tu contraseña por correo.</td></tr>
</table></td></tr></table></body></html>`;
  return { asunto: `FERSUAZ · ${titulo}`, texto: plano, html };
}

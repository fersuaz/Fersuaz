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

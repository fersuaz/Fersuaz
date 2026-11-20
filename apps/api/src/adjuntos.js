// Validación de archivos subidos (fotos de recetas y comprobantes de gastos).
import { AuthError as HttpError } from './auth.js';
import { normalizeName } from './validation.js';

const FIRMAS = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};
export const MAX_ADJUNTO = 5 * 1024 * 1024;

/** Valida tipo, tamaño y firma real del archivo; lo guarda y devuelve sus metadatos. */
export async function guardarAdjunto(files, actor, adj, nombrePorDefecto = 'archivo') {
  if (!adj) return null;
  const tipo = String(adj.tipo ?? '');
  const firma = FIRMAS[tipo];
  if (!firma) throw new HttpError(422, 'El archivo debe ser JPG, PNG, WEBP o PDF.', { adjunto: 'Formato no permitido.' });
  const buf = Buffer.from(String(adj.base64 ?? ''), 'base64');
  if (!buf.length) throw new HttpError(422, 'No se pudo leer el archivo.', { adjunto: 'Archivo vacío o dañado.' });
  if (buf.length > MAX_ADJUNTO) throw new HttpError(413, 'El archivo no puede pasar de 5 MB.', { adjunto: 'Archivo demasiado grande.' });
  if (!firma.every((b, i) => buf[i] === b)) throw new HttpError(422, 'El archivo no coincide con su formato.', { adjunto: 'Archivo no válido.' });
  if (!files) throw new HttpError(503, 'El almacenamiento de archivos todavía no está configurado.');
  const clave = await files.put(buf, tipo, actor.id);
  return { clave, tipo, tamano: buf.length, nombre: normalizeName(adj.nombre).slice(0, 120) || nombrePorDefecto };
}

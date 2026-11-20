// Lectura de hojas de cálculo sin dependencias: .xlsx (primera hoja) y .csv.
// Devuelve { columnas, filas } donde cada fila es un objeto { columna: valor } y lleva su número de fila de Excel.
import { inflateRawSync } from 'node:zlib';

const MAX_FILAS = 10000;

/** Lee las entradas de un ZIP a partir del directorio central. */
function leerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const archivos = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('El archivo Excel está dañado.');
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lNombre);
    archivos.set(nombre, { metodo, comprimido, local });
    p += 46 + lNombre + lExtra + lComent;
  }
  return (nombre) => {
    const e = archivos.get(nombre); if (!e) return null;
    const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const datos = buf.subarray(ini, ini + e.comprimido);
    if (e.metodo === 0) return datos.toString('utf8');
    if (e.metodo === 8) return inflateRawSync(datos, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
    throw new Error('Formato de compresión no soportado en el Excel.');
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const unirT = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => texto(m[1])).join('');
const colIdx = (ref) => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

function leerXlsx(buf) {
  const leer = leerZip(buf);
  const compartidos = [];
  const ss = leer('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidos.push(unirT(m[1]));
  // primera hoja según el libro y sus relaciones
  let ruta = 'xl/worksheets/sheet1.xml';
  const libro = leer('xl/workbook.xml'); const rels = leer('xl/_rels/workbook.xml.rels');
  const rid = libro?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const destino = rid && rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || rid && rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  if (destino) ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.\//, '')}`;
  const hoja = leer(ruta);
  if (!hoja) throw new Error('No se encontró la primera hoja del Excel.');
  const filas = [];
  for (const f of hoja.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const num = Number(f[1].match(/\br="(\d+)"/)?.[1] ?? filas.length + 1);
    const celdas = [];
    let i = 0;
    for (const c of f[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = c[1]; const ref = at.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIdx(ref) : i; i = idx + 1;
      const t = at.match(/\bt="(\w+)"/)?.[1]; const cuerpo = c[2] ?? '';
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (t === 's') val = compartidos[Number(v)] ?? '';
      else if (t === 'inlineStr') val = unirT(cuerpo);
      else if (t === 'str' || t === 'e') val = v != null ? texto(v) : '';
      else if (t === 'b') val = v === '1' ? 'SI' : 'NO';
      else val = v != null ? texto(v) : '';
      celdas[idx] = String(val).trim();
    }
    filas.push({ num, celdas });
    if (filas.length > MAX_FILAS + 1) throw new Error(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en partes.`);
  }
  return filas;
}

function leerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas = []; let celdas = []; let cel = ''; let comillas = false; let num = 1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) { if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') comillas = false; else cel += c; continue; }
    if (c === '"') comillas = true;
    else if (c === sep) { celdas.push(cel.trim()); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      celdas.push(cel.trim()); filas.push({ num: num++, celdas }); celdas = []; cel = '';
      if (filas.length > MAX_FILAS + 1) throw new Error(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en partes.`);
    } else cel += c;
  }
  if (cel || celdas.length) { celdas.push(cel.trim()); filas.push({ num, celdas }); }
  return filas;
}

/** Normaliza un encabezado: minúsculas, sin acentos ni símbolos ("Precio RD$" → "precio rd"). */
export const clave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Convierte un archivo en filas con encabezado. `tipo` es el MIME o la extensión.
 * La primera fila no vacía es el encabezado; las filas totalmente vacías se ignoran.
 */
export function leerHoja(buf, nombre = '') {
  const esXlsx = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (!esXlsx && /\.xls$/i.test(nombre)) throw new Error('El formato .xls antiguo no está soportado. Guárdalo como .xlsx (Excel) o .csv.');
  const crudas = (esXlsx ? leerXlsx(buf) : leerCsv(buf.toString('utf8'))).filter((f) => f.celdas.some((c) => c));
  if (!crudas.length) throw new Error('El archivo está vacío.');
  const [enc, ...resto] = crudas;
  const columnas = [...enc.celdas].map((c) => clave(c));
  if (!columnas.some(Boolean)) throw new Error('La primera fila debe tener los nombres de las columnas.');
  const filas = resto.map((f) => {
    const o = { _fila: f.num };
    columnas.forEach((col, i) => { if (col) o[col] = f.celdas[i] ?? ''; });
    return o;
  });
  return { columnas: columnas.filter(Boolean), filas };
}

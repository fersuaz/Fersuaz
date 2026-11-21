/**
 * Exportar tablas a Excel (.xlsx) y a PDF, sin librerías.
 * Excel: se arma el archivo .xlsx (un ZIP con XML) en el navegador.
 * PDF: se abre la vista de impresión con el encabezado de FERSUAZ; el navegador la guarda como PDF.
 */

// ---- ZIP sin compresión (suficiente para hojas de cálculo) ----
const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(archivos) {
  const enc = new TextEncoder(); const partes = []; const central = []; let offset = 0;
  for (const [nombre, texto] of archivos) {
    const datos = enc.encode(texto); const n = enc.encode(nombre); const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true); local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, datos);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, datos.length, true); cd.setUint32(24, datos.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), n);
    offset += 30 + n.length + datos.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true); fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** Montos "RD$ 1,900.00" y números "1,234" se guardan como número para poder sumar en Excel. */
function comoNumero(v) {
  const t = String(v ?? '').trim();
  if (!/^(RD\$\s*)?-?[\d,]+(\.\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/RD\$\s*/, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function descargarXlsx(nombre, titulo, encabezados, filas) {
  const anchos = encabezados.map((e, i) => Math.min(60, Math.max(10, String(e).length + 2, ...filas.slice(0, 300).map((f) => String(f[i] ?? '').length + 2))));
  const celda = (v, r, c, estilo) => {
    const ref = `${col(c)}${r}`; const n = estilo ? null : comoNumero(v);
    return n != null ? `<c r="${ref}"${String(v).includes('RD$') ? ' s="2"' : ''}><v>${n}</v></c>` : `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const filasXml = [
    `<row r="1">${celda(titulo, 1, 0, 3)}</row>`,
    `<row r="2">${encabezados.map((e, c) => celda(e, 2, c, 1)).join('')}</row>`,
    ...filas.map((f, i) => `<row r="${i + 3}">${f.map((v, c) => celda(v, i + 3, c)).join('')}</row>`),
  ].join('');
  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${filasXml}</sheetData><autoFilter ref="A2:${col(Math.max(0, encabezados.length - 1))}${filas.length + 2}"/></worksheet>`;
  const estilos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;RD$&quot;\\ #,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF003463"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF003463"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>';
  const blob = zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(titulo).slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', hoja],
    ['xl/styles.xml', estilos],
  ]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${nombre}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function imprimirPdf(titulo, encabezados, filas, { subtitulo = '' } = {}) {
  const fecha = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santo_Domingo' });
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${xml(titulo)}</title><style>
    @page { size: ${encabezados.length > 6 ? 'landscape' : 'portrait'}; margin: 14mm; }
    body { font-family: Figtree, Arial, sans-serif; color: #0F2A44; font-size: 10pt; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #003463; padding-bottom: 6px; margin-bottom: 10px; }
    header img { height: 30px; } h1 { font: 600 15pt Poppins, Arial, sans-serif; color: #003463; margin: 0 0 2px; } p { margin: 0; color: #52677A; }
    table { width: 100%; border-collapse: collapse; } th { background: #003463; color: #fff; text-align: left; padding: 5px 6px; font-weight: 600; }
    td { padding: 4px 6px; border-bottom: 1px solid #C7D6E3; vertical-align: top; } tr:nth-child(even) td { background: #F5F8FB; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; } footer { margin-top: 8px; color: #52677A; font-size: 8.5pt; }
  </style></head><body><header><div><h1>${xml(titulo)}</h1><p>${xml(subtitulo || `${filas.length} registro(s)`)} · ${xml(fecha)}</p></div><img src="${location.origin}/assets/brand/fersuaz-logo-color.svg" alt="FERSUAZ"></header>
  <table><thead><tr>${encabezados.map((e) => `<th>${xml(e)}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((v) => `<td>${xml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
  <footer>Generado desde la plataforma FERSUAZ.</footer></body></html>`;
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true'); marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.append(marco);
  marco.srcdoc = html;
  marco.onload = () => { const img = marco.contentDocument.querySelector('img'); const ir = () => { marco.contentWindow.focus(); marco.contentWindow.print(); setTimeout(() => marco.remove(), 60_000); }; if (img && !img.complete) { img.onload = ir; img.onerror = ir; } else ir(); };
}

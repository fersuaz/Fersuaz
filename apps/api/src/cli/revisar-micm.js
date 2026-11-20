// Lee el aviso más reciente del MICM y muestra los precios verificados, sin guardar nada.
// Uso: npm run revisar-micm   (en GitHub Actions imprime anotaciones ::notice / ::error)
import { URL_AVISOS, avisoMasReciente, preciosDePdf } from '../combustible-micm.js';
import { lineasPdf } from '../pdf-texto.js';

const gh = !!process.env.GITHUB_ACTIONS;
const nota = (tipo, msg) => console.log(gh ? `::${tipo} title=Aviso MICM::${msg}` : msg);
try {
  const html = await (await fetch(URL_AVISOS, { signal: AbortSignal.timeout(30000) })).text();
  const aviso = avisoMasReciente(html);
  if (!aviso) throw new Error('No se encontró el aviso más reciente en el listado.');
  const pdf = Buffer.from(await (await fetch(aviso.pdf, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
  const { precios } = preciosDePdf(pdf);
  nota('notice', `${aviso.titulo} (desde ${aviso.desde}) ${aviso.pdf} → ${JSON.stringify(precios)}`);
  if (Object.keys(precios).length < 5) {
    nota('error', 'No se verificaron los cinco combustibles.'); process.exitCode = 1;
    // Diagnóstico: cómo se leyeron las líneas (sin datos personales; es un documento público).
    const t = pdf.toString('latin1');
    nota('warning', `PDF ${pdf.length} bytes; cabecera ${t.slice(0, 8)}; objetos ${(t.match(/ obj\b/g) ?? []).length}; ObjStm ${(t.match(/\/ObjStm/g) ?? []).length}; filtros ${[...new Set(t.match(/\/Filter\s*\/?\[?\s*\/\w+/g) ?? [])].join(' ')}; fuentes ${[...new Set(t.match(/\/Subtype\s*\/(Type0|TrueType|Type1|Type3|CIDFontType2)/g) ?? [])].join(' ')}`);
    const pags = lineasPdf(pdf);
    nota('warning', `páginas ${pags.length}; líneas ${pags.map((p) => p.length).join(',')}`);
    for (const l of pags.flat().slice(0, 45)) nota('warning', `y=${Math.round(l.y)} ${l.texto.slice(0, 180)}`);
  }
} catch (e) { nota('error', e.message); process.exitCode = 1; }

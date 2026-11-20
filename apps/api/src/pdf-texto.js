// Extracción de texto de PDF con posición, sin dependencias. Pensado para avisos tabulares (MICM):
// devuelve las líneas de cada página reconstruidas por coordenada vertical y ordenadas de izquierda a derecha.
import { inflateSync } from 'node:zlib';

const latin1 = (b) => Buffer.from(b).toString('latin1');

function objetos(buf) {
  const txt = latin1(buf);
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(txt))) {
    const id = Number(m[1]);
    const ini = m.index + m[0].length;
    const fin = txt.indexOf('endobj', ini);
    if (fin < 0) break;
    const cuerpo = txt.slice(ini, fin);
    const s = cuerpo.indexOf('stream');
    if (s >= 0 && /^\s*<</.test(cuerpo)) {
      const dict = cuerpo.slice(0, s);
      let d0 = ini + s + 6;
      if (txt[d0] === '\r') d0++;
      if (txt[d0] === '\n') d0++;
      let d1 = txt.lastIndexOf('endstream', fin);
      const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      if (len && d0 + Number(len[1]) <= d1) d1 = d0 + Number(len[1]);
      objs.set(id, { dict, datos: buf.subarray(d0, d1) });
    } else objs.set(id, { dict: cuerpo });
    re.lastIndex = fin;
  }
  return objs;
}

function decodificar(o) {
  if (!o?.datos) return null;
  if (/\/FlateDecode/.test(o.dict) || /\/Fl\b/.test(o.dict)) {
    try { return inflateSync(o.datos); } catch { try { return inflateSync(o.datos, { finishFlush: 2 }); } catch { return null; } }
  }
  if (/\/Filter/.test(o.dict)) return null;
  return o.datos;
}

/** Expande los objetos guardados dentro de /ObjStm. */
function expandirObjStm(objs) {
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const d = decodificar(o); if (!d) continue;
    const n = Number(o.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0);
    const first = Number(o.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0);
    const t = latin1(d);
    const nums = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = nums[2 * i]; const off = first + nums[2 * i + 1];
      const fin = i + 1 < n ? first + nums[2 * i + 3] : t.length;
      if (!objs.has(id)) objs.set(id, { dict: t.slice(off, fin) });
    }
  }
}

const ref = (s, clave) => { const m = s?.match(new RegExp(`/${clave}\\s+(\\d+)\\s+\\d+\\s+R`)); return m ? Number(m[1]) : null; };

/** Diccionario (texto) que sigue a /Clave, ya sea en línea << >> o por referencia. */
function subDict(s, clave, objs) {
  const i = s?.search(new RegExp(`/${clave}\\b`));
  if (i == null || i < 0) return null;
  let j = i + clave.length + 1;
  while (/\s/.test(s[j])) j++;
  if (s.startsWith('<<', j)) {
    let prof = 0;
    for (let k = j; k < s.length - 1; k++) {
      if (s.startsWith('<<', k)) { prof++; k++; } else if (s.startsWith('>>', k)) { prof--; k++; if (!prof) return s.slice(j, k + 1); }
    }
    return null;
  }
  const r = s.slice(j).match(/^(\d+)\s+\d+\s+R/);
  return r ? objs.get(Number(r[1]))?.dict ?? null : null;
}

function hexBytes(h) { const s = h.replace(/[^0-9a-f]/gi, ''); const out = []; for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2).padEnd(2, '0'), 16)); return out; }
const hexTexto = (h) => { const b = hexBytes(h); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]); if (b.length % 2) s += String.fromCharCode(b.at(-1)); return s; };

/** ToUnicode: códigos → texto. */
function leerCMap(texto) {
  const mapa = new Map(); let bytes = 1;
  const cs = texto.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/); if (cs) bytes = Math.max(1, cs[1].length / 2);
  for (const b of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) mapa.set(parseInt(p[1], 16), hexTexto(p[2]));
  }
  for (const b of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      const a = parseInt(p[1], 16), z = parseInt(p[2], 16);
      if (p[4] != null) { const base = hexTexto(p[4]); const ult = base.charCodeAt(base.length - 1); for (let c = a; c <= z && c - a < 65536; c++) mapa.set(c, base.slice(0, -1) + String.fromCharCode(ult + c - a)); }
      else { const xs = [...p[5].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexTexto(x[1])); for (let c = a; c <= z; c++) mapa.set(c, xs[c - a] ?? ''); }
    }
  }
  return { mapa, bytes };
}

function fuentes(recursos, objs) {
  const out = {};
  const dict = subDict(recursos, 'Font', objs);
  if (!dict) return out;
  for (const m of dict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const f = objs.get(Number(m[2]))?.dict ?? '';
    const tu = ref(f, 'ToUnicode');
    let cmap = null;
    if (tu != null) { const d = decodificar(objs.get(tu)); if (d) cmap = leerCMap(latin1(d)); }
    const doble = /\/Subtype\s*\/Type0/.test(f);
    out[m[1]] = { cmap, bytes: cmap?.bytes ?? (doble ? 2 : 1) };
  }
  return out;
}

function decodificarTexto(bytes, fuente) {
  if (!fuente?.cmap) return fuente?.bytes === 2 ? '' : Buffer.from(bytes).toString('latin1');
  let s = ''; const n = fuente.bytes;
  for (let i = 0; i + n - 1 < bytes.length; i += n) {
    let c = 0; for (let k = 0; k < n; k++) c = (c << 8) | bytes[i + k];
    s += fuente.cmap.mapa.get(c) ?? (n === 1 ? String.fromCharCode(c) : '');
  }
  return s;
}

/** Tokeniza un flujo de contenido PDF. */
function* tokens(t) {
  let i = 0; const L = t.length;
  while (i < L) {
    const c = t[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < L && t[i] !== '\n' && t[i] !== '\r') i++; continue; }
    if (c === '(') {
      let prof = 1; const out = []; i++;
      while (i < L && prof) {
        const ch = t[i];
        if (ch === '\\') {
          const n = t[i + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
          if (n in esc) { out.push(esc[n]); i += 2; }
          else if (/[0-7]/.test(n)) { const o = t.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]; out.push(parseInt(o, 8) & 255); i += 1 + o.length; }
          else if (n === '\r' || n === '\n') { i += 2; if (n === '\r' && t[i] === '\n') i++; }
          else { i++; }
          continue;
        }
        if (ch === '(') prof++;
        if (ch === ')') { prof--; if (!prof) { i++; break; } }
        out.push(ch.charCodeAt(0) & 255); i++;
      }
      yield { t: 'str', v: out }; continue;
    }
    if (c === '<' && t[i + 1] !== '<') { const j = t.indexOf('>', i); yield { t: 'str', v: hexBytes(t.slice(i + 1, j)) }; i = j + 1; continue; }
    if (c === '<' || c === '>') { i += 2; yield { t: 'op', v: c + c }; continue; }
    if (c === '[' || c === ']') { i++; yield { t: c }; continue; }
    if (c === '/') { let j = i + 1; while (j < L && !/[\s/[\]()<>{}%]/.test(t[j])) j++; yield { t: 'name', v: t.slice(i + 1, j) }; i = j; continue; }
    let j = i; while (j < L && !/[\s/[\]()<>{}%]/.test(t[j])) j++;
    if (j === i) { i++; continue; }
    const w = t.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { t: 'num', v: Number(w) }; else yield { t: 'op', v: w };
  }
}

const mult = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

function textoDePagina(contenido, fts) {
  const items = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const pila = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0], tl = 0, fuente = null, tam = 12;
  let ops = [];
  const emitir = (bytes) => {
    const s = decodificarTexto(bytes, fuente);
    if (!s) return;
    const m = mult(tm, ctm);
    items.push({ x: m[4], y: m[5], s, alto: Math.abs(tam * (m[3] || 1)) });
  };
  let arr = null;
  for (const tk of tokens(latin1(contenido))) {
    if (tk.t === '[') { arr = []; continue; }
    if (tk.t === ']') { ops.push({ t: 'arr', v: arr }); arr = null; continue; }
    if (arr) { arr.push(tk); continue; }
    if (tk.t !== 'op') { ops.push(tk); continue; }
    const a = ops.map((o) => o.v); const op = tk.v; ops = [];
    switch (op) {
      case 'q': pila.push(ctm); break;
      case 'Q': ctm = pila.pop() ?? [1, 0, 0, 1, 0, 0]; break;
      case 'cm': if (a.length >= 6) ctm = mult(a.slice(-6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': fuente = fts[a[0]] ?? null; tam = a[1] ?? tam; break;
      case 'TL': tl = a[0] ?? 0; break;
      case 'Tm': tm = a.slice(-6); tlm = tm.slice(); break;
      case 'Td': tlm = mult([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm.slice(); break;
      case 'TD': tl = -a[1]; tlm = mult([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm.slice(); break;
      case 'T*': tlm = mult([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); break;
      case 'Tj': if (Array.isArray(a[0])) emitir(a[0]); break;
      case "'": tlm = mult([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); if (Array.isArray(a[0])) emitir(a[0]); break;
      case '"': tlm = mult([1, 0, 0, 1, 0, -tl], tlm); tm = tlm.slice(); if (Array.isArray(a[2])) emitir(a[2]); break;
      case 'TJ': {
        const lista = a[0] ?? [];
        const partes = []; let pos = 0; let x0 = null;
        for (const e of lista) {
          if (e.t === 'str') { partes.push(...e.v); if (x0 == null) x0 = pos; }
          else if (e.t === 'num' && e.v < -200) partes.push(...(fuente?.bytes === 2 ? [0, 32] : [32]));
        }
        emitir(partes);
        break;
      }
      default:
    }
  }
  return items;
}

/** Devuelve las líneas de texto de cada página: [{ y, texto, celdas: [{x, s}] }]. */
export function lineasPdf(buf) {
  if (latin1(buf.subarray(0, 5)) !== '%PDF-') throw new Error('El archivo no es un PDF.');
  const objs = objetos(buf);
  expandirObjStm(objs);
  const paginas = [...objs.values()].filter((o) => /\/Type\s*\/Page(?!s)\b/.test(o.dict));
  const salida = [];
  for (const p of paginas) {
    let recursos = subDict(p.dict, 'Resources', objs) ?? '';
    const fts = fuentes(recursos, objs);
    const cont = p.dict.match(/\/Contents\s*(\[([^\]]*)\]|(\d+)\s+\d+\s+R)/);
    const ids = cont ? (cont[2] ? [...cont[2].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1])) : [Number(cont[3])]) : [];
    const datos = Buffer.concat(ids.map((id) => decodificar(objs.get(id)) ?? Buffer.alloc(0)).flatMap((b) => [b, Buffer.from('\n')]));
    const items = textoDePagina(datos, fts).filter((it) => it.s.trim());
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = [];
    for (const it of items) {
      const tol = Math.max(1.5, it.alto * 0.35);
      const l = lineas.find((x) => Math.abs(x.y - it.y) <= tol);
      if (l) l.celdas.push({ x: it.x, s: it.s }); else lineas.push({ y: it.y, celdas: [{ x: it.x, s: it.s }] });
    }
    for (const l of lineas) { l.celdas.sort((a, b) => a.x - b.x); l.texto = l.celdas.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim(); }
    salida.push(lineas.sort((a, b) => b.y - a.y));
  }
  return salida;
}

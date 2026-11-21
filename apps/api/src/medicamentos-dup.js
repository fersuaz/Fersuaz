// Medicamentos repetidos en el catálogo. "Tio dex" + "Jarabe de 120ml" y "Tio-Dex Jarabe 120 mL" se reconocen como el
// mismo producto. Exactos: mismo código, o mismo nombre + presentación sin tildes, espacios ni signos. Probables:
// mismas cifras (dosis, mL, unidades) y nombres muy parecidos.

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Clave compacta: "Ciprosay 500 mg" + "C/30 Capsulas" = "Ciprosay 500 mg C/30 Capsulas". */
export const claveMed = (nombre, presentacion) => sinAcentos(`${nombre ?? ''} ${presentacion ?? ''}`).replace(/\bde\b/g, '').replace(/[^a-z0-9]/g, '');
export const codigoMed = (v) => String(v ?? '').toUpperCase().replace(/\s+/g, '').trim();
const cifras = (t) => (sinAcentos(t).match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.')).sort().join('|');
const texto = (m) => `${m.nombre} ${m.presentacion ?? ''}`;
const VACIAS = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'c', 'x', 'frasco', 'fco', 'unidades', 'und', 'u']);
/** Palabras que importan: sin tildes, "120ml" → "120" "ml", sin palabras vacías (de, frasco, c/…). */
const palabras = (t) => new Set(sinAcentos(t).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w && !VACIAS.has(w)));
/** Parecido de 0 a 1 entre dos medicamentos (palabras en común). */
export function parecidoMed(a, b) {
  const A = palabras(a); const B = palabras(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

/** Grupos de repetidos entre los activos. Cada grupo: { exacto, motivo, items, conservar }. */
export function gruposRepetidos(meds) {
  const act = meds.filter((m) => m.activo !== false);
  const padre = new Map(act.map((m) => [m.id, m.id]));
  const raiz = (x) => { while (padre.get(x) !== x) x = padre.get(x); return x; };
  const unir = (a, b, motivo, exacto) => { const ra = raiz(a); const rb = raiz(b); if (ra !== rb) padre.set(rb, ra); razones.push({ a, b, motivo, exacto }); };
  const razones = [];
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const a = act[i]; const b = act[j];
    if (a.codigo && b.codigo && codigoMed(a.codigo) === codigoMed(b.codigo)) unir(a.id, b.id, 'mismo código', true);
    else if (claveMed(a.nombre, a.presentacion) === claveMed(b.nombre, b.presentacion)) unir(a.id, b.id, 'mismo nombre y presentación', true);
    else if (cifras(texto(a)) === cifras(texto(b)) && parecidoMed(texto(a), texto(b)) >= 0.85 && !(a.codigo && b.codigo)) unir(a.id, b.id, 'nombre muy parecido', false);
  }
  const grupos = new Map();
  for (const m of act) { const r = raiz(m.id); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(m); }
  return [...grupos.values()].filter((g) => g.length > 1).map((items) => {
    const ids = new Set(items.map((m) => m.id));
    const rz = razones.filter((r) => ids.has(r.a));
    // Se conserva el más completo: con código, con precio, el más antiguo.
    const conservar = [...items].sort((x, y) => Number(!!y.codigo) - Number(!!x.codigo) || Number(y.precio != null) - Number(x.precio != null) || String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')))[0];
    return { exacto: rz.every((r) => r.exacto), motivo: [...new Set(rz.map((r) => r.motivo))].join(', '), items, conservar: conservar.id };
  });
}

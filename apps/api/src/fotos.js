// Fotos repetidas de vouchers y recetas. Dos huellas por foto:
// - exacta: SHA-256 del archivo original (la misma foto enviada otra vez);
// - parecido: dHash de 1,024 bits (32×32): la misma imagen reenviada por WhatsApp o comprimida. Con esa
//   resolución, dos vouchers distintos con el mismo formato de farmacia no se confunden.
// Se compara contra todo lo cargado en el sistema, por cualquier persona.
// Medido: la misma imagen recomprimida o achicada difiere en 0 a 6 bits; vouchers distintos, en 85 o más.
export const UMBRAL_PARECIDO = 24; // bits distintos de 1,024 para considerarla la misma imagen

export const esHuella = (v) => /^[a-f0-9]{64}$/.test(String(v ?? ''));
export const esDhash = (v) => /^[a-f0-9]{256}$/.test(String(v ?? ''));
/** Bits distintos entre dos dHash en hexadecimal. */
export function distancia(a, b) {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
/** Registro anterior con la misma foto (exacta o muy parecida), o null. */
export function buscarRepetida(registros, { huella, dhash }) {
  for (const r of registros) {
    if (huella && r.fotoHuella === huella) return { registro: r, motivo: 'igual' };
    if (dhash && esDhash(r.fotoDhash) && distancia(dhash, r.fotoDhash) <= UMBRAL_PARECIDO) return { registro: r, motivo: 'parecida' };
  }
  return null;
}
const fechaLarga = (f) => { const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`); return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
export const textoRepetida = (rep, que) => `${rep.motivo === 'igual' ? 'Esta foto ya se cargó' : 'Esta foto es igual a otra ya cargada'} como ${que} del ${fechaLarga(rep.registro.fecha)}.`;

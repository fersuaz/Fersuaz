// URL de la API: <meta name="fersuaz-api" content="https://api.fersuaz.net">
export function apiBase() {
  const v = document.querySelector('meta[name="fersuaz-api"]')?.content?.trim();
  return v ? v.replace(/\/$/, '') : '';
}

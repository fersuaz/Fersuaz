// Scrollytelling: la ruta se dibuja según el avance de la jornada.
(() => {
  const route = document.getElementById('route');
  const steps = [...document.querySelectorAll('.step')];
  if (!route || !steps.length) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const len = route.getTotalLength();
  route.style.strokeDasharray = len;
  route.style.strokeDashoffset = reduce ? 0 : len;

  const stops = [...document.querySelectorAll('.stops circle')];
  const rows = [...document.querySelectorAll('.ledger > div')];
  const fmt = new Intl.NumberFormat('es-DO');
  const counted = new WeakSet();

  function countUp(el) {
    if (counted.has(el)) return; counted.add(el);
    const target = Number(el.dataset.count);
    if (reduce) { el.textContent = fmt.format(target); return; }
    const t0 = performance.now(), dur = 1100;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt.format(Math.round(target * e));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  let current = -1;
  function activate(i) {
    if (i === current) return; current = i;
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    stops.forEach((c, k) => c.classList.toggle('is-on', k <= i));
    rows.forEach((r) => {
      const on = Number(r.dataset.show) <= i;
      r.classList.toggle('is-on', on);
      r.classList.toggle('is-current', Number(r.dataset.show) === Math.max(1, i));
      if (on) r.querySelectorAll('[data-count]').forEach(countUp);
    });
  }

  // Avance continuo de la línea dentro del bloque de pasos.
  const list = document.querySelector('.steps');
  function onScroll() {
    const r = list.getBoundingClientRect();
    const vh = innerHeight;
    const p = Math.min(1, Math.max(0, (vh * 0.55 - r.top) / (r.height - vh * 0.45)));
    if (!reduce) route.style.strokeDashoffset = len * (1 - p);
    let idx = 0;
    steps.forEach((s, k) => { if (s.getBoundingClientRect().top < vh * 0.6) idx = k; });
    activate(idx);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();
})();

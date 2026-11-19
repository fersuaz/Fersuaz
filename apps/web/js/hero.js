// Hero cinematográfico: el video avanza y retrocede con el scroll.
// Estándar 10k-websites: Blob con anillo y vigilancia, lerp normalizado por tiempo,
// seeks con compuerta, escrituras al DOM solo con cambios, 5 compuertas en vivo.
(() => {
  const section = document.querySelector('.cine');
  if (!section) return;
  const stage = section.querySelector('.cine-stage');
  const video = section.querySelector('.cine-video');
  const poster = section.querySelector('.cine-poster');
  const ring = section.querySelector('.cine-ring');
  const bands = [...section.querySelectorAll('.band')].map((el) => ({
    el, a: +el.dataset.a, b: +el.dataset.b, fx: el.dataset.fx, ramp: el.dataset.ramp ? +el.dataset.ramp : null, op: -1, k: -1,
  }));

  const VIDEO_URL = 'assets/hero/hero-scrub.mp4';
  const POSTER_URL = 'assets/hero/hero-poster.jpg';
  const ENDING_URL = 'assets/hero/hero-ending.jpg';
  const VIDEO_BYTES = 12000000; // respaldo si el servidor no envía Content-Length

  // ---------- partir el texto en palabras/letras (semilla fija) ----------
  function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  bands.forEach((b, i) => {
    const line = b.el.querySelector('.band-line');
    const text = line.textContent.trim();
    const r = rng(1000 + i);
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = text;
    const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    const words = text.split(/\s+/);
    if (b.fx === 'blur') {
      vis.innerHTML = '';
      const soft = document.createElement('span'); soft.className = 'soft'; soft.textContent = text;
      const sharp = document.createElement('span'); sharp.className = 'sharp'; sharp.textContent = text;
      vis.append(soft, sharp);
    } else {
      words.forEach((w, n) => {
        const span = document.createElement('span'); span.className = 'w'; span.textContent = w;
        const th = (n / words.length) * 0.55 + r() * 0.05;
        span.style.setProperty('--th', th.toFixed(3));
        if (b.fx === 'halves') span.style.setProperty('--jx', (n < words.length / 2 ? -1 : 1) * (30 + r() * 20) + 'px');
        vis.append(span, document.createTextNode(n < words.length - 1 ? ' ' : ''));
      });
    }
    line.textContent = ''; line.append(sr, vis);
  });

  // ---------- progreso del hero ----------
  function heroProgress() {
    const r = section.getBoundingClientRect();
    const range = section.offsetHeight - innerHeight;
    return range > 0 ? Math.min(1, Math.max(0, -r.top / range)) : 0;
  }
  const smoothstep = (p, e0, e1) => { const t = Math.min(1, Math.max(0, (p - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  let loadK = 0;
  function updateCaptions(p) {
    bands.forEach((b, i) => {
      const f = Math.min(0.02, (b.b - b.a) / 3);
      const inE = i === 0 ? 1 : smoothstep(p, b.a, b.a + f);
      const outE = i === bands.length - 1 ? 0 : smoothstep(p, b.b - f, b.b);
      const op = +(inE * (1 - outE)).toFixed(3);
      let k = clamp((p - b.a) / (b.ramp || Math.min(0.025, (b.b - b.a) * 0.35)), 0, 1);
      if (i === 0) k = Math.max(k, loadK);
      if (Math.abs(op - b.op) > 0.004) { b.el.style.opacity = op; b.op = op; }
      if (Math.abs(k - b.k) > 0.008 || (k === 1 && b.k !== 1)) {
        b.el.style.setProperty('--k', k.toFixed(3));
        if (b.fx === 'rise') {
          b.el.style.setProperty('--ks', clamp((k - 0.66) * 4, 0, 1).toFixed(3));
          b.el.style.setProperty('--kb', clamp((k - 0.78) * 5, 0, 1).toFixed(3));
        }
        b.k = k;
      }
    });
  }

  // ---------- seeks con compuerta (sin bloqueos) ----------
  let seekBusy = false, pendingTime = null;
  function requestSeek(t) {
    if (!video.duration) return;
    if (seekBusy) { pendingTime = t; return; }
    seekBusy = true; video.currentTime = t;
  }
  video.addEventListener('seeked', () => {
    seekBusy = false;
    if (pendingTime !== null) { const t = pendingTime; pendingTime = null; requestSeek(t); }
  });
  video.addEventListener('error', () => { seekBusy = false; pendingTime = null; failVideo(); });

  // ---------- lerp que descansa ----------
  let target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true;
  function tick(now) {
    const dt = Math.min(100, now - (lastTick || now)); lastTick = now;
    shown += (target - shown) * (1 - Math.pow(1 - 0.16, dt / 16.667));
    if (Math.abs(target - shown) < 0.0005) { shown = target; rafId = null; lastTick = 0; }
    else rafId = requestAnimationFrame(tick);
    requestSeek(shown * (video.duration || 0));
    updateCaptions(shown);
  }
  function onScroll() {
    target = heroProgress();
    if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
  }
  new IntersectionObserver(([e]) => { heroOnScreen = e.isIntersecting; if (heroOnScreen) onScroll(); }).observe(section);

  // ---------- carga del video como Blob, con anillo y vigilancia ----------
  function failVideo() { stage.classList.add('video-failed'); video.removeAttribute('src'); }
  let started = false;
  async function loadHeroBlob() {
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error('video ' + res.status);
    const total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
    const reader = res.body.getReader(); const chunks = []; let got = 0, lastRing = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(watchdog); watchdog = setTimeout(() => ctrl.abort(), 20000);
      chunks.push(value); got += value.length;
      const frac = Math.min(1, got / total), now = performance.now();
      if (now - lastRing > 100 || frac === 1) { lastRing = now; ring.style.setProperty('--ld', Math.round(126 * (1 - frac))); }
    }
    clearTimeout(watchdog); ring.style.setProperty('--ld', 0);
    video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    video.load();
    video.addEventListener('canplay', () => { requestSeek(heroProgress() * video.duration); stage.classList.add('video-ready'); }, { once: true });
  }
  function startBlobFetch() { if (started) return; started = true; loadHeroBlob().catch(failVideo); }
  let inited = false;
  function initHeroOnce() {
    if (inited) return; inited = true;
    poster.style.backgroundImage = `url('${POSTER_URL}')`;
    const img = new Image(); img.onload = startBlobFetch; img.onerror = startBlobFetch; img.src = POSTER_URL;
    setTimeout(startBlobFetch, 4000);
    const t0 = performance.now();
    const ramp = (now) => { loadK = Math.min(1, (now - t0) / 1200); updateCaptions(heroProgress()); if (loadK < 1) requestAnimationFrame(ramp); };
    requestAnimationFrame(ramp);
  }

  // ---------- las 5 compuertas del hero fijo, en vivo ----------
  const GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)',
  ];
  let scrubOn = false, staticBgSet = false;
  function enableScrub() {
    if (scrubOn) return; scrubOn = true;
    initHeroOnce();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    bands.forEach((b) => { b.op = -1; b.k = -1; });
    updateCaptions(heroProgress()); onScroll();
  }
  function disableScrub() {
    if (!staticBgSet) { section.style.setProperty('--hero-static', `url('${ENDING_URL}'), radial-gradient(ellipse at 70% 30%, #3085AC, #003463 70%)`); staticBgSet = true; }
    if (!scrubOn) return; scrubOn = false;
    removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }
  function applyHeroMode() { GATES.some((q) => matchMedia(q).matches) ? disableScrub() : enableScrub(); }
  const MQLS = GATES.map((q) => matchMedia(q));
  MQLS.forEach((m) => m.addEventListener('change', applyHeroMode));
  applyHeroMode();

  // pausa animaciones con la pestaña oculta
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));
})();

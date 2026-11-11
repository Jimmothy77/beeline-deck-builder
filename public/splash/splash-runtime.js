/*
 * BeeLine splash runtime. Loaded by every splashes/<slug>.html.
 * <html data-slug="vader" data-duration="2200" data-poster="1700">
 *
 * URL params (all optional):
 *   ?t=1234      freeze at 1234 ms (renders, thumbnails)
 *   ?poster=1    freeze on the poster frame
 *   ?hold=1      at the end keep the last frame instead of fading/ending (preview tiles)
 *   ?noskip=1    hide the Skip button and ignore taps (preview tiles)
 *
 * Messages to parent (window.parent.postMessage):
 *   {type:'beeline-splash:ready', slug, duration}
 *   {type:'beeline-splash:end', slug, reason:'complete'|'skip'|'reduced-motion'}
 * Messages accepted from parent:
 *   {type:'beeline-splash:skip'} | {type:'beeline-splash:replay'} | {type:'beeline-splash:seek', t}
 */
(function () {
  const root = document.documentElement;
  const slug = root.dataset.slug || 'splash';
  const DURATION = +root.dataset.duration || 2200;
  const POSTER = +(root.dataset.poster || DURATION * 0.75);
  const q = new URLSearchParams(location.search);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hold = q.has('hold');
  const frameHooks = [];
  let t0 = 0, raf = 0, timer = 0, ended = false, frozen = false;

  if (q.has('noskip')) root.classList.add('bl-noskip');

  function post(msg) {
    msg.slug = slug;
    try { if (window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
    window.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
  }
  function anims() { return document.getAnimations ? document.getAnimations().filter(a => !(a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('bl-skip'))) : []; }
  function runHooks(t) { for (const fn of frameHooks) { try { fn(t); } catch (e) { console.error(e); } } }

  function seek(t) {
    frozen = true; root.classList.add('bl-frozen');
    cancelAnimationFrame(raf); clearTimeout(timer);
    anims().forEach(a => { a.pause(); a.currentTime = t; });
    runHooks(t);
  }
  function loop() {
    const t = performance.now() - t0;
    runHooks(Math.min(t, DURATION));
    if (t < DURATION) raf = requestAnimationFrame(loop);
  }
  function play() {
    ended = false; frozen = false;
    root.classList.remove('bl-out', 'bl-frozen');
    anims().forEach(a => { a.currentTime = 0; a.play(); });
    t0 = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    clearTimeout(timer);
    timer = setTimeout(() => end('complete'), DURATION);
  }
  function end(reason) {
    if (ended) return;
    if (reason === 'complete' && hold) { ended = true; return; }
    ended = true; clearTimeout(timer);
    root.style.setProperty('--bl-out', reason === 'skip' ? '150ms' : '240ms');
    root.classList.add('bl-out');
    setTimeout(() => {
      post({ type: 'beeline-splash:end', reason });
      if (typeof window.onSplashEnd === 'function') window.onSplashEnd(reason);
    }, reason === 'skip' ? 150 : 240);
  }
  function skip() { if (!frozen || reduce) end(reduce ? 'reduced-motion' : 'skip'); }

  // Skip button + input
  const btn = document.createElement('button');
  btn.className = 'bl-skip'; btn.type = 'button'; btn.textContent = 'Skip';
  btn.setAttribute('aria-label', 'Skip intro');
  btn.addEventListener('click', e => { e.stopPropagation(); skip(); });
  document.addEventListener('pointerup', () => { if (!root.classList.contains('bl-noskip')) skip(); });
  document.addEventListener('keydown', e => {
    if (root.classList.contains('bl-noskip')) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skip(); }
  });
  window.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'beeline-splash:skip') end('skip');
    else if (d.type === 'beeline-splash:replay') play();
    else if (d.type === 'beeline-splash:seek') seek(+d.t || 0);
  });

  window.BLSplash = {
    slug, duration: DURATION, poster: POSTER,
    onFrame(fn) { frameHooks.push(fn); },
    seek, play, skip: () => end('skip'),
    ready: null
  };

  function imgsReady() {
    return Promise.all([...document.images].map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
  }
  const loaded = new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r));
  const timeout = new Promise(r => setTimeout(r, 1500)); // never hang on a slow font
  BLSplash.ready = Promise.race([Promise.all([loaded, document.fonts ? document.fonts.ready : 0, imgsReady()]), timeout]).then(() => {
    document.body.appendChild(btn);
    root.classList.add('go');
    post({ type: 'beeline-splash:ready', duration: DURATION });
    if (q.has('t')) seek(+q.get('t'));
    else if (q.has('poster')) seek(POSTER);
    else if (reduce) {
      // Static poster frame, shown briefly, then auto-end (tap/Esc still ends early).
      seek(POSTER); frozen = true;
      timer = setTimeout(() => end('reduced-motion'), hold ? 1e9 : 1400);
    } else play();
  });
})();

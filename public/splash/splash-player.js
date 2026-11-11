/*
 * BeeLine splash player — drop-in for the Deck Builder app.
 *
 *   <script src="/splash/splash-player.js"></script>
 *   BeeLineSplash.configure({ base: '/splash/' });          // folder that holds splashes/, fonts/, assets/
 *   BeeLineSplash.playOnce(deck.id, deck.name, { onEnd: reason => openDeck() });
 *
 * Each splash is a standalone page (splashes/<slug>.html) shown in a full-viewport iframe overlay,
 * so its CSS can never leak into the app. Splashes skip on tap/click, Esc/Enter/Space, or the Skip
 * button, auto-end after ~2 s, and show a static poster when prefers-reduced-motion is set.
 */
(function (global) {
  const DECKS = {
    eggman:          { name: 'Dr. Eggman',          duration: 2200, bg: '#3a0004', match: ['eggman', 'dr. eggman', 'dr eggman'] },
    silksong:        { name: 'Silksong',            duration: 2400, bg: '#020b0c', match: ['silksong'] },
    'floating-world':{ name: 'Floating World',      duration: 2300, bg: '#efe4cb', match: ['floating world'] },
    horror:          { name: 'Horror Movie Poster', duration: 2200, bg: '#070504', match: ['horror', 'horror movie poster', 'secret lair'] },
    kpdh:            { name: 'KPDH',                duration: 2200, bg: '#0b0315', match: ['kpdh'] },
    nier:            { name: 'Nier',                duration: 2300, bg: '#2a2822', match: ['nier'] },
    persona5:        { name: 'Persona 5',           duration: 2200, bg: '#d6000f', match: ['persona 5', 'persona5', 'p5'] },
    sxf:             { name: 'SxF',                 duration: 2200, bg: '#14231e', match: ['sxf', 'spy x family'] },
    tmnt:            { name: 'TMNT',                duration: 2200, bg: '#0b120d', match: ['tmnt'] },
    vader:           { name: 'Vader',               duration: 2300, bg: '#000000', match: ['vader'] },
    xmen:            { name: 'X-Men',               duration: 2100, bg: '#0a1f6e', match: ['x-men', 'xmen', 'x men'] },
    beeline:         { name: 'BeeLine (fallback)',  duration: 2500, bg: '#d57528', match: [] },
    // Horror deck options (round 2). Empty match lists; the horror deck resolves to 'horror-c'
    // by default through cfg.use below. 'horror', 'horror-a' and 'horror-b' are unused alternates.
    'horror-a':      { name: 'Horror Movie Poster (option A: VHS)',        duration: 2300, bg: '#050304', match: [], alt: 'horror' },
    'horror-b':      { name: 'Horror Movie Poster (option B: film burn)',  duration: 2300, bg: '#030201', match: [], alt: 'horror' },
    'horror-c':      { name: 'Horror Movie Poster (option C: the door)',   duration: 2400, bg: '#030202', match: [], alt: 'horror' }
  };
  const cfg = { base: (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || './', zIndex: 2147483000, storageKey: 'beeline.splashSeen.', use: { horror: 'horror-c' } }; // Horror C is the chosen horror splash
  let active = null;

  // configure({ use: { horror: 'horror-b' } }) swaps which page a resolved slug plays.
  function pick(slug) { const u = cfg.use && cfg.use[slug]; return u && DECKS[u] ? u : slug; }
  function slugFor(deck) { return pick(resolve(deck)); }
  function resolve(deck) {
    if (!deck) return 'beeline';
    const k = String(deck).trim().toLowerCase();
    if (DECKS[k]) return k;
    const esc = m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [slug, d] of Object.entries(DECKS)) if (d.match.some(m => new RegExp('(^|[^a-z0-9])' + esc(m) + '($|[^a-z0-9])').test(k))) return slug;
    return 'beeline'; // paid / unknown decks get the honey fallback
  }

  function play(deckOrSlug, opts = {}) {
    if (active) active.skip();
    const slug = slugFor(deckOrSlug);
    const meta = DECKS[slug];
    const base = (opts.base || cfg.base).replace(/\/?$/, '/');
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', meta.name + ' intro');
    wrap.style.cssText = `position:fixed;inset:0;z-index:${opts.zIndex || cfg.zIndex};background:${meta.bg};opacity:1;transition:opacity .15s`;
    const frame = document.createElement('iframe');
    frame.src = base + 'splashes/' + slug + '.html' + (opts.query ? '?' + opts.query : '');
    frame.title = meta.name + ' intro';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent';
    wrap.appendChild(frame);
    (opts.container || document.body).appendChild(wrap);

    let finished = false, resolveDone;
    const done = new Promise(r => (resolveDone = r));
    const safety = setTimeout(() => finish('timeout'), meta.duration + 4000);
    function finish(reason) {
      if (finished) return; finished = true;
      clearTimeout(safety);
      removeEventListener('message', onMsg); removeEventListener('keydown', onKey, true);
      wrap.remove(); if (active === ctrl) active = null;
      if (opts.onEnd) try { opts.onEnd(reason, slug); } catch (e) { console.error(e); }
      resolveDone(reason);
    }
    function onMsg(e) {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === 'beeline-splash:ready') { try { frame.contentWindow.focus(); } catch (_) {} }
      if (e.data.type === 'beeline-splash:end') finish(e.data.reason);
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); ctrl.skip(); } }
    addEventListener('message', onMsg); addEventListener('keydown', onKey, true);
    frame.addEventListener('error', () => finish('error'));

    const ctrl = {
      slug, element: wrap, done,
      skip() { if (finished) return; try { frame.contentWindow.postMessage({ type: 'beeline-splash:skip' }, '*'); } catch (_) {} setTimeout(() => finish('skip'), 200); }
    };
    active = ctrl;
    return ctrl;
  }

  function playOnce(deckId, deckOrSlug, opts = {}) {
    const key = cfg.storageKey + deckId;
    try { if (localStorage.getItem(key)) { if (opts.onEnd) opts.onEnd('already-seen', slugFor(deckOrSlug)); return null; } localStorage.setItem(key, String(Date.now())); } catch (_) {}
    return play(deckOrSlug, opts);
  }
  function reset(deckId) {
    try { if (deckId != null) localStorage.removeItem(cfg.storageKey + deckId); else Object.keys(localStorage).filter(k => k.startsWith(cfg.storageKey)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  }
  function configure(o) { o = o || {}; if (o.use) o = Object.assign({}, o, { use: Object.assign({}, cfg.use, o.use) }); Object.assign(cfg, o); }

  global.BeeLineSplash = { DECKS, configure, slugFor, play, playOnce, reset };
})(window);

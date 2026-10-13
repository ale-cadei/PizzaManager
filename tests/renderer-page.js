// Il renderer caricato davvero, come fa la pagina: tutti gli script di
// index.html in un unico contesto vm con un DOM finto (docs/plans/21). Lo
// usano renderer-load.test.js (l'ordine di caricamento) ed editor-tab.test.js
// (il comportamento della scheda editor, che sta nello scope globale).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
const pageScripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

/** Oggetto che risponde a tutto: basta per il codice di caricamento, che costruisce e non disegna. */
function stub() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()),
    apply: () => stub(),
    construct: () => stub(),
  });
}

/**
 * @param {{aisess?: object}} [opts] `aisess`: il preload finto; senza, uno stub
 * @returns {{ctx: object, listeners: object, windowListeners: object}}
 *   `listeners` del document, `windowListeners` della finestra (un handler per evento)
 */
function loadPage({ aisess = stub() } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const listeners = {};
  const windowListeners = {};
  const document = new Proxy({}, {
    get: (t, k) => (k === 'addEventListener' ? (ev, fn) => { listeners[ev] = fn; } : stub()),
  });
  const ctx = {
    document, localStorage, console, setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { platform: 'MacIntel', userAgent: 'test' },
    getComputedStyle: stub(), CSS: { escape: (s) => s },
    addEventListener: (ev, fn) => { windowListeners[ev] = fn; },
  };
  ctx.window = ctx;
  ctx.aisess = aisess;
  vm.createContext(ctx);
  for (const src of pageScripts.filter((s) => !s.startsWith('../'))) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER_DIR, src), 'utf8'), ctx, { filename: src });
  }
  return { ctx, listeners, windowListeners };
}

module.exports = { loadPage, pageScripts, stub };

/* Albero della scheda editor ridimensionabile e nascondibile (docs/plans/62).
 * Larghezza e aperto/chiuso valgono per tutte le schede editor e si
 * ricordano in localStorage: stanno sulla pagina (variabile CSS
 * --editor-tree-w e classe editor-tree-hidden sul body), non nelle schede.
 * Striscia, bottone e Ctrl+B li aggancia editor-tab.js.
 *
 * Wrapper UMD come editor-tree.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const WIDTH_KEY = 'aisess.editorTreeW';
  const HIDDEN_KEY = 'aisess.editorTreeHidden';
  const DEFAULT_W = 240;
  const MIN_W = 160;

  /** Fra MIN_W e max (metà della scheda); con una scheda stretta vince il minimo. */
  const clampWidth = (w, max) => Math.round(Math.max(MIN_W, Math.min(w, max)));

  function readPanelPrefs(storage) {
    try {
      const w = Number(storage.getItem(WIDTH_KEY));
      return {
        width: Number.isFinite(w) && w >= MIN_W ? Math.round(w) : DEFAULT_W,
        hidden: storage.getItem(HIDDEN_KEY) === '1',
      };
    } catch {
      return { width: DEFAULT_W, hidden: false };
    }
  }

  function savePanelPrefs(storage, prefs) {
    try {
      storage.setItem(WIDTH_KEY, String(prefs.width));
      storage.setItem(HIDDEN_KEY, prefs.hidden ? '1' : '0');
    } catch {
      // localStorage negato o pieno: la preferenza vale fino al riavvio
    }
  }

  function applyPanelPrefs(doc, prefs) {
    doc.body.style.setProperty('--editor-tree-w', `${prefs.width}px`);
    doc.body.classList.toggle('editor-tree-hidden', prefs.hidden);
  }

  /** Le preferenze correnti stanno qui, non rilette dallo storage: se lo
   *  storage lancia, il bottone apre e chiude lo stesso. */
  function createPanel({ doc, storage }) {
    let prefs = readPanelPrefs(storage);
    const show = (patch) => {
      prefs = { ...prefs, ...patch };
      applyPanelPrefs(doc, prefs);
    };
    const keep = (patch) => {
      show(patch);
      savePanelPrefs(storage, prefs);
    };

    function attachResizer(resizer, { side, wrap, win }) {
      resizer.addEventListener('dblclick', () => keep({ width: DEFAULT_W }));
      resizer.addEventListener('pointerdown', (e) => {
        if (e.button) return; // solo il tasto principale
        e.preventDefault();
        const startX = e.clientX;
        const startW = side.getBoundingClientRect().width;
        const max = wrap.getBoundingClientRect().width / 2;
        const move = (ev) => show({ width: clampWidth(startW + ev.clientX - startX, max) });
        const up = () => {
          win.removeEventListener('pointermove', move);
          win.removeEventListener('pointerup', up);
          doc.body.classList.remove('editor-resizing');
          savePanelPrefs(storage, prefs);
        };
        doc.body.classList.add('editor-resizing');
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', up);
      });
    }

    applyPanelPrefs(doc, prefs);
    return {
      prefs: () => prefs,
      toggle: () => keep({ hidden: !prefs.hidden }),
      attachResizer,
    };
  }

  const isToggleKey = (e) => Boolean(e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    && typeof e.key === 'string' && e.key.toLowerCase() === 'b');

  return { WIDTH_KEY, HIDDEN_KEY, DEFAULT_W, MIN_W, clampWidth, readPanelPrefs, savePanelPrefs, applyPanelPrefs, createPanel, isToggleKey };
});

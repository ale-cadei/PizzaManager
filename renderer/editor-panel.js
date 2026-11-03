/* Albero della scheda editor ridimensionabile e nascondibile (docs/plans/62),
 * e anteprima del codice (minimappa) accesa o spenta (docs/plans/81).
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
  const MINIMAP_KEY = 'aisess.editorMinimap';
  const DEFAULT_W = 256;
  const MIN_W = 160;

  /** Fra MIN_W e max (metà della scheda); con una scheda stretta vince il minimo. */
  const clampWidth = (w, max) => Math.round(Math.max(MIN_W, Math.min(w, max)));

  function readPanelPrefs(storage) {
    try {
      const w = Number(storage.getItem(WIDTH_KEY));
      return {
        width: Number.isFinite(w) && w >= MIN_W ? Math.round(w) : DEFAULT_W,
        hidden: storage.getItem(HIDDEN_KEY) === '1',
        minimap: storage.getItem(MINIMAP_KEY) === '1',
      };
    } catch {
      return { width: DEFAULT_W, hidden: false, minimap: false };
    }
  }

  function savePanelPrefs(storage, prefs) {
    try {
      storage.setItem(WIDTH_KEY, String(prefs.width));
      storage.setItem(HIDDEN_KEY, prefs.hidden ? '1' : '0');
      storage.setItem(MINIMAP_KEY, prefs.minimap ? '1' : '0');
    } catch {
      // localStorage negato o pieno: la preferenza vale fino al riavvio
    }
  }

  function applyPanelPrefs(doc, prefs) {
    doc.body.style.setProperty('--editor-tree-w', `${prefs.width}px`);
    doc.body.classList.toggle('editor-tree-hidden', prefs.hidden);
    doc.body.classList.toggle('editor-minimap-on', Boolean(prefs.minimap));
  }

  /** Le preferenze correnti stanno qui, non rilette dallo storage: se lo
   *  storage lancia, il bottone apre e chiude lo stesso. */
  /** Con `motion` (renderer/motion.js, docs/plans/80) l'albero si apre e si
   *  chiude animato: si stringe a 0 prima di sparire, cresce dopo essere comparso.
   *  `onMinimap(on)`: la minimappa è stata accesa o spenta, le schede aperte
   *  la seguono (le nuove leggono prefs().minimap). */
  function createPanel({ doc, storage, motion = null, onMinimap = () => {} }) {
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
          resizer.removeEventListener('lostpointercapture', up);
          doc.body.classList.remove('editor-resizing');
          savePanelPrefs(storage, prefs);
        };
        // Col puntatore catturato il cursore resta ew-resize anche sopra
        // Monaco, e un rilascio perso (fuoco altrove) chiude lo stesso
        if (resizer.setPointerCapture) resizer.setPointerCapture(e.pointerId);
        doc.body.classList.add('editor-resizing');
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', up);
        resizer.addEventListener('lostpointercapture', up);
      });
    }

    function toggle() {
      const hidden = !prefs.hidden;
      const sides = motion && doc.querySelectorAll ? [...doc.querySelectorAll('.editor-side')] : [];
      if (!sides.length) { keep({ hidden }); return; }
      if (!hidden) { sides.forEach((side, i) => motion.showWidth(side, () => { if (!i) keep({ hidden }); })); return; }
      // Le preferenze cambiano subito (Ctrl+B di nuovo riapre da dov'è),
      // la classe che lo toglie dalla pagina arriva a fine corsa
      prefs = { ...prefs, hidden };
      savePanelPrefs(storage, prefs);
      sides.forEach((side) => motion.hideWidth(side, () => applyPanelPrefs(doc, prefs)));
    }

    function toggleMinimap() {
      keep({ minimap: !prefs.minimap });
      onMinimap(prefs.minimap);
    }

    applyPanelPrefs(doc, prefs);
    return {
      prefs: () => prefs,
      toggle: () => toggle(),
      toggleMinimap: () => toggleMinimap(),
      attachResizer,
    };
  }

  const isToggleKey = (e) => Boolean(e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    && typeof e.key === 'string' && e.key.toLowerCase() === 'b');

  /** Alt+1…9 porta davanti l'N-esimo file aperto (docs/plans/75). Sul Mac
   *  Ctrl: Opzione+cifra scrive caratteri (~ è Opzione+5 sulla tastiera
   *  italiana). Ctrl+Alt fuori dal Mac è AltGr, che scrive anche lui.
   *  @returns {number} l'indice da 0, -1 se il tasto non è questo */
  function openIndexKey(e, isMac) {
    const m = /^Digit([1-9])$/.exec(e.code || '');
    if (!m || e.shiftKey || e.metaKey) return -1;
    const mods = isMac ? e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey;
    return mods ? Number(m[1]) - 1 : -1;
  }
  const openKeyLabel = (n, isMac) => (isMac ? `⌃${n}` : `Alt ${n}`);

  /** Ctrl+P (Cmd+P sul Mac): «Vai al file» (docs/plans/75). */
  const isQuickKey = (e) => Boolean((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
    && typeof e.key === 'string' && e.key.toLowerCase() === 'p');

  /** Ctrl+Alt+N: file nuovo nella cartella selezionata (stato vuoto, docs/plans/75). */
  const isNewFileKey = (e) => Boolean(e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.code === 'KeyN');

  return {
    WIDTH_KEY, HIDDEN_KEY, MINIMAP_KEY, DEFAULT_W, MIN_W, clampWidth, readPanelPrefs, savePanelPrefs, applyPanelPrefs, createPanel,
    isToggleKey, isQuickKey, isNewFileKey, openIndexKey, openKeyLabel,
  };
});

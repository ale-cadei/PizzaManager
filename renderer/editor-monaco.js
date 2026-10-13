/* L'unico modulo che conosce Monaco (docs/plans/60). Lo carica una volta,
 * col suo loader AMD, alla prima scheda editor che apre un file; a ogni
 * scheda dà un «host»: un editor Monaco e un model per file aperto, chiesti
 * per percorso relativo. Il resto del renderer non tocca Monaco: il motore
 * resta sostituibile.
 * Monaco è bloccato a 0.57.0 (package.json): il loader AMD è deprecato, un
 * aggiornamento è un lavoro a sé (docs/plans/60, «Motore: Monaco»).
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorMonaco = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const BASE = '../node_modules/monaco-editor/min/vs';
  const THEME = 'aisess';
  const FONT = "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace";
  let loading = null;
  let hosts = 0;

  function cssColor(win, name, fallback) {
    const v = win.getComputedStyle(win.document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }

  function defineTheme(win, monaco) {
    const bg = cssColor(win, '--bg', '#070505');
    monaco.editor.defineTheme(THEME, {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': bg,
        'editorGutter.background': bg,
        'editor.lineHighlightBackground': cssColor(win, '--surface-2', '#151010'),
        'editorWidget.background': cssColor(win, '--surface', '#0E0B0A'),
      },
    });
  }

  /** Carica Monaco una volta. Se fallisce, la prossima chiamata ritenta. */
  function load(win) {
    if (win.monaco && win.monaco.editor) return Promise.resolve(win.monaco);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const doc = win.document;
      const script = doc.createElement('script');
      script.src = `${BASE}/loader.js`;
      script.onerror = () => reject(new Error(`loader di Monaco non trovato (${script.src})`));
      script.onload = () => {
        win.require.config({ paths: { vs: BASE } });
        win.require(['vs/editor/editor.main'], () => {
          defineTheme(win, win.monaco);
          resolve(win.monaco);
        }, (e) => reject(e instanceof Error ? e : new Error(String(e))));
      };
      doc.head.appendChild(script);
    }).catch((e) => { loading = null; throw e; });
    return loading;
  }

  /**
   * @param {{monaco: object, container: Element, fontSize: number,
   *   onChange: (rel: string, dirty: boolean) => void,
   *   onSave: (rel: string|null) => void, onSaveAll: () => void}} o
   */
  function createEditorHost({ monaco, container, fontSize, onChange, onSave, onSaveAll }) {
    // Autorità diversa per host: due schede sulla stessa cartella hanno model distinti
    const authority = `h${++hosts}`;
    const docs = new Map(); // rel → { rel, model, savedVersion, viewState, forcedDirty, sub }
    let current = null;
    const editor = monaco.editor.create(container, {
      model: null, theme: THEME, automaticLayout: true, fontSize, fontFamily: FONT,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderWhitespace: 'selection',
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave(current));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => onSaveAll());

    const uriOf = (rel) => monaco.Uri.from({ scheme: 'aisess', authority, path: `/${rel}` });
    const dirtyOf = (d) => d.forcedDirty || d.model.getAlternativeVersionId() !== d.savedVersion;

    function track(d) {
      d.sub = d.model.onDidChangeContent(() => onChange(d.rel, dirtyOf(d)));
      docs.set(d.rel, d);
    }

    function make(rel, text, extra = {}) {
      const model = monaco.editor.createModel(text, undefined, uriOf(rel));
      track({ rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, ...extra });
    }

    function activate(rel) {
      const d = docs.get(rel);
      if (!d) return;
      if (current && docs.has(current) && current !== rel) docs.get(current).viewState = editor.saveViewState();
      current = rel;
      editor.setModel(d.model);
      if (d.viewState) editor.restoreViewState(d.viewState);
      editor.focus();
    }

    function open(rel, text) {
      if (!docs.has(rel)) make(rel, text);
      activate(rel);
    }

    function markSaved(rel) {
      const d = docs.get(rel);
      if (!d) return;
      d.savedVersion = d.model.getAlternativeVersionId();
      d.forcedDirty = false;
      onChange(rel, false);
    }

    /* Ricarica dal disco: nella pila dell'undo (Ctrl+Z riporta il testo di
       prima), cursore e scroll conservati, a capo presi dal file nuovo. */
    function replaceText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const eol = /\r\n/.test(text) ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF;
      d.model.pushEOL(eol);
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      if (view) editor.restoreViewState(view);
      markSaved(rel);
    }

    /* Un model non cambia URI: se ne fa uno nuovo (anche il linguaggio può
       cambiare con l'estensione). La storia dell'undo non segue. */
    function rename(from, to) {
      const d = docs.get(from);
      if (!d || docs.has(to)) return;
      const wasCurrent = current === from;
      const viewState = wasCurrent ? editor.saveViewState() : d.viewState;
      docs.delete(from);
      make(to, d.model.getValue(), { viewState, forcedDirty: dirtyOf(d) });
      if (wasCurrent) { current = null; activate(to); }
      d.sub.dispose();
      d.model.dispose();
    }

    function close(rel) {
      const d = docs.get(rel);
      if (!d) return;
      docs.delete(rel);
      if (current === rel) { current = null; editor.setModel(null); }
      d.sub.dispose();
      d.model.dispose();
    }

    function dispose() {
      for (const rel of [...docs.keys()]) close(rel);
      editor.dispose();
    }

    return {
      open, activate, markSaved, replaceText, rename, close, dispose,
      current: () => current,
      getText: (rel) => (docs.has(rel) ? docs.get(rel).model.getValue() : null),
      isDirty: (rel) => docs.has(rel) && dirtyOf(docs.get(rel)),
      focus: () => editor.focus(),
    };
  }

  return { load, createEditorHost };
});

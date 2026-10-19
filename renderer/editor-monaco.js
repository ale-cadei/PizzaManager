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
   *   onChange: (rel: string, dirty: boolean, edited: boolean) => void,
   *   onSave: (rel: string|null) => void, onSaveAll: () => void,
   *   onComment?: (rel: string, from: number, to: number) => void}} o
   */
  function createEditorHost({ monaco, container, fontSize, onChange, onSave, onSaveAll, onComment = () => {} }) {
    // Autorità diversa per host: due schede sulla stessa cartella hanno model distinti
    const authority = `h${++hosts}`;
    const docs = new Map(); // rel → { rel, model, savedVersion, viewState, forcedDirty, sub, gutter, marks, zones }
    let current = null;
    const editor = monaco.editor.create(container, {
      model: null, theme: THEME, automaticLayout: true, fontSize, fontFamily: FONT,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderWhitespace: 'selection',
      glyphMargin: true, // il margine del «+» (docs/plans/65)
    });
    // addCommand di Monaco è globale: senza una chiave che vale solo nel DOM di
    // questo editor, Ctrl+S andrebbe all'ultimo host creato (un'altra scheda).
    // Cerca e sostituisci si aprono su questo editor e non su quello che Monaco
    // crede abbia il fuoco: con più schede editor sceglieva una nascosta.
    const scope = `aisessHost${hosts}`;
    editor.createContextKey(scope, true);
    const bind = (keys, fn) => editor.addCommand(keys, fn, scope);
    const runAction = (id) => () => { const a = editor.getAction(id); if (a) a.run(); };
    const { KeyMod, KeyCode } = monaco;
    bind(KeyMod.CtrlCmd | KeyCode.KeyS, () => onSave(current));
    bind(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS, () => onSaveAll());
    bind(KeyMod.CtrlCmd | KeyCode.KeyF, runAction('actions.find'));
    bind(KeyMod.CtrlCmd | KeyCode.KeyH, runAction('editor.action.startFindReplaceAction'));
    // Su Mac Cmd+H nasconde l'app: Monaco lì usa Cmd+Alt+F
    bind(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyF, runAction('editor.action.startFindReplaceAction'));

    const uriOf = (rel) => monaco.Uri.from({ scheme: 'aisess', authority, path: `/${rel}` });
    const dirtyOf = (d) => d.forcedDirty || d.model.getAlternativeVersionId() !== d.savedVersion;

    function track(d) {
      // edited: il testo è cambiato; false da markSaved (cambia solo «sporco»)
      d.sub = d.model.onDidChangeContent(() => {
        followZones(d);
        onChange(d.rel, dirtyOf(d), true);
      });
      docs.set(d.rel, d);
    }

    function make(rel, text, extra = {}) {
      const model = monaco.editor.createModel(text, undefined, uriOf(rel));
      track({
        rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, gutter: [],
        marks: new Map(), zones: new Map(), ...extra,
      });
    }

    function activate(rel) {
      const d = docs.get(rel);
      if (!d) return;
      const fresh = current !== rel;
      const prev = fresh ? docs.get(current) : null;
      if (prev) {
        prev.viewState = editor.saveViewState();
        prev.zones.forEach(hideZone);
      }
      current = rel;
      editor.setModel(d.model);
      // setModel butta la vista e le sue zone: si rimettono (lo stesso model non la cambia)
      if (fresh) d.zones.forEach(showZone);
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
      onChange(rel, false, false);
    }

    /* Ricarica dal disco: nella pila dell'undo (Ctrl+Z riporta il testo di
       prima), cursore e scroll conservati, a capo presi dal file nuovo. */
    function replaceText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const spans = spansOf(d); // sostituire tutto il testo li schiaccerebbe in cima
      const eol = /\r\n/.test(text) ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF;
      d.model.pushEOL(eol);
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      putMarks(d, spans);
      followZones(d);
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
      if (wasCurrent) d.zones.forEach(hideZone);
      const spans = spansOf(d); // prima di togliere `from` da docs: linesOf passa da lì
      docs.delete(from);
      // Le zone passano fuori dalla vista: activate le rimette
      const zones = new Map([...d.zones].map(([id, z]) => [id, { ...z, viewId: null, overlaid: false }]));
      make(to, d.model.getValue(), { viewState, forcedDirty: dirtyOf(d), zones });
      putMarks(docs.get(to), spans, d);
      for (const id of zones.keys()) owner.set(id, to);
      if (wasCurrent) { current = null; activate(to); }
      d.sub.dispose();
      d.model.dispose();
    }

    /* Barrette delle righe cambiate (docs/plans/63): decorazioni del model
       nel margine delle righe; `d.gutter` tiene gli id per sostituirle. */
    /* Il margine di Monaco ha `contain: strict`: un triangolino a cavallo del
       bordo sopra la prima riga o sotto l'ultima verrebbe tagliato a metà, lì
       si disegna dentro la riga (-top, -end). */
    function delClass(after, lineCount) {
      if (after === 0) return 'editor-gutter-del editor-gutter-del-top';
      if (after >= lineCount) return 'editor-gutter-del editor-gutter-del-end';
      return 'editor-gutter-del';
    }

    function gutterDecoration(r, lineCount) {
      if (r.kind === 'del') {
        const line = Math.max(r.after, 1);
        const cls = delClass(r.after, lineCount);
        return {
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, linesDecorationsClassName: cls },
        };
      }
      return {
        range: { startLineNumber: r.from, startColumn: 1, endLineNumber: r.to, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: `editor-gutter-${r.kind}` },
      };
    }

    /** @param {Array|null} ranges da AisessEditorGutter.changeRanges; null o [] tolgono le barrette */
    function setGutter(rel, ranges) {
      const d = docs.get(rel);
      if (!d) return;
      const lineCount = d.model.getLineCount();
      d.gutter = d.model.deltaDecorations(d.gutter, (ranges || []).map((r) => gutterDecoration(r, lineCount)));
    }

    /** Porta il cursore all'inizio della riga e la mette al centro (piano 64). */
    function reveal(rel, line) {
      if (!docs.has(rel)) return;
      if (current !== rel) activate(rel);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.revealLineInCenter(line);
      editor.focus();
    }

    function close(rel) {
      const d = docs.get(rel);
      if (!d) return;
      docs.delete(rel);
      for (const id of [...d.marks.keys(), ...d.zones.keys()]) owner.delete(id);
      if (current === rel) { d.zones.forEach(hideZone); current = null; editor.setModel(null); }
      d.sub.dispose();
      d.model.dispose();
    }

    /* Commenti (docs/plans/65): segni sulle righe e zone sotto di loro.
       Un segno è una decorazione del model, che Monaco sposta col testo;
       `owner` dice di quale file è ogni id, anche dopo una rinomina. Le
       zone stanno nella vista, che setModel butta: l'host le tiene per file e le rimette
       quando il file torna davanti (activate). */
    const NOTE_LINE = 'editor-note-line';
    const ZONE_PX = 64;
    const owner = new Map(); // id di segno o di zona → rel
    let seq = 0;

    const validLines = (model, from, to) => Number.isInteger(from) && Number.isInteger(to)
      && from >= 1 && to >= from && from <= model.getLineCount();

    function markOf(model, from, to, cls) {
      const stickiness = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
      return {
        range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: model.getLineMaxColumn(to) },
        options: { isWholeLine: true, stickiness, ...(cls ? { className: cls } : {}) },
      };
    }

    function trackIn(d, from, to, cls) {
      const id = `${authority}m${++seq}`;
      const [deco] = d.model.deltaDecorations([], [markOf(d.model, from, to, cls)]);
      d.marks.set(id, { deco, cls });
      owner.set(id, d.rel);
      return id;
    }

    /** Righe intere col fondo dei commenti; la fine oltre il file si ferma all'ultima riga */
    function trackLines(rel, from, to) {
      const d = docs.get(rel);
      if (!d || !validLines(d.model, from, to)) return null;
      return trackIn(d, from, Math.min(to, d.model.getLineCount()), NOTE_LINE);
    }

    const docOf = (id) => docs.get(owner.get(id));

    function linesOf(id) {
      const d = docOf(id);
      const m = d && d.marks.get(id);
      const r = m && d.model.getDecorationRange(m.deco);
      return r ? { from: r.startLineNumber, to: r.endLineNumber } : null;
    }

    function untrack(id) {
      const d = docOf(id);
      owner.delete(id);
      const m = d && d.marks.get(id);
      if (!m) return;
      d.model.deltaDecorations([m.deco], []);
      d.marks.delete(id);
    }

    const spansOf = (d) => [...d.marks.keys()].map((id) => [id, linesOf(id)]);

    /* Rimette i segni ai numeri di `spans`, fermati all'ultima riga: dopo
       un testo sostituito tutto, o nel model nuovo di una rinomina (`from`
       è il file da cui vengono) */
    function putMarks(d, spans, from = d) {
      const last = d.model.getLineCount();
      for (const [id, at] of spans) {
        const m = from.marks.get(id);
        if (!at || !m) continue;
        const old = from === d ? [m.deco] : [];
        const [deco] = d.model.deltaDecorations(old, [markOf(d.model, Math.min(at.from, last), Math.min(at.to, last), m.cls)]);
        d.marks.set(id, { deco, cls: m.cls });
        owner.set(id, d.rel);
      }
    }

    function lineText(rel, line) {
      const d = docs.get(rel);
      return d && validLines(d.model, line, line) ? d.model.getLineContent(line) : null;
    }

    /* Lo strato delle righe di Monaco sta sopra le zone e si prende i clic:
       un nodo dentro la zona non riceve né fuoco né clic. Come lo ZoneWidget
       di Monaco, la zona tiene solo lo spazio e il nodo sta in un overlay
       widget, messo all'altezza della zona da onDomNodeTop (fuori vista
       Monaco dà -1e6, e il nodo esce dallo schermo). Gli overlay, al
       contrario delle zone, restano dopo setModel: hideZone li toglie. */
    const doc = container.ownerDocument;

    function placeZone(z) {
      const info = editor.getLayoutInfo();
      z.node.style.left = `${info.contentLeft}px`;
      z.node.style.width = `${info.contentWidth}px`;
    }

    function showZone(z) {
      editor.changeViewZones((acc) => { z.viewId = acc.addZone(z.delegate); });
      if (z.overlaid) return;
      editor.addOverlayWidget(z.widget);
      z.overlaid = true;
      placeZone(z);
    }

    function hideZone(z) {
      if (z.viewId !== null) editor.changeViewZones((acc) => acc.removeZone(z.viewId));
      z.viewId = null;
      if (z.overlaid) editor.removeOverlayWidget(z.widget);
      z.overlaid = false;
    }

    /** Una zona col nodo `node` sotto la riga `afterLine`, che la segue come un segno */
    function addZone(rel, afterLine, node, heightInPx = ZONE_PX) {
      const d = docs.get(rel);
      if (!d || !validLines(d.model, afterLine, afterLine)) return null;
      const id = `${authority}z${++seq}`;
      const wrap = doc.createElement('div');
      node.style.position = 'absolute';
      node.style.top = '-100000px'; // fuori vista finché Monaco non dice dov'è la zona
      wrap.appendChild(node);
      const delegate = {
        afterLineNumber: afterLine, heightInPx, domNode: doc.createElement('div'),
        onDomNodeTop: (top) => { node.style.top = `${top}px`; },
      };
      const widget = { getId: () => id, getDomNode: () => wrap, getPosition: () => null };
      const z = { mark: trackIn(d, afterLine, afterLine, null), viewId: null, delegate, node, widget, overlaid: false };
      d.zones.set(id, z);
      owner.set(id, rel);
      if (current === rel) showZone(z);
      return id;
    }

    function removeZone(id) {
      const d = docOf(id);
      const z = d && d.zones.get(id);
      owner.delete(id);
      if (!z) return;
      hideZone(z);
      untrack(z.mark);
      d.zones.delete(id);
    }

    /** L'altezza la sa il riquadro dopo il disegno: chi la misura la passa qui */
    function resizeZone(id, heightInPx) {
      const d = docOf(id);
      const z = d && d.zones.get(id);
      if (!z || !(heightInPx > 0) || z.delegate.heightInPx === heightInPx) return;
      z.delegate.heightInPx = heightInPx;
      if (z.viewId !== null) editor.changeViewZones((acc) => acc.layoutZone(z.viewId));
    }

    /* Monaco sposta già la zona con le righe, ma a ogni layoutZone rilegge
       afterLineNumber: lo si tiene uguale al segno */
    function followZones(d) {
      const moved = [];
      for (const z of d.zones.values()) {
        const at = linesOf(z.mark);
        if (at && at.to !== z.delegate.afterLineNumber) {
          z.delegate.afterLineNumber = at.to;
          moved.push(z);
        }
      }
      const shown = moved.filter((z) => z.viewId !== null);
      if (shown.length) editor.changeViewZones((acc) => shown.forEach((z) => acc.layoutZone(z.viewId)));
    }

    /* Commentare (docs/plans/65): dal menu del tasto destro, o col clic sul
       «+» che compare nel margine della riga sotto il mouse */
    const MT = monaco.editor.MouseTargetType;
    const ON_LINE = new Set([MT.GUTTER_GLYPH_MARGIN, MT.GUTTER_LINE_NUMBERS, MT.GUTTER_LINE_DECORATIONS, MT.CONTENT_TEXT, MT.CONTENT_EMPTY]);
    let hover = { rel: null, line: 0, ids: [] };

    // Una selezione che finisce a inizio riga non prende quella riga
    function selectedLines() {
      const s = editor.getSelection();
      if (!s) return null;
      const to = s.endLineNumber > s.startLineNumber && s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
      return { from: s.startLineNumber, to };
    }

    /* `line` 0: dal menu, vale la selezione (o la riga del cursore). Dal
       margine la riga, o la selezione se la riga ci sta dentro */
    function commentAt(line) {
      if (!current) return;
      const sel = selectedLines();
      const inSel = sel && sel.to > sel.from && line >= sel.from && line <= sel.to;
      const lines = line && !inSel ? { from: line, to: line } : sel;
      if (lines) onComment(current, lines.from, lines.to);
    }

    function clearAdd() {
      const d = docs.get(hover.rel);
      if (d && hover.ids.length) d.model.deltaDecorations(hover.ids, []);
      hover = { rel: null, line: 0, ids: [] };
    }

    function showAdd(line) {
      if (hover.rel === current && hover.line === line) return;
      clearAdd();
      const d = docs.get(current);
      if (!d) return;
      const range = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 };
      hover = { rel: current, line, ids: d.model.deltaDecorations([], [{ range, options: { glyphMarginClassName: 'editor-note-add' } }]) };
    }

    const lineOf = (e) => (e.target && e.target.position ? e.target.position.lineNumber : 0);

    function wireComments() {
      editor.onDidLayoutChange(() => {
        const d = docs.get(current);
        if (d) d.zones.forEach((z) => { if (z.overlaid) placeZone(z); });
      });
      const action = (id, label, precondition) => editor.addAction({
        id, label, precondition, contextMenuGroupId: 'navigation', contextMenuOrder: 0, run: () => commentAt(0),
      });
      action('aisess.comment-line', 'Commenta riga', '!editorHasSelection');
      action('aisess.comment-selection', 'Commenta selezione', 'editorHasSelection');
      editor.onMouseMove((e) => {
        const line = ON_LINE.has(e.target.type) ? lineOf(e) : 0;
        if (line) showAdd(line);
        else clearAdd();
      });
      editor.onMouseLeave(() => clearAdd());
      // Monaco non sposta la selezione per un clic nel margine dei glifi: si legge ancora quella di prima
      editor.onMouseDown((e) => {
        if (e.target.type !== MT.GUTTER_GLYPH_MARGIN || !(e.event && e.event.leftButton)) return;
        const line = lineOf(e);
        if (line) commentAt(line);
      });
    }

    function dispose() {
      for (const rel of [...docs.keys()]) close(rel);
      editor.dispose();
    }

    wireComments();

    return {
      open, activate, markSaved, replaceText, rename, close, dispose, setGutter, reveal,
      trackLines, linesOf, untrack, lineText, addZone, removeZone, resizeZone,
      current: () => current,
      getText: (rel) => (docs.has(rel) ? docs.get(rel).model.getValue() : null),
      // Senza copiare il testo: le barrette saltano i file troppo lunghi (docs/plans/63)
      lineCount: (rel) => (docs.has(rel) ? docs.get(rel).model.getLineCount() : 0),
      isDirty: (rel) => docs.has(rel) && dirtyOf(docs.get(rel)),
      focus: () => editor.focus(),
    };
  }

  return { load, createEditorHost };
});

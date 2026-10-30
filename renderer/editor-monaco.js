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
  const api = factory(root ? root.AisessEditorLanguages : require('./editor-languages'));
  if (root) root.AisessEditorMonaco = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Languages) {
  const BASE = '../node_modules/monaco-editor/min/vs';
  const THEME = 'aisess';
  const FONT = "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace";
  let loading = null;
  let hosts = 0;

  // Tema sintattico «Forno» (docs/plans/75): parole chiave arancio, stringhe
  // ocra, commenti in corsivo. Monaco vuole gli hex senza #
  const FORNO_RULES = [
    { token: 'keyword', foreground: 'FF9B6F' },
    { token: 'string', foreground: 'E3C27A' },
    { token: 'comment', foreground: '8A7A72', fontStyle: 'italic' },
    { token: 'number', foreground: 'C9A8F5' },
    { token: 'type', foreground: 'C9A8F5' },
    { token: 'identifier', foreground: 'D9CDC6' },
    { token: 'delimiter', foreground: '9A8A82' },
  ];
  // Non sono token: la riga corrente e i numeri di riga del mock 1c
  const LINE_HIGHLIGHT = '#140B09';
  const LINE_NUMBER = '#5E4E47';

  function cssColor(win, name, fallback) {
    const v = win.getComputedStyle(win.document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }

  /** `background`: il fondo di #main già in hex (lo calcola termTheme, come per i terminali). */
  function defineTheme(win, monaco, { background } = {}) {
    const bg = background || cssColor(win, '--bg', '#070505');
    monaco.editor.defineTheme(THEME, {
      base: 'vs-dark', inherit: true, rules: FORNO_RULES,
      colors: {
        'editor.background': bg,
        'editorGutter.background': bg,
        'editor.foreground': cssColor(win, '--text', '#F6F1EC'),
        'editor.lineHighlightBackground': LINE_HIGHLIGHT,
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': LINE_NUMBER,
        'editorLineNumber.activeForeground': cssColor(win, '--text-2', '#D9CDC6'),
        'editorWidget.background': cssColor(win, '--surface', '#0E0B0A'),
      },
    });
  }

  /** Ridefinisce il tema col fondo dato; senza Monaco caricato non fa niente (lo fa load). */
  function applyTheme(win, colors) {
    if (!win.monaco || !win.monaco.editor) return;
    defineTheme(win, win.monaco, colors);
    win.monaco.editor.setTheme(THEME);
  }

  // Simboli da mostrare nel percorso sotto il titolo: non le variabili
  const SYMBOL_KINDS = new Set(['function', 'local function', 'method', 'class', 'constructor', 'getter', 'setter', 'interface', 'enum']);

  /** Il simbolo più interno, fra SYMBOL_KINDS, che contiene `offset` nell'albero di getNavigationTree. */
  function symbolInTree(node, offset, found = null) {
    if (!node) return found;
    const inside = (node.spans || []).some((sp) => offset >= sp.start && offset < sp.start + sp.length);
    if (!inside) return found;
    const here = SYMBOL_KINDS.has(node.kind) ? node.text : found;
    for (const child of node.childItems || []) {
      const deeper = symbolInTree(child, offset, null);
      if (deeper) return deeper;
    }
    return here;
  }

  /* Le definizioni interne di Monaco (JS/TS, CSS) saltano solo dentro il
     file e, insieme a Ctrl+click dell'host, darebbero due salti: si spengono
     e la definizione la cerca il main per tutti i linguaggi (docs/plans/71).
     setModeConfiguration sostituisce tutto: si parte da quella che c'è. */
  function quietBuiltinDefinitions(monaco) {
    const ts = monaco.typescript || {};
    const css = monaco.css || {};
    for (const d of [ts.typescriptDefaults, ts.javascriptDefaults, css.cssDefaults, css.scssDefaults, css.lessDefaults]) {
      if (d && typeof d.setModeConfiguration === 'function') d.setModeConfiguration({ ...d.modeConfiguration, definitions: false });
    }
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
          quietBuiltinDefinitions(win.monaco);
          Languages.registerLanguages(win.monaco); // .env, .gitignore, Makefile, toml (docs/plans/74)
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
   *   onComment?: (rel: string, from: number, to: number) => void,
   *   onCursor?: (rel: string, pos: {line: number, col: number}) => void,
   *   onDefinition?: (rel: string, word: string, at: {lineNumber: number, column: number}) => void,
   *   onCursorLine?: (rel: string, line: number) => void,
   *   mac?: boolean}} o `onDefinition`: Ctrl+click (⌘ con `mac`) su un nome (docs/plans/71);
   *   `onCursorLine`: il cursore è su una riga, o il suo testo è cambiato (docs/plans/73);
   *   `onCursor`: riga e colonna per la barra di stato (docs/plans/75)
   */
  function createEditorHost({
    monaco, container, fontSize, onChange, onSave, onSaveAll, onComment = () => {}, onDefinition = null,
    onCursorLine = null, mac = false, onCursor = () => {},
  }) {
    // Autorità diversa per host: due schede sulla stessa cartella hanno model distinti
    const authority = `h${++hosts}`;
    const docs = new Map(); // rel → { rel, model, savedVersion, viewState, forcedDirty, sub, gutter, marks, zones }
    let current = null;
    const editor = monaco.editor.create(container, {
      model: null, theme: THEME, automaticLayout: true, fontSize, fontFamily: FONT,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderWhitespace: 'selection',
      glyphMargin: true, // il margine del «+» (docs/plans/65)
      padding: { top: 10 }, lineDecorationsWidth: 18, // corsia delle barrette (docs/plans/75)
    });
    const tellCursor = (p) => { if (current && p) onCursor(current, { line: p.lineNumber, col: p.column }); };
    editor.onDidChangeCursorPosition((e) => tellCursor(e.position));
    // Le azioni di Monaco legano i tasti a questo editor (precondizione
    // `editorId`) e tornano un disposable, che dispose() chiude. addCommand no:
    // è globale e resta, così con due schede editor Ctrl+S andava all'ultimo
    // host creato. Cerca e sostituisci si aprono su questo editor e non su
    // quello che Monaco crede abbia il fuoco: con più schede ne sceglieva una nascosta.
    const owned = [];
    const addAction = (a) => { owned.push(editor.addAction(a)); };
    const runAction = (id) => () => { const a = editor.getAction(id); if (a) a.run(); };
    const { KeyMod, KeyCode } = monaco;
    const keys = (id, label, keybindings, run) => addAction({ id: `aisess.${id}`, label, keybindings, run });
    keys('save', 'Salva', [KeyMod.CtrlCmd | KeyCode.KeyS], () => onSave(current));
    keys('save-all', 'Salva tutto', [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS], () => onSaveAll());
    keys('find', 'Cerca', [KeyMod.CtrlCmd | KeyCode.KeyF], runAction('actions.find'));
    // Su Mac Cmd+H nasconde l'app: Monaco lì usa Cmd+Alt+F
    keys('replace', 'Sostituisci', [KeyMod.CtrlCmd | KeyCode.KeyH, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyF],
      runAction('editor.action.startFindReplaceAction'));

    const uriOf = (rel) => monaco.Uri.from({ scheme: 'aisess', authority, path: `/${rel}` });
    const dirtyOf = (d) => d.forcedDirty || d.model.getAlternativeVersionId() !== d.savedVersion;

    function track(d) {
      // edited: il testo è cambiato; false da markSaved (cambia solo «sporco»)
      d.sub = d.model.onDidChangeContent(() => {
        followZones(d);
        onChange(d.rel, dirtyOf(d), true);
        if (d.rel === current) cursorLine();
      });
      docs.set(d.rel, d);
    }

    function make(rel, text, extra = {}) {
      // Il nome del file sceglie il linguaggio; se non lo conosce, decide Monaco dall'estensione
      const model = monaco.editor.createModel(text, Languages.languageFor(rel), uriOf(rel));
      track({
        rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, gutter: [], conflicts: [],
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
      cursorLine();
      tellCursor(editor.getPosition() || { lineNumber: 1, column: 1 });
    }

    /** La funzione (o classe, metodo) che contiene la posizione, dal worker JS/TS; null negli altri linguaggi. */
    async function symbolAt(rel, line, col) {
      const d = docs.get(rel);
      const ts = monaco.typescript;
      if (!d || !ts) return null;
      const lang = d.model.getLanguageId();
      const getWorker = lang === 'javascript' ? ts.getJavaScriptWorker : lang === 'typescript' ? ts.getTypeScriptWorker : null;
      if (!getWorker) return null;
      try {
        const worker = await (await getWorker())(d.model.uri);
        const tree = await worker.getNavigationTree(d.model.uri.toString());
        return symbolInTree(tree, d.model.getOffsetAt({ lineNumber: line, column: col }));
      } catch {
        return null; // worker non pronto o file chiuso nel frattempo: niente simbolo
      }
    }

    /** Per la barra di stato: indentazione, fine riga, linguaggio col nome leggibile. */
    function info(rel) {
      const d = docs.get(rel);
      if (!d) return null;
      const { tabSize, insertSpaces } = d.model.getOptions();
      const id = d.model.getLanguageId();
      const lang = monaco.languages.getLanguages().find((l) => l.id === id);
      return {
        tabSize, insertSpaces,
        eol: d.model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
        language: (lang && lang.aliases && lang.aliases[0]) || id,
      };
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

    /* Righe dei conflitti (docs/plans/69): marcatori, nostro, base e loro */
    function conflictDecorations(b) {
      const lines = (from, to, className) => ({
        range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: 1 },
        options: { isWholeLine: true, className },
      });
      const out = [b.start, b.sep, b.end].map((n) => lines(n, n, 'editor-conflict-marker'));
      if (b.ours[0] <= b.ours[1]) out.push(lines(b.ours[0], b.ours[1], 'editor-conflict-ours'));
      if (b.base !== null && b.base !== undefined) out.push(lines(b.base, b.sep - 1, 'editor-conflict-base'));
      if (b.theirs[0] <= b.theirs[1]) out.push(lines(b.theirs[0], b.theirs[1], 'editor-conflict-theirs'));
      return out;
    }

    function setConflicts(rel, blocks) {
      const d = docs.get(rel);
      if (!d) return;
      d.conflicts = d.model.deltaDecorations(d.conflicts, (blocks || []).flatMap(conflictDecorations));
    }

    /* Testo nuovo come modifica dell'utente (una scelta su un conflitto): il
       file resta sporco e Ctrl+Z la annulla in un colpo, al contrario di
       replaceText che è il disco che cambia */
    function editText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const spans = spansOf(d);
      d.model.pushStackElement();
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      d.model.pushStackElement();
      putMarks(d, spans);
      followZones(d);
      if (view) editor.restoreViewState(view);
    }

    /** Porta il cursore sulla riga (piano 64), alla colonna se c'è (piano 71), e la mette al centro. */
    function reveal(rel, line, column = 1) {
      if (!docs.has(rel)) return;
      if (current !== rel) activate(rel);
      editor.setPosition({ lineNumber: line, column });
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
      const action = (id, label, precondition) => addAction({
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

    /* Vai alla definizione (docs/plans/71). Col modificatore il nome sotto il
       mouse si sottolinea; il clic vale se giù e su cadono sullo stesso nome
       (un trascinamento con Ctrl premuto resta una selezione). */
    let link = { rel: null, ids: [] };
    let pressed = null;
    const held = (ev) => Boolean(ev && (mac ? ev.metaKey : ev.ctrlKey));

    function wordAt(e) {
      const d = docs.get(current);
      const pos = e.target && e.target.position;
      if (!d || e.target.type !== MT.CONTENT_TEXT || !pos) return null;
      const w = d.model.getWordAtPosition(pos);
      return w ? { word: w.word, lineNumber: pos.lineNumber, column: w.startColumn, endColumn: w.endColumn } : null;
    }

    function clearLink() {
      const d = docs.get(link.rel);
      if (d && link.ids.length) d.model.deltaDecorations(link.ids, []);
      link = { rel: null, ids: [] };
    }

    function showLink(w) {
      clearLink();
      const d = docs.get(current);
      const range = { startLineNumber: w.lineNumber, startColumn: w.column, endLineNumber: w.lineNumber, endColumn: w.endColumn };
      link = { rel: current, ids: d.model.deltaDecorations([], [{ range, options: { inlineClassName: 'editor-def-link' } }]) };
    }

    const sameWord = (a, b) => a && b && a.word === b.word && a.lineNumber === b.lineNumber && a.column === b.column;

    function wireDefinitions() {
      if (!onDefinition) return;
      editor.onMouseMove((e) => {
        const w = held(e.event) ? wordAt(e) : null;
        if (w) showLink(w);
        else clearLink();
      });
      editor.onMouseLeave(() => clearLink());
      editor.onKeyUp((e) => { if (!held(e)) clearLink(); });
      editor.onMouseDown((e) => {
        pressed = e.event && e.event.leftButton && held(e.event) ? wordAt(e) : null;
      });
      editor.onMouseUp((e) => {
        const w = held(e.event) ? wordAt(e) : null;
        const go = sameWord(w, pressed);
        pressed = null;
        if (!go) return;
        clearLink();
        onDefinition(current, w.word, { lineNumber: w.lineNumber, column: w.column });
      });
    }

    /** Il fumetto di Monaco sul cursore («Nessuna definizione…»); false se non c'è */
    function hint(text) {
      const c = editor.getContribution && editor.getContribution('editor.contrib.messageController');
      if (!c || typeof c.showMessage !== 'function' || !editor.getPosition()) return false;
      c.showMessage(text, editor.getPosition());
      return true;
    }

    /* Chi ha toccato la riga del cursore (docs/plans/73): un testo in fondo
       alla riga (decorazione `after`) col fumetto; uno solo per host. Si
       toglie appena il cursore cambia riga o il testo cambia: chi lo mette
       (editor-blame-ui.js) aspetta che il cursore si fermi. */
    let blame = { rel: null, ids: [] };

    function clearLineInfo() {
      const d = docs.get(blame.rel);
      if (d && blame.ids.length) d.model.deltaDecorations(blame.ids, []);
      blame = { rel: null, ids: [] };
    }

    function cursorLine() {
      clearLineInfo();
      const pos = editor.getPosition();
      if (onCursorLine && current && pos) onCursorLine(current, pos.lineNumber);
    }

    // Stacco dal codice dentro il testo: Monaco può spezzare il testo iniettato in
    // più span e un margine CSS cadrebbe su ognuno, aprendo buchi a metà frase
    const LINE_INFO_GAP = '\u00a0'.repeat(6);

    // Il fumetto è markdown: autore e messaggio vengono da git, si mostrano come testo
    const markdownText = (text) => text.replace(/[\\`*_{}[\]()#+\-!|<>~]/g, '\\$&').replace(/\n/g, '  \n');

    /** @param {{text: string, title: string}|null} info null toglie il testo */
    function setLineInfo(rel, line, info) {
      clearLineInfo();
      const d = docs.get(rel);
      if (!info || !d || rel !== current || !validLines(d.model, line, line)) return;
      const end = d.model.getLineMaxColumn(line);
      const range = { startLineNumber: line, startColumn: end, endLineNumber: line, endColumn: end };
      const options = {
        after: { content: LINE_INFO_GAP + info.text, inlineClassName: 'editor-blame' },
        hoverMessage: { value: markdownText(info.title) },
        showIfCollapsed: true,
      };
      blame = { rel, ids: d.model.deltaDecorations([], [{ range, options }]) };
    }

    function wireCursorLine() {
      if (!onCursorLine) return;
      editor.onDidChangeCursorPosition(() => cursorLine());
    }

    function dispose() {
      for (const rel of [...docs.keys()]) close(rel);
      owned.splice(0).forEach((d) => d.dispose());
      editor.dispose();
    }

    wireComments();
    wireDefinitions();
    wireCursorLine();

    return {
      open, activate, info, symbolAt, markSaved, replaceText, rename, close, dispose, setGutter, setConflicts, editText, reveal, hint, setLineInfo,
      trackLines, linesOf, untrack, lineText, addZone, removeZone, resizeZone,
      current: () => current,
      getText: (rel) => (docs.has(rel) ? docs.get(rel).model.getValue() : null),
      // Senza copiare il testo: le barrette saltano i file troppo lunghi (docs/plans/63)
      lineCount: (rel) => (docs.has(rel) ? docs.get(rel).model.getLineCount() : 0),
      // Cambia a ogni modifica del testo: editor-blame-ui.js scarta le risposte per un testo vecchio
      version: (rel) => (docs.has(rel) ? docs.get(rel).model.getAlternativeVersionId() : null),
      isDirty: (rel) => docs.has(rel) && dirtyOf(docs.get(rel)),
      focus: () => editor.focus(),
      /* Colora il testo di un nodo fuori dall'editor: le celle dei notebook
         (docs/plans/77). Il tema va passato: senza, colorizeElement fa
         setTheme('vs') per tutta la pagina e anche l'editor diventa chiaro. */
      colorize: (node, language) => {
        monaco.editor.colorizeElement(node, { mimeType: language, tabSize: 4, theme: THEME })
          .catch((e) => console.warn('colorize fallito', language, e));
      },
    };
  }

  return { load, applyTheme, createEditorHost, symbolInTree, quietBuiltinDefinitions };
});

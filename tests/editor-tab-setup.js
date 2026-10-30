/* Aiuti comuni ai test della scheda editor (editor-tab.test.js,
   editor-tab-gutter.test.js). La scheda vive nello scope globale del
   renderer: si carica la pagina vera (renderer-page.js) e si chiamano le sue
   funzioni su una scheda finta. Monaco è un `host` finto che ricorda il testo
   e le modifiche; il main è un `window.aisess` finto. */
const vm = require('vm');
const { loadPage, stub } = require('./renderer-page');

const settle = () => new Promise((r) => setImmediate(r));

/** Una promise da risolvere a mano: un salvataggio ancora in volo. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeHost(texts) {
  const calls = [];
  const gutters = []; // a parte: le barrette arrivano anche da sole, dopo ogni lettura di HEAD
  const dirty = new Set();
  return {
    calls,
    gutters,
    texts,
    dirty,
    setGutter: (rel, ranges) => gutters.push([rel, ranges]),
    conflicts: [], // a parte come gutters: i blocchi colorati
    setConflicts(rel, blocks) { this.conflicts.push([rel, blocks.map((b) => b.start)]); },
    editText(rel, text) { calls.push(['editText', rel, text]); texts[rel] = text; dirty.add(rel); },
    isDirty: (rel) => dirty.has(rel),
    reads: [], // a parte come gutters: le letture del testo per le barrette
    getText(rel) { this.reads.push(rel); return texts[rel]; },
    lineCount: (rel) => (rel in texts ? texts[rel].split(/\r\n|\r|\n/).length : 0),
    markSaved: (rel) => { calls.push(['markSaved', rel]); dirty.delete(rel); },
    replaceText: (rel, text) => { calls.push(['replaceText', rel, text]); texts[rel] = text; dirty.delete(rel); },
    activate: (rel) => calls.push(['activate', rel]),
    reveals: [], // a parte come gutters: dove si è portato il cursore
    reveal(rel, line, column) { this.reveals.push(column === undefined ? [rel, line] : [rel, line, column]); },
    // Chi ha toccato la riga (docs/plans/73): il testo stesso fa da versione
    lineInfos: [],
    setLineInfo(rel, line, info) { this.lineInfos.push([rel, line, info]); },
    version: (rel) => (rel in texts ? texts[rel] : null),
    hints: [], // i fumetti sul cursore (docs/plans/71)
    hint(text) { this.hints.push(text); return true; },
    // Commenti (docs/plans/65): segni e zone in due mappe, id da un contatore solo
    marks: new Map(), zones: new Map(), seq: 0,
    trackLines(rel, from, to) { const id = `m${++this.seq}`; this.marks.set(id, { rel, from, to }); return id; },
    linesOf(id) { const m = this.marks.get(id); return m ? { from: m.from, to: m.to } : null; },
    untrack(id) { this.marks.delete(id); },
    lineText: (rel, line) => (rel in texts ? texts[rel].split(/\r\n|\r|\n/)[line - 1] : null),
    addZone(rel, afterLine, node, height) { const id = `z${++this.seq}`; this.zones.set(id, { rel, afterLine, node, height }); return id; },
    removeZone(id) { this.zones.delete(id); },
    resizeZone() {},
    focus: () => {},
    open: (rel, text) => { texts[rel] = text; }, close: () => {}, rename: () => {}, dispose: () => {},
  };
}

/**
 * La pagina caricata, il main finto e una scheda editor con i file `files`
 * già aperti ({rel: {text, mtime, dirty}}); l'ultimo è quello attivo.
 * `main`: risposte del main per canale (funzioni), il resto risponde ok.
 */
function setup({ files = {}, main = {} } = {}) {
  const calls = [];
  const handlers = {
    editorWatch: async (root, rel) => ({ ok: true, path: `${root}/${rel}` }),
    editorUnwatch: async () => ({ ok: true }),
    saveEditorSessions: async () => ({ ok: true }),
    onEditorFileChanged: () => {},
    ...main,
  };
  const aisess = new Proxy({}, {
    get: (t, k) => (k in handlers
      ? (...args) => { calls.push([k, ...args]); return handlers[k](...args); }
      : (...args) => { calls.push([k, ...args]); return Promise.resolve({ ok: true }); }),
  });
  const page = loadPage({ aisess });
  const run = (code) => vm.runInContext(code, page.ctx);
  const Files = page.ctx.AisessEditorFiles;
  const host = fakeHost(Object.fromEntries(Object.entries(files).map(([rel, f]) => [rel, f.text])));
  let state = Files.empty();
  for (const [rel, f] of Object.entries(files)) {
    state = Files.open(state, rel, { path: `/w/${rel}`, mtime: f.mtime, bom: false });
    if (f.dirty) { state = Files.update(state, rel, { dirty: true }); host.dirty.add(rel); }
  }
  const tab = {
    id: 'tab-ed', type: 'editor', cwd: '/w', name: 'w', wrap: stub(),
    editor: {
      ui: { tree: stub(), treeHost: stub(), subtabs: stub(), bar: stub(), message: stub(), host: stub(), notesBar: stub() },
      files: state, tree: page.ctx.AisessEditorTree.emptyTree(),
      host, hostPending: null, saving: new Set(), pendingChanges: new Map(), gutterTimer: null, gutterSeq: new Map(), gutterSeqLast: 0,
      gutterReads: new Map(),
      notes: page.ctx.AisessEditorNotes.empty(), noteViews: new Map(), noteDraft: null,
    },
  };
  run('tabs').set(tab.id, tab);
  const file = (rel) => tab.editor.files.files[rel];
  const sent = (channel) => calls.filter((c) => c[0] === channel);
  return { page, run, tab, host, calls, sent, file, fn: (name) => run(name) };
}

/** Array e oggetti nati nel contesto vm della pagina hanno altri prototipi: si confrontano in copia. */
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { settle, deferred, fakeHost, setup, plain };

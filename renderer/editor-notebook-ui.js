/* I notebook Jupyter nella scheda editor (docs/plans/77). Un .ipynb attivo
   si mostra come notebook, in sola lettura, al posto di Monaco; il bottone
   nella testata passa al JSON (che resta il testo del file: si modifica e si
   salva lì) e torna indietro. La vista si ridisegna dal testo dell'editor
   quando la sua versione cambia: modifiche non salvate e ricariche dal
   disco comprese.
   Script dell'app, caricato dopo editor-tab.js: ne usa lo scope globale
   (tabs, renderEditorSubtabs), solo dentro le funzioni. */

const NotebookModel = window.AisessNotebookModel;
const NotebookView = window.AisessNotebookView;

/* Stile dell'HTML degli output (tabelle di pandas), che sta in un iframe e
   non vede le variabili della pagina: i colori arrivano già risolti. */
function editorNotebookCss(node) {
  const style = getComputedStyle(node);
  return `html{color-scheme:dark}body{margin:0;color:${style.color};font:13px ${style.fontFamily};background:transparent}`
    + 'table{border-collapse:collapse}th,td{padding:4px 10px;text-align:right;'
    + 'border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}th{font-weight:600}';
}

function editorNotebookState(tab) {
  const ed = tab.editor;
  if (!ed.notebook) ed.notebook = { source: new Set(), views: new Map(), shown: null };
  return ed.notebook;
}

/* Il notebook non si legge: si dice perché e si offre il JSON */
function editorNotebookProblem(tab, error) {
  const box = document.createElement('div');
  box.className = 'nb-problem';
  const text = document.createElement('span');
  text.textContent = `Non si legge come notebook. ${error}`;
  const open = document.createElement('button');
  open.className = 'btn btn--ghost';
  open.textContent = 'Apri il sorgente';
  open.onclick = () => toggleEditorNotebook(tab);
  box.append(text, open);
  return box;
}

function buildEditorNotebook(tab, rel) {
  const { host, ui } = tab.editor;
  const nb = NotebookModel.parseNotebook(host.getText(rel));
  if (!nb.ok) return editorNotebookProblem(tab, nb.error);
  return NotebookView.renderNotebook(document, nb, {
    colorize: (node, language) => host.colorize(node, language),
    htmlCss: editorNotebookCss(ui.notebook),
  });
}

/* Disegna `rel` nella vista; dallo stesso testo si riusa quello già fatto,
   e ogni file ritrova il punto dove lo si era lasciato. */
function showEditorNotebook(tab, rel) {
  const state = editorNotebookState(tab);
  const { host, ui } = tab.editor;
  const version = host.version(rel);
  if (state.shown === rel && state.views.get(rel).version === version) return;
  const cached = state.views.get(rel);
  // Ridisegnato sotto gli occhi (ricaricato dal disco): resta dov'era
  const scroll = state.shown === rel ? ui.notebook.scrollTop : (cached ? cached.scroll : 0);
  const view = cached && cached.version === version ? { ...cached, scroll } : { version, node: buildEditorNotebook(tab, rel), scroll };
  state.views.set(rel, view);
  state.shown = rel;
  ui.notebook.replaceChildren(view.node);
  ui.notebook.scrollTop = view.scroll;
}

/** Vista o Monaco per il file attivo; il bottone solo sui notebook. Da renderEditorOpen. */
function syncEditorNotebook(tab) {
  const ed = tab.editor;
  const { ui } = ed;
  const rel = ed.files.active;
  const notebook = Boolean(rel) && NotebookModel.isNotebook(rel);
  const state = editorNotebookState(tab);
  const asView = notebook && Boolean(ed.host) && !state.source.has(rel);
  // Il punto della vista si legge prima di nasconderla: nascosta, scrollTop vale 0
  const leaving = state.shown && state.shown !== (asView ? rel : null) ? state.views.get(state.shown) : null;
  if (leaving) leaving.scroll = ui.notebook.scrollTop;
  ui.nbToggle.hidden = !notebook;
  ui.nbToggle.textContent = asView ? '{ } Sorgente' : '▤ Notebook';
  ui.nbToggle.title = asView ? 'Mostra il JSON del notebook, per modificarlo' : 'Mostra il notebook';
  ui.host.hidden = asView;
  ui.notebook.hidden = !asView;
  if (asView) showEditorNotebook(tab, rel);
  else state.shown = null;
}

function toggleEditorNotebook(tab) {
  const ed = tab.editor;
  const rel = ed.files.active;
  if (!rel || !NotebookModel.isNotebook(rel)) return;
  const { source } = editorNotebookState(tab);
  const toSource = !source.has(rel);
  if (toSource) source.add(rel); else source.delete(rel);
  syncEditorNotebook(tab);
  if (toSource && ed.host) ed.host.focus();
}

/** Un file chiuso: la sua vista e la sua scelta se ne vanno con lui. */
function dropEditorNotebook(tab, rel) {
  const state = editorNotebookState(tab);
  state.source.delete(rel);
  state.views.delete(rel);
  if (state.shown === rel) state.shown = null;
}

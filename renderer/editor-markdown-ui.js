/* Anteprima dei file markdown nella scheda editor (docs/plans/83). Un .md si
   apre in Monaco come ogni file; il bottone nella testata lo mostra reso, in
   sola lettura, e torna al sorgente. La vista si disegna dal testo
   dell'editor (anche non salvato) con lo stesso parser e lo stesso disegno
   dei notebook: createElement e textContent, l'HTML resta testo, i link non
   navigano.
   Script dell'app, caricato dopo editor-notebook-ui.js: ne usa lo scope
   globale (NotebookView), solo dentro le funzioni. */

const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i;

/** @param {string} rel @returns {boolean} */
const isEditorMarkdown = (rel) => MARKDOWN_FILE.test(rel);

/* preview: i file mostrati resi; views: rel → {version, node, scroll};
   shown: il file nella vista adesso */
function editorMarkdownState(tab) {
  const ed = tab.editor;
  if (!ed.markdown) ed.markdown = { preview: new Set(), views: new Map(), shown: null };
  return ed.markdown;
}

function buildEditorMarkdown(tab, rel) {
  const { host } = tab.editor;
  const box = document.createElement('div');
  box.className = 'md-preview';
  box.append(NotebookView.renderMarkdown(document, host.getText(rel) || '', {
    colorize: (node, language) => host.colorize(node, language),
  }));
  return box;
}

/* Disegna `rel` nella vista; dallo stesso testo si riusa quello già fatto,
   e ogni file ritrova il punto dove lo si era lasciato. */
function showEditorMarkdown(tab, rel) {
  const state = editorMarkdownState(tab);
  const { host, ui } = tab.editor;
  const version = host.version(rel);
  const cached = state.views.get(rel);
  if (state.shown === rel && cached && cached.version === version) return;
  const fresh = !cached || cached.version !== version;
  // Ridisegnato sotto gli occhi (modifica, ricarica dal disco): resta dov'era
  const scroll = state.shown === rel ? ui.markdown.scrollTop : (cached ? cached.scroll : 0);
  const view = fresh ? { version, node: buildEditorMarkdown(tab, rel), scroll } : { ...cached, scroll };
  state.views.set(rel, view);
  state.shown = rel;
  ui.markdown.replaceChildren(view.node);
  ui.markdown.scrollTop = view.scroll;
}

/** Anteprima o Monaco per il file attivo; il bottone solo sui markdown. Da renderEditorOpen, dopo il notebook. */
function syncEditorMarkdown(tab) {
  const ed = tab.editor;
  const { ui } = ed;
  const rel = ed.files.active;
  const markdown = Boolean(rel) && isEditorMarkdown(rel);
  const state = editorMarkdownState(tab);
  const asView = markdown && Boolean(ed.host) && state.preview.has(rel);
  // Il punto della vista si legge prima di nasconderla: nascosta, scrollTop vale 0
  const leaving = state.shown && state.shown !== (asView ? rel : null) ? state.views.get(state.shown) : null;
  if (leaving) leaving.scroll = ui.markdown.scrollTop;
  ui.mdToggle.hidden = !markdown;
  ui.mdToggle.textContent = asView ? '{ } Sorgente' : '▤ Anteprima';
  ui.mdToggle.title = asView ? 'Modifica il markdown' : 'Mostra il markdown reso, in sola lettura';
  // Sui file non markdown Monaco lo decide il notebook (syncEditorNotebook, chiamato prima)
  if (markdown) ui.host.hidden = asView;
  ui.markdown.hidden = !asView;
  if (asView) showEditorMarkdown(tab, rel);
  else state.shown = null;
}

function toggleEditorMarkdown(tab) {
  const ed = tab.editor;
  const rel = ed.files.active;
  if (!rel || !isEditorMarkdown(rel)) return;
  const { preview } = editorMarkdownState(tab);
  const toPreview = !preview.has(rel);
  if (toPreview) preview.add(rel); else preview.delete(rel);
  syncEditorMarkdown(tab);
  if (!toPreview && ed.host) ed.host.focus();
  else if (toPreview) ed.ui.markdown.focus();
}

/** Un file chiuso: la sua vista e la sua scelta se ne vanno con lui. */
function dropEditorMarkdown(tab, rel) {
  const state = editorMarkdownState(tab);
  state.preview.delete(rel);
  state.views.delete(rel);
  if (state.shown === rel) state.shown = null;
}

/* Trovare i file nella scheda editor (docs/plans/70): le lettere git
   nell'albero, il filtro dei nomi già letti, «Vai al file» (Ctrl+P) su tutto
   il progetto e il simbolo sotto il titolo. Caricato dopo editor-tab.js, di
   cui usa le funzioni; l'elenco dei file e le lettere li dà il main
   (lib/editor-index.js). */

const EditorQuick = window.AisessEditorQuick;
const EDITOR_SYMBOL_DELAY = 150;

/* ---------- lettere git ---------- */

/** M/U/A/D per file, da git; fuori da un repository nessuna. */
async function loadEditorGitStatus(tab) {
  const r = await callEditor(() => window.aisess.editorGitStatus(tab.cwd));
  if (!tabs.has(tab.id)) return;
  if (!r.ok) { console.warn('editor-git-status fallito:', r.error); return; }
  tab.editor.git = r.status || {};
  renderEditorTree(tab);
  renderEditorTitle(tab);
  if (tab.editor.quick) tab.editor.quick.refresh();
}

/* ---------- elenco di tutti i file, per Ctrl+P ---------- */

/** L'elenco va riletto: una cartella è cambiata, o si è chiesto di rileggere. */
function forgetEditorFileList(tab) {
  tab.editor.allFiles = null;
}

function loadEditorFileList(tab) {
  const ed = tab.editor;
  if (ed.allFiles || ed.allFilesPending) return ed.allFilesPending;
  ed.allFilesPending = callEditor(() => window.aisess.editorListAll(tab.cwd)).then((r) => {
    ed.allFilesPending = null;
    if (!tabs.has(tab.id)) return;
    if (!r.ok) { showEditorMessage(tab, `Non si legge l'elenco dei file: ${r.error}`); return; }
    ed.allFiles = { files: r.files, truncated: Boolean(r.truncated) };
    if (ed.quick) ed.quick.refresh();
  });
  return ed.allFilesPending;
}

/* ---------- Vai al file (Ctrl+P) ---------- */

function openEditorQuick(tab) {
  const ed = tab.editor;
  if (ed.quick && ed.quick.isOpen()) { ed.quick.input.focus(); return; }
  ed.quick = EditorQuick.createQuickView({
    document, host: ed.ui.stage,
    source: () => ({
      files: ed.allFiles ? ed.allFiles.files : null,
      truncated: Boolean(ed.allFiles && ed.allFiles.truncated),
      loading: !ed.allFiles,
      open: ed.files.order,
      recent: ed.recent.map((r) => r.rel),
      git: ed.git,
    }),
    onPick: (rel) => openEditorFile(tab, rel),
    onClose: () => {
      ed.quick = null;
      if (ed.host) ed.host.focus();
    },
  });
  loadEditorFileList(tab);
}

/** «Vai al file… Ctrl P» in testa, a destra. */
function buildEditorQuickButton(tab, head) {
  const b = editorEl('button', 'editor-quick', head);
  b.title = 'Vai al file (Ctrl+P)';
  b.appendChild(editorCodicon('search'));
  b.appendChild(editorText('span', 'editor-quick-placeholder', 'Vai al file…'));
  const keys = editorEl('span', 'editor-kbd-group', b);
  for (const k of ['Ctrl', 'P']) keys.appendChild(editorText('kbd', 'kbd', k));
  b.onclick = () => openEditorQuick(tab);
  return b;
}

/* ---------- filtro dell'albero ---------- */

/** Il campo del filtro, al posto della testata «File» quando è attivo. */
function buildEditorFilter(tab, side) {
  const box = editorEl('div', 'editor-filter', side);
  box.hidden = true;
  box.appendChild(editorCodicon('filter', 'editor-filter-icon'));
  const input = editorEl('input', 'editor-filter-input', box);
  input.setAttribute('placeholder', 'Filtra i nomi…');
  input.setAttribute('aria-label', 'Filtra i nomi dei file');
  input.setAttribute('spellcheck', 'false');
  const count = editorEl('span', 'editor-filter-count', box);
  const clear = editorEl('button', 'editor-filter-clear', box);
  clear.title = 'Chiudi il filtro (Esc)';
  clear.setAttribute('aria-label', 'Chiudi il filtro');
  clear.appendChild(editorCodicon('close'));
  clear.onmousedown = (e) => e.preventDefault();
  clear.onclick = () => closeEditorFilter(tab);
  input.addEventListener('input', () => setEditorFilter(tab, input.value));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // i tasti del campo non sono scorciatoie
    if (e.key === 'Escape') { e.preventDefault(); closeEditorFilter(tab); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = EditorTree.filterRows(tab.editor.tree, input.value).find((r) => r.kind === 'file');
      if (first) openEditorFile(tab, first.rel);
    }
  });
  return { box, input, count };
}

function setEditorFilter(tab, query) {
  tab.editor.filter = { active: true, query };
  renderEditorTree(tab);
}

/** Dall'icona del filtro, o scrivendo con l'albero a fuoco (`initial` è la lettera). */
function openEditorFilter(tab, initial = '') {
  const { ui } = tab.editor;
  ui.filter.box.hidden = false;
  ui.fileHead.hidden = true;
  ui.filter.input.value = (tab.editor.filter.active ? ui.filter.input.value : '') + initial;
  setEditorFilter(tab, ui.filter.input.value);
  ui.filter.input.focus();
}

/** Esc o ×: l'albero torna com'era, aperture e selezione comprese. */
function closeEditorFilter(tab) {
  const { ui } = tab.editor;
  tab.editor.filter = { active: false, query: '' };
  ui.filter.input.value = '';
  ui.filter.box.hidden = true;
  ui.fileHead.hidden = false;
  renderEditorTree(tab);
  ui.tree.element.focus();
}

/** Click su una cartella fra i risultati: il filtro si chiude e l'albero la mostra aperta. */
async function openEditorDirFromFilter(tab, rel) {
  closeEditorFilter(tab);
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (!EditorTree.isExpanded(tab.editor.tree, dir)) await toggleEditorDir(tab, dir);
  }
}

function toggleEditorFilter(tab) {
  if (tab.editor.filter.active) closeEditorFilter(tab);
  else openEditorFilter(tab);
}

/** Il numero di risultati accanto al campo. */
function renderEditorFilterCount(tab, n) {
  tab.editor.ui.filter.count.textContent = String(n);
}

/* ---------- simbolo sotto il titolo ---------- */

/** In debounce: la funzione che contiene il cursore, dal worker JS/TS di Monaco. */
function scheduleEditorSymbol(tab, rel, pos) {
  const ed = tab.editor;
  clearTimeout(ed.symbolTimer);
  ed.symbolTimer = setTimeout(async () => {
    if (!ed.host || typeof ed.host.symbolAt !== 'function') return;
    const name = await ed.host.symbolAt(rel, pos.line, pos.col);
    // Il cursore o il file sono cambiati nel frattempo: vale la risposta più nuova
    if (!tabs.has(tab.id) || ed.files.active !== rel || ed.cursor !== pos) return;
    if (ed.symbol && ed.symbol.rel === rel && ed.symbol.name === name) return;
    ed.symbol = { rel, name };
    renderEditorTitle(tab);
  }, EDITOR_SYMBOL_DELAY);
}

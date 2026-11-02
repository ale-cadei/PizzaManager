/* Il notebook si modifica dalla vista (docs/plans/78): selezione, tasti del
   modo comando, una cella alla volta in modifica con un Monaco piccolo,
   barre della cella e del notebook.
   Ogni modifica riscrive il JSON del file con host.editText: è nella pila
   dell'undo e accende «modificato», e salvare resta quello di ogni file.
   Script dell'app, caricato dopo editor-notebook-ui.js: ne usa lo stato
   (editorNotebookState) e lo scope globale, solo dentro le funzioni. */

const NotebookEdit = window.AisessNotebookEdit;
const NB_COMMIT_MS = 300; // il testo battuto arriva al JSON dopo questa pausa
const NB_TYPES = [['code', 'Codice'], ['markdown', 'Markdown'], ['raw', 'Raw']];

function newEditorNotebookCellId() {
  const c = globalThis.crypto;
  const uuid = c && c.randomUUID ? c.randomUUID() : `${Math.random().toString(16).slice(2)}0000000000`;
  return uuid.replace(/-/g, '').slice(0, 8);
}

/* ---------- scrivere il JSON ---------- */

/**
 * Riscrive il notebook `rel` con `change(raw)`. `quiet`: la vista mostra già
 * il risultato (il testo della cella in modifica) e non si ridisegna.
 * @returns {boolean} false se il testo non è un notebook o non cambia
 */
function writeEditorNotebook(tab, rel, change, { quiet = false } = {}) {
  const { host } = tab.editor;
  const before = host.getText(rel);
  const parsed = before === null ? { ok: false } : NotebookEdit.parseRaw(before);
  if (!parsed.ok) return false;
  const text = NotebookEdit.serialize(change(parsed.raw));
  if (text === before) return false;
  const state = editorNotebookState(tab);
  state.quiet = quiet ? rel : null;
  try {
    host.editText(rel, text);
  } finally {
    state.quiet = null;
  }
  const view = state.views.get(rel);
  if (quiet && view) state.views.set(rel, { ...view, version: host.version(rel) });
  if (!quiet) syncEditorNotebook(tab);
  return true;
}

/* ---------- selezione ---------- */

/** L'indice selezionato fra quelli di `cells`: quello scelto, o il più vicino sopra, o il primo. */
function editorNotebookSelected(tab, rel, cells) {
  const want = editorNotebookState(tab).selected.get(rel);
  const indexes = cells.map((c) => c.index);
  if (!indexes.length) return null;
  if (want === undefined || indexes.includes(want)) return want === undefined ? indexes[0] : want;
  const above = indexes.filter((i) => i < want);
  return above.length ? above[above.length - 1] : indexes[0];
}

const editorNotebookCells = (view) => [...view.node.querySelectorAll('.nb-cell')];

function selectEditorNotebookCell(tab, rel, index) {
  const state = editorNotebookState(tab);
  state.selected.set(rel, index);
  const view = state.views.get(rel);
  if (!view) return;
  for (const node of editorNotebookCells(view)) {
    const on = Number(node.dataset.index) === index;
    node.classList.toggle('nb-cell--selected', on);
    if (on && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }
}

/** La posizione della selezionata fra le celle mostrate, e quelle celle. */
function editorNotebookPlace(tab, rel) {
  const view = editorNotebookState(tab).views.get(rel);
  const cells = view && view.nb ? view.nb.cells : [];
  const index = editorNotebookSelected(tab, rel, cells);
  return { cells, index, at: cells.findIndex((c) => c.index === index) };
}

function moveEditorNotebookSelection(tab, rel, delta) {
  const { cells, at } = editorNotebookPlace(tab, rel);
  if (!cells.length) return;
  const next = cells[Math.max(0, Math.min(cells.length - 1, at + delta))];
  selectEditorNotebookCell(tab, rel, next.index);
}

/* ---------- operazioni sulle celle ---------- */

function insertEditorNotebookCell(tab, rel, at, type) {
  editorNotebookState(tab).selected.set(rel, at);
  writeEditorNotebook(tab, rel, (raw) => NotebookEdit.insertCell(raw, at, type, newEditorNotebookCellId));
}

/** Sotto la selezionata, o in fondo se non ce n'è una. */
function insertEditorNotebookBelow(tab, rel, type) {
  const { cells, index } = editorNotebookPlace(tab, rel);
  insertEditorNotebookCell(tab, rel, index === null ? cells.length : index + 1, type);
}

function deleteEditorNotebookCell(tab, rel, index) {
  writeEditorNotebook(tab, rel, (raw) => NotebookEdit.deleteCell(raw, index));
}

function moveEditorNotebookCell(tab, rel, index, delta) {
  const { cells } = editorNotebookPlace(tab, rel);
  const at = cells.findIndex((c) => c.index === index);
  const other = cells[at + delta];
  if (!other) return;
  editorNotebookState(tab).selected.set(rel, other.index);
  // Le celle non oggetto stanno dove sono: si scambia con la vicina mostrata
  writeEditorNotebook(tab, rel, (raw) => NotebookEdit.moveCell(raw, index, other.index - index));
}

const setEditorNotebookType = (tab, rel, index, type) => writeEditorNotebook(tab, rel, (raw) => NotebookEdit.setType(raw, index, type));
const clearEditorNotebookOutputs = (tab, rel, index) => writeEditorNotebook(tab, rel, (raw) => NotebookEdit.clearOutputs(raw, index));

/** Il testo è cambiato da fuori della vista (undo): si ridisegna se serve. */
function undoEditorNotebook(tab, rel, redo) {
  const { host } = tab.editor;
  if (redo) host.redo(rel); else host.undo(rel);
  syncEditorNotebook(tab);
}

/* ---------- modo comando ---------- */

function runEditorNotebookCommand(tab, rel, command) {
  const { cells, index, at } = editorNotebookPlace(tab, rel);
  const run = {
    up: () => moveEditorNotebookSelection(tab, rel, -1),
    down: () => moveEditorNotebookSelection(tab, rel, 1),
    edit: () => { if (index !== null) editEditorNotebookCell(tab, rel, index); },
    // Shift+Invio: esegue e passa alla cella dopo; dall'ultima se ne crea una e ci si entra, come in Jupyter
    next: () => {
      if (index !== null) runEditorNotebookCell(tab, rel, index);
      if (at < cells.length - 1) { moveEditorNotebookSelection(tab, rel, 1); return; }
      insertEditorNotebookBelow(tab, rel, 'code');
      editEditorNotebookCell(tab, rel, editorNotebookPlace(tab, rel).index);
    },
    run: () => { if (index !== null) runEditorNotebookCell(tab, rel, index); },
    above: () => insertEditorNotebookCell(tab, rel, index === null ? 0 : index, 'code'),
    below: () => insertEditorNotebookBelow(tab, rel, 'code'),
    delete: () => { if (index !== null) deleteEditorNotebookCell(tab, rel, index); },
    code: () => { if (index !== null) setEditorNotebookType(tab, rel, index, 'code'); },
    markdown: () => { if (index !== null) setEditorNotebookType(tab, rel, index, 'markdown'); },
    raw: () => { if (index !== null) setEditorNotebookType(tab, rel, index, 'raw'); },
    undo: () => undoEditorNotebook(tab, rel, false),
    redo: () => undoEditorNotebook(tab, rel, true),
    save: () => saveEditorFile(tab, rel),
  }[command];
  if (run) run();
}

/** keydown sulla vista: i tasti del modo comando, quando nessuna cella è in modifica. */
function onEditorNotebookKey(tab, e) {
  const rel = tab.editor.files.active;
  const state = editorNotebookState(tab);
  if (!rel || state.editing || state.shown !== rel) return;
  const target = e.target && e.target.tagName;
  if (target === 'SELECT' || target === 'BUTTON' || target === 'INPUT') return; // i loro tasti restano loro
  const command = NotebookEdit.commandForKey(e, state.armed);
  state.armed = command === 'arm-delete';
  if (!command) return;
  e.preventDefault();
  e.stopPropagation();
  runEditorNotebookCommand(tab, rel, command);
}

/* ---------- la cella in modifica ---------- */

const editorNotebookCellNode = (view, index) => editorNotebookCells(view).find((n) => Number(n.dataset.index) === index);

function editorNotebookLanguage(nb, cell) {
  if (cell.type === 'code') return nb.language;
  return cell.type === 'markdown' ? 'markdown' : 'plaintext';
}

function editEditorNotebookCell(tab, rel, index) {
  const state = editorNotebookState(tab);
  if (state.editing) finishEditorNotebookCell(tab);
  const view = state.views.get(rel);
  const cell = view && view.nb && view.nb.cells.find((c) => c.index === index);
  const node = cell && editorNotebookCellNode(view, index);
  if (!node) return;
  selectEditorNotebookCell(tab, rel, index);
  const row = [...node.children].find((n) => n.classList.contains('nb-row'));
  const box = document.createElement('div');
  box.className = 'nb-cell-editor';
  row.replaceChildren(row.children[0], box); // il prompt resta, il contenuto diventa l'editor
  node.classList.add('nb-cell--editing');
  const editor = tab.editor.host.cellEditor(box, {
    text: cell.source,
    language: editorNotebookLanguage(view.nb, cell),
    onChange: () => scheduleEditorNotebookCommit(tab),
    onKey: (key) => onEditorNotebookCellKey(tab, key),
  });
  state.editing = { rel, index, editor, timer: null };
  editor.focus();
}

function scheduleEditorNotebookCommit(tab) {
  const { editing } = editorNotebookState(tab);
  if (!editing) return;
  clearTimeout(editing.timer);
  editing.timer = setTimeout(() => commitEditorNotebookCell(tab), NB_COMMIT_MS);
}

/** Il testo della cella in modifica nel JSON, senza ridisegnarla. */
function commitEditorNotebookCell(tab) {
  const { editing } = editorNotebookState(tab);
  if (!editing) return;
  clearTimeout(editing.timer);
  editing.timer = null;
  const text = editing.editor.getValue();
  writeEditorNotebook(tab, editing.rel, (raw) => NotebookEdit.setSource(raw, editing.index, text), { quiet: true });
}

/**
 * Il testo della cella in modifica nel modello del file, senza uscire dalla
 * cella: prima di salvare, di chiudere o di chiedersi cosa è da salvare,
 * altrimenti gli ultimi tasti (in attesa dei NB_COMMIT_MS) andrebbero persi.
 */
function flushEditorNotebook(tab) {
  if (tab.editor && tab.editor.notebook && tab.editor.notebook.editing) commitEditorNotebookCell(tab);
}

/** Via l'editor della cella, senza scrivere niente. */
function releaseEditorNotebookCell(state) {
  const { editing } = state;
  if (!editing) return;
  clearTimeout(editing.timer);
  state.editing = null;
  editing.editor.dispose();
}

/**
 * Esce dalla modifica: testo nel JSON, editor via. `redraw`: la cella torna
 * disegnata (una markdown si rende) e il fuoco torna alla vista.
 */
function finishEditorNotebookCell(tab, { redraw = true } = {}) {
  const state = editorNotebookState(tab);
  const { editing } = state;
  if (!editing) return;
  commitEditorNotebookCell(tab);
  releaseEditorNotebookCell(state);
  const view = state.views.get(editing.rel);
  if (view) state.views.set(editing.rel, { ...view, version: null }); // si ridisegna alla prossima occhiata
  if (!redraw) return;
  syncEditorNotebook(tab);
  tab.editor.ui.notebook.focus();
}

function onEditorNotebookCellKey(tab, key) {
  const { editing } = editorNotebookState(tab);
  if (!editing) return;
  const { rel } = editing;
  if (key === 'save') {
    commitEditorNotebookCell(tab);
    saveEditorFile(tab, rel);
    return;
  }
  finishEditorNotebookCell(tab);
  if (key === 'next' || key === 'run') runEditorNotebookCommand(tab, rel, key);
}

/* ---------- barre e click ---------- */

function editorNotebookButton(icon, label, title, run) {
  const b = document.createElement('button');
  b.className = 'nb-tool';
  b.title = title;
  b.append(editorCodicon(icon));
  if (label) b.append(editorText('span', 'nb-tool-label', label));
  b.onclick = run;
  return b;
}

/* Un click su una barra prima chiude la cella in modifica: l'operazione vede il suo testo.
   Dopo, il fuoco torna alla vista: il bottone premuto se n'è andato col ridisegno. */
const editorNotebookAction = (tab, fn) => () => { finishEditorNotebookCell(tab); fn(); tab.editor.ui.notebook.focus(); };

function editorNotebookTypePicker(tab, rel, cell) {
  const pick = document.createElement('select');
  pick.className = 'nb-type';
  pick.title = 'Tipo della cella (Y codice, M markdown, R raw)';
  for (const [type, label] of NB_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = label;
    pick.append(option);
  }
  pick.value = cell.type;
  pick.onchange = editorNotebookAction(tab, () => setEditorNotebookType(tab, rel, cell.index, pick.value));
  return pick;
}

function editorNotebookCellTools(tab, rel, cell) {
  const tools = document.createElement('div');
  tools.className = 'nb-cell-tools';
  // Non seleziona né chiude la modifica col mousedown: lo fa il click, se serve
  tools.addEventListener('mousedown', (e) => e.stopPropagation());
  const act = (fn) => editorNotebookAction(tab, fn);
  tools.append(
    editorNotebookButton('arrow-up', '', 'Sposta su', act(() => moveEditorNotebookCell(tab, rel, cell.index, -1))),
    editorNotebookButton('arrow-down', '', 'Sposta giù', act(() => moveEditorNotebookCell(tab, rel, cell.index, 1))),
    editorNotebookTypePicker(tab, rel, cell),
  );
  if (cell.type === 'code') {
    tools.append(editorNotebookButton('play', '', 'Esegui la cella (Ctrl+Invio)', act(() => runEditorNotebookCell(tab, rel, cell.index))));
    tools.append(editorNotebookButton('clear-all', '', 'Cancella output', act(() => clearEditorNotebookOutputs(tab, rel, cell.index))));
  }
  tools.append(editorNotebookButton('trash', '', 'Elimina la cella (D D)', act(() => deleteEditorNotebookCell(tab, rel, cell.index))));
  return tools;
}

function wireEditorNotebookCell(tab, rel, cell, node) {
  node.addEventListener('mousedown', (e) => {
    const { editing } = editorNotebookState(tab);
    if (editing && editing.rel === rel && editing.index === cell.index) return; // dentro l'editor della cella
    if (editing) {
      finishEditorNotebookCell(tab);
      e.preventDefault(); // il nodo è stato ridisegnato: il fuoco resta alla vista
    }
    selectEditorNotebookCell(tab, rel, cell.index);
  });
  node.addEventListener('dblclick', () => editEditorNotebookCell(tab, rel, cell.index));
  node.append(editorNotebookCellTools(tab, rel, cell));
}

function editorNotebookBar(tab, rel) {
  const bar = document.createElement('div');
  bar.className = 'nb-bar';
  bar.append(
    editorNotebookButton('add', 'Codice', 'Nuova cella di codice sotto la selezionata (B)',
      editorNotebookAction(tab, () => insertEditorNotebookBelow(tab, rel, 'code'))),
    editorNotebookButton('add', 'Markdown', 'Nuova cella markdown sotto la selezionata',
      editorNotebookAction(tab, () => insertEditorNotebookBelow(tab, rel, 'markdown'))),
    editorNotebookButton('clear-all', 'Cancella output', 'Cancella gli output di tutte le celle',
      editorNotebookAction(tab, () => clearEditorNotebookOutputs(tab, rel))),
    ...editorNotebookRunTools(tab, rel),
  );
  return bar;
}

/** La vista disegnata da notebook-view.js, con barre e click per modificarla. */
function decorateEditorNotebook(tab, rel, nb, root) {
  const byIndex = new Map(nb.cells.map((c) => [String(c.index), c]));
  for (const node of [...root.children]) {
    const cell = node.dataset && byIndex.get(node.dataset.index);
    if (cell) wireEditorNotebookCell(tab, rel, cell, node);
  }
  const wrap = document.createElement('div');
  wrap.className = 'nb-editable';
  wrap.append(editorNotebookBar(tab, rel), root);
  return wrap;
}

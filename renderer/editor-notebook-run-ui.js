/* Le celle di codice girano in un kernel Jupyter (docs/plans/79): uno per
   notebook aperto, avviato alla prima cella eseguita, spento con il file.
   Il kernel sta dietro al ponte del main (app/notebook-kernel.js); qui
   arrivano i suoi eventi e diventano gli output della cella nel JSON.
   Gli output si scrivono `quiet` e si ridisegna solo la cella che gira:
   una cella in modifica altrove resta aperta.
   Script dell'app, caricato dopo editor-notebook-edit-ui.js: ne usa le
   funzioni e lo scope globale (tabs), solo dentro le funzioni. */

const NotebookRun = window.AisessNotebookRun;
const NB_OUTPUT_MS = 100; // gli output in arrivo si scrivono al più così spesso
const NB_KERNEL_TEXT = {
  off: 'Kernel spento', starting: 'Avvio del kernel…', idle: 'Kernel pronto', busy: 'Kernel occupato',
  dead: 'Il kernel è morto: ↻ per riavviarlo',
};
let editorNotebookRunSeq = 0;

/* ---------- lo stato dei kernel ---------- */

/** rel → kernel del notebook, per scheda. */
function editorNotebookKernels(tab) {
  const ed = tab.editor;
  if (!ed.kernels) ed.kernels = new Map();
  return ed.kernels;
}

/* id: quello del main, null se spento; runs: runId → {cellId, index, source, state}
   (source ritrova la cella senza id, nbformat < 4.5);
   dirty: le corse con output da scrivere al prossimo giro del timer */
function editorNotebookKernel(tab, rel) {
  const kernels = editorNotebookKernels(tab);
  if (!kernels.has(rel)) {
    kernels.set(rel, { id: null, starting: null, status: 'off', message: '', display: '', runs: new Map(), dirty: new Set(), timer: null });
  }
  return kernels.get(rel);
}

function findEditorNotebookKernel(id) {
  for (const tab of tabs.values()) {
    if (!tab.editor || !tab.editor.kernels) continue;
    for (const [rel, k] of tab.editor.kernels) if (k.id === id) return { tab, rel, k };
  }
  return null;
}

async function callEditorKernel(fn) {
  try {
    const r = await fn();
    return r && typeof r === 'object' ? r : { ok: false, error: 'nessuna risposta dal main' };
  } catch (e) {
    console.warn('[kernel]', e);
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Il JSON del notebook, o null se il testo non lo è. */
function editorNotebookRaw(tab, rel) {
  const { host } = tab.editor;
  const text = host ? host.getText(rel) : null;
  const parsed = text === null || text === undefined ? { ok: false } : NotebookEdit.parseRaw(text);
  return parsed.ok ? parsed.raw : null;
}

/** La cartella del notebook: il kernel parte lì, come in Jupyter. */
function editorNotebookDir(tab, rel) {
  const f = tab.editor.files.files[rel];
  const file = f && f.path;
  if (!file) return null;
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (cut < 0) return null;
  const dir = file.slice(0, cut || 1);
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}

/** Gli indici delle celle in corso o in coda, per il prompt `[*]`. */
function editorNotebookRunning(tab, rel) {
  const k = tab.editor.kernels && tab.editor.kernels.get(rel);
  const raw = k && k.runs.size ? editorNotebookRaw(tab, rel) : null;
  if (!raw) return new Set();
  const indexes = [...k.runs.values()].filter((r) => !r.state.done).map((r) => NotebookEdit.cellIndexById(raw, r.cellId, r.index, r.source));
  return new Set(indexes.filter((i) => i >= 0));
}

/* ---------- la barra ---------- */

function editorNotebookKernelText(k) {
  if (k.status === 'missing' || k.status === 'error') return k.message;
  const base = NB_KERNEL_TEXT[k.status] || '';
  return k.display && (k.status === 'idle' || k.status === 'busy') ? `${base} · ${k.display}` : base;
}

function setEditorNotebookKernel(tab, rel, k, patch) {
  Object.assign(k, patch);
  const view = editorNotebookState(tab).views.get(rel);
  if (!view) return;
  for (const node of view.node.querySelectorAll('.nb-kernel')) {
    node.textContent = editorNotebookKernelText(k); // il messaggio può venire dal ponte
    node.dataset.state = k.status;
  }
}

/** Bottoni e stato del kernel nella barra del notebook. */
function editorNotebookRunTools(tab, rel) {
  const k = editorNotebookKernel(tab, rel);
  const status = editorText('span', 'nb-kernel', editorNotebookKernelText(k));
  status.dataset.state = k.status;
  const act = (fn) => editorNotebookAction(tab, fn);
  return [
    editorNotebookButton('run-all', 'Esegui tutto', 'Esegui tutte le celle di codice',
      act(() => runAllEditorNotebookCells(tab, rel))),
    editorNotebookButton('debug-stop', '', 'Interrompi la cella in corso', act(() => interruptEditorNotebookKernel(tab, rel))),
    editorNotebookButton('debug-restart', '', 'Riavvia il kernel: le variabili si perdono, gli output restano',
      act(() => restartEditorNotebookKernel(tab, rel))),
    status,
  ];
}

/* ---------- avvio ---------- */

function ensureEditorNotebookKernel(tab, rel) {
  const k = editorNotebookKernel(tab, rel);
  if (k.id) return Promise.resolve(k.id);
  if (!k.starting) k.starting = startEditorNotebookKernel(tab, rel, k).finally(() => { k.starting = null; });
  return k.starting;
}

async function startEditorNotebookKernel(tab, rel, k) {
  const raw = editorNotebookRaw(tab, rel);
  // Il kernel partirebbe su questo computer, in una cartella che qui non c'è
  if (isRemoteEditor(tab)) return failEditorNotebookStart(tab, rel, k, { error: EDITOR_LOCAL_ONLY });
  setEditorNotebookKernel(tab, rel, k, { status: 'starting', message: '' });
  const r = await callEditorKernel(() => window.aisess.kernelStart(editorNotebookDir(tab, rel), NotebookRun.kernelNameOf(raw && raw.doc)));
  if (editorNotebookKernels(tab).get(rel) !== k) {
    // Il file si è chiuso mentre il kernel partiva
    if (r.ok) callEditorKernel(() => window.aisess.kernelShutdown(r.id));
    return null;
  }
  if (r.ok && typeof r.id !== 'string') return failEditorNotebookStart(tab, rel, k, { error: 'kernel: il main non ha dato un id' });
  if (!r.ok) return failEditorNotebookStart(tab, rel, k, r);
  k.id = r.id;
  return r.id;
}

function failEditorNotebookStart(tab, rel, k, r) {
  const missing = Boolean(r.missing);
  setEditorNotebookKernel(tab, rel, k, { status: missing ? 'missing' : 'error', message: missing ? NotebookRun.missingMessage(r) : String(r.error || '') });
  return null;
}

/* ---------- eseguire ---------- */

/**
 * Esegue la cella `index`, se è di codice: output via, `[*]`, e il codice
 * al kernel (avviato se serve).
 * @returns {boolean} false se non è una cella di codice
 */
function runEditorNotebookCell(tab, rel, index) {
  const raw = editorNotebookRaw(tab, rel);
  const cell = raw && raw.doc.cells[index];
  if (!cell || cell.cell_type !== 'code') return false;
  const code = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
  const runId = `r${++editorNotebookRunSeq}`;
  const k = editorNotebookKernel(tab, rel);
  k.runs.set(runId, { cellId: typeof cell.id === 'string' ? cell.id : null, index, source: code, state: NotebookRun.startRun() });
  writeEditorNotebookRun(tab, rel, k, runId);
  sendEditorNotebookRun(tab, rel, runId, code);
  return true;
}

function runAllEditorNotebookCells(tab, rel) {
  const raw = editorNotebookRaw(tab, rel);
  if (!raw) return;
  raw.doc.cells.forEach((c, i) => { if (c && c.cell_type === 'code') runEditorNotebookCell(tab, rel, i); });
}

async function sendEditorNotebookRun(tab, rel, runId, code) {
  const id = await ensureEditorNotebookKernel(tab, rel);
  const k = editorNotebookKernels(tab).get(rel);
  if (!k || !k.runs.has(runId)) return;
  const r = id ? await callEditorKernel(() => window.aisess.kernelExecute(id, runId, code)) : { ok: false };
  if (r.ok) return;
  if (r.error) setEditorNotebookKernel(tab, rel, k, { status: 'error', message: r.error });
  endEditorNotebookRun(tab, rel, k, runId, 'dead');
}

function interruptEditorNotebookKernel(tab, rel) {
  const k = editorNotebookKernel(tab, rel);
  if (k.id) callEditorKernel(() => window.aisess.kernelInterrupt(k.id));
}

/** Con il kernel acceso lo riavvia il ponte; spento o mai partito, se ne avvia uno. */
function restartEditorNotebookKernel(tab, rel) {
  const k = editorNotebookKernel(tab, rel);
  if (!k.id) {
    ensureEditorNotebookKernel(tab, rel);
    return;
  }
  setEditorNotebookKernel(tab, rel, k, { status: 'starting', message: '' });
  callEditorKernel(() => window.aisess.kernelRestart(k.id));
}

/* ---------- gli output nel JSON ---------- */

/** Gli output della corsa nella sua cella, ritrovata per id: può essersi spostata. */
function writeEditorNotebookRun(tab, rel, k, runId) {
  const run = k.runs.get(runId);
  const raw = run && editorNotebookRaw(tab, rel);
  if (!raw) return;
  const index = NotebookEdit.cellIndexById(raw, run.cellId, run.index, run.source);
  if (index < 0) return; // la cella non c'è più
  run.index = index;
  const outputs = NotebookRun.toFileOutputs(run.state.outputs);
  writeEditorNotebook(tab, rel, (r) => NotebookEdit.setOutputs(r, index, outputs, run.state.count), { quiet: true });
  patchEditorNotebookCell(tab, rel, index);
}

const editorNotebookChildren = (node, cls) => [...node.children].filter((n) => n.classList.contains(cls));

/** Ridisegna output e prompt della cella `index`, senza toccare le altre. */
function patchEditorNotebookCell(tab, rel, index) {
  const state = editorNotebookState(tab);
  const view = state.views.get(rel);
  if (!view || !view.nb) return;
  const nb = NotebookModel.parseNotebook(tab.editor.host.getText(rel));
  if (!nb.ok) return;
  state.views.set(rel, { ...view, nb });
  const cell = nb.cells.find((c) => c.index === index);
  const node = editorNotebookCellNode(view, index);
  if (!cell || !node) return;
  for (const out of editorNotebookChildren(node, 'nb-output')) out.remove();
  const tools = editorNotebookChildren(node, 'nb-cell-tools')[0] || null;
  for (const row of NotebookView.renderOutputs(document, cell.outputs, editorNotebookViewOptions(tab, rel))) node.insertBefore(row, tools);
  const input = editorNotebookChildren(node, 'nb-input')[0];
  const prompt = input && editorNotebookChildren(input, 'nb-prompt')[0];
  if (prompt) prompt.textContent = NotebookView.promptOf(cell, editorNotebookRunning(tab, rel).has(index));
}

/* Scrive le corse con output nuovi; quelle finite se ne vanno */
function flushEditorNotebookRuns(tab, rel, k) {
  clearTimeout(k.timer);
  k.timer = null;
  const dirty = [...k.dirty];
  k.dirty.clear();
  for (const runId of dirty) {
    writeEditorNotebookRun(tab, rel, k, runId);
    const run = k.runs.get(runId);
    if (run && run.state.done) k.runs.delete(runId);
  }
}

/** La corsa finisce senza che il kernel l'abbia detto (non partito, uscito). */
function endEditorNotebookRun(tab, rel, k, runId, status) {
  const run = k.runs.get(runId);
  if (!run) return;
  run.state = NotebookRun.applyEvent(run.state, { ev: 'done', status });
  k.dirty.add(runId);
  flushEditorNotebookRuns(tab, rel, k);
}

function onEditorNotebookRunEvent(tab, rel, k, event) {
  const run = k.runs.get(event.run);
  if (!run) return;
  run.state = NotebookRun.applyEvent(run.state, event);
  k.dirty.add(event.run);
  if (event.ev === 'done' || event.ev === 'started') flushEditorNotebookRuns(tab, rel, k);
  else if (!k.timer) k.timer = setTimeout(() => flushEditorNotebookRuns(tab, rel, k), NB_OUTPUT_MS);
}

/* ---------- gli eventi del kernel ---------- */

function exitedEditorNotebookKernel(tab, rel, k, event) {
  k.id = null;
  for (const runId of [...k.runs.keys()]) endEditorNotebookRun(tab, rel, k, runId, 'dead');
  if (k.status === 'missing') return; // il perché è già nella barra
  const tail = String(event.stderr || '').trim().split('\n').pop();
  const failed = event.code !== 0;
  setEditorNotebookKernel(tab, rel, k, {
    status: failed ? 'error' : 'off',
    message: failed ? `Il kernel si è fermato${tail ? `: ${tail}` : ''}` : '',
  });
}

function onEditorNotebookKernelState(tab, rel, k, event) {
  const set = (patch) => setEditorNotebookKernel(tab, rel, k, patch);
  switch (event.ev) {
    case 'ready': set({ status: 'idle', message: '', display: String(event.display || event.kernel || '') }); break;
    case 'missing': set({ status: 'missing', message: NotebookRun.missingMessage(event) }); break;
    case 'status': if (event.state === 'busy' || event.state === 'idle') set({ status: event.state }); break;
    case 'dead': set({ status: 'dead' }); break;
    case 'error': set({ status: 'error', message: `Kernel: ${String(event.message || '')}` }); break;
    case 'exit': exitedEditorNotebookKernel(tab, rel, k, event); break;
    default: break;
  }
}

function onEditorNotebookKernelEvent(event) {
  if (!event || typeof event.id !== 'string' || typeof event.ev !== 'string') return;
  const found = findEditorNotebookKernel(event.id);
  if (!found) return;
  const { tab, rel, k } = found;
  if (typeof event.run === 'string') onEditorNotebookRunEvent(tab, rel, k, event);
  else onEditorNotebookKernelState(tab, rel, k, event);
}

/* ---------- spegnere ---------- */

/** Il file si chiude: il suo kernel si spegne. */
function stopEditorNotebookKernel(tab, rel) {
  const kernels = tab.editor.kernels;
  const k = kernels && kernels.get(rel);
  if (!k) return;
  kernels.delete(rel);
  clearTimeout(k.timer);
  if (k.id) callEditorKernel(() => window.aisess.kernelShutdown(k.id));
}

function stopEditorNotebookKernels(tab) {
  if (tab.editor && tab.editor.kernels) for (const rel of [...tab.editor.kernels.keys()]) stopEditorNotebookKernel(tab, rel);
}

/** Da initEditorTabs. */
function initEditorNotebookRun() {
  window.aisess.onKernelEvent(onEditorNotebookKernelEvent);
}

/* Scheda di tipo editor (docs/plans/60): niente pty, l'albero della cartella
   della sessione e Monaco con una sotto-scheda per file aperto. Leggere,
   scrivere e sorvegliare i file lo fa il main (lib/editor-fs.js,
   lib/editor-watch.js), che confina ogni percorso nella cartella.
   Lo stato dei file aperti sta in editor-files.js, l'albero in
   editor-tree.js, Monaco in editor-monaco.js: qui il cablaggio.
   Le barrette delle righe cambiate (docs/plans/63) stanno in
   editor-tab-gutter.js, caricato prima di questo.
   Le schede si salvano (lib/editor-sessions.js) e tornano al riavvio coi
   file che avevano aperti, come le schede git. */

const EditorFiles = window.AisessEditorFiles;
const EditorTree = window.AisessEditorTree;
const EditorMonaco = window.AisessEditorMonaco;
const EditorPanel = window.AisessEditorPanel;
// Larghezza e aperto/chiuso dell'albero, uguali per tutte le schede editor
// e ricordati al riavvio (docs/plans/62): applicati subito alla pagina
const editorPanel = EditorPanel.createPanel({ doc: document, storage: localStorage });
// Domande appese all'editor (sotto-schede, albero): un fumetto suo, che i
// render della sidebar non spostano (closeConfirm segue le card)
const editorConfirm = ConfirmBubble.createConfirmBubble();

const EDITOR_READ_REASONS = {
  binary: 'è un file binario: l\'editor apre solo testo.',
  'too-large': 'è più grande di 5 MB.',
  'not-utf8': 'non è testo UTF-8.',
  outside: 'sta fuori dalla cartella della sessione.',
  missing: 'non esiste più.',
  'not-file': 'non è un file.',
};
let editorExitConfirmed = false;
let editorExitAsking = false;

const errorText = (e) => String((e && e.message) || e);
const readReason = (r) => EDITOR_READ_REASONS[r && r.reason] || (r && r.error) || 'errore sconosciuto.';

/** Una chiamata al main che non lancia mai: un rifiuto diventa {ok:false}. */
async function callEditor(fn) {
  try {
    return (await fn()) || { ok: false, error: 'nessuna risposta dal main' };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/* ---------- disegno ---------- */

function editorEl(tag, className, parent) {
  const n = document.createElement(tag);
  n.className = className;
  parent.appendChild(n);
  return n;
}

/** Bottone a sola icona (codicon): il titolo fa da etichetta. */
function editorIconButton(parent, { icon, title, run }) {
  const b = editorEl('button', 'editor-icon-btn', parent);
  editorEl('span', `codicon codicon-${icon}`, b).setAttribute('aria-hidden', 'true');
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = run;
  return b;
}

/** Testata di una sezione del pannello: «ETICHETTA», contatore opzionale, azioni a destra. */
function editorSectionHead(parent, label, actions) {
  const head = editorEl('div', 'editor-section-head', parent);
  editorEl('span', 'editor-section-label', head).textContent = label;
  const count = editorEl('span', 'count', head);
  count.hidden = true;
  editorEl('span', 'spacer', head);
  for (const a of actions) editorIconButton(head, a);
  return { head, count };
}

function buildEditorLayout(tab) {
  const el = editorEl;
  const side = el('aside', 'editor-side', tab.wrap);
  editorSectionHead(side, 'File', [
    { icon: 'new-file', title: 'Nuovo file nella cartella della sessione', run: () => newEditorEntry(tab, '', 'file') },
    { icon: 'new-folder', title: 'Nuova cartella nella cartella della sessione', run: () => newEditorEntry(tab, '', 'dir') },
    { icon: 'refresh', title: 'Rileggi le cartelle aperte', run: () => reloadEditorTree(tab) },
  ]);
  const treeHost = el('div', 'editor-tree-host', side);
  const tree = EditorTree.createTreeView({
    root: treeHost, document,
    onOpenFile: (rel) => openEditorFile(tab, rel),
    onToggleDir: (rel) => toggleEditorDir(tab, rel),
    onContextMenu: (row, e) => editorTreeMenu(tab, row, e),
    onCopyInto: (dir, source) => copyIntoEditor(tab, dir, source),
    onDeselect: () => clearEditorSelection(tab),
    onRename: (row) => renameEditorEntry(tab, row),
    onTrash: (row) => trashEditorEntry(tab, row),
  });
  const resizer = el('div', 'editor-resizer', tab.wrap);
  resizer.title = `Trascina per allargare l'albero, doppio click per tornare a ${EditorPanel.DEFAULT_W}px`;
  editorPanel.attachResizer(resizer, { side, wrap: tab.wrap, win: window });
  const main = el('section', 'editor-main', tab.wrap);
  // Il bottone sta fuori dal tablist: renderEditorSubtabs ne rimpiazza i figli
  const head = el('div', 'editor-head', main);
  const toggle = el('button', 'btn btn--ghost editor-tree-toggle', head);
  toggle.textContent = '☰';
  toggle.title = 'Mostra/nascondi file (Ctrl+B)';
  toggle.setAttribute('aria-label', 'Mostra/nascondi file');
  toggle.onmousedown = (e) => e.preventDefault(); // il fuoco resta a Monaco
  toggle.onclick = () => editorPanel.toggle();
  const subtabs = el('div', 'editor-subtabs', head);
  subtabs.setAttribute('role', 'tablist');
  // «N commenti · Copia prompt · Svuota» (docs/plans/65), la disegna editor-notes-ui.js
  const notesBar = el('div', 'editor-notes-bar', head);
  notesBar.hidden = true;
  const bar = el('div', 'editor-bar', main);
  bar.hidden = true;
  const message = el('div', 'editor-message', main);
  message.hidden = true;
  const host = el('div', 'editor-host', main);
  return { treeHost, tree, subtabs, notesBar, bar, message, host };
}

function renderEditorTree(tab) {
  const { tree, ui } = tab.editor;
  ui.tree.render(EditorTree.visibleRows(tree), tree.selected);
}

function showEditorMessage(tab, text) {
  const { message } = tab.editor.ui;
  message.classList.remove('is-info');
  message.textContent = text; // può contenere nomi di file ed errori del sistema
  message.hidden = false;
}

/** Come showEditorMessage, ma non è un errore (avanzamento ed esito della copia). */
function showEditorNotice(tab, text) {
  showEditorMessage(tab, text);
  tab.editor.ui.message.classList.add('is-info');
}

function hideEditorMessage(tab) {
  tab.editor.ui.message.hidden = true;
}

function renderEditorSubtabs(tab) {
  const { files, ui } = tab.editor;
  ui.subtabs.replaceChildren(...files.order.map((rel) => {
    const f = files.files[rel];
    const b = document.createElement('div');
    b.className = 'editor-subtab'
      + (rel === files.active ? ' is-active' : '')
      + (f.dirty ? ' is-dirty' : '')
      + (f.deleted ? ' is-deleted' : '');
    b.title = rel + (f.deleted ? ' — eliminato dal disco' : '');
    b.setAttribute('role', 'tab');
    const name = document.createElement('span');
    name.className = 'editor-subtab-name';
    name.textContent = EditorFiles.baseName(rel);
    const dot = document.createElement('span');
    dot.className = 'editor-subtab-dot';
    dot.textContent = '●';
    dot.title = 'Non salvato';
    const x = document.createElement('button');
    x.className = 'editor-subtab-close';
    x.textContent = '×';
    x.title = 'Chiudi';
    x.setAttribute('aria-label', `Chiudi ${rel}`);
    x.onclick = (e) => { e.stopPropagation(); closeEditorFile(tab, rel, x); };
    b.onclick = () => activateEditorFile(tab, rel);
    b.onauxclick = (e) => { if (e.button === 1) closeEditorFile(tab, rel, x); };
    b.append(name, dot, x);
    return b;
  }));
  renderEditorBar(tab);
}

/* La barra sotto le sotto-schede parla del file attivo: errore,
   conflitto col disco, file eliminato. */
function renderEditorBar(tab) {
  const { files, ui } = tab.editor;
  const f = files.active ? files.files[files.active] : null;
  const bar = ui.bar;
  bar.replaceChildren();
  bar.className = 'editor-bar';
  bar.hidden = true;
  const show = (text, cls, actions = []) => {
    bar.hidden = false;
    bar.classList.add(cls);
    const t = document.createElement('span');
    t.className = 'editor-bar-text';
    t.textContent = text;
    bar.appendChild(t);
    for (const [label, run] of actions) {
      const b = document.createElement('button');
      b.className = 'btn btn--ghost';
      b.textContent = label;
      b.onclick = run;
      bar.appendChild(b);
    }
  };
  if (!f) return;
  if (f.error) show(f.error, 'is-error', [['Chiudi', () => setEditorFile(tab, f.rel, { error: null })]]);
  else if (f.conflict === 'disk') show('Cambiato sul disco mentre lo modificavi.', 'is-warn',
    [['Ricarica', () => reloadEditorFile(tab, f.rel)], ['Tieni il mio', () => keepEditorVersion(tab, f.rel)]]);
  else if (f.conflict === 'save') show('Cambiato sul disco da quando l\'hai aperto: salvare lo sovrascrive.', 'is-warn',
    [['Sovrascrivi', () => keepEditorVersion(tab, f.rel, { save: true })], ['Ricarica', () => reloadEditorFile(tab, f.rel)]]);
  else if (f.deleted) show('Eliminato dal disco. Salva (Ctrl+S) per ricrearlo.', 'is-warn');
}

function setEditorFile(tab, rel, patch) {
  tab.editor.files = EditorFiles.update(tab.editor.files, rel, patch);
  renderEditorSubtabs(tab);
}

/* ---------- albero ---------- */

async function loadEditorDir(tab, dir) {
  const r = await callEditor(() => window.aisess.editorList(tab.cwd, dir));
  if (!tabs.has(tab.id)) return;
  if (!r.ok) {
    showEditorMessage(tab, `Impossibile leggere ${dir || 'la cartella'}: ${r.error}`);
    return;
  }
  tab.editor.tree = EditorTree.setChildren(tab.editor.tree, dir, r.entries);
  renderEditorTree(tab);
}

async function toggleEditorDir(tab, rel) {
  tab.editor.tree = EditorTree.select(EditorTree.toggle(tab.editor.tree, rel), rel);
  renderEditorTree(tab);
  if (EditorTree.isExpanded(tab.editor.tree, rel)) await loadEditorDir(tab, rel);
}

/** Click nel vuoto dell'albero: senza, Ctrl+V nella radice resta irraggiungibile
 *  una volta selezionato qualcosa (piano 61). */
function clearEditorSelection(tab) {
  tab.editor.tree = EditorTree.deselect(tab.editor.tree);
  renderEditorTree(tab);
}

async function reloadEditorTree(tab) {
  for (const dir of ['', ...tab.editor.tree.expanded]) await loadEditorDir(tab, dir);
}

function editorTreeMenu(tab, row, e) {
  const dir = !row ? '' : row.kind === 'dir' ? row.rel : EditorFiles.parentRel(row.rel);
  const items = [
    { label: 'Nuovo file', icon: 'new-file', run: () => newEditorEntry(tab, dir, 'file') },
    { label: 'Nuova cartella', icon: 'new-folder', run: () => newEditorEntry(tab, dir, 'dir') },
    { sep: true },
    { label: 'Copia qui file…', icon: 'cloud-download', run: () => copyIntoEditor(tab, dir, { kind: 'pick' }) },
    { label: 'Incolla', icon: 'clippy', key: 'Ctrl V', run: () => copyIntoEditor(tab, dir, { kind: 'paste' }) },
  ];
  const rowItems = row ? [
    { sep: true },
    { label: 'Rinomina', icon: 'edit', key: 'F2', run: () => renameEditorEntry(tab, row) },
    { label: 'Copia percorso', icon: 'copy', run: () => copyEditorPath(tab, row.rel) },
    { sep: true },
    { label: 'Elimina', icon: 'trash', key: 'Canc', danger: true, run: () => trashEditorEntry(tab, row) },
  ] : [];
  EditorTree.showMenu({ document, x: e.clientX, y: e.clientY, items: [...items, ...rowItems] });
}

/** Il percorso relativo alla cartella della sessione: quello che si scrive in un prompt. */
async function copyEditorPath(tab, rel) {
  const r = await callEditor(() => window.aisess.clipboardWrite(rel));
  if (!r.ok) showEditorMessage(tab, `Non si copia il percorso: ${r.error}`);
}

async function newEditorEntry(tab, dir, kind) {
  const ed = tab.editor;
  if (dir && !EditorTree.isExpanded(ed.tree, dir)) await toggleEditorDir(tab, dir);
  const name = await EditorTree.promptName({
    document, host: ed.ui.tree.element,
    after: dir ? ed.ui.tree.rowOf(dir) : null,
    depth: dir ? dir.split('/').length : 0,
  });
  if (!name) return;
  const rel = EditorFiles.joinRel(dir, name);
  const r = await callEditor(() => (kind === 'dir'
    ? window.aisess.editorMkdir(tab.cwd, rel)
    : window.aisess.editorCreate(tab.cwd, rel)));
  if (!r.ok) { showEditorMessage(tab, `Non si crea ${rel}: ${r.error}`); return; }
  await loadEditorDir(tab, dir);
  if (kind === 'file') await openEditorFile(tab, rel);
}

async function renameEditorEntry(tab, row) {
  const ed = tab.editor;
  const name = await EditorTree.promptName({
    document, host: ed.ui.tree.element, after: ed.ui.tree.rowOf(row.rel), depth: row.depth, initial: row.name,
  });
  if (!name || name === row.name) return;
  const r = await callEditor(() => window.aisess.editorRename(tab.cwd, row.rel, name));
  if (!r.ok) { showEditorMessage(tab, `Non si rinomina ${row.rel}: ${r.error}`); return; }
  // I file aperti lì sotto seguono: stato, model di Monaco, watch
  const moved = EditorFiles.affectedBy(ed.files, row.rel);
  for (const rel of moved) unwatchEditorFile(tab, rel);
  ed.files = EditorFiles.renamePath(ed.files, row.rel, r.rel);
  for (const rel of moved) {
    const to = EditorFiles.movedPath(rel, row.rel, r.rel);
    if (ed.host) ed.host.rename(rel, to);
    renameEditorNotes(tab, rel, to);
    ed.gutterSeq.delete(rel);
    ed.files = EditorFiles.update(ed.files, to, { gutterBase: null, changes: null });
    loadEditorGutterBase(tab, to);
    await watchEditorFile(tab, to);
  }
  ed.tree = EditorTree.renamePath(ed.tree, row.rel, r.rel);
  await loadEditorDir(tab, EditorFiles.parentRel(row.rel));
  renderEditorSubtabs(tab);
  saveEditorSessions();
}

async function trashEditorEntry(tab, row) {
  const ed = tab.editor;
  const yes = await editorConfirm.ask({
    anchor: ed.ui.tree.rowOf(row.rel) || ed.ui.treeHost,
    title: `Eliminare «${row.name}»?`,
    text: row.kind === 'dir' ? 'La cartella e tutto quello che contiene vanno nel cestino.' : 'Il file va nel cestino.',
    confirmLabel: 'Elimina',
  });
  if (!yes) return;
  const r = await callEditor(() => window.aisess.editorTrash(tab.cwd, row.rel));
  if (!r.ok) { showEditorMessage(tab, `Non si elimina ${row.rel}: ${r.error}`); return; }
  // Un file aperto e pulito si chiude; uno con modifiche resta, «eliminato»
  for (const rel of EditorFiles.affectedBy(ed.files, row.rel)) {
    if (ed.host && ed.host.isDirty(rel)) ed.files = EditorFiles.markDeleted(ed.files, rel);
    else dropEditorFile(tab, rel);
  }
  ed.tree = EditorTree.removePath(ed.tree, row.rel);
  await loadEditorDir(tab, EditorFiles.parentRel(row.rel));
  renderEditorSubtabs(tab);
  saveEditorSessions();
}

/* ---------- file aperti ---------- */

function ensureEditorHost(tab) {
  const ed = tab.editor;
  if (ed.host) return Promise.resolve(ed.host);
  if (!ed.hostPending) {
    ed.hostPending = EditorMonaco.load(window).then((monaco) => {
      if (!tabs.has(tab.id)) return null;
      ed.host = EditorMonaco.createEditorHost({
        monaco, container: ed.ui.host, fontSize: termFont.get(),
        onChange: (rel, dirty, edited) => onEditorTextChange(tab, rel, dirty, edited),
        onSave: (rel) => saveEditorFile(tab, rel),
        onSaveAll: () => saveAllEditorFiles(tab),
        onComment: (rel, from, to) => openEditorNoteDraft(tab, rel, from, to),
      });
      return ed.host;
    }).finally(() => { ed.hostPending = null; });
  }
  return ed.hostPending;
}

/* Il testo di un file è cambiato (scrittura, undo, ricarica) o è solo
   tornato pulito (salvataggio: `edited` false, le barrette non cambiano) */
function onEditorTextChange(tab, rel, dirty, edited = true) {
  const f = tab.editor.files.files[rel];
  if (!f) return;
  if (f.dirty !== dirty) setEditorFile(tab, rel, { dirty });
  syncEditorNotes(tab, rel);
  if (edited) { scheduleEditorGutter(tab, rel); scheduleEditorConflicts(tab, rel); }
}

/* Una rinomina, un salvataggio o una ricarica possono finire dopo
   disposeEditorTab: una scheda chiusa non arma watch (e uno armato mentre
   si chiudeva si toglie). */
async function watchEditorFile(tab, rel) {
  if (!tabs.has(tab.id)) return;
  const r = await callEditor(() => window.aisess.editorWatch(tab.cwd, rel));
  if (!r.ok) { console.warn('editor-watch fallito:', r.error); return; }
  if (!tabs.has(tab.id)) { unwatchEditorFile(tab, rel); return; }
  if (tab.editor.files.files[rel]) tab.editor.files = EditorFiles.update(tab.editor.files, rel, { path: r.path });
}

function unwatchEditorFile(tab, rel) {
  callEditor(() => window.aisess.editorUnwatch(tab.cwd, rel))
    .then((r) => { if (!r.ok) console.warn('editor-unwatch fallito:', r.error); });
}

/**
 * Apre (o porta davanti) un file. `quiet`: al ripristino un file sparito si
 * salta senza dirlo, e la lista salvata non si riscrive a ogni file.
 * @returns {Promise<boolean>} true se il file è aperto
 */
async function openEditorFile(tab, rel, { quiet = false } = {}) {
  const ed = tab.editor;
  ed.tree = EditorTree.select(ed.tree, rel);
  renderEditorTree(tab);
  if (ed.files.files[rel]) { activateEditorFile(tab, rel, { save: !quiet }); return true; }
  const r = await callEditor(() => window.aisess.editorRead(tab.cwd, rel));
  if (!r.ok) {
    if (!quiet) showEditorMessage(tab, `Non si apre ${rel}: ${readReason(r)}`);
    return false;
  }
  let host;
  try {
    host = await ensureEditorHost(tab);
  } catch (e) {
    console.error('Monaco non si carica', e);
    showEditorMessage(tab, `L'editor non si carica: ${errorText(e)}`);
    return false;
  }
  if (!host || !tabs.has(tab.id)) return false;
  if (ed.files.files[rel]) { activateEditorFile(tab, rel, { save: !quiet }); return true; } // aperto nel frattempo
  host.open(rel, r.text);
  updateEditorConflicts(tab, rel);
  ed.files = EditorFiles.open(ed.files, rel, { path: r.path, mtime: r.mtime, bom: r.bom });
  hideEditorMessage(tab);
  renderEditorSubtabs(tab);
  loadEditorGutterBase(tab, rel); // senza aspettare: le barrette arrivano dopo il testo
  await watchEditorFile(tab, rel);
  if (!quiet) saveEditorSessions();
  return true;
}

function activateEditorFile(tab, rel, { save = true } = {}) {
  const ed = tab.editor;
  if (!ed.files.files[rel]) return;
  ed.files = EditorFiles.activate(ed.files, rel);
  if (ed.host) ed.host.activate(rel);
  hideEditorMessage(tab);
  renderEditorSubtabs(tab);
  if (save) saveEditorSessions();
}

/* Toglie la sotto-scheda senza chiedere niente (chi chiama ha già chiesto) */
function dropEditorFile(tab, rel) {
  const ed = tab.editor;
  if (!ed.files.files[rel]) return;
  ed.files = EditorFiles.close(ed.files, rel);
  if (ed.gutterTimer && ed.gutterTimer.rel === rel) { clearTimeout(ed.gutterTimer.id); ed.gutterTimer = null; }
  ed.gutterSeq.delete(rel); // una lettura di HEAD ancora in volo trova il file chiuso e si scarta
  if (ed.conflictTimers && Object.prototype.hasOwnProperty.call(ed.conflictTimers, rel)) {
    clearTimeout(ed.conflictTimers[rel]);
    ed.conflictTimers = Object.fromEntries(Object.entries(ed.conflictTimers).filter(([r]) => r !== rel));
  }
  dropEditorNotes(tab, rel);
  if (ed.conflicts) ed.conflicts = Object.fromEntries(Object.entries(ed.conflicts).filter(([r]) => r !== rel));
  if (ed.host) {
    ed.host.close(rel);
    if (ed.files.active) ed.host.activate(ed.files.active);
  }
  unwatchEditorFile(tab, rel);
  renderEditorSubtabs(tab);
}

async function closeEditorFile(tab, rel, anchor) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f) return;
  const name = EditorFiles.baseName(rel);
  const loss = editorNotesLoss(EditorNotes.count(ed.notes, rel), 'il file'); // docs/plans/65
  if (f.dirty) {
    const choice = await editorConfirm.choose({
      anchor, title: `«${name}» ha modifiche non salvate`, text: loss,
      choices: [{ value: 'save', label: 'Salva' }, { value: 'discard', label: 'Scarta', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save' && !(await saveEditorFile(tab, rel))) return;
  } else if (loss && !(await editorConfirm.ask({ anchor, title: `Chiudere «${name}»?`, text: loss, confirmLabel: 'Chiudi' }))) {
    return;
  }
  dropEditorFile(tab, rel);
  saveEditorSessions();
}

/* ---------- salvataggio e cambi sul disco ---------- */

/** @returns {Promise<boolean>} true se il file è sul disco com'è nell'editor */
async function saveEditorFile(tab, rel) {
  const ed = tab.editor;
  const f = rel && ed.files.files[rel];
  if (!f || !ed.host || ed.saving.has(rel)) return false;
  if (f.conflict) { renderEditorBar(tab); return false; } // la barra chiede già che fare
  ed.saving.add(rel);
  let done = false;
  try {
    const text = ed.host.getText(rel);
    const r = await callEditor(() => window.aisess.editorWrite(tab.cwd, rel, text, f.mtime, f.bom));
    if (!ed.files.files[rel]) return false; // chiuso nel frattempo
    if (r.ok) {
      ed.files = EditorFiles.update(ed.files, rel, { mtime: r.mtime, deleted: false, conflict: null, diskMtime: null, error: null });
      // Se si è scritto ancora durante il salvataggio, resta sporco
      if (ed.host.getText(rel) === text) ed.host.markSaved(rel);
      if (f.deleted) { unwatchEditorFile(tab, rel); await watchEditorFile(tab, rel); } // ricreato: il watch si riarma
      loadEditorGutterBase(tab, rel); // un hook di git o un commit fatto altrove
      done = true;
    } else if (r.conflict) {
      ed.files = EditorFiles.update(ed.files, rel, { conflict: 'save', diskMtime: r.mtime });
    } else {
      ed.files = EditorFiles.update(ed.files, rel, { error: `Salvataggio non riuscito: ${r.error}` });
    }
    renderEditorSubtabs(tab);
    return done;
  } finally {
    ed.saving.delete(rel);
    // Un evento del watch arrivato durante il salvataggio si guarda adesso,
    // col mtime nuovo: se è il nostro, non dice niente
    const pending = ed.pendingChanges.get(rel);
    ed.pendingChanges.delete(rel);
    if (pending) handleEditorFileChange(tab, rel, pending);
  }
}

async function saveAllEditorFiles(tab) {
  let allSaved = true;
  let firstFailed = null;
  for (const rel of EditorFiles.dirtyFiles(tab.editor.files)) {
    const ok = await saveEditorFile(tab, rel);
    allSaved = ok && allSaved;
    if (!ok && !firstFailed) firstFailed = rel;
  }
  // Un fallimento su un file non attivo non si vedrebbe: la barra disegna
  // solo il file attivo (renderEditorBar). Si porta in primo piano quello.
  if (firstFailed) activateEditorFile(tab, firstFailed, { save: false });
  return allSaved;
}

/* Un file aperto è cambiato sul disco (watch o ricontrollo in primo piano):
   pulito → si ricarica; con modifiche → si chiede; sparito → «eliminato». */
function handleEditorFileChange(tab, rel, change) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f) return;
  if (ed.saving.has(rel)) { ed.pendingChanges.set(rel, change); return; }
  if (!change.exists) {
    if (f.deleted) return;
    ed.files = EditorFiles.markDeleted(ed.files, rel);
    renderEditorSubtabs(tab);
    return;
  }
  if (change.mtime === f.mtime) return; // il nostro salvataggio
  if (!(ed.host && ed.host.isDirty(rel))) { reloadEditorFile(tab, rel); return; }
  if (f.conflict === 'disk' && f.diskMtime === change.mtime) return;
  ed.files = EditorFiles.update(ed.files, rel, { conflict: 'disk', diskMtime: change.mtime });
  renderEditorSubtabs(tab);
}

async function reloadEditorFile(tab, rel) {
  const ed = tab.editor;
  const r = await callEditor(() => window.aisess.editorRead(tab.cwd, rel));
  const f = ed.files.files[rel];
  if (!f || !ed.host) return;
  if (!r.ok) {
    ed.files = r.reason === 'missing'
      ? EditorFiles.markDeleted(ed.files, rel)
      : EditorFiles.update(ed.files, rel, { error: `Non si ricarica: ${readReason(r)}` });
    renderEditorSubtabs(tab);
    return;
  }
  ed.host.replaceText(rel, r.text);
  ed.files = EditorFiles.update(ed.files, rel, {
    path: r.path, mtime: r.mtime, bom: r.bom, dirty: false, deleted: false, conflict: null, diskMtime: null, error: null,
  });
  flushEditorGutter(tab, rel); // replaceText ne ha messo uno in attesa: si fa adesso, una volta
  flushEditorConflicts(tab, rel);
  if (f.deleted) { unwatchEditorFile(tab, rel); await watchEditorFile(tab, rel); }
  renderEditorSubtabs(tab);
}

/* «Tieni il mio» / «Sovrascrivi»: l'mtime atteso diventa quello del disco,
   il prossimo salvataggio sovrascrive (null: il file non c'è più, si ricrea) */
function keepEditorVersion(tab, rel, { save = false } = {}) {
  const f = tab.editor.files.files[rel];
  if (!f) return;
  setEditorFile(tab, rel, { mtime: f.diskMtime, conflict: null, diskMtime: null });
  if (save) saveEditorFile(tab, rel);
}

/** Tornando in primo piano: albero riletto e mtime dei file aperti ricontrollati. */
async function refreshEditorTab(tab) {
  const ed = tab && tab.editor;
  if (!ed) return;
  for (const rel of [...ed.files.order]) {
    const f = ed.files.files[rel];
    if (!f) continue;
    const r = await callEditor(() => window.aisess.editorStat(tab.cwd, rel));
    if (r.ok) handleEditorFileChange(tab, rel, { path: f.path, exists: r.exists, mtime: r.mtime });
    else console.warn('editor-stat fallito:', r.error);
  }
  // Un commit fatto da un terminale cambia HEAD: le barrette si rifanno
  await Promise.all(ed.files.order.map((rel) => loadEditorGutterBase(tab, rel)));
  await reloadEditorTree(tab);
}

/* ---------- scheda ---------- */

/** Chiudendo la scheda: i file con modifiche si salvano o si scartano, i commenti si perdono (docs/plans/65). */
async function confirmEditorClose(tab, anchor) {
  const dirty = EditorFiles.dirtyFiles(tab.editor.files);
  const loss = editorNotesLoss(EditorNotes.count(tab.editor.notes), 'la scheda');
  if (!dirty.length && !loss) return true;
  const bubble = anchor ? closeConfirm : editorConfirm;
  const where = { anchor: anchor || tab.editor.ui.subtabs, key: anchor ? tab.id : null };
  if (!dirty.length) return bubble.ask({ ...where, title: `Chiudere «${tab.name}»?`, text: loss, confirmLabel: 'Chiudi' });
  const choice = await bubble.choose({
    ...where, text: loss,
    title: dirty.length === 1 ? `«${EditorFiles.baseName(dirty[0])}» ha modifiche non salvate` : `${dirty.length} file con modifiche non salvate`,
    choices: [{ value: 'save', label: 'Salva tutto' }, { value: 'discard', label: 'Scarta', danger: true }],
  });
  if (!choice) return false;
  return choice === 'save' ? saveAllEditorFiles(tab) : true;
}

function disposeEditorTab(tab) {
  const ed = tab.editor;
  if (!ed) return;
  for (const rel of ed.files.order) unwatchEditorFile(tab, rel);
  if (ed.gutterTimer) { clearTimeout(ed.gutterTimer.id); ed.gutterTimer = null; }
  try { if (ed.host) ed.host.dispose(); } catch (e) { console.warn('chiusura di Monaco fallita', e); }
}

async function createEditorTab({ name, cwd, startedAt = Date.now(), files = [], active = null, restoring = false, reveal = true } = {}) {
  const id = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wrap = document.createElement('div');
  wrap.className = 'term-wrap editor-wrap type-editor';
  wrap.id = 'wrap-' + id;
  $('#terminals').appendChild(wrap);
  const folder = String(cwd || '').split(/[\\/]/).filter(Boolean).pop();
  const tab = { id, type: 'editor', name: name || folder || `editor · ${counter++}`, cwd, projectRoot: cwd || null, startedAt, autoNamed: !name,
    session: null, reattached: false, alive: true, needsAttention: false, running: false, term: null, fit: null, ro: null, wrap, editor: null };
  tab.editor = {
    ui: buildEditorLayout(tab), files: EditorFiles.empty(), tree: EditorTree.emptyTree(),
    host: null, hostPending: null, saving: new Set(), pendingChanges: new Map(), copying: false, gutterTimer: null, gutterSeq: new Map(), gutterSeqLast: 0,
    gutterReads: new Map(),
    notes: EditorNotes.empty(), noteViews: new Map(), noteDraft: null,
  };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id, { reveal });
  // Durante il ripristino la lista su disco è già quella giusta: riscriverla
  // a ogni scheda la accorcerebbe, se l'app si chiudesse a metà
  if (!restoring) saveEditorSessions();
  resolveProjectRoot(cwd).then((root) => {
    if (!tabs.has(id) || root === tab.projectRoot) return;
    tab.projectRoot = root;
    renderSidebar();
  }).catch((e) => console.warn('radice del progetto non risolta', e));
  await loadEditorDir(tab, '');
  for (const rel of files) await openEditorFile(tab, rel, { quiet: true });
  if (active && tab.editor.files.files[active]) activateEditorFile(tab, active, { save: !restoring });
  return tab;
}

/* ---------- salvataggio delle schede e ripristino ---------- */

/* La lista si riscrive per intero a ogni apertura/chiusura di scheda o file
   e a ogni rinomina. Un nome preso dalla cartella non si salva (null). */
function saveEditorSessions() {
  const sessions = [...tabs.values()].filter((t) => t.type === 'editor')
    .map((t) => ({ cwd: t.cwd, name: t.autoNamed ? null : t.name, startedAt: t.startedAt, ...EditorFiles.toSaved(t.editor.files) }));
  return window.aisess.saveEditorSessions(sessions)
    .then((r) => { if (r && !r.ok) console.warn('editor-sessions-save fallito:', r.error); })
    .catch((e) => console.warn('editor-sessions-save non raggiungibile', e));
}

/** Perché una cartella non si può aprire nell'editor; null se si può. */
async function editorFolderProblem(cwd) {
  if (!cwd) return 'Scegli la cartella da aprire.';
  const r = await callEditor(() => window.aisess.editorList(cwd, ''));
  return r.ok ? null : `Impossibile aprire la cartella: ${r.error}`;
}

/* Una cartella sparita nel frattempo: la scheda non torna */
async function restoreEditorTab(s) {
  const problem = await editorFolderProblem(s.cwd);
  if (problem) { console.warn('scheda editor non ripristinata:', s.cwd, problem); return false; }
  await createEditorTab({ name: s.name, cwd: s.cwd, startedAt: s.startedAt || Date.now(), files: s.files, active: s.active, restoring: true, reveal: false });
  return true;
}

/* All'avvio, come restoreGitSessions: senza riavvio della macchina le schede
   tornano da sole; dopo (`ask`) si restituiscono a offerRestore. */
async function restoreEditorSessions() {
  const r = await callEditor(() => window.aisess.editorSessions());
  if (!r.ok) { console.warn('editor-sessions fallito:', r.error); return []; }
  if (r.ask) return r.sessions;
  for (const s of r.sessions) await restoreEditorTab(s);
  return [];
}

/* ---------- uscita con file non salvati ---------- */

const editorDirtyTabs = () => [...tabs.values()].filter((t) => t.editor && EditorFiles.dirtyFiles(t.editor.files).length);

/* Il beforeunload ha fermato l'uscita (o la chiusura, o una ricarica):
   si chiede, e alla conferma il main rifà quello che era stato fermato
   (app/editor-close.js). */
async function askEditorExit() {
  if (editorExitAsking) return;
  editorExitAsking = true;
  try {
    const dirty = editorDirtyTabs();
    if (!dirty.length) return;
    const first = dirty[0];
    setActive(first.id);
    const count = dirty.reduce((n, t) => n + EditorFiles.dirtyFiles(t.editor.files).length, 0);
    const choice = await editorConfirm.choose({
      anchor: first.editor.ui.subtabs,
      title: count === 1 ? 'Un file con modifiche non salvate' : `${count} file con modifiche non salvate`,
      text: 'Uscendo senza salvare le modifiche si perdono.',
      choices: [{ value: 'save', label: 'Salva tutto ed esci' }, { value: 'discard', label: 'Esci senza salvare', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save') {
      for (const t of dirty) {
        // Un salvataggio fallito: la barra del file dice perché, non si esce
        if (!(await saveAllEditorFiles(t))) { setActive(t.id); return; }
      }
    }
    editorExitConfirmed = true;
    const r = await callEditor(() => window.aisess.editorCloseConfirmed());
    if (!r.ok || !r.what) editorExitConfirmed = false; // niente da rifare: si resta
  } finally {
    editorExitAsking = false;
  }
}

/** Da init(): gli eventi del watch e la guardia sull'uscita. */
function initEditorTabs() {
  window.aisess.onEditorFileChanged((change) => {
    if (!change || typeof change.path !== 'string') return;
    for (const t of tabs.values()) {
      if (!t.editor) continue;
      const rel = EditorFiles.findByPath(t.editor.files, change.path);
      if (rel) handleEditorFileChange(t, rel, change);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (editorExitConfirmed || !editorDirtyTabs().length) return;
    // Annullare senza dialogo: Electron non ne mostra, la domanda è nostra
    e.preventDefault();
    e.returnValue = false;
    askEditorExit();
  });
  // Un file lasciato fuori dall'albero non deve aprirsi al posto della
  // pagina (Electron naviga verso i file trascinati): il drop si rifiuta.
  // L'albero li accetta da sé e non lascia salire l'evento fin qui.
  const isFileDrag = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  document.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none'; // il cursore dice «qui no»
  });
  document.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  // Ctrl+B apre e chiude l'albero solo con una scheda editor davanti: nei
  // terminali il tasto resta della shell. In cattura, così arriva prima di Monaco.
  document.addEventListener('keydown', (e) => {
    const t = activeId ? tabs.get(activeId) : null;
    if (!t || !t.editor || !EditorPanel.isToggleKey(e)) return;
    e.preventDefault();
    if (!e.repeat) editorPanel.toggle(); // tenuto premuto non fa lampeggiare l'albero
  }, true);
}

/* I file aperti della scheda editor (docs/plans/75): la sezione «Aperti» in
   cima al pannello, il titolo con il file attivo, e con l'albero nascosto il
   menu «N aperti». Sostituiscono le sotto-schede: stessi dati
   (files.order, active, dirty, deleted, conflict) e stessi gesti (click
   attiva, click centrale o × chiudono). Caricato dopo editor-tab.js, di cui
   usa le funzioni (activateEditorFile, closeEditorFile, dropEditorFile…). */

function editorText(tag, className, text) {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = text; // nomi e cartelle vengono dal disco
  return n;
}

/** L'icona del tipo di file (file-icons.js, piano 70): decorativa, il nome accanto dice già tutto. */
function editorFileIcon(name, className = 'editor-file-icon') {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  img.src = FileIcons.iconUrl({ name, kind: 'file' });
  return img;
}

function editorCodicon(name, extra = '') {
  const n = document.createElement('span');
  n.className = `codicon codicon-${name}${extra ? ` ${extra}` : ''}`;
  n.setAttribute('aria-hidden', 'true');
  return n;
}

/** Il file non si può salvare così com'è: conflitto col disco o errore. */
const editorFileTrouble = (f) => Boolean(f.conflict || f.error);

function editorOpenTitle(rel, f) {
  if (f.deleted) return `${rel} — eliminato dal disco`;
  if (f.conflict) return `${rel} — cambiato sul disco`;
  return rel;
}

function editorOpenRow(tab, rel, f, active) {
  const row = document.createElement('div');
  row.className = 'editor-open-row'
    + (active ? ' is-active' : '')
    + (f.dirty ? ' is-dirty' : '')
    + (f.deleted ? ' is-deleted' : '')
    + (editorFileTrouble(f) ? ' is-trouble' : '');
  row.title = editorOpenTitle(rel, f);
  row.setAttribute('role', 'tab');
  row.setAttribute('aria-selected', active ? 'true' : 'false');
  const state = document.createElement('span');
  state.className = 'editor-open-state';
  if (editorFileTrouble(f)) state.appendChild(editorCodicon('warning', 'editor-open-warn'));
  const x = document.createElement('button');
  x.className = 'editor-open-close';
  x.title = 'Chiudi';
  x.setAttribute('aria-label', `Chiudi ${rel}`);
  x.appendChild(editorCodicon('close'));
  // La × è visibile solo sotto il puntatore: la domanda si appende alla riga
  x.onclick = (e) => { e.stopPropagation(); closeEditorFile(tab, rel, row); };
  state.appendChild(x);
  row.append(
    editorFileIcon(EditorFiles.baseName(rel)),
    editorText('span', 'editor-open-name', EditorFiles.baseName(rel)),
    editorText('span', 'editor-open-dir', EditorFiles.parentRel(rel)),
    state,
  );
  row.onclick = () => activateEditorFile(tab, rel);
  row.onauxclick = (e) => { if (e.button === 1) closeEditorFile(tab, rel, row); };
  return row;
}

/** Titolo dell'area: il file attivo, con la cartella sotto. Vuoto senza file. */
function renderEditorTitle(tab) {
  const { files, ui } = tab.editor;
  const rel = files.active;
  const f = rel ? files.files[rel] : null;
  if (!f) { ui.title.replaceChildren(); return; }
  const name = EditorFiles.baseName(rel);
  const line = document.createElement('div');
  line.className = 'editor-title-row';
  const nameEl = editorText('span', 'editor-title-name', name);
  if (f.deleted) nameEl.classList.add('is-deleted');
  line.append(editorFileIcon(name, 'editor-title-icon'), nameEl);
  if (f.dirty) {
    const dot = editorText('span', 'editor-title-dot', '');
    dot.title = 'Non salvato';
    line.appendChild(dot);
  }
  const letter = (tab.editor.git || {})[rel];
  if (letter) line.appendChild(editorText('span', `editor-tree-git is-${letter}`, letter));
  // cartella › simbolo (docs/plans/75); senza simbolo solo la cartella
  const crumb = document.createElement('div');
  crumb.className = 'editor-crumb';
  const dir = EditorFiles.parentRel(rel);
  const sym = tab.editor.symbol && tab.editor.symbol.rel === rel ? tab.editor.symbol.name : null;
  if (dir) crumb.appendChild(editorText('span', 'editor-crumb-dir', dir));
  if (dir && sym) crumb.appendChild(editorCodicon('chevron-right', 'editor-crumb-sep'));
  if (sym) {
    const s = document.createElement('span');
    s.className = 'editor-crumb-sym';
    s.append(editorCodicon('symbol-method'), editorText('span', 'sym', sym));
    crumb.appendChild(s);
  }
  ui.title.title = rel;
  ui.title.replaceChildren(line, crumb);
}

/** Sezione «Aperti», titolo, «N aperti», e intorno al codice conflitto, barra di stato, stato vuoto. */
function renderEditorOpen(tab) {
  const { files, ui } = tab.editor;
  const n = files.order.length;
  ui.openList.replaceChildren(...files.order.map((rel) => editorOpenRow(tab, rel, files.files[rel], rel === files.active)));
  ui.openCount.textContent = String(n);
  ui.openCount.hidden = n === 0;
  ui.openMenu.replaceChildren(editorText('span', 'editor-open-menu-label', `${n} ${n === 1 ? 'aperto' : 'aperti'}`), editorCodicon('chevron-down'));
  ui.openMenu.hidden = n === 0;
  renderEditorTitle(tab);
  renderEditorBar(tab);
  renderEditorStatus(tab);
  renderEditorEmpty(tab);
  syncEditorNotebook(tab); // notebook o Monaco per il file attivo (docs/plans/77)
}

/** Con l'albero nascosto: il menu dei file aperti, appeso sotto il titolo. */
function showEditorOpenMenu(tab) {
  const { files, ui } = tab.editor;
  if (!files.order.length) return;
  const at = ui.title.getBoundingClientRect();
  const items = files.order.map((rel, i) => {
    const f = files.files[rel];
    const name = EditorFiles.baseName(rel);
    return {
      label: name, detail: EditorFiles.parentRel(rel), image: FileIcons.iconUrl({ name, kind: 'file' }),
      key: i < 9 ? EditorPanel.openKeyLabel(i + 1, EDITOR_IS_MAC) : undefined,
      className: 'editor-open-item' + (rel === files.active ? ' is-active' : '') + (f.dirty ? ' is-dirty' : ''),
      run: () => activateEditorFile(tab, rel),
    };
  });
  ui.openMenu.classList.add('is-open');
  ui.openMenu.setAttribute('aria-expanded', 'true');
  EditorTree.showMenu({
    document, x: at.left, y: at.bottom + 6,
    items: [
      ...items,
      { sep: true },
      { label: 'Salva tutto', icon: 'save-all', key: 'Ctrl Shift S', run: () => saveAllEditorFiles(tab) },
      { label: 'Chiudi tutti', icon: 'close-all', run: () => closeAllEditorFiles(tab, ui.title) },
    ],
    onClose: () => {
      ui.openMenu.classList.remove('is-open');
      ui.openMenu.setAttribute('aria-expanded', 'false');
    },
  });
}

/** «Chiudi tutti»: come chiudere ogni file, con una domanda sola. */
async function closeAllEditorFiles(tab, anchor) {
  const ed = tab.editor;
  if (!ed.files.order.length) return;
  const dirty = EditorFiles.dirtyFiles(ed.files);
  const loss = editorNotesLoss(EditorNotes.count(ed.notes), 'i file');
  if (dirty.length) {
    const choice = await editorConfirm.choose({
      anchor, text: loss,
      title: dirty.length === 1 ? `«${EditorFiles.baseName(dirty[0])}» ha modifiche non salvate` : `${dirty.length} file con modifiche non salvate`,
      choices: [{ value: 'save', label: 'Salva tutto' }, { value: 'discard', label: 'Scarta', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save' && !(await saveAllEditorFiles(tab))) return;
  } else if (loss && !(await editorConfirm.ask({ anchor, title: 'Chiudere tutti i file?', text: loss, confirmLabel: 'Chiudi tutti' }))) {
    return;
  }
  const closing = [...ed.files.order];
  rememberEditorClosed(tab, [...closing].reverse()); // il primo della lista resta il più recente
  for (const rel of closing) dropEditorFile(tab, rel);
  saveEditorSessions();
}

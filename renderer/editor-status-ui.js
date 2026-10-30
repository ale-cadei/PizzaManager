/* Intorno al codice della scheda editor (docs/plans/70): la scheda del
   conflitto col disco in alto a destra, la barra di stato in fondo e lo stato
   vuoto quando non c'è nessun file aperto. Caricato dopo editor-tab.js, di
   cui usa le funzioni; le chiama renderEditorOpen (editor-open-ui.js). */

const EDITOR_RECENT_UNITS = [
  [60 * 1000, 'adesso'],
  [60 * 60 * 1000, (ms) => `${Math.floor(ms / 60000)} min fa`],
  [24 * 60 * 60 * 1000, (ms) => `${Math.floor(ms / 3600000)} h fa`],
  [2 * 24 * 60 * 60 * 1000, 'ieri'],
];

/** «adesso», «5 min fa», «3 h fa», «ieri», «4 g fa». */
function editorTimeAgo(at, now = Date.now()) {
  const ms = Math.max(0, now - at);
  for (const [limit, label] of EDITOR_RECENT_UNITS) {
    if (ms < limit) return typeof label === 'function' ? label(ms) : label;
  }
  return `${Math.floor(ms / 86400000)} g fa`;
}

/* La scheda in alto a destra sul codice parla del file attivo: errore,
   conflitto col disco, file eliminato. Le azioni sono
   [etichetta, run, 'ghost'|'secondary']. */
function renderEditorBar(tab) {
  const { files, ui } = tab.editor;
  const f = files.active ? files.files[files.active] : null;
  const bar = ui.bar;
  bar.replaceChildren();
  bar.className = 'editor-bar';
  bar.hidden = true;
  const show = (cls, title, text, actions = []) => {
    bar.hidden = false;
    bar.classList.add(cls);
    bar.setAttribute('role', cls === 'is-error' ? 'alert' : 'status');
    editorEl('div', 'editor-bar-title', bar).textContent = title;
    editorEl('div', 'editor-bar-text', bar).textContent = text; // nomi di file ed errori del sistema
    if (!actions.length) return;
    const row = editorEl('div', 'editor-bar-actions', bar);
    for (const [label, run, kind] of actions) {
      const b = editorEl('button', kind === 'secondary' ? 'btn editor-bar-secondary' : 'btn btn--ghost', row);
      b.textContent = label;
      b.onclick = run;
    }
  };
  if (!f) return;
  const name = EditorFiles.baseName(f.rel);
  if (f.error) {
    // Gli errori nascono come «Cosa: perché» (saveEditorFile, reloadEditorFile)
    const at = f.error.indexOf(': ');
    show('is-error', at > 0 ? f.error.slice(0, at) : 'Errore', at > 0 ? f.error.slice(at + 2) : f.error,
      [['Chiudi', () => setEditorFile(tab, f.rel, { error: null }), 'ghost']]);
  } else if (f.conflict === 'disk') {
    show('is-warn', 'Cambiato sul disco', `${name} è cambiato sul disco mentre lo modificavi. Le tue modifiche non sono ancora salvate.`,
      [['Tieni il mio', () => keepEditorVersion(tab, f.rel), 'ghost'], ['Ricarica dal disco', () => reloadEditorFile(tab, f.rel), 'secondary']]);
  } else if (f.conflict === 'save') {
    show('is-warn', 'Cambiato sul disco', `${name} è cambiato sul disco da quando l'hai aperto: salvare lo sovrascrive.`,
      [['Ricarica', () => reloadEditorFile(tab, f.rel), 'ghost'], ['Sovrascrivi', () => keepEditorVersion(tab, f.rel, { save: true }), 'secondary']]);
  } else if (f.deleted) {
    show('is-warn', 'Eliminato dal disco', `${name} non c'è più. Salva (Ctrl+S) per ricrearlo.`);
  }
}

/* ---------- barra di stato ---------- */

function onEditorCursor(tab, rel, pos) {
  if (!tabs.has(tab.id) || rel !== tab.editor.files.active) return;
  tab.editor.cursor = pos;
  renderEditorStatus(tab);
}

/** Il branch della cartella, per la barra di stato: null fuori da git o con HEAD staccata. */
async function loadEditorBranch(tab) {
  const r = await callEditor(() => window.aisess.gitBranches(tab.cwd));
  if (!tabs.has(tab.id)) return;
  const current = r.ok && Array.isArray(r.local) ? r.local.find((b) => b.current) : null;
  const branch = current ? current.name : null;
  if (branch === tab.editor.branch) return;
  tab.editor.branch = branch;
  renderEditorStatus(tab);
}

/** Non salvato · branch … Ln, Col · Spazi · codifica e fine riga · linguaggio. Nascosta senza file. */
function renderEditorStatus(tab) {
  const { files, ui, host, cursor, branch } = tab.editor;
  const rel = files.active;
  const f = rel ? files.files[rel] : null;
  ui.status.hidden = !f;
  if (!f) { ui.status.replaceChildren(); return; }
  const info = host && typeof host.info === 'function' ? host.info(rel) : null;
  const item = (cls, text, icon) => {
    const n = document.createElement('span');
    n.className = cls;
    if (icon) n.appendChild(editorCodicon(icon));
    n.appendChild(editorText('span', 'editor-status-text', text)); // il branch arriva da git
    return n;
  };
  const left = [];
  if (f.dirty) left.push(item('editor-status-dirty', '● Non salvato'));
  if (branch) left.push(item('editor-status-branch', branch, 'git-branch'));
  const right = [];
  if (cursor) right.push(item('editor-status-pos', `Ln ${cursor.line}, Col ${cursor.col}`));
  if (info) {
    right.push(item('editor-status-indent', info.insertSpaces ? `Spazi: ${info.tabSize}` : `Tab: ${info.tabSize}`));
    right.push(item('editor-status-enc', `${f.bom ? 'UTF-8 con BOM' : 'UTF-8'} · ${info.eol}`));
    right.push(item('editor-status-lang', info.language));
  }
  const spacer = document.createElement('span');
  spacer.className = 'editor-status-spacer';
  ui.status.replaceChildren(...left, spacer, ...right);
}

/* ---------- stato vuoto ---------- */

function editorShortcut(label, keys) {
  const row = document.createElement('div');
  row.className = 'editor-empty-key';
  row.appendChild(editorText('span', '', label));
  const kbd = document.createElement('span');
  kbd.className = 'editor-kbd-group';
  for (const k of keys) kbd.appendChild(editorText('kbd', 'kbd', k));
  row.appendChild(kbd);
  return row;
}

function editorRecentRow(tab, r, now) {
  const name = EditorFiles.baseName(r.rel);
  const row = document.createElement('button');
  row.className = 'editor-recent-row';
  row.title = r.rel;
  row.append(
    EditorIcons.iconElement(document, name, 'file'),
    editorText('span', 'editor-recent-name', name),
    editorText('span', 'editor-recent-dir', EditorFiles.parentRel(r.rel)),
    editorText('span', 'editor-recent-when', editorTimeAgo(r.at, now)),
  );
  row.onclick = () => openEditorFile(tab, r.rel);
  return row;
}

/** Nessun file aperto: cosa fare adesso, i file chiusi di recente, le scorciatoie. */
function renderEditorEmpty(tab) {
  const { files, ui, recent } = tab.editor;
  ui.empty.hidden = files.order.length > 0;
  if (ui.empty.hidden) { ui.empty.replaceChildren(); return; }
  const col = document.createElement('div');
  col.className = 'editor-empty-col';
  col.append(
    editorText('h2', 'editor-empty-title', 'Apri un file'),
    editorText('p', 'editor-empty-sub', 'Scegli un file dall\'albero, oppure riprendi da dove avevi lasciato.'),
  );
  if (recent.length) {
    const card = document.createElement('div');
    card.className = 'editor-recent';
    card.appendChild(editorText('div', 'editor-recent-head', 'Aperti di recente'));
    const now = Date.now();
    for (const r of recent) card.appendChild(editorRecentRow(tab, r, now));
    col.appendChild(card);
  }
  const keys = document.createElement('div');
  keys.className = 'editor-empty-keys';
  keys.append(editorShortcut('Nuovo file', ['Ctrl', 'Alt', 'N']), editorShortcut('Mostra/nascondi file', ['Ctrl', 'B']));
  col.appendChild(keys);
  ui.empty.replaceChildren(col);
}

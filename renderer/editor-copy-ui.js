/* Copiare file da fuori nell'albero della scheda editor (docs/plans/61).
   Piano e copia li fa il main (lib/editor-copy.js); qui da dove vengono i
   percorsi (drop, finestra di scelta, appunti), le domande sui conflitti
   e l'esito nella barra dei messaggi. Ctrl+C / Ctrl+X e l'incolla di un
   taglia, che sposta, sono del piano 95. Script dell'app, caricato dopo
   editor-tab.js: ne usa le funzioni (callEditor, showEditorMessage,
   editorConfirm, loadEditorDir…) dallo scope globale. */

const COPY_CHOICES = [
  { value: 'replace', label: 'Sostituisci', danger: true, hint: 'Quello che c\'è già va nel cestino.' },
  { value: 'keep-both', label: 'Tieni entrambi', hint: 'La copia prende un nome libero, «nome (2)».' },
  { value: 'skip', label: 'Salta' },
];
const COPY_ALL_LABELS = { replace: 'Sostituisci tutti', 'keep-both': 'Tieni entrambi per tutti', skip: 'Salta tutti' };

const copyCount = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const copyEnding = (n) => (n === 1 ? 'o' : 'i');

/** Le scelte per un conflitto; con altri conflitti dopo, anche «per tutti». */
function copyConflictChoices(remaining) {
  if (remaining <= 1) return COPY_CHOICES;
  return [...COPY_CHOICES, ...COPY_CHOICES.map((c) => ({ ...c, value: `${c.value}-all`, label: COPY_ALL_LABELS[c.value] }))];
}

/** «Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).»; con `move` «Spostati». */
function copyOutcomeText({ copied = 0, skipped = 0, failed = [] }, move = false) {
  const verb = move ? 'spostat' : 'copiat';
  const parts = [`${verb[0].toUpperCase()}${verb.slice(1)}${copyEnding(copied)} ${copyCount(copied, 'elemento', 'elementi')}`];
  if (skipped) parts.push(`${skipped} saltat${copyEnding(skipped)}`);
  if (failed.length) {
    const names = failed.map((f) => `${f.name} (${String(f.error).replace(/\.$/, '')})`).join(', ');
    parts.push(`${failed.length} non ${verb}${copyEnding(failed.length)}: ${names}`);
  }
  return `${parts.join(', ')}.`;
}

/** Ctrl+C / Ctrl+X sulle righe scelte: negli appunti del sistema, li scrive il main. */
async function putEditorClipboard(tab, rows, mode) {
  if (isRemoteEditor(tab)) { showEditorNotice(tab, EDITOR_LOCAL_ONLY); return; }
  const cut = mode === 'cut';
  const r = await callEditor(() => window.aisess.editorClipboardPut(tab.cwd, rows.map((row) => row.rel), mode));
  if (!tabs.has(tab.id)) return;
  const what = rows.length === 1 ? rows[0].rel : copyCount(rows.length, 'elemento', 'elementi');
  if (!r.ok) { showEditorMessage(tab, `Non si ${cut ? 'taglia' : 'copia'} ${what}: ${r.error}`); return; }
  showEditorNotice(tab, editorClipboardNotice(rows, r.count, cut));
}

/** «Copiato «a.txt»: …» per uno, «Tagliati 3 elementi: …» per più (una cartella copre i suoi figli). */
function editorClipboardNotice(rows, count, cut) {
  const n = Number.isInteger(count) ? count : rows.length;
  const done = `${cut ? 'Tagliat' : 'Copiat'}${copyEnding(n)}`;
  const what = n === 1 && rows.length === 1 ? `«${rows[0].name}»` : copyCount(n, 'elemento', 'elementi');
  const then = cut ? `spostar${n === 1 ? 'lo' : 'li'}` : `incollar${n === 1 ? 'lo' : 'li'}`;
  return `${done} ${what}: Ctrl+V in un'altra cartella per ${then}.`;
}

/** Dopo uno spostamento: i file aperti seguono, le cartelle da cui sono usciti si rileggono. */
async function followEditorMoves(tab, moved) {
  const from = moved.filter((m) => m.fromRel && m.toRel);
  for (const m of from) await followEditorMove(tab, m.fromRel, m.toRel);
  for (const dir of new Set(from.map((m) => EditorFiles.parentRel(m.fromRel)))) await loadEditorDir(tab, dir);
  if (from.length) { renderEditorOpen(tab); saveEditorSessions(); }
}

/**
 * Le altre schede editor di questo computer non hanno un watch sulle
 * cartelle (docs/plans/98): rileggono quelle toccate che hanno già letto,
 * e un file aperto spostato dentro la loro stessa cartella lo seguono.
 */
async function refreshOtherEditors(tab, destAbs, moved) {
  const others = [...tabs.values()].filter((t) => t !== tab && t.editor && !isRemoteEditor(t));
  for (const other of others) {
    const dirs = new Set();
    const into = EditorTree.relIn(other.cwd, destAbs);
    if (into !== null) dirs.add(into);
    let followed = false;
    for (const m of moved) {
      const from = EditorTree.relIn(other.cwd, m.from);
      const to = EditorTree.relIn(other.cwd, m.to);
      if (from) dirs.add(EditorFiles.parentRel(from));
      if (from && to) { await followEditorMove(other, from, to); followed = true; }
    }
    if (!tabs.has(other.id)) continue;
    for (const dir of dirs) if (other.editor.tree.children[dir]) await loadEditorDir(other, dir);
    if (followed) renderEditorOpen(other);
  }
  if (moved.length) saveEditorSessions();
}

/** @returns {Promise<Object<string, string>|null>} nome → decisione; null se annullato */
async function askCopyConflicts(tab, conflicts) {
  let decisions = {};
  for (let i = 0; i < conflicts.length; i += 1) {
    const c = conflicts[i];
    const answer = await editorConfirm.choose({
      anchor: tab.editor.ui.treeHost,
      title: `«${c.name}» c'è già`,
      text: `Nella cartella c'è già ${c.existingKind === 'dir' ? 'una cartella' : 'un file'} con questo nome.`,
      key: `copy:${tab.id}`,
      choices: copyConflictChoices(conflicts.length - i),
    });
    if (!answer) return null;
    if (answer.endsWith('-all')) {
      const value = answer.slice(0, -'-all'.length);
      return conflicts.slice(i).reduce((acc, rest) => ({ ...acc, [rest.name]: value }), decisions);
    }
    decisions = { ...decisions, [c.name]: answer };
  }
  return decisions;
}

/** I percorsi assoluti da copiare: dal drop qui, dalla finestra e dagli appunti nel main. */
async function editorCopySources(source) {
  if (source.kind === 'drop') {
    const paths = source.files.map((f) => {
      try {
        return window.aisess.editorPathForFile(f);
      } catch (e) {
        console.warn('percorso del file trascinato non leggibile', e);
        return '';
      }
    }).filter(Boolean);
    return { ok: true, paths };
  }
  if (source.kind === 'pick') return callEditor(() => window.aisess.editorPickFiles());
  if (source.kind === 'paste') return callEditor(() => window.aisess.editorClipboardFiles());
  return { ok: false, error: 'sorgente sconosciuta' };
}

const COPY_EMPTY = {
  drop: 'I file trascinati non hanno un percorso sul disco.',
  paste: 'Negli appunti non ci sono file da incollare.',
};

/** Fatta la copia, la cartella si mostra aperta e riletta. */
async function revealEditorDir(tab, dir) {
  if (dir && !EditorTree.isExpanded(tab.editor.tree, dir)) await toggleEditorDir(tab, dir);
  else await loadEditorDir(tab, dir);
}

async function copyIntoEditor(tab, dir, source) {
  const ed = tab.editor;
  if (isRemoteEditor(tab)) { showEditorNotice(tab, EDITOR_LOCAL_ONLY); return; }
  if (ed.copying) {
    showEditorNotice(tab, 'Una copia è già in corso.');
    return;
  }
  ed.copying = true;
  try {
    const got = await editorCopySources(source);
    if (!tabs.has(tab.id)) return;
    if (!got.ok) { showEditorMessage(tab, `Non si copia: ${got.error}`); return; }
    if (!got.paths.length) {
      if (COPY_EMPTY[source.kind]) showEditorNotice(tab, COPY_EMPTY[source.kind]);
      return; // finestra di scelta annullata: niente da dire
    }
    // Un taglia (docs/plans/95) sposta; `move` va al main solo allora
    const move = source.kind === 'paste' && got.cut === true;
    const extra = move ? [true] : [];
    const fail = move ? 'Non si sposta' : 'Non si copia';
    const plan = await callEditor(() => window.aisess.editorCopyPlan(tab.cwd, dir, got.paths, ...extra));
    if (!tabs.has(tab.id)) return;
    if (!plan.ok) { showEditorMessage(tab, `${fail}: ${plan.error}`); return; }
    // Incollare dove già sta: la copia prende «nome (2)», lo spostamento non fa niente; non si chiede
    const decisions = await askCopyConflicts(tab, plan.conflicts.filter((c) => !c.same));
    if (!decisions || !tabs.has(tab.id)) return;
    // Come l'esito: gli elementi in cima che si copiano, non plan.count (ricorsivo, per i limiti)
    const toCopy = plan.items.filter((i) => decisions[i.name] !== 'skip').length;
    showEditorNotice(tab, `${move ? 'Sposto' : 'Copio'} ${copyCount(toCopy, 'elemento', 'elementi')}…`);
    const r = await callEditor(() => window.aisess.editorCopyRun(tab.cwd, dir, got.paths, decisions, ...extra));
    if (!tabs.has(tab.id)) return;
    if (!r.ok) showEditorMessage(tab, `${fail}: ${r.error}`);
    else if (r.failed.length) showEditorMessage(tab, copyOutcomeText(r, move));
    else showEditorNotice(tab, copyOutcomeText(r, move));
    if (r.ok && r.moved) await followEditorMoves(tab, r.moved);
    await revealEditorDir(tab, dir);
    if (r.ok) await refreshOtherEditors(tab, `${tab.cwd}/${dir}`, r.moved || []);
  } finally {
    ed.copying = false;
  }
}

/* Copiare file da fuori nell'albero della scheda editor (docs/plans/61).
   Piano e copia li fa il main (lib/editor-copy.js); qui da dove vengono i
   percorsi (drop, finestra di scelta, appunti), le domande sui conflitti
   e l'esito nella barra dei messaggi. Script dell'app, caricato dopo
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

/** «Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).» */
function copyOutcomeText({ copied = 0, skipped = 0, failed = [] }) {
  const parts = [`Copiat${copyEnding(copied)} ${copyCount(copied, 'elemento', 'elementi')}`];
  if (skipped) parts.push(`${skipped} saltat${copyEnding(skipped)}`);
  if (failed.length) {
    const names = failed.map((f) => `${f.name} (${String(f.error).replace(/\.$/, '')})`).join(', ');
    parts.push(`${failed.length} non copiat${copyEnding(failed.length)}: ${names}`);
  }
  return `${parts.join(', ')}.`;
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
    const plan = await callEditor(() => window.aisess.editorCopyPlan(tab.cwd, dir, got.paths));
    if (!tabs.has(tab.id)) return;
    if (!plan.ok) { showEditorMessage(tab, `Non si copia: ${plan.error}`); return; }
    const decisions = await askCopyConflicts(tab, plan.conflicts);
    if (!decisions || !tabs.has(tab.id)) return;
    // Come l'esito: gli elementi in cima che si copiano, non plan.count (ricorsivo, per i limiti)
    const toCopy = plan.items.filter((i) => decisions[i.name] !== 'skip').length;
    showEditorNotice(tab, `Copio ${copyCount(toCopy, 'elemento', 'elementi')}…`);
    const r = await callEditor(() => window.aisess.editorCopyRun(tab.cwd, dir, got.paths, decisions));
    if (!tabs.has(tab.id)) return;
    if (!r.ok) showEditorMessage(tab, `Non si copia: ${r.error}`);
    else if (r.failed.length) showEditorMessage(tab, copyOutcomeText(r));
    else showEditorNotice(tab, copyOutcomeText(r));
    await revealEditorDir(tab, dir);
  } finally {
    ed.copying = false;
  }
}

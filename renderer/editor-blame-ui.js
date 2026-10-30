/* Chi ha toccato la riga del cursore nella scheda editor (docs/plans/73).
   Quando il cursore si ferma si chiede al main (lib/editor-git.js, git
   blame sul testo dell'editor) e l'etichetta (editor-blame.js) va all'host
   Monaco. Script dell'app, caricato dopo editor-tab.js: ne usa callEditor e
   tabs dallo scope globale, solo dentro le funzioni. */

const EditorBlame = window.AisessEditorBlame;
// Il testo compare quando il cursore resta fermo su una riga
const EDITOR_BLAME_DELAY = 400;
// Motivi per cui una riga non ha autore e non c'è niente da dire
const EDITOR_BLAME_QUIET = new Set(['not-repo', 'ignored', 'no-git', 'no-line', 'outside', 'too-large']);

/* Un errore vero si scrive in console una volta per cartella: a ogni
   spostamento del cursore si ripeterebbe */
const editorBlameWarned = new Set();
function warnEditorBlame(root, r) {
  if (editorBlameWarned.has(root)) return;
  editorBlameWarned.add(root);
  console.warn('editor-blame-line fallito:', r.reason || '', r.error || '');
}

/* Chiede la riga e, se intanto il cursore, il file o il testo non sono
   cambiati, la mostra. `blameSeq` scarta le risposte superate. */
async function showEditorBlame(tab, rel, line) {
  const ed = tab.editor;
  const { host } = ed;
  if (!host || ed.files.active !== rel) return;
  const version = host.version(rel);
  const text = host.getText(rel);
  if (version === null || typeof text !== 'string') return;
  const seq = (ed.blameSeq || 0) + 1;
  ed.blameSeq = seq;
  const r = await callEditor(() => window.aisess.editorBlameLine(tab.cwd, rel, line, text));
  if (!tabs.has(tab.id) || ed.blameSeq !== seq || ed.host !== host) return;
  if (ed.files.active !== rel || host.version(rel) !== version) return;
  if (!r.ok) {
    if (!EDITOR_BLAME_QUIET.has(r.reason)) warnEditorBlame(tab.cwd, r);
    return;
  }
  host.setLineInfo(rel, line, EditorBlame.blameInfo(r.blame));
}

/** Il cursore è su `line` (o il testo è cambiato): si chiede dopo EDITOR_BLAME_DELAY ms di quiete. */
function scheduleEditorBlame(tab, rel, line) {
  const ed = tab.editor;
  stopEditorBlame(tab);
  // Una risposta in volo per la riga di prima non vale più
  ed.blameSeq = (ed.blameSeq || 0) + 1;
  ed.blameTimer = setTimeout(() => {
    ed.blameTimer = null;
    showEditorBlame(tab, rel, line);
  }, EDITOR_BLAME_DELAY);
}

function stopEditorBlame(tab) {
  const ed = tab.editor;
  if (ed && ed.blameTimer) { clearTimeout(ed.blameTimer); ed.blameTimer = null; }
}

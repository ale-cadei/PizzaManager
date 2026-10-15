/* Barrette delle righe cambiate nella scheda editor (docs/plans/63): il
   cablaggio fra lo stato dei file (editor-files.js), il confronto con HEAD
   (editor-gutter.js) e l'host Monaco. Separato da editor-tab.js per tenerlo
   sotto le 800 righe (docs/plans/64).
   Script classico nello scope globale, caricato prima di editor-tab.js:
   EditorFiles, callEditor e tabs li definiscono altri script, e qui si usano
   solo dentro le funzioni, mai al caricamento. */

const EditorGutter = window.AisessEditorGutter;
// Le barrette si ricalcolano quando si smette di scrivere (docs/plans/63)
const EDITOR_GUTTER_DELAY = 300;

/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */

/* Confronta il testo nell'editor con quello di HEAD e ridisegna le barrette.
   Senza base (fuori da git, errore, file troppo grande) niente barrette.
   Il numero di righe si chiede prima: un file oltre il tetto non si copia
   né si spezza a ogni pausa nella scrittura. */
function updateEditorGutter(tab, rel) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f || !ed.host) return;
  const comparable = f.gutterBase && ed.host.lineCount(rel) <= EditorGutter.MAX_GUTTER_LINES;
  const changes = comparable ? EditorGutter.changeRanges(f.gutterBase.text, ed.host.getText(rel)) : null;
  ed.files = EditorFiles.update(ed.files, rel, { changes });
  ed.host.setGutter(rel, changes);
}

/* Ricalcolo subito, e quello in attesa per lo stesso file non serve più */
function flushEditorGutter(tab, rel) {
  const ed = tab.editor;
  if (ed.gutterTimer && ed.gutterTimer.rel === rel) { clearTimeout(ed.gutterTimer.id); ed.gutterTimer = null; }
  updateEditorGutter(tab, rel);
}

/* Si ricalcola EDITOR_GUTTER_DELAY ms dopo l'ultima modifica. Un timer per
   scheda: se ne aspetta uno di un altro file, quello si fa subito. */
function scheduleEditorGutter(tab, rel) {
  const ed = tab.editor;
  const pending = ed.gutterTimer;
  if (pending) {
    clearTimeout(pending.id);
    if (pending.rel !== rel) updateEditorGutter(tab, pending.rel);
  }
  const id = setTimeout(() => {
    ed.gutterTimer = null;
    updateEditorGutter(tab, rel);
  }, EDITOR_GUTTER_DELAY);
  ed.gutterTimer = { rel, id };
}

const sameGutterBase = (a, b) => Boolean(a && b && a.text === b.text);

/* Una lettura di HEAD fallita si scrive in console una volta per cartella e
   motivo: un repository «dubious ownership» la farebbe ripetere per ogni
   file aperto a ogni ritorno sulla scheda. */
const editorHeadWarned = new Set();
function warnEditorHead(root, r) {
  const key = `${root}\0${r.reason || 'ipc'}`;
  if (editorHeadWarned.has(key)) return;
  editorHeadWarned.add(key);
  console.warn('editor-head-text fallito:', r.error);
}

/* Rilegge il testo di HEAD (all'apertura, al salvataggio, tornando in primo
   piano) e, se è cambiato, ricalcola subito. text null = file non in HEAD.
   Due letture per lo stesso file possono risolvere in ordine invertito
   (refreshEditorTab e saveEditorFile possono rileggerlo insieme): ogni
   lettura prende un numero dal contatore della scheda e `gutterSeq` tiene
   l'ultimo per file; risponde in ritardo una superata → si scarta. Il
   contatore è della scheda, non del file: chiudendo un file la sua voce si
   toglie, e riaprendolo non si riparte da 1 (una lettura di prima della
   chiusura non può passare per quella nuova). */
async function loadEditorGutterBase(tab, rel) {
  const ed = tab.editor;
  const seq = ++ed.gutterSeqLast;
  ed.gutterSeq.set(rel, seq);
  const r = await callEditor(() => window.aisess.editorHeadText(tab.cwd, rel));
  const f = ed.files.files[rel];
  if (!f || !tabs.has(tab.id) || ed.gutterSeq.get(rel) !== seq) return;
  if (!r.ok && r.error) warnEditorHead(tab.cwd, r);
  const base = r.ok && (typeof r.text === 'string' || r.text === null) ? { text: r.text } : null;
  if (sameGutterBase(f.gutterBase, base)) return;
  ed.files = EditorFiles.update(ed.files, rel, { gutterBase: base });
  updateEditorGutter(tab, rel);
}

/** Le righe cambiate di un file aperto rispetto a HEAD; null se non si sa (piano 64). */
function editorFileChanges(tab, rel) {
  const f = tab && tab.editor && tab.editor.files.files[rel];
  return f ? f.changes : null;
}

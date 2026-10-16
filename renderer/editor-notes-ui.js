/* Commenti sul codice nella scheda editor (docs/plans/65): la casella
   sotto le righe, i commenti salvati, la riga «N commenti · Copia prompt ·
   Svuota» in testa. Il modello è editor-notes.js; dove stanno le righe e le
   zone sotto di loro lo sa l'host di Monaco (trackLines, addZone). Script
   dell'app, caricato dopo editor-tab.js: ne usa le funzioni
   (showEditorMessage, editorConfirm, errorText) dallo scope globale.
   I commenti vivono in memoria, nella scheda: non si salvano. Testo del
   commento e righe del file passano solo da textContent. */

const EditorNotes = window.AisessEditorNotes;
const NOTE_ZONE_PX = { saved: 44, draft: 132 }; // finché il riquadro non si misura

function noteEl(tag, className, text) {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function noteButton(className, label, title, run) {
  const b = noteEl('button', className, label);
  b.type = 'button';
  b.title = title;
  b.onclick = run;
  return b;
}

/* La zona di Monaco è alta quanto le si dice: si misura il riquadro e la si aggiusta */
function editorNoteZone(tab, rel, afterLine, box, kind) {
  const ed = tab.editor;
  const node = noteEl('div', 'editor-note-zone');
  node.appendChild(box);
  // I tasti scritti nel commento non arrivano alle scorciatoie di Monaco né della pagina
  node.addEventListener('keydown', (e) => e.stopPropagation());
  const zone = ed.host.addZone(rel, afterLine, node, NOTE_ZONE_PX[kind]);
  let ro = null;
  if (zone && typeof ResizeObserver === 'function') {
    // Fuori dal layout (file dietro, scheda nascosta) il riquadro misura 0: la zona tiene l'altezza di prima
    ro = new ResizeObserver(() => {
      const h = box.offsetHeight;
      if (ed.host && h > 0) ed.host.resizeZone(zone, Math.ceil(h) + 6);
    });
    ro.observe(box);
  }
  return { zone, node, ro };
}

function dropEditorNoteZone(tab, view) {
  if (view.ro) view.ro.disconnect();
  if (tab.editor.host && view.zone) tab.editor.host.removeZone(view.zone);
}

function editorNoteBox(tab, n) {
  const box = noteEl('div', 'changes-comment');
  const label = noteEl('span', 'changes-comment-range', EditorNotes.labelOf(n));
  box.append(
    label,
    noteEl('span', 'changes-comment-body', n.body),
    noteButton('changes-comment-edit', '✎', 'Modifica il commento', () => editEditorNote(tab, n.id)),
    noteButton('changes-comment-remove', '✕', 'Elimina il commento', () => removeEditorNote(tab, n.id)),
  );
  return { box, label };
}

function editorNoteDraftBox(tab, label, body) {
  const box = noteEl('div', 'changes-comment-editor');
  const lines = noteEl('div', 'changes-comment-lines');
  const range = noteEl('span', 'changes-comment-lines-label', label); // a parte: le righe si spostano, l'avviso resta
  const warn = noteEl('span', 'changes-comment-warn');
  warn.hidden = true;
  lines.append(range, warn);
  const input = noteEl('textarea', 'changes-comment-input');
  input.value = body;
  input.setAttribute('aria-label', 'Commento per l\'agente');
  input.placeholder = 'Cosa deve correggere l\'agente qui?';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditorNoteDraft(tab, input.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditorNoteDraft(tab); if (tab.editor.host) tab.editor.host.focus(); }
  });
  const actions = noteEl('div', 'changes-comment-actions');
  actions.append(
    noteEl('span', 'changes-comment-hint', 'Ctrl+Invio salva · Esc annulla'),
    noteButton('btn btn--ghost changes-comment-cancel', 'Annulla', 'Annulla', () => closeEditorNoteDraft(tab)),
    noteButton('btn btn--primary changes-comment-save', 'Salva', 'Salva il commento', () => saveEditorNoteDraft(tab, input.value)),
  );
  box.append(lines, input, actions);
  return { box, input, warn, range };
}

/** «N commenti · Copia prompt · Svuota», nascosta senza commenti */
function renderEditorNotesBar(tab) {
  const ed = tab.editor;
  const bar = ed.ui.notesBar;
  const n = EditorNotes.count(ed.notes);
  bar.hidden = n === 0;
  if (!n) { bar.replaceChildren(); return; }
  const copy = noteButton('btn btn--ghost editor-notes-copy', 'Copia prompt',
    'Copia negli appunti un prompt con tutti i commenti', () => copyEditorNotes(tab, copy));
  bar.replaceChildren(
    noteEl('span', 'editor-notes-count', EditorNotes.countLabel(n)),
    copy,
    noteButton('btn btn--ghost editor-notes-clear', 'Svuota', 'Togli tutti i commenti', () => clearEditorNotes(tab)),
  );
}

/** Rifà le zone dei commenti salvati e la riga in testa. Quello che si sta riscrivendo ha la casella al suo posto */
function renderEditorNotes(tab) {
  const ed = tab.editor;
  renderEditorNotesBar(tab);
  for (const v of ed.noteViews.values()) dropEditorNoteZone(tab, v);
  if (!ed.host) { ed.noteViews = new Map(); return; }
  const editing = ed.noteDraft && ed.noteDraft.noteId;
  ed.noteViews = new Map(ed.notes.notes.filter((n) => n.id !== editing).map((n) => {
    const { box, label } = editorNoteBox(tab, n);
    return [n.id, { ...editorNoteZone(tab, n.rel, n.to, box, 'saved'), label }];
  }));
}

/* La casella sotto le righe: nuova (`noteId` null, con un segno suo) o per riscrivere un commento */
function openEditorNoteDraft(tab, rel, from, to, noteId = null) {
  const ed = tab.editor;
  if (!ed.host || !ed.files.files[rel]) return;
  closeEditorNoteDraft(tab);
  const old = noteId ? EditorNotes.find(ed.notes, noteId) : null;
  if (noteId && !old) return;
  const track = old ? null : ed.host.trackLines(rel, from, to);
  if (!old && !track) return;
  const parts = editorNoteDraftBox(tab, EditorNotes.labelOf({ from, to }), old ? old.body : '');
  ed.noteDraft = { rel, noteId, track, warn: parts.warn, label: parts.range, ...editorNoteZone(tab, rel, to, parts.box, 'draft') };
  if (old) renderEditorNotes(tab);
  parts.input.focus();
}

function closeEditorNoteDraft(tab) {
  const ed = tab.editor;
  const d = ed.noteDraft;
  if (!d) return;
  ed.noteDraft = null;
  dropEditorNoteZone(tab, d);
  if (d.track && ed.host) ed.host.untrack(d.track);
  if (d.noteId) renderEditorNotes(tab); // il commento torna al suo posto
}

function saveEditorNoteDraft(tab, body) {
  const ed = tab.editor;
  const d = ed.noteDraft;
  if (!d || !ed.host) return;
  const at = d.track ? ed.host.linesOf(d.track) : null;
  const r = d.noteId
    ? EditorNotes.update(ed.notes, d.noteId, body)
    : EditorNotes.add(ed.notes, { rel: d.rel, ...(at || {}), body, track: d.track });
  if (!r.ok) {
    d.warn.textContent = ` · ${r.error}`;
    d.warn.hidden = false;
    return;
  }
  ed.notes = r.state;
  ed.noteDraft = { ...d, track: null, noteId: null }; // il segno ora è del commento
  closeEditorNoteDraft(tab);
  renderEditorNotes(tab);
  ed.host.focus();
}

function editEditorNote(tab, id) {
  const n = EditorNotes.find(tab.editor.notes, id);
  if (n) openEditorNoteDraft(tab, n.rel, n.from, n.to, id);
}

function removeEditorNote(tab, id) {
  const ed = tab.editor;
  const n = EditorNotes.find(ed.notes, id);
  if (!n) return;
  if (ed.host && n.track) ed.host.untrack(n.track);
  ed.notes = EditorNotes.remove(ed.notes, id);
  renderEditorNotes(tab);
}

/* «Svuota» toglie anche la casella aperta; `keepDraft` (dopo la copia) la lascia:
   il suo testo non era nel prompt. Se riscriveva un commento, ne prende il segno
   e diventa una casella nuova */
function clearEditorNotes(tab, { keepDraft = false } = {}) {
  const ed = tab.editor;
  if (!keepDraft) closeEditorNoteDraft(tab);
  const d = ed.noteDraft;
  const kept = d && d.noteId ? EditorNotes.find(ed.notes, d.noteId) : null;
  if (kept) ed.noteDraft = { ...d, noteId: null, track: kept.track };
  if (ed.host) ed.notes.notes.forEach((n) => { if (n.track && n !== kept) ed.host.untrack(n.track); });
  ed.notes = EditorNotes.clear(ed.notes);
  renderEditorNotes(tab);
}

const editorNoteText = (tab) => (rel, line) => (tab.editor.host && tab.editor.host.lineText(rel, line)) || '';

async function copyEditorNotes(tab, anchor) {
  const text = EditorNotes.promptFor(tab.editor.notes, editorNoteText(tab));
  if (!text) return;
  let r;
  try { r = await window.aisess.clipboardWrite(text); } catch (e) { r = { ok: false, error: errorText(e) }; }
  if (!r || !r.ok) { showEditorMessage(tab, `Prompt non copiato: ${(r && r.error) || 'errore sconosciuto.'}`); return; }
  let yes;
  try {
    yes = await editorConfirm.ask({
      anchor, title: 'Copiato. Svuoto i commenti?',
      text: 'Il prompt è negli appunti: incollalo nella sessione dell\'agente.', confirmLabel: 'Svuota',
    });
  } catch (e) {
    if (tabs.has(tab.id)) showEditorMessage(tab, `Commenti non svuotati: ${errorText(e)}`);
    return;
  }
  if (yes && tabs.has(tab.id)) clearEditorNotes(tab, { keepDraft: true });
}

/** Il testo è cambiato: le righe dei commenti del file dai segni dell'host */
function syncEditorNotes(tab, rel) {
  const ed = tab.editor;
  if (!ed.host) return;
  let notes = ed.notes;
  for (const n of EditorNotes.forFile(notes, rel)) {
    const at = n.track ? ed.host.linesOf(n.track) : null;
    if (at) notes = EditorNotes.move(notes, n.id, at);
  }
  if (notes !== ed.notes) {
    ed.notes = notes;
    for (const n of EditorNotes.forFile(notes, rel)) {
      const v = ed.noteViews.get(n.id);
      if (v) v.label.textContent = EditorNotes.labelOf(n);
    }
  }
  syncEditorNoteDraftLabel(tab, rel);
}

/* «Righe X–Y» della casella aperta: dal suo segno, o dal commento che riscrive */
function syncEditorNoteDraftLabel(tab, rel) {
  const ed = tab.editor;
  const d = ed.noteDraft;
  if (!d || d.rel !== rel) return;
  const at = d.noteId ? EditorNotes.find(ed.notes, d.noteId) : (d.track && ed.host.linesOf(d.track));
  if (at) d.label.textContent = EditorNotes.labelOf(at);
}

/* Il file si chiude: i suoi commenti vanno via (chi chiama ha già chiesto) */
function dropEditorNotes(tab, rel) {
  const ed = tab.editor;
  if (ed.noteDraft && ed.noteDraft.rel === rel) closeEditorNoteDraft(tab);
  const gone = EditorNotes.forFile(ed.notes, rel);
  if (!gone.length) return;
  if (ed.host) gone.forEach((n) => { if (n.track) ed.host.untrack(n.track); });
  ed.notes = EditorNotes.dropFile(ed.notes, rel);
  renderEditorNotes(tab);
}

/* Il file ha cambiato nome: l'host ha già spostato segni e zone (rename) */
function renameEditorNotes(tab, from, to) {
  const ed = tab.editor;
  ed.notes = EditorNotes.renameFile(ed.notes, from, to);
  if (ed.noteDraft && ed.noteDraft.rel === from) ed.noteDraft = { ...ed.noteDraft, rel: to };
}

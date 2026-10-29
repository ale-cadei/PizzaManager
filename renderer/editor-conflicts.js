/* Conflitti nella scheda editor (docs/plans/69): le righe di nostro e di
 * loro colorate e, sotto ogni `<<<<<<<`, una zona con «Tieni nostro · Tieni
 * loro · Tieni entrambi». La scelta è una modifica del testo (editText):
 * Ctrl+Z la annulla, salvare resta quello di sempre, «Segna risolto» sta
 * nel pannello. I blocchi si rileggono a ogni modifica, a riposo come le
 * barrette (editor-tab-gutter.js). */
const ConflictMarkers = window.AisessConflictMarkers;
const CONFLICT_ZONE_PX = 26;
const EDITOR_CONFLICTS_DELAY = 300;
const CONFLICT_CHOICES = [
  { choice: 'ours', label: 'Tieni nostro', side: 'oursLabel' },
  { choice: 'theirs', label: 'Tieni loro', side: 'theirsLabel' },
  { choice: 'both', label: 'Tieni entrambi', side: null },
];

function conflictBar(tab, rel, index, block) {
  const bar = document.createElement('div');
  bar.className = 'editor-conflict-bar';
  for (const c of CONFLICT_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `editor-conflict-choice is-${c.choice}`;
    b.textContent = c.label;
    b.title = c.side && block[c.side] ? `${c.label} (${block[c.side]})` : c.label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // il fuoco resta nel testo
    b.addEventListener('click', () => chooseEditorConflict(tab, rel, index, c.choice));
    bar.appendChild(b);
  }
  return bar;
}

/* Colori e zone del file: si rifanno solo se i blocchi sono cambiati */
function updateEditorConflicts(tab, rel) {
  const ed = tab.editor;
  if (!ed || !ed.host) return;
  const text = ed.host.getText(rel);
  const blocks = typeof text === 'string' && text.includes('<<<<<<<') ? ConflictMarkers.parseBlocks(text) : [];
  const seen = ed.conflicts || {};
  const key = JSON.stringify(blocks);
  const prev = Object.prototype.hasOwnProperty.call(seen, rel) ? seen[rel] : null;
  if (prev && prev.key === key) return;
  if (!prev && !blocks.length) return;
  if (prev) prev.zones.forEach((id) => ed.host.removeZone(id));
  ed.host.setConflicts(rel, blocks);
  const zones = blocks.map((b, i) => ed.host.addZone(rel, b.start, conflictBar(tab, rel, i, b), CONFLICT_ZONE_PX)).filter(Boolean);
  const rest = Object.fromEntries(Object.entries(seen).filter(([r]) => r !== rel));
  ed.conflicts = blocks.length ? { ...rest, [rel]: { key, zones } } : rest;
}

function scheduleEditorConflicts(tab, rel) {
  const ed = tab.editor;
  if (!ed) return;
  const timers = ed.conflictTimers || {};
  clearTimeout(timers[rel]);
  ed.conflictTimers = { ...timers, [rel]: setTimeout(() => { if (tabs.has(tab.id)) updateEditorConflicts(tab, rel); }, EDITOR_CONFLICTS_DELAY) };
}

/* Ricalcolo subito, come flushEditorGutter: una ricarica dal disco (replaceText)
   ne mette uno in attesa, che qui non serve più aspettare */
function flushEditorConflicts(tab, rel) {
  const ed = tab.editor;
  if (!ed) return;
  const timers = ed.conflictTimers;
  if (timers && Object.prototype.hasOwnProperty.call(timers, rel)) {
    clearTimeout(timers[rel]);
    ed.conflictTimers = Object.fromEntries(Object.entries(timers).filter(([r]) => r !== rel));
  }
  updateEditorConflicts(tab, rel);
}

/* Il blocco si rilegge adesso dal testo, per posizione: quello della zona
   può essere di prima dell'ultima battuta */
function chooseEditorConflict(tab, rel, index, choice) {
  const host = tab.editor && tab.editor.host;
  const text = host ? host.getText(rel) : null;
  if (typeof text !== 'string') return;
  const block = ConflictMarkers.parseBlocks(text)[index];
  const next = block ? ConflictMarkers.applyChoice(text, block, choice) : null;
  if (next === null) { updateEditorConflicts(tab, rel); return; }
  host.editText(rel, next);
}

/** Apre il file e porta il cursore al primo blocco (dal pannello dei conflitti) */
async function openEditorConflict(tab, rel) {
  if (!(await openEditorFile(tab, rel))) return false;
  const host = tab.editor && tab.editor.host;
  if (!tabs.has(tab.id) || !host) return true;
  updateEditorConflicts(tab, rel);
  const [first] = ConflictMarkers.parseBlocks(host.getText(rel) || '');
  if (first) host.reveal(rel, first.start);
  return true;
}

/* Ctrl+click (⌘ su Mac) su un nome nella scheda editor: va alla sua
   definizione (docs/plans/71). La cerca il main (lib/editor-definition.js);
   qui si apre il file e si porta il cursore sul nome. Script dell'app,
   caricato dopo editor-tab.js: ne usa le funzioni (callEditor,
   openEditorFile, showEditorMessage…) dallo scope globale. */

const DEFINITION_REASONS = {
  invalid: 'non è un nome da cercare.',
  'no-git': 'serve git, che non si trova nel PATH.',
};

/* Il fumetto di Monaco sul cursore; senza, la barra dei messaggi */
function editorDefinitionHint(tab, text) {
  const { host } = tab.editor;
  if (!host || !host.hint(text)) showEditorNotice(tab, text);
}

/**
 * @param {object} tab la scheda editor
 * @param {string} rel il file del click
 * @param {string} word il nome cliccato
 * @param {{lineNumber: number}} at dove
 */
async function goToEditorDefinition(tab, rel, word, at) {
  const ed = tab.editor;
  // Un click più recente vince: la risposta di uno vecchio si scarta
  const seq = (ed.definitionSeq || 0) + 1;
  ed.definitionSeq = seq;
  const r = await callEditor(() => window.aisess.editorDefinition(tab.cwd, word, rel, at.lineNumber));
  if (!tabs.has(tab.id) || ed.definitionSeq !== seq) return;
  if (!r.ok) {
    if (r.reason !== 'invalid') console.warn('editor-definition fallito:', r.reason, r.error);
    editorDefinitionHint(tab, `Definizione di «${word}» non cercata: ${DEFINITION_REASONS[r.reason] || r.error || 'errore sconosciuto.'}`);
    return;
  }
  const [best] = r.results;
  if (!best) { editorDefinitionHint(tab, `Nessuna definizione per «${word}».`); return; }
  if (!(await openEditorFile(tab, best.rel))) return;
  if (!tabs.has(tab.id) || ed.definitionSeq !== seq || !ed.host || ed.files.active !== best.rel) return;
  ed.host.reveal(best.rel, best.line, best.column);
}

/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): la
 * linguetta in alto a destra del terminale e il pannello che le si apre
 * sopra.
 *
 *   ┌──────── terminale ────────┬─ Modifiche · feat/x da main ─┐
 *   │                           │ 5 file · +120 −30        [×] │
 *   │                           │ ▾ M renderer/app.js  +12 −3  │
 *   │                           │   @@ -10,4 +10,6 @@          │
 *   │                           │ ▸ A lib/x.js         +40     │
 *
 * Sta SOPRA il terminale, non accanto: il contenitore del terminale non
 * cambia misura, il pty non si ridimensiona e l'agente non ridisegna la sua
 * interfaccia a ogni apertura. I file sono a fisarmonica: a metà schermo
 * lista e diff affiancati sarebbero troppo stretti.
 *
 * Qui solo il disegno: cosa mostrare lo decide changes-model.js, quando
 * leggere changes-panel.js. Tutto con textContent: il testo di un diff è
 * quello dei file dell'utente, e può contenere qualsiasi cosa.
 *
 * Wrapper UMD come worktree-section.js: globale nella pagina e module.exports
 * sotto Node. */
(function (root, factory) {
  const api = factory(root && root.AisessChangesModel);
  if (root) root.AisessChangesView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Model) {
  const M = Model || require('./changes-model');
  const SIGN = { add: '+', del: '-', ctx: ' ', note: '\\' };
  const DIFF_NOTES = {
    loading: 'Carico…',
    binary: 'File binario: niente righe da mostrare.',
    truncated: 'Diff troppo lungo: mostrate le prime righe.',
    empty: 'Nessuna riga cambiata (solo nome o permessi).',
  };

  function el(doc, tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function button(doc, cls, text, title, onClick) {
    const b = el(doc, 'button', cls, text);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = () => onClick();
    return b;
  }

  function diffLine(doc, line) {
    const row = el(doc, 'div', `changes-line ${line.kind}`);
    const no = line.kind === 'del' ? line.oldNo : line.newNo;
    row.appendChild(el(doc, 'span', 'changes-ln', no === null || no === undefined ? '' : String(no)));
    row.appendChild(el(doc, 'span', 'changes-sign', SIGN[line.kind] || ' '));
    row.appendChild(el(doc, 'span', 'changes-code', line.text));
    return row;
  }

  function diffBody(doc, diff) {
    const box = el(doc, 'div', 'changes-diff');
    const note = (text) => box.appendChild(el(doc, 'div', 'changes-diff-note', text));
    if (diff.loading) { note(DIFF_NOTES.loading); return box; }
    if (diff.ok === false) { note(diff.error || 'Diff non disponibile.'); return box; }
    if (diff.binary) { note(DIFF_NOTES.binary); return box; }
    if (!diff.hunks.length) { note(DIFF_NOTES.empty); return box; }
    for (const hunk of diff.hunks) {
      box.appendChild(el(doc, 'div', 'changes-hunk', hunk.header));
      for (const line of hunk.lines) box.appendChild(diffLine(doc, line));
    }
    if (diff.truncated) note(DIFF_NOTES.truncated);
    return box;
  }

  function fileRow(doc, f, diff, onFile) {
    const item = el(doc, 'div', 'changes-file');
    const row = el(doc, 'button', 'changes-file-row');
    row.type = 'button';
    row.title = M.displayPath(f);
    row.setAttribute('aria-expanded', diff ? 'true' : 'false');
    row.onclick = () => onFile(f.path);
    row.appendChild(el(doc, 'span', 'changes-chevron', diff ? '▾' : '▸'));
    row.appendChild(el(doc, 'span', `changes-status s-${f.status === '?' ? 'new' : f.status}`, f.status));
    row.appendChild(el(doc, 'span', 'changes-path', M.displayPath(f)));
    const counts = M.fileCounts(f);
    if (counts.added) row.appendChild(el(doc, 'span', 'changes-add', counts.added));
    if (counts.removed) row.appendChild(el(doc, 'span', 'changes-del', counts.removed));
    if (counts.note) row.appendChild(el(doc, 'span', 'changes-note', counts.note));
    item.appendChild(row);
    if (diff) item.appendChild(diffBody(doc, diff));
    return item;
  }

  /**
   * @param {{doc: Document, host: Element, shortcut: string,
   *   onToggle: () => void, onClose: () => void, onFile: (path: string) => void}} o
   */
  function createChangesView({ doc, host, shortcut, onToggle, onClose, onFile }) {
    const tab = button(doc, 'changes-tab', '', `Modifiche di questa sessione (${shortcut})`, () => onToggle());
    tab.hidden = true;

    const panel = el(doc, 'aside', 'changes-panel');
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Modifiche');
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (e.stopPropagation) e.stopPropagation();
      onClose();
    });
    const resizer = el(doc, 'div', 'changes-resizer');
    resizer.title = 'Trascina per allargare il pannello';
    const head = el(doc, 'header', 'changes-head');
    const heading = el(doc, 'div', 'changes-heading');
    heading.appendChild(el(doc, 'span', 'changes-label', 'Modifiche'));
    const title = el(doc, 'span', 'changes-title');
    heading.appendChild(title);
    const summary = el(doc, 'div', 'changes-summary');
    head.appendChild(heading);
    head.appendChild(summary);
    head.appendChild(button(doc, 'changes-close', '×', `Chiudi (${shortcut} o Esc)`, () => onClose()));
    const body = el(doc, 'div', 'changes-body');
    panel.appendChild(resizer);
    panel.appendChild(head);
    panel.appendChild(body);
    host.appendChild(tab);
    host.appendChild(panel);

    /**
     * @param {{label: {visible: boolean, clean: boolean, text: string}, open: boolean,
     *   title: string, summary: string, error: string|null, files: object[],
     *   expanded: Object<string, object>}} state
     */
    function render(state) {
      tab.hidden = state.open || !state.label.visible;
      tab.textContent = state.label.text;
      tab.classList.toggle('is-clean', state.label.clean);
      panel.hidden = !state.open;
      if (!state.open) return;
      title.textContent = state.title;
      summary.textContent = state.summary;
      const items = [];
      if (state.error) items.push(el(doc, 'div', 'changes-error', state.error));
      else if (!state.files.length) items.push(el(doc, 'div', 'changes-empty', 'Nessuna modifica: tutto come all\'ultimo commit.'));
      for (const f of state.files) items.push(fileRow(doc, f, state.expanded[f.path] || null, onFile));
      body.replaceChildren(...items);
    }

    function setWidth(px) {
      panel.style.width = `${Math.round(px)}px`;
    }

    return { render, setWidth, panel, resizer, tab };
  }

  return { createChangesView };
});

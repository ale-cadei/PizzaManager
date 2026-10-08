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
 * In modalità «Unisci» (piano 32, momento 3) lo stesso pannello mostra il
 * diff del branch contro la base e, in fondo, la conferma del merge.
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

  /** Pezzi di un contatore (changes-model.js, countParts), ognuno con la sua classe di colore */
  function fillParts(doc, box, parts) {
    box.replaceChildren(...parts.map((p) => el(doc, 'span', `changes-n-${p.kind}`, p.text)));
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

  /* `id` è il percorso, o «sezione:percorso» in «Da committare» (changes-model.js, itemId) */
  function fileRow(doc, f, diff, onFile) {
    const id = M.itemId(f);
    const item = el(doc, 'div', 'changes-file');
    const row = el(doc, 'button', 'changes-file-row');
    row.type = 'button';
    row.title = M.displayPath(f);
    row.dataset.item = id;
    row.setAttribute('aria-expanded', diff ? 'true' : 'false');
    row.onclick = () => onFile(id);
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

  /** L'intestazione di una sezione di «Da committare»: «STAGED · 2» */
  function sectionHead(doc, section) {
    const head = el(doc, 'div', `changes-section s-${section.side}`);
    head.title = section.hint;
    head.appendChild(el(doc, 'span', 'changes-section-title', section.title));
    head.appendChild(el(doc, 'span', 'changes-section-count', String(section.count)));
    return head;
  }

  /* Le righe, divise per sezione se ce ne sono; una sezione vuota lo dice */
  function fileItems(doc, state, diffOf, onFile) {
    const row = (f) => fileRow(doc, f, diffOf(M.itemId(f)), onFile);
    const heads = state.sections || [];
    if (!heads.length) return state.files.map(row);
    return heads.flatMap((section) => {
      const own = state.files.filter((f) => f.side === section.side);
      const rows = own.length ? own.map(row) : [el(doc, 'div', 'changes-section-empty', 'Nessun file')];
      return [sectionHead(doc, section), ...rows];
    });
  }

  /**
   * @param {{doc: Document, host: Element, shortcut: string,
   *   onToggle: () => void, onClose: () => void, onFile: (path: string) => void,
   *   onMerge?: (confirmed: boolean) => void, onMode?: (mode: 'commit'|'turn'|'staging') => void}} o
   */
  function createChangesView({ doc, host, shortcut, onToggle, onClose, onFile, onMerge = () => {}, onMode = () => {} }) {
    const tab = button(doc, 'changes-tab', '', `Modifiche di questa sessione (${shortcut})`, () => onToggle());
    tab.hidden = true;
    const tabTitle = (text) => `Modifiche di questa sessione: ${text} (${shortcut})`;

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
    const label = el(doc, 'span', 'changes-label', 'Modifiche');
    heading.appendChild(label);
    const title = el(doc, 'span', 'changes-title');
    heading.appendChild(title);
    const summary = el(doc, 'div', 'changes-summary');
    head.appendChild(heading);
    head.appendChild(summary);
    head.appendChild(button(doc, 'changes-close', '×', `Chiudi (${shortcut} o Esc)`, () => onClose()));
    // «Dall'ultimo commit | Ultimo giro | Da committare»: stesso selettore della sidebar
    const modes = el(doc, 'div', 'seg changes-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Rispetto a cosa');
    const commitBtn = button(doc, 'seg-btn changes-mode-commit', 'Dall\'ultimo commit',
      'Tutto quello che non è ancora in un commit', () => onMode('commit'));
    const turnBtn = button(doc, 'seg-btn changes-mode-turn', 'Ultimo giro', '', () => onMode('turn'));
    const stagingBtn = button(doc, 'seg-btn changes-mode-staging', 'Da committare',
      'Il non committato diviso fra staged (già con git add) e non staged', () => onMode('staging'));
    modes.appendChild(commitBtn);
    modes.appendChild(turnBtn);
    modes.appendChild(stagingBtn);
    head.appendChild(modes);
    const body = el(doc, 'div', 'changes-body');
    const foot = el(doc, 'footer', 'changes-foot');
    foot.hidden = true;
    const footText = el(doc, 'p', 'changes-foot-text');
    const warning = el(doc, 'p', 'changes-warning');
    warning.setAttribute('role', 'alert');
    const actions = el(doc, 'div', 'changes-foot-actions');
    const cancel = button(doc, 'btn btn--ghost changes-cancel', 'Annulla', 'Annulla: non unire', () => onMerge(false));
    const confirm = button(doc, 'btn btn--primary changes-confirm', '', 'Unisci', () => onMerge(true));
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    foot.appendChild(footText);
    foot.appendChild(warning);
    foot.appendChild(actions);
    panel.appendChild(resizer);
    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);
    host.appendChild(tab);
    host.appendChild(panel);

    /**
     * @param {{label: {visible: boolean, clean: boolean, text: string, parts: object[]}, open: boolean,
     *   title: string, summary: Array<{kind: string, text: string}>, error: string|null, files: object[],
     *   expanded: Object<string, object>, heading?: string, loading?: boolean, emptyText?: string, notice?: string|null,
     *   modes?: {current: 'commit'|'turn'|'staging', turnAvailable: boolean, turnHint: string}|null,
     *   sections?: Array<{side: string, title: string, hint: string, count: number}>,
     *   merge?: {text: string, confirmLabel: string, warning: string|null, canConfirm: boolean}|null}} state
     */
    function render(state) {
      tab.hidden = state.open || !state.label.visible;
      fillParts(doc, tab, state.label.parts);
      tab.title = tabTitle(state.label.text);
      tab.setAttribute('aria-label', tabTitle(state.label.text));
      tab.classList.toggle('is-clean', state.label.clean);
      // La linguetta sta sul fianco destro, dove c'è la barra di scorrimento
      // del terminale: con questa classe la barra comincia sotto (styles.css)
      host.classList.toggle('has-changes-tab', !tab.hidden);
      panel.hidden = !state.open;
      if (!state.open) return;
      label.textContent = state.heading || 'Modifiche';
      title.textContent = state.title;
      renderModes(state.modes || null);
      renderFoot(state.merge || null);
      fillParts(doc, summary, state.summary);
      const items = [];
      if (state.notice) items.push(el(doc, 'div', 'changes-notice', state.notice));
      if (state.loading) items.push(el(doc, 'div', 'changes-empty', 'Carico…'));
      else if (state.error) items.push(el(doc, 'div', 'changes-error', state.error));
      else if (!state.files.length) items.push(el(doc, 'div', 'changes-empty', state.emptyText || 'Nessuna modifica: tutto come all\'ultimo commit.'));
      // Proprietà proprie: un file che si chiama `constructor` o `__proto__`
      // non deve trovare quelle di Object.prototype
      const diffOf = (p) => (Object.prototype.hasOwnProperty.call(state.expanded, p) ? state.expanded[p] : null);
      const focused = focusedItem();
      if (state.files.length) items.push(...fileItems(doc, state, diffOf, onFile));
      body.replaceChildren(...items);
      // Il ridisegno sostituisce le righe: il fuoco torna su quella di prima,
      // o finirebbe sul body (e Esc non chiuderebbe più)
      if (focused !== null) {
        const row = [...body.querySelectorAll('.changes-file-row')].find((r) => r.dataset.item === focused);
        if (row && row.focus) row.focus();
      }
    }

    function renderModes(choice) {
      modes.hidden = !choice;
      if (!choice) return;
      commitBtn.setAttribute('aria-pressed', String(choice.current === 'commit'));
      turnBtn.setAttribute('aria-pressed', String(choice.current === 'turn'));
      stagingBtn.setAttribute('aria-pressed', String(choice.current === 'staging'));
      turnBtn.disabled = !choice.turnAvailable;
      turnBtn.title = choice.turnHint;
      turnBtn.setAttribute('aria-label', `Ultimo giro: ${choice.turnHint}`);
    }

    function renderFoot(merge) {
      foot.hidden = !merge;
      panel.classList.toggle('is-merge', Boolean(merge));
      if (!merge) return;
      footText.textContent = merge.text;
      warning.hidden = !merge.warning;
      warning.textContent = merge.warning || '';
      confirm.textContent = merge.confirmLabel;
      confirm.title = merge.confirmLabel;
      confirm.setAttribute('aria-label', merge.confirmLabel);
      confirm.disabled = !merge.canConfirm;
    }

    function focusedItem() {
      const active = doc.activeElement;
      if (!active || !active.dataset || typeof active.dataset.item !== 'string') return null;
      return active.classList && active.classList.contains('changes-file-row') ? active.dataset.item : null;
    }

    function setWidth(px) {
      panel.style.width = `${Math.round(px)}px`;
    }

    return { render, setWidth, panel, resizer, tab };
  }

  return { createChangesView };
});

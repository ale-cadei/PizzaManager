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
 * In «Da committare» (piano 53) ogni riga ha ＋ o −, le sezioni «tutti», e in
 * fondo la casella del messaggio col pulsante di commit.
 *
 * Qui solo il disegno: cosa mostrare lo decide changes-model.js, quando
 * leggere changes-panel.js. Tutto con textContent: il testo di un diff è
 * quello dei file dell'utente, e può contenere qualsiasi cosa.
 *
 * Wrapper UMD come worktree-section.js: globale nella pagina e module.exports
 * sotto Node. */
(function (root, factory) {
  const api = factory(root && root.AisessChangesModel, root && root.AisessReviewNotes);
  if (root) root.AisessChangesView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Model, Review) {
  const M = Model || require('./changes-model');
  const R = Review || require('./review-notes');
  const SIGN = { add: '+', del: '-', ctx: ' ', note: '\\' };
  /* Come lib/git-commit.js, MAX_MESSAGE: la casella non accetta di più */
  const MAX_COMMIT_MESSAGE = 10000;
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
    b.onclick = (e) => onClick(e);
    return b;
  }

  /** Pezzi di un contatore (changes-model.js, countParts), ognuno con la sua classe di colore */
  function fillParts(doc, box, parts) {
    box.replaceChildren(...parts.map((p) => el(doc, 'span', `changes-n-${p.kind}`, p.text)));
  }

  /* `rc` sono i commenti del file (docs/plans/44 e 57), null se non si commenta:
     { path, notes, editing, open(anchor, draft, replaces), extend(hunk, line), draft(text),
       save(), cancel(), remove(id) }. `place` dice dove stanno note e gruppo in modifica. */
  function diffLine(doc, line, rc, hunk, place) {
    const row = el(doc, 'div', `changes-line ${line.kind}`);
    if (rc) {
      const anchor = R.anchorOf(rc.path, line);
      row.appendChild(anchor ? noteAddButton(doc, rc, anchor, hunk, line) : el(doc, 'span', 'changes-note-gap'));
      if (place.covered.has(line)) row.classList.add('has-note');
      if (place.editing && place.editing.lines.has(line)) row.classList.add('is-selecting');
    }
    const no = line.kind === 'del' ? line.oldNo : line.newNo;
    row.appendChild(el(doc, 'span', 'changes-ln', no === null || no === undefined ? '' : String(no)));
    row.appendChild(el(doc, 'span', 'changes-sign', SIGN[line.kind] || ' '));
    row.appendChild(el(doc, 'span', 'changes-code', line.text));
    return row;
  }

  /* Clic: commenta la riga. Shift+clic con la textarea aperta: il commento
     copre le righe fino a questa (docs/plans/57) */
  function noteAddButton(doc, rc, anchor, hunk, line) {
    const b = button(doc, 'changes-note-add', '＋', 'Commenta questa riga (Shift+clic: fin qui)', (e) => {
      if (e && e.shiftKey && rc.editing) rc.extend(hunk, line);
      else rc.open(anchor, '');
    });
    // Shift+clic estenderebbe anche la selezione del testo della pagina
    b.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
    return b;
  }

  function commentBox(doc, n, rc) {
    const box = el(doc, 'div', 'changes-comment');
    if (n.lines.length > 1) box.appendChild(el(doc, 'span', 'changes-comment-range', R.linesLabel(n.lines)));
    box.appendChild(el(doc, 'span', 'changes-comment-body', n.body));
    box.appendChild(button(doc, 'changes-comment-edit', '✎', 'Modifica il commento',
      () => rc.open({ path: n.path, lines: n.lines }, n.body, n.id)));
    box.appendChild(button(doc, 'changes-comment-remove', '✕', 'Togli il commento', () => rc.remove(n.id)));
    return box;
  }

  /* Ctrl+Invio (⌘+Invio) salva, Esc annulla: Esc non arriva al pannello, che si chiuderebbe */
  function commentEditor(doc, rc) {
    const box = el(doc, 'div', 'changes-comment-editor');
    const range = el(doc, 'div', 'changes-comment-lines', R.linesLabel(rc.editing.anchor.lines));
    if (rc.editing.hint) range.appendChild(el(doc, 'span', 'changes-comment-warn', ` · ${rc.editing.hint}`));
    const input = el(doc, 'textarea', 'changes-comment-input');
    input.value = rc.editing.draft;
    input.setAttribute('aria-label', 'Commento per l\'agente');
    input.placeholder = 'Cosa deve correggere l\'agente qui?';
    input.addEventListener('input', () => rc.draft(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rc.save(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); rc.cancel(); }
    });
    const actions = el(doc, 'div', 'changes-comment-actions');
    actions.appendChild(el(doc, 'span', 'changes-comment-hint', 'Shift+clic su un ＋: più righe · Ctrl+Invio salva · Esc annulla'));
    actions.appendChild(button(doc, 'btn btn--ghost changes-comment-cancel', 'Annulla', 'Annulla', () => rc.cancel()));
    actions.appendChild(button(doc, 'btn btn--primary changes-comment-save', 'Salva', 'Salva il commento', () => rc.save()));
    box.appendChild(range);
    box.appendChild(input);
    box.appendChild(actions);
    return box;
  }

  /* La nota che si sta riscrivendo non si mostra due volte: c'è la textarea */
  const hiddenWhileEditing = (rc, n) => Boolean(rc.editing) && (n.id === rc.editing.id || n.id === rc.editing.replaces);

  /* Le note che finiscono su questa riga, e la textarea se il gruppo in modifica finisce qui */
  function lineComments(doc, line, rc, place) {
    if (!rc) return [];
    const notes = (place.endsAt.get(line) || []).filter((n) => !hiddenWhileEditing(rc, n));
    const editing = Boolean(place.editing) && place.editing.last === line;
    return [...notes.map((n) => commentBox(doc, n, rc)), ...(editing ? [commentEditor(doc, rc)] : [])];
  }

  /* Prima riga citata di una nota orfana, e quante altre ne aveva */
  function orphanQuote(n) {
    const first = n.lines[0];
    const others = n.lines.length - 1;
    const more = others === 0 ? '' : `  (${others === 1 ? 'e un\'altra riga' : `e altre ${others} righe`})`;
    return `${first.side === 'old' ? '−' : '+'}${first.no}  ${first.text}${more}`;
  }

  /* Note la cui riga non c'è più: l'agente ha cambiato il file sotto. Se
     si stava riscrivendo una di queste, la textarea resta al suo posto */
  function orphanBox(doc, orphans, rc, place) {
    const box = el(doc, 'div', 'changes-orphan');
    box.appendChild(el(doc, 'div', 'changes-orphan-title', 'Righe non più nel diff'));
    for (const n of orphans) {
      box.appendChild(el(doc, 'div', 'changes-comment-quote', orphanQuote(n)));
      const here = !place.editing && rc.editing && rc.editing.replaces === n.id;
      box.appendChild(here ? commentEditor(doc, rc) : commentBox(doc, n, rc));
    }
    return box;
  }

  /* Dove stanno le note del file e il gruppo in modifica, in un passaggio solo */
  function placeAll(diff, rc) {
    const empty = { endsAt: new Map(), covered: new Set(), orphans: [], editing: null };
    if (!rc) return empty;
    const editing = rc.editing && rc.editing.anchor.path === rc.path ? R.placeOf(rc.editing.anchor, diff) : null;
    return { ...R.placeNotes(rc.notes, rc.path, diff), editing };
  }

  function diffBody(doc, diff, rc) {
    const box = el(doc, 'div', 'changes-diff');
    const note = (text) => box.appendChild(el(doc, 'div', 'changes-diff-note', text));
    if (diff.loading) { note(DIFF_NOTES.loading); return box; }
    if (diff.ok === false) { note(diff.error || 'Diff non disponibile.'); return box; }
    const place = placeAll(diff, rc);
    if (place.orphans.length) box.appendChild(orphanBox(doc, place.orphans, rc, place));
    if (diff.binary) { note(DIFF_NOTES.binary); return box; }
    if (!diff.hunks.length) { note(DIFF_NOTES.empty); return box; }
    for (const hunk of diff.hunks) {
      box.appendChild(el(doc, 'div', 'changes-hunk', hunk.header));
      for (const line of hunk.lines) {
        box.appendChild(diffLine(doc, line, rc, hunk, place));
        for (const c of lineComments(doc, line, rc, place)) box.appendChild(c);
      }
    }
    if (diff.truncated) note(DIFF_NOTES.truncated);
    return box;
  }

  /* Un pulsante che scrive nell'indice: spento, col motivo, se ora non si può */
  function writeButton(doc, cls, text, title, commit, onClick) {
    const b = button(doc, cls, text, title, onClick);
    b.disabled = !commit.canWrite;
    if (commit.reason) b.title = commit.reason;
    return b;
  }

  /* ＋ su una riga non staged, − su una staged (docs/plans/53), e ↶ per
     scartare il non staged (docs/plans/56); `cc` è null fuori da «Da committare» */
  function rowActions(doc, f, cc) {
    if (!cc || !f.side) return [];
    if (f.side === 'staged') {
      return [writeButton(doc, 'changes-file-act changes-unstage', '−', `Togli ${f.path} dallo stage`, cc.commit,
        () => cc.act({ type: 'unstage', paths: [f.path] }))];
    }
    const untracked = f.status === '?';
    return [
      writeButton(doc, 'changes-file-act changes-discard', '↶',
        untracked ? `Cancella ${f.path} (non è in git)` : `Scarta le modifiche non staged a ${f.path}`, cc.commit,
        () => cc.act({ type: 'discard-ask', path: f.path, untracked })),
      writeButton(doc, 'changes-file-act changes-stage', '＋', `Aggiungi ${f.path} allo stage`, cc.commit,
        () => cc.act({ type: 'stage', paths: [f.path] })),
    ];
  }

  /* `id` è il percorso, o «sezione:percorso» in «Da committare» (changes-model.js, itemId) */
  function fileRow(doc, f, diff, onFile, rc, cc) {
    const id = M.itemId(f);
    const item = el(doc, 'div', 'changes-file');
    const head = el(doc, 'div', 'changes-file-head');
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
    const comments = rc ? R.countFor(rc.notes, f.path) : 0;
    if (comments) row.appendChild(el(doc, 'span', 'changes-comments', `💬${comments}`));
    // Il pulsante sta accanto alla riga, non dentro: un pulsante non ne contiene un altro
    head.appendChild(row);
    for (const act of rowActions(doc, f, cc)) head.appendChild(act);
    item.appendChild(head);
    if (diff) item.appendChild(diffBody(doc, diff, rc));
    return item;
  }

  /** L'intestazione di una sezione di «Da committare»: «STAGED · 2», e «tutti» se si scrive */
  function sectionHead(doc, section, cc) {
    const head = el(doc, 'div', `changes-section s-${section.side}`);
    head.title = section.hint;
    head.appendChild(el(doc, 'span', 'changes-section-title', section.title));
    head.appendChild(el(doc, 'span', 'changes-section-count', String(section.count)));
    if (cc && section.count) {
      head.appendChild(section.side === 'staged'
        ? writeButton(doc, 'changes-section-act changes-unstage-all', 'Togli tutti', 'Togli tutto dallo stage',
          cc.commit, () => cc.act({ type: 'unstage-all' }))
        : writeButton(doc, 'changes-section-act changes-stage-all', 'Aggiungi tutti',
          'Aggiungi tutto allo stage, file nuovi compresi', cc.commit, () => cc.act({ type: 'stage-all' })));
    }
    return head;
  }

  /* Le righe, divise per sezione se ce ne sono; una sezione vuota lo dice */
  function fileItems(doc, state, diffOf, onFile, reviewOf, cc) {
    const row = (f) => fileRow(doc, f, diffOf(M.itemId(f)), onFile, reviewOf(f.path), cc);
    const heads = state.sections || [];
    if (!heads.length) return state.files.map(row);
    return heads.flatMap((section) => {
      const own = state.files.filter((f) => f.side === section.side);
      const rows = own.length ? own.map(row) : [el(doc, 'div', 'changes-section-empty', 'Nessun file')];
      return [sectionHead(doc, section, cc), ...rows];
    });
  }

  /**
   * @param {{doc: Document, host: Element, shortcut: string,
   *   onToggle: () => void, onClose: () => void, onFile: (path: string) => void,
   *   onMerge?: (confirmed: boolean) => void, onMode?: (mode: 'commit'|'turn'|'staging') => void,
   *   onReview?: (action: {type: 'save', anchor: object, body: string, replaces: string|null}|{type: 'remove', id: string}
   *     |{type: 'clear'}|{type: 'send'}) => boolean|void,
   *   onCommit?: (action: {type: 'stage'|'unstage', paths: string[]}|{type: 'stage-all'|'unstage-all'|'commit'}
   *     |{type: 'message', text: string}|{type: 'discard-ask', path: string, untracked: boolean}
   *     |{type: 'discard'|'discard-cancel'|'discard-undo'}) => void}} o
   *   `onReview` dei commenti (docs/plans/44): per `save`, false se il commento
   *   è stato rifiutato (la textarea resta aperta). `onCommit` di stage e
   *   commit (docs/plans/53): `message` a ogni carattere, il pannello lo tiene
   */
  function createChangesView({
    doc, host, shortcut, onToggle, onClose, onFile, onMerge = () => {}, onMode = () => {}, onReview = () => {},
    onCommit = () => {},
  }) {
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
    // «3 commenti · Svuota · Invia all'agente» (docs/plans/44)
    const reviewFoot = el(doc, 'footer', 'changes-review-foot');
    reviewFoot.hidden = true;
    const reviewCount = el(doc, 'span', 'changes-review-count');
    const reviewError = el(doc, 'p', 'changes-review-error');
    reviewError.setAttribute('role', 'alert');
    const reviewActions = el(doc, 'div', 'changes-foot-actions');
    reviewActions.appendChild(reviewCount);
    const clearBtn = button(doc, 'btn btn--ghost changes-review-clear', 'Svuota', 'Togli tutti i commenti',
      () => onReview({ type: 'clear' }));
    const sendBtn = button(doc, 'btn btn--primary changes-review-send', 'Invia all\'agente',
      'Incolla i commenti nel prompt dell\'agente: rileggi e premi Invio', () => onReview({ type: 'send' }));
    reviewActions.appendChild(clearBtn);
    reviewActions.appendChild(sendBtn);
    reviewFoot.appendChild(reviewError);
    reviewFoot.appendChild(reviewActions);
    const commitBox = createCommitBox(doc, onCommit);
    const discardFoot = createDiscardFoot(doc, onCommit);
    panel.appendChild(resizer);
    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(discardFoot.foot);
    panel.appendChild(commitBox.foot);
    panel.appendChild(reviewFoot);
    panel.appendChild(foot);

    /* Il commento che si sta scrivendo è solo della vista: sopravvive ai
       ridisegni (il pannello si rilegge ogni pochi secondi) finché non si
       salva o si annulla. È della scheda in cui si è aperto (`key`): su
       un'altra si butta, o Ctrl+Invio lo salverebbe lì */
    let last = null;
    let editing = null;
    let focusEditor = false;
    const redraw = () => { if (last) render(last); };
    const notesNow = () => (last && last.review && last.review.notes) || [];
    const review = {
      /* `replaces`: la nota che si sta riscrivendo (✎), che al salvataggio
         sparisce anche se nel frattempo si è cambiato il gruppo (docs/plans/57) */
      open: (anchor, draft, replaces = null) => {
        const key = last && last.review ? last.review.key : null;
        const id = R.noteId(anchor);
        editing = { key, id, origin: id, anchor, start: anchor.lines[0], draft, replaces, hint: null };
        focusEditor = true;
        redraw();
      },
      /* Shift+clic su un ＋: il gruppo va dalla prima riga scelta a questa */
      extend: (path, hunk, line) => {
        if (!editing) return;
        const to = R.anchorOf(path, line);
        const range = to && path === editing.anchor.path
          ? R.rangeAnchor(path, hunk, editing.start, to.lines[0])
          : { ok: false, error: 'Solo righe dello stesso file.' };
        const id = range.ok ? R.noteId(range.anchor) : null;
        const taken = range.ok && id !== editing.origin && id !== editing.replaces && notesNow().some((n) => n.id === id);
        if (taken) editing = { ...editing, hint: R.TAKEN };
        else if (range.ok) editing = { ...editing, anchor: range.anchor, id, hint: null };
        else editing = { ...editing, hint: range.error };
        focusEditor = true;
        redraw();
      },
      draft: (text) => { editing = editing && { ...editing, draft: text }; },
      save: () => {
        if (!editing) return;
        const saved = onReview({ type: 'save', anchor: editing.anchor, body: editing.draft, replaces: editing.replaces });
        if (saved !== false) editing = null;
        redraw();
      },
      cancel: () => { editing = null; redraw(); },
      remove: (id) => onReview({ type: 'remove', id }),
    };
    const reviewOf = (state) => (path) => (state.review && state.review.enabled
      ? { ...review, extend: (hunk, line) => review.extend(path, hunk, line), path, notes: state.review.notes, editing }
      : null);
    host.appendChild(tab);
    host.appendChild(panel);

    /**
     * @param {{label: {visible: boolean, clean: boolean, text: string, parts: object[]}, open: boolean,
     *   title: string, summary: Array<{kind: string, text: string}>, error: string|null, files: object[],
     *   expanded: Object<string, object>, heading?: string, loading?: boolean, emptyText?: string, notice?: string|null,
     *   modes?: {current: 'commit'|'turn'|'staging', turnAvailable: boolean, turnHint: string}|null,
     *   sections?: Array<{side: string, title: string, hint: string, count: number}>,
     *   merge?: {text: string, confirmLabel: string, warning: string|null, canConfirm: boolean}|null,
     *   review?: {enabled: boolean, key: string, notes: object[], error: string|null}|null,
     *   commit?: {message: string, canWrite: boolean, reason: string|null, canCommit: boolean,
     *     commitReason: string|null, commitLabel: string, outcome: {ok: boolean, text: string}|null}|null,
     *   discard?: {text: string, confirmLabel: string|null, undoLabel: string|null, canAct: boolean}|null}} state
     */
    function render(state) {
      last = state;
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
      renderReviewFoot(state.review || null);
      commitBox.render(state.commit || null);
      discardFoot.render(state.discard || null);
      fillParts(doc, summary, state.summary);
      const items = [];
      if (state.notice) items.push(el(doc, 'div', 'changes-notice', state.notice));
      if (state.loading) items.push(el(doc, 'div', 'changes-empty', 'Carico…'));
      else if (state.error) items.push(el(doc, 'div', 'changes-error', state.error));
      else if (!state.files.length) items.push(el(doc, 'div', 'changes-empty', state.emptyText || 'Nessuna modifica: tutto come all\'ultimo commit.'));
      // Proprietà proprie: un file che si chiama `constructor` o `__proto__`
      // non deve trovare quelle di Object.prototype
      const diffOf = (p) => (Object.prototype.hasOwnProperty.call(state.expanded, p) ? state.expanded[p] : null);
      if (editing && state.review && state.review.key !== editing.key) editing = null;
      const focused = focusedItem();
      const typing = typingAt();
      const cc = state.commit ? { commit: state.commit, act: onCommit } : null;
      if (state.files.length) items.push(...fileItems(doc, state, diffOf, onFile, reviewOf(state), cc));
      body.replaceChildren(...items);
      // La textarea prende il fuoco appena aperta, o se l'aveva (si stava
      // scrivendo e l'agente ha cambiato un file); un ridisegno qualsiasi no,
      // o il giro periodico lo ruberebbe al terminale
      const input = editing && (focusEditor || typing) ? body.querySelectorAll('.changes-comment-input')[0] : null;
      if (input) {
        focusEditor = false;
        input.focus();
        if (typing) Object.assign(input, typing);
        return;
      }
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

    function renderReviewFoot(state) {
      const notes = state && state.enabled ? state.notes : [];
      const error = state && state.enabled ? state.error : null;
      reviewFoot.hidden = !notes.length && !error;
      reviewCount.textContent = notes.length === 1 ? '1 commento' : `${notes.length} commenti`;
      reviewError.hidden = !error;
      reviewError.textContent = error || '';
      clearBtn.disabled = !notes.length;
      sendBtn.disabled = !notes.length;
    }

    function focusedItem() {
      const active = doc.activeElement;
      if (!active || !active.dataset || typeof active.dataset.item !== 'string') return null;
      return active.classList && active.classList.contains('changes-file-row') ? active.dataset.item : null;
    }

    /** Dov'era il cursore, se il fuoco è sulla textarea del commento */
    function typingAt() {
      const active = doc.activeElement;
      if (!editing || !active || !active.classList || !active.classList.contains('changes-comment-input')) return null;
      return { selectionStart: active.selectionStart, selectionEnd: active.selectionEnd };
    }

    function setWidth(px) {
      panel.style.width = `${Math.round(px)}px`;
    }

    return { render, renderCommit: commitBox.render, setWidth, panel, resizer, tab };
  }

  /**
   * La casella del messaggio e «Committa N file» (docs/plans/53). Resta la
   * stessa fra un ridisegno e l'altro: fuoco e cursore non si perdono mentre
   * il pannello si rilegge. Il messaggio lo tiene il pannello (per scheda):
   * qui si riscrive solo se è diverso, cioè dopo un commit o cambiando scheda.
   */
  function createCommitBox(doc, onCommit) {
    const foot = el(doc, 'footer', 'changes-commit-foot');
    foot.hidden = true;
    const reason = el(doc, 'p', 'changes-commit-reason');
    reason.setAttribute('role', 'status');
    const input = el(doc, 'textarea', 'changes-commit-input');
    input.maxLength = MAX_COMMIT_MESSAGE;
    input.rows = 2;
    input.placeholder = 'Messaggio del commit';
    input.setAttribute('aria-label', 'Messaggio del commit');
    let current = null;
    const commit = () => { if (current && current.canCommit) onCommit({ type: 'commit' }); };
    input.addEventListener('input', () => onCommit({ type: 'message', text: input.value }));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      if (e.preventDefault) e.preventDefault();
      commit();
    });
    const actions = el(doc, 'div', 'changes-foot-actions');
    actions.appendChild(el(doc, 'span', 'changes-commit-hint', 'Ctrl+Invio committa'));
    const btn = button(doc, 'btn btn--primary changes-commit-btn', '', 'Committa', () => commit());
    actions.appendChild(btn);
    const outcome = el(doc, 'p', 'changes-commit-outcome');
    outcome.setAttribute('role', 'alert');
    foot.appendChild(reason);
    foot.appendChild(input);
    foot.appendChild(actions);
    foot.appendChild(outcome);

    function render(state) {
      current = state;
      foot.hidden = !state;
      if (!state) return;
      if (input.value !== state.message) input.value = state.message;
      reason.hidden = !state.reason;
      reason.textContent = state.reason || '';
      btn.textContent = state.commitLabel;
      btn.title = state.commitReason || state.commitLabel;
      btn.setAttribute('aria-label', btn.title);
      btn.disabled = !state.canCommit;
      outcome.hidden = !state.outcome;
      outcome.textContent = state.outcome ? state.outcome.text : '';
      outcome.classList.toggle('is-error', Boolean(state.outcome && !state.outcome.ok));
    }
    return { foot, render };
  }

  /**
   * Conferma dello scarto di un file e, dopo, «Annulla lo scarto»
   * (docs/plans/56). I testi li sceglie changes-model.js (discardFooter).
   */
  function createDiscardFoot(doc, onCommit) {
    const foot = el(doc, 'footer', 'changes-discard-foot');
    foot.hidden = true;
    const text = el(doc, 'p', 'changes-discard-text');
    text.setAttribute('role', 'status');
    const actions = el(doc, 'div', 'changes-foot-actions');
    const cancel = button(doc, 'btn btn--ghost changes-discard-cancel', '', '', () => onCommit({ type: 'discard-cancel' }));
    const undo = button(doc, 'btn btn--ghost changes-discard-undo', '', 'Rimette il file com\'era prima dello scarto',
      () => onCommit({ type: 'discard-undo' }));
    const confirm = button(doc, 'btn btn--danger changes-discard-confirm', '', '', () => onCommit({ type: 'discard' }));
    actions.appendChild(cancel);
    actions.appendChild(undo);
    actions.appendChild(confirm);
    foot.appendChild(text);
    foot.appendChild(actions);

    function render(state) {
      foot.hidden = !state;
      if (!state) return;
      text.textContent = state.text;
      const asking = Boolean(state.confirmLabel);
      cancel.textContent = asking ? 'Lascia stare' : 'Chiudi';
      cancel.title = asking ? 'Non scartare niente' : 'Chiudi questo avviso';
      confirm.hidden = !asking;
      confirm.textContent = state.confirmLabel || '';
      confirm.title = state.confirmLabel || '';
      confirm.disabled = !state.canAct;
      undo.hidden = !state.undoLabel;
      undo.textContent = state.undoLabel || '';
      undo.disabled = !state.canAct;
    }
    return { foot, render };
  }

  return { createChangesView };
});

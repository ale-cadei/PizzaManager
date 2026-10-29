/* Modalità «Conflitti» del pannello delle modifiche (docs/plans/69): le
 * righe dei file in conflitto, i risolti e il piè di pagina con Concludi /
 * Continua e Annulla. changes-view.js le mette al posto dell'elenco solito.
 * Tutto con textContent: percorsi, nomi di branch e messaggi vengono da git.
 *
 * Wrapper UMD come changes-view.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictsView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function el(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(doc, cls, text, title, onClick) {
    const b = el(doc, 'button', cls, text);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  /**
   * @param {{doc: Document, onAction: (a: {how: string, path?: string, anchor: Element}) => void}} o
   */
  function createConflictsPart({ doc, onAction }) {
    const foot = el(doc, 'div', 'conflicts-foot');
    foot.hidden = true;
    const outcome = el(doc, 'div', 'conflicts-outcome');
    const abort = button(doc, 'conflicts-abort', '', '', (b) => onAction({ how: 'abort', anchor: b }));
    const go = button(doc, 'conflicts-continue', '', '', (b) => onAction({ how: 'continue', anchor: b }));
    foot.appendChild(outcome);
    foot.appendChild(go);
    foot.appendChild(abort);

    function fileRow(f) {
      const row = el(doc, 'div', 'conflicts-file');
      row.appendChild(el(doc, 'span', 'conflicts-path', f.path));
      row.appendChild(el(doc, 'span', 'conflicts-kind', [f.kindLabel, f.blocksLabel].filter(Boolean).join(' · ')));
      for (const a of f.actions) {
        row.appendChild(button(doc, `conflicts-action is-${a.how}`, a.label, a.title, (b) => onAction({ how: a.how, path: f.path, anchor: b })));
      }
      return row;
    }

    function resolvedRow(p) {
      const row = el(doc, 'div', 'conflicts-file is-resolved');
      row.appendChild(el(doc, 'span', 'conflicts-path', p));
      row.appendChild(button(doc, 'conflicts-action is-open', '✎', 'Apri nell\'editor', (b) => onAction({ how: 'open', path: p, anchor: b })));
      return row;
    }

    function items(state) {
      const out = [el(doc, 'div', 'conflicts-heading', `In conflitto (${state.files.length})`)];
      out.push(...state.files.map(fileRow));
      if (!state.files.length) out.push(el(doc, 'div', 'changes-empty', 'Nessun file in conflitto.'));
      if (state.resolved.length) {
        out.push(el(doc, 'div', 'conflicts-heading', `Risolti (${state.resolved.length})`));
        out.push(...state.resolved.map(resolvedRow));
      }
      return out;
    }

    function render(state) {
      foot.hidden = !state;
      if (!state) return;
      const f = state.footer;
      go.textContent = f.continueLabel;
      go.title = f.continueReason || f.continueLabel;
      go.setAttribute('aria-label', go.title);
      go.disabled = !f.canContinue;
      abort.textContent = f.abortLabel;
      abort.title = f.abortReason || f.abortLabel;
      abort.setAttribute('aria-label', abort.title);
      abort.disabled = !f.canAbort;
      outcome.hidden = !state.outcome;
      outcome.textContent = state.outcome ? state.outcome.text : '';
      outcome.classList.toggle('is-error', Boolean(state.outcome && !state.outcome.ok));
    }

    return { foot, items, render };
  }

  return { createConflictsPart };
});

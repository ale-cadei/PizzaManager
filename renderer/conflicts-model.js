/* Modalità «Conflitti» del pannello delle modifiche (docs/plans/69): cosa
 * dice la testata, come si chiamano i due lati, quali pulsanti ha ogni file
 * e il piè di pagina. Niente DOM: lo disegna conflicts-view.js.
 *
 * «Nostro» e «loro» si dicono coi nomi: in un merge nostro è il branch
 * corrente e loro quello che entra; in un rebase git li inverte (nostro è
 * la base su cui si riapplica, loro il commit che si sta riapplicando).
 *
 * Wrapper UMD come changes-model.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictsModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const OP_NAMES = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' };
  const OP_TITLES = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };

  const commitText = (w) => [w.commit, w.subject].filter(Boolean).join(' ');

  function headline({ op, what: w }) {
    if (op === 'merge') return `Merge di ${w.incoming || w.commit || '?'} in ${w.into || 'HEAD'}, a metà`;
    if (op === 'rebase') {
      const step = w.step && w.total ? `, passo ${w.step} di ${w.total}` : '';
      const commit = commitText(w) ? ` (${commitText(w)})` : '';
      return `Rebase di ${w.incoming || 'HEAD'} su ${w.into || '?'}${step}${commit}`;
    }
    return `${OP_TITLES[op]} di ${commitText(w) || '?'} in ${w.into || 'HEAD'}`;
  }

  function sides({ op, what: w }) {
    if (op === 'rebase') return { ours: w.into || 'la base', theirs: w.incoming ? `${w.commit} di ${w.incoming}` : w.commit || 'il commit' };
    if (op === 'merge') return { ours: w.into || 'HEAD', theirs: w.incoming || w.commit || 'in arrivo' };
    return { ours: w.into || 'HEAD', theirs: w.commit || 'il commit' };
  }

  function kindLabel(f, s) {
    const labels = {
      'both-modified': 'modificato da entrambi', 'both-added': 'aggiunto da entrambi',
      'deleted-by-us': `cancellato in ${s.ours}`, 'deleted-by-them': `cancellato in ${s.theirs}`,
      'added-by-us': `aggiunto solo in ${s.ours}`, 'added-by-them': `aggiunto solo in ${s.theirs}`,
      'both-deleted': 'cancellato da entrambi',
    };
    const label = labels[f.kind] || 'in conflitto';
    return f.binary ? `binario, ${label}` : label;
  }

  const blocksLabel = (n) => (typeof n !== 'number' || n === 0 ? '' : n === 1 ? '1 blocco' : `${n} blocchi`);

  function rawActionsOf(f, s) {
    const both = f.kind === 'both-modified' || f.kind === 'both-added';
    if (both && f.binary) {
      return [
        { how: 'ours', label: `Tieni ${s.ours}`, title: `Tieni la versione di ${s.ours}` },
        { how: 'theirs', label: `Tieni ${s.theirs}`, title: `Tieni la versione di ${s.theirs}` },
      ];
    }
    if (both) {
      return [
        { how: 'open', label: '✎', title: 'Apri nell\'editor' },
        { how: 'mark', label: 'Segna risolto', title: 'Segna risolto (git add): il file non deve avere più marcatori' },
      ];
    }
    const keep = { how: 'keep', label: 'Tieni il file', title: 'Tieni il file com\'è nella cartella (git add)' };
    const drop = { how: 'delete', label: 'Eliminalo', title: 'Elimina il file (git rm)' };
    return f.kind === 'both-deleted' ? [drop] : [keep, drop];
  }

  /* Col blocco (scrittura in corso, sessione al lavoro…) le azioni che
     toccano l'indice si spengono; «Apri nell'editor» resta acceso perché
     non scrive niente. */
  function actionsOf(f, s, block) {
    return rawActionsOf(f, s).map((a) => (block && a.how !== 'open'
      ? { ...a, disabled: true, title: block }
      : { ...a, disabled: false }));
  }

  function footer(c, block) {
    const name = OP_NAMES[c.op];
    const left = c.files.length;
    const continueLabel = c.op === 'merge' ? 'Concludi merge' : `Continua ${name}`;
    const continueReason = block || (left ? `${left} file in conflitto: risolvili prima.` : null);
    return {
      continueLabel, canContinue: !continueReason, continueReason,
      abortLabel: `Annulla ${name}`, canAbort: !block, abortReason: block || null,
    };
  }

  /**
   * @param {{op: string, what: object, files: object[], resolved: string[]}} c da gitConflicts
   * @param {{block?: string|null, outcome?: object|null}} o `block`: perché adesso non si scrive
   */
  function viewState(c, { block = null, outcome = null } = {}) {
    const s = sides(c);
    return {
      headline: headline(c),
      sides: s,
      files: c.files.map((f) => ({ path: f.path, kindLabel: kindLabel(f, s), blocksLabel: blocksLabel(f.blocks), actions: actionsOf(f, s, block) })),
      resolved: c.resolved,
      footer: footer(c, block),
      outcome,
    };
  }

  function outcomeOf(action, res) {
    if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'git ha rifiutato l\'operazione.' };
    if (action.how !== 'continue') return null;
    return res.stopped
      ? { ok: true, text: 'Passo fatto: l\'operazione si è fermata di nuovo su altri conflitti.' }
      : { ok: true, text: 'Concluso.' };
  }

  return { viewState, outcomeOf, OP_NAMES };
});

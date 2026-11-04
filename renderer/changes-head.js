/* La barra in cima al pannello delle modifiche (docs/plans/89): su che
 * branch e in che worktree si trova la scheda, quanto è avanti l'upstream,
 * e il pulsante per pushare.
 *
 *   ⎇ feat/x · worktree feature-x     ⇡2 origin/feat/x   [Push ⇡2]
 *
 * `headBar` decide cosa mostrare (puro, testato), `createHeadBar` lo disegna.
 * I dati arrivano da lib/git-head.js (canale `git-head`); il push è quello
 * del selettore dei branch (lib/git-push.js, piano 55): upstream o `-u`,
 * mai forzato. Tutto con textContent: nomi di branch e messaggi vengono da git.
 *
 * Wrapper UMD come conflicts-view.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessChangesHead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /* Il pulsante: si può pushare adesso, e se no perché */
  function pushChoice(head, { pushing, writing }) {
    const name = head.branch;
    if (pushing) return { label: 'Push…', enabled: false, title: 'Push in corso…' };
    if (!name) return { label: 'Push', enabled: false, title: 'HEAD staccato: passa a un branch per pushare.' };
    if (head.unborn) return { label: 'Push', enabled: false, title: 'Ancora nessun commit da pushare.' };
    if (writing) return { label: 'Push', enabled: false, title: 'Operazione in corso…' };
    if (!head.upstream) {
      return { label: 'Pubblica', enabled: true, title: `Pubblica ${name} sul remoto e lo segue (git push -u)` };
    }
    if (head.gone) {
      return { label: 'Push', enabled: false, title: `${head.upstream} non c'è più sul remoto: se va ricreato, fai il push dal terminale.` };
    }
    if (!head.ahead) return { label: 'Push', enabled: false, title: `Niente da pushare: ${name} è allineato con ${head.upstream}.` };
    const commits = head.ahead === 1 ? '1 commit' : `${head.ahead} commit`;
    const behind = head.behind ? ` Il remoto ha ${head.behind} commit in più: git rifiuterà, fai pull o rebase dal terminale.` : '';
    return { label: `Push ⇡${head.ahead}`, enabled: true, title: `Push di ${commits} su ${head.upstream}.${behind}` };
  }

  /* Accanto al nome: «⇡2 ⇣1 origin/x», «nessun upstream», «origin/x sparito» */
  function syncText(head) {
    if (!head.branch || head.unborn) return '';
    if (!head.upstream) return 'nessun upstream';
    if (head.gone) return `${head.upstream} sparito`;
    const arrows = [head.ahead ? `⇡${head.ahead}` : '', head.behind ? `⇣${head.behind}` : ''].filter(Boolean).join(' ');
    return arrows ? `${arrows} ${head.upstream}` : `= ${head.upstream}`;
  }

  /**
   * Cosa dice la barra. Nessuna barra fuori da un repository.
   * @param {object|null} head la lettura di readHead
   * @param {{pushing?: boolean, writing?: boolean, outcome?: {ok: boolean, text: string}|null}} state
   * @returns {{branch: string, worktree: string|null, sync: string,
   *   push: {label: string, enabled: boolean, title: string}, outcome: {ok: boolean, text: string}|null}|null}
   */
  function headBar(head, { pushing = false, writing = false, outcome = null } = {}) {
    if (!head || !head.ok) return null;
    const branch = head.branch || (head.detached ? `HEAD staccato · ${head.detached}` : 'HEAD staccato');
    return {
      branch, worktree: head.worktree || null, sync: syncText(head),
      push: pushChoice(head, { pushing, writing }), outcome: outcome || null,
    };
  }

  /** L'esito di un push, per la riga sotto la barra */
  function pushOutcome(res) {
    if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'git ha rifiutato il push.' };
    return { ok: true, text: `${res.branch} pushato su ${res.upstream}${res.created ? ' (nuovo upstream)' : ''}` };
  }

  /** Uguale finché non cambia niente di visibile */
  function headSignature(head) {
    if (!head) return 'none';
    if (!head.ok) return `ko:${head.reason || head.error || ''}`;
    return [head.root, head.branch, head.detached, head.unborn ? 1 : 0, head.upstream, head.ahead, head.behind,
      head.gone ? 1 : 0, head.worktree].join('\x1f');
  }

  function el(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /**
   * La barra, da mettere nell'intestazione del pannello.
   * @param {Document} doc
   * @param {() => void} onPush
   */
  function createHeadBar(doc, onPush) {
    const bar = el(doc, 'div', 'changes-branchbar');
    bar.hidden = true;
    const where = el(doc, 'div', 'changes-where');
    const branch = el(doc, 'span', 'changes-branch');
    const worktree = el(doc, 'span', 'changes-worktree');
    const sync = el(doc, 'span', 'changes-sync');
    where.appendChild(branch);
    where.appendChild(worktree);
    where.appendChild(sync);
    const push = el(doc, 'button', 'btn btn--ghost changes-push', 'Push');
    push.type = 'button';
    let current = null;
    push.onclick = () => { if (current && current.push.enabled) onPush(); };
    const outcome = el(doc, 'p', 'changes-push-outcome');
    outcome.setAttribute('role', 'status');
    bar.appendChild(where);
    bar.appendChild(push);
    bar.appendChild(outcome);

    function render(state) {
      current = state;
      bar.hidden = !state;
      if (!state) return;
      branch.textContent = `⎇ ${state.branch}`;
      branch.title = state.branch;
      worktree.hidden = !state.worktree;
      worktree.textContent = state.worktree ? `worktree ${state.worktree}` : '';
      worktree.title = state.worktree ? `Worktree collegato: ${state.worktree}` : '';
      sync.hidden = !state.sync;
      sync.textContent = state.sync;
      push.textContent = state.push.label;
      push.title = state.push.title;
      push.setAttribute('aria-label', state.push.title);
      push.disabled = !state.push.enabled;
      outcome.hidden = !state.outcome;
      outcome.textContent = state.outcome ? state.outcome.text : '';
      outcome.classList.toggle('is-error', Boolean(state.outcome && !state.outcome.ok));
    }

    return { el: bar, render };
  }

  return { headBar, pushOutcome, headSignature, createHeadBar };
});

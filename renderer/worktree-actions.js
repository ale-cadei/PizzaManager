/* Il menu ⋯ di un worktree nella sidebar (docs/plans/36-sessione-worktree.md):
 * Unisci, Tieni il branch, Butta.
 *
 * L'ordine dei passi è la parte delicata, ed è per questo che sta qui e non
 * nel renderer: scelta → conferma → azione → (modifiche non committate?
 * seconda conferma → con force) → le sessioni del worktree si chiudono solo
 * quando la cartella se n'è andata. Così un Unisci rifiutato o un conflitto
 * non costano gli agenti che ci lavoravano. Su Windows un processo con la
 * cartella aperta ne blocca la rimozione: in quel caso, visto che chiuderle
 * era già stato detto, si chiudono e si riprova una volta.
 *
 * Il modulo non conosce le schede né il main: riceve tutto come dipendenze.
 * Wrapper UMD come session-groups.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessWorktreeActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const lastSegment = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || String(p || '');
  const nameOf = (w) => w.branch || lastSegment(w.path);
  const messageOf = (e) => String((e && e.message) || e);

  function sessionsNote(n) {
    if (!n) return '';
    return n === 1 ? ' La sessione aperta nel worktree verrà chiusa.' : ` Le ${n} sessioni aperte nel worktree verranno chiuse.`;
  }

  function menuChoices(w) {
    const mergeHint = !w.branch ? 'Il worktree non è su un branch: non c\'è niente da unire.'
      : !w.base ? 'Non so in quale branch unirlo: usa «Tieni il branch» e apri una PR.'
      : `Merge in ${w.base} dalla cartella principale, poi toglie cartella e branch.`;
    return [
      { value: 'merge', label: w.base ? `Unisci in ${w.base}` : 'Unisci', hint: mergeHint, disabled: !w.branch || !w.base },
      { value: 'keep', label: 'Tieni il branch', hint: 'Toglie la cartella; il branch resta, per la PR.', disabled: !w.branch },
      { value: 'delete', label: 'Butta', hint: 'Toglie cartella e branch, anche con commit non uniti.', danger: true },
    ];
  }

  function confirmation(choice, w, openCount) {
    const note = sessionsNote(openCount);
    if (choice === 'merge') {
      return {
        title: `Unire «${w.branch}» in ${w.base}?`,
        text: `Il merge si fa nella cartella principale, che deve essere su ${w.base} e senza modifiche; poi cartella e branch del worktree vengono tolti.${note}`,
        confirmLabel: 'Unisci',
      };
    }
    if (choice === 'keep') {
      return { title: `Togliere la cartella di «${w.branch}»?`, text: `Il branch resta, con i suoi commit, per la PR.${note}`, confirmLabel: 'Togli la cartella' };
    }
    return { title: `Buttare «${nameOf(w)}»?`, text: `Cartella e branch vengono tolti, anche i commit non uniti altrove.${note}`, confirmLabel: 'Butta' };
  }

  /**
   * @param {{api: {merge: (root: string, path: string) => Promise<object>,
   *     remove: (root: string, path: string, branch: 'keep'|'delete', force: boolean) => Promise<object>},
   *   bubble: {choose: Function, ask: Function, tell: Function},
   *   sessionsIn: (path: string) => Array<{id: string}>,
   *   closeSessions: (sessions: Array<{id: string}>) => Promise<void>,
   *   refresh: (root: string) => Promise<void>,
   *   review?: (w: object, conf: {title: string, text: string, confirmLabel: string}) => Promise<boolean>}} deps
   *   `review`: Unisci si conferma guardando il diff del branch nel pannello
   *   delle modifiche (docs/plans/32), invece che dal fumetto.
   */
  function createWorktreeActions({ api, bubble, sessionsIn, closeSessions, refresh, review = null }) {
    /* Chiamata al main che non lancia mai: un canale giù diventa un errore da dire */
    const call = (fn) => fn().catch((e) => ({ ok: false, error: messageOf(e) }));

    async function remove(w, root, branch, open, ctx) {
      let force = false;
      let res = await call(() => api.remove(root, w.path, branch, force));
      if (!res.ok && res.dirty) {
        const sure = await bubble.ask({
          ...ctx,
          title: 'Modifiche non committate',
          text: 'Nel worktree ci sono file modificati o nuovi che non sono in nessun commit: andranno persi.',
          confirmLabel: 'Butta le modifiche',
        });
        if (!sure) return null;
        force = true;
        res = await call(() => api.remove(root, w.path, branch, force));
      }
      if (!res.ok && !res.dirty && open.length) {
        await closeSessions(open);
        return call(() => api.remove(root, w.path, branch, force));
      }
      return res;
    }

    /**
     * @param {{path: string, branch: string|null, base: string|null}} w
     * @param {string} root radice del progetto
     * @param {Element} anchor il ⋯ della riga, a cui appendere i fumetti
     */
    async function openMenu(w, root, anchor) {
      // La chiave fa ritrovare la riga dopo un render (closeConfirm.retarget)
      const ctx = { anchor, key: `worktree:${w.path}` };
      const choice = await bubble.choose({ ...ctx, title: `⑂ ${nameOf(w)}`, text: w.base ? `Parte da ${w.base}.` : '', choices: menuChoices(w) });
      if (!choice) return;
      const open = sessionsIn(w.path);
      const conf = confirmation(choice, w, open.length);
      const confirmed = choice === 'merge' && review ? await review(w, conf) : await bubble.ask({ ...ctx, ...conf });
      if (!confirmed) return;

      const res = choice === 'merge'
        ? await call(() => api.merge(root, w.path))
        : await remove(w, root, choice, open, ctx);
      if (res === null) return; // seconda conferma rifiutata: niente è cambiato
      if (res.ok) {
        // La cartella non c'è più: le sessioni che ci stavano non hanno dove lavorare
        const left = sessionsIn(w.path);
        if (left.length) await closeSessions(left);
        await refresh(root);
        return;
      }
      // Il messaggio prima del rinfresco: la riga a cui si appende c'è ancora
      const title = res.conflict ? 'Conflitti: merge annullato' : res.merged ? 'Unito, ma la cartella è rimasta' : 'Non fatto';
      bubble.tell({ ...ctx, title, text: res.error || 'Errore sconosciuto.' }).catch(() => {});
      await refresh(root);
    }

    return { openMenu };
  }

  return { createWorktreeActions, menuChoices };
});

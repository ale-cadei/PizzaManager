/* Pannello «cosa ha cambiato» (docs/plans/32-pannello-modifiche.md): le
 * scelte che non toccano il DOM. Di quale cartella si parla, cosa dicono la
 * linguetta e l'intestazione, quando un diff aperto va riletto.
 *
 * I dati arrivano da lib/git-changes.js (canali `git-changes` e
 * `git-file-diff`). Wrapper UMD come session-groups.js: globale nella pagina
 * e module.exports sotto Node, per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessChangesModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SINCE_COMMIT = 'rispetto all\'ultimo commit';
  const STAGING = 'da committare';
  /* «Da committare» (docs/plans/43): le due sezioni, nell'ordine in cui si mostrano */
  const SECTIONS = [
    { side: 'staged', title: 'Staged', hint: 'Già nell\'indice: entra nel prossimo commit' },
    { side: 'unstaged', title: 'Non staged', hint: 'Non ancora aggiunto con git add (file nuovi compresi)' },
  ];

  /**
   * La cartella di cui mostrare le modifiche. Con un worktree che ricorda la
   * sua base il confronto è con la base, altrimenti con HEAD.
   * @param {{type: string, cwd?: string}|null} tab
   * @param {{path: string, branch: string|null, base: string|null}|null} worktree
   * `path` è la cartella del worktree (null nella cartella principale): la
   * lettura vale anche per il contatore sulla sua riga in sidebar.
   * `since` è la fotografia dell'ultimo giro, se è quello che si guarda;
   * `staging` vuol dire «Da committare» (indice e cartella, niente base).
   * @returns {{cwd: string, base: string|null, branch: string|null, path: string|null,
   *   since: string|null, staging: boolean, key: string}|null}
   */
  function targetFor(tab, worktree, { since = null, staging = false } = {}) {
    if (!tab || tab.type === 'git' || typeof tab.cwd !== 'string' || !tab.cwd) return null;
    const base = (worktree && worktree.base) || null;
    const branch = (worktree && worktree.branch) || null;
    const path = (worktree && worktree.path) || null;
    const turn = staging ? null : since;
    return {
      cwd: tab.cwd, base, branch, path, since: turn, staging: Boolean(staging),
      key: `${tab.cwd}\0${base || ''}\0${turn || ''}${staging ? '\0staging' : ''}`,
    };
  }

  /**
   * La conferma di un merge dal selettore dei branch (docs/plans/54): quello
   * che `name` porta in `into`, dal punto in cui si è staccato alla sua punta.
   * @param {{cwd: string, name: string, into: string}} merge
   */
  function incomingTarget({ cwd, name, into }) {
    if (typeof cwd !== 'string' || !cwd || typeof name !== 'string' || !name) return null;
    return {
      cwd, base: null, branch: null, path: null, since: null, staging: false, incoming: name, into: into || null,
      key: `${cwd}\0incoming\0${name}`,
    };
  }

  const isRepo = (result) => Boolean(result && result.ok);

  /* Tipi senza un agente (e senza pty): shell (nessun agente dentro) e i
     pannelli git/editor (nessun processo). Niente «ultimo giro», niente commenti. */
  const NON_AGENT_TYPES = ['shell', 'git', 'editor'];
  const isAgentTab = (tab) => Boolean(tab) && !NON_AGENT_TYPES.includes(tab.type);

  /* I pezzi di un contatore, ciascuno col suo colore: file, aggiunte (verde),
     rimozioni (rosso). `text` è la stessa cosa in una riga, per i titoli. */
  function countParts({ files, added, removed }, filesText = String(files)) {
    return [{ kind: 'files', text: filesText }, { kind: 'add', text: `+${added}` }, { kind: 'del', text: `−${removed}` }];
  }

  /** Linguetta: `3 · +121 −30`, `±0` se è tutto pulito. Fuori da un repository non c'è. */
  function tabLabel(result) {
    if (!isRepo(result)) return { visible: false, clean: true, text: '', parts: [] };
    const { files, added, removed } = result.totals;
    if (!files) return { visible: true, clean: true, text: '±0', parts: [{ kind: 'clean', text: '±0' }] };
    return { visible: true, clean: false, text: `${files} · +${added} −${removed}`, parts: countParts(result.totals) };
  }

  /** Di cosa parla il pannello, sotto la parola «Modifiche». `turnTime`: ora dell'ultimo prompt */
  function headerTitle(target, result, { turnTime = null } = {}) {
    if (target && target.incoming) return target.into ? `${target.incoming} in ${target.into}` : target.incoming;
    if (result && result.ok && result.since) return turnTime ? `ultimo giro · dalle ${turnTime}` : 'ultimo giro';
    const branch = target && target.branch;
    if (result && result.ok && result.staging) return branch ? `${branch} · ${STAGING}` : STAGING;
    if (result && result.ok && result.against === null) return 'nessun commit ancora';
    if (result && result.ok && result.base) return `${branch || 'branch'} da ${result.base}`;
    return branch ? `${branch} · ${SINCE_COMMIT}` : SINCE_COMMIT;
  }

  /** Il riepilogo sotto il titolo, a pezzi colorati come la linguetta */
  function summaryParts(result) {
    if (!isRepo(result)) return [];
    if (!result.totals.files) return [{ kind: 'note', text: 'Nessuna modifica' }];
    const parts = result.staging
      ? [{ kind: 'files', text: `${result.totals.staged} staged · ${result.totals.unstaged} non staged` },
        ...countParts(result.totals).slice(1)]
      : countParts(result.totals, `${result.totals.files} file`);
    return result.truncated ? [...parts, { kind: 'note', text: `mostrati i primi ${result.files.length}` }] : parts;
  }

  /** Un avviso sopra l'elenco: per ora solo la fotografia senza i file nuovi */
  function notice(result) {
    if (!result || !result.ok || !result.partial) return null;
    return 'Troppi file nuovi non ignorati (una cartella generata?): l\'ultimo giro non vede i file nuovi. '
      + 'Aggiungi quella cartella a .gitignore.';
  }

  /** Lo stesso riepilogo in una riga di testo */
  function summary(result) {
    if (!isRepo(result)) return '';
    const { files, added, removed } = result.totals;
    if (!files) return 'Nessuna modifica';
    const head = result.staging ? `${result.totals.staged} staged · ${result.totals.unstaged} non staged` : `${files} file`;
    const text = `${head} · +${added} −${removed}`;
    return result.truncated ? `${text} · mostrati i primi ${result.files.length}` : text;
  }

  /** I contatori di una riga: solo quelli diversi da zero; binari e file troppo grandi lo dicono */
  function fileCounts(f) {
    if (f.special) return { added: null, removed: null, note: 'non è un file' };
    if (f.binary) return { added: null, removed: null, note: 'binario' };
    if (f.added === null || f.added === undefined) return { added: null, removed: null, note: 'grande' };
    return {
      added: f.added > 0 ? `+${f.added}` : null,
      removed: f.removed > 0 ? `−${f.removed}` : null,
      note: null,
    };
  }

  /* Il timbro (dimensione e data del file) cambia a ogni riscrittura: un file
     ritoccato senza cambiare i contatori va comunque riletto */
  const fileKey = (f) => [f.side || '', f.path, f.oldPath || '', f.status, f.added, f.removed, f.binary ? 1 : 0, f.stamp || ''].join('\x1f');

  /** Uguale finché non cambia niente di visibile: si ridisegna solo allora */
  function signature(result) {
    if (!result) return 'none';
    if (!result.ok) return `ko:${result.reason || result.error || ''}`;
    // `uncommitted` decide se «Unisci» si può confermare: un commit lo cambia
    // senza toccare l'elenco dei file
    return [result.against, result.base || '', result.staging ? 'staging' : '', result.busy || '', result.truncated ? 1 : 0,
      result.totals.files, result.uncommitted,
      ...result.files.map(fileKey)].join('\x1e');
  }

  /**
   * Quali diff aperti rileggere (il file è cambiato) e quali chiudere (non è
   * più fra le modifiche). Se è cambiato il punto di confronto, tutti.
   */
  function diffsToReload(prevFiles, nextFiles, openPaths, { againstChanged = false } = {}) {
    const before = new Map((prevFiles || []).map((f) => [itemId(f), fileKey(f)]));
    const after = new Map((nextFiles || []).map((f) => [itemId(f), fileKey(f)]));
    const drop = openPaths.filter((p) => !after.has(p));
    const reload = openPaths.filter((p) => after.has(p) && (againstChanged || before.get(p) !== after.get(p)));
    return { reload, drop };
  }

  /**
   * Come si chiama una riga dell'elenco (diff aperti, fuoco): il percorso, e
   * in «Da committare» anche la sezione, perché un file a metà sta in tutte e due.
   */
  function itemId(f) {
    return f.side ? `${f.side}:${f.path}` : f.path;
  }

  /** L'inverso di itemId, dato il bersaglio: le sezioni non hanno `:` nel nome */
  function splitItemId(target, id) {
    if (!target || !target.staging) return { side: null, path: id };
    const i = id.indexOf(':');
    return { side: id.slice(0, i), path: id.slice(i + 1) };
  }

  /**
   * Le intestazioni delle sezioni di «Da committare», con quanti file hanno.
   * Fuori da quel modo, o senza niente da mostrare, nessuna.
   * @returns {Array<{side: string, title: string, hint: string, count: number}>}
   */
  function sections(result) {
    if (!isRepo(result) || !result.staging || !result.totals.files) return [];
    return SECTIONS.map((s) => ({ ...s, count: result.totals[s.side] || 0 }));
  }

  /** `lib/sub/x.js` → cartella e nome: il nome si evidenzia, la cartella no */
  function splitPath(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('/');
    return { dir: i >= 0 ? s.slice(0, i + 1) : '', name: i >= 0 ? s.slice(i + 1) : s };
  }

  function displayPath(f) {
    return f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
  }

  /**
   * Il selettore «Dall'ultimo commit | Ultimo giro | Da committare». Non c'è
   * in modalità Unisci; «Ultimo giro» è spento, e dice perché, finché la
   * sessione non ha una fotografia. «Da committare» c'è sempre.
   * @param {{type: string, turnTree?: string|null}|null} tab
   * @param {'commit'|'turn'|'staging'} wanted la scelta dell'utente
   * @returns {{current: 'commit'|'turn'|'staging', turnAvailable: boolean, turnHint: string}}
   */
  function modeChoice(tab, wanted) {
    const isAgent = isAgentTab(tab);
    const turnAvailable = isAgent && Boolean(tab.turnTree);
    const turnHint = !isAgent ? 'L\'ultimo giro c\'è solo nelle sessioni con un agente.'
      : turnAvailable ? 'Solo quello che è cambiato dopo l\'ultimo prompt inviato.'
        : 'Ancora nessun prompt inviato da questa sessione.';
    const current = wanted === 'staging' ? 'staging' : wanted === 'turn' && turnAvailable ? 'turn' : 'commit';
    return { current, turnAvailable, turnHint };
  }

  /** I commenti sul diff (docs/plans/44) vanno a un agente: non a shell e git, non durante Unisci */
  function reviewAvailable(tab, merging) {
    return isAgentTab(tab) && !merging;
  }

  /* Una cartella dentro la radice del repository (separatori di Windows compresi) */
  const slashes = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  function insideRoot(cwd, root) {
    const c = slashes(cwd);
    const r = slashes(root);
    return Boolean(r) && (c === r || c.startsWith(`${r}/`));
  }

  const BUSY_REASONS = {
    merge: 'C\'è un merge a metà nel repository: finiscilo o annullalo dal terminale.',
    rebase: 'C\'è un rebase a metà nel repository: finiscilo o annullalo dal terminale.',
  };

  /* Perché adesso non si scrive nell'indice, o null. Una sessione che lavora
     (renderer/running.js) committerebbe file a metà e si scontrerebbe con
     l'agente sull'index.lock: vale anche per le altre schede nello stesso repository. */
  function writeBlock(tab, tabs, result, writing) {
    if (writing) return 'Operazione in corso…';
    if (result.busy) return BUSY_REASONS[result.busy] || BUSY_REASONS.merge;
    if (tab && tab.running) return 'La sessione sta lavorando: aspetta che si fermi.';
    const other = (tabs || []).find((t) => t && t.running && (!tab || t.id !== tab.id) && insideRoot(t.cwd, result.root));
    return other ? `«${other.name || 'Un\'altra sessione'}» sta lavorando nello stesso repository: aspetta che si fermi.` : null;
  }

  /**
   * Stage, unstage e commit dal pannello (docs/plans/53): cosa si può fare
   * adesso, e perché no. Solo in «Da committare», mai durante Unisci.
   * @param {{id: string, running?: boolean}|null} tab la scheda in primo piano
   * @param {Array<{id: string, cwd?: string, name?: string, running?: boolean}>} tabs tutte
   * @param {object|null} result la lettura di readStaging
   * @param {{merging?: boolean, writing?: boolean, message?: string}} state
   * @returns {{canWrite: boolean, reason: string|null, canCommit: boolean,
   *   commitReason: string|null, commitLabel: string}|null}
   */
  function commitChoice(tab, tabs, result, { merging = false, writing = false, message = '' } = {}) {
    if (!isRepo(result) || !result.staging || merging) return null;
    const reason = writeBlock(tab, tabs, result, writing);
    const stagedCount = result.totals.staged || 0;
    const commitReason = reason
      || (!stagedCount ? 'Niente di staged: aggiungi i file con ＋.' : null)
      || (!String(message || '').trim() ? 'Scrivi il messaggio del commit.' : null);
    return {
      canWrite: !reason, reason,
      canCommit: !commitReason, commitReason,
      commitLabel: `Committa ${stagedCount} file`,
    };
  }

  /**
   * Il piè di pagina della conferma di un merge dal selettore (docs/plans/54).
   * Si spegne con file non committati (lib/git-merge.js rifiuterebbe) o con
   * una sessione che lavora nello stesso repository.
   * @param {{name: string, into: string}} merge
   * @param {object|null} result la lettura di readChanges con `incoming`
   * @param {Array<{id: string, cwd?: string, name?: string, running?: boolean}>} tabs
   * @returns {{text: string, confirmLabel: string, warning: string|null, canConfirm: boolean}}
   */
  function branchMergeFooter({ name, into }, result, tabs) {
    const text = `Unisce ${name} in ${into}: fast-forward se ${into} non è andato avanti, altrimenti un commit di merge. `
      + 'Ai conflitti si annulla tutto e la cartella resta com\'era.';
    const base = { text, confirmLabel: `Unisci in ${into}` };
    if (!isRepo(result)) return { ...base, warning: null, canConfirm: false };
    const pending = result.uncommitted > 0 ? result.uncommitted : 0;
    // Punta già nel corrente: lib/git-merge.js direbbe «niente da unire»
    const contained = Boolean(result.tip) && result.tip === result.against;
    const block = writeBlock(null, tabs, result, false)
      || (contained ? `${name} è già contenuto in ${into}: niente da unire.` : null);
    const warning = (pending
      ? `${pending === 1 ? '1 file tracciato ha' : `${pending} file tracciati hanno`} modifiche non committate: `
        + 'committale (o mettile da parte) prima di unire.'
      : null)
      || block
      || (!result.totals.files ? `${name} non cambia nessun file rispetto a ${into}.` : null);
    return { ...base, warning, canConfirm: !pending && !block };
  }

  /**
   * Il piè di pagina dello scarto di un file (docs/plans/56): prima la
   * conferma, poi l'Annulla dell'ultimo scarto, finché il pannello è aperto.
   * @param {{phase: 'confirm'|'done', path: string, untracked: boolean, undo?: object|null}|null} discard
   * @param {boolean} canWrite si può scrivere adesso (commitChoice)
   * @returns {{text: string, confirmLabel: string|null, undoLabel: string|null, canAct: boolean}|null}
   */
  function discardFooter(discard, canWrite) {
    if (!discard) return null;
    const { path, untracked } = discard;
    if (discard.phase === 'confirm') {
      const text = untracked
        ? `Cancellare ${path}? Non è in git.`
        : `Scartare le modifiche non staged a ${path}? Torna com'è nello stage: quello già staged resta.`;
      return {
        text: `${text} Subito dopo si può annullare, finché il pannello resta aperto.`,
        confirmLabel: untracked ? 'Cancella' : 'Scarta', undoLabel: null, canAct: canWrite,
      };
    }
    const text = untracked ? `Cancellato ${path}.` : `Scartate le modifiche a ${path}.`;
    if (!discard.undo) return { text: `${text} Era un collegamento: non si può annullare.`, confirmLabel: null, undoLabel: null, canAct: canWrite };
    return { text, confirmLabel: null, undoLabel: 'Annulla lo scarto', canAct: canWrite };
  }

  /** Se un file del pannello si può aprire nell'editor (docs/plans/64): c'è sul disco ed è testo. */
  const openableInEditor = (f) => Boolean(f && typeof f.path === 'string' && f.path
    && f.status !== 'D' && !f.binary && !f.special);

  function emptyText(result) {
    if (result && result.incoming) return 'Nessun file cambiato.';
    if (result && result.staging) return 'Niente da committare: indice e cartella come all\'ultimo commit.';
    return result && result.since ? 'Nessuna modifica dall\'ultimo prompt.' : 'Nessuna modifica: tutto come all\'ultimo commit.';
  }

  return {
    targetFor, tabLabel, headerTitle, summary, summaryParts, notice, modeChoice, emptyText, fileCounts, signature,
    diffsToReload, splitPath, displayPath, itemId, splitItemId, sections, reviewAvailable, commitChoice,
    incomingTarget, branchMergeFooter, discardFooter, openableInEditor,
  };
});

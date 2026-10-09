/* Scheda di tipo git: niente pty né xterm, un pannello con la timeline dei
   branch locali (renderer/git-graph-view.js) letta dal main (lib/git-graph.js).
   Si aggiorna quando torna in primo piano e dal pulsante del pannello; dal
   nome del branch si cambia branch, se ne crea uno, si elimina un locale o
   se ne unisce uno nel corrente (git-branch-picker.js).
   Le schede aperte si salvano (lib/git-sessions.js) e tornano al riavvio:
   da sole, o dalla finestra del ripristino se la macchina si è riavviata. */

const GitView = window.AisessGitView;
const GitBranchPicker = window.AisessGitBranchPicker;

/** Legge la timeline e la disegna. Una sola lettura alla volta per scheda:
    chi chiama durante una lettura aspetta quella in corso. */
function refreshGitTab(tab) {
  if (!tab || !tab.git) return Promise.resolve();
  if (!tab.git.pending) tab.git.pending = loadGitTab(tab).finally(() => { tab.git.pending = null; });
  return tab.git.pending;
}

async function loadGitTab(tab) {
  tab.git.view.setLoading(true);
  try {
    const data = await window.aisess.gitGraph(tab.cwd);
    if (!tabs.has(tab.id)) return;
    tab.git.view.update(data);
    if (data && data.ok) nameGitTab(tab, data.root);
  } catch (e) {
    console.warn('git-graph non raggiungibile', e);
    tab.git.view.showStatus('Impossibile leggere il repository: ' + String((e && e.message) || e), true);
  } finally {
    tab.git.view.setLoading(false);
  }
}

/* Dopo un cambio o una creazione di branch riuscita la timeline si rilegge:
   il branch corrente è cambiato. L'esito torna al selettore, che mostra
   l'errore di git se qualcosa è andato storto. */
async function afterBranchChange(tab, request) {
  const r = await request;
  if (r && r.ok) await refreshGitTab(tab);
  return r;
}

/* ⤵ nel selettore (docs/plans/46): il pannello delle modifiche mostra cosa
   porta il branch e chiede conferma; il merge ricontrolla che la punta sia
   ancora quella guardata. Il testo dell'esito lo mostra il selettore. */
async function mergeIntoCurrent(tab, name, kind, into) {
  const seen = await reviewBranchMerge({ cwd: tab.cwd, name, into });
  if (!seen) return { cancelled: true };
  const r = await afterBranchChange(tab, window.aisess.gitMerge(tab.cwd, name, kind, seen.tip));
  if (!r || !r.ok) return r;
  const how = r.fastForward ? 'fast-forward' : r.commit ? `commit ${r.commit}` : 'commit di merge';
  return { ok: true, text: `${r.branch} unito in ${r.into} (${how}).` };
}

/* Senza un nome scelto, la scheda prende quello del repository */
function nameGitTab(tab, root) {
  const repoName = String(root || '').split(/[\\/]/).filter(Boolean).pop();
  const changed = tab.projectRoot !== root;
  tab.projectRoot = root || tab.projectRoot;
  if (tab.autoNamed && repoName && tab.name !== repoName) {
    tab.name = repoName;
    renderSidebar();
  } else if (changed) {
    renderSidebar();
  }
}

/* Le schede git non hanno una sessione tmux che le ricordi: la lista si
   salva a ogni apertura, chiusura o rinomina. Un nome dato dal repository non
   si salva (null): al ritorno lo riprende da sé. */
function saveGitSessions() {
  const sessions = [...tabs.values()].filter((t) => t.type === 'git')
    .map((t) => ({ cwd: t.cwd, name: t.autoNamed ? null : t.name, startedAt: t.startedAt }));
  return window.aisess.saveGitSessions(sessions)
    .then((r) => { if (r && !r.ok) console.warn('git-sessions-save fallito:', r.error); })
    .catch((e) => console.warn('git-sessions-save non raggiungibile', e));
}

/* All'avvio. Se la macchina non si è riavviata le schede git tornano da
   sole, come le sessioni tmux vive che si riattaccano. Dopo un riavvio
   (`ask`) non si aprono: si restituiscono a offerRestore, che le propone
   insieme alle sessioni perse. Una directory che non è più un repository si
   apre lo stesso e lo dice nel pannello. */
async function restoreGitSessions() {
  let r = null;
  try { r = await window.aisess.gitSessions(); } catch (e) { console.warn('git-sessions non raggiungibile', e); return []; }
  if (!r || !r.ok) { if (r) console.warn('git-sessions fallito:', r.error); return []; }
  if (r.ask) return r.sessions;
  for (const s of r.sessions) {
    await createGitTab({ name: s.name, cwd: s.cwd, startedAt: s.startedAt, restoring: true, reveal: false });
  }
  return [];
}

async function createGitTab({ name, cwd, startedAt = Date.now(), restoring = false, reveal = true } = {}) {
  const id = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wrap = document.createElement('div');
  wrap.className = 'term-wrap git-wrap type-git';
  wrap.id = 'wrap-' + id;
  $('#terminals').appendChild(wrap);
  const tab = { id, type: 'git', name: name || `git · ${counter++}`, cwd, projectRoot: cwd || null, startedAt, autoNamed: !name,
    session: null, reattached: false, alive: true, needsAttention: false, running: false, term: null, fit: null, ro: null, wrap, git: null };
  const view = GitView.createGitView({
    root: wrap, document,
    onRefresh: () => refreshGitTab(tab),
    onCopy: (hash) => { window.aisess.clipboardWrite(hash).catch((e) => console.warn('copia fallita', e)); },
    onBranchClick: () => picker.toggle(),
  });
  const picker = GitBranchPicker.createBranchPicker({
    document, host: view.element, storage: window.localStorage,
    load: () => window.aisess.gitBranches(tab.cwd),
    onSwitch: (name, kind) => afterBranchChange(tab, window.aisess.gitSwitch(tab.cwd, name, kind)),
    onCreate: (name) => afterBranchChange(tab, window.aisess.gitCreateBranch(tab.cwd, name)),
    onDelete: (name, force) => afterBranchChange(tab, window.aisess.gitDeleteBranch(tab.cwd, name, force)),
    onMerge: (name, kind, into) => mergeIntoCurrent(tab, name, kind, into),
  });
  tab.git = { view, picker, pending: null };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id, { reveal });
  // Durante il ripristino la lista su disco è già quella giusta: riscriverla
  // a ogni scheda la accorcerebbe, se l'app si chiudesse a metà
  if (!restoring) saveGitSessions();
  await refreshGitTab(tab);
}

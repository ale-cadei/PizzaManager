/* Scheda di tipo git: niente pty né xterm, un pannello con la timeline dei
   branch locali (renderer/git-graph-view.js) letta dal main (lib/git-graph.js).
   Si aggiorna quando torna in primo piano e dal pulsante del pannello. */

const GitView = window.AisessGitView;

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

async function createGitTab({ name, cwd, startedAt = Date.now() } = {}) {
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
  });
  tab.git = { view, pending: null };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id);
  await refreshGitTab(tab);
}

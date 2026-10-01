/* PizzaManager renderer — punto d'ingresso: init() collega eventi e moduli.
   Caricato per ultimo; lo stato condiviso sta in app-state.js. */

async function init() {
  Icons.hydrate(document);
  Logo.hydrate(document);
  const d = await window.aisess.getDefaults();
  tmuxAvailable = Boolean(d.tmux && d.tmux.available);
  tmuxPath = (d.tmux && d.tmux.path) || null;
  $('#platform-label').textContent = d.label || `${d.platform} · ${d.shell}`;
  $('#platform-label').title = `${d.platform} · ${d.shell}`;
  $('#new-cwd').value = d.homedir;
  initWelcome();
  await refreshDeps();

  $('#btn-new').addEventListener('click', () => openNewModal());
  $('#btn-resume').addEventListener('click', () => openResumeModal());
  $('#open-search').addEventListener('input', onOpenSearchInput);

  // Voci del menu File (native e della menubar in-app)
  try {
    window.aisess.onMenu('menu-new-session', () => openNewModal());
    window.aisess.onMenu('menu-open-config', () => window.AisessCommands.openConfig());
    window.aisess.onMenu('menu-term-font-bigger', () => runTermFontAction('term-font-bigger'));
    window.aisess.onMenu('menu-term-font-smaller', () => runTermFontAction('term-font-smaller'));
    window.aisess.onMenu('menu-term-font-reset', () => runTermFontAction('term-font-reset'));
    window.aisess.onMenu('menu-type-colors', () => typeColorsDialog().open());
    window.aisess.onMenu('menu-pets', () => petsDialog().open());
    window.aisess.onMenuEdit((action) => runEditAction(action));
  } catch {}

  // Comandi di avvio configurabili (renderer/command-config.js)
  window.AisessCommands.initConfigUI();
  window.AisessCommands.load().catch((e) => console.warn('get-command-profiles fallito', e));
  window.onCommandProfilesChanged = () => renderSidebar();

  initSidebarResize();
  initUsageBar();
  initExtensions();
  initPets();
  $('#group-mode-type').addEventListener('click', () => { if (sidebar.setMode('type')) renderSidebar(); });
  $('#group-mode-project').addEventListener('click', () => { if (sidebar.setMode('project')) renderSidebar(); });
  initMenubar(d.platform);

  // new modal
  $$('.type-card').forEach(c => c.addEventListener('click', () => {
    $$('.type-card').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
    pendingNewType = c.dataset.type;
    showNewError('');
    updateClaudeAccountRow();
  }));
  $('#new-cancel').addEventListener('click', () => $('#modal-new').hidden = true);
  $('#btn-browse').addEventListener('click', async () => {
    const p = await window.aisess.pickCwd();
    if (p) {
      $('#new-cwd').value = p;
      markSelectedRecentDir();
    }
  });
  $('#new-cwd').addEventListener('input', () => { markSelectedRecentDir(); showNewError(''); });
  $('#new-confirm').addEventListener('click', async () => {
    const name = $('#new-name').value.trim();
    const cwd = $('#new-cwd').value.trim() || undefined;
    // Una sessione git ha senso solo dentro un repository: il modal resta aperto
    if (pendingNewType === 'git') {
      const problem = await gitRepoProblem(cwd);
      if (problem) { showNewError(problem); return; }
    }
    showNewError('');
    const claudeAccountId = pendingNewType === 'claude' ? ($('#new-claude-account') || {}).value || null : null;
    if (claudeAccountId) { try { localStorage.setItem('aisess.claudeAccount', claudeAccountId); } catch {} }
    $('#modal-new').hidden = true;
    $('#new-name').value = '';
    await createTab(pendingNewType, { name, cwd, claudeAccountId });
  });

  // resume modal
  // gestione account Claude nel modal nuova sessione
  $('#btn-manage-accounts').addEventListener('click', () => {
    const m = $('#account-manager');
    m.hidden = !m.hidden;
    if (!m.hidden) renderAccountManager();
  });
  $('#btn-add-account').addEventListener('click', async () => {
    const name = $('#acc-name').value.trim();
    const apiKey = $('#acc-key').value.trim();
    if (!name || !apiKey) return;
    const r = await window.aisess.addClaudeAccount({ name, apiKey });
    if (!r.ok) { renderAccountManager(r.error); return; }
    $('#acc-name').value = '';
    $('#acc-key').value = '';
    await ensureClaudeAccounts(true);
    fillAccountSelect($('#new-claude-account'));
    fillAccountSelect($('#resume-claude-account'));
    renderAccountManager();
    updateClaudeAccountRow();
  });

  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
    t.classList.add('active');
    t.setAttribute('aria-selected', 'true');
    resumeTab = t.dataset.tab;
    updateResumeAccountRow();
    renderResumeList();
  }));
  $('#resume-close').addEventListener('click', () => $('#modal-resume').hidden = true);
  $('#resume-reload').addEventListener('click', async () => {
    resumeCache = emptyResumeCache();
    await renderResumeList();
  });
  $('#resume-search').addEventListener('input', onResumeSearchInput);
  $('#resume-group-projects').addEventListener('change', () => { renderResumeList(); });
  $('#resume-project-clear').addEventListener('click', () => {
    resumeProjectFilterRoot = null;
    updateResumeProjectScope();
    renderResumeList();
  });

  window.aisess.onData(({ id, data }) => {
    const t = tabs.get(id);
    if (!t) return;
    t.term.write(data);
    if (t.scroller) t.scroller.noteOutput();
    noteActivity(t, data ? data.length : 0);
    noteRunning(t);
  });
  window.aisess.onExit(({ id, exitCode }) => {
    const t = tabs.get(id);
    if (t) {
      t.alive = false;
      clearAttention(id);
      // Il processo è morto: l'ultimo output non deve lasciare la card che corre
      clearTimeout(t.runTimer);
      running.forget(id);
      t.running = false;
      t.term.write(`\r\n\x1b[90m[processo terminato con codice ${exitCode}] — puoi chiudere la scheda ✕\x1b[0m\r\n`);
      renderSidebar();
    }
  });

  window.addEventListener('resize', () => fitActive());
  watchWorktrees();
  renderSidebar();
  updateEmpty();
  ensureClaudeAccounts();
  await reattachLiveSessions();
  const gitToOffer = await restoreGitSessions();
  await offerRestore(gitToOffer);
}

document.addEventListener('DOMContentLoaded', init);

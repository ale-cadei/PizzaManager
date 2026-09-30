/* Modal «Resume»: conversazioni dei CLI e cronologia dell'app. */

let resumeRenderSeq = 0;
const resumeCollapsedProjects = new Set();

function updateResumeProjectScope() {
  const scope = $('#resume-project-scope');
  scope.hidden = !resumeProjectFilterRoot;
  $('#resume-project-label').textContent = resumeProjectFilterRoot ? `Solo ${resumeProjectFilterRoot}` : '';
  $('#resume-project-label').title = resumeProjectFilterRoot || '';
}

async function openResumeModal({ projectRoot = null } = {}) {
  resumeCollapsedProjects.clear();
  resumeProjectFilterRoot = typeof projectRoot === 'string' && projectRoot ? projectRoot : null;
  $('#resume-group-projects').checked = Boolean(resumeProjectFilterRoot);
  $('#resume-search').value = '';
  if (resumeProjectFilterRoot && resumeTab === 'search') {
    resumeTab = 'opencode';
    $$('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === resumeTab);
      tab.setAttribute('aria-selected', String(tab.dataset.tab === resumeTab));
    });
  }
  updateResumeProjectScope();
  $('#modal-resume').hidden = false;
  await updateResumeAccountRow();
  await renderResumeList();
}

async function ensureResumeData(tab) {
  const limit = resumeProjectFilterRoot ? 500 : 100;
  if (resumeCache[tab] && (tab === 'history' || resumeCache[tab].requestedLimit >= limit)) return resumeCache[tab];
  if (tab === 'opencode') {
    const r = await window.aisess.listOpencode(limit);
    resumeCache.opencode = { ...r, requestedLimit: limit };
  } else if (tab === 'claude') {
    const r = await window.aisess.listClaude(limit);
    resumeCache.claude = { ...r, requestedLimit: limit };
  } else if (tab === 'codex') {
    const r = await window.aisess.listCodex(limit);
    resumeCache.codex = { ...r, requestedLimit: limit };
  } else if (tab === 'antigravity') {
    const r = await window.aisess.listAntigravity(limit);
    resumeCache.antigravity = { ...r, requestedLimit: limit };
  } else {
    const h = await window.aisess.getHistory();
    resumeCache.history = { ok: true, sessions: h };
  }
  return resumeCache[tab];
}

const SEARCH_PLACEHOLDER = {
  search: 'Cerca nei messaggi o per nome del progetto…',
  list: 'Cerca per titolo, progetto, directory o id…',
};

async function renderResumeList(keepCache = false) {
  const seq = ++resumeRenderSeq;
  const box = $('#resume-list');
  $('#resume-search').placeholder = resumeTab === 'search' ? SEARCH_PLACEHOLDER.search : SEARCH_PLACEHOLDER.list;
  if (resumeTab === 'search') return conversationSearch.run($('#resume-search').value);
  conversationSearch.cancel(); // una risposta in ritardo non deve coprire questa lista
  const q = $('#resume-search').value || '';
  box.innerHTML = '<p class="muted">Caricamento…</p>';
  const data = await ensureResumeData(resumeTab);
  if (seq !== resumeRenderSeq) return;
  if (!data.ok) {
    box.innerHTML = `<p class="muted">⚠ ${escapeHtml(data.error || 'Nessun dato')}</p>`;
    return;
  }
  const items = data.sessions || [];
  const grouped = $('#resume-group-projects').checked;
  const groups = await window.AisessResumeProjects.arrange(items, {
    source: resumeTab, resolve: resolveProjectRoot,
    filterRoot: resumeProjectFilterRoot, grouped, query: q, Groups,
  });
  if (seq !== resumeRenderSeq) return;
  if (!groups.some((group) => group.items.length)) {
    box.innerHTML = '<p class="muted">Nessuna sessione trovata.</p>';
    appendResumeLimitNote(box, data, grouped);
    return;
  }
  box.innerHTML = '';
  appendResumeGroups(box, groups, (s) => createResumeItem(resumeTab, s));
  appendResumeLimitNote(box, data, grouped);
  // Il lister puo' aver scartato file illeggibili o in un formato inatteso:
  // meglio dirlo che lasciar credere che la lista sia completa.
  if (data.skipped > 0) {
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = data.skipped === 1 ? '1 sessione non leggibile, esclusa dall\'elenco.' : `${data.skipped} sessioni non leggibili, escluse dall'elenco.`;
    box.appendChild(note);
  }
}

function appendResumeLimitNote(box, data, grouped) {
  if (!(grouped || resumeProjectFilterRoot) || !data.requestedLimit || (data.sessions || []).length < data.requestedLimit) return;
  box.appendChild(mutedNote(`Elenco limitato alle ${data.requestedLimit} conversazioni più recenti.`, 'small'));
}

function appendResumeGroups(box, groups, createItem) {
  // La lista normale resta corta come prima; con un progetto scelto o con il
  // raggruppamento attivo non nascondere interi gruppi per il limite visivo.
  const limit = $('#resume-group-projects').checked || resumeProjectFilterRoot ? Infinity : 80;
  let shown = 0;
  for (const group of groups) {
    const visible = group.items.slice(0, limit - shown);
    if (!visible.length) continue;
    let target = box;
    if ($('#resume-group-projects').checked) {
      const section = document.createElement('section');
      section.className = 'resume-project-group';
      const heading = document.createElement('h3');
      heading.className = 'resume-project-heading';
      heading.title = group.title;
      const toggle = document.createElement('button');
      toggle.className = 'resume-project-toggle';
      toggle.type = 'button';
      const arrow = document.createElement('span');
      arrow.className = 'resume-project-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '▾';
      const label = document.createElement('span');
      label.className = 'resume-project-name';
      label.textContent = `${group.label} (${group.items.length})`;
      toggle.appendChild(arrow);
      toggle.appendChild(label);
      heading.appendChild(toggle);
      const body = document.createElement('div');
      body.className = 'resume-project-items';
      body.id = `resume-project-items-${shown}`;
      const expanded = !resumeCollapsedProjects.has(group.key);
      toggle.setAttribute('aria-controls', body.id);
      toggle.setAttribute('aria-expanded', String(expanded));
      body.hidden = !expanded;
      toggle.onclick = () => {
        const open = body.hidden;
        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) resumeCollapsedProjects.delete(group.key);
        else resumeCollapsedProjects.add(group.key);
      };
      section.appendChild(heading);
      section.appendChild(body);
      box.appendChild(section);
      target = body;
    }
    for (const item of visible) target.appendChild(createItem(item));
    shown += visible.length;
    if (shown >= limit) break;
  }
}

/* ---------- Linguetta «Cerca»: messaggi e nomi dei progetti ---------- */

const conversationSearch = ConvSearch.createSearchRunner({
  search: (q) => window.aisess.searchConversations(q),
  render: renderSearchState,
});

/** La casella del Resume: filtra la lista, o cerca nei messaggi dopo una pausa. */
function onResumeSearchInput() {
  if (resumeTab === 'search') conversationSearch.schedule($('#resume-search').value);
  else renderResumeList(true);
}

function mutedNote(text, extraClass) {
  const p = document.createElement('p');
  p.className = 'muted' + (extraClass ? ' ' + extraClass : '');
  p.textContent = text;
  return p;
}

async function renderSearchState(state) {
  if (resumeTab !== 'search') return;
  const seq = ++resumeRenderSeq;
  const box = $('#resume-list');
  box.innerHTML = '';
  if (state.phase !== 'results') {
    box.appendChild(mutedNote(ConvSearch.statusText(state)));
    return;
  }
  const groups = await window.AisessResumeProjects.arrange(state.results, {
    resolve: resolveProjectRoot, filterRoot: resumeProjectFilterRoot,
    grouped: $('#resume-group-projects').checked, Groups,
  });
  if (seq !== resumeRenderSeq || resumeTab !== 'search' || $('#modal-resume').hidden) return;
  if (!groups.some((group) => group.items.length)) box.appendChild(mutedNote('Nessuna conversazione trovata in questo progetto.'));
  else appendResumeGroups(box, groups, (r) => createSearchItem(r, state.query));
  if (state.truncated) box.appendChild(mutedNote(`Solo le ${state.results.length} conversazioni più recenti: aggiungi una parola per restringere.`, 'small'));
  if (state.skipped > 0) box.appendChild(mutedNote(`${state.skipped} conversazioni non leggibili, escluse dalla ricerca.`, 'small'));
}

/* Un risultato è una voce del Resume (stesse viste, stessa scelta dell'account
   Claude) con sotto i frammenti trovati. */
function createSearchItem(r, query) {
  const el = createResumeItem(r.source, { id: r.id, title: r.title, cwd: r.cwd, mtime: r.mtime });
  el.classList.add('search-result');
  const meta = el.querySelector('.meta');
  if (r.projectName && !r.hits) meta.appendChild(mutedNote(`Trovata per nome del progetto: ${r.projectName}`, 'small'));
  ConvSearch.appendExpandableSnippets(document, meta, r, {
    query,
    loadAll: (q, scope, all) => window.aisess.searchConversations(q, scope, all),
    isCurrent: () => resumeTab === 'search' && !$('#modal-resume').hidden && $('#resume-search').value === query,
  });
  return el;
}

/* Descrittori per tab: come mostrare una voce e come riaprirla.
   `date` è la data da mostrare, `open()` avvia la scheda corrispondente. */
const RESUME_VIEWS = {
  opencode: (s) => ({
    icon: 'opencode',
    title: Titles.displayName(titleStore, 'opencode', s.id, s.title || s.id),
    sub: [titleStore.nameFor('opencode', s.id) ? s.title : null, s.directory, s.id, fmtDate(s.created)],
    action: 'Resume',
    actionClass: 'btn--primary',
    open: () => createTab('opencode', { name: Titles.displayName(titleStore, 'opencode', s.id, s.title || 'opencode').slice(0, 28), cwd: s.directory, resumeId: s.id }),
  }),
  claude: (s) => ({
    icon: 'claude',
    title: Titles.displayName(titleStore, 'claude', s.id, s.title || s.id),
    sub: [titleStore.nameFor('claude', s.id) ? s.title : null, s.cwd, s.id.slice(0, 8), fmtDate(s.mtime)],
    action: 'Resume',
    actionClass: 'btn--primary',
    open: () => createTab('claude', { name: Titles.displayName(titleStore, 'claude', s.id, s.title || 'claude').slice(0, 28), cwd: s.cwd, resumeId: s.id, claudeAccountId: selectedResumeAccount() }),
  }),
  codex: (s) => ({
    icon: 'codex',
    title: Titles.displayName(titleStore, 'codex', s.id, s.title || s.id),
    sub: [titleStore.nameFor('codex', s.id) ? s.title : null, s.cwd, s.id.slice(0, 8), fmtDate(s.mtime)],
    action: 'Resume',
    actionClass: 'btn--primary',
    open: () => createTab('codex', { name: Titles.displayName(titleStore, 'codex', s.id, s.title || 'codex').slice(0, 28), cwd: s.cwd, resumeId: s.id }),
  }),
  antigravity: (s) => ({
    icon: 'antigravity',
    title: Titles.displayName(titleStore, 'antigravity', s.id, s.title || s.id),
    sub: [titleStore.nameFor('antigravity', s.id) ? s.title : null, s.cwd, s.id.slice(0, 8), fmtDate(s.mtime)],
    action: 'Resume',
    actionClass: 'btn--primary',
    open: () => createTab('antigravity', { name: Titles.displayName(titleStore, 'antigravity', s.id, s.title || 'antigravity').slice(0, 28), cwd: s.cwd, resumeId: s.id }),
  }),
  history: (s) => ({
    icon: Icons.has(s.type) ? s.type : null,
    title: s.cmd || s.type,
    sub: [s.cwd, s.lastOpened],
    action: 'Riapri',
    actionClass: 'btn--secondary',
    open: () => {
      const t = Icons.has(s.type) ? s.type : 'shell';
      return createTab(t, {
        cwd: s.cwd,
        resumeId: s.resumeId,
        claudeAccountId: t === 'claude' ? (s.claudeAccountId || null) : null,
        commandProfileId: s.commandProfileId || undefined,
      });
    },
  }),
};

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function createResumeItem(tab, s) {
  const view = (RESUME_VIEWS[tab] || RESUME_VIEWS.history)(s);
  const el = document.createElement('div');
  el.className = 'resume-item';
  const sub = view.sub.filter(Boolean).join(' · ');
  // L'icona è markup statico del modulo icone; solo i dati della sessione vanno escapati
  const icon = view.icon ? `<span class="icon">${Icons.markup(view.icon)}</span>` : '';
  el.innerHTML = `<div class="meta"><div class="title">${icon}${escapeHtml(view.title)}</div>
    <div class="sub path" title="${escapeHtml(sub)}"><span>${escapeHtml(sub)}</span></div></div>`;
  const btn = document.createElement('button');
  btn.className = 'btn ' + view.actionClass;
  btn.style.width = 'auto';
  btn.textContent = view.action;
  btn.onclick = async () => {
    $('#modal-resume').hidden = true;
    await view.open();
  };
  if (Sidebar.EXPORTABLE_TYPES.includes(tab) && s.id) el.appendChild(createExportButton(tab, s.id, el));
  el.appendChild(btn);
  return el;
}

/* ---------- «⤓ .md»: la conversazione in un file Markdown (piano 23) ----------
   Il modal resta aperto: l'esito sta sul bottone, un errore in una nota sotto
   la voce. Il percorso lo sceglie il dialog nel main. */

const EXPORT_LABEL = '⤓ .md';

function createExportButton(source, id, item) {
  const btn = document.createElement('button');
  btn.className = 'btn btn--ghost resume-export';
  btn.style.width = 'auto';
  btn.textContent = EXPORT_LABEL;
  btn.title = 'Esporta la conversazione in Markdown';
  btn.onclick = async () => {
    btn.disabled = true;
    const res = await window.aisess.exportConversation(source, id)
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    btn.disabled = false;
    showExportOutcome(item, btn, res);
  };
  return btn;
}

function showExportOutcome(item, btn, res) {
  const previous = item.querySelector('.export-error');
  if (previous) previous.remove();
  if (res.ok) {
    btn.textContent = '✓ .md';
    btn.title = 'Salvata in ' + res.path;
    return;
  }
  btn.textContent = EXPORT_LABEL;
  if (res.cancelled) return;
  item.querySelector('.meta').appendChild(mutedNote('⚠ ' + (res.error || 'Esportazione non riuscita.'), 'small export-error'));
}

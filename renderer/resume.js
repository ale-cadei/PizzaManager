/* Modal «Resume»: conversazioni dei CLI e cronologia dell'app. */

async function openResumeModal() {
  $('#modal-resume').hidden = false;
  await updateResumeAccountRow();
  await renderResumeList();
}

async function ensureResumeData(tab) {
  if (resumeCache[tab]) return resumeCache[tab];
  if (tab === 'opencode') {
    const r = await window.aisess.listOpencode(100);
    resumeCache.opencode = r;
  } else if (tab === 'claude') {
    const r = await window.aisess.listClaude(100);
    resumeCache.claude = r;
  } else if (tab === 'codex') {
    const r = await window.aisess.listCodex(100);
    resumeCache.codex = r;
  } else if (tab === 'antigravity') {
    const r = await window.aisess.listAntigravity(100);
    resumeCache.antigravity = r;
  } else {
    const h = await window.aisess.getHistory();
    resumeCache.history = { ok: true, sessions: h };
  }
  return resumeCache[tab];
}

const SEARCH_PLACEHOLDER = {
  search: 'Cerca nei messaggi delle conversazioni…',
  list: 'Cerca per titolo, directory o id…',
};

async function renderResumeList(keepCache = false) {
  const box = $('#resume-list');
  $('#resume-search').placeholder = resumeTab === 'search' ? SEARCH_PLACEHOLDER.search : SEARCH_PLACEHOLDER.list;
  if (resumeTab === 'search') return conversationSearch.run($('#resume-search').value);
  conversationSearch.cancel(); // una risposta in ritardo non deve coprire questa lista
  const q = ($('#resume-search').value || '').toLowerCase();
  box.innerHTML = '<p class="muted">Caricamento…</p>';
  const data = await ensureResumeData(resumeTab);
  if (!data.ok) {
    box.innerHTML = `<p class="muted">⚠ ${escapeHtml(data.error || 'Nessun dato')}</p>`;
    return;
  }
  let items = data.sessions || [];
  if (q) {
    items = items.filter(s => JSON.stringify(s).toLowerCase().includes(q));
  }
  if (!items.length) {
    box.innerHTML = '<p class="muted">Nessuna sessione trovata.</p>';
    return;
  }
  box.innerHTML = '';
  for (const s of items.slice(0, 80)) box.appendChild(createResumeItem(resumeTab, s));
  // Il lister puo' aver scartato file illeggibili o in un formato inatteso:
  // meglio dirlo che lasciar credere che la lista sia completa.
  if (data.skipped > 0) {
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = data.skipped === 1 ? '1 sessione non leggibile, esclusa dall\'elenco.' : `${data.skipped} sessioni non leggibili, escluse dall'elenco.`;
    box.appendChild(note);
  }
}

/* ---------- Linguetta «Cerca»: nei messaggi, non nei titoli ---------- */

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

function renderSearchState(state) {
  if (resumeTab !== 'search') return;
  const box = $('#resume-list');
  box.innerHTML = '';
  if (state.phase !== 'results') {
    box.appendChild(mutedNote(ConvSearch.statusText(state)));
    return;
  }
  for (const r of state.results) box.appendChild(createSearchItem(r));
  if (state.truncated) box.appendChild(mutedNote(`Solo le ${state.results.length} conversazioni più recenti: aggiungi una parola per restringere.`, 'small'));
  if (state.skipped > 0) box.appendChild(mutedNote(`${state.skipped} conversazioni non leggibili, escluse dalla ricerca.`, 'small'));
}

/* Un risultato è una voce del Resume (stesse viste, stessa scelta dell'account
   Claude) con sotto i frammenti trovati. */
function createSearchItem(r) {
  const el = createResumeItem(r.source, { id: r.id, title: r.title, cwd: r.cwd, mtime: r.mtime });
  el.classList.add('search-result');
  const meta = el.querySelector('.meta');
  for (const snip of r.snippets) meta.appendChild(ConvSearch.snippetElement(document, snip));
  if (r.hits > r.snippets.length) meta.appendChild(mutedNote(ConvSearch.hitsText(r.hits), 'small search-hits'));
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

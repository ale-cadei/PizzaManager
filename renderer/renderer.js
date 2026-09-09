/* AISessionManager renderer */
const tabs = new Map();
let activeId = null;
let counter = 1;
let pendingNewType = 'shell';
let resumeTab = 'opencode';
let resumeCache = { opencode: null, claude: null, history: null };

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const ICONS = { shell: '🖥', opencode: '⚡', claude: '🤖' };

async function init() {
  const d = await window.aisess.getDefaults();
  $('#platform-label').textContent = d.platform + ' · ' + d.shell;
  $('#new-cwd').value = d.homedir;
  try {
    const deps = await window.aisess.checkDeps();
    const fmt = (b, name) => b && b.found ? `✔ ${name}: ${b.path}` : `✘ ${name} non trovato`;
    $('#deps-status').textContent = `${deps.opencode.found ? '✔' : '✘'} opencode · ${deps.claude.found ? '✔' : '✘'} claude`;
    $('#deps-status').title = fmt(deps.opencode, 'opencode') + '\n' + fmt(deps.claude, 'claude') + '\nPATH: ' + deps.path;
    const mark = (id, b) => {
      const el = $(id);
      if (!el) return;
      el.style.opacity = b && b.found ? '1' : '0.45';
      el.title = b && b.found ? b.path + ' (' + (b.via || '') + ')' : 'NON TROVATO nel PATH:\n' + (b && b.searchedPath);
    };
    mark('#dep-opencode', deps.opencode);
    mark('#dep-claude', deps.claude);
    if (!deps.opencode.found || !deps.claude.found) {
      console.warn('[AISessionManager] binari mancanti:', deps);
    }
  } catch (e) { console.warn('check-deps fallito', e); }

  $('#btn-new').addEventListener('click', () => openNewModal());
  $('#btn-resume').addEventListener('click', openResumeModal);

  // Voce del menu nativo File > Nuova sessione
  try {
    window.aisess.onMenu('menu-new-session', () => openNewModal());
  } catch {}

  initSidebarResize();
  initMenubar(d.platform);

  // new modal
  $$('.type-card').forEach(c => c.addEventListener('click', () => {
    $$('.type-card').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
    pendingNewType = c.dataset.type;
    updateClaudeAccountRow();
  }));
  $('#new-cancel').addEventListener('click', () => $('#modal-new').hidden = true);
  $('#btn-browse').addEventListener('click', async () => {
    const p = await window.aisess.pickCwd();
    if (p) $('#new-cwd').value = p;
  });
  $('#new-confirm').addEventListener('click', async () => {
    const name = $('#new-name').value.trim();
    const cwd = $('#new-cwd').value.trim() || undefined;
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
    resumeCache = { opencode: null, claude: null, history: null };
    await renderResumeList();
  });
  $('#resume-search').addEventListener('input', () => renderResumeList(true));

  window.aisess.onData(({ id, data }) => {
    const t = tabs.get(id);
    if (t) t.term.write(data);
  });
  window.aisess.onExit(({ id, exitCode }) => {
    const t = tabs.get(id);
    if (t) {
      t.alive = false;
      t.term.write(`\r\n\x1b[90m[processo terminato con codice ${exitCode}] — puoi chiudere la scheda ✕\x1b[0m\r\n`);
      renderSidebar();
    }
  });

  window.addEventListener('resize', () => fitActive());
  renderSidebar();
  updateEmpty();
  ensureClaudeAccounts();
}

function openNewModal(type) {
  if (type) pendingNewType = type;
  $$('.type-card').forEach(x => x.classList.toggle('selected', x.dataset.type === pendingNewType));
  updateClaudeAccountRow();
  $('#modal-new').hidden = false;
}

async function openResumeModal() {
  $('#modal-resume').hidden = false;
  await updateResumeAccountRow();
  await renderResumeList();
}

/* ---------- Account Claude multipli ---------- */
let claudeAccounts = { oauth: { available: false, label: '' }, accounts: [] };

async function ensureClaudeAccounts(force) {
  if (!force && ensureClaudeAccounts._done) return claudeAccounts;
  try {
    claudeAccounts = await window.aisess.listClaudeAccounts();
    ensureClaudeAccounts._done = true;
  } catch (e) { console.warn('list-claude-accounts fallito', e); }
  return claudeAccounts;
}

function claudeAccountOptions() {
  const opts = [];
  if (claudeAccounts.oauth && claudeAccounts.oauth.available)
    opts.push({ value: 'oauth', label: 'OAuth — ' + (claudeAccounts.oauth.label || 'login corrente') });
  for (const a of (claudeAccounts.accounts || []))
    opts.push({ value: a.id, label: a.name + ' (API key)' });
  if (!opts.length) opts.push({ value: 'oauth', label: 'Default (ambiente corrente)' });
  return opts;
}

function claudeAccountLabel(id) {
  if (!id || id === 'oauth') {
    if (claudeAccounts.oauth && claudeAccounts.oauth.available) return 'OAuth';
    return null;
  }
  const a = (claudeAccounts.accounts || []).find(x => x.id === id);
  return a ? a.name : null;
}

function fillAccountSelect(sel) {
  if (!sel) return;
  let last = null;
  try { last = localStorage.getItem('aisess.claudeAccount'); } catch {}
  sel.innerHTML = '';
  for (const o of claudeAccountOptions()) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (last && [...sel.options].some(o => o.value === last)) sel.value = last;
}

// Mostra il selettore solo se ci sono davvero più account tra cui scegliere
async function updateClaudeAccountRow() {
  const row = $('#claude-account-row');
  if (!row) return;
  if (pendingNewType !== 'claude') { row.hidden = true; return; }
  await ensureClaudeAccounts();
  const multi = claudeAccountOptions().length > 1;
  row.hidden = !multi;
  if (multi) fillAccountSelect($('#new-claude-account'));
}

async function updateResumeAccountRow() {
  const row = $('#resume-account-row');
  if (!row) return;
  if (resumeTab !== 'claude') { row.hidden = true; return; }
  await ensureClaudeAccounts();
  const multi = claudeAccountOptions().length > 1;
  row.hidden = !multi;
  if (multi) fillAccountSelect($('#resume-claude-account'));
}

function selectedResumeAccount() {
  const row = $('#resume-account-row');
  if (!row || row.hidden) return null;
  const v = ($('#resume-claude-account') || {}).value || null;
  if (v) { try { localStorage.setItem('aisess.claudeAccount', v); } catch {} }
  return v;
}

function renderAccountManager(error) {
  const box = $('#account-list');
  if (!box) return;
  box.innerHTML = '';
  if (error) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = '⚠ ' + error;
    box.appendChild(p);
  }
  const oauthRow = document.createElement('div');
  oauthRow.className = 'account-row';
  oauthRow.innerHTML = `<span class="meta">OAuth — ${(claudeAccounts.oauth && claudeAccounts.oauth.label) || 'login corrente'}</span>`;
  const src = document.createElement('span');
  src.className = 'src';
  src.textContent = (claudeAccounts.oauth && claudeAccounts.oauth.available) ? 'rilevato' : 'non rilevato';
  oauthRow.appendChild(src);
  box.appendChild(oauthRow);
  for (const a of (claudeAccounts.accounts || [])) {
    const el = document.createElement('div');
    el.className = 'account-row';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = a.name;
    const s = document.createElement('span');
    s.className = 'src';
    s.textContent = 'API key';
    const del = document.createElement('button');
    del.className = 'btn btn--ghost';
    del.textContent = 'Elimina';
    del.onclick = async () => {
      await window.aisess.deleteClaudeAccount(a.id);
      await ensureClaudeAccounts(true);
      fillAccountSelect($('#new-claude-account'));
      fillAccountSelect($('#resume-claude-account'));
      renderAccountManager();
      updateClaudeAccountRow();
    };
    el.appendChild(meta);
    el.appendChild(s);
    el.appendChild(del);
    box.appendChild(el);
  }
  if (!(claudeAccounts.accounts || []).length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Nessun account API key salvato. Aggiungine uno qui sotto per poter scegliere.';
    box.appendChild(p);
  }
}

async function ensureResumeData(tab) {
  if (resumeCache[tab]) return resumeCache[tab];
  if (tab === 'opencode') {
    const r = await window.aisess.listOpencode(100);
    resumeCache.opencode = r;
  } else if (tab === 'claude') {
    const r = await window.aisess.listClaude(100);
    resumeCache.claude = r;
  } else {
    const h = await window.aisess.getHistory();
    resumeCache.history = { ok: true, sessions: h };
  }
  return resumeCache[tab];
}

async function renderResumeList(keepCache = false) {
  const box = $('#resume-list');
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
  for (const s of items.slice(0, 80)) {
    const el = document.createElement('div');
    el.className = 'resume-item';
    if (resumeTab === 'opencode') {
      const date = new Date(s.created).toLocaleString();
      el.innerHTML = `<div class="meta"><div class="title">⚡ ${escapeHtml(s.title || s.id)}</div>
        <div class="sub path"><span>${escapeHtml(s.directory || '')} · ${escapeHtml(s.id)} · ${date}</span></div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn btn--primary'; btn.style.width = 'auto'; btn.textContent = 'Resume';
      btn.onclick = async () => {
        $('#modal-resume').hidden = true;
        await createTab('opencode', { name: (s.title || 'opencode').slice(0, 28), cwd: s.directory, resumeId: s.id });
      };
      el.appendChild(btn);
    } else if (resumeTab === 'claude') {
      const date = new Date(s.mtime).toLocaleString();
      el.innerHTML = `<div class="meta"><div class="title">🤖 ${escapeHtml(s.title || s.id)}</div>
        <div class="sub path"><span>${escapeHtml(s.cwd || '')} · ${escapeHtml(s.id.slice(0, 8))} · ${date}</span></div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn btn--primary'; btn.style.width = 'auto'; btn.textContent = 'Resume';
      btn.onclick = async () => {
        $('#modal-resume').hidden = true;
        await createTab('claude', { name: (s.title || 'claude').slice(0, 28), cwd: s.cwd, resumeId: s.id, claudeAccountId: selectedResumeAccount() });
      };
      el.appendChild(btn);
    } else {
      el.innerHTML = `<div class="meta"><div class="title">${ICONS[s.type] || '•'} ${escapeHtml(s.cmd || s.type)}</div>
        <div class="sub path"><span>${escapeHtml(s.cwd || '')} · ${escapeHtml(s.lastOpened || '')}</span></div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn btn--secondary'; btn.style.width = 'auto'; btn.textContent = 'Riapri';
      btn.onclick = async () => {
        $('#modal-resume').hidden = true;
        const t = s.type === 'claude' || s.type === 'opencode' ? s.type : 'shell';
        await createTab(t, { cwd: s.cwd, resumeId: s.resumeId, claudeAccountId: t === 'claude' ? (s.claudeAccountId || null) : null });
      };
      el.appendChild(btn);
    }
    box.appendChild(el);
  }
}

async function createTab(type, { name, cwd, resumeId, claudeAccountId } = {}) {
  const id = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const label = name || `${type} · ${counter++}`;
  if (type === 'claude') await ensureClaudeAccounts();
  const claudeAccountName = type === 'claude' ? claudeAccountLabel(claudeAccountId) : null;

  const wrap = document.createElement('div');
  wrap.className = 'term-wrap';
  wrap.id = 'wrap-' + id;
  const inner = document.createElement('div');
  inner.style.width = '100%'; inner.style.height = '100%';
  wrap.appendChild(inner);
  $('#terminals').appendChild(wrap);

  // Registra e rendi visibile PRIMA di aprire il terminale: xterm misura il
  // contenitore all'apertura, quindi il wrap deve essere già laid out a
  // dimensione piena (altrimenti la prima scheda nasce 20x10).
  const tab = { id, type, name: label, cwd, resumeId, claudeAccountId, claudeAccountName, term: null, fit: null, ro: null, wrap, alive: true };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id);

  const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace", theme: { background: '#000000', foreground: '#F2EFF4', cursor: '#1FA79A', selectionBackground: '#0E2E2B', black: '#000000', brightBlack: '#7C7488', white: '#F2EFF4', brightWhite: '#FFFFFF', cyan: '#5FD8CB', brightCyan: '#31C3B4', green: '#5BC78F', red: '#E8556E', yellow: '#FF8A6B' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
  term.open(inner);
  tab.term = term;
  tab.fit = fit;

  term.onData((d) => window.aisess.write(id, d));

  // Dimensioni iniziali misurate sul contenitore reale già visibile
  let cols = 80, rows = 24;
  try {
    const dims = fit.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) { cols = dims.cols; rows = dims.rows; }
  } catch {}
  const res = await window.aisess.spawn({ id, type, cwd, resumeId, claudeAccountId, cols, rows });
  if (!res.ok) {
    const msg = String(res.error || 'errore sconosciuto').replace(/\n/g, '\r\n');
    term.write(`\x1b[31mErrore avvio [${type}]: ${msg}\x1b[0m\r\n`);
    term.write(`\x1b[90mSuggerimento: apri un Terminale e verifica con: which ${type === 'shell' ? 'bash' : type} && ${type === 'shell' ? 'echo ok' : type + ' --version'}\x1b[0m\r\n`);
    tab.alive = false;
  } else {
    // Fit definitivo a layout assestato (doppio rAF)
    requestAnimationFrame(() => requestAnimationFrame(() => refitTab(id)));
  }

  // Refit automatico ai cambi di dimensione del contenitore (drag sidebar, resize finestra)
  try {
    let t = null;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => refitTab(id), 50); });
    ro.observe(inner);
    tab.ro = ro;
  } catch {}
  term.focus();
  renderSidebar();
}

function setActive(id) {
  activeId = id;
  tabs.forEach((t) => t.wrap.classList.toggle('active', t.id === id));
  renderSidebar();
  setTimeout(() => fitActive(), 30);
}

function refitTab(id) {
  const t = tabs.get(id);
  if (!t || !t.fit || !t.term) return;
  // Le schede nascoste hanno dimensione 0: fittare qui le rovinerebbe
  if (!t.wrap.classList.contains('active')) return;
  try { t.fit.fit(); window.aisess.resize(t.id, t.term.cols, t.term.rows); } catch {}
}

function fitActive() {
  if (activeId) refitTab(activeId);
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  await window.aisess.kill(id);
  try { if (t.ro) t.ro.disconnect(); } catch {}
  try { if (t.term) t.term.dispose(); } catch {}
  t.wrap.remove();
  tabs.delete(id);
  if (activeId === id) {
    const rest = [...tabs.keys()];
    activeId = rest.length ? rest[rest.length - 1] : null;
    if (activeId) tabs.get(activeId).wrap.classList.add('active');
  }
  updateEmpty();
  if (tabs.size) fitActive();
  renderSidebar();
}

/* ---------- Raggruppamento card per tipo (gruppi collassabili) ---------- */
const GROUP_ORDER = ['shell', 'opencode', 'claude'];
const GROUP_LABELS = { shell: 'Terminale', opencode: 'OpenCode', claude: 'Claude' };
let collapsedGroups = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('aisess.collapsedGroups') || '[]');
  if (Array.isArray(saved)) collapsedGroups = new Set(saved.filter(t => GROUP_ORDER.includes(t)));
} catch {}
function saveCollapsedGroups() {
  try { localStorage.setItem('aisess.collapsedGroups', JSON.stringify([...collapsedGroups])); } catch {}
}

/* Mostra solo parent + current (es. "progetto/backend" invece del full path) */
function shortPath(cwd) {
  if (!cwd) return '';
  const parts = String(cwd).split('/').filter(Boolean);
  if (!parts.length) return '/';
  return parts.slice(-2).join('/');
}

function createSessionItem(t) {
  const b = document.createElement('button');
  b.className = 'session-item' + (t.id === activeId ? ' active' : '');
  const fullSub = t.claudeAccountName ? `${t.cwd || ''} · ${t.claudeAccountName}` : (t.cwd || '');
  const displaySub = t.claudeAccountName ? `${shortPath(t.cwd)} · ${t.claudeAccountName}` : shortPath(t.cwd);
  b.innerHTML = `<span class="icon">${ICONS[t.type]}</span>
    ${t.alive ? '<span class="live-dot" title="In esecuzione"></span>' : ''}
    <span class="meta"><span class="name">${escapeHtml(t.name)}${t.alive ? '' : ' (terminata)'}</span><br>
    <span class="sub path" title="${escapeHtml(fullSub)}"><span>${escapeHtml(displaySub)}</span></span></span>`;
  b.onclick = () => setActive(t.id);
  const x = document.createElement('span');
  x.className = 'close-x'; x.textContent = '✕'; x.title = 'Chiudi';
  x.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
  b.appendChild(x);
  return b;
}

function renderSidebar() {
  const list = $('#session-list');
  list.innerHTML = '';
  $('#count').textContent = tabs.size ? `(${tabs.size})` : '';
  if (!tabs.size) {
    list.innerHTML = '<p class="muted" style="font-size:12px">Nessuna sessione aperta.<br>Avviane una con ＋ Nuova sessione.</p>';
    return;
  }
  // Se la scheda attiva è in un gruppo collassato, espandilo
  const active = activeId && tabs.get(activeId);
  if (active && collapsedGroups.has(active.type)) {
    collapsedGroups.delete(active.type);
    saveCollapsedGroups();
  }
  const byType = new Map(GROUP_ORDER.map(t => [t, []]));
  tabs.forEach((t) => {
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(t);
  });
  for (const type of byType.keys()) {
    const items = byType.get(type);
    if (!items.length) continue;
    // Una sola sessione di questo tipo: card singola, senza gruppo
    if (items.length === 1) {
      list.appendChild(createSessionItem(items[0]));
      continue;
    }
    // Più sessioni dello stesso tipo: gruppo espandibile/collassabile
    const collapsed = collapsedGroups.has(type);
    const group = document.createElement('div');
    group.className = 'session-group';
    const header = document.createElement('button');
    header.className = 'group-header';
    header.setAttribute('aria-expanded', String(!collapsed));
    header.innerHTML = `<span class="chevron">${collapsed ? '▸' : '▾'}</span>
      <span class="icon">${ICONS[type] || '•'}</span>
      <span class="group-name">${escapeHtml(GROUP_LABELS[type] || type)}</span>
      <span class="group-count">${items.length}</span>`;
    header.onclick = () => {
      if (collapsedGroups.has(type)) collapsedGroups.delete(type);
      else collapsedGroups.add(type);
      saveCollapsedGroups();
      renderSidebar();
    };
    group.appendChild(header);
    const body = document.createElement('div');
    body.className = 'group-body';
    if (collapsed) body.hidden = true;
    for (const t of items) body.appendChild(createSessionItem(t));
    group.appendChild(body);
    list.appendChild(group);
  }
}

function updateEmpty() {
  const el = $('#empty');
  if (el) el.style.display = tabs.size ? 'none' : 'block';
}

/* Menubar scura in-app: su macOS il menu nativo segue già il tema scuro,
   quindi questa barra viene rimossa; altrove sostituisce la menubar nativa
   (nascosta nel main process perché il tema di sistema la disegna chiara). */
function initMenubar(platform) {
  const bar = document.querySelector('#menubar');
  if (!bar) return;
  if (platform === 'darwin') { bar.remove(); return; }
  const menus = [...bar.querySelectorAll('.mb-menu')];
  const closeAll = () => menus.forEach((m) => {
    m.classList.remove('open');
    const drop = m.querySelector('.mb-drop');
    if (drop) drop.hidden = true;
  });
  menus.forEach((m) => {
    const label = m.querySelector('.mb-label');
    label.addEventListener('click', () => {
      const wasOpen = m.classList.contains('open');
      closeAll();
      if (!wasOpen) {
        m.classList.add('open');
        m.querySelector('.mb-drop').hidden = false;
      }
    });
    m.addEventListener('mouseenter', () => {
      if (menus.some((x) => x.classList.contains('open'))) {
        closeAll();
        m.classList.add('open');
        m.querySelector('.mb-drop').hidden = false;
      }
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menubar')) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  bar.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
    closeAll();
    try { await window.aisess.menuAction(b.dataset.action); } catch {}
  }));
}

/* Sidebar ridimensionabile via drag, larghezza persistita in localStorage */
function initSidebarResize() {
  const sidebar = $('#sidebar');
  const resizer = $('#sidebar-resizer');
  if (!sidebar || !resizer) return;
  const DEFAULT_W = 264, MIN_W = 180, MAX_W = 480;
  try {
    const saved = parseInt(localStorage.getItem('aisess.sidebarW'), 10);
    if (saved >= MIN_W && saved <= MAX_W) sidebar.style.width = saved + 'px';
  } catch {}
  resizer.addEventListener('dblclick', () => {
    sidebar.style.width = DEFAULT_W + 'px';
    try { localStorage.setItem('aisess.sidebarW', String(DEFAULT_W)); } catch {}
    fitActive();
  });
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('dragging');
    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;
    const onMove = (ev) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('aisess.sidebarW', String(Math.round(sidebar.getBoundingClientRect().width))); } catch {}
      fitActive();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', init);

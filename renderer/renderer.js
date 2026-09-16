/* AISessionManager renderer */
const tabs = new Map();
let activeId = null;
/* Con tmux le sessioni sopravvivono alla chiusura: la ✕ stacca, «Termina» uccide. */
let tmuxAvailable = false;
let counter = 1;
let pendingNewType = 'shell';
let resumeTab = 'opencode';
let resumeCache = { opencode: null, claude: null, codex: null, history: null };
const emptyResumeCache = () => ({ opencode: null, claude: null, codex: null, history: null });

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Marchi ufficiali degli agenti (renderer/agent-icons.js)
const Icons = window.AisessIcons;
const Groups = window.AisessGroups;
const Order = window.AisessOrder;
const Sidebar = window.AisessSidebar;
const Titles = window.AisessTitles;
const PromptCapture = window.AisessPromptCapture;
/* I nomi rinominati a mano sopravvivono alla chiusura dell'app: stanno in
   localStorage, non nello stato in memoria delle schede. */
const titleStore = Titles.createTitleStore(window.localStorage);
// Tipi con un binario esterno da risolvere (lo shell è sempre disponibile)
const AI_TYPES = ['opencode', 'claude', 'codex', 'antigravity'];

// Corpo del testo dei terminali (shell, opencode, claude)
const TERM_FONT_SIZE = 15;
const TERM_LINE_HEIGHT = 1.2;

async function init() {
  Icons.hydrate(document);
  const d = await window.aisess.getDefaults();
  tmuxAvailable = Boolean(d.tmux && d.tmux.available);
  $('#platform-label').textContent = d.platform + ' · ' + d.shell;
  $('#new-cwd').value = d.homedir;
  try {
    const deps = await window.aisess.checkDeps();
    const fmt = (b, name) => b && b.found ? `✔ ${name}: ${b.path}` : `✘ ${name} non trovato`;
    $('#deps-status').textContent = AI_TYPES.map(n => `${deps[n] && deps[n].found ? '✔' : '✘'} ${n}`).join(' · ');
    $('#deps-status').title = AI_TYPES.map(n => fmt(deps[n], n)).join('\n') + '\nPATH: ' + deps.path;
    const mark = (id, b) => {
      const el = $(id);
      if (!el) return;
      el.style.opacity = b && b.found ? '1' : '0.45';
      el.title = b && b.found ? b.path + ' (' + (b.via || '') + ')' : 'NON TROVATO nel PATH:\n' + (b && b.searchedPath);
    };
    for (const n of AI_TYPES) mark('#dep-' + n, deps[n]);
    if (AI_TYPES.some(n => !deps[n] || !deps[n].found)) {
      console.warn('[AISessionManager] binari mancanti:', deps);
    }
  } catch (e) { console.warn('check-deps fallito', e); }

  $('#btn-new').addEventListener('click', () => openNewModal());
  $('#btn-resume').addEventListener('click', openResumeModal);

  // Voci del menu File (native e della menubar in-app)
  try {
    window.aisess.onMenu('menu-new-session', () => openNewModal());
    window.aisess.onMenu('menu-open-config', () => window.AisessCommands.openConfig());
    window.aisess.onMenuEdit((action) => runEditAction(action));
  } catch {}

  // Comandi di avvio configurabili (renderer/command-config.js)
  window.AisessCommands.initConfigUI();
  window.AisessCommands.load().catch((e) => console.warn('get-command-profiles fallito', e));
  window.onCommandProfilesChanged = () => renderSidebar();

  initSidebarResize();
  $('#group-mode-type').addEventListener('click', () => { if (sidebar.setMode('type')) renderSidebar(); });
  $('#group-mode-project').addEventListener('click', () => { if (sidebar.setMode('project')) renderSidebar(); });
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
    if (p) {
      $('#new-cwd').value = p;
      markSelectedRecentDir();
    }
  });
  $('#new-cwd').addEventListener('input', () => markSelectedRecentDir());
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
    resumeCache = emptyResumeCache();
    await renderResumeList();
  });
  $('#resume-search').addEventListener('input', () => renderResumeList(true));

  window.aisess.onData(({ id, data }) => {
    const t = tabs.get(id);
    if (!t) return;
    t.term.write(data);
    noteActivity(t, data ? data.length : 0);
  });
  window.aisess.onExit(({ id, exitCode }) => {
    const t = tabs.get(id);
    if (t) {
      t.alive = false;
      clearAttention(id);
      t.term.write(`\r\n\x1b[90m[processo terminato con codice ${exitCode}] — puoi chiudere la scheda ✕\x1b[0m\r\n`);
      renderSidebar();
    }
  });

  window.addEventListener('resize', () => fitActive());
  renderSidebar();
  updateEmpty();
  ensureClaudeAccounts();
  await reattachLiveSessions();
  await offerRestore();
}

function openNewModal(type) {
  if (type) pendingNewType = type;
  $$('.type-card').forEach(x => x.classList.toggle('selected', x.dataset.type === pendingNewType));
  updateClaudeAccountRow();
  $('#modal-new').hidden = false;
  renderRecentDirs();
}

/* ---------- Directory di lavoro recenti ---------- */
const RECENT_DIRS_LIMIT = 8;

async function renderRecentDirs() {
  const row = $('#recent-dirs-row');
  const box = $('#recent-dirs');
  if (!row || !box) return;
  let dirs = [];
  try {
    dirs = await window.aisess.getRecentDirs(RECENT_DIRS_LIMIT);
  } catch (e) {
    console.warn('get-recent-dirs fallito', e);
  }
  if (!Array.isArray(dirs) || dirs.length === 0) {
    row.hidden = true;
    box.replaceChildren();
    return;
  }
  const chips = dirs.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dir-chip';
    b.dataset.path = d.path;
    b.title = d.lastOpened ? `${d.path}\nUltimo uso: ${fmtDate(d.lastOpened)}` : d.path;
    const icon = document.createElement('span');
    icon.className = 'dir-chip-type';
    if (Icons.has(d.type)) icon.innerHTML = Icons.markup(d.type);
    else icon.textContent = '📁';
    const label = document.createElement('span');
    label.className = 'dir-chip-path';
    label.textContent = Groups.shortPath(d.path);
    b.append(icon, label);
    b.addEventListener('click', () => {
      $('#new-cwd').value = d.path;
      markSelectedRecentDir();
    });
    return b;
  });
  box.replaceChildren(...chips);
  row.hidden = false;
  markSelectedRecentDir();
}

function markSelectedRecentDir() {
  const current = ($('#new-cwd').value || '').trim().replace(/(.)\/+$/, '$1');
  $$('#recent-dirs .dir-chip').forEach(c => c.classList.toggle('selected', c.dataset.path === current));
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
  oauthRow.innerHTML = `<span class="meta">OAuth — ${escapeHtml((claudeAccounts.oauth && claudeAccounts.oauth.label) || 'login corrente')}</span>`;
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
  for (const s of items.slice(0, 80)) box.appendChild(createResumeItem(resumeTab, s));
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
  el.appendChild(btn);
  return el;
}

/* Comando da usare per la sessione: se il tipo ha più comandi configurati la
   scelta viene chiesta all'utente (o riusata dalla cronologia, se ancora esiste). */
async function resolveCommandProfile(type, { commandProfileId, cwd, resumeId } = {}) {
  const ui = window.AisessCommands;
  if (!ui) return { ok: true, id: commandProfileId || null, label: null };
  await ui.load();
  if (commandProfileId) {
    const known = ui.labelFor(type, commandProfileId);
    if (known) {
      ui.rememberUsed(type, commandProfileId);
      return { ok: true, id: commandProfileId, label: known };
    }
    // Comando eliminato dalla configurazione: si torna a chiedere
  }
  return ui.choose(type, { cwd, resumeId });
}

/* ---------- Nomi delle sessioni ----------
   Automatici dal titolo che il CLI dà alla conversazione, finché l'utente non
   ne sceglie uno suo: da lì in poi vince il suo e l'automatico non lo tocca. */
const AUTO_TITLE_MS = 20000;
let autoTitleTimer = null;

function listSessionsFor(type) {
  if (type === 'opencode') return window.aisess.listOpencode(100);
  if (type === 'claude') return window.aisess.listClaude(100);
  if (type === 'codex') return window.aisess.listCodex(100);
  if (type === 'antigravity') return window.aisess.listAntigravity(100);
  return null; // lo shell non ha conversazioni
}

function applyTitle(tab, title) {
  const next = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!next || next === tab.name) return false;
  tab.name = next;
  syncLabel(tab);
  return true;
}

/** Il nome della scheda si salva sulla sessione tmux: al riattacco torna. */
function syncLabel(tab) {
  if (tab && tab.session && tab.alive) window.aisess.setLabel(tab.id, tab.name);
}

/**
 * Nome dal primo prompt digitato. Vale per ogni tipo di sessione, anche per
 * quelli di cui non sappiamo leggere le conversazioni, e arriva subito: non
 * serve aspettare che il CLI scriva il suo file.
 */
function applyTypedPrompt(tab, data) {
  if (!tab.promptCapture) return;
  let line = null;
  try { line = tab.promptCapture.feed(data); } catch { return; }
  if (!line) return;
  tab.promptCapture = null;
  if (!tab.autoNamed) return; // l'utente ha già scelto un nome suo
  // Il titolo del CLI non deve più scavalcare il prompt scritto dall'utente
  tab.namedFromPrompt = true;
  if (tab.resumeId) titleStore.setName(tab.type, tab.resumeId, line);
  if (applyTitle(tab, line)) renderSidebar();
}

/** Aggiorna nome e id conversazione delle schede che non sono state rinominate. */
async function refreshAutoTitles() {
  const targets = [...tabs.values()].filter((t) => t.autoNamed && t.type !== 'shell');
  if (!targets.length) return;
  const byType = new Map();
  for (const t of targets) if (!byType.has(t.type)) byType.set(t.type, listSessionsFor(t.type));
  let changed = false;
  for (const [type, promise] of byType) {
    let data = null;
    try { data = await promise; } catch { continue; }
    if (!data || !data.ok) continue;
    for (const t of targets.filter((x) => x.type === type)) {
      // Con un resume l'id è noto; per una scheda nuova va riconosciuto
      const s = t.resumeId
        ? (data.sessions || []).find((x) => x.id === t.resumeId)
        : Titles.pickAutoSession(data.sessions, { cwd: t.cwd, since: t.startedAt - 5000 });
      if (!s) continue;
      if (!t.resumeId) {
        t.resumeId = s.id;
        // Appena l'id e' noto lo si salva sulla sessione tmux: e' cio' che rende
        // ripristinabile dopo un riavvio una scheda nata "nuova".
        if (t.session && t.alive) window.aisess.setMeta(t.id, { resumeId: s.id });
      }
      // Nome già preso dal prompt digitato: si lega alla conversazione appena
      // se ne conosce l'id, così sopravvive al resume. Il titolo del CLI perde.
      if (t.namedFromPrompt) {
        if (!titleStore.nameFor(t.type, t.resumeId)) titleStore.setName(t.type, t.resumeId, t.name);
        continue;
      }
      // Conversazione appena creata, senza ancora un prompt: il suo "titolo" è
      // solo l'id. Meglio tenere il nome provvisorio e riprovare al giro dopo.
      if (s.titled === false) continue;
      const custom = titleStore.nameFor(t.type, t.resumeId);
      if (custom) { t.autoNamed = false; changed = applyTitle(t, custom) || changed; continue; }
      changed = applyTitle(t, s.title) || changed;
    }
  }
  if (changed) renderSidebar();
}

function startAutoTitles() {
  if (autoTitleTimer) return;
  autoTitleTimer = setInterval(() => { refreshAutoTitles().catch(() => {}); }, AUTO_TITLE_MS);
}

/**
 * Chiede il nuovo nome con un modal interno: in Electron la prompt() del
 * browser lancia "prompt() is and will not be supported.".
 * @returns {Promise<string|null>} null se annullato
 */
function askSessionName(tab) {
  const backdrop = $('#modal-rename');
  const input = $('#rename-input');
  const confirmBtn = $('#rename-confirm');
  const cancelBtn = $('#rename-cancel');
  if (!backdrop || !input || !confirmBtn || !cancelBtn) return Promise.resolve(null);

  const sub = $('#rename-sub');
  if (sub) sub.textContent = [Groups.TYPE_LABELS[tab.type] || tab.type, Groups.shortPath(tab.cwd)].filter(Boolean).join(' · ');
  input.value = tab.name || '';
  backdrop.hidden = false;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      backdrop.hidden = true;
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && e.target === input) finish(input.value);
    };
    const onBackdrop = (e) => { if (e.target === backdrop) finish(null); };
    const onConfirm = () => finish(input.value);
    const onCancel = () => finish(null);
    const cleanup = () => {
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('click', onBackdrop);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', onBackdrop);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/** Rinomina manuale: il nome resta legato alla conversazione, non alla scheda. */
async function renameTab(tab) {
  const current = await askSessionName(tab);
  if (current === null) return; // annullato
  const clean = String(current).replace(/\s+/g, ' ').trim();
  if (tab.resumeId) titleStore.setName(tab.type, tab.resumeId, clean);
  if (clean) { tab.name = clean.slice(0, 40); tab.autoNamed = false; syncLabel(tab); }
  else { tab.autoNamed = true; }
  renderSidebar();
  if (!clean) refreshAutoTitles().catch(() => {});
}

/* ---------- Radice di progetto delle schede ----------
   La risalita la fa il main (il renderer non vede il filesystem). Il risultato
   si mette in cache per directory: aprire dieci sessioni nello stesso repo non
   deve costare dieci risalite. In caso di errore vale la cwd, così la scheda
   ha comunque un gruppo. */
const projectRootCache = new Map();

async function resolveProjectRoot(cwd) {
  if (!cwd) return null;
  if (projectRootCache.has(cwd)) return projectRootCache.get(cwd);
  let root = cwd;
  try {
    const r = await window.aisess.resolveProject(cwd);
    if (r && r.ok && typeof r.root === 'string' && r.root) root = r.root;
    else if (r && !r.ok) console.warn('resolve-project fallito:', r.error);
  } catch (e) {
    console.warn('resolve-project non raggiungibile', e);
  }
  projectRootCache.set(cwd, root);
  return root;
}

async function createTab(type, { name, cwd, resumeId, claudeAccountId, commandProfileId, attachSession = null, commandProfileLabel = null } = {}) {
  // attachSession: riaggancio di una sessione tmux gia' viva. Il comando e' gia'
  // stato risolto quando e' nata, quindi niente scelta del profilo.
  const picked = attachSession
    ? { ok: true, id: commandProfileId || null, label: commandProfileLabel || null }
    : await resolveCommandProfile(type, { commandProfileId, cwd, resumeId });
  if (!picked.ok) return; // scelta annullata: nessuna scheda creata
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
  const tab = { id, type, name: label, cwd, projectRoot: cwd || null, resumeId, startedAt: Date.now(), autoNamed: !name,
    session: attachSession, reattached: Boolean(attachSession),
    promptCapture: PromptCapture.createPromptCapture(), namedFromPrompt: false, claudeAccountId, claudeAccountName, commandProfileId: picked.id, commandProfileLabel: picked.label, term: null, fit: null, ro: null, wrap, alive: true, needsAttention: false, idleTimer: null, pendingBytes: 0 };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id);

  const term = new Terminal({ cursorBlink: true, fontSize: TERM_FONT_SIZE, lineHeight: TERM_LINE_HEIGHT, fontFamily: "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace", theme: { background: '#000000', foreground: '#EFF2F6', cursor: '#1FA79A', selectionBackground: '#0E2E2B', black: '#000000', brightBlack: '#74808F', white: '#EFF2F6', brightWhite: '#FFFFFF', cyan: '#5FD8CB', brightCyan: '#31C3B4', green: '#5BC78F', red: '#E8556E', yellow: '#FF8A6B' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
  term.open(inner);
  tab.term = term;
  tab.fit = fit;

  term.onData((d) => {
    window.aisess.write(id, d);
    applyTypedPrompt(tab, d);
  });
  // Copia/incolla: la selezione di xterm non è una selezione del documento
  window.AisessClipboard.attach(term, inner);
  // Il bell è il "ho finito" esplicito degli agenti: vale senza attendere l'idle
  try { term.onBell(() => flagAttention(tab, { force: true })); } catch {}

  // Dimensioni iniziali misurate sul contenitore reale già visibile
  let cols = 80, rows = 24;
  try {
    const dims = fit.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) { cols = dims.cols; rows = dims.rows; }
  } catch {}
  const res = attachSession
    ? await window.aisess.attach({ id, session: attachSession, cols, rows })
    : await window.aisess.spawn({ id, type, cwd, resumeId, claudeAccountId, commandProfileId: picked.id, label, cols, rows });
  if (!res.ok && res.gone) {
    // La sessione tmux non c'e' piu' (riavvio della macchina, terminata altrove):
    // caso normale, non un errore. Si offre la strada per ricrearla.
    term.write('\x1b[90mQuesta sessione non è più attiva sulla macchina.\x1b[0m\r\n');
    if (resumeId) term.write('\x1b[90mPuoi riprenderla dal dialog ⟲ Resume: la conversazione è salvata dal CLI.\x1b[0m\r\n');
    else term.write('\x1b[90mAvviane una nuova con ＋ Nuova sessione.\x1b[0m\r\n');
    tab.alive = false;
  } else if (!res.ok) {
    const msg = String(res.error || 'errore sconosciuto').replace(/\n/g, '\r\n');
    term.write(`\x1b[31mErrore avvio [${type}]: ${msg}\x1b[0m\r\n`);
    term.write(`\x1b[90mSuggerimento: apri un Terminale e verifica con: which ${type === 'shell' ? 'bash' : type} && ${type === 'shell' ? 'echo ok' : type + ' --version'}\x1b[0m\r\n`);
    tab.alive = false;
  } else {
    if (res.session) tab.session = res.session;
    // Il main può spostare la sessione (cwd vuota, con ~ o inesistente finisce
    // nella home): senza la directory vera il titolo automatico non troverebbe
    // mai la conversazione, che viene riconosciuta proprio dalla directory.
    if (res.cwd) tab.cwd = res.cwd;
    // La radice si risolve sulla directory davvero usata dal pty, non su quella
    // digitata: con cwd vuota o inesistente il main sposta la sessione altrove.
    resolveProjectRoot(tab.cwd).then((root) => {
      if (!tabs.has(id) || root === tab.projectRoot) return;
      tab.projectRoot = root;
      renderSidebar();
    }).catch(() => {});
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
  startAutoTitles();
  // Primo giro ravvicinato: il CLI scrive la conversazione poco dopo l'avvio
  setTimeout(() => { refreshAutoTitles().catch(() => {}); }, 4000);
}

/* ---------- Menu Edit: terminale o resto della pagina ----------
   Con il fuoco (o una selezione) sul terminale attivo copia/incolla passano da
   xterm; altrove restano le azioni native, che funzionano su input e testo. */
const EDIT_ACTIONS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

function runEditAction(action) {
  if (!EDIT_ACTIONS.includes(action)) return false;
  const t = activeId ? tabs.get(activeId) : null;
  const onTerminal = !!t && !!t.term && (t.wrap.contains(document.activeElement) || t.term.hasSelection());
  if (onTerminal && window.AisessClipboard.applyEditAction(t.term, action)) return true;
  window.aisess.menuAction(action).catch((e) => console.warn('azione edit fallita', e));
  return true;
}

function setActive(id) {
  activeId = id;
  tabs.forEach((t) => t.wrap.classList.toggle('active', t.id === id));
  // Selezionare la sessione è la conferma che l'utente ha visto il lavoro finito
  clearAttention(id);
  // Selezionare una scheda espande il suo gruppo, così la card resta visibile.
  // Va fatto SOLO qui e non in renderSidebar(), altrimenti il click sull'header
  // richiuderebbe e riaprirebbe subito il gruppo della scheda attiva.
  const t = tabs.get(id);
  if (t) sidebar.expandGroupOf(t);
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

/* ---------- "L'assistente ha finito": card che lampeggia ----------
   Un agente TUI scrive senza sosta mentre lavora: quando il flusso si ferma
   per ATTENTION_IDLE_MS su una scheda non in primo piano, il turno è finito e
   la card lampeggia finché l'utente non la seleziona. Il bell del terminale
   (\x07, emesso dagli agenti a fine turno) è un segnale esplicito e vale
   subito, senza attendere la soglia di byte. */
const ATTENTION_IDLE_MS = 1500;
const ATTENTION_MIN_BYTES = 40; // sotto questa soglia è solo ridisegno della TUI

function noteActivity(t, bytes) {
  if (t.type === 'shell') return;   // nessun assistente: niente da segnalare
  if (t.id === activeId) return;    // già sotto gli occhi dell'utente
  t.pendingBytes += bytes;
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => flagAttention(t), ATTENTION_IDLE_MS);
}

function flagAttention(t, { force = false } = {}) {
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  const bytes = t.pendingBytes;
  t.pendingBytes = 0;
  if (t.type === 'shell' || t.id === activeId || t.needsAttention) return;
  if (!force && bytes < ATTENTION_MIN_BYTES) return;
  t.needsAttention = true;
  renderSidebar();
}

/** Azzera la segnalazione di una scheda. @returns {boolean} true se lampeggiava */
function clearAttention(id) {
  const t = tabs.get(id);
  if (!t) return false;
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  t.pendingBytes = 0;
  if (!t.needsAttention) return false;
  t.needsAttention = false;
  return true;
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  await window.aisess.kill(id);
  clearAttention(id);
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

/** Termina davvero: uccide la sessione tmux e poi chiude la scheda. */
async function terminateTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  if (t.session && t.alive && !confirm(`Terminare «${t.name}»?\nIl processo verrà chiuso: non sarà più possibile riattaccarsi.`)) return;
  await window.aisess.terminate(id);
  await closeTab(id);
}

/**
 * All'avvio: le sessioni tmux vive dell'app tornano come schede, riattaccate.
 * E' il motivo per cui esiste il backend tmux (docs/plans/06-tmux-backend.md).
 */
async function reattachLiveSessions() {
  if (!tmuxAvailable) return;
  let live = [];
  try { live = await window.aisess.listLive(); } catch (e) { console.warn('list-live-sessions fallito', e); return; }
  for (const s of live) {
    if (s.attachedHere) continue;
    await createTab(s.type || 'shell', {
      name: s.label || null,
      cwd: s.cwd || undefined,
      resumeId: s.resumeId || null,
      claudeAccountId: s.accountId || null,
      commandProfileId: s.profileId || null,
      commandProfileLabel: s.profileLabel || null,
      attachSession: s.name,
    });
  }
}

/**
 * Dopo un riavvio della macchina tmux e' vuoto ma il registro no: si propone
 * di ricreare quelle sessioni. Con l'id della conversazione si riprende
 * (`--resume`); senza, si riparte pulita nella stessa directory. Si chiede,
 * non si fa da soli: N processi che partono senza permesso sono invadenti.
 */
async function offerRestore() {
  if (!tmuxAvailable) return;
  let lost = [];
  try { lost = await window.aisess.restorable(); } catch (e) { console.warn('restorable-sessions fallito', e); return; }
  if (!lost.length) return;

  const backdrop = $('#modal-restore');
  const list = $('#restore-list');
  const sub = $('#restore-sub');
  if (!backdrop || !list) return;
  list.innerHTML = '';
  sub.textContent = lost.length === 1
    ? 'Una sessione era aperta quando il computer si è spento o l\'app è stata chiusa dal sistema.'
    : `${lost.length} sessioni erano aperte quando il computer si è spento o l'app è stata chiusa dal sistema.`;

  // Stessa card della sidebar (scatola, barra colorata del tipo, icona), con
  // una spunta a sinistra. Un div e non un <label>: nei modal i label sono in
  // colonna per i campi dei form e metterebbero la spunta sopra.
  const rows = lost.map((s) => {
    const plan = restorePlanFor(s);
    const type = s.type || 'shell';
    const row = document.createElement('div');
    row.className = `session-item type-${type} restore-row`;
    row.setAttribute('role', 'checkbox');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.className = 'restore-check';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = Icons.markup(type); // markup statico, nessun dato utente
    const meta = document.createElement('span');
    meta.className = 'meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.label || type;
    const sub = document.createElement('span');
    sub.className = 'sub';
    const how = plan.mode === 'resume' ? 'riprende la conversazione' : (type === 'shell' ? 'nuova shell' : 'ripartirà pulita, senza id');
    sub.textContent = [Groups.shortPath(s.cwd), how].filter(Boolean).join(' · ');
    sub.title = [s.cwd || '', how].filter(Boolean).join(' · ');
    meta.appendChild(name); meta.appendChild(sub);
    row.appendChild(cb); row.appendChild(icon); row.appendChild(meta);
    const sync = () => { row.setAttribute('aria-checked', String(cb.checked)); row.classList.toggle('is-off', !cb.checked); };
    row.onclick = (e) => { if (e.target !== cb) cb.checked = !cb.checked; sync(); };
    cb.onchange = sync;
    sync();
    list.appendChild(row);
    return { cb, plan };
  });

  await new Promise((resolve) => {
    const done = () => { backdrop.hidden = true; confirmBtn.onclick = null; dismissBtn.onclick = null; resolve(); };
    const confirmBtn = $('#restore-confirm');
    const dismissBtn = $('#restore-dismiss');
    confirmBtn.onclick = async () => {
      const chosen = rows.filter((r) => r.cb.checked).map((r) => r.plan);
      done();
      // Il registro si ricostruisce da solo con le nuove sessioni; quelle non scelte spariscono.
      await window.aisess.discardRestorable();
      for (const plan of chosen) {
        await createTab(plan.type, { name: plan.name, cwd: plan.cwd, resumeId: plan.resumeId, claudeAccountId: plan.claudeAccountId, commandProfileId: plan.commandProfileId });
      }
    };
    dismissBtn.onclick = async () => { done(); await window.aisess.discardRestorable(); };
    backdrop.hidden = false;
  });
}

/** Stessa logica di lib/live-sessions.js#restorePlan, lato renderer (che non puo' importarla). */
function restorePlanFor(s) {
  const type = s.type || 'shell';
  const base = { type, cwd: s.cwd || undefined, commandProfileId: s.profileId || null, claudeAccountId: s.accountId || null, name: s.label || null };
  if (type !== 'shell' && s.resumeId) return { ...base, resumeId: s.resumeId, mode: 'resume' };
  return { ...base, resumeId: null, mode: 'fresh' };
}

/* ---------- Sidebar delle sessioni aperte ----------
   Il modulo non conosce le schede: le riceve a ogni render e restituisce le
   azioni come callback. Qui restano `tabs` e `activeId`, che sono suoi — e
   `tmuxAvailable`, per cui è il renderer a dire quali card si possono staccare
   invece che terminare. */
const sidebar = Sidebar.createSidebar({
  list: $('#session-list'), count: $('#count'),
  storage: window.localStorage, Icons, Groups, Commands: window.AisessCommands, escapeHtml,
  modeButtons: { type: $('#group-mode-type'), project: $('#group-mode-project') },
  onSelect: (id) => setActive(id),
  onClose: (id) => { closeTab(id).catch(() => {}); },
  onRename: (t) => { renameTab(t).catch(() => {}); },
  canDetach: (t) => Boolean(tmuxAvailable && t.session && t.alive),
  onTerminate: (id) => { terminateTab(id).catch(() => {}); },
  onReorder: (movedId, targetId, opts) => {
    const next = Order.moveAdjacent(sessionOrder, movedId, targetId, opts);
    if (next === sessionOrder) return;
    sessionOrder = next;
    renderSidebar();
  },
});
/* Ordine manuale delle card, deciso trascinandole. Vive qui insieme a `tabs`
   perché è una proprietà delle schede aperte, non della sidebar: il modulo
   riceve già la lista ordinata. Le schede nuove entrano in coda. */
let sessionOrder = [];

const renderSidebar = () => {
  sessionOrder = Order.syncOrder(sessionOrder, [...tabs.keys()]);
  sidebar.render(Order.applyOrder([...tabs.values()], sessionOrder), activeId);
};

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
    // Le voci di Edit possono riguardare il terminale attivo: le smista runEditAction
    if (runEditAction(b.dataset.action)) return;
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

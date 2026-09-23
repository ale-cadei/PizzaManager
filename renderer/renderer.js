/* PizzaManager renderer */
const tabs = new Map();
let activeId = null;
/* Con tmux le sessioni sopravvivono alla chiusura: la ✕ stacca, «Termina» uccide. */
let tmuxAvailable = false;
let tmuxPath = null;
let counter = 1;
let pendingNewType = 'shell';
let resumeTab = 'opencode';
let resumeCache = { opencode: null, claude: null, codex: null, history: null };
const emptyResumeCache = () => ({ opencode: null, claude: null, codex: null, history: null });

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Marchi ufficiali degli agenti (renderer/agent-icons.js)
const Icons = window.AisessIcons;
// Logo dell'app: pizza con la fetta sollevata (renderer/pizza-logo.js)
const Logo = window.PizzaLogo;
const Groups = window.AisessGroups;
const Order = window.AisessOrder;
const Sidebar = window.AisessSidebar;
// Fumetto di conferma appoggiato a una card (renderer/confirm-bubble.js)
const ConfirmBubble = window.AisessConfirmBubble;
// Regola del lampeggio «l'assistente ha finito» (renderer/attention.js)
const Attention = window.AisessAttention;
// «Sta lavorando adesso»: barra del tipo animata (renderer/running.js)
const Running = window.AisessRunning;
const Titles = window.AisessTitles;
const PromptCapture = window.AisessPromptCapture;
/* I nomi rinominati a mano sopravvivono alla chiusura dell'app: stanno in
   localStorage, non nello stato in memoria delle schede. */
const titleStore = Titles.createTitleStore(window.localStorage);
// Tipi con un binario esterno da risolvere (lo shell è sempre disponibile)
const AI_TYPES = ['opencode', 'claude', 'codex', 'antigravity'];

// Corpo del testo dei terminali: una dimensione per tutte le schede, scelta
// dal menu Vista e ricordata (renderer/term-font.js)
const termFont = window.AisessTermFont.createFontSizeStore(window.localStorage);
const TERM_LINE_HEIGHT = 1.2;

/* Tema del terminale, allineato ai token (renderer/tokens.css): il fondo e il
   testo sono gli stessi dell'app, e i tre colori "di stato" della palette
   prendono il posto dei corrispondenti ANSI, così un ✔ verde del terminale è
   lo stesso verde del pallino "in esecuzione".
   Ciano e magenta restano quelli di default di xterm: la palette Forno non ha
   un colore freddo da prestargli, e reinventarlo caldo li renderebbe
   indistinguibili dal rosso. */
const TERM_THEME = {
  background: '#070505',        // --bg
  foreground: '#F6F1EC',        // --text
  cursor: '#F04E23',            // --action
  selectionBackground: '#2B120A', // --action-soft
  black: '#070505',
  brightBlack: '#8A7A72',       // --text-faint
  white: '#F6F1EC',
  brightWhite: '#FFFFFF',
  green: '#7FC45A',             // --state-ok
  red: '#FF4D74',               // --state-error
  yellow: '#F2C14E',            // --accent (crosta)
};

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
  $('#btn-resume').addEventListener('click', openResumeModal);

  // Voci del menu File (native e della menubar in-app)
  try {
    window.aisess.onMenu('menu-new-session', () => openNewModal());
    window.aisess.onMenu('menu-open-config', () => window.AisessCommands.openConfig());
    window.aisess.onMenu('menu-term-font-bigger', () => runTermFontAction('term-font-bigger'));
    window.aisess.onMenu('menu-term-font-smaller', () => runTermFontAction('term-font-smaller'));
    window.aisess.onMenu('menu-term-font-reset', () => runTermFontAction('term-font-reset'));
    window.aisess.onMenuEdit((action) => runEditAction(action));
  } catch {}

  // Comandi di avvio configurabili (renderer/command-config.js)
  window.AisessCommands.initConfigUI();
  window.AisessCommands.load().catch((e) => console.warn('get-command-profiles fallito', e));
  window.onCommandProfilesChanged = () => renderSidebar();

  initSidebarResize();
  initUsageBar();
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
  renderSidebar();
  updateEmpty();
  ensureClaudeAccounts();
  await reattachLiveSessions();
  await offerRestore();
}

/**
 * @param {string} [type] tipo preselezionato (dal menu o dall'ultimo uso)
 * @param {{cwd?: string}} [opts] directory da proporre al posto dell'ultima digitata:
 *   è quello che fa il «+» di un gruppo progetto nella sidebar
 */
async function openNewModal(type, { cwd } = {}) {
  if (type) pendingNewType = type;
  if (cwd) $('#new-cwd').value = cwd;
  $$('.type-card').forEach(x => x.classList.toggle('selected', x.dataset.type === pendingNewType));
  // Il modal si apre DOPO che la riga account e' pronta: prima compariva un
  // istante senza, e con piu' account Claude la riga arrivava a modal gia' aperto.
  await updateClaudeAccountRow();
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
  // Il lister puo' aver scartato file illeggibili o in un formato inatteso:
  // meglio dirlo che lasciar credere che la lista sia completa.
  if (data.skipped > 0) {
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = data.skipped === 1 ? '1 sessione non leggibile, esclusa dall\'elenco.' : `${data.skipped} sessioni non leggibili, escluse dall'elenco.`;
    box.appendChild(note);
  }
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

/**
 * Aggiorna id conversazione e nome delle schede. L'id si cerca per OGNI scheda
 * che non lo conosce, rinominata o no: e' cio' che la rende ripristinabile
 * dopo un riavvio (finisce sulla sessione tmux e da li' in live-sessions.json).
 * Il titolo automatico invece tocca solo le schede non rinominate.
 */
async function refreshAutoTitles() {
  const targets = [...tabs.values()].filter(Titles.needsAutoRefresh);
  if (!targets.length) return;
  const byType = new Map();
  for (const t of targets) if (!byType.has(t.type)) byType.set(t.type, listSessionsFor(t.type));
  let changed = false;
  for (const [type, promise] of byType) {
    let data = null;
    try { data = await promise; } catch { continue; }
    if (!data || !data.ok) continue;
    for (const t of targets.filter((x) => x.type === type)) {
      // Con un resume l'id è noto; per una scheda nuova va riconosciuto. Le
      // conversazioni già di altre schede sono escluse: due schede nello stesso
      // progetto non devono finire sulla stessa conversazione.
      const s = t.resumeId
        ? (data.sessions || []).find((x) => x.id === t.resumeId)
        : Titles.pickAutoSession(data.sessions, { cwd: t.cwd, since: t.startedAt - 5000, exclude: knownResumeIds(t) });
      if (!s) continue;
      if (!t.resumeId) {
        t.resumeId = s.id;
        // Appena l'id e' noto lo si salva sulla sessione tmux: e' cio' che rende
        // ripristinabile dopo un riavvio una scheda nata "nuova".
        if (t.session && t.alive) window.aisess.setMeta(t.id, { resumeId: s.id });
      }
      // Nome scelto dall'utente (rinomina, dialog, prompt digitato): si lega
      // alla conversazione appena se ne conosce l'id, così sopravvive al
      // resume. Il titolo del CLI perde.
      if (t.namedFromPrompt || !t.autoNamed) {
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

/** Id delle conversazioni già assegnate ad altre schede dello stesso tipo. */
function knownResumeIds(tab) {
  return [...tabs.values()].filter((t) => t !== tab && t.type === tab.type && t.resumeId).map((t) => t.resumeId);
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

async function createTab(type, { name, cwd, resumeId, claudeAccountId, commandProfileId, attachSession = null, commandProfileLabel = null, previousSession = null, startedAt = Date.now() } = {}) {
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
  const tab = { id, type, name: label, cwd, projectRoot: cwd || null, resumeId, startedAt, autoNamed: !name,
    session: attachSession, reattached: Boolean(attachSession),
    // Nome tmux della sessione prima di un riavvio della macchina: la sola
    // identità stabile di una shell ricreata, per ritrovarne il posto.
    previousSession,
    promptCapture: PromptCapture.createPromptCapture(), namedFromPrompt: false, claudeAccountId, claudeAccountName, commandProfileId: picked.id, commandProfileLabel: picked.label, term: null, fit: null, ro: null, wrap, alive: true, needsAttention: false, idleTimer: null, running: false, runTimer: null };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id);

  // scrollback: senza tmux la history con cui scorre la rotella è QUESTA.
  // Le 1000 righe di default coprivano poco: allineate all'ordine di
  // grandezza di `history-limit`. Con tmux si azzera appena si sa (sotto):
  // la history è quella di tmux, e questa sarebbe a buchi.
  const term = new Terminal({ cursorBlink: true, scrollback: 20000, fontSize: termFont.get(), lineHeight: TERM_LINE_HEIGHT, fontFamily: "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace", theme: TERM_THEME });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch {}
  term.open(inner);
  tab.term = term;
  tab.fit = fit;

  // Rotella e barra laterale: con tmux scorrono la history di tmux (copy-mode),
  // senza quella di xterm. Vedi renderer/term-scroll.js.
  const tmuxScroll = {
    scroll: (n) => window.aisess.scroll(id, n),
    scrollTo: (n) => window.aisess.scrollTo(id, n),
    state: () => window.aisess.scrollState(id),
  };
  const xtermScroll = window.AisessTermScroll.xtermBackend(term);
  tab.scroller = window.AisessTermScroll.attach({
    term, host: wrap,
    backend: () => (tab.session ? tmuxScroll : xtermScroll),
    rowHeight: () => inner.clientHeight / Math.max(1, term.rows),
    sendKeys: (d) => window.aisess.write(id, d),
    isVisible: () => wrap.classList.contains('active'),
  });
  term.onScroll(() => { if (!tab.session) tab.scroller.refresh(); });

  term.onData((d) => {
    window.aisess.write(id, d);
    applyTypedPrompt(tab, d);
    // L'utente ha chiesto qualcosa qui: la risposta va segnalata anche se breve.
    // Non i report che xterm manda da solo (mouse, focus): lampeggio a caso.
    if (Attention.isTyping(d)) attention.typed(id);
  });
  // xterm accetta un solo gestore tasti: qui si compongono quelli dei moduli.
  // Copia/incolla: la selezione di xterm non è una selezione del documento.
  // Shift+Invio: a capo nel prompt delle TUI senza inviarlo.
  const keyHandlers = [window.AisessNewline.keyHandler(term), window.AisessClipboard.keyHandler(term)];
  term.attachCustomKeyEventHandler((e) => keyHandlers.every((h) => h(e)));
  window.AisessClipboard.attachContextMenu(term, inner);
  // Il bell è il "ho finito" esplicito degli agenti: vale senza attendere l'idle
  try { term.onBell(() => flagAttention(tab, { bell: true })); } catch {}

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
    if (tab.session) term.options.scrollback = 0;
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

/**
 * Dimensione del testo dei terminali, da menu nativo o menubar in-app.
 * Cambia tutte le schede insieme: quella attiva si rifà il fit subito, le
 * altre quando tornano in primo piano (setActive → refit).
 * @returns {boolean} true se l'azione era una di queste
 */
function runTermFontAction(action) {
  const deltas = { 'term-font-bigger': +1, 'term-font-smaller': -1 };
  if (action === 'term-font-reset') termFont.reset();
  else if (action in deltas) termFont.step(deltas[action]);
  else return false;
  const size = termFont.get();
  for (const t of tabs.values()) {
    if (t.term) t.term.options.fontSize = size;
  }
  fitActive();
  return true;
}

function runEditAction(action) {
  if (!EDIT_ACTIONS.includes(action)) return false;
  const t = activeId ? tabs.get(activeId) : null;
  const onTerminal = !!t && !!t.term && (t.wrap.contains(document.activeElement) || t.term.hasSelection());
  if (onTerminal && window.AisessClipboard.applyEditAction(t.term, action)) return true;
  window.aisess.menuAction(action).catch((e) => console.warn('azione edit fallita', e));
  return true;
}

function setActive(id) {
  // La scheda che lascia il primo piano si ridisegna per il refit: quell'output
  // è una conseguenza della visita, non un lavoro nuovo (attention.js).
  if (activeId && activeId !== id) attention.left(activeId);
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
  refreshUsage(); // il riquadro SESSIONE parla della scheda in primo piano
}

function refitTab(id) {
  const t = tabs.get(id);
  if (!t || !t.fit || !t.term) return;
  // Le schede nascoste hanno dimensione 0: fittare qui le rovinerebbe
  if (!t.wrap.classList.contains('active')) return;
  try { t.fit.fit(); window.aisess.resize(t.id, t.term.cols, t.term.rows); } catch {}
  if (t.scroller) t.scroller.refresh();
}

function fitActive() {
  if (activeId) refitTab(activeId);
}

/* ---------- "L'assistente ha finito": card che lampeggia ----------
   Un agente TUI scrive senza sosta mentre lavora: quando il flusso si ferma
   per ATTENTION_IDLE_MS su una scheda non in primo piano, il turno può essere
   finito. *Può*: decidere se quella raffica era un lavoro o solo la TUI che si
   ridisegna spetta a renderer/attention.js, che è dove sta la regola (e dove i
   test la provano). Qui restano il timer e il render. */
const ATTENTION_IDLE_MS = 1500;
const attention = Attention.createAttention();

function noteActivity(t, bytes) {
  if (t.type === 'shell') return;   // nessun assistente: niente da segnalare
  if (t.id === activeId) return;    // già sotto gli occhi dell'utente
  attention.data(t.id, bytes);
  clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => flagAttention(t), ATTENTION_IDLE_MS);
}

/** @param {{bell?: boolean}} [o] il bell del terminale, segnale esplicito di fine turno */
function flagAttention(t, { bell = false } = {}) {
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  if (t.type === 'shell' || t.id === activeId || t.needsAttention) return;
  if (!(bell ? attention.bell(t.id) : attention.idle(t.id))) return;
  t.needsAttention = true;
  // Solo la classe sulla card: rifare la sidebar farebbe ripartire da capo il
  // lampeggio di tutte le altre (render() ricostruisce gli elementi).
  if (!sidebar.signal(t.id, { needsAttention: true })) renderSidebar();
}

/* ---------- "Sta lavorando adesso": barra del tipo animata ----------
   Stesso flusso di byte dell'attenzione, domanda diversa: non «ha finito» ma
   «sta macinando in questo momento», e vale anche per la scheda in primo piano
   e per le shell (un build che gira è in esecuzione quanto un agente). La
   regola sta in renderer/running.js; qui il timer del silenzio e il render,
   che scatta solo ai due cambi di stato. */
const RUNNING_IDLE_MS = 1200;
const running = Running.createRunning();

function noteRunning(t) {
  if (!t.alive) return;
  if (running.data(t.id)) { t.running = true; showRunning(t); }
  clearTimeout(t.runTimer);
  t.runTimer = setTimeout(() => stopRunning(t), RUNNING_IDLE_MS);
}

function stopRunning(t) {
  clearTimeout(t.runTimer);
  t.runTimer = null;
  if (!running.stop(t.id)) return;
  t.running = false;
  showRunning(t);
}

/* Il segnale si accende e si spegne di continuo (ogni pausa di una sessione che
   lavora): passare da renderSidebar() ricostruirebbe le card, e la sessione che
   lampeggia «ho finito» ripartirebbe ogni volta dal fotogramma zero — il
   lampeggio si vedrebbe a scatti. */
function showRunning(t) {
  if (!sidebar.signal(t.id, { running: t.running })) renderSidebar();
}

/** Azzera la segnalazione di una scheda. @returns {boolean} true se lampeggiava */
function clearAttention(id) {
  const t = tabs.get(id);
  if (!t) return false;
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  attention.seen(id);
  if (!t.needsAttention) return false;
  t.needsAttention = false;
  return true;
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  await window.aisess.kill(id);
  clearAttention(id);
  attention.forget(id);
  clearTimeout(t.runTimer);
  running.forget(id);
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
  if (t.session) await window.aisess.terminate(id);
  await closeTab(id);
}

/* La ✕ della card. Chiude la sessione per davvero (il processo muore): prima
   lo si chiede, con un fumetto appoggiato alla card. La domanda si salta solo
   per una sessione già terminata, dove non c'è niente da perdere. */
const closeConfirm = ConfirmBubble.createConfirmBubble();
async function requestClose(id, anchor) {
  const t = tabs.get(id);
  if (!t) return;
  if (t.alive && anchor) {
    const yes = await closeConfirm.ask({
      anchor,
      key: id,
      name: t.name,
      detachable: Boolean(tmuxAvailable && t.session),
    });
    if (!yes) return;
  }
  await terminateTab(id);
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
    // Si salta solo cio' che questo renderer ha gia' in una scheda. Un client
    // attaccato nel main senza una scheda qui e' di un renderer precedente
    // (hard refresh): va riagganciato, e attach() chiude quello vecchio.
    if ([...tabs.values()].some((t) => t.session === s.name)) continue;
    await createTab(s.type || 'shell', {
      name: s.label || null,
      cwd: s.cwd || undefined,
      resumeId: s.resumeId || null,
      claudeAccountId: s.accountId || null,
      commandProfileId: s.profileId || null,
      commandProfileLabel: s.profileLabel || null,
      attachSession: s.name,
      // L'istante di avvio e' quello della sessione tmux, non del riattacco:
      // senza id, la conversazione va cercata da quando e' nata davvero.
      startedAt: s.createdAt || Date.now(),
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
        await createTab(plan.type, { name: plan.name, cwd: plan.cwd, resumeId: plan.resumeId, claudeAccountId: plan.claudeAccountId, commandProfileId: plan.commandProfileId, previousSession: plan.previousSession });
      }
    };
    dismissBtn.onclick = async () => { done(); await window.aisess.discardRestorable(); };
    backdrop.hidden = false;
  });
}

/** Stessa logica di lib/live-sessions.js#restorePlan, lato renderer (che non puo' importarla). */
function restorePlanFor(s) {
  const type = s.type || 'shell';
  const base = { type, cwd: s.cwd || undefined, commandProfileId: s.profileId || null, claudeAccountId: s.accountId || null, name: s.label || null, previousSession: s.name || null };
  if (type !== 'shell' && s.resumeId) return { ...base, resumeId: s.resumeId, mode: 'resume' };
  return { ...base, resumeId: null, mode: 'fresh' };
}

/* ---------- Sidebar delle sessioni aperte ----------
   Il modulo non conosce le schede: le riceve a ogni render e restituisce le
   azioni come callback. Qui restano `tabs` e `activeId`, che sono suoi — e
   `tmuxAvailable`, che decide che cosa dire nella conferma di chiusura. */
const sidebar = Sidebar.createSidebar({
  list: $('#session-list'), count: $('#count'),
  storage: window.localStorage, Icons, Slice: window.PizzaSlice,
  Groups, Order, Commands: window.AisessCommands, escapeHtml,
  modeButtons: { type: $('#group-mode-type'), project: $('#group-mode-project') },
  onSelect: (id) => setActive(id),
  onClose: (id, anchor) => { requestClose(id, anchor).catch(() => {}); },
  onRename: (t) => { renameTab(t).catch(() => {}); },
  // Il «+» di un gruppo progetto: stesso dialog, directory già impostata sulla
  // radice; il tipo lo si sceglie lì come sempre.
  onNewInProject: (root) => { openNewModal(undefined, { cwd: root }).catch(() => {}); },
  onReorder: (movedId, targetId, opts) => {
    const next = Order.moveAdjacent(sessionOrder, movedId, targetId, opts);
    if (next === sessionOrder) return;
    sessionOrder = next;
    renderSidebar();
  },
});
/* Ordine manuale delle card, deciso trascinandole. Vive qui insieme a `tabs`
   perché è una proprietà delle schede aperte, non della sidebar: il modulo
   riceve già la lista ordinata. Le schede nuove entrano in coda, tranne quelle
   che hanno un posto salvato da un avvio precedente (session-order.js). */
let sessionOrder = [];
const SAVED_ORDER_KEY = 'aisess.sessionOrder';
let savedOrder = readSavedOrder();

function readSavedOrder() {
  try {
    const v = JSON.parse(window.localStorage.getItem(SAVED_ORDER_KEY) || '[]');
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}

/** Riscrive l'ordine salvato, solo se è cambiato: renderSidebar() è frequente. */
function saveOrder() {
  const next = Order.mergeSaved(sessionOrder.map((id) => Order.tabKeys(tabs.get(id))), savedOrder);
  if (next.length === savedOrder.length && next.every((k, i) => k === savedOrder[i])) return;
  savedOrder = next;
  try { window.localStorage.setItem(SAVED_ORDER_KEY, JSON.stringify(next)); } catch (e) { console.warn('ordine delle schede non salvato', e); }
}

/** Posto salvato di una scheda: quello della prima delle sue chiavi che c'è. */
function savedRanks() {
  const rank = new Map(savedOrder.map((k, i) => [k, i]));
  return (id) => {
    const hit = Order.tabKeys(tabs.get(id)).find((k) => rank.has(k));
    return hit === undefined ? undefined : rank.get(hit);
  };
}

const renderSidebar = () => {
  sessionOrder = Order.syncOrder(sessionOrder, [...tabs.keys()], { rankOf: savedRanks() });
  saveOrder();
  sidebar.render(Order.applyOrder([...tabs.values()], sessionOrder), activeId);
  // La barra in basso dice in che chat si è: cambia con la scheda attiva, un
  // rinomina, il titolo automatico — tutte strade che passano da qui.
  if (usageBar) usageBar.setCurrent(activeId ? tabs.get(activeId) : null);
  // Il render ricrea le card: il fumetto di conferma resterebbe appeso a un
  // elemento che non è più nella pagina. Lo si rimette sulla card nuova della
  // stessa sessione (o lo si chiude, se quella sessione non c'è più).
  closeConfirm.retarget(findAnchor);
  scheduleHint();
};

/* Pallini dei binari in fondo alla sidebar. Si rilegge anche da «Ricontrolla»
   nella schermata vuota: chi ha appena installato un assistente deve vederlo
   acceso senza riavviare. */
async function refreshDeps() {
  try {
    const deps = await window.aisess.checkDeps();
    if (welcome) welcome.update(deps.setup || null);
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
    // tmux non e' un tipo di sessione ma decide se le sessioni sopravvivono
    // all'app: senza indicatore, chi non ce l'ha scopre la differenza solo
    // perdendole. Stesso trattamento dei binari, con la spiegazione nel tooltip.
    const tmuxEl = $('#dep-tmux');
    if (tmuxEl) {
      tmuxEl.style.opacity = tmuxAvailable ? '1' : '0.45';
      tmuxEl.title = tmuxAvailable
        ? `tmux: ${tmuxPath}\nLe sessioni restano vive alla chiusura dell'app e tornano alla riapertura.`
        : 'tmux non trovato: le sessioni muoiono con la finestra.\nInstallalo (brew install tmux / apt install tmux) e riavvia l\'app.';
    }
    if (AI_TYPES.some(n => !deps[n] || !deps[n].found)) {
      console.warn('[PizzaManager] binari mancanti:', deps);
    }
  } catch (e) {
    console.warn('check-deps fallito', e);
    if (welcome) welcome.update(null);
  }
}

function updateEmpty() {
  const el = $('#empty');
  if (el) el.style.display = tabs.size ? 'none' : 'block';
}

/* ---------- Suggerimenti una volta sola (onboarding) ----------
   Quale mostrare lo decide renderer/hints.js; qui si sceglie QUANDO: poco
   dopo un render, a layout assestato, e mai sopra qualcos'altro — la
   conferma di chiusura ha la precedenza, e un modale aperto vuol dire che
   l'utente sta facendo altro. Il fumetto è lo stesso della conferma. */
const HINT_DELAY_MS = 800;
const hintStore = window.AisessHints ? window.AisessHints.createHintStore(window.localStorage) : null;
let hintTimer = null;

/** L'elemento a cui appendere un fumetto: `group:<radice>` è una linguetta, il resto una card. */
function findAnchor(key) {
  if (key.startsWith('group:')) {
    return document.querySelector(`#session-list .group-header[data-key="${CSS.escape(key.slice('group:'.length))}"]`);
  }
  return document.querySelector(`#session-list .session-item[data-id="${CSS.escape(key)}"]`);
}

function scheduleHint() {
  if (!hintStore) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(showHint, HINT_DELAY_MS);
}

function showHint() {
  if (closeConfirm.isOpen() || document.querySelector('.modal-backdrop:not([hidden])')) return;
  const mode = sidebar.getMode();
  const groups = Groups.groupSessions(Order.applyOrder([...tabs.values()], sessionOrder), { mode });
  const hint = window.AisessHints.nextHint({ seen: hintStore.seen(), groups, mode });
  if (!hint) return;
  const key = hint.anchor.kind === 'group' ? `group:${hint.anchor.key}` : hint.anchor.key;
  const anchor = findAnchor(key);
  // Dentro un gruppo chiuso la card c'è ma non si vede: si riprova al prossimo render
  if (!anchor || anchor.offsetParent === null) return;
  hintStore.markSeen(hint.id);
  closeConfirm.tell({ anchor, title: hint.title, text: hint.text, key }).catch(() => {});
}

/* ---------- Schermata vuota (onboarding) ----------
   Che cosa manca per usare l'app lo calcola il main (lib/setup-check.js) e
   arriva con `check-deps`, la schermata lo disegna (renderer/welcome.js). Si
   chiede all'avvio e a ogni «Ricontrolla»: non a ogni apertura della
   schermata, perché cercare i binari legge il filesystem. */
let welcome = null;

function initWelcome() {
  const root = $('#empty');
  if (!root || !window.AisessWelcome) return;
  welcome = window.AisessWelcome.createWelcome({
    root, document,
    onCopy: (text) => { window.aisess.clipboardWrite(text).catch((e) => console.warn('copia fallita', e)); },
    onRecheck: () => { refreshDeps(); },
    onNew: () => openNewModal(),
    onResume: () => openResumeModal(),
  });
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
    if (runTermFontAction(b.dataset.action)) return;
    try { await window.aisess.menuAction(b.dataset.action); } catch {}
  }));
}

/* Sidebar ridimensionabile via drag, larghezza persistita in localStorage */
function initSidebarResize() {
  const sidebar = $('#sidebar');
  const resizer = $('#sidebar-resizer');
  if (!sidebar || !resizer) return;
  const DEFAULT_W = 300, MIN_W = 180, MAX_W = 480;
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

/* ---------- Barra dell'uso ----------
   Il main process legge i log dei CLI (lib/usage) e restituisce i totali gia'
   aggregati. Qui si decide solo *quando* chiederli: ogni 8 secondi, e subito
   dopo un cambio di scheda, perche' il riquadro SESSIONE cambia con essa.
   Un errore non svuota la barra: si tiene l'ultima fotografia buona, un buco
   di pochi secondi vale meno di una riga che lampeggia. */
const USAGE_REFRESH_MS = 8000;
let usageBar = null;
let usageTimer = null;

function activeUsageSession() {
  const t = activeId ? tabs.get(activeId) : null;
  if (!t || !t.resumeId || t.type === 'shell') return null;
  return { source: t.type, sessionId: t.resumeId };
}

async function refreshUsage() {
  if (!usageBar) return;
  try {
    const r = await window.aisess.usage(activeUsageSession());
    if (r && r.ok && r.usage) usageBar.update(r.usage);
  } catch (e) {
    console.warn('usage-snapshot fallito', e);
  }
}

function initUsageBar() {
  const root = $('#usagebar');
  if (!root || !window.AisessUsageBar) return;
  usageBar = window.AisessUsageBar.createUsageBar({ root, document });
  usageBar.setCurrent(activeId ? tabs.get(activeId) : null);
  refreshUsage();
  if (usageTimer) clearInterval(usageTimer);
  usageTimer = setInterval(refreshUsage, USAGE_REFRESH_MS);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', init);

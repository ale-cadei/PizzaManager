/* Lista delle sessioni nella sidebar: modulo sidebar.js, ordine manuale,
   renderSidebar() e suggerimenti una volta sola. */

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
  onIcon: (t) => openShellIconPicker(t),
  // ⤓ sulla card: se l'export non riesce, il perché esce dalla card
  onExport: (t, anchor) => { exportFromCard(t, anchor).catch(() => {}); },
  // Il «+» di un gruppo progetto: stesso dialog, directory già impostata sulla
  // radice; il tipo lo si sceglie lì come sempre.
  onNewInProject: (root) => { openNewModal(undefined, { cwd: root }).catch(() => {}); },
  onResumeInProject: (root) => { openResumeModal({ projectRoot: root }).catch(() => {}); },
  // Worktree (docs/plans/36): sotto-sezioni nel gruppo, «+» e ⋯ sulla riga
  WorktreeSection: window.AisessWorktreeSection,
  onNewWorktree: (root) => { openWorktreeModal(root).catch((e) => console.warn('modale worktree', e)); },
  onNewInWorktree: (path) => { openNewModal(undefined, { cwd: path }).catch(() => {}); },
  onWorktreeMenu: (w, root, anchor) => {
    worktreeActions.openMenu(w, root, anchor).catch((e) => console.warn('menu del worktree', e));
  },
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
  const ordered = Order.applyOrder([...tabs.values()], sessionOrder);
  // I worktree di un progetto si chiedono la prima volta che il progetto compare;
  // la risposta ridisegna la sidebar da sola (worktrees.js)
  worktreeCache.sync(ordered.map((t) => t.projectRoot)).catch(() => {});
  sidebar.render(ordered, activeId, worktreeCache.snapshot());
  refreshOpenSearchScope();
  // La barra in basso dice in che chat si è: cambia con la scheda attiva, un
  // rinomina, il titolo automatico — tutte strade che passano da qui.
  if (usageBar) usageBar.setCurrent(activeId ? tabs.get(activeId) : null);
  // Il render ricrea le card: il fumetto di conferma resterebbe appeso a un
  // elemento che non è più nella pagina. Lo si rimette sulla card nuova della
  // stessa sessione (o lo si chiude, se quella sessione non c'è più).
  closeConfirm.retarget(findAnchor);
  scheduleHint();
};

/* Cerca nelle chat aperte e nella cronologia delle shell. Il risultato
   seleziona la scheda viva, senza creare un nuovo Resume. */
let openSearchScopeKey = '';
const openSearch = ConvSearch.createSearchRunner({
  search: searchOpenChats,
  render: renderOpenSearchState,
});

function openSearchTabs() {
  return [...tabs.values()].filter((t) => t.type === 'shell' || (['claude', 'codex'].includes(t.type) && t.resumeId));
}

function openSearchKey(t) {
  return t.type === 'shell' ? `shell:${t.id}` : `${t.type}:${t.resumeId}`;
}

function xtermShellText(tab) {
  const buffer = tab.term && tab.term.buffer && tab.term.buffer.active;
  if (!buffer) return '';
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

async function searchShellTab(tab, query, allSnippets = false) {
  let text = tab.session ? await window.aisess.captureShell(tab.id) : null;
  if (text == null) text = xtermShellText(tab);
  const found = ShellSearch.search(text, query, { allSnippets });
  return found.hits ? { source: 'shell', id: tab.id, title: tab.name, mtime: tab.startedAt, ...found } : null;
}

async function searchOpenChats(query) {
  const open = openSearchTabs();
  const scope = open.filter((t) => t.type !== 'shell').map((t) => ({ source: t.type, id: t.resumeId }));
  const agents = scope.length ? window.aisess.searchConversations(query, scope) : Promise.resolve({ ok: true, results: [] });
  const shells = Promise.all(open.filter((t) => t.type === 'shell').map((t) => searchShellTab(t, query).catch(() => null)));
  const [agentResults, shellResults] = await Promise.all([agents, shells]);
  if (!agentResults.ok) return agentResults;
  return { ...agentResults, results: [...agentResults.results, ...shellResults.filter(Boolean)].sort((a, b) => b.mtime - a.mtime) };
}

function onOpenSearchInput() {
  const query = $('#open-search').value;
  const searching = Boolean(query.trim());
  $('#sidebar').classList.toggle('searching', searching);
  $('#open-search-results').hidden = !searching;
  if (!searching) {
    openSearch.cancel();
    openSearchScopeKey = '';
    return;
  }
  openSearchScopeKey = openSearchTabs().map(openSearchKey).sort().join('\n');
  if (!openSearchTabs().length) {
    openSearch.cancel();
    renderOpenSearchState({ phase: 'unavailable' });
  } else openSearch.schedule(query);
}

function refreshOpenSearchScope() {
  if (!$('#open-search').value.trim()) return;
  const key = openSearchTabs().map(openSearchKey).sort().join('\n');
  if (key !== openSearchScopeKey) onOpenSearchInput();
}

function renderOpenSearchState(state) {
  if (!$('#open-search').value.trim()) return;
  const box = $('#open-search-results');
  box.replaceChildren();
  if (state.phase !== 'results') {
    const message = state.phase === 'unavailable'
      ? 'Nessuna shell o chat Claude Code o Codex ricercabile è aperta.'
      : state.phase === 'short' ? 'Scrivi almeno 2 caratteri.'
      : ConvSearch.statusText(state);
    box.appendChild(mutedNote(message));
    return;
  }
  const byConversation = new Map(openSearchTabs().map((t) => [openSearchKey(t), t]));
  let count = 0;
  for (const r of state.results) {
    const tab = byConversation.get(`${r.source}:${r.id}`);
    if (!tab) continue;
    count++;
    const item = document.createElement('div');
    item.className = 'open-search-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open-search-open';
    const type = document.createElement('span');
    type.className = 'open-search-type';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = Icons.markup(tab.type === 'shell' ? ShellIcons.normalize(tab.iconKey) : tab.type); // markup statico
    type.appendChild(icon);
    const label = document.createElement('span');
    label.textContent = tab.type === 'shell' ? 'Shell' : Groups.TYPE_LABELS[tab.type] || tab.type;
    type.appendChild(label);
    open.appendChild(type);
    const title = document.createElement('span');
    title.className = 'open-search-title';
    title.textContent = tab.name;
    open.appendChild(title);
    open.addEventListener('click', () => {
      $('#open-search').value = '';
      onOpenSearchInput();
      setActive(tab.id);
    });
    item.appendChild(open);
    ConvSearch.appendExpandableSnippets(document, item, r, {
      query: state.query,
      loadAll: async (q, scope, all) => {
        if (tab.type !== 'shell') return window.aisess.searchConversations(q, scope, all);
        const full = await searchShellTab(tab, q, all);
        return { ok: true, results: full ? [full] : [] };
      },
      isCurrent: () => $('#open-search').value === state.query && tabs.get(tab.id) === tab,
    });
    box.appendChild(item);
  }
  if (!count) box.appendChild(mutedNote(`Nessun messaggio contiene «${state.query}» nelle chat aperte.`));
}

/* ---------- Suggerimenti una volta sola (onboarding) ----------
   Quale mostrare lo decide renderer/hints.js; qui si sceglie QUANDO: poco
   dopo un render, a layout assestato, e mai sopra qualcos'altro — la
   conferma di chiusura ha la precedenza, e un modale aperto vuol dire che
   l'utente sta facendo altro. Il fumetto è lo stesso della conferma. */
const HINT_DELAY_MS = 800;
const hintStore = window.AisessHints ? window.AisessHints.createHintStore(window.localStorage) : null;
let hintTimer = null;

/** L'elemento a cui appendere un fumetto: `group:<radice>` è una linguetta,
    `worktree:<percorso>` il ⋯ di un worktree, il resto una card. */
function findAnchor(key) {
  if (key.startsWith('group:')) {
    return document.querySelector(`#session-list .group-header[data-key="${CSS.escape(key.slice('group:'.length))}"]`);
  }
  if (key.startsWith('worktree:')) {
    return document.querySelector(`#session-list .worktree-menu[data-path="${CSS.escape(key.slice('worktree:'.length))}"]`);
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

/* Schede con un export in corso: un doppio clic su ⤓ aprirebbe due dialog di
   salvataggio uno dopo l'altro. */
let exportingCards = new Set();

/** Esporta la conversazione di una card; riuscito o annullato non c'è niente da dire. */
async function exportFromCard(t, anchor) {
  if (exportingCards.has(t.id)) return;
  exportingCards = new Set(exportingCards).add(t.id);
  let res = null;
  try {
    res = await window.aisess.exportConversation(t.type, t.resumeId);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  } finally {
    exportingCards = new Set([...exportingCards].filter((id) => id !== t.id));
  }
  if (res.ok || res.cancelled) return;
  await closeConfirm.tell({ anchor, title: 'Esportazione non riuscita', text: res.error || 'Errore sconosciuto.', key: t.id });
}

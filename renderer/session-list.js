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

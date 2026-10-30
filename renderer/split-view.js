/* Schermo diviso nella pagina (docs/plans/76-schermo-diviso.md): due wrap
   visibili in #terminals, la linea fra loro, la velina del trascinamento e il
   salvataggio. Le regole stanno in renderer/split-layout.js.

   `.active` sul wrap vuol dire «visibile» (fit, barra di scorrimento): in
   divisione lo sono entrambe le metà. Quella in primo piano resta `activeId`
   e porta `.split-focus`. */
const Split = window.AisessSplit;
const SPLIT_STORAGE_KEY = 'aisess.split';
let splitState = null;
// Card della sidebar presa in mano: solo quella apre la velina, non un file
// o un testo trascinati da fuori.
let splitDraggedId = null;

function splitVisibleIds() {
  return Split.visibleIds(splitState, activeId);
}

/* Chiavi stabili di una scheda (session-order.js). Git ed editor non hanno
   né tmux né conversazione: le riconosce il tipo con la cartella. */
function splitKeysOf(id) {
  const t = tabs.get(id);
  if (!t) return [];
  const keys = Order.tabKeys(t);
  return PANEL_TYPES.includes(t.type) && t.cwd ? [...keys, `${t.type}:${t.cwd}`] : keys;
}

function saveSplit() {
  try {
    const saved = Split.toSaved(splitState, splitKeysOf);
    if (saved) localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(SPLIT_STORAGE_KEY);
  } catch (e) {
    console.warn('[PizzaManager] divisione non salvata', e);
  }
}

function setSplit(next) {
  splitState = next;
  saveSplit();
  applySplitLayout();
  setTimeout(() => fitActive(), 30);
}

/** Da setActive: un click su una card può sostituire la metà in primo piano. */
function splitSelect(id) {
  const { state } = Split.select(splitState, activeId, id);
  if (state === splitState) return;
  splitState = state;
  saveSplit();
}

/** Da closeTab: la compagna della scheda chiusa, che resta sola. */
function splitForget(id) {
  const partner = Split.partnerOf(splitState, id);
  if (partner) { splitState = null; saveSplit(); }
  return partner;
}

/** Visibilità, ordine e misure dei wrap secondo lo stato. */
function applySplitLayout() {
  const host = $('#terminals');
  if (!host) return;
  const s = splitState;
  const visible = splitVisibleIds();
  host.classList.toggle('split-row', Boolean(s) && s.orientation === 'row');
  host.classList.toggle('split-column', Boolean(s) && s.orientation === 'column');
  tabs.forEach((t) => {
    const at = s ? [s.first, s.second].indexOf(t.id) : -1;
    t.wrap.classList.toggle('active', visible.includes(t.id));
    t.wrap.classList.toggle('split-focus', at >= 0 && t.id === activeId);
    // La linea ha order 1: first prima, second dopo
    t.wrap.style.order = at === 1 ? '2' : '';
    t.wrap.style.flex = at === 0 ? `0 0 calc(${s.ratio * 100}% - var(--split-gap) / 2)` : '';
  });
  const divider = $('#split-divider');
  if (divider) {
    divider.hidden = !s;
    divider.setAttribute('aria-orientation', s && s.orientation === 'column' ? 'horizontal' : 'vertical');
  }
}

/* Click o fuoco dentro l'altra metà la porta in primo piano. */
function focusPaneOf(target) {
  if (!splitState || !target || !target.closest) return;
  const wrap = target.closest('.term-wrap');
  const id = wrap && wrap.id.startsWith('wrap-') ? wrap.id.slice(5) : null;
  if (id && id !== activeId && splitVisibleIds().includes(id)) setActive(id);
}

function canDropSplit() {
  return Boolean(splitDraggedId) && tabs.has(splitDraggedId)
    && Split.canPlace(splitState, { focusedId: activeId, droppedId: splitDraggedId });
}

function dropZoneOf(host, e) {
  const rect = host.getBoundingClientRect();
  return Split.dropZone(rect, e.clientX - rect.left, e.clientY - rect.top);
}

function initSplitDrop(host, overlay) {
  const hide = () => { overlay.hidden = true; overlay.dataset.zone = ''; };
  document.addEventListener('dragstart', (e) => {
    const card = e.target && e.target.closest ? e.target.closest('.session-item') : null;
    splitDraggedId = card && card.dataset.id ? card.dataset.id : null;
  });
  document.addEventListener('dragend', () => { splitDraggedId = null; hide(); });
  // La velina copre terminali ed editor: da lì in poi gli eventi sono suoi
  host.addEventListener('dragenter', (e) => {
    if (!canDropSplit()) return;
    e.preventDefault();
    overlay.hidden = false;
  });
  overlay.addEventListener('dragover', (e) => {
    if (!canDropSplit()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    overlay.dataset.zone = dropZoneOf(host, e);
  });
  overlay.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !overlay.contains(e.relatedTarget)) hide();
  });
  overlay.addEventListener('drop', (e) => {
    if (!canDropSplit()) return;
    e.preventDefault();
    const droppedId = splitDraggedId;
    const zone = dropZoneOf(host, e);
    hide();
    const next = Split.place(splitState, { focusedId: activeId, droppedId, zone });
    if (next === splitState) return;
    splitState = next;
    saveSplit();
    setActive(droppedId);
  });
}

function initSplitDivider(host, divider) {
  const onButton = (e) => Boolean(e.target.closest && e.target.closest('button'));
  divider.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || onButton(e) || !splitState) return;
    e.preventDefault();
    host.classList.add('split-resizing');
    const onMove = (ev) => {
      if (!splitState) return;
      const ratio = Split.ratioAt(host.getBoundingClientRect(), splitState.orientation, ev.clientX, ev.clientY);
      splitState = { ...splitState, ratio };
      applySplitLayout();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      host.classList.remove('split-resizing');
      saveSplit();
      fitActive();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  divider.addEventListener('dblclick', (e) => {
    if (onButton(e) || !splitState) return;
    setSplit({ ...splitState, ratio: 0.5 });
  });
  const swap = divider.querySelector('.split-swap');
  if (swap) swap.addEventListener('click', () => setSplit(Split.swap(splitState)));
  const close = divider.querySelector('.split-close');
  if (close) close.addEventListener('click', () => setSplit(null));
}

function initSplitView() {
  const host = $('#terminals');
  const divider = $('#split-divider');
  const overlay = $('#split-drop');
  if (!host || !divider || !overlay || !Split) return;
  initSplitDrop(host, overlay);
  initSplitDivider(host, divider);
  host.addEventListener('mousedown', (e) => focusPaneOf(e.target), true);
  host.addEventListener('focusin', (e) => focusPaneOf(e.target));
  // Le chiavi arrivano dopo la nascita (sessione tmux, id della conversazione):
  // all'uscita si salvano quelle definitive.
  window.addEventListener('beforeunload', saveSplit);
}

/* All'avvio, finiti riaggancio e ripristino automatici: la divisione torna
   solo se ci sono entrambe le sessioni. */
function restoreSplit() {
  let saved = null;
  try { saved = Split.parseSaved(localStorage.getItem(SPLIT_STORAGE_KEY)); } catch {}
  const open = [...tabs.keys()].map((id) => ({ id, keys: splitKeysOf(id) }));
  const next = Split.fromSaved(saved, open);
  if (!next) return;
  splitState = next;
  const focus = activeId === next.first || activeId === next.second ? activeId : next.first;
  setActive(focus, { reveal: false });
}

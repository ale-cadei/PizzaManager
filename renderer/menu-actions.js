/* Azioni di menu (nativo e menubar in-app): Edit sul terminale, dimensione
   del testo, colori (principale e tipi). */

/* ---------- Menu Edit: terminale o resto della pagina ----------
   Con il fuoco (o una selezione) sul terminale attivo copia/incolla passano da
   xterm; altrove restano le azioni native, che funzionano su input e testo. */
const EDIT_ACTIONS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

// Il dialogo dei colori si costruisce alla prima apertura (renderer/type-colors-ui.js)
let typeColorsDialogInstance = null;
function typeColorsDialog() {
  if (!typeColorsDialogInstance) {
    const root = document.documentElement;
    typeColorsDialogInstance = window.AisessTypeColorsUI.createTypeColorsDialog({
      doc: document,
      backdrop: $('#modal-type-colors'),
      list: $('#type-color-list'),
      saveBtn: $('#type-colors-save'),
      cancelBtn: $('#type-colors-cancel'),
      resetBtn: $('#type-colors-reset'),
      store: typeColors,
      types: COLOR_KEYS,
      labels: COLOR_LABELS,
      style: root.style,
      readVar: (name) => getComputedStyle(root).getPropertyValue(name),
      onChange: () => {
        const theme = termTheme();
        for (const tab of tabs.values()) if (tab.term) tab.term.options.theme = theme;
      },
    });
  }
  return typeColorsDialogInstance;
}

/* Notifiche di sistema (piano 38): la preferenza vive qui, il main la riceve
   e tiene allineata la spunta del menu nativo; quella della menubar in-app
   la aggiorna applyNotifications. */
async function applyNotifications(enabled) {
  const check = $('#mb-notifications-check');
  if (check) check.textContent = enabled ? '✓' : '';
  try {
    return await window.aisess.notifyConfig({ enabled });
  } catch (e) {
    console.warn('notify-config fallito', e);
    return null;
  }
}
async function initNotifications() {
  window.aisess.onMenu('menu-notifications', () => { applyNotifications(notifyStore.toggle()); });
  // Click sulla notifica: la scheda, se c'è ancora
  window.aisess.onNotifyOpenTab((id) => { if (tabs.has(id)) setActive(id); });
  const res = await applyNotifications(notifyStore.get());
  const item = $('#mb-notifications');
  if (item && !(res && res.supported)) item.hidden = true;
}

/* Animaletti in fondo alla finestra (renderer/pets-view.js, piano 33).
   Reagiscono a tutte le schede: una al lavoro li fa correre, una che
   aspetta ne fa chiamare uno. */
let petsView = null;
function petsSignals() {
  const all = [...tabs.values()];
  return { running: all.some((t) => t.running), attention: all.some((t) => t.needsAttention) };
}
/** La striscia cambia altezza: il terminale attivo rifà righe e colonne. */
function applyPets(config) {
  petsView.apply(config);
  fitActive();
}
function initPets() {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  petsView = window.AisessPetsView.createPetsView({
    doc: document,
    win: window,
    strip: $('#pets-strip'),
    signals: petsSignals,
    raf: (fn) => window.requestAnimationFrame(fn),
    caf: (id) => window.cancelAnimationFrame(id),
    reducedMotion: () => motion.matches,
  });
  motion.addEventListener('change', () => petsView.refresh());
  applyPets(petsStore.get());
}

let petsDialogInstance = null;
function petsDialog() {
  if (!petsDialogInstance) {
    petsDialogInstance = window.AisessPetsUI.createPetsDialog({
      doc: document,
      backdrop: $('#modal-pets'),
      body: $('#pets-settings'),
      saveBtn: $('#pets-save'),
      cancelBtn: $('#pets-cancel'),
      store: petsStore,
      onChange: applyPets,
    });
  }
  return petsDialogInstance;
}

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

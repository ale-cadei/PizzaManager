/* Azioni di menu (nativo e menubar in-app): Edit sul terminale, dimensione
   del testo, colori dei tipi. */

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
      types: Groups.TYPE_ORDER,
      labels: Groups.TYPE_LABELS,
      style: root.style,
      readVar: (name) => getComputedStyle(root).getPropertyValue(name),
    });
  }
  return typeColorsDialogInstance;
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

/* Copia/incolla nei terminali.
 *
 * Perché serve codice dedicato: la selezione di xterm.js vive dentro il suo
 * renderer (canvas), non è una selezione del documento. Quindi né
 * `webContents.copy()` né il ruolo nativo "Copia" del menu vedono qualcosa:
 * il testo va preso con `term.getSelection()` e scritto negli appunti via IPC.
 *
 * Scorciatoie (Ctrl = Cmd su macOS):
 *   Ctrl+Shift+C / Cmd+C ....... copia la selezione
 *   Ctrl+C ..................... copia SOLO se c'è una selezione, altrimenti
 *                                passa al processo (SIGINT: non va rubato)
 *   Ctrl+Shift+V / Ctrl+V / Cmd+V  incolla
 *   Click destro ............... incolla (selezione presente: copia)
 *
 * Espone il globale `AisessClipboard`.
 */
(function () {
  const isMac = /mac/i.test(navigator.platform || '');

  async function copy(term) {
    if (!term || !term.hasSelection()) return false;
    const text = term.getSelection();
    if (!text) return false;
    try {
      const r = await window.aisess.clipboardWrite(text);
      if (!r || !r.ok) console.warn('copia negli appunti fallita:', r && r.error);
      return !!(r && r.ok);
    } catch (e) {
      console.error('copia negli appunti fallita', e);
      return false;
    }
  }

  async function paste(term) {
    if (!term) return false;
    try {
      const r = await window.aisess.clipboardRead();
      if (!r || !r.ok) { console.warn('lettura appunti fallita:', r && r.error); return false; }
      if (!r.text) return false;
      // term.paste() applica il bracketed paste quando la TUI lo richiede
      term.paste(r.text);
      return true;
    } catch (e) {
      console.error('lettura appunti fallita', e);
      return false;
    }
  }

  function selectAll(term) {
    if (!term) return false;
    term.selectAll();
    return true;
  }

  /** Esegue un'azione del menu Edit su un terminale. @returns {boolean} gestita */
  function applyEditAction(term, action) {
    if (!term) return false;
    switch (action) {
      case 'copy': copy(term); return true;
      case 'cut': copy(term); return true;   // in un terminale "taglia" = copia
      case 'paste': paste(term); return true;
      case 'selectAll': return selectAll(term);
      case 'undo': case 'redo': return true; // senza significato: non toccare il pty
      default: return false;
    }
  }

  /** Gestore per `term.attachCustomKeyEventHandler`: false = gestito qui.
   * xterm ne accetta uno solo per terminale: chi lo installa lo compone con
   * gli altri (renderer.js). */
  function keyHandler(term) {
    return (e) => {
      if (e.type !== 'keydown') return true;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return true;
      const key = (e.key || '').toLowerCase();
      // Tornare `false` ferma solo xterm: il browser eseguirebbe comunque
      // l'azione nativa (Ctrl+V -> evento `paste` sulla textarea di xterm ->
      // secondo incolla). Serve anche preventDefault.
      const handled = () => { e.preventDefault(); e.stopPropagation(); return false; };
      if (key === 'c') {
        // Ctrl+C senza selezione deve restare SIGINT
        if (!e.shiftKey && !isMac && !term.hasSelection()) return true;
        copy(term);
        return handled();
      }
      if (key === 'v') {
        paste(term);
        return handled();
      }
      if (key === 'a' && isMac) {
        selectAll(term);
        return handled();
      }
      return true;
    };
  }

  /** Click destro: copia se c'e' una selezione, altrimenti incolla. */
  function attachContextMenu(term, element) {
    if (!element) return;
    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) copy(term);
      else paste(term);
    });
  }

  window.AisessClipboard = { keyHandler, attachContextMenu, copy, paste, selectAll, applyEditAction };
})();

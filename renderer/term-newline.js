/* Shift+Invio = a capo, senza inviare il prompt.
 *
 * Le TUI di claude, codex e opencode inseriscono una riga nuova con
 * Shift+Invio, ma lo riconoscono solo nei terminali che parlano il
 * protocollo tastiera di kitty. xterm.js non lo parla: per lui Shift+Invio
 * e' Invio (\r), e il prompt parte a meta'.
 *
 * Tutte e tre le CLI accettano pero' anche Meta+Invio, cioe' ESC seguito da
 * CR (in codex `alt(Enter)`, in opencode `alt+return`, in claude
 * Option+Invio): e' la sequenza che xterm manda gia' per Alt+Invio, e tmux la
 * inoltra intatta al processo. Qui Shift+Invio viene tradotto in quella.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessNewline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const NEWLINE_SEQUENCE = '\x1b\r';

  /** @returns {string|null} la sequenza da inviare, o null se il tasto non ci riguarda */
  function newlineSequence(e) {
    if (!e || e.type !== 'keydown' || e.key !== 'Enter') return null;
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
    return NEWLINE_SEQUENCE;
  }

  /** Gestore per `term.attachCustomKeyEventHandler`: false = gestito qui. */
  function keyHandler(term) {
    return (e) => {
      const seq = newlineSequence(e);
      if (!seq) return true;
      // Tornare false ferma solo xterm: senza preventDefault il browser
      // metterebbe comunque un a capo nella textarea nascosta di xterm.
      e.preventDefault();
      e.stopPropagation();
      term.input(seq, true);
      return false;
    };
  }

  return { NEWLINE_SEQUENCE, newlineSequence, keyHandler };
});

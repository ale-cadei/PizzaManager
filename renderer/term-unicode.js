/* Larghezze dei caratteri nel terminale, uguali a quelle di psmux e tmux.
 *
 * Chi sta dietro al terminale (psmux su Windows, tmux su Mac) tiene la sua
 * griglia e la ridisegna su xterm.js per differenze. Se xterm conta un
 * carattere largo diversamente, da quel punto ogni ridisegno scrive spostato
 * di una colonna, e lo schermo si riempie di lettere sparse (docs/plans/52).
 *
 * Due correzioni, in ordine:
 * - Unicode 11 invece del default Unicode 6, dove molte emoji valgono 1
 *   colonna (addon @xterm/addon-unicode11);
 * - un simbolo seguito da U+FE0F (VS16, «versione emoji»: ⚔️ 🗺️ 🖥️) occupa 2
 *   colonne. Unicode 11 da solo somma 1 + 0 = 1; psmux e tmux allargano la
 *   cella (`variation-selector-always-wide` di tmux, sempre attivo in psmux).
 *   Qui come loro: VS16 su una cella larga 1 la porta a 2, mai oltre.
 *
 * `charProperties` e' l'API di xterm 5.5 per unire un carattere al
 * precedente: con una larghezza maggiore, xterm allarga la cella e sposta il
 * cursore (InputHandler.print). I bit sono quelli di UnicodeService, che xterm
 * non esporta: join nel bit 0, larghezza nei bit 1-2, il resto sopra.
 *
 * Wrapper UMD come gli altri moduli del renderer: globale nella pagina,
 * module.exports sotto Node per i test. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessTermUnicode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const VERSION = '11-vs16';
  const VS16 = 0xFE0F;

  const shouldJoin = (props) => (props & 1) !== 0;
  const width = (props) => (props >> 1) & 3;
  const withWidth = (props, w) => (props & ~6) | ((w & 3) << 1);

  /** Un fornitore che e' `base` (Unicode 11) piu' la regola di VS16. */
  function createProvider(base) {
    return {
      version: VERSION,
      wcwidth: (codepoint) => base.wcwidth(codepoint),
      charProperties(codepoint, preceding) {
        const props = base.charProperties(codepoint, preceding);
        if (codepoint === VS16 && shouldJoin(props) && width(preceding) === 1) return withWidth(props, 2);
        return props;
      },
    };
  }

  /**
   * Attiva le larghezze giuste su un terminale. Serve `allowProposedApi`:
   * term.unicode e' sperimentale in xterm 5. Se qualcosa manca resta il
   * default di xterm, come prima.
   *
   * `vs16Wide` solo con psmux, dove l'allargamento e' verificato nel sorgente
   * (vt100-psmux, screen.rs). In tmux e' un'opzione delle versioni recenti: con
   * un tmux che non allarga, la regola sposterebbe le colonne al contrario.
   */
  function install(term, Unicode11Addon, { vs16Wide = false } = {}) {
    // L'addon registra la sua tabella Unicode 11: la si prende e, se serve, la si avvolge.
    let base = null;
    new Unicode11Addon().activate({ unicode: { register: (p) => { base = p; } } });
    if (!base) return false;
    const provider = vs16Wide ? createProvider(base) : base;
    term.unicode.register(provider);
    term.unicode.activeVersion = provider.version;
    return true;
  }

  return { VERSION, createProvider, install, shouldJoin, width };
});

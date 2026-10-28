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
 *   Qui come loro: VS16 su una cella larga 1 la porta a 2, mai oltre;
 * - con psmux, le emoji arrivate dopo Unicode 11 (🥲 🫠 🪖 🫡…) valgono 2
 *   colonne e 🤻 🥆 1: psmux usa tabelle Unicode 16. Gli intervalli sono
 *   misurati sulla griglia di psmux 3.3.8 (`#{cursor_x}` dopo ogni carattere,
 *   tutto U+1F000-1FAFF); bandiere, sequenze ZWJ e toni della pelle in psmux
 *   e in xterm valevano gia' uguale.
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
  const VERSION = '11-psmux';
  const VS16 = 0xFE0F;
  // Larghe 2 in psmux, 1 in Unicode 11.
  const PSMUX_WIDE = [
    [0x1F6D6, 0x1F6D8], [0x1F6DC, 0x1F6DF], [0x1F6FB, 0x1F6FC], [0x1F7F0, 0x1F7F0],
    [0x1F90C, 0x1F90C], [0x1F972, 0x1F972], [0x1F977, 0x1F979], [0x1F9A3, 0x1F9A4],
    [0x1F9AB, 0x1F9AD], [0x1F9CB, 0x1F9CC], [0x1FA74, 0x1FA77], [0x1FA7B, 0x1FA7C],
    [0x1FA83, 0x1FA8A], [0x1FA8E, 0x1FA8F], [0x1FA96, 0x1FAC6], [0x1FAC8, 0x1FAC8],
    [0x1FACD, 0x1FADC], [0x1FADF, 0x1FAEA], [0x1FAEF, 0x1FAF8],
  ];
  // Larghe 1 in psmux, 2 in Unicode 11.
  const PSMUX_NARROW = [0x1F93B, 0x1F946];

  const shouldJoin = (props) => (props & 1) !== 0;
  const width = (props) => (props >> 1) & 3;
  const withWidth = (props, w) => (props & ~6) | ((w & 3) << 1);

  /** La larghezza di psmux dove e' diversa da Unicode 11, se no null. */
  function psmuxWidth(codepoint) {
    if (codepoint < 0x1F6D6 || codepoint > 0x1FAF8) return null;
    if (PSMUX_NARROW.includes(codepoint)) return 1;
    return PSMUX_WIDE.some(([a, b]) => codepoint >= a && codepoint <= b) ? 2 : null;
  }

  /** Un fornitore che e' `base` (Unicode 11) con le larghezze di psmux. */
  function createProvider(base) {
    return {
      version: VERSION,
      wcwidth: (codepoint) => psmuxWidth(codepoint) ?? base.wcwidth(codepoint),
      charProperties(codepoint, preceding) {
        const props = base.charProperties(codepoint, preceding);
        if (codepoint === VS16 && shouldJoin(props) && width(preceding) === 1) return withWidth(props, 2);
        const w = psmuxWidth(codepoint);
        return w === null ? props : withWidth(props, w);
      },
    };
  }

  function unicode11(Unicode11Addon) {
    // L'addon registra la sua tabella Unicode 11: la si prende per avvolgerla.
    let base = null;
    new Unicode11Addon().activate({ unicode: { register: (p) => { base = p; } } });
    return base;
  }

  /**
   * Toglie lo spazio di troppo che il client psmux 3.3.8 scrive dopo un
   * simbolo allargato da VS16. Quando ridisegna un pezzo di riga di seguito,
   * scrive la seconda meta' della cella larga come uno spazio, invece di
   * saltarla: «🖥️: Bingo» diventa «🖥️ :» e cio' che segue finisce una colonna
   * piu' in la'. Restano lettere vecchie dove dovevano esserci spazi.
   * Misurato col client vero (docs/plans/52): dopo un'emoji larga di natura il
   * client sposta sempre il cursore, e dopo una allargata da VS16 o sposta il
   * cursore o scrive quello spazio. Uno spazio vero dopo l'emoji arriva come
   * secondo spazio, quindi se ne toglie uno solo. Da riverificare quando
   * cambia la versione di psmux.
   *
   * Lo stato attraversa i pezzi: l'emoji puo' chiudere un pezzo e lo spazio
   * aprire il successivo.
   */
  function createOutputFilter(Unicode11Addon) {
    const base = unicode11(Unicode11Addon);
    if (!base) return (data) => data;
    const { wcwidth } = createProvider(base);
    let last = 0;
    let dropSpace = false;
    return (data) => {
      let s = data;
      if (dropSpace && s[0] === ' ') s = s.slice(1);
      dropSpace = false;
      if (!s) return s;
      if (s.indexOf('️') === -1) {
        const end = s.charCodeAt(s.length - 1);
        last = end >= 0xDC00 && end <= 0xDFFF && s.length > 1 ? s.codePointAt(s.length - 2) : end;
        return s;
      }
      let out = '';
      let prev = last;
      for (let i = 0; i < s.length;) {
        const cp = s.codePointAt(i);
        const next = i + (cp > 0xFFFF ? 2 : 1);
        out += s.slice(i, next);
        i = next;
        if (cp === VS16 && wcwidth(prev) === 1) {
          if (i === s.length) dropSpace = true;
          else if (s[i] === ' ') i++;
        }
        prev = cp;
      }
      last = prev;
      return out;
    };
  }

  /**
   * Attiva le larghezze giuste su un terminale. Serve `allowProposedApi`:
   * term.unicode e' sperimentale in xterm 5. Se qualcosa manca resta il
   * default di xterm, come prima.
   *
   * `psmux`: la regola di VS16 vale solo con psmux, dove l'allargamento e'
   * verificato nel sorgente (vt100-psmux, screen.rs). In tmux e' un'opzione
   * delle versioni recenti: con un tmux che non allarga, la regola sposterebbe
   * le colonne al contrario.
   */
  function install(term, Unicode11Addon, { psmux = false } = {}) {
    const base = unicode11(Unicode11Addon);
    if (!base) return false;
    const provider = psmux ? createProvider(base) : base;
    term.unicode.register(provider);
    term.unicode.activeVersion = provider.version;
    return true;
  }

  return { VERSION, createProvider, createOutputFilter, install, shouldJoin, width };
});

/* Il pesce: nuota ondeggiando, e chiama soffiando bolle.
 * Disegno del pacchetto «Spritelli»: griglie ricavate dai PNG 1x nel
 * formato di pets-sprites.js, che lo fonde nel suo catalogo (AisessPetsPack).
 * Pose dalle animazioni del pacchetto.
 *
 * File generato: si ritocca il pacchetto, non queste righe.
 *
 * Wrapper UMD come gli altri moduli del renderer: in pagina i personaggi
 * del pacchetto si sommano nello stesso oggetto. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessPetsPack = Object.assign({}, root.AisessPetsPack, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // ---- Il pesce: nuota ondeggiando, e chiama soffiando bolle (17×12) ----
  const PESCE_FISH_SWIM_1 = [
    '........aa.......',
    '.......abbaa.....',
    '..a...abbbbba....',
    '.aba.accccccca...',
    '.abbaccccccccca..',
    '.abbbcccccccdaca.',
    '.abbcccccccccccca',
    '.abbbceeeeeeecca.',
    '.abbaaeeeeeeeea..',
    '.aba..aeeeeeaa...',
    '..a...abbaaa.....',
    '.......aa........',
  ];
  const PESCE_FISH_SWIM_2 = [
    '........aa.......',
    '.......abbaa.....',
    '......abbbbba....',
    '...a.accccccca...',
    '..abaccccccccca..',
    '.abbbcccccccdaca.',
    'abbbcccccccccccca',
    '.abbbceeeeeeecca.',
    '..abaaeeeeeeeea..',
    '...a..aeeeeeaa...',
    '......abbaaa.....',
    '.......aa........',
  ];
  const PESCE_FISH_SLEEP = [
    '........aa.......',
    '.......abbaa.....',
    '..a...abbbbba....',
    '.aba.accccccca...',
    '.abbaccccccccca..',
    '.abbbcccccccaaca.',
    '.abbcccccccccccca',
    '.abbbceeeeeeecca.',
    '.abbaaeeeeeeeea..',
    '.aba..aeeeeeaa...',
    '..a...abbaaa.....',
    '.......aa........',
  ];
  const PESCE_FISH_BLOW = [
    '........aa.......',
    '.......abbaa.....',
    '..a...abbbbba....',
    '.aba.accccccca...',
    '.abbaccccccccca..',
    '.abbbcccccccdaca.',
    '.abbcccccccccccaa',
    '.abbbceeeeeeecca.',
    '.abbaaeeeeeeeea..',
    '.aba..aeeeeeaa...',
    '..a...abbaaa.....',
    '.......aa........',
  ];
  const PESCE_BOLLE_1 = [
    '.......',
    '.......',
    '.......',
    '.......',
    '..f....',
    '.f.f...',
    '..f....',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ];
  const PESCE_BOLLE_2 = [
    '..fff..',
    '.f...f.',
    '.f...f.',
    '.f...f.',
    '..fff..',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ];
  const PESCE_BOLLE_3 = [
    '....f..',
    '...f.f.',
    '....f..',
    '.......',
    '.......',
    '..f....',
    '.f.f...',
    '..f....',
    '.......',
    '.......',
    '.......',
    '.......',
  ];

  return {
    pesce: {
      speed: 0.7,
      motion: 'swim',
      palette: { a: '#2B2233', b: '#3A86A8', c: '#5FB7D6', d: '#F7F3EA', e: '#C4EBF5', f: '#9FD6EA' },
      variants: [
        { b: '#C8561E', c: '#F2833A', e: '#FFFFFF' },
        { b: '#3C8A34', c: '#5DBB4A', e: '#C8E88A' },
        { b: '#9A4A9A', c: '#C86BC8', e: '#F4D0F4' },
      ],
      bubbles: [PESCE_BOLLE_1, PESCE_BOLLE_2, PESCE_BOLLE_3],
      frames: {
        walk: [PESCE_FISH_SWIM_1, PESCE_FISH_SWIM_2],
        sleep: [PESCE_FISH_SLEEP],
        call: [PESCE_FISH_BLOW],
      },
    },
  };
});

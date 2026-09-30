/* L'anatroccolo: va dietro alla papera.
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
  // ---- L'anatroccolo: va dietro alla papera (11×11) ----
  const ANATROCCOLO_DUCKLING_WALK_1 = [
    '.....aaa...',
    '....abbbaa.',
    '...abbbabca',
    '...abbbbba.',
    '.a..abbba..',
    'abaabbbbba.',
    'abbbbbbbbba',
    'abddddbbbba',
    '.abbbbbbba.',
    '..aacaaca..',
    '....a..a...',
  ];
  const ANATROCCOLO_DUCKLING_WALK_2 = [
    '.....aaa...',
    '....abbbaa.',
    '...abbbabca',
    '...abbbbba.',
    '.a..abbba..',
    'abaabbbbba.',
    'abbbbbbbbba',
    'abddddbbbba',
    '.abbbbbbba.',
    '..aaaccaa..',
    '.....aa....',
  ];
  const ANATROCCOLO_DUCKLING_SLEEP = [
    '.....aaa...',
    '....abbbaa.',
    '...abbbdbca',
    '...abbbbba.',
    '.a..abbba..',
    'abaabbbbba.',
    'abbbbbbbbba',
    'abddddbbbba',
    '.abbbbbbba.',
    '..aacaaca..',
    '....a..a...',
  ];

  return {
    anatroccolo: {
      speed: 0.7,
      motion: 'walk',
      palette: { a: '#2B2233', b: '#FFD447', c: '#F39A36', d: '#E3A92C' },
      frames: {
        walk: [ANATROCCOLO_DUCKLING_WALK_1, ANATROCCOLO_DUCKLING_WALK_2],
        sleep: [ANATROCCOLO_DUCKLING_SLEEP],
        call: [ANATROCCOLO_DUCKLING_WALK_1],
      },
    },
  };
});

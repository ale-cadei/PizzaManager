/* La chiocciola: lenta, e per chiamare dondola le antenne.
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
  // ---- La chiocciola: lenta, e per chiamare dondola le antenne (15×14) ----
  const CHIOCCIOLA_SNAIL_WALK_1 = [
    '..........a.a..',
    '.........aaaaa.',
    '.........ababa.',
    '....aaaa.ababa.',
    '...accccaabbba.',
    '..acdddccabbba.',
    '.acdcccdccbbba.',
    '.acdcdcdccbba..',
    '.acdcddcccbba..',
    '.accdcccccbba..',
    '.aaccccccbbbaa.',
    'abbbbbbbbbbbbba',
    '.aeeeeeeeeeeea.',
    '..aaaaaaaaaaa..',
  ];
  const CHIOCCIOLA_SNAIL_WALK_2 = [
    '...............',
    '..........a.a..',
    '.........aaaaa.',
    '....aaaa.ababa.',
    '...accccaabbba.',
    '..acdddccabbba.',
    '.acdcccdccbbba.',
    '.acdcdcdccbba..',
    '.acdcddcccbba..',
    '.accdcccccbba..',
    '..accccccbbbaa.',
    '.abbbbbbbbbbbba',
    '..aeeeeeeeeeea.',
    '...aaaaaaaaaa..',
  ];
  const CHIOCCIOLA_SNAIL_SLEEP = [
    '...............',
    '...............',
    '...............',
    '...............',
    '.....aaaa......',
    '....acccca.....',
    '...acdddcca....',
    '..acdcccdcca...',
    '..acdcdcdcca...',
    '..acdcddccca...',
    '..accdccccca...',
    '...acccccca....',
    '..aeeeeeeeea...',
    '...aaaaaaaa....',
  ];

  return {
    chiocciola: {
      speed: 0.2,
      motion: 'walk',
      palette: { a: '#2B2233', b: '#B8CC7C', c: '#D98B4F', d: '#9B5A2C', e: '#86A052' },
      frames: {
        walk: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
        sleep: [CHIOCCIOLA_SNAIL_SLEEP],
        call: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
      },
    },
  };
});

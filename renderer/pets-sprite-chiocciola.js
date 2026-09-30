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
  // ---- La chiocciola: lenta, e per chiamare dondola le antenne (26×26) ----
  const CHIOCCIOLA_SNAIL_WALK_1 = [
    '..................aa..aa..',
    '..................aa..aa..',
    '..................aa..aa..',
    '..................aa..aa..',
    '..................baaaab..',
    '..................bbaabb..',
    '..................bbaabb..',
    '..................bbaabb..',
    '.......cccccc....abbbbbb..',
    '.....cccccccccc.aabbbbbb..',
    '.....cddddddccccaabbbbbb..',
    '...ccddddddddccccabbbbbb..',
    '...cdddccccdddccccbbbbbb..',
    '..ccddccccccddccccbbbbb...',
    '..ccddccddccddccccbbbbb...',
    '..ccddccddccddccccbbbb....',
    '..ccddccdddddcccccbbbb....',
    '..ccddcccdddccccccbbbb....',
    '..cccddddcccccccccbbbb....',
    '..ccccddcccccccccbbbbb....',
    '..accccccccccccccbbbbba...',
    '..aacccccccccccbbbbbbbba..',
    'bbbbbbbbbbbbbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbbbbbbbbbbbbb',
    '..eeeeeeeeeeeeeeeeeeeeee..',
    '...eeeeeeeeeeeeeeeeeeee...',
  ];
  const CHIOCCIOLA_SNAIL_WALK_2 = [
    '..........................',
    '..........................',
    '..................aa..aa..',
    '..................aa..aa..',
    '..................aa..aa..',
    '..................aa..aa..',
    '..................baaaab..',
    '..................bbaabb..',
    '.......cccccc....abbbbbb..',
    '.....cccccccccc.aabbbbbb..',
    '.....cddddddccccaabbbbbb..',
    '...ccddddddddccccabbbbbb..',
    '...cdddccccdddccccbbbbbb..',
    '..ccddccccccddccccbbbbb...',
    '..ccddccddccddccccbbbbb...',
    '..ccddccddccddccccbbbb....',
    '..ccddccdddddcccccbbbb....',
    '..ccddcccdddccccccbbbb....',
    '..cccddddcccccccccbbbb....',
    '...cccddcccccccccbbbbb....',
    '...ccccccccccccccbbbbba...',
    '....cccccccccccbbbbbbbba..',
    '..bbbbbbbbbbbbbbbbbbbbbbbb',
    '..bbbbbbbbbbbbbbbbbbbbbbbb',
    '....eeeeeeeeeeeeeeeeeeee..',
    '.....eeeeeeeeeeeeeeeeee...',
  ];
  const CHIOCCIOLA_SNAIL_SLEEP = [
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '.........cccccc...........',
    '.......cccccccccc.........',
    '.......cddddddccc.........',
    '.....ccddddddddcccc.......',
    '.....cdddccccdddccc.......',
    '....ccddccccccddcccc......',
    '....ccddccddccddcccc......',
    '....ccddccddccddcccc......',
    '....ccddccdddddccccc......',
    '....ccddcccdddcccccc......',
    '....cccddddccccccccc......',
    '.....cccddccccccccc.......',
    '.....cccccccccccccc.......',
    '......cccccccccccc........',
    '....eeeeeeeeeeeeeeee......',
    '....eeeeeeeeeeeeeeee......',
  ];

  return {
    chiocciola: {
      speed: 0.2,
      motion: 'walk',
      height: 0.812,
      palette: { a: '#2B2233', b: '#B8CC7C', c: '#D98B4F', d: '#9B5A2C', e: '#86A052' },
      frames: {
        walk: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
        sleep: [CHIOCCIOLA_SNAIL_SLEEP],
        call: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
      },
    },
  };
});

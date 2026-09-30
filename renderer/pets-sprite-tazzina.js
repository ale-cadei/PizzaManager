/* La tazzina di caffè: saltella fumando, e da fredda dorme.
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
  // ---- La tazzina di caffè: saltella fumando, e da fredda dorme (26×26) ----
  const TAZZINA_COFFEE_LAND = [
    '..........................',
    '..........................',
    '......aa......aa..........',
    '......aaa.....aaa.........',
    '........aa......aa........',
    '........aa......aa........',
    '......aaa.....aaa.........',
    '......aa......aa..........',
    '...bbbbbbbbbbbbbbbb.......',
    '.bbbbbbbbbbbbbbbbbbbb.....',
    '.bbccccccccccccccccbb.....',
    'bbccccccccccccccccccbbb...',
    'bbccddddddddddddddccbbb...',
    'bbccddddddddddddddcccbbbb.',
    'bbcccccccccccccccccccccbb.',
    'bbccccccccccccccccccccccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbcceecccccccccceeccccccbb',
    '.bbceecccccccccceecccccbb.',
    '.bbccccccccccccccccbbbbbb.',
    '...bbccccccccccccbbbbbb...',
    '...bbccccccccccccbb.......',
    '.....bbccccccccbb.........',
    '.....bbbbbbbbbbbb.........',
    '.......bbbbbbbb...........',
  ];
  const TAZZINA_COFFEE_HOP_1 = [
    '......aa......aa..........',
    '......aaa.....aaa.........',
    '........aa......aa........',
    '........aa......aa........',
    '......aaa.....aaa.........',
    '......aa......aa..........',
    '...bbbbbbbbbbbbbbbb.......',
    '.bbbbbbbbbbbbbbbbbbbb.....',
    '.bbccccccccccccccccbb.....',
    'bbccccccccccccccccccbbb...',
    'bbccddddddddddddddccbbb...',
    'bbccddddddddddddddcccbbbb.',
    'bbcccccccccccccccccccccbb.',
    'bbccccccccccccccccccccccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbcceecccccccccceeccccccbb',
    'bbcceecccccccccceecccccbb.',
    'bbccccccccbbcccccccccbbbb.',
    '.bbcccccccbbcccccccbbbb...',
    '.bbccccccccccccccccbb.....',
    '...bbccccccccccccbb.......',
    '...bbccccccccccccbb.......',
    '.....bbccccccccbb.........',
    '.....bbbbbbbbbbbb.........',
    '.......bbbbbbbb...........',
  ];
  const TAZZINA_COFFEE_HOP_2 = [
    '........aa......aa........',
    '.......aaa.....aaa........',
    '......aa......aa..........',
    '......aa......aa..........',
    '.......aaa.....aaa........',
    '........aa......aa........',
    '...bbbbbbbbbbbbbbbb.......',
    '.bbbbbbbbbbbbbbbbbbbb.....',
    '.bbccccccccccccccccbb.....',
    'bbccccccccccccccccccbbb...',
    'bbccddddddddddddddccbbb...',
    'bbccddddddddddddddcccbbbb.',
    'bbcccccccccccccccccccccbb.',
    'bbccccccccccccccccccccccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbccccbbccccccbbccccbbccbb',
    'bbcceecccccccccceeccccccbb',
    'bbcceecccccccccceecccccbb.',
    'bbccccccccbbcccccccccbbbb.',
    '.bbcccccccbbcccccccbbbb...',
    '.bbccccccccccccccccbb.....',
    '...bbccccccccccccbb.......',
    '...bbccccccccccccbb.......',
    '.....bbccccccccbb.........',
    '.....bbbbbbbbbbbb.........',
    '.......bbbbbbbb...........',
  ];
  const TAZZINA_COFFEE_SLEEP = [
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '...bbbbbbbbbbbbbbbb.......',
    '.bbbbbbbbbbbbbbbbbbbb.....',
    '.bbccccccccccccccccbb.....',
    'bbccccccccccccccccccbbb...',
    'bbccddddddddddddddccbbb...',
    'bbccddddddddddddddcccbbbb.',
    'bbcccccccccccccccccccccbb.',
    'bbccccccccccccccccccccccbb',
    'bbcccbbbccccccbbbcccbbccbb',
    'bbccbbbbccccccbbbbccbbccbb',
    'bbcceecccccccccceeccccccbb',
    '.bbceecccccccccceecccccbb.',
    '.bbccccccccccccccccbbbbbb.',
    '...bbccccccccccccbbbbbb...',
    '...bbccccccccccccbb.......',
    '.....bbccccccccbb.........',
    '.....bbbbbbbbbbbb.........',
    '.......bbbbbbbb...........',
  ];

  return {
    tazzina: {
      speed: 1.2,
      motion: 'hop',
      height: 0.812,
      palette: { a: '#CFC8BD', b: '#2B2233', c: '#F7F3EA', d: '#6E4126', e: '#F2A4B4' },
      frames: {
        walk: [TAZZINA_COFFEE_LAND, TAZZINA_COFFEE_LAND],
        jump: [TAZZINA_COFFEE_HOP_1, TAZZINA_COFFEE_HOP_2],
        sleep: [TAZZINA_COFFEE_SLEEP],
        call: [TAZZINA_COFFEE_HOP_1, TAZZINA_COFFEE_LAND],
      },
    },
  };
});

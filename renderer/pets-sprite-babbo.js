/* Babbo Natale con la slitta, vola.
 * Disegno del pacchetto «Sprite pixel-art originale»: griglie ricavate dai PNG 1x nel
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
  // ---- Babbo Natale con la slitta, vola (52×20) ----
  const BABBO_VOLO_1 = [
    '....................................................',
    '....................................................',
    '.............bbbb...................................',
    '........dda.bbbbbb..................................',
    '........ddabbbbbbbb.............................i.i.',
    '...........ddddddddd............................iii.',
    '............eeeeaeee..............i.i...........aa..',
    '.j..........deeeeefe..............iii..........ggag.',
    '...........ddddeeddd..............aa...........ggggm',
    '..........bddddddddd.............ggag...........hh..',
    '.....bb..bbadddddabb.............gggg..........gg...',
    '.....bbaaaaaaaaaaaaaa.b.kkkkkkkkkahh.kk.gggggggjg...',
    '...jabjjjjjjjjjjjjjjjb.....aaaaaagg....hagggggggg...',
    '.....bbbbbbbbbbbbbbbb.....gggggggjg.....hhhhhhhhh...',
    '......cccccccccccccc.....hagggggggg.................',
    '.......a........a.........hhhhhhhhh.......a...a.....',
    '.......j........j.....j.............................',
    '.....kjjjjjjjjjjjjjjjjk..a.........a................',
    '........................a...........a...............',
    '....................................................',
  ];
  const BABBO_VOLO_2 = [
    '....................................................',
    '.............bbbb...................................',
    '........dda.bbbbbb..................................',
    '........ddabbbbbbbb.................................',
    '..j........ddddddddd................................',
    '............eeeeaeee..............i.i...........i.i.',
    '............deeeeefe..............iii...........iii.',
    '...........ddddeeddd..............aa............aa..',
    '..........bddddddddd.............ggag..........ggag.',
    'j....bb..bbadddddabb.............gggg..........ggggl',
    '.....bbaaaaaaaaaaaaaa.b.kkkkkkkkkahh.kkkkkkkkkkahh..',
    '.....bjjjjjjjjjjjjjjjb.....aaaaaagg......aaaaaagg...',
    '.....bbbbbbbbbbbbbbbb.....gggggggjg.....gggggggjg...',
    '......cccccccccccccc.....hagggggggg....hagggggggg...',
    '.......a........a.........hhhhhhhhh.....hhhhhhhhh...',
    '.......j........j.....j...a.......a.....a.......a...',
    '.....kjjjjjjjjjjjjjjjjk...a.......a.....a.......a...',
    '..........................a.......a.....a.......a...',
    '....................................................',
    '....................................................',
  ];
  const BABBO_VOLO_3 = [
    '....................................................',
    '....................................................',
    '.............bbbb...................................',
    '........dda.bbbbbb..................................',
    '........ddabbbbbbbb...............i.i...............',
    '...........ddddddddd..............iii...............',
    '............eeeeaeee..............aa............i.i.',
    '............deeeeefe.............ggag...........iii.',
    '...j.......ddddeeddd.............gggg...........aa..',
    '..........bddddddddd..............hh...........ggag.',
    '.....bb..bbadddddabb.............gg............ggggm',
    '.....bbaaaaaaaaaaaaaa.b.k.gggggggjgakkkkkkkkkkkahh..',
    '.....bjjjjjjjjjjjjjjjb...hagggggggg......aaaaaagg...',
    '.j...bbbbbbbbbbbbbbbb.....hhhhhhhhh.....gggggggjg...',
    '......cccccccccccccc...................hagggggggg...',
    '.......a........a...........a...a.......hhhhhhhhh...',
    '.......j........j.....j.............................',
    '.....kjjjjjjjjjjjjjjjjk................a.........a..',
    '......................................a...........a.',
    '....................................................',
  ];
  const BABBO_VOLO_4 = [
    '....................................................',
    '....................................................',
    '....................................................',
    '.............bbbb...................................',
    '........dda.bbbbbb..................................',
    '........ddabbbbbbbb...............i.i...........i.i.',
    '...........ddddddddd..............iii...........iii.',
    'j...........eeeeaeee..............aa............aa..',
    '............deeeeefe.............ggag..........ggag.',
    '...........ddddeeddd.............gggg..........ggggl',
    '..........bddddddddd..............hh............hh..',
    '.....bb..bbadddddabb.............gg............gg...',
    '..j..bbaaaaaaaaaaaaaa.b.k.gggggggjgakkk.gggggggjg...',
    '.....bjjjjjjjjjjjjjjjb...hagggggggg....hagggggggg...',
    '.....bbbbbbbbbbbbbbbb.....hhhhhhhhh.....hhhhhhhhh...',
    '......cccccccccccccc......a.......a.....a.......a...',
    '.......a........a.........a.......a.....a.......a...',
    '.......j........j.....j...a.......a.....a.......a...',
    '.....kjjjjjjjjjjjjjjjjk.............................',
    '....................................................',
  ];

  return {
    babbo: {
      speed: 1.2,
      motion: 'fly',
      palette: { a: '#1F1420', b: '#D32F3A', c: '#8E1C2A', d: '#F4F1EA', e: '#F2B58A', f: '#E0806A', g: '#8A5530', h: '#C08850', i: '#E0C080', j: '#F2C14E', k: '#B8862A', l: '#FF3B3B', m: '#9A2030' },
      frames: {
        walk: [BABBO_VOLO_1, BABBO_VOLO_2, BABBO_VOLO_3, BABBO_VOLO_4],
        sleep: [BABBO_VOLO_1],
        call: [BABBO_VOLO_1],
      },
    },
  };
});

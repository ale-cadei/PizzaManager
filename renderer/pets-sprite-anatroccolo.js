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
  // ---- L'anatroccolo: va dietro alla papera (18×20) ----
  const ANATROCCOLO_DUCKLING_STEP_1 = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaabbaacc',
    '......aaaaaabbaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaa...',
    '......dd....cc....',
    '.....ddd....ccc...',
    '....dddd.....ccccc',
    '....ddd.......cccc',
  ];
  const ANATROCCOLO_DUCKLING_PASS_1 = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaabbaacc',
    '......aaaaaabbaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaa...',
    '......dddd..cc....',
    '.......dd...ccc...',
    '............cccc..',
    '.............ccc..',
  ];
  const ANATROCCOLO_DUCKLING_STEP_2 = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaabbaacc',
    '......aaaaaabbaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaa...',
    '......cc....dd....',
    '.....ccc....ddd...',
    '....cccc.....ddddd',
    '....ccc.......dddd',
  ];
  const ANATROCCOLO_DUCKLING_PASS_2 = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaabbaacc',
    '......aaaaaabbaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaaa..',
    '......dd....cccc..',
    '......ddd....cc...',
    '......dddd........',
    '.......ddd........',
  ];
  const ANATROCCOLO_DUCKLING_SLEEP = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaaddaacc',
    '......aaaaaaddaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaa...',
    '......dd....cc....',
    '......ddd...ccc...',
    '......dddd..cccc..',
    '.......ddd...ccc..',
  ];
  const ANATROCCOLO_DUCKLING_STAND = [
    '.........aaaa.....',
    '.......aaaaaaaa...',
    '.......aaaaabbaacc',
    '......aaaaaabbaacc',
    '......aaaaaaaaaa..',
    '.......aaaaaaaa...',
    '........aaaaaa....',
    '........aaaaaa....',
    'aa.....aaaaaaaa...',
    'aaa..aaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaa.',
    'aaaaaaaaaaaaaaaaaa',
    'aaddddddddaaaaaaaa',
    '.addddddddaaaaaaa.',
    '.aaaaaaaaaaaaaaaa.',
    '...aaaaaaaaaaaa...',
    '......dd....cc....',
    '......ddd...ccc...',
    '......dddd..cccc..',
    '.......ddd...ccc..',
  ];

  return {
    anatroccolo: {
      speed: 0.7,
      motion: 'walk',
      height: 0.625,
      palette: { a: '#FFD447', b: '#2B2233', c: '#F39A36', d: '#E3A92C' },
      frames: {
        walk: [ANATROCCOLO_DUCKLING_STEP_1, ANATROCCOLO_DUCKLING_PASS_1, ANATROCCOLO_DUCKLING_STEP_2, ANATROCCOLO_DUCKLING_PASS_2],
        sleep: [ANATROCCOLO_DUCKLING_SLEEP],
        call: [ANATROCCOLO_DUCKLING_STAND],
      },
    },
  };
});

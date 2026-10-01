/* L'ape: vola, e si posa sul suo fiore per dormire e per chiamare.
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
  // ---- L'ape: vola, e si posa sul suo fiore per dormire e per chiamare (28×20) ----
  const APE_BEE_FLY_1 = [
    '.......aaaa......aaaa.......',
    '.....aaaaaaa....aaaaaaa.....',
    '.....aaaaaaabbbbaaaaaaa.....',
    '....aaaaaaaabbbbaaaaaaaa....',
    '....aaaaaaaabbbbaaaaaaaa....',
    '.....aaaaaabbbbbbaaaaaa.....',
    '.....aaaaaabbbbbbaaaaaa.....',
    '......aaaabbbbbbbbaaaa......',
    '.....cccddddccccddddccc.....',
    '...cccccddddccccddddccccc...',
    '...cccccddddccccddddccbbc...',
    '..ccccccddddccccddddccbbccc.',
    'ddccccccddddccccddddcccccccc',
    'ddccccccddddccccddddcccccccc',
    '..ccccccddddccccddddccccccc.',
    '...cccccddddccccddddccccc...',
    '...cccccddddccccddddccccc...',
    '.....cccddddccccddddccc.....',
    '............................',
    '............................',
  ];
  const APE_BEE_FLY_2 = [
    '............................',
    '............................',
    '............................',
    '............................',
    '.......aa..........aa.......',
    '.....aaaaaa......aaaaaa.....',
    '.....aaaaaa......aaaaaa.....',
    '....aaaaaaaa....aaaaaaaa....',
    '....ccccddddccccddddcccc....',
    '...cccccddddccccddddccccc...',
    '...cccccddddccccddddccbbc...',
    '..ccccccddddccccddddccbbccc.',
    'ddccccccddddccccddddcccccccc',
    'ddccccccddddccccddddcccccccc',
    '..ccccccddddccccddddccccccc.',
    '...cccccddddccccddddccccc...',
    '...cccccddddccccddddccccc...',
    '.....cccddddccccddddccc.....',
    '............................',
    '............................',
  ];
  const APE_BEE_REST = [
    '............................',
    '............................',
    '............................',
    '............................',
    '...aaaa.....................',
    '.aaaaaaaa...................',
    'aaaaaaaaaaa.................',
    'aaaaaaaaaaaa................',
    '..bbccccddddccccddddccc.....',
    '..bcccccddddccccddddccccc...',
    '..ccccccddddccccddddccbbc...',
    '..ccccccddddccccddddccbbccc.',
    'ddccccccddddccccddddcccccccc',
    'ddccccccddddccccddddcccccccc',
    '..ccccccddddccccddddccccccc.',
    '...cccccddddccccddddccccc...',
    '...cccccddddccccddddccccc...',
    '.....cccddddccccddddccc.....',
    '........ddd.....ddd.........',
    '........dd......dd..........',
  ];
  const APE_PERCH = [
    '...........eeeeee...........',
    '.........eeeeeeeeee.........',
    '.........eeeeeeeeee.........',
    '.......eeeeeeeeeeeeee.......',
    '...eeeeeeeeeeffeeeeeeeeee...',
    '.eeeeeeeeeeffffffeeeeeeeeee.',
    '.eeeeeeeeeeffffffeeeeeeeeee.',
    'eeeeeeeeeeffffffffeeeeeeeeee',
    'eeeeeeeeeeffffffffeeeeeeeeee',
    '.eeeeeeeeeeffffffeeeeeeeeee.',
    '..geeeeeeeeffffffeeeeeeeeg..',
    '...geeeeeeeeeffeeeeeeeeeg...',
    '........geeeeeeeeeeg........',
    '.........geeeeeeeeg.........',
    '..........eeeeeeee..........',
    '...........eeeeee...........',
    '............hhhh............',
    '............hhhh............',
    '.....ii....bhhhh............',
    '....iiiii.bbhhhh............',
    '....iiiiiibbhhhhb....iii....',
    '.....iiiiiibhhhhbb.iiiii....',
    '.....iiiiiiihhhhiiiiiii.....',
    '.......iiiiihhhhiiiii.......',
    '..........bbhhhhbb..........',
    '...........bhhhhb...........',
    '............hhhh............',
    '.............hh.............',
  ];

  return {
    ape: {
      speed: 0.9,
      motion: 'fly',
      height: 0.625,
      palette: { a: '#D9F0FA', b: '#2B2233', c: '#FFCF3D', d: '#3B3342', e: '#F28AB5', f: '#F0A830', g: '#D9669A', h: '#4F8F3F', i: '#7CBF5A' },
      perch: { grid: APE_PERCH, seat: 26 },
      frames: {
        walk: [APE_BEE_FLY_1, APE_BEE_FLY_2],
        sleep: [APE_BEE_REST],
        call: [APE_BEE_FLY_1, APE_BEE_REST],
      },
    },
  };
});

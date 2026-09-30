/* La papera: cammina con gli anatroccoli dietro, e chiama facendo qua qua.
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
  // ---- La papera: cammina con gli anatroccoli dietro, e chiama facendo qua qua (26×26) ----
  const PAPERA_DUCK_WALK_1 = [
    '...............aaaa.......',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '............aaaaaaaaaa....',
    '............aaaaaabbaacccc',
    '............aaaaaabbaacccc',
    '............aaaaaaaaaa....',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '..............aaaaaa......',
    '..............aaaaaa......',
    '.............aaaaaaa......',
    'aa...........aaaaaaa......',
    'aaa........aaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaaaa...',
    'aaaadddddddddaaaaaaaaaa...',
    '.aaaddddddddddaaaaaaaaaa..',
    '.aaaadddddddddaaaaaaaaaa..',
    '...aaaaddddddaaaaaaaaaa...',
    '...aaaaaaaaaaaaaaaaaaaa...',
    '.....aaaaaaaaaaaaaaaa.....',
    '......bbccbbbbbbccbb......',
    '......bcccbbbbbcccb.......',
    '......cccc....cccc........',
    '.......cc......cc.........',
  ];
  const PAPERA_DUCK_WALK_2 = [
    '...............aaaa.......',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '............aaaaaaaaaa....',
    '............aaaaaabbaacccc',
    '............aaaaaabbaacccc',
    '............aaaaaaaaaa....',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '..............aaaaaa......',
    '..............aaaaaa......',
    '.............aaaaaaa......',
    'aa...........aaaaaaa......',
    'aaa........aaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaaaa...',
    'aaaadddddddddaaaaaaaaaa...',
    '.aaaddddddddddaaaaaaaaaa..',
    '.aaaadddddddddaaaaaaaaaa..',
    '...aaaaddddddaaaaaaaaaa...',
    '...aaaaaaaaaaaaaaaaaaaa...',
    '.....aaaaaaaaaaaaaaaa.....',
    '......bbbbccbbbbccbb......',
    '.......bbcccbbbcccb.......',
    '........cccc..cccc........',
    '.........cc....cc.........',
  ];
  const PAPERA_DUCK_SLEEP = [
    '...............aaaa.......',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '............aaaaaaaaaa....',
    '............aaaaaaddaacccc',
    '............aaaaaaddaacccc',
    '............aaaaaaaaaa....',
    '.............aaaaaaaa.....',
    '.............aaaaaaaa.....',
    '..............aaaaaa......',
    '..............aaaaaa......',
    '.............aaaaaaa......',
    'aa...........aaaaaaa......',
    'aaa........aaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaaaa...',
    'aaaadddddddddaaaaaaaaaa...',
    '.aaaddddddddddaaaaaaaaaa..',
    '.aaaadddddddddaaaaaaaaaa..',
    '...aaaaddddddaaaaaaaaaa...',
    '...aaaaaaaaaaaaaaaaaaaa...',
    '.....aaaaaaaaaaaaaaaa.....',
    '......bbccbbbbbbccbb......',
    '......bcccbbbbbcccb.......',
    '......cccc....cccc........',
    '.......cc......cc.........',
  ];
  const PAPERA_DUCK_QUACK = [
    '...............aaaa.......',
    '.............aaaaaaaa.....',
    '.............aaaaaaaaacccc',
    '............aaaaaaaaaacccc',
    '............aaaaaabbaa....',
    '............aaaaaabbaa....',
    '............aaaaaaaaaacccc',
    '.............aaaaaaaaacccc',
    '.............aaaaaaaab....',
    '..............aaaaaab.....',
    '..............aaaaaa......',
    '.............aaaaaaa......',
    'aa...........aaaaaaa......',
    'aaa........aaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaa.....',
    'aaaaaaaaaaaaaaaaaaaaaaa...',
    'aaaadddddddddaaaaaaaaaa...',
    '.aaaddddddddddaaaaaaaaaa..',
    '.aaaadddddddddaaaaaaaaaa..',
    '...aaaaddddddaaaaaaaaaa...',
    '...aaaaaaaaaaaaaaaaaaaa...',
    '.....aaaaaaaaaaaaaaaa.....',
    '......bbccbbbbbbccbb......',
    '......bcccbbbbbcccb.......',
    '......cccc....cccc........',
    '.......cc......cc.........',
  ];

  return {
    papera: {
      speed: 0.7,
      motion: 'walk',
      height: 0.812,
      palette: { a: '#F7F3EA', b: '#2B2233', c: '#F39A36', d: '#D8D1C3' },
      frames: {
        walk: [PAPERA_DUCK_WALK_1, PAPERA_DUCK_WALK_2],
        sleep: [PAPERA_DUCK_SLEEP],
        call: [PAPERA_DUCK_WALK_1, PAPERA_DUCK_QUACK],
      },
    },
  };
});

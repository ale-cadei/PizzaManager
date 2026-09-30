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
  // ---- La papera: cammina con gli anatroccoli dietro, e chiama facendo qua qua (15×15) ----
  const PAPERA_DUCK_WALK_1 = [
    '........aaa....',
    '.......abbba...',
    '......abbbbbaa.',
    '......abbbabcca',
    '......abbbbbaa.',
    '.......abbba...',
    '.a.....abbba...',
    'abaaaaabbbba...',
    'abbbbbbbbbbba..',
    'abbdddddbbbbba.',
    '.abbddddbbbbba.',
    '..abbbbbbbbba..',
    '...aacaaacaa...',
    '...accaacca....',
    '....aa..aa.....',
  ];
  const PAPERA_DUCK_WALK_2 = [
    '........aaa....',
    '.......abbba...',
    '......abbbbbaa.',
    '......abbbabcca',
    '......abbbbbaa.',
    '.......abbba...',
    '.a.....abbba...',
    'abaaaaabbbba...',
    'abbbbbbbbbbba..',
    'abbdddddbbbbba.',
    '.abbddddbbbbba.',
    '..abbbbbbbbba..',
    '...aaacaacaa...',
    '....accacca....',
    '.....aa.aa.....',
  ];
  const PAPERA_DUCK_SLEEP = [
    '........aaa....',
    '.......abbba...',
    '......abbbbbaa.',
    '......abbbdbcca',
    '......abbbbbaa.',
    '.......abbba...',
    '.a.....abbba...',
    'abaaaaabbbba...',
    'abbbbbbbbbbba..',
    'abbdddddbbbbba.',
    '.abbddddbbbbba.',
    '..abbbbbbbbba..',
    '...aacaaacaa...',
    '...accaacca....',
    '....aa..aa.....',
  ];
  const PAPERA_DUCK_QUACK = [
    '........aaa....',
    '.......abbbaaa.',
    '......abbbbbcca',
    '......abbbaba..',
    '......abbbbbcca',
    '.......abbbaaa.',
    '.a.....abbba...',
    'abaaaaabbbba...',
    'abbbbbbbbbbba..',
    'abbdddddbbbbba.',
    '.abbddddbbbbba.',
    '..abbbbbbbbba..',
    '...aacaaacaa...',
    '...accaacca....',
    '....aa..aa.....',
  ];

  return {
    papera: {
      speed: 0.7,
      motion: 'walk',
      palette: { a: '#2B2233', b: '#F7F3EA', c: '#F39A36', d: '#D8D1C3' },
      frames: {
        walk: [PAPERA_DUCK_WALK_1, PAPERA_DUCK_WALK_2],
        sleep: [PAPERA_DUCK_SLEEP],
        call: [PAPERA_DUCK_WALK_1, PAPERA_DUCK_QUACK],
      },
    },
  };
});

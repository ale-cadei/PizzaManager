/* Zucco, la zucca.
 * Disegno del pacchetto «Halloween Pack pixel-art»: griglie ricavate dallo
 * sheet 1x nel formato di pets-sprites.js, che lo fonde nel suo catalogo
 * (AisessPetsPack). Pose dalle animazioni del pacchetto.
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
  // ---- Zucco, la zucca (22×18) ----
  const ZUCCA_BLINK = [
    '......................',
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '...abdbbcbbbbcbbdba...',
    '...abdbbcbbbbcbbdba...',
    '...abdaaabbbbaaadba...',
    '..aabdbbcbbbbcbbdbaa..',
    '.a.abdhbbcbbcbbhdba.a.',
    '.a.abdhhhhhhhhhhdba.a.',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '........a....a........',
    '.......aa....aa.......',
  ];
  const ZUCCA_FELICE = [
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '.a.abdbbcbbbbcbbdba.a.',
    '.a.abdaaabbbbaaadba.a.',
    '.a.ababbbabbabbbaba.a.',
    '..aabdbbcbbbbcbbdbaa..',
    '...abdhbbcbbcbbhdba...',
    '...abdhhhhhhhhhhdba...',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '........a....a........',
    '.......aa....aa.......',
    '......................',
  ];
  const ZUCCA_PASSO_1 = [
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '...abdbbcbbbbcbbdba...',
    '...abdbgcbbbbcgbdba...',
    'a..abdgggbbbbgggdba...',
    '.aaabdbbcbbbbcbbdbaa..',
    '...abdhbbcbbcbbhdba.a.',
    '...abdhhhhhhhhhhdba.a.',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '.......aa....a........',
    '.............aa.......',
    '......................',
  ];
  const ZUCCA_PASSO_2 = [
    '......................',
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '...abdbbcbbbbcbbdba...',
    '...abdbgcbbbbcgbdba...',
    '...abdgggbbbbgggdba...',
    '..aabdbbcbbbbcbbdbaa..',
    '.a.abdhbbcbbcbbhdba.a.',
    '.a.abdhhhhhhhhhhdba.a.',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '........a....a........',
    '.......aa....aa.......',
  ];
  const ZUCCA_PASSO_3 = [
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '...abdbbcbbbbcbbdba...',
    '...abdbgcbbbbcgbdba...',
    '...abdgggbbbbgggdba..a',
    '..aabdbbcbbbbcbbdbaaa.',
    '.a.abdhbbcbbcbbhdba...',
    '.a.abdhhhhhhhhhhdba...',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '........a....aa.......',
    '.......aa.............',
    '......................',
  ];
  const ZUCCA_PASSO_4 = [
    '......................',
    '..........aa..........',
    '.........aefa.........',
    '.....aaaaaefaaaaa.....',
    '....abbdbbabbbdbba....',
    '...abdbbcbbbbcbbdba...',
    '...abdbgcbbbbcgbdba...',
    '...abdgggbbbbgggdba...',
    '..aabdbbcbbbbcbbdbaa..',
    '.a.abdhbbcbbcbbhdba.a.',
    '.a.abdhhhhhhhhhhdba.a.',
    '...abdbhhbhhbhhbdba...',
    '....abdbcbbbbcbbda....',
    '.....aabbbcbbcbaa.....',
    '.......aaaaaaaa.......',
    '........a....a........',
    '........a....a........',
    '.......aa....aa.......',
  ];

  return {
    zucca: {
      speed: 0.9,
      motion: 'walk',
      palette: { a: '#3A1A0A', b: '#F07A1C', c: '#B8500E', d: '#FFA24A', e: '#4A8A2C', f: '#2E5A1C', g: '#FFE45C', h: '#FFB020' },
      frames: {
        walk: [ZUCCA_PASSO_1, ZUCCA_PASSO_2, ZUCCA_PASSO_3, ZUCCA_PASSO_4],
        sleep: [ZUCCA_BLINK],
        call: [ZUCCA_FELICE],
      },
    },
  };
});

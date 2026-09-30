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
  // ---- La chiocciola: lenta, e per chiamare dondola le antenne (30×28) ----
  const CHIOCCIOLA_SNAIL_WALK_1 = [
    '....................aa..aa....',
    '...................aaa..aaa...',
    '...................aaaaaaaa...',
    '..................aaaaaaaaaa..',
    '..................aabbaabbaa..',
    '..................aabbaabbaa..',
    '.........aaaaaa...aabbaabbaa..',
    '.......aaaaaaaaa..aabbaabbaa..',
    '.......aaccccccaaaaabbbbbbaa..',
    '.....aaccccccccccaaabbbbbbaa..',
    '.....aacddddddcccaaabbbbbbaa..',
    '...aaccddddddddccccabbbbbbaa..',
    '...aacdddccccdddccccbbbbbbaa..',
    '..aaccddccccccddccccbbbbbaa...',
    '..aaccddccddccddccccbbbbbaa...',
    '..aaccddccddccddccccbbbbaa....',
    '..aaccddccdddddcccccbbbbaa....',
    '..aaccddcccdddccccccbbbbaa....',
    '..aacccddddcccccccccbbbbaa....',
    '..aaacccddcccccccccbbbbbaaa...',
    '..aaaccccccccccccccbbbbbaaa...',
    '.aaaaacccccccccccbbbbbbbbaaaa.',
    'aabbbbbbbbbbbbbbbbbbbbbbbbbbaa',
    'aabbbbbbbbbbbbbbbbbbbbbbbbbbaa',
    '.aaaeeeeeeeeeeeeeeeeeeeeeeaaa.',
    '...aaeeeeeeeeeeeeeeeeeeeeaa...',
    '...aaaaaaaaaaaaaaaaaaaaaaaa...',
    '.....aaaaaaaaaaaaaaaaaaaa.....',
  ];
  const CHIOCCIOLA_SNAIL_WALK_2 = [
    '..............................',
    '..............................',
    '....................aa..aa....',
    '...................aaa..aaa...',
    '...................aaaaaaaa...',
    '..................aaaaaaaaaa..',
    '.........aaaaaa...aabbaabbaa..',
    '.......aaaaaaaaa..aabbaabbaa..',
    '.......aaccccccaaaaabbbbbbaa..',
    '.....aaccccccccccaaabbbbbbaa..',
    '.....aacddddddcccaaabbbbbbaa..',
    '...aaccddddddddccccabbbbbbaa..',
    '...aacdddccccdddccccbbbbbbaa..',
    '..aaccddccccccddccccbbbbbaa...',
    '..aaccddccddccddccccbbbbbaa...',
    '..aaccddccddccddccccbbbbaa....',
    '..aaccddccdddddcccccbbbbaa....',
    '..aaccddcccdddccccccbbbbaa....',
    '..aacccddddcccccccccbbbbaa....',
    '...aacccddcccccccccbbbbbaaa...',
    '....accccccccccccccbbbbbaaa...',
    '....aacccccccccccbbbbbbbbaaaa.',
    '..aabbbbbbbbbbbbbbbbbbbbbbbbaa',
    '..aabbbbbbbbbbbbbbbbbbbbbbbbaa',
    '...aaaeeeeeeeeeeeeeeeeeeeeaaa.',
    '.....aaeeeeeeeeeeeeeeeeeeaa...',
    '.....aaaaaaaaaaaaaaaaaaaaaa...',
    '.......aaaaaaaaaaaaaaaaaa.....',
  ];
  const CHIOCCIOLA_SNAIL_SLEEP = [
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '..............................',
    '...........aaaaaa.............',
    '.........aaaaaaaaaa...........',
    '.........aaccccccaa...........',
    '.......aaccccccccccaa.........',
    '.......aacddddddcccaa.........',
    '.....aaccddddddddccccaa.......',
    '.....aacdddccccdddcccaa.......',
    '....aaccddccccccddccccaa......',
    '....aaccddccddccddccccaa......',
    '....aaccddccddccddccccaa......',
    '....aaccddccdddddcccccaa......',
    '....aaccddcccdddccccccaa......',
    '....aacccddddcccccccccaa......',
    '.....aacccddcccccccccaa.......',
    '......acccccccccccccca........',
    '......aaccccccccccccaa........',
    '....aaeeeeeeeeeeeeeeeeaa......',
    '....aaeeeeeeeeeeeeeeeeaa......',
    '.....aaaaaaaaaaaaaaaaaa.......',
    '.......aaaaaaaaaaaaaa.........',
  ];

  return {
    chiocciola: {
      speed: 0.2,
      motion: 'walk',
      height: 0.875,
      palette: { a: '#2B2233', b: '#B8CC7C', c: '#D98B4F', d: '#9B5A2C', e: '#86A052' },
      frames: {
        walk: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
        sleep: [CHIOCCIOLA_SNAIL_SLEEP],
        call: [CHIOCCIOLA_SNAIL_WALK_1, CHIOCCIOLA_SNAIL_WALK_2],
      },
    },
  };
});

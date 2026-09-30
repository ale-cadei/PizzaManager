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
  // ---- L'ape: vola, e si posa sul suo fiore per dormire e per chiamare (16×12) ----
  const APE_BEE_FLY_1 = [
    '....aaa..aaa....',
    '...abbbaabbba...',
    '..abbbbaabbbba..',
    '..abbbbaabbbba..',
    '...abbaaaabba...',
    '..accddccddcca..',
    '.acccddccddcaca.',
    'adcccddccddcccca',
    '.acccddccddccca.',
    '..accddccddcca..',
    '...aaaaaaaaaa...',
    '................',
  ];
  const APE_BEE_FLY_2 = [
    '................',
    '................',
    '....aa....aa....',
    '...abba..abba...',
    '..abbbbaabbbba..',
    '..accddccddcca..',
    '.acccddccddcaca.',
    'adcccddccddcccca',
    '.acccddccddccca.',
    '..accddccddcca..',
    '...aaaaaaaaaa...',
    '................',
  ];
  const APE_BEE_REST = [
    '................',
    '................',
    '..aaa...........',
    '.abbbaa.........',
    'abbbbbbaaaaaa...',
    '.aaccddccddcca..',
    '.acccddccddcaca.',
    'adcccddccddcccca',
    '.acccddccddccca.',
    '..accddccddcca..',
    '...aadaaadaaa...',
    '.....a...a......',
  ];
  const APE_PERCH = [
    '......aaaa......',
    '.....aeeeea.....',
    '..aaaeeeeeeaaa..',
    '.aeeeeeffeeeeea.',
    'aeeeeeffffeeeeea',
    'aeeeeeffffeeeeea',
    '.ageeeeffeeeega.',
    '..aaageeeegaaa..',
    '.....aeeeea.....',
    '...aa.ahha......',
    '..aiiaahha.aa...',
    '..aiiiahhaaiia..',
    '...aiiihhiiia...',
    '....aaahhaaa....',
    '......ahha......',
    '.......aa.......',
  ];

  return {
    ape: {
      speed: 0.9,
      motion: 'fly',
      palette: { a: '#2B2233', b: '#D9F0FA', c: '#FFCF3D', d: '#3B3342', e: '#F28AB5', f: '#F0A830', g: '#D9669A', h: '#4F8F3F', i: '#7CBF5A' },
      perch: { grid: APE_PERCH, seat: 13 },
      frames: {
        walk: [APE_BEE_FLY_1, APE_BEE_FLY_2],
        sleep: [APE_BEE_REST],
        call: [APE_BEE_FLY_1, APE_BEE_REST],
      },
    },
  };
});

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
  // ---- L'ape: vola, e si posa sul suo fiore per dormire e per chiamare (32×24) ----
  const APE_BEE_FLY_1 = [
    '.........aaaa......aaaa.........',
    '.......aaaaaaaa..aaaaaaaa.......',
    '.......aabbbbaaaaaabbbbaa.......',
    '.....aabbbbbbbaaaabbbbbbbaa.....',
    '.....aabbbbbbbaaaabbbbbbbaa.....',
    '....aabbbbbbbbaaaabbbbbbbbaa....',
    '....aabbbbbbbbaaaabbbbbbbbaa....',
    '.....aabbbbbbaaaaaabbbbbbaa.....',
    '......abbbbbbaaaaaabbbbbba......',
    '......aabbbbaaaaaaaabbbbaa......',
    '.....aacccddddccccddddcccca.....',
    '...aacccccddddccccddddcccccaa...',
    '...aacccccddddccccddddccaacca...',
    '.aaaccccccddddccccddddccaacccaa.',
    'aaddccccccddddccccddddccccccccaa',
    'aaddccccccddddccccddddccccccccaa',
    '.aaaccccccddddccccddddcccccccaa.',
    '...aacccccddddccccddddcccccaa...',
    '...aacccccddddccccddddcccccaa...',
    '.....aacccddddccccddddcccaa.....',
    '.....aaaaaaaaaaaaaaaaaaaaaa.....',
    '.......aaaaaaaaaaaaaaaaaa.......',
    '................................',
    '................................',
  ];
  const APE_BEE_FLY_2 = [
    '................................',
    '................................',
    '................................',
    '................................',
    '.........aa..........aa.........',
    '.......aaaaaa......aaaaaa.......',
    '.......aabbaa......aabbaa.......',
    '.....aabbbbbbaa..aabbbbbbaa.....',
    '.....aabbbbbbaaaaaabbbbbbaa.....',
    '....aabbbbbbbbaaaabbbbbbbbaa....',
    '....aaccccddddccccddddccccaa....',
    '...aacccccddddccccddddcccacaa...',
    '...aacccccddddccccddddccaacca...',
    '.aaaccccccddddccccddddccaacccaa.',
    'aaddccccccddddccccddddccccccccaa',
    'aaddccccccddddccccddddccccccccaa',
    '.aaaccccccddddccccddddcccccccaa.',
    '...aacccccddddccccddddcccccaa...',
    '...aacccccddddccccddddcccccaa...',
    '.....aacccddddccccddddcccaa.....',
    '.....aaaaaaaaaaaaaaaaaaaaaa.....',
    '.......aaaaaaaaaaaaaaaaaa.......',
    '................................',
    '................................',
  ];
  const APE_BEE_REST = [
    '................................',
    '................................',
    '................................',
    '................................',
    '.....aaaa.......................',
    '...aaaaaaaa.....................',
    '...aabbbbaaaa...................',
    '.aabbbbbbbbaaaa.................',
    'aabbbbbbbbbbbaaaaaaaaaaaa.......',
    'aabbbbbbbbbbbbaaaaaaaaaaaaa.....',
    '.aaaaaccccddddccccddddcccca.....',
    '..aaacccccddddccccddddcccccaa...',
    '..aaacccccddddccccddddccaacca...',
    '.aaaccccccddddccccddddccaacccaa.',
    'aaddccccccddddccccddddccccccccaa',
    'aaddccccccddddccccddddccccccccaa',
    '.aaaccccccddddccccddddcccccccaa.',
    '...aacccccddddccccddddcccccaa...',
    '...aacccccddddccccddddcccccaa...',
    '.....aacccddddccccddddcccaa.....',
    '.....aaaaadddaaaaadddaaaaaa.....',
    '.......aaaddaaaaaaddaaaaa.......',
    '.........aaaa....aaaa...........',
    '..........aa......aa............',
  ];
  const APE_PERCH = [
    '.............aaaaaa.............',
    '...........aaaaaaaaaa...........',
    '...........aaeeeeeeaa...........',
    '.........aaeeeeeeeeeeaa.........',
    '.....aaaaaaeeeeeeeeeeaaaaaa.....',
    '...aaaaaaeeeeeeeeeeeeeeaaaaaa...',
    '...aaeeeeeeeeeeffeeeeeeeeeeaa...',
    '.aaeeeeeeeeeeffffffeeeeeeeeeeaa.',
    '.aaeeeeeeeeeeffffffeeeeeeeeeeaa.',
    'aaeeeeeeeeeeffffffffeeeeeeeeeeaa',
    'aaeeeeeeeeeeffffffffeeeeeeeeeeaa',
    '.aaeeeeeeeeeeffffffeeeeeeeeeeaa.',
    '.aaageeeeeeeeffffffeeeeeeeegaaa.',
    '...aageeeeeeeeeffeeeeeeeeegaa...',
    '...aaaaaaageeeeeeeeeegaaaaaaa...',
    '.....aaaaaageeeeeeeegaaaaaa.....',
    '..........aaeeeeeeeeaaa.........',
    '...........aaeeeeeeaa...........',
    '.......aa...aahhhhaaa...........',
    '.....aaaaa..aahhhhaa............',
    '.....aaiiaaaaahhhhaa...aa.......',
    '....aaiiiiiaaahhhhaa..aaaaa.....',
    '....aaiiiiiaaahhhhaaaaaiiiaa....',
    '.....aaiiiiiiahhhhaaaiiiiiaa....',
    '.....aaiiiiiiihhhhiiiiiiiaa.....',
    '.......aaiiiiihhhhiiiiiaa.......',
    '.......aaaaaaahhhhaaaaaaa.......',
    '.........aaaaahhhhaaaaa.........',
    '...........aaahhhhaaa...........',
    '.............aahhaa.............',
    '.............aaaaaa.............',
    '...............aa...............',
  ];

  return {
    ape: {
      speed: 0.9,
      motion: 'fly',
      height: 0.75,
      palette: { a: '#2B2233', b: '#D9F0FA', c: '#FFCF3D', d: '#3B3342', e: '#F28AB5', f: '#F0A830', g: '#D9669A', h: '#4F8F3F', i: '#7CBF5A' },
      perch: { grid: APE_PERCH, seat: 26 },
      frames: {
        walk: [APE_BEE_FLY_1, APE_BEE_FLY_2],
        sleep: [APE_BEE_REST],
        call: [APE_BEE_FLY_1, APE_BEE_REST],
      },
    },
  };
});

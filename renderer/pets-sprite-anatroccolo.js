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
  // ---- L'anatroccolo: va dietro alla papera (22×22) ----
  const ANATROCCOLO_DUCKLING_WALK_1 = [
    '...........aaaa.......',
    '.........aaaaaaaa.....',
    '.........aabbbbbaaa...',
    '.......aabbbbbbbbaaaa.',
    '.......aabbbbbaaabccaa',
    '......aabbbbbbaabbccaa',
    '......aabbbbbbbbbbaaa.',
    '.......aabbbbbbbbaa...',
    '..aa....aabbbbbbaa....',
    '.aaaa...aabbbbbbaa....',
    '.abbaaaaabbbbbbbbaa...',
    'aabbbaabbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbbaa',
    'aabbddddddddbbbbbbbbaa',
    '.aabddddddddbbbbbbbaa.',
    '.aabbbbbbbbbbbbbbbbaa.',
    '...aabbbbbbbbbbbbaa...',
    '...aaaaaccaaaaccaaa...',
    '.....aaaccaaaacca.....',
    '.......aaaa..aaaa.....',
    '........aa....aa......',
  ];
  const ANATROCCOLO_DUCKLING_WALK_2 = [
    '...........aaaa.......',
    '.........aaaaaaaa.....',
    '.........aabbbbbaaa...',
    '.......aabbbbbbbbaaaa.',
    '.......aabbbbbaaabccaa',
    '......aabbbbbbaabbccaa',
    '......aabbbbbbbbbbaaa.',
    '.......aabbbbbbbbaa...',
    '..aa....aabbbbbbaa....',
    '.aaaa...aabbbbbbaa....',
    '.abbaaaaabbbbbbbbaa...',
    'aabbbaabbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbbaa',
    'aabbddddddddbbbbbbbbaa',
    '.aabddddddddbbbbbbbaa.',
    '.aabbbbbbbbbbbbbbbbaa.',
    '...aabbbbbbbbbbbbaa...',
    '...aaaaaaaccccaaaaa...',
    '.....aaaaaaccaaaa.....',
    '.........aaaaaa.......',
    '...........aa.........',
  ];
  const ANATROCCOLO_DUCKLING_SLEEP = [
    '...........aaaa.......',
    '.........aaaaaaaa.....',
    '.........aabbbbaaaa...',
    '.......aabbbbbbbbaaaa.',
    '.......aabbbbbddbbccaa',
    '......aabbbbbbddbbccaa',
    '......aabbbbbbbbbbaaa.',
    '.......aabbbbbbbbaa...',
    '..aa....aabbbbbbaa....',
    '.aaaa...aabbbbbbaa....',
    '.abbaaaaabbbbbbbbaa...',
    'aabbbaabbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbaa.',
    'aabbbbbbbbbbbbbbbbbbaa',
    'aabbddddddddbbbbbbbbaa',
    '.aabddddddddbbbbbbbaa.',
    '.aabbbbbbbbbbbbbbbbaa.',
    '...aabbbbbbbbbbbbaa...',
    '...aaaaaccaaaaccaaa...',
    '.....aaaccaaaacca.....',
    '.......aaaa..aaaa.....',
    '........aa....aa......',
  ];

  return {
    anatroccolo: {
      speed: 0.7,
      motion: 'walk',
      height: 0.688,
      palette: { a: '#2B2233', b: '#FFD447', c: '#F39A36', d: '#E3A92C' },
      frames: {
        walk: [ANATROCCOLO_DUCKLING_WALK_1, ANATROCCOLO_DUCKLING_WALK_2],
        sleep: [ANATROCCOLO_DUCKLING_SLEEP],
        call: [ANATROCCOLO_DUCKLING_WALK_1],
      },
    },
  };
});

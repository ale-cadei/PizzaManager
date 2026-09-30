/* La tazzina di caffè: cammina come Fizzo, a quattro passi, e camminando
 * lascia sbuffi di fumo dietro di sé (trail: docs/plans/33-animaletti.md).
 * Da fredda, quando dorme, non fuma. Disegnata a mano nel formato di
 * pets-sprites.js, che la fonde nel suo catalogo (AisessPetsPack): guarda a
 * destra, col manico dalla parte opposta al fumo.
 *
 * Wrapper UMD come gli altri moduli del renderer: in pagina i personaggi
 * del pacchetto si sommano nello stesso oggetto. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessPetsPack = Object.assign({}, root.AisessPetsPack, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // ---- La tazzina (27×23): orlo col caffè, manico, gambette come Fizzo ----
  const TAZZINA_PASSO_1 = [
    '....aaaaaaaaaaaaaa.........',
    '..aabbbbbbbbbbbbbbaa.......',
    '.abbaaaaaaaaaaaaaabba......',
    'abbaddddddddddddddabba.....',
    'abbadeeddddddddddeabba.....',
    'abbbaaaaaaaaaaaaaabbbaaaaa.',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbbbbbbbbbbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbffbbbbbbbbbbbbffbbaaaaba',
    'abbbbbbbaabbbbaabbbbbabbbba',
    'abbbbbbbbbaaaabbbbbbbaaaaa.',
    '.abbbbbbbbbbbbbbbbbba......',
    '.abbbbbbbbbbbbbbbbbba......',
    '..abbbbbbbbbbbbbbbba.......',
    '..acbbbbbbbbbbbbbbca.......',
    '...acccccccccccca..........',
    '....aaaaaaaaaaaa...........',
    '.......a......a............',
    '......aa......a............',
    '..............aa...........',
  ];
  const TAZZINA_PASSO_2 = [
    '....aaaaaaaaaaaaaa.........',
    '..aabbbbbbbbbbbbbbaa.......',
    '.abbaaaaaaaaaaaaaabba......',
    'abbaddddddddddddddabba.....',
    'abbadeeddddddddddeabba.....',
    'abbbaaaaaaaaaaaaaabbbaaaaa.',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbbbbbbbbbbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbffbbbbbbbbbbbbffbbaaaaba',
    'abbbbbbbaabbbbaabbbbbabbbba',
    'abbbbbbbbbaaaabbbbbbbaaaaa.',
    '.abbbbbbbbbbbbbbbbbba......',
    '.abbbbbbbbbbbbbbbbbba......',
    '..abbbbbbbbbbbbbbbba.......',
    '..acbbbbbbbbbbbbbbca.......',
    '...acccccccccccca..........',
    '....aaaaaaaaaaaa...........',
    '.......a......a............',
    '.......a......a............',
    '......aa......aa...........',
  ];
  const TAZZINA_PASSO_3 = [
    '....aaaaaaaaaaaaaa.........',
    '..aabbbbbbbbbbbbbbaa.......',
    '.abbaaaaaaaaaaaaaabba......',
    'abbaddddddddddddddabba.....',
    'abbadeeddddddddddeabba.....',
    'abbbaaaaaaaaaaaaaabbbaaaaa.',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbbbbbbbbbbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbffbbbbbbbbbbbbffbbaaaaba',
    'abbbbbbbaabbbbaabbbbbabbbba',
    'abbbbbbbbbaaaabbbbbbbaaaaa.',
    '.abbbbbbbbbbbbbbbbbba......',
    '.abbbbbbbbbbbbbbbbbba......',
    '..abbbbbbbbbbbbbbbba.......',
    '..acbbbbbbbbbbbbbbca.......',
    '...acccccccccccca..........',
    '....aaaaaaaaaaaa...........',
    '.......a......a............',
    '.......a......aa...........',
    '......aa...................',
  ];
  const TAZZINA_DORME = [
    '....aaaaaaaaaaaaaa.........',
    '..aabbbbbbbbbbbbbbaa.......',
    '.abbaaaaaaaaaaaaaabba......',
    'abbaddddddddddddddabba.....',
    'abbadeeddddddddddeabba.....',
    'abbbaaaaaaaaaaaaaabbbaaaaa.',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbbbbbbbbbbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbaabbbbbbbbaabbbba..aba',
    'abbffbbbbbbbbbbbbffbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbaabbbbbbbbaaaaa.',
    '.abbbbbbbbbbbbbbbbbba......',
    '.abbbbbbbbbbbbbbbbbba......',
    '..abbbbbbbbbbbbbbbba.......',
    '..acbbbbbbbbbbbbbbca.......',
    '...acccccccccccca..........',
    '....aaaaaaaaaaaa...........',
    '.......a......a............',
    '.......a......a............',
    '......aa......aa...........',
  ];
  const TAZZINA_CHIAMA = [
    '....aaaaaaaaaaaaaa.........',
    '..aabbbbbbbbbbbbbbaa.......',
    '.abbaaaaaaaaaaaaaabba......',
    'abbaddddddddddddddabba.....',
    'abbadeeddddddddddeabba.....',
    'abbbaaaaaaaaaaaaaabbbaaaaa.',
    'abbbbbbbbbbbbbbbbbbbbabbbba',
    'abbbbbbbbbbbbbbbbbbbbaaaaba',
    'abbbbbbbbbbbbbbbbbbbba..aba',
    'abbbbbabbbbbbbbbabbbba..aba',
    'abbbbabababbbbabababba..aba',
    'abbffbbbbaddddabbffbbaaaaba',
    'abbbbbbbaaaaaaabbbbbbabbbba',
    'abbbbbbbbaaaaabbbbbbbaaaaa.',
    '.abbbbbbbbbbbbbbbbbba......',
    '.abbbbbbbbbbbbbbbbbba......',
    '..abbbbbbbbbbbbbbbba.......',
    '..acbbbbbbbbbbbbbbca.......',
    '...acccccccccccca..........',
    '....aaaaaaaaaaaa...........',
    '.......a......a............',
    '.......a......a............',
    '......aa......aa...........',
  ];
  // Gli sbuffi: nascono piccoli, si gonfiano, si sfilacciano
  const TAZZINA_SBUFFO_1 = [
    '........',
    '........',
    '...pp...',
    '..pwpp..',
    '..pppp..',
    '...pp...',
    '........',
    '........',
  ];
  const TAZZINA_SBUFFO_2 = [
    '........',
    '...pp...',
    '..pwwp..',
    '.ppwwpp.',
    '.pppppp.',
    '..pppp..',
    '...p....',
    '........',
  ];
  const TAZZINA_SBUFFO_3 = [
    '..pp..p.',
    '.p..pp.p',
    'p.pp..p.',
    '.pp..pp.',
    'p..pp..p',
    '.pp..p..',
    '..p..pp.',
    '........',
  ];

  return {
    tazzina: {
      speed: 0.9,
      motion: 'walk',
      height: 0.72,
      palette: { a: '#2B2233', b: '#F7F3EA', c: '#DCD5C9', d: '#6E4126', e: '#9A6A3E', f: '#F2A4B4', p: '#DAD4C8', w: '#F4F1EA' },
      frames: {
        walk: [TAZZINA_PASSO_1, TAZZINA_PASSO_2, TAZZINA_PASSO_3, TAZZINA_PASSO_2],
        sleep: [TAZZINA_DORME],
        call: [TAZZINA_CHIAMA],
      },
      // Il fumo esce dal caffè, dalla parte del manico no: dietro, mentre cammina
      trail: { frames: [TAZZINA_SBUFFO_1, TAZZINA_SBUFFO_2, TAZZINA_SBUFFO_3], at: { col: 7, row: 2 } },
    },
  };
});

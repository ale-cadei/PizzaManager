/* Babbo Natale con la slitta, vola.
 * Disegno del pacchetto «Sprite pixel-art originale»: griglie ricavate dai PNG 1x nel
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
  // ---- Babbo Natale con la slitta, vola (52×20) ----
  const BABBO_VOLO_1 = [
    '....................................................',
    '.............aaaa...................................',
    '........aaa.abbbba..................................',
    '.......addaabbbbbba.................................',
    '.......addabbbbbbbba............................i.i.',
    '........aaaddddddddda...........................iii.',
    '...........aeeeeaeeea.............i.i..........aaaa.',
    '.j.........adeeeeefea.............iii.........aggaga',
    '..........addddeeddda............aaaa.........aggggm',
    '....aaa..abddddddddda...........aggaga.........ahha.',
    '....abbaabbadddddabba.aa........agggga..aaaaaaagga..',
    '....abbaaaaaaaaaaaaaaabakkkkkkkkkahhakkagggggggjga..',
    '...jabjjjjjjjjjjjjjjjba...aaaaaaagga..ahagggggggga..',
    '....abbbbbbbbbbbbbbbba...agggggggjga...ahhhhhhhhha..',
    '.....acccccccccccccca...ahagggggggga.....a.....a....',
    '......aaaaaaaaaaaaaa.....ahhhhhhhhha......a...a.....',
    '.......j........j.....j...a.......a.................',
    '.....kjjjjjjjjjjjjjjjjk..a.........a................',
    '......aaaaaaaaaaaaaaaa..a...........a...............',
    '....................................................',
  ];
  const BABBO_VOLO_2 = [
    '.............aaaa...................................',
    '........aaa.abbbba..................................',
    '.......addaabbbbbba.................................',
    '.......addabbbbbbbba................................',
    '..j.....aaaddddddddda...............................',
    '...........aeeeeaeeea.............i.i...........i.i.',
    '...........adeeeeefea.............iii...........iii.',
    '..........addddeeddda............aaaa..........aaaa.',
    '....aaa..abddddddddda...........aggaga........aggaga',
    'j...abbaabbadddddabba.aa........agggga........aggggl',
    '....abbaaaaaaaaaaaaaaabakkkkkkkkkahhakkkkkkkkkkahha.',
    '....abjjjjjjjjjjjjjjjba...aaaaaaagga....aaaaaaagga..',
    '....abbbbbbbbbbbbbbbba...agggggggjga...agggggggjga..',
    '.....acccccccccccccca...ahagggggggga..ahagggggggga..',
    '......aaaaaaaaaaaaaa.....ahhhhhhhhha...ahhhhhhhhha..',
    '.......j........j.....j...a.......a.....a.......a...',
    '.....kjjjjjjjjjjjjjjjjk...a.......a.....a.......a...',
    '......aaaaaaaaaaaaaaaa....a.......a.....a.......a...',
    '....................................................',
    '....................................................',
  ];
  const BABBO_VOLO_3 = [
    '....................................................',
    '.............aaaa...................................',
    '........aaa.abbbba..................................',
    '.......addaabbbbbba.................................',
    '.......addabbbbbbbba..............i.i...............',
    '........aaaddddddddda.............iii...............',
    '...........aeeeeaeeea............aaaa...........i.i.',
    '...........adeeeeefea...........aggaga..........iii.',
    '...j......addddeeddda...........agggga.........aaaa.',
    '....aaa..abddddddddda............ahha.........aggaga',
    '....abbaabbadddddabba.aa..aaaaaaagga..........aggggm',
    '....abbaaaaaaaaaaaaaaabakagggggggjgakkkkkkkkkkkahha.',
    '....abjjjjjjjjjjjjjjjba.ahagggggggga....aaaaaaagga..',
    '.j..abbbbbbbbbbbbbbbba...ahhhhhhhhha...agggggggjga..',
    '.....acccccccccccccca......a.....a....ahagggggggga..',
    '......aaaaaaaaaaaaaa........a...a......ahhhhhhhhha..',
    '.......j........j.....j.................a.......a...',
    '.....kjjjjjjjjjjjjjjjjk................a.........a..',
    '......aaaaaaaaaaaaaaaa................a...........a.',
    '....................................................',
  ];
  const BABBO_VOLO_4 = [
    '....................................................',
    '....................................................',
    '.............aaaa...................................',
    '........aaa.abbbba..................................',
    '.......addaabbbbbba.................................',
    '.......addabbbbbbbba..............i.i...........i.i.',
    '........aaaddddddddda.............iii...........iii.',
    'j..........aeeeeaeeea............aaaa..........aaaa.',
    '...........adeeeeefea...........aggaga........aggaga',
    '..........addddeeddda...........agggga........aggggl',
    '....aaa..abddddddddda............ahha..........ahha.',
    '....abbaabbadddddabba.aa..aaaaaaagga....aaaaaaagga..',
    '..j.abbaaaaaaaaaaaaaaabakagggggggjgakkkagggggggjga..',
    '....abjjjjjjjjjjjjjjjba.ahagggggggga..ahagggggggga..',
    '....abbbbbbbbbbbbbbbba...ahhhhhhhhha...ahhhhhhhhha..',
    '.....acccccccccccccca.....a.......a.....a.......a...',
    '......aaaaaaaaaaaaaa......a.......a.....a.......a...',
    '.......j........j.....j...a.......a.....a.......a...',
    '.....kjjjjjjjjjjjjjjjjk.............................',
    '......aaaaaaaaaaaaaaaa..............................',
  ];

  return {
    babbo: {
      speed: 1.2,
      motion: 'fly',
      palette: { a: '#1F1420', b: '#D32F3A', c: '#8E1C2A', d: '#F4F1EA', e: '#F2B58A', f: '#E0806A', g: '#8A5530', h: '#C08850', i: '#E0C080', j: '#F2C14E', k: '#B8862A', l: '#FF3B3B', m: '#9A2030' },
      frames: {
        walk: [BABBO_VOLO_1, BABBO_VOLO_2, BABBO_VOLO_3, BABBO_VOLO_4],
        sleep: [BABBO_VOLO_1],
        call: [BABBO_VOLO_1],
      },
    },
  };
});

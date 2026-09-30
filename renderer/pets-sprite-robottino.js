/* Il robottino: cammina con l'antenna che lampeggia, e chiama con lo schermo acceso.
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
  // ---- Il robottino: cammina con l'antenna che lampeggia, e chiama con lo schermo acceso (16×16) ----
  const ROBOTTINO_ROBOT_WALK_1_ON = [
    '.......aa.......',
    '......abba......',
    '....aaaccaaa....',
    '...adddddddda...',
    '..adeeeeeeeeda..',
    '..adefeeeefeda..',
    '..adefeeeefeda..',
    '..adeeeeeeeeda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....acaaaaca....',
    '...acca..acca...',
    '....aa....aa....',
  ];
  const ROBOTTINO_ROBOT_WALK_2_ON = [
    '.......aa.......',
    '......abba......',
    '....aaaccaaa....',
    '...adddddddda...',
    '..adeeeeeeeeda..',
    '..adefeeeefeda..',
    '..adefeeeefeda..',
    '..adeeeeeeeeda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....aacaacaa....',
    '....accaacca....',
    '.....aa..aa.....',
  ];
  const ROBOTTINO_ROBOT_WALK_1_OFF = [
    '.......aa.......',
    '......agga......',
    '....aaaccaaa....',
    '...adddddddda...',
    '..adeeeeeeeeda..',
    '..adefeeeefeda..',
    '..adefeeeefeda..',
    '..adeeeeeeeeda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....acaaaaca....',
    '...acca..acca...',
    '....aa....aa....',
  ];
  const ROBOTTINO_ROBOT_WALK_2_OFF = [
    '.......aa.......',
    '......agga......',
    '....aaaccaaa....',
    '...adddddddda...',
    '..adeeeeeeeeda..',
    '..adefeeeefeda..',
    '..adefeeeefeda..',
    '..adeeeeeeeeda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....aacaacaa....',
    '....accaacca....',
    '.....aa..aa.....',
  ];
  const ROBOTTINO_ROBOT_SLEEP = [
    '.......aa.......',
    '......agga......',
    '....aaaccaaa....',
    '...adddddddda...',
    '..adeeeeeeeeda..',
    '..adeeeeeeeeda..',
    '..adefeeeefeda..',
    '..adeeeeeeeeda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....acaaaaca....',
    '...acca..acca...',
    '....aa....aa....',
  ];
  const ROBOTTINO_ROBOT_CALL_1 = [
    '.......aa.......',
    '...h..abba..h...',
    '....aaaccaaa....',
    '..haddddddddah..',
    '..adhhhhhhhhda..',
    '.hadhahhhhahdah.',
    '..adhahhhhahda..',
    '..adhhhhhhhhda..',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....acaaaaca....',
    '...acca..acca...',
    '....aa....aa....',
  ];
  const ROBOTTINO_ROBOT_CALL_2 = [
    '....h..aa..h....',
    '......abba......',
    '....aaaccaaa....',
    '...adddddddda...',
    'h.adhhhhhhhhda.h',
    '..adhahhhhahda..',
    '..adhahhhhahda..',
    '.hadhhhhhhhhdah.',
    '...adddddddda...',
    '...aaaccccaaa...',
    '..acdddbbdddca..',
    '..acddddddddca..',
    '...adddddddda...',
    '....acaaaaca....',
    '...acca..acca...',
    '....aa....aa....',
  ];

  return {
    robottino: {
      speed: 0.7,
      motion: 'walk',
      palette: { a: '#2B2233', b: '#FF5D4F', c: '#75838F', d: '#B9C4CC', e: '#33405A', f: '#6FE3FF', g: '#7A4A4A', h: '#FFD94A' },
      frames: {
        walk: [ROBOTTINO_ROBOT_WALK_1_ON, ROBOTTINO_ROBOT_WALK_2_ON, ROBOTTINO_ROBOT_WALK_1_OFF, ROBOTTINO_ROBOT_WALK_2_OFF],
        sleep: [ROBOTTINO_ROBOT_SLEEP],
        call: [ROBOTTINO_ROBOT_CALL_1, ROBOTTINO_ROBOT_CALL_2],
      },
    },
  };
});

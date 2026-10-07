/* Il trenino: una locomotiva a vapore col suo vagone. Le ruote girano coi
 * raggi e la biella a ogni tempo del passo, e dal comignolo escono sbuffi di
 * fumo come dalla tazzina (trail: docs/plans/33-animaletti.md); fermo a
 * dormire spegne le luci e non fuma, per chiamare accende i finestrini e
 * fischia. Disegnato a mano nel formato di pets-sprites.js, che lo fonde nel
 * suo catalogo (AisessPetsPack): guarda a destra, la locomotiva davanti.
 *
 * Wrapper UMD come gli altri moduli del renderer: in pagina i personaggi
 * del pacchetto si sommano nello stesso oggetto. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessPetsPack = Object.assign({}, root.AisessPetsPack, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // ---- Il trenino (60×21): vagone, gancio, cabina, caldaia, comignolo ----
  // Quattro tempi: i raggi si alternano a croce e a ics, la biella fa il giro
  const TRENINO_PASSO_1 = [
    '............................................................',
    '............................................................',
    '............................................................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrwwwwwrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrwwwwwrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrwwwwwrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrwwwwwrrbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....sssssssssbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskklkkssskklkkssssssssssssss...',
    '.....kkk.........kkk.........kkglgkk.kkglgkk.....kkk...kkk..',
    '....kkkkk.......kkkkk........klllllllllllllk....kkkkk...kkk.',
    '....klllk.......klllk........kkglgkk.kkglgkk....klllk....kk.',
    '....kkkkk.......kkkkk.........kklkk...kklkk.....kkkkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  const TRENINO_PASSO_2 = [
    '............................................................',
    '............................................................',
    '............................................................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrwwwwwrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrwwwwwrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrwwwwwrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrwwwwwrrbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....sssssssssbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskklllllllllkkssssssssssssss...',
    '.....kkk.........kkk.........kklglkk.kklglkk.....kkk...kkk..',
    '....kklkk.......kklkk........kkglgkk.kkglgkk....kklkk...kkk.',
    '....kklkk.......kklkk........kklglkk.kklglkk....kklkk....kk.',
    '....kklkk.......kklkk.........kkkkk...kkkkk.....kklkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  const TRENINO_PASSO_3 = [
    '............................................................',
    '............................................................',
    '............................................................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrwwwwwrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrwwwwwrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrwwwwwrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrwwwwwrrbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....sssssssssbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskklkkssskklkkssssssssssssss...',
    '.....kkk.........kkk.........kkglgkk.kkglgkk.....kkk...kkk..',
    '....kkkkk.......kkkkk........klllllllllllllk....kkkkk...kkk.',
    '....klllk.......klllk........kkglgkk.kkglgkk....klllk....kk.',
    '....kkkkk.......kkkkk.........kklkk...kklkk.....kkkkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  const TRENINO_PASSO_4 = [
    '............................................................',
    '............................................................',
    '............................................................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrwwwwwrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrwwwwwrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrwwwwwrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrwwwwwrrbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....sssssssssbbbbbnbbbbbnbbbbbbnnh..',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyywwwwyywwwwyywwwwyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskkkkkssskkkkkssssssssssssss...',
    '.....kkk.........kkk.........kklglkk.kklglkk.....kkk...kkk..',
    '....kklkk.......kklkk........kkglgkk.kkglgkk....kklkk...kkk.',
    '....kklkk.......kklkk........kklglkk.kklglkk....kklkk....kk.',
    '....kklkk.......kklkk.........kklllllllllkk.....kklkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  // Luci spente
  const TRENINO_DORME = [
    '............................................................',
    '............................................................',
    '............................................................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrdddddrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrdddddrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrdddddrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrdddddrrbbbbbnbbbbbnbbbbbbnno..',
    '.yyyddddyyddddyyddddyyyy....sssssssssbbbbbnbbbbbnbbbbbbnno..',
    '.yyyddddyyddddyyddddyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyddddyyddddyyddddyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskklkkssskklkkssssssssssssss...',
    '.....kkk.........kkk.........kkglgkk.kkglgkk.....kkk...kkk..',
    '....kkkkk.......kkkkk........klllllllllllllk....kkkkk...kkk.',
    '....klllk.......klllk........kkglgkk.kkglgkk....klllk....kk.',
    '....kkkkk.......kkkkk.........kklkk...kklkk.....kkkkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  // Finestrini accesi e uno sbuffo di fischio sulla cabina
  const TRENINO_CHIAMA = [
    '...............................ee...........................',
    '..............................eeee..........................',
    '...............................ee...........................',
    '..........................rrrrrrrrrrrrr............kkkk.....',
    '...........................sssssssssss..............kk......',
    '............................rrrrrrrrr........oo.....kk......',
    '...rrrrrrrrrrrrrrrrrrr......rrhhhhhrr.......yyyy....kk......',
    '..sssssssssssssssssssss.....rrhhhhhrr.......yyyy....kk......',
    '..ooooooooooooooooooooo.....rrhhhhhrrnnnnnnnnnnnnnnnnnnnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrhhhhhrrbbbbbnbbbbbnbbbbbbnnh..',
    '.yyyhhhhyyhhhhyyhhhhyyyy....sssssssssbbbbbnbbbbbnbbbbbbnnh..',
    '.yyyhhhhyyhhhhyyhhhhyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyhhhhyyhhhhyyhhhhyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyy....rrrrrrrrrbbbbbnbbbbbnbbbbbbnn...',
    '.yyyyyyyyyyyyyyyyyyyyyyykkk.rrrkkkrrrnnkkknnnnnnnnnnnnnnn...',
    '.ooooooooooooooooooooooo....sskklkkssskklkkssssssssssssss...',
    '.....kkk.........kkk.........kkglgkk.kkglgkk.....kkk...kkk..',
    '....kkkkk.......kkkkk........klllllllllllllk....kkkkk...kkk.',
    '....klllk.......klllk........kkglgkk.kkglgkk....klllk....kk.',
    '....kkkkk.......kkkkk.........kklkk...kklkk.....kkkkk.......',
    '.....kkk.........kkk...........kkk.....kkk.......kkk........',
  ];
  // Gli sbuffi: nascono piccoli, si gonfiano, si sfilacciano
  const TRENINO_SBUFFO_1 = [
    '........',
    '........',
    '...ee...',
    '..effe..',
    '..eeee..',
    '...ee...',
    '........',
    '........',
  ];
  const TRENINO_SBUFFO_2 = [
    '........',
    '...ee...',
    '..effe..',
    '.eeffee.',
    '.eeeeee.',
    '..eeee..',
    '...e....',
    '........',
  ];
  const TRENINO_SBUFFO_3 = [
    '..ee..e.',
    '.e..ee.e',
    'e.ee..e.',
    '.ee..ee.',
    'e..ee..e',
    '.ee..e..',
    '..e..ee.',
    '........',
  ];

  return {
    trenino: {
      speed: 1.1,
      motion: 'walk',
      height: 0.63,
      palette: { r: '#D9412E', s: '#A8302A', b: '#3E6FB8', n: '#2E528A', y: '#F2C230', o: '#D9A021', g: '#5C5F6B', k: '#3A3B44', l: '#9EA3AE', w: '#CFE8F5', d: '#4A5A78', h: '#F7E27A', e: '#E8E2D6', f: '#F4F1EA' },
      frames: {
        walk: [TRENINO_PASSO_1, TRENINO_PASSO_2, TRENINO_PASSO_3, TRENINO_PASSO_4],
        sleep: [TRENINO_DORME],
        call: [TRENINO_CHIAMA],
      },
      // Il fumo esce dal comignolo, davanti: correndo se lo lascia dietro
      trail: { frames: [TRENINO_SBUFFO_1, TRENINO_SBUFFO_2, TRENINO_SBUFFO_3], at: { col: 52, row: 3 } },
    },
  };
});

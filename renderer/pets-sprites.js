/* Disegni degli animaletti (docs/plans/33-animaletti.md).
 *
 * Ogni personaggio è pixel art scritta a mano: una griglia di caratteri per
 * frame e una palette che dà il colore a ogni carattere ('.' è trasparente).
 * Un disegno può avere `variants`: palette alternative (solo i colori che
 * cambiano) fra cui il motore sceglie a caso alla nascita, così due pesci
 * non sono per forza uguali.
 * Così un disegno si legge e si ritocca qui, senza file esterni, e la pagina
 * lo costruisce con createElementNS (niente innerHTML, CSP invariata).
 * Guardano tutti a destra: chi va a sinistra lo specchia la vista.
 * I personaggi dei pacchetti di sprite dell'utente stanno nei file
 * pets-sprite-*.js (generati) e si fondono qui nel catalogo.
 *
 * I personaggi di SpongeBob sono di Nickelodeon/Paramount; tenerli qui è una
 * scelta presa sapendolo (piano 33). Per toglierli basta togliere le voci:
 * il motore (pets.js) non dipende da nessun personaggio.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root
    ? factory(root.AisessPetsPack)
    : factory(Object.assign({}, ...['pizza', 'fizzo', 'rotolacampo', 'babbo', 'morte', 'zucca', 'fantasmino'].map((k) => require(`./pets-sprite-${k}`))));
  if (root) root.AisessPetsSprites = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (pack) {
  /** Righe di riferimento: un pixel vale size / GRID, così i piccoli restano
   *  piccoli; un disegno più alto si rimpicciolisce per stare in size (pixel). */
  const GRID = 16;

  const REQUIRED_POSES = ['walk', 'sleep', 'call'];
  const EXTRA_POSES = { spongebob: ['swing'], medusa: ['flee'], rana: ['jump'] };
  /** Pose che un disegno può avere o no: il motore le usa solo se ci sono
   *  (pets.js). idle: si ferma un attimo a passeggio. turn: cambia verso.
   *  startle: un agente si mette al lavoro. laugh: un'attesa finisce.
   *  sad: l'attesa dura da troppo. appear/vanish: entra ed esce dal cast. */
  const OPTIONAL_POSES = ['idle', 'turn', 'startle', 'laugh', 'sad', 'appear', 'vanish'];

  /** Copia di un frame con alcune righe sostituite: i frame differiscono per poco. */
  const patch = (base, rows) => base.map((row, i) => (rows[i] === undefined ? row : rows[i]));

  // ---- SpongeBob, dallo sprite GBA ritoccato da gianlucarugergr, col retino alzato ----
  // Passo destro; la riga vuota in cima serve al corpo per salire nel passo intermedio
  const SPONGE = [
    '.....................................',
    '......dds.ssds..sdds.sdd.............',
    '.....dsyossoyossoyyodoyys............',
    '....dsdyyyyyyyyyyyyyyyyys............',
    '...dsqdyyyykykykyykykykyq.....eeeee..',
    '...dqodyyyydddsyyydddsyys....efefefe.',
    '...doosoyydwwwwsydwwwwsys...eefefefee',
    '..dsooqsydwwwwwwdwwwwwwyq....efefefe.',
    '.dqqddodydwwwbkwdwwbkwwyo.....eeeee..',
    '.dqoddodydwwwkkkdwwkkkwyo.......g....',
    '.dsossodyrrwwbkbdwwbkbwys.......g....',
    '..dqooosoyyrwwwwkkkkkkkyd......g.....',
    '..dsoooqsyyysdddyyyyyykyd......g.....',
    '...doddodykkyyyyqkkkkkyys......g.....',
    '...dqssodyookyyyyyyodyyyq.....g......',
    '...dsooodyyyokkkkkkkkyyyo.....g......',
    '....dooosoyyyokwwkwwkyyyo.....g......',
    '.dowwqooqsyyyyykkykkyqdys....g.......',
    'doyywwhhodyqdyyyyyyyyoq......g.......',
    'dys.hwwaodyoqydyydyysyyyswod.g.......',
    'dys..aasodyyyyyddydsyyyydwyog........',
    'dls...dqosyyoqyyyyyyoqyshhayg........',
    'dlds..ddddsqsddsqoqsddsd..dys........',
    'dyyys.ahhawwhawwmrrwwahd..dls........',
    'doyod.ahhawwwhahwrwhahwh.ddls........',
    '.dqd..xzzxngggggmrrgggghdyyys........',
    '......xkkxnkkgkkmrrkkgkndoyos........',
    '......xzzxnggggggmgggggn.dqd.........',
    '........xxxzzn.xxxzzn................',
    '.......slqznn...xznn.................',
    '.......syo........slq................',
    '.......awh........syo................',
    '.......kkakk......awh................',
    '.......kkkawk.....kkakk..............',
    '.......kkkkkk.....kkkawk.............',
    '.......kkkkkk.....kkkkkk.............',
  ];
  // Gambe unite e corpo su di uno, fra un passo e l'altro
  const SPONGE_MID = patch(SPONGE, {
    0: '......dds.ssds..sdds.sdd.............',
    1: '.....dsyossoyossoyyodoyys............',
    2: '....dsdyyyyyyyyyyyyyyyyys............',
    3: '...dsqdyyyykykykyykykykyq.....eeeee..',
    4: '...dqodyyyydddsyyydddsyys....efefefe.',
    5: '...doosoyydwwwwsydwwwwsys...eefefefee',
    6: '..dsooqsydwwwwwwdwwwwwwyq....efefefe.',
    7: '.dqqddodydwwwbkwdwwbkwwyo.....eeeee..',
    8: '.dqoddodydwwwkkkdwwkkkwyo.......g....',
    9: '.dsossodyrrwwbkbdwwbkbwys.......g....',
    10: '..dqooosoyyrwwwwkkkkkkkyd......g.....',
    11: '..dsoooqsyyysdddyyyyyykyd......g.....',
    12: '...doddodykkyyyyqkkkkkyys......g.....',
    13: '...dqssodyookyyyyyyodyyyq.....g......',
    14: '...dsooodyyyokkkkkkkkyyyo.....g......',
    15: '....dooosoyyyokwwkwwkyyyo.....g......',
    16: '....dqooqsyyyyykkykkyqdys....g.......',
    17: '.dowwwhhodyqdyyyyyyyyoqyswod.g.......',
    18: 'doyywwwaodyoqydyydyysyyydwyosg.......',
    19: 'dys.haasodyyyyyddydsyyyshhayg........',
    20: 'dys...dqosyyoqyyyyyyoqyd..dyg........',
    21: 'dls...ddddsqsddsqoqsddsd..dls........',
    22: 'dlds..ahhawwhawwmrrwwahh.ddls........',
    23: 'dyyys.ahhawwwhahwrwhahwhdyyys........',
    24: 'doyod.xzzxngggggmrrggggndoyos........',
    25: '.dqd..xkkxnkkgkkmrrkkgkn.dqd.........',
    26: '......xzzxnggggggmgggggn.............',
    27: '........xxxzzn.xxxzzn................',
    28: '.........xznn...xznn.................',
    29: '.........slq....slq..................',
    30: '.........syo....syo..................',
    31: '.........awh....awh..................',
    32: '.........kkakk..kkakk................',
    33: '.........kkkawk.kkkawk...............',
    34: '.........kkkkkk.kkkkkk...............',
    35: '.....................................',
  });
  // Passo sinistro, braccia al contrario
  const SPONGE_STEP = patch(SPONGE, {
    4: '...dsqdyyyykykykyykykykyq............',
    5: '...dqodyyyydddsyyydddsyys.....eeeee..',
    6: '...doosoyydwwwwsydwwwwsys....efefefe.',
    7: '..dsooqsydwwwwwwdwwwwwwyq...eefefefee',
    8: '.dqqddodydwwwbkwdwwbkwwyo....efefefe.',
    9: '.dqoddodydwwwkkkdwwkkkwyo.....eeeee..',
    11: '..dqooosoyyrwwwwkkkkkkkyd.......g....',
    14: '...dqssodyookyyyyyyodyyyq......g.....',
    17: '....dqooqsyyyyykkykkyqdyswod..g......',
    18: '.....whhodyqdyyyyyyyyoqydwyosg.......',
    19: '.dowwwwaodyoqydyydyysyyshhaysg.......',
    20: 'doyywaasodyyyyyddydsyyyd..dysg.......',
    21: 'dys.h.dqosyyoqyyyyyyoqyd..dlg........',
    22: 'dys...ddddsqsddsqoqsddsh.ddlg........',
    23: 'dls...ahhawwhawwmrrwwahhdyyys........',
    24: 'dlds..ahhawwwhahwrwhahwndoyos........',
    25: 'dyyys.xzzxngggggmrrggggn.dqd.........',
    26: 'doyod.xkkxnkkgkkmrrkkgk..............',
    27: '.dqd..xzzxnggggggmgggggn.............',
    29: '.........xznn..slqnn.................',
    30: '...........slq.syo...................',
    31: '...........syo.awh...................',
    32: '...........awh.kkakk.................',
    33: '...........kkakkkkawk................',
    34: '...........kkkakkkkkk................',
    35: '...........kkkkkk....................',
  });
  // Fermo, braccia a riposo: base del colpo di retino, del sonno e della chiamata
  const SPONGE_STAND = patch(SPONGE, {
    17: '....dqooqsyyyyykkykkyqdys....g.......',
    18: '.dowwwhhodyqdyyyyyyyyoqyswod.g.......',
    19: 'doyywwwaodyoqydyydyysyyydwyosg.......',
    20: 'dys.haasodyyyyyddydsyyyshhayg........',
    21: 'dys...dqosyyoqyyyyyyoqyd..dyg........',
    22: 'dls...ddddsqsddsqoqsddsd..dls........',
    23: 'dlds..ahhawwhawwmrrwwahh.ddls........',
    24: 'dyyys.ahhawwwhahwrwhahwhdyyys........',
    25: 'doyod.xzzxngggggmrrggggndoyos........',
    26: '.dqd..xkkxnkkgkkmrrkkgkn.dqd.........',
    27: '......xzzxnggggggmgggggn.............',
    29: '.........xznn...xznn.................',
    30: '.........slq....slq..................',
    31: '.........syo....syo..................',
    32: '.........awh....awh..................',
    33: '.........kkakk..kkakk................',
    34: '.........kkkawk.kkkawk...............',
    35: '.........kkkkkk.kkkkkk...............',
  });
  // Colpo di retino: il retino scende davanti, all'altezza della medusa
  const SPONGE_SWING = patch(SPONGE_STAND, {
    4: '...dsqdyyyykykykyykykykyq............',
    5: '...dqodyyyydddsyyydddsyys............',
    6: '...doosoyydwwwwsydwwwwsys............',
    7: '..dsooqsydwwwwwwdwwwwwwyq............',
    8: '.dqqddodydwwwbkwdwwbkwwyo............',
    9: '.dqoddodydwwwkkkdwwkkkwyo............',
    10: '.dsossodyrrwwbkbdwwbkbwys............',
    11: '..dqooosoyyrwwwwkkkkkkkyd............',
    12: '..dsoooqsyyysdddyyyyyykyd............',
    13: '...doddodykkyyyyqkkkkkyys............',
    14: '...dqssodyookyyyyyyodyyyq............',
    15: '...dsooodyyyokkkkkkkkyyyo............',
    16: '....dooosoyyyokwwkwwkyyyo............',
    17: '....dqooqsyyyyykkykkyqdys............',
    18: '.dowwwhhodyqdyyyyyyyyoqyswod.........',
    19: 'doyywwwaodyoqydyydyysyyydwyos........',
    20: 'dys.haasodyyyyyddydsyyyshhays........',
    21: 'dys...dqosyyoqyyyyyyoqyd..dys........',
    23: 'dlds..ahhawwhawwmrrwwahh.ddlsgg......',
    24: 'dyyys.ahhawwwhahwrwhahwhdyyys..gg....',
    25: 'doyod.xzzxngggggmrrggggndoyos....eee.',
    26: '.dqd..xkkxnkkgkkmrrkkgkn.dqd....efefe',
    27: '......xzzxnggggggmgggggn........eefee',
    28: '........xxxzzn.xxxzzn...........efefe',
    29: '.........xznn...xznn............eefee',
    30: '.........slq....slq.............efefe',
    31: '.........syo....syo..............eee.',
  });
  const SPONGE_SLEEP = patch(SPONGE_STAND, {
    6: '...doosoyydyyyysydyyyysys...eefefefee',
    7: '..dsooqsydyyyyyydyyyyyyyq....efefefe.',
    8: '.dqqddodydyyyyyydyyyyyyyo.....eeeee..',
    9: '.dqoddodydykkkkydykkkkyyo.......g....',
    10: '.dsossodyrryyyyydyyyyyyys.......g....',
    11: '..dqooosoyyryyyykkkkkkkyd......g.....',
  });
  const SPONGE_CALL = patch(SPONGE_STAND, {
    17: '....dqooqsyyykmmmmmmkqdys....g.......',
    18: '.dowwwhhodyqdykkkkkkyoqyswod.g.......',
  });

  // ---- Medusa: campana con riflesso e macchie, quattro tentacoli; le colonne vuote a sinistra servono ai tentacoli in fuga ----
  const JELLY = [
    '........pppppp....',
    '......ppppppppwp..',
    '.....pplppppppwwp.',
    '.....plpppdppppwp.',
    '....pppppddpppppwp',
    '....ppddppppppddpp',
    '....pppddppdppddpp',
    '....ppppppppppppp.',
    '.....p..pp..p..pp.',
    '.....p..p...p..p..',
    '......p.p..p...p..',
    '......p..p.p...p..',
    '.....p...p..p.p...',
    '.....p..p...p.p...',
  ];
  const JELLY_STEP = patch(JELLY, {
    8: '......p.pp..p..pp.',
    9: '......p..p..p..p..',
    10: '.....p...p.p...p..',
    11: '.....p..p..p...p..',
    12: '......p.p...p.p...',
    13: '......p.p...p..p..',
  });
  // In fuga i tentacoli restano indietro
  const JELLY_FLEE = patch(JELLY, {
    8: '....p..pp..p..pp..',
    9: '...p..p...p..p....',
    10: '....p.p..p...p....',
    11: '...p..p.p...p.....',
    12: '..p...p..p.p......',
    13: '.p..p...p.p.......',
  });
  const JELLY_FLEE_STEP = patch(JELLY, {
    8: '.....p.pp..p..pp..',
    9: '....p..p..p..p....',
    10: '...p...p.p...p....',
    11: '..p..p..p...p.....',
    12: '...p.p...p.p......',
    13: '..p.p...p..p......',
  });
  // Tentacoli a penzoloni
  const JELLY_SLEEP = patch(JELLY, {
    8: '.....p..p...p..p..',
    10: '.....p..p...p..p..',
    11: '.....p..p...p..p..',
    12: '.....p..p...p..p..',
    13: '.....p..p...p.....',
  });

  // ---- Patrick: due occhi strabici, sorriso largo, pantaloncini a fiori ----
  const STAR = [
    '.......pp.......',
    '......pppp......',
    '......pppp......',
    '.....pppppp.....',
    '.....pppppp.....',
    '....pwwppwwp....',
    '....pwkppkwp....',
    '....pppppppp....',
    '...ppmppppmpp...',
    'ppppppmmmmpppppp',
    'pp.pppppppppp.pp',
    '....pppdpppp....',
    '....gggggggg....',
    '...gvggggggvg...',
    '...gggg..gggg...',
    '...ppp....ppp...',
  ];
  const STAR_STEP = patch(STAR, { 10: '.pppppppppppppp.', 15: '....ppp..ppp....' });

  // ---- Gary ----
  const SNAIL = [
    '..........e..e',
    '..........b..b',
    '...ssss...b.b.',
    '..sccccs...bb.',
    '.scsssscs..bb.',
    '.scsccscs..bb.',
    '.scssscs..bbb.',
    '..sssss.bbbbb.',
    'bbbbbbbbbbbbbb',
    '.bbbbbbbbbbbb.',
  ];
  const SNAIL_STEP = patch(SNAIL, { 8: '.bbbbbbbbbbbbb', 9: 'bbbbbbbbbbbbb.' });

  // ---- Gatto ----
  const CAT = [
    'd........o...o',
    'd........ooooo',
    '.d.......ogoog',
    '.d.......ooopo',
    '..d.....ooooo.',
    '..oooooooooo..',
    '..odoooddooo..',
    '..oooooooooo..',
    '..o.o....o.o..',
    '..o.o....o.o..',
  ];
  const CAT_STEP = patch(CAT, { 8: '...o.o..o.o...', 9: '...o.o..o.o...' });

  // ---- Rana: seduta, e in salto con le zampe distese dietro ----
  const FROG = [
    '..............',
    '.........gg...',
    '........gwkg..',
    '....ggggggggg.',
    '...ggggggggggg',
    '..gggggggmmmm.',
    '.ggllllllllgg.',
    '.gggglllllgg..',
    'gg..gg...gg...',
    'ggg.ggg..ggg..',
  ];
  const FROG_JUMP = patch(FROG, {
    0: '.........gg...',
    1: '........gwkg..',
    2: '....ggggggggg.',
    3: '...ggggggggggg',
    4: '..gggggggmmmm.',
    5: 'gggllllllllgg.',
    6: 'gg.gglllllg...',
    7: 'g.........gg..',
    8: '..............',
    9: '..............',
  });

  // ---- Uccellino: ali su, ali giù; posato ha le zampe ----
  const BIRD_UP = [
    '..ww......',
    '..www..bb.',
    '...wwbbkbo',
    'tbbbbbbbb.',
    '.tbbbllll.',
    '..bbllll..',
    '..........',
    '..........',
  ];
  const BIRD_DOWN = patch(BIRD_UP, {
    0: '..........',
    1: '.......bb.',
    2: '.....bbkbo',
    4: '.tbwwwlll.',
    5: '..bwwwll..',
    6: '...ww.....',
  });
  const BIRD_PERCHED = patch(BIRD_UP, {
    0: '..........',
    1: '.......bb.',
    2: '.....bbkbo',
    6: '....o.o...',
    7: '...oo.oo..',
  });

  // ---- Pesce: la coda batte ----
  const FISH = [
    '.....ooo....',
    'o..oooowooo.',
    'oo.oooowooko',
    'ooooooowoooo',
    'oo.oooowooo.',
    'o..oooowoo..',
    '.....ooo....',
    '............',
  ];
  const FISH_STEP = patch(FISH, {
    1: '...oooowooo.',
    2: 'o..oooowooko',
    4: 'o..oooowooo.',
    5: '...oooowoo..',
  });

  /** speed: misure del personaggio al secondo, a velocità «normale».
   *  motion: come si muove (pets.js MOTIONS): cammina, salta, vola, nuota.
   *  height: altezza come frazione della taglia, per chi non segue la regola di GRID.
   *  shadow: ombra a terra per chi vola, un frame per frame di walk (facoltativa). */
  const SPRITES = {
    spongebob: {
      speed: 1.3,
      motion: 'walk',
      palette: { y: '#F7FF47', l: '#D1E32B', o: '#B3C227', s: '#80892E', q: '#9DA929', d: '#625E1F', k: '#000000', w: '#F8F8F8', h: '#C7C8B8', a: '#878878', b: '#5EA5E5', r: '#DE0C0B', m: '#A52524', x: '#2A1206', z: '#483018', n: '#84430D', g: '#B57919', e: '#D8ECF4', f: '#8FB8CC' },
      frames: {
        walk: [SPONGE, SPONGE_MID, SPONGE_STEP, SPONGE_MID],
        swing: [SPONGE_STAND, SPONGE_SWING],
        sleep: [SPONGE_SLEEP],
        call: [SPONGE_CALL],
      },
    },
    // Metà di SpongeBob, come nel cartone
    medusa: {
      speed: 0.9,
      motion: 'walk',
      height: 0.5,
      palette: { p: '#F06A9B', l: '#F9B4CC', d: '#C8367A', w: '#FFFFFF' },
      frames: {
        walk: [JELLY, JELLY_STEP],
        flee: [JELLY_FLEE, JELLY_FLEE_STEP],
        sleep: [JELLY_SLEEP],
        call: [JELLY],
      },
    },
    patrick: {
      speed: 0.6,
      motion: 'walk',
      palette: { p: '#F4A3B5', d: '#D9748C', w: '#FFFFFF', k: '#1A1A1A', m: '#7A1F1F', g: '#7BC25A', v: '#9B59B6' },
      frames: {
        walk: [STAR, STAR_STEP],
        sleep: [patch(STAR, { 5: '....pppppppp....', 6: '....pkkppkkp....', 8: '...pppppppppp...', 9: 'pppppppmmppppppp' })],
        // Braccia alzate e bocca aperta
        call: [patch(STAR, { 7: 'pp..pppppppp..pp', 8: '.ppppmppppmpppp.', 9: '....ppmmmmpp....', 10: '....pppmmppp....' })],
      },
    },
    gary: {
      speed: 0.15,
      motion: 'walk',
      palette: { s: '#E8759A', c: '#A8406A', b: '#8FD3E8', e: '#F3E36A' },
      frames: {
        walk: [SNAIL, SNAIL_STEP],
        sleep: [patch(SNAIL, { 0: '..............', 1: '..............', 2: '...ssss.......' })],
        call: [SNAIL],
      },
    },
    gatto: {
      speed: 1,
      motion: 'walk',
      palette: { o: '#E8963C', d: '#A85E1E', g: '#7BC25A', p: '#F4A3B5' },
      frames: {
        walk: [CAT, CAT_STEP],
        sleep: [patch(CAT, { 2: '.d.......odood' })],
        call: [CAT],
      },
    },
    // In aria va più svelta della pizza, ma metà del tempo sta seduta
    rana: {
      speed: 1.6,
      motion: 'hop',
      height: 0.4,
      palette: { g: '#5DBB4A', l: '#C8E88A', w: '#FFFFFF', k: '#1A1A1A', m: '#2E6B2A' },
      frames: {
        walk: [FROG, FROG],
        jump: [FROG_JUMP],
        sleep: [patch(FROG, { 2: '........gkkg..' })],
        call: [patch(FROG, { 5: '..gggggggg....', 6: '.gglllllllmmm.', 7: '.gggglllllmm..' })],
      },
    },
    uccellino: {
      speed: 1.1,
      motion: 'fly',
      palette: { b: '#4FA3E0', w: '#2F77B8', t: '#2F77B8', l: '#F3E9C8', k: '#1A1A1A', o: '#F29B30' },
      // Azzurro di base; poi pettirosso, canarino, cardinale
      variants: [
        { b: '#8B5A2B', w: '#6B4220', t: '#6B4220', l: '#E8603C', o: '#5A3A1A' },
        { b: '#F2D23C', w: '#D4B12A', t: '#D4B12A', l: '#FBF0A0' },
        { b: '#D8322B', w: '#A9241F', t: '#A9241F', l: '#E5514A' },
      ],
      frames: {
        walk: [BIRD_UP, BIRD_DOWN],
        sleep: [patch(BIRD_PERCHED, { 2: '.....bbbbo' })],
        call: [patch(BIRD_PERCHED, { 1: '.......bbo', 2: '.....bbkb.', 3: 'tbbbbbbbbo' })],
      },
    },
    pesce: {
      speed: 0.7,
      motion: 'swim',
      palette: { o: '#F2833A', w: '#FFFFFF', k: '#1A1A1A', e: '#BFE6F5' },
      // Pesce pagliaccio di base; poi blu a righe gialle, verde, rosa
      variants: [
        { o: '#3C7BE0', w: '#F2D23C' },
        { o: '#5DBB4A', w: '#C8E88A' },
        { o: '#C86BC8', w: '#F4D0F4' },
      ],
      frames: {
        walk: [FISH, FISH_STEP],
        sleep: [patch(FISH, { 2: 'oo.oooowoooo' })],
        call: [patch(FISH, { 0: '.....ooo...e', 1: 'o..oooowooe.' })],
      },
    },
    ...pack,
  };
  const MOTIONS = ['walk', 'hop', 'fly', 'swim'];

  /** Voci che si scelgono nelle impostazioni: SpongeBob e la medusa vanno
   *  insieme, ma la medusa si può avere anche da sola. */
  const CAST = {
    inseguimento: ['spongebob', 'medusa'],
    medusa: ['medusa'],
    patrick: ['patrick'],
    gary: ['gary'],
    gatto: ['gatto'],
    pizza: ['pizza'],
    rana: ['rana'],
    uccellino: ['uccellino'],
    pesce: ['pesce'],
    fizzo: ['fizzo'],
    rotolacampo: ['rotolacampo'],
    babbo: ['babbo'],
    morte: ['morte'],
    zucca: ['zucca'],
    fantasmino: ['fantasmino'],
  };
  const CAST_LABELS = {
    inseguimento: 'SpongeBob e la medusa',
    medusa: 'Medusa',
    patrick: 'Patrick',
    gary: 'Gary',
    gatto: 'Gatto',
    pizza: 'Peppo, la pizza',
    rana: 'Rana',
    uccellino: 'Uccellino',
    pesce: 'Pesce',
    fizzo: 'Fizzo, la bibita',
    rotolacampo: 'Rotolacampo',
    babbo: 'Babbo Natale',
    morte: 'La Morte',
    zucca: 'Zucco, la zucca',
    fantasmino: 'Fantasmino',
  };

  /** Quanti aspetti ha un personaggio: la palette di base più le variants. */
  const looks = (kind) => 1 + (SPRITES[kind].variants || []).length;

  /** La palette dell'aspetto scelto: 0 è quella di base, le altre la ritoccano. */
  function paletteOf(kind, variant = 0) {
    const { palette, variants = [] } = SPRITES[kind];
    return variant > 0 && variants[variant - 1] ? { ...palette, ...variants[variant - 1] } : palette;
  }

  /** Colonne e righe di un personaggio (tutti i suoi frame hanno la stessa misura). */
  function dims(kind) {
    const [frame] = SPRITES[kind].frames.walk;
    return { cols: frame[0].length, rows: frame.length };
  }

  /** Lato di un pixel del disegno, in pixel dello schermo, all'altezza size.
   *  Un disegno con height (frazione di size) è alto esattamente quello. */
  function pixel(kind, size) {
    const { rows } = dims(kind);
    const { height } = SPRITES[kind];
    return height ? (size * height) / rows : size / Math.max(GRID, rows);
  }

  /**
   * Una riga di pixel uguali contigui diventa un rettangolo solo: un frame di
   * 16×16 scende da 256 elementi a qualche decina.
   * @returns {{x: number, y: number, w: number, fill: string}[]}
   */
  function toRects(rows, palette) {
    const rects = [];
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        let end = x + 1;
        while (end < row.length && row[end] === ch) end += 1;
        if (ch !== '.') rects.push({ x, y, w: end - x, fill: palette[ch] });
        x = end;
      }
    });
    return rects;
  }

  return { SPRITES, CAST, CAST_LABELS, REQUIRED_POSES, EXTRA_POSES, OPTIONAL_POSES, MOTIONS, GRID, dims, pixel, looks, paletteOf, toRects };
});

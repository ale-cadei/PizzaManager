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
 * Qui non entrano personaggi di qualcun altro: SpongeBob, Patrick e Gary
 * c'erano e sono stati tolti (piano 49), perché sono di Nickelodeon/Paramount
 * e l'app è distribuita con una licenza nostra. Non rimettiamoli.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = root
    ? factory(root.AisessPetsPack)
    : factory(Object.assign({}, ...['pizza', 'fizzo', 'rotolacampo', 'babbo', 'morte', 'zucca', 'fantasmino', 'ape', 'chiocciola', 'papera', 'anatroccolo', 'robottino', 'tazzina', 'pesce', 'trenino', 'granchio', 'barchetta'].map((k) => require(`./pets-sprite-${k}`))));
  if (root) root.AisessPetsSprites = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (pack) {
  /** Righe di riferimento: un pixel vale size / GRID, così i piccoli restano
   *  piccoli; un disegno più alto si rimpicciolisce per stare in size (pixel). */
  const GRID = 16;

  const REQUIRED_POSES = ['walk', 'sleep', 'call'];
  const EXTRA_POSES = { rana: ['jump'] };
  /** Pose che un disegno può avere o no: il motore le usa solo se ci sono
   *  (pets.js). idle: si ferma un attimo a passeggio. turn: cambia verso.
   *  startle: un agente si mette al lavoro. laugh: un'attesa finisce.
   *  sad: l'attesa dura da troppo. appear/vanish: entra ed esce dal cast. */
  const OPTIONAL_POSES = ['idle', 'turn', 'startle', 'laugh', 'sad', 'appear', 'vanish'];

  /** Copia di un frame con alcune righe sostituite: i frame differiscono per poco. */
  const patch = (base, rows) => base.map((row, i) => (rows[i] === undefined ? row : rows[i]));

  // ---- Medusa: campana con riflesso e macchie, quattro tentacoli ----
  const JELLY = [
    '....pppppp....',
    '..ppppppppwp..',
    '.pplppppppwwp.',
    '.plpppdppppwp.',
    'pppppddpppppwp',
    'ppddppppppddpp',
    'pppddppdppddpp',
    'ppppppppppppp.',
    '.p..pp..p..pp.',
    '.p..p...p..p..',
    '..p.p..p...p..',
    '..p..p.p...p..',
    '.p...p..p.p...',
    '.p..p...p.p...',
  ];
  const JELLY_STEP = patch(JELLY, {
    8: '..p.pp..p..pp.',
    9: '..p..p..p..p..',
    10: '.p...p.p...p..',
    11: '.p..p..p...p..',
    12: '..p.p...p.p...',
    13: '..p.p...p..p..',
  });
  // Tentacoli a penzoloni
  const JELLY_SLEEP = patch(JELLY, {
    8: '.p..p...p..p..',
    10: '.p..p...p..p..',
    11: '.p..p...p..p..',
    12: '.p..p...p..p..',
    13: '.p..p...p.....',
  });

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
  // Per dormire si sdraia come i gatti: a pagnotta, zampe sotto, la testa
  // un po' su con gli occhi chiusi e la coda stesa davanti, a terra
  const CAT_SLEEP = [
    '..............',
    '..............',
    '..............',
    '..............',
    '..............',
    '.........o...o',
    '.........ooooo',
    '...ooooo.odood',
    '.oodooddoooopo',
    'dddddddooooooo',
  ];

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

  /** speed: misure del personaggio al secondo, a velocità «normale».
   *  motion: come si muove (pets.js MOTIONS): cammina, salta, vola, nuota.
   *  height: altezza come frazione della taglia, per chi non segue la regola di GRID.
   *  shadow: ombra a terra per chi vola, un frame per frame di walk (facoltativa).
   *  perch: dove si posa per dormire e chiamare, un disegno fermo a terra (grid)
   *    e l'altezza in righe a cui si siede (seat). Facoltativo.
   *  bubbles: disegni davanti alla bocca mentre chiama, alti quanto il
   *    personaggio, uno dopo l'altro. Facoltativi.
   *  trail: scia di sbuffi (la tazzina, il trenino): i frame di uno sbuffo, dal più
   *    giovane al più vecchio, e la cella del disegno (at) da cui nascono,
   *    a personaggio girato a destra. Facoltativa. */
  const SPRITES = {
    // Bassa la metà di una misura (height), come un personaggio che galleggia
    medusa: {
      speed: 0.9,
      motion: 'walk',
      height: 0.5,
      palette: { p: '#F06A9B', l: '#F9B4CC', d: '#C8367A', w: '#FFFFFF' },
      frames: {
        walk: [JELLY, JELLY_STEP],
        sleep: [JELLY_SLEEP],
        call: [JELLY],
      },
    },
    gatto: {
      speed: 1,
      motion: 'walk',
      palette: { o: '#E8963C', d: '#A85E1E', g: '#7BC25A', p: '#F4A3B5' },
      frames: {
        walk: [CAT, CAT_STEP],
        sleep: [CAT_SLEEP],
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
    ...pack,
  };
  const MOTIONS = ['walk', 'hop', 'fly', 'swim'];

  /** Voci che si scelgono nelle impostazioni: quasi sempre un personaggio,
   *  a volte un gruppetto (la papera con gli anatroccoli). */
  const CAST = {
    medusa: ['medusa'],
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
    ape: ['ape'],
    chiocciola: ['chiocciola'],
    papera: ['papera', 'anatroccolo', 'anatroccolo'],
    robottino: ['robottino'],
    tazzina: ['tazzina'],
    trenino: ['trenino'],
    granchio: ['granchio'],
    barchetta: ['barchetta'],
  };
  const CAST_LABELS = {
    medusa: 'Medusa',
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
    ape: 'Ape',
    chiocciola: 'Chiocciola',
    papera: 'Papera e anatroccoli',
    robottino: 'Robbo, il robottino',
    tazzina: 'Tazzi, la tazzina',
    trenino: 'Trenino',
    granchio: 'Granchio',
    barchetta: 'Barchetta di carta',
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

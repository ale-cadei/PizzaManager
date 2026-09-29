/* Disegni degli animaletti (docs/plans/33-animaletti.md).
 *
 * Ogni personaggio è pixel art scritta a mano: una griglia di caratteri per
 * frame e una palette che dà il colore a ogni carattere ('.' è trasparente).
 * Così un disegno si legge e si ritocca qui, senza file esterni, e la pagina
 * lo costruisce con createElementNS (niente innerHTML, CSP invariata).
 * Guardano tutti a destra: chi va a sinistra lo specchia la vista.
 *
 * I personaggi di SpongeBob sono di Nickelodeon/Paramount; tenerli qui è una
 * scelta presa sapendolo (piano 33). Per toglierli basta togliere le voci:
 * il motore (pets.js) non dipende da nessun personaggio.
 *
 * Wrapper UMD come gli altri moduli del renderer. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessPetsSprites = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  /** Righe di riferimento: un pixel vale size / GRID, così i piccoli restano piccoli. */
  const GRID = 16;

  const REQUIRED_POSES = ['walk', 'sleep', 'call'];
  const EXTRA_POSES = { spongebob: ['swing'], medusa: ['flee'] };

  /** Copia di un frame con alcune righe sostituite: i frame differiscono per poco. */
  const patch = (base, rows) => base.map((row, i) => (rows[i] === undefined ? row : rows[i]));

  // ---- SpongeBob, retino alzato ----
  const SPONGE = [
    '............eee.',
    '...........e.e.e',
    '.yyyyyyyyyyeeeee',
    '.yoyyyyyyoy.eee.',
    '.ywwyyywwyy..g..',
    '.ywbyyywbyy..g..',
    '.yyyyoyyyyy..g..',
    '.ykwwwwkyoy..g..',
    '.yykkkkyyyy..g..',
    '.wwwwrrwwwwyyg..',
    '.wwwwrrwwww..g..',
    '.nnnnnnnnnn..g..',
    '....y..y........',
    '....y..y........',
    '...kk..kk.......',
    '................',
  ];
  const SPONGE_STEP = patch(SPONGE, {
    12: '...y....y.......',
    13: '..y......y......',
    14: '.kk......kk.....',
  });
  // Colpo di retino: il retino scende davanti, all'altezza della medusa
  const SPONGE_SWING = patch(SPONGE, {
    0: '................',
    1: '................',
    2: '.yyyyyyyyyy.....',
    3: '.yoyyyyyyoy.....',
    4: '.ywwyyywwyy.....',
    5: '.ywbyyywbyy.....',
    6: '.yyyyoyyyyy.....',
    7: '.ykwwwwkyoy.....',
    8: '.yykkkkyyyy.....',
    9: '.wwwwrrwwwwyg...',
    10: '.wwwwrrwwww.g...',
    11: '.nnnnnnnnnn.eee.',
    12: '....y..y...e.e.e',
    13: '....y..y...eeeee',
    14: '...kk..kk...eee.',
  });

  // ---- Medusa ----
  const JELLY = [
    '...pppp...',
    '..pllllp..',
    '.plpllplp.',
    '.pllllllp.',
    'pppppppppp',
    '.d.d..d.d.',
    '.d..d.d..d',
    'd...d..d..',
  ];
  const JELLY_STEP = patch(JELLY, { 6: 'd..d.d..d.', 7: '.d..d..d.d' });
  // In fuga i tentacoli restano indietro
  const JELLY_FLEE = patch(JELLY, { 5: 'dd.dd.dd..', 6: '.dd.dd.dd.', 7: '..........' });
  const JELLY_FLEE_STEP = patch(JELLY, { 5: '.dd.dd.dd.', 6: 'dd.dd.dd..', 7: '..........' });

  // ---- Patrick ----
  const STAR = [
    '......pp......',
    '.....pppp.....',
    '.....pppp.....',
    '....pwwwwp....',
    '....pwkkwp....',
    '...pppppppp...',
    '...ppmmmmpp...',
    'pppppppppppppp',
    'pp..pppppp..pp',
    '....pppppp....',
    '...gggggggg...',
    '...gvggggvg...',
    '...ggggvggg...',
    '...pp....pp...',
    '..pp......pp..',
    '..............',
  ];
  const STAR_STEP = patch(STAR, { 13: '....pp..pp....', 14: '....pp..pp....' });

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

  // ---- Fetta di pizza, colori di pizza-slice.js ----
  const SLICE = [
    '.....yy.....',
    '.....yy.....',
    '....yyyy....',
    '....yryy....',
    '...yyyyyy...',
    '...ykyyky...',
    '..yyyyyyyy..',
    '..yyykkyyy..',
    '.yryyyyyyry.',
    '.yyyyyyyyyy.',
    'cccccccccccc',
    '.cccccccccc.',
    '...d....d...',
    '..dd...dd...',
  ];
  const SLICE_STEP = patch(SLICE, { 12: '..d......d..', 13: '.dd.....dd..' });

  /** speed: misure del personaggio al secondo, a velocità «normale». */
  const SPRITES = {
    spongebob: {
      speed: 1.3,
      palette: { y: '#F7E03C', o: '#C9B02A', w: '#FFFFFF', b: '#3B8FD9', k: '#1A1A1A', m: '#7A1F1F', r: '#E2412A', n: '#8B5A2B', g: '#B07A3C', e: '#D8ECF4' },
      frames: {
        walk: [SPONGE, SPONGE_STEP],
        swing: [SPONGE, SPONGE_SWING],
        sleep: [patch(SPONGE, { 4: '.yyyyyyyyyy..g..', 5: '.ykkyyykkyy..g..', 7: '.yyyyyyyyoy..g..', 8: '.yyykkyyyyy..g..' })],
        call: [patch(SPONGE, { 7: '.ykmmmmkyoy..g..', 8: '.yykmmkyyyy..g..' })],
      },
    },
    medusa: {
      speed: 0.9,
      palette: { p: '#F28DB2', l: '#FBC6DA', d: '#C2557F' },
      frames: {
        walk: [JELLY, JELLY_STEP],
        flee: [JELLY_FLEE, JELLY_FLEE_STEP],
        sleep: [JELLY],
        call: [JELLY],
      },
    },
    patrick: {
      speed: 0.6,
      palette: { p: '#F4A3B5', w: '#FFFFFF', k: '#1A1A1A', m: '#7A1F1F', g: '#7BC25A', v: '#9B59B6' },
      frames: {
        walk: [STAR, STAR_STEP],
        sleep: [patch(STAR, { 3: '....pppppp....', 4: '....pkkkkp....' })],
        call: [patch(STAR, { 5: 'p..pppppppp..p', 6: 'pp.ppmmmmpp.pp', 7: '...pppppppp...', 8: '....pppppp....' })],
      },
    },
    gary: {
      speed: 0.15,
      palette: { s: '#E8759A', c: '#A8406A', b: '#8FD3E8', e: '#F3E36A' },
      frames: {
        walk: [SNAIL, SNAIL_STEP],
        sleep: [patch(SNAIL, { 0: '..............', 1: '..............', 2: '...ssss.......' })],
        call: [SNAIL],
      },
    },
    gatto: {
      speed: 1,
      palette: { o: '#E8963C', d: '#A85E1E', g: '#7BC25A', p: '#F4A3B5' },
      frames: {
        walk: [CAT, CAT_STEP],
        sleep: [patch(CAT, { 2: '.d.......odood' })],
        call: [CAT],
      },
    },
    pizza: {
      speed: 0.8,
      palette: { y: '#F5C45A', r: '#E2412A', c: '#E7A33C', k: '#1A1A1A', d: '#6B3E1E' },
      frames: {
        walk: [SLICE, SLICE_STEP],
        sleep: [patch(SLICE, { 5: '...ydyydy...' })],
        call: [patch(SLICE, { 7: '..yykkkkyy..' })],
      },
    },
  };

  /** Voci che si scelgono nelle impostazioni: SpongeBob e la medusa vanno insieme. */
  const CAST = {
    inseguimento: ['spongebob', 'medusa'],
    patrick: ['patrick'],
    gary: ['gary'],
    gatto: ['gatto'],
    pizza: ['pizza'],
  };
  const CAST_LABELS = {
    inseguimento: 'SpongeBob e la medusa',
    patrick: 'Patrick',
    gary: 'Gary',
    gatto: 'Gatto',
    pizza: 'Fetta di pizza',
  };

  /** Colonne e righe di un personaggio (tutti i suoi frame hanno la stessa misura). */
  function dims(kind) {
    const [frame] = SPRITES[kind].frames.walk;
    return { cols: frame[0].length, rows: frame.length };
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

  return { SPRITES, CAST, CAST_LABELS, REQUIRED_POSES, EXTRA_POSES, GRID, dims, toRects };
});

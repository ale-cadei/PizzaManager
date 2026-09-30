// renderer/pets-sprites.js: i disegni dei personaggi come griglie di caratteri
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { SPRITES, CAST, CAST_LABELS, REQUIRED_POSES, EXTRA_POSES, OPTIONAL_POSES, MOTIONS, GRID, dims, pixel, toRects } = require('../renderer/pets-sprites');

const allFrames = (sprite) => Object.values(sprite.frames).flat();

ok('sprites: le righe di ogni frame hanno la stessa larghezza, i frame di un personaggio la stessa misura', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    const [first] = allFrames(sprite);
    for (const frame of allFrames(sprite)) {
      assert.strictEqual(frame.length, first.length, `${kind}: frame con un numero di righe diverso`);
      for (const row of frame) assert.strictEqual(row.length, first[0].length, `${kind}: riga «${row}» fuori misura`);
    }
  }
});

ok('sprites: ogni carattere disegnato ha un colore in palette', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    for (const frame of allFrames(sprite)) {
      for (const ch of frame.join('')) {
        if (ch !== '.') assert.ok(sprite.palette[ch], `${kind}: «${ch}» senza colore`);
      }
    }
  }
});

ok('sprites: ogni personaggio ha le pose che il motore usa, walk con almeno due frame', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    for (const pose of [...REQUIRED_POSES, ...(EXTRA_POSES[kind] || [])]) {
      assert.ok(sprite.frames[pose] && sprite.frames[pose].length > 0, `${kind}: manca la posa ${pose}`);
    }
    assert.ok(sprite.frames.walk.length >= 2, `${kind}: walk non si anima`);
    assert.ok(sprite.speed > 0, `${kind}: velocità mancante`);
  }
  assert.deepStrictEqual(EXTRA_POSES.pescatore, ['swing']);
  assert.deepStrictEqual(EXTRA_POSES.medusa, ['flee']);
  assert.deepStrictEqual(EXTRA_POSES.rana, ['jump']);
  assert.deepStrictEqual(EXTRA_POSES.tazzina, ['jump']);
});

ok('sprites: i personaggi del pacchetto Spritelli sono voci del cast', () => {
  for (const id of ['ape', 'chiocciola', 'papera', 'robottino', 'tazzina']) {
    assert.ok(CAST[id], `${id} non è nel cast`);
    assert.strictEqual(CAST[id][0], id);
  }
  assert.strictEqual(SPRITES.ape.motion, 'fly');
  assert.strictEqual(SPRITES.tazzina.motion, 'hop');
});

ok('sprites: gli Spritelli sono ingranditi a 2x, coi pixel fini quanto i pacchetti a 32 righe', () => {
  for (const kind of ['ape', 'chiocciola', 'papera', 'anatroccolo', 'robottino', 'pesce']) {
    assert.ok(dims(kind).rows >= 22, `${kind}: ${dims(kind).rows} righe`);
    assert.ok(Math.abs(pixel(kind, 48) - 48 / 32) < 0.01, `${kind}: pixel ${pixel(kind, 48)}`);
  }
});

ok('sprites: il pesce è quello del pacchetto Spritelli, coi suoi colori a scelta', () => {
  assert.deepStrictEqual(dims('pesce'), { cols: 34, rows: 24 });
  assert.strictEqual(SPRITES.pesce.motion, 'swim');
  assert.ok(SPRITES.pesce.variants.length >= 3);
});

ok('sprites: le bolle stanno a parte, alte quanto chi le soffia, coi colori in palette', () => {
  const withBubbles = Object.entries(SPRITES).filter(([, s]) => s.bubbles);
  assert.deepStrictEqual(withBubbles.map(([k]) => k), ['pesce']);
  for (const [kind, sprite] of withBubbles) {
    assert.ok(sprite.bubbles.length >= 2, `${kind}: bolle ferme`);
    const cols = sprite.bubbles[0][0].length;
    for (const grid of sprite.bubbles) {
      assert.strictEqual(grid.length, dims(kind).rows, `${kind}: bolle di un'altra altezza`);
      for (const row of grid) {
        assert.strictEqual(row.length, cols);
        for (const ch of row) if (ch !== '.') assert.ok(sprite.palette[ch], `${kind}: ${ch} delle bolle senza colore`);
      }
    }
  }
});

ok('sprites: il fiore dell ape è un disegno a parte, col posto dove si posa', () => {
  const { perch } = SPRITES.ape;
  assert.ok(perch && Array.isArray(perch.grid), 'l ape non ha il fiore');
  const cols = perch.grid[0].length;
  for (const row of perch.grid) {
    assert.strictEqual(row.length, cols);
    for (const ch of row) if (ch !== '.') assert.ok(SPRITES.ape.palette[ch], `${ch} del fiore senza colore`);
  }
  assert.ok(perch.seat > 0 && perch.seat <= perch.grid.length, `posto fuori dal fiore: ${perch.seat}`);
  assert.deepStrictEqual(Object.entries(SPRITES).filter(([, s]) => s.perch).map(([k]) => k), ['ape']);
});

ok('sprites: nessuna posa che il motore non conosca; le opzionali ci sono dove i pacchetti le danno', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    const known = [...REQUIRED_POSES, ...(EXTRA_POSES[kind] || []), ...OPTIONAL_POSES];
    for (const pose of Object.keys(sprite.frames)) assert.ok(known.includes(pose), `${kind}: posa «${pose}» sconosciuta`);
  }
  assert.deepStrictEqual(Object.keys(SPRITES.fantasmino.frames).filter((p) => OPTIONAL_POSES.includes(p)).sort(), [...OPTIONAL_POSES].sort());
  for (const kind of ['pizza', 'fizzo', 'zucca']) {
    assert.ok(SPRITES[kind].frames.idle && SPRITES[kind].frames.startle, `${kind}: senza pausa o spavento`);
  }
  assert.ok(SPRITES.morte.frames.idle, 'la Morte non si ferma mai');
});

ok('sprites: l ombra ha frame tutti della stessa misura, coi colori in palette', () => {
  const withShadow = Object.entries(SPRITES).filter(([, s]) => s.shadow);
  assert.deepStrictEqual(withShadow.map(([k]) => k), ['fantasmino']);
  for (const [kind, sprite] of withShadow) {
    const [first] = sprite.shadow;
    assert.ok(sprite.shadow.length >= 2, `${kind}: ombra senza animazione`);
    for (const frame of sprite.shadow) {
      assert.strictEqual(frame.length, first.length, `${kind}: ombra con righe diverse`);
      for (const row of frame) {
        assert.strictEqual(row.length, first[0].length, `${kind}: riga d'ombra «${row}» fuori misura`);
        for (const ch of row) if (ch !== '.') assert.ok(sprite.palette[ch], `${kind}: ombra «${ch}» senza colore`);
      }
    }
  }
});

ok('sprites: ogni personaggio si muove in un modo che il motore conosce', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    assert.ok(MOTIONS.includes(sprite.motion), `${kind}: motion «${sprite.motion}»`);
  }
  assert.deepStrictEqual(['rana', 'uccellino', 'pesce'].map((k) => SPRITES[k].motion), ['hop', 'fly', 'swim']);
});

ok('sprites: il cast usa solo personaggi disegnati e ha un nome per ogni voce', () => {
  assert.deepStrictEqual(CAST.inseguimento, ['pescatore', 'medusa']);
  for (const [id, kinds] of Object.entries(CAST)) {
    assert.ok(CAST_LABELS[id], `${id} senza nome`);
    for (const k of kinds) assert.ok(SPRITES[k], `${id}: ${k} non disegnato`);
  }
});

ok('sprites: toRects fonde i pixel uguali contigui e salta i trasparenti', () => {
  const rects = toRects(['aab.', '.bb.'], { a: '#111', b: '#222' });
  assert.deepStrictEqual(rects, [
    { x: 0, y: 0, w: 2, fill: '#111' },
    { x: 2, y: 0, w: 1, fill: '#222' },
    { x: 1, y: 1, w: 2, fill: '#222' },
  ]);
});

ok('sprites: nessuno supera l\'altezza scelta; chi sta nelle GRID righe tiene il pixel di riferimento', () => {
  const size = 48;
  for (const kind of Object.keys(SPRITES)) {
    const { rows } = dims(kind);
    assert.ok(rows * pixel(kind, size) <= size + 1e-9, `${kind}: alto ${rows * pixel(kind, size)} su ${size}`);
    const { height } = SPRITES[kind];
    if (height) assert.ok(Math.abs(rows * pixel(kind, size) - size * height) < 1e-9, `${kind}: alto ${rows * pixel(kind, size)} invece di ${size * height}`);
    else if (rows <= GRID) assert.strictEqual(pixel(kind, size), size / GRID, `${kind}: pixel cambiato`);
  }
});

ok('sprites: la medusa è più bassa del pescatore', () => {
  assert.ok(dims('medusa').rows * pixel('medusa', 48) <= dims('pescatore').rows * pixel('pescatore', 48) * 0.6);
});

ok('sprites: le varianti ritoccano solo colori che la palette di base conosce; paletteOf le fonde', () => {
  const { looks, paletteOf } = require('../renderer/pets-sprites');
  const withVariants = Object.entries(SPRITES).filter(([, s]) => s.variants);
  assert.deepStrictEqual(withVariants.map(([k]) => k).sort(), ['pesce', 'uccellino']);
  for (const [kind, sprite] of withVariants) {
    assert.ok(sprite.variants.length >= 1, `${kind}: variants vuoto`);
    assert.strictEqual(looks(kind), sprite.variants.length + 1);
    sprite.variants.forEach((v, i) => {
      for (const ch of Object.keys(v)) assert.ok(sprite.palette[ch], `${kind} variante ${i}: «${ch}» non è nella palette`);
      const merged = paletteOf(kind, i + 1);
      assert.deepStrictEqual(Object.keys(merged).sort(), Object.keys(sprite.palette).sort());
      assert.notDeepStrictEqual(merged, sprite.palette, `${kind} variante ${i}: uguale alla base`);
    });
  }
  assert.strictEqual(paletteOf('pesce', 0), SPRITES.pesce.palette);
  assert.strictEqual(paletteOf('pesce'), SPRITES.pesce.palette);
  assert.strictEqual(paletteOf('pesce', 99), SPRITES.pesce.palette, 'un indice fuori misura torna alla base');
  assert.strictEqual(looks('gatto'), 1);
  assert.strictEqual(paletteOf('gatto', 1), SPRITES.gatto.palette);
});

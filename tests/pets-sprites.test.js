// renderer/pets-sprites.js: i disegni dei personaggi come griglie di caratteri
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { SPRITES, CAST, CAST_LABELS, REQUIRED_POSES, EXTRA_POSES, MOTIONS, GRID, dims, pixel, toRects } = require('../renderer/pets-sprites');

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
  assert.deepStrictEqual(EXTRA_POSES.spongebob, ['swing']);
  assert.deepStrictEqual(EXTRA_POSES.medusa, ['flee']);
  assert.deepStrictEqual(EXTRA_POSES.rana, ['jump']);
});

ok('sprites: ogni personaggio si muove in un modo che il motore conosce', () => {
  for (const [kind, sprite] of Object.entries(SPRITES)) {
    assert.ok(MOTIONS.includes(sprite.motion), `${kind}: motion «${sprite.motion}»`);
  }
  assert.deepStrictEqual(['rana', 'uccellino', 'pesce'].map((k) => SPRITES[k].motion), ['hop', 'fly', 'swim']);
});

ok('sprites: il cast usa solo personaggi disegnati e ha un nome per ogni voce', () => {
  assert.deepStrictEqual(CAST.inseguimento, ['spongebob', 'medusa']);
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

ok('sprites: la medusa è più bassa di SpongeBob', () => {
  assert.ok(dims('medusa').rows * pixel('medusa', 48) <= dims('spongebob').rows * pixel('spongebob', 48) * 0.6);
});

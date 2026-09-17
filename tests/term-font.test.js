const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Dimensione del testo dei terminali: scelta con ⌘+ / ⌘- / ⌘0, persistita in
   localStorage, uguale per tutte le schede. Lo store è puro: chi lo usa
   applica il valore a xterm.js e rifà il fit. */
const { createStorage } = require('./fake-dom');
const TermFont = require('../renderer/term-font');

ok('font: senza niente salvato vale il default', () => {
  const f = TermFont.createFontSizeStore(createStorage());
  assert.strictEqual(f.get(), TermFont.DEFAULT_SIZE);
});

ok('font: step cambia di un punto alla volta e resta nei limiti', () => {
  const f = TermFont.createFontSizeStore(createStorage());
  assert.strictEqual(f.step(+1), TermFont.DEFAULT_SIZE + 1);
  assert.strictEqual(f.step(-2), TermFont.DEFAULT_SIZE - 1);
  for (let i = 0; i < 100; i++) f.step(+1);
  assert.strictEqual(f.get(), TermFont.MAX_SIZE, 'non si supera il massimo');
  for (let i = 0; i < 100; i++) f.step(-1);
  assert.strictEqual(f.get(), TermFont.MIN_SIZE, 'non si scende sotto il minimo');
});

ok('font: la scelta sopravvive a un riavvio, reset la annulla', () => {
  const storage = createStorage();
  createFontAnd(storage).step(+3);
  const again = TermFont.createFontSizeStore(storage);
  assert.strictEqual(again.get(), TermFont.DEFAULT_SIZE + 3);
  assert.strictEqual(again.reset(), TermFont.DEFAULT_SIZE);
  assert.strictEqual(TermFont.createFontSizeStore(storage).get(), TermFont.DEFAULT_SIZE);
});

ok('font: un valore salvato corrotto o fuori scala non rompe niente', () => {
  for (const bad of ['abc', '', '999', '-3', '2.5']) {
    const f = TermFont.createFontSizeStore(createStorage({ [TermFont.STORAGE_KEY]: bad }));
    const v = f.get();
    assert.ok(Number.isInteger(v) && v >= TermFont.MIN_SIZE && v <= TermFont.MAX_SIZE, `${JSON.stringify(bad)} → ${v}`);
  }
});

ok('font: uno storage che lancia (modalità privata) non blocca l app', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const f = TermFont.createFontSizeStore(broken);
  assert.strictEqual(f.get(), TermFont.DEFAULT_SIZE);
  assert.strictEqual(f.step(+1), TermFont.DEFAULT_SIZE + 1);
});

function createFontAnd(storage) { return TermFont.createFontSizeStore(storage); }

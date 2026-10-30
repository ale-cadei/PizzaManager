const assert = require('node:assert');
const { test: ok } = require('node:test');
const { relativeTime, blameInfo } = require('../renderer/editor-blame');

/* L'etichetta di chi ha toccato la riga (docs/plans/73) */
const NOW = Date.parse('2026-10-30T12:00:00Z');
const ago = (s) => NOW / 1000 - s;

ok('relativeTime: adesso, minuti, ore, giorni, mesi, anni', () => {
  assert.strictEqual(relativeTime(ago(10), NOW), 'adesso');
  assert.strictEqual(relativeTime(ago(5 * 60), NOW), '5 minuti fa');
  assert.strictEqual(relativeTime(ago(2 * 3600), NOW), '2 ore fa');
  assert.strictEqual(relativeTime(ago(3 * 86400), NOW), '3 giorni fa');
  assert.strictEqual(relativeTime(ago(1 * 86400), NOW), 'ieri');
  assert.strictEqual(relativeTime(ago(90 * 86400), NOW), '3 mesi fa');
  assert.strictEqual(relativeTime(ago(800 * 86400), NOW), '2 anni fa');
  // Orologio indietro rispetto al commit: non «fra 3 minuti»
  assert.strictEqual(relativeTime(ago(-180), NOW), 'adesso');
});

ok('blameInfo: riga committata → testo breve e fumetto lungo', () => {
  const info = blameInfo({
    hash: 'a1b2c3d4e5f6', uncommitted: false, author: 'Ale Cadei', mail: 'ale@x', time: ago(3 * 86400), summary: 'fix: carica config',
  }, NOW);
  assert.strictEqual(info.text, 'Ale Cadei, 3 giorni fa · fix: carica config');
  assert.match(info.title, /^a1b2c3d · Ale Cadei <ale@x>\n27 ottobre 2026/);
  assert.match(info.title, /\n\nfix: carica config$/);
});

ok('blameInfo: messaggio lungo accorciato nel testo, intero nel fumetto; senza mail né data', () => {
  const summary = 'x'.repeat(100);
  const info = blameInfo({ hash: 'ff', uncommitted: false, author: 'A', mail: '', time: null, summary }, NOW);
  assert.strictEqual(info.text, `A · ${'x'.repeat(59)}…`);
  assert.strictEqual(info.title, `ff · A\n\n${summary}`);
});

ok('blameInfo: non committata; nulla da mostrare', () => {
  assert.deepStrictEqual(blameInfo({ uncommitted: true }, NOW), { text: 'Modifica non committata', title: 'Modifica non committata' });
  assert.strictEqual(blameInfo(null, NOW), null);
  assert.strictEqual(blameInfo({ uncommitted: false }, NOW), null);
});

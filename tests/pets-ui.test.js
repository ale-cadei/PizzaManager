// renderer/pets-ui.js: il dialogo «Animaletti» del menu View
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createPetsDialog } = require('../renderer/pets-ui');
const { createPetsStore, DEFAULTS, MAX_PETS } = require('../renderer/pets-config');
const { createElement, createStorage, descendants, fire } = require('./fake-dom');

function setup(initial) {
  const doc = createElement('html');
  doc.createElement = createElement;
  const els = Object.fromEntries(['backdrop', 'body', 'saveBtn', 'cancelBtn'].map((k) => [k, createElement('div')]));
  els.backdrop.hidden = true;
  const store = createPetsStore(createStorage());
  if (initial) store.save(initial);
  const previews = [];
  const dialog = createPetsDialog({ doc, ...els, store, onChange: (cfg) => previews.push(cfg) });
  const find = (pred) => descendants(els.body).find(pred);
  const field = (name) => find((n) => n.dataset.field === name);
  const row = (id) => find((n) => n.dataset.cast === id);
  const stepBtn = (id, dir) => descendants(row(id)).find((n) => n.dataset.step === String(dir));
  const count = (id) => descendants(row(id)).find((n) => n.dataset.count !== undefined).textContent;
  const last = () => previews[previews.length - 1];
  return { doc, els, store, dialog, previews, field, row, stepBtn, count, last };
}

ok('pets-ui: si apre coi valori salvati, una riga per voce del cast', () => {
  const s = setup();
  s.dialog.open();
  assert.strictEqual(s.els.backdrop.hidden, false);
  assert.strictEqual(s.field('enabled').checked, false);
  assert.strictEqual(s.field('size').value, 'm');
  assert.strictEqual(s.field('speed').value, 'normale');
  assert.strictEqual(s.count('inseguimento'), '1');
  assert.strictEqual(s.count('lumaca'), '0');
  assert.strictEqual(descendants(s.row('inseguimento')).some((n) => n.textContent === 'il pescatore e la medusa'), true);
});

ok('pets-ui: ogni ritocco si vede subito nella striscia', () => {
  const s = setup();
  s.dialog.open();
  s.field('enabled').checked = true;
  fire(s.field('enabled'), 'change', {});
  assert.strictEqual(s.last().enabled, true);
  fire(s.stepBtn('lumaca', 1), 'click', {});
  assert.deepStrictEqual(s.last().cast, ['inseguimento', 'lumaca']);
  assert.strictEqual(s.count('lumaca'), '1');
  s.field('size').value = 'l';
  fire(s.field('size'), 'change', {});
  assert.strictEqual(s.last().size, 'l');
  fire(s.stepBtn('inseguimento', -1), 'click', {});
  assert.deepStrictEqual(s.last().cast, ['lumaca']);
});

ok('pets-ui: il + si spegne quando non c è più posto', () => {
  const s = setup({ cast: ['inseguimento', 'lumaca', 'lumaca'] });
  s.dialog.open();
  assert.strictEqual(s.stepBtn('inseguimento', 1).disabled, true, 'la coppia non ci sta in 1 posto');
  assert.strictEqual(s.stepBtn('gatto', 1).disabled, false);
  fire(s.stepBtn('gatto', 1), 'click', {});
  assert.strictEqual(s.stepBtn('gatto', 1).disabled, true);
  fire(s.stepBtn('gatto', 1), 'click', {});
  assert.strictEqual(s.last().cast.length, 4, 'oltre MAX_PETS non si va');
  assert.ok(MAX_PETS === 5);
  assert.strictEqual(s.stepBtn('stella', -1).disabled, true, 'sotto zero non si scende');
});

ok('pets-ui: Salva ricorda, Annulla ed Esc rimettono quello salvato', () => {
  const s = setup();
  s.dialog.open();
  s.field('enabled').checked = true;
  fire(s.field('enabled'), 'change', {});
  fire(s.els.saveBtn, 'click', {});
  assert.strictEqual(s.els.backdrop.hidden, true);
  assert.strictEqual(s.store.get().enabled, true);

  s.dialog.open();
  fire(s.stepBtn('pizza', 1), 'click', {});
  fire(s.els.cancelBtn, 'click', {});
  assert.deepStrictEqual(s.last(), s.store.get(), 'Annulla rimette il salvato nella striscia');
  assert.deepStrictEqual(s.store.get().cast, DEFAULTS.cast);

  s.dialog.open();
  fire(s.stepBtn('pizza', 1), 'click', {});
  fire(s.doc, 'keydown', { key: 'Escape' });
  assert.strictEqual(s.els.backdrop.hidden, true);
  assert.deepStrictEqual(s.last().cast, DEFAULTS.cast);
});

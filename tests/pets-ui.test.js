// renderer/pets-ui.js: il dialogo «Animaletti» del menu View
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createPetsDialog } = require('../renderer/pets-ui');
const { createPetsStore, DEFAULTS, MAX_CAST } = require('../renderer/pets-config');
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
  assert.strictEqual(s.count('gary'), '0');
  assert.strictEqual(descendants(s.row('inseguimento')).some((n) => n.textContent === 'SpongeBob e la medusa'), true);
});

ok('pets-ui: ogni ritocco si vede subito nella striscia', () => {
  const s = setup();
  s.dialog.open();
  s.field('enabled').checked = true;
  fire(s.field('enabled'), 'change', {});
  assert.strictEqual(s.last().enabled, true);
  fire(s.stepBtn('gary', 1), 'click', {});
  assert.deepStrictEqual(s.last().cast, ['inseguimento', 'gary']);
  assert.strictEqual(s.count('gary'), '1');
  s.field('size').value = 'l';
  fire(s.field('size'), 'change', {});
  assert.strictEqual(s.last().size, 'l');
  fire(s.stepBtn('inseguimento', -1), 'click', {});
  assert.deepStrictEqual(s.last().cast, ['gary']);
});

ok('pets-ui: il + si spegne quando non c è più posto', () => {
  const s = setup({ cast: ['inseguimento', 'patrick', 'gary', 'gatto'] });
  s.dialog.open();
  assert.strictEqual(s.stepBtn('pizza', 1).disabled, false, 'la quinta voce ci sta');
  fire(s.stepBtn('pizza', 1), 'click', {});
  assert.deepStrictEqual(s.last().cast, ['inseguimento', 'patrick', 'gary', 'gatto', 'pizza']);
  assert.ok(['inseguimento', 'patrick', 'gary', 'gatto', 'pizza'].every((id) => s.stepBtn(id, 1).disabled), 'pieno: tutti i + spenti');
  fire(s.stepBtn('gatto', 1), 'click', {});
  assert.strictEqual(s.last().cast.length, MAX_CAST, 'oltre MAX_CAST non si va');
  fire(s.stepBtn('gary', -1), 'click', {});
  assert.strictEqual(s.stepBtn('inseguimento', 1).disabled, false, 'tolta una voce, anche la coppia rientra');
  assert.ok(descendants(s.els.body).some((n) => n.textContent === 'Scelti: 4 su 5'));
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

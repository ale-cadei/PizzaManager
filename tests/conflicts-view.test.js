const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, descendants, fire } = require('./fake-dom');

/* La modalità «Conflitti» disegnata (docs/plans/69): elenco, pulsanti e piè
   di pagina su un DOM finto. Percorsi e nomi restano testo. */
const { createConflictsPart } = require('../renderer/conflicts-view');
const M = require('../renderer/conflicts-model');

const doc = { createElement };
const byClass = (root, cls) => descendants(root).filter((n) => n.classes.has(cls));
const textOf = (el) => [el.textContent, ...el.children.map(textOf)].join('');

const c = {
  ok: true, root: '/r', op: 'merge',
  what: { incoming: '<b>feat</b>', into: 'main', step: null, total: null, commit: 'abc1234', subject: null },
  files: [{ path: '<img src=x>.js', kind: 'both-modified', binary: false, blocks: 1 }],
  resolved: ['README.md'],
};

ok('vista conflitti: file, pulsanti e risolti, tutto come testo', () => {
  const acts = [];
  const part = createConflictsPart({ doc, onAction: (a) => acts.push(a) });
  const state = M.viewState(c, {});
  part.render(state);
  const box = createElement('div');
  box.replaceChildren(...part.items(state));
  assert.match(textOf(box), /<img src=x>\.js/);
  assert.match(textOf(box), /Risolti \(1\)/);
  assert.ok(!descendants(box).some((n) => n.tagName === 'IMG'));
  const mark = byClass(box, 'conflicts-action').find((b) => b.textContent === 'Segna risolto');
  fire(mark, 'click');
  assert.deepStrictEqual(acts.map((a) => [a.how, a.path]), [['mark', '<img src=x>.js']]);
});

ok('vista conflitti: piè di pagina spento con conflitti, il motivo nel title', () => {
  const acts = [];
  const part = createConflictsPart({ doc, onAction: (a) => acts.push(a) });
  part.render(M.viewState(c, {}));
  const [go] = byClass(part.foot, 'conflicts-continue');
  assert.strictEqual(go.textContent, 'Concludi merge');
  assert.strictEqual(go.disabled, true);
  assert.match(go.title, /in conflitto/);
  const [abort] = byClass(part.foot, 'conflicts-abort');
  fire(abort, 'click');
  assert.deepStrictEqual(acts.map((a) => a.how), ['abort']);
  part.render(null);
  assert.strictEqual(part.foot.hidden, true);
});

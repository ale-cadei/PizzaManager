const assert = require('node:assert');
const { test: ok } = require('node:test');

/* I gruppi della sidebar si aprono e si chiudono animati
   (docs/plans/80-gruppo-in-cima.md). */
const { createGroupFold, bodyFrames, DURATION_MS } = require('../renderer/group-fold');
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const { createSidebar } = require('../renderer/sidebar');

/** Un elemento che registra le animazioni chieste. */
function animated({ scrollHeight = 120, height = 120 } = {}) {
  const calls = [];
  return {
    calls, scrollHeight,
    getBoundingClientRect: () => ({ height }),
    animate(frames, timing) {
      calls.push({ frames, timing });
      return { finished: Promise.resolve() };
    },
  };
}
const style = () => ({ paddingBottom: '8px' });

ok('bodyFrames: dal corpo schiacciato all altezza piena, padding compreso', () => {
  const [from, to] = bodyFrames(120, '8px');
  assert.deepStrictEqual([from.height, from.paddingBottom, from.opacity], ['0px', '0px', 0]);
  assert.deepStrictEqual([to.height, to.paddingBottom, to.opacity], ['120px', '8px', 1]);
});

ok('open: il corpo cresce fino alla sua altezza e la fetta ruota', () => {
  const fold = createGroupFold({ getStyle: style });
  const body = animated({ scrollHeight: 200 });
  const chevron = animated();
  fold.open(body, chevron);
  assert.strictEqual(body.calls.length, 1);
  assert.strictEqual(body.calls[0].frames[1].height, '200px');
  assert.strictEqual(body.calls[0].timing.duration, DURATION_MS);
  assert.strictEqual(chevron.calls.length, 1, 'la fetta deve ruotare insieme al corpo');
});

ok('close: il corpo si schiaccia a 0 e resta così fino al render', async () => {
  const fold = createGroupFold({ getStyle: style });
  const body = animated({ height: 90 });
  await fold.close(body);
  const { frames, timing } = body.calls[0];
  assert.deepStrictEqual([frames[0].height, frames[1].height], ['90px', '0px']);
  assert.strictEqual(timing.fill, 'forwards');
});

ok('prefers-reduced-motion o niente animate: tutto istantaneo', async () => {
  const fold = createGroupFold({ reducedMotion: () => true });
  const body = animated();
  fold.open(body);
  await fold.close(body);
  assert.strictEqual(body.calls.length, 0);
  await createGroupFold().close({});
});

ok('close: un animazione annullata non blocca la chiusura', async () => {
  const fold = createGroupFold();
  const body = { getBoundingClientRect: () => ({ height: 10 }), animate: () => ({ finished: Promise.reject(new Error('annullata')) }) };
  await fold.close(body);
});

function renderSidebar(GroupFold) {
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s),
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
    GroupFold,
  });
  sidebar.render([{ id: 'a', type: 'claude', name: 'a', cwd: '/repo', projectRoot: '/repo', alive: true }], null);
  const header = () => descendants(list).find((n) => n.classes.has('group-header'));
  const body = () => descendants(list).find((n) => n.classes.has('group-body'));
  return { header, body };
}

ok('sidebar: chiudendo anima il corpo vecchio, poi ridisegna il gruppo chiuso', async () => {
  const restore = installDocument();
  try {
    let finish;
    const closed = [];
    const fold = { open: () => {}, close: (b) => { closed.push(b); return new Promise((r) => { finish = r; }); } };
    const { header, body } = renderSidebar(fold);
    const before = body();
    header().onclick();
    assert.deepStrictEqual(closed, [before], 'l animazione va sul corpo che c è adesso');
    assert.strictEqual(header().getAttribute('aria-expanded'), 'false', 'la fetta ruota mentre si chiude');
    assert.ok(!body().hidden, 'prima della fine il corpo resta nella pagina');
    header().onclick();
    assert.strictEqual(closed.length, 1, 'un secondo click durante la chiusura non ne avvia un altra');
    finish();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(body().hidden, true, 'finita l animazione il gruppo è chiuso');
  } finally { restore(); }
});

ok('sidebar: aprendo anima il corpo NUOVO, dopo il render', async () => {
  const restore = installDocument();
  try {
    const opened = [];
    const fold = { open: (b) => opened.push(b), close: () => Promise.resolve() };
    const { header, body } = renderSidebar(fold);
    header().onclick();
    await new Promise((r) => setImmediate(r));
    header().onclick();
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0], body(), 'va animato il corpo appena disegnato');
    assert.ok(!body().hidden);
  } finally { restore(); }
});

ok('sidebar: senza GroupFold apre e chiude subito', () => {
  const restore = installDocument();
  try {
    const { header, body } = renderSidebar(undefined);
    header().onclick();
    assert.strictEqual(body().hidden, true);
    header().onclick();
    assert.ok(!body().hidden);
  } finally { restore(); }
});

const assert = require('node:assert');
const { test: ok } = require('node:test');

/* L'elenco dei worktree dei progetti in sidebar (docs/plans/36): si chiede
   al main una volta per radice, si rinfresca dopo un'azione o al ritorno in
   primo piano, e si ridisegna solo se è cambiato. */
const { createWorktreeCache } = require('../renderer/worktree-cache');

function setup(answers) {
  const asked = [];
  let changes = 0;
  const warnings = [];
  const cache = createWorktreeCache({
    list: async (root) => {
      asked.push(root);
      const a = answers[root];
      if (a instanceof Error) throw a;
      return typeof a === 'function' ? a() : a;
    },
    onChange: () => { changes += 1; },
    warn: (...args) => warnings.push(args.join(' ')),
  });
  return { cache, asked, changes: () => changes, warnings };
}

const FEAT = { path: '/p.worktrees/feat-x', branch: 'feat/x', base: 'main', head: 'abc', locked: false };

ok('cache: chiede ogni radice una volta, tiene solo percorso, branch e base', async () => {
  const { cache, asked, changes } = setup({ '/p': { ok: true, worktrees: [FEAT] }, '/q': { ok: true, worktrees: [] } });
  await cache.sync(['/p', '/q', '/p', '', null]);
  await cache.sync(['/p', '/q']);
  assert.deepStrictEqual(asked, ['/p', '/q'], 'radici chieste più volte, o vuote');
  assert.deepStrictEqual(cache.snapshot(), { '/p': [{ path: '/p.worktrees/feat-x', branch: 'feat/x', base: 'main' }], '/q': [] });
  assert.strictEqual(changes(), 1, 'un ridisegno per ogni risposta invece che uno per il cambio');
});

ok('cache: refresh richiede la radice e ridisegna solo se l elenco è cambiato', async () => {
  let list = [FEAT];
  const { cache, changes } = setup({ '/p': () => ({ ok: true, worktrees: list }) });
  await cache.sync(['/p']);
  await cache.refresh('/p');
  assert.strictEqual(changes(), 1, 'ridisegnato con lo stesso elenco');
  list = [];
  await cache.refresh('/p');
  assert.strictEqual(changes(), 2);
  assert.deepStrictEqual(cache.snapshot()['/p'], []);
});

ok('cache: refreshAll rinfresca tutte le radici conosciute', async () => {
  const { cache, asked } = setup({ '/p': { ok: true, worktrees: [] }, '/q': { ok: true, worktrees: [] } });
  await cache.sync(['/p', '/q']);
  await cache.refreshAll();
  assert.deepStrictEqual(asked, ['/p', '/q', '/p', '/q']);
});

ok('cache: un errore si annota, vale come nessun worktree, e non si richiede a ogni render', async () => {
  const { cache, asked, warnings } = setup({ '/p': { ok: false, error: 'git esploso' }, '/q': new Error('ipc giù') });
  await cache.sync(['/p', '/q']);
  await cache.sync(['/p', '/q']);
  assert.deepStrictEqual(cache.snapshot(), { '/p': [], '/q': [] });
  assert.deepStrictEqual(asked, ['/p', '/q']);
  assert.strictEqual(warnings.length, 2);
  assert.match(warnings.join('\n'), /git esploso/);
});

ok('cache: vince l ultima risposta, anche se arriva prima di una vecchia', async () => {
  const pending = [];
  const cache = createWorktreeCache({
    list: () => new Promise((resolve) => pending.push(resolve)),
    onChange: () => {},
    warn: () => {},
  });
  const first = cache.refresh('/p');
  const second = cache.refresh('/p');
  pending[1]({ ok: true, worktrees: [] });
  await second;
  pending[0]({ ok: true, worktrees: [FEAT] });
  await first;
  assert.deepStrictEqual(cache.snapshot()['/p'], [], 'una risposta vecchia ha sovrascritto quella nuova');
});

ok('cache: lo snapshot è un oggetto nuovo a ogni cambio, non si muta quello dato', async () => {
  const { cache } = setup({ '/p': { ok: true, worktrees: [FEAT] } });
  const before = cache.snapshot();
  await cache.sync(['/p']);
  assert.deepStrictEqual(before, {}, 'mutato lo snapshot già consegnato');
  assert.notStrictEqual(cache.snapshot(), before);
});

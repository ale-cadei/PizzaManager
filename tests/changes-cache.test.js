const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Contatori delle modifiche sulle righe dei worktree (docs/plans/32): senza
   polling. Si leggono la prima volta che un worktree compare, quando una sua
   sessione finisce, al ritorno della finestra, e si prendono dalla lettura
   del pannello quando la sessione in primo piano sta in un worktree. */
const { createChangesCache } = require('../renderer/changes-cache');

const okResult = (files, added, removed) => ({ ok: true, totals: { files, added, removed }, files: [] });

function setup(answers = {}) {
  const reads = [];
  let changes = 0;
  const cache = createChangesCache({
    read: async (cwd, base) => {
      reads.push([cwd, base]);
      const a = answers[cwd];
      if (a instanceof Error) throw a;
      return a || okResult(0, 0, 0);
    },
    onChange: () => { changes += 1; },
    warn: () => {},
  });
  return { cache, reads, changes: () => changes };
}

const W1 = { path: '/p.worktrees/a', base: 'main' };
const W2 = { path: '/p.worktrees/b', base: null };

ok('contatori worktree: ensure legge solo i worktree mai letti', async () => {
  const { cache, reads, changes } = setup({ [W1.path]: okResult(3, 10, 2) });
  await cache.ensure([W1, W2]);
  await cache.ensure([W1, W2]);
  assert.deepStrictEqual(reads, [[W1.path, 'main'], [W2.path, null]]);
  assert.deepStrictEqual(cache.get(W1.path), { files: 3, added: 10, removed: 2 });
  assert.deepStrictEqual(cache.get(W2.path), { files: 0, added: 0, removed: 0 });
  assert.strictEqual(changes(), 1, 'un worktree pulito letto la prima volta non cambia niente di visibile');
});

ok('contatori worktree: refresh rilegge e avvisa solo se i numeri cambiano', async () => {
  const answers = { [W1.path]: okResult(1, 1, 0) };
  const { cache, reads, changes } = setup(answers);
  await cache.refresh(W1);
  await cache.refresh(W1);
  assert.strictEqual(changes(), 1);
  answers[W1.path] = okResult(2, 5, 0);
  await cache.refresh(W1);
  assert.strictEqual(changes(), 2);
  assert.strictEqual(reads.length, 3);
});

ok('contatori worktree: put prende la lettura del pannello senza chiedere a git', () => {
  const { cache, reads, changes } = setup();
  cache.put(W1.path, okResult(4, 8, 1));
  assert.deepStrictEqual(cache.get(W1.path), { files: 4, added: 8, removed: 1 });
  assert.strictEqual(reads.length, 0);
  assert.strictEqual(changes(), 1);
  cache.put(W1.path, { ok: false, reason: 'not-a-repo' });
  assert.strictEqual(cache.get(W1.path), null);
});

ok('contatori worktree: una risposta vecchia non sovrascrive una nuova', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  let n = 0;
  const cache = createChangesCache({
    read: async () => { n += 1; if (n === 1) { await slow; return okResult(1, 1, 1); } return okResult(9, 9, 9); },
    onChange: () => {}, warn: () => {},
  });
  const first = cache.refresh(W1);
  await cache.refresh(W1);
  release();
  await first;
  assert.deepStrictEqual(cache.get(W1.path), { files: 9, added: 9, removed: 9 });
});

ok('contatori worktree: un errore di lettura non esplode e non inventa numeri', async () => {
  const { cache } = setup({ [W1.path]: new Error('ipc giù') });
  await cache.refresh(W1);
  assert.strictEqual(cache.get(W1.path), null);
});

ok('contatori worktree: refreshAll rilegge quelli passati', async () => {
  const { cache, reads } = setup();
  await cache.refreshAll([W1, W2]);
  assert.strictEqual(reads.length, 2);
});

ok('contatori worktree: una refresh lenta non sovrascrive la lettura del pannello arrivata dopo', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const cache = createChangesCache({
    read: async () => { await slow; return okResult(1, 1, 1); },
    onChange: () => {}, warn: () => {},
  });
  const pending = cache.refresh(W1);
  cache.put(W1.path, okResult(7, 7, 7));
  release();
  await pending;
  assert.deepStrictEqual(cache.get(W1.path), { files: 7, added: 7, removed: 7 });
});

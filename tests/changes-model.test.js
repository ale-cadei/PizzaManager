const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Pannello «cosa ha cambiato» (docs/plans/32): le scelte senza DOM. Di quale
   cartella si parla, cosa dice la linguetta, quando rileggere un diff aperto. */
const M = require('../renderer/changes-model');

const result = (files, extra = {}) => ({
  ok: true, root: '/r', against: 'abc', base: null, truncated: false,
  totals: { files: files.length, added: files.reduce((n, f) => n + (f.added || 0), 0), removed: files.reduce((n, f) => n + (f.removed || 0), 0) },
  files, ...extra,
});
const file = (path, added = 1, removed = 0, status = 'M') => ({ path, status, added, removed, binary: false });

ok('modifiche: il bersaglio è la cartella della sessione, con la base se sta in un worktree', () => {
  assert.deepStrictEqual(M.targetFor({ type: 'claude', cwd: '/r' }, null), { cwd: '/r', base: null, branch: null, key: '/r\0' });
  const wt = { path: '/r.worktrees/feat-x', branch: 'feat/x', base: 'main' };
  assert.deepStrictEqual(M.targetFor({ type: 'shell', cwd: '/r.worktrees/feat-x' }, wt),
    { cwd: '/r.worktrees/feat-x', base: 'main', branch: 'feat/x', key: '/r.worktrees/feat-x\0main' });
  // worktree senza base: contro HEAD, ma il branch si mostra
  assert.strictEqual(M.targetFor({ type: 'shell', cwd: '/w' }, { path: '/w', branch: 'x', base: null }).base, null);
});

ok('modifiche: niente bersaglio per la scheda git o senza cartella', () => {
  assert.strictEqual(M.targetFor(null, null), null);
  assert.strictEqual(M.targetFor({ type: 'git', cwd: '/r' }, null), null);
  assert.strictEqual(M.targetFor({ type: 'shell', cwd: '' }, null), null);
});

ok('modifiche: la linguetta dice file e righe, e sparisce fuori da un repository', () => {
  assert.deepStrictEqual(M.tabLabel(result([file('a', 120, 30), file('b'), file('c')])), { visible: true, clean: false, text: '3 · +122 −30' });
  assert.deepStrictEqual(M.tabLabel(result([])), { visible: true, clean: true, text: '±0' });
  assert.strictEqual(M.tabLabel(null).visible, false);
  assert.strictEqual(M.tabLabel({ ok: false, reason: 'not-a-repo' }).visible, false);
  assert.strictEqual(M.tabLabel({ ok: false, error: 'boh' }).visible, false);
});

ok('modifiche: il titolo dice rispetto a cosa', () => {
  const target = { cwd: '/w', base: 'main', branch: 'feat/x' };
  assert.strictEqual(M.headerTitle(target, result([], { base: 'main' })), 'feat/x da main');
  assert.strictEqual(M.headerTitle({ cwd: '/r', base: null, branch: null }, result([])), 'rispetto all\'ultimo commit');
  // la base non c'è più: si è confrontato con HEAD e il titolo lo dice
  assert.strictEqual(M.headerTitle(target, result([], { base: null })), 'feat/x · rispetto all\'ultimo commit');
  assert.strictEqual(M.headerTitle({ cwd: '/r', base: null, branch: null }, result([], { against: null })), 'nessun commit ancora');
});

ok('modifiche: il riepilogo conta tutti i file e dice se l\'elenco è tagliato', () => {
  assert.strictEqual(M.summary(result([file('a', 2, 1)])), '1 file · +2 −1');
  assert.strictEqual(M.summary(result([file('a'), file('b')])), '2 file · +2 −0');
  const cut = result([file('a')], { truncated: true, totals: { files: 1500, added: 9, removed: 0 } });
  assert.strictEqual(M.summary(cut), '1500 file · +9 −0 · mostrati i primi 1');
  assert.strictEqual(M.summary(result([])), 'Nessuna modifica');
});

ok('modifiche: i contatori di un file', () => {
  assert.deepStrictEqual(M.fileCounts(file('a', 12, 3)), { added: '+12', removed: '−3', note: null });
  assert.deepStrictEqual(M.fileCounts({ ...file('a'), binary: true, added: null, removed: null }), { added: null, removed: null, note: 'binario' });
  assert.deepStrictEqual(M.fileCounts({ ...file('a'), added: null, removed: 0, status: '?' }), { added: null, removed: null, note: 'grande' });
  assert.deepStrictEqual(M.fileCounts(file('a', 0, 4, 'D')), { added: null, removed: '−4', note: null });
});

ok('modifiche: la firma cambia solo se cambia qualcosa che si vede', () => {
  const a = result([file('a', 1, 0)]);
  assert.strictEqual(M.signature(a), M.signature(result([file('a', 1, 0)])));
  assert.notStrictEqual(M.signature(a), M.signature(result([file('a', 2, 0)])));
  assert.notStrictEqual(M.signature(a), M.signature(result([file('a', 1, 0)], { against: 'zzz' })));
  assert.notStrictEqual(M.signature(a), M.signature({ ok: false, reason: 'not-a-repo' }));
});

ok('modifiche: un diff aperto si rilegge se il suo file cambia, si chiude se sparisce', () => {
  const prev = [file('a', 1), file('b', 1), file('c', 1)];
  const next = [file('a', 1), file('b', 5)];
  assert.deepStrictEqual(M.diffsToReload(prev, next, ['a', 'b', 'c']), { reload: ['b'], drop: ['c'] });
  assert.deepStrictEqual(M.diffsToReload(prev, prev, ['a']), { reload: [], drop: [] });
  // il punto di confronto è cambiato (un commit): tutti da rileggere
  assert.deepStrictEqual(M.diffsToReload(prev, prev, ['a'], { againstChanged: true }), { reload: ['a'], drop: [] });
});

ok('modifiche: il percorso si divide in cartella e nome, anche con i rinominati', () => {
  assert.deepStrictEqual(M.splitPath('lib/sub/x.js'), { dir: 'lib/sub/', name: 'x.js' });
  assert.deepStrictEqual(M.splitPath('x.js'), { dir: '', name: 'x.js' });
  assert.strictEqual(M.displayPath({ path: 'b.js', oldPath: 'lib/a.js' }), 'lib/a.js → b.js');
  assert.strictEqual(M.displayPath({ path: 'b.js' }), 'b.js');
});

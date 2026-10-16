const assert = require('node:assert');
const { test: ok } = require('node:test');

/* I worktree nella timeline git (docs/plans/66-grafo-worktree.md): quali
   linee sono di un worktree, vivo o già unito, e come si disegnano. */
const { layoutGraph, readGitGraph, worktreeLanes, markWorktreeRefs, FIELD_SEP, RECORD_SEP } = require('../lib/git-graph');
const { worktreeMergeMessage, isWorktreeMerge } = require('../lib/worktree-path');
const { parseMergeSubject } = require('../lib/git-branch-topology');
const View = require('../renderer/git-graph-view');

const rec = (hash, parents, subject, refs = '') => [
  hash, parents.join(' '), 'Ale', '2026-10-16T10:00:00+02:00', refs, subject,
].join(FIELD_SEP) + RECORD_SEP;
const commit = (hash, parents, subject, refs = []) => ({ hash, parents, subject, refs });
const branch = (name, extra = {}) => ({ name, kind: 'branch', head: false, ...extra });

const lanesOf = (commits, branches) => {
  const { rows } = layoutGraph(commits, { pinned: ['main'] });
  return { rows, lanes: worktreeLanes(rows, { branches, reserved: 1 }) };
};

ok('worktree-grafo: il messaggio del merge è firmato e si riconosce', () => {
  const msg = worktreeMergeMessage('feat/x');
  assert.strictEqual(msg, "Merge branch 'feat/x' (worktree)");
  assert.strictEqual(isWorktreeMerge(msg), true);
  assert.strictEqual(isWorktreeMerge("Merge branch 'feat/x'"), false);
  assert.strictEqual(isWorktreeMerge(undefined), false);
  // la mappa dei branch legge il nome come per un merge normale
  assert.deepStrictEqual(parseMergeSubject(msg), { name: 'feat/x', pr: null });
});

ok('worktree-grafo: la linea di un worktree vivo con commit suoi è del worktree', () => {
  const commits = [
    commit('w1', ['m1'], 'lavoro nel worktree', [branch('feat/x')]),
    commit('m1', ['m0'], 'base', [branch('main', { head: true })]),
    commit('m0', [], 'primo'),
  ];
  const { rows, lanes } = lanesOf(commits, new Set(['feat/x']));
  assert.deepStrictEqual(lanes, [rows[0].color]);
  assert.notStrictEqual(rows[0].color, 0);
  assert.deepStrictEqual(lanesOf(commits, new Set()).lanes, [], 'un branch normale non è un worktree');
});

ok('worktree-grafo: un worktree senza commit suoi non tratteggia la linea della base', () => {
  const commits = [
    commit('m1', ['m0'], 'base', [branch('main', { head: true }), branch('feat/x')]),
    commit('m0', [], 'primo'),
  ];
  assert.deepStrictEqual(lanesOf(commits, new Set(['feat/x'])).lanes, []);
});

ok('worktree-grafo: un worktree sulla linea di un altro branch non se la prende', () => {
  const commits = [
    commit('a2', ['a1'], 'altro', [branch('feat/a')]),
    commit('a1', ['m0'], 'punta del worktree', [branch('feat/x')]),
    commit('m0', [], 'primo', [branch('main')]),
  ];
  assert.deepStrictEqual(lanesOf(commits, new Set(['feat/x'])).lanes, []);
});

ok('worktree-grafo: un worktree già unito si riconosce dal merge firmato', () => {
  const commits = [
    commit('m2', ['m1', 'w1'], worktreeMergeMessage('feat/x'), [branch('main', { head: true })]),
    commit('w1', ['m0'], 'lavoro nel worktree'),
    commit('m1', ['m0'], 'altro su main'),
    commit('m0', [], 'primo'),
  ];
  const { rows, lanes } = lanesOf(commits, new Set());
  const w1 = rows.find((r) => r.commit.hash === 'w1');
  assert.deepStrictEqual(lanes, [w1.color]);
  const unsigned = commits.map((c) => (c.hash === 'm2' ? { ...c, subject: "Merge branch 'feat/x'" } : c));
  assert.deepStrictEqual(lanesOf(unsigned, new Set()).lanes, [], 'un merge non firmato è un branch normale');
});

ok('worktree-grafo: markWorktreeRefs segna i branch dei worktree senza toccare i commit', () => {
  const commits = [commit('a', [], 'x', [branch('feat/x'), branch('main'), { name: 'origin/feat/x', kind: 'remote', head: false }])];
  const marked = markWorktreeRefs(commits, new Set(['feat/x']));
  assert.deepStrictEqual(marked[0].refs.map((r) => Boolean(r.worktree)), [true, false, false]);
  assert.strictEqual(commits[0].refs[0].worktree, undefined, 'commit originale mutato');
});

/* readGitGraph con un finto git */
function fakeGit(responses) {
  return async (args) => {
    const key = args.find((a) => responses[a] !== undefined);
    const r = responses[key];
    if (r instanceof Error) throw r;
    return r;
  };
}
const PORCELAIN = [
  'worktree /repo', 'HEAD m1', 'branch refs/heads/main', '',
  'worktree /repo.worktrees/feat-x', 'HEAD w1', 'branch refs/heads/feat/x', '',
].join('\n');
const LOG = rec('w1', ['m1'], 'lavoro', 'feat/x') + rec('m1', ['m0'], 'base', 'HEAD -> main') + rec('m0', [], 'primo');

ok('worktree-grafo: readGitGraph segna ref e linee dei worktree, non il principale', async () => {
  const run = fakeGit({ '--show-toplevel': '/repo\n', remote: '', log: LOG, 'for-each-ref': 'main\nfeat/x\n', worktree: PORCELAIN });
  const r = await readGitGraph({ cwd: '/repo', run, platform: 'linux' });
  assert.strictEqual(r.ok, true, r.error);
  const refs = r.rows.flatMap((row) => row.commit.refs);
  assert.strictEqual(refs.find((x) => x.name === 'feat/x').worktree, true);
  assert.ok(!refs.find((x) => x.name === 'main').worktree, 'il principale non è un worktree');
  assert.deepStrictEqual(r.worktreeLanes, [r.rows[0].color]);
});

ok('worktree-grafo: se git worktree list fallisce la timeline c\'è lo stesso', async () => {
  const run = fakeGit({ '--show-toplevel': '/repo\n', remote: '', log: LOG, 'for-each-ref': 'main\n', worktree: new Error('boom') });
  const r = await readGitGraph({ cwd: '/repo', run, platform: 'linux' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.worktreeLanes, []);
});

/* Il disegno */
ok('worktree-grafo: il nome di un worktree ha ⌂ davanti, gli altri no', () => {
  assert.strictEqual(View.refText({ name: 'feat/x', kind: 'branch', worktree: true }), '⌂ feat/x');
  assert.strictEqual(View.refText({ name: 'feat/y', kind: 'branch' }), 'feat/y');
});

ok('worktree-grafo: le linee dei worktree sono tratteggiate', () => {
  const dashed = View.edgeAttrs(0, { from: 1, to: 1, color: 2 }, new Set([2]));
  assert.strictEqual(dashed['stroke-dasharray'], View.WORKTREE_DASH);
  const solid = View.edgeAttrs(0, { from: 0, to: 0, color: 0 }, new Set([2]));
  assert.strictEqual(solid['stroke-dasharray'], undefined);
  assert.strictEqual(solid.d, View.edgePath(0, 0, 0));
});

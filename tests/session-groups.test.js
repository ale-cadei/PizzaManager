const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Raggruppamento delle sessioni aperte nella sidebar: per tipo (default) o per
   progetto. Il modulo sta in renderer/ perché il renderer non ha require e non
   potrebbe importarlo da lib/; il wrapper UMD lo rende comunque testabile qui. */
const { groupSessions, worktreeOf, relativeSubpath, shortPath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL } = require('../renderer/session-groups');

const byType = (sessions) => groupSessions(sessions, { mode: 'type', typeOrder: TYPE_ORDER, typeLabels: TYPE_LABELS });
const byProject = (sessions) => groupSessions(sessions, { mode: 'project' });
const shape = (groups) => groups.map((g) => [g.label, g.items.map((s) => s.id)]);

ok('gruppi per tipo: ordine fisso, etichette leggibili, tipi sconosciuti in coda', () => {
  const groups = byType([
    { id: 'a', type: 'claude' },
    { id: 'b', type: 'shell' },
    { id: 'c', type: 'futuro' },
    { id: 'd', type: 'claude' },
  ]);
  assert.deepStrictEqual(shape(groups), [
    ['Terminale', ['b']],
    ['Claude', ['a', 'd']],
    ['futuro', ['c']],
  ]);
  assert.deepStrictEqual(groups.map((g) => g.key), ['shell', 'claude', 'futuro']);
  assert.ok(groups.every((g) => g.kind === 'type'));
});

ok('gruppi per tipo: i tipi senza sessioni aperte non producono gruppi vuoti', () => {
  assert.deepStrictEqual(shape(byType([{ id: 'a', type: 'codex' }])), [['Codex', ['a']]]);
});

ok('gruppi per progetto: ordine alfabetico, etichetta = nome della cartella', () => {
  const groups = byProject([
    { id: 'a', type: 'claude', projectRoot: '/home/tizio/zulu' },
    { id: 'b', type: 'shell', projectRoot: '/home/tizio/alfa' },
    { id: 'c', type: 'codex', projectRoot: '/home/tizio/zulu' },
  ]);
  assert.deepStrictEqual(shape(groups), [['alfa', ['b']], ['zulu', ['a', 'c']]]);
  assert.deepStrictEqual(groups.map((g) => g.title), ['/home/tizio/alfa', '/home/tizio/zulu'],
    'il title deve restare il path completo');
  assert.ok(groups.every((g) => g.kind === 'project'));
});

ok('gruppi per progetto: due cartelle omonime si disambiguano entrambe', () => {
  const groups = byProject([
    { id: 'a', type: 'shell', projectRoot: '/lavoro/cliente/app' },
    { id: 'b', type: 'shell', projectRoot: '/personale/app' },
    { id: 'c', type: 'shell', projectRoot: '/personale/blog' },
  ]);
  assert.deepStrictEqual(shape(groups), [
    ['blog', ['c']],
    ['cliente/app', ['a']],
    ['personale/app', ['b']],
  ]);
});

ok('gruppi per progetto: le sessioni senza directory finiscono in fondo', () => {
  const groups = byProject([
    { id: 'a', type: 'shell', projectRoot: null },
    { id: 'b', type: 'shell', projectRoot: '/home/tizio/alfa' },
  ]);
  assert.deepStrictEqual(shape(groups), [['alfa', ['b']], [NO_PROJECT_LABEL, ['a']]]);
  assert.strictEqual(groups[1].key, '');
});

ok('gruppi: gli input non vengono mutati e i gruppi sono strutture nuove', () => {
  const sessions = [{ id: 'a', type: 'shell', projectRoot: '/x' }];
  const copy = JSON.parse(JSON.stringify(sessions));
  const groups = byProject(sessions);
  groups[0].items.push({ id: 'intruso', type: 'shell' });
  assert.deepStrictEqual(sessions, copy, "l'array di partenza è stato toccato");
});

ok('gruppi: senza modalità si raggruppa per tipo, e un input non valido non lancia', () => {
  assert.deepStrictEqual(shape(groupSessions([{ id: 'a', type: 'shell' }], { typeLabels: TYPE_LABELS })), [['Terminale', ['a']]]);
  assert.deepStrictEqual(groupSessions(null), []);
  assert.deepStrictEqual(groupSessions(undefined, { mode: 'project' }), []);
});

ok('sottopath: si mostra solo quando la sessione non sta nella radice del progetto', () => {
  assert.strictEqual(relativeSubpath('/repo/src/parti', '/repo'), 'src/parti');
  assert.strictEqual(relativeSubpath('/repo', '/repo'), '');
  assert.strictEqual(relativeSubpath('/altro/posto', '/repo'), '', 'una cwd fuori dalla radice non produce un path finto');
  assert.strictEqual(relativeSubpath('/repo-bis/src', '/repo'), '', 'il confronto non deve fermarsi al prefisso di stringa');
  assert.strictEqual(relativeSubpath('', '/repo'), '');
  assert.strictEqual(relativeSubpath('/repo/src', null), '');
});

/* shortPath sta qui e non nel renderer perché lo usano in due: la sidebar e i
   chip delle directory recenti. Una sola definizione, una sola verifica. */
ok('path corto: solo cartella genitore e cartella corrente', () => {
  assert.strictEqual(shortPath('/home/tizio/progetto/backend'), 'progetto/backend');
  assert.strictEqual(shortPath('/home'), 'home');
  assert.strictEqual(shortPath('/'), '/');
  assert.strictEqual(shortPath(''), '');
  assert.strictEqual(shortPath(null), '');
});

ok('gruppi per progetto: un ordine scelto dall utente vince su quello alfabetico', () => {
  const groups = groupSessions([
    { id: 'a', type: 'shell', projectRoot: '/p/alfa' },
    { id: 'b', type: 'shell', projectRoot: '/p/beta' },
    { id: 'c', type: 'shell', projectRoot: '/p/gamma' },
  ], { mode: 'project', projectOrder: ['/p/gamma', '/p/alfa'] });
  // I progetti mai spostati vanno in coda, fra loro in ordine alfabetico
  assert.deepStrictEqual(shape(groups), [['gamma', ['c']], ['alfa', ['a']], ['beta', ['b']]]);
});

ok('gruppi per progetto: con un ordine salvato «Senza directory» resta comunque in fondo', () => {
  const groups = groupSessions([
    { id: 'a', type: 'shell', projectRoot: null },
    { id: 'b', type: 'shell', projectRoot: '/p/beta' },
  ], { mode: 'project', projectOrder: ['', '/p/beta', '/p/sparito'] });
  assert.deepStrictEqual(shape(groups), [['beta', ['b']], [NO_PROJECT_LABEL, ['a']]]);
});

// ---------- worktree (docs/plans/36-sessione-worktree.md) ----------

/* Un progetto con due worktree: le sessioni dentro un worktree vanno nella sua
   sotto-sezione, le altre restano fra quelle della cartella principale */
const WORKTREES = {
  '/src/progetto': [
    { path: '/src/progetto.worktrees/feat-x', branch: 'feat/x', base: 'main' },
    { path: '/src/progetto.worktrees/vuoto', branch: 'vuoto', base: null },
  ],
};
const withWorktrees = (sessions, worktrees = WORKTREES) => groupSessions(sessions, { mode: 'project', worktrees });

ok('worktree: le sessioni di un worktree finiscono nella sua sotto-sezione, anche da una sottocartella', () => {
  const [g] = withWorktrees([
    { id: 'main', type: 'claude', cwd: '/src/progetto', projectRoot: '/src/progetto' },
    { id: 'wt', type: 'claude', cwd: '/src/progetto.worktrees/feat-x', projectRoot: '/src/progetto' },
    { id: 'wt-sub', type: 'shell', cwd: '/src/progetto.worktrees/feat-x/src', projectRoot: '/src/progetto' },
  ]);
  assert.deepStrictEqual(g.items.map((s) => s.id), ['main']);
  assert.deepStrictEqual(g.worktrees.map((w) => [w.branch, w.base, w.items.map((s) => s.id)]), [
    ['feat/x', 'main', ['wt', 'wt-sub']],
    ['vuoto', null, []],
  ]);
  assert.strictEqual(g.worktrees[0].path, '/src/progetto.worktrees/feat-x');
});

ok('worktree: un worktree senza sessioni resta visibile, anche con il progetto senza sessioni sue', () => {
  const [g] = withWorktrees([{ id: 'wt', type: 'codex', cwd: '/src/progetto.worktrees/feat-x', projectRoot: '/src/progetto' }]);
  assert.deepStrictEqual(g.items, []);
  assert.deepStrictEqual(g.worktrees.map((w) => w.items.length), [1, 0]);
});

ok('worktree: una cartella che inizia come il worktree non ci finisce dentro', () => {
  const [g] = withWorktrees([{ id: 'a', type: 'shell', cwd: '/src/progetto.worktrees/feat-x2', projectRoot: '/src/progetto' }]);
  assert.deepStrictEqual(g.items.map((s) => s.id), ['a']);
});

ok('worktree: senza elenco dei worktree ogni gruppo progetto ne ha uno vuoto, e il resto non cambia', () => {
  const sessions = [{ id: 'a', type: 'shell', cwd: '/src/progetto/x', projectRoot: '/src/progetto' }, { id: 'b', type: 'shell', projectRoot: null }];
  for (const worktrees of [undefined, null, 'boh', { '/altro': [{ path: '/altro.worktrees/y', branch: 'y' }] }]) {
    const groups = groupSessions(sessions, { mode: 'project', worktrees });
    assert.deepStrictEqual(shape(groups), [['progetto', ['a']], [NO_PROJECT_LABEL, ['b']]], String(worktrees));
    assert.ok(groups.every((g) => Array.isArray(g.worktrees) && g.worktrees.length === 0), String(worktrees));
  }
});

ok('worktree: «Senza directory» non riceve worktree, e per tipo non ci sono sotto-sezioni', () => {
  const sessions = [
    { id: 'wt', type: 'claude', cwd: '/src/progetto.worktrees/feat-x', projectRoot: '/src/progetto' },
    { id: 'x', type: 'shell', projectRoot: null },
  ];
  const project = withWorktrees(sessions);
  assert.deepStrictEqual(project.find((g) => g.key === '').worktrees, []);
  const types = groupSessions(sessions, { mode: 'type', worktrees: WORKTREES });
  assert.deepStrictEqual(shape(types), [['Terminale', ['x']], ['Claude', ['wt']]], 'per tipo una sessione di worktree sparisce');
  assert.ok(types.every((g) => g.worktrees === undefined));
});

ok('worktree: su Windows il worktree si riconosce coi backslash', () => {
  const worktrees = { 'C:\\src\\progetto': [{ path: 'C:\\src\\progetto.worktrees\\feat-x', branch: 'feat/x', base: 'main' }] };
  const [g] = withWorktrees([{ id: 'wt', type: 'shell', cwd: 'C:\\src\\progetto.worktrees\\feat-x\\src', projectRoot: 'C:\\src\\progetto' }], worktrees);
  assert.deepStrictEqual(g.worktrees[0].items.map((s) => s.id), ['wt']);
});

ok('worktree: né le sessioni né l elenco dei worktree vengono mutati', () => {
  const sessions = [{ id: 'wt', type: 'claude', cwd: '/src/progetto.worktrees/feat-x', projectRoot: '/src/progetto' }];
  const worktrees = JSON.parse(JSON.stringify(WORKTREES));
  const before = JSON.stringify({ sessions, worktrees });
  const [g] = withWorktrees(sessions, worktrees);
  assert.strictEqual(JSON.stringify({ sessions, worktrees }), before);
  assert.notStrictEqual(g.worktrees[0], worktrees['/src/progetto'][0], 'la sotto-sezione è l oggetto dell elenco');
});

ok('worktree: worktreeOf dice in quale worktree sta una sessione, o null', () => {
  const at = (cwd, projectRoot = '/src/progetto') => worktreeOf({ cwd, projectRoot }, WORKTREES);
  assert.strictEqual(at('/src/progetto.worktrees/feat-x/src').branch, 'feat/x');
  assert.strictEqual(at('/src/progetto'), null, 'la cartella principale non è un worktree');
  assert.strictEqual(at('/src/progetto.worktrees/feat-x2'), null);
  assert.strictEqual(at('/src/progetto.worktrees/feat-x', '/altro'), null, 'cercato nei worktree di un altro progetto');
  for (const bad of [null, undefined, {}]) assert.strictEqual(worktreeOf(bad, WORKTREES), null);
  assert.strictEqual(worktreeOf({ cwd: '/x', projectRoot: '/x' }, null), null);
});

ok('il tipo editor ha posto e nome nei gruppi (piano 60)', () => {
  assert.strictEqual(TYPE_ORDER.indexOf('editor'), TYPE_ORDER.indexOf('git') + 1);
  assert.strictEqual(TYPE_LABELS.editor, 'Editor');
});

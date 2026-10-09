const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Sessione git: cambiare branch (anche partendo da un remoto) o crearne uno.
   lib/git-branches.js con un finto `git`: si verifica cosa gli si chiede. */
const { parseBranches, validateBranchName, listBranches, switchBranch, createBranch, deleteBranch, FIELD_SEP } = require('../lib/git-branches');

const line = (ref, head = ' ', upstream = '') => [ref, head, upstream].join(FIELD_SEP);

function fakeGit(handler) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push(args);
    return handler(args, opts);
  };
  return { run, calls };
}

const gitError = (stderr) => Object.assign(new Error('Command failed: git'), { stderr });

ok('branch: parseBranches separa locali e remoti e segna il corrente', () => {
  const text = [
    line('refs/heads/feat/x'),
    line('refs/heads/main', '*', 'origin/main'),
    line('refs/remotes/origin/HEAD'),
    line('refs/remotes/origin/main'),
    line('refs/remotes/origin/fix/y'),
  ].join('\n') + '\n';
  const b = parseBranches(text);
  assert.deepStrictEqual(b.local, [
    { name: 'feat/x', current: false, upstream: '' },
    { name: 'main', current: true, upstream: 'origin/main' },
  ]);
  // origin/HEAD non è un branch: è un puntatore al branch di default
  assert.deepStrictEqual(b.remote.map((r) => r.name), ['origin/main', 'origin/fix/y']);
  assert.deepStrictEqual(b.remote[1], { name: 'origin/fix/y', remote: 'origin', short: 'fix/y', hasLocal: false });
  assert.strictEqual(b.remote[0].hasLocal, true, 'origin/main ha già il suo main locale');
});

ok('branch: parseBranches con output vuoto o spazzatura non esplode', () => {
  assert.deepStrictEqual(parseBranches(''), { local: [], remote: [] });
  assert.deepStrictEqual(parseBranches('niente\n\n'), { local: [], remote: [] });
});

ok('branch: validateBranchName accetta i nomi normali', () => {
  for (const name of ['main', 'feat/sessione-git', 'fix_1', 'release/1.2.0']) {
    assert.strictEqual(validateBranchName(name), null, name);
  }
});

ok('branch: validateBranchName rifiuta nomi vuoti, opzioni e caratteri vietati da git', () => {
  assert.match(validateBranchName(''), /nome/i);
  assert.match(validateBranchName('   '), /nome/i);
  for (const bad of ['-f', '--force', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b',
    'fine/', '/inizio', 'x.lock', 'punto.', 'a@{1}', '@', 'a//b', '.nascosto', 'a/.b']) {
    assert.ok(validateBranchName(bad), `"${bad}" doveva essere rifiutato`);
  }
});

ok('branch: listBranches chiede heads e remotes a for-each-ref', async () => {
  const { run, calls } = fakeGit(() => line('refs/heads/main', '*') + '\n');
  const r = await listBranches({ cwd: '/repo', run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.local[0].name, 'main');
  assert.strictEqual(calls[0][0], 'for-each-ref');
  assert.ok(calls[0].includes('refs/heads') && calls[0].includes('refs/remotes'));
});

ok('branch: listBranches fuori da un repository restituisce un errore, non un\'eccezione', async () => {
  const { run } = fakeGit(() => { throw gitError('fatal: not a git repository'); });
  const r = await listBranches({ cwd: '/tmp', run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /not a git repository/);
});

ok('branch: switchBranch su un locale fa git switch <nome>', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await switchBranch({ cwd: '/repo', name: 'feat/x', kind: 'local', run });
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/x' });
  assert.deepStrictEqual(calls, [['switch', 'feat/x']]);
});

ok('branch: un remoto senza locale diventa un branch locale che lo segue', async () => {
  const { run, calls } = fakeGit((args) => {
    if (args[0] === 'rev-parse') throw gitError('');
    return '';
  });
  const r = await switchBranch({ cwd: '/repo', name: 'origin/fix/y', kind: 'remote', run });
  assert.deepStrictEqual(r, { ok: true, branch: 'fix/y' });
  assert.deepStrictEqual(calls[calls.length - 1], ['switch', '--track', 'origin/fix/y']);
});

ok('branch: un remoto che ha già il suo locale passa al locale', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await switchBranch({ cwd: '/repo', name: 'origin/main', kind: 'remote', run });
  assert.deepStrictEqual(r, { ok: true, branch: 'main' });
  assert.deepStrictEqual(calls[0], ['rev-parse', '--verify', '--quiet', 'refs/heads/main']);
  assert.deepStrictEqual(calls[1], ['switch', 'main']);
});

ok('branch: con modifiche in conflitto git rifiuta e il messaggio arriva all\'utente', async () => {
  const { run } = fakeGit(() => {
    throw gitError('error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.\nAborting\n');
  });
  const r = await switchBranch({ cwd: '/repo', name: 'feat/x', kind: 'local', run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /local changes/);
  assert.match(r.error, /a\.txt/);
});

ok('branch: switchBranch rifiuta nomi che git leggerebbe come opzioni, senza lanciarlo', async () => {
  const { run, calls } = fakeGit(() => '');
  for (const [name, kind] of [['--orphan', 'local'], ['-c', 'local'], ['', 'local'], ['main', 'boh'], ['origin', 'remote'], ['origin/-x', 'remote']]) {
    const r = await switchBranch({ cwd: '/repo', name, kind, run });
    assert.strictEqual(r.ok, false, `${kind} "${name}" doveva essere rifiutato`);
  }
  assert.deepStrictEqual(calls, []);
});

ok('branch: createBranch verifica il nome con git e poi fa git switch -c', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await createBranch({ cwd: '/repo', name: ' feat/nuovo ', run });
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/nuovo' });
  assert.deepStrictEqual(calls, [['check-ref-format', '--branch', 'feat/nuovo'], ['switch', '-c', 'feat/nuovo']]);
});

ok('branch: createBranch con un nome non valido non lancia git switch', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await createBranch({ cwd: '/repo', name: 'a b', run });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(calls, []);
});

ok('branch: createBranch con un nome già usato lo dice', async () => {
  const { run } = fakeGit((args) => {
    if (args[0] === 'switch') throw gitError("fatal: a branch named 'main' already exists\n");
    return '';
  });
  const r = await createBranch({ cwd: '/repo', name: 'main', run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /already exists/);
});

ok('branch: senza cwd rifiuta subito', async () => {
  const { run, calls } = fakeGit(() => '');
  assert.strictEqual((await listBranches({ cwd: '', run })).ok, false);
  assert.strictEqual((await switchBranch({ cwd: '', name: 'main', kind: 'local', run })).ok, false);
  assert.strictEqual((await createBranch({ cwd: '', name: 'x', run })).ok, false);
  assert.deepStrictEqual(calls, []);
});

ok('branch: deleteBranch fa git branch -d, che rifiuta i branch non uniti', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await deleteBranch({ cwd: '/repo', name: 'feat/x', run });
  assert.deepStrictEqual(r, { ok: true, branch: 'feat/x' });
  assert.deepStrictEqual(calls, [['branch', '-d', 'feat/x']]);
});

ok('branch: un branch non unito si segnala, non si elimina', async () => {
  const { run } = fakeGit(() => {
    throw gitError("error: the branch 'feat/x' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D feat/x'.\n");
  });
  const r = await deleteBranch({ cwd: '/repo', name: 'feat/x', run });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notMerged, true);
  assert.match(r.error, /not fully merged/);
});

ok('branch: con force si elimina anche non unito (git branch -D)', async () => {
  const { run, calls } = fakeGit(() => '');
  const r = await deleteBranch({ cwd: '/repo', name: 'feat/x', force: true, run });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [['branch', '-D', 'feat/x']]);
});

ok('branch: force vale solo se è proprio true', async () => {
  const { run, calls } = fakeGit(() => '');
  await deleteBranch({ cwd: '/repo', name: 'feat/x', force: 'yes', run });
  assert.deepStrictEqual(calls, [['branch', '-d', 'feat/x']]);
});

ok('branch: il branch corrente e gli altri errori di git arrivano all\'utente', async () => {
  const { run } = fakeGit(() => { throw gitError("error: cannot delete branch 'main' used by worktree at '/repo'\n"); });
  const r = await deleteBranch({ cwd: '/repo', name: 'main', run });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.notMerged);
  assert.match(r.error, /cannot delete branch/);
});

ok('branch: deleteBranch rifiuta nomi che git leggerebbe come opzioni, senza lanciarlo', async () => {
  const { run, calls } = fakeGit(() => '');
  for (const name of ['-D', '--all', '', 'a b', undefined]) {
    assert.strictEqual((await deleteBranch({ cwd: '/repo', name, run })).ok, false, String(name));
  }
  assert.strictEqual((await deleteBranch({ cwd: '', name: 'x', run })).ok, false);
  assert.deepStrictEqual(calls, []);
});

/* Il selettore nel renderer (renderer/git-branch-picker.js): solo il filtro */
const { filterBranches } = require('../renderer/git-branch-picker');

ok('branch: il filtro del selettore cerca in locali e remoti senza distinguere maiuscole', () => {
  const branches = parseBranches([line('refs/heads/main', '*'), line('refs/heads/feat/Git'), line('refs/remotes/origin/feat/git-x')].join('\n'));
  const f = filterBranches(branches, 'GIT');
  assert.deepStrictEqual(f.local.map((b) => b.name), ['feat/Git']);
  assert.deepStrictEqual(f.remote.map((b) => b.name), ['origin/feat/git-x']);
  assert.strictEqual(f.create, 'GIT', 'un nome che non esiste si può creare');
  assert.strictEqual(filterBranches(branches, 'main').create, '', 'main esiste già');
  assert.strictEqual(filterBranches(branches, '  ').create, '');
  assert.strictEqual(filterBranches(branches, '').local.length, 2);
  assert.deepStrictEqual(filterBranches(null, 'x'), { local: [], remote: [], create: 'x' });
});

const { clampPickerWidth, PICKER_MIN_W, PICKER_DEFAULT_W } = require('../renderer/git-branch-picker');

ok('branch: la larghezza del selettore resta fra il minimo e lo spazio disponibile', () => {
  assert.strictEqual(clampPickerWidth(600, 1000), 600);
  assert.strictEqual(clampPickerWidth(1500, 1000), 1000, 'non esce dal pannello');
  assert.strictEqual(clampPickerWidth(100, 1000), PICKER_MIN_W);
  assert.strictEqual(clampPickerWidth(500, 200), PICKER_MIN_W, 'pannello stretto: vince il minimo');
  assert.strictEqual(clampPickerWidth(null, 1000), PICKER_DEFAULT_W, 'niente di salvato');
  assert.strictEqual(clampPickerWidth('boh', 1000), PICKER_DEFAULT_W);
  assert.strictEqual(clampPickerWidth('512', 1000), 512, 'da localStorage arriva una stringa');
  assert.strictEqual(clampPickerWidth(333.6, 1000), 334);
});

/* ⤵ nel selettore (docs/plans/46): il codice vero col DOM finto */
const { createElement, fire } = require('./fake-dom');
const { createBranchPicker } = require('../renderer/git-branch-picker');

const BRANCHES = {
  ok: true,
  local: [{ name: 'main', current: true, upstream: null }, { name: 'feat/x', current: false, upstream: 'origin/feat/x' }],
  remote: [{ name: 'origin/fix/y', remote: 'origin', short: 'fix/y', hasLocal: false }],
};
const settle = () => new Promise((r) => setImmediate(r));

async function openPicker({ branches = BRANCHES, onMerge } = {}) {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.createElementNS = (ns, tag) => createElement(tag);
  doc.body = createElement('body');
  const host = createElement('div');
  host.clientWidth = 900;
  const calls = { switch: [], loads: 0 };
  const picker = createBranchPicker({
    document: doc, host, onMerge,
    load: async () => { calls.loads += 1; return branches; },
    onSwitch: async (name, kind) => { calls.switch.push([name, kind]); return { ok: true }; },
    onCreate: async () => ({ ok: true }), onDelete: async () => ({ ok: true }),
  });
  await picker.open();
  const merges = () => host.querySelectorAll('.git-picker-merge');
  const text = (cls) => { const [n] = host.querySelectorAll(cls); return n.hidden ? '' : n.textContent; };
  return { picker, host, calls, merges, text };
}

ok('selettore: ⤵ sulle righe che non sono il corrente, locali e remote', async () => {
  const p = await openPicker({ onMerge: async () => ({ cancelled: true }) });
  const titles = p.merges().map((b) => b.title);
  assert.deepStrictEqual(titles, ['Unisci feat/x in main', 'Unisci origin/fix/y in main']);
  assert.strictEqual(p.merges()[0].getAttribute('aria-label'), 'Unisci feat/x in main');
  // senza onMerge, o con la cartella su un commit staccato: nessun ⤵
  assert.strictEqual((await openPicker()).merges().length, 0);
  const detached = { ...BRANCHES, local: BRANCHES.local.map((b) => ({ ...b, current: false })) };
  assert.strictEqual((await openPicker({ branches: detached, onMerge: async () => ({}) })).merges().length, 0);
});

ok('selettore: ⤵ chiede il merge, aspetta la conferma e mostra l\'esito', async () => {
  let answer;
  const asked = [];
  const p = await openPicker({ onMerge: (...args) => { asked.push(args); return new Promise((r) => { answer = r; }); } });
  fire(p.merges()[1], 'click');
  assert.deepStrictEqual(asked, [['origin/fix/y', 'remote', 'main']]);
  assert.match(p.text('.git-picker-notice'), /pannello delle modifiche/);
  assert.strictEqual(p.picker.isOpen(), true);
  // un secondo clic mentre aspetta non chiede un altro merge
  fire(p.merges()[0], 'click');
  assert.strictEqual(asked.length, 1);
  const loads = p.calls.loads;
  answer({ ok: true, text: 'origin/fix/y unito in main (fast-forward).' });
  await settle(); await settle();
  assert.strictEqual(p.text('.git-picker-notice'), 'origin/fix/y unito in main (fast-forward).');
  assert.strictEqual(p.calls.loads, loads + 1, 'i branch si rileggono');
  assert.strictEqual(p.picker.isOpen(), true);
});

ok('selettore: merge annullato o rifiutato, il selettore lo dice', async () => {
  const cancelled = await openPicker({ onMerge: async () => ({ cancelled: true }) });
  fire(cancelled.merges()[0], 'click');
  await settle();
  assert.deepStrictEqual([cancelled.text('.git-picker-notice'), cancelled.text('.git-picker-error')], ['', '']);
  const conflict = 'Conflitti fra feat/x e main: il merge è stato annullato, la cartella è com\'era.\n\nFile in conflitto:\n  a.js';
  const refused = await openPicker({ onMerge: async () => ({ ok: false, conflict: true, error: conflict }) });
  fire(refused.merges()[0], 'click');
  await settle();
  assert.strictEqual(refused.text('.git-picker-error'), conflict);
  assert.strictEqual(refused.text('.git-picker-notice'), '');
  const thrown = await openPicker({ onMerge: async () => { throw new Error('ipc giù'); } });
  fire(thrown.merges()[0], 'click');
  await settle();
  assert.match(thrown.text('.git-picker-error'), /ipc giù/);
});

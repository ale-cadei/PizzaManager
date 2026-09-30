const assert = require('node:assert/strict');
const { test } = require('node:test');
const Groups = require('../renderer/session-groups');
const { arrange, pathOf, pathKey } = require('../renderer/resume-projects');

test('Resume raggruppa per radice git e mantiene le conversazioni del progetto insieme', async () => {
  const calls = [];
  const roots = { '/repo/src': '/repo', '/repo': '/repo', '/altro': '/altro' };
  const items = [
    { id: 'a', cwd: '/repo/src' }, { id: 'b', cwd: '/altro' }, { id: 'c', cwd: '/repo' },
    { id: 'd', cwd: '/repo/src' },
  ];
  const groups = await arrange(items, {
    source: 'codex', grouped: true, Groups,
    resolve: async (cwd) => { calls.push(cwd); return roots[cwd]; },
  });
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((s) => s.id)]), [
    ['/altro', ['b']], ['/repo', ['a', 'c', 'd']],
  ]);
  assert.deepEqual(calls.sort(), ['/altro', '/repo', '/repo/src'], 'ogni directory viene risolta una volta sola');
});

test('Resume da un gruppo filtra anche le conversazioni di sottocartelle e le ricerche', async () => {
  const roots = { '/repo/src': '/repo', '/repo': '/repo', '/repo-bis': '/repo-bis' };
  const items = [
    { id: 'a', source: 'claude', cwd: '/repo/src' },
    { id: 'b', source: 'codex', cwd: '/repo-bis' },
    { id: 'c', source: 'opencode', directory: '/repo' },
  ];
  const groups = await arrange(items, {
    filterRoot: '/repo', grouped: true, Groups, resolve: async (cwd) => roots[cwd],
  });
  assert.deepEqual(groups.map((g) => g.items.map((s) => s.id)), [['a', 'c']]);
  assert.equal(pathOf('opencode', items[2]), '/repo');
});

test('Resume distingue i percorsi vicini e confronta quelli Windows con separatori diversi', async () => {
  assert.notEqual(pathKey('/repo'), pathKey('/repo-bis'));
  assert.equal(pathKey('C:\\Users\\Jack\\Repo\\'), pathKey('c:/users/jack/repo'));
  assert.equal(pathKey('C:\\'), pathKey('c:/'));
  assert.equal(pathKey('\\\\Server\\Share\\Repo'), pathKey('//server/share/repo'));
  assert.equal(pathKey('/'), '/');
  const groups = await arrange([{ id: 'a', cwd: 'C:\\Users\\Jack\\Repo\\src' }], {
    source: 'history', filterRoot: 'c:/users/jack/repo', Groups,
    resolve: async () => 'C:\\Users\\Jack\\Repo',
  });
  assert.deepEqual(groups[0].items.map((s) => s.id), ['a']);
});

test('Resume senza filtro lascia la lista invariata e non risolve directory', async () => {
  const items = [{ id: 'a', cwd: '/repo' }];
  const groups = await arrange(items, { source: 'codex', Groups, resolve: () => { throw Error('inatteso'); } });
  assert.deepEqual(groups[0].items, items);
});

test('la casella del Resume trova il nome del progetto anche se non compare nei dati della chat', async () => {
  const items = [
    { id: 'a', title: 'Prima chat', cwd: '/collegamento/a' },
    { id: 'b', title: 'Seconda chat', cwd: '/collegamento/b' },
  ];
  const roots = { '/collegamento/a': '/lavoro/Caffè', '/collegamento/b': '/lavoro/Altro' };
  for (const grouped of [false, true]) {
    const result = await arrange(items, {
      source: 'codex', query: 'caffe', grouped, Groups,
      resolve: async (cwd) => roots[cwd],
    });
    assert.deepEqual(result.flatMap((g) => g.items).map((s) => s.id), ['a']);
  }
});

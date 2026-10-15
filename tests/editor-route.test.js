const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { editorTarget } = require('../renderer/editor-route');

/* Quale scheda editor apre un file del pannello modifiche (docs/plans/64). */

const ROOT = '/repo';
const ed = (id, cwd) => ({ id, type: 'editor', cwd });
const target = (tabs, file = 'lib/x.js', platform = 'linux') => editorTarget({ repoRoot: ROOT, file, tabs, platform });

ok('apri nell editor: una scheda sulla radice del repository si usa', () => {
  assert.deepStrictEqual(target([ed('a', ROOT)]), { tabId: 'a', rel: 'lib/x.js' });
});

ok('apri nell editor: una scheda su una sottocartella che contiene il file si usa, col percorso relativo a lei', () => {
  assert.deepStrictEqual(target([ed('a', `${ROOT}/lib/`)]), { tabId: 'a', rel: 'x.js' });
  assert.deepStrictEqual(target([ed('a', `${ROOT}/lib`)], 'lib/sub/y.js'), { tabId: 'a', rel: 'sub/y.js' });
});

ok('apri nell editor: una sottocartella che non contiene il file non vale, nemmeno con un nome che è un prefisso', () => {
  const tabs = [ed('a', `${ROOT}/docs`), ed('b', `${ROOT}/li`), ed('c', `${ROOT}/lib/x.js`), ed('d', '/altro')];
  assert.deepStrictEqual(target(tabs), { cwd: ROOT, rel: 'lib/x.js' });
});

ok('apri nell editor: senza schede se ne apre una sulla radice', () => {
  assert.deepStrictEqual(target([]), { cwd: ROOT, rel: 'lib/x.js' });
  assert.deepStrictEqual(editorTarget({ repoRoot: ROOT, file: 'a.md', platform: 'linux' }), { cwd: ROOT, rel: 'a.md' });
});

ok('apri nell editor: le schede non editor non contano, e fra due editor vince la prima nell ordine', () => {
  const tabs = [{ id: 's', type: 'shell', cwd: ROOT }, { id: 'g', type: 'git', cwd: ROOT }, ed('a', `${ROOT}/lib`), ed('b', ROOT)];
  assert.deepStrictEqual(target(tabs), { tabId: 'a', rel: 'x.js' });
  assert.deepStrictEqual(target([ed('b', ROOT), ed('a', `${ROOT}/lib`)]), { tabId: 'b', rel: 'lib/x.js' });
});

ok('apri nell editor: percorsi Windows, separatori misti e maiuscole diverse', () => {
  const root = path.win32.join('C:\\', 'Users', 'ale', 'repo');
  const tab = ed('a', path.win32.join('c:\\', 'users', 'ALE', 'repo', 'src'));
  assert.deepStrictEqual(editorTarget({ repoRoot: root, file: 'src/App.js', tabs: [tab], platform: 'win32' }), { tabId: 'a', rel: 'App.js' });
  assert.deepStrictEqual(editorTarget({ repoRoot: 'C:/Users/ale/repo', file: 'src/App.js', tabs: [ed('b', root)], platform: 'win32' }),
    { tabId: 'b', rel: 'src/App.js' });
  // Fuori da Windows le maiuscole contano: stessa cartella scritta diversa, scheda nuova
  assert.deepStrictEqual(editorTarget({ repoRoot: root, file: 'src/App.js', tabs: [tab], platform: 'linux' }), { cwd: root, rel: 'src/App.js' });
});

ok('apri nell editor: radice o percorso non validi danno null', () => {
  for (const bad of [{ repoRoot: '', file: 'a.js' }, { repoRoot: null, file: 'a.js' }, { repoRoot: ROOT, file: '' },
    { repoRoot: ROOT, file: '../fuori.js' }, { repoRoot: ROOT, file: 'a/../../b.js' }, { repoRoot: ROOT, file: 7 }]) {
    assert.strictEqual(editorTarget({ ...bad, tabs: [ed('a', ROOT)], platform: 'linux' }), null, JSON.stringify(bad));
  }
});

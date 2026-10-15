const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage } = require('./renderer-page');

/* Il bottone «Apri nell'editor» del pannello modifiche (docs/plans/64,
   renderer/changes-panel.js): la pagina vera, con setActive, createTab e
   openEditorAt sostituiti da registratori. */

function panelSetup({ result = { ok: true, root: '/repo', files: [] }, merge = null, tabs = [] } = {}) {
  const page = loadPage();
  const run = (code) => vm.runInContext(code, page.ctx);
  const calls = [];
  page.ctx.setActive = (id) => { calls.push(['setActive', id]); };
  page.ctx.createTab = async (type, opts) => {
    calls.push(['createTab', type, { ...opts }]);
    const tab = { id: 'tab-nuova', type, cwd: opts.cwd };
    run('tabs').set(tab.id, tab);
    return tab;
  };
  page.ctx.openEditorAt = async (tab, rel) => { calls.push(['openEditorAt', tab.id, rel]); return true; };
  for (const t of tabs) run('tabs').set(t.id, t);
  page.ctx.panelPatch = { result, merge };
  run('changesState = { ...changesState, ...panelPatch }');
  return { calls, open: (p) => run('openChangedFile')(p) };
}

ok('apri nell editor dal pannello: una scheda editor che contiene il file si riusa', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/lib' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-ed'], ['openEditorAt', 'tab-ed', 'x.js']]);
});

ok('apri nell editor dal pannello: senza una scheda adatta se ne crea una sulla radice', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/docs' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['createTab', 'editor', { cwd: '/repo' }], ['openEditorAt', 'tab-nuova', 'lib/x.js']]);
});

ok('apri nell editor dal pannello: in modalità Unisci, senza lettura o senza radice non fa niente', async () => {
  for (const opts of [{ merge: { kind: 'worktree' } }, { result: null }, { result: { ok: false, error: 'x' } }, { result: { ok: true, files: [] } }]) {
    const s = panelSetup({ ...opts, tabs: [{ id: 'tab-ed', type: 'editor', cwd: '/repo' }] });
    await s.open('a.js');
    assert.deepStrictEqual(s.calls, [], JSON.stringify(opts));
  }
});

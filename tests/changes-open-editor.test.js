const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage } = require('./renderer-page');

/* Il bottone «Apri nell'editor» del pannello modifiche (docs/plans/64,
   renderer/changes-panel.js): la pagina vera, con setActive, createTab e
   openEditorAt sostituiti da registratori. */

function panelSetup({ result = { ok: true, root: '/repo', files: [] }, merge = null, tabs = [], active = null, open = true } = {}) {
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
  page.ctx.toggleChangesPanel = (force) => { calls.push(['toggleChangesPanel', force]); };
  for (const t of tabs) run('tabs').set(t.id, t);
  page.ctx.panelActive = active;
  run('activeId = panelActive');
  page.ctx.panelPatch = { result, merge, open };
  run('changesState = { ...changesState, ...panelPatch }');
  return { calls, open: (p) => run('openChangedFile')(p) };
}

ok('apri nell editor dal pannello: una scheda editor che contiene il file si riusa', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/lib' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-ed'], ['toggleChangesPanel', false], ['openEditorAt', 'tab-ed', 'x.js']]);
});

ok('apri nell editor dal pannello: senza una scheda adatta se ne crea una sulla radice', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/docs' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['createTab', 'editor', { cwd: '/repo' }], ['toggleChangesPanel', false], ['openEditorAt', 'tab-nuova', 'lib/x.js']]);
});

ok('apri nell editor dal pannello: in modalità Unisci, senza lettura o senza radice non fa niente', async () => {
  for (const opts of [{ merge: { kind: 'worktree' } }, { result: null }, { result: { ok: false, error: 'x' } }, { result: { ok: true, files: [] } }]) {
    const s = panelSetup({ ...opts, tabs: [{ id: 'tab-ed', type: 'editor', cwd: '/repo' }] });
    await s.open('a.js');
    assert.deepStrictEqual(s.calls, [], JSON.stringify(opts));
  }
});

ok('apri nell editor dal pannello: la scheda editor attiva che contiene il file vince su una prima nell ordine', async () => {
  const s = panelSetup({ active: 'tab-sub', tabs: [{ id: 'tab-root', type: 'editor', cwd: '/repo' }, { id: 'tab-sub', type: 'editor', cwd: '/repo/lib' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-sub'], ['toggleChangesPanel', false], ['openEditorAt', 'tab-sub', 'x.js']]);
});

ok('apri nell editor dal pannello: il pannello si chiude prima di aprire il file, e uno già chiuso non si tocca', async () => {
  const tabs = [{ id: 'tab-ed', type: 'editor', cwd: '/repo' }];
  const s = panelSetup({ tabs });
  await s.open('a.js');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-ed'], ['toggleChangesPanel', false], ['openEditorAt', 'tab-ed', 'a.js']]);
  const closed = panelSetup({ tabs, open: false });
  await closed.open('a.js');
  assert.deepStrictEqual(closed.calls, [['setActive', 'tab-ed'], ['openEditorAt', 'tab-ed', 'a.js']]);
});

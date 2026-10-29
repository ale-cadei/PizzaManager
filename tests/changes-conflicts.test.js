const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage } = require('./renderer-page');

/* Modalità «Conflitti» del pannello (docs/plans/69, renderer/changes-conflicts.js):
   la pagina vera, con setActive/createTab/openEditorAt/toggleChangesPanel/
   refreshChanges/refreshGitTab sostituiti da registratori, e gitOpContinue/
   gitOpAbort/gitConflictResolve finti. */

const WHAT = { into: 'main', incoming: 'feat/x', step: null, total: null, commit: 'abc1234', subject: null };
const conflicts = (files = []) => ({ ok: true, root: '/r', op: 'merge', what: WHAT, files, resolved: [] });

function conflictsSetup({ conflicts: c = conflicts(), tabs = [], active = null, writing = false, target } = {}) {
  const calls = [];
  const page = loadPage({
    aisess: {
      gitOpContinue: async (...a) => { calls.push(['gitOpContinue', ...a]); return { ok: true, done: true }; },
      gitOpAbort: async (...a) => { calls.push(['gitOpAbort', ...a]); return { ok: true }; },
      gitConflictResolve: async (...a) => { calls.push(['gitConflictResolve', ...a]); return { ok: true }; },
    },
  });
  const run = (code) => vm.runInContext(code, page.ctx);
  page.ctx.setActive = (id) => { calls.push(['setActive', id]); };
  page.ctx.createTab = async (type, opts) => {
    calls.push(['createTab', type, { ...opts }]);
    const tab = { id: 'tab-nuova', type, cwd: opts.cwd };
    run('tabs').set(tab.id, tab);
    return tab;
  };
  page.ctx.openEditorAt = async (tab, rel) => { calls.push(['openEditorAt', tab.id, rel]); return true; };
  page.ctx.toggleChangesPanel = (force) => { calls.push(['toggleChangesPanel', force]); };
  page.ctx.refreshChanges = async () => { calls.push(['refreshChanges']); };
  page.ctx.refreshGitTab = async () => { calls.push(['refreshGitTab']); };
  for (const t of tabs) run('tabs').set(t.id, t);
  page.ctx.setupActive = active;
  run('activeId = setupActive');
  run('closeConfirm').ask = (o) => { calls.push(['ask', o.title]); return page.ctx.askImpl(o); };
  page.ctx.askImpl = async () => true;
  page.ctx.setupPatch = { open: true, conflicts: c, writing, target: target || { key: '/r\0merge', cwd: '/r', root: '/r' } };
  run('changesState = { ...changesState, ...setupPatch }');
  return {
    calls, run,
    setAsk: (fn) => { page.ctx.askImpl = fn; },
    setAisess: (name, fn) => { run('window').aisess[name] = fn; },
    // handleConflict non restituisce la promessa (sbaglia apposta, l'errore lo
    // inghiotte lui): per aspettare la scrittura davvero si chiama la
    // funzione sotto, runConflictAction, direttamente.
    handle: (a) => run('runConflictAction')(a),
    open: (root) => run('openConflictsFor')(root),
  };
}

ok('conflitti - annulla: il fumetto non è modale, si ricontrolla dopo la conferma', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a' });
  // Mentre il fumetto è aperto parte un'altra scrittura nello stesso pannello
  s.setAsk(async () => { s.run('changesState').writing = true; return true; });
  await s.handle({ how: 'abort', anchor: {} });
  assert.ok(!s.calls.some((c) => c[0] === 'gitOpAbort'), JSON.stringify(s.calls));
  assert.strictEqual(s.run('changesState').conflictOutcome.ok, false);
});

ok('conflitti - annulla: ricontrolla anche se il bersaglio è cambiato durante il fumetto', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a' });
  s.setAsk(async () => { s.run('changesState').target = { key: 'altro', cwd: '/altro', root: '/altro' }; return true; });
  await s.handle({ how: 'abort', anchor: {} });
  assert.ok(!s.calls.some((c) => c[0] === 'gitOpAbort'), JSON.stringify(s.calls));
});

ok('conflitti - annulla: senza il fumetto va regolarmente', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a' });
  await s.handle({ how: 'abort', anchor: {} });
  assert.ok(s.calls.some((c) => c[0] === 'gitOpAbort'), JSON.stringify(s.calls));
});

ok('conflitti: un\'azione è rifiutata se c\'è già una scrittura in corso', async () => {
  const s = conflictsSetup({
    conflicts: conflicts([{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }]),
    tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a', writing: true,
  });
  await s.handle({ how: 'mark', path: 'a.js' });
  assert.ok(!s.calls.some((c) => c[0] === 'gitConflictResolve'), JSON.stringify(s.calls));
});

ok('conflitti: bersaglio cambiato durante la scrittura, niente esito sulla scheda sbagliata', async () => {
  const s = conflictsSetup({
    conflicts: conflicts([{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }]),
    tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a',
  });
  s.setAisess('gitConflictResolve', async () => {
    s.run('changesState').target = { key: 'altro', cwd: '/altro', root: '/altro' };
    return { ok: true };
  });
  await s.handle({ how: 'mark', path: 'a.js' });
  assert.strictEqual(s.run('changesState').conflictOutcome, null);
});

ok('conflitti: un errore IPC si mostra come esito', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a' });
  s.setAisess('gitOpContinue', async () => { throw new Error('boom'); });
  await s.handle({ how: 'continue', anchor: {} });
  // L'oggetto vive nel contesto vm: lo si confronta per valore, non per prototipo
  const outcome = JSON.parse(JSON.stringify(s.run('changesState').conflictOutcome));
  assert.deepStrictEqual(outcome, { ok: false, text: 'boom' });
});

ok('risolvi da Unisci: la scheda attiva dentro la radice si riusa', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r/lib' }], active: 'tab-a' });
  await s.open('/r');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-a'], ['toggleChangesPanel', true]]);
});

ok('risolvi da Unisci: senza una attiva dentro la radice, la prima scheda editor', async () => {
  const s = conflictsSetup({
    tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/altrove' }, { id: 'tab-ed', type: 'editor', cwd: '/r/lib' }],
    active: 'tab-sh',
  });
  await s.open('/r');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-ed'], ['toggleChangesPanel', true]]);
});

ok('risolvi da Unisci: nessuna scheda dentro la radice, se ne crea una nuova', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-ed', type: 'editor', cwd: '/altrove' }], active: 'tab-ed' });
  await s.open('/r');
  assert.deepStrictEqual(s.calls, [['createTab', 'editor', { cwd: '/r' }], ['toggleChangesPanel', true]]);
});

ok('risolvi da Unisci: senza una radice valida non fa niente', async () => {
  const s = conflictsSetup({ tabs: [{ id: 'tab-ed', type: 'editor', cwd: '/r' }], active: 'tab-ed' });
  await s.open('');
  await s.open(null);
  assert.deepStrictEqual(s.calls, []);
});

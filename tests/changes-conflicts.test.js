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
  page.ctx.openEditorConflict = async (tab, rel, sides) => { calls.push(['openEditorConflict', tab.id, rel, sides]); return true; };
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
    openFile: (path) => run('openConflictFile')(path),
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

/* Apri nell'editor con gli stessi nomi del pannello (fix round finale,
   docs/plans/69): in un rebase "nostro" e "loro" si invertono rispetto a un
   merge, e la barra dell'editor deve dire la stessa cosa del pannello, non
   "nostro/loro" fissi. */
ok('apri nell\'editor: passa a openEditorConflict gli stessi sides del pannello (rebase)', async () => {
  const what = {
    into: 'main', incoming: 'feat/x', step: 2, total: 3, commit: 'abc1234', subject: 'fix: qualcosa',
  };
  const rebaseConflicts = {
    ok: true, root: '/r', op: 'rebase', what, files: [{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }], resolved: [],
  };
  const s = conflictsSetup({ conflicts: rebaseConflicts, tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a' });
  await s.openFile('a.js');
  const call = s.calls.find((c) => c[0] === 'openEditorConflict');
  assert.ok(call, JSON.stringify(s.calls));
  const sides = JSON.parse(JSON.stringify(call[3]));
  // Stesso calcolo del pannello: ConflictsModel.sides(c), non ripetuto a mano
  const modelSides = JSON.parse(JSON.stringify(s.run('AisessConflictsModel.sides')(rebaseConflicts)));
  assert.deepStrictEqual(sides, modelSides);
  assert.deepStrictEqual(sides, { ours: 'main', theirs: 'abc1234 di feat/x' });
});

/* Un'azione sul file si ricontrolla al clic come continua e annulla: fra il
   disegno e il clic una sessione può aver rimesso il blocco (scrittura
   partita altrove, fix round finale, docs/plans/69) */
ok('conflitti: un\'azione sul file si rifiuta se nel frattempo si è spenta', async () => {
  const s = conflictsSetup({
    conflicts: conflicts([{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }]),
    tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a',
  });
  // "mark" esiste nelle azioni di un file both-modified non binario: lo si
  // chiama su un file che non è fra quelli in conflitto, quindi l'azione non
  // si trova più fra le sue azioni → rifiutato prima di scrivere
  await s.handle({ how: 'mark', path: 'sparito.js' });
  assert.ok(!s.calls.some((c) => c[0] === 'gitConflictResolve'), JSON.stringify(s.calls));
});

ok('conflitti: un\'azione sul file va se è ancora fra le sue azioni valide', async () => {
  const s = conflictsSetup({
    conflicts: conflicts([{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }]),
    tabs: [{ id: 'tab-a', type: 'editor', cwd: '/r' }], active: 'tab-a',
  });
  await s.handle({ how: 'mark', path: 'a.js' });
  assert.ok(s.calls.some((c) => c[0] === 'gitConflictResolve'), JSON.stringify(s.calls));
});

/* readConflictsOf non deve più confondere un errore transitorio (es.
   index.lock di un'altra scrittura) con "niente conflitti": altrimenti il
   pannello cade in staging, che fallisce allo stesso modo, in un giro di
   BUSY circolare (fix round finale, docs/plans/69) */
ok('readConflictsOf: un errore IPC non si inghiotte, torna ok:false con l\'errore', async () => {
  const page = loadPage({
    aisess: { gitConflicts: async () => ({ ok: false, error: 'index.lock' }) },
  });
  const run = (code) => vm.runInContext(code, page.ctx);
  run('changesState = { ...changesState, open: true, merge: null }');
  const res = await run('readConflictsOf')({ cwd: '/r' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), { ok: false, error: 'index.lock' });
});

ok('readConflictsOf: un\'eccezione non si inghiotte, torna ok:false col messaggio', async () => {
  const page = loadPage({
    aisess: { gitConflicts: async () => { throw new Error('ipc giù'); } },
  });
  const run = (code) => vm.runInContext(code, page.ctx);
  run('changesState = { ...changesState, open: true, merge: null }');
  const res = await run('readConflictsOf')({ cwd: '/r' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), { ok: false, error: 'ipc giù' });
});

/* refreshChanges (changes-panel.js) con un readConflictsOf che fallisce per un
   motivo transitorio: non deve buttare lo stato dei conflitti che c'era né
   proseguire sul percorso di staging (che allo stesso giro, con lo stesso
   index.lock, fallirebbe uguale: il giro di BUSY circolare che c'era prima,
   fix round finale, docs/plans/69). */
ok('refreshChanges: un errore di lettura dei conflitti tiene lo stato e non cade in staging', async () => {
  const target = { key: '/r\0merge', cwd: '/r', root: '/r' };
  const prevConflicts = conflicts([{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }]);
  let gitConflictsCalls = 0;
  const page = loadPage({
    aisess: {
      gitConflicts: async () => {
        gitConflictsCalls += 1;
        return gitConflictsCalls === 1 ? prevConflicts : { ok: false, error: 'index.lock' };
      },
      gitStaging: async () => { throw new Error('non deve arrivare qui: resterebbe un giro di BUSY'); },
      gitChanges: async () => { throw new Error('non deve arrivare qui: resterebbe un giro di BUSY'); },
    },
  });
  const run = (code) => vm.runInContext(code, page.ctx);
  page.ctx.activeChangesTarget = () => target;
  run('changesState = { ...changesState, open: true }');
  await run('refreshChanges')(); // prima lettura, buona: i conflitti entrano nello stato
  assert.strictEqual(gitConflictsCalls, 1);
  assert.ok(run('changesState').conflicts, 'i conflitti dovevano essere entrati nello stato');
  await run('refreshChanges')(); // seconda lettura, fallita: l'index.lock di un'altra scrittura
  assert.strictEqual(gitConflictsCalls, 2);
  const state = JSON.parse(JSON.stringify(run('changesState')));
  assert.deepStrictEqual(state.conflicts, JSON.parse(JSON.stringify(prevConflicts)), 'i conflitti di prima restano');
  assert.deepStrictEqual(state.conflictOutcome, { ok: false, text: 'index.lock' });
});

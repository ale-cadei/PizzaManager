// lib/editor-remote-watch.js: polling degli mtime sul server (docs/plans/94)
const assert = require('node:assert');
const { test } = require('node:test');
const { createEditorRemoteWatch } = require('../lib/editor-remote-watch');

function fakeFiles(mtimes) {
  const calls = [];
  return {
    calls,
    mtimes,
    stat: async (rel) => ({ ok: true, exists: mtimes[rel] != null, mtime: mtimes[rel] ?? null }),
    statMany: async (rels) => { calls.push(rels); return { ok: true, mtimes: Object.fromEntries(rels.map((r) => [r, mtimes[r] ?? null])) }; },
  };
}

function fakeTimers() {
  const t = { active: 0, setInterval: () => { t.active += 1; return { unref() {} }; }, clearInterval: () => { t.active -= 1; } };
  return t;
}

test('remote-watch: avvisa solo per i file cambiati, un giro per server', async () => {
  const events = [];
  const timers = fakeTimers();
  const w = createEditorRemoteWatch({ onChange: (c) => events.push(c), timers });
  const nas = fakeFiles({ a: 1, b: 2 });
  const pi = fakeFiles({ a: 5 });
  await w.watch('ssh:nas:/r/a', nas, 'a');
  await w.watch('ssh:nas:/r/b', nas, 'b');
  await w.watch('ssh:pi:/r/a', pi, 'a');
  assert.strictEqual(timers.active, 1, 'un solo timer');

  await w.poll();
  assert.deepStrictEqual(events, [], 'niente cambiato');
  nas.mtimes.a = 10;
  delete pi.mtimes.a;
  await w.poll();
  assert.deepStrictEqual(events, [
    { path: 'ssh:nas:/r/a', exists: true, mtime: 10 },
    { path: 'ssh:pi:/r/a', exists: false, mtime: null },
  ]);
  assert.deepStrictEqual(nas.calls.at(-1), ['a', 'b']);
  assert.deepStrictEqual(pi.calls.at(-1), ['a']);
  await w.poll();
  assert.strictEqual(events.length, 2, 'lo stesso cambio non si ripete');
});

test('remote-watch: conta le watch, ferma il timer senza file, ignora i giri falliti', async () => {
  const events = [];
  const timers = fakeTimers();
  const w = createEditorRemoteWatch({ onChange: (c) => events.push(c), timers });
  const files = fakeFiles({ a: 1 });
  await w.watch('k', files, 'a');
  await w.watch('k', files, 'a');
  w.unwatch('k');
  assert.strictEqual(w.size, 1);
  files.statMany = async () => ({ ok: false, error: 'Server non raggiungibile' });
  files.mtimes.a = 2;
  await w.poll();
  assert.deepStrictEqual(events, []);
  w.unwatch('k');
  assert.strictEqual(w.size, 0);
  assert.strictEqual(timers.active, 0);
});

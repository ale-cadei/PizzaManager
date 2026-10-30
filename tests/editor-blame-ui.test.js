const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, deferred, setup, plain } = require('./editor-tab-setup');

/* Chi ha toccato la riga del cursore nella scheda editor (docs/plans/73):
   il main risponde finto, la scheda aspetta che il cursore si fermi e passa
   l'etichetta all'host. */
const FILES = { 'a.js': { text: 'uno\ndue\n', mtime: 1 } };
const BLAME = { hash: 'abcdef1234', uncommitted: false, author: 'Ale', mail: 'a@x', time: 1, summary: 'primo' };

function blameSetup(main) {
  const s = setup({ files: FILES, main });
  const timers = [];
  s.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  s.page.ctx.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const flush = async () => {
    timers.filter((t) => !t.cleared && !t.done).forEach((t) => { t.done = true; t.fn(); });
    await settle();
  };
  return { ...s, timers, flush };
}

ok('blame ui: quando il cursore si ferma chiede al main la riga col testo dell editor e la mostra', async () => {
  const s = blameSetup({ editorBlameLine: async () => ({ ok: true, blame: BLAME }) });
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 2);
  assert.deepStrictEqual(s.sent('editorBlameLine'), [], 'si aspetta che il cursore si fermi');
  assert.strictEqual(s.timers[0].ms, s.run('EDITOR_BLAME_DELAY'));
  await s.flush();
  assert.deepStrictEqual(plain(s.sent('editorBlameLine')), [['editorBlameLine', '/w', 'a.js', 2, 'uno\ndue\n']]);
  const [[rel, line, info]] = s.host.lineInfos;
  assert.deepStrictEqual([rel, line], ['a.js', 2]);
  assert.match(info.text, /^Ale, .* · primo$/);
});

ok('blame ui: solo l ultima riga dove il cursore si è fermato', async () => {
  const s = blameSetup({ editorBlameLine: async () => ({ ok: true, blame: BLAME }) });
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 1);
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 2);
  await s.flush();
  assert.deepStrictEqual(s.sent('editorBlameLine').map((c) => c[3]), [2]);
});

ok('blame ui: risposta superata, testo cambiato o file non più attivo → si scarta', async () => {
  const slow = deferred();
  let n = 0;
  const s = blameSetup({ editorBlameLine: () => (++n === 1 ? slow.promise : Promise.resolve({ ok: true, blame: BLAME })) });
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 1);
  await s.flush();
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 2);
  await s.flush();
  slow.resolve({ ok: true, blame: BLAME });
  await settle();
  assert.deepStrictEqual(s.host.lineInfos.map((x) => x[1]), [2]);

  const t = blameSetup({ editorBlameLine: async () => { t.host.texts['a.js'] = 'cambiato'; return { ok: true, blame: BLAME }; } });
  t.fn('scheduleEditorBlame')(t.tab, 'a.js', 1);
  await t.flush();
  assert.deepStrictEqual(t.host.lineInfos, []);

  const u = blameSetup({ editorBlameLine: async () => ({ ok: true, blame: BLAME }) });
  u.fn('scheduleEditorBlame')(u.tab, 'altro.js', 1);
  await u.flush();
  assert.deepStrictEqual(u.sent('editorBlameLine'), []);
});

ok('blame ui: fuori da git, ignorato, errore → niente testo; l errore in console una volta', async () => {
  for (const reason of ['not-repo', 'ignored', 'no-git', 'no-line']) {
    const s = blameSetup({ editorBlameLine: async () => ({ ok: false, reason }) });
    s.fn('scheduleEditorBlame')(s.tab, 'a.js', 1);
    await s.flush();
    assert.deepStrictEqual(s.host.lineInfos, [], reason);
  }
  const warned = [];
  const s = blameSetup({ editorBlameLine: async () => { throw new Error('ipc giù'); } });
  s.page.ctx.console = { ...console, warn: (...a) => warned.push(a.join(' ')) };
  for (const line of [1, 2]) {
    s.fn('scheduleEditorBlame')(s.tab, 'a.js', line);
    await s.flush();
  }
  assert.deepStrictEqual(s.host.lineInfos, []);
  assert.strictEqual(warned.filter((w) => /ipc giù/.test(w)).length, 1);
});

ok('blame ui: chiudere la scheda ferma l attesa', async () => {
  const s = blameSetup({ editorBlameLine: async () => ({ ok: true, blame: BLAME }) });
  s.fn('scheduleEditorBlame')(s.tab, 'a.js', 1);
  s.fn('disposeEditorTab')(s.tab);
  assert.strictEqual(s.timers[0].cleared, true);
});

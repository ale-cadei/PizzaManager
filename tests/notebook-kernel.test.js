const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { registerKernelHandlers, MAX_CODE } = require('../app/notebook-kernel');

/* app/notebook-kernel.js non chiede Electron: ipcMain e il ponte sono finti. */
function setup(t, { python = '/usr/bin/python3' } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-kernel-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bridges = [];
  const kernels = registerKernelHandlers(ipcMain, {
    findPython: () => python,
    env: () => ({ PATH: '/bin' }),
    scriptPath: '/app.asar.unpacked/app/kernel-bridge.py',
    createBridge: (opts) => {
      const bridge = { opts, sent: [], closed: 0, send(c) { this.sent.push(c); }, close() { this.closed += 1; } };
      bridges.push(bridge);
      return bridge;
    },
  });
  const makeSender = (id) => Object.assign(new EventEmitter(), {
    id, sent: [], destroyed: false, isDestroyed() { return this.destroyed; }, send(ch, v) { this.sent.push([ch, v]); },
  });
  const sender = makeSender(1);
  const call = (channel, payload, from = sender) => handlers.get(channel)({ sender: from }, payload);
  return { handlers, call, dir, bridges, sender, makeSender, kernels };
}

ok('ipc kernel: ogni canale kernel del preload ha il suo handler, e c è onKernelEvent', (t) => {
  const { handlers } = setup(t);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('(kernel-[a-z-]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(invoked.sort(), ['kernel-execute', 'kernel-interrupt', 'kernel-restart', 'kernel-shutdown', 'kernel-start']);
  for (const channel of invoked) assert.ok(handlers.has(channel), `${channel} senza handler`);
  assert.ok(/ipcRenderer\.on\('kernel-event'/.test(preload), 'manca onKernelEvent nel preload');
});

ok('ipc kernel: main.js registra gli handler e li spegne uscendo; lo script è in asarUnpack', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/registerKernelHandlers\(ipcMain, \{ app \}\)/.test(main), 'main.js non registra gli handler del kernel con app');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.asarUnpack.includes('app/kernel-bridge.py'), 'il ponte deve stare fuori da app.asar');
});

ok('ipc kernel: start avvia il ponte nella cartella e gli manda start', async (t) => {
  const { call, dir, bridges } = setup(t);
  const r = await call('kernel-start', { dir, kernel: 'python3' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(typeof r.id, 'string');
  assert.strictEqual(bridges.length, 1);
  const { opts } = bridges[0];
  assert.strictEqual(opts.python, '/usr/bin/python3');
  assert.strictEqual(opts.script, '/app.asar.unpacked/app/kernel-bridge.py');
  assert.strictEqual(opts.cwd, dir);
  assert.deepStrictEqual(opts.env, { PATH: '/bin' });
  assert.deepStrictEqual(bridges[0].sent, [{ cmd: 'start', kernel: 'python3', cwd: dir }]);
});

ok('ipc kernel: senza Python → missing python, nessun ponte', async (t) => {
  const { call, dir, bridges } = setup(t, { python: null });
  const r = await call('kernel-start', { dir, kernel: 'python3' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.missing, 'python');
  assert.ok(r.error);
  assert.strictEqual(bridges.length, 0);
});

ok('ipc kernel: start rifiuta cartelle e nomi strani', async (t) => {
  const { call, dir, bridges } = setup(t);
  fs.writeFileSync(path.join(dir, 'f'), '');
  const bad = [
    undefined, null, {}, { dir: 'relativa', kernel: 'python3' }, { dir: '/non/esiste/proprio', kernel: 'python3' },
    { dir: path.join(dir, 'f'), kernel: 'python3' }, { dir, kernel: '../x' }, { dir, kernel: 'a b' },
    { dir, kernel: 'x'.repeat(100) }, { dir, kernel: 3 },
  ];
  for (const payload of bad) {
    const r = await call('kernel-start', payload);
    assert.strictEqual(r.ok, false, JSON.stringify(payload));
    assert.ok(r.error);
  }
  assert.strictEqual(bridges.length, 0);
});

ok('ipc kernel: execute, interrupt, restart arrivano al ponte giusto', async (t) => {
  const { call, dir, bridges } = setup(t);
  const a = await call('kernel-start', { dir, kernel: 'python3' });
  const b = await call('kernel-start', { dir, kernel: 'python3' });
  assert.notStrictEqual(a.id, b.id);
  assert.deepStrictEqual(await call('kernel-execute', { id: b.id, run: 'r-1', code: 'print(1)' }), { ok: true });
  assert.deepStrictEqual(await call('kernel-interrupt', { id: b.id }), { ok: true });
  assert.deepStrictEqual(await call('kernel-restart', { id: b.id }), { ok: true });
  assert.deepStrictEqual(bridges[1].sent.slice(1), [
    { cmd: 'execute', run: 'r-1', code: 'print(1)' }, { cmd: 'interrupt' }, { cmd: 'restart' },
  ]);
  assert.strictEqual(bridges[0].sent.length, 1);
});

ok('ipc kernel: execute rifiuta codice troppo lungo, run strani, id ignoti', async (t) => {
  const { call, dir, bridges } = setup(t);
  const { id } = await call('kernel-start', { dir, kernel: 'python3' });
  const bad = [
    undefined, {}, { id: 'k999', run: 'r', code: '1' }, { id, run: 'r', code: 3 }, { id, run: 'a b', code: '1' },
    { id, run: 'r', code: 'x'.repeat(MAX_CODE + 1) }, { id, code: '1' },
  ];
  for (const payload of bad) {
    const r = await call('kernel-execute', payload);
    assert.strictEqual(r.ok, false, JSON.stringify(payload && { ...payload, code: String(payload.code).slice(0, 10) }));
  }
  assert.strictEqual(bridges[0].sent.length, 1);
});

ok('ipc kernel: un altro webContents non tocca il kernel che non è suo', async (t) => {
  const { call, dir, bridges, makeSender } = setup(t);
  const { id } = await call('kernel-start', { dir, kernel: 'python3' });
  const other = makeSender(2);
  for (const ch of ['kernel-execute', 'kernel-interrupt', 'kernel-restart', 'kernel-shutdown']) {
    const r = await call(ch, { id, run: 'r', code: '1' }, other);
    assert.strictEqual(r.ok, false, ch);
  }
  assert.strictEqual(bridges[0].sent.length, 1);
  assert.strictEqual(bridges[0].closed, 0);
});

ok('ipc kernel: gli eventi del ponte vanno a chi l ha avviato, con il suo id; exit lo dimentica', async (t) => {
  const { call, dir, bridges, sender } = setup(t);
  const { id } = await call('kernel-start', { dir, kernel: 'python3' });
  bridges[0].opts.onEvent({ ev: 'ready', language: 'python' });
  bridges[0].opts.onEvent({ ev: 'exit', code: 1, stderr: 'boom' });
  assert.deepStrictEqual(sender.sent, [
    ['kernel-event', { id, ev: 'ready', language: 'python' }],
    ['kernel-event', { id, ev: 'exit', code: 1, stderr: 'boom' }],
  ]);
  const r = await call('kernel-execute', { id, run: 'r', code: '1' });
  assert.strictEqual(r.ok, false);
});

ok('ipc kernel: eventi verso una finestra chiusa non si mandano', async (t) => {
  const { call, dir, bridges, sender } = setup(t);
  await call('kernel-start', { dir, kernel: 'python3' });
  sender.destroyed = true;
  assert.doesNotThrow(() => bridges[0].opts.onEvent({ ev: 'ready' }));
  assert.strictEqual(sender.sent.length, 0);
});

ok('ipc kernel: shutdown chiude il ponte una volta', async (t) => {
  const { call, dir, bridges } = setup(t);
  const { id } = await call('kernel-start', { dir, kernel: 'python3' });
  assert.deepStrictEqual(await call('kernel-shutdown', { id }), { ok: true });
  assert.strictEqual(bridges[0].closed, 1);
  assert.strictEqual((await call('kernel-shutdown', { id })).ok, false);
  assert.strictEqual(bridges[0].closed, 1);
});

ok('ipc kernel: ricarica o chiusura della finestra spengono i suoi kernel, non gli altri', async (t) => {
  const { call, dir, bridges, sender, makeSender } = setup(t);
  const other = makeSender(2);
  await call('kernel-start', { dir, kernel: 'python3' });
  await call('kernel-start', { dir, kernel: 'python3' });
  await call('kernel-start', { dir, kernel: 'python3' }, other);
  sender.emit('did-start-loading');
  assert.deepStrictEqual(bridges.map((b) => b.closed), [1, 1, 0]);
  // un solo listener per webContents, tolto dopo: niente accumulo a ogni ricarica
  assert.strictEqual(sender.listenerCount('destroyed'), 0);
  await call('kernel-start', { dir, kernel: 'python3' });
  other.emit('destroyed');
  assert.deepStrictEqual(bridges.map((b) => b.closed), [1, 1, 1, 0]);
});

ok('ipc kernel: shutdownAll spegne tutto', async (t) => {
  const { call, dir, bridges, kernels, makeSender } = setup(t);
  await call('kernel-start', { dir, kernel: 'python3' });
  await call('kernel-start', { dir, kernel: 'python3' }, makeSender(2));
  kernels.shutdownAll();
  assert.deepStrictEqual(bridges.map((b) => b.closed), [1, 1]);
});

ok('ipc kernel: con app i kernel si spengono a will-quit', async (t) => {
  const handlers = new Map();
  const app = new EventEmitter();
  const bridges = [];
  registerKernelHandlers({ handle: (c, fn) => handlers.set(c, fn) }, {
    app, findPython: () => '/usr/bin/python3', env: () => ({}), scriptPath: '/x.py',
    createBridge: (opts) => { const b = { opts, closed: 0, send() {}, close() { this.closed += 1; } }; bridges.push(b); return b; },
  });
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-kernel-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send() {} });
  await handlers.get('kernel-start')({ sender }, { dir, kernel: 'python3' });
  app.emit('will-quit');
  assert.deepStrictEqual(bridges.map((b) => b.closed), [1]);
});

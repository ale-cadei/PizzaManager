const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorWatch } = require('../lib/editor-watch');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* fs.watch finto: gli eventi li decide il test. Come quello vero lancia se
   il file non c'è. */
function fakeWatch() {
  const watchers = [];
  const watchFn = (p, listener) => {
    if (!fs.existsSync(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const w = new EventEmitter();
    w.path = p;
    w.closed = false;
    w.close = () => { w.closed = true; };
    w.on('change', listener);
    watchers.push(w);
    return w;
  };
  const live = (p) => watchers.filter((w) => w.path === p && !w.closed);
  const fire = (p) => live(p).forEach((w) => w.emit('change', 'change', path.basename(p)));
  return { watchers, watchFn, live, fire };
}

function tmpFile(t, content = 'x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-watch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'a.txt');
  fs.writeFileSync(p, content);
  return p;
}

ok('watch: più eventi ravvicinati diventano una notifica, col mtime del disco', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 20, watchFn: fake.watchFn });
  assert.strictEqual(w.watch(p), true);
  fake.fire(p); fake.fire(p); fake.fire(p);
  await sleep(80);
  assert.deepStrictEqual(seen, [{ path: p, exists: true, mtime: fs.statSync(p).mtimeMs }]);
  w.close();
});

ok('watch: dopo un evento si riarma (un rename sostituisce l\'inode)', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const w = createEditorWatch({ onChange: () => {}, debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fake.fire(p);
  await sleep(50);
  assert.strictEqual(fake.watchers.length, 2);
  assert.strictEqual(fake.watchers[0].closed, true);
  assert.strictEqual(fake.live(p).length, 1);
  w.close();
});

ok('watch: un file cancellato si notifica con exists false e non si riarma', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fs.rmSync(p);
  fake.fire(p);
  await sleep(50);
  assert.deepStrictEqual(seen, [{ path: p, exists: false, mtime: null }]);
  assert.strictEqual(fake.live(p).length, 0);
  w.close();
});

ok('watch: un errore del watcher non lancia e porta a un ricontrollo', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fake.watchers[0].emit('error', new Error('EPERM'));
  await sleep(50);
  assert.strictEqual(seen.length, 1);
  w.close();
});

ok('watch: un file che non c\'è non arma niente e non lancia', (t) => {
  const p = path.join(path.dirname(tmpFile(t)), 'manca.txt');
  const w = createEditorWatch({ onChange: () => {}, watchFn: fakeWatch().watchFn });
  assert.strictEqual(w.watch(p), false);
  w.close();
});

ok('unwatch: conta i riferimenti', (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const w = createEditorWatch({ onChange: () => {}, watchFn: fake.watchFn });
  w.watch(p); w.watch(p);
  w.unwatch(p);
  assert.strictEqual(fake.live(p).length, 1);
  w.unwatch(p);
  assert.strictEqual(fake.live(p).length, 0);
  assert.strictEqual(w.size(), 0);
});

ok('close: ferma i watcher e le notifiche in attesa', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 20, watchFn: fake.watchFn });
  w.watch(p);
  fake.fire(p);
  w.close();
  await sleep(60);
  assert.deepStrictEqual(seen, []);
  assert.strictEqual(fake.live(p).length, 0);
});

ok('leak: se watch è chiamato durante notify che aspetta stat, il vecchio watcher non è orfano', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const w = createEditorWatch({ onChange: () => {}, debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fake.fire(p);
  // Aspetta che notify inizi (debounce scaduto) ma non finisca ancora
  await sleep(15);
  // In questo punto notify sta aspettando fs.promises.stat
  // Richiama watch dello stesso path
  w.watch(p);
  // Aspetta che notify finisca
  await sleep(30);
  // Deve esserci solo 1 watcher live (non chiuso), non 2
  assert.strictEqual(fake.live(p).length, 1);
  w.close();
});

ok('errors: ENOENT è silenzioso, altri errori si loggano', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-watch-err-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'a.txt');

  // Test ENOENT: non deve loggare
  const errorsCalled = [];
  const originalError = console.error;
  console.error = (...args) => { errorsCalled.push(args); };
  t.after(() => { console.error = originalError; });

  const w = createEditorWatch({
    onChange: () => {},
    watchFn: (path) => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
  });
  assert.strictEqual(w.watch(p), false);
  assert.strictEqual(errorsCalled.length, 0);

  // Test EACCES: deve loggare
  errorsCalled.length = 0;
  const w2 = createEditorWatch({
    onChange: () => {},
    watchFn: (path) => {
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    }
  });
  assert.strictEqual(w2.watch(p), false);
  assert.strictEqual(errorsCalled.length, 1);
  assert(errorsCalled[0][0].includes('[editor-watch]'));
  assert(errorsCalled[0][0].includes('watch fallito'));
});

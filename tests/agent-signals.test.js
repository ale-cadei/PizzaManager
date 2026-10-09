// lib/agent-signals.js: i file in cui gli hook scrivono lo stato (piano 46)
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../lib/agent-signals');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-signals-'));

test('parseState: solo le quattro parole, spazi e a capo tollerati', () => {
  assert.equal(S.parseState('running'), 'running');
  assert.equal(S.parseState(' waiting\r\n'), 'waiting');
  assert.equal(S.parseState('permission\n'), 'permission');
  assert.equal(S.parseState('ready'), 'ready');
  assert.equal(S.parseState(''), null, 'vuoto: scrittura a metà');
  assert.equal(S.parseState('runn'), null);
  assert.equal(S.parseState('rm -rf /'), null);
  assert.equal(S.parseState(undefined), null);
});

test('isValidKey: nomi di sessione, mai percorsi', () => {
  assert.equal(S.isValidKey('ais-claude-lx1abc'), true);
  assert.equal(S.isValidKey('tab-12'), true);
  for (const k of ['', '../x', 'a/b', 'a\\b', '..', 'a b', 'x'.repeat(81), null]) {
    assert.equal(S.isValidKey(k), false, String(k));
  }
});

test('pathFor sta nella cartella signals e rifiuta chiavi malformate', () => {
  const dir = tmp();
  const store = S.createAgentSignalStore({ dir });
  assert.equal(store.pathFor('ais-claude-1'), path.join(dir, 'signals', 'ais-claude-1'));
  assert.throws(() => store.pathFor('../fuori'), /chiave/);
});

test('read: stato scritto da un hook; file mancante o sporco → null', () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  assert.equal(store.read('ais-x-1'), null);
  fs.mkdirSync(path.dirname(store.pathFor('ais-x-1')), { recursive: true });
  fs.writeFileSync(store.pathFor('ais-x-1'), 'permission');
  assert.equal(store.read('ais-x-1'), 'permission');
  fs.writeFileSync(store.pathFor('ais-x-1'), 'boh');
  assert.equal(store.read('ais-x-1'), null);
});

test('remove e sweep: restano solo le sessioni vive', () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  fs.mkdirSync(path.dirname(store.pathFor('a')), { recursive: true });
  for (const k of ['a', 'b', 'c']) fs.writeFileSync(store.pathFor(k), 'waiting');
  store.remove('a');
  store.remove('non-esiste'); // nessun errore
  store.sweep(['c']);
  assert.deepEqual(fs.readdirSync(path.dirname(store.pathFor('c'))), ['c']);
});

test('watch: una scrittura arriva come (chiave, stato)', async () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  const seen = [];
  const stop = store.watch((key, state) => seen.push([key, state]));
  try {
    fs.writeFileSync(store.pathFor('ais-y-1'), 'running');
    for (let i = 0; i < 50 && !seen.length; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.at(-1), ['ais-y-1', 'running']);
  } finally { stop(); }
});

test('writePlugin: file fuori da asar, percorso stabile, contenuto aggiornato', () => {
  const dir = tmp();
  const store = S.createAgentSignalStore({ dir });
  const p = store.writePlugin('export default 1;');
  assert.equal(p, path.join(dir, 'hooks', 'opencode-signal.mjs'));
  assert.equal(fs.readFileSync(p, 'utf8'), 'export default 1;');
  store.writePlugin('export default 2;');
  assert.equal(fs.readFileSync(p, 'utf8'), 'export default 2;');
});

/* Il plugin è codice che opencode esegue: se un altro utente potesse
   riscriverlo, girerebbe dentro ogni sessione. Permessi come scrollback. */
test('permessi: cartelle 0700, plugin 0600 anche se esisteva già', { skip: process.platform === 'win32' }, () => {
  const dir = tmp();
  const store = S.createAgentSignalStore({ dir });
  const hooks = path.join(dir, 'hooks');
  fs.mkdirSync(hooks, { mode: 0o755 });
  fs.writeFileSync(path.join(hooks, 'opencode-signal.mjs'), 'vecchio', { mode: 0o666 });
  fs.chmodSync(path.join(hooks, 'opencode-signal.mjs'), 0o666);
  const p = store.writePlugin('export default 1;');
  store.ensureDir();
  const mode = (f) => fs.statSync(f).mode & 0o777;
  assert.equal(mode(p), 0o600);
  assert.equal(mode(hooks), 0o700, 'una cartella già esistente resta scrivibile da altri');
  assert.equal(mode(path.join(dir, 'signals')), 0o700);
});

/* fs.watch può morire (EMFILE, ENOSPC, filesystem senza inotify): le
   sessioni già esatte resterebbero ferme sull'ultimo stato. Si riparte. */
test('watch: se l osservazione muore riparte da sola, stop la ferma davvero', async () => {
  const { EventEmitter } = require('events');
  const watchers = [];
  const fakeWatch = (_dir, cb) => {
    const w = new EventEmitter();
    w.cb = cb; w.closed = false; w.close = () => { w.closed = true; };
    watchers.push(w);
    return w;
  };
  const store = S.createAgentSignalStore({ dir: tmp(), fsWatch: fakeWatch, retryMs: 5 });
  const got = [];
  const stop = store.watch((k, v) => got.push([k, v]));
  const err = console.error; console.error = () => {};
  try {
    watchers[0].emit('error', new Error('EMFILE'));
    assert.ok(watchers[0].closed, 'il watcher morto va chiuso');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(watchers.length, 2, 'non è ripartito');
    fs.writeFileSync(store.pathFor('k1'), 'waiting');
    watchers[1].cb('change', 'k1');
    assert.deepStrictEqual(got, [['k1', 'waiting']]);
    watchers[1].emit('error', new Error('EMFILE'));
    stop();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(watchers.length, 2, 'dopo stop non deve ripartire');
  } finally { console.error = err; }
});

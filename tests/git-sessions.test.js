const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Schede git da riaprire al riavvio: lib/git-sessions.js su una tmpdir */
const { createGitSessionsStore, sanitizeGitSessions, GIT_SESSIONS_FILE, MAX_SESSIONS } = require('../lib/git-sessions');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-gitsess-'));

ok('git-sessions: senza file non c\'è niente da riaprire', () => {
  assert.deepStrictEqual(createGitSessionsStore({ dir: tmp() }).read(), []);
});

ok('git-sessions: quello che si scrive si rilegge, nello stesso ordine', () => {
  const dir = tmp();
  const store = createGitSessionsStore({ dir });
  store.write([
    { cwd: '/repo/a', name: null, startedAt: 1000 },
    { cwd: '/repo/b', name: 'mio nome', startedAt: 2000 },
  ]);
  assert.deepStrictEqual(createGitSessionsStore({ dir }).read(), [
    { cwd: '/repo/a', name: null, startedAt: 1000 },
    { cwd: '/repo/b', name: 'mio nome', startedAt: 2000 },
  ]);
  assert.ok(fs.existsSync(path.join(dir, GIT_SESSIONS_FILE)));
});

ok('git-sessions: una lista vuota cancella le schede di prima', () => {
  const store = createGitSessionsStore({ dir: tmp() });
  store.write([{ cwd: '/repo', name: null, startedAt: 1 }]);
  store.write([]);
  assert.deepStrictEqual(store.read(), []);
});

ok('git-sessions: un file corrotto non fa esplodere l\'avvio', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, GIT_SESSIONS_FILE), '{non è json');
  assert.deepStrictEqual(createGitSessionsStore({ dir }).read(), []);
  fs.writeFileSync(path.join(dir, GIT_SESSIONS_FILE), '{"cwd":"/x"}');
  assert.deepStrictEqual(createGitSessionsStore({ dir }).read(), []);
});

ok('git-sessions: le voci malformate si scartano, le altre si puliscono', () => {
  const list = sanitizeGitSessions([
    null, 'stringa', { name: 'senza cwd' }, { cwd: '' }, { cwd: '   ' }, { cwd: 42 },
    { cwd: '/a\nb' }, { cwd: 'x'.repeat(5000) },
    { cwd: ' /repo ', name: '  ' + 'n'.repeat(60) + '  ', startedAt: 5 },
    { cwd: '/repo2', name: '   ', startedAt: -1 },
  ]);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[0], { cwd: '/repo', name: 'n'.repeat(40), startedAt: 5 });
  assert.strictEqual(list[1].name, null, 'un nome vuoto = nome dal repository');
  assert.ok(list[1].startedAt > 0, 'un istante non valido diventa adesso');
  assert.deepStrictEqual(sanitizeGitSessions(undefined), []);
});

ok('git-sessions: al massimo MAX_SESSIONS schede', () => {
  const many = Array.from({ length: MAX_SESSIONS + 10 }, (_, i) => ({ cwd: `/r/${i}`, startedAt: 1 }));
  assert.strictEqual(createGitSessionsStore({ dir: tmp() }).write(many).length, MAX_SESSIONS);
});

ok('git-sessions: senza directory rifiuta', () => {
  assert.throws(() => createGitSessionsStore({}), /directory/);
});

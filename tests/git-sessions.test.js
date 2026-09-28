const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Schede git da riaprire al riavvio: lib/git-sessions.js su una tmpdir */
const { createGitSessionsStore, sanitizeGitSessions, savedBeforeBoot, GIT_SESSIONS_FILE, MAX_SESSIONS } = require('../lib/git-sessions');

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

ok('git-sessions: il file ricorda quando è stato scritto', () => {
  const dir = tmp();
  createGitSessionsStore({ dir, now: () => 5000 }).write([{ cwd: '/repo', startedAt: 1 }]);
  assert.deepStrictEqual(createGitSessionsStore({ dir }).readState(), {
    sessions: [{ cwd: '/repo', name: null, startedAt: 1 }], savedAt: 5000,
  });
});

ok('git-sessions: il formato vecchio (solo la lista) si legge ancora, senza data', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, GIT_SESSIONS_FILE), JSON.stringify([{ cwd: '/vecchio', startedAt: 3 }]));
  const store = createGitSessionsStore({ dir });
  assert.deepStrictEqual(store.readState(), { sessions: [{ cwd: '/vecchio', name: null, startedAt: 3 }], savedAt: null });
  assert.deepStrictEqual(store.read(), [{ cwd: '/vecchio', name: null, startedAt: 3 }]);
});

ok('git-sessions: savedBeforeBoot dice se la macchina si è riavviata dopo il salvataggio', () => {
  // acceso da 100 s: il boot è a now - 100 000 ms
  const clock = { now: 1_000_000, uptime: 100 };
  assert.strictEqual(savedBeforeBoot(850_000, clock), true, 'salvato prima del boot = riavvio');
  assert.strictEqual(savedBeforeBoot(950_000, clock), false, 'salvato dopo il boot = app solo chiusa');
  assert.strictEqual(savedBeforeBoot(null, clock), true, 'senza data si chiede, non si decide da soli');
  assert.strictEqual(savedBeforeBoot('x', clock), true);
});

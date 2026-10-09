const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Canali IPC della sessione git e dei worktree (app/git.js). app/git.js non
   chiede Electron: riceve ipcMain, quindi un finto ipcMain basta a provare
   che i canali esistono e cosa rispondono. */
const { registerGitHandlers } = require('../app/git');

function fakeIpc() {
  const handlers = new Map();
  return { handlers, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } };
}

const WORKTREE_CHANNELS = ['worktree-list', 'worktree-start', 'worktree-create', 'worktree-merge', 'worktree-remove'];

ok('ipc: i canali dei worktree sono registrati', () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  for (const channel of WORKTREE_CHANNELS) assert.ok(handlers.has(channel), `manca ${channel}`);
});

ok('ipc: ogni canale git del preload ha il suo handler', () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('((?:git|worktree)-[a-z-]+)'/g)].map((m) => m[1]);
  for (const channel of WORKTREE_CHANNELS) assert.ok(invoked.includes(channel), `il preload non espone ${channel}`);
  for (const channel of invoked) assert.ok(handlers.has(channel), `${channel} nel preload ma senza handler`);
});

ok('ipc: un payload mancante o senza radice risponde con un errore, non lancia', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  for (const channel of WORKTREE_CHANNELS) {
    for (const payload of [undefined, null, {}]) {
      const r = await handlers.get(channel)({}, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error, `${channel} senza messaggio`);
    }
  }
});

ok('ipc: il pannello delle modifiche risponde con un errore a un payload vuoto, e rifiuta percorsi fuori', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  for (const channel of ['git-changes', 'git-file-diff', 'git-snapshot', 'git-staging', 'git-staging-diff']) {
    for (const payload of [undefined, null, {}]) {
      const r = await handlers.get(channel)({}, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error, `${channel} senza messaggio`);
    }
  }
  const outside = await handlers.get('git-file-diff')({}, { cwd: __dirname, path: '../../etc/passwd' });
  assert.deepStrictEqual(outside, { ok: false, error: 'Percorso non valido.' });
  const stagingOutside = await handlers.get('git-staging-diff')({}, { cwd: __dirname, path: '../../etc/passwd', side: 'unstaged' });
  assert.deepStrictEqual(stagingOutside, { ok: false, error: 'Percorso non valido.' });
  const badSide = await handlers.get('git-staging-diff')({}, { cwd: __dirname, path: 'a.js', side: '--output=/tmp/x' });
  assert.deepStrictEqual(badSide, { ok: false, error: 'Sezione non valida.' });
  const badBase = await handlers.get('git-changes')({}, { cwd: __dirname, base: '--output=/tmp/x' });
  assert.strictEqual(badBase.ok, false);
});

ok('ipc: stage, unstage e commit rifiutano payload vuoti, percorsi fuori e un `all` che non è true', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  for (const channel of ['git-stage', 'git-unstage', 'git-commit']) {
    for (const payload of [undefined, null, {}]) {
      const r = await handlers.get(channel)({}, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error, `${channel} senza messaggio`);
    }
  }
  // cwd è questo repository: nessuna di queste richieste deve arrivare a scrivere
  for (const channel of ['git-stage', 'git-unstage']) {
    const outside = await handlers.get(channel)({}, { cwd: __dirname, paths: ['../../etc/passwd'] });
    assert.deepStrictEqual(outside, { ok: false, error: 'Percorsi non validi.' });
    const notTrue = await handlers.get(channel)({}, { cwd: __dirname, all: 'true' });
    assert.deepStrictEqual(notTrue, { ok: false, error: 'Percorsi non validi.' });
  }
  const noMessage = await handlers.get('git-commit')({}, { cwd: __dirname, message: '   ' });
  assert.strictEqual(noMessage.ok, false);
});

ok('ipc: git-merge rifiuta payload vuoti, nomi che sembrano opzioni e tipi sconosciuti', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  const merge = handlers.get('git-merge');
  for (const payload of [undefined, null, {}]) {
    const r = await merge({}, payload);
    assert.strictEqual(r.ok, false, JSON.stringify(payload));
    assert.ok(r.error);
  }
  // cwd è questo repository: nessuna di queste richieste deve arrivare a unire
  assert.strictEqual((await merge({}, { cwd: __dirname, name: '--abort', kind: 'local' })).ok, false);
  assert.strictEqual((await merge({}, { cwd: __dirname, name: 'main', kind: 'tag' })).ok, false);
  const badIncoming = await handlers.get('git-changes')({}, { cwd: __dirname, incoming: '-X' });
  assert.strictEqual(badIncoming.ok, false);
});

ok('ipc: git-push rifiuta payload vuoti e nomi che sembrano opzioni, senza pushare', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  const push = handlers.get('git-push');
  for (const payload of [undefined, null, {}, { cwd: __dirname }]) {
    const r = await push({}, payload);
    assert.strictEqual(r.ok, false, JSON.stringify(payload));
    assert.ok(r.error);
  }
  // cwd è questo repository: nessuna di queste richieste deve arrivare a git push
  for (const name of ['--all', '--mirror', '-f', 'non/esiste/davvero-47']) {
    assert.strictEqual((await push({}, { cwd: __dirname, name })).ok, false, name);
  }
});

ok('ipc: scarta e annulla rifiutano payload vuoti, percorsi fuori e gettoni finti', async () => {
  const { handlers, ipcMain } = fakeIpc();
  registerGitHandlers(ipcMain, { userDataDir: () => '/non/usata' });
  for (const channel of ['git-discard', 'git-discard-undo']) {
    for (const payload of [undefined, null, {}, { cwd: __dirname }]) {
      const r = await handlers.get(channel)({}, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error, `${channel} senza messaggio`);
    }
  }
  // cwd è questo repository: nessuna di queste richieste deve arrivare a scrivere
  const discard = handlers.get('git-discard');
  assert.deepStrictEqual(await discard({}, { cwd: __dirname, path: '../../etc/passwd' }), { ok: false, error: 'Percorso non valido.' });
  assert.strictEqual((await discard({}, { cwd: __dirname, path: 'non-esiste-piano-48.txt' })).ok, false);
  const token = { path: '../../etc/passwd', blob: 'a'.repeat(40), mode: 0o644, after: null };
  assert.strictEqual((await handlers.get('git-discard-undo')({}, { cwd: __dirname, token })).ok, false);
});

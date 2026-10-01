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

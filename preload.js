const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aisess', {
  spawn: (opts) => ipcRenderer.invoke('pty-spawn', opts),
  write: (id, data) => ipcRenderer.send('pty-write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty-resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke('pty-kill', { id }),
  onData: (cb) => ipcRenderer.on('pty-data', (_e, v) => cb(v)),
  onExit: (cb) => ipcRenderer.on('pty-exit', (_e, v) => cb(v)),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  checkDeps: () => ipcRenderer.invoke('check-deps'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  listOpencode: (limit) => ipcRenderer.invoke('list-opencode-sessions', { limit }),
  listClaude: (limit) => ipcRenderer.invoke('list-claude-sessions', { limit }),
  listClaudeAccounts: () => ipcRenderer.invoke('list-claude-accounts'),
  addClaudeAccount: ({ name, apiKey }) => ipcRenderer.invoke('add-claude-account', { name, apiKey }),
  deleteClaudeAccount: (id) => ipcRenderer.invoke('delete-claude-account', { id }),
  pickCwd: () => ipcRenderer.invoke('dialog-cwd'),
  onMenu: (channel, cb) => {
    const allowed = ['menu-new-session'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, () => cb());
  },
});

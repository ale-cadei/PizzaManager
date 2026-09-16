const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aisess', {
  spawn: (opts) => ipcRenderer.invoke('pty-spawn', opts),
  write: (id, data) => ipcRenderer.send('pty-write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty-resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.invoke('pty-kill', { id }),
  // Sessioni dentro tmux: riattacco e terminazione esplicita
  attach: (opts) => ipcRenderer.invoke('pty-attach', opts),
  terminate: (id) => ipcRenderer.invoke('pty-terminate', { id }),
  listLive: () => ipcRenderer.invoke('list-live-sessions'),
  setLabel: (id, label) => ipcRenderer.send('pty-set-label', { id, label }),
  setMeta: (id, meta) => ipcRenderer.send('pty-set-meta', { id, ...meta }),
  restorable: () => ipcRenderer.invoke('restorable-sessions'),
  discardRestorable: () => ipcRenderer.invoke('discard-restorable'),
  terminateSession: (session) => ipcRenderer.invoke('terminate-session', { session }),
  onData: (cb) => ipcRenderer.on('pty-data', (_e, v) => cb(v)),
  onExit: (cb) => ipcRenderer.on('pty-exit', (_e, v) => cb(v)),
  getDefaults: () => ipcRenderer.invoke('get-defaults'),
  checkDeps: () => ipcRenderer.invoke('check-deps'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getRecentDirs: (limit) => ipcRenderer.invoke('get-recent-dirs', { limit }),
  listOpencode: (limit) => ipcRenderer.invoke('list-opencode-sessions', { limit }),
  listClaude: (limit) => ipcRenderer.invoke('list-claude-sessions', { limit }),
  listCodex: (limit) => ipcRenderer.invoke('list-codex-sessions', { limit }),
  listAntigravity: (limit) => ipcRenderer.invoke('list-antigravity-sessions', { limit }),
  listClaudeAccounts: () => ipcRenderer.invoke('list-claude-accounts'),
  addClaudeAccount: ({ name, apiKey }) => ipcRenderer.invoke('add-claude-account', { name, apiKey }),
  deleteClaudeAccount: (id) => ipcRenderer.invoke('delete-claude-account', { id }),
  getCommandProfiles: () => ipcRenderer.invoke('get-command-profiles'),
  saveCommandProfiles: (profiles) => ipcRenderer.invoke('save-command-profiles', { profiles }),
  resetCommandProfiles: () => ipcRenderer.invoke('reset-command-profiles'),
  pickCwd: () => ipcRenderer.invoke('dialog-cwd'),
  menuAction: (action) => ipcRenderer.invoke('menu-action', { action }),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', { text }),
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  onMenuEdit: (cb) => ipcRenderer.on('menu-edit', (_e, action) => cb(action)),
  onMenu: (channel, cb) => {
    const allowed = ['menu-new-session', 'menu-open-config'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, () => cb());
  },
});

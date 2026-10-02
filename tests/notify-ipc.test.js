const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok, mock } = require('node:test');

/* Canali IPC delle notifiche di sistema (app/notify.js, piano 38). Il modulo
   riceve Electron come parametro: con un finto app/Notification/Menu e una
   finta finestra si prova cosa fa, senza aprire niente. */
const { registerNotifyHandlers } = require('../app/notify');

function fakeElectron() {
  const shown = [];
  class Notification {
    constructor(opts) { this.opts = opts; this.listeners = {}; this.closed = false; }
    static isSupported() { return true; }
    on(ev, fn) { this.listeners[ev] = fn; }
    show() { shown.push(this); }
    close() { this.closed = true; if (this.listeners.close) this.listeners.close(); }
    click() { this.listeners.click(); }
  }
  const appListeners = {};
  const app = {
    badge: null,
    badgeCount: null,
    focused: null,
    dock: { setBadge: (s) => { app.badge = s; } },
    setBadgeCount: (n) => { app.badgeCount = n; return true; },
    focus: (opts) => { app.focused = opts; },
    on: (ev, fn) => { appListeners[ev] = fn; },
    emit: (ev) => appListeners[ev] && appListeners[ev](),
  };
  const menuItem = { checked: true };
  const Menu = { getApplicationMenu: () => ({ getMenuItemById: (id) => (id === 'notifications' ? menuItem : null) }) };
  return { electron: { app, Notification, Menu }, shown, menuItem };
}

function fakeWindow({ focused = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    focusedNow: focused,
    isDestroyed: () => false,
    isFocused() { return this.focusedNow; },
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
}

function setup({ platform = 'darwin', win = fakeWindow() } = {}) {
  const on = new Map();
  const handle = new Map();
  const ipcMain = { on: (c, fn) => on.set(c, fn), handle: (c, fn) => handle.set(c, fn) };
  const fake = fakeElectron();
  const sent = [];
  let pending = [];
  registerNotifyHandlers(ipcMain, {
    electron: fake.electron,
    getWindow: () => win,
    sendToRenderer: (channel, payload) => sent.push([channel, payload]),
    platform,
    // Raggruppamento a mano: flush() svuota la finestra subito
    schedule: (fn) => { pending.push(fn); return fn; },
    cancel: (fn) => { pending = pending.filter((x) => x !== fn); },
  });
  const flush = () => { const due = pending; pending = []; due.forEach((fn) => fn()); };
  const finished = (payload) => { on.get('notify-finished')({}, payload); flush(); };
  return { on, handle, sent, win, finished, ...fake };
}

const ITEM = { id: 'a', name: 'refactor login', typeLabel: 'Claude', where: '~/progetto' };

ok('notify ipc: canali registrati ed esposti dal preload', () => {
  const { on, handle } = setup();
  assert.ok(on.has('notify-finished'));
  assert.ok(on.has('notify-badge'));
  assert.ok(handle.has('notify-config'));
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const c of ["send('notify-finished'", "send('notify-badge'", "invoke('notify-config'", "on('notify-open-tab'"]) {
    assert.ok(preload.includes(c), `il preload non usa ${c}`);
  }
});

ok('notify ipc: con la finestra dietro parte la notifica con il testo giusto', () => {
  const { finished, shown } = setup();
  finished(ITEM);
  assert.strictEqual(shown.length, 1);
  assert.deepStrictEqual({ title: shown[0].opts.title, body: shown[0].opts.body },
    { title: 'Claude ha finito', body: 'refactor login · ~/progetto' });
});

ok('notify ipc: con la finestra davanti non parte niente', () => {
  const { finished, shown } = setup({ win: fakeWindow({ focused: true }) });
  finished(ITEM);
  assert.strictEqual(shown.length, 0);
});

ok('notify ipc: il focus si guarda al momento del flush, non all arrivo', () => {
  const s = setup();
  s.on.get('notify-finished')({}, ITEM);
  s.win.focusedNow = true; // l'utente è tornato mentre la finestra di raggruppamento era aperta
  s.finished({ ...ITEM, id: 'b' });
  assert.strictEqual(s.shown.length, 0);
});

ok('notify ipc: spente dal menu non partono, e il menu si allinea', async () => {
  const { handle, finished, shown, menuItem } = setup();
  const r = await handle.get('notify-config')({}, { enabled: false });
  assert.deepStrictEqual(r, { ok: true, supported: true });
  assert.strictEqual(menuItem.checked, false);
  finished(ITEM);
  assert.strictEqual(shown.length, 0);
  await handle.get('notify-config')({}, { enabled: true });
  assert.strictEqual(menuItem.checked, true);
  finished(ITEM);
  assert.strictEqual(shown.length, 1);
});

ok('notify ipc: su Windows niente notifiche e niente badge', async () => {
  const { handle, on, finished, shown, electron } = setup({ platform: 'win32' });
  assert.deepStrictEqual(await handle.get('notify-config')({}, { enabled: true }), { ok: true, supported: false });
  finished(ITEM);
  on.get('notify-badge')({}, 3);
  assert.strictEqual(shown.length, 0);
  assert.strictEqual(electron.app.badgeCount, null);
  assert.strictEqual(electron.app.badge, null);
});

ok('notify ipc: payload sporchi si ignorano senza lanciare', async () => {
  const { finished, shown, handle } = setup();
  for (const bad of [undefined, null, 'x', {}, { id: '' }]) finished(bad);
  assert.strictEqual(shown.length, 0);
  for (const bad of [undefined, null, 'x']) {
    const r = await handle.get('notify-config')({}, bad);
    assert.strictEqual(r.ok, true);
  }
});

ok('notify ipc: il click riporta davanti la finestra e apre la scheda', () => {
  const win = fakeWindow({ minimized: true });
  const { finished, shown, sent, electron } = setup({ win });
  finished(ITEM);
  shown[0].click();
  assert.deepStrictEqual(win.calls, ['restore', 'show', 'focus']);
  assert.deepStrictEqual(electron.app.focused, { steal: true }, 'su macOS l app va attivata');
  assert.deepStrictEqual(sent, [['notify-open-tab', 'a']]);
});

ok('notify ipc: su Linux il click non chiama app.focus (è solo di macOS)', () => {
  const { finished, shown, electron } = setup({ platform: 'linux' });
  finished(ITEM);
  shown[0].click();
  assert.strictEqual(electron.app.focused, null);
});

ok('notify ipc: tornando sulla finestra le notifiche aperte si chiudono', () => {
  const { finished, shown, electron } = setup();
  finished(ITEM);
  finished({ ...ITEM, id: 'b' });
  electron.app.emit('browser-window-focus');
  assert.deepStrictEqual(shown.map((n) => n.closed), [true, true]);
  // Già chiuse: un secondo focus non le richiude
  shown.forEach((n) => { n.closed = false; });
  electron.app.emit('browser-window-focus');
  assert.deepStrictEqual(shown.map((n) => n.closed), [false, false]);
});

ok('notify ipc: badge sul Dock su macOS, contatore su Linux', () => {
  const mac = setup();
  mac.on.get('notify-badge')({}, 2);
  assert.strictEqual(mac.electron.app.badge, '2');
  mac.on.get('notify-badge')({}, 0);
  assert.strictEqual(mac.electron.app.badge, '', 'a zero il badge sparisce');
  mac.on.get('notify-badge')({}, 'tanti');
  assert.strictEqual(mac.electron.app.badge, '');

  const linux = setup({ platform: 'linux' });
  linux.on.get('notify-badge')({}, 2);
  assert.strictEqual(linux.electron.app.badgeCount, 2);
});

ok('notify ipc: una Notification che lancia non rompe niente', () => {
  const s = setup();
  s.electron.Notification.prototype.show = () => { throw new Error('dbus assente'); };
  const err = mock.method(console, 'error', () => {});
  try {
    assert.doesNotThrow(() => s.finished(ITEM));
    assert.strictEqual(err.mock.callCount(), 1);
  } finally {
    err.mock.restore();
  }
});

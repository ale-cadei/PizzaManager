'use strict';
const {
  isPlatformSupported, shouldNotify, validateItem, validateBadgeCount, composeNotification, createCoalescer,
} = require('../lib/notifications');

const MENU_ITEM_ID = 'notifications';

/**
 * Notifiche di sistema e badge (docs/plans/38). Le regole stanno in
 * lib/notifications.js; qui Notification, finestra, Dock e menu.
 *
 * Electron arriva come parametro (`electron: { app, Notification, Menu }`)
 * invece che da require: così i test lo sostituiscono con dei finti.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{
 *   electron: {app: Electron.App, Notification: typeof Electron.Notification, Menu: typeof Electron.Menu},
 *   getWindow: () => Electron.BrowserWindow | null,
 *   sendToRenderer: (channel: string, payload: unknown) => void,
 *   platform?: string,
 *   schedule?: typeof setTimeout,
 *   cancel?: typeof clearTimeout,
 * }} opts
 */
function registerNotifyHandlers(ipcMain, { electron, getWindow, sendToRenderer, platform = process.platform, schedule, cancel }) {
  const { app, Notification, Menu } = electron;
  const isMac = platform === 'darwin';
  let enabled = true;
  // Senza un riferimento il garbage collector raccoglie la Notification e il
  // click non arriva più: si tengono finché non vengono cliccate o chiuse.
  let live = new Set();

  const isSupported = () => isPlatformSupported(platform) && Notification.isSupported();
  const usableWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  function forget(n) {
    live = new Set([...live].filter((x) => x !== n));
  }

  function bringBack(tabId) {
    const win = usableWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    // Su macOS focus() sulla finestra non attiva l'app se è dietro un'altra
    if (isMac) app.focus({ steal: true });
    sendToRenderer('notify-open-tab', tabId);
  }

  function show(items) {
    const win = usableWindow();
    const focused = Boolean(win && win.isFocused());
    if (!shouldNotify({ enabled, focused, supported: isSupported() })) return;
    const content = composeNotification(items);
    if (!content) return;
    try {
      const n = new Notification({ title: content.title, body: content.body });
      n.on('click', () => { forget(n); bringBack(content.tabId); });
      n.on('close', () => forget(n));
      n.show();
      live = new Set(live).add(n);
    } catch (e) {
      console.error('[notify] notifica non mostrata:', e);
    }
  }

  // L'utente è tornato: la sidebar dice già tutto, le notifiche aperte sono vecchie
  function closeAll() {
    const open = [...live];
    live = new Set();
    for (const n of open) {
      try { n.close(); } catch (e) { console.error('[notify] chiusura fallita:', e); }
    }
  }

  function setBadge(count) {
    if (!isPlatformSupported(platform)) return;
    try {
      if (isMac) app.dock.setBadge(count ? String(count) : '');
      // Su Linux funziona solo con i launcher che lo supportano (Unity, KDE)
      else app.setBadgeCount(count);
    } catch (e) {
      console.error('[notify] badge non aggiornato:', e);
    }
  }

  function syncMenu() {
    try {
      const menu = Menu.getApplicationMenu();
      const item = menu && menu.getMenuItemById(MENU_ITEM_ID);
      if (item) item.checked = enabled;
    } catch (e) {
      console.error('[notify] menu non allineato:', e);
    }
  }

  const coalescer = createCoalescer({ onFlush: show, ...(schedule && { schedule }), ...(cancel && { cancel }) });

  ipcMain.on('notify-finished', (event, raw) => {
    const item = validateItem(raw);
    if (item) coalescer.push(item);
  });
  ipcMain.on('notify-badge', (event, raw) => setBadge(validateBadgeCount(raw)));
  ipcMain.handle('notify-config', (event, cfg) => {
    enabled = !(cfg && cfg.enabled === false);
    syncMenu();
    return { ok: true, supported: isSupported() };
  });
  app.on('browser-window-focus', closeAll);
}

module.exports = { registerNotifyHandlers, MENU_ITEM_ID };

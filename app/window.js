'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { buildAppMenu } = require('./menu');

const ROOT = path.join(__dirname, '..');

const WINDOW_OPTIONS = {
  width: 1280,
  height: 800,
  minWidth: 900,
  minHeight: 600,
  title: 'PizzaManager',
  // Barra superiore in tema col resto dell'app (nera):
  // - backgroundColor nero per il flash di avvio
  // - darkTheme: dice al SO/Chromium di usare controlli e menu scuri
  // - titleBarOverlay nera dove supportata (Win): controlli nativi su fondo nero
  backgroundColor: '#000000',
  darkTheme: true,
  titleBarOverlay: { color: '#000000', symbolColor: '#F2EFF4' },
};

/**
 * Finestra principale.
 *
 * NOTA Linux: la menubar nativa e' disegnata dal tema GTK del desktop e resta
 * chiara anche con darkTheme. Per avere una barra scura si nasconde quella
 * nativa (il menu resta attivo per gli acceleratori come Ctrl+N) e si usa la
 * menubar in-app nel renderer. Su macOS il menu nativo segue gia' il tema
 * scuro e va tenuto visibile.
 */
function createWindow({ platform = process.platform } = {}) {
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  const isMac = platform === 'darwin';
  const win = new BrowserWindow({
    ...WINDOW_OPTIONS,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  buildAppMenu({
    sendToRenderer: (channel) => {
      if (!win.isDestroyed()) win.webContents.send(channel);
    },
  });
  if (!isMac) {
    try { win.setMenuBarVisibility(false); } catch {}
  }
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  return win;
}

module.exports = { createWindow, WINDOW_OPTIONS };

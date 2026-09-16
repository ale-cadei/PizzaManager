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
  // Barra superiore in tema col resto dell'app (--bg della palette "Forno",
  // un nero virato al caldo, non #000):
  // - backgroundColor per il flash di avvio
  // - darkTheme: dice al SO/Chromium di usare controlli e menu scuri
  // - titleBarOverlay dove supportata (Win): controlli nativi sullo stesso fondo
  backgroundColor: '#070505',
  darkTheme: true,
  titleBarOverlay: { color: '#070505', symbolColor: '#F6F1EC' },
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
function createWindow({ platform = process.platform, onRendererReload = null } = {}) {
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
  // Un ricaricamento del renderer (Ricarica, Ricarica forzata) distrugge le
  // schede ma non i pty nel main: quei client resterebbero attaccati a un
  // renderer morto e il nuovo li vedrebbe come "gia' aperti". Si chiudono
  // qui; con tmux le sessioni sopravvivono e il renderer nuovo le riaggancia.
  if (onRendererReload) {
    let firstLoad = true;
    win.webContents.on('did-start-navigation', (details) => {
      if (details && details.isSameDocument) return;
      if (firstLoad) { firstLoad = false; return; }
      onRendererReload();
    });
  }
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  return win;
}

module.exports = { createWindow, WINDOW_OPTIONS };

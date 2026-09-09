'use strict';
const { app, Menu, shell: electronShell } = require('electron');

const REPO_URL = 'https://github.com/aisessionmanager/aisessionmanager';

/**
 * Menu applicativo nativo.
 *
 * Vive in app/ e non in lib/ perche' dipende da Electron per natura: non
 * avrebbe senso verificarlo in isolamento.
 *
 * `sendToRenderer` arriva dall'esterno per non dover conoscere la finestra.
 */
function buildAppMenu({ sendToRenderer, quit } = {}) {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Nuova sessione', accelerator: 'CmdOrCtrl+N', click: () => sendToRenderer('menu-new-session') },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Ricarica' },
        { role: 'forceReload', label: 'Ricarica forzata' },
        { role: 'toggleDevTools', label: 'Strumenti di sviluppo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom originale' },
        { role: 'zoomIn', label: 'Aumenta zoom' },
        { role: 'zoomOut', label: 'Riduci zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'close', label: 'Chiudi finestra' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Repository AISessionManager', click: () => electronShell.openExternal(REPO_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Azioni della menubar scura in-app (renderer/index.html#menubar).
 * Replica i ruoli del menu nativo, cosi' File/Edit/View/Window/Help funzionano
 * anche dove quello nativo e' nascosto (Linux/Windows).
 */
async function runMenuAction(action, win) {
  if (!win || win.isDestroyed()) return { ok: false, error: 'finestra non disponibile' };
  const wc = win.webContents;
  try {
    switch (action) {
      case 'new-session': wc.send('menu-new-session'); break;
      case 'quit': app.quit(); break;
      case 'undo': wc.undo(); break;
      case 'redo': wc.redo(); break;
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectAll': wc.selectAll(); break;
      case 'reload': wc.reload(); break;
      case 'forceReload': wc.reloadIgnoringCache(); break;
      case 'devtools': wc.toggleDevTools(); break;
      case 'resetZoom': wc.setZoomLevel(0); break;
      case 'zoomIn': wc.setZoomLevel(wc.getZoomLevel() + 0.5); break;
      case 'zoomOut': wc.setZoomLevel(wc.getZoomLevel() - 0.5); break;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
      case 'minimize': win.minimize(); break;
      case 'close': win.close(); break;
      case 'open-repo': await electronShell.openExternal(REPO_URL); break;
      default: return { ok: false, error: `azione menu sconosciuta: ${action}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { buildAppMenu, runMenuAction, REPO_URL };

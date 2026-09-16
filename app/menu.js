'use strict';
const { app, Menu, shell: electronShell } = require('electron');

const REPO_URL = 'https://github.com/aisessionmanager/aisessionmanager';

/**
 * Menu applicativo nativo.
 *
 * Vive in app/ e non in lib/ perche' dipende da Electron per natura: non
 * avrebbe senso verificarlo in isolamento. `sendToRenderer` arriva
 * dall'esterno per non dover conoscere la finestra.
 *
 * Le voci di Edit NON usano i `role` nativi: quelli agiscono sulla selezione
 * del documento, che nei terminali xterm non esiste (la selezione vive dentro
 * il canvas). Il renderer sa se il fuoco e' su un terminale e copia/incolla di
 * conseguenza (renderer/term-clipboard.js). Gli acceleratori sono solo quelli
 * che NON servono alla shell: Ctrl+C/Ctrl+Z/Ctrl+X restano al processo
 * (SIGINT, sospensione, nano).
 */
function buildAppMenu({ sendToRenderer, platform = process.platform } = {}) {
  const isMac = platform === 'darwin';
  const sendEdit = (action) => sendToRenderer('menu-edit', action);
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Nuova sessione', accelerator: 'CmdOrCtrl+N', click: () => sendToRenderer('menu-new-session') },
        { type: 'separator' },
        { label: 'Configurazione comandi…', accelerator: 'CmdOrCtrl+,', click: () => sendToRenderer('menu-open-config') },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Annulla', click: () => sendEdit('undo') },
        { label: 'Ripeti', click: () => sendEdit('redo') },
        { type: 'separator' },
        { label: 'Taglia', click: () => sendEdit('cut') },
        { label: 'Copia', accelerator: isMac ? 'Cmd+C' : 'Ctrl+Shift+C', click: () => sendEdit('copy') },
        { label: 'Incolla', accelerator: isMac ? 'Cmd+V' : 'Ctrl+Shift+V', click: () => sendEdit('paste') },
        { label: 'Seleziona tutto', accelerator: isMac ? 'Cmd+A' : undefined, click: () => sendEdit('selectAll') },
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
        { label: 'Repository PizzaManager', click: () => electronShell.openExternal(REPO_URL) },
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
      case 'open-config': wc.send('menu-open-config'); break;
      case 'quit': app.quit(); break;
      // Stessa strada del menu nativo: il renderer sa se il fuoco e' su un
      // terminale e usa la selezione di xterm (renderer/term-clipboard.js).
      // I metodi nativi di webContents agirebbero sulla selezione del documento,
      // che dentro un terminale non esiste.
      case 'undo': case 'redo': case 'cut': case 'copy': case 'paste': case 'selectAll':
        wc.send('menu-edit', action); break;
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

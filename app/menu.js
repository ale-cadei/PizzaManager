'use strict';
const { Menu, shell: electronShell } = require('electron');

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

module.exports = { buildAppMenu, REPO_URL };

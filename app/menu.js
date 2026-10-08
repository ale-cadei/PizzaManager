'use strict';
const { app, Menu, shell: electronShell } = require('electron');
const { isPlatformSupported } = require('../lib/notifications');
const { MENU_ITEM_ID: NOTIFICATIONS_ID } = require('./notify');

// La pagina pubblica dei download, non il repo del codice (privato): questo
// link lo apre chi usa l'app, e su un repo privato vedrebbe un 404.
const REPO_URL = 'https://github.com/JackGrieco/PizzaManager-releases';

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
        // Non lo zoom di pagina di Electron (ingrandiva anche la sidebar e
        // restava memorizzato): in un'app di terminali si cambia il testo del
        // terminale. Lo applica il renderer (renderer/term-font.js).
        { label: 'Testo del terminale più grande', accelerator: 'CmdOrCtrl+Plus', click: () => sendToRenderer('menu-term-font-bigger') },
        { label: 'Testo del terminale più piccolo', accelerator: 'CmdOrCtrl+-', click: () => sendToRenderer('menu-term-font-smaller') },
        { label: 'Testo del terminale normale', accelerator: 'CmdOrCtrl+0', click: () => sendToRenderer('menu-term-font-reset') },
        // Secondo acceleratore per «più grande»: su molte tastiere + è Shift+=
        { label: 'Testo del terminale più grande', accelerator: 'CmdOrCtrl+=', visible: false, click: () => sendToRenderer('menu-term-font-bigger') },
        { type: 'separator' },
        // Pannello delle modifiche (docs/plans/32). Non Ctrl+D: è EOF nella shell
        { label: 'Mostra modifiche', accelerator: 'CmdOrCtrl+Shift+M', click: () => sendToRenderer('menu-changes') },
        { type: 'separator' },
        { label: 'Colori…', click: () => sendToRenderer('menu-type-colors') },
        { label: 'Personaggi…', click: () => sendToRenderer('menu-pets') },
        // La spunta la tiene allineata app/notify.js; la preferenza vive nel renderer
        ...(isPlatformSupported(platform)
          ? [{ id: NOTIFICATIONS_ID, label: 'Notifiche di sistema', type: 'checkbox', checked: true, click: () => sendToRenderer('menu-notifications') }]
          : []),
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
        // La versione va mostrata: da quando l'app si scarica invece di
        // ricostruirla, "che versione hai?" non aveva risposta da nessuna
        // parte. `role: 'about'` apre il pannello di sistema, riempito da
        // setAboutPanelOptions (sotto): su macOS e' il posto che l'utente
        // cerca per abitudine.
        { role: 'about', label: 'Informazioni su PizzaManager' },
        { type: 'separator' },
        { label: 'PizzaManager: download e versioni', click: () => electronShell.openExternal(REPO_URL) },
      ],
    },
  ];
  // Senza queste opzioni il pannello mostra solo il nome; la versione e'
  // quella di package.json, cioe' quella del pacchetto che si e' scaricato.
  app.setAboutPanelOptions({
    applicationName: 'PizzaManager',
    applicationVersion: app.getVersion(),
    copyright: 'Gestore di sessioni di terminale per shell e assistenti',
  });
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
      case 'type-colors': wc.send('menu-type-colors'); break;
      case 'pets': wc.send('menu-pets'); break;
      case 'notifications': wc.send('menu-notifications'); break;
      case 'changes': wc.send('menu-changes'); break;
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

'use strict';
/* Uscita con file non salvati nella sessione editor (docs/plans/60).
 * Il renderer ha un beforeunload che, con file sporchi, annulla la chiusura
 * e chiede che fare. Electron, quando una pagina annulla, emette
 * will-prevent-unload e si ferma lì. Qui si ricorda che cosa la pagina ha
 * fermato (l'uscita dall'app, la chiusura della finestra, una ricarica) e,
 * quando il renderer conferma, si rifà quella. Non si chiama preventDefault
 * su will-prevent-unload: vorrebbe dire ignorare il beforeunload.
 * app/quit-capture.js non blocca mai, ma al quit ferma la cattura dello
 * scrollback: se la pagina annulla un quit, `onQuitCancelled` la fa ripartire. */

/**
 * @param {{app: Electron.App, ipcMain: Electron.IpcMain, BrowserWindow: typeof Electron.BrowserWindow,
 *   onQuitCancelled?: () => void}} o
 */
function installEditorCloseGuard({ app, ipcMain, BrowserWindow, onQuitCancelled = () => {} }) {
  let quitting = false;
  const closing = new Set();
  const pending = new Map(); // webContents.id → 'quit' | 'close' | 'reload'

  app.on('before-quit', () => { quitting = true; });
  app.on('browser-window-created', (_e, win) => {
    const id = win.webContents.id;
    // 'close' arriva prima del beforeunload della pagina
    win.on('close', () => closing.add(id));
    win.webContents.on('will-prevent-unload', () => {
      const what = quitting ? 'quit' : closing.has(id) ? 'close' : 'reload';
      pending.set(id, what);
      // Fermato: se l'utente annulla, la prossima richiesta è un'altra storia
      quitting = false;
      closing.delete(id);
      if (what === 'quit') onQuitCancelled();
    });
  });

  ipcMain.handle('editor-close-confirmed', (event) => {
    const id = event.sender.id;
    const what = pending.get(id) || null;
    pending.delete(id);
    if (what === 'quit') app.quit();
    else if (what === 'close') {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.close();
    } else if (what === 'reload') event.sender.reload();
    return { ok: true, what };
  });
}

module.exports = { installEditorCloseGuard };

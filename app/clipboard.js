'use strict';
const { clipboard } = require('electron');

/**
 * Appunti di sistema per il renderer (renderer/term-clipboard.js).
 *
 * Vive in app/ e non in lib/ perche' dipende da Electron per natura: la
 * selezione dei terminali xterm non e' quella del documento, quindi copia e
 * incolla passano da qui invece che dai `role` nativi del menu Edit.
 */
function registerClipboardHandlers(ipcMain) {
  ipcMain.handle('clipboard-write', (event, { text } = {}) => {
    if (typeof text !== 'string' || !text) return { ok: false, error: 'niente da copiare' };
    try {
      clipboard.writeText(text);
      return { ok: true };
    } catch (e) {
      console.error('[clipboard-write]', e);
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('clipboard-read', () => {
    try {
      return { ok: true, text: clipboard.readText() || '' };
    } catch (e) {
      console.error('[clipboard-read]', e);
      return { ok: false, error: String((e && e.message) || e), text: '' };
    }
  });
}

module.exports = { registerClipboardHandlers };

'use strict';
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { buildExport } = require('../lib/transcript-export');

/**
 * Esportare una conversazione in Markdown (docs/plans/23).
 *
 * Vive in app/ perché il percorso lo decide il dialog «Salva con nome»: il
 * renderer manda solo `{ source, id }` e non sceglie mai dove si scrive.
 * Prima si legge e si converte (se la conversazione non si legge lo si dice
 * subito, non dopo aver scelto il file), poi il dialog, poi la scrittura.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{ getWindow: () => (Electron.BrowserWindow|null) }} deps
 */
function registerExportHandlers(ipcMain, { getWindow }) {
  ipcMain.handle('export-conversation', async (event, { source, id } = {}) => {
    try {
      const built = await buildExport({ source, id });
      if (!built.ok) return built;
      const options = {
        title: 'Esporta la conversazione in Markdown',
        defaultPath: path.join(app.getPath('downloads'), built.fileName),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      };
      const win = getWindow();
      const r = await (win && !win.isDestroyed() ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
      if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
      // Su Linux (GTK) il filtro non aggiunge l'estensione a un nome scritto
      // senza. Il dialog però ha chiesto di sovrascrivere solo il nome senza
      // .md: quello con .md, se esiste già, non si tocca ('wx').
      const appended = !path.extname(r.filePath);
      const file = appended ? `${r.filePath}.md` : r.filePath;
      try {
        await fs.promises.writeFile(file, built.markdown, { encoding: 'utf8', flag: appended ? 'wx' : 'w' });
      } catch (e) {
        if (e && e.code === 'EEXIST') return { ok: false, error: `${path.basename(file)} esiste già: scegli un altro nome.` };
        throw e;
      }
      return { ok: true, path: file };
    } catch (e) {
      console.error('[export-conversation]', e);
      return { ok: false, error: 'Esportazione non riuscita: ' + String((e && e.message) || e) };
    }
  });
}

module.exports = { registerExportHandlers };

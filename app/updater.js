'use strict';
const { updateMode, bannerText, DOWNLOAD_URL, CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS } = require('../lib/update-policy');

/**
 * Aggiornamento automatico: l'app legge il manifesto della Release pubblica,
 * scarica in background e offre il riavvio quando il pacchetto e' pronto.
 *
 * Sta in app/ perche' vive su `autoUpdater` e sul ciclo di vita di Electron;
 * le regole di «chi puo' aggiornarsi» stanno in lib/update-policy.js, dove si
 * verificano senza avviare niente.
 *
 * L'indirizzo da cui scaricare NON e' qui: electron-builder lo scrive dentro
 * al pacchetto (`app-update.yml`) al momento del build, dalla sezione
 * `publish` di package.json. Per questo un'app costruita dal repo privato
 * cerca gli aggiornamenti in quello pubblico, e per questo in sviluppo non
 * funziona: quel file non c'e'.
 */
function registerUpdateHandlers(ipcMain, { electron, sendToRenderer, autoUpdater: injected } = {}) {
  const { app, shell } = electron;
  const mode = updateMode({ isPackaged: app.isPackaged });

  /** Ultimo stato noto: il renderer puo' nascere dopo l'evento e deve ritrovarlo. */
  let last = { state: 'idle', mode };

  const publish = (next) => {
    last = { ...next, mode };
    const text = bannerText(last);
    // Si manda sempre, anche null: e' cosi' che il banner sa sparire.
    sendToRenderer('update-state', text ? { ...text, state: last.state, version: last.version } : null);
  };

  ipcMain.handle('update-state', () => {
    const text = bannerText(last);
    return text ? { ...text, state: last.state, version: last.version } : null;
  });

  ipcMain.handle('update-apply', async () => {
    // In modalita' manuale non c'e' niente da installare: si apre la pagina.
    if (last.action === 'download' || mode === 'manual') {
      await shell.openExternal(DOWNLOAD_URL);
      return { ok: true, opened: true };
    }
    if (last.state !== 'ready') return { ok: false, error: 'Nessun aggiornamento pronto.' };
    try {
      // Con tmux le sessioni sopravvivono al riavvio dell'app e si
      // riattaccano da sole (piano 06): chiudere qui non costa niente.
      updater().quitAndInstall();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('update-dismiss', () => {
    // «Più tardi» nasconde il banner ma non annulla il download: alla prossima
    // apertura l'aggiornamento e' gia' lì.
    publish({ state: 'idle' });
    return { ok: true };
  });

  if (mode === 'off') return { mode };

  let cached = null;
  function updater() {
    if (cached) return cached;
    // Richiesto qui e non in testa al file: in sviluppo non si carica affatto.
    cached = injected || require('electron-updater').autoUpdater;
    cached.autoDownload = mode === 'auto';
    cached.autoInstallOnAppQuit = mode === 'auto';
    cached.on('update-available', (info) => publish({ state: mode === 'auto' ? 'downloading' : 'ready', version: info && info.version, percent: 0 }));
    cached.on('download-progress', (p) => publish({ state: 'downloading', version: last.version, percent: p && p.percent }));
    cached.on('update-downloaded', (info) => publish({ state: 'ready', version: (info && info.version) || last.version }));
    // Un errore non deve diventare un allarme: spesso e' solo la rete. Si
    // mostra una volta e si riprova al controllo dopo.
    cached.on('error', (e) => publish({ state: 'error', error: String((e && e.message) || e) }));
    return cached;
  }

  const check = () => {
    try {
      updater().checkForUpdates();
    } catch (e) {
      publish({ state: 'error', error: String((e && e.message) || e) });
    }
  };

  const first = setTimeout(check, FIRST_CHECK_DELAY_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  // Due timer non devono tenere vivo il processo da soli.
  if (first.unref) first.unref();
  if (every.unref) every.unref();

  return { mode, check };
}

module.exports = { registerUpdateHandlers };

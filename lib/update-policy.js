'use strict';

/**
 * Chi puo' aggiornarsi da se', e cosa dire all'utente.
 *
 * Puro: nessun require di electron, cosi' le regole si verificano senza
 * avviare l'app. Il pezzo che tocca `autoUpdater` sta in app/updater.js.
 *
 * I pacchetti si prendono da un repo pubblico che contiene solo le Release
 * (docs/plans/44-release-firmata.md): e' quello che rende possibile
 * l'aggiornamento senza mettere un token dentro l'app.
 */

/** La pagina da aprire quando l'app non puo' aggiornarsi da se'. */
const DOWNLOAD_URL = 'https://github.com/JackGrieco/PizzaManager-releases/releases/latest';
/** All'avvio e poi ogni 4 ore: le release sono rare, non serve di piu'. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** Il primo controllo non all'istante: l'avvio ha di meglio da fare. */
const FIRST_CHECK_DELAY_MS = 10000;

/**
 * `off` non controlla nemmeno, `auto` scarica e si sostituisce, `manual`
 * avvisa e manda al download.
 *
 * - **In sviluppo** (`npm start`) non si fa niente: il codice e' gia' quello
 *   corrente e manca `app-update.yml`, quindi ogni controllo sarebbe un errore
 *   nella console.
 * - **macOS** puo' perche' l'app e' firmata e notarizzata: Squirrel.Mac
 *   rifiuta gli aggiornamenti non firmati, ed e' il motivo per cui questa
 *   funzione e' arrivata solo dopo il piano 44.
 * - **Linux** solo da AppImage. In un `.deb` l'aggiornamento lo fa `apt`, e
 *   `electron-updater` non saprebbe dove scrivere: meglio dirlo che fallire.
 *   La variabile `APPIMAGE` la mette il formato stesso quando l'app parte.
 */
function updateMode({ platform = process.platform, isPackaged = true, appImage = process.env.APPIMAGE } = {}) {
  if (!isPackaged) return 'off';
  if (platform === 'linux' && !appImage) return 'manual';
  return 'auto';
}

/**
 * Cosa scrivere nel banner, o null se non c'e' niente da mostrare.
 * `action` dice cosa fa il tasto: `restart`, `download`, o nessun tasto.
 */
function bannerText({ state, version, percent, error, mode = 'auto' } = {}) {
  if (state === 'error') {
    return { message: `Aggiornamento non riuscito: ${error || 'errore sconosciuto'}`, action: null };
  }
  if (!version) return null;
  if (state === 'downloading') {
    const q = Number.isFinite(percent) ? Math.round(percent) : 0;
    return { message: `Sto scaricando la versione ${version}… ${q}%`, action: null, percent: q };
  }
  if (state !== 'ready') return null;
  if (mode === 'manual') {
    // Il .deb non si sostituisce da se': si dice che c'e' e si apre la pagina.
    return { message: `È disponibile la versione ${version}`, action: 'download' };
  }
  // Si offre il riavvio solo a scaricamento finito: il pacchetto e' gia' sul
  // disco, quindi premere "Riavvia" costa due secondi e non 100 MB di attesa.
  return { message: `La versione ${version} è pronta`, action: 'restart' };
}

module.exports = { updateMode, bannerText, DOWNLOAD_URL, CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS };

'use strict';

/**
 * Un'ultima cattura dello scrollback prima che l'app esca.
 *
 * E' un di piu', non la protezione principale: a uno spegnimento brusco — o a
 * un `kill` — questo evento non arriva mai, ed e' il salvataggio a intervalli
 * (app/pty.js) a fare il lavoro vero. Per questo ha un tetto di tempo e non
 * deve MAI poter impedire la chiusura: meglio perdere mezzo minuto di testo
 * che avere un'app che non si chiude.
 *
 * Un quit si puo' annullare: il beforeunload dell'editor lo ferma se ci sono
 * file non salvati (app/editor-close.js). Allora `reset()` rimette tutto come
 * prima: la cattura a intervalli riparte e il quit successivo rifa' quella
 * finale.
 *
 * Sta in app/ perche' vive sul ciclo di vita di Electron.
 */
const GRACE_MS = 1000;

function installQuitCapture({ app, ptys, graceMs = GRACE_MS }) {
  let quitting = false;
  app.on('before-quit', (e) => {
    // Il secondo giro (quello dopo app.quit()) deve passare, o l'app resta su.
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    ptys.stopCapture();
    const entro = new Promise((r) => setTimeout(r, graceMs));
    Promise.race([ptys.captureDirty(), entro]).catch(() => {}).then(() => app.quit());
  });
  return {
    /** Il quit e' stato annullato: si torna a catturare. */
    reset() {
      quitting = false;
      ptys.startCapture();
    },
  };
}

module.exports = { installQuitCapture, GRACE_MS };

'use strict';

/**
 * La riga di contesto allegata a una segnalazione.
 *
 * Senza, ogni scambio comincia con «che versione hai? su che sistema? hai
 * tmux?» — e la risposta a quest'ultima spiega da sola meta' delle
 * segnalazioni («le sessioni spariscono quando chiudo l'app»).
 *
 * Puro: i dati arrivano da chi la chiama (app/feedback.js li prende da
 * `app.getVersion()` e dal controllo dei binari).
 */

const SISTEMI = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Una riga sola: finisce in fondo a una issue, non e' un rapporto diagnostico. */
function diagnosticLine({ version, platform, tmux, clis } = {}) {
  const pezzi = [];
  pezzi.push(`PizzaManager ${version || 'versione sconosciuta'}`);
  pezzi.push(SISTEMI[platform] || platform || 'sistema sconosciuto');
  // Su Windows il backend e' psmux, che viaggia nel pacchetto (docs/plans/52):
  // «senza psmux» vuol dire che l'exe non e' partito, non che manca qualcosa.
  const backend = platform === 'win32' ? 'psmux' : 'tmux';
  pezzi.push(tmux ? `con ${backend}` : `senza ${backend}`);
  const trovate = Object.entries(clis || {}).filter(([, c]) => c).map(([n]) => n);
  pezzi.push(trovate.length ? trovate.join(', ') : 'nessuna CLI trovata');
  return pezzi.join(' · ');
}

/**
 * Riduce l'esito di `checkDeps` a cio' che serve alla diagnostica: quali CLI
 * sono state trovate, e se c'e' tmux. Sta qui e non in main.js, che e' solo
 * cablaggio.
 */
function collectDeps(deps, agents, tmux) {
  const clis = {};
  for (const a of agents || []) {
    const voce = deps && deps[a.type];
    if (voce && voce.found) clis[a.type] = true;
  }
  return { tmux: Boolean(tmux), clis };
}

module.exports = { diagnosticLine, collectDeps };

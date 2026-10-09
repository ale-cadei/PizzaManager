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
  // Su Windows tmux non esiste: dire «senza tmux» la' sarebbe una colpa che
  // non c'e'.
  if (platform !== 'win32') pezzi.push(tmux ? 'con tmux' : 'senza tmux');
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

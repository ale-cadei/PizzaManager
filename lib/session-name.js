'use strict';
/* Il nome che l'utente dà a una sessione arriva alla CLI (docs/plans/83).
   Claude ha un flag di avvio; opencode no, e il nome passa al plugin del
   piano 46 per variabile d'ambiente. Codex e agy lo cambiano solo da dentro
   la loro interfaccia: niente. */
const { hasFlag, NAME_ENV, ID_ENV } = require('./agent-hooks');

/* Come NAME_MAX di renderer/session-titles.js: il nome che l'utente vede. */
const NAME_MAX = 60;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/* Flag che, se il profilo li ha già, vincono sul nome della scheda. */
const CLAUDE_NAME_FLAGS = Object.freeze(['-n', '--name']);
const NOTHING = Object.freeze({ args: Object.freeze([]), env: Object.freeze({}) });

/**
 * Il nome pulito: niente caratteri di controllo (arrivano dall'input
 * dell'utente e finirebbero nel titolo del terminale), spazi compattati.
 * @param {unknown} name
 * @returns {string} '' se non c'è niente da usare
 */
function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/**
 * Argomenti e variabili da AGGIUNGERE per dare il nome alla sessione.
 *
 * Claude: `--name=<nome>` in un solo argomento, così un nome che comincia con
 * `-` resta il valore. Insieme a `--resume` rinomina la conversazione.
 *
 * opencode: le variabili ci sono sempre, vuote senza nome: quelle dell'app
 * (avviata da una scheda opencode con un nome) non devono passare a un'altra
 * sessione, come il file del segnale (withoutSignal, piano 59).
 *
 * @param {string} type tipo di sessione
 * @param {unknown} name il nome scelto dall'utente (mai uno generato)
 * @param {{ args?: string[], resumeId?: string|null }} [opts] argomenti del profilo, sessione ripresa
 * @returns {{ args: string[], env: Record<string,string> }}
 */
function nameInjection(type, name, { args = [], resumeId = null } = {}) {
  const clean = cleanName(name);
  if (type === 'claude') {
    if (!clean || CLAUDE_NAME_FLAGS.some((f) => hasFlag(args, f))) return NOTHING;
    return { args: [`--name=${clean}`], env: {} };
  }
  if (type === 'opencode') {
    return { args: [], env: { [NAME_ENV]: clean, [ID_ENV]: (clean && resumeId) || '' } };
  }
  return NOTHING;
}

module.exports = { nameInjection, cleanName, NAME_MAX, NAME_ENV, ID_ENV };

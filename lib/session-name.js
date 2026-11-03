'use strict';
/* Il nome che l'utente dà a una sessione arriva alla CLI (docs/plans/83).
   Solo Claude ha un flag di avvio: opencode, codex e agy lo cambiano solo da
   dentro la loro interfaccia. */
const { hasFlag } = require('./agent-hooks');

/* Come NAME_MAX di renderer/session-titles.js: il nome che l'utente vede. */
const NAME_MAX = 60;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/* Flag che, se il profilo li ha già, vincono sul nome della scheda. */
const NAME_FLAGS = Object.freeze({ claude: Object.freeze(['-n', '--name']) });

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
 * Argomenti da AGGIUNGERE per dare il nome alla sessione.
 * `--name=<nome>` in un solo argomento: un nome che comincia con `-` resta il
 * valore e non diventa un'opzione.
 * @param {string} type tipo di sessione
 * @param {unknown} name il nome scelto dall'utente (mai uno generato)
 * @param {string[]} [args] gli argomenti del profilo
 * @returns {string[]}
 */
function nameArgs(type, name, args = []) {
  const flags = NAME_FLAGS[type];
  if (!flags) return [];
  const clean = cleanName(name);
  if (!clean || flags.some((f) => hasFlag(args, f))) return [];
  return [`--name=${clean}`];
}

module.exports = { nameArgs, cleanName, NAME_MAX };

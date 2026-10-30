/* Istanza di prova accanto all'app installata: `AISESS_PROFILE=prova npm start`.
 * Con un profilo l'app usa una cartella dei dati sua (AISessionManager-prova)
 * e un socket tmux suo (aisession-prova): non riattacca le sessioni dell'app
 * vera e non ne riscrive live-sessions.json, editor-sessions.json, profili.
 * Senza profilo i nomi sono quelli di sempre (vedi USER_DATA_DIR_NAME in
 * main.js: la cartella non deve mai cambiare da sola). */

const BASE_SOCKET = 'aisession';
// Finisce in un percorso e in `tmux -L`: niente separatori, spazi o punti
const VALID = /^[a-z0-9][a-z0-9-]{0,31}$/i;

/**
 * @param {Record<string, string|undefined>} env di solito process.env
 * @param {string} baseDir la cartella dei dati di sempre (USER_DATA_DIR_NAME)
 * @returns {{ name: string|null, userDataDir: string, socket: string }}
 * @throws se AISESS_PROFILE c'è ma non è un nome valido
 */
function devProfile(env, baseDir) {
  const name = env.AISESS_PROFILE || '';
  if (!name) return { name: null, userDataDir: baseDir, socket: BASE_SOCKET };
  if (!VALID.test(name)) {
    throw new Error(`AISESS_PROFILE non valido: «${name}». Lettere, cifre e trattini, al massimo 32.`);
  }
  return { name, userDataDir: `${baseDir}-${name}`, socket: `${BASE_SOCKET}-${name}` };
}

module.exports = { devProfile };

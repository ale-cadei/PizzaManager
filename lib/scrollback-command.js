'use strict';
const { SEPARATOR } = require('./scrollback');

/**
 * Il comando iniziale di una sessione tmux che riparte con il testo di prima.
 *
 * Dietro tmux lo scrollback di xterm vale 0 e tmux ridisegna sopra: il testo
 * va messo nella history di TMUX, cioe' stampato dentro la sessione prima che
 * parta la shell. Da qui il guscio `sh -c`.
 *
 * La regola del repo — i comandi vanno in pty.spawn senza shell — protegge dai
 * comandi dell'UTENTE, che non devono essere interpretati (pipe, redirezioni,
 * alias). Qui il comando e' dell'app e la stringa dopo `-c` e' una costante di
 * questo file: niente di variabile ci viene interpolato. Il file da stampare e
 * la shell da lanciare viaggiano nell'ambiente; gli argomenti del profilo
 * restano argomenti, passati dopo lo script e ripresi con "$@" — `sh` li
 * espande uno per uno, senza rileggerne il contenuto. Vale solo per le shell:
 * gli agenti non passano mai di qui.
 *
 * `exec` sostituisce il guscio con la shell vera: senza, resterebbe un `sh`
 * intermedio come genitore (e come pane_current_command).
 */
/**
 * Il separatore lo stampa `printf`, quindi le sequenze vanno nella forma che
 * capisce lui: ESC come \033, a capo come \n. La fonte resta una sola
 * (SEPARATOR in lib/scrollback.js), cosi' il percorso senza tmux — che scrive
 * la stessa riga con term.write — non ne tiene una copia diversa.
 */
function toPrintfArg(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\x1b/g, '\\033').replace(/\r/g, '').replace(/\n/g, '\\n');
}

const REPLAY_SCRIPT = `cat "$AIS_SCROLLBACK"; printf '${toPrintfArg(SEPARATOR)}'; exec "$AIS_SHELL" "$@"`;
/** Finisce in $0: un nome che si riconosce se compare in un messaggio d'errore. */
const ARGV0 = 'ais-scrollback';

/** null quando non c'e' niente da ripristinare o la strada non e' questa (Windows). */
function replayCommand({ file, shell, args = [], platform = process.platform } = {}) {
  if (platform === 'win32') return null;
  if (!file || !shell) return null;
  return {
    cmd: '/bin/sh',
    args: ['-c', REPLAY_SCRIPT, ARGV0, ...args.map(String)],
    env: { AIS_SCROLLBACK: String(file), AIS_SHELL: String(shell) },
  };
}

module.exports = { replayCommand, REPLAY_SCRIPT, ARGV0, toPrintfArg };

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

/**
 * Windows, dentro psmux (docs/plans/52). Non c'e' exec, ma non serve un
 * guscio: e' PowerShell stessa a stampare il file e poi, con -NoExit, a
 * restare la shell interattiva. Stesso patto della versione Unix: lo script
 * e' una costante, file e separatore viaggiano nell'ambiente.
 *
 * Windows PowerShell 5.1 scrive nella codifica OEM della console (850): l'euro
 * e le emoji del testo salvato diventerebbero «?». Si stampa in UTF-8 e poi si
 * rimette la codifica di prima, perche' la shell che resta si comporti come
 * sempre. Il nome della variabile e' improbabile apposta: il profilo
 * dell'utente gira prima di -Command.
 */
const REPLAY_SCRIPT_POWERSHELL = [
  '$__aisEnc = [Console]::OutputEncoding',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '[Console]::Out.Write([IO.File]::ReadAllText($env:AIS_SCROLLBACK))',
  '[Console]::Out.Write($env:AIS_SCROLLBACK_SEP)',
  '[Console]::OutputEncoding = $__aisEnc',
  'Remove-Variable __aisEnc',
].join('; ');

const POWERSHELL_RE = /^(powershell|pwsh)(\.exe)?$/i;
/** Flag che non cambiano cosa esegue PowerShell: con questi il replay si puo' aggiungere. */
const HARMLESS_FLAGS = new Set(['-nologo', '-noprofile', '-noexit']);

function replayPowerShell({ file, shell, args }) {
  const name = String(shell).split(/[\\/]/).pop();
  if (!POWERSHELL_RE.test(name)) return null;
  // -Command, -File, un argomento posizionale (che 5.1 prende come -Command):
  // il nostro -Command entrerebbe in conflitto. La shell parte e basta.
  if (!args.every((a) => HARMLESS_FLAGS.has(String(a).toLowerCase()))) return null;
  return {
    cmd: shell,
    args: [...args.map(String), '-NoLogo', '-NoExit', '-Command', REPLAY_SCRIPT_POWERSHELL],
    env: { AIS_SCROLLBACK: String(file), AIS_SCROLLBACK_SEP: SEPARATOR },
  };
}

/** null quando non c'e' niente da ripristinare o la shell non sa ristampare il testo. */
function replayCommand({ file, shell, args = [], platform = process.platform } = {}) {
  if (!file || !shell) return null;
  if (platform === 'win32') return replayPowerShell({ file, shell, args });
  return {
    cmd: '/bin/sh',
    args: ['-c', REPLAY_SCRIPT, ARGV0, ...args.map(String)],
    env: { AIS_SCROLLBACK: String(file), AIS_SHELL: String(shell) },
  };
}

module.exports = { replayCommand, REPLAY_SCRIPT, REPLAY_SCRIPT_POWERSHELL, ARGV0, toPrintfArg };

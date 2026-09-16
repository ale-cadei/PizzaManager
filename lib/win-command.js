/* Avvio di script `.cmd`/`.bat` su Windows.
 *
 * Un `.cmd` (è così che npm -g installa `claude`, `codex`…) non è un
 * eseguibile: lo interpreta cmd.exe. Va quindi lanciato come
 * `cmd.exe /d /s /c "<script> <argomenti>"`, e la riga tra virgolette la
 * rilegge cmd.exe con le sue regole, non quelle di CreateProcess: spazi e
 * metacaratteri si proteggono con `^`, e gli script rileggono `%*` una
 * seconda volta, quindi per loro l'escape si applica due volte.
 *
 * Le regole sono quelle di cross-spawn (lib/util/escape.js, MIT), che è il
 * riferimento di fatto per questo problema. node-pty su Windows accetta la
 * riga di comando già composta (una stringa al posto dell'argv), così non
 * la ricompone con le regole sbagliate.
 *
 * Modulo puro: niente I/O, niente Electron. */
'use strict';

const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function needsCmdWrapper(bin) {
  return /\.(cmd|bat)$/i.test(String(bin || ''));
}

/** Il comando non va tra virgolette: si proteggono i singoli caratteri. */
function escapeCommand(arg) {
  return String(arg).replace(META_CHARS, '^$1');
}

/** Un argomento: tra virgolette, con le virgolette interne e i backslash finali raddoppiati. */
function escapeArgument(arg, doubleEscapeMetaChars) {
  let s = String(arg);
  s = s.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  s = s.replace(/(?=(\\+?)?)\1$/, '$1$1');
  s = `"${s}"`;
  s = s.replace(META_CHARS, '^$1');
  if (doubleEscapeMetaChars) s = s.replace(META_CHARS, '^$1');
  return s;
}

/**
 * Riga di comando per `cmd.exe`, da passare a node-pty come stringa.
 * @param {string} bin percorso dello script
 * @param {string[]} args
 * @returns {string} es. `/d /s /c "C:\x\claude.cmd --resume abc"`
 */
function windowsCommandLine(bin, args = []) {
  const doubleEscape = needsCmdWrapper(bin);
  const inner = [escapeCommand(bin), ...args.map((a) => escapeArgument(a, doubleEscape))].join(' ');
  return `/d /s /c "${inner}"`;
}

module.exports = { needsCmdWrapper, windowsCommandLine, escapeCommand, escapeArgument };

// Come nasce una sessione tmux che prima rimette il testo di prima e poi
// diventa la shell dell'utente.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { replayCommand, REPLAY_SCRIPT, ARGV0 } = require('../lib/scrollback-command');

const file = '/Users/x/Library/Application Support/AISessionManager/scrollback/ais-shell-1.txt';
// Il comando vale su macOS e Linux: lo si prova su quelle piattaforme anche
// quando i test girano su Windows (dove replayCommand restituisce null).
const unix = { platform: 'darwin' };

ok('il comando e una costante: niente di variabile finisce nella riga', () => {
  const c = replayCommand({ file, shell: '/bin/zsh', args: ['-i'], ...unix });
  // La regola del repo (comandi senza shell) protegge dai comandi DELL'UTENTE.
  // Qui il comando e' dell'app: la stringa dopo -c e' fissa e il percorso
  // viaggia nell'ambiente, che nessun parser interpreta.
  assert.deepStrictEqual(c.args, ['-c', REPLAY_SCRIPT, ARGV0, '-i']);
  assert.ok(!JSON.stringify(c.args).includes('ais-shell-1'), 'il percorso non deve comparire negli argomenti');
  assert.ok(!JSON.stringify(c.args).includes('zsh'), 'nemmeno la shell da lanciare');
  assert.strictEqual(c.env.AIS_SCROLLBACK, file);
  assert.strictEqual(c.env.AIS_SHELL, '/bin/zsh');
});

ok('gli argomenti del profilo arrivano alla shell', () => {
  // Il profilo di default e' `<shell> -i`: perdere -i darebbe una shell non
  // interattiva, cioe' senza prompt ne' configurazione dell'utente.
  const c = replayCommand({ file, shell: '/bin/zsh', args: ['-i'], ...unix });
  assert.deepStrictEqual(c.args.slice(2), [ARGV0, '-i'], 'dopo lo script vengono $0 e poi gli argomenti');
  assert.match(REPLAY_SCRIPT, /exec "\$AIS_SHELL" "\$@"$/, '"$@" li espande uno per uno, senza rileggerli');
  const senza = replayCommand({ file, shell: '/bin/zsh', ...unix });
  assert.deepStrictEqual(senza.args, ['-c', REPLAY_SCRIPT, ARGV0], 'senza argomenti resta solo $0');
});

ok('il testo vecchio viene prima, la shell sostituisce il guscio', () => {
  // `exec` e' cio' che fa trovare zsh come pane_current_command invece di sh:
  // senza, resterebbe un processo intermedio a fare da genitore.
  assert.match(REPLAY_SCRIPT, /^cat /, 'il testo vecchio va stampato per primo');
  assert.match(REPLAY_SCRIPT, /exec "\$AIS_SHELL"/);
  assert.match(REPLAY_SCRIPT, /\$AIS_SCROLLBACK/);
});

ok('senza file o senza shell non si ripristina niente', () => {
  assert.strictEqual(replayCommand({ file: null, shell: '/bin/zsh', ...unix }), null);
  assert.strictEqual(replayCommand({ file, shell: '', ...unix }), null);
});

ok('su Windows non esiste questa strada: la cattura la fa il renderer', () => {
  assert.strictEqual(replayCommand({ file, shell: 'powershell.exe', platform: 'win32' }), null);
  assert.ok(replayCommand({ file, shell: '/bin/bash', platform: 'linux' }), 'su Linux vale come su macOS');
});

ok('il separatore ha una fonte sola, tradotta per printf', () => {
  const { SEPARATOR } = require('../lib/scrollback');
  const { toPrintfArg } = require('../lib/scrollback-command');
  assert.strictEqual(toPrintfArg('\x1b[2mx\x1b[0m\r\n'), '\\033[2mx\\033[0m\\n');
  assert.ok(REPLAY_SCRIPT.includes(toPrintfArg(SEPARATOR)), 'lo script stampa proprio quel separatore');
  assert.ok(!REPLAY_SCRIPT.includes('\x1b'), 'un ESC vero dentro lo script arriverebbe storto a sh');
  // Una virgoletta singola nel separatore chiuderebbe l'argomento di printf.
  assert.ok(!SEPARATOR.includes("'"), 'il separatore non puo contenere virgolette singole');
});

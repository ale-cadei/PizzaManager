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

ok('su Linux vale come su macOS', () => {
  assert.strictEqual(replayCommand({ file, shell: '/bin/bash', platform: 'linux' }).cmd, '/bin/sh');
});

/* Windows, dentro psmux (docs/plans/52, Q7 di 40-risultati.md). Non c'e' exec:
   e' PowerShell stessa a stampare il file e poi restare interattiva
   (-NoExit), quindi nessun guscio in mezzo. Provato nel psmux vero: colori,
   accenti, euro ed emoji, il separatore passato con -e, prompt che risponde. */
const winFile = 'C:\\Users\\jack\\AppData\\Roaming\\AISessionManager\\scrollback\\ais-shell-1.txt';
const win = { platform: 'win32' };

ok('win: PowerShell stampa il testo di prima e resta la shell, lo script e una costante', () => {
  const { REPLAY_SCRIPT_POWERSHELL } = require('../lib/scrollback-command');
  const { SEPARATOR } = require('../lib/scrollback');
  const c = replayCommand({ file: winFile, shell: 'powershell.exe', ...win });
  assert.deepStrictEqual(c, {
    cmd: 'powershell.exe',
    args: ['-NoLogo', '-NoExit', '-Command', REPLAY_SCRIPT_POWERSHELL],
    env: { AIS_SCROLLBACK: winFile, AIS_SCROLLBACK_SEP: SEPARATOR },
  });
  assert.ok(!JSON.stringify(c.args).includes('ais-shell-1'), 'il percorso viaggia nell ambiente, non nella riga');
});

ok('win: lo script stampa in UTF-8 e rimette la codifica dell utente, senza lasciare variabili', () => {
  const { REPLAY_SCRIPT_POWERSHELL: s } = require('../lib/scrollback-command');
  // Windows PowerShell 5.1 scrive nella codifica OEM (850): l'euro e le emoji
  // diventavano «?». La shell che resta deve pero' comportarsi come sempre.
  assert.match(s, /\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8/);
  assert.match(s, /\[Console\]::OutputEncoding = \$__aisEnc; Remove-Variable __aisEnc$/, 'codifica rimessa e variabile tolta, per ultime');
  assert.ok(s.indexOf('$env:AIS_SCROLLBACK)') < s.indexOf('$env:AIS_SCROLLBACK_SEP'), 'prima il testo, poi il separatore');
  assert.ok(!/\$o\b/.test(s), 'il profilo dell utente gira prima di -Command: un nome comune potrebbe essere suo');
});

ok('win: pwsh e percorsi completi valgono, maiuscole o no; il comando resta quello del profilo', () => {
  for (const shell of ['pwsh.exe', 'PWSH', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE', 'C:/Program Files/PowerShell/7/pwsh.exe']) {
    const c = replayCommand({ file: winFile, shell, ...win });
    assert.ok(c, shell);
    assert.strictEqual(c.cmd, shell);
  }
});

ok('win: i flag innocui del profilo restano, prima dei nostri', () => {
  const c = replayCommand({ file: winFile, shell: 'powershell.exe', args: ['-NoProfile', '-NoLogo'], ...win });
  assert.deepStrictEqual(c.args.slice(0, 5), ['-NoProfile', '-NoLogo', '-NoLogo', '-NoExit', '-Command'], 'PowerShell accetta i flag ripetuti');
});

ok('win: con -Command, -File o un argomento posizionale nel profilo niente replay, la shell parte e basta', () => {
  for (const args of [['-Command', 'Get-Date'], ['-c', 'x'], ['-File', 'a.ps1'], ['script.ps1'], ['-ExecutionPolicy', 'Bypass'], ['-EncodedCommand', 'AA==']]) {
    assert.strictEqual(replayCommand({ file: winFile, shell: 'powershell.exe', args, ...win }), null, JSON.stringify(args));
  }
});

ok('win: le altre shell non hanno una strada per ristampare il testo', () => {
  for (const shell of ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'powershell_ise.exe']) {
    assert.strictEqual(replayCommand({ file: winFile, shell, ...win }), null, shell);
  }
  assert.strictEqual(replayCommand({ file: null, shell: 'powershell.exe', ...win }), null);
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

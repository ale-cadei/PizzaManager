const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const remote = require('../lib/remote-env');

/* ---------- ~/.ssh/config ---------- */

test('parseSshConfig: alias concreti, senza wildcard né negazioni', () => {
  const text = [
    '# commento',
    'Host nas',
    '  HostName 192.168.1.10',
    'Host web db  # due alias',
    'Host *',
    '  ServerAliveInterval 30',
    'Host *.lan !bad pc?',
    'host minuscolo',
    'Host=uguale',
  ].join('\n');
  assert.deepStrictEqual(remote.parseSshConfig(text).hosts, ['nas', 'web', 'db', 'minuscolo', 'uguale']);
});

test('parseSshConfig: alias ripetuti una volta sola, nell\'ordine del file', () => {
  assert.deepStrictEqual(remote.parseSshConfig('Host a\nHost b\nHost a\n').hosts, ['a', 'b']);
});

test('parseSshConfig: Include raccolti per chi legge i file', () => {
  const r = remote.parseSshConfig('Include config.d/*\nInclude ~/.ssh/altro "con spazio"\nHost x\n');
  assert.deepStrictEqual(r.includes, ['config.d/*', '~/.ssh/altro', 'con spazio']);
});

test('parseSshConfig: alias che ssh leggerebbe come opzione scartato', () => {
  assert.deepStrictEqual(remote.parseSshConfig('Host -oProxyCommand=x ok\n').hosts, ['ok']);
});

test('parseSshConfig: testo non stringa → nessun host', () => {
  assert.deepStrictEqual(remote.parseSshConfig(null), { hosts: [], includes: [] });
});

/* ---------- wsl.exe -l -q ---------- */

test('parseWslList: UTF-16LE con BOM, righe vuote e docker scartate', () => {
  const text = '\uFEFFUbuntu-24.04\r\nDebian\r\n\r\ndocker-desktop\r\ndocker-desktop-data\r\n';
  const buf = Buffer.from(text, 'utf16le');
  assert.deepStrictEqual(remote.parseWslList(buf), ['Ubuntu-24.04', 'Debian']);
});

test('parseWslList: accetta anche una stringa con i \\0 di un decode sbagliato', () => {
  assert.deepStrictEqual(remote.parseWslList('U\0b\0u\0n\0t\0u\0\r\0\n\0'), ['Ubuntu']);
});

/* ---------- chiave dell'ambiente ---------- */

test('envKey / parseEnvKey: andata e ritorno', () => {
  for (const env of [{ kind: 'local' }, { kind: 'ssh', host: 'nas' }, { kind: 'wsl', distro: 'Ubuntu-24.04' }]) {
    assert.deepStrictEqual(remote.parseEnvKey(remote.envKey(env)), env);
  }
});

test('parseEnvKey: vuoto o assente → locale (cronologia vecchia)', () => {
  assert.deepStrictEqual(remote.parseEnvKey(undefined), { kind: 'local' });
  assert.deepStrictEqual(remote.parseEnvKey(''), { kind: 'local' });
});

test('parseEnvKey: host non valido → null', () => {
  assert.strictEqual(remote.parseEnvKey('ssh:-oProxyCommand=sh'), null);
  assert.strictEqual(remote.parseEnvKey('ssh:a b'), null);
  assert.strictEqual(remote.parseEnvKey('ftp:x'), null);
  assert.strictEqual(remote.parseEnvKey('wsl:'), null);
});

test('envLabel: nome breve per la scheda', () => {
  assert.strictEqual(remote.envLabel({ kind: 'local' }), '');
  assert.strictEqual(remote.envLabel({ kind: 'ssh', host: 'nas' }), 'nas');
  assert.strictEqual(remote.envLabel({ kind: 'wsl', distro: 'Debian' }), 'WSL · Debian');
});

/* ---------- directory remota ---------- */

test('validateRemoteDir: ~, ~/… e assoluti; vuoto = ~', () => {
  assert.deepStrictEqual(remote.validateRemoteDir(''), { ok: true, dir: '~' });
  assert.deepStrictEqual(remote.validateRemoteDir(' ~/app/ '), { ok: true, dir: '~/app' });
  assert.deepStrictEqual(remote.validateRemoteDir('/srv/app'), { ok: true, dir: '/srv/app' });
  assert.deepStrictEqual(remote.validateRemoteDir('/'), { ok: true, dir: '/' });
});

test('validateRemoteDir: relativi, ~utente e caratteri di controllo rifiutati', () => {
  for (const bad of ['app', '~altro/x', '/a\nb', 'C:\\x', '/a\0b']) {
    assert.strictEqual(remote.validateRemoteDir(bad).ok, false, bad);
  }
});

/* ---------- quoting ---------- */

/** Fa girare la riga in un sh vero: è l'unica prova che il quoting regga. */
function shEcho(word) {
  return execFileSync('sh', ['-c', `printf '%s' ${word}`], { encoding: 'utf8', env: { HOME: '/casa' } });
}

test('shQuote: tutto arriva letterale alla shell', () => {
  for (const s of ["a b", "l'apice", '$HOME', '`id`', '"x"', 'a\\b', '*', '']) {
    assert.strictEqual(shEcho(remote.shQuote(s)), s, s);
  }
});

test('quoteHomePath: ~ espanso dal server, il resto letterale', () => {
  assert.strictEqual(shEcho(remote.quoteHomePath('~')), '/casa');
  assert.strictEqual(shEcho(remote.quoteHomePath("~/mio progetto/l'app")), "/casa/mio progetto/l'app");
  assert.strictEqual(shEcho(remote.quoteHomePath('/srv/$X')), '/srv/$X');
});

/* ---------- segreti ---------- */

test('remoteSecretProblem: variabili con chiavi rifiutate, le altre passano', () => {
  assert.strictEqual(remote.remoteSecretProblem({ CLAUDE_CONFIG_DIR: '~/.c' }), null);
  assert.match(remote.remoteSecretProblem({ ANTHROPIC_API_KEY: 'x', GH_TOKEN: 'y' }), /ANTHROPIC_API_KEY, GH_TOKEN/);
  assert.match(remote.remoteSecretProblem({ DB_PASSWORD: 'x' }), /DB_PASSWORD/);
});

/* ---------- riga remota ---------- */

test('remoteScript: cd nella directory e exec del comando nella shell di login', () => {
  const s = remote.remoteScript({ cwd: '~/app', bin: 'claude', args: ['--resume', 'u 1'], vars: {} });
  assert.match(s, /^cd -- ~\/'app' 2>\/dev\/null \|\| \{/);
  const inner = `exec ${remote.shQuote('claude')} ${remote.shQuote('--resume')} ${remote.shQuote('u 1')}`;
  assert.ok(s.endsWith(`exec "\${SHELL:-/bin/sh}" -lic ${remote.shQuote(inner)}`), s);
});

test('remoteScript: le variabili del profilo passano con env', () => {
  const s = remote.remoteScript({ cwd: '~', bin: 'claude', args: [], vars: { CLAUDE_CONFIG_DIR: '/x y' } });
  assert.match(s, /exec env CLAUDE_CONFIG_DIR='\/x y' "\$\{SHELL/);
});

test('remoteScript: shell = shell di login interattiva, niente comando', () => {
  const s = remote.remoteScript({ cwd: '/srv', shell: true });
  assert.match(s, /exec "\$\{SHELL:-\/bin\/sh\}" -il$/);
});

test('remoteScript: eseguita da sh, apre la directory e passa gli argomenti intatti', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), "ais remote '"));
  const s = remote.remoteScript({ cwd: dir, bin: 'printf', args: ['%s|', '$HOME', "a'b"], vars: {} });
  const out = execFileSync('sh', ['-c', s], { encoding: 'utf8', env: { HOME: '/casa', SHELL: '/bin/sh', PATH: process.env.PATH } });
  assert.strictEqual(out, "$HOME|a'b|");
  const pwd = execFileSync('sh', ['-c', remote.remoteScript({ cwd: dir, bin: 'pwd', args: [], vars: {} })], { encoding: 'utf8', env: { SHELL: '/bin/sh', PATH: process.env.PATH } });
  assert.strictEqual(pwd.trim(), require('fs').realpathSync(dir));
});

test('remoteScript: directory inesistente → avviso e home, la sessione parte lo stesso', () => {
  const s = remote.remoteScript({ cwd: '/non/esiste/proprio', bin: 'pwd', args: [], vars: {} });
  const r = require('child_process').spawnSync('sh', ['-c', s], { encoding: 'utf8', env: { HOME: '/', SHELL: '/bin/sh', PATH: process.env.PATH } });
  assert.strictEqual(r.stdout.trim(), '/');
  assert.match(r.stderr, /non trovata/);
});

test('wrapRemote ssh: -t, host dopo --, riga per sh -c', () => {
  const w = remote.wrapRemote({ env: { kind: 'ssh', host: 'nas' }, cwd: '~', bin: 'claude', args: [], vars: {}, sshBin: '/usr/bin/ssh' });
  assert.strictEqual(w.cmd, '/usr/bin/ssh');
  assert.deepStrictEqual(w.args.slice(0, 3), ['-t', '--', 'nas']);
  assert.strictEqual(w.args.length, 4);
  assert.match(w.args[3], /^sh -c '/);
});

test('wrapRemote ssh: la riga passata a sh -c sopravvive alla shell di login del server', () => {
  const w = remote.wrapRemote({ env: { kind: 'ssh', host: 'nas' }, cwd: '/', bin: 'printf', args: ["%s", "l'a $X"], vars: {}, sshBin: 'ssh' });
  // ssh consegna l'ultimo argomento alla shell di login: qui la simula sh
  const out = execFileSync('sh', ['-c', w.args[3]], { encoding: 'utf8', env: { SHELL: '/bin/sh', PATH: process.env.PATH } });
  assert.strictEqual(out, "l'a $X");
});

test('wrapRemote wsl: --exec sh -c con la riga intera', () => {
  const w = remote.wrapRemote({ env: { kind: 'wsl', distro: 'Debian' }, cwd: '~', shell: true, wslBin: 'wsl.exe' });
  assert.strictEqual(w.cmd, 'wsl.exe');
  assert.deepStrictEqual(w.args.slice(0, 5), ['-d', 'Debian', '--exec', 'sh', '-c']);
  assert.match(w.args[5], /^cd -- ~ /);
});

test('wrapRemote: ambiente locale o non valido → errore', () => {
  assert.throws(() => remote.wrapRemote({ env: { kind: 'local' }, cwd: '~', shell: true }));
  assert.throws(() => remote.wrapRemote({ env: { kind: 'ssh', host: '-x' }, cwd: '~', shell: true, sshBin: 'ssh' }));
});

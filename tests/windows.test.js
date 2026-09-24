const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Windows (docs/plans/12-windows.md). La macchina di sviluppo e la CI sono
   Unix: qui si inietta `platform: 'win32'` (e `path.win32` dove serve) nei
   moduli di lib/, che ricevono già piattaforma, home ed `exists` come
   parametri. La prova sul sistema vero è la checklist nel piano. */

const win = path.win32;
const HOME = 'C:\\Users\\jack';
const ENV = { APPDATA: 'C:\\Users\\jack\\AppData\\Roaming', USERPROFILE: HOME };

// ---------- lib/login-path ----------
const { computeLoginPath, computeLoginPathAsync, dedupePath } = require('../lib/login-path');

ok('win: dedupePath spezza sul ; e non sul :', () => {
  const out = dedupePath('C:\\a;C:\\b;C:\\a', { delimiter: ';' });
  assert.strictEqual(out, 'C:\\a;C:\\b');
});

ok('win: il PATH non si chiede a nessuna shell, è già quello dell utente', async () => {
  let called = 0;
  const env = { PATH: 'C:\\Windows;C:\\npm;C:\\Windows' };
  const sync = computeLoginPath({ platform: 'win32', env, exec: () => { called++; return ''; } });
  const async = await computeLoginPathAsync({ platform: 'win32', env, run: () => { called++; } });
  assert.strictEqual(called, 0, 'su Windows non si lancia nessuna shell -lc');
  assert.strictEqual(sync, 'C:\\Windows;C:\\npm');
  assert.strictEqual(async, 'C:\\Windows;C:\\npm');
});

// ---------- lib/binaries ----------
const { candidatesFor, resolveBinary, augmentedEnv, isExecutable } = require('../lib/binaries');

ok('win: i candidati coprono npm -g (.cmd), l installer nativo di Claude e le directory dedicate', () => {
  const claude = candidatesFor('claude', HOME, { platform: 'win32', env: ENV });
  assert.ok(claude.includes(win.join(ENV.APPDATA, 'npm', 'claude.cmd')), 'manca il wrapper .cmd di npm -g');
  assert.ok(claude.includes(win.join(HOME, '.local', 'bin', 'claude.exe')), 'manca l installer nativo');
  const codex = candidatesFor('codex', HOME, { platform: 'win32', env: ENV });
  assert.ok(codex.includes(win.join(ENV.APPDATA, 'npm', 'codex.cmd')));
  const oc = candidatesFor('opencode', HOME, { platform: 'win32', env: ENV });
  assert.ok(oc.includes(win.join(HOME, '.opencode', 'bin', 'opencode.exe')));
  for (const c of [...claude, ...codex, ...oc]) assert.ok(win.isAbsolute(c) && !c.includes('/'), `candidato non Windows: ${c}`);
});

ok('win: un nome senza estensione trova il .cmd o l .exe nel PATH, e il permesso x non conta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-win-'));
  // Su Windows non esiste il bit x: un file .cmd senza 0o755 è comunque eseguibile
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\n', { mode: 0o644 });
  fs.writeFileSync(path.join(dir, 'codex.exe'), 'MZ', { mode: 0o644 });
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x', { mode: 0o644 });
  try {
    const opts = { searchPath: dir, home: HOME, platform: 'win32', env: ENV };
    assert.strictEqual(resolveBinary('claude', opts).path, path.join(dir, 'claude.cmd'));
    assert.strictEqual(resolveBinary('codex', opts).path, path.join(dir, 'codex.exe'));
    // Con l'estensione già scritta non se ne aggiunge un'altra
    assert.strictEqual(resolveBinary('claude.cmd', opts).path, path.join(dir, 'claude.cmd'));
    assert.strictEqual(resolveBinary('note', opts).path, null, 'un .txt non è un eseguibile');
    assert.strictEqual(isExecutable(path.join(dir, 'note.txt'), { platform: 'win32' }), false);
    assert.strictEqual(isExecutable(path.join(dir, 'claude.cmd'), { platform: 'win32' }), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

ok('win: il PATH si spezza sul ; anche quando arriva dalla ricerca', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-win-'));
  fs.writeFileSync(path.join(dir, 'tool.exe'), 'MZ');
  try {
    const r = resolveBinary('tool', { searchPath: `C:\\nulla;${dir}`, home: HOME, platform: 'win32', env: ENV });
    assert.strictEqual(r.path, path.join(dir, 'tool.exe'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

ok('win: augmentedEnv riusa la chiave Path esistente invece di aggiungerne una seconda', () => {
  const env = augmentedEnv(['C:\\tools\\claude.cmd'], {}, { Path: 'C:\\Windows', HOMEPATH: '\\Users\\jack' },
    { platform: 'win32', searchPath: 'C:\\Windows', resolve: () => ({ path: null }) });
  assert.strictEqual(env.PATH, undefined, 'due chiavi PATH/Path in un env Windows sono ambigue');
  assert.strictEqual(env.Path, 'C:\\Windows;C:\\tools');
  assert.strictEqual(env.HOMEPATH, '\\Users\\jack');
  assert.strictEqual(env.TERM, 'xterm-256color');
});

// ---------- lib/win-command ----------
const { windowsCommandLine, needsCmdWrapper } = require('../lib/win-command');

ok('win: .cmd e .bat sono script di cmd.exe, gli .exe no', () => {
  assert.strictEqual(needsCmdWrapper('C:\\x\\claude.cmd'), true);
  assert.strictEqual(needsCmdWrapper('C:\\x\\run.BAT'), true);
  assert.strictEqual(needsCmdWrapper('C:\\x\\claude.exe'), false);
  assert.strictEqual(needsCmdWrapper('powershell.exe'), false);
});

ok('win: la riga per cmd.exe /s /c racchiude tutto tra virgolette e protegge spazi e metacaratteri', () => {
  const line = windowsCommandLine('C:\\Program Files\\npm\\claude.cmd', ['--resume', 'abc-123', 'ciao mondo', '50%']);
  assert.ok(line.startsWith('/d /s /c "'), line);
  assert.ok(line.endsWith('"'), line);
  // Lo spazio nel percorso del comando è protetto con ^, come fa cross-spawn
  assert.ok(line.includes('C:\\Program^ Files\\npm\\claude.cmd'), line);
  // Gli argomenti vanno tra virgolette e, per gli script .cmd che rileggono
  // %*, ogni metacarattere (spazio, virgolette, %) è protetto due volte
  assert.ok(line.includes('^^^"ciao^^^ mondo^^^"'), line);
  assert.ok(line.includes('^^^"50^^^%^^^"'), line);
  assert.ok(line.includes('--resume'), line);
});

// ---------- lib/commands ----------
const { buildCommand } = require('../lib/commands');
const { createProfileStore } = require('../lib/profiles');

function winProfiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-prof-'));
  return createProfileStore({ dir, shell: 'powershell.exe', platform: 'win32' });
}

ok('win: un binario .cmd viene lanciato tramite cmd.exe, con la riga di comando pronta per node-pty', () => {
  const resolve = () => ({ path: 'C:\\Users\\jack\\AppData\\Roaming\\npm\\claude.cmd', via: 'PATH:npm' });
  const r = buildCommand('claude', 'abc', null, { profiles: winProfiles(), home: HOME, env: { ...ENV, ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, platform: 'win32', resolve });
  assert.strictEqual(r.cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepStrictEqual(r.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(r.args[3].includes('claude.cmd') && r.args[3].includes('--resume abc'), r.args[3]);
  assert.strictEqual(typeof r.commandLine, 'string', 'node-pty su Windows accetta la riga di comando già composta');
  // Nella riga per cmd.exe gli argomenti sono escapati (vedi win-command): si
  // verifica che ci siano, non la forma esatta, che è coperta dal test sopra
  assert.ok(r.commandLine.startsWith('/d /s /c "') && r.commandLine.includes('--resume') && r.commandLine.includes('abc'), r.commandLine);
  assert.strictEqual(r.wrapped, 'C:\\Users\\jack\\AppData\\Roaming\\npm\\claude.cmd');
});

ok('win: un .exe si lancia direttamente, senza cmd.exe', () => {
  const resolve = () => ({ path: 'C:\\Users\\jack\\.local\\bin\\claude.exe', via: 'candidate' });
  const r = buildCommand('claude', null, null, { profiles: winProfiles(), home: HOME, env: ENV, platform: 'win32', resolve });
  assert.strictEqual(r.cmd, 'C:\\Users\\jack\\.local\\bin\\claude.exe');
  assert.deepStrictEqual(r.args, []);
  assert.strictEqual(r.commandLine, undefined);
});

/* Il test sotto usa un file vero in tmpdir: su Unix il percorso non ha
   backslash, quindi non vedeva il tokenizer mangiarli. Qui la stringa è
   quella che un utente Windows scrive nella configurazione comandi. */
ok('win: nei comandi dei profili il backslash è un separatore, e ~\ si espande', () => {
  const profiles = require('../lib/command-profiles');
  const r = profiles.resolveProfileCommand(
    { command: 'C:\\Tools\\claude.exe --add-dir ~\\repo', resumeArgs: '--resume {id}' },
    { home: HOME, platform: 'win32', resumeId: 'abc' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.bin, 'C:\\Tools\\claude.exe');
  assert.deepStrictEqual(r.args, ['--add-dir', 'C:\\Users\\jack\\repo', '--resume', 'abc']);
  assert.deepStrictEqual(profiles.tokenizeCommand('"C:\\Program Files\\x\\x.exe" --y', { platform: 'win32' }), ['C:\\Program Files\\x\\x.exe', '--y']);
  assert.deepStrictEqual(profiles.tokenizeCommand('C:\\Tools\\claude.exe', { platform: 'linux' }), ['C:Toolsclaude.exe'], 'su Unix resta un escape');
});

ok('win: un percorso con backslash o lettera di unità è esplicito, non un nome da cercare nel PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-win-'));
  const exe = path.join(dir, 'mio.exe');
  fs.writeFileSync(exe, 'MZ');
  try {
    const store = winProfiles();
    const cfg = store.load();
    store.save({ ...cfg, profiles: { ...cfg.profiles, claude: [{ id: 'claude:x', label: 'X', command: exe, resumeArgs: '' }] } });
    let searched = 0;
    const r = buildCommand('claude', null, 'claude:x', { profiles: store, home: HOME, env: ENV, platform: 'win32', resolve: () => { searched++; return { path: null }; } });
    assert.strictEqual(searched, 0);
    assert.strictEqual(r.cmd, exe);
    assert.strictEqual(r.resolvedVia, 'path-esplicito');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- lib/recent-dirs ----------
const { normalizeDir } = require('../lib/recent-dirs');

ok('win: le directory con lettera di unità o UNC sono assolute; C:\\ resta C:\\', () => {
  assert.strictEqual(normalizeDir('C:\\Users\\jack\\repo\\'), 'C:\\Users\\jack\\repo');
  assert.strictEqual(normalizeDir('C:/Users/jack/repo/'), 'C:/Users/jack/repo');
  assert.strictEqual(normalizeDir('C:\\'), 'C:\\');
  assert.strictEqual(normalizeDir('\\\\server\\share\\dir\\'), '\\\\server\\share\\dir');
  assert.strictEqual(normalizeDir('repo\\sub'), null, 'un percorso relativo non è una directory recente');
  assert.strictEqual(normalizeDir('/home/jack/'), '/home/jack', 'i percorsi POSIX restano come prima');
});

// ---------- lib/workdir ----------
const { resolveWorkdir } = require('../lib/workdir');

ok('win: ~ seguito da backslash si espande nella home', () => {
  const isDir = () => true;
  const out = resolveWorkdir('~\\repo', { home: os.homedir(), isDir });
  assert.strictEqual(out, path.resolve(path.join(os.homedir(), '\\repo')));
  assert.strictEqual(resolveWorkdir('~/repo', { home: '/home/jack', isDir }), path.resolve('/home/jack/repo'), 'su Unix come prima');
});

// ---------- lib/project-root ----------
const { findProjectRoot } = require('../lib/project-root');

ok('win: la radice si trova risalendo con i backslash, fino all unità', () => {
  const git = new Set(['C:\\Users\\jack\\repo\\.git']);
  const exists = (p) => git.has(p);
  assert.strictEqual(findProjectRoot('C:\\Users\\jack\\repo\\src\\deep', { exists, pathImpl: win }), 'C:\\Users\\jack\\repo');
  assert.strictEqual(findProjectRoot('C:\\Users\\jack\\altro', { exists, pathImpl: win }), 'C:\\Users\\jack\\altro', 'senza .git vale la directory di partenza');
});

// ---------- lib/claude-sessions ----------
const { cwdFromProjectDir } = require('../lib/claude-sessions');

ok('win: il nome della cartella di progetto di Claude torna un percorso con unità e backslash', () => {
  assert.strictEqual(cwdFromProjectDir('C--Users-jack-repo', { platform: 'win32' }), 'C:\\Users\\jack\\repo');
  assert.strictEqual(cwdFromProjectDir('-home-jack-repo', { platform: 'linux' }), '/home/jack/repo', 'su Unix come prima');
});

// ---------- lib/tmux ----------
const { detectTmux } = require('../lib/tmux');

ok('win: tmux non si cerca nemmeno', () => {
  let looked = 0;
  const r = detectTmux({ confPath: 'x', platform: 'win32', resolve: () => { looked++; return { path: 'C:\\msys64\\usr\\bin\\tmux.exe' }; } });
  assert.strictEqual(r, null);
  assert.strictEqual(looked, 0);
});

// ---------- renderer/session-groups ----------
const Groups = require('../renderer/session-groups');

ok('win: etichette e sottocartelle dei progetti capiscono i backslash', () => {
  assert.strictEqual(Groups.shortPath('C:\\Users\\jack\\repo'), 'jack/repo');
  assert.strictEqual(Groups.relativeSubpath('C:\\Users\\jack\\repo\\src\\api', 'C:\\Users\\jack\\repo'), 'src/api');
  assert.strictEqual(Groups.relativeSubpath('C:\\Users\\jack\\repo-bis', 'C:\\Users\\jack\\repo'), '', 'repo-bis non è dentro repo');
  const groups = Groups.groupSessions([
    { id: 'a', type: 'claude', projectRoot: 'C:\\Users\\jack\\repo' },
    { id: 'b', type: 'shell', projectRoot: 'D:\\lavoro\\repo' },
  ], { mode: 'project' });
  assert.deepStrictEqual(groups.map((g) => g.label), ['jack/repo', 'lavoro/repo'], 'due radici omonime si disambiguano col genitore');
});

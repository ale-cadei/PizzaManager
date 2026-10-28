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
const { filesFromClipboard, fileUriToPath, formatsFor } = require('../lib/clipboard-files');
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorCopy, pickProperties } = require('../lib/editor-copy');

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

/* Il PATH si legge e si scrive sotto la chiave che l'ambiente usa gia'. Leggere
   `env.PATH` da un env Windows (chiave `Path`) dava undefined: le sessioni
   psmux nascevano con PATH=undefined, e nessun comando si trovava piu'. */
ok('win: pathOf legge Path o PATH, withPath riscrive quella che c e', () => {
  const { pathOf, withPath } = require('../lib/binaries');
  assert.strictEqual(pathOf({ Path: 'C:\\Windows;C:\\npm' }), 'C:\\Windows;C:\\npm');
  assert.strictEqual(pathOf({ PATH: '/usr/bin' }), '/usr/bin');
  assert.strictEqual(pathOf({}), undefined);
  assert.deepStrictEqual(withPath({ Path: 'vecchio', HOMEPATH: '\\Users\\jack' }, 'nuovo'), { Path: 'nuovo', HOMEPATH: '\\Users\\jack' });
  assert.deepStrictEqual(withPath({ HOME: '/h' }, '/bin'), { HOME: '/h', PATH: '/bin' });
});

ok('win: il client che crea la sessione ha un solo PATH, quello della sessione', async () => {
  const { createTmuxControl } = require('../lib/tmux');
  const seen = [];
  const ctl = createTmuxControl({ bin: 'C:\\psmux.exe', confPath: 'C:\\psmux.conf', processEnv: { Path: 'C:\\Windows', USERPROFILE: HOME },
    run: (bin, args, opts, cb) => { seen.push(opts.env); cb(null, '', ''); } });
  await ctl.create({ name: 'ais-shell-1', cmd: 'powershell.exe', env: { PATH: 'C:\\Windows;C:\\Program Files\\Git\\cmd' } });
  const env = seen[0];
  assert.deepStrictEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH'), ['Path'], 'due chiavi PATH/Path sono ambigue');
  assert.strictEqual(env.Path, 'C:\\Windows;C:\\Program Files\\Git\\cmd');
  assert.strictEqual(env.USERPROFILE, HOME);
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

/* Gli hook del piano 46 si aggiungono prima di comporre la riga per cmd.exe:
   dopo, sarebbero fuori dalla riga che node-pty usa davvero. */
ok('win: gli argomenti iniettati finiscono nella riga di cmd.exe', () => {
  const resolve = () => ({ path: 'C:\\Users\\jack\\AppData\\Roaming\\npm\\claude.cmd', via: 'PATH:npm' });
  const seen = [];
  const inject = (args, env) => { seen.push([args, env]); return { args: ['--settings', '{"a":1}'], env: { X: '1' } }; };
  const r = buildCommand('claude', null, null, { profiles: winProfiles(), home: HOME, env: ENV, platform: 'win32', resolve, inject });
  assert.ok(r.commandLine.includes('--settings'), r.commandLine);
  assert.deepStrictEqual(r.injectedEnv, { X: '1' });
  assert.deepStrictEqual(r.baseArgs, [], 'gli args del profilo, senza iniezione: per la cronologia');
  assert.deepStrictEqual(seen, [[[], {}]], 'inject vede gli args e l env del profilo');
});

ok('senza inject il risultato non cambia: niente env aggiunta', () => {
  const resolve = () => ({ path: 'C:\\Users\\jack\\.local\\bin\\claude.exe', via: 'candidate' });
  const r = buildCommand('claude', null, null, { profiles: winProfiles(), home: HOME, env: ENV, platform: 'win32', resolve });
  assert.deepStrictEqual(r.injectedEnv, {});
  assert.deepStrictEqual(r.args, r.baseArgs);
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

/* git per Windows scrive il gitdir del worktree con gli slash (`C:/...`): la
   radice deve tornare coi backslash, uguale a quella del progetto principale. */
ok('win: un worktree appartiene al progetto principale anche con gitdir C:/...', () => {
  const files = {
    // a capo CRLF (git per Windows con autocrlf): il \r non finisce nel percorso
    'C:\\Users\\jack\\repo.worktrees\\feat-x\\.git': 'gitdir: C:/Users/jack/repo/.git/worktrees/feat-x\r\n',
    'C:\\Users\\jack\\repo\\.git\\worktrees\\feat-x\\commondir': '../..\r\n',
  };
  const exists = (p) => p in files || p === 'C:\\Users\\jack\\repo\\.git';
  const readFile = (p) => {
    if (!(p in files)) throw new Error(`ENOENT ${p}`);
    return files[p];
  };
  assert.strictEqual(findProjectRoot('C:\\Users\\jack\\repo.worktrees\\feat-x\\src', { exists, readFile, pathImpl: win }), 'C:\\Users\\jack\\repo');
});

// ---------- lib/git-graph ----------
const { readGitGraph } = require('../lib/git-graph');

/* git su Windows risponde `C:/Users/...` con gli slash, mentre findProjectRoot
   (e il resto dell'app) usa `C:\Users\...`. La sidebar raggruppa confrontando
   la stringa: senza normalizzare, la scheda git starebbe in un gruppo suo. */
ok('win: la radice di git arriva coi backslash, come quella di findProjectRoot', async () => {
  const run = async (args) => {
    if (args.includes('--show-toplevel')) return 'C:/Users/jack/repo\n';
    if (args.includes('remote')) return '';
    throw new Error('fatal: your current branch does not have any commits yet');
  };
  const r = await readGitGraph({ cwd: 'C:\\Users\\jack\\repo\\src', run, platform: 'win32' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.root, 'C:\\Users\\jack\\repo');
  assert.strictEqual(r.root, findProjectRoot('C:\\Users\\jack\\repo\\src', { exists: (p) => p === 'C:\\Users\\jack\\repo\\.git', pathImpl: win }));
});

ok('git: fuori da Windows la radice resta quella che dice git', async () => {
  const run = async (args) => {
    if (args.includes('--show-toplevel')) return '/Users/jack/repo\n';
    if (args.includes('remote')) return '';
    throw new Error('fatal: your current branch does not have any commits yet');
  };
  const r = await readGitGraph({ cwd: '/Users/jack/repo/src', run, platform: 'darwin' });
  assert.strictEqual(r.root, '/Users/jack/repo');
});

// ---------- lib/claude-sessions ----------
const { cwdFromProjectDir } = require('../lib/claude-sessions');

ok('win: il nome della cartella di progetto di Claude torna un percorso con unità e backslash', () => {
  assert.strictEqual(cwdFromProjectDir('C--Users-jack-repo', { platform: 'win32' }), 'C:\\Users\\jack\\repo');
  assert.strictEqual(cwdFromProjectDir('-home-jack-repo', { platform: 'linux' }), '/home/jack/repo', 'su Unix come prima');
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

// ---------- opencode via execFile ----------
/* Da Node 18.20.2 execFile rifiuta un .cmd con spawn EINVAL (CVE-2024-27980):
   opencode installato con npm -g, su Windows, è opencode.cmd, e Resume e barra
   dell'uso di OpenCode fallivano. */
const { execFileArgs } = require('../lib/win-command');
const { listOpencodeSessions } = require('../lib/opencode-sessions');

ok('win: execFileArgs avvolge .cmd/.bat in cmd.exe, il resto passa com\'è', () => {
  const cmd = execFileArgs('C:\\npm\\opencode.cmd', ['session', 'list'], { platform: 'win32', env: {} });
  assert.strictEqual(cmd.file, 'cmd.exe');
  assert.deepStrictEqual(cmd.args, [windowsCommandLine('C:\\npm\\opencode.cmd', ['session', 'list'])]);
  assert.deepStrictEqual(cmd.options, { windowsVerbatimArguments: true });
  assert.strictEqual(execFileArgs('C:\\x.cmd', [], { platform: 'win32', env: { ComSpec: 'C:\\W\\cmd.exe' } }).file, 'C:\\W\\cmd.exe');
  assert.deepStrictEqual(execFileArgs('C:\\oc\\opencode.exe', ['a'], { platform: 'win32', env: {} }), { file: 'C:\\oc\\opencode.exe', args: ['a'], options: {} });
  assert.deepStrictEqual(execFileArgs('/usr/bin/x.cmd', ['a'], { platform: 'linux' }), { file: '/usr/bin/x.cmd', args: ['a'], options: {} });
});

ok('win: listOpencodeSessions lancia opencode.cmd tramite cmd.exe', async () => {
  let call;
  const run = (file, args, opts, cb) => { call = { file, args, opts }; cb(null, '[]', ''); };
  const r = await listOpencodeSessions(5, { bin: 'C:\\npm\\opencode.cmd', run, platform: 'win32' });
  assert.strictEqual(r.ok, true, r.error);
  assert.match(call.file, /cmd\.exe$/i);
  assert.match(call.args[0], /opencode\.cmd .*session.*list/);
  assert.strictEqual(call.opts.windowsVerbatimArguments, true);
});

/* Il caso vero: execFile di Node su un .cmd, con uno spazio nel percorso. Il
   .cmd è fatto come gli shim di npm (`node script %*`), quindi verifica anche
   che gli argomenti arrivino interi al programma dietro lo shim. */
ok('win: un opencode.cmd vero risponde, niente spawn EINVAL', { skip: process.platform !== 'win32' && 'serve cmd.exe' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais oc-'));
  const script = path.join(dir, 'opencode.js');
  fs.writeFileSync(script, "console.log(JSON.stringify([{ id: 'ses_1', title: process.argv.slice(2).join(' ') }]));\n");
  const bin = path.join(dir, 'opencode.cmd');
  fs.writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
  try {
    const r = await listOpencodeSessions(5, { bin });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(r.sessions.map((s) => [s.id, s.title]), [['ses_1', 'session list --format json -n 5']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


/* Il JSON vero degli hook ha `|` nel matcher e virgolette ovunque: cmd.exe
   deve ricevere --settings come un solo argomento, intatto. */
ok('win: il JSON vero di claudeSettings passa intatto nella riga di cmd.exe', () => {
  const { claudeSettings } = require('../lib/agent-hooks');
  const json = claudeSettings({ platform: 'win32' });
  const resolve = () => ({ path: 'C:\\Users\\jack\\AppData\\Roaming\\npm\\claude.cmd', via: 'PATH:npm' });
  const inject = () => ({ args: ['--settings', json], env: {} });
  const r = buildCommand('claude', null, null, { profiles: winProfiles(), home: HOME, env: ENV, platform: 'win32', resolve, inject });
  // Ogni metacarattere di cmd.exe fuori dalle virgolette va preceduto da ^
  const inner = r.commandLine.slice('/d /s /c "'.length, -1);
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '^') { i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted) assert.ok(!'|&<>()%!'.includes(c), `${c} nudo in posizione ${i}: ${r.commandLine}`);
  }
  assert.ok(r.commandLine.includes('permission_prompt'), r.commandLine);
});

// ---------- lib/editor-paths (docs/plans/60) ----------
const editorPaths = require('../lib/editor-paths');

ok('win: validName rifiuta nomi riservati, caratteri vietati, punti e spazi finali', () => {
  for (const n of ['CON', 'nul.txt', 'com1', 'LPT9.log', 'a<b', 'a:b', 'a?', 'a"b', 'a|b', 'a*', 'fine.', 'fine ']) {
    assert.strictEqual(editorPaths.validName(n, 'win32'), false, n);
  }
  assert.strictEqual(editorPaths.validName('console.js', 'win32'), true);
});

ok('win: isInside non bada alle maiuscole e non confonde le unità', () => {
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'c:\\prog\\app\\src\\a.js', 'win32'), true);
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'C:\\Prog\\AppX\\a.js', 'win32'), false);
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'D:\\Prog\\App\\a.js', 'win32'), false);
});

ok('windows: dagli appunti FileNameW (UTF-16, chiuso da zero), solo percorsi assoluti', () => {
  const asked = [];
  const read = (format) => { asked.push(format); return Buffer.from('C:\\Users\\jack\\una foto.png\0', 'utf16le'); };
  assert.deepStrictEqual(filesFromClipboard(read, 'win32'), ['C:\\Users\\jack\\una foto.png']);
  assert.deepStrictEqual(asked, ['FileNameW']);
  assert.deepStrictEqual(formatsFor('win32'), ['FileNameW']);
  assert.deepStrictEqual(filesFromClipboard(() => Buffer.from('relativo.txt\0', 'utf16le'), 'win32'), []);
  assert.deepStrictEqual(filesFromClipboard(() => Buffer.alloc(0), 'win32'), []);
  assert.strictEqual(fileUriToPath('file:///C:/a%20b/x.txt', 'win32'), 'C:\\a b\\x.txt');
});

ok('windows: editor-copy confronta i nomi senza maiuscole e il dialog offre solo file', async (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-wcopy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  fs.mkdirSync(root);
  for (const d of ['x', 'y']) fs.mkdirSync(path.join(base, d));
  fs.writeFileSync(path.join(base, 'x', 'A.txt'), '');
  fs.writeFileSync(path.join(base, 'y', 'a.txt'), '');
  const copy = createEditorCopy({ editorFs: createEditorFs({ root }), trash: async () => {}, platform: 'win32' });
  const r = await copy.planCopy([path.join(base, 'x', 'A.txt'), path.join(base, 'y', 'a.txt')], '');
  assert.deepStrictEqual(r, { ok: false, error: 'Due elementi si chiamano «a.txt»: copiali uno alla volta.' });
  assert.deepStrictEqual(pickProperties('win32'), ['openFile', 'multiSelections']);
});

// ---------- lib/tmux + lib/psmux-install: psmux al posto di tmux (piano 52) ----------
const { detectTmux } = require('../lib/tmux');
const { psmuxDirs } = require('../lib/psmux-install');

const PSMUX = { bin: 'C:\\Users\\jack\\AppData\\Local\\PizzaManager\\psmux\\3.3.8\\psmux.exe', version: '3.3.8' };
const WHERE = { packaged: true, resourcesPath: 'C:\\PM\\resources', appDir: 'C:\\PM\\resources\\app.asar' };

ok('win: detectTmux usa il psmux del pacchetto, con la sua config fuori dall asar', () => {
  const seen = [];
  const d = detectTmux({
    platform: 'win32', confPath: 'C:\\PM\\resources\\app.asar\\app\\tmux.conf', psmuxConfPath: 'C:\\PM\\resources\\app.asar\\app\\psmux.conf',
    psmux: WHERE, installPsmux: (opts) => { seen.push(opts); return PSMUX; }, resolve: () => { throw new Error('niente PATH'); },
  });
  assert.strictEqual(d.bin, PSMUX.bin);
  assert.strictEqual(d.psmuxVersion, '3.3.8');
  assert.strictEqual(d.confPath, 'C:\\PM\\resources\\app.asar.unpacked\\app\\psmux.conf', 'tmux.conf su Windows non va: prefix None non esiste in psmux');
  assert.strictEqual(typeof d.control.list, 'function');
  assert.deepStrictEqual(seen, [{ ...WHERE, platform: 'win32' }]);
});

ok('win: senza psmux nel pacchetto niente tmux, e il PATH non si guarda (un tmux.exe di MSYS2 non va)', () => {
  let searched = 0;
  const d = detectTmux({ platform: 'win32', confPath: 'C:\\x\\tmux.conf', psmuxConfPath: 'C:\\x\\psmux.conf', psmux: WHERE,
    installPsmux: () => null, resolve: () => { searched++; return { path: 'C:\\msys64\\usr\\bin\\tmux.exe' }; } });
  assert.strictEqual(d, null);
  assert.strictEqual(searched, 0);
});

ok('detectTmux fuori da Windows non installa psmux e usa tmux.conf', () => {
  let installed = 0;
  const d = detectTmux({ platform: 'darwin', confPath: '/a/tmux.conf', psmuxConfPath: '/a/psmux.conf', psmux: WHERE,
    installPsmux: () => { installed++; return PSMUX; }, resolve: () => ({ path: '/opt/homebrew/bin/tmux' }) });
  assert.strictEqual(installed, 0);
  assert.strictEqual(d.bin, '/opt/homebrew/bin/tmux');
  assert.strictEqual(d.confPath, '/a/tmux.conf');
  assert.strictEqual(d.psmuxVersion, undefined);
});

/* Aggiornamenti con sessioni vive (piano 52, punto 5). Il protocollo di psmux
   non ha versione, quindi ci si riattacca con l'exe con cui la sessione e'
   nata, e si tolgono solo le versioni che nessuna sessione viva usa. */
const { META_KEYS, FIELD_SEP } = require('../lib/tmux');
/** Un psmux finto: list-sessions risponde con queste sessioni, il resto va. */
function fakePsmux(sessions) {
  const stdout = sessions.map(({ name, psmux }) => [name, '1000', '0', ...META_KEYS.map((k) => ({ type: 'shell', psmux })[k] || '')].join(FIELD_SEP)).join('\n');
  return (bin, args, opts, cb) => cb(null, args.includes('list-sessions') ? stdout : '', '');
}
const OLD_BIN = 'C:\\Users\\jack\\AppData\\Local\\PizzaManager\\psmux\\3.3.7\\psmux.exe';
function withVersions(sessions, { installed = ['3.3.7', '3.3.8'], pruned = [] } = {}) {
  return detectTmux({
    platform: 'win32', psmuxConfPath: 'C:\\x\\psmux.conf', psmux: WHERE, run: fakePsmux(sessions),
    installPsmux: () => ({
      ...PSMUX,
      binFor: (v) => (installed.includes(v) ? `C:\\Users\\jack\\AppData\\Local\\PizzaManager\\psmux\\${v}\\psmux.exe` : null),
      prune: (keep) => { pruned.push([...keep].sort()); return installed.filter((v) => !keep.includes(v)); },
    }),
  });
}

ok('win: ogni sessione nuova si segna la versione di psmux', async () => {
  const calls = [];
  const d = detectTmux({ platform: 'win32', psmuxConfPath: 'C:\\x\\psmux.conf', psmux: WHERE, installPsmux: () => PSMUX,
    run: (bin, args, opts, cb) => { calls.push(args); cb(null, '', ''); } });
  await d.control.create({ name: 'ais-shell-1', cmd: 'powershell.exe', meta: { type: 'shell' } });
  assert.ok(calls.some((a) => a.slice(-2).join(' ') === '@ais_psmux 3.3.8'));
});

ok('win: ci si riattacca con l exe della versione della sessione, se c e ancora', async () => {
  const d = withVersions([{ name: 'ais-shell-vecchia', psmux: '3.3.7' }, { name: 'ais-shell-nuova', psmux: '3.3.8' }, { name: 'ais-shell-ignota' }, { name: 'ais-shell-sparita', psmux: '3.2.0' }]);
  assert.strictEqual(await d.attachBin('ais-shell-vecchia'), OLD_BIN);
  assert.strictEqual(await d.attachBin('ais-shell-nuova'), PSMUX.bin);
  assert.strictEqual(await d.attachBin('ais-shell-ignota'), PSMUX.bin, 'nata prima di @ais_psmux: l exe corrente');
  assert.strictEqual(await d.attachBin('ais-shell-sparita'), PSMUX.bin, 'cartella della versione tolta: l exe corrente');
  assert.strictEqual(await d.attachBin('ais-shell-nessuna'), PSMUX.bin);
});

ok('win: la pulizia tiene la versione corrente e quelle delle sessioni vive', async () => {
  const pruned = [];
  const d = withVersions([{ name: 'ais-shell-a', psmux: '3.3.7' }], { installed: ['3.3.6', '3.3.7', '3.3.8'], pruned });
  assert.deepStrictEqual(await d.pruneUnused(), ['3.3.6']);
  assert.deepStrictEqual(pruned, [['3.3.7', '3.3.8']]);
});

ok('win: con una sessione di versione ignota non si toglie niente (potrebbe usare qualunque exe)', async () => {
  const pruned = [];
  const d = withVersions([{ name: 'ais-shell-a', psmux: '3.3.8' }, { name: 'ais-shell-ignota' }], { installed: ['3.3.7', '3.3.8'], pruned });
  assert.deepStrictEqual(await d.pruneUnused(), []);
  assert.deepStrictEqual(pruned, []);
});

ok('fuori da Windows attachBin è il tmux trovato e la pulizia non fa niente', async () => {
  const d = detectTmux({ platform: 'linux', confPath: '/a/tmux.conf', resolve: () => ({ path: '/usr/bin/tmux' }), run: fakePsmux([]) });
  assert.strictEqual(await d.attachBin('ais-shell-1'), '/usr/bin/tmux');
  assert.deepStrictEqual(await d.pruneUnused(), []);
});

/* Ogni riga di app/psmux.conf viene da una misura (docs/plans/40-risultati.md):
   chi la «riallinea» a tmux.conf rompe qualcosa che su Mac non si vede. */
ok('win: psmux.conf, le opzioni che psmux vuole diverse da tmux', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'app', 'psmux.conf'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const opts = new Map(lines.filter((l) => /^set -g /.test(l)).map((l) => {
    const [, name, value] = l.match(/^set -g (\S+)\s+(.*)$/);
    return [name, value.replace(/^'|'$/g, '')];
  }));
  assert.strictEqual(opts.get('prefix'), 'C-M-S-F12', 'psmux scarta "None" e lascia C-b (Q4)');
  assert.strictEqual(opts.get('mouse'), 'on', 'con off il server butta il mouse del pane e Claude non seleziona');
  assert.strictEqual(opts.get('warm'), 'off', 'il server caldo l app non lo usa mai');
  for (const [name, value] of [['status', 'off'], ['escape-time', '0'], ['history-limit', '50000'], ['window-size', 'latest'], ['destroy-unattached', 'off']]) {
    assert.strictEqual(opts.get(name), value, name);
  }
  assert.ok(!lines.some((l) => /terminal-(features|overrides)/.test(l)), 'terminal-features da un avviso, terminal-overrides e ignorato');
});

ok('win: psmuxDirs, l exe dalle risorse del pacchetto o da vendor/ in sviluppo, le copie in LOCALAPPDATA', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\jack\\AppData\\Local' };
  assert.deepStrictEqual(psmuxDirs({ ...WHERE, env }), {
    sourceDir: 'C:\\PM\\resources\\psmux',
    localDir: 'C:\\Users\\jack\\AppData\\Local\\PizzaManager\\psmux',
  });
  assert.strictEqual(psmuxDirs({ packaged: false, resourcesPath: 'C:\\electron\\resources', appDir: 'C:\\src\\PizzaManager', env }).sourceDir,
    'C:\\src\\PizzaManager\\vendor\\psmux', 'da sorgente le risorse sono quelle di Electron, non le nostre');
  assert.strictEqual(psmuxDirs({ ...WHERE, env: {} }), null, 'senza LOCALAPPDATA non si sa dove copiare');
});

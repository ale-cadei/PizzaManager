// Test che toccano l'ambiente reale: girano solo se i tool sono installati,
// altrimenti si dichiarano saltati. Servono a intercettare i cambi di formato
// delle CLI esterne, che nessun test con dipendenze iniettate puo' vedere.
const fs = require('fs');
const assert = require('node:assert');
const { test: ok, skip } = require('node:test');

ok('codex-sessions: la scansione dei rollout non solleva eccezioni', (t) => {
  const { listCodexSessions, sessionsDir } = require('../lib/codex-sessions');
  const r = listCodexSessions(5);
  assert.ok(typeof r.ok === 'boolean' && Array.isArray(r.sessions), 'forma della risposta inattesa');
  if (!fs.existsSync(sessionsDir())) return t.skip('nessuna directory di sessioni codex su questa macchina');
  assert.strictEqual(r.ok, true, r.error || '');
  assert.ok(r.sessions.length <= 5, 'limite non rispettato');
  for (const s of r.sessions) {
    assert.ok(s.id && s.title, 'sessione senza id o titolo');
    assert.strictEqual(typeof s.mtime, 'number', 'mtime mancante');
  }
});

ok('opencode: `session list --format json` produce ancora un array JSON', (t) => {
  const { execFileSync } = require('child_process');
  const { resolveBinary } = require('../lib/binaries');
  const bin = resolveBinary('opencode');
  if (!bin.path) return t.skip('opencode non installato su questa macchina');
  let out;
  try {
    out = execFileSync(bin.path, ['session', 'list', '--format', 'json', '-n', '2'], { timeout: 15000 });
  } catch (e) {
    return t.skip('opencode presente ma non interrogabile: ' + (e.message || e));
  }
  // Qualunque cosa stampi opencode — niente (zero sessioni), un array, altro —
  // il parser dell'app deve produrre un risultato leggibile, mai un'eccezione.
  const { parseSessionOutput } = require('../lib/opencode-sessions');
  const r = parseSessionOutput(out.toString());
  if (!out.toString().trim()) { assert.deepStrictEqual(r, { ok: true, sessions: [] }); return; }
  assert.strictEqual(r.ok, true, 'opencode ha cambiato formato: ' + (r.error || ''));
});

// ---------- tmux: il ciclo per cui esiste il branch 6 ----------
ok('tmux: la sessione sopravvive allo stacco del client e si riattacca con i metadati', async (t) => {
  const path = require('path');
  const os = require('os');
  const { detectTmux, createTmuxControl } = require('../lib/tmux');
  const { createPtyManager, isPtyAvailable } = require('../app/pty');
  const { createAccountStore } = require('../lib/accounts');
  const { createHistoryStore } = require('../lib/history');
  const { createProfileStore } = require('../lib/profiles');

  const found = detectTmux({ confPath: null });
  if (!found) return t.skip('tmux non installato su questa macchina');
  if (!isPtyAvailable()) return t.skip('node-pty non compilato');

  // Socket dedicato al test: le sessioni reali dell'app (aisession) non si toccano.
  const socket = 'aistest-' + process.pid;
  const confPath = path.join(__dirname, '..', 'app', 'tmux.conf');
  const control = createTmuxControl({ bin: found.bin, confPath, socket });
  const tmux = { bin: found.bin, confPath, socket, control };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-tmux-'));
  const profiles = createProfileStore({ dir });
  const cfg = profiles.load();
  cfg.profiles.shell = [{ id: 'shell:t', label: 'Shell di prova', command: '/bin/sh', resumeArgs: '' }];
  profiles.save(cfg);
  const { createLiveSessionsStore } = require('../lib/live-sessions');
  const liveStore = () => createLiveSessionsStore({ dir });
  const mk = () => createPtyManager({
    accounts: () => createAccountStore({ dir }), history: () => createHistoryStore({ dir }), profiles, sendToRenderer: () => {}, tmux, liveStore,
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // 1. avvio: la sessione nasce in tmux con i metadati
    const app1 = mk();
    assert.strictEqual(app1.viaTmux, true);
    const r = await app1.spawn({ id: 'tab1', type: 'shell', cwd: dir, commandProfileId: 'shell:t', label: 'la mia shell', cols: 80, rows: 24 });
    assert.strictEqual(r.ok, true, r.error);
    assert.ok(r.session && r.session.startsWith('ais-shell-'), r.session);
    await wait(300);
    assert.strictEqual(typeof await app1.captureShell('tab1'), 'string', 'la ricerca deve poter leggere il pane della shell');
    assert.strictEqual(await app1.captureShell('scheda-inesistente'), null);
    let live = await app1.listLive();
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].name, r.session);
    assert.strictEqual(live[0].type, 'shell');
    assert.strictEqual(live[0].label, 'la mia shell');
    assert.strictEqual(live[0].attachedHere, true);
    await wait(200);
    assert.deepStrictEqual(liveStore().read().map((x) => x.name), [r.session], 'il registro su disco deve rispecchiare tmux');

    // l'id della conversazione, scoperto dopo, finisce in tmux e nel registro
    app1.setMeta('tab1', { resumeId: 'uuid-scoperto' });
    await wait(300);
    assert.strictEqual((await app1.listLive())[0].resumeId, 'uuid-scoperto');
    assert.strictEqual(liveStore().read()[0].resumeId, 'uuid-scoperto', 'il registro deve avere l id per il ripristino');

    // 2. stacco (la ✕, o la chiusura della finestra): il processo resta
    app1.setLabel('tab1', 'rinominata');
    await wait(200);
    app1.closeAll();
    await wait(300);
    assert.strictEqual(app1.size, 0, 'nessun client rimasto');
    assert.strictEqual(await control.has(r.session), true, 'la sessione tmux deve sopravvivere allo stacco');

    // 3. "riapertura": un manager nuovo la ritrova e si riattacca, col titolo aggiornato
    const app2 = mk();
    assert.deepStrictEqual(await app2.restorable(), [], 'con tmux ancora vivo non c e niente da ripristinare');
    live = await app2.listLive();
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].attachedHere, false, 'nessun client di questo manager e attaccato');
    assert.strictEqual(live[0].label, 'rinominata', 'il titolo cambiato deve tornare al riattacco');
    const a = await app2.attach({ id: 'tab2', session: r.session, cols: 80, rows: 24 });
    assert.strictEqual(a.ok, true, a.error);
    await wait(200);
    assert.strictEqual((await app2.listLive())[0].attachedHere, true);

    // 3-bis. hard refresh: il renderer nuovo riattacca una sessione che ha gia' un
    // client (del renderer morto). Il client vecchio va via, non se ne sommano due.
    const again = await app2.attach({ id: 'tab2-dopo-reload', session: r.session, cols: 80, rows: 24 });
    assert.strictEqual(again.ok, true, again.error);
    await wait(200);
    assert.strictEqual(app2.size, 1, 'il client stale della stessa sessione doveva essere chiuso');
    app2.write('tab2', 'x'); // il vecchio id non deve piu' scrivere da nessuna parte (non deve lanciare)

    // 4. una sessione sparita e un caso normale, non un errore
    const gone = await app2.attach({ id: 'tab3', session: 'ais-shell-inesistente', cols: 80, rows: 24 });
    assert.strictEqual(gone.ok, false);
    assert.strictEqual(gone.gone, true, 'deve dichiararla sparita, non un errore generico');

    // 5. termina per davvero: la sessione non c'e piu
    await app2.terminate('tab2-dopo-reload');
    await wait(300);
    assert.strictEqual(await control.has(r.session), false, 'dopo terminate la sessione deve essere morta');
    assert.deepStrictEqual(await app2.listLive(), []);
    assert.deepStrictEqual(liveStore().read(), [], 'terminata con ⏻: sparisce anche dal registro, non va proposta al riavvio');

    // 6. "riavvio": registro pieno, tmux vuoto → si propone il ripristino con l id
    liveStore().write([{ name: 'ais-claude-persa', type: 'claude', cwd: dir, resumeId: 'uuid-x', label: 'Persa' }]);
    const lost = await mk().restorable();
    assert.strictEqual(lost.length, 1);
    assert.strictEqual(lost[0].resumeId, 'uuid-x');
    mk().discardRestorable();
    assert.deepStrictEqual(liveStore().read(), [], '"Non ora" svuota il registro');
  } finally {
    const { execFileSync } = require('child_process');
    try { execFileSync(found.bin, ['-L', socket, 'kill-server']); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* Il mouse deve restare al terminale, non a tmux. Con `mouse on` tmux cattura
   il drag: al rilascio chiude la sua copy-mode e la selezione sparisce prima
   che l'utente possa copiarla (xterm non ne ha mai vista una). L'app la copia
   da `term.getSelection()`, quindi il mouse le serve. Non e' un test teorico:
   il .deb ha mostrato il guasto appena ha cominciato a leggere davvero questa
   config (prima restava dentro app.asar e tmux partiva coi default). */
ok('tmux: il mouse resta al terminale, altrimenti la selezione sparisce al rilascio', (t) => {
  const path = require('path');
  const { execFileSync } = require('child_process');
  const { detectTmux } = require('../lib/tmux');

  const found = detectTmux({ confPath: null });
  if (!found) return t.skip('tmux non installato su questa macchina');

  const socket = 'aistest-mouse-' + process.pid;
  const confPath = path.join(__dirname, '..', 'app', 'tmux.conf');
  const run = (...args) => execFileSync(found.bin, ['-L', socket, '-f', confPath, ...args], { timeout: 10000 }).toString().trim();
  try {
    run('new-session', '-d', '-s', 'probe', '--', 'sleep', '30');
    assert.strictEqual(run('show-options', '-g', 'mouse'), 'mouse off',
      'con il mouse a tmux la selezione col mouse non arriva mai a xterm: niente copia');
  } finally {
    try { execFileSync(found.bin, ['-L', socket, 'kill-server']); } catch {}
  }
});

/* Scorrere con la rotella. tmux entra nell'alternate screen del terminale
   esterno (smcup): li' xterm.js traduce la rotella in frecce su/giu' — nella
   shell si sfogliano i comandi recenti invece del testo. Togliendo
   smcup/rmcup l'output di tmux resta nella schermata normale. La history pero'
   NON e' di xterm: tmux scorre con `CSI n S` e quelle righe xterm non le
   conserva. Si scorre quella di tmux (test "lo scorrimento muove la copy-mode"). */
ok('tmux: niente alternate screen, altrimenti la rotella non scorre il terminale', async (t) => {
  const path = require('path');
  const { execFileSync } = require('child_process');
  const { detectTmux } = require('../lib/tmux');
  const { isPtyAvailable } = require('../app/pty');

  const found = detectTmux({ confPath: null });
  if (!found) return t.skip('tmux non installato su questa macchina');
  if (!isPtyAvailable()) return t.skip('node-pty non compilato');

  const pty = require('node-pty');
  const socket = 'aistest-altscreen-' + process.pid;
  const confPath = path.join(__dirname, '..', 'app', 'tmux.conf');
  const base = ['-L', socket, '-f', confPath];
  try {
    execFileSync(found.bin, [...base, 'new-session', '-d', '-s', 'probe', '--', 'sleep', '30'], { timeout: 10000 });
    // Un client vero: e' l'attach che emette (o no) la sequenza sul terminale
    const p = pty.spawn(found.bin, [...base, 'attach-session', '-t', '=probe'], {
      name: 'xterm-256color', cols: 80, rows: 24, env: { ...process.env, TERM: 'xterm-256color' },
    });
    let out = '';
    p.onData((d) => { out += d; });
    await new Promise((r) => setTimeout(r, 800));
    p.kill();
    assert.ok(!out.includes('\x1b[?1049h'),
      'tmux passa all alternate screen: xterm resta senza history e la rotella manda frecce alla shell');
  } finally {
    try { execFileSync(found.bin, ['-L', socket, 'kill-server']); } catch {}
  }
});

/* La rotella scorre la history di tmux, non quella di xterm: tmux scorre il
   terminale esterno con `CSI n S` e quelle righe xterm non le conserva. Qui il
   giro completo con un tmux e un pty veri: su nella copy-mode, e un tasto
   premuto la chiude prima di arrivare alla shell. */
ok('tmux: lo scorrimento muove la copy-mode e scrivere la chiude', async (t) => {
  const path = require('path');
  const os = require('os');
  const { detectTmux, createTmuxControl } = require('../lib/tmux');
  const { createPtyManager, isPtyAvailable } = require('../app/pty');
  const { createAccountStore } = require('../lib/accounts');
  const { createHistoryStore } = require('../lib/history');
  const { createProfileStore } = require('../lib/profiles');

  const found = detectTmux({ confPath: null });
  if (!found) return t.skip('tmux non installato su questa macchina');
  if (!isPtyAvailable()) return t.skip('node-pty non compilato');

  const socket = 'aistest-scroll-' + process.pid;
  const confPath = path.join(__dirname, '..', 'app', 'tmux.conf');
  const control = createTmuxControl({ bin: found.bin, confPath, socket });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-scroll-'));
  const profiles = createProfileStore({ dir });
  const cfg = profiles.load();
  cfg.profiles.shell = [{ id: 'shell:t', label: 'Shell di prova', command: '/bin/sh', resumeArgs: '' }];
  profiles.save(cfg);
  const app = createPtyManager({
    accounts: () => createAccountStore({ dir }), history: () => createHistoryStore({ dir }), profiles, sendToRenderer: () => {},
    tmux: { bin: found.bin, confPath, socket, control },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const r = await app.spawn({ id: 'tab1', type: 'shell', cwd: dir, commandProfileId: 'shell:t', cols: 80, rows: 24 });
    assert.strictEqual(r.ok, true, r.error);
    await wait(300);
    app.write('tab1', 'seq 300\r');
    await wait(500);

    const start = await app.scroll('tab1');
    assert.ok(start.history >= 270, `la history deve stare in tmux: ${JSON.stringify(start)}`);
    assert.strictEqual(start.inMode, false);

    const up = await app.scroll('tab1', { lines: 10 });
    assert.deepStrictEqual([up.inMode, up.position], [true, 10]);
    assert.strictEqual((await app.scroll('tab1', { fromBottom: 100 })).position, 100);
    assert.strictEqual((await app.scroll('tab1', { lines: -1000 })).inMode, false, 'in fondo la copy-mode si chiude da sola');

    // Il tasto arriva mentre lo scroll e' ancora in volo: non deve finire nella copy-mode.
    const flying = app.scroll('tab1', { lines: 5 });
    app.write('tab1', 'echo fine-scroll\r');
    await flying;
    await wait(400);
    const after = await app.scroll('tab1');
    assert.strictEqual(after.inMode, false, 'un tasto premuto deve chiudere la copy-mode');
    const shown = await new Promise((res) => require('child_process').execFile(found.bin, ['-L', socket, 'capture-pane', '-p', '-t', `=${r.session}:`], (e, out) => res(String(out))));
    assert.ok(shown.includes('fine-scroll'), 'il testo deve arrivare alla shell, non ai comandi della copy-mode');
    assert.strictEqual(await app.scroll('nessuna', { lines: 3 }), null);
  } finally {
    app.closeAll();
    try { require('child_process').execFileSync(found.bin, ['-L', socket, 'kill-server']); } catch {}
  }
});

/* Il giro completo dello scrollback (piano 26) su un tmux vero: si cattura il
   testo di una sessione, la si uccide come farebbe un riavvio, e la sessione
   ricreata deve ritrovarsi quel testo nella history — coi colori, e con la
   shell vera come processo, non il guscio che l'ha stampato. */
ok('tmux: il testo di una shell sopravvive alla morte della sessione', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const { detectTmux, createTmuxControl } = require('../lib/tmux');
  const { createScrollbackStore } = require('../lib/scrollback');
  const { replayCommand } = require('../lib/scrollback-command');

  const found = detectTmux({ confPath: null });
  if (!found) return t.skip('tmux non installato su questa macchina');

  const socket = 'aistest-scrollback-' + process.pid;
  const confPath = path.join(__dirname, '..', 'app', 'tmux.conf');
  const control = createTmuxControl({ bin: found.bin, confPath, socket });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-sb-int-'));
  const store = createScrollbackStore({ dir });
  const prima = 'ais-shell-prima';

  try {
    // Una shell che ha scritto qualcosa di riconoscibile, in verde.
    const gen = path.join(dir, 'gen.sh');
    fs.writeFileSync(gen, '#!/bin/sh\nprintf "\\033[32mCIAMBELLA-42\\033[0m\\n"\nsleep 30\n', { mode: 0o700 });
    assert.ok((await control.create({ name: prima, cmd: '/bin/sh', args: [gen], cols: 120, rows: 40 })).ok);
    await new Promise((r) => setTimeout(r, 600));

    const testo = await control.capture(prima);
    assert.ok(testo && testo.includes('CIAMBELLA-42'), 'la cattura non ha preso il testo');
    assert.ok(testo.includes('\x1b['), 'senza -e i colori si perderebbero');
    store.save(prima, testo);

    // Quello che fa un riavvio della macchina: il server muore con tutto dentro.
    await control.kill(prima);
    assert.strictEqual(await control.has(prima), false);

    // La sessione ricreata stampa il salvato e poi diventa la shell.
    // Una shell DIVERSA dal guscio `/bin/sh`: e' l'unico modo di vedere che
    // `exec` l'ha sostituito davvero (su macOS /bin/sh e' bash, quindi con sh
    // il confronto non proverebbe niente).
    const shell = fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash';
    const replay = replayCommand({ file: store.fileFor(prima), shell, args: [] });
    const dopo = 'ais-shell-dopo';
    assert.ok((await control.create({ name: dopo, cmd: replay.cmd, args: replay.args, env: replay.env, cols: 120, rows: 40 })).ok);
    await new Promise((r) => setTimeout(r, 600));

    const ripristinato = await control.capture(dopo);
    assert.ok(ripristinato.includes('CIAMBELLA-42'), 'il testo di prima non e tornato nella history');
    assert.ok(ripristinato.includes('cronologia ripristinata'), 'manca il separatore');
    assert.ok(ripristinato.includes('\x1b[32m'), 'il verde di prima si e perso per strada');

    // `exec` deve aver sostituito il guscio: il processo e' la shell vera.
    const cmd = execFileSync(found.bin, ['-L', socket, 'display-message', '-p', '-t', `=${dopo}:`, '#{pane_current_command}'], { timeout: 5000 }).toString().trim();
    assert.strictEqual(cmd, path.basename(shell), `nel pane c'e ${cmd}: il guscio sh non e stato sostituito`);
  } finally {
    // SOLO il socket di prova: su 'aisession' ci sono le sessioni dell'utente.
    try { execFileSync(found.bin, ['-L', socket, 'kill-server']); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- git: la timeline della sessione git su un repository vero ----------
ok('git: readGitGraph legge branch, merge e repository vuoti con il git installato', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const { readGitGraph } = require('../lib/git-graph');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  // .native come git: su macOS risolve /var -> /private/var, su Windows
  // espande i nomi corti 8.3 della tmpdir (RUNNER~1 -> runneradmin), che
  // realpathSync semplice lascia com'erano.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-git-')));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };
  const git = (...args) => execFileSync(bin.path, args, { cwd: dir, env });
  try {
    git('init', '-q', '-b', 'main');
    const empty = await readGitGraph({ cwd: dir });
    assert.deepStrictEqual({ ok: empty.ok, rows: empty.rows }, { ok: true, rows: [] }, empty.error || '');
    git('commit', '-q', '--allow-empty', '-m', 'primo');
    git('checkout', '-q', '-b', 'feat/x');
    git('commit', '-q', '--allow-empty', '-m', 'sul branch');
    git('checkout', '-q', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'su main');
    git('merge', '-q', '--no-ff', '--no-edit', 'feat/x');
    const r = await readGitGraph({ cwd: dir });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.root, dir);
    assert.strictEqual(r.head, 'main');
    assert.strictEqual(r.rows.length, 4);
    assert.strictEqual(r.width, 2);
    assert.strictEqual(r.rows[0].commit.parents.length, 2, 'il primo commit non è il merge');
    assert.ok(r.rows.some((row) => row.commit.refs.some((ref) => ref.name === 'feat/x')), 'il branch feat/x non compare');
    const outside = await readGitGraph({ cwd: os.tmpdir() });
    if (!outside.ok) assert.strictEqual(outside.notRepo, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- git: un worktree vero appartiene al progetto principale ----------
ok('git: un worktree creato da git fa gruppo con il progetto principale, anche nella scheda git', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const { readGitGraph } = require('../lib/git-graph');
  const { findProjectRoot } = require('../lib/project-root');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-gitwt-')));
  const main = path.join(base, 'progetto');
  const wt = path.join(base, 'progetto.worktrees', 'feat-x');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };
  const git = (...args) => execFileSync(bin.path, args, { cwd: main, env });
  try {
    fs.mkdirSync(main);
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'primo');
    git('worktree', 'add', '-q', '-b', 'feat/x', wt);

    assert.strictEqual(findProjectRoot(wt), main, 'la sessione nel worktree fa gruppo a sé');
    const graph = await readGitGraph({ cwd: wt });
    assert.strictEqual(graph.ok, true, graph.error);
    assert.strictEqual(graph.root, main, 'la scheda git nel worktree fa gruppo a sé');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------- git: il ciclo di vita di un worktree con git vero (piano 36) ----------
ok('git: worktree creato, unito, in conflitto e buttato, con il git installato', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const wt = require('../lib/worktree');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-wtlife-')));
  const root = path.join(base, 'progetto');
  const git = (cwd, ...args) => String(execFileSync(bin.path, args, { cwd })).trim();
  const commitFile = (cwd, file, text) => {
    fs.writeFileSync(path.join(cwd, file), text);
    git(cwd, 'add', file);
    git(cwd, 'commit', '-q', '-m', `${file}: ${text}`);
  };
  try {
    fs.mkdirSync(root);
    git(root, 'init', '-q', '-b', 'main');
    // Identità locale: il merge di lib/worktree.js gira con l'env dell'app
    git(root, 'config', 'user.name', 'Prova');
    git(root, 'config', 'user.email', 'p@x');
    commitFile(root, '.gitignore', 'node_modules/\n.env\n');
    commitFile(root, 'a.txt', 'uno\n');
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'i.js'), 'x');
    fs.writeFileSync(path.join(root, '.env'), 'SEGRETO=1\n', { mode: 0o600 });
    fs.chmodSync(path.join(root, '.env'), 0o600);
    fs.writeFileSync(path.join(root, '.worktreeinclude'), '.env\n');

    const start = await wt.worktreeStart({ root });
    assert.strictEqual(start.ok, true, start.error);
    assert.deepStrictEqual(start.current.branch, 'main');
    assert.strictEqual(start.busy, null);

    // Crea: cartella accanto al progetto, base ricordata, file ignorati portati
    const made = await wt.createWorktree({ root, branch: 'feat/uno', base: 'main' });
    assert.strictEqual(made.ok, true, made.error);
    assert.deepStrictEqual(made.warnings, []);
    assert.strictEqual(made.path, path.join(base, 'progetto.worktrees', 'feat-uno'));
    assert.ok(fs.lstatSync(path.join(made.path, 'node_modules')).isSymbolicLink(), 'node_modules non collegato');
    assert.strictEqual(fs.statSync(path.join(made.path, '.env')).mode & 0o777, 0o600, '.env non copiato o con altri permessi');
    const listed = await wt.listWorktrees({ root });
    assert.deepStrictEqual(listed.worktrees.map((w) => [w.path, w.branch, w.base]), [[made.path, 'feat/uno', 'main']]);

    // Unisci: il commit del worktree arriva in main, cartella e branch spariscono
    commitFile(made.path, 'b.txt', 'dal worktree\n');
    const merged = await wt.mergeWorktree({ root, path: made.path });
    assert.strictEqual(merged.ok, true, merged.error);
    assert.ok(fs.existsSync(path.join(root, 'b.txt')), 'il lavoro del worktree non è in main');
    assert.ok(!fs.existsSync(made.path), 'la cartella del worktree è rimasta');
    assert.ok(!fs.existsSync(path.join(base, 'progetto.worktrees')), 'la cartella .worktrees vuota è rimasta');
    assert.strictEqual(git(root, 'branch', '--list', 'feat/uno'), '', 'il branch unito è rimasto');
    assert.ok(fs.existsSync(path.join(root, 'node_modules', 'pkg', 'i.js')), 'node_modules del progetto cancellato');

    // Conflitto: il merge si annulla e la cartella principale torna pulita
    const due = await wt.createWorktree({ root, branch: 'feat/due', base: 'main' });
    assert.strictEqual(due.ok, true, due.error);
    commitFile(due.path, 'a.txt', 'dal worktree\n');
    commitFile(root, 'a.txt', 'da main\n');
    const clash = await wt.mergeWorktree({ root, path: due.path });
    assert.strictEqual(clash.ok, false);
    assert.strictEqual(clash.conflict, true, clash.error);
    assert.strictEqual(git(root, 'status', '--porcelain', '--untracked-files=no'), '', 'cartella principale a metà merge');
    assert.ok(fs.existsSync(due.path), 'worktree tolto dopo un conflitto');

    // Butta con un file non committato: prima chiede, poi con force butta tutto
    fs.writeFileSync(path.join(due.path, 'nuovo.txt'), 'non committato');
    const asked = await wt.removeWorktree({ root, path: due.path, branch: 'delete' });
    assert.deepStrictEqual({ ok: asked.ok, dirty: asked.dirty }, { ok: false, dirty: true }, asked.error);
    const thrown = await wt.removeWorktree({ root, path: due.path, branch: 'delete', force: true });
    assert.strictEqual(thrown.ok, true, thrown.error);
    assert.ok(!fs.existsSync(due.path));
    assert.strictEqual(git(root, 'branch', '--list', 'feat/due'), '', 'il branch buttato è rimasto');

    // Una conversazione nata nel worktree buttato riparte nel progetto (passo 7)
    const { findProjectRoot } = require('../lib/project-root');
    const { describeWorkdir } = require('../lib/workdir');
    assert.strictEqual(findProjectRoot(due.path), root, 'il Resume la raggruppa fuori dal progetto');
    assert.deepStrictEqual(describeWorkdir(due.path), { dir: root, moved: 'worktree', requested: due.path });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------- git: la mappa dei branch su un repository vero ----------
ok('git: la mappa ricostruisce chi nasce da chi e chi è unito, con il git installato', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const { readGitGraph } = require('../lib/git-graph');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-gitmap-')));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };
  const git = (...args) => String(execFileSync(bin.path, args, { cwd: dir, env })).trim();
  const commit = (msg) => git('commit', '-q', '--allow-empty', '-m', msg);
  try {
    // main: primo · uno: u1-u2-u3 da primo · due: d1 da u1 · unito: x1 da m1, unito con un merge e cancellato
    git('init', '-q', '-b', 'main');
    commit('primo');
    const primo = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'uno');
    commit('u1');
    const u1 = git('rev-parse', 'HEAD');
    commit('u2');
    commit('u3');
    git('checkout', '-q', '-b', 'due', u1);
    commit('d1');
    git('checkout', '-q', 'main');
    commit('m1');
    git('checkout', '-q', '-b', 'unito');
    commit('x1');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '--no-edit', 'unito');
    const merge = git('rev-parse', 'HEAD');
    // come dopo una PR: il branch si cancella, la mappa lo ritrova dal messaggio del merge
    git('branch', '-q', '-d', 'unito');
    const r = await readGitGraph({ cwd: dir });
    assert.strictEqual(r.ok, true, r.error || '');
    const all = Object.fromEntries(r.map.all.lines.map((l) => [l.name, l]));
    assert.deepStrictEqual([all.uno.parent, all.uno.fork], ['main', primo]);
    assert.deepStrictEqual([all.due.parent, all.due.fork], ['uno', u1]);
    assert.deepStrictEqual([all.unito.merged, all.unito.merge, all.unito.where], [true, merge, null]);
    assert.deepStrictEqual(r.map.open.lines.map((l) => l.name).sort(), ['due', 'main', 'uno']);
    assert.strictEqual(r.map.hiddenCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- git: cambiare e creare branch su un repository vero ----------
ok('git: switchBranch, createBranch e deleteBranch con il git installato, remoti compresi', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const { listBranches, switchBranch, createBranch, deleteBranch } = require('../lib/git-branches');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-gitb-')));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };
  const origin = path.join(base, 'origin');
  const dir = path.join(base, 'clone');
  const git = (cwd, ...args) => execFileSync(bin.path, args, { cwd, env, stdio: 'pipe' }).toString();
  try {
    fs.mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'primo');
    git(origin, 'branch', 'fix/remoto');
    git(base, 'clone', '-q', origin, dir);
    const list = await listBranches({ cwd: dir });
    assert.strictEqual(list.ok, true, list.error || '');
    assert.deepStrictEqual(list.local.map((b) => [b.name, b.current]), [['main', true]]);
    assert.deepStrictEqual(list.remote.map((b) => b.name).sort(), ['origin/fix/remoto', 'origin/main']);

    // un remoto senza locale: nasce il locale che lo segue
    const fromRemote = await switchBranch({ cwd: dir, name: 'origin/fix/remoto', kind: 'remote' });
    assert.deepStrictEqual(fromRemote, { ok: true, branch: 'fix/remoto' });
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'fix/remoto');
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', '@{upstream}').trim(), 'origin/fix/remoto');

    const created = await createBranch({ cwd: dir, name: 'feat/nuovo' });
    assert.deepStrictEqual(created, { ok: true, branch: 'feat/nuovo' });
    const again = await createBranch({ cwd: dir, name: 'feat/nuovo' });
    assert.strictEqual(again.ok, false);

    // modifiche che il cambio di branch perderebbe: git rifiuta, niente va perso
    fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'a su feat/nuovo');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'modificato\n');
    const blocked = await switchBranch({ cwd: dir, name: 'main', kind: 'local' });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'modificato\n');
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feat/nuovo');

    // eliminare: il corrente no; uno non unito solo con force; uno unito subito
    git(dir, 'checkout', '-q', '--', 'a.txt');
    const current = await deleteBranch({ cwd: dir, name: 'feat/nuovo' });
    assert.strictEqual(current.ok, false);
    git(dir, 'switch', '-q', 'main');
    const unmerged = await deleteBranch({ cwd: dir, name: 'feat/nuovo' });
    assert.strictEqual(unmerged.notMerged, true, unmerged.error);
    assert.ok(git(dir, 'branch', '--list', 'feat/nuovo').trim(), 'il branch non unito deve restare');
    assert.deepStrictEqual(await deleteBranch({ cwd: dir, name: 'feat/nuovo', force: true }), { ok: true, branch: 'feat/nuovo' });
    assert.deepStrictEqual(await deleteBranch({ cwd: dir, name: 'fix/remoto' }), { ok: true, branch: 'fix/remoto' });
    assert.strictEqual(git(dir, 'branch', '--list').trim(), '* main');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------- git: il pannello «cosa ha cambiato» su un repository vero (piano 32) ----------
ok('git: readChanges e readFileDiff su modifiche, file nuovi, rinominati e worktree, con il git installato', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const { readChanges, readFileDiff } = require('../lib/git-changes');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-changes-')));
  const root = path.join(base, 'progetto');
  const wtPath = path.join(base, 'progetto.worktrees', 'feat-x');
  const git = (cwd, ...args) => String(execFileSync(bin.path, args, { cwd })).trim();
  const write = (cwd, file, text) => fs.writeFileSync(path.join(cwd, file), text);
  try {
    fs.mkdirSync(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Prova');
    git(root, 'config', 'user.email', 'p@x');

    // Senza commit: tutto quello che c'è è nuovo
    write(root, 'a.txt', 'uno\ndue\n');
    const unborn = await readChanges({ cwd: root });
    assert.strictEqual(unborn.ok, true, unborn.error);
    assert.deepStrictEqual(unborn.files.map((f) => [f.path, f.status, f.added]), [['a.txt', '?', 2]]);

    write(root, 'vecchio.txt', 'resto uguale\nper il rename\ne ancora\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'primo');
    const clean = await readChanges({ cwd: root });
    assert.deepStrictEqual([clean.files, clean.totals], [[], { files: 0, added: 0, removed: 0 }]);

    // Una modifica, un file nuovo con un nome strano, un rename
    write(root, 'a.txt', 'uno\nDUE\ntre\n');
    write(root, 'perché è.md', '<script>x</script>\n');
    git(root, 'mv', 'vecchio.txt', 'nuovo.txt');
    const r = await readChanges({ cwd: path.join(root) });
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(r.files.map((f) => [f.path, f.status, f.added, f.removed]), [
      ['a.txt', 'M', 2, 1], ['nuovo.txt', 'R', 0, 0], ['perché è.md', '?', 1, 0],
    ]);
    assert.strictEqual(r.files[1].oldPath, 'vecchio.txt');

    const d = await readFileDiff({ cwd: root, path: 'a.txt' });
    assert.strictEqual(d.ok, true, d.error);
    assert.deepStrictEqual(d.hunks[0].lines.map((l) => [l.kind, l.text]), [['ctx', 'uno'], ['del', 'due'], ['add', 'DUE'], ['add', 'tre']]);
    const n = await readFileDiff({ cwd: root, path: 'perché è.md' });
    assert.strictEqual(n.hunks[0].lines[0].text, '<script>x</script>');
    assert.strictEqual((await readFileDiff({ cwd: root, path: '../progetto/a.txt' })).ok, false);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'secondo');

    // Worktree: commit del branch + non committato, contro la base
    git(root, 'worktree', 'add', '-q', '-b', 'feat/x', wtPath);
    write(root, 'a.txt', 'cambiato su main dopo\n');
    git(root, 'commit', '-q', '-am', 'main va avanti');
    write(wtPath, 'b.txt', 'dal branch\n');
    git(wtPath, 'add', 'b.txt');
    git(wtPath, 'commit', '-q', '-m', 'sul branch');
    write(wtPath, 'c.txt', 'non committato\n');
    const w = await readChanges({ cwd: wtPath, base: 'main' });
    assert.strictEqual(w.ok, true, w.error);
    assert.strictEqual(w.base, 'main');
    assert.deepStrictEqual(w.files.map((f) => [f.path, f.status]), [['b.txt', 'A'], ['c.txt', '?']],
      'i commit di main dopo la partenza non sono lavoro del branch');
    assert.strictEqual(w.uncommitted, 1, 'solo c.txt non è in un commit');
    const vsHead = await readChanges({ cwd: wtPath });
    assert.deepStrictEqual(vsHead.files.map((f) => f.path), ['c.txt']);

    const outside = await readChanges({ cwd: base });
    assert.deepStrictEqual(outside, { ok: false, reason: 'not-a-repo' });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

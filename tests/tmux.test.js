// lib/tmux.js: costruzione degli argomenti e lettura dell'output, senza tmux.
// L'integrazione con un tmux vero sta in tests/integration.test.js.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const t = require('../lib/tmux');

const conf = '/app/tmux.conf';

ok('sessionName: prefisso riconoscibile, tipo leggibile, univoco', () => {
  const a = t.sessionName('claude', 1000, 0.5);
  const b = t.sessionName('claude', 1000, 0.6);
  assert.ok(a.startsWith('ais-claude-'), a);
  assert.notStrictEqual(a, b, 'due sessioni nello stesso istante devono avere nomi diversi');
  assert.ok(t.isAisSession(a));
  assert.ok(!t.isAisSession('xirp-abc'), 'le sessioni di altri strumenti non sono nostre');
  assert.ok(!t.isAisSession(null));
});

ok('sessionName: un tipo con caratteri strani non produce un nome invalido per tmux', () => {
  const n = t.sessionName('tipo:con.punti', 1, 0);
  assert.ok(/^ais-[a-z0-9]+-[a-z0-9]+$/.test(n), n);
});

ok('ogni comando passa dal socket dedicato e dalla config dell app', () => {
  for (const args of [
    t.spawnArgs({ confPath: conf, name: 'ais-x-1', cmd: '/bin/sh' }),
    t.attachArgs({ confPath: conf, name: 'ais-x-1' }),
    t.listArgs({ confPath: conf }),
    t.killArgs({ confPath: conf, name: 'ais-x-1' }),
    t.hasArgs({ confPath: conf, name: 'ais-x-1' }),
    ...t.metaArgs({ confPath: conf, name: 'ais-x-1', meta: { type: 'shell' } }),
  ]) {
    assert.deepStrictEqual(args.slice(0, 4), ['-L', t.SOCKET, '-f', conf], JSON.stringify(args));
  }
});

ok('il socket e parametrico, cosi i test non toccano le sessioni reali', () => {
  assert.deepStrictEqual(t.listArgs({ confPath: conf, socket: 'aistest' }).slice(0, 2), ['-L', 'aistest']);
});

ok('spawnArgs: -A per attaccare-o-creare, -d per creare staccata', () => {
  assert.ok(t.spawnArgs({ confPath: conf, name: 'n', cmd: 'c' }).includes('-A'));
  const d = t.spawnArgs({ confPath: conf, name: 'n', cmd: 'c', detached: true });
  assert.ok(d.includes('-d') && !d.includes('-A'));
});

ok('spawnArgs: il comando e i suoi argomenti stanno dopo --, intatti', () => {
  const a = t.spawnArgs({ confPath: conf, name: 'ais-claude-1', cmd: '/usr/local/bin/claude', args: ['--resume', 'uuid', '--flag=-x'], cwd: '/w' });
  const i = a.indexOf('--');
  assert.ok(i > 0);
  assert.deepStrictEqual(a.slice(i + 1), ['/usr/local/bin/claude', '--resume', 'uuid', '--flag=-x']);
  assert.deepStrictEqual(a.slice(a.indexOf('-c'), a.indexOf('-c') + 2), ['-c', '/w']);
});

ok('spawnArgs: l ambiente passa con -e, una coppia per variabile, prima di --', () => {
  const a = t.spawnArgs({ confPath: conf, name: 'n', cmd: 'c', env: { CLAUDE_CONFIG_DIR: '/x/y con spazi', PATH: '/a:/b' } });
  const i = a.indexOf('--');
  const pre = a.slice(0, i);
  assert.ok(pre.includes('-e'));
  assert.ok(pre.includes('CLAUDE_CONFIG_DIR=/x/y con spazi'));
  assert.ok(pre.includes('PATH=/a:/b'));
  assert.strictEqual(pre.filter((x) => x === '-e').length, 2);
});

ok('attach/kill/has usano il match esatto (=nome), set-option il nome nudo', () => {
  assert.ok(t.attachArgs({ confPath: conf, name: 'ais-x' }).includes('=ais-x'));
  assert.ok(t.killArgs({ confPath: conf, name: 'ais-x' }).includes('=ais-x'));
  assert.ok(t.hasArgs({ confPath: conf, name: 'ais-x' }).includes('=ais-x'));
  // set-option non accetta il prefisso = (verificato su tmux 3.7)
  for (const a of t.metaArgs({ confPath: conf, name: 'ais-x', meta: { type: 'shell' } })) {
    assert.ok(a.includes('ais-x') && !a.includes('=ais-x'), JSON.stringify(a));
  }
});

ok('metaArgs: un set-option per chiave presente, le chiavi nulle si saltano', () => {
  const list = t.metaArgs({ confPath: conf, name: 'n', meta: { type: 'claude', cwd: '/w', label: null, resume_id: undefined } });
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((a) => a.includes('@ais_type') && a.includes('claude')));
  assert.ok(list.some((a) => a.includes('@ais_cwd') && a.includes('/w')));
});

ok('parseSessionList: legge il formato, ignora sessioni altrui e righe rotte, ordina per recenza', () => {
  const S = t.FIELD_SEP;
  const riga = (name, created, attached, meta) => [name, created, attached, ...t.META_KEYS.map((k) => meta[k] || '')].join(S);
  const out = t.parseSessionList([
    riga('ais-shell-a', '1000', '0', { type: 'shell', cwd: '/a', label: 'vecchia' }),
    riga('xirp-altro', '5000', '1', { type: 'x' }),
    'riga senza separatori',
    riga('ais-claude-b', '2000', '1', { type: 'claude', cwd: '/b con spazi', label: 'Titolo: due punti', profile_id: 'claude:default', resume_id: 'uuid-1' }),
    '',
  ].join('\n'));
  assert.deepStrictEqual(out.map((s) => s.name), ['ais-claude-b', 'ais-shell-a'], 'piu recente prima, solo le nostre');
  assert.deepStrictEqual(out[0], {
    name: 'ais-claude-b', createdAt: 2000000, attached: true, type: 'claude', cwd: '/b con spazi', label: 'Titolo: due punti',
    profileId: 'claude:default', profileLabel: null, resumeId: 'uuid-1', accountId: null, accountName: null,
  });
  assert.deepStrictEqual(t.parseSessionList(''), []);
  assert.deepStrictEqual(t.parseSessionList(null), []);
});

ok('createTmuxControl: server assente vuol dire nessuna sessione, non un errore', async () => {
  const ctl = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => cb(new Error('no server running'), '', 'no server running') });
  assert.deepStrictEqual(await ctl.list(), []);
  assert.strictEqual(await ctl.has('ais-x'), false);
});

ok('createTmuxControl.create: prima new-session -d, poi i set-option, e riporta l errore di tmux', async () => {
  const calls = [];
  const ctl = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => { calls.push(a); cb(null, '', ''); } });
  const r = await ctl.create({ name: 'ais-x', cmd: '/bin/sh', args: ['-i'], cwd: '/w', env: { A: '1' }, meta: { type: 'shell', cwd: '/w' } });
  assert.strictEqual(r.ok, true);
  assert.ok(calls[0].includes('new-session') && calls[0].includes('-d'), 'la sessione va creata staccata');
  assert.ok(calls.slice(1).every((a) => a.includes('set-option') || a.includes('source-file')), 'i metadati vanno dopo la creazione');
  assert.strictEqual(calls.length, 4, 'new-session, source-file, due set-option');

  const bad = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => cb(new Error('x'), '', 'duplicate session: ais-x') });
  const e = await bad.create({ name: 'ais-x', cmd: 'c' });
  assert.deepStrictEqual(e, { ok: false, error: 'duplicate session: ais-x' });
});

ok('createTmuxControl.create: il client new-session gira col PATH della sessione, non con quello del processo', async () => {
  // tmux (verificato su 3.7) da' al comando iniziale il PATH del CLIENT che
  // esegue new-session, ignorando `-e PATH`: con l'app avviata dal Finder il
  // client avrebbe /usr/bin:/bin e `docker`, `brew`, ecc. non si troverebbero.
  const opts = [];
  const ctl = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => { opts.push(o); cb(null, '', ''); } });
  await ctl.create({ name: 'ais-x', cmd: '/bin/sh', env: { PATH: '/usr/local/bin:/usr/bin:/bin', A: '1' }, meta: {} });
  assert.strictEqual(opts[0].env.PATH, '/usr/local/bin:/usr/bin:/bin');
  assert.strictEqual(opts[0].env.HOME, process.env.HOME, 'il resto dell ambiente del processo resta');
  assert.strictEqual(opts[0].env.A, undefined, 'le altre variabili passano solo da -e, non al client');

  const noPath = [];
  const ctl2 = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => { noPath.push(o); cb(null, '', ''); } });
  await ctl2.create({ name: 'ais-y', cmd: 'c' });
  assert.strictEqual(noPath[0].env, undefined, 'senza PATH esplicito si eredita l ambiente del processo');
});

ok('detectTmux: null senza binario, altrimenti bin + config + controllo', () => {
  assert.strictEqual(t.detectTmux({ confPath: conf, platform: 'linux', resolve: () => ({ path: null }) }), null);
  const d = t.detectTmux({ confPath: conf, platform: 'linux', resolve: () => ({ path: '/opt/homebrew/bin/tmux' }) });
  assert.strictEqual(d.bin, '/opt/homebrew/bin/tmux');
  assert.strictEqual(d.confPath, conf);
  assert.strictEqual(d.socket, t.SOCKET);
  assert.strictEqual(typeof d.control.list, 'function');
});

/* L'app impacchettata sta in app.asar, un archivio che solo Electron sa
   leggere: tmux, processo esterno, non puo' aprire `…/app.asar/app/tmux.conf`
   e parte con i default (barra di stato verde, Ctrl+B attivo). electron-builder
   ne tiene una copia in app.asar.unpacked: e' quella da dare a tmux. */
ok('tmux: la config si passa dal percorso fuori dall asar', () => {
  assert.strictEqual(t.externalPath('/opt/PizzaManager/resources/app.asar/app/tmux.conf'), '/opt/PizzaManager/resources/app.asar.unpacked/app/tmux.conf');
  assert.strictEqual(t.externalPath('C:\\PizzaManager\\resources\\app.asar\\app\\tmux.conf'), 'C:\\PizzaManager\\resources\\app.asar.unpacked\\app\\tmux.conf');
  assert.strictEqual(t.externalPath('/src/PizzaManager/app/tmux.conf'), '/src/PizzaManager/app/tmux.conf', 'da sorgente non cambia');
  const d = t.detectTmux({ confPath: '/x/app.asar/app/tmux.conf', platform: 'linux', resolve: () => ({ path: '/usr/bin/tmux' }) });
  assert.strictEqual(d.confPath, '/x/app.asar.unpacked/app/tmux.conf');
});

/* tmux legge -f solo alla nascita del server: se il server e' stato avviato a
   mano (`tmux -L aisession attach` per curiosita') ha la config di default e
   l'app non potrebbe piu' correggerla. source-file la riapplica a ogni
   creazione: idempotente, e a costo di un comando. */
ok('createTmuxControl.create: riapplica la config al server con source-file, prima dei metadati', async () => {
  const calls = [];
  const ctl = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => { calls.push(a); cb(null, '', ''); } });
  await ctl.create({ name: 'ais-x', cmd: '/bin/sh', meta: { type: 'shell' } });
  const i = calls.findIndex((a) => a.includes('source-file'));
  assert.ok(i > 0, 'manca source-file');
  assert.ok(calls[i].includes(conf), 'source-file deve ricevere la config dell app');
  assert.ok(calls[0].includes('new-session'), 'prima la sessione');
  assert.ok(calls.slice(i + 1).every((a) => a.includes('set-option')), 'i metadati vengono dopo');
});

// ---------- scorrimento: la history vera è quella di tmux ----------
// tmux scorre il terminale esterno con `CSI n S`, righe che xterm.js non mette
// nello scrollback: la rotella deve muovere la copy-mode di tmux.

ok('scroll: copy-mode, righe e lettura dello stato in un solo comando tmux', () => {
  const up = t.scrollArgs({ confPath: conf, name: 'ais-x-1', lines: 3 });
  assert.deepStrictEqual(up.slice(0, 4), ['-L', t.SOCKET, '-f', conf]);
  const cmds = up.slice(4).join(' ').split(' ; ');
  assert.deepStrictEqual(cmds, [
    'copy-mode -e -t =ais-x-1:',
    'send-keys -t =ais-x-1: -X -N 3 scroll-up',
    `display-message -p -t =ais-x-1: ${t.SCROLL_FORMAT}`,
  ]);
  const down = t.scrollArgs({ confPath: conf, name: 'ais-x-1', lines: -2 });
  assert.ok(down.includes('scroll-down') && down.includes('2'), JSON.stringify(down));
});

ok('scroll: il salto a una riga usa goto-line, il fondo esce dalla copy-mode', () => {
  const to = t.scrollToArgs({ confPath: conf, name: 'ais-x-1', fromBottom: 120 });
  assert.ok(to.join(' ').includes('send-keys -t =ais-x-1: -X goto-line 120'), JSON.stringify(to));
  const bottom = t.scrollToArgs({ confPath: conf, name: 'ais-x-1', fromBottom: 0 });
  assert.ok(bottom.join(' ').includes('-X cancel'), JSON.stringify(bottom));
  assert.ok(!bottom.includes('goto-line'));
});

ok('scroll: righe non valide non arrivano a tmux come argomenti', () => {
  for (const lines of [0, NaN, '3; kill-server', undefined]) {
    assert.strictEqual(t.scrollArgs({ name: 'ais-x-1', lines }), null, String(lines));
  }
  assert.strictEqual(t.scrollToArgs({ name: 'ais-x-1', fromBottom: -1 }), null);
  const big = t.scrollArgs({ name: 'ais-x-1', lines: 1e9 });
  assert.ok(big.includes(String(t.MAX_SCROLL_STEP)), 'un passo enorme viene limitato');
});

ok('parseScrollState: legge history, posizione, copy-mode e righe', () => {
  const S = t.FIELD_SEP;
  assert.deepStrictEqual(t.parseScrollState(`1${S}10${S}278${S}24${S}0\n`), { inMode: true, position: 10, history: 278, rows: 24, alternate: false });
  assert.deepStrictEqual(t.parseScrollState(`0${S}${S}278${S}24${S}1`), { inMode: false, position: 0, history: 278, rows: 24, alternate: true });
  assert.strictEqual(t.parseScrollState(`${S}${S}${S}${S}`), null, 'sessione inesistente: tmux stampa campi vuoti');
  assert.strictEqual(t.parseScrollState(''), null);
});

ok('createTmuxControl.scroll: stato letto dalla risposta, null se tmux fallisce', async () => {
  const S = t.FIELD_SEP;
  const calls = [];
  const ctl = t.createTmuxControl({ bin: '/bin/tmux', confPath: conf, run: (b, a, o, cb) => { calls.push(a); cb(null, `1${S}3${S}50${S}24${S}0`, ''); } });
  assert.deepStrictEqual(await ctl.scroll('ais-x-1', 3), { inMode: true, position: 3, history: 50, rows: 24, alternate: false });
  assert.strictEqual((await ctl.scrollTo('ais-x-1', 0)).position, 3);
  assert.strictEqual((await ctl.scrollState('ais-x-1')).history, 50);
  assert.strictEqual(await ctl.scroll('ais-x-1', 0), null, 'niente da fare: nessun comando');
  assert.strictEqual(calls.length, 3);
  const bad = t.createTmuxControl({ bin: '/bin/tmux', run: (b, a, o, cb) => cb(new Error('x'), '', 'no server') });
  assert.strictEqual(await bad.scroll('ais-x-1', 3), null);
});

ok('captureArgs: socket dedicato, bersaglio col due punti, tetto di righe', () => {
  const a = t.captureArgs({ confPath: conf, name: 'ais-shell-1', lines: 2000 });
  assert.deepStrictEqual(a.slice(0, 4), ['-L', 'aisession', '-f', conf], 'senza -L colpirebbe le sessioni personali');
  assert.ok(a.includes('capture-pane'));
  assert.ok(a.includes('-p'), 'senza -p il testo non arriva sullo stdout');
  assert.ok(a.includes('-e'), 'senza -e si perdono i colori');
  // Con `=nome` nudo tmux risponde "can't find pane" (verificato su 3.7c),
  // come gia' per lo scorrimento: il bersaglio pane vuole i due punti.
  assert.ok(a.includes('=ais-shell-1:'), a.join(' '));
  assert.ok(a.includes('-2000'), 'il tetto di righe si passa a -S, negativo');
});

ok('captureArgs: un tetto assurdo o assente ricade sul default', () => {
  const start = (args) => args[args.indexOf('-S') + 1];
  assert.strictEqual(start(t.captureArgs({ name: 'ais-shell-1' })), '-2000');
  assert.strictEqual(start(t.captureArgs({ name: 'ais-shell-1', lines: 0 })), '-2000');
  assert.strictEqual(start(t.captureArgs({ name: 'ais-shell-1', lines: -5 })), '-2000');
  assert.strictEqual(start(t.captureArgs({ name: 'ais-shell-1', lines: 1e9 })), '-' + t.MAX_SCROLL_STEP);
});

ok('spawnArgs: la sessione nasce gia della misura del client', () => {
  // La sessione nasce staccata e il client si attacca dopo: senza -x/-y il
  // pane e' 80x24, e il testo ripristinato resterebbe mandato a capo a 80
  // colonne DENTRO la history, dove il resize non lo raddrizza piu'.
  const a = t.spawnArgs({ confPath: conf, name: 'ais-shell-1', cmd: '/bin/zsh', cols: 203, rows: 51 });
  assert.strictEqual(a[a.indexOf('-x') + 1], '203');
  assert.strictEqual(a[a.indexOf('-y') + 1], '51');
  const senza = t.spawnArgs({ confPath: conf, name: 'ais-shell-1', cmd: '/bin/zsh' });
  assert.ok(!senza.includes('-x'), 'senza misure si lascia decidere tmux');
  for (const bad of [0, -5, null, 1.5, 1e9]) {
    const s = t.spawnArgs({ confPath: conf, name: 'ais-shell-1', cmd: '/bin/zsh', cols: bad, rows: bad });
    assert.ok(!s.includes('-x'), `misura non valida accettata: ${bad}`);
  }
});

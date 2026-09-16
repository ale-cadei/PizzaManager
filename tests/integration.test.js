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
  const testo = out.toString().trim();
  // Con zero sessioni opencode non stampa nulla, nemmeno "[]". Non c'e' niente
  // da verificare sul formato — ed e' il caso che oggi manda in errore il
  // dialog Resume: vedi docs/plans/04-robustness.md.
  if (!testo) return t.skip('nessuna sessione opencode su questa macchina');
  assert.ok(Array.isArray(JSON.parse(testo)), 'opencode non restituisce piu un array: il dialog Resume si rompe');
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

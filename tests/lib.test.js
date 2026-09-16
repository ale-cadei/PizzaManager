const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

// ---------- lib/binaries ----------
const { candidatesFor, nodeToolCandidates, isExecutable, resolveBinary, augmentedEnv, AI_BINARIES } = require('../lib/binaries');

ok('i candidati di ogni tool AI sono percorsi assoluti e non vuoti', () => {
  for (const tool of Object.values(AI_BINARIES)) {
    const list = candidatesFor(tool, '/home/tizio');
    assert.ok(list.length, `nessun candidato per ${tool}`);
    for (const c of list) assert.ok(path.isAbsolute(c), `candidato relativo: ${c}`);
    assert.ok(list.every((c) => path.basename(c) === tool), `un candidato di ${tool} punta a un altro binario`);
  }
});

ok('un tool sconosciuto non ha candidati', () => {
  assert.deepStrictEqual(candidatesFor('tool-inventato', '/home/tizio'), []);
});

ok('i candidati coprono i gestori di versioni piu diffusi', () => {
  const list = nodeToolCandidates('claude', '/home/tizio').join('\n');
  for (const manager of ['.local/bin', 'homebrew', '.npm-global', '.volta', '.asdf']) {
    assert.ok(list.includes(manager), `manca il percorso per ${manager}`);
  }
});

ok('opencode viene cercato anche nella sua directory dedicata', () => {
  assert.ok(candidatesFor('opencode', '/home/tizio').includes('/home/tizio/.opencode/bin/opencode'));
});

ok('isExecutable distingue file eseguibili, non eseguibili e directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-exec-'));
  const script = path.join(dir, 'script');
  fs.writeFileSync(script, '#!/bin/sh\n', { mode: 0o755 });
  const plain = path.join(dir, 'dati.txt');
  fs.writeFileSync(plain, 'x', { mode: 0o644 });

  assert.strictEqual(isExecutable(script), true);
  assert.strictEqual(isExecutable(plain), false, 'un file senza permesso di esecuzione non e un binario');
  assert.strictEqual(isExecutable(dir), false, 'una directory eseguibile non e un binario');
  assert.strictEqual(isExecutable(path.join(dir, 'inesistente')), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

ok('resolveBinary trova un binario nel PATH che gli viene passato', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-path-'));
  fs.writeFileSync(path.join(dir, 'finto-tool'), '#!/bin/sh\n', { mode: 0o755 });
  const r = resolveBinary('finto-tool', { searchPath: dir, home: '/home/nessuno' });
  assert.strictEqual(r.path, path.join(dir, 'finto-tool'));
  assert.ok(r.via.startsWith('PATH:'));
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('resolveBinary segnala il PATH cercato quando non trova niente', () => {
  const r = resolveBinary('tool-che-non-esiste', { searchPath: '/nessuna/dir', home: '/home/nessuno' });
  assert.strictEqual(r.path, null);
  assert.strictEqual(r.searchedPath, '/nessuna/dir');
});

ok('augmentedEnv dichiara un terminale a colori pieni e preserva le altre variabili', () => {
  const env = augmentedEnv([], {}, { PATH: '/bin', MIA_VAR: 'valore' });
  assert.strictEqual(env.TERM, 'xterm-256color');
  assert.strictEqual(env.COLORTERM, 'truecolor');
  assert.strictEqual(env.MIA_VAR, 'valore');
});

ok('augmentedEnv aggiunge al PATH la directory dei binari indicati', () => {
  const env = augmentedEnv(['/opt/strumenti/mio-tool'], {}, { PATH: '/bin' });
  assert.ok(env.PATH.split(':').includes('/opt/strumenti'));
});

ok('augmentedEnv non duplica le voci del PATH', () => {
  const env = augmentedEnv(['/bin/qualcosa'], {}, { PATH: '/bin:/usr/bin:/bin' });
  const voci = env.PATH.split(':');
  assert.strictEqual(voci.length, new Set(voci).size, 'PATH con duplicati: ' + env.PATH);
});

ok('le variabili extra hanno precedenza su quelle dell ambiente', () => {
  const env = augmentedEnv([], { ANTHROPIC_API_KEY: 'nuova' }, { PATH: '/bin', ANTHROPIC_API_KEY: 'vecchia' });
  assert.strictEqual(env.ANTHROPIC_API_KEY, 'nuova');
});

// ---------- lib/login-path ----------
const { computeLoginPath, dedupePath } = require('../lib/login-path');

ok('il PATH della shell di login viene anteposto a quello del processo', () => {
  const p = computeLoginPath({
    env: { PATH: '/bin' },
    exec: () => '/opt/homebrew/bin:/usr/bin\n',
    shell: '/bin/zsh',
  });
  assert.strictEqual(p, '/opt/homebrew/bin:/usr/bin:/bin');
});

ok('se la shell fallisce si resta col PATH del processo', () => {
  const p = computeLoginPath({
    env: { PATH: '/bin:/usr/bin' },
    exec: () => { throw new Error('shell assente'); },
    shell: '/bin/zsh',
  });
  assert.strictEqual(p, '/bin:/usr/bin');
});

ok('viene letta solo l ultima riga, cosi i messaggi della rc non sporcano il PATH', () => {
  const p = computeLoginPath({
    env: { PATH: '/bin' },
    exec: () => 'Benvenuto!\nnvm caricato\n/opt/bin:/usr/bin\n',
    shell: '/bin/zsh',
  });
  assert.strictEqual(p, '/opt/bin:/usr/bin:/bin');
});

ok('un output della shell senza percorsi viene ignorato', () => {
  const p = computeLoginPath({ env: { PATH: '/bin' }, exec: () => 'niente-di-utile\n', shell: '/bin/zsh' });
  assert.strictEqual(p, '/bin');
});

ok('dedupePath tiene la prima occorrenza e scarta le successive', () => {
  assert.strictEqual(dedupePath('/a:/b:/a:/c:/b'), '/a:/b:/c');
  assert.strictEqual(dedupePath('/a::/b:'), '/a:/b', 'le voci vuote vanno tolte');
});

// ---------- lib/claude-sessions ----------
const { listClaudeSessions } = require('../lib/claude-sessions');

ok('una directory di progetti inesistente da un errore, non un crash', () => {
  const r = listClaudeSessions(10, { base: '/percorso/che/non/esiste' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.sessions, []);
  assert.ok(r.error.includes('non trovata'));
});

ok('le sessioni sono ordinate dalla piu recente e rispettano il limite', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-proj-'));
  const proj = path.join(base, '-Users-tizio-app');
  fs.mkdirSync(proj);
  const riga = (t) => JSON.stringify({ cwd: '/Users/tizio/app', message: { role: 'user', content: [{ type: 'text', text: t }] } });
  for (const [nome, testo] of [['vecchia', 'la prima'], ['media', 'la seconda'], ['recente', 'la terza']]) {
    fs.writeFileSync(path.join(proj, `${nome}.jsonl`), riga(testo) + '\n');
  }
  fs.utimesSync(path.join(proj, 'vecchia.jsonl'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(proj, 'media.jsonl'), new Date(2000), new Date(2000));
  fs.utimesSync(path.join(proj, 'recente.jsonl'), new Date(3000), new Date(3000));

  const tutte = listClaudeSessions(null, { base });
  assert.strictEqual(tutte.ok, true);
  assert.deepStrictEqual(tutte.sessions.map((s) => s.id), ['recente', 'media', 'vecchia']);
  assert.strictEqual(tutte.sessions[0].title, 'la terza');

  assert.strictEqual(listClaudeSessions(2, { base }).sessions.length, 2, 'il limite non e rispettato');

  fs.rmSync(base, { recursive: true, force: true });
});

ok('i file che non sono .jsonl vengono ignorati', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-proj-'));
  const proj = path.join(base, '-Users-tizio-app');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'appunti.txt'), 'niente');
  fs.writeFileSync(path.join(proj, 'vera.jsonl'), '{"summary":"una sessione"}\n');
  const r = listClaudeSessions(null, { base });
  assert.deepStrictEqual(r.sessions.map((s) => s.id), ['vera']);
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------- lib/opencode-sessions ----------
const { listOpencodeSessions } = require('../lib/opencode-sessions');

ok('opencode: zero sessioni (output vuoto) e un risultato, non un errore', async () => {
  // opencode con nessuna sessione non stampa nemmeno "[]": prima l'utente leggeva "Parse JSON fallito"
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(null, '', '') });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions, []);
});

ok('opencode: un output non JSON e un errore che dice cosa e arrivato', async () => {
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(null, 'non e json', '') });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('non è JSON') && r.error.includes('non e json'), r.error);
});

ok('opencode: JSON valido ma non un elenco = formato cambiato, segnalato come tale', async () => {
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(null, '{"sessions": []}', '') });
  assert.strictEqual(r.ok, false);
  assert.ok(/formato inatteso/.test(r.error), r.error);
});

ok('opencode: le voci senza id vengono scartate e contate, le altre passano', async () => {
  const out = JSON.stringify([{ id: 'ses_1', title: 'ok' }, { title: 'senza id' }, null, { id: 'ses_2' }]);
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(null, out, '') });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions.map((s) => s.id), ['ses_1', 'ses_2']);
  assert.strictEqual(r.skipped, 2);
});

ok('un errore di esecuzione di opencode riporta lo stderr', async () => {
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(new Error('uscita 1'), '', 'comando sconosciuto') });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('comando sconosciuto'), r.error);
});

ok('un elenco valido viene restituito cosi com e', async () => {
  const sessioni = [{ id: 'ses_1', title: 'prima' }];
  const r = await listOpencodeSessions(5, { run: (c, a, o, cb) => cb(null, JSON.stringify(sessioni), '') });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions, sessioni);
});

// ---------- lib/login-path: mai bloccare il main ----------
const { primeLoginPath, getLoginPathSync, resetLoginPathCache, computeLoginPathAsync } = require('../lib/login-path');

ok('getLoginPathSync non interroga mai la shell: a cache fredda da il PATH del processo, subito', () => {
  resetLoginPathCache();
  const p = getLoginPathSync({ env: { PATH: '/bin:/usr/bin' } });
  assert.strictEqual(p, '/bin:/usr/bin');
});

ok('primeLoginPath: chiamate concorrenti condividono UNA shell, e riempiono la cache', async () => {
  resetLoginPathCache();
  let calls = 0;
  const run = (sh, args, opts, cb) => { calls++; setTimeout(() => cb(null, '/opt/homebrew/bin:/usr/bin\n'), 10); };
  const [a, b, c] = await Promise.all([
    primeLoginPath({ env: { PATH: '/bin' }, run, shell: '/bin/zsh' }),
    primeLoginPath({ env: { PATH: '/bin' }, run, shell: '/bin/zsh' }),
    primeLoginPath({ env: { PATH: '/bin' }, run, shell: '/bin/zsh' }),
  ]);
  assert.strictEqual(calls, 1, 'tre chiamate all avvio devono lanciare una sola shell');
  assert.strictEqual(a, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.strictEqual(b, a); assert.strictEqual(c, a);
  assert.strictEqual(getLoginPathSync(), a, 'dopo il prime la versione sincrona serve la cache');
  resetLoginPathCache();
});

ok('computeLoginPathAsync: se la shell fallisce si resta col PATH del processo', async () => {
  const p = await computeLoginPathAsync({ env: { PATH: '/bin' }, run: (s, a, o, cb) => cb(new Error('timeout')), shell: '/bin/zsh' });
  assert.strictEqual(p, '/bin');
});

ok('computeLoginPathAsync: legge solo l ultima riga, le rc possono stampare', async () => {
  const p = await computeLoginPathAsync({ env: { PATH: '/bin' }, run: (s, a, o, cb) => cb(null, 'Benvenuto!\n/opt/bin:/usr/bin\n'), shell: '/bin/zsh' });
  assert.strictEqual(p, '/opt/bin:/usr/bin:/bin');
});

ok('claude-sessions: i file illeggibili vengono contati, non nascosti', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-proj-'));
  const proj = path.join(base, '-Users-tizio-app');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'buona.jsonl'), '{"summary":"ok"}\n');
  // una directory di progetto illeggibile (permessi) va contata come scarto
  const chiusa = path.join(base, '-Users-tizio-chiusa');
  fs.mkdirSync(chiusa, { mode: 0o000 });
  const { listClaudeSessions } = require('../lib/claude-sessions');
  const r = listClaudeSessions(null, { base });
  fs.chmodSync(chiusa, 0o755);
  fs.rmSync(base, { recursive: true, force: true });
  if (process.getuid && process.getuid() === 0) return; // root legge tutto: il caso non si riproduce
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions.map((s) => s.id), ['buona']);
  assert.strictEqual(r.skipped, 1, 'la directory illeggibile doveva essere contata');
});

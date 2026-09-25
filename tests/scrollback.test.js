const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createScrollbackStore, shouldCapture, SEPARATOR, MAX_LINES } = require('../lib/scrollback');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-sb-'));
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);

ok('store: salva, rilegge, cancella', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  assert.strictEqual(store.read('ais-shell-1'), null, 'una chiave mai salvata non ha testo');
  store.save('ais-shell-1', 'ciao\nmondo');
  assert.strictEqual(store.read('ais-shell-1'), 'ciao\nmondo');
  store.remove('ais-shell-1');
  assert.strictEqual(store.read('ais-shell-1'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('store: il file e leggibile solo dal proprietario (puo contenere segreti)', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  store.save('ais-shell-1', 'export TOKEN=sk-segretissimo');
  assert.strictEqual(mode(store.fileFor('ais-shell-1')), '600');
  // Riscrivere un file gia esistente non deve allentare i permessi:
  // writeFileSync applica il mode solo alla creazione.
  fs.chmodSync(store.fileFor('ais-shell-1'), 0o644);
  store.save('ais-shell-1', 'altro');
  assert.strictEqual(mode(store.fileFor('ais-shell-1')), '600');
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('store: remove di una chiave che non c e non lancia', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  assert.doesNotThrow(() => store.remove('mai-vista'));
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('store: una chiave inventata non puo uscire dalla cartella', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  for (const cattiva of ['../fuori', 'a/b', 'a\\b', '']) {
    assert.throws(() => store.save(cattiva, 'x'), /chiave/i, `accettata: ${JSON.stringify(cattiva)}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('sweep: restano solo le chiavi vive, il resto sparisce', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  store.save('ais-shell-viva', 'a');
  store.save('ais-shell-orfana', 'b');
  store.sweep(['ais-shell-viva']);
  assert.strictEqual(store.read('ais-shell-viva'), 'a');
  assert.strictEqual(store.read('ais-shell-orfana'), null, 'il file orfano puo contenere segreti: va via');
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('sweep: senza cartella non lancia (primo avvio)', () => {
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  assert.doesNotThrow(() => store.sweep([]));
  fs.rmSync(dir, { recursive: true, force: true });
});

ok('si cattura solo la shell, e non mentre un pager tiene l alternate screen', () => {
  assert.strictEqual(shouldCapture({ type: 'shell', alternate: false }), true);
  assert.strictEqual(shouldCapture({ type: 'shell', alternate: true }), false, 'sarebbe il fotogramma di un less, non una cronologia');
  for (const t of ['claude', 'codex', 'opencode', 'antigravity']) {
    assert.strictEqual(shouldCapture({ type: t, alternate: false }), false, `${t} riprende con --resume, e una TUI`);
  }
  assert.strictEqual(shouldCapture({ type: undefined, alternate: false }), false);
});

ok('il separatore dice che quel pezzo e passato', () => {
  assert.match(SEPARATOR, /cronologia ripristinata/);
  assert.match(SEPARATOR, /\n$/, 'il prompt della shell deve partire dalla riga dopo');
  assert.strictEqual(MAX_LINES, 2000);
});

/* Un riavvio (o `kill-server`) lascia tmux senza sessioni: i file da
   ripristinare appartengono proprio a quelle, che vivono ormai solo nel
   registro. La pulizia all'avvio gira PRIMA del modal «Ripristina»: se
   guardasse solo tmux, cancellerebbe tutto un attimo prima che serva. */
ok('pulizia all avvio: tiene i file delle sessioni nel registro, anche se tmux non ne ha piu', async () => {
  const { createPtyManager } = require('../app/pty');
  const { createLiveSessionsStore } = require('../lib/live-sessions');
  const dir = tmp();
  const store = createScrollbackStore({ dir });
  const live = createLiveSessionsStore({ dir });
  for (const k of ['ais-shell-prima', 'ais-shell-viva', 'ais-shell-orfana']) store.save(k, `testo di ${k}`);
  live.write([{ name: 'ais-shell-prima', type: 'shell' }]);
  const tmux = { bin: 'tmux', control: { list: async () => [{ name: 'ais-shell-viva' }] } };
  const mgr = createPtyManager({
    accounts: () => null, history: () => null, profiles: { load: () => ({}) }, sendToRenderer: () => {},
    tmux, liveStore: () => live, scrollbackStore: () => store,
  });

  await mgr.sweepScrollback();

  assert.strictEqual(store.read('ais-shell-prima'), 'testo di ais-shell-prima', 'e il testo da ripristinare dopo il riavvio');
  assert.strictEqual(store.read('ais-shell-viva'), 'testo di ais-shell-viva');
  assert.strictEqual(store.read('ais-shell-orfana'), null, 'ne viva ne nel registro: orfana');
  fs.rmSync(dir, { recursive: true, force: true });
});

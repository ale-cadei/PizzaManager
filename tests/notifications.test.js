// lib/notifications.js: quando notificare, che testo, come raggruppare (piano 38)
const assert = require('node:assert');
const { test: ok } = require('node:test');
const N = require('../lib/notifications');

const item = (id, extra = {}) => ({ id, name: `sessione ${id}`, typeLabel: 'Claude', where: '~/progetto', ...extra });

ok('notifiche: solo macOS e Linux, Windows resta com era', () => {
  assert.strictEqual(N.isPlatformSupported('darwin'), true);
  assert.strictEqual(N.isPlatformSupported('linux'), true);
  assert.strictEqual(N.isPlatformSupported('win32'), false);
  assert.strictEqual(N.isPlatformSupported(undefined), N.isPlatformSupported(process.platform), 'il default è la piattaforma corrente');
});

ok('notifiche: partono solo se accese, supportate e con la finestra dietro', () => {
  assert.strictEqual(N.shouldNotify({ enabled: true, focused: false, supported: true }), true);
  assert.strictEqual(N.shouldNotify({ enabled: true, focused: true, supported: true }), false, 'la finestra davanti basta il lampeggio');
  assert.strictEqual(N.shouldNotify({ enabled: false, focused: false, supported: true }), false, 'spente dal menu');
  assert.strictEqual(N.shouldNotify({ enabled: true, focused: false, supported: false }), false, 'piattaforma non supportata');
  assert.strictEqual(N.shouldNotify({}), false, 'senza informazioni non si notifica');
});

ok('notifiche: una sessione sola dice chi ha finito e dove', () => {
  const n = N.composeNotification([item('a', { name: 'refactor login' })]);
  assert.deepStrictEqual(n, { title: 'Claude ha finito', body: 'refactor login · ~/progetto', tabId: 'a' });
});

ok('notifiche: senza percorso o senza nome il corpo non ha separatori orfani', () => {
  assert.strictEqual(N.composeNotification([item('a', { where: '' })]).body, 'sessione a');
  assert.strictEqual(N.composeNotification([item('a', { name: '' })]).body, '~/progetto');
});

ok('notifiche: più sessioni insieme diventano una notifica sola', () => {
  const n = N.composeNotification([item('a'), item('b', { typeLabel: 'Codex' }), item('c')]);
  assert.strictEqual(n.title, '3 sessioni hanno finito');
  assert.strictEqual(n.body, 'sessione a · sessione b · sessione c');
  assert.strictEqual(n.tabId, 'a', 'il click apre la prima');
});

ok('notifiche: un corpo troppo lungo si tronca con i puntini', () => {
  const many = Array.from({ length: 30 }, (_, i) => item(`s${i}`, { name: `una sessione dal nome lungo ${i}` }));
  const n = N.composeNotification(many);
  assert.ok(n.body.length <= N.MAX_BODY, `corpo di ${n.body.length} caratteri`);
  assert.ok(n.body.endsWith('…'));
});

ok('notifiche: niente voci, niente notifica', () => {
  assert.strictEqual(N.composeNotification([]), null);
  assert.strictEqual(N.composeNotification(undefined), null);
});

ok('notifiche: le voci dal renderer si validano, quelle sporche si scartano', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { id: '' }, { id: 7 }]) {
    assert.strictEqual(N.validateItem(bad), null, `accettata ${JSON.stringify(bad)}`);
  }
  assert.deepStrictEqual(N.validateItem({ id: 'a' }), { id: 'a', name: '', typeLabel: 'Sessione', where: '', kind: 'done' });
  const huge = N.validateItem({ id: 'a', name: 'x'.repeat(5000), typeLabel: 3, where: { p: 1 } });
  assert.ok(huge.name.length <= N.MAX_FIELD, 'testo accorciato');
  assert.strictEqual(huge.typeLabel, 'Sessione', 'un tipo non stringa torna al default');
  assert.strictEqual(huge.where, '');
});

ok('notifiche: il badge accetta solo interi non negativi', () => {
  assert.strictEqual(N.validateBadgeCount(3), 3);
  assert.strictEqual(N.validateBadgeCount(0), 0);
  for (const bad of [-1, 2.5, '3', null, undefined, NaN, Infinity]) {
    assert.strictEqual(N.validateBadgeCount(bad), 0, `${String(bad)}`);
  }
});

/** Timer finto: si avanza a mano, niente attese vere. */
function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    schedule: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    cancel: (t) => { timers = timers.filter((x) => x !== t); },
    advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      due.forEach((t) => t.fn());
    },
    pending: () => timers.length,
  };
}

ok('raggruppa: tre sessioni che finiscono entro la finestra → un flush solo', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = N.createCoalescer({ windowMs: 1500, schedule: clock.schedule, cancel: clock.cancel, onFlush: (items) => flushed.push(items) });
  c.push(item('a'));
  clock.advance(500);
  c.push(item('b'));
  clock.advance(500);
  c.push(item('c'));
  assert.strictEqual(flushed.length, 0, 'non prima della fine della finestra');
  clock.advance(500);
  assert.deepStrictEqual(flushed.map((f) => f.map((i) => i.id)), [['a', 'b', 'c']]);
});

ok('raggruppa: due sessioni lontane → due flush, la finestra non si allunga', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = N.createCoalescer({ windowMs: 1500, schedule: clock.schedule, cancel: clock.cancel, onFlush: (items) => flushed.push(items) });
  c.push(item('a'));
  clock.advance(2000);
  c.push(item('b'));
  clock.advance(2000);
  assert.deepStrictEqual(flushed.map((f) => f.map((i) => i.id)), [['a'], ['b']]);
});

ok('raggruppa: la stessa scheda due volte nella finestra conta una', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = N.createCoalescer({ windowMs: 1500, schedule: clock.schedule, cancel: clock.cancel, onFlush: (items) => flushed.push(items) });
  c.push(item('a', { name: 'vecchio' }));
  c.push(item('a', { name: 'nuovo' }));
  clock.advance(1500);
  assert.deepStrictEqual(flushed, [[item('a', { name: 'nuovo' })]]);
});

ok('raggruppa: dispose butta quello che aspettava', () => {
  const clock = fakeClock();
  const flushed = [];
  const c = N.createCoalescer({ windowMs: 1500, schedule: clock.schedule, cancel: clock.cancel, onFlush: (items) => flushed.push(items) });
  c.push(item('a'));
  c.dispose();
  clock.advance(5000);
  assert.deepStrictEqual(flushed, []);
  assert.strictEqual(clock.pending(), 0);
});

// ---------- piano 46: il permesso ----------
ok('notifiche: un permesso ha il suo titolo', () => {
  const n = N.composeNotification([N.validateItem(item('a', { kind: 'permission' }))]);
  assert.strictEqual(n.title, 'Claude chiede un permesso');
});

ok('notifiche: kind ignoto vale «ha finito»', () => {
  assert.strictEqual(N.validateItem(item('a', { kind: 'boh' })).kind, 'done');
  assert.strictEqual(N.validateItem(item('a')).kind, 'done');
});

ok('notifiche: più sessioni e almeno un permesso → «ti aspettano»', () => {
  const n = N.composeNotification([N.validateItem(item('a')), N.validateItem(item('b', { kind: 'permission' }))]);
  assert.strictEqual(n.title, '2 sessioni ti aspettano');
  const m = N.composeNotification([N.validateItem(item('a')), N.validateItem(item('b'))]);
  assert.strictEqual(m.title, '2 sessioni hanno finito', 'senza permessi il testo di prima');
});

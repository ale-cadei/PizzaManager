const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, descendants } = require('./fake-dom');
const { createSearchRunner, snippetElement, statusText, hitsText, MIN_QUERY, DELAY_MS } = require('../renderer/search-results');

/* ---------- Linguetta «Cerca» del Resume (renderer/search-results.js) ---------- */

/** Timer finti: si fanno scattare a mano, niente attese vere. */
function fakeTimers() {
  let next = 1;
  let pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; pending = new Map(pending).set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { pending = new Map([...pending].filter(([k]) => k !== id)); },
    pending: () => [...pending.values()],
    fire: () => { const all = [...pending.values()]; pending = new Map(); all.forEach((t) => t.fn()); },
  };
}

/** Ricerca finta che risponde quando lo decide il test. */
function deferredSearch() {
  const calls = [];
  const search = (q) => new Promise((resolve, reject) => calls.push({ q, resolve, reject }));
  return { search, calls };
}

const flush = () => new Promise((r) => setImmediate(r));

ok('cerca: sotto i 2 caratteri non interroga il main', async () => {
  const { search, calls } = deferredSearch();
  const states = [];
  const runner = createSearchRunner({ search, render: (s) => states.push(s), timers: fakeTimers() });
  await runner.run(' a ');
  assert.strictEqual(MIN_QUERY, 2);
  assert.deepStrictEqual(states, [{ phase: 'short' }]);
  assert.strictEqual(calls.length, 0);
});

ok('cerca: prima «Cerco…», poi i risultati', async () => {
  const { search, calls } = deferredSearch();
  const states = [];
  const runner = createSearchRunner({ search, render: (s) => states.push(s), timers: fakeTimers() });
  const done = runner.run('login');
  await flush();
  assert.deepStrictEqual(states, [{ phase: 'loading', query: 'login' }]);
  calls[0].resolve({ ok: true, results: [{ id: 'a' }], truncated: true });
  await done;
  assert.deepStrictEqual(states[1], { phase: 'results', query: 'login', results: [{ id: 'a' }], truncated: true, skipped: 0 });
});

ok('cerca: nessun risultato, errore del main ed eccezione diventano stati da mostrare', async () => {
  const cases = [
    [{ ok: true, results: [] }, { phase: 'empty', query: 'zz' }],
    [{ ok: false, error: 'boom', results: [] }, { phase: 'error', error: 'boom' }],
  ];
  for (const [res, expected] of cases) {
    const states = [];
    await createSearchRunner({ search: async () => res, render: (s) => states.push(s), timers: fakeTimers() }).run('zz');
    assert.deepStrictEqual(states.at(-1), expected);
  }
  const states = [];
  await createSearchRunner({ search: async () => { throw new Error('ipc giù'); }, render: (s) => states.push(s), timers: fakeTimers() }).run('zz');
  assert.deepStrictEqual(states.at(-1), { phase: 'error', error: 'ipc giù' });
});

ok('cerca: aspetta 300 ms dall ultimo tasto e cerca una volta sola', async () => {
  const timers = fakeTimers();
  const { search, calls } = deferredSearch();
  const runner = createSearchRunner({ search, render: () => {}, timers });
  runner.schedule('lo'); runner.schedule('log'); runner.schedule('login');
  assert.strictEqual(timers.pending().length, 1, 'un solo timer attivo');
  assert.strictEqual(timers.pending()[0].ms, DELAY_MS);
  assert.strictEqual(DELAY_MS, 300);
  timers.fire();
  await flush();
  assert.deepStrictEqual(calls.map((c) => c.q), ['login']);
});

ok('cerca: la risposta di una ricerca superata si butta', async () => {
  const timers = fakeTimers();
  const { search, calls } = deferredSearch();
  const states = [];
  const runner = createSearchRunner({ search, render: (s) => states.push(s), timers });
  const first = runner.run('vecchia');
  await flush();
  const second = runner.run('nuova');
  await flush();
  calls[1].resolve({ ok: true, results: [{ id: 'nuova' }] });
  calls[0].resolve({ ok: true, results: [{ id: 'vecchia' }] }); // arriva per ultima
  await Promise.all([first, second]);
  const shown = states.filter((s) => s.phase === 'results').map((s) => s.results[0].id);
  assert.deepStrictEqual(shown, ['nuova']);
});

ok('cerca: anche un tasto premuto mentre la ricerca gira rende vecchia la risposta', async () => {
  const timers = fakeTimers();
  const { search, calls } = deferredSearch();
  const states = [];
  const runner = createSearchRunner({ search, render: (s) => states.push(s), timers });
  const first = runner.run('login');
  await flush();
  runner.schedule('login rotto');
  calls[0].resolve({ ok: true, results: [{ id: 'x' }] });
  await first;
  assert.ok(!states.some((s) => s.phase === 'results'), 'la risposta per «login» non va mostrata');
});

ok('cerca: le risposte annullate dal worker non si mostrano; cancel ferma timer e risposte', async () => {
  const timers = fakeTimers();
  const states = [];
  await createSearchRunner({ search: async () => ({ ok: false, cancelled: true, results: [] }), render: (s) => states.push(s), timers }).run('ab');
  assert.deepStrictEqual(states.map((s) => s.phase), ['loading']);

  const { search, calls } = deferredSearch();
  const shown = [];
  const runner = createSearchRunner({ search, render: (s) => shown.push(s), timers });
  const running = runner.run('login');
  await flush();
  runner.schedule('altro');
  runner.cancel();
  assert.strictEqual(timers.pending().length, 0, 'il timer va fermato');
  calls[0].resolve({ ok: true, results: [{ id: 'a' }] });
  await running;
  assert.deepStrictEqual(shown.map((s) => s.phase), ['loading']);
});

ok('cerca: il frammento evidenzia con <mark> e non interpreta l HTML del testo', () => {
  const doc = { createElement };
  const el = snippetElement(doc, { role: 'assistant', before: '<img src=x onerror=alert(1)> prima ', match: '<b>login</b>', after: ' dopo' });
  const nodes = descendants(el);
  assert.deepStrictEqual(nodes.map((n) => n.tag), ['span', 'span', 'mark', 'span']);
  assert.deepStrictEqual(nodes.map((n) => n.textContent), ['agente:', '<img src=x onerror=alert(1)> prima ', '<b>login</b>', ' dopo']);
  assert.ok([el, ...nodes].every((n) => !n.html), 'niente innerHTML');
  assert.strictEqual(descendants(snippetElement(doc, { role: 'user', before: '', match: 'x', after: '' }))[0].textContent, 'tu:');
});

ok('cerca: i testi di stato dicono cosa succede', () => {
  assert.ok(/almeno 2 caratteri/.test(statusText({ phase: 'short' })));
  assert.strictEqual(statusText({ phase: 'loading' }), 'Cerco…');
  assert.strictEqual(statusText({ phase: 'empty', query: 'zz' }), 'Nessun messaggio contiene «zz».');
  assert.ok(statusText({ phase: 'error', error: 'boom' }).includes('boom'));
  assert.strictEqual(hitsText(1), '1 occorrenza');
  assert.strictEqual(hitsText(7), '7 occorrenze');
});

ok('cerca: senza timer passati usa quelli globali senza staccarli da window', async () => {
  // Nel browser setTimeout chiamato come metodo di un altro oggetto lancia
  // «Illegal invocation»; Node non se ne accorge, quindi lo si imita qui.
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const strict = (fn) => function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return fn(...args);
  };
  globalThis.setTimeout = strict(real.setTimeout);
  globalThis.clearTimeout = strict(real.clearTimeout);
  try {
    const queries = [];
    const runner = createSearchRunner({ search: async (q) => { queries.push(q); return { ok: true, results: [] }; }, render: () => {}, delay: 1 });
    runner.schedule('lo');
    runner.schedule('login');
    await new Promise((r) => real.setTimeout(r, 20));
    assert.deepStrictEqual(queries, ['login']);
  } finally {
    Object.assign(globalThis, real);
  }
});

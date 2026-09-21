const assert = require('node:assert');
const { test: ok } = require('node:test');

/* La barra dell'uso girata sul DOM finto (tests/fake-dom.js): si chiama il
   codice vero del renderer e si guarda che cosa scrive, invece di controllare
   il testo del sorgente. */
const { installDocument, createElement } = require('./fake-dom');
const Bar = require('../renderer/usage-bar');

const NOW = new Date(2026, 8, 21, 12, 30, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function totals(over = {}) {
  return { input: 1000, output: 200, cacheWrite: 0, cacheRead: 1_200_000, total: 1_201_200, count: 3, ...over };
}

function snapshot(over = {}) {
  return {
    now: NOW,
    session: {
      ...totals({ total: 12_000 }),
      context: { model: 'claude-opus-5', tokens: 50_000, limit: 200_000, ratio: 0.25, ts: NOW },
    },
    block: {
      start: new Date(2026, 8, 21, 10, 0, 0).getTime(),
      end: new Date(2026, 8, 21, 15, 0, 0).getTime(),
      now: NOW, active: true, totals: totals({ total: 900_000 }),
    },
    week: { start: NOW - 7 * DAY, end: NOW, now: NOW, totals: totals({ total: 8_400_000 }) },
    bySource: { claude: totals(), codex: totals({ total: 5_000 }) },
    sources: { claude: { ok: true }, codex: { ok: true }, opencode: { ok: true }, antigravity: { ok: false, supported: false, error: 'protobuf binario' } },
    rateLimits: null,
    ...over,
  };
}

function mount(snap) {
  const restore = installDocument();
  try {
    const root = createElement('footer');
    const bar = Bar.createUsageBar({ root, document: global.document });
    bar.update(snap);
    return {
      root, bar,
      texts: root.children.map((c) => c.children.map((x) => x.textContent).join(' ')),
      titles: root.children.map((c) => c.title),
    };
  } finally { restore(); }
}

ok('usage bar: i token si accorciano, le quote sono percentuali intere', () => {
  assert.strictEqual(Bar.formatTokens(999), '999');
  assert.strictEqual(Bar.formatTokens(1500), '1.5K');
  assert.strictEqual(Bar.formatTokens(1_250_000), '1.3M');
  assert.strictEqual(Bar.formatPercent(0.615), '62%');
  assert.strictEqual(Bar.formatPercent(null), '');
});

ok('usage bar: niente prezzi da nessuna parte', () => {
  const { texts, root } = mount(snapshot({ rateLimits: { fiveHour: { usedPercent: 40 }, weekly: { usedPercent: 12 } } }));
  const tutto = texts.join(' ') + ' ' + root.children.map((c) => c.title).join(' ');
  assert.ok(!tutto.includes('$'), 'la barra non mostra costi');
});

ok('usage bar: tre riquadri, solo etichetta e percentuale', () => {
  const { texts } = mount(snapshot({ rateLimits: { fiveHour: null, weekly: { usedPercent: 30 } } }));
  assert.strictEqual(texts.length, 3);
  assert.deepStrictEqual(texts.map((t) => t.trim()), ['SESSIONE 25%', 'FINESTRA 5h 50%', 'SETTIMANA 30%']);
});

ok('usage bar: i token escono dal testo ma restano nei tooltip', () => {
  const { texts, titles } = mount(snapshot());
  assert.ok(!texts.join(' ').includes('tok'), 'nessun conteggio di token nella riga');
  assert.ok(titles[0].includes('50K dei 200K token'), 'il contesto resta nel tooltip');
  assert.ok(titles[1].includes('900K token'), 'i token della finestra restano nel tooltip');
  assert.ok(titles[2].includes('8.4M token'), 'i token della settimana restano nel tooltip');
  assert.strictEqual(Bar.tokensLine({ total: 1500 }), '1.5K token');
});

ok('usage bar: la barra della sessione segue il contesto dell ultimo scambio', () => {
  const { bar } = mount(snapshot());
  assert.strictEqual(bar.elements.session.fill.style.width, '25%');
  assert.ok(bar.elements.session.box.title.includes('claude-opus-5'));
});

ok('usage bar: senza contesto calcolabile la barra sparisce e il valore dice —', () => {
  const { bar, texts, titles } = mount(snapshot({ session: totals({ total: 12_000, context: null }) }));
  assert.strictEqual(bar.elements.session.bar.style.display, 'none');
  assert.ok(texts[0].includes(Bar.EMPTY), 'niente percentuale inventata');
  assert.ok(titles[0].includes('12K token'), 'i token spesi restano nel tooltip');
  assert.strictEqual(Bar.contextProgress({ context: null }), null);
});

ok('usage bar: senza sessione riconosciuta il riquadro dice — e spiega perche', () => {
  const { root, texts } = mount(snapshot({ session: null }));
  assert.ok(texts[0].includes(Bar.EMPTY));
  assert.ok(root.children[0].title.includes('shell'));
});

ok('usage bar: la quota dichiarata dal CLI batte il tempo trascorso', () => {
  const { bar, texts } = mount(snapshot({
    rateLimits: { fiveHour: { usedPercent: 82, resetsAt: NOW + 2 * 60 * 60 * 1000 }, weekly: null },
  }));
  assert.strictEqual(bar.elements.block.fill.style.width, '82%');
  assert.ok(texts[1].includes('82%'));
});

ok('usage bar: senza quota dichiarata la barra 5h mostra il tempo trascorso', () => {
  const { bar } = mount(snapshot());
  assert.strictEqual(bar.elements.block.fill.style.width, '50%'); // 10:00 -> 15:00, ora sono le 12:30
  assert.ok(bar.elements.block.box.title.includes('tempo trascorso'));
});

ok('usage bar: fuori dalla finestra di 5h non si finge un consumo a zero', () => {
  const { bar, texts, titles } = mount(snapshot({ block: { start: null, end: null, now: NOW, active: false, totals: totals({ total: 0 }) } }));
  assert.ok(texts[1].includes(Bar.EMPTY), 'niente 0%: la finestra non esiste');
  assert.strictEqual(bar.elements.block.bar.style.display, 'none');
  assert.ok(titles[1].includes('Nessuna attivita'));
});

ok('usage bar: la settimana mostra la quota solo se qualcuno la dichiara', () => {
  const senza = mount(snapshot());
  assert.strictEqual(senza.bar.elements.week.bar.style.display, 'none');
  assert.ok(senza.bar.elements.week.box.title.includes('Nessun CLI dichiara'));

  const con = mount(snapshot({ rateLimits: { fiveHour: null, weekly: { usedPercent: 30, resetsAt: NOW + 3 * DAY } } }));
  assert.strictEqual(con.bar.elements.week.fill.style.width, '30%');
  assert.ok(con.texts[2].includes('30%'));
  assert.ok(con.titles[2].includes('reset fra 3 g'), 'il reset si legge nel tooltip');
});

ok('usage bar: quanto manca si dice in giorni, ore o minuti', () => {
  assert.strictEqual(Bar.formatDelta(3 * DAY), 'fra 3 g');
  assert.strictEqual(Bar.formatDelta(5 * 60 * 60 * 1000), 'fra 5 h');
  assert.strictEqual(Bar.formatDelta(90 * 1000), 'fra 2 min');
  assert.strictEqual(Bar.formatDelta(-1), '');
});

ok('usage bar: il tooltip elenca gli agenti e le sorgenti mancanti', () => {
  const { root } = mount(snapshot());
  const t = root.children[1].title;
  assert.ok(t.includes('claude:') && t.includes('codex:'));
  assert.ok(t.includes('antigravity: protobuf binario'));
});

ok('usage bar: senza dati non si mostrano zeri inventati', () => {
  const { texts, bar } = mount(null);
  assert.ok(texts.every((t) => t.includes(Bar.EMPTY)));
  assert.strictEqual(bar.elements.week.bar.style.display, 'none');
});

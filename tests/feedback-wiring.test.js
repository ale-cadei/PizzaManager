// renderer/feedback-panel.js montato davvero e cliccato: i pulsanti del
// pannello 📣 Segnalazioni sono collegati e fanno quello che dicono?
//
// Perché esiste: due difetti sono arrivati fino a una versione pubblicata
// (1.5.0) perché nessun test montava il pannello. `feedback-panel.test.js`,
// malgrado il nome, prova solo il disegno delle righe. Qui invece si esegue
// il file vero e si preme sui pulsanti (piano 50).
//
// Gli elementi della pagina non si scrivono a mano: tag, id e `hidden` si
// leggono da index.html. Così un id che il JS cerca ma la pagina non dichiara
// — o che qualcuno rinomina da una parte sola — fa cadere il test invece di
// lasciare un pulsante morto.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, installDocument, fire } = require('./fake-dom');
const View = require('../renderer/feedback-view');

const RENDERER = path.join(__dirname, '..', 'renderer');
const SORGENTE = fs.readFileSync(path.join(RENDERER, 'feedback-panel.js'), 'utf8');

/** Gli elementi del pannello come li dichiara la pagina: id → tag e se nasce
 *  nascosto. Sono tutti gli `fb-*`, il pulsante che apre il pannello e il
 *  modale che lo contiene. */
const DEL_PANNELLO = (id) => id.startsWith('fb-') || id === 'feedback-open' || id === 'modal-feedback';

function elementiDellaPagina() {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const trovati = new Map();
  for (const m of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const [tutto, tag, id] = m;
    if (!DEL_PANNELLO(id)) continue;
    trovati.set(id, { tag, nascosto: /\shidden[\s>/]/.test(tutto) });
  }
  return trovati;
}

/** Monta il pannello: costruisce gli elementi, finge `window.aisess` ed
 *  esegue il file vero, che è uno script classico senza esportazioni. */
function monta() {
  const uninstall = installDocument();
  const dichiarati = elementiDellaPagina();
  const nodi = new Map();
  for (const [id, { tag, nascosto }] of dichiarati) {
    const e = createElement(tag);
    e.hidden = nascosto;
    nodi.set(id, e);
    document.body.appendChild(e);
  }
  document.querySelector = (sel) => nodi.get(String(sel).replace(/^#/, '')) || null;

  const chiamate = [];
  const win = {
    aisess: {
      feedbackList: async (ricarica) => { chiamate.push(['list', ricarica]); return { voci: [], errore: null }; },
      feedbackDiagnostics: async () => { chiamate.push(['diagnostica']); return 'PizzaManager 1.5.0 · darwin'; },
      feedbackCreate: async (opts) => { chiamate.push(['create', opts]); return { ok: true }; },
      feedbackOpenIssue: async (numero) => { chiamate.push(['apri', numero]); return { ok: true }; },
    },
    AisessFeedbackView: View,
  };
  const fabbrica = new Function('$', 'window', 'document', `${SORGENTE}\nreturn { initFeedback, feedback };`);
  const pannello = fabbrica(document.querySelector, win, document);
  pannello.initFeedback();

  const el = (id) => {
    const n = nodi.get(id);
    assert.ok(n, `index.html non dichiara #${id}`);
    return n;
  };
  const clic = (id) => fire(el(id), 'click');
  // I gestori sono async e nessuno li aspetta: un giro di coda basta.
  const riposa = () => new Promise((r) => setImmediate(r));
  return { el, clic, chiamate, dichiarati, pannello, riposa, uninstall };
}

ok('pannello: ogni pulsante del pannello è collegato a qualcosa', () => {
  // La rete di sicurezza: un pulsante nuovo nella pagina che nessuno collega
  // nasce morto, e nel pannello è già successo.
  const t = monta();
  const pulsanti = [...t.dichiarati].filter(([, v]) => v.tag === 'button').map(([id]) => id);
  assert.ok(pulsanti.length >= 5, `trovati solo ${pulsanti.length} pulsanti: la lettura di index.html non ha funzionato`);
  for (const id of pulsanti) {
    assert.strictEqual(typeof t.el(id).onclick, 'function', `#${id} non è collegato a niente`);
  }
  t.uninstall();
});

ok('pannello: 📣 apre la bacheca e la legge', async () => {
  const t = monta();
  assert.strictEqual(t.el('modal-feedback').hidden, true, 'nasce aperto');
  t.clic('feedback-open');
  await t.riposa();
  assert.strictEqual(t.el('modal-feedback').hidden, false);
  assert.deepStrictEqual(t.chiamate, [['list', false]], 'all apertura serve dalla cache, senza forzare');
  t.uninstall();
});

ok('pannello: «＋ Nuova» apre il modulo e «Annulla» lo chiude', () => {
  // Era il difetto della 1.5.0: il modulo restava sempre aperto (una regola
  // CSS su #fb-form batteva [hidden]), quindi i due pulsanti sembravano morti
  // mentre facevano il loro lavoro.
  const t = monta();
  assert.strictEqual(t.el('fb-form').hidden, true, 'il modulo deve nascere chiuso');
  t.clic('fb-new');
  assert.strictEqual(t.el('fb-form').hidden, false, '«Nuova» non apre il modulo');
  t.clic('fb-form-cancel');
  assert.strictEqual(t.el('fb-form').hidden, true, '«Annulla» non chiude il modulo');
  t.uninstall();
});

ok('pannello: «Chiudi» chiude anche il modulo rimasto aperto', async () => {
  const t = monta();
  t.clic('feedback-open');
  // L'apertura legge la bacheca e disegna: si aspetta, o il disegno arriva a
  // test finito, quando il `document` finto non c'è più.
  await t.riposa();
  t.clic('fb-new');
  t.clic('fb-close');
  assert.strictEqual(t.el('modal-feedback').hidden, true);
  assert.strictEqual(t.el('fb-form').hidden, true, 'riaprendo il pannello il modulo sarebbe già aperto');
  t.uninstall();
});

ok('pannello: il ⟳ rilegge scavalcando la cache', async () => {
  const t = monta();
  t.clic('feedback-open');
  await t.riposa();
  t.clic('fb-reload');
  await t.riposa();
  assert.deepStrictEqual(t.chiamate, [['list', false], ['list', true]], 'il ⟳ deve chiedere la rilettura forzata');
  t.uninstall();
});

ok('pannello: «Continua su GitHub» manda tipo, titolo, testo e diagnostica', async () => {
  const t = monta();
  t.clic('fb-new');
  t.el('fb-tipo').value = 'segnalazione';
  t.el('fb-titolo').value = '  Il banner non sparisce  ';
  t.el('fb-corpo').value = 'Mi aspettavo che si chiudesse.';
  t.clic('fb-form-send');
  await t.riposa();
  assert.deepStrictEqual(t.chiamate, [
    ['diagnostica'],
    ['create', {
      tipo: 'segnalazione',
      titolo: 'Il banner non sparisce',
      corpo: 'Mi aspettavo che si chiudesse.',
      diagnostica: 'PizzaManager 1.5.0 · darwin',
    }],
  ]);
  assert.strictEqual(t.el('fb-form').hidden, true, 'mandata la segnalazione il modulo resta aperto');
  t.uninstall();
});

ok('pannello: senza titolo non si manda niente e il cursore torna nel campo', async () => {
  const t = monta();
  t.clic('fb-new');
  t.el('fb-titolo').value = '   ';
  t.clic('fb-form-send');
  await t.riposa();
  assert.deepStrictEqual(t.chiamate, [], 'ha aperto GitHub con una segnalazione senza titolo');
  assert.strictEqual(t.el('fb-titolo').focused, true, 'non dice dove manca qualcosa');
  t.uninstall();
});

const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Il fumetto di conferma: chiudere una sessione termina il processo, quindi si
   chiede prima. Non con un modale (copre tutto per una domanda da due parole)
   e non con `confirm()` del browser (finestra di sistema, fuori dallo stile
   dell'app): un fumetto che esce dalla card, così si vede di quale sessione si
   sta parlando senza rileggerne il nome. */
const { installDocument, createElement, descendants, fire } = require('./fake-dom');
const Bubble = require('../renderer/confirm-bubble');

const VIEWPORT = { width: 1200, height: 800 };
const SIZE = { width: 240, height: 120 };
// Card tipica nella sidebar: colonna stretta a sinistra, riga alta ~46px
const CARD = { left: 16, top: 300, width: 268, height: 46, right: 284, bottom: 346 };

ok('fumetto: esce dal fianco destro della card e la punta ne indica il centro', () => {
  const p = Bubble.place({ anchor: CARD, size: SIZE, viewport: VIEWPORT });
  assert.strictEqual(p.side, 'right');
  assert.ok(p.left >= CARD.right, `il fumetto copre la card: left ${p.left} < ${CARD.right}`);
  const centroCard = CARD.top + CARD.height / 2;
  assert.strictEqual(p.top + p.tip, centroCard, 'la punta non è all altezza del centro della card');
});

ok('fumetto: senza spazio a destra passa dall altro lato invece di uscire dallo schermo', () => {
  // Finestra rimpicciolita: la card arriva quasi al bordo destro
  const alBordo = { ...CARD, left: 900, right: 1168 };
  const p = Bubble.place({ anchor: alBordo, size: SIZE, viewport: VIEWPORT });
  assert.strictEqual(p.side, 'left');
  assert.ok(p.left + SIZE.width <= alBordo.left, `il fumetto copre la card: ${p.left + SIZE.width} > ${alBordo.left}`);
  assert.ok(p.left >= 0, 'il fumetto esce dal bordo sinistro');
});

ok('fumetto: finestra più stretta del fumetto, resta comunque dentro', () => {
  // Caso limite: da nessuna delle due parti ci sta. Meglio sovrapposto alla
  // card che fuori dallo schermo, dove nessuno potrebbe rispondere.
  const minuscola = { width: 300, height: 300 };
  const p = Bubble.place({ anchor: CARD, size: SIZE, viewport: minuscola });
  assert.ok(p.left >= 0 && p.left + SIZE.width <= minuscola.width, `fuori in orizzontale: ${p.left}`);
  assert.ok(p.top >= 0 && p.top + SIZE.height <= minuscola.height, `fuori in verticale: ${p.top}`);
});

ok('fumetto: card in fondo alla finestra, il fumetto resta dentro e la punta la segue', () => {
  const bassa = { ...CARD, top: 770, bottom: 816 };
  const p = Bubble.place({ anchor: bassa, size: SIZE, viewport: VIEWPORT });
  assert.ok(p.top + SIZE.height <= VIEWPORT.height, `il fumetto esce sotto: ${p.top + SIZE.height}`);
  // Spostato in su per starci, ma la punta deve continuare a indicare la card
  assert.ok(p.tip > 0 && p.tip < SIZE.height, `la punta è fuori dal fumetto: ${p.tip}`);
  assert.ok(p.top + p.tip >= bassa.top, 'la punta indica sopra la card');
});

function apri(opts = {}) {
  const anchor = createElement('div');
  anchor.rect = { top: CARD.top, left: CARD.left, width: CARD.width, height: CARD.height };
  document.body.appendChild(anchor);
  // Il renderer ne tiene uno solo: `reuse` serve a provare che cosa succede
  // quando lo stesso fumetto riceve due domande.
  const bubble = opts.reuse || Bubble.createConfirmBubble({ viewport: () => VIEWPORT });
  const answer = bubble.ask({ anchor, name: 'refactor sidebar', ...opts });
  const el = descendants(document.body).find((n) => n.classes.has('confirm-bubble'));
  const bottone = (cls) => descendants(el).find((n) => n.classes.has(cls));
  return { bubble, el, answer, confirm: bottone('confirm-yes'), cancel: bottone('confirm-no') };
}

ok('fumetto: confermare risponde sì, annullare risponde no, e in entrambi i casi sparisce', async () => {
  const restore = installDocument();
  try {
    const a = apri();
    assert.ok(a.el, 'il fumetto non è stato aggiunto alla pagina');
    a.confirm.onclick({ stopPropagation() {} });
    assert.strictEqual(await a.answer, true);
    assert.strictEqual(descendants(document.body).find((n) => n.classes.has('confirm-bubble')), undefined,
      'il fumetto resta nella pagina dopo la conferma');

    const b = apri();
    b.cancel.onclick({ stopPropagation() {} });
    assert.strictEqual(await b.answer, false);
    assert.strictEqual(descendants(document.body).find((n) => n.classes.has('confirm-bubble')), undefined,
      'il fumetto resta nella pagina dopo l annullamento');
  } finally { restore(); }
});

ok('fumetto: Esc e il click fuori annullano — non si chiude una sessione per sbaglio', async () => {
  const restore = installDocument();
  try {
    const a = apri();
    fire(document, 'keydown', { key: 'Escape' });
    assert.strictEqual(await a.answer, false, 'Esc non ha annullato');

    const b = apri();
    fire(document, 'mousedown', { target: createElement('div') });
    assert.strictEqual(await b.answer, false, 'il click fuori non ha annullato');

    // Il click DENTRO il fumetto non deve chiuderlo: annullerebbe mentre si
    // sta per premere «Chiudi».
    const c = apri();
    fire(document, 'mousedown', { target: c.confirm });
    assert.ok(descendants(document.body).some((n) => n.classes.has('confirm-bubble')),
      'cliccare dentro il fumetto lo ha chiuso');
    c.cancel.onclick({ stopPropagation() {} });
    await c.answer;
  } finally { restore(); }
});

ok('fumetto: uno per volta — chiederne un altro annulla la domanda aperta', async () => {
  const restore = installDocument();
  try {
    const a = apri();
    const b = apri({ reuse: a.bubble });
    assert.strictEqual(await a.answer, false, 'la prima domanda è rimasta appesa');
    assert.strictEqual(descendants(document.body).filter((n) => n.classes.has('confirm-bubble')).length, 1,
      'due fumetti aperti insieme');
    b.cancel.onclick({ stopPropagation() {} });
    await b.answer;
  } finally { restore(); }
});

ok('fumetto: un render della sidebar lo sposta sulla card nuova, non lo fa sparire', async () => {
  const restore = installDocument();
  try {
    const a = apri({ key: 'a' });
    const nuova = createElement('div');
    nuova.rect = { top: 500, left: CARD.left, width: CARD.width, height: CARD.height };
    document.body.appendChild(nuova);
    a.bubble.retarget(() => nuova);
    assert.ok(a.bubble.isOpen(), 'il fumetto è sparito a un render che non lo riguardava');
    // Segue la card: la punta indica il suo centro nuovo
    const top = Number(a.el.style.top.replace('px', ''));
    const tip = Number(descendants(a.el).find((n) => n.classes.has('confirm-bubble-tip')).style.top.replace('px', ''));
    assert.strictEqual(top + tip, 500 + CARD.height / 2, 'la punta non ha seguito la card');
    a.cancel.onclick({ stopPropagation() {} });
    await a.answer;

    // Card sparita (sessione chiusa altrove): la domanda decade
    const b = apri({ key: 'b' });
    b.bubble.retarget(() => null);
    assert.strictEqual(await b.answer, false, 'la domanda è rimasta appesa a una card che non c è più');
  } finally { restore(); }
});

ok('fumetto: il nome della sessione è testo, non HTML', () => {
  const restore = installDocument();
  try {
    const a = apri({ name: '<img src=x onerror=alert(1)>' });
    const titolo = descendants(a.el).find((n) => n.classes.has('confirm-bubble-title'));
    assert.ok(titolo.textContent.includes('<img src=x onerror=alert(1)>'),
      'il nome non è stato scritto come testo: ' + titolo.textContent);
    assert.ok(!/<img/.test(a.el.innerHTML || ''), 'il nome è finito nell HTML del fumetto');
    a.cancel.onclick({ stopPropagation() {} });
  } finally { restore(); }
});

ok('fumetto: con tmux dice che non ci si potrà più riattaccare', () => {
  const restore = installDocument();
  try {
    const a = apri({ detachable: true });
    const testo = descendants(a.el).find((n) => n.classes.has('confirm-bubble-text'));
    assert.match(testo.textContent, /riattacc/i, 'non dice che la sessione tmux sparisce: ' + testo.textContent);
    a.cancel.onclick({ stopPropagation() {} });
  } finally { restore(); }
});

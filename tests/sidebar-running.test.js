/* Segnale «in esecuzione» sulla card: la barra del tipo si anima mentre la
   sessione macina e sta ferma quando è ferma. La regola di quando una sessione
   è in esecuzione sta in tests/running.test.js; qui si verifica che la card lo
   mostri e che l'animazione non si pesti coi segnali che ci sono già. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

const styles = () => fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

const render = (sessions, activeId) => {
  const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
  const Groups = require('../renderer/session-groups');
  const { createSidebar } = require('../renderer/sidebar');
  const restore = installDocument();
  try {
    const list = createElement('div');
    const sidebar = createSidebar({
      list, count: createElement('span'), storage: createStorage({}),
      Icons: { markup: () => '' }, Slice: { markup: () => '' },
      Groups, escapeHtml: (s) => String(s),
      onSelect: () => {}, onClose: () => {}, onRename: () => {},
    });
    sidebar.render(sessions, activeId);
    return descendants(list).filter((n) => n.classes.has('session-item'));
  } finally { restore(); }
};

ok('esecuzione: solo la card che sta lavorando porta il segnale', () => {
  const cards = render([
    { id: 'a', type: 'claude', name: 'lavora', cwd: '/repo', alive: true, running: true },
    { id: 'b', type: 'claude', name: 'ferma', cwd: '/repo', alive: true },
  ], 'b');
  const [a, b] = cards;
  assert.ok(a.classes.has('is-running'), 'la sessione al lavoro non è segnalata');
  assert.ok(!b.classes.has('is-running'), 'una sessione ferma risulta al lavoro');
});

ok('esecuzione: il segnale convive con selezione e lampeggio', () => {
  const [card] = render([
    { id: 'a', type: 'codex', name: 'a', cwd: '/repo', alive: true, running: true, needsAttention: true },
  ], 'a');
  for (const c of ['session-item', 'type-codex', 'active', 'needs-attention', 'is-running']) {
    assert.ok(card.classes.has(c), `la card ha perso "${c}"`);
  }
});

/* Il segnale è movimento su un elemento che c'è già (la barra del tipo): un
   badge in più su ogni card sarebbe una cosa in più da leggere, e il colore è
   già preso dal tipo e dal lampeggio. */
ok('esecuzione: si anima la barra del tipo, non si aggiunge roba alla card', () => {
  const css = styles();
  const regola = css.match(/\.session-item\.is-running::before \{[^}]*\}/);
  assert.ok(regola, 'il segnale di esecuzione non sta sulla barra del tipo');
  assert.ok(/animation:\s*run-bar/.test(regola[0]), 'la barra non si anima');
  assert.ok(/var\(--type-color/.test(regola[0]),
    `la luce che scorre non è del colore della sessione: ${regola[0]}`);
  // La geometria della riga non si muove: una card che cambia misura mentre
  // lavora farebbe saltare la lista sotto il cursore.
  assert.ok(!/(width|height|top|bottom|left|right|padding|margin):/.test(regola[0]),
    `il segnale sposta la geometria della card: ${regola[0]}`);
  // Le graffe sono annidate: il blocco finisce sulla parentesi a inizio riga
  const kf = css.match(/@keyframes run-bar \{[\s\S]*?\n\}/);
  assert.ok(kf && !/opacity|transform|width|height/.test(kf[0]),
    'l animazione muove qualcosa che non è la luce dentro la barra');
  // Il moto deve essere continuo: il motivo si ripete e il giro lo sposta di
  // esattamente un passo, così l'ultimo fotogramma è uguale al primo. Se i due
  // numeri divergono, alla fine del ciclo si vede uno scatto.
  assert.ok(/background-repeat:\s*repeat-y/.test(regola[0]),
    `la luce è una sola che entra ed esce: al ritorno a capo scatta — ${regola[0]}`);
  const passo = regola[0].match(/background-size:\s*100%\s*(\d+)px/);
  assert.ok(passo, `il passo del motivo non è una misura fissa: ${regola[0]}`);
  const estremi = [...kf[0].matchAll(/background-position-y:\s*(-?\d+)px/g)].map((m) => Number(m[1]));
  assert.equal(estremi.length, 2, 'il ciclo non ha due estremi in px');
  assert.equal(Math.abs(estremi[0] - estremi[1]), Number(passo[1]),
    `il giro sposta la luce di ${Math.abs(estremi[0] - estremi[1])}px ma il motivo si ripete ogni ${passo[1]}px: si vede lo scatto`);
  assert.ok(/prefers-reduced-motion: reduce\)[\s\S]{0,400}\.session-item\.is-running::before[^}]*animation:\s*none/.test(css),
    'chi ha disattivato le animazioni resta senza segnale o con la barra che si muove');
});

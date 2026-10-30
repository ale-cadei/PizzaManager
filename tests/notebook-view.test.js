const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createTextNode, descendants, fire } = require('./fake-dom');
const { renderNotebook, renderMarkdown } = require('../renderer/notebook-view');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const doc = { createElement, createTextNode };

function render(notebook, opts = {}) {
  const colorized = [];
  const root = renderNotebook(doc, notebook, { colorize: (node, lang) => colorized.push([node.textContent, lang]), ...opts });
  const all = descendants(root);
  return { root, all, colorized, byClass: (c) => all.filter((n) => n.classes.has(c)), byTag: (t) => all.filter((n) => n.tag === t) };
}

/** Il testo visibile di un nodo, figli compresi. */
const textOf = (n) => (n.children.length ? n.children.map(textOf).join('') : n.textContent);

const NB = {
  language: 'python',
  cells: [
    { type: 'markdown', source: '# Titolo\n\nUn [link](https://e.it) e ![](attachment:a.png)', count: null, outputs: [], attachments: { 'a.png': PNG } },
    { type: 'code', source: 'print(1)', count: 4, attachments: {}, outputs: [
      { kind: 'text', text: '1\n', stream: 'stdout' },
      { kind: 'text', text: 'attento', stream: 'stderr' },
      { kind: 'error', name: 'ValueError', value: 'no', traceback: '' },
      { kind: 'image', src: PNG },
      { kind: 'html', html: '<table><tr><td>1</td></tr></table>' },
      { kind: 'markdown', text: '**b**' },
    ] },
    { type: 'code', source: 'x', count: null, outputs: [], attachments: {} },
    { type: 'raw', source: '<b>grezzo</b>', count: null, outputs: [], attachments: {} },
  ],
};

ok('notebook-view: una cella per cella, nell ordine, col suo tipo', () => {
  const r = render(NB);
  assert.deepStrictEqual(r.byClass('nb-cell').map((c) => c.className), [
    'nb-cell nb-cell--markdown', 'nb-cell nb-cell--code', 'nb-cell nb-cell--code', 'nb-cell nb-cell--raw',
  ]);
  assert.deepStrictEqual(r.byClass('nb-prompt').filter((p) => p.textContent).map((p) => p.textContent), ['[4]', '[ ]']);
  assert.strictEqual(textOf(r.byClass('nb-cell--raw')[0]), '<b>grezzo</b>');
});

ok('notebook-view: il codice si colora col linguaggio del notebook, quello del markdown col suo', () => {
  const r = render({ language: 'r', cells: [
    { type: 'code', source: 'a <- 1', count: 1, outputs: [], attachments: {} },
    { type: 'markdown', source: '```sql\nselect 1\n```\n```\nniente\n```', count: null, outputs: [], attachments: {} },
  ] });
  assert.deepStrictEqual(r.colorized, [['a <- 1', 'r'], ['select 1', 'sql']]);
});

ok('notebook-view: output di testo, stderr, errore, immagine, markdown', () => {
  const r = render(NB);
  const out = r.byClass('nb-output');
  assert.strictEqual(out.length, 6);
  assert.deepStrictEqual(r.byClass('nb-stream').map((n) => [n.textContent, n.classes.has('nb-stderr')]), [['1\n', false], ['attento', true]]);
  assert.strictEqual(r.byClass('nb-error')[0].textContent, 'ValueError: no');
  const imgs = r.byTag('img').map((i) => i.attrs.src || i.src);
  assert.deepStrictEqual(imgs, [PNG, PNG], 'allegato del markdown e output');
  assert.strictEqual(textOf(out[5]), 'b');
  assert.strictEqual(r.byTag('strong').length, 1);
});

ok('notebook-view: traceback, quando c è, al posto di nome e messaggio', () => {
  const r = render({ language: 'python', cells: [{ type: 'code', source: '', count: 1, attachments: {}, outputs: [
    { kind: 'error', name: 'E', value: 'v', traceback: 'Traceback\nE: v' },
  ] }] });
  assert.strictEqual(r.byClass('nb-error')[0].textContent, 'Traceback\nE: v');
});

ok('notebook-view: l HTML degli output sta in un iframe isolato, senza script', () => {
  const r = render(NB, { htmlCss: 'body{color:red}' });
  const [frame] = r.byTag('iframe');
  assert.strictEqual(frame.attrs.sandbox, 'allow-same-origin');
  assert.ok(!/allow-scripts/.test(frame.attrs.sandbox));
  assert.match(frame.attrs.csp, /default-src 'none'/);
  assert.match(frame.attrs.srcdoc, /^<!doctype html><meta charset="utf-8"><style>body\{color:red\}<\/style>/);
  assert.match(frame.attrs.srcdoc, /<table><tr><td>1<\/td><\/tr><\/table>$/);
  // Al caricamento prende l'altezza del contenuto, con un tetto
  frame.contentDocument = { documentElement: { scrollHeight: 120 } };
  fire(frame, 'load');
  assert.strictEqual(frame.style.height, '120px');
  frame.contentDocument = { documentElement: { scrollHeight: 99999 } };
  fire(frame, 'load');
  assert.strictEqual(frame.style.height, '600px');
});

ok('notebook-view: link senza href, bersaglio nel title', () => {
  const r = render(NB);
  const link = r.byClass('nb-link')[0];
  assert.strictEqual(link.tag, 'span');
  assert.strictEqual(link.title, 'https://e.it');
  assert.strictEqual(textOf(link), 'link');
  assert.ok(!r.all.some((n) => n.tag === 'a' || 'href' in n.attrs));
});

ok('notebook-view: immagini markdown che non sono data: restano testo', () => {
  const root = renderMarkdown(doc, '![gatto](https://x/g.png) ![x](attachment:manca.png) ![y](data:text/html,<b>)', {});
  const all = descendants(root);
  assert.strictEqual(all.filter((n) => n.tag === 'img').length, 0);
  assert.deepStrictEqual(all.filter((n) => n.classes.has('nb-missing')).map((n) => [n.textContent, n.title]), [
    ['[immagine: gatto]', 'https://x/g.png'], ['[immagine: x]', 'attachment:manca.png'], ['[immagine: y]', 'data:text/html,<b>'],
  ]);
});

ok('notebook-view: blocchi markdown nei tag giusti, testo mai come HTML', () => {
  const root = renderMarkdown(doc, '## T\n\n> q\n\n1. a\n2. b\n\n---\n\n| x | y |\n|:-:|--|\n| `1` | <i>2</i> |\n\ncon <script>x</script>  \nfine', {});
  const all = descendants(root);
  const tags = all.map((n) => n.tag);
  for (const t of ['h2', 'blockquote', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'th', 'td', 'code', 'br']) assert.ok(tags.includes(t), t);
  assert.strictEqual(all.find((n) => n.tag === 'th').style.textAlign, 'center');
  assert.ok(!all.some((n) => n.html), 'mai innerHTML');
  assert.ok(textOf(root).includes('<i>2</i>'));
  assert.ok(textOf(root).includes('con <script>x</script>'));
});

ok('notebook-view: lista numerata che parte da 3', () => {
  const ol = descendants(renderMarkdown(doc, '3. a', {})).find((n) => n.tag === 'ol');
  assert.strictEqual(ol.attrs.start, '3');
});

ok('notebook-view: notebook vuoto → messaggio', () => {
  const r = render({ language: 'python', cells: [] });
  assert.strictEqual(r.byClass('nb-empty')[0].textContent, 'Il notebook non ha celle.');
});

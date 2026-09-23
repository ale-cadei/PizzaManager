const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { readRendererApp } = require('./renderer-source');

/* Il logo della sidebar (renderer/pizza-logo.js) è una pizza con una fetta
   sollevata: il buco che la fetta lascia è ritagliato con una <mask> SVG.
   Le maschere si indirizzano per `id`, e un id è globale alla pagina: due logi
   con lo stesso id e il browser applicherebbe la prima maschera a entrambi.
   È l'unico modo in cui questo SVG può rompersi, quindi è quello che si prova. */
const Logo = require('../renderer/pizza-logo');

/** Gli id delle maschere dichiarate e quelli usati, nell'ordine in cui compaiono. */
function maskIds(svg) {
  return [...svg.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
}
function maskRefs(svg) {
  return [...svg.matchAll(/mask="url\(#([^)]+)\)"/g)].map((m) => m[1]);
}

ok('logo: la maschera che ritaglia il buco è quella dichiarata nello stesso SVG', () => {
  const svg = Logo.markup('pizza-x');
  assert.deepStrictEqual(maskIds(svg), ['pizza-x']);
  assert.deepStrictEqual(maskRefs(svg), ['pizza-x'], 'il gruppo non usa la maschera dichiarata');
});

ok('logo: due logi nella stessa pagina non condividono l id della maschera', () => {
  const nodes = [{ innerHTML: '' }, { innerHTML: '' }];
  Logo.hydrate({ querySelectorAll: () => nodes });

  const ids = nodes.map((n) => maskIds(n.innerHTML)[0]);
  assert.ok(ids.every(Boolean), 'un logo è rimasto senza maschera');
  assert.notStrictEqual(ids[0], ids[1], 'id duplicato: la seconda maschera verrebbe ignorata');
  nodes.forEach((n, i) => {
    assert.deepStrictEqual(maskRefs(n.innerHTML), [ids[i]], 'logo ' + i + ': riferimento alla maschera sbagliata');
  });
});

ok('logo: decorativo, il nome accanto lo dice già allo screen reader', () => {
  const svg = Logo.markup();
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/, 'senza focusable="false" IE/Edge ci mette il tab dentro');
});

ok('logo: nella sidebar c è il segnaposto e lo script che lo riempie', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('data-pizza-logo'), 'manca il segnaposto del logo nel marchio');
  // Il modulo definisce il globale PizzaLogo: deve essere caricato prima del renderer
  assert.ok(html.indexOf('pizza-logo.js') < html.indexOf('app-state.js'),
    'pizza-logo.js va caricato prima del renderer (app-state.js)');

  const js = readRendererApp();
  assert.ok(js.includes('Logo.hydrate(document)'), 'il renderer non riempie il segnaposto');
});

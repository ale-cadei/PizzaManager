// Il renderer è diviso in script classici che condividono lo scope globale
// (docs/plans/21-split-renderer.md): l'ordine in index.html conta. Qui si
// caricano davvero, come fa la pagina, in un unico contesto con un DOM finto:
// il codice che gira al caricamento e usa qualcosa non ancora definito esplode.
const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { RENDERER_APP_FILES } = require('./renderer-source');
const { loadPage, pageScripts } = require('./renderer-page');

ok('renderer: index.html carica i suoi file nell ordine previsto, dopo i moduli', () => {
  const local = pageScripts.filter((s) => !s.startsWith('../'));
  const appAt = RENDERER_APP_FILES.map((f) => local.indexOf(f));
  assert.ok(appAt.every((i) => i >= 0), 'index.html non carica tutti i file del renderer');
  assert.deepStrictEqual([...appAt].sort((a, b) => a - b), appAt, 'i file del renderer sono fuori ordine');
  assert.deepStrictEqual(local.slice(appAt[0]), RENDERER_APP_FILES,
    'dopo app-state.js ci sono script estranei al renderer, o ne mancano');
});

ok('renderer: tutti gli script si caricano insieme e init parte al DOMContentLoaded', () => {
  const { ctx, listeners } = loadPage();
  assert.strictEqual(typeof listeners.DOMContentLoaded, 'function', 'nessun avvio registrato');
  assert.strictEqual(listeners.DOMContentLoaded.name, 'init');
  // Una funzione per file: se uno script manca o non si carica, qui si vede
  const expected = ['escapeHtml', 'flagAttention', 'createTab', 'renameTab', 'renderSidebar', 'openNewModal',
    'fillAccountSelect', 'openResumeModal', 'offerRestore', 'runEditAction', 'refreshDeps', 'init',
    'createEditorTab', 'initEditorTabs', 'loadEditorGutterBase', 'renderEditorNotes'];
  const missing = expected.filter((n) => vm.runInContext(`typeof ${n}`, ctx) !== 'function');
  assert.deepStrictEqual(missing, []);
});

ok('renderer: editor-gutter.js è nella pagina prima di editor-tab.js', () => {
  const at = (f) => pageScripts.indexOf(f);
  assert.ok(at('editor-gutter.js') >= 0, 'index.html non carica editor-gutter.js');
  assert.ok(at('editor-gutter.js') < at('editor-tab.js'), 'editor-gutter.js va caricato prima di editor-tab.js');
  const { ctx } = loadPage();
  assert.strictEqual(typeof ctx.AisessEditorGutter.changeRanges, 'function');
});

/* xterm.js di default misura i caratteri con Unicode 6: molte emoji larghe 1
   colonna. psmux (unicode-width) e tmux le contano 2, e ridisegnano per
   differenze: dopo ogni emoji le correzioni cadevano una colonna piu' in la',
   e in Claude lo schermo si riempiva di lettere sparse (docs/plans/52). Il DOM
   finto non ha Terminal: si controlla il collegamento, la prova e' nell'app. */
ok('renderer: i terminali misurano i caratteri con Unicode 11, come psmux e tmux', () => {
  const fs = require('fs');
  const path = require('path');
  const src = '../node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js';
  assert.ok(pageScripts.includes(src), 'index.html non carica l addon unicode11');
  assert.ok(pageScripts.indexOf(src) > pageScripts.indexOf('../node_modules/@xterm/xterm/lib/xterm.js'), 'l addon va dopo xterm');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'renderer', src)), 'addon unicode11 non installato');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@xterm/addon-unicode11'], 'deve viaggiare nel pacchetto: dependencies, non devDependencies');
  // Il fornitore delle larghezze (Unicode 11 + VS16) e' un modulo: c'e' nella pagina, prima di tabs.js.
  assert.ok(pageScripts.indexOf('term-unicode.js') >= 0 && pageScripts.indexOf('term-unicode.js') < pageScripts.indexOf('tabs.js'));
  const { ctx } = loadPage();
  assert.strictEqual(typeof ctx.AisessTermUnicode.install, 'function');
  const tabs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tabs.js'), 'utf8');
  assert.match(tabs, /allowProposedApi: true/, 'term.unicode e API sperimentale: senza, l addon lancia');
  assert.match(tabs, /AisessTermUnicode\.install\(term, Unicode11Addon\.Unicode11Addon, \{ psmux \}\)/);
});

/* Gli script dell'app condividono lo scope globale: due `function X` con lo
   stesso nome non danno errore, vince l'ultima caricata e la prima sparisce
   in silenzio. È successo col piano 70: revealEditorDir del filtro copriva
   quella della copia di file (editor-copy-ui.js). */
ok('renderer: nessuna funzione globale dichiarata in due script', () => {
  const fs = require('fs');
  const path = require('path');
  const seen = new Map();
  const doubles = [];
  for (const f of RENDERER_APP_FILES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
    for (const m of src.matchAll(/^(?:async )?function (\w+)/gm)) {
      if (seen.has(m[1])) doubles.push(`${m[1]} (${seen.get(m[1])}, ${f})`);
      else seen.set(m[1], f);
    }
  }
  assert.deepStrictEqual(doubles, []);
});

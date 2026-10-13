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
    'createEditorTab', 'initEditorTabs'];
  const missing = expected.filter((n) => vm.runInContext(`typeof ${n}`, ctx) !== 'function');
  assert.deepStrictEqual(missing, []);
});

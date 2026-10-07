// renderer/type-colors.js: come i colori scelti dal menu View finiscono sulle
// variabili di :root. Lo stato per tema e il dialogo: type-color-themes.test.js.
const assert = require('node:assert');
const { test: ok } = require('node:test');
const TC = require('../renderer/type-colors');

const TYPES = ['shell', 'opencode', 'claude', 'codex', 'antigravity'];
const DEFAULTS = { shell: '#F2C14E', opencode: '#4ADE80', claude: '#FF9147', codex: '#5AA2FF', antigravity: '#FF6B6B' };

/** Lo stile di :root con sotto il foglio: la variabile inline vince, tolta torna tokens.css. */
function rootStyle() {
  const inline = {};
  return {
    inline,
    setProperty: (k, v) => { inline[k] = v; },
    removeProperty: (k) => { delete inline[k]; },
    read: (k) => (k in inline ? inline[k] : DEFAULTS[k.replace('--type-', '')]),
  };
}

ok('normalize: passano solo chiavi conosciute con un #rrggbb, in minuscolo', () => {
  assert.deepStrictEqual(TC.normalize({ shell: 'red', codex: '#00FF00', ignoto: '#ffffff', claude: '#12345', opencode: 'url(javascript:x)' }, TYPES),
    { codex: '#00ff00' });
  assert.deepStrictEqual(TC.normalize('{non json', TYPES), {});
  assert.deepStrictEqual(TC.normalize(['#ffffff'], TYPES), {});
});

ok('applyTypeColors: scrive i colori cambiati e toglie gli altri, così torna il predefinito', () => {
  const style = rootStyle();
  TC.applyTypeColors(style, { claude: '#111111', codex: '#222222' }, TYPES);
  assert.deepStrictEqual(style.inline, { '--type-claude': '#111111', '--type-codex': '#222222' });
  TC.applyTypeColors(style, { codex: '#333333' }, TYPES);
  assert.deepStrictEqual(style.inline, { '--type-codex': '#333333' });
  assert.strictEqual(style.read('--type-claude'), DEFAULTS.claude);
});

ok('colore principale: una scelta sola scrive --action e tutte le sue varianti', () => {
  const style = rootStyle();
  const keys = [TC.ACTION, ...TYPES];
  TC.applyTypeColors(style, { action: '#3366CC' }, keys);
  assert.deepStrictEqual(Object.keys(style.inline).sort(), [...TC.ACTION_VARS].sort());
  assert.strictEqual(style.inline['--action'], '#3366cc');
  assert.strictEqual(style.inline['--action-ring'], 'rgba(51,102,204,0.22)');
  TC.applyTypeColors(style, {}, keys);
  assert.deepStrictEqual(style.inline, {}, 'tolto, tornano tutte le varianti di tokens.css');
});

ok('colore principale: le varianti hanno col colore gli stessi rapporti del pomodoro', () => {
  const v = TC.actionVars('#F04E23');
  assert.strictEqual(v['--action-soft'], '#2a100a', 'fondo tenue ≈ #2B120A di tokens.css');
  assert.strictEqual(v['--action-ink'], '#180804', 'inchiostro scuro ≈ #1A0A05');
  assert.ok(TC.contrast(v['--action'], v['--action-ink']) >= 4.5);
});

ok('colore principale: su un principale scuro la scritta del pulsante diventa chiara', () => {
  const v = TC.actionVars('#1a237e');
  assert.strictEqual(v['--action-ink'], '#f6f1ec');
  assert.ok(TC.contrast(v['--action'], v['--action-ink']) >= 4.5);
});

const assert = require('node:assert');
const { test: ok } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Plugin e skill installati (docs/plans/29): lib/extensions su una home finta */
const { parseFrontmatter, describe } = require('../lib/extensions/frontmatter');
const { parseCodexPlugins } = require('../lib/extensions/codex');
const { stripJsonComments, firstComment } = require('../lib/extensions/opencode');
const { listExtensions } = require('../lib/extensions');

/* listExtensions mostra i percorsi col separatore del sistema: ~\progetto su Windows */
const tilde = (p) => p.split('/').join(path.sep);

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-ext-'));
  const put = (rel, text) => {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
    return file;
  };
  return { home, put };
}

const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
const cli = (res, id) => res.clis.find((c) => c.id === id);

ok('frontmatter: chiavi semplici, virgolette e blocchi su più righe', () => {
  const { data, body } = parseFrontmatter([
    '---', 'name: "mia-skill"', 'description: >-', '  Prima riga', '  seconda riga', "tools: 'Read'", 'metadata:', '  - voce', '---', 'Corpo',
  ].join('\n'));
  assert.strictEqual(data.name, 'mia-skill');
  assert.strictEqual(data.description, 'Prima riga seconda riga');
  assert.strictEqual(data.tools, 'Read');
  assert.strictEqual(body, 'Corpo');
});

ok('frontmatter: senza blocco --- tutto è corpo', () => {
  assert.deepStrictEqual(parseFrontmatter('# Titolo\ntesto').data, {});
  assert.deepStrictEqual(parseFrontmatter('---\nname: x\nsenza chiusura').data, {});
});

ok('describe: senza description vale la prima riga di testo, non un titolo', () => {
  assert.deepStrictEqual(describe('# Build fix\n\n```\ncodice\n```\nSistema la build.\n'), { name: '', description: 'Sistema la build.' });
  assert.strictEqual(describe(skill('a', 'Fa una cosa')).description, 'Fa una cosa');
  assert.strictEqual(describe('---\ndescription: x\n---\n').description, 'x');
});

ok('codex: plugin e stato da config.toml', () => {
  const map = parseCodexPlugins([
    '[marketplaces.x]', 'enabled = true',
    '[plugins."caveman@caveman"]', 'enabled = true',
    '[plugins."spento@mkt"]', 'enabled = false',
    '[plugins."muto@mkt"]',
    '[hooks.state."a"]', 'enabled = false',
  ].join('\n'));
  assert.deepStrictEqual([...map], [['caveman@caveman', true], ['spento@mkt', false], ['muto@mkt', null]]);
});

ok('opencode: commenti tolti dal jsonc ma non dalle stringhe', () => {
  const text = '{\n  // commento\n  "url": "http://x/y", /* altro */ "plugin": ["a"]\n}';
  assert.deepStrictEqual(JSON.parse(stripJsonComments(text)), { url: 'http://x/y', plugin: ['a'] });
});

ok('opencode: descrizione di un plugin locale dal primo commento', () => {
  assert.strictEqual(firstComment('/**\n * notify.js — Notifiche\n * altro\n */\nexport default 1'), 'notify.js — Notifiche');
  assert.strictEqual(firstComment('// Riga uno\n// riga due\ncode()'), 'Riga uno');
  assert.strictEqual(firstComment('export default 1'), '');
});

ok('listExtensions: Claude, plugin con skill e comandi, stato e ambito', async () => {
  const { home, put } = fakeHome();
  const dir = path.join(home, '.claude/plugins/cache/mkt/bello/1.2.0');
  put('.claude/plugins/installed_plugins.json', { version: 2, plugins: {
    'bello@mkt': [{ scope: 'user', installPath: dir, version: '1.2.0' }],
    'locale@mkt': [{ scope: 'local', installPath: path.join(home, 'manca'), version: 'unknown', projectPath: path.join(home, 'progetto') }],
  } });
  put('.claude/plugins/cache/mkt/bello/1.2.0/.claude-plugin/plugin.json', { name: 'bello', description: 'Un plugin bello' });
  put('.claude/plugins/cache/mkt/bello/1.2.0/skills/pulisci/SKILL.md', skill('pulisci', 'Pulisce il codice'));
  put('.claude/plugins/cache/mkt/bello/1.2.0/commands/help.md', '---\ndescription: Aiuto del plugin\n---\n');
  put('.claude/settings.json', { enabledPlugins: { 'bello@mkt': true, 'locale@mkt': false } });
  put('.claude/skills/mia/SKILL.md', skill('mia', 'Skill mia'));
  put('.claude/skills/senza-file/README.md', 'niente SKILL.md');
  put('.claude/commands/fai.md', '# Fai\nFa le cose.');

  const c = cli(await listExtensions({ home, env: {} }), 'claude');
  assert.strictEqual(c.ok, true);
  const [bello, locale] = c.plugins;
  assert.deepStrictEqual(
    { name: bello.name, marketplace: bello.marketplace, version: bello.version, description: bello.description, enabled: bello.enabled, scope: bello.scope },
    { name: 'bello', marketplace: 'mkt', version: '1.2.0', description: 'Un plugin bello', enabled: true, scope: null });
  assert.deepStrictEqual(bello.items, [
    { name: 'pulisci', description: 'Pulisce il codice', kind: 'skill' },
    { name: 'help', description: 'Aiuto del plugin', kind: 'command' },
  ]);
  assert.strictEqual(locale.enabled, false);
  assert.strictEqual(locale.version, '', '"unknown" non è una versione');
  assert.strictEqual(locale.scope, 'solo in ' + tilde('~/progetto'));
  assert.deepStrictEqual(locale.items, [], 'cartella mancante: plugin elencato, senza contenuto');
  assert.deepStrictEqual([bello.missing, locale.missing], [false, true]);
  assert.deepStrictEqual(c.skillDirs.map((d) => [d.dir, d.items.map((i) => i.name)]), [
    [tilde('~/.claude/skills'), ['mia']],
    [tilde('~/.claude/commands'), ['fai']],
  ]);
  assert.strictEqual(c.skillDirs[1].items[0].description, 'Fa le cose.');
});

ok('listExtensions: Codex, config.toml più cache, versione più recente', async () => {
  const { home, put } = fakeHome();
  put('.codex/config.toml', '[plugins."uno@mkt"]\nenabled = false\n[plugins."fantasma@mkt"]\nenabled = true\n');
  put('.codex/plugins/cache/mkt/uno/0.1.0/.claude-plugin/plugin.json', { description: 'vecchia' });
  const nuova = put('.codex/plugins/cache/mkt/uno/0.2.0/.codex-plugin/plugin.json', { version: '0.2.0', description: 'nuova' });
  const past = new Date(Date.now() - 86_400_000);
  fs.utimesSync(path.join(home, '.codex/plugins/cache/mkt/uno/0.1.0'), past, past);
  fs.utimesSync(path.dirname(path.dirname(nuova)), new Date(), new Date());
  put('.codex/plugins/cache/altro/due/1.0.0/skills/s/SKILL.md', skill('s', 'skill del plugin'));
  put('.codex/plugins/cache/altro/tre/1.0.0/package.json', { name: '@scope/pacchetto', description: 'dal package.json' });
  put('.codex/skills/gsd/SKILL.md', skill('gsd', 'da codex'));
  put('.agents/skills/comune/SKILL.md', skill('comune', 'condivisa'));

  const c = cli(await listExtensions({ home, env: {} }), 'codex');
  const byId = Object.fromEntries(c.plugins.map((p) => [p.id, p]));
  assert.deepStrictEqual(Object.keys(byId).sort(), ['due@altro', 'fantasma@mkt', 'tre@altro', 'uno@mkt']);
  assert.deepStrictEqual([byId['tre@altro'].name, byId['tre@altro'].description], ['tre', 'dal package.json'], 'senza manifest');
  assert.strictEqual(byId['uno@mkt'].description, 'nuova');
  assert.strictEqual(byId['uno@mkt'].version, '0.2.0');
  assert.strictEqual(byId['uno@mkt'].enabled, false);
  assert.strictEqual(byId['fantasma@mkt'].description, '', 'nel config ma non su disco');
  assert.strictEqual(byId['due@altro'].enabled, null, 'su disco ma non nel config');
  assert.deepStrictEqual(byId['due@altro'].items.map((i) => i.name), ['s']);
  assert.deepStrictEqual(c.skillDirs.map((d) => d.dir), [tilde('~/.codex/skills'), tilde('~/.agents/skills')]);
});

ok('listExtensions: opencode, plugin locali e npm, XDG_CONFIG_HOME, skill da più cartelle', async () => {
  const { home, put } = fakeHome();
  const xdg = path.join(home, 'xdg');
  put('xdg/opencode/plugins/notify.js', '/**\n * Notifiche desktop\n */\nexport default {}');
  put('xdg/opencode/plugins/leggimi.txt', 'non è un plugin');
  put('xdg/opencode/opencode.jsonc', '{\n  // npm\n  "plugin": ["opencode-foo@1.0", 42]\n}');
  put('xdg/opencode/skills/oc/SKILL.md', skill('oc', 'di opencode'));
  put('.claude/skills/cl/SKILL.md', skill('cl', 'di claude'));

  const c = cli(await listExtensions({ home, env: { XDG_CONFIG_HOME: xdg } }), 'opencode');
  assert.deepStrictEqual(c.plugins.map((p) => [p.name, p.description, p.scope]), [
    ['notify', 'Notifiche desktop', 'file locale'],
    ['opencode-foo@1.0', '', 'pacchetto npm'],
  ]);
  assert.deepStrictEqual(c.skillDirs.map((d) => [d.dir, d.items.map((i) => i.name)]), [
    [tilde('~/xdg/opencode/skills'), ['oc']],
    [tilde('~/.claude/skills'), ['cl']],
  ]);
});

ok('listExtensions: una home vuota non è un errore', async () => {
  const { home } = fakeHome();
  const res = await listExtensions({ home, env: {} });
  assert.deepStrictEqual(res.clis.map((c) => [c.id, c.ok, c.plugins.length, c.skillDirs.length]), [
    ['claude', true, 0, 0], ['codex', true, 0, 0], ['opencode', true, 0, 0],
  ]);
});

ok('listExtensions: testi lunghi tagliati, file enormi letti solo in testa', async () => {
  const { home, put } = fakeHome();
  put('.claude/skills/lunga/SKILL.md', skill('lunga', 'x'.repeat(2000)) + 'y'.repeat(100_000));
  const [dir] = cli(await listExtensions({ home, env: {} }), 'claude').skillDirs;
  assert.ok(dir.items[0].description.length <= 400);
});

/* ---------- Finestra "Plugin e skill" (renderer/extensions-view.js) ---------- */
const { createElement, descendants } = require('./fake-dom');
const { filterCli, countOf, itemsSummary, pluginFlags, createExtensionsView } = require('../renderer/extensions-view');

const sample = () => ({
  id: 'claude', label: 'Claude Code', ok: true,
  plugins: [
    { id: 'bello@mkt', name: 'bello', marketplace: 'mkt', version: '1.0', description: 'Pulizia del codice', enabled: true, scope: null, missing: false,
      items: [{ name: 'refactor', description: 'Riordina', kind: 'skill' }, { name: 'deploy', description: 'Pubblica il sito', kind: 'command' }] },
    { id: 'spento@mkt', name: 'spento', marketplace: 'mkt', version: '', description: '', enabled: false, scope: 'solo in ~/p', missing: true, items: [] },
  ],
  skillDirs: [{ dir: '~/.claude/skills', items: [{ name: 'tdd', description: 'Test prima del codice', kind: 'skill' }] }],
});
const texts = (root) => descendants(root).map((n) => n.textContent).filter(Boolean);
const fakeDoc = { createElement };

ok('filtro: un plugin che corrisponde resta intero, altrimenti solo le sue voci che corrispondono', () => {
  const cli = sample();
  assert.strictEqual(filterCli(cli, '  '), cli);
  const byName = filterCli(cli, 'BELLO');
  assert.deepStrictEqual(byName.plugins.map((p) => [p.name, p.items.length]), [['bello', 2]]);
  assert.deepStrictEqual(byName.skillDirs, []);
  const byItem = filterCli(cli, 'pubblica');
  assert.deepStrictEqual(byItem.plugins.map((p) => [p.name, p.items.map((i) => i.name)]), [['bello', ['deploy']]]);
  assert.deepStrictEqual(filterCli(cli, 'test').skillDirs.map((d) => d.items.map((i) => i.name)), [['tdd']]);
  assert.strictEqual(cli.plugins[0].items.length, 2, 'il dato originale non cambia');
});

ok('conteggi, riassunto delle voci e segnali del plugin', () => {
  assert.deepStrictEqual(countOf(sample()), { plugins: 2, items: 3 });
  assert.strictEqual(itemsSummary(sample().plugins[0].items), '1 skill · 1 comando');
  assert.strictEqual(itemsSummary([]), '');
  assert.deepStrictEqual(pluginFlags(sample().plugins[1]).map((f) => f.text), ['disattivato', 'non trovato su disco', 'solo in ~/p']);
  assert.deepStrictEqual(pluginFlags(sample().plugins[0]), []);
});

ok('vista: plugin, voci e cartelle con testo, niente innerHTML', () => {
  const root = createElement('div');
  const view = createExtensionsView({ root, document: fakeDoc });
  view.render(sample(), '');
  const all = texts(root);
  for (const t of ['bello', '1.0', 'Pulizia del codice', 'refactor', '/deploy', 'disattivato', 'non trovato su disco', 'tdd', '~/.claude/skills · 1']) {
    assert.ok(all.includes(t), `manca "${t}"`);
  }
  assert.ok(descendants(root).every((n) => !n.html), 'innerHTML mai usato');
  const [bello, spento] = descendants(root).filter((n) => n.classes.has('ext-plugin'));
  assert.deepStrictEqual([bello.tag, bello.open, spento.tag], ['details', false, 'div'], 'senza voci non si apre');

  view.render(sample(), 'riordina');
  const [aperto] = descendants(root).filter((n) => n.classes.has('ext-plugin'));
  assert.strictEqual(aperto.open, true, 'filtrando si vede cosa corrisponde');
  view.render(sample(), 'zzz');
  assert.deepStrictEqual(texts(root), ['Nessun plugin o skill corrisponde.']);
});

ok('vista: CLI vuoto o illeggibile', () => {
  const root = createElement('div');
  const view = createExtensionsView({ root, document: fakeDoc });
  view.render({ id: 'codex', label: 'Codex', ok: true, plugins: [], skillDirs: [] }, '');
  assert.deepStrictEqual(texts(root), ['Nessun plugin o skill trovato per Codex.']);
  view.render({ id: 'codex', label: 'Codex', ok: false, error: 'EACCES', plugins: [], skillDirs: [] }, '');
  assert.deepStrictEqual(texts(root), ['Lettura non riuscita: EACCES']);
  view.render(null, '');
  assert.deepStrictEqual(root.children, []);
});

/* ---------- Skill del progetto aperto (docs/plans/30) ---------- */
const { projectOf } = require('../lib/extensions');

ok('progetto: radice del repository della cartella, mai la home', () => {
  const { home, put } = fakeHome();
  put('repo/.git/HEAD', 'ref');
  fs.mkdirSync(path.join(home, 'repo/src/deep'), { recursive: true });
  assert.strictEqual(projectOf(path.join(home, 'repo/src/deep'), home), path.join(home, 'repo'));
  assert.strictEqual(projectOf(home, home), null, 'la home è già globale');
  assert.strictEqual(projectOf(home + '/', home), null);
  assert.strictEqual(projectOf(null, home), null);
  assert.strictEqual(projectOf('relativo/x', home), null);
});

ok('listExtensions: col progetto aperto le sue skill vengono prima, segnate', async () => {
  const { home, put } = fakeHome();
  put('repo/.git/HEAD', 'ref');
  put('repo/.claude/skills/locale/SKILL.md', skill('locale', 'del progetto'));
  put('repo/.claude/commands/rilascia.md', '---\ndescription: Rilascio\n---\n');
  put('repo/.agents/skills/agente/SKILL.md', skill('agente', 'per codex e opencode'));
  put('repo/.opencode/skills/oc/SKILL.md', skill('oc', 'solo opencode'));
  put('repo/.opencode/plugins/guardia.js', '// Blocca i comandi pericolosi\nexport default {}');
  put('repo/opencode.json', { plugin: ['oc-prj@1'] });
  put('.claude/skills/mia/SKILL.md', skill('mia', 'globale'));
  put('.claude/settings.json', { enabledPlugins: { 'a@m': true, 'b@m': true } });
  put('repo/.claude/settings.json', { enabledPlugins: { 'a@m': false } });
  put('repo/.claude/settings.local.json', { enabledPlugins: { 'b@m': false } });
  put('.claude/plugins/installed_plugins.json', { version: 2, plugins: { 'a@m': [{ scope: 'user' }], 'b@m': [{ scope: 'user' }] } });

  const res = await listExtensions({ home, env: {}, cwd: path.join(home, 'repo') });
  assert.strictEqual(res.project, tilde('~/repo'));
  const dirs = (id) => cli(res, id).skillDirs.map((d) => [d.dir, d.project]);
  assert.deepStrictEqual(dirs('claude'), [[tilde('~/repo/.claude/skills'), true], [tilde('~/repo/.claude/commands'), true], [tilde('~/.claude/skills'), false]]);
  assert.deepStrictEqual(dirs('codex'), [[tilde('~/repo/.agents/skills'), true]]);
  assert.deepStrictEqual(dirs('opencode'), [
    [tilde('~/repo/.opencode/skills'), true], [tilde('~/repo/.claude/skills'), true], [tilde('~/repo/.agents/skills'), true], [tilde('~/.claude/skills'), false],
  ]);
  assert.deepStrictEqual(cli(res, 'claude').plugins.map((p) => [p.id, p.enabled]), [['a@m', false], ['b@m', false]],
    'le impostazioni del progetto vincono su quelle dell\'utente');
  assert.deepStrictEqual(cli(res, 'opencode').plugins.map((p) => [p.name, p.description, p.scope]), [
    ['guardia', 'Blocca i comandi pericolosi', 'progetto'],
    ['oc-prj@1', '', 'pacchetto npm del progetto'],
  ]);

  const senza = await listExtensions({ home, env: {} });
  assert.strictEqual(senza.project, null);
  assert.deepStrictEqual(senza.clis.map((c) => c.skillDirs.filter((d) => d.project).length), [0, 0, 0]);
});

ok('vista: le cartelle del progetto hanno un titolo loro, e la riga dice quale', () => {
  const { dirTitle, projectLine } = require('../renderer/extensions-view');
  assert.strictEqual(dirTitle({ project: true, items: [{ kind: 'skill' }] }), 'Skill del progetto');
  assert.strictEqual(dirTitle({ project: true, items: [{ kind: 'command' }] }), 'Comandi del progetto');
  assert.strictEqual(dirTitle({ project: false, items: [] }), 'Skill');
  assert.match(projectLine('~/repo'), /~\/repo/);
  assert.match(projectLine(null), /Solo globali/);
  const root = createElement('div');
  createExtensionsView({ root, document: fakeDoc }).render({ id: 'c', label: 'C', ok: true, plugins: [],
    skillDirs: [{ dir: '~/repo/.claude/skills', project: true, items: [{ name: 'x', description: '', kind: 'skill' }] }] }, '');
  const [box] = root.children;
  assert.ok(box.classes.has('ext-section--project'));
  assert.strictEqual(box.children[0].textContent, 'Skill del progetto');
});

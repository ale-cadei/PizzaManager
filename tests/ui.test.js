const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { SESSION_TYPES } = require('../lib/command-profiles');

// Verifiche sul markup e sugli stili: leggono i sorgenti del renderer,
// che non hanno una controparte eseguibile fuori da Electron.

ok('icone: ogni tipo ha il marchio ufficiale ed è incluso nella pagina', () => {
  const root = path.join(__dirname, '..');
  const icons = fs.readFileSync(path.join(root, 'renderer', 'agent-icons.js'), 'utf8');
  assert.ok(icons.includes('window.AisessIcons'), 'agent-icons.js non espone AisessIcons');
  for (const t of SESSION_TYPES) {
    assert.ok(new RegExp(`\\n\\s{4}${t}:\\s*\\{`).test(icons), `manca il marchio per ${t}`);
  }
  // Marchi ufficiali riconoscibili dal loro tracciato/colore
  assert.ok(icons.includes('M22 24H2V0h20zM17 4.8H7v14.4h10z'), 'il marchio OpenCode non è quello ufficiale');
  assert.ok(icons.includes('M22.2819 9.8211'), 'il marchio Codex (OpenAI) non è quello ufficiale');
  // Claude: l'insetto di Claude Code, ricalcato da assets/claude-code.png
  const claude = icons.match(/\n {4}claude:\s*\{[\s\S]*?\n {4}\},/);
  assert.ok(claude, 'manca il marchio Claude');
  assert.ok(claude[0].includes('M4 4H20V8H24V12H20V20H18V16H16V20H14V16H10V20H8V16H6V20H4V12H0V8H4Z'),
    'la sagoma dell insetto Claude non corrisponde a assets/claude-code.png');
  assert.ok(/rule:\s*'evenodd'/.test(claude[0]), 'occhi e zampe dell insetto Claude non sono ritagliati');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'claude-code.png')),
    'manca l immagine sorgente assets/claude-code.png');

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('agent-icons.js'), 'agent-icons.js non è incluso nella pagina');
  for (const t of SESSION_TYPES) {
    assert.ok(html.includes(`data-icon="${t}"`), `manca il segnaposto icona per ${t}`);
  }
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('Icons.hydrate(document)'), 'i segnaposto icona non vengono riempiti');
  assert.ok(!/ICONS\s*=\s*\{/.test(js), 'restano icone emoji hardcoded nel renderer');

  const tokens = fs.readFileSync(path.join(root, 'renderer', 'tokens.css'), 'utf8');
  assert.ok(/--brand-claude:\s*#D97757/i.test(tokens), 'manca il colore ufficiale del marchio Claude');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/\.agent-icon\s*\{[^}]*fill:\s*currentColor/.test(css), 'le icone non ereditano il colore');
});

ok('sessioni: la card lampeggia quando l assistente ha finito e si spegne alla selezione', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes('ATTENTION_IDLE_MS'), 'manca la soglia di inattività per rilevare la fine del turno');
  assert.ok(/onData\(\(\{ id, data \}\)[\s\S]{0,200}noteActivity/.test(js),
    'l output del terminale non alimenta il rilevamento');
  assert.ok(js.includes('term.onBell'), 'il bell dell agente non viene usato come segnale di fine turno');
  assert.ok(/function setActive\(id\)[\s\S]{0,300}clearAttention\(id\)/.test(js),
    'selezionare la sessione non spegne il lampeggio');
  assert.ok(/t\.id === activeId\) return/.test(js), 'la scheda in primo piano non deve lampeggiare');
  const sidebar = fs.readFileSync(path.join(root, 'renderer', 'sidebar.js'), 'utf8');
  assert.ok(sidebar.includes("t.needsAttention ? ' needs-attention' : ''"), 'la card non riceve la classe di lampeggio');

  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  assert.ok(/@keyframes attention-pulse/.test(css), 'manca l animazione di lampeggio');
  assert.ok(/\.session-item\.needs-attention[\s\S]{0,160}animation:\s*attention-pulse/.test(css),
    'la card non usa l animazione di lampeggio');
  assert.ok(/prefers-reduced-motion[\s\S]{0,400}animation:\s*none/.test(css),
    'il lampeggio non rispetta prefers-reduced-motion');
});

ok('sidebar: i gruppi arrivano dal modulo, non da una Map costruita a mano', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'sidebar.js'), 'utf8');
  const body = js.slice(js.indexOf('function render('));
  assert.ok(!/items\.length === 1/.test(body),
    'con una sola sessione il gruppo collassabile viene ancora saltato');
  assert.ok(body.includes('group-header'), "manca l'header di gruppo");
  assert.ok(body.includes("collapsed ? '▸' : '▾'"), 'manca la freccina di collasso');
  assert.ok(/groupSessions\(/.test(body), 'la sidebar raggruppa ancora per conto suo');
  assert.ok(!/new Map\(GROUP_ORDER/.test(js), 'resta il raggruppamento per tipo cablato nel renderer');
  assert.ok(!/const GROUP_LABELS\s*=/.test(js), 'le etichette dei tipi sono duplicate nel renderer');

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('session-groups.js'), 'session-groups.js non è incluso nella pagina');
});

ok('sidebar: le azioni non usano il pieno teal (riservato alla conferma nei modali)', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const actions = html.match(/<div class="side-actions">[\s\S]*?<\/div>/);
  assert.ok(actions, 'manca il blocco .side-actions');
  assert.ok(!actions[0].includes('btn--primary'), 'un pulsante della sidebar è ancora pieno: ' + actions[0]);
  assert.ok(actions[0].includes('btn--outline'), 'Nuova deve usare la variante outline');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
  const hover = css.match(/\.side-actions \.btn--outline:hover\s*\{[^}]*\}/);
  assert.ok(hover, 'manca l hover dedicato per l azione outline in sidebar');
  assert.ok(hover[0].includes('--action-soft'), 'in hover il pulsante si riempie di teal pieno: ' + hover[0]);
});

ok('sidebar: in modalità progetto la card non ripete il path già scritto nell header', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'sidebar.js'), 'utf8');
  const body = js.slice(js.indexOf('function createSessionItem'), js.indexOf('function render('));
  assert.ok(/relativeSubpath\(/.test(body), 'la card non mostra il path relativo al progetto');
  assert.ok(/groupMode === 'project'/.test(body), 'il sottotitolo non cambia con la modalità');
  assert.ok(/TYPE_LABELS\[t\.type\]/.test(body),
    'in modalità progetto la card non dice di che tipo è la sessione');
  assert.ok(/title="\$\{escapeHtml\(fullSub\)\}"/.test(body),
    'il tooltip non mostra più la cwd completa');
});

ok('sidebar: il modulo della sidebar non conosce lo stato delle schede', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'sidebar.js'), 'utf8');
  assert.ok(js.includes('window.AisessSidebar') || js.includes('AisessSidebar = api'),
    'sidebar.js non espone AisessSidebar');
  assert.ok(!/\btabs\.(get|set|delete|forEach|values)\b/.test(js),
    'la sidebar accede alla mappa delle schede invece di riceverla');
  assert.ok(!/\bactiveId\b\s*=/.test(js), 'la sidebar scrive lo stato di selezione');
  for (const cb of ['onSelect', 'onClose', 'onRename']) {
    assert.ok(js.includes(cb), `manca la callback ${cb}`);
  }
  const main = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(!/function renderSidebar\(/.test(main), 'renderSidebar è ancora in renderer.js');
  assert.ok(fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8').includes('sidebar.js'),
    'sidebar.js non è incluso nella pagina');
});

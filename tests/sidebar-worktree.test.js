const assert = require('node:assert');
const { test: ok } = require('node:test');

/* I worktree nella sidebar (docs/plans/36-sessione-worktree.md): in modalità
   progetto ogni worktree è una sotto-sezione del gruppo, con il suo «+» e il
   suo ⋯; un worktree senza sessioni resta visibile. Per tipo, il branch sta
   sulla card. La sidebar non sa creare, unire o buttare: chiama i callback. */
const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
const Groups = require('../renderer/session-groups');
const WorktreeSection = require('../renderer/worktree-section');
const { createSidebar } = require('../renderer/sidebar');

const ROOT = '/src/progetto';
const FEAT = { path: '/src/progetto.worktrees/feat-x', branch: 'feat/x', base: 'main' };
const EMPTY = { path: '/src/progetto.worktrees/vuoto', branch: 'vuoto', base: null };
const WORKTREES = { [ROOT]: [FEAT, EMPTY] };

const session = (id, cwd, extra = {}) => ({ id, type: 'claude', name: id, cwd, projectRoot: ROOT, alive: true, ...extra });
const SESSIONS = [
  session('main', ROOT),
  session('wt', FEAT.path),
  session('wt-sub', `${FEAT.path}/src`, { type: 'shell' }),
];

function render({ mode = 'project', sessions = SESSIONS, worktrees = WORKTREES, withSection = true, ...callbacks } = {}) {
  const list = createElement('div');
  const sidebar = createSidebar({
    list, count: createElement('span'), storage: createStorage(),
    Icons: { markup: () => '' }, Slice: { markup: () => '' },
    Groups, escapeHtml: (s) => String(s).replace(/</g, '&lt;'),
    WorktreeSection: withSection ? WorktreeSection : undefined,
    onSelect: () => {}, onClose: () => {}, onRename: () => {},
    ...callbacks,
  });
  sidebar.setMode(mode);
  sidebar.render(sessions, null, worktrees);
  return { list, sidebar };
}

const byClass = (root, cls) => descendants(root).filter((n) => n.classes.has(cls));
const textOf = (root, cls) => byClass(root, cls).map((n) => n.textContent);
const cardIds = (root) => byClass(root, 'session-item').map((c) => c.dataset.id);
const stopEvent = () => {
  const ev = { propagationStopped: false, stopPropagation() { ev.propagationStopped = true; } };
  return ev;
};

ok('sidebar worktree: una sotto-sezione per worktree, con branch e base, sotto le sessioni del progetto', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    const [group] = byClass(list, 'session-group');
    const body = byClass(group, 'group-body')[0];
    // Le card della cartella principale stanno direttamente nel corpo del gruppo
    assert.deepStrictEqual(body.children.filter((c) => c.classes.has('session-item')).map((c) => c.dataset.id), ['main']);
    const sections = byClass(body, 'worktree-section');
    assert.deepStrictEqual(sections.map((s) => s.dataset.path), [FEAT.path, EMPTY.path]);
    assert.deepStrictEqual(textOf(list, 'worktree-branch'), ['feat/x', 'vuoto']);
    assert.deepStrictEqual(textOf(list, 'worktree-base'), ['da main'], 'senza base non si scrive «da»');
    assert.deepStrictEqual(cardIds(sections[0]), ['wt', 'wt-sub']);
    assert.deepStrictEqual(cardIds(sections[1]), []);
    assert.deepStrictEqual(textOf(sections[1], 'worktree-empty'), ['nessuna sessione']);
  } finally { restore(); }
});

ok('sidebar worktree: il contatore del progetto conta anche le sessioni nei worktree', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    const header = byClass(list, 'group-header')[0];
    assert.match(header.innerHTML, /<span class="group-count">3<\/span>/);
  } finally { restore(); }
});

ok('sidebar worktree: «+» e ⋯ della riga chiamano i callback con worktree e radice, senza collassare il gruppo', () => {
  const restore = installDocument();
  try {
    const asked = [];
    const { list } = render({
      onNewInWorktree: (path, root) => asked.push(['new', path, root]),
      onWorktreeMenu: (w, root, el) => asked.push(['menu', w.branch, root, el.classes.has('worktree-menu')]),
    });
    const add = byClass(list, 'worktree-add')[0];
    const menu = byClass(list, 'worktree-menu')[0];
    const ev1 = stopEvent();
    add.onclick(ev1);
    const ev2 = stopEvent();
    menu.onclick(ev2);
    assert.deepStrictEqual(asked, [['new', FEAT.path, ROOT], ['menu', 'feat/x', ROOT, true]]);
    assert.ok(ev1.propagationStopped && ev2.propagationStopped);
    assert.strictEqual(menu.dataset.path, FEAT.path, 'il fumetto non ritroverebbe il ⋯ dopo un render');
    assert.match(add.title, /feat\/x/);
  } finally { restore(); }
});

ok('sidebar worktree: senza callback la riga non ha pulsanti che non fanno niente', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    assert.strictEqual(byClass(list, 'worktree-add').length, 0);
    assert.strictEqual(byClass(list, 'worktree-menu').length, 0);
  } finally { restore(); }
});

ok('sidebar worktree: [⑂] sulla linguetta del progetto chiede un worktree nuovo, non su «Senza directory»', () => {
  const restore = installDocument();
  try {
    const roots = [];
    const sessions = [...SESSIONS, { id: 'x', type: 'shell', name: 'x', cwd: '', projectRoot: null, alive: true }];
    const { list } = render({ sessions, onNewWorktree: (root) => roots.push(root) });
    const buttons = byClass(list, 'group-worktree');
    assert.strictEqual(buttons.length, 1, '[⑂] mancante o anche su «Senza directory»');
    const ev = stopEvent();
    buttons[0].onclick(ev);
    assert.deepStrictEqual(roots, [ROOT]);
    assert.ok(ev.propagationStopped);
    assert.strictEqual(byClass(render().list, 'group-worktree').length, 0, '[⑂] senza callback');
  } finally { restore(); }
});

ok('sidebar worktree: il nome del branch è testo, non HTML', () => {
  const restore = installDocument();
  try {
    const evil = { path: '/src/progetto.worktrees/x', branch: 'feat/<img src=x onerror=alert(1)>', base: 'main' };
    const { list } = render({ worktrees: { [ROOT]: [evil] } });
    const branch = byClass(list, 'worktree-branch')[0];
    assert.strictEqual(branch.textContent, evil.branch);
    assert.strictEqual(branch.innerHTML, '', 'il branch è finito in innerHTML');
  } finally { restore(); }
});

ok('sidebar worktree: per tipo niente sotto-sezioni, il branch sta sulla card', () => {
  const restore = installDocument();
  try {
    const { list } = render({ mode: 'type' });
    assert.strictEqual(byClass(list, 'worktree-section').length, 0);
    const cards = byClass(list, 'session-item');
    const wt = cards.find((c) => c.dataset.id === 'wt');
    const main = cards.find((c) => c.dataset.id === 'main');
    assert.match(wt.innerHTML, /⑂ feat\/x/);
    assert.doesNotMatch(main.innerHTML, /⑂/);
  } finally { restore(); }
});

ok('sidebar worktree: senza il modulo delle sotto-sezioni nessuna sessione sparisce', () => {
  const restore = installDocument();
  try {
    const { list } = render({ withSection: false });
    assert.deepStrictEqual(cardIds(list).sort(), ['main', 'wt', 'wt-sub']);
    assert.strictEqual(byClass(list, 'worktree-section').length, 0);
  } finally { restore(); }
});

ok('sidebar worktree: collassare e riaprire il gruppo non perde i worktree', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    const header = () => byClass(list, 'group-header')[0];
    header().onclick();
    header().onclick();
    assert.deepStrictEqual(byClass(list, 'worktree-section').map((s) => s.dataset.path), [FEAT.path, EMPTY.path]);
  } finally { restore(); }
});

ok('sidebar worktree: in un worktree la sottocartella si mostra rispetto al worktree', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    const sub = byClass(list, 'session-item').find((c) => c.dataset.id === 'wt-sub');
    assert.match(sub.innerHTML, /Terminale · src</, 'la sottocartella non è relativa al worktree: ' + sub.innerHTML);
  } finally { restore(); }
});

ok('sidebar worktree: la riga mostra le righe toccate, e niente se il worktree è pulito', () => {
  const restore = installDocument();
  try {
    const counts = { [FEAT.path]: { files: 3, added: 10, removed: 2 }, [EMPTY.path]: { files: 0, added: 0, removed: 0 } };
    const { list } = render({ changesOf: (p) => counts[p] || null, onNewInWorktree: () => {} });
    const badges = byClass(list, 'worktree-changes');
    assert.strictEqual(badges.length, 1, 'un worktree pulito non ha numeri');
    assert.deepStrictEqual(textOf(badges[0], 'worktree-added'), ['+10']);
    assert.deepStrictEqual(textOf(badges[0], 'worktree-removed'), ['−2']);
    assert.strictEqual(badges[0].title, '3 file cambiati rispetto a main');
    const row = byClass(list, 'worktree-row')[0];
    assert.ok(row.children.indexOf(badges[0]) < row.children.indexOf(byClass(row, 'worktree-add')[0]), 'i numeri vanno prima dei pulsanti');
  } finally {
    restore();
  }
});

ok('sidebar worktree: senza changesOf le righe restano come prima', () => {
  const restore = installDocument();
  try {
    const { list } = render();
    assert.strictEqual(byClass(list, 'worktree-changes').length, 0);
  } finally {
    restore();
  }
});

const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Mappa dei branch (docs/plans/31-mappa-branch.md): main orizzontale, ogni
   branch si stacca dal commit da cui è nato. lib/git-branch-map.js ricostruisce
   chi nasce da chi e dispone le linee; qui si prova senza git e senza DOM. */
const { branchTopology, layoutBranchMap, buildBranchMap } = require('../lib/git-branch-map');
const { parseMergeSubject } = require('../lib/git-branch-topology');

let clock = 0;
/** Commit già letto da parseGitLog. `refs`: nomi di branch; `*nome` è HEAD, `origin/nome` un remoto. */
function C(hash, parents, refs = [], subject = 'msg ' + hash) {
  clock += 1;
  return {
    hash, parents, subject, author: 'a',
    date: new Date(Date.UTC(2026, 8, 1, 0, clock)).toISOString(),
    refs: refs.map((r) => ({
      name: r.replace(/^\*/, ''), kind: /^(old-)?origin\//.test(r) ? 'remote' : 'branch', head: r.startsWith('*'),
    })),
  };
}
/** Scritti dal più vecchio, restituiti come `git log`: dal più recente. */
const history = (...commits) => commits.reverse();
const byName = (list) => Object.fromEntries(list.map((b) => [b.name, b]));

/* Lo schizzo: branch #1 nasce da main, branch #2 da branch #1, branch #3 da
   main più avanti. */
function sketch() {
  return history(
    C('a', []),
    C('b1', ['a']),
    C('m1', ['a']),
    C('c1', ['b1'], ['branch2']),
    C('b2', ['b1']),
    C('d1', ['m1'], ['branch3']),
    C('b3', ['b2'], ['branch1']),
    C('m2', ['m1'], ['*main']),
  );
}

ok('mappa: un branch nato da un altro branch si stacca da quello, non da main', () => {
  const t = branchTopology(sketch(), { head: 'main' });
  assert.strictEqual(t.trunk, 'main');
  const b = byName(t.branches);
  assert.deepStrictEqual([b.branch1.parent, b.branch1.fork], ['main', 'a']);
  assert.deepStrictEqual([b.branch2.parent, b.branch2.fork], ['branch1', 'b1']);
  assert.deepStrictEqual([b.branch3.parent, b.branch3.fork], ['main', 'm1']);
  assert.deepStrictEqual(b.branch1.commits, ['b1', 'b2', 'b3'], 'dal più vecchio');
  assert.deepStrictEqual(b.branch2.commits, ['c1']);
  assert.deepStrictEqual(b.main.commits, ['a', 'm1', 'm2']);
  assert.ok(!b.branch1.merged && !b.branch2.merged);
  assert.strictEqual(b.main.head, true);
});

ok('mappa: i commit in comune vanno alla linea più lunga, qualunque sia il nome', () => {
  // zeta: s1-s2-s3-s4, alfa: s1-s2-x1. Il tratto s1-s2 è di zeta, alfa ne esce.
  const t = branchTopology(history(
    C('r', [], ['main']),
    C('s1', ['r']), C('s2', ['s1']),
    C('x1', ['s2'], ['alfa']),
    C('s3', ['s2']), C('s4', ['s3'], ['zeta']),
  ), { head: 'main' });
  const b = byName(t.branches);
  assert.deepStrictEqual([b.zeta.parent, b.zeta.fork], ['main', 'r']);
  assert.deepStrictEqual([b.alfa.parent, b.alfa.fork], ['zeta', 's2']);
});

ok('mappa: un branch unito con un merge torna su main nel commit di merge', () => {
  const t = branchTopology(history(
    C('a', []), C('f1', ['a']), C('f2', ['f1'], ['feat']),
    C('m1', ['a']), C('M', ['m1', 'f2'], ['main']),
  ), { head: 'main' });
  const feat = byName(t.branches).feat;
  assert.strictEqual(feat.merged, true);
  assert.strictEqual(feat.merge, 'M');
  assert.deepStrictEqual(feat.commits, ['f1', 'f2']);
});

ok('mappa: un branch rimasto indietro su main è unito, ma senza punto di ritorno', () => {
  const t = branchTopology(history(C('a', [], ['vecchio']), C('b', ['a']), C('c', ['b'], ['main'])), { head: 'main' });
  const old = byName(t.branches).vecchio;
  assert.strictEqual(old.merged, true);
  assert.strictEqual(old.merge, null);
  assert.deepStrictEqual(old.commits, []);
  assert.strictEqual(old.fork, 'a');
});

ok('mappa: un branch appena creato sulla punta di main è aperto e senza commit propri', () => {
  const t = branchTopology(history(C('a', []), C('b', ['a'], ['main', '*nuovo'])), { head: 'nuovo' });
  const fresh = byName(t.branches).nuovo;
  assert.strictEqual(fresh.merged, false);
  assert.deepStrictEqual(fresh.commits, []);
  assert.strictEqual(fresh.fork, 'b');
  assert.strictEqual(fresh.head, true);
});

ok('mappa: il tronco è main, poi master, poi il branch corrente', () => {
  const two = (names) => history(C('a', [], names));
  assert.strictEqual(branchTopology(two(['dev', 'master']), { head: 'dev' }).trunk, 'master');
  assert.strictEqual(branchTopology(two(['dev', 'feat']), { head: 'feat' }).trunk, 'feat');
  assert.strictEqual(branchTopology(two(['zz', 'aa']), { head: null }).trunk, 'aa');
});

ok('mappa: senza branch locali non c\'è niente da disegnare', () => {
  const t = branchTopology(history(C('a', [])), { head: null });
  assert.strictEqual(t.trunk, null);
  assert.deepStrictEqual(t.branches, []);
  assert.deepStrictEqual(layoutBranchMap(t, []).lines, []);
});

ok('mappa: un branch che si stacca prima della storia letta è segnato incompleto', () => {
  // la storia letta si ferma: il genitore di f1 e quello di a non ci sono
  const t = branchTopology(history(C('a', ['vecchio']), C('f1', ['perso'], ['feat']), C('b', ['a'], ['main'])), { head: 'main' });
  const feat = byName(t.branches).feat;
  assert.strictEqual(feat.incomplete, true);
  assert.strictEqual(feat.fork, null);
  assert.strictEqual(feat.parent, 'main');
});

/* ---------- merge dei branch cancellati, locali e remoti insieme ---------- */

ok('mappa: il nome di un branch unito si legge dal messaggio del merge', () => {
  assert.deepStrictEqual(parseMergeSubject('Merge pull request #37 from ale-cadei/feat/ricerca-chat-aperte'),
    { name: 'feat/ricerca-chat-aperte', pr: 37 });
  assert.deepStrictEqual(parseMergeSubject("Merge branch 'feat/sessione-git'"), { name: 'feat/sessione-git', pr: null });
  assert.deepStrictEqual(parseMergeSubject("Merge branch 'fix/x' into 'main'"), { name: 'fix/x', pr: null });
  assert.deepStrictEqual(parseMergeSubject("Merge remote-tracking branch 'origin/feat/y'"), { name: 'feat/y', pr: null });
  assert.strictEqual(parseMergeSubject('feat: niente merge qui'), null);
});

ok('mappa: un branch cancellato dopo il merge compare lo stesso, col nome e la PR del merge', () => {
  const t = branchTopology(history(
    C('a', []), C('x1', ['a']), C('x2', ['x1']), C('m1', ['a']),
    C('M', ['m1', 'x2'], ['main'], 'Merge pull request #37 from ale/feat/ricerca'),
  ), { head: 'main' });
  const gone = t.branches.find((b) => b.name === 'feat/ricerca');
  assert.ok(gone, 'il branch cancellato non c\'è');
  assert.deepStrictEqual([gone.pr, gone.merged, gone.merge, gone.where], [37, true, 'M', null]);
  assert.deepStrictEqual([gone.parent, gone.fork, gone.commits], ['main', 'a', ['x1', 'x2']]);
});

ok('mappa: un merge con un messaggio qualunque prende il nome dal commit', () => {
  const t = branchTopology(history(C('a', []), C('x1', ['a']), C('abcdef123', ['a', 'x1'], ['main'], 'unione a mano')), { head: 'main' });
  assert.ok(t.branches.some((b) => b.name === 'merge abcdef1'));
});

ok('mappa: un merge di git pull (main dentro main) non si chiama come il tronco', () => {
  const t = branchTopology(history(
    C('a', []), C('r1', ['a']), C('l1', ['a']),
    C('M', ['l1', 'r1'], ['main'], "Merge branch 'main' of github.com:ale/PizzaManager"),
  ), { head: 'main' });
  assert.deepStrictEqual(t.branches.map((b) => b.name), ['main', 'main (pull)']);
});

ok('mappa: x e origin/x sono un branch solo; origin/HEAD non è un branch', () => {
  const t = branchTopology(history(
    C('a', [], ['origin/HEAD']),
    C('b1', ['a'], ['entrambi', 'origin/entrambi']),
    C('c1', ['a'], ['origin/remoto']),
    C('d1', ['a'], ['origin/avanti']), C('d2', ['d1'], ['avanti']),
    C('m1', ['a'], ['main', 'origin/main']),
  ), { head: 'main' });
  const b = byName(t.branches);
  assert.deepStrictEqual(Object.keys(b).sort(), ['avanti', 'entrambi', 'main', 'remoto']);
  assert.deepStrictEqual([b.entrambi.where, b.entrambi.sync], ['both', 'same']);
  assert.deepStrictEqual([b.remoto.where, b.remoto.tip, b.remoto.sync], ['remote', 'c1', null]);
  // il locale è andato avanti: la linea segue il locale, che è da pushare
  assert.deepStrictEqual([b.avanti.tip, b.avanti.sync], ['d2', 'ahead']);
});

ok('mappa: un main locale rimasto indietro non nasconde i merge già fatti sul remoto', () => {
  // main locale fermo in m1; origin/main ha il merge della PR #24: il branch è unito
  const t = branchTopology(history(
    C('a', []), C('x1', ['a'], ['origin/fix/tenant']), C('m1', ['a'], ['*main']),
    C('M', ['m1', 'x1'], ['origin/main'], 'Merge pull request #24 from ale/fix/tenant'),
  ), { head: 'main' });
  const b = byName(t.branches);
  assert.deepStrictEqual([b.main.tip, b.main.sync], ['M', 'behind']);
  assert.deepStrictEqual([b['fix/tenant'].merged, b['fix/tenant'].merge], [true, 'M']);
});

ok('mappa: con più remoti vale origin, anche se un altro ha commit più recenti', () => {
  const t = branchTopology(history(
    C('a', []), C('o1', ['a'], ['origin/main']), C('v1', ['a'], ['old-origin/main']),
  ), { head: null });
  assert.strictEqual(byName(t.branches).main.tip, 'o1');
});

ok('mappa: locale e remoto separati, la linea segue il locale', () => {
  const t = branchTopology(history(
    C('a', [], ['main']), C('r1', ['a'], ['origin/feat']), C('l1', ['a'], ['feat']),
  ), { head: 'main' });
  assert.deepStrictEqual([byName(t.branches).feat.tip, byName(t.branches).feat.sync], ['l1', 'diverged']);
});

ok('mappa: un branch unito e poi continuato è due linee, la seconda nasce dalla prima', () => {
  const t = branchTopology(history(
    C('a', []), C('x1', ['a']), C('m1', ['a']),
    C('M', ['m1', 'x1'], [], "Merge branch 'feat/x'"),
    C('x2', ['x1'], ['feat/x']), C('m2', ['M'], ['main']),
  ), { head: 'main' });
  const lines = t.branches.filter((b) => b.name === 'feat/x');
  assert.strictEqual(lines.length, 2);
  const [merged, open] = lines;
  assert.notStrictEqual(merged.id, open.id);
  assert.deepStrictEqual([merged.merged, merged.commits], [true, ['x1']]);
  assert.deepStrictEqual([open.merged, open.parent, open.fork, open.commits], [false, merged.id, 'x1', ['x2']]);
});

ok('mappa: un branch nato da uno già unito e cancellato si stacca da quello', () => {
  const t = branchTopology(history(
    C('a', []), C('x1', ['a']), C('y1', ['x1'], ['figlio']), C('m1', ['a']),
    C('M', ['m1', 'x1'], ['main'], "Merge branch 'padre'"),
  ), { head: 'main' });
  const b = byName(t.branches);
  assert.deepStrictEqual([b.figlio.parent, b.figlio.fork], [b.padre.id, 'x1']);
});

/* ---------- layout: colonne e corsie ---------- */

ok('layout: come lo schizzo, #1 e #2 sopra (il #2 più in alto), #3 sotto', () => {
  const commits = sketch();
  const m = layoutBranchMap(branchTopology(commits, { head: 'main' }), commits, { includeMerged: true });
  const l = byName(m.lines);
  assert.strictEqual(l.main.lane, 0);
  assert.ok(l.branch1.lane < 0, 'branch1 sopra main');
  assert.ok(l.branch2.lane < l.branch1.lane, 'branch2 più in alto di branch1');
  assert.ok(l.branch3.lane > 0, 'branch3 sotto main');
  assert.strictEqual(l.branch2.parentLane, l.branch1.lane);
});

ok('layout: ogni linea si stacca a sinistra del suo primo commit, e i commit vanno da sinistra a destra', () => {
  const commits = sketch();
  const m = layoutBranchMap(branchTopology(commits, { head: 'main' }), commits);
  for (const line of m.lines.filter((x) => x.parent)) {
    assert.ok(line.forkCol < line.startCol, line.name);
    const cols = line.dots.map((d) => d.col);
    assert.deepStrictEqual(cols, cols.slice().sort((a, b) => a - b), line.name);
  }
  const l = byName(m.lines);
  const colOf = (hash) => m.lines.flatMap((x) => x.dots).find((d) => d.hash === hash).col;
  assert.strictEqual(l.branch2.forkCol, colOf('b1'));
  assert.strictEqual(l.branch3.forkCol, colOf('m1'));
});

ok('layout: due branch che non si sovrappongono nel tempo condividono la corsia', () => {
  const commits = history(
    C('a', []), C('p1', ['a'], ['p']),
    C('m1', ['a']), C('m2', ['m1']), C('m3', ['m2']), C('m4', ['m3']), C('m5', ['m4']), C('m6', ['m5']), C('m7', ['m6']),
    C('q1', ['m7'], ['q']), C('m8', ['m7'], ['main']),
  );
  const l = byName(layoutBranchMap(branchTopology(commits, { head: 'main' }), commits).lines);
  assert.strictEqual(l.p.lane, l.q.lane);
});

ok('layout: i branch uniti si nascondono, tranne quelli da cui nasce un branch aperto', () => {
  const commits = history(
    C('a', []),
    // unito (f1-f2-f3) è più lungo di figlio (f1-g1): il tratto f1 è suo
    C('f1', ['a']), C('g1', ['f1'], ['figlio']),
    C('f2', ['f1']), C('f3', ['f2'], ['unito']), C('u1', ['a'], ['solo-unito']),
    C('m1', ['a']), C('M', ['m1', 'f3']), C('M2', ['M', 'u1'], ['main']),
  );
  const t = branchTopology(commits, { head: 'main' });
  const shown = (o) => layoutBranchMap(t, commits, o).lines.map((x) => x.name).sort();
  assert.deepStrictEqual(shown(), ['figlio', 'main', 'unito']);
  assert.deepStrictEqual(shown({ includeMerged: true }), ['figlio', 'main', 'solo-unito', 'unito']);
  const unito = byName(layoutBranchMap(t, commits).lines).unito;
  assert.strictEqual(unito.merged, true);
  assert.ok(unito.mergeCol > unito.endCol, 'il ritorno su main viene dopo l\'ultimo commit');
});

ok('layout: un lungo tratto di main senza eventi diventa un segno +N', () => {
  const trunk = [C('a', [])];
  for (let i = 1; i <= 20; i++) trunk.push(C('m' + i, [trunk[i - 1].hash]));
  const commits = history(...trunk, C('f1', ['m20'], ['feat']), C('m21', ['m20'], ['main']));
  const m = layoutBranchMap(branchTopology(commits, { head: 'main' }), commits);
  const main = byName(m.lines).main;
  assert.deepStrictEqual(main.gaps.map((g) => g.count), [19], 'fra la radice a e il punto m20');
  assert.ok(m.columns < 12, `troppe colonne: ${m.columns}`);
  assert.deepStrictEqual(main.dots.map((d) => d.hash), ['a', 'm20', 'm21']);
});

ok('layout: il pallino porta messaggio, data e se è un merge', () => {
  const commits = history(C('a', []), C('f1', ['a'], ['feat']), C('M', ['a', 'f1'], ['main']));
  const main = byName(layoutBranchMap(branchTopology(commits, { head: 'main' }), commits, { includeMerged: true }).lines).main;
  const merge = main.dots.find((d) => d.hash === 'M');
  assert.strictEqual(merge.merge, true);
  assert.strictEqual(merge.subject, 'msg M');
  assert.ok(merge.date);
});

ok('buildBranchMap: versione con e senza uniti, e quanti sono nascosti', () => {
  const commits = history(C('a', []), C('f1', ['a'], ['feat']), C('M', ['a', 'f1'], ['main']), C('o1', ['M'], ['aperto']));
  const map = buildBranchMap(commits, { head: 'main' });
  assert.deepStrictEqual(map.open.lines.map((l) => l.name).sort(), ['aperto', 'main']);
  assert.strictEqual(map.all.lines.length, 3);
  assert.strictEqual(map.hiddenCount, 1);
});

/* ---------- disegno: renderer/git-map-view.js su un DOM finto ---------- */
const { createElement, descendants, fire } = require('./fake-dom');
const MapView = require('../renderer/git-map-view');

function fakeDocument() {
  const make = (tag) => {
    const e = createElement(tag);
    e.style.setProperty = (k, v) => { e.style[k] = v; };
    return e;
  };
  return { createElement: make, createElementNS: (ns, tag) => make(tag) };
}

ok('disegno: un nome per linea, con il testo del repository mai come HTML', () => {
  const commits = history(C('a', []), C('f1', ['a'], ['<b>x</b>']), C('m1', ['a'], ['main']));
  const layout = buildBranchMap(commits, { head: 'main' }).open;
  const view = MapView.createBranchMap({ document: fakeDocument(), layout, formatDate: () => '' });
  const labels = descendants(view.element).filter((n) => n.classes.has('git-map-label'));
  assert.deepStrictEqual(labels.map((n) => n.textContent).sort(), ['<b>x</b>', 'main']);
  assert.ok(descendants(view.element).every((n) => !n.html), 'niente innerHTML');
});

ok('disegno: clic sul nome di un branch passa il suo ultimo commit', () => {
  const layout = buildBranchMap(sketch(), { head: 'main' }).open;
  let picked = null;
  const view = MapView.createBranchMap({ document: fakeDocument(), layout, formatDate: () => '', onPick: (tip) => { picked = tip; } });
  const label = descendants(view.element).find((n) => n.classes.has('git-map-label') && n.textContent === 'branch2');
  fire(label, 'click');
  assert.strictEqual(picked, 'c1');
});

ok('disegno: il nome di un branch unito porta la PR e il giorno del merge', () => {
  const commits = history(C('a', []), C('x1', ['a']), C('M', ['a', 'x1'], ['main'], 'Merge pull request #37 from ale/feat/r'));
  const layout = buildBranchMap(commits, { head: 'main' }).all;
  const view = MapView.createBranchMap({ document: fakeDocument(), layout, formatDate: () => 'il giorno' });
  const label = descendants(view.element).find((n) => n.classes.has('git-map-label') && n.textContent === 'feat/r');
  const extras = label.children.map((n) => n.textContent);
  assert.strictEqual(extras[0], ' #37');
  assert.match(extras[1], /^ ✓ \d\d\/\d\d$/);
  assert.match(label.title, /branch cancellato/);
  assert.match(label.title, /unito in main il il giorno/);
});

ok('disegno: il ramo parte dalla corsia del padre e arriva sulla sua', () => {
  const layout = buildBranchMap(sketch(), { head: 'main' }).open;
  const line = layout.lines.find((l) => l.name === 'branch2');
  const d = MapView.branchPath(line, layout.minLane);
  const nums = d.match(/-?[\d.]+/g).map(Number);
  assert.strictEqual(nums[0], MapView.colX(line.forkCol));
  assert.strictEqual(nums[1], MapView.laneY(line.parentLane, layout.minLane));
  assert.strictEqual(nums[nums.length - 1], MapView.colX(line.endCol));
  assert.ok(d.includes(String(MapView.laneY(line.lane, layout.minLane))));
});

ok('disegno: passando sul nome si illumina il branch e la strada fino a main', () => {
  const layout = buildBranchMap(sketch(), { head: 'main' }).open;
  const view = MapView.createBranchMap({ document: fakeDocument(), layout, formatDate: () => '' });
  const label = descendants(view.element).find((n) => n.classes.has('git-map-label') && n.textContent === 'branch2');
  fire(label, 'mouseenter');
  const lit = new Set(descendants(view.element).filter((n) => n.classes.has('is-lit')).map((n) => n.getAttribute('data-branch')));
  assert.deepStrictEqual([...lit].sort(), ['branch1', 'branch2', 'main']);
});

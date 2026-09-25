const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Sessione git: la timeline dei branch locali. lib/git-graph.js legge
   `git log` e calcola le corsie (colonne) di ogni commit; il renderer si
   limita a disegnarle. Qui si provano parsing e layout senza git. */
const { parseGitLog, parseRefs, layoutGraph, gitLogArgs, readGitGraph, FIELD_SEP, RECORD_SEP } = require('../lib/git-graph');

const rec = (hash, parents, subject, extra = {}) => [
  hash, parents.join(' '), extra.author || 'Ale', extra.date || '2026-09-25T10:12:00+02:00', extra.refs || '', subject,
].join(FIELD_SEP) + RECORD_SEP;

ok('git: parseGitLog legge hash, genitori, autore, data, ref e messaggio', () => {
  const text = rec('aaa', ['bbb', 'ccc'], 'Merge PR #31', { refs: 'HEAD -> main, origin/main, tag: v1' }) + '\n' + rec('bbb', [], 'primo');
  const list = parseGitLog(text);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[0].parents, ['bbb', 'ccc']);
  assert.strictEqual(list[0].subject, 'Merge PR #31');
  assert.strictEqual(list[0].author, 'Ale');
  assert.strictEqual(list[0].date, '2026-09-25T10:12:00+02:00');
  assert.deepStrictEqual(list[1].parents, []);
  assert.deepStrictEqual(list[1].refs, []);
});

ok('git: un messaggio con caratteri strani resta intero', () => {
  const [c] = parseGitLog(rec('aaa', [], 'fix: a | b; <script> "x"'));
  assert.strictEqual(c.subject, 'fix: a | b; <script> "x"');
});

ok('git: output vuoto o spazzatura non esplode', () => {
  assert.deepStrictEqual(parseGitLog(''), []);
  assert.deepStrictEqual(parseGitLog('\n\n'), []);
  assert.deepStrictEqual(parseGitLog('niente separatori' + RECORD_SEP), []);
});

ok('git: parseRefs distingue HEAD, branch, remoti e tag', () => {
  assert.deepStrictEqual(parseRefs('HEAD -> main, origin/main, tag: v1, feat/x'), [
    { name: 'main', kind: 'branch', head: true },
    { name: 'origin/main', kind: 'remote', head: false },
    { name: 'v1', kind: 'tag', head: false },
    { name: 'feat/x', kind: 'branch', head: false },
  ]);
  // HEAD staccata: nessun branch corrente
  assert.deepStrictEqual(parseRefs('HEAD'), [{ name: 'HEAD', kind: 'head', head: true }]);
  assert.deepStrictEqual(parseRefs(''), []);
});

ok('git: parseRefs riconosce come remoti solo i remoti veri', () => {
  const refs = parseRefs('origin/main, feat/x', { remotes: ['origin'] });
  assert.deepStrictEqual(refs.map((r) => r.kind), ['remote', 'branch']);
  // senza elenco dei remoti vale la convenzione: origin/… e upstream/…
  assert.deepStrictEqual(parseRefs('upstream/dev, feat/x').map((r) => r.kind), ['remote', 'branch']);
});

const C = (hash, parents) => ({ hash, parents, subject: hash, author: 'a', date: '', refs: [] });

ok('git: storia lineare, una corsia sola', () => {
  const g = layoutGraph([C('c', ['b']), C('b', ['a']), C('a', [])]);
  assert.deepStrictEqual(g.rows.map((r) => r.col), [0, 0, 0]);
  assert.strictEqual(g.width, 1);
  assert.deepStrictEqual(g.rows[0].edges, [{ from: 0, to: 0, color: 0 }]);
  assert.deepStrictEqual(g.rows[2].edges, [], 'la radice non prosegue');
});

ok('git: un branch che si stacca e rientra con un merge', () => {
  // m = merge di f (feature) in main; f e b partono da a
  //   m      col 0
  //   | f    col 1
  //   b |    col 0
  //   |/
  //   a      col 0
  const g = layoutGraph([C('m', ['b', 'f']), C('f', ['a']), C('b', ['a']), C('a', [])]);
  assert.deepStrictEqual(g.rows.map((r) => r.col), [0, 1, 0, 0]);
  assert.strictEqual(g.width, 2);
  const [m, f, b] = g.rows;
  assert.ok(m.edges.some((e) => e.from === 0 && e.to === 0), 'il merge non prosegue sul primo genitore');
  assert.ok(m.edges.some((e) => e.from === 0 && e.to === 1), 'il merge non si collega al secondo genitore');
  assert.notStrictEqual(f.color, m.color, 'il branch ha lo stesso colore di main');
  assert.ok(f.edges.some((e) => e.from === 1 && e.to === 0 || e.from === 1 && e.to === 1), 'la corsia del branch sparisce');
  // b e f hanno lo stesso genitore: la corsia di f confluisce in a
  assert.ok(b.edges.some((e) => e.from === 1 && e.to === 0), 'la corsia del branch non rientra nel genitore comune');
  assert.ok(b.edges.some((e) => e.from === 0 && e.to === 0));
});

ok('git: due branch aperti hanno due colori e due colonne', () => {
  const g = layoutGraph([C('x2', ['x1']), C('y1', ['a']), C('x1', ['a']), C('a', [])]);
  assert.deepStrictEqual(g.rows.map((r) => r.col), [0, 1, 0, 0]);
  assert.notStrictEqual(g.rows[0].color, g.rows[1].color);
  assert.strictEqual(g.rows[0].color, g.rows[2].color, 'lo stesso branch cambia colore');
});

ok('git: una corsia libera viene riusata', () => {
  // dopo che f rientra in a, il branch g nato più sotto riusa la colonna 1
  const g = layoutGraph([
    C('m', ['b', 'f']), C('f', ['b']), C('b', ['h', 'g']), C('g', ['a']), C('h', ['a']), C('a', []),
  ]);
  assert.strictEqual(g.width, 2);
  assert.strictEqual(g.rows[3].col, 1);
});

ok('git: storia troncata, i genitori fuori elenco proseguono verso il basso', () => {
  const g = layoutGraph([C('b', ['a'])]);
  assert.deepStrictEqual(g.rows[0].edges, [{ from: 0, to: 0, color: 0 }]);
});

ok('git: layoutGraph non muta i commit', () => {
  const list = [C('b', ['a']), C('a', [])];
  const copy = JSON.parse(JSON.stringify(list));
  layoutGraph(list);
  assert.deepStrictEqual(list, copy);
});

ok('git: gitLogArgs chiede solo i branch locali, con limite e senza colori', () => {
  const args = gitLogArgs({ limit: 50 });
  assert.ok(args.includes('--branches'));
  assert.ok(!args.includes('--all'));
  assert.ok(args.includes('--max-count=50'));
  assert.ok(args.includes('--no-color'));
});

/* readGitGraph con un finto `git`: si verifica cosa chiede e cosa restituisce */
function fakeGit(responses) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    const key = args.find((a) => responses[a] !== undefined);
    const r = responses[key];
    if (r instanceof Error) throw r;
    return r;
  };
  return { run, calls };
}

ok('git: readGitGraph restituisce radice, branch corrente e righe', async () => {
  const { run, calls } = fakeGit({
    '--show-toplevel': '/repo\n',
    remote: 'origin\n',
    log: rec('b', ['a'], 'secondo', { refs: 'HEAD -> main' }) + '\n' + rec('a', [], 'primo'),
  });
  const r = await readGitGraph({ cwd: '/repo/src', run });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.root, '/repo');
  assert.strictEqual(r.head, 'main');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].commit.subject, 'secondo');
  assert.ok(calls.every((c) => c.opts.cwd === '/repo/src'), 'git non gira nella directory della sessione');
});

ok('git: readGitGraph fuori da un repository lo dice senza eccezioni', async () => {
  const { run } = fakeGit({ '--show-toplevel': new Error('fatal: not a git repository') });
  const r = await readGitGraph({ cwd: '/tmp', run });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notRepo, true);
  assert.match(r.error, /repository git/);
});

ok('git: readGitGraph con una directory inesistente non dice "non è un repository"', async () => {
  const gone = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  const { run } = fakeGit({ '--show-toplevel': gone });
  const r = await readGitGraph({ cwd: '/non/esiste', run });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.notRepo);
  assert.match(r.error, /non esiste/);
});

ok('git: troncata solo se oltre il limite c\'è davvero altro', async () => {
  const log = rec('c', ['b'], '3') + rec('b', ['a'], '2') + rec('a', [], '1');
  const read = (limit) => readGitGraph({ cwd: '/repo', limit, run: fakeGit({ '--show-toplevel': '/repo\n', remote: '', log }).run });
  const exact = await read(3);
  assert.strictEqual(exact.rows.length, 3);
  assert.strictEqual(exact.truncated, false, 'esattamente 3 commit con limite 3 non è troncata');
  const cut = await read(2);
  assert.strictEqual(cut.rows.length, 2);
  assert.strictEqual(cut.truncated, true);
});

ok('git: readGitGraph in un repository senza commit restituisce zero righe', async () => {
  const err = Object.assign(new Error("fatal: your current branch 'main' does not have any commits yet"), { stderr: 'does not have any commits yet' });
  const { run } = fakeGit({ '--show-toplevel': '/repo\n', remote: '', log: err });
  const r = await readGitGraph({ cwd: '/repo', run });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.rows, []);
});

ok('git: readGitGraph senza cwd rifiuta subito', async () => {
  const r = await readGitGraph({ cwd: '', run: async () => { throw new Error('non doveva girare'); } });
  assert.strictEqual(r.ok, false);
});

/* Il disegno (renderer/git-graph-view.js): tracciati e testi, senza DOM */
const View = require('../renderer/git-graph-view');

ok('git: una linea sulla stessa corsia è verticale, un cambio di corsia è una curva', () => {
  assert.match(View.edgePath(0, 0, 0), /^M\d+ \d+V\d+$/);
  const bend = View.edgePath(2, 0, 1);
  assert.match(bend, /^M[\d.]+ [\d.]+C/);
  // parte dalla riga 2 e arriva alla 3, una corsia più a destra
  const nums = bend.match(/[\d.]+/g).map(Number);
  assert.strictEqual(nums[1], 2 * View.ROW_H + View.ROW_H / 2);
  assert.strictEqual(nums[nums.length - 1], 3 * View.ROW_H + View.ROW_H / 2);
  assert.strictEqual(nums[nums.length - 2] - nums[0], View.LANE_W);
});

ok('git: la data si mostra giorno/mese/anno ore:minuti, e mai "Invalid Date"', () => {
  const d = new Date(2026, 8, 5, 7, 3);
  assert.strictEqual(View.formatDate(d.toISOString()), '05/09/2026 07:03');
  assert.strictEqual(View.formatDate('non una data'), '');
  assert.strictEqual(View.formatDate(''), '');
});

ok('git: i colori girano sulla tavolozza, i ref remoti vanno in coda', () => {
  assert.strictEqual(View.colorOf(0), View.colorOf(View.PALETTE.length));
  assert.notStrictEqual(View.colorOf(0), View.colorOf(1));
  const refs = [{ name: 'origin/main', kind: 'remote' }, { name: 'v1', kind: 'tag' }, { name: 'main', kind: 'branch', head: true }];
  assert.deepStrictEqual(View.visibleRefs(refs).map((r) => r.name), ['main', 'v1', 'origin/main']);
  assert.strictEqual(refs[0].name, 'origin/main', 'visibleRefs ha riordinato l elenco originale');
});

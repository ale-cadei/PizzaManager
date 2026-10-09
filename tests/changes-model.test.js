const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Pannello «cosa ha cambiato» (docs/plans/32): le scelte senza DOM. Di quale
   cartella si parla, cosa dice la linguetta, quando rileggere un diff aperto. */
const M = require('../renderer/changes-model');

const result = (files, extra = {}) => ({
  ok: true, root: '/r', against: 'abc', base: null, truncated: false,
  totals: { files: files.length, added: files.reduce((n, f) => n + (f.added || 0), 0), removed: files.reduce((n, f) => n + (f.removed || 0), 0) },
  files, ...extra,
});
const file = (path, added = 1, removed = 0, status = 'M') => ({ path, status, added, removed, binary: false });

ok('modifiche: il bersaglio è la cartella della sessione, con la base se sta in un worktree', () => {
  assert.deepStrictEqual(M.targetFor({ type: 'claude', cwd: '/r' }, null), { cwd: '/r', base: null, branch: null, path: null, since: null, staging: false, key: '/r\0\0' });
  const wt = { path: '/r.worktrees/feat-x', branch: 'feat/x', base: 'main' };
  assert.deepStrictEqual(M.targetFor({ type: 'shell', cwd: '/r.worktrees/feat-x' }, wt),
    { cwd: '/r.worktrees/feat-x', base: 'main', branch: 'feat/x', path: '/r.worktrees/feat-x', since: null, staging: false, key: '/r.worktrees/feat-x\0main\0' });
  // worktree senza base: contro HEAD, ma il branch si mostra
  assert.strictEqual(M.targetFor({ type: 'shell', cwd: '/w' }, { path: '/w', branch: 'x', base: null }).base, null);
});

ok('modifiche: niente bersaglio per la scheda git o senza cartella', () => {
  assert.strictEqual(M.targetFor(null, null), null);
  assert.strictEqual(M.targetFor({ type: 'git', cwd: '/r' }, null), null);
  assert.strictEqual(M.targetFor({ type: 'shell', cwd: '' }, null), null);
});

ok('modifiche: la linguetta dice file e righe, e sparisce fuori da un repository', () => {
  const dirty = M.tabLabel(result([file('a', 120, 30), file('b'), file('c')]));
  assert.deepStrictEqual([dirty.visible, dirty.clean, dirty.text], [true, false, '3 · +122 −30']);
  assert.deepStrictEqual(dirty.parts, [{ kind: 'files', text: '3' }, { kind: 'add', text: '+122' }, { kind: 'del', text: '−30' }]);
  const clean = M.tabLabel(result([]));
  assert.deepStrictEqual([clean.clean, clean.text, clean.parts], [true, '±0', [{ kind: 'clean', text: '±0' }]]);
  assert.strictEqual(M.tabLabel(null).visible, false);
  assert.strictEqual(M.tabLabel({ ok: false, reason: 'not-a-repo' }).visible, false);
  assert.strictEqual(M.tabLabel({ ok: false, error: 'boh' }).visible, false);
});

ok('modifiche: il titolo dice rispetto a cosa', () => {
  const target = { cwd: '/w', base: 'main', branch: 'feat/x' };
  assert.strictEqual(M.headerTitle(target, result([], { base: 'main' })), 'feat/x da main');
  assert.strictEqual(M.headerTitle({ cwd: '/r', base: null, branch: null }, result([])), 'rispetto all\'ultimo commit');
  // la base non c'è più: si è confrontato con HEAD e il titolo lo dice
  assert.strictEqual(M.headerTitle(target, result([], { base: null })), 'feat/x · rispetto all\'ultimo commit');
  assert.strictEqual(M.headerTitle({ cwd: '/r', base: null, branch: null }, result([], { against: null })), 'nessun commit ancora');
});

ok('modifiche: il riepilogo conta tutti i file e dice se l\'elenco è tagliato', () => {
  assert.strictEqual(M.summary(result([file('a', 2, 1)])), '1 file · +2 −1');
  assert.strictEqual(M.summary(result([file('a'), file('b')])), '2 file · +2 −0');
  const cut = result([file('a')], { truncated: true, totals: { files: 1500, added: 9, removed: 0 } });
  assert.strictEqual(M.summary(cut), '1500 file · +9 −0 · mostrati i primi 1');
  assert.strictEqual(M.summary(result([])), 'Nessuna modifica');
});

ok('modifiche: i contatori di un file', () => {
  assert.deepStrictEqual(M.fileCounts(file('a', 12, 3)), { added: '+12', removed: '−3', note: null });
  assert.deepStrictEqual(M.fileCounts({ ...file('a'), binary: true, added: null, removed: null }), { added: null, removed: null, note: 'binario' });
  assert.deepStrictEqual(M.fileCounts({ ...file('a'), added: null, removed: 0, status: '?' }), { added: null, removed: null, note: 'grande' });
  assert.deepStrictEqual(M.fileCounts(file('a', 0, 4, 'D')), { added: null, removed: '−4', note: null });
});

ok('modifiche: la firma cambia solo se cambia qualcosa che si vede', () => {
  const a = result([file('a', 1, 0)]);
  assert.strictEqual(M.signature(a), M.signature(result([file('a', 1, 0)])));
  assert.notStrictEqual(M.signature(a), M.signature(result([file('a', 2, 0)])));
  assert.notStrictEqual(M.signature(a), M.signature(result([file('a', 1, 0)], { against: 'zzz' })));
  assert.notStrictEqual(M.signature(a), M.signature({ ok: false, reason: 'not-a-repo' }));
});

ok('modifiche: un diff aperto si rilegge se il suo file cambia, si chiude se sparisce', () => {
  const prev = [file('a', 1), file('b', 1), file('c', 1)];
  const next = [file('a', 1), file('b', 5)];
  assert.deepStrictEqual(M.diffsToReload(prev, next, ['a', 'b', 'c']), { reload: ['b'], drop: ['c'] });
  assert.deepStrictEqual(M.diffsToReload(prev, prev, ['a']), { reload: [], drop: [] });
  // il punto di confronto è cambiato (un commit): tutti da rileggere
  assert.deepStrictEqual(M.diffsToReload(prev, prev, ['a'], { againstChanged: true }), { reload: ['a'], drop: [] });
});

ok('modifiche: il percorso si divide in cartella e nome, anche con i rinominati', () => {
  assert.deepStrictEqual(M.splitPath('lib/sub/x.js'), { dir: 'lib/sub/', name: 'x.js' });
  assert.deepStrictEqual(M.splitPath('x.js'), { dir: '', name: 'x.js' });
  assert.strictEqual(M.displayPath({ path: 'b.js', oldPath: 'lib/a.js' }), 'lib/a.js → b.js');
  assert.strictEqual(M.displayPath({ path: 'b.js' }), 'b.js');
});

ok('modifiche: un commit nel worktree cambia la firma anche se i file sono gli stessi', () => {
  const before = result([file('a', 1, 0)], { uncommitted: 1 });
  const after = result([file('a', 1, 0)], { uncommitted: 0 });
  assert.notStrictEqual(M.signature(before), M.signature(after));
});

ok('modifiche: un file riscritto con gli stessi contatori si rilegge', () => {
  const prev = [{ ...file('a', 1, 1), stamp: '10:1' }];
  const next = [{ ...file('a', 1, 1), stamp: '10:2' }];
  assert.deepStrictEqual(M.diffsToReload(prev, next, ['a']), { reload: ['a'], drop: [] });
});

ok('modifiche: un collegamento o una cartella lo dicono invece di «grande»', () => {
  assert.deepStrictEqual(M.fileCounts({ ...file('link'), added: null, special: true }), { added: null, removed: null, note: 'non è un file' });
});

ok('modifiche: il riepilogo a pezzi, per colorare aggiunte e rimozioni', () => {
  assert.deepStrictEqual(M.summaryParts(result([file('a', 2, 1)])),
    [{ kind: 'files', text: '1 file' }, { kind: 'add', text: '+2' }, { kind: 'del', text: '−1' }]);
  assert.deepStrictEqual(M.summaryParts(result([])), [{ kind: 'note', text: 'Nessuna modifica' }]);
  assert.deepStrictEqual(M.summaryParts({ ok: false }), []);
});

ok('ultimo giro: la fotografia entra nel bersaglio e nella sua chiave', () => {
  const a = M.targetFor({ type: 'claude', cwd: '/r' }, null, { since: 'f'.repeat(40) });
  assert.strictEqual(a.since, 'f'.repeat(40));
  assert.notStrictEqual(a.key, M.targetFor({ type: 'claude', cwd: '/r' }, null).key);
});

ok('ultimo giro: il selettore si accende solo per un agente con una fotografia', () => {
  assert.deepStrictEqual(M.modeChoice({ type: 'claude', turnTree: 'abc' }, 'turn'),
    { current: 'turn', turnAvailable: true, turnHint: 'Solo quello che è cambiato dopo l\'ultimo prompt inviato.' });
  const none = M.modeChoice({ type: 'claude', turnTree: null }, 'turn');
  assert.deepStrictEqual([none.current, none.turnAvailable], ['commit', false]);
  assert.match(none.turnHint, /nessun prompt/);
  assert.match(M.modeChoice({ type: 'shell' }, 'turn').turnHint, /agente/);
  assert.strictEqual(M.modeChoice({ type: 'codex', turnTree: 'x' }, 'commit').current, 'commit');
});

ok('ultimo giro: titolo e messaggio vuoto lo dicono', () => {
  const turn = result([], { since: true });
  assert.strictEqual(M.headerTitle({ cwd: '/r' }, turn, { turnTime: '16:42' }), 'ultimo giro · dalle 16:42');
  assert.strictEqual(M.emptyText(turn), 'Nessuna modifica dall\'ultimo prompt.');
  assert.match(M.emptyText(result([])), /ultimo commit/);
});

ok('ultimo giro: una fotografia senza i file nuovi lo dice', () => {
  assert.match(M.notice(result([], { since: true, partial: true })), /gitignore/);
  assert.strictEqual(M.notice(result([], { since: true, partial: false })), null);
  assert.strictEqual(M.notice(null), null);
});

/* ---------- «Da committare» (docs/plans/43) ---------- */

const staged = (path, extra = {}) => ({ ...file(path), side: 'staged', ...extra });
const unstaged = (path, extra = {}) => ({ ...file(path), side: 'unstaged', ...extra });
const stagingResult = (files, counts) => result(files, {
  staging: true, since: false,
  totals: { files: new Set(files.map((f) => f.path)).size, added: files.length, removed: 0, ...counts },
});

ok('da committare: il bersaglio ha una chiave sua, e niente fotografia', () => {
  const tab = { type: 'claude', cwd: '/r' };
  const s = M.targetFor(tab, null, { staging: true, since: 'f'.repeat(40) });
  assert.deepStrictEqual([s.staging, s.since], [true, null]);
  assert.notStrictEqual(s.key, M.targetFor(tab, null).key);
  assert.strictEqual(M.targetFor(tab, null).staging, false);
});

ok('da committare: il selettore lo offre a ogni sessione, anche senza prompt', () => {
  assert.strictEqual(M.modeChoice({ type: 'shell' }, 'staging').current, 'staging');
  assert.strictEqual(M.modeChoice({ type: 'claude', turnTree: null }, 'staging').current, 'staging');
  assert.strictEqual(M.modeChoice({ type: 'claude' }, 'altro').current, 'commit');
});

ok('da committare: titolo, riepilogo e messaggio vuoto lo dicono', () => {
  const r = stagingResult([staged('a.js'), unstaged('a.js'), unstaged('b.js')], { staged: 1, unstaged: 2 });
  assert.strictEqual(M.headerTitle({ branch: 'feat/x' }, r), 'feat/x · da committare');
  assert.strictEqual(M.headerTitle({}, stagingResult([], { against: null })), 'da committare');
  assert.deepStrictEqual(M.summaryParts(r).map((p) => p.text), ['1 staged · 2 non staged', '+3', '−0']);
  assert.strictEqual(M.summary(r), '1 staged · 2 non staged · +3 −0');
  assert.match(M.emptyText(stagingResult([], { staged: 0, unstaged: 0 })), /Niente da committare/);
});

ok('da committare: le sezioni coi loro numeri, solo se c\'è qualcosa', () => {
  const r = stagingResult([unstaged('b.js')], { staged: 0, unstaged: 1 });
  assert.deepStrictEqual(M.sections(r).map((s) => [s.side, s.title, s.count]), [['staged', 'Staged', 0], ['unstaged', 'Non staged', 1]]);
  assert.deepStrictEqual(M.sections(stagingResult([], { staged: 0, unstaged: 0 })), []);
  assert.deepStrictEqual(M.sections(result([file('a')])), []);
});

ok('da committare: un file a metà ha due righe distinte, e i diff aperti restano separati', () => {
  assert.strictEqual(M.itemId(staged('a.js')), 'staged:a.js');
  assert.strictEqual(M.itemId(file('a.js')), 'a.js');
  const target = M.targetFor({ type: 'claude', cwd: '/r' }, null, { staging: true });
  assert.deepStrictEqual(M.splitItemId(target, 'unstaged:dir/con:due.js'), { side: 'unstaged', path: 'dir/con:due.js' });
  assert.deepStrictEqual(M.splitItemId(M.targetFor({ type: 'claude', cwd: '/r' }, null), 'x:y'), { side: null, path: 'x:y' });
  // cambia solo la parte non staged: si rilegge solo quel diff
  const before = [staged('a.js'), unstaged('a.js')];
  const after = [staged('a.js'), unstaged('a.js', { added: 5 })];
  assert.deepStrictEqual(M.diffsToReload(before, after, ['staged:a.js', 'unstaged:a.js']), { reload: ['unstaged:a.js'], drop: [] });
  // tutto aggiunto con git add: sparisce dai non staged
  assert.deepStrictEqual(M.diffsToReload(before, [staged('a.js')], ['unstaged:a.js']).drop, ['unstaged:a.js']);
});

ok('da committare: spostare un file da una sezione all\'altra cambia la firma', () => {
  const a = stagingResult([unstaged('a.js')], { staged: 0, unstaged: 1 });
  const b = stagingResult([staged('a.js')], { staged: 1, unstaged: 0 });
  assert.notStrictEqual(M.signature(a), M.signature(b));
});

ok('commenti: solo nelle sessioni con un agente, e non in modalità Unisci', () => {
  assert.strictEqual(M.reviewAvailable({ type: 'claude' }, false), true);
  assert.strictEqual(M.reviewAvailable({ type: 'codex' }, false), true);
  assert.strictEqual(M.reviewAvailable({ type: 'claude' }, true), false);
  assert.strictEqual(M.reviewAvailable({ type: 'shell' }, false), false);
  assert.strictEqual(M.reviewAvailable({ type: 'git' }, false), false);
  assert.strictEqual(M.reviewAvailable(null, false), false);
});

/* ---------- Stage, unstage e commit (docs/plans/45) ---------- */

ok('commit: si scrive solo in «Da committare», e mai in modalità Unisci', () => {
  const tab = { id: 't1', type: 'shell', cwd: '/r' };
  const r = stagingResult([unstaged('a.js')], { staged: 0, unstaged: 1 });
  assert.strictEqual(M.commitChoice(tab, [tab], result([file('a.js')]), {}), null);
  assert.strictEqual(M.commitChoice(tab, [tab], r, { merging: true }), null);
  assert.strictEqual(M.commitChoice(tab, [tab], { ok: false, error: 'x' }, {}), null);
  const c = M.commitChoice(tab, [tab], r, { message: '' });
  assert.deepStrictEqual([c.canWrite, c.reason], [true, null]);
});

ok('commit: «Committa N file» solo con qualcosa di staged e un messaggio', () => {
  const tab = { id: 't1', type: 'claude', cwd: '/r' };
  const r = stagingResult([staged('a.js'), staged('b.js'), unstaged('c.js')], { staged: 2, unstaged: 1 });
  const ready = M.commitChoice(tab, [tab], r, { message: 'fix: x' });
  assert.deepStrictEqual([ready.canCommit, ready.commitReason, ready.commitLabel], [true, null, 'Committa 2 file']);
  const blank = M.commitChoice(tab, [tab], r, { message: '  \n ' });
  assert.strictEqual(blank.canCommit, false);
  assert.match(blank.commitReason, /messaggio/);
  const none = M.commitChoice(tab, [tab], stagingResult([unstaged('c.js')], { staged: 0, unstaged: 1 }), { message: 'x' });
  assert.strictEqual(none.canCommit, false);
  assert.match(none.commitReason, /staged/);
  assert.strictEqual(none.canWrite, true, 'si può ancora aggiungere');
});

ok('commit: spento, col motivo, se la sessione o un\'altra nello stesso repository lavora', () => {
  const tab = { id: 't1', type: 'claude', cwd: '/r/lib', name: 'questa' };
  const r = stagingResult([staged('a.js')], { staged: 1, unstaged: 0 });
  const self = M.commitChoice({ ...tab, running: true }, [{ ...tab, running: true }], r, { message: 'x' });
  assert.deepStrictEqual([self.canWrite, self.canCommit], [false, false]);
  assert.match(self.reason, /sta lavorando/);
  assert.strictEqual(self.commitReason, self.reason);
  const other = { id: 't2', type: 'codex', cwd: '/r', name: 'agente <b>', running: true };
  const c = M.commitChoice(tab, [tab, other], r, { message: 'x' });
  assert.strictEqual(c.canWrite, false);
  assert.match(c.reason, /agente <b>/);
  // fuori dal repository, o in uno che comincia uguale: non conta
  for (const cwd of ['/altro', '/r2', '/r.worktrees/feat-x']) {
    assert.strictEqual(M.commitChoice(tab, [tab, { ...other, cwd }], r, {}).canWrite, true, cwd);
  }
  // Windows: separatori diversi, stessa cartella
  const win = stagingResult([staged('a.js')], { staged: 1, unstaged: 0 });
  const wr = { ...win, root: 'C:\\r' };
  assert.strictEqual(M.commitChoice(tab, [tab, { ...other, cwd: 'C:/r/sub' }], wr, {}).canWrite, false);
});

ok('commit: spento con un merge o un rebase a metà, o con un\'altra scrittura in corso', () => {
  const tab = { id: 't1', type: 'shell', cwd: '/r' };
  const r = stagingResult([staged('a.js')], { staged: 1, unstaged: 0 });
  const merge = M.commitChoice(tab, [tab], { ...r, busy: 'merge' }, { message: 'x' });
  assert.deepStrictEqual([merge.canWrite, merge.canCommit], [false, false]);
  assert.match(merge.reason, /merge/);
  assert.match(M.commitChoice(tab, [tab], { ...r, busy: 'rebase' }, {}).reason, /rebase/);
  const writing = M.commitChoice(tab, [tab], r, { message: 'x', writing: true });
  assert.deepStrictEqual([writing.canWrite, writing.canCommit], [false, false]);
});

ok('commit: un merge che comincia o finisce cambia la firma', () => {
  const r = stagingResult([staged('a.js')], { staged: 1, unstaged: 0 });
  assert.notStrictEqual(M.signature(r), M.signature({ ...r, busy: 'merge' }));
});

/* ---------- Unire un branch dal selettore (docs/plans/46) ---------- */

const incoming = (files, extra = {}) => result(files, { incoming: 'feat/x', tip: 'bbb222', uncommitted: 0, ...extra });

ok('unisci branch: il bersaglio è il branch che entra, con una chiave sua', () => {
  const t = M.incomingTarget({ cwd: '/r', name: 'feat/x', into: 'main' });
  assert.strictEqual(t.incoming, 'feat/x');
  assert.strictEqual(t.into, 'main');
  assert.deepStrictEqual([t.base, t.since, t.staging], [null, null, false]);
  assert.notStrictEqual(t.key, M.targetFor({ type: 'shell', cwd: '/r' }, null).key);
  assert.notStrictEqual(t.key, M.incomingTarget({ cwd: '/r', name: 'origin/x', into: 'main' }).key);
  assert.strictEqual(M.headerTitle(t, incoming([file('a.js')])), 'feat/x in main');
  assert.strictEqual(M.incomingTarget({ cwd: '', name: 'x', into: 'main' }), null);
  assert.strictEqual(M.incomingTarget({ cwd: '/r', name: '', into: 'main' }), null);
});

ok('unisci branch: «Unisci in main» acceso quando si può, e dice cosa farà', () => {
  const tabs = [{ id: 'g', type: 'git', cwd: '/r' }];
  const f = M.branchMergeFooter({ name: 'feat/x', into: 'main' }, incoming([file('a.js')]), tabs);
  assert.deepStrictEqual([f.confirmLabel, f.canConfirm, f.warning], ['Unisci in main', true, null]);
  assert.match(f.text, /fast-forward/);
  // ancora da leggere, o illeggibile: spento senza avviso
  assert.strictEqual(M.branchMergeFooter({ name: 'feat/x', into: 'main' }, null, tabs).canConfirm, false);
  assert.strictEqual(M.branchMergeFooter({ name: 'feat/x', into: 'main' }, { ok: false, error: 'x' }, tabs).canConfirm, false);
});

ok('unisci branch: spento con file non committati o una sessione che lavora nel repository', () => {
  const merge = { name: 'feat/x', into: 'main' };
  const dirty = M.branchMergeFooter(merge, incoming([file('a.js')], { uncommitted: 2 }), []);
  assert.strictEqual(dirty.canConfirm, false);
  assert.match(dirty.warning, /2 file tracciati/);
  const busy = { id: 't2', type: 'claude', cwd: '/r/lib', name: 'agente', running: true };
  const running = M.branchMergeFooter(merge, incoming([file('a.js')]), [busy]);
  assert.strictEqual(running.canConfirm, false);
  assert.match(running.warning, /agente/);
  assert.strictEqual(M.branchMergeFooter(merge, incoming([file('a.js')]), [{ ...busy, cwd: '/altro' }]).canConfirm, true);
  // niente file cambiati: si avvisa, ma il merge (i commit) si può fare
  const empty = M.branchMergeFooter(merge, incoming([]), []);
  assert.strictEqual(empty.canConfirm, true);
  assert.match(empty.warning, /nessun file/);
});

ok('unisci branch: un branch già contenuto nel corrente non si unisce', () => {
  const f = M.branchMergeFooter({ name: 'feat/x', into: 'main' }, incoming([], { against: 'bbb222', tip: 'bbb222' }), []);
  assert.strictEqual(f.canConfirm, false);
  assert.match(f.warning, /già contenuto/);
});

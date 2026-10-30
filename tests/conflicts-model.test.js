const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Modalità «Conflitti» del pannello (docs/plans/69): testata, nomi dei due
   lati per operazione, pulsanti. Niente DOM. */
const M = require('../renderer/conflicts-model');

const base = (op, what, files = [], resolved = []) => ({ ok: true, root: '/r', op, what, files, resolved });
const merge = base('merge', { incoming: 'feat/x', into: 'main', step: null, total: null, commit: 'abc1234', subject: null });

ok('conflitti: testata per merge, rebase, cherry-pick, revert', () => {
  assert.strictEqual(M.viewState(merge, {}).headline, 'Merge di feat/x in main, a metà');
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 3, total: 7, commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(rebase, {}).headline, 'Rebase di feat/x su main, passo 3 di 7 (abc1234 fix: x)');
  const pick = base('cherry-pick', { incoming: null, into: 'main', commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(pick, {}).headline, 'Cherry-pick di abc1234 fix: x in main');
  const rev = base('revert', { incoming: null, into: 'main', commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(rev, {}).headline, 'Revert di abc1234 fix: x in main');
});

ok('conflitti: nostro e loro coi nomi, invertiti nel rebase', () => {
  assert.deepStrictEqual(M.viewState(merge, {}).sides, { ours: 'main', theirs: 'feat/x' });
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 1, total: 1, commit: 'abc1234', subject: 's' });
  assert.deepStrictEqual(M.viewState(rebase, {}).sides, { ours: 'main', theirs: 'abc1234 di feat/x' });
});

ok('conflitti: azioni per tipo di file', () => {
  const c = { ...merge, files: [
    { path: 'a.js', kind: 'both-modified', binary: false, blocks: 2 },
    { path: 'logo.png', kind: 'both-modified', binary: true, blocks: null },
    { path: 'old.js', kind: 'deleted-by-them', binary: false, blocks: 0 },
    { path: 'gone.js', kind: 'both-deleted', binary: false, blocks: null },
  ] };
  const [text, bin, del, both] = M.viewState(c, {}).files;
  assert.deepStrictEqual(text.actions.map((a) => a.how), ['open', 'mark']);
  assert.strictEqual(text.blocksLabel, '2 blocchi');
  assert.strictEqual(text.kindLabel, 'modificato da entrambi');
  assert.deepStrictEqual(bin.actions.map((a) => [a.how, a.label]), [['ours', 'Tieni main'], ['theirs', 'Tieni feat/x']]);
  assert.strictEqual(bin.kindLabel, 'binario, modificato da entrambi');
  assert.deepStrictEqual(del.actions.map((a) => a.how), ['keep', 'delete']);
  assert.strictEqual(del.kindLabel, 'cancellato in feat/x');
  assert.deepStrictEqual(both.actions.map((a) => a.how), ['delete']);
});

ok('conflitti: Concludi solo a zero conflitti e senza sessioni al lavoro', () => {
  const withFile = { ...merge, files: [{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }] };
  const f1 = M.viewState(withFile, {}).footer;
  assert.strictEqual(f1.continueLabel, 'Concludi merge');
  assert.strictEqual(f1.canContinue, false);
  assert.match(f1.continueReason, /1 file in conflitto/);
  assert.strictEqual(f1.canAbort, true);
  assert.strictEqual(f1.abortLabel, 'Annulla merge');
  const f2 = M.viewState(merge, {}).footer;
  assert.strictEqual(f2.canContinue, true);
  const f3 = M.viewState(merge, { block: 'La sessione sta lavorando: aspetta che si fermi.' }).footer;
  assert.strictEqual(f3.canContinue, false);
  assert.strictEqual(f3.canAbort, false);
  assert.match(f3.abortReason, /sta lavorando/);
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 1, total: 2, commit: 'a', subject: 's' });
  assert.strictEqual(M.viewState(rebase, {}).footer.continueLabel, 'Continua rebase');
  assert.strictEqual(M.viewState(rebase, {}).footer.abortLabel, 'Annulla rebase');
});

ok('conflitti: con un blocco le azioni si spengono, tranne aprire nell\'editor', () => {
  const c = { ...merge, files: [
    { path: 'a.js', kind: 'both-modified', binary: false, blocks: 2 },
    { path: 'old.js', kind: 'deleted-by-them', binary: false, blocks: 0 },
  ] };
  const reason = 'La sessione sta lavorando: aspetta che si fermi.';
  const [text, del] = M.viewState(c, { block: reason }).files;
  assert.deepStrictEqual(text.actions.map((a) => [a.how, a.disabled]), [['open', false], ['mark', true]]);
  assert.strictEqual(text.actions.find((a) => a.how === 'mark').title, reason);
  assert.strictEqual(text.actions.find((a) => a.how === 'open').title, 'Apri nell\'editor');
  assert.deepStrictEqual(del.actions.map((a) => [a.how, a.disabled]), [['keep', true], ['delete', true]]);
  const [free] = M.viewState(c, {}).files;
  assert.deepStrictEqual(free.actions.map((a) => a.disabled), [false, false]);
});

ok('conflitti: esiti', () => {
  assert.deepStrictEqual(M.outcomeOf({ how: 'mark' }, { ok: false, error: 'marcatori' }), { ok: false, text: 'marcatori' });
  assert.strictEqual(M.outcomeOf({ how: 'mark' }, { ok: true }), null);
  assert.match(M.outcomeOf({ how: 'continue' }, { ok: true, stopped: true }).text, /fermata di nuovo/);
  assert.match(M.outcomeOf({ how: 'continue' }, { ok: true, done: true }).text, /concluso/i);
});

const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, descendants } = require('./fake-dom');

/* La barra del pannello delle modifiche (docs/plans/89): branch, worktree,
   distanza dall'upstream e pulsante di push. Su un DOM finto: mai nodi
   dentro assert.*Equal (memoria), solo testi e flag. */
const { headBar, pushOutcome, headSignature, createHeadBar } = require('../renderer/changes-head');

const head = (over = {}) => ({
  ok: true, root: '/repo', branch: 'feat/x', detached: null, unborn: false,
  upstream: 'origin/feat/x', ahead: 2, behind: 0, gone: false, worktree: null, ...over,
});

ok('barra: branch avanti sull\'upstream, push col numero di commit', () => {
  const s = headBar(head());
  assert.strictEqual(s.branch, 'feat/x');
  assert.strictEqual(s.sync, '⇡2 origin/feat/x');
  assert.deepStrictEqual(s.push, { label: 'Push ⇡2', enabled: true, title: 'Push di 2 commit su origin/feat/x.' });
  assert.strictEqual(s.worktree, null);
});

ok('barra: senza upstream si pubblica, allineato non si pusha', () => {
  const fresh = headBar(head({ upstream: null, ahead: 0 }));
  assert.strictEqual(fresh.push.label, 'Pubblica');
  assert.strictEqual(fresh.push.enabled, true);
  assert.strictEqual(fresh.sync, 'nessun upstream');
  const even = headBar(head({ ahead: 0 }));
  assert.strictEqual(even.push.enabled, false);
  assert.match(even.push.title, /allineato con origin\/feat\/x/);
  assert.strictEqual(even.sync, '= origin/feat/x');
});

ok('barra: remoto più avanti lo dice, upstream sparito non ricrea', () => {
  const diverged = headBar(head({ ahead: 1, behind: 3 }));
  assert.strictEqual(diverged.sync, '⇡1 ⇣3 origin/feat/x');
  assert.strictEqual(diverged.push.enabled, true);
  assert.match(diverged.push.title, /1 commit su origin\/feat\/x.*3 commit in più.*pull o rebase/);
  const gone = headBar(head({ gone: true }));
  assert.strictEqual(gone.push.enabled, false);
  assert.strictEqual(gone.sync, 'origin/feat/x sparito');
});

ok('barra: HEAD staccato, nessun commit, push o scrittura in corso spengono il pulsante', () => {
  const detached = headBar(head({ branch: null, detached: 'abc1234', upstream: null }));
  assert.strictEqual(detached.branch, 'HEAD staccato · abc1234');
  assert.strictEqual(detached.push.enabled, false);
  assert.strictEqual(detached.sync, '');
  assert.strictEqual(headBar(head({ unborn: true, upstream: null })).push.enabled, false);
  const pushing = headBar(head(), { pushing: true });
  assert.deepStrictEqual([pushing.push.label, pushing.push.enabled], ['Push…', false]);
  assert.strictEqual(headBar(head(), { writing: true }).push.enabled, false);
});

ok('barra: worktree collegato e fuori da un repository', () => {
  assert.strictEqual(headBar(head({ worktree: 'feature-x' })).worktree, 'feature-x');
  assert.strictEqual(headBar(null), null);
  assert.strictEqual(headBar({ ok: false, reason: 'not-a-repo' }), null);
});

ok('barra: esito del push e firma', () => {
  assert.deepStrictEqual(pushOutcome({ ok: true, branch: 'feat/x', upstream: 'origin/feat/x', created: true }),
    { ok: true, text: 'feat/x pushato su origin/feat/x (nuovo upstream)' });
  assert.deepStrictEqual(pushOutcome({ ok: false, error: 'rifiutato' }), { ok: false, text: 'rifiutato' });
  assert.strictEqual(pushOutcome(null).ok, false);
  assert.notStrictEqual(headSignature(head()), headSignature(head({ ahead: 3 })));
  assert.strictEqual(headSignature(head()), headSignature(head()));
  assert.strictEqual(headSignature(null), 'none');
});

const byClass = (root, cls) => descendants(root).find((n) => n.classes.has(cls));

ok('barra: il disegno mostra nome, worktree, distanza, e il clic pusha solo se si può', () => {
  let pushes = 0;
  const bar = createHeadBar({ createElement }, () => { pushes += 1; });
  bar.render(null);
  assert.strictEqual(bar.el.hidden, true);
  bar.render(headBar(head({ worktree: 'feature-x' }), { outcome: { ok: false, text: 'rifiutato <b>' } }));
  assert.strictEqual(bar.el.hidden, false);
  assert.strictEqual(byClass(bar.el, 'changes-branch').textContent, '⎇ feat/x');
  assert.strictEqual(byClass(bar.el, 'changes-worktree').textContent, 'worktree feature-x');
  assert.strictEqual(byClass(bar.el, 'changes-sync').textContent, '⇡2 origin/feat/x');
  const outcome = byClass(bar.el, 'changes-push-outcome');
  assert.strictEqual(outcome.textContent, 'rifiutato <b>');
  assert.ok(outcome.classes.has('is-error'));
  const btn = byClass(bar.el, 'changes-push');
  assert.strictEqual(btn.textContent, 'Push ⇡2');
  btn.onclick();
  assert.strictEqual(pushes, 1);
  bar.render(headBar(head({ ahead: 0 })));
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(byClass(bar.el, 'changes-worktree').hidden, true);
  btn.onclick();
  assert.strictEqual(pushes, 1);
});

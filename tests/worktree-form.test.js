const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Il modale «Nuovo worktree» (docs/plans/36): da dove si parte, cosa non
   seguirà, se si può creare e dove finirà la cartella. La parte pura, senza
   DOM: renderer/worktree-form.js. */
const { startModel, folderPreview, filterBases } = require('../renderer/worktree-form');

const START = { ok: true, current: { branch: 'feat/y', commit: 'abc1234' }, dirty: 0, busy: null, bases: ['feat/y', 'main', 'develop'] };

ok('form: le basi nell ordine di lib/worktree.js, la corrente segnata e preselezionata', () => {
  const m = startModel(START);
  // Come le voci dell'albero git: nome, e a destra il suggerimento grigio
  assert.deepStrictEqual(m.bases, [
    { value: 'feat/y', label: 'feat/y', hint: 'corrente' },
    { value: 'main', label: 'main', hint: '' },
    { value: 'develop', label: 'develop', hint: '' },
  ]);
  assert.strictEqual(m.selected, 'feat/y');
  assert.strictEqual(m.warning, null);
  assert.strictEqual(m.blocked, null);
});

ok('form: da HEAD staccato la prima base è il commit, e lo dice', () => {
  const m = startModel({ ...START, current: { branch: null, commit: 'abc1234' }, bases: ['abc1234', 'main'] });
  assert.deepStrictEqual(m.bases[0], { value: 'abc1234', label: 'abc1234', hint: 'commit corrente, HEAD staccato' });
  assert.match(m.note, /Unisci/, 'non avvisa che da un commit non si potrà unire');
});

ok('form: i file modificati non seguono il worktree, e lo si dice prima', () => {
  assert.match(startModel({ ...START, dirty: 1 }).warning, /^1 file modificato /);
  assert.match(startModel({ ...START, dirty: 3 }).warning, /^3 file modificati /);
  assert.match(startModel({ ...START, dirty: 3 }).warning, /ultimo commit/);
});

ok('form: un merge o un rebase a metà bloccano la creazione, con il perché', () => {
  assert.match(startModel({ ...START, busy: 'merge' }).blocked, /merge/);
  assert.match(startModel({ ...START, busy: 'rebase' }).blocked, /rebase/);
});

ok('form: una risposta di errore blocca e porta il messaggio', () => {
  assert.deepStrictEqual(startModel({ ok: false, error: 'nessun commit' }).blocked, 'nessun commit');
  for (const bad of [null, undefined, {}]) assert.ok(startModel(bad).blocked, JSON.stringify(bad));
});

ok('form: l anteprima mostra dove finirà la cartella, come lib/worktree.js', () => {
  assert.strictEqual(folderPreview('/src/PizzaManager', 'feat/login'), 'PizzaManager.worktrees/feat-login');
  assert.strictEqual(folderPreview('C:\\src\\PizzaManager', 'fix/a/b'), 'PizzaManager.worktrees/fix-a-b');
  assert.strictEqual(folderPreview('/src/PizzaManager', '   '), '');
});

ok('form: ogni elemento che il modale cerca esiste in index.html, e [⑂] lo apre', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'worktree-modal.js'), 'utf8');
  const ids = [...new Set([...js.matchAll(/\$\('#([a-z-]+)'\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 5, 'non trovati gli elementi del modale nel sorgente');
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepStrictEqual(missing, [], 'il modale cerca elementi che la pagina non ha');
  assert.match(fs.readFileSync(path.join(dir, 'session-list.js'), 'utf8'), /onNewWorktree: \(root\) => \{ openWorktreeModal\(root\)/);
});

ok('form: il filtro delle basi funziona come quello dell albero git, e tiene l ordine', () => {
  const { bases } = startModel(START);
  assert.deepStrictEqual(filterBases(bases, 'MA').map((b) => b.value), ['main'], 'non ignora maiuscole e minuscole');
  assert.deepStrictEqual(filterBases(bases, 'e').map((b) => b.value), ['feat/y', 'develop']);
  assert.deepStrictEqual(filterBases(bases, '  ').map((b) => b.value), ['feat/y', 'main', 'develop']);
  assert.deepStrictEqual(filterBases(bases, 'nessuno'), []);
});

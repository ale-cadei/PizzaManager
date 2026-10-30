const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Il menu ⋯ di un worktree (docs/plans/36): scelta, conferma, azione, e la
   seconda conferma se ci sono modifiche non committate. L'ordine conta: le
   sessioni del worktree si chiudono solo quando la cartella se ne va, così
   un Unisci rifiutato o un conflitto non costano gli agenti al lavoro. */
const { createWorktreeActions } = require('../renderer/worktree-actions');

const WT = { path: '/p.worktrees/feat-x', branch: 'feat/x', base: 'main' };
const ANCHOR = { id: 'ancora' };

/**
 * `choice` è la risposta al menu, `asks` le risposte alle conferme in ordine,
 * `merge` / `remove` le risposte del main (una per chiamata).
 */
function setup({ choice, choices = null, asks = [], merge = [], remove = [], aborts = [], open = [], reviews = null, closeAnswers = null }) {
  const log = [];
  const reviewed = [];
  const asked = [];
  const told = [];
  const deps = {
    api: {
      merge: async (root, path) => { log.push(`merge ${root} ${path}`); return merge.shift(); },
      remove: async (root, path, branch, force) => { log.push(`remove ${root} ${path} ${branch}${force ? ' force' : ''}`); return remove.shift(); },
      abortMerge: async (root) => { log.push(`abort ${root}`); return aborts.shift(); },
    },
    bubble: {
      // Il menu del worktree e, se il merge resta a metà, la scelta fra
      // Risolvi e Annulla merge passano dalla stessa `choose`
      choose: async (o) => { log.push('choose'); asked.push(o); return choices ? choices.shift() : choice; },
      ask: async (o) => { log.push('ask'); asked.push(o); return asks.shift(); },
      tell: async (o) => { log.push('tell'); told.push(o); return true; },
    },
    sessionsIn: (path) => { log.push(`sessionsIn ${path}`); return open; },
    // Come le schede vere: chiusa una sessione, non è più fra quelle del worktree
    closeSessions: async (list) => {
      log.push(`close ${list.map((t) => t.id).join(',')}`);
      open = open.filter((t) => !list.includes(t));
    },
    refresh: async (root) => { log.push(`refresh ${root}`); },
    // Il pannello delle modifiche (docs/plans/32): c'è solo se il test lo chiede
    ...(reviews ? { review: async (w, conf) => { log.push('review'); reviewed.push({ w, conf }); return reviews.shift(); } } : {}),
    // Le schede editor con file non salvati (renderer/worktrees.js): una risposta per scheda
    ...(closeAnswers ? { confirmClose: async (t) => { log.push(`confirmClose ${t.id}`); return closeAnswers.shift(); } } : {}),
    // Apre il pannello dei conflitti (Task 5): qui basta vedere che si chiama
    resolve: async (root) => { log.push(`resolve ${root}`); },
  };
  return { actions: createWorktreeActions(deps), log, asked, told, reviewed };
}

const steps = (log) => log.filter((l) => !l.startsWith('sessionsIn'));

ok('azioni: il menu offre Unisci, Tieni il branch e Butta, appeso alla riga del worktree', async () => {
  const { actions, asked } = setup({ choice: null });
  await actions.openMenu(WT, '/p', ANCHOR);
  const menu = asked[0];
  assert.strictEqual(menu.anchor, ANCHOR);
  assert.strictEqual(menu.key, 'worktree:/p.worktrees/feat-x', 'senza chiave il fumetto sparisce al primo render');
  assert.deepStrictEqual(menu.choices.map((c) => c.value), ['merge', 'keep', 'delete']);
  assert.match(menu.choices[0].label, /main/);
  assert.ok(menu.choices[2].danger);
});

ok('azioni: senza base Unisci è spento e dice perché; staccato si può solo buttare', async () => {
  const noBase = setup({ choice: null });
  await noBase.actions.openMenu({ ...WT, base: null }, '/p', ANCHOR);
  const merge = noBase.asked[0].choices[0];
  assert.strictEqual(merge.disabled, true);
  assert.match(merge.hint, /Tieni il branch/);

  const detached = setup({ choice: null });
  await detached.actions.openMenu({ path: '/p.worktrees/prova', branch: null, base: null }, '/p', ANCHOR);
  assert.deepStrictEqual(detached.asked[0].choices.map((c) => !!c.disabled), [true, true, false]);
});

ok('azioni: rinunciare al menu o alla conferma non tocca niente', async () => {
  for (const [choice, asks] of [[null, []], ['delete', [false]], ['merge', [false]]]) {
    const { actions, log } = setup({ choice, asks });
    await actions.openMenu(WT, '/p', ANCHOR);
    assert.ok(!log.some((l) => /^(merge|remove|close|refresh)/.test(l)), `${choice}: ${log.join(' | ')}`);
  }
});

ok('azioni: Unisci riuscito chiude le sessioni del worktree DOPO il merge, poi rinfresca', async () => {
  const open = [{ id: 'a' }, { id: 'b' }];
  const { actions, log, asked } = setup({ choice: 'merge', asks: [true], merge: [{ ok: true }], open });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'ask', 'merge /p /p.worktrees/feat-x', 'close a,b', 'refresh /p']);
  assert.match(asked[1].text, /2 sessioni/, 'la conferma non dice che si chiudono le sessioni');
  assert.strictEqual(asked[1].confirmLabel, 'Unisci');
});

ok('azioni: un conflitto lascia le sessioni vive e lo dice dalla riga del worktree', async () => {
  const { actions, log, told } = setup({ choice: 'merge', asks: [true], merge: [{ ok: false, conflict: true, error: 'Conflitti fra feat/x e main' }], open: [{ id: 'a' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.ok(!log.some((l) => l.startsWith('close')), 'chiuse le sessioni dopo un conflitto');
  assert.strictEqual(told.length, 1);
  assert.strictEqual(told[0].key, 'worktree:/p.worktrees/feat-x');
  // conflict senza pending: anche l'annullo è fallito, non va detto "annullato"
  // (fix round finale, docs/plans/69)
  assert.strictEqual(told[0].title, 'Merge non annullato');
  assert.match(told[0].text, /Conflitti/);
  assert.ok(log.indexOf('tell') < log.indexOf('refresh /p') || !log.includes('refresh /p'), 'il messaggio dopo che la riga è sparita');
});

const PENDING = { ok: false, conflict: true, pending: true, root: '/p', files: ['a.js'], error: 'Conflitti fra feat/x e main: il merge è a metà.' };

ok('azioni: merge a metà → chiede Risolvi o Annulla merge; Risolvi apre il pannello', async () => {
  const { actions, log, asked } = setup({ choices: ['merge', 'resolve'], asks: [true], merge: [PENDING], open: [{ id: 'a' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  const q = asked[asked.length - 1];
  assert.deepStrictEqual(q.choices.map((c) => c.value), ['resolve', 'abort']);
  assert.match(q.text, /a metà/);
  assert.ok(log.includes('resolve /p'));
  assert.ok(!log.some((l) => l.startsWith('close')));
});

ok('azioni: merge a metà → Annulla merge fa l abort nella cartella principale', async () => {
  const { actions, log, told } = setup({ choices: ['merge', 'abort'], asks: [true], merge: [PENDING], aborts: [{ ok: true }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.ok(log.includes('abort /p'));
  assert.ok(!log.includes('resolve /p'));
  assert.strictEqual(told.length, 0);
});

ok('azioni: Butta con modifiche chiede una seconda volta, poi butta con force', async () => {
  const { actions, log, asked } = setup({
    choice: 'delete', asks: [true, true],
    remove: [{ ok: false, dirty: true, error: 'contains modified or untracked files' }, { ok: true }],
    open: [{ id: 'a' }],
  });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), [
    'choose', 'ask', 'remove /p /p.worktrees/feat-x delete', 'ask', 'remove /p /p.worktrees/feat-x delete force', 'close a', 'refresh /p',
  ]);
  assert.match(asked[2].title, /modifiche/i);
});

ok('azioni: alla seconda domanda si può ancora rinunciare, e le sessioni restano', async () => {
  const { actions, log } = setup({ choice: 'keep', asks: [true, false], remove: [{ ok: false, dirty: true, error: 'x' }], open: [{ id: 'a' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'ask', 'remove /p /p.worktrees/feat-x keep', 'ask']);
});

/* Su Windows un processo con la cartella aperta ne impedisce la rimozione:
   le sessioni le si è già promesse chiuse, quindi si chiudono e si riprova */
ok('azioni: se la cartella non si toglie con le sessioni aperte, si chiudono e si riprova una volta', async () => {
  const { actions, log, told } = setup({
    choice: 'keep', asks: [true],
    remove: [{ ok: false, error: 'Permission denied' }, { ok: true }],
    open: [{ id: 'a' }],
  });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'ask', 'remove /p /p.worktrees/feat-x keep', 'close a', 'remove /p /p.worktrees/feat-x keep', 'refresh /p']);
  assert.strictEqual(told.length, 0);
});

ok('azioni: un errore che resta si dice, senza sessioni da chiudere non si riprova', async () => {
  const { actions, log, told } = setup({ choice: 'delete', asks: [true], remove: [{ ok: false, error: 'is locked' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'ask', 'remove /p /p.worktrees/feat-x delete', 'tell', 'refresh /p']);
  assert.match(told[0].text, /locked/);
});

ok('azioni: un errore del canale non resta appeso, si dice', async () => {
  const told = [];
  const failing = createWorktreeActions({
    api: { merge: async () => { throw new Error('ipc giù'); }, remove: async () => { throw new Error('ipc giù'); } },
    bubble: { choose: async () => 'delete', ask: async () => true, tell: async (o) => { told.push(o); return true; } },
    sessionsIn: () => [], closeSessions: async () => {}, refresh: async () => {},
  });
  await failing.openMenu(WT, '/p', ANCHOR);
  assert.match(told[0].text, /ipc giù/);
});

ok('azioni: col pannello, Unisci si conferma dalla revisione del diff e non dal fumetto', async () => {
  const open = [{ id: 'a' }];
  const { actions, log, reviewed } = setup({ choice: 'merge', reviews: [true], merge: [{ ok: true }], open });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'review', 'merge /p /p.worktrees/feat-x', 'close a', 'refresh /p']);
  assert.strictEqual(reviewed[0].w, WT);
  assert.match(reviewed[0].conf.text, /sessione aperta/, 'la revisione non dice che la sessione si chiude');
});

ok('azioni: Annulla nella revisione non tocca niente', async () => {
  const { actions, log } = setup({ choice: 'merge', reviews: [false], open: [{ id: 'a' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(log), ['choose', 'review']);
});

ok('azioni: col pannello, Tieni il branch e Butta restano sul fumetto', async () => {
  const { actions, log } = setup({ choice: 'keep', asks: [true], reviews: [true], remove: [{ ok: true }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.ok(!log.includes('review'));
  assert.ok(log.includes('ask'));
});

/* Una scheda editor del worktree con file non salvati: chiuderla senza
   chiedere li perderebbe (il merge non li prende, la rimozione li butta). */
ok('azioni: se una scheda rifiuta la chiusura non si unisce e non si toglie niente', async () => {
  for (const [choice, extra] of [['merge', { merge: [{ ok: true }] }], ['keep', { remove: [{ ok: true }] }], ['delete', { remove: [{ ok: true }] }]]) {
    const open = [{ id: 'ed', type: 'editor' }, { id: 'sh', type: 'shell' }];
    const { actions, log } = setup({ choice, asks: [true], open, closeAnswers: [false, true], ...extra });
    await actions.openMenu(WT, '/p', ANCHOR);
    assert.deepStrictEqual(steps(log), ['choose', 'ask', 'confirmClose ed'], `${choice}: ${log.join(' | ')}`);
  }
});

ok('azioni: col consenso di tutte le schede si procede, e la domanda viene prima dell azione', async () => {
  const open = [{ id: 'ed', type: 'editor' }, { id: 'sh', type: 'shell' }];
  const merged = setup({ choice: 'merge', asks: [true], merge: [{ ok: true }], open: [...open], closeAnswers: [true, true] });
  await merged.actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(merged.log), ['choose', 'ask', 'confirmClose ed', 'confirmClose sh',
    'merge /p /p.worktrees/feat-x', 'close ed,sh', 'refresh /p']);

  const removed = setup({ choice: 'delete', asks: [true], remove: [{ ok: true }], open: [...open], closeAnswers: [true, true] });
  await removed.actions.openMenu(WT, '/p', ANCHOR);
  assert.deepStrictEqual(steps(removed.log), ['choose', 'ask', 'confirmClose ed', 'confirmClose sh',
    'remove /p /p.worktrees/feat-x delete', 'close ed,sh', 'refresh /p']);
});

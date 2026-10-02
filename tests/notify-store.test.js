// renderer/notify.js: preferenza delle notifiche e voci da mandare al main (piano 38)
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createStorage } = require('./fake-dom');
const Notify = require('../renderer/notify');

ok('notify store: accese di default', () => {
  assert.strictEqual(Notify.createNotifyStore(createStorage()).get(), true);
});

ok('notify store: la scelta sopravvive a un riavvio', () => {
  const storage = createStorage();
  const s = Notify.createNotifyStore(storage);
  assert.strictEqual(s.toggle(), false);
  assert.strictEqual(Notify.createNotifyStore(storage).get(), false);
  assert.strictEqual(Notify.createNotifyStore(storage).toggle(), true);
  assert.strictEqual(Notify.createNotifyStore(storage).get(), true);
});

ok('notify store: un valore salvato strano vale acceso', () => {
  for (const bad of ['', 'forse', '2', 'null']) {
    assert.strictEqual(Notify.createNotifyStore(createStorage({ [Notify.STORAGE_KEY]: bad })).get(), true, bad);
  }
});

ok('notify store: localStorage che lancia non rompe niente', () => {
  const broken = { getItem: () => { throw new Error('bloccato'); }, setItem: () => { throw new Error('bloccato'); } };
  const s = Notify.createNotifyStore(broken);
  assert.strictEqual(s.get(), true);
  assert.strictEqual(s.toggle(), false, 'in memoria la scelta vale lo stesso');
});

ok('notify item: nome, tipo leggibile e percorso corto della scheda', () => {
  const tab = { id: 't1', type: 'claude', name: 'refactor login', cwd: '/Users/me/progetto' };
  const item = Notify.notifyItem(tab, { typeLabels: { claude: 'Claude' }, shortPath: (p) => p.replace('/Users/me', '~') });
  assert.deepStrictEqual(item, { id: 't1', name: 'refactor login', typeLabel: 'Claude', where: '~/progetto' });
});

ok('notify item: tipo sconosciuto e cwd mancante non rompono', () => {
  const item = Notify.notifyItem({ id: 't1', type: 'nuovo' }, { typeLabels: {}, shortPath: () => '' });
  assert.deepStrictEqual(item, { id: 't1', name: '', typeLabel: 'nuovo', where: '' });
});

ok('notify badge: conta le schede accese', () => {
  const tabs = new Map([['a', { needsAttention: true }], ['b', { needsAttention: false }], ['c', { needsAttention: true }], ['d', {}]]);
  assert.strictEqual(Notify.attentionCount(tabs.values()), 2);
  assert.strictEqual(Notify.attentionCount([]), 0);
});

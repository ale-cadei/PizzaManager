// «Dove» della nuova sessione con i server scritti a mano (docs/plans/96):
// gruppi del select e testo di «Altro server…» controllato dal main.
const assert = require('node:assert');
const { test } = require('node:test');
const vm = require('vm');
const { loadPage } = require('./renderer-page');

function page(checkSshTarget) {
  const p = loadPage({ aisess: { checkSshTarget } });
  return (name) => vm.runInContext(name, p.ctx);
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test('envSelectGroups: SSH di config, poi i recenti scritti a mano, poi WSL', () => {
  const groups = page()('envSelectGroups')({ ssh: ['nas'], wsl: ['Debian'], recent: ['ale@b:2222'] }, 'local');
  assert.deepStrictEqual(plain(groups), [
    { label: 'SSH', items: [{ value: 'ssh:nas', text: 'nas' }] },
    { label: 'Usati di recente', items: [{ value: 'ssh:ale@b:2222', text: 'ale@b:2222' }] },
    { label: 'WSL', items: [{ value: 'wsl:Debian', text: 'Debian' }] },
  ]);
  assert.deepStrictEqual(plain(page()('envSelectGroups')(null, 'local')), []);
});

test('envSelectGroups: il server richiesto che non è fra le opzioni entra nei recenti', () => {
  const fn = page()('envSelectGroups');
  const groups = fn({ ssh: ['nas'], wsl: [], recent: ['root@c'] }, 'ssh:ale@b:2222');
  assert.deepStrictEqual(plain(groups[1].items.map((i) => i.value)), ['ssh:ale@b:2222', 'ssh:root@c']);
  // Un alias di config o un recente non si ripetono
  assert.strictEqual(fn({ ssh: ['nas'], wsl: [], recent: [] }, 'ssh:nas').length, 1);
  assert.deepStrictEqual(plain(fn({ ssh: [], wsl: [], recent: ['root@c'] }, 'ssh:root@c')[0].items.length), 1);
});

test('resolveNewEnv: le voci del select passano, «Altro server…» chiede al main', async () => {
  const asked = [];
  const fn = page(async (text) => {
    asked.push(text);
    return text === 'ale@srv:22' ? { ok: true, env: 'ssh:ale@srv' } : { ok: false, error: 'Scrivi il server come host, utente@host o utente@host:porta.' };
  });
  const resolve = fn('resolveNewEnv');
  const SSH_NEW = fn('SSH_NEW_ENV');
  assert.deepStrictEqual(plain(await resolve('ssh:nas', 'ignorato')), { env: 'ssh:nas' });
  assert.deepStrictEqual(asked, []);
  assert.deepStrictEqual(plain(await resolve(SSH_NEW, 'ale@srv:22')), { env: 'ssh:ale@srv' });
  const bad = await resolve(SSH_NEW, '-oProxyCommand=sh');
  assert.match(bad.error, /utente@host/);
  assert.strictEqual(bad.env, undefined);
});

test('resolveNewEnv: main che non risponde → errore nel modal, niente sessione', async () => {
  const orig = console.warn;
  console.warn = () => {};
  try {
    const fn = page(async () => { throw new Error('ipc giù'); });
    const r = await fn('resolveNewEnv')(fn('SSH_NEW_ENV'), 'nas');
    assert.match(r.error, /ipc giù/);
    assert.strictEqual(r.env, undefined);
  } finally {
    console.warn = orig;
  }
});

test('saveNewSshHost: il main salva e dà la chiave, o il perché no', async () => {
  const calls = [];
  const p = loadPage({ aisess: { saveSshHost: async (text, alias) => {
    calls.push([text, alias]);
    return alias === 'dup' ? { ok: false, error: '«dup» c\'è già in ~/.ssh/config.' } : { ok: true, env: `ssh:${alias}` };
  } } });
  const save = vm.runInContext('saveNewSshHost', p.ctx);
  assert.deepStrictEqual(plain(await save('ale@srv', 'srv')), { env: 'ssh:srv' });
  assert.match((await save('ale@srv', 'dup')).error, /già/);
  assert.deepStrictEqual(calls, [['ale@srv', 'srv'], ['ale@srv', 'dup']]);
});

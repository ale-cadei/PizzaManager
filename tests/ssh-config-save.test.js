// «Salva» di un server scritto a mano in ~/.ssh/config (docs/plans/96).
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { addSshHost, createSshConfigSaver } = require('../lib/ssh-config-save');

const BLOCK = [
  '# Aggiunto da PizzaManager',
  'Host srv',
  '    HostName 10.0.0.5',
  '    User ale',
  '    Port 2222',
];

test('addSshHost: config vuoto → solo il blocco', () => {
  assert.strictEqual(addSshHost('', { alias: 'srv', target: 'ale@10.0.0.5:2222' }), `${BLOCK.join('\n')}\n`);
  assert.strictEqual(addSshHost('', { alias: 'nas', target: 'nas.lan' }),
    '# Aggiunto da PizzaManager\nHost nas\n    HostName nas.lan\n');
});

test('addSshHost: in fondo con una riga vuota, le righe che ci sono restano uguali', () => {
  const before = 'Host pi\n  HostName 10.0.0.9'; // senza a capo finale
  assert.strictEqual(addSshHost(before, { alias: 'srv', target: 'ale@10.0.0.5:2222' }),
    `Host pi\n  HostName 10.0.0.9\n\n${BLOCK.join('\n')}\n`);
});

test('addSshHost: prima del primo Host con wildcard o Match, coi commenti che lo precedono', () => {
  const before = 'Host pi\n  HostName 10.0.0.9\n\n# per tutti\nHost *\n  User root\n';
  assert.strictEqual(addSshHost(before, { alias: 'srv', target: 'ale@10.0.0.5:2222' }),
    `Host pi\n  HostName 10.0.0.9\n\n${BLOCK.join('\n')}\n\n# per tutti\nHost *\n  User root\n`);
  const match = 'Match host x\n  User y\n';
  assert.ok(addSshHost(match, { alias: 'nas', target: 'nas' }).endsWith('\nMatch host x\n  User y\n'));
});

test('addSshHost: a capo di Windows se il file li usa', () => {
  const out = addSshHost('Host pi\r\n  HostName p\r\n', { alias: 'srv', target: 'ale@10.0.0.5:2222' });
  assert.strictEqual(out, `Host pi\r\n  HostName p\r\n\r\n${BLOCK.join('\r\n')}\r\n`);
});

test('addSshHost: nome o server non validi, nome già presente → errore', () => {
  for (const alias of ['', '-oProxyCommand=sh', 'a b', 'web*', 'x\nHost y']) {
    assert.throws(() => addSshHost('', { alias, target: 'nas' }), /nome/i, JSON.stringify(alias));
  }
  assert.throws(() => addSshHost('', { alias: 'ok', target: '-oProxyCommand=sh' }), /server/i);
  assert.throws(() => addSshHost('Host a srv b\n', { alias: 'srv', target: 'nas' }), /già/);
});

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-sshcfg-'));
}

test('saver: crea ~/.ssh e config, poi aggiunge', () => {
  const home = tmpHome();
  const saver = createSshConfigSaver({ home });
  saver.save({ alias: 'srv', target: 'ale@10.0.0.5:2222' });
  saver.save({ alias: 'nas', target: 'nas.lan' });
  const text = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8');
  assert.match(text, /^# Aggiunto da PizzaManager\nHost srv\n[\s\S]*\n\n# Aggiunto da PizzaManager\nHost nas\n    HostName nas.lan\n$/);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(path.join(home, '.ssh')).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(path.join(home, '.ssh', 'config')).mode & 0o777, 0o600);
  }
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.ssh')), ['config']);
});

test('saver: un config che c\'è tiene i suoi permessi; un link resta un link', { skip: process.platform === 'win32' }, () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.mkdirSync(path.join(home, 'dotfiles'));
  const real = path.join(home, 'dotfiles', 'ssh_config');
  fs.writeFileSync(real, 'Host pi\n', { mode: 0o644 });
  fs.chmodSync(real, 0o644);
  fs.symlinkSync(real, path.join(home, '.ssh', 'config'));
  createSshConfigSaver({ home }).save({ alias: 'srv', target: 'srv.lan' });
  assert.ok(fs.lstatSync(path.join(home, '.ssh', 'config')).isSymbolicLink());
  assert.match(fs.readFileSync(real, 'utf8'), /^Host pi\n\n# Aggiunto da PizzaManager\nHost srv\n/);
  assert.strictEqual(fs.statSync(real).mode & 0o777, 0o644);
  assert.deepStrictEqual(fs.readdirSync(path.join(home, 'dotfiles')), ['ssh_config']);
});

test('saver: nome già presente → il file non cambia', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'config'), 'Host srv\n');
  assert.throws(() => createSshConfigSaver({ home }).save({ alias: 'srv', target: 'x' }), /già/);
  assert.strictEqual(fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8'), 'Host srv\n');
});

test('ipc save-ssh-host: nome di default l\'host, doppione anche negli Include, errori del disco detti', async () => {
  const { registerRemoteEnvHandlers } = require('../app/remote-envs');
  const saved = [];
  let fail = null;
  const lists = [];
  const handlers = {};
  registerRemoteEnvHandlers({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    hosts: { list: async (o) => { lists.push(o); return { ssh: ['nas', 'incluso'], wsl: [] }; } },
    saver: { save: (o) => { if (fail) throw fail; saved.push(o); } },
  });
  const save = (text, alias) => handlers['save-ssh-host']({}, { text, alias });
  assert.deepStrictEqual(await save(' ale@10.0.0.5:2222 ', ''), { ok: true, env: 'ssh:10.0.0.5' });
  assert.deepStrictEqual(await save('ale@srv:22', ' lavoro '), { ok: true, env: 'ssh:lavoro' });
  assert.deepStrictEqual(saved, [{ alias: '10.0.0.5', target: 'ale@10.0.0.5:2222' }, { alias: 'lavoro', target: 'ale@srv' }]);
  // La lista si rilegge dopo il salvataggio: il select vede subito il nome nuovo
  assert.ok(lists.every((o) => o.fresh === true) && lists.length === 4, JSON.stringify(lists));
  const r1 = await save('ale@x', 'incluso');
  assert.strictEqual(r1.ok, false);
  assert.match(r1.error, /già/);
  assert.match((await save('-oProxyCommand=sh', 'a')).error, /utente@host/);
  assert.match((await save('ale@x', '-x')).error, /nome/i);
  const orig = console.error;
  console.error = () => {};
  try {
    fail = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const r = await save('ale@x', 'altro');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /EACCES/);
  } finally {
    console.error = orig;
  }
  assert.strictEqual(saved.length, 2);
});

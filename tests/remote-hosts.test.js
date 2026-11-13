const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test } = require('node:test');

const { createRemoteHosts } = require('../lib/remote-hosts');

function fakeHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-hosts-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return home;
}

test('remote-hosts: nessun ~/.ssh/config → lista vuota, senza errori', async () => {
  const r = await createRemoteHosts({ home: fakeHome({}), platform: 'linux' }).list();
  assert.deepStrictEqual(r, { ssh: [], wsl: [] });
});

test('remote-hosts: Include relativi, con glob e ~, senza doppioni', async () => {
  const home = fakeHome({
    '.ssh/config': 'Include config.d/*.conf\nInclude ~/altro\nHost nas\n',
    '.ssh/config.d/a.conf': 'Host web\nHost nas\n',
    '.ssh/config.d/b.conf': 'Host db\n',
    '.ssh/config.d/ignorato.txt': 'Host no\n',
    altro: 'Host pi\n',
  });
  const r = await createRemoteHosts({ home, platform: 'linux' }).list();
  assert.deepStrictEqual(r.ssh, ['nas', 'web', 'db', 'pi']);
});

test('remote-hosts: un Include che include se stesso si ferma', async () => {
  const home = fakeHome({ '.ssh/config': 'Include config\nHost x\n' });
  assert.deepStrictEqual((await createRemoteHosts({ home, platform: 'linux' }).list()).ssh, ['x']);
});

test('remote-hosts: wsl.exe solo su Windows; un errore dà lista vuota', async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, ...args]); return Buffer.from('﻿Debian\r\n', 'utf16le'); };
  const home = fakeHome({});
  assert.deepStrictEqual((await createRemoteHosts({ home, platform: 'linux', run }).list()).wsl, []);
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual((await createRemoteHosts({ home, platform: 'win32', run }).list()).wsl, ['Debian']);
  assert.deepStrictEqual(calls[0], ['wsl.exe', '-l', '-q']);
  const failing = async () => { throw new Error('non installato'); };
  assert.deepStrictEqual((await createRemoteHosts({ home, platform: 'win32', run: failing }).list()).wsl, []);
});

test('remote-hosts: cache di 30 s, fresh la salta', async () => {
  const home = fakeHome({ '.ssh/config': 'Host a\n' });
  let t = 0;
  const hosts = createRemoteHosts({ home, platform: 'linux', now: () => t });
  assert.deepStrictEqual((await hosts.list()).ssh, ['a']);
  fs.writeFileSync(path.join(home, '.ssh/config'), 'Host b\n');
  t = 1000;
  assert.deepStrictEqual((await hosts.list()).ssh, ['a']);
  assert.deepStrictEqual((await hosts.list({ fresh: true })).ssh, ['b']);
});

test('list-remote-envs: passa fresh solo se true; un errore dà liste vuote', async () => {
  const { registerRemoteEnvHandlers } = require('../app/remote-envs');
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const calls = [];
  registerRemoteEnvHandlers(ipcMain, { hosts: { list: async (o) => { calls.push(o); return { ssh: ['nas'], wsl: [] }; } } });
  assert.deepStrictEqual(await handlers['list-remote-envs']({}, { fresh: 'si' }), { ssh: ['nas'], wsl: [] });
  await handlers['list-remote-envs']({}, { fresh: true });
  await handlers['list-remote-envs']({});
  assert.deepStrictEqual(calls, [{ fresh: false }, { fresh: true }, { fresh: false }]);

  const failing = {};
  const orig = console.error;
  console.error = () => {};
  try {
    registerRemoteEnvHandlers({ handle: (ch, fn) => { failing[ch] = fn; } }, { hosts: { list: async () => { throw new Error('x'); } } });
    assert.deepStrictEqual(await failing['list-remote-envs']({}), { ssh: [], wsl: [] });
  } finally {
    console.error = orig;
  }
});

const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { runGit } = require('../lib/git-run');
const { resolveBinary } = require('../lib/binaries');

ok('runGit: input arriva sullo stdin di git', async (t) => {
  if (!resolveBinary('git').path) return t.skip('git non installato su questa macchina');
  // Senza input git resterebbe ad aspettare: il timeout fa fallire, non appendere
  const out = await runGit(['hash-object', '--stdin'], { cwd: os.tmpdir(), input: 'x', timeout: 5000 });
  assert.strictEqual(out.trim(), 'c1b0730e0133447badcfd47fd144e254807b06e1');
});

ok('runGit: un git che esce senza leggere lo stdin non fa cadere il processo', async (t) => {
  if (!resolveBinary('git').path) return t.skip('git non installato su questa macchina');
  // Fuori da un repository check-ignore esce con 128 prima di leggere: EPIPE sullo stdin
  await assert.rejects(runGit(['check-ignore', '-z', '--stdin'], { cwd: '/', input: 'a\0'.repeat(100000), timeout: 5000 }));
});

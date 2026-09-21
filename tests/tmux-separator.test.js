const assert = require('node:assert');
const { test: ok } = require('node:test');
const t = require('../lib/tmux');
ok('tmux: il separatore dei campi è stampabile, perché tmux ≤ 3.3 sostituisce i caratteri di controllo con _', () => {
  assert.ok(/^[\x20-\x7e]+$/.test(t.FIELD_SEP), JSON.stringify(t.FIELD_SEP));
  // Cio' che tmux 3.3a farebbe a una riga con un separatore non stampabile
  const sanitized = ['ais-shell-a', '1', '0', 'shell'].join(String.fromCharCode(0x1f)).replace(/[\x00-\x1f]/g, '_');
  assert.strictEqual(t.parseSessionList(sanitized).length, 0, 'premessa del test: con 0x1f la riga non si spezzava');
  const line = ['ais-shell-a', '1', '0', 'shell', '/tmp/x', 'etichetta'].join(t.FIELD_SEP);
  const [s] = t.parseSessionList(line);
  assert.strictEqual(s.type, 'shell'); assert.strictEqual(s.cwd, '/tmp/x'); assert.strictEqual(s.label, 'etichetta');
});

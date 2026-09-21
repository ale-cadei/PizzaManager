const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Shift+Invio nel terminale: le TUI di claude/codex/opencode vogliono un
   "a capo" senza inviare il prompt. xterm.js manderebbe lo stesso \r di
   Invio: il modulo lo trasforma nella sequenza Meta+Invio (ESC CR), che
   tutte e tre leggono come newline e che tmux inoltra intatta. */
const TermNewline = require('../renderer/term-newline');

const keydown = (over = {}) => ({ type: 'keydown', key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...over });

ok('newline: Shift+Invio produce ESC CR', () => {
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true })), '\x1b\r');
});

ok('newline: Invio semplice e altre combinazioni restano a xterm', () => {
  assert.strictEqual(TermNewline.newlineSequence(keydown()), null);
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true, ctrlKey: true })), null);
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true, metaKey: true })), null);
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true, altKey: true })), null);
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true, key: 'a' })), null);
  assert.strictEqual(TermNewline.newlineSequence(keydown({ shiftKey: true, type: 'keyup' })), null);
  assert.strictEqual(TermNewline.newlineSequence(null), null);
});

ok('newline: il gestore scrive la sequenza nel terminale e ferma xterm e il browser', () => {
  const sent = [];
  const term = { input: (data, isUser) => sent.push([data, isUser]) };
  const e = keydown({ shiftKey: true, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

  const handled = TermNewline.keyHandler(term)(e);

  assert.strictEqual(handled, false, 'false ferma la gestione interna di xterm');
  assert.deepStrictEqual(sent, [['\x1b\r', true]]);
  assert.ok(e.prevented && e.stopped, 'senza preventDefault la textarea di xterm riceverebbe un a capo suo');
});

ok('newline: il gestore lascia passare tutto il resto senza toccare il terminale', () => {
  const sent = [];
  const term = { input: (data) => sent.push(data) };
  assert.strictEqual(TermNewline.keyHandler(term)(keydown()), true);
  assert.deepStrictEqual(sent, []);
});

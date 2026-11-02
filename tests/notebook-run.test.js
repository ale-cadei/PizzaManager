const assert = require('node:assert');
const { test: ok } = require('node:test');
const Run = require('../renderer/notebook-run');

/* L'esecuzione di una cella vista dal renderer (renderer/notebook-run.js,
   docs/plans/79): gli eventi del ponte diventano gli output della cella. */

const stream = (text, name = 'stdout') => ({ output_type: 'stream', name, text });
const result = (v) => ({ output_type: 'execute_result', data: { 'text/plain': v }, metadata: {}, execution_count: 1 });

const play = (...events) => events.reduce(Run.applyEvent, Run.startRun());

ok('notebook-run: una corsa nuova è vuota, senza numero, in corso', () => {
  assert.deepStrictEqual(Run.startRun(), { outputs: [], clearPending: false, count: null, done: false, status: null });
});

ok('notebook-run: started dà il numero, done lo conferma e chiude', () => {
  const s = play({ ev: 'started', count: 4 }, { ev: 'done', status: 'ok', count: 4 });
  assert.strictEqual(s.count, 4);
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.status, 'ok');
});

ok('notebook-run: done senza numero (annullata) lascia quello che c era', () => {
  assert.strictEqual(play({ ev: 'started', count: 2 }, { ev: 'done', status: 'dead', count: null }).count, 2);
  assert.strictEqual(play({ ev: 'done', status: 'aborted', count: null }).count, null);
});

ok('notebook-run: stream consecutivi con lo stesso nome si uniscono, con nomi diversi no', () => {
  const s = play(
    { ev: 'output', output: stream('a\n') }, { ev: 'output', output: stream('b') },
    { ev: 'output', output: stream('e\n', 'stderr') }, { ev: 'output', output: stream('c\n') },
    { ev: 'output', output: result('3') },
  );
  assert.deepStrictEqual(s.outputs, [stream('a\nb'), stream('e\n', 'stderr'), stream('c\n'), result('3')]);
});

ok('notebook-run: clear senza wait svuota subito; con wait al primo output dopo', () => {
  const now = play({ ev: 'output', output: stream('x\n') }, { ev: 'clear', wait: false });
  assert.deepStrictEqual(now.outputs, []);
  const waiting = play({ ev: 'output', output: stream('x\n') }, { ev: 'clear', wait: true });
  assert.deepStrictEqual(waiting.outputs, [stream('x\n')]);
  assert.strictEqual(waiting.clearPending, true);
  const after = Run.applyEvent(waiting, { ev: 'output', output: stream('y\n') });
  assert.deepStrictEqual(after.outputs, [stream('y\n')]);
  assert.strictEqual(after.clearPending, false);
});

ok('notebook-run: eventi sconosciuti o output rotti non cambiano niente', () => {
  const s = play({ ev: 'output', output: stream('a') });
  assert.strictEqual(Run.applyEvent(s, { ev: 'boh' }), s);
  assert.strictEqual(Run.applyEvent(s, { ev: 'output', output: null }), s);
  assert.strictEqual(Run.applyEvent(s, { ev: 'output', output: { output_type: 7 } }), s);
});

ok('notebook-run: applyEvent non tocca lo stato di prima', () => {
  const before = play({ ev: 'output', output: stream('a') });
  const copy = JSON.parse(JSON.stringify(before));
  Run.applyEvent(before, { ev: 'output', output: stream('b') });
  Run.applyEvent(before, { ev: 'clear', wait: false });
  assert.deepStrictEqual(before, copy);
});

ok('notebook-run: toFileOutputs scrive le righe come nbformat', () => {
  const outs = Run.toFileOutputs([
    stream('a\nb\n'),
    { output_type: 'display_data', data: { 'text/plain': 'x\ny', 'text/html': '<b>\n</b>', 'image/png': 'AAA\nBBB', 'application/json': { a: 1 }, 'image/svg+xml': '<svg>\n</svg>' }, metadata: {} },
    { output_type: 'error', ename: 'E', evalue: 'v', traceback: ['l1', 'l2'] },
    stream(''),
  ]);
  assert.deepStrictEqual(outs[0], { output_type: 'stream', name: 'stdout', text: ['a\n', 'b\n'] });
  assert.deepStrictEqual(outs[1].data, {
    'text/plain': ['x\n', 'y'], 'text/html': ['<b>\n', '</b>'], 'image/png': 'AAA\nBBB',
    'application/json': { a: 1 }, 'image/svg+xml': ['<svg>\n', '</svg>'],
  });
  assert.deepStrictEqual(outs[2], { output_type: 'error', ename: 'E', evalue: 'v', traceback: ['l1', 'l2'] });
  assert.deepStrictEqual(outs[3].text, []);
});

ok('notebook-run: kernelNameOf legge kernelspec.name, altrimenti python3', () => {
  assert.strictEqual(Run.kernelNameOf({ metadata: { kernelspec: { name: 'ir' } } }), 'ir');
  for (const doc of [{}, null, { metadata: null }, { metadata: { kernelspec: { name: 3 } } }, { metadata: { kernelspec: { name: '' } } }]) {
    assert.strictEqual(Run.kernelNameOf(doc), 'python3');
  }
});

ok('notebook-run: missingMessage spiega cosa installare', () => {
  assert.match(Run.missingMessage({ missing: 'python' }), /Python/);
  assert.match(Run.missingMessage({ ev: 'missing', what: 'jupyter_client' }), /pip install .*ipykernel/);
  const k = Run.missingMessage({ ev: 'missing', what: 'kernel', kernel: 'ir', available: ['python3'] });
  assert.match(k, /ir/);
  assert.match(k, /python3/);
  assert.match(Run.missingMessage({ ev: 'missing', what: 'kernel', kernel: 'ir', available: [] }), /ipykernel/);
});

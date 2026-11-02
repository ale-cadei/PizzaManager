const assert = require('node:assert');
const { test: ok } = require('node:test');
const { fire } = require('./fake-dom');
const { settle, plain } = require('./editor-tab-setup');
const { NB, nbSetup } = require('./editor-notebook-setup');

/* Le celle girano in un kernel (renderer/editor-notebook-run-ui.js,
   docs/plans/79): il main è finto e gli eventi del ponte si mandano a mano. */

function runSetup(text, { start = async () => ({ ok: true, id: 'k1' }) } = {}) {
  const kernel = { emit: null, started: [], executed: [], sent: [] };
  const main = {
    onKernelEvent: (cb) => { kernel.emit = cb; },
    kernelStart: async (dir, name) => { kernel.started.push([dir, name]); return start(dir, name); },
    kernelExecute: async (id, run, code) => { kernel.executed.push([id, run, code]); return { ok: true }; },
    kernelInterrupt: async (id) => { kernel.sent.push(['interrupt', id]); return { ok: true }; },
    kernelRestart: async (id) => { kernel.sent.push(['restart', id]); return { ok: true }; },
    kernelShutdown: async (id) => { kernel.sent.push(['shutdown', id]); return { ok: true }; },
  };
  const s = nbSetup(text, main);
  s.fn('initEditorNotebookRun')();
  const ev = (event) => kernel.emit({ id: 'k1', ...event });
  const prompts = () => s.nodes().map((n) => {
    const input = n.children.find((c) => c.classes.has('nb-input'));
    return input ? input.children[0].textContent : null;
  });
  const outputs = () => s.nodes().map((n) => n.children.filter((c) => c.classes.has('nb-output')).length);
  const status = () => s.ui.notebook.querySelectorAll('.nb-kernel')[0];
  const button = (title) => s.ui.notebook.querySelectorAll('.nb-tool').find((b) => b.title.startsWith(title));
  return { ...s, kernel, ev, prompts, outputs, status, button };
}

const out = (text) => ({ output_type: 'stream', name: 'stdout', text });

ok('notebook esegui: Ctrl+Invio avvia il kernel nella cartella, svuota gli output e segna [*]', async () => {
  const s = runSetup(NB('print(1)', 'b'));
  s.key('Enter', { ctrlKey: true });
  assert.deepStrictEqual(s.json().cells[0].outputs, []);
  assert.deepStrictEqual(s.prompts(), ['[*]', '[2]']);
  assert.deepStrictEqual(s.outputs(), [0, 1]);
  await settle();
  assert.deepStrictEqual(s.kernel.started, [['/w', 'python3']]);
  assert.strictEqual(s.kernel.executed.length, 1);
  const [id, run, code] = s.kernel.executed[0];
  assert.deepStrictEqual([id, code], ['k1', 'print(1)']);
  assert.match(run, /^[\w-]+$/);
  assert.deepStrictEqual(s.selected(), ['0'], 'Ctrl+Invio resta sulla cella');
});

ok('notebook esegui: gli eventi diventano output nel JSON, scritti come nbformat, e il prompt [n]', async () => {
  const s = runSetup(NB('print(1)', 'b'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  const run = s.kernel.executed[0][1];
  s.ev({ ev: 'started', run, count: 7 });
  s.ev({ ev: 'output', run, output: out('a\n') });
  s.ev({ ev: 'output', run, output: out('b\n') });
  s.ev({ ev: 'output', run, output: { output_type: 'execute_result', data: { 'text/plain': '42' }, metadata: {}, execution_count: 7 } });
  s.ev({ ev: 'done', run, status: 'ok', count: 7 });
  const cell = s.json().cells[0];
  assert.strictEqual(cell.execution_count, 7);
  assert.deepStrictEqual(cell.outputs, [
    { output_type: 'stream', name: 'stdout', text: ['a\n', 'b\n'] },
    { output_type: 'execute_result', data: { 'text/plain': ['42'] }, metadata: {}, execution_count: 7 },
  ]);
  assert.deepStrictEqual(s.prompts(), ['[7]', '[2]']);
  assert.deepStrictEqual(s.outputs(), [2, 1]);
  assert.strictEqual(s.nodes()[0].children.at(-1).classes.has('nb-cell-tools'), true, 'gli output stanno prima della barra della cella');
});

ok('notebook esegui: gli output in arrivo si scrivono a gruppi, non uno a uno', async () => {
  const s = runSetup(NB('x'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  const run = s.kernel.executed[0][1];
  s.ev({ ev: 'started', run, count: 1 });
  const before = s.edits();
  for (let i = 0; i < 20; i += 1) s.ev({ ev: 'output', run, output: out(`${i}\n`) });
  assert.strictEqual(s.edits(), before, 'niente scrittura a ogni riga');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(s.edits(), before + 1);
  assert.strictEqual(s.json().cells[0].outputs[0].text.length, 20);
  assert.deepStrictEqual(s.prompts(), ['[*]'], 'ancora in corso');
});

ok('notebook esegui: Shift+Invio esegue e passa alla dopo; su una markdown passa e basta', async () => {
  const md = { cell_type: 'markdown', id: 'm', metadata: {}, source: ['# t'] };
  const s = runSetup(NB('a', md, 'c'));
  s.key('Enter', { shiftKey: true });
  assert.deepStrictEqual(s.selected(), ['1']);
  s.key('Enter', { shiftKey: true });
  assert.deepStrictEqual(s.selected(), ['2']);
  await settle();
  assert.deepStrictEqual(s.kernel.executed.map((e) => e[2]), ['a']);
  assert.deepStrictEqual(s.kernel.started.length, 1);
});

ok('notebook esegui: Ctrl+Invio nella cella in modifica esegue il testo appena scritto', async () => {
  const s = runSetup(NB('a'));
  s.key('Enter');
  s.cells[0].type('+1');
  s.cells[0].opts.onKey('run');
  assert.strictEqual(s.cells[0].disposed, true, 'si esce dalla modifica');
  await settle();
  assert.deepStrictEqual(s.kernel.executed.map((e) => e[2]), ['a+1']);
});

ok('notebook esegui: un kernel solo per notebook, «Esegui tutto» manda le celle di codice in ordine', async () => {
  const md = { cell_type: 'markdown', id: 'm', metadata: {}, source: ['t'] };
  const s = runSetup(NB('a', md, 'c'));
  fire(s.button('Esegui tutte'), 'click');
  assert.deepStrictEqual(s.prompts(), ['[*]', null, '[*]']);
  await settle();
  assert.strictEqual(s.kernel.started.length, 1);
  assert.deepStrictEqual(s.kernel.executed.map((e) => e[2]), ['a', 'c']);
});

ok('notebook esegui: il nome del kernel viene da kernelspec', async () => {
  const text = NB('a').replace('"language": "python"', '"language": "python",\n   "name": "ir"');
  const s = runSetup(text);
  s.key('Enter', { ctrlKey: true });
  await settle();
  assert.deepStrictEqual(s.kernel.started, [['/w', 'ir']]);
});

ok('notebook esegui: lo stato del kernel nella barra', async () => {
  const s = runSetup(NB('a'));
  assert.strictEqual(s.status().textContent, 'Kernel spento');
  s.key('Enter', { ctrlKey: true });
  assert.strictEqual(s.status().dataset.state, 'starting');
  await settle();
  s.ev({ ev: 'ready', kernel: 'python3', language: 'python', display: 'Python 3 (ipykernel)' });
  assert.strictEqual(s.status().textContent, 'Kernel pronto · Python 3 (ipykernel)');
  s.ev({ ev: 'status', state: 'busy' });
  assert.strictEqual(s.status().dataset.state, 'busy');
  s.ev({ ev: 'dead' });
  assert.match(s.status().textContent, /morto/);
});

ok('notebook esegui: senza Python lo dice la barra, il [*] se ne va, niente execute', async () => {
  const s = runSetup(NB('a'), { start: async () => ({ ok: false, missing: 'python', error: 'Python non trovato nel PATH' }) });
  s.key('Enter', { ctrlKey: true });
  await settle();
  assert.match(s.status().textContent, /Python non trovato/);
  assert.strictEqual(s.status().dataset.state, 'missing');
  assert.deepStrictEqual(s.prompts(), ['[ ]']);
  assert.strictEqual(s.kernel.executed.length, 0);
});

ok('notebook esegui: un kernel che manca → il messaggio con quelli installati', async () => {
  const s = runSetup(NB('a'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  s.ev({ ev: 'missing', what: 'kernel', kernel: 'python3', available: ['ir'] });
  s.ev({ ev: 'done', run: s.kernel.executed[0][1], status: 'dead', count: null });
  assert.match(s.status().textContent, /ir/);
  assert.deepStrictEqual(s.prompts(), ['[ ]']);
});

ok('notebook esegui: gli output vanno alla cella giusta anche se si è spostata', async () => {
  const s = runSetup(NB('a', 'b'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  const run = s.kernel.executed[0][1];
  s.key('a'); // una cella nuova sopra: la "a" ora è la seconda
  s.ev({ ev: 'output', run, output: out('ciao\n') });
  s.ev({ ev: 'done', run, status: 'ok', count: 1 });
  const cells = s.json().cells;
  assert.deepStrictEqual(cells[1].outputs, [{ output_type: 'stream', name: 'stdout', text: ['ciao\n'] }]);
  assert.deepStrictEqual(cells[0].outputs, []);
  assert.deepStrictEqual(s.prompts(), ['[ ]', '[1]', '[2]']);
});

ok('notebook esegui: senza id (nbformat 4.4) la cella si ritrova dal sorgente; eliminata, l output non va su un altra', async () => {
  const noIds = (text) => {
    const doc = JSON.parse(text);
    return `${JSON.stringify({ ...doc, nbformat_minor: 4, cells: doc.cells.map(({ id, ...c }) => c) }, null, 1)}\n`;
  };
  const s = runSetup(noIds(NB('a', 'b')));
  s.key('Enter', { ctrlKey: true });
  await settle();
  const run = s.kernel.executed[0][1];
  s.key('a'); // una cella nuova sopra: la "a" ora è la seconda
  s.ev({ ev: 'output', run, output: out('ciao\n') });
  s.ev({ ev: 'done', run, status: 'ok', count: 1 });
  assert.deepStrictEqual(s.json().cells[1].outputs, [{ output_type: 'stream', name: 'stdout', text: ['ciao\n'] }]);
  assert.deepStrictEqual(s.json().cells[0].outputs, []);

  const t = runSetup(noIds(NB('a', 'b')));
  t.key('Enter', { ctrlKey: true });
  await settle();
  const run2 = t.kernel.executed[0][1];
  t.key('d');
  t.key('d'); // la "a" sparisce: la "b" passa all indice 0
  t.ev({ ev: 'output', run: run2, output: out('perso\n') });
  t.ev({ ev: 'done', run: run2, status: 'ok', count: 1 });
  const cells = t.json().cells;
  assert.strictEqual(cells.length, 1);
  assert.deepStrictEqual(cells[0].outputs, [{ output_type: 'stream', name: 'stdout', text: ['o\n'] }], 'la "b" tiene i suoi');
  assert.strictEqual(cells[0].execution_count, 2);
});

ok('notebook esegui: la cella in modifica altrove resta aperta mentre arrivano gli output', async () => {
  const s = runSetup(NB('a', 'b'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  const run = s.kernel.executed[0][1];
  s.key('j');
  s.key('Enter');
  s.ev({ ev: 'output', run, output: out('x\n') });
  s.ev({ ev: 'done', run, status: 'ok', count: 1 });
  assert.strictEqual(s.cells[0].disposed, false);
  assert.strictEqual(s.fn('editorNotebookState')(s.tab).editing.index, 1);
  assert.deepStrictEqual(s.json().cells[0].outputs.length, 1);
});

ok('notebook esegui: interrompi e riavvia vanno al kernel; riavvia senza kernel ne avvia uno', async () => {
  const s = runSetup(NB('a'));
  fire(s.button('Riavvia'), 'click');
  await settle();
  assert.strictEqual(s.kernel.started.length, 1, 'senza kernel parte');
  fire(s.button('Interrompi'), 'click');
  fire(s.button('Riavvia'), 'click');
  await settle();
  assert.deepStrictEqual(plain(s.kernel.sent), [['interrupt', 'k1'], ['restart', 'k1']]);
  assert.strictEqual(s.kernel.started.length, 1);
});

ok('notebook esegui: il ponte che esce chiude le corse; la prossima riavvia il kernel', async () => {
  const s = runSetup(NB('a'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  s.ev({ ev: 'exit', code: 1, stderr: 'riga\nboom\n' });
  assert.deepStrictEqual(s.prompts(), ['[ ]']);
  assert.match(s.status().textContent, /boom/);
  s.key('Enter', { ctrlKey: true });
  await settle();
  assert.strictEqual(s.kernel.started.length, 2);
});

ok('notebook esegui: eventi di kernel ignoti o rotti non fanno niente', async () => {
  const s = runSetup(NB('a'));
  assert.doesNotThrow(() => {
    s.kernel.emit(null);
    s.kernel.emit({ id: 'k9', ev: 'ready' });
    s.kernel.emit({ id: 'k1', ev: 3 });
  });
  s.key('Enter', { ctrlKey: true });
  await settle();
  assert.doesNotThrow(() => s.ev({ ev: 'output', run: 'non-esiste', output: out('x') }));
  assert.deepStrictEqual(s.prompts(), ['[*]']);
});

ok('notebook esegui: chiudere il file o la scheda spegne il kernel', async () => {
  const s = runSetup(NB('a'));
  s.key('Enter', { ctrlKey: true });
  await settle();
  s.fn('dropEditorNotebook')(s.tab, 'a.ipynb');
  assert.deepStrictEqual(plain(s.kernel.sent), [['shutdown', 'k1']]);
  const t = runSetup(NB('a'));
  t.key('Enter', { ctrlKey: true });
  await settle();
  t.fn('disposeEditorTab')(t.tab);
  assert.deepStrictEqual(plain(t.kernel.sent), [['shutdown', 'k1']]);
});

ok('notebook esegui: il file chiuso mentre il kernel parte → il kernel si spegne appena arriva', async () => {
  let release;
  const s = runSetup(NB('a'), { start: () => new Promise((r) => { release = r; }) });
  s.key('Enter', { ctrlKey: true });
  s.fn('dropEditorNotebook')(s.tab, 'a.ipynb');
  release({ ok: true, id: 'k1' });
  await settle();
  assert.deepStrictEqual(plain(s.kernel.sent), [['shutdown', 'k1']]);
  assert.strictEqual(s.kernel.executed.length, 0);
});

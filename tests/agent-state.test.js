// renderer/agent-state.js: il segnale esatto degli hook decide barra e lampeggio (piano 46)
const assert = require('node:assert');
const { test } = require('node:test');
const { createAgentState, codexOscState } = require('../renderer/agent-state');

test('prima di ogni segnale la sessione non è esatta', () => {
  const s = createAgentState();
  assert.equal(s.isExact('a'), false);
  s.signal('a', 'ready', { watched: false });
  assert.equal(s.isExact('a'), true);
});

test('lavora e poi finisce in secondo piano: «ha finito»', () => {
  const s = createAgentState();
  assert.deepEqual(s.signal('a', 'running', { watched: false }), { running: true, attention: null, changed: true });
  assert.deepEqual(s.signal('a', 'waiting', { watched: false }), { running: false, attention: 'done', changed: true });
});

test('waiting senza un running dall ultima visita (avvio, --resume): niente', () => {
  const s = createAgentState();
  s.signal('a', 'ready', { watched: false });
  assert.equal(s.signal('a', 'waiting', { watched: false }).attention, null);
});

test('permesso: lampeggio rapido anche senza running prima', () => {
  const s = createAgentState();
  assert.equal(s.signal('a', 'permission', { watched: false }).attention, 'permission');
});

test('permesso concesso: torna a lavorare e il lampeggio si spegne', () => {
  const s = createAgentState();
  s.signal('a', 'permission', { watched: false });
  assert.deepEqual(s.signal('a', 'running', { watched: false }), { running: true, attention: null, changed: true });
});

test('scheda sotto gli occhi: niente lampeggio', () => {
  const s = createAgentState();
  s.signal('a', 'running', { watched: true });
  assert.equal(s.signal('a', 'waiting', { watched: true }).attention, null);
  assert.equal(s.signal('a', 'permission', { watched: true }).attention, null);
});

test('seen spegne e azzera: un waiting dopo non riaccende', () => {
  const s = createAgentState();
  s.signal('a', 'running', { watched: false });
  s.signal('a', 'waiting', { watched: false });
  s.seen('a');
  assert.equal(s.signal('a', 'waiting', { watched: false }).attention, null);
});

test('stesso stato due volte: changed false', () => {
  const s = createAgentState();
  s.signal('a', 'running', { watched: false });
  assert.equal(s.signal('a', 'running', { watched: false }).changed, false);
});

test('Codex: il testo dice se è un permesso o la fine del turno', () => {
  assert.equal(codexOscState('Approval requested: ls -la'), 'permission');
  assert.equal(codexOscState('Approval requested by tool'), 'permission');
  assert.equal(codexOscState('Codex wants to edit lib/a.js'), 'permission');
  assert.equal(codexOscState('Plan mode prompt: scegli'), 'permission');
  assert.equal(codexOscState('Ho finito, i test passano.'), 'waiting');
  assert.equal(codexOscState(''), 'waiting');
});

test('Codex: la barra non si tocca, il permesso sì', () => {
  const s = createAgentState();
  const r = s.signal('c', 'permission', { watched: false, codex: true });
  assert.equal(r.running, null);
  assert.equal(r.attention, 'permission');
});

test('Codex: waiting senza running esatto vale come fine turno', () => {
  const s = createAgentState();
  assert.equal(s.signal('c', 'waiting', { watched: false, codex: true }).attention, 'done');
});

/* Il permesso chiesto sotto gli occhi non lampeggia; ma se l'utente se ne va
   senza rispondere, Claude resta fermo e nessun hook arriverà più: lasciare
   la scheda deve riaccenderlo. «Ha finito» invece, visto, è letto. */
test('permesso visto e non risposto: lasciare la scheda lo riaccende', () => {
  const s = createAgentState();
  s.signal('a', 'running', { watched: true });
  assert.equal(s.signal('a', 'permission', { watched: true }).attention, null);
  assert.equal(s.left('a'), 'permission');
  assert.equal(s.left('a'), null, 'già acceso: niente da cambiare');
});

test('permesso visto, poi visitato e lasciato di nuovo: ancora pendente', () => {
  const s = createAgentState();
  s.signal('a', 'permission', { watched: false });
  s.seen('a');
  assert.equal(s.left('a'), 'permission');
});

test('permesso risposto o fine turno vista: lasciare non accende niente', () => {
  const s = createAgentState();
  s.signal('a', 'permission', { watched: true });
  s.signal('a', 'running', { watched: true });
  assert.equal(s.left('a'), null, 'concesso: torna a lavorare');
  s.signal('a', 'waiting', { watched: true });
  assert.equal(s.left('a'), null, '«ha finito» visto non si riaccende');
  s.signal('a', 'permission', { watched: true });
  s.signal('a', 'waiting', { watched: true });
  assert.equal(s.left('a'), null, 'negato: il turno si chiude con Stop');
  assert.equal(s.left('mai-vista'), null);
});

test('Codex: niente segnale dice «risposto», quindi lasciare non riaccende', () => {
  const s = createAgentState();
  s.signal('a', 'permission', { watched: true, codex: true });
  assert.equal(s.left('a'), null);
});

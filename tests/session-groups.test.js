const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Raggruppamento delle sessioni aperte nella sidebar: per tipo (default) o per
   progetto. Il modulo sta in renderer/ perché il renderer non ha require e non
   potrebbe importarlo da lib/; il wrapper UMD lo rende comunque testabile qui. */
const { groupSessions, relativeSubpath, shortPath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL } = require('../renderer/session-groups');

const byType = (sessions) => groupSessions(sessions, { mode: 'type', typeOrder: TYPE_ORDER, typeLabels: TYPE_LABELS });
const byProject = (sessions) => groupSessions(sessions, { mode: 'project' });
const shape = (groups) => groups.map((g) => [g.label, g.items.map((s) => s.id)]);

ok('gruppi per tipo: ordine fisso, etichette leggibili, tipi sconosciuti in coda', () => {
  const groups = byType([
    { id: 'a', type: 'claude' },
    { id: 'b', type: 'shell' },
    { id: 'c', type: 'futuro' },
    { id: 'd', type: 'claude' },
  ]);
  assert.deepStrictEqual(shape(groups), [
    ['Terminale', ['b']],
    ['Claude', ['a', 'd']],
    ['futuro', ['c']],
  ]);
  assert.deepStrictEqual(groups.map((g) => g.key), ['shell', 'claude', 'futuro']);
  assert.ok(groups.every((g) => g.kind === 'type'));
});

ok('gruppi per tipo: i tipi senza sessioni aperte non producono gruppi vuoti', () => {
  assert.deepStrictEqual(shape(byType([{ id: 'a', type: 'codex' }])), [['Codex', ['a']]]);
});

ok('gruppi per progetto: ordine alfabetico, etichetta = nome della cartella', () => {
  const groups = byProject([
    { id: 'a', type: 'claude', projectRoot: '/home/tizio/zulu' },
    { id: 'b', type: 'shell', projectRoot: '/home/tizio/alfa' },
    { id: 'c', type: 'codex', projectRoot: '/home/tizio/zulu' },
  ]);
  assert.deepStrictEqual(shape(groups), [['alfa', ['b']], ['zulu', ['a', 'c']]]);
  assert.deepStrictEqual(groups.map((g) => g.title), ['/home/tizio/alfa', '/home/tizio/zulu'],
    'il title deve restare il path completo');
  assert.ok(groups.every((g) => g.kind === 'project'));
});

ok('gruppi per progetto: due cartelle omonime si disambiguano entrambe', () => {
  const groups = byProject([
    { id: 'a', type: 'shell', projectRoot: '/lavoro/cliente/app' },
    { id: 'b', type: 'shell', projectRoot: '/personale/app' },
    { id: 'c', type: 'shell', projectRoot: '/personale/blog' },
  ]);
  assert.deepStrictEqual(shape(groups), [
    ['blog', ['c']],
    ['cliente/app', ['a']],
    ['personale/app', ['b']],
  ]);
});

ok('gruppi per progetto: le sessioni senza directory finiscono in fondo', () => {
  const groups = byProject([
    { id: 'a', type: 'shell', projectRoot: null },
    { id: 'b', type: 'shell', projectRoot: '/home/tizio/alfa' },
  ]);
  assert.deepStrictEqual(shape(groups), [['alfa', ['b']], [NO_PROJECT_LABEL, ['a']]]);
  assert.strictEqual(groups[1].key, '');
});

ok('gruppi: gli input non vengono mutati e i gruppi sono strutture nuove', () => {
  const sessions = [{ id: 'a', type: 'shell', projectRoot: '/x' }];
  const copy = JSON.parse(JSON.stringify(sessions));
  const groups = byProject(sessions);
  groups[0].items.push({ id: 'intruso', type: 'shell' });
  assert.deepStrictEqual(sessions, copy, "l'array di partenza è stato toccato");
});

ok('gruppi: senza modalità si raggruppa per tipo, e un input non valido non lancia', () => {
  assert.deepStrictEqual(shape(groupSessions([{ id: 'a', type: 'shell' }], { typeLabels: TYPE_LABELS })), [['Terminale', ['a']]]);
  assert.deepStrictEqual(groupSessions(null), []);
  assert.deepStrictEqual(groupSessions(undefined, { mode: 'project' }), []);
});

ok('sottopath: si mostra solo quando la sessione non sta nella radice del progetto', () => {
  assert.strictEqual(relativeSubpath('/repo/src/parti', '/repo'), 'src/parti');
  assert.strictEqual(relativeSubpath('/repo', '/repo'), '');
  assert.strictEqual(relativeSubpath('/altro/posto', '/repo'), '', 'una cwd fuori dalla radice non produce un path finto');
  assert.strictEqual(relativeSubpath('/repo-bis/src', '/repo'), '', 'il confronto non deve fermarsi al prefisso di stringa');
  assert.strictEqual(relativeSubpath('', '/repo'), '');
  assert.strictEqual(relativeSubpath('/repo/src', null), '');
});

/* shortPath sta qui e non nel renderer perché lo usano in due: la sidebar e i
   chip delle directory recenti. Una sola definizione, una sola verifica. */
ok('path corto: solo cartella genitore e cartella corrente', () => {
  assert.strictEqual(shortPath('/home/tizio/progetto/backend'), 'progetto/backend');
  assert.strictEqual(shortPath('/home'), 'home');
  assert.strictEqual(shortPath('/'), '/');
  assert.strictEqual(shortPath(''), '');
  assert.strictEqual(shortPath(null), '');
});

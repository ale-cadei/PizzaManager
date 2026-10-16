# Commenti sulle righe dell'editor — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nella scheda editor si commenta qualsiasi riga o selezione, dal «+» nel margine o dal menu del tasto destro. Il commento si scrive in un riquadro sotto le righe e resta lì, con lo sfondo sulle righe commentate. Il riquadro segue le sue righe quando il testo sopra cambia. In testa alla scheda compare «N commenti · Copia prompt · Svuota». «Copia prompt» mette negli appunti un prompt nel formato del pannello modifiche, con l'intestazione «Correggi questi punti del codice:», e poi chiede se svuotare.

**Architecture:** `renderer/review-notes.js` prende l'intestazione come opzione di `formatPrompt`. `renderer/editor-notes.js` (UMD, puro) tiene lo stato dei commenti di una scheda, immutabile, e lo trasforma in note di review su righe di contesto. `renderer/editor-monaco.js` dà all'host i segni sulle righe (decorazioni del model che Monaco sposta col testo), le zone sotto le righe (`changeViewZones`, rimesse a ogni cambio di model perché `setModel` butta la vista), il «+» nel margine dei glifi e due voci nel menu. `renderer/editor-notes-ui.js` (script dell'app, dopo `editor-copy-ui.js`) disegna caselle, commenti salvati e la riga in testa, copia e chiede. `renderer/editor-tab.js` lo cabla e chiede conferma chiudendo un file o la scheda con commenti.

**Tech Stack:** Electron 33, Monaco 0.57 (`changeViewZones`, `ITextModel.deltaDecorations`/`getDecorationRange`, `addAction`, `onMouseDown`/`onMouseMove`), script classici del renderer nello scope globale, test con `node --test` e la pagina vera in un contesto vm (`tests/renderer-page.js`).

Spec: `docs/plans/65-editor-commenti.md`.

## Global Constraints

- **Ordine degli script:** `editor-notes.js` è un modulo UMD e va fra i moduli di `index.html`, subito dopo `review-notes.js` (che usa). `editor-notes-ui.js` è uno script dell'app e va subito dopo `editor-copy-ui.js`, anche in `RENDERER_APP_FILES` (`tests/renderer-source.js`): dopo `app-state.js` la pagina deve caricare esattamente quella lista (`tests/renderer-load.test.js`).
- **Scope condiviso:** `editor-notes-ui.js` usa `editorConfirm`, `showEditorMessage`, `errorText` di `editor-tab.js`, e `editor-tab.js` usa le sue funzioni (`openEditorNoteDraft`, `syncEditorNotes`, `dropEditorNotes`, `renameEditorNotes`, `editorNotesLoss`) e la sua `EditorNotes`. Va bene perché si toccano solo dentro le funzioni, mai al caricamento. Nessuna `const` nuova può avere il nome di una che c'è già (`noteEl`, `noteButton`, `EditorNotes`, `NOTE_ZONE_PX` sono liberi: verificato con `grep`).
- **Immutabilità:** `editor-notes.js` non modifica mai lo stato che riceve, ogni operazione ne dà uno nuovo (o lo stesso, se non cambia niente). La scheda lo sostituisce (`ed.notes = r.state`). Le strutture mutabili sono quelle dentro l'host di Monaco (come `docs` oggi) e `ed.noteViews`, che si rifà da capo a ogni disegno.
- **UI e sicurezza:** testo del commento, righe del file e nomi passano da `textContent`. Niente `innerHTML`, niente `onclick=` nell'HTML, la CSP non si tocca. Nessun dato nuovo lascia il renderer: il prompt va negli appunti con `window.aisess.clipboardWrite`, che c'è già.
- **Windows:** niente percorsi nuovi. I `rel` restano quelli della scheda, uniti con `/`.
- **Righe:** ogni file sotto 800. `editor-tab.js` parte da 703.
- **Test:** prima `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (il node di sistema è v12). La suite è `npm run test:unit` e deve restare verde. Prima del piano: 1645 test, 1644 passano, 1 skip. Gli array nati nel contesto vm si confrontano passando da `plain` (JSON).
- **Non lanciare l'app** dagli agenti: `npm start` si attacca alle sessioni tmux vere dell'utente. Lo smoke test è dell'utente, alla fine.
- **Commit:** messaggio in `/tmp/msg.txt`, poi `git commit --file=/tmp/msg.txt`, in un comando separato da qualsiasi `grep`. Formato `<tipo>: <cosa>` in italiano, il perché nel corpo, ultima riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scelte rispetto alla spec

- **Segni con `model.deltaDecorations`, non con `createDecorationsCollection`.** Una collezione è legata al model che l'editor ha davanti, e i commenti stanno anche sui file dietro. `ITextModel.deltaDecorations` (non deprecata, a differenza di quella dell'editor) più `getDecorationRange` danno i segni per file, come già fa `setGutter`.
- **Host con più metodi della spec:** oltre a `addZone`, `removeZone`, `trackLines` e `linesOf` ci sono `untrack(id)` (un commento tolto toglie lo sfondo), `lineText(rel, line)` (il testo citato nel prompt, senza copiare il file) e `resizeZone(id, px)` (Monaco vuole l'altezza in pixel, e il riquadro la sa solo dopo il disegno). `addZone(rel, afterLine, node, heightInPx)` ha l'altezza iniziale come quarto argomento, facoltativo. La zona segue la riga con un suo segno interno.
- **`toReviewNotes(notes, textOf)`:** il secondo argomento dà il testo di una riga (`textOf(rel, line)`), non le righe di un id. Lo stato tiene già `from` e `to` aggiornati da `move`.
- **Funzioni in più nel modello:** `find`, `dropFile`, `renameFile`, `count`, `labelOf`, `countLabel`, `promptFor`. Servono a chiudere e rinominare file e a scrivere le etichette senza logica nella UI.
- **«Modifica» ed «Elimina» sono ✎ e ✕**, coi `title` «Modifica il commento» ed «Elimina il commento», come i commenti del pannello modifiche, di cui si riusano le classi (`changes-comment…`) e quindi l'aspetto.
- **«Svuota» nella riga in testa non chiede**, come «Svuota» del pannello modifiche. La domanda c'è dopo «Copia prompt», come dice la spec.
- **Anche chiudere la scheda chiede**, se ha commenti. La spec dice solo «spariscono chiudendo la scheda», ma la stessa domanda c'è già per i file con modifiche (`confirmEditorClose`), e perdere 20 commenti con un click sulla ✕ della card è peggio che perdere quelli di un file.
- **Test della UI in `tests/editor-notes-ui.test.js`**, non in `tests/editor-tab.test.js`: lì ci sono i test della chiusura (Task 5), come chiede la spec. Quelli della riga in testa e della copia sono dieci e hanno un loro `setup` con un document di fake-dom.
- **Il «+» compare su tutta la riga sotto il mouse** (testo, numeri, margini), ma il clic che commenta è solo quello nel margine dei glifi. Un clic nel testo deve restare un clic nel testo.

---

### Task 1: intestazione di `formatPrompt` e modello `renderer/editor-notes.js`

**Files:**
- Modify: `renderer/review-notes.js` (`formatPrompt`, riga 225)
- Modify: `tests/review-notes.test.js` (un test in fondo)
- Create: `renderer/editor-notes.js`
- Create: `tests/editor-notes.test.js`
- Modify: `renderer/index.html` (modulo dopo `review-notes.js`)

**Interfaces:**
- Consumes: `AisessReviewNotes` (`formatPrompt`, `linesLabel`, `MAX_BODY` 2000, `MAX_NOTES` 50, `MAX_LINES` 200).
- Produces:
  - `formatPrompt(notes, { header } = {})`: `header` di default è `'Review delle modifiche, correggi questi punti:'`, come oggi.
  - `window.AisessEditorNotes` / `module.exports` = `{ HEADER, empty, add, update, remove, clear, dropFile, renameFile, move, forFile, count, find, countLabel, labelOf, toReviewNotes, promptFor }`.
  - Stato: `{ notes: [{ id, rel, from, to, body, track }], seq }`. `id` è `n1`, `n2`… e non torna mai, neanche dopo `clear`. `track` è l'id del segno dell'host (o `null`), che il modello non guarda.
  - `add(state, { rel, from, to, body, track }) → { ok: true, state, note } | { ok: false, state, error }`. `update(state, id, body)` risponde allo stesso modo.
  - `remove`, `clear`, `dropFile(state, rel)`, `renameFile(state, from, to)`, `move(state, id, { from, to })` danno lo stato nuovo, o lo stesso se non cambia niente.
  - `forFile(state, rel)` dà i commenti del file in ordine di riga. `count(state, rel?)`, `find(state, id) → note | null`.
  - `labelOf({ from, to })` dà «Riga 12» o «Righe 12–14». `countLabel(n)` dà «1 commento» o «N commenti».
  - `toReviewNotes(notes, textOf)` dà le note di `formatPrompt`: `{ id, path: rel, body, lines: [{ side: 'new', no, kind: 'ctx', text }] }`. `promptFor(state, textOf)` è il prompt con `HEADER` = `'Correggi questi punti del codice:'`, oppure `''`.

- [ ] **Step 1: scrivere i test che falliscono**

In fondo a `tests/review-notes.test.js`:

```js
ok('review: il prompt prende un\'intestazione diversa, senza resta quella di sempre', () => {
  const notes = R.addNote([], R.anchorOf('lib/a.js', add(7, 'a')), 'Prima').notes;
  const header = 'Correggi questi punti del codice:';
  assert.deepStrictEqual(R.formatPrompt(notes, { header }).split('\n').slice(0, 3), [header, '', '1. lib/a.js:7']);
  assert.strictEqual(R.formatPrompt(notes).split('\n')[0], 'Review delle modifiche, correggi questi punti:');
  assert.strictEqual(R.formatPrompt([], { header }), '');
});
```

Creare `tests/editor-notes.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const N = require('../renderer/editor-notes');

/* I commenti della scheda editor (docs/plans/65): solo il modello. Dove
   stanno le righe adesso lo sa l'host di Monaco; qui l'ultimo numero visto. */

const put = (state, rel, from, to, body = 'x', track = null) => N.add(state, { rel, from, to, body, track });

ok('commenti editor: add dà un id nuovo e non tocca lo stato di prima', () => {
  const s0 = N.empty();
  const r = put(s0, 'lib/a.js', 3, 5, '  Qui manca un controllo.  ', 'm1');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.note, { id: 'n1', rel: 'lib/a.js', from: 3, to: 5, body: 'Qui manca un controllo.', track: 'm1' });
  assert.deepStrictEqual(r.state.notes, [r.note]);
  assert.deepStrictEqual(s0, { notes: [], seq: 0 });
  assert.strictEqual(put(r.state, 'lib/a.js', 9, 9).note.id, 'n2');
});

ok('commenti editor: add rifiuta testo vuoto o troppo lungo, righe sbagliate, troppi commenti', () => {
  const s = N.empty();
  assert.deepStrictEqual(put(s, 'a.js', 1, 1, '   '), { ok: false, state: s, error: 'Il commento è vuoto.' });
  assert.match(put(s, 'a.js', 1, 1, 'x'.repeat(2001)).error, /al massimo 2000 caratteri/);
  assert.strictEqual(put(s, 'a.js', 0, 1).error, 'Righe non commentabili.');
  assert.strictEqual(put(s, 'a.js', 5, 4).error, 'Righe non commentabili.');
  assert.strictEqual(put(s, 'a.js', 1.5, 2).error, 'Righe non commentabili.');
  assert.match(put(s, 'a.js', 1, 201).error, /al massimo 200 righe/);
  assert.strictEqual(put(s, 'a.js', 1, 200).ok, true);
  assert.strictEqual(put(s, '', 1, 1).error, 'File non valido.');
  let full = s;
  for (let i = 1; i <= 50; i += 1) full = put(full, 'a.js', i, i).state;
  const r = put(full, 'a.js', 60, 60);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Al massimo 50 commenti/);
  assert.strictEqual(r.state, full);
});

ok('commenti editor: update cambia solo il testo, e rifiuta un testo vuoto o un id che non c è', () => {
  const s = put(N.empty(), 'a.js', 2, 2, 'prima', 'm1').state;
  const r = N.update(s, 'n1', ' dopo ');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.state.notes, [{ id: 'n1', rel: 'a.js', from: 2, to: 2, body: 'dopo', track: 'm1' }]);
  assert.strictEqual(s.notes[0].body, 'prima');
  assert.deepStrictEqual(N.update(s, 'n1', ''), { ok: false, state: s, error: 'Il commento è vuoto.' });
  assert.strictEqual(N.update(s, 'n9', 'x').ok, false);
});

ok('commenti editor: remove e clear; dopo clear gli id non ricominciano', () => {
  let s = put(N.empty(), 'a.js', 1, 1).state;
  s = put(s, 'b.js', 1, 1).state;
  assert.deepStrictEqual(N.remove(s, 'n1').notes.map((n) => n.id), ['n2']);
  assert.strictEqual(N.remove(s, 'n9'), s, 'niente da togliere: stesso stato');
  const cleared = N.clear(s);
  assert.deepStrictEqual(cleared.notes, []);
  assert.strictEqual(put(cleared, 'a.js', 1, 1).note.id, 'n3');
  assert.strictEqual(s.notes.length, 2);
});

ok('commenti editor: forFile in ordine di riga, count per file e in tutto, find', () => {
  let s = N.empty();
  s = put(s, 'a.js', 9, 9).state;
  s = put(s, 'b.js', 1, 1).state;
  s = put(s, 'a.js', 2, 4).state;
  s = put(s, 'a.js', 2, 2).state;
  assert.deepStrictEqual(N.forFile(s, 'a.js').map((n) => [n.from, n.to]), [[2, 2], [2, 4], [9, 9]]);
  assert.deepStrictEqual(s.notes.map((n) => n.id), ['n1', 'n2', 'n3', 'n4'], 'forFile non riordina lo stato');
  assert.strictEqual(N.count(s, 'a.js'), 3);
  assert.strictEqual(N.count(s), 4);
  assert.strictEqual(N.count(s, 'c.js'), 0);
  assert.strictEqual(N.find(s, 'n2').rel, 'b.js');
  assert.strictEqual(N.find(s, 'n9'), null);
});

ok('commenti editor: move segue le righe; uguali, non valide o id sconosciuto: stesso stato', () => {
  const s = put(N.empty(), 'a.js', 3, 5).state;
  const moved = N.move(s, 'n1', { from: 6, to: 8 });
  assert.deepStrictEqual([moved.notes[0].from, moved.notes[0].to], [6, 8]);
  assert.strictEqual(s.notes[0].from, 3);
  assert.strictEqual(N.move(s, 'n1', { from: 3, to: 5 }), s);
  assert.strictEqual(N.move(s, 'n1', { from: 0, to: 2 }), s);
  assert.strictEqual(N.move(s, 'n9', { from: 1, to: 1 }), s);
  assert.strictEqual(N.move(s, 'n1', { from: 1, to: 400 }).notes[0].to, 400, 'righe scritte in mezzo lo allungano anche oltre 200');
});

ok('commenti editor: dropFile toglie i commenti di un file, renameFile li sposta', () => {
  let s = put(N.empty(), 'a.js', 1, 1).state;
  s = put(s, 'b.js', 2, 2).state;
  assert.deepStrictEqual(N.dropFile(s, 'a.js').notes.map((n) => n.rel), ['b.js']);
  assert.strictEqual(N.dropFile(s, 'c.js'), s);
  assert.deepStrictEqual(N.renameFile(s, 'a.js', 'lib/a.js').notes.map((n) => n.rel), ['lib/a.js', 'b.js']);
  assert.strictEqual(N.renameFile(s, 'c.js', 'd.js'), s);
});

ok('commenti editor: etichette delle righe e del conteggio', () => {
  assert.strictEqual(N.labelOf({ from: 12, to: 12 }), 'Riga 12');
  assert.strictEqual(N.labelOf({ from: 12, to: 14 }), 'Righe 12–14');
  assert.strictEqual(N.countLabel(1), '1 commento');
  assert.strictEqual(N.countLabel(3), '3 commenti');
});

ok('commenti editor: toReviewNotes dà righe nuove di contesto col testo di adesso', () => {
  const s = put(N.empty(), 'a.js', 2, 3, 'corto').state;
  const text = (rel, line) => `${rel}:${line}`;
  assert.deepStrictEqual(N.toReviewNotes(s.notes, text), [{
    id: 'n1', path: 'a.js', body: 'corto',
    lines: [{ side: 'new', no: 2, kind: 'ctx', text: 'a.js:2' }, { side: 'new', no: 3, kind: 'ctx', text: 'a.js:3' }],
  }]);
  // Oltre 200 righe formatPrompt la scarterebbe: si citano le prime, l'ultima tiene giusto l'intervallo
  const long = N.move(put(N.empty(), 'a.js', 1, 1).state, 'n1', { from: 1, to: 300 });
  const [n] = N.toReviewNotes(long.notes, () => null);
  assert.strictEqual(n.lines.length, 200);
  assert.deepStrictEqual([n.lines[0].no, n.lines[198].no, n.lines[199].no], [1, 199, 300]);
  assert.strictEqual(n.lines[0].text, '');
});

ok('commenti editor: il prompt ha la sua intestazione, i file in ordine e le righe citate', () => {
  let s = N.empty();
  s = put(s, 'lib/b.js', 4, 4, 'Nome sbagliato.').state;
  s = put(s, 'lib/a.js', 10, 11, 'Togli il doppione.\nE un test.').state;
  s = put(s, 'lib/a.js', 2, 2, 'Manca il null.').state;
  const files = {
    'lib/a.js': ['', '  const x = foo();', '', '', '', '', '', '', '', 'bar();', 'bar();'],
    'lib/b.js': ['', '', '', 'function fo() {}'],
  };
  const text = (rel, line) => files[rel][line - 1];
  assert.strictEqual(N.promptFor(s, text), [
    'Correggi questi punti del codice:',
    '',
    '1. lib/a.js:2',
    '   > const x = foo();',
    '   Manca il null.',
    '',
    '2. lib/a.js:10-11',
    '     bar();',
    '     bar();',
    '   Togli il doppione.',
    '   E un test.',
    '',
    '3. lib/b.js:4',
    '   > function fo() {}',
    '   Nome sbagliato.',
  ].join('\n'));
  assert.strictEqual(N.promptFor(N.empty(), text), '');
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-notes.test.js tests/review-notes.test.js`
Expected: FAIL. `Cannot find module '../renderer/editor-notes'`, e in review-notes il test nuovo dà `'Review delle modifiche, correggi questi punti:' !== 'Correggi questi punti del codice:'`.

- [ ] **Step 3: l'intestazione in `formatPrompt`**

In `renderer/review-notes.js` sostituire `formatPrompt` (righe 224–233) con:

```js
  /** Il prompt per l'agente; vuoto se non ci sono note. `header`: la prima riga (la scheda editor ha la sua, docs/plans/65) */
  function formatPrompt(notes, { header = HEADER } = {}) {
    const list = [...(notes || [])].filter(validAnchor).sort(byPlace);
    if (!list.length) return '';
    const items = list.map((n, i) => {
      const body = sanitize(n.body).split('\n').map((l) => `   ${l}`.trimEnd());
      return [`${i + 1}. ${where(n)}`, ...quoteOf(n), ...body].join('\n');
    });
    return [header, '', items.join('\n\n')].join('\n');
  }
```

Il commento `/** Il prompt per l'agente; vuoto se non ci sono note */` sopra la funzione è sostituito da questo.

- [ ] **Step 4: il modello**

Creare `renderer/editor-notes.js`:

```js
/* Commenti sul codice nella scheda editor (docs/plans/65): su una riga o su
 * un gruppo di righe di un file aperto, copiati negli appunti come un prompt
 * solo. Qui solo il modello: lo stato è della scheda, in memoria, e ogni
 * operazione ne restituisce uno nuovo. Disegno e cablaggio in
 * editor-notes-ui.js. Dove sono le righe adesso lo sa l'host di Monaco
 * (trackLines): qui si tiene l'ultimo numero visto (`move`).
 *
 * Il testo del prompt lo fa review-notes.js (formatPrompt) con
 * un'intestazione sua: i commenti diventano note di review su righe di
 * contesto, e il formato resta quello del pannello modifiche.
 *
 * Wrapper UMD come review-notes.js: globale nella pagina e module.exports
 * sotto Node. */
(function (root, factory) {
  const api = factory(root && root.AisessReviewNotes);
  if (root) root.AisessEditorNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Review) {
  const R = Review || require('./review-notes');
  const HEADER = 'Correggi questi punti del codice:';

  const empty = () => ({ notes: [], seq: 0 });
  const fail = (state, error) => ({ ok: false, state, error });
  const goodLines = (from, to) => Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;

  function bodyError(text) {
    if (!text) return 'Il commento è vuoto.';
    if (text.length > R.MAX_BODY) return `Commento troppo lungo (al massimo ${R.MAX_BODY} caratteri).`;
    return null;
  }

  function rangeError(from, to) {
    if (!goodLines(from, to)) return 'Righe non commentabili.';
    if (to - from + 1 > R.MAX_LINES) return `Un commento copre al massimo ${R.MAX_LINES} righe.`;
    return null;
  }

  /** @returns {{ok: true, state: object, note: object} | {ok: false, state: object, error: string}} */
  function add(state, { rel, from, to, body, track = null }) {
    const text = String(body || '').trim();
    if (typeof rel !== 'string' || !rel) return fail(state, 'File non valido.');
    const error = rangeError(from, to) || bodyError(text);
    if (error) return fail(state, error);
    if (state.notes.length >= R.MAX_NOTES) return fail(state, `Al massimo ${R.MAX_NOTES} commenti: copiali, poi continua.`);
    const note = { id: `n${state.seq + 1}`, rel, from, to, body: text, track };
    return { ok: true, state: { notes: [...state.notes, note], seq: state.seq + 1 }, note };
  }

  function update(state, id, body) {
    const text = String(body || '').trim();
    const old = state.notes.find((n) => n.id === id);
    if (!old) return fail(state, 'Il commento non c\'è più.');
    const error = bodyError(text);
    if (error) return fail(state, error);
    const note = { ...old, body: text };
    return { ok: true, state: { ...state, notes: state.notes.map((n) => (n.id === id ? note : n)) }, note };
  }

  /* Stesso stato se non si toglie niente: chi chiama può confrontare */
  function keep(state, test) {
    const notes = state.notes.filter(test);
    return notes.length === state.notes.length ? state : { ...state, notes };
  }

  const remove = (state, id) => keep(state, (n) => n.id !== id);
  // `seq` resta: un id già dato non torna, anche dopo Svuota
  const clear = (state) => (state.notes.length ? { ...state, notes: [] } : state);
  const dropFile = (state, rel) => keep(state, (n) => n.rel !== rel);

  function renameFile(state, from, to) {
    if (!state.notes.some((n) => n.rel === from)) return state;
    return { ...state, notes: state.notes.map((n) => (n.rel === from ? { ...n, rel: to } : n)) };
  }

  const find = (state, id) => state.notes.find((n) => n.id === id) || null;

  /** Le righe sono andate altrove (si è scritto sopra). Niente tetto di
      righe: scrivendo in mezzo un commento può allungarsi */
  function move(state, id, { from, to }) {
    const old = find(state, id);
    if (!old || !goodLines(from, to) || (old.from === from && old.to === to)) return state;
    return { ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, from, to } : n)) };
  }

  const byLine = (a, b) => a.from - b.from || a.to - b.to;
  const forFile = (state, rel) => state.notes.filter((n) => n.rel === rel).sort(byLine);
  const count = (state, rel) => (rel === undefined ? state.notes.length : state.notes.filter((n) => n.rel === rel).length);

  const countLabel = (n) => (n === 1 ? '1 commento' : `${n} commenti`);
  const labelOf = ({ from, to }) => R.linesLabel([{ side: 'new', no: from }, { side: 'new', no: to }]);

  /* formatPrompt scarta una nota con più di MAX_LINES righe: oltre si
     citano le prime, e l'ultima resta `to` perché l'intervallo sia giusto */
  function linesFor(n) {
    const total = n.to - n.from + 1;
    const nos = Array.from({ length: Math.min(total, R.MAX_LINES) }, (_, i) => n.from + i);
    return total > R.MAX_LINES ? [...nos.slice(0, -1), n.to] : nos;
  }

  /** Note di review (review-notes.js) su righe di contesto. `textOf(rel, line)`: il testo di adesso */
  function toReviewNotes(notes, textOf) {
    return notes.map((n) => ({
      id: n.id, path: n.rel, body: n.body,
      lines: linesFor(n).map((no) => ({ side: 'new', no, kind: 'ctx', text: String(textOf(n.rel, no) || '') })),
    }));
  }

  /** Il prompt di tutti i commenti della scheda, in ordine di file e riga; vuoto senza commenti */
  const promptFor = (state, textOf) => R.formatPrompt(toReviewNotes(state.notes, textOf), { header: HEADER });

  return {
    HEADER, empty, add, update, remove, clear, dropFile, renameFile, move,
    forFile, count, find, countLabel, labelOf, toReviewNotes, promptFor,
  };
});
```

In `renderer/index.html`, dopo `<script src="review-notes.js"></script>`:

```html
<script src="editor-notes.js"></script>
```

- [ ] **Step 5: verificare che passino**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: PASS, 1656 test (1645 + 10 editor-notes + 1 review-notes), 1 skip.

- [ ] **Step 6: commit**

```bash
git add renderer/review-notes.js renderer/editor-notes.js renderer/index.html tests/review-notes.test.js tests/editor-notes.test.js
cat > /tmp/msg.txt <<'EOF'
feat: commenti dell'editor, il modello e il prompt

I commenti sulle righe della scheda editor hanno bisogno di uno stato
loro: stanno su righe qualsiasi di file aperti, non su righe di un diff,
e i numeri cambiano mentre si scrive. editor-notes.js li tiene immutabili
e li trasforma in note di review su righe di contesto, così il prompt
esce da formatPrompt nello stesso formato del pannello modifiche.
formatPrompt prende l'intestazione come opzione; senza, resta quella di
oggi e il pannello non cambia.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git commit --file=/tmp/msg.txt
```

---

### Task 2: segni sulle righe e zone nell'host di Monaco

**Files:**
- Modify: `renderer/editor-monaco.js`
- Modify: `tests/editor-monaco.test.js` (il finto di Monaco e nove test in fondo)

**Interfaces:**
- Consumes: `monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges`, `ITextModel.deltaDecorations`/`getDecorationRange`/`getLineMaxColumn`/`getLineContent`, `editor.changeViewZones(cb)` con `addZone`/`removeZone`/`layoutZone`.
- Produces, nell'host:
  - `trackLines(rel, from, to) → id | null`: righe intere con la classe `editor-note-line`. `null` con righe non valide o file non aperto. `to` oltre la fine si ferma all'ultima riga.
  - `linesOf(id) → { from, to } | null` e `untrack(id)`.
  - `lineText(rel, line) → string | null`.
  - `addZone(rel, afterLine, node, heightInPx = 64) → id | null`: la zona sotto la riga `afterLine`. Si vede quando il file è davanti e segue la riga quando il testo cambia.
  - `removeZone(id)` e `resizeZone(id, heightInPx)`.
  - Segni e zone restano dopo `replaceText` (agli stessi numeri, fermati all'ultima riga) e dopo `rename` (con gli stessi id). `close` li scorda.

- [ ] **Step 1: il finto di Monaco con decorazioni vive e zone**

In `tests/editor-monaco.test.js` sostituire tutta la funzione `fakeMonaco` (righe 5–56) con:

```js
/* Monaco non gira sotto Node: un finto con le sole cose che l'host usa
   (model con versione e decorazioni, editor con view state, comandi e zone). */
function fakeMonaco() {
  const models = [];
  const editor = {
    model: null, view: null, commands: [], disposed: false, options: null,
    zones: new Map(), zoneSeq: 0, layouts: [],
    // Come Monaco: un model diverso è una vista nuova, senza le zone di prima
    setModel(m) { if (m !== editor.model) editor.zones = new Map(); editor.model = m; },
    changeViewZones(cb) {
      cb({
        addZone: (z) => { const id = `vz${++editor.zoneSeq}`; editor.zones.set(id, z); return id; },
        removeZone: (id) => { editor.zones.delete(id); },
        layoutZone: (id) => { editor.layouts.push(id); },
      });
    },
    saveViewState: () => ({ of: editor.model && editor.model.uri.path }),
    restoreViewState(v) { editor.view = v; },
    focus() {}, updateOptions() {},
    position: null, revealed: [],
    setPosition(p) { editor.position = p; },
    revealLineInCenter(line) { editor.revealed.push(line); },
    addCommand(keys, fn) { editor.commands.push({ keys, fn }); },
    dispose() { editor.disposed = true; },
  };
  function createModel(text, _language, uri) {
    const listeners = [];
    let value = text;
    let version = 1;
    const live = new Map(); // id → { range, options }: le decorazioni che ci sono adesso
    const lines = () => value.split(/\r\n|\r|\n/);
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const top = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
    const m = {
      uri, disposed: false, eol: null, decorations: [], removed: [], live,
      getValue: () => value,
      getLineCount: () => lines().length,
      getLineContent: (n) => lines()[n - 1],
      getLineMaxColumn: (n) => lines()[n - 1].length + 1,
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      // Tutto il testo sostituito: le decorazioni si schiacciano in cima, come in Monaco
      pushEditOperations: (_sel, ops) => {
        value = ops[0].text;
        for (const [id, d] of live) live.set(id, { ...d, range: top });
        change();
      },
      pushEOL: (eol) => { m.eol = eol; },
      deltaDecorations: (old, decorations) => {
        m.removed.push(old);
        m.decorations = decorations;
        old.forEach((id) => live.delete(id));
        const ids = decorations.map((_, i) => `${uri.path}#${m.removed.length}.${i}`);
        ids.forEach((id, i) => live.set(id, decorations[i]));
        return ids;
      },
      getDecorationRange: (id) => (live.has(id) ? live.get(id).range : null),
      onDidChangeContent: (f) => { listeners.push(f); return { dispose: () => listeners.splice(listeners.indexOf(f), 1) }; },
      dispose: () => { m.disposed = true; },
      type: (s) => { value += s; change(); }, // solo per il test: l'utente che scrive
      // solo per il test: `count` righe nuove sotto la riga `after`; le decorazioni sotto scendono
      insertLines: (after, count) => {
        const ls = lines();
        value = [...ls.slice(0, after), ...Array(count).fill('nuova'), ...ls.slice(after)].join('\n');
        const down = (n) => (n > after ? n + count : n);
        for (const [id, d] of live) {
          live.set(id, { ...d, range: { ...d.range, startLineNumber: down(d.range.startLineNumber), endLineNumber: down(d.range.endLineNumber) } });
        }
        change();
      },
    };
    models.push(m);
    return m;
  }
  const monaco = {
    editor: {
      create: (_container, options) => { editor.options = options; return editor; },
      createModel,
      EndOfLineSequence: { LF: 0, CRLF: 1 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
    Uri: { from: (o) => ({ ...o }) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyS: 49 },
  };
  return { monaco, editor, models };
}
```

I test che ci sono già non cambiano: `deltaDecorations` registra ancora `decorations` e `removed` come prima.

- [ ] **Step 2: scrivere i test che falliscono**

In fondo a `tests/editor-monaco.test.js`:

```js
/* ---------- commenti (docs/plans/65): segni sulle righe e zone sotto ---------- */

const TEXT = 'uno\ndue\ntre\nquattro\ncinque';

ok('trackLines: righe intere col fondo dei commenti, che seguono il testo', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const m = fake.models[0];
  const id = h.trackLines('a.js', 2, 3);
  const [deco] = m.decorations;
  assert.deepStrictEqual(deco.range, { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 4 });
  assert.deepStrictEqual(deco.options, { isWholeLine: true, className: 'editor-note-line', stickiness: 1 });
  assert.deepStrictEqual(h.linesOf(id), { from: 2, to: 3 });
  m.insertLines(1, 2);
  assert.deepStrictEqual(h.linesOf(id), { from: 4, to: 5 });
  h.untrack(id);
  assert.strictEqual(h.linesOf(id), null);
  assert.strictEqual(m.live.size, 0);
});

ok('trackLines: righe fuori dal file o file non aperto, niente segno', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  assert.strictEqual(h.trackLines('a.js', 0, 1), null);
  assert.strictEqual(h.trackLines('a.js', 3, 2), null);
  assert.strictEqual(h.trackLines('a.js', 6, 6), null);
  assert.strictEqual(h.trackLines('b.js', 1, 1), null);
  assert.deepStrictEqual(h.linesOf(h.trackLines('a.js', 4, 99)), { from: 4, to: 5 }, 'la fine si ferma all ultima riga');
  assert.strictEqual(h.linesOf('sconosciuto'), null);
  h.untrack('sconosciuto');
});

ok('lineText: il testo di una riga, null fuori dal file', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  assert.strictEqual(h.lineText('a.js', 2), 'due');
  assert.strictEqual(h.lineText('a.js', 6), null);
  assert.strictEqual(h.lineText('a.js', 0), null);
  assert.strictEqual(h.lineText('b.js', 1), null);
});

ok('addZone: sotto la riga nel file attivo; negli altri compare quando si attivano', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  h.open('b.js', TEXT);
  const node = { tag: 'div' };
  assert.ok(h.addZone('a.js', 3, node, 80));
  assert.strictEqual(fake.editor.zones.size, 0, 'a.js non è davanti');
  h.activate('a.js');
  assert.deepStrictEqual([...fake.editor.zones.values()].map((z) => [z.afterLineNumber, z.heightInPx, z.domNode]), [[3, 80, node]]);
  h.activate('b.js');
  assert.strictEqual(fake.editor.zones.size, 0);
  h.activate('a.js');
  assert.strictEqual(fake.editor.zones.size, 1, 'setModel butta le zone: si rimettono');
  h.activate('a.js');
  assert.strictEqual(fake.editor.zones.size, 1, 'lo stesso file non le raddoppia');
  assert.strictEqual(h.addZone('a.js', 9, node), null);
  assert.strictEqual(h.addZone('c.js', 1, node), null);
});

ok('addZone: segue la riga quando il testo cambia sopra', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  h.addZone('a.js', 3, {});
  const [[vid, zone]] = [...fake.editor.zones];
  assert.strictEqual(zone.heightInPx, 64, 'altezza di partenza');
  fake.models[0].insertLines(1, 2);
  assert.strictEqual(zone.afterLineNumber, 5);
  assert.deepStrictEqual(fake.editor.layouts, [vid]);
  fake.models[0].insertLines(9, 1);
  assert.deepStrictEqual(fake.editor.layouts, [vid], 'righe sotto la zona: non si muove');
});

ok('removeZone e resizeZone', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.addZone('a.js', 2, {});
  const [[vid, zone]] = [...fake.editor.zones];
  h.resizeZone(id, 120);
  assert.strictEqual(zone.heightInPx, 120);
  assert.deepStrictEqual(fake.editor.layouts, [vid]);
  h.resizeZone(id, 120);
  h.resizeZone(id, 0);
  assert.deepStrictEqual(fake.editor.layouts, [vid], 'stessa altezza o zero: niente');
  h.removeZone(id);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(fake.models[0].live.size, 0, 'anche il segno della zona va via');
  h.removeZone(id);
});

ok('replaceText: i segni restano agli stessi numeri, fermati all ultima riga', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const a = h.trackLines('a.js', 2, 3);
  const b = h.trackLines('a.js', 4, 5);
  h.addZone('a.js', 5, {});
  h.replaceText('a.js', 'uno\ndue\ntre\nquattro');
  assert.deepStrictEqual(h.linesOf(a), { from: 2, to: 3 });
  assert.deepStrictEqual(h.linesOf(b), { from: 4, to: 4 });
  assert.strictEqual([...fake.editor.zones.values()][0].afterLineNumber, 4);
});

ok('rename: segni e zone passano al model nuovo con gli stessi id', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 2, 2);
  const node = {};
  const zone = h.addZone('a.js', 2, node);
  h.rename('a.js', 'b.js');
  assert.deepStrictEqual(h.linesOf(id), { from: 2, to: 2 });
  assert.strictEqual(fake.models[1].live.size, 2, 'il segno e quello della zona');
  assert.deepStrictEqual([...fake.editor.zones.values()].map((z) => z.domNode), [node]);
  h.removeZone(zone);
  assert.strictEqual(fake.editor.zones.size, 0);
  assert.strictEqual(h.lineText('b.js', 2), 'due');
});

ok('close: segni e zone del file si scordano', () => {
  const { h } = host();
  h.open('a.js', TEXT);
  const id = h.trackLines('a.js', 1, 1);
  const zone = h.addZone('a.js', 1, {});
  h.close('a.js');
  assert.strictEqual(h.linesOf(id), null);
  h.removeZone(zone);
  h.open('a.js', TEXT);
  assert.strictEqual(h.linesOf(id), null, 'un file riaperto non ritrova i segni di prima');
});
```

- [ ] **Step 3: verificare che falliscano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-monaco.test.js`
Expected: FAIL nei nove test nuovi, con `h.trackLines is not a function` (e simili). Gli undici di prima passano.

- [ ] **Step 4: segni e zone nell'host**

In `renderer/editor-monaco.js`, dentro `createEditorHost`:

1. In `track(d)`, la zona segue prima che la scheda senta il cambio:

```js
    function track(d) {
      // edited: il testo è cambiato; false da markSaved (cambia solo «sporco»)
      d.sub = d.model.onDidChangeContent(() => {
        followZones(d);
        onChange(d.rel, dirtyOf(d), true);
      });
      docs.set(d.rel, d);
    }
```

2. In `make`, ogni file ha i suoi segni e le sue zone:

```js
    function make(rel, text, extra = {}) {
      const model = monaco.editor.createModel(text, undefined, uriOf(rel));
      track({
        rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, gutter: [],
        marks: new Map(), zones: new Map(), ...extra,
      });
    }
```

Il commento sopra `docs` diventa `// rel → { rel, model, savedVersion, viewState, forcedDirty, sub, gutter, marks, zones }`.

3. `activate` toglie le zone del file che va dietro e rimette quelle del file che viene davanti:

```js
    function activate(rel) {
      const d = docs.get(rel);
      if (!d) return;
      const fresh = current !== rel;
      const prev = fresh ? docs.get(current) : null;
      if (prev) {
        prev.viewState = editor.saveViewState();
        prev.zones.forEach(hideZone);
      }
      current = rel;
      editor.setModel(d.model);
      // setModel butta la vista e le sue zone: si rimettono (lo stesso model non la cambia)
      if (fresh) d.zones.forEach(showZone);
      if (d.viewState) editor.restoreViewState(d.viewState);
      editor.focus();
    }
```

4. `replaceText` rimette i segni dopo la sostituzione:

```js
    function replaceText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const spans = spansOf(d); // sostituire tutto il testo li schiaccerebbe in cima
      const eol = /\r\n/.test(text) ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF;
      d.model.pushEOL(eol);
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      putMarks(d, spans);
      followZones(d);
      if (view) editor.restoreViewState(view);
      markSaved(rel);
    }
```

5. `rename` porta segni e zone nel model nuovo:

```js
    function rename(from, to) {
      const d = docs.get(from);
      if (!d || docs.has(to)) return;
      const wasCurrent = current === from;
      const viewState = wasCurrent ? editor.saveViewState() : d.viewState;
      const spans = spansOf(d); // prima di togliere `from` da docs: linesOf passa da lì
      docs.delete(from);
      // Le zone passano fuori dalla vista: activate le rimette
      const zones = new Map([...d.zones].map(([id, z]) => [id, { ...z, viewId: null }]));
      make(to, d.model.getValue(), { viewState, forcedDirty: dirtyOf(d), zones });
      putMarks(docs.get(to), spans, d);
      for (const id of zones.keys()) owner.set(id, to);
      if (wasCurrent) { current = null; activate(to); }
      d.sub.dispose();
      d.model.dispose();
    }
```

6. `close` scorda gli id del file:

```js
    function close(rel) {
      const d = docs.get(rel);
      if (!d) return;
      docs.delete(rel);
      for (const id of [...d.marks.keys(), ...d.zones.keys()]) owner.delete(id);
      if (current === rel) { current = null; editor.setModel(null); }
      d.sub.dispose();
      d.model.dispose();
    }
```

7. Dopo `reveal` (prima di `close`), il blocco nuovo:

```js
    /* Commenti (docs/plans/65): segni sulle righe e zone sotto di loro.
       Un segno è una decorazione del model, che Monaco sposta col testo;
       `owner` dice di quale file è ogni id, anche dopo una rinomina. Le
       zone stanno nella vista, che setModel butta: si rimettono quando il
       file torna davanti (activate). */
    const NOTE_LINE = 'editor-note-line';
    const ZONE_PX = 64;
    const owner = new Map(); // id di segno o di zona → rel
    let seq = 0;

    const validLines = (model, from, to) => Number.isInteger(from) && Number.isInteger(to)
      && from >= 1 && to >= from && from <= model.getLineCount();

    function markOf(model, from, to, cls) {
      const stickiness = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
      return {
        range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: model.getLineMaxColumn(to) },
        options: { isWholeLine: true, stickiness, ...(cls ? { className: cls } : {}) },
      };
    }

    function trackIn(d, from, to, cls) {
      const id = `${authority}m${++seq}`;
      const [deco] = d.model.deltaDecorations([], [markOf(d.model, from, to, cls)]);
      d.marks.set(id, { deco, cls });
      owner.set(id, d.rel);
      return id;
    }

    /** Righe intere col fondo dei commenti; la fine oltre il file si ferma all'ultima riga */
    function trackLines(rel, from, to) {
      const d = docs.get(rel);
      if (!d || !validLines(d.model, from, to)) return null;
      return trackIn(d, from, Math.min(to, d.model.getLineCount()), NOTE_LINE);
    }

    const docOf = (id) => docs.get(owner.get(id));

    function linesOf(id) {
      const d = docOf(id);
      const m = d && d.marks.get(id);
      const r = m && d.model.getDecorationRange(m.deco);
      return r ? { from: r.startLineNumber, to: r.endLineNumber } : null;
    }

    function untrack(id) {
      const d = docOf(id);
      owner.delete(id);
      const m = d && d.marks.get(id);
      if (!m) return;
      d.model.deltaDecorations([m.deco], []);
      d.marks.delete(id);
    }

    const spansOf = (d) => [...d.marks.keys()].map((id) => [id, linesOf(id)]);

    /* Rimette i segni ai numeri di `spans`, fermati all'ultima riga: dopo
       un testo sostituito tutto, o nel model nuovo di una rinomina (`from`
       è il file da cui vengono) */
    function putMarks(d, spans, from = d) {
      const last = d.model.getLineCount();
      for (const [id, at] of spans) {
        const m = from.marks.get(id);
        if (!at || !m) continue;
        const old = from === d ? [m.deco] : [];
        const [deco] = d.model.deltaDecorations(old, [markOf(d.model, Math.min(at.from, last), Math.min(at.to, last), m.cls)]);
        d.marks.set(id, { deco, cls: m.cls });
        owner.set(id, d.rel);
      }
    }

    function lineText(rel, line) {
      const d = docs.get(rel);
      return d && validLines(d.model, line, line) ? d.model.getLineContent(line) : null;
    }

    function showZone(z) {
      editor.changeViewZones((acc) => { z.viewId = acc.addZone(z.delegate); });
    }

    function hideZone(z) {
      if (z.viewId === null) return;
      editor.changeViewZones((acc) => acc.removeZone(z.viewId));
      z.viewId = null;
    }

    /** Una zona col nodo `node` sotto la riga `afterLine`, che la segue come un segno */
    function addZone(rel, afterLine, node, heightInPx = ZONE_PX) {
      const d = docs.get(rel);
      if (!d || !validLines(d.model, afterLine, afterLine)) return null;
      const id = `${authority}z${++seq}`;
      const delegate = { afterLineNumber: afterLine, heightInPx, domNode: node };
      const z = { mark: trackIn(d, afterLine, afterLine, null), viewId: null, delegate };
      d.zones.set(id, z);
      owner.set(id, rel);
      if (current === rel) showZone(z);
      return id;
    }

    function removeZone(id) {
      const d = docOf(id);
      const z = d && d.zones.get(id);
      owner.delete(id);
      if (!z) return;
      hideZone(z);
      untrack(z.mark);
      d.zones.delete(id);
    }

    /** L'altezza la sa il riquadro dopo il disegno: chi la misura la passa qui */
    function resizeZone(id, heightInPx) {
      const d = docOf(id);
      const z = d && d.zones.get(id);
      if (!z || !(heightInPx > 0) || z.delegate.heightInPx === heightInPx) return;
      z.delegate.heightInPx = heightInPx;
      if (z.viewId !== null) editor.changeViewZones((acc) => acc.layoutZone(z.viewId));
    }

    /* Monaco sposta già la zona con le righe, ma a ogni layoutZone rilegge
       afterLineNumber: lo si tiene uguale al segno */
    function followZones(d) {
      const moved = [];
      for (const z of d.zones.values()) {
        const at = linesOf(z.mark);
        if (at && at.to !== z.delegate.afterLineNumber) {
          z.delegate.afterLineNumber = at.to;
          moved.push(z);
        }
      }
      const shown = moved.filter((z) => z.viewId !== null);
      if (shown.length) editor.changeViewZones((acc) => shown.forEach((z) => acc.layoutZone(z.viewId)));
    }
```

8. Nel `return` dell'host aggiungere i metodi:

```js
    return {
      open, activate, markSaved, replaceText, rename, close, dispose, setGutter, reveal,
      trackLines, linesOf, untrack, lineText, addZone, removeZone, resizeZone,
      current: () => current,
```

(il resto del `return` resta com'è).

- [ ] **Step 5: verificare che passino**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: PASS, 1665 test (1656 + 9), 1 skip.

- [ ] **Step 6: commit**

```bash
git add renderer/editor-monaco.js tests/editor-monaco.test.js
cat > /tmp/msg.txt <<'EOF'
feat: segni sulle righe e zone sotto nell'host di Monaco

Un commento dell'editor deve restare sulle sue righe mentre si scrive
sopra, e il suo riquadro deve stare sotto l'ultima. I segni sono
decorazioni del model, che Monaco sposta col testo, e valgono anche
per i file che non sono davanti: per questo model.deltaDecorations e
non le collezioni dell'editor, legate al model attivo. Le zone stanno
nella vista, che setModel butta: l'host le tiene per file e le rimette
quando il file torna davanti. Segni e zone passano attraverso una
ricarica dal disco e una rinomina, che cambiano o rifanno il model.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git commit --file=/tmp/msg.txt
```

---

### Task 3: commentare dal margine e dal menu

**Files:**
- Modify: `renderer/editor-monaco.js`
- Modify: `tests/editor-monaco.test.js` (finto e tre test)

**Interfaces:**
- Consumes: `editor.addAction`, `editor.getSelection`, `editor.onMouseDown`/`onMouseMove`/`onMouseLeave`, `monaco.editor.MouseTargetType` (`GUTTER_GLYPH_MARGIN` 2, `GUTTER_LINE_NUMBERS` 3, `GUTTER_LINE_DECORATIONS` 4, `CONTENT_TEXT` 6, `CONTENT_EMPTY` 7). Il contesto `editorHasSelection` è di Monaco.
- Produces:
  - Nuova opzione di `createEditorHost`: `onComment(rel, from, to)`, di default una funzione vuota.
  - L'editor ha `glyphMargin: true`.
  - Due voci nel menu del tasto destro, gruppo `navigation`: `aisess.comment-line` «Commenta riga» (senza selezione, precondizione `!editorHasSelection`) e `aisess.comment-selection` «Commenta selezione» (precondizione `editorHasSelection`).
  - Un «+» (`glyphMarginClassName: 'editor-note-add'`) nel margine della riga sotto il mouse.
  - Il clic sinistro nel margine dei glifi commenta la riga, o la selezione se la riga ci sta dentro.
  - Una selezione che finisce a colonna 1 di una riga non prende quella riga.

- [ ] **Step 1: il finto e i test che falliscono**

Nel finto di `tests/editor-monaco.test.js`, nell'oggetto `editor` dopo `addCommand`:

```js
    selection: null, actions: [], mouse: {},
    getSelection: () => editor.selection,
    addAction(a) { editor.actions.push(a); },
    onMouseDown(f) { editor.mouse.down = f; },
    onMouseMove(f) { editor.mouse.move = f; },
    onMouseLeave(f) { editor.mouse.leave = f; },
```

e in `monaco.editor`, dopo `TrackedRangeStickiness`:

```js
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 2, GUTTER_LINE_NUMBERS: 3, GUTTER_LINE_DECORATIONS: 4, GUTTER_VIEW_ZONE: 5, CONTENT_TEXT: 6, CONTENT_EMPTY: 7, CONTENT_VIEW_ZONE: 8 },
```

In fondo al file:

```js
const sel = (startLineNumber, endLineNumber, endColumn = 5, startColumn = 1) => ({ startLineNumber, startColumn, endLineNumber, endColumn });
const at = (type, lineNumber) => ({ target: { type, position: lineNumber ? { lineNumber, column: 1 } : null }, event: { rightButton: false } });

ok('commenti: margine dei glifi acceso e due voci nel menu, una per la riga e una per la selezione', () => {
  const asked = [];
  const { h, fake } = host({ onComment: (...a) => asked.push(a) });
  assert.strictEqual(fake.editor.options.glyphMargin, true);
  assert.deepStrictEqual(fake.editor.actions.map((a) => [a.id, a.label, a.precondition, a.contextMenuGroupId]), [
    ['aisess.comment-line', 'Commenta riga', '!editorHasSelection', 'navigation'],
    ['aisess.comment-selection', 'Commenta selezione', 'editorHasSelection', 'navigation'],
  ]);
  const [line, selection] = fake.editor.actions;
  line.run(fake.editor);
  assert.deepStrictEqual(asked, [], 'nessun file aperto');
  h.open('a.js', TEXT);
  fake.editor.selection = sel(4, 4, 3, 3); // il cursore, fermo sulla riga 4
  line.run(fake.editor);
  fake.editor.selection = sel(3, 6, 1); // fino a inizio riga 6: la 6 non c'è
  selection.run(fake.editor);
  fake.editor.selection = sel(2, 3, 2);
  selection.run(fake.editor);
  assert.deepStrictEqual(asked, [['a.js', 4, 4], ['a.js', 3, 5], ['a.js', 2, 3]]);
});

ok('commenti: il clic nel margine dei glifi commenta la riga, o la selezione se ci sta dentro', () => {
  const asked = [];
  const { h, fake } = host({ onComment: (...a) => asked.push(a) });
  h.open('a.js', TEXT);
  const down = fake.editor.mouse.down;
  down(at(2, 3));
  fake.editor.selection = sel(2, 4);
  down(at(2, 3));
  down(at(2, 5));
  down({ ...at(2, 1), event: { rightButton: true } });
  down(at(6, 1)); // nel testo: è un clic nel testo
  down(at(2, 0));
  assert.deepStrictEqual(asked, [['a.js', 3, 3], ['a.js', 2, 4], ['a.js', 5, 5]]);
});

ok('commenti: il «+» compare nel margine della riga sotto il mouse e sparisce uscendo', () => {
  const { h, fake } = host();
  h.open('a.js', TEXT);
  const m = fake.models[0];
  const plus = () => [...m.live.values()].filter((d) => d.options.glyphMarginClassName === 'editor-note-add').map((d) => d.range.startLineNumber);
  fake.editor.mouse.move(at(6, 2));
  assert.deepStrictEqual(plus(), [2]);
  fake.editor.mouse.move(at(2, 2));
  assert.strictEqual(m.removed.length, 1, 'stessa riga: non si ridisegna');
  fake.editor.mouse.move(at(3, 4));
  assert.deepStrictEqual(plus(), [4]);
  fake.editor.mouse.move(at(8, 4));
  assert.deepStrictEqual(plus(), [], 'sopra una zona dei commenti no');
  fake.editor.mouse.move(at(6, 1));
  fake.editor.mouse.leave({});
  assert.deepStrictEqual(plus(), []);
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-monaco.test.js`
Expected: FAIL nei tre test nuovi: `glyphMargin` è `undefined`, `actions` è vuoto e `fake.editor.mouse.down is not a function`.

- [ ] **Step 3: margine, menu e «+»**

In `renderer/editor-monaco.js`:

1. Firma e documentazione di `createEditorHost`:

```js
  /**
   * @param {{monaco: object, container: Element, fontSize: number,
   *   onChange: (rel: string, dirty: boolean, edited: boolean) => void,
   *   onSave: (rel: string|null) => void, onSaveAll: () => void,
   *   onComment?: (rel: string, from: number, to: number) => void}} o
   */
  function createEditorHost({ monaco, container, fontSize, onChange, onSave, onSaveAll, onComment = () => {} }) {
```

2. Nelle opzioni di `monaco.editor.create`, dopo `renderWhitespace: 'selection'`, aggiungere `glyphMargin: true` (il margine del «+», docs/plans/65).

3. Dopo il blocco dei commenti del Task 2 (dopo `followZones`):

```js
    /* Commentare (docs/plans/65): dal menu del tasto destro, o col clic sul
       «+» che compare nel margine della riga sotto il mouse */
    const MT = monaco.editor.MouseTargetType;
    const ON_LINE = new Set([MT.GUTTER_GLYPH_MARGIN, MT.GUTTER_LINE_NUMBERS, MT.GUTTER_LINE_DECORATIONS, MT.CONTENT_TEXT, MT.CONTENT_EMPTY]);
    let hover = { rel: null, line: 0, ids: [] };

    // Una selezione che finisce a inizio riga non prende quella riga
    function selectedLines() {
      const s = editor.getSelection();
      if (!s) return null;
      const to = s.endLineNumber > s.startLineNumber && s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
      return { from: s.startLineNumber, to };
    }

    /* `line` 0: dal menu, vale la selezione (o la riga del cursore). Dal
       margine la riga, o la selezione se la riga ci sta dentro */
    function commentAt(line) {
      if (!current) return;
      const sel = selectedLines();
      const inSel = sel && sel.to > sel.from && line >= sel.from && line <= sel.to;
      const lines = line && !inSel ? { from: line, to: line } : sel;
      if (lines) onComment(current, lines.from, lines.to);
    }

    function clearAdd() {
      const d = docs.get(hover.rel);
      if (d && hover.ids.length) d.model.deltaDecorations(hover.ids, []);
      hover = { rel: null, line: 0, ids: [] };
    }

    function showAdd(line) {
      if (hover.rel === current && hover.line === line) return;
      clearAdd();
      const d = docs.get(current);
      if (!d) return;
      const range = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 };
      hover = { rel: current, line, ids: d.model.deltaDecorations([], [{ range, options: { glyphMarginClassName: 'editor-note-add' } }]) };
    }

    const lineOf = (e) => (e.target && e.target.position ? e.target.position.lineNumber : 0);

    function wireComments() {
      const action = (id, label, precondition) => editor.addAction({
        id, label, precondition, contextMenuGroupId: 'navigation', contextMenuOrder: 0, run: () => commentAt(0),
      });
      action('aisess.comment-line', 'Commenta riga', '!editorHasSelection');
      action('aisess.comment-selection', 'Commenta selezione', 'editorHasSelection');
      editor.onMouseMove((e) => {
        const line = ON_LINE.has(e.target.type) ? lineOf(e) : 0;
        if (line) showAdd(line);
        else clearAdd();
      });
      editor.onMouseLeave(() => clearAdd());
      // Monaco non sposta la selezione per un clic nel margine dei glifi: si legge ancora quella di prima
      editor.onMouseDown((e) => {
        if (e.target.type !== MT.GUTTER_GLYPH_MARGIN || (e.event && e.event.rightButton)) return;
        const line = lineOf(e);
        if (line) commentAt(line);
      });
    }
```

4. Subito prima del `return {` dell'host:

```js
    wireComments();
```

- [ ] **Step 4: verificare che passino**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: PASS, 1668 test (1665 + 3), 1 skip.

- [ ] **Step 5: commit**

```bash
git add renderer/editor-monaco.js tests/editor-monaco.test.js
cat > /tmp/msg.txt <<'EOF'
feat: commentare una riga dell'editor dal margine o dal menu

I due ingressi chiesti dalla spec: il «+» che compare nel margine della
riga sotto il mouse e le voci «Commenta riga» e «Commenta selezione»
nel menu del tasto destro, una sola alla volta secondo che ci sia una
selezione. Il clic che commenta è solo quello nel margine dei glifi,
perché un clic nel testo deve restare un clic nel testo. Una selezione
che arriva a inizio riga non prende quella riga, come quando Monaco
sposta le righe. L'host dice solo file e righe: la casella la apre la
scheda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git commit --file=/tmp/msg.txt
```

---

### Task 4: caselle, commenti salvati e riga in testa (`renderer/editor-notes-ui.js`)

**Files:**
- Create: `renderer/editor-notes-ui.js`
- Create: `tests/editor-notes-ui.test.js`
- Modify: `renderer/editor-tab.js` (layout, host, stato, cambio del testo, chiusura e rinomina di un file)
- Modify: `renderer/index.html` (script dopo `editor-copy-ui.js`)
- Modify: `renderer/styles.css` (dopo il blocco `.monaco-editor .editor-gutter-*`, prima di `.editor-menu`)
- Modify: `tests/renderer-source.js` (`RENDERER_APP_FILES`)
- Modify: `tests/renderer-load.test.js` (`renderEditorNotes` fra le funzioni attese)
- Modify: `tests/editor-tab-setup.js` (host finto con segni e zone, stato dei commenti)

**Interfaces:**
- Consumes: `AisessEditorNotes` (Task 1), i metodi dell'host dei Task 2 e 3, `editorConfirm.ask`, `showEditorMessage`, `errorText`, `window.aisess.clipboardWrite(text) → { ok } | { ok: false, error }`.
- Produces (scope globale):
  - `openEditorNoteDraft(tab, rel, from, to, noteId = null)`: apre la casella sotto `to`. Senza `noteId` crea un segno, con `noteId` riscrive quel commento. Una casella per volta.
  - `saveEditorNoteDraft(tab, body)` e `closeEditorNoteDraft(tab)`.
  - `editEditorNote(tab, id)`, `removeEditorNote(tab, id)`, `clearEditorNotes(tab)`.
  - `renderEditorNotes(tab)` (zone dei commenti salvati e riga in testa) e `renderEditorNotesBar(tab)`.
  - `copyEditorNotes(tab, anchor)`.
  - `syncEditorNotes(tab, rel)`: le righe dei commenti dai segni dell'host.
  - `dropEditorNotes(tab, rel)` e `renameEditorNotes(tab, from, to)`.
- Stato della scheda (`tab.editor`): `notes` (stato di `EditorNotes`), `noteViews` (`Map` id → `{ zone, node, ro, label }`), `noteDraft` (`{ rel, noteId, track, zone, node, ro, warn } | null`), `ui.notesBar`.
- DOM: la zona è un `div.editor-note-zone` che contiene i riquadri del pannello modifiche (`changes-comment`, `changes-comment-editor` e figli). La riga in testa è `div.editor-notes-bar` in `.editor-head`, dopo le sotto-schede, con `span.editor-notes-count`, `button.editor-notes-copy` «Copia prompt» e `button.editor-notes-clear` «Svuota».

- [ ] **Step 1: host finto e stato nel setup dei test**

In `tests/editor-tab-setup.js`, nell'oggetto restituito da `fakeHost`, dopo `reveal(rel, line) {…},`:

```js
    // Commenti (docs/plans/65): segni e zone in due mappe, id da un contatore solo
    marks: new Map(), zones: new Map(), seq: 0,
    trackLines(rel, from, to) { const id = `m${++this.seq}`; this.marks.set(id, { rel, from, to }); return id; },
    linesOf(id) { const m = this.marks.get(id); return m ? { from: m.from, to: m.to } : null; },
    untrack(id) { this.marks.delete(id); },
    lineText: (rel, line) => (rel in texts ? texts[rel].split(/\r\n|\r|\n/)[line - 1] : null),
    addZone(rel, afterLine, node, height) { const id = `z${++this.seq}`; this.zones.set(id, { rel, afterLine, node, height }); return id; },
    removeZone(id) { this.zones.delete(id); },
    resizeZone() {},
    focus: () => {},
```

In `setup`, nell'oggetto `editor` della scheda: `ui` prende anche `notesBar: stub()`, e dopo `gutterReads: new Map(),` si aggiunge:

```js
      notes: page.ctx.AisessEditorNotes.empty(), noteViews: new Map(), noteDraft: null,
```

- [ ] **Step 2: scrivere i test che falliscono**

Creare `tests/editor-notes-ui.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, fire } = require('./fake-dom');
const { settle, setup, plain } = require('./editor-tab-setup');

/* I commenti nella scheda editor (renderer/editor-notes-ui.js, docs/plans/65):
   la pagina vera con un document di fake-dom; Monaco è l'host finto di
   editor-tab-setup.js, che tiene segni e zone in due mappe. */

function fakeDocument() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}

const TEXT = 'uno\ndue\ntre\nquattro';

function notesSetup(main = {}) {
  const s = setup({ files: { 'a.js': { text: TEXT, mtime: 1 }, 'b.js': { text: 'bi', mtime: 1 } }, main });
  s.page.ctx.document = fakeDocument();
  s.tab.editor.ui.notesBar = createElement('div');
  s.tab.editor.ui.notesBar.hidden = true;
  s.tab.editor.ui.message = createElement('div');
  const zones = () => [...s.host.zones.values()];
  const find = (root, cls) => root.querySelectorAll(`.${cls}`)[0];
  const draft = () => zones().find((z) => find(z.node, 'changes-comment-input'));
  const saved = () => zones().filter((z) => find(z.node, 'changes-comment'));
  const write = (text, key = { key: 'Enter', ctrlKey: true }) => {
    const input = find(draft().node, 'changes-comment-input');
    input.value = text;
    return fire(input, 'keydown', key);
  };
  const bar = () => s.tab.editor.ui.notesBar;
  return { ...s, zones, find, draft, saved, write, bar, notes: () => plain(s.tab.editor.notes.notes) };
}

ok('commenti editor: la riga dei commenti sta in testa dopo le sotto-schede, nascosta', () => {
  const s = setup();
  s.page.ctx.document = fakeDocument();
  const wrap = createElement('div');
  const ui = s.fn('buildEditorLayout')({ ...s.tab, wrap });
  const head = wrap.children[2].children[0];
  assert.deepStrictEqual(head.children.map((c) => c.className), ['btn btn--ghost editor-tree-toggle', 'editor-subtabs', 'editor-notes-bar']);
  assert.strictEqual(ui.notesBar, head.children[2]);
  assert.strictEqual(ui.notesBar.hidden, true);
});

ok('commenti editor: si apre la casella sotto le righe, Ctrl+Invio salva il commento', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 3);
  const d = s.draft();
  assert.deepStrictEqual([d.rel, d.afterLine], ['a.js', 3]);
  assert.strictEqual(s.find(d.node, 'changes-comment-lines').textContent, 'Righe 2–3');
  assert.strictEqual(s.find(d.node, 'changes-comment-input').focused, true);
  assert.strictEqual(fire(d.node, 'keydown', { key: 'a' }).propagationStopped, true, 'i tasti non arrivano a Monaco');
  const e = s.write('  Qui manca il null.  ');
  assert.strictEqual(e.defaultPrevented, true);
  assert.deepStrictEqual(s.notes(), [{ id: 'n1', rel: 'a.js', from: 2, to: 3, body: 'Qui manca il null.', track: 'm1' }]);
  assert.deepStrictEqual([...s.host.marks.keys()], ['m1'], 'il segno della casella passa al commento');
  assert.strictEqual(s.draft(), undefined);
  const [z] = s.saved();
  assert.strictEqual(z.afterLine, 3);
  assert.strictEqual(s.find(z.node, 'changes-comment-range').textContent, 'Righe 2–3');
  assert.strictEqual(s.find(z.node, 'changes-comment-body').textContent, 'Qui manca il null.');
  assert.strictEqual(s.bar().hidden, false);
  assert.deepStrictEqual(s.bar().children.map((c) => c.textContent), ['1 commento', 'Copia prompt', 'Svuota']);
});

ok('commenti editor: Esc chiude la casella senza commento e toglie il segno', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 4, 4);
  const e = s.write('a metà', { key: 'Escape' });
  assert.strictEqual(e.defaultPrevented, true);
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
});

ok('commenti editor: un commento vuoto non si salva e la casella lo dice; una casella per volta', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('   ');
  const warn = s.find(s.draft().node, 'changes-comment-warn');
  assert.strictEqual(warn.hidden, false);
  assert.strictEqual(warn.textContent, ' · Il commento è vuoto.');
  assert.deepStrictEqual(s.notes(), []);
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 3, 3);
  assert.strictEqual(s.zones().length, 1);
  assert.deepStrictEqual([...s.host.marks.values()].map((m) => m.from), [3]);
});

ok('commenti editor: ✎ riapre la casella col testo al posto del commento, ✕ lo toglie', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 2);
  s.write('prima');
  s.find(s.saved()[0].node, 'changes-comment-edit').onclick();
  assert.strictEqual(s.saved().length, 0, 'il commento lascia il posto alla casella');
  assert.strictEqual(s.find(s.draft().node, 'changes-comment-input').value, 'prima');
  s.write('x', { key: 'Escape' });
  assert.strictEqual(s.saved().length, 1, 'Esc rimette il commento com era');
  s.find(s.saved()[0].node, 'changes-comment-edit').onclick();
  s.write('dopo');
  assert.deepStrictEqual(s.notes().map((n) => [n.id, n.body, n.track]), [['n1', 'dopo', 'm1']]);
  assert.strictEqual(s.saved().length, 1);
  s.find(s.saved()[0].node, 'changes-comment-remove').onclick();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: Copia prompt mette il prompt negli appunti e chiede se svuotare', async () => {
  const s = notesSetup();
  const asked = [];
  let answer = false;
  s.run('editorConfirm').ask = async (o) => { asked.push(o); return answer; };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 2);
  s.write('Manca il null.');
  const copy = s.find(s.bar(), 'editor-notes-copy');
  copy.onclick();
  await settle();
  assert.deepStrictEqual(s.sent('clipboardWrite').map((c) => c[1]), [
    ['Correggi questi punti del codice:', '', '1. a.js:2', '   > due', '   Manca il null.'].join('\n'),
  ]);
  assert.deepStrictEqual(plain(asked.map((o) => [o.title, o.confirmLabel])), [['Copiato. Svuoto i commenti?', 'Svuota']]);
  assert.strictEqual(asked[0].anchor, copy);
  assert.strictEqual(s.notes().length, 1, 'Annulla: i commenti restano');
  answer = true;
  copy.onclick();
  await settle();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: se la copia non riesce lo dice e non chiede niente', async () => {
  const s = notesSetup({ clipboardWrite: async () => ({ ok: false, error: 'testo vuoto' }) });
  let asked = 0;
  s.run('editorConfirm').ask = async () => { asked += 1; return true; };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('x');
  await s.find(s.bar(), 'editor-notes-copy').onclick();
  assert.strictEqual(s.tab.editor.ui.message.textContent, 'Prompt non copiato: testo vuoto');
  assert.strictEqual(s.tab.editor.ui.message.hidden, false);
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.notes().length, 1);
});

ok('commenti editor: Svuota toglie tutto senza chiedere, anche la casella aperta', () => {
  const s = notesSetup();
  s.run('editorConfirm').ask = async () => { throw new Error('Svuota non chiede'); };
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('uno');
  s.fn('openEditorNoteDraft')(s.tab, 'b.js', 1, 1);
  s.write('due');
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 3, 3);
  assert.strictEqual(s.bar().children[0].textContent, '2 commenti');
  s.find(s.bar(), 'editor-notes-clear').onclick();
  assert.deepStrictEqual(s.notes(), []);
  assert.strictEqual(s.zones().length, 0);
  assert.strictEqual(s.host.marks.size, 0);
  assert.strictEqual(s.bar().hidden, true);
});

ok('commenti editor: quando il testo cambia il commento segue il suo segno', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 2, 3);
  s.write('x');
  s.host.marks.set('m1', { rel: 'a.js', from: 4, to: 5 });
  s.fn('onEditorTextChange')(s.tab, 'a.js', false, false);
  assert.deepStrictEqual(s.notes().map((n) => [n.from, n.to]), [[4, 5]]);
  assert.strictEqual(s.find(s.saved()[0].node, 'changes-comment-range').textContent, 'Righe 4–5');
});

ok('commenti editor: chiudere un file ne toglie i commenti, rinominarlo li porta col nome nuovo', () => {
  const s = notesSetup();
  s.fn('openEditorNoteDraft')(s.tab, 'a.js', 1, 1);
  s.write('di a');
  s.fn('openEditorNoteDraft')(s.tab, 'b.js', 1, 1);
  s.write('di b');
  s.fn('dropEditorFile')(s.tab, 'a.js');
  assert.deepStrictEqual(s.notes().map((n) => n.body), ['di b']);
  assert.deepStrictEqual(s.saved().map((z) => z.rel), ['b.js']);
  assert.deepStrictEqual([...s.host.marks.values()].map((m) => m.rel), ['b.js']);
  s.fn('renameEditorNotes')(s.tab, 'b.js', 'c.js');
  assert.deepStrictEqual(s.notes().map((n) => n.rel), ['c.js']);
});
```

In `tests/renderer-load.test.js`, nel secondo test, l'elenco atteso finisce con:

```js
    'createEditorTab', 'initEditorTabs', 'loadEditorGutterBase', 'renderEditorNotes'];
```

- [ ] **Step 3: verificare che falliscano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-notes-ui.test.js tests/renderer-load.test.js`
Expected: FAIL. Il primo test dà due figli invece di tre in `.editor-head`, gli altri `openEditorNoteDraft is not defined`, e renderer-load dà `missing: ['renderEditorNotes']`.

- [ ] **Step 4: `renderer/editor-notes-ui.js`**

Creare `renderer/editor-notes-ui.js`:

```js
/* Commenti sul codice nella scheda editor (docs/plans/65): la casella
   sotto le righe, i commenti salvati, la riga «N commenti · Copia prompt ·
   Svuota» in testa. Il modello è editor-notes.js; dove stanno le righe e le
   zone sotto di loro lo sa l'host di Monaco (trackLines, addZone). Script
   dell'app, caricato dopo editor-tab.js: ne usa le funzioni
   (showEditorMessage, editorConfirm, errorText) dallo scope globale.
   I commenti vivono in memoria, nella scheda: non si salvano. Testo del
   commento e righe del file passano solo da textContent. */

const EditorNotes = window.AisessEditorNotes;
const NOTE_ZONE_PX = { saved: 44, draft: 132 }; // finché il riquadro non si misura

function noteEl(tag, className, text) {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function noteButton(className, label, title, run) {
  const b = noteEl('button', className, label);
  b.type = 'button';
  b.title = title;
  b.onclick = run;
  return b;
}

/* La zona di Monaco è alta quanto le si dice: si misura il riquadro e la si aggiusta */
function editorNoteZone(tab, rel, afterLine, box, kind) {
  const ed = tab.editor;
  const node = noteEl('div', 'editor-note-zone');
  node.appendChild(box);
  // I tasti scritti nel commento non arrivano alle scorciatoie di Monaco né della pagina
  node.addEventListener('keydown', (e) => e.stopPropagation());
  const zone = ed.host.addZone(rel, afterLine, node, NOTE_ZONE_PX[kind]);
  let ro = null;
  if (zone && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (ed.host) ed.host.resizeZone(zone, Math.ceil(box.offsetHeight) + 6); });
    ro.observe(box);
  }
  return { zone, node, ro };
}

function dropEditorNoteZone(tab, view) {
  if (view.ro) view.ro.disconnect();
  if (tab.editor.host && view.zone) tab.editor.host.removeZone(view.zone);
}

function editorNoteBox(tab, n) {
  const box = noteEl('div', 'changes-comment');
  const label = noteEl('span', 'changes-comment-range', EditorNotes.labelOf(n));
  box.append(
    label,
    noteEl('span', 'changes-comment-body', n.body),
    noteButton('changes-comment-edit', '✎', 'Modifica il commento', () => editEditorNote(tab, n.id)),
    noteButton('changes-comment-remove', '✕', 'Elimina il commento', () => removeEditorNote(tab, n.id)),
  );
  return { box, label };
}

function editorNoteDraftBox(tab, label, body) {
  const box = noteEl('div', 'changes-comment-editor');
  const lines = noteEl('div', 'changes-comment-lines', label);
  const warn = noteEl('span', 'changes-comment-warn');
  warn.hidden = true;
  lines.appendChild(warn);
  const input = noteEl('textarea', 'changes-comment-input');
  input.value = body;
  input.setAttribute('aria-label', 'Commento per l\'agente');
  input.placeholder = 'Cosa deve correggere l\'agente qui?';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditorNoteDraft(tab, input.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditorNoteDraft(tab); if (tab.editor.host) tab.editor.host.focus(); }
  });
  const actions = noteEl('div', 'changes-comment-actions');
  actions.append(
    noteEl('span', 'changes-comment-hint', 'Ctrl+Invio salva · Esc annulla'),
    noteButton('btn btn--ghost changes-comment-cancel', 'Annulla', 'Annulla', () => closeEditorNoteDraft(tab)),
    noteButton('btn btn--primary changes-comment-save', 'Salva', 'Salva il commento', () => saveEditorNoteDraft(tab, input.value)),
  );
  box.append(lines, input, actions);
  return { box, input, warn };
}

/** «N commenti · Copia prompt · Svuota», nascosta senza commenti */
function renderEditorNotesBar(tab) {
  const ed = tab.editor;
  const bar = ed.ui.notesBar;
  const n = EditorNotes.count(ed.notes);
  bar.hidden = n === 0;
  if (!n) { bar.replaceChildren(); return; }
  const copy = noteButton('btn btn--ghost editor-notes-copy', 'Copia prompt',
    'Copia negli appunti un prompt con tutti i commenti', () => copyEditorNotes(tab, copy));
  bar.replaceChildren(
    noteEl('span', 'editor-notes-count', EditorNotes.countLabel(n)),
    copy,
    noteButton('btn btn--ghost editor-notes-clear', 'Svuota', 'Togli tutti i commenti', () => clearEditorNotes(tab)),
  );
}

/** Rifà le zone dei commenti salvati e la riga in testa. Quello che si sta riscrivendo ha la casella al suo posto */
function renderEditorNotes(tab) {
  const ed = tab.editor;
  renderEditorNotesBar(tab);
  for (const v of ed.noteViews.values()) dropEditorNoteZone(tab, v);
  if (!ed.host) { ed.noteViews = new Map(); return; }
  const editing = ed.noteDraft && ed.noteDraft.noteId;
  ed.noteViews = new Map(ed.notes.notes.filter((n) => n.id !== editing).map((n) => {
    const { box, label } = editorNoteBox(tab, n);
    return [n.id, { ...editorNoteZone(tab, n.rel, n.to, box, 'saved'), label }];
  }));
}

/* La casella sotto le righe: nuova (`noteId` null, con un segno suo) o per riscrivere un commento */
function openEditorNoteDraft(tab, rel, from, to, noteId = null) {
  const ed = tab.editor;
  if (!ed.host || !ed.files.files[rel]) return;
  closeEditorNoteDraft(tab);
  const old = noteId ? EditorNotes.find(ed.notes, noteId) : null;
  if (noteId && !old) return;
  const track = old ? null : ed.host.trackLines(rel, from, to);
  if (!old && !track) return;
  const parts = editorNoteDraftBox(tab, EditorNotes.labelOf({ from, to }), old ? old.body : '');
  ed.noteDraft = { rel, noteId, track, warn: parts.warn, ...editorNoteZone(tab, rel, to, parts.box, 'draft') };
  if (old) renderEditorNotes(tab);
  parts.input.focus();
}

function closeEditorNoteDraft(tab) {
  const ed = tab.editor;
  const d = ed.noteDraft;
  if (!d) return;
  ed.noteDraft = null;
  dropEditorNoteZone(tab, d);
  if (d.track && ed.host) ed.host.untrack(d.track);
  if (d.noteId) renderEditorNotes(tab); // il commento torna al suo posto
}

function saveEditorNoteDraft(tab, body) {
  const ed = tab.editor;
  const d = ed.noteDraft;
  if (!d || !ed.host) return;
  const at = d.track ? ed.host.linesOf(d.track) : null;
  const r = d.noteId
    ? EditorNotes.update(ed.notes, d.noteId, body)
    : EditorNotes.add(ed.notes, { rel: d.rel, ...(at || {}), body, track: d.track });
  if (!r.ok) {
    d.warn.textContent = ` · ${r.error}`;
    d.warn.hidden = false;
    return;
  }
  ed.notes = r.state;
  ed.noteDraft = { ...d, track: null, noteId: null }; // il segno ora è del commento
  closeEditorNoteDraft(tab);
  renderEditorNotes(tab);
  ed.host.focus();
}

function editEditorNote(tab, id) {
  const n = EditorNotes.find(tab.editor.notes, id);
  if (n) openEditorNoteDraft(tab, n.rel, n.from, n.to, id);
}

function removeEditorNote(tab, id) {
  const ed = tab.editor;
  const n = EditorNotes.find(ed.notes, id);
  if (!n) return;
  if (ed.host && n.track) ed.host.untrack(n.track);
  ed.notes = EditorNotes.remove(ed.notes, id);
  renderEditorNotes(tab);
}

function clearEditorNotes(tab) {
  const ed = tab.editor;
  closeEditorNoteDraft(tab);
  if (ed.host) ed.notes.notes.forEach((n) => { if (n.track) ed.host.untrack(n.track); });
  ed.notes = EditorNotes.clear(ed.notes);
  renderEditorNotes(tab);
}

const editorNoteText = (tab) => (rel, line) => (tab.editor.host && tab.editor.host.lineText(rel, line)) || '';

async function copyEditorNotes(tab, anchor) {
  const text = EditorNotes.promptFor(tab.editor.notes, editorNoteText(tab));
  if (!text) return;
  let r;
  try { r = await window.aisess.clipboardWrite(text); } catch (e) { r = { ok: false, error: errorText(e) }; }
  if (!r || !r.ok) { showEditorMessage(tab, `Prompt non copiato: ${(r && r.error) || 'errore sconosciuto.'}`); return; }
  const yes = await editorConfirm.ask({
    anchor, title: 'Copiato. Svuoto i commenti?',
    text: 'Il prompt è negli appunti: incollalo nella sessione dell\'agente.', confirmLabel: 'Svuota',
  });
  if (yes) clearEditorNotes(tab);
}

/** Il testo è cambiato: le righe dei commenti del file dai segni dell'host */
function syncEditorNotes(tab, rel) {
  const ed = tab.editor;
  if (!ed.host || !EditorNotes.count(ed.notes, rel)) return;
  let notes = ed.notes;
  for (const n of EditorNotes.forFile(notes, rel)) {
    const at = n.track ? ed.host.linesOf(n.track) : null;
    if (at) notes = EditorNotes.move(notes, n.id, at);
  }
  if (notes === ed.notes) return;
  ed.notes = notes;
  for (const n of EditorNotes.forFile(notes, rel)) {
    const v = ed.noteViews.get(n.id);
    if (v) v.label.textContent = EditorNotes.labelOf(n);
  }
}

/* Il file si chiude: i suoi commenti vanno via (chi chiama ha già chiesto) */
function dropEditorNotes(tab, rel) {
  const ed = tab.editor;
  if (ed.noteDraft && ed.noteDraft.rel === rel) closeEditorNoteDraft(tab);
  const gone = EditorNotes.forFile(ed.notes, rel);
  if (!gone.length) return;
  if (ed.host) gone.forEach((n) => { if (n.track) ed.host.untrack(n.track); });
  ed.notes = EditorNotes.dropFile(ed.notes, rel);
  renderEditorNotes(tab);
}

/* Il file ha cambiato nome: l'host ha già spostato segni e zone (rename) */
function renameEditorNotes(tab, from, to) {
  const ed = tab.editor;
  ed.notes = EditorNotes.renameFile(ed.notes, from, to);
  if (ed.noteDraft && ed.noteDraft.rel === from) ed.noteDraft = { ...ed.noteDraft, rel: to };
}
```

- [ ] **Step 5: cablaggio in `renderer/editor-tab.js`**

1. In `buildEditorLayout`, dopo `subtabs.setAttribute('role', 'tablist');`:

```js
  // «N commenti · Copia prompt · Svuota» (docs/plans/65), la disegna editor-notes-ui.js
  const notesBar = el('div', 'editor-notes-bar', head);
  notesBar.hidden = true;
```

e il `return` diventa `return { treeHost, tree, subtabs, notesBar, bar, message, host };`.

2. In `ensureEditorHost`, nelle opzioni di `createEditorHost`, dopo `onSaveAll`:

```js
        onComment: (rel, from, to) => openEditorNoteDraft(tab, rel, from, to),
```

3. `onEditorTextChange` allinea i commenti a ogni cambio. Anche con `edited` false: dopo una ricarica dal disco l'host rimette i segni a sostituzione finita, e l'ultimo avviso è quello di `markSaved`.

```js
function onEditorTextChange(tab, rel, dirty, edited = true) {
  const f = tab.editor.files.files[rel];
  if (!f) return;
  if (f.dirty !== dirty) setEditorFile(tab, rel, { dirty });
  syncEditorNotes(tab, rel);
  if (edited) scheduleEditorGutter(tab, rel);
}
```

4. In `dropEditorFile`, prima di `if (ed.host) {`:

```js
  dropEditorNotes(tab, rel);
```

5. In `renameEditorEntry`, dopo `if (ed.host) ed.host.rename(rel, to);`:

```js
    renameEditorNotes(tab, rel, to);
```

6. In `createEditorTab`, nell'oggetto `tab.editor`, dopo `gutterReads: new Map(),`:

```js
    notes: EditorNotes.empty(), noteViews: new Map(), noteDraft: null,
```

- [ ] **Step 6: pagina e stile**

In `renderer/index.html`, dopo `<script src="editor-copy-ui.js"></script>`:

```html
<script src="editor-notes-ui.js"></script>
```

In `tests/renderer-source.js`, in `RENDERER_APP_FILES` dopo `'editor-copy-ui.js',`:

```js
  'editor-notes-ui.js',
```

In `renderer/styles.css`, dopo l'ultima regola `.monaco-editor .editor-gutter-del-end::after { … }` e prima di `.editor-menu`:

```css
/* Commenti sul codice (docs/plans/65): i riquadri del pannello modifiche
   dentro le zone di Monaco, che le posizionano da sé (niente sticky); il
   fondo sulle righe commentate; il «+» nel margine dei glifi */
.editor-note-zone { box-sizing: border-box; padding: 0 16px 0 4px; }
.editor-note-zone .changes-comment, .editor-note-zone .changes-comment-editor { position: static; }
.monaco-editor .editor-note-line { background: color-mix(in srgb, var(--action-text) 10%, transparent); }
.monaco-editor .editor-note-add { display: flex; align-items: center; justify-content: center; cursor: pointer; }
.monaco-editor .editor-note-add::before { content: '+'; font: 600 14px/1 var(--font-ui); color: var(--action-text); }
.editor-notes-bar { display: flex; align-items: center; gap: 6px; padding: 0 8px; border-left: 1px solid var(--divider); }
.editor-notes-bar[hidden] { display: none; }
.editor-notes-count { font: 12px var(--font-ui); color: var(--action-text); white-space: nowrap; }
.editor-notes-bar .btn { font-size: 12px; padding: 2px 8px; }
```

- [ ] **Step 7: verificare che passino**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: PASS, 1678 test (1668 + 10), 1 skip. I test di prima su `editor-tab` e `editor-tab-gutter` passano col setup nuovo.

- [ ] **Step 8: commit**

```bash
git add renderer/editor-notes-ui.js renderer/editor-tab.js renderer/index.html renderer/styles.css tests/editor-notes-ui.test.js tests/editor-tab-setup.js tests/renderer-source.js tests/renderer-load.test.js
cat > /tmp/msg.txt <<'EOF'
feat: commenti nella scheda editor e prompt negli appunti

La casella si apre sotto le righe scelte e il commento salvato resta
lì, con ✎ e ✕, nello stesso aspetto dei commenti del pannello
modifiche, di cui si riusano le classi. Le righe seguono il segno
dell'host a ogni cambio del testo. In testa alla scheda «N commenti ·
Copia prompt · Svuota»: la copia passa da clipboardWrite e poi chiede
se svuotare, perché di solito il prompt si incolla una volta sola.
Chiudere o rinominare un file porta via o sposta i suoi commenti. Tutto
in memoria, come chiede la spec.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git commit --file=/tmp/msg.txt
```

---

### Task 5: chiudere un file o la scheda con commenti chiede

**Files:**
- Modify: `renderer/editor-notes-ui.js` (`editorNotesLoss`)
- Modify: `renderer/editor-tab.js` (`closeEditorFile`, `confirmEditorClose`)
- Modify: `tests/editor-tab.test.js` (quattro test in fondo)

**Interfaces:**
- Consumes: `EditorNotes.count`, `editorConfirm.ask`/`choose`, `closeConfirm.ask`/`choose` (`tabs.js:303`), il cui `ask` vuole sempre un `text` non vuoto, perché senza mostra quello della chiusura di una sessione.
- Produces:
  - `editorNotesLoss(n, what) → string`: `''` con zero commenti, altrimenti «Chiudendo il file si perde il commento.» o «Chiudendo la scheda si perdono 3 commenti.».
  - `closeEditorFile`: un file pulito con commenti chiede «Chiudere «a.js»?» (Chiudi/Annulla). Un file con modifiche ha la scelta di sempre, col testo dei commenti.
  - `confirmEditorClose`: una scheda senza modifiche e con commenti chiede «Chiudere «nome»?», nel fumetto della card se c'è `anchor`. Con modifiche, la scelta di sempre col testo dei commenti. Il valore restituito è quello di prima (`true` per chiudere).

- [ ] **Step 1: scrivere i test che falliscono**

In fondo a `tests/editor-tab.test.js`:

```js
/* ---------- chiudere con commenti (docs/plans/65) ---------- */

function withNote(s, rel) {
  s.tab.editor.notes = s.run('EditorNotes').add(s.tab.editor.notes, { rel, from: 1, to: 1, body: 'x', track: null }).state;
}

ok('commenti: chiudere un file pulito con commenti chiede, e Annulla lo tiene aperto', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 } } });
  const asked = [];
  let answer = false;
  s.run('editorConfirm').ask = async (o) => { asked.push(o); return answer; };
  withNote(s, 'a.js');
  withNote(s, 'a.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', 'ancora');
  assert.deepStrictEqual(plain(asked.map((o) => [o.anchor, o.title, o.text, o.confirmLabel])),
    [['ancora', 'Chiudere «a.js»?', 'Chiudendo il file si perdono 2 commenti.', 'Chiudi']]);
  assert.ok(s.file('a.js'));
  answer = true;
  await s.fn('closeEditorFile')(s.tab, 'a.js', 'ancora');
  assert.strictEqual(s.file('a.js'), undefined);
  assert.strictEqual(s.run('EditorNotes').count(s.tab.editor.notes), 0);
});

ok('commenti: chiudere un file pulito senza commenti non chiede, e i commenti degli altri restano', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 }, 'b.js': { text: 'due', mtime: 1 } } });
  let asked = 0;
  s.run('editorConfirm').ask = async () => { asked += 1; return false; };
  withNote(s, 'b.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', null);
  assert.strictEqual(asked, 0);
  assert.strictEqual(s.file('a.js'), undefined);
  assert.strictEqual(s.run('EditorNotes').count(s.tab.editor.notes), 1);
});

ok('commenti: chiudere un file con modifiche e commenti è la scelta di sempre, che dice dei commenti', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1, dirty: true } } });
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return 'discard'; };
  withNote(s, 'a.js');
  await s.fn('closeEditorFile')(s.tab, 'a.js', null);
  assert.deepStrictEqual(plain(asked.map((o) => [o.title, o.text, o.choices.map((c) => c.value)])),
    [['«a.js» ha modifiche non salvate', 'Chiudendo il file si perde il commento.', ['save', 'discard']]]);
  assert.strictEqual(s.file('a.js'), undefined);
});

ok('commenti: chiudere la scheda con commenti chiede, nel fumetto della card o dell editor', async () => {
  const s = setup({ files: { 'a.js': { text: 'uno', mtime: 1 } } });
  const asked = [];
  s.run('closeConfirm').ask = async (o) => { asked.push(o); return false; };
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab, 'card'), true, 'niente commenti né modifiche: non chiede');
  withNote(s, 'a.js');
  withNote(s, 'a.js');
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab, 'card'), false);
  assert.deepStrictEqual(plain(asked.map((o) => [o.anchor, o.key, o.title, o.text, o.confirmLabel])),
    [['card', 'tab-ed', 'Chiudere «w»?', 'Chiudendo la scheda si perdono 2 commenti.', 'Chiudi']]);
  s.tab.editor.files = s.run('EditorFiles').update(s.tab.editor.files, 'a.js', { dirty: true });
  const chosen = [];
  s.run('editorConfirm').choose = async (o) => { chosen.push(o); return null; };
  assert.strictEqual(await s.fn('confirmEditorClose')(s.tab), false);
  assert.deepStrictEqual(plain(chosen.map((o) => [o.key, o.text])), [[null, 'Chiudendo la scheda si perdono 2 commenti.']]);
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-tab.test.js`
Expected: FAIL nel primo, terzo e quarto test nuovi. Nel primo `asked` è vuoto e il file si chiude subito, nel terzo `text` è `undefined`, nel quarto `confirmEditorClose` dà `true`. Il secondo passa già, ed è giusto: fissa che senza commenti non cambia niente.

- [ ] **Step 3: le domande**

In fondo a `renderer/editor-notes-ui.js`:

```js
/** Per le domande di chiusura: cosa si perde; vuoto se non ci sono commenti */
function editorNotesLoss(n, what) {
  if (!n) return '';
  return n === 1 ? `Chiudendo ${what} si perde il commento.` : `Chiudendo ${what} si perdono ${n} commenti.`;
}
```

In `renderer/editor-tab.js`, `closeEditorFile` diventa:

```js
async function closeEditorFile(tab, rel, anchor) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f) return;
  const name = EditorFiles.baseName(rel);
  const loss = editorNotesLoss(EditorNotes.count(ed.notes, rel), 'il file'); // docs/plans/65
  if (f.dirty) {
    const choice = await editorConfirm.choose({
      anchor, title: `«${name}» ha modifiche non salvate`, text: loss,
      choices: [{ value: 'save', label: 'Salva' }, { value: 'discard', label: 'Scarta', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save' && !(await saveEditorFile(tab, rel))) return;
  } else if (loss && !(await editorConfirm.ask({ anchor, title: `Chiudere «${name}»?`, text: loss, confirmLabel: 'Chiudi' }))) {
    return;
  }
  dropEditorFile(tab, rel);
  saveEditorSessions();
}
```

`confirmEditorClose` diventa:

```js
/** Chiudendo la scheda: i file con modifiche si salvano o si scartano, i commenti si perdono (docs/plans/65). */
async function confirmEditorClose(tab, anchor) {
  const dirty = EditorFiles.dirtyFiles(tab.editor.files);
  const loss = editorNotesLoss(EditorNotes.count(tab.editor.notes), 'la scheda');
  if (!dirty.length && !loss) return true;
  const bubble = anchor ? closeConfirm : editorConfirm;
  const where = { anchor: anchor || tab.editor.ui.subtabs, key: anchor ? tab.id : null };
  if (!dirty.length) return bubble.ask({ ...where, title: `Chiudere «${tab.name}»?`, text: loss, confirmLabel: 'Chiudi' });
  const choice = await bubble.choose({
    ...where, text: loss,
    title: dirty.length === 1 ? `«${EditorFiles.baseName(dirty[0])}» ha modifiche non salvate` : `${dirty.length} file con modifiche non salvate`,
    choices: [{ value: 'save', label: 'Salva tutto' }, { value: 'discard', label: 'Scarta', danger: true }],
  });
  if (!choice) return false;
  return choice === 'save' ? saveAllEditorFiles(tab) : true;
}
```

`choose` con `text: ''` si comporta come prima, che non lo passava: il default è `''`.

- [ ] **Step 4: verificare che passino**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: PASS, 1682 test (1678 + 4), 1 skip.

- [ ] **Step 5: commit**

```bash
git add renderer/editor-notes-ui.js renderer/editor-tab.js tests/editor-tab.test.js
cat > /tmp/msg.txt <<'EOF'
feat: chiudere un file o la scheda editor coi commenti chiede

I commenti vivono solo in memoria: chiudere il file o la scheda li
perde senza rimedio. Un file pulito con commenti ora chiede, come chiede
la spec. Uno con modifiche ha la scelta di sempre, che dice anche dei
commenti. La scheda fa lo stesso, nel fumetto della card come per le
modifiche: perdere una ventina di commenti con un click sulla ✕ è
peggio che perderne uno, anche se la spec non lo chiede.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

```bash
git commit --file=/tmp/msg.txt
```

---

## Punti aperti

- **Le zone si perdono a ogni `setModel`.** Monaco butta la vista quando cambia model (`_detachModel`), e le zone sono della vista. L'host le tiene per file e le rimette in `activate`, così in ogni momento sono nella vista solo quelle del file davanti. Un cambio di model che non passa da `activate` (oggi nessuno) le perderebbe fino al prossimo.
- **Percorsi nel prompt:** sono relativi alla cartella della scheda editor. Se la sessione dell'agente gira in un'altra cartella (una scheda editor su `lib/`, l'agente sulla radice), i percorsi non combaciano. L'agente di solito li ritrova dal testo citato. Se dà fastidio, si può prefissare il percorso relativo alla radice del progetto (`tab.projectRoot`).
- **Righe tolte del tutto:** se si cancellano tutte le righe di un commento, il segno si stringe sul punto della cancellazione e il commento resta lì, su una riga sola. Non sparisce, come le orfane del pannello.
- **Ricarica dal disco:** `replaceText` sostituisce tutto il testo, quindi i segni restano agli stessi numeri e non seguono il testo. Se l'agente aggiunge righe sopra un commento, il commento resta al numero di prima. Seguire il testo vorrebbe un diff fra il testo vecchio e quello nuovo, come fanno le barrette.
- **Tasti nella casella:** il `keydown` della zona non sale, così le scorciatoie di Monaco non scattano mentre si scrive. Neanche Ctrl+S salva il file da lì dentro: si salva dopo, dall'editor.
- **Altezza della zona:** viene da un `ResizeObserver` sul riquadro (+6 px di margine). Finché non risponde vale l'altezza di partenza (44 o 132 px).
- **Il margine dei glifi** è una colonna in più, sempre visibile, a sinistra dei numeri di riga, anche nei file senza commenti.
- **Uscire dall'app** con commenti non chiede niente: `askEditorExit` guarda solo i file con modifiche. La spec non ne parla.
- **Le domande di chiusura** per i commenti valgono anche quando un worktree chiude le sue schede (`worktrees.js:37` chiama `confirmEditorClose`).

## Da verificare a mano (dopo i task)

Nell'app (`npm start` dal worktree, lo fa l'utente):
- Passare col mouse su una riga: il «+» nel margine segue il mouse e sparisce uscendo dall'editor. Clic sul «+»: la casella si apre sotto la riga, col fuoco nel testo e le righe col fondo leggero.
- Selezionare tre righe, poi click destro: c'è «Commenta selezione», senza selezione c'è «Commenta riga». Il clic sul «+» di una riga dentro la selezione commenta tutta la selezione.
- Ctrl+Invio salva, Esc annulla. Mentre si scrive nella casella, Ctrl+Z, Ctrl+D e Tab non toccano il codice.
- La zona è alta quanto il riquadro, anche con un commento di dieci righe. Il riquadro non copre il codice sotto.
- Scrivere righe sopra un commento: riquadro e fondo scendono con le righe, l'etichetta «Riga N» si aggiorna.
- Passare a un altro file e tornare: i commenti ci sono ancora.
- «Copia prompt», poi incollare in una sessione claude: intestazione «Correggi questi punti del codice:», percorsi giusti, righe citate. Il fumetto «Copiato. Svuoto i commenti?» svuota con «Svuota» e lascia tutto com'è con «Annulla».
- Chiudere un file con commenti chiede, chiudere la scheda dalla ✕ della card chiede nel fumetto della card.
- Rinominare dall'albero un file con commenti: i commenti restano, e il prompt usa il nome nuovo.

## Autorevisione

- **Copertura della spec:**
  - Commentare qualsiasi riga o selezione: «+» nel margine e menu nel Task 3, casella con Ctrl+Invio ed Esc nel Task 4.
  - Commenti salvati sotto l'ultima riga, con modifica ed eliminazione, e sfondo sulle righe: Task 4, con la classe `editor-note-line` del segno del Task 2.
  - Il commento segue le sue righe: segni e zone nel Task 2, `syncEditorNotes` nel Task 4.
  - Riga «N commenti · Copia prompt · Svuota», prompt con l'intestazione nuova, tutti i file in ordine di file e riga, fumetto dopo la copia: Task 1 e Task 4.
  - Vita in memoria e conferma alla chiusura di un file: Task 4 e Task 5.
  - Test chiesti dalla spec: `editor-notes.test.js` e `review-notes.test.js` nel Task 1. Riga in testa e copia in `editor-notes-ui.test.js` (Task 4). Chiusura in `editor-tab.test.js` (Task 5).
- **Segnaposto:** nessuno. Ogni passo ha il codice intero o la riga esatta da cambiare, ogni test ha le asserzioni vere.
- **Coerenza dei nomi:**
  - Host: `trackLines`, `linesOf`, `untrack`, `lineText`, `addZone`, `removeZone`, `resizeZone`, `onComment`. Gli stessi nell'host vero (Task 2 e 3), nel finto di `editor-tab-setup.js` e nelle chiamate di `editor-notes-ui.js`.
  - Modello: `EditorNotes.add`, `update`, `remove`, `clear`, `dropFile`, `renameFile`, `move`, `forFile`, `count`, `find`, `labelOf`, `countLabel`, `promptFor`. Gli stessi nel Task 1 e negli usi dei Task 4 e 5.
  - Stato della scheda: `notes`, `noteViews`, `noteDraft`, `ui.notesBar`. Gli stessi in `createEditorTab`, nel setup dei test e in `editor-notes-ui.js`.
- **Conteggi:** 1645 → 1656 (+10 editor-notes, +1 review-notes) → 1665 (+9 host) → 1668 (+3 host) → 1678 (+10 UI) → 1682 (+4 chiusura). Sempre 1 skip.
- **Righe:** `editor-monaco.js` passa da 210 a circa 380, `editor-tab.js` da 703 a circa 725. `editor-notes.js` è circa 125 righe, `editor-notes-ui.js` circa 230. Fra i test, `editor-monaco.test.js` passa da 178 a circa 340, `editor-tab.test.js` da 436 a circa 500, e `editor-notes-ui.test.js` è circa 190. Tutti sotto 800.

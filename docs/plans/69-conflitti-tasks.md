# 69 — Conflitti git dall'app: passi di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vedere e risolvere dall'app un merge, rebase, cherry-pick o revert
fermo sui conflitti: pannello in modalità «Conflitti», blocchi nell'editor,
«Unisci» che chiede invece di annullare.

**Architecture:** la lettura e le scritture stanno in `lib/git-conflicts.js`
(git via argv, `run` iniettabile), esposte da quattro canali IPC. Il
renderer ha due moduli UMD puri e testati (`conflict-markers.js` per i
marcatori nel testo, `conflicts-model.js` per testata, etichette e pulsanti),
una vista (`conflicts-view.js`) che `changes-view.js` usa al posto della
lista quando c'è un'operazione a metà, e due script dell'app
(`changes-conflicts.js` per il pannello, `editor-conflicts.js` per le zone
nell'editor).

**Tech Stack:** Electron, Node `node:test` (`npm run test:unit`), git CLI,
Monaco 0.57 (host in `renderer/editor-monaco.js`).

**Spec:** `docs/plans/69-conflitti.md`.

## Global Constraints

- `lib/` non fa `require('electron')`; `main.js` resta solo cablaggio.
- git sempre con argv (`runGit`), mai la shell; `--` prima dei percorsi e
  `--literal-pathspecs`; mai `--strategy`, `-X`, `--no-verify`, `--skip`.
- `op` solo da `['merge', 'rebase', 'cherry-pick', 'revert']`.
- Nella pagina solo `textContent` (nomi di branch, messaggi di commit,
  percorsi); il contenuto dei file solo dentro Monaco.
- Windows: niente `split('/')`; percorsi con `path` della piattaforma
  (`platform` come parametro).
- Test: importano il codice vero; comportamento, non testo del sorgente;
  fixture in `tests/fixtures/conflicts/`; git vero solo in
  `tests/integration.test.js`, con `t.skip` se manca.
- Node per i test: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` prima
  di `npm run test:unit` (il node di sistema è v12).
- File sotto le 800 righe: `changes-view.js` (711), `editor-tab.js` (718),
  `changes-panel.js` (599) ricevono solo agganci di poche righe.
- Commit: `<tipo>: <cosa>` e il perché nel corpo, in italiano; refactor e
  cambi di comportamento separati. Messaggio in `/tmp/msg.txt`, poi
  `git commit --file=/tmp/msg.txt`. Ultima riga del messaggio:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scelte rispetto alla spec

- **`conflict-markers.js` sta in `renderer/`, non in `lib/`.** Il renderer
  è sandboxed e carica solo file di `renderer/`; il modulo è UMD e i test
  lo importano da lì. `lib/git-conflicts.js` non lo usa: per contare i
  blocchi e rifiutare «Segna risolto» gli bastano due espressioni regolari
  sue (`<<<<<<<` e `>>>>>>>` a inizio riga).
- **`=======` da solo non blocca «Segna risolto».** È un titolo Markdown
  valido; i marcatori che contano sono `<<<<<<<` e `>>>>>>>`.
- **La zona sta sotto la riga `<<<<<<<`**, non sopra il blocco: `addZone`
  vuole una riga ≥ 1 e un conflitto alla riga 1 non avrebbe dove stare.
- **La scelta nell'editor sostituisce tutto il testo** (`editText`, una
  `pushEditOperations` sull'intero modello fra due `pushStackElement`):
  Ctrl+Z la annulla in un colpo, come chiede la spec, e l'host non deve
  imparare le modifiche per intervallo.
- **I «Risolti» sono un elenco senza diff**, ciascuno col pulsante «Apri
  nell'editor». Il diff staged resta in modalità staging, che torna appena
  l'operazione è conclusa.
- **«Unisci» dalla scheda git** (piano 54) non ha una bolla da appoggiare:
  il selettore dei branch mostra il messaggio e il pannello si apre da sé in
  modalità Conflitti, dove ci sono sia «Concludi» sia «Annulla merge».
  «Unisci» di un worktree (36) chiede con la bolla «Risolvi / Annulla merge».
- **La linguetta chiusa non parla dei conflitti**: la lettura dei conflitti
  parte solo a pannello aperto, come «Ultimo giro» e «Da committare».

## File

| File | Cosa |
|------|------|
| `lib/worktree.js` | `busyWith` riconosce cherry-pick e revert; `abortFailedMerge` lascia il merge a metà se ci sono conflitti |
| `lib/git-commit.js` | `BUSY` per le quattro operazioni, rimanda al pannello |
| `lib/git-merge.js` | `undoMerge` lascia il merge a metà se ci sono conflitti |
| `lib/git-conflicts.js` (nuovo) | `readConflicts`, `resolveFile`, `continueOp`, `abortOp` |
| `app/git.js`, `preload.js` | canali `git-conflicts`, `git-conflict-resolve`, `git-op-continue`, `git-op-abort` |
| `renderer/conflict-markers.js` (nuovo, UMD) | `parseBlocks`, `applyChoice` |
| `renderer/conflicts-model.js` (nuovo, UMD) | testata, etichette, pulsanti, esiti |
| `renderer/conflicts-view.js` (nuovo, UMD) | elenco e piè di pagina della modalità Conflitti |
| `renderer/changes-conflicts.js` (nuovo, app) | stato, letture e azioni del pannello |
| `renderer/editor-conflicts.js` (nuovo, app) | colori e zone dei blocchi nell'editor |
| `renderer/editor-monaco.js` | `setConflicts`, `editText` |
| `renderer/changes-model.js`, `changes-view.js`, `changes-panel.js`, `editor-tab.js` | agganci |
| `renderer/worktree-actions.js`, `renderer/worktrees.js`, `renderer/git-tab.js` | «Risolvi / Annulla merge» |
| `renderer/index.html`, `renderer/styles.css`, `tests/renderer-source.js` | ordine degli script, stili |

---

### Task 1: `busyWith` con cherry-pick e revert, messaggi `BUSY`

**Files:**
- Modify: `lib/worktree.js:138-144` (`busyWith`)
- Modify: `lib/git-commit.js:28-31` (`BUSY`)
- Modify: `renderer/changes-model.js:224-227` (`BUSY_REASONS`)
- Test: `tests/worktree.test.js`, `tests/git-staging.test.js`

**Interfaces:**
- Produces: `busyWith(run, root, exists, platform) → Promise<'merge'|'rebase'|'cherry-pick'|'revert'|null>`;
  `BUSY[op]` per le quattro operazioni.

- [ ] **Step 1: test che falliscono**

In `tests/worktree.test.js`, accanto agli altri test di `worktreeStart`
(aggiungere `busyWith` all'import in cima):

```js
ok('worktree: busyWith riconosce merge, rebase, cherry-pick e revert', async () => {
  const repo = (heads, dirs = []) => fakeGit((args) => {
    const ref = args[args.length - 1];
    if (has(args, '--verify')) { if (heads.includes(ref)) return 'f00\n'; throw gitError(''); }
    if (has(args, '--git-path')) return '.git/rebase-merge\n.git/rebase-apply\n';
    throw new Error(`inatteso: ${args.join(' ')}`);
  });
  const exists = (dirs) => (p) => dirs.some((d) => p.endsWith(d));
  const busy = (heads, dirs = []) => busyWith(repo(heads).run, '/r', exists(dirs), 'linux');
  assert.strictEqual(await busy([]), null);
  assert.strictEqual(await busy(['MERGE_HEAD']), 'merge');
  assert.strictEqual(await busy([], ['rebase-merge']), 'rebase');
  assert.strictEqual(await busy([], ['rebase-apply']), 'rebase');
  assert.strictEqual(await busy(['CHERRY_PICK_HEAD']), 'cherry-pick');
  assert.strictEqual(await busy(['REVERT_HEAD']), 'revert');
  // Un rebase che riapplica un commit: vale il rebase
  assert.strictEqual(await busy(['CHERRY_PICK_HEAD'], ['rebase-merge']), 'rebase');
});
```

In `tests/git-staging.test.js` (dove oggi si prova `merging.busy`), un caso
per i messaggi:

```js
ok('staging: i messaggi BUSY coprono le quattro operazioni e rimandano al pannello', () => {
  const { BUSY } = require('../lib/git-commit');
  for (const op of ['merge', 'rebase', 'cherry-pick', 'revert']) {
    assert.match(BUSY[op], new RegExp(op));
    assert.match(BUSY[op], /pannello/);
  }
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `npm run test:unit 2>&1 | grep -E "^not ok|busyWith|BUSY"`
Expected: FAIL su cherry-pick (`null` invece di `'cherry-pick'`) e su `BUSY['cherry-pick']` undefined.

- [ ] **Step 3: implementazione**

`lib/worktree.js`:

```js
/* Cosa c'è a metà nel repository. Il rebase prima del cherry-pick: un rebase
   che riapplica un commit può lasciare anche CHERRY_PICK_HEAD (docs/plans/69) */
async function busyWith(run, root, exists, platform = process.platform) {
  const has = (ref) => run(['rev-parse', '-q', '--verify', ref], { cwd: root }).then(() => true, () => false);
  if (await has('MERGE_HEAD')) return 'merge';
  const paths = (await run(['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], { cwd: root }))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  if (paths.some((p) => exists(pathFor(platform).resolve(root, p)))) return 'rebase';
  if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (await has('REVERT_HEAD')) return 'revert';
  return null;
}
```

`lib/git-commit.js`:

```js
const BUSY = {
  merge: 'C\'è un merge a metà nel repository: concludilo o annullalo dal pannello delle modifiche.',
  rebase: 'C\'è un rebase a metà nel repository: continualo o annullalo dal pannello delle modifiche.',
  'cherry-pick': 'C\'è un cherry-pick a metà nel repository: continualo o annullalo dal pannello delle modifiche.',
  revert: 'C\'è un revert a metà nel repository: continualo o annullalo dal pannello delle modifiche.',
};
```

`renderer/changes-model.js`, `BUSY_REASONS` con le stesse quattro frasi
(il renderer non può importare `lib/`).

- [ ] **Step 4: test verdi**

Run: `npm run test:unit`
Expected: tutto verde. Se un test esistente confronta il vecchio testo
(«dal terminale»), aggiornarlo alla frase nuova.

- [ ] **Step 5: commit**

```
feat: busyWith riconosce cherry-pick e revert

Il pannello dei conflitti (piano 69) deve sapere quale operazione è a
metà per offrire il continue e l'abort giusti. I messaggi BUSY ora
rimandano al pannello invece che al terminale.
```

---

### Task 2: `renderer/conflict-markers.js`

**Files:**
- Create: `renderer/conflict-markers.js`
- Create: `tests/fixtures/conflicts/simple.txt`, `multi.txt`, `diff3.txt`, `crlf.txt`, `stray.txt`
- Create: `tests/conflict-markers.test.js`
- Modify: `renderer/index.html` (script prima di `changes-model.js`)

**Interfaces:**
- Produces (globale `window.AisessConflictMarkers`, `module.exports` sotto Node):
  - `parseBlocks(text: string) → Array<{start, base: number|null, sep, end, ours: [from, to], theirs: [from, to], oursLabel, theirsLabel}>`
    righe da 1; `ours`/`theirs` inclusive, vuote quando `from > to`.
  - `applyChoice(text, block, choice: 'ours'|'theirs'|'both') → string|null`
    (null se `block` non combacia più col testo).

- [ ] **Step 1: fixture**

Creare i file con `printf`, per avere esattamente i byte giusti:

```bash
mkdir -p tests/fixtures/conflicts
printf 'prima\n<<<<<<< HEAD\nnostro\n=======\nloro\n>>>>>>> feat/x\ndopo\n' > tests/fixtures/conflicts/simple.txt
printf '<<<<<<< HEAD\na1\n=======\nb1\n>>>>>>> feat/x\nmezzo\n<<<<<<< HEAD\n=======\nb2\nb3\n>>>>>>> feat/x\n' > tests/fixtures/conflicts/multi.txt
printf 'x\n<<<<<<< HEAD\nnostro\n||||||| abc1234\nbase\n=======\nloro\n>>>>>>> feat/x\n' > tests/fixtures/conflicts/diff3.txt
printf 'su\r\n<<<<<<< HEAD\r\nnostro\r\n=======\r\nloro\r\n>>>>>>> feat/x\r\ngiu\r\n' > tests/fixtures/conflicts/crlf.txt
printf 'Titolo\n=======\n\ntesto\n' > tests/fixtures/conflicts/stray.txt
```

- [ ] **Step 2: test che falliscono**

`tests/conflict-markers.test.js`:

```js
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { test: ok } = require('node:test');

/* Marcatori di conflitto nel testo (docs/plans/69): blocchi e scelte, sulle
   fixture in tests/fixtures/conflicts/. */
const { parseBlocks, applyChoice } = require('../renderer/conflict-markers');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'conflicts', name), 'utf8');

ok('marcatori: un blocco semplice, righe da 1 e nomi dei due lati', () => {
  assert.deepStrictEqual(parseBlocks(fixture('simple.txt')), [{
    start: 2, base: null, sep: 4, end: 6, ours: [3, 3], theirs: [5, 5], oursLabel: 'HEAD', theirsLabel: 'feat/x',
  }]);
});

ok('marcatori: più blocchi, anche con un lato vuoto', () => {
  const blocks = parseBlocks(fixture('multi.txt'));
  assert.deepStrictEqual(blocks.map((b) => [b.start, b.sep, b.end]), [[1, 3, 5], [7, 8, 11]]);
  assert.deepStrictEqual(blocks[1].ours, [8, 7]); // vuoto
  assert.deepStrictEqual(blocks[1].theirs, [9, 10]);
});

ok('marcatori: diff3, la base non è un lato', () => {
  const [b] = parseBlocks(fixture('diff3.txt'));
  assert.strictEqual(b.base, 4);
  assert.deepStrictEqual(b.ours, [3, 3]);
  assert.deepStrictEqual(b.theirs, [7, 7]);
  assert.strictEqual(applyChoice(fixture('diff3.txt'), b, 'both'), 'x\nnostro\nloro\n');
});

ok('marcatori: ======= fuori da un blocco non è un marcatore', () => {
  assert.deepStrictEqual(parseBlocks(fixture('stray.txt')), []);
  assert.deepStrictEqual(parseBlocks('<<<<<<< HEAD\nmai chiuso\n'), []);
});

ok('marcatori: le tre scelte sostituiscono solo il blocco', () => {
  const text = fixture('simple.txt');
  const [b] = parseBlocks(text);
  assert.strictEqual(applyChoice(text, b, 'ours'), 'prima\nnostro\ndopo\n');
  assert.strictEqual(applyChoice(text, b, 'theirs'), 'prima\nloro\ndopo\n');
  assert.strictEqual(applyChoice(text, b, 'both'), 'prima\nnostro\nloro\ndopo\n');
});

ok('marcatori: CRLF resta CRLF', () => {
  const text = fixture('crlf.txt');
  const [b] = parseBlocks(text);
  assert.strictEqual(b.theirsLabel, 'feat/x');
  assert.strictEqual(applyChoice(text, b, 'theirs'), 'su\r\nloro\r\ngiu\r\n');
});

ok('marcatori: un blocco che non combacia più col testo non si applica', () => {
  const [b] = parseBlocks(fixture('simple.txt'));
  assert.strictEqual(applyChoice('cambiato tutto\n', b, 'ours'), null);
  assert.strictEqual(applyChoice(fixture('simple.txt'), b, 'base'), null);
});
```

- [ ] **Step 3: verificare che falliscano**

Run: `node --test tests/conflict-markers.test.js`
Expected: FAIL «Cannot find module '../renderer/conflict-markers'».

- [ ] **Step 4: implementazione**

`renderer/conflict-markers.js`:

```js
/* Marcatori di conflitto nel testo di un file (docs/plans/69): dove sono i
 * blocchi e cosa resta scegliendo un lato. Puro, senza DOM: lo usano
 * l'editor (renderer/editor-conflicts.js) e i test.
 *
 *   <<<<<<< HEAD        start
 *   nostro              ours
 *   ||||||| base        base (diff3/zdiff3, facoltativo: si mostra, non si sceglie)
 *   =======             sep
 *   loro                theirs
 *   >>>>>>> feat/x      end
 *
 * Righe da 1, come Monaco. Un `=======` fuori da un blocco aperto è testo
 * (un titolo Markdown), un blocco mai chiuso non è un blocco.
 *
 * Wrapper UMD come editor-route.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictMarkers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const OPEN = /^<{7}(?: (.*))?$/;
  const BASE = /^\|{7}(?: .*)?$/;
  const SEP = /^={7}$/;
  const CLOSE = /^>{7}(?: (.*))?$/;
  const CHOICES = new Set(['ours', 'theirs', 'both']);

  const linesOf = (text) => String(text).split(/\r?\n/);

  /**
   * @param {string} text
   * @returns {Array<{start: number, base: number|null, sep: number, end: number,
   *   ours: [number, number], theirs: [number, number], oursLabel: string, theirsLabel: string}>}
   */
  function parseBlocks(text) {
    const blocks = [];
    let open = null;
    linesOf(text).forEach((line, i) => {
      const n = i + 1;
      const opening = OPEN.exec(line);
      if (opening) { open = { start: n, base: null, sep: null, oursLabel: opening[1] || '' }; return; }
      if (!open) return;
      if (open.sep === null && open.base === null && BASE.test(line)) { open = { ...open, base: n }; return; }
      if (open.sep === null && SEP.test(line)) { open = { ...open, sep: n }; return; }
      const closing = open.sep !== null ? CLOSE.exec(line) : null;
      if (!closing) return;
      blocks.push({
        start: open.start, base: open.base, sep: open.sep, end: n,
        ours: [open.start + 1, (open.base || open.sep) - 1], theirs: [open.sep + 1, n - 1],
        oursLabel: open.oursLabel, theirsLabel: closing[1] || '',
      });
      open = null;
    });
    return blocks;
  }

  /**
   * Il testo col blocco sostituito dalla scelta; null se il blocco non è più
   * dove era (il testo è cambiato) o la scelta non esiste.
   * @param {string} text
   * @param {{start: number, sep: number, end: number, ours: number[], theirs: number[]}} block
   * @param {'ours'|'theirs'|'both'} choice
   * @returns {string|null}
   */
  function applyChoice(text, block, choice) {
    if (!CHOICES.has(choice) || !block) return null;
    const lines = linesOf(text);
    const at = (n) => lines[n - 1];
    if (!OPEN.test(at(block.start) || '') || !SEP.test(at(block.sep) || '') || !CLOSE.test(at(block.end) || '')) return null;
    const side = ([from, to]) => lines.slice(from - 1, to);
    const kept = choice === 'ours' ? side(block.ours)
      : choice === 'theirs' ? side(block.theirs)
        : [...side(block.ours), ...side(block.theirs)];
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    return [...lines.slice(0, block.start - 1), ...kept, ...lines.slice(block.end)].join(eol);
  }

  return { parseBlocks, applyChoice };
});
```

`renderer/index.html`: `<script src="conflict-markers.js"></script>` subito
prima di `<script src="changes-model.js"></script>`.

- [ ] **Step 5: test verdi**

Run: `node --test tests/conflict-markers.test.js && npm run test:unit`
Expected: PASS (anche `renderer-load.test.js`, che carica la pagina).

- [ ] **Step 6: commit**

```
feat: marcatori di conflitto, blocchi e scelte

Primo pezzo dell'editor dei conflitti (piano 69): dove sono i blocchi in
un file e cosa resta tenendo nostro, loro o entrambi. Riconosce diff3
e conserva CRLF. Sta in renderer/ perché il renderer sandboxed non può
caricare lib/.
```

---

### Task 3: `lib/git-conflicts.js` e canali IPC

**Files:**
- Create: `lib/git-conflicts.js`
- Create: `tests/git-conflicts.test.js`
- Modify: `app/git.js` (require e 4 handler), `preload.js` (4 metodi)
- Modify: `tests/integration.test.js` (nuovo test in fondo)

**Interfaces:**
- Consumes: `busyWith` (Task 1), `openRepo`, `GIT_GLOBAL`, `isSafeRelative`
  (`lib/git-changes.js`), `writeError`, `COMMIT_TIMEOUT_MS`, `BUSY`
  (`lib/git-commit.js`), `gitMessage` (`lib/git-branches.js`).
- Produces:
  - `readConflicts({cwd, run?, exists?, fsp?, platform?}) → {ok: true, root, op: null} | {ok: true, root, op, what: {incoming, into, step, total, commit, subject}, files: [{path, kind, binary, blocks}], resolved: string[]} | {ok: false, error|reason}`.
    `kind` ∈ `both-modified, both-added, deleted-by-us, deleted-by-them, added-by-us, added-by-them, both-deleted`; `blocks` numero di `<<<<<<<` o `null` (binario, assente, troppo grande).
  - `resolveFile({cwd, path, how, run?, fsp?, platform?, exists?}) → {ok: true} | {ok: false, error}`; `how` ∈ `mark, ours, theirs, keep, delete`.
  - `continueOp({cwd, op, ...}) → {ok: true, done: true} | {ok: true, stopped: true} | {ok: false, error}`.
  - `abortOp({cwd, op, ...}) → {ok: true} | {ok: false, error}`.
  - preload: `gitConflicts(cwd)`, `gitConflictResolve(cwd, path, how)`, `gitOpContinue(cwd, op)`, `gitOpAbort(cwd, op)`.

- [ ] **Step 1: test che falliscono (git finto)**

`tests/git-conflicts.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Conflitti di un'operazione a metà (docs/plans/69): letture, argv e
   controlli con un git finto; il giro vero sta in tests/integration.test.js. */
const C = require('../lib/git-conflicts');

const ROOT = '/repo';
const fail = (code, stderr = '', extra = {}) => Object.assign(new Error(`exit ${code}`), { code, stderr, stdout: '', ...extra });

/* `status --porcelain=v2 -z`: una riga «u» per file in conflitto, «1» per i risolti */
const u = (xy, p) => `u ${xy} N... 100644 100644 100644 100644 h1 h2 h3 ${p}`;
const one = (xy, p) => `1 ${xy} N... 100644 100644 100644 hH hI ${p}`;

/**
 * git finto. `heads`: i ref speciali che esistono (MERGE_HEAD…); `rebase`:
 * contenuto di .git/rebase-merge ({head-name, onto, msgnum, end}) o null;
 * `status`: le voci di status; `files`: il contenuto dei file sul disco;
 * `cont(args)`: cosa fa il continue / commit; dopo, `after` dice cosa resta a metà.
 */
function fakeRepo({
  heads = ['MERGE_HEAD'], rebase = null, status = [], files = {}, mergeMsg = "Merge branch 'feat/x'\n",
  current = 'main', cont = () => '', after = [],
} = {}) {
  const calls = [];
  let live = heads;
  let rebasing = rebase;
  const run = async (args, opts) => {
    calls.push({ args, opts });
    const a = args.filter((x) => !['--literal-pathspecs'].includes(x));
    if (a.includes('--show-toplevel')) return `${ROOT}\n`;
    if (a[0] === 'rev-parse' && a.includes('--git-path')) return a.filter((x, i) => a[i - 1] === '--git-path').map((p) => `.git/${p}`).join('\n');
    if (a[0] === 'rev-parse' && a.includes('--verify')) {
      const ref = a[a.length - 1];
      if (live.includes(ref)) return 'abc1234def\n';
      if (ref === 'HEAD^{commit}') return 'fff0000\n';
      throw fail(1);
    }
    if (a[0] === 'symbolic-ref') return `${current}\n`;
    if (a[0] === 'log') return 'messaggio del commit\n';
    if (a[0] === 'for-each-ref') return 'main\n';
    if (a.includes('status')) return status.map((s) => `${s}\0`).join(''); // dopo i -c di GIT_GLOBAL
    if (a[0] === 'diff' && a.includes('--diff-filter=U')) return status.filter((s) => s.startsWith('u ')).map((s) => `${s.split(' ').slice(10).join(' ')}\0`).join('');
    if (['add', 'rm', 'checkout'].includes(a[0])) return '';
    if (a[0] === 'commit' || a.includes('--continue')) {
      const out = cont(args, opts);
      live = after; rebasing = after.includes('rebase') ? rebasing : null;
      return out;
    }
    if (a.includes('--abort')) { live = []; rebasing = null; return ''; }
    throw fail(128, `git finto: ${args.join(' ')}`);
  };
  const exists = (p) => Boolean(rebasing) && /rebase-merge$/.test(p);
  const fsp = {
    readFile: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (rebasing && /rebase-merge[\\/]/.test(p)) return `${rebasing[p.split(/[\\/]/).pop()]}\n`;
      if (/MERGE_MSG$/.test(p)) return mergeMsg;
      if (rel in files) return files[rel];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    stat: async (p) => {
      const rel = p.replace(/^\/repo\//, '');
      if (!(rel in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: Buffer.byteLength(files[rel]) };
    },
  };
  const sent = () => calls.map((c) => c.args.join(' '));
  return { run, exists, fsp, calls, sent, platform: 'linux' };
}

const opts = (r, extra = {}) => ({ cwd: `${ROOT}/sub`, run: r.run, exists: r.exists, fsp: r.fsp, platform: 'linux', ...extra });

ok('conflitti: niente a metà → op null, una lettura sola', async () => {
  const r = fakeRepo({ heads: [] });
  assert.deepStrictEqual(await C.readConflicts(opts(r)), { ok: true, root: ROOT, op: null });
  assert.ok(!r.sent().some((s) => s.startsWith('status')));
});

ok('conflitti: merge, file per tipo, blocchi contati, risolti a parte', async () => {
  const r = fakeRepo({
    status: [u('UU', 'lib/a b.js'), u('UD', 'old.js'), u('AA', 'img.png'), one('M.', 'README.md'), '? nuovo.txt'],
    files: {
      'lib/a b.js': '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feat/x\n<<<<<<< HEAD\n=======\n>>>>>>> feat/x\n',
      'old.js': 'x\n', 'img.png': 'PNG\0\0binario',
    },
  });
  const c = await C.readConflicts(opts(r));
  assert.strictEqual(c.op, 'merge');
  assert.deepStrictEqual(c.what, { incoming: 'feat/x', into: 'main', step: null, total: null, commit: 'abc1234', subject: null });
  assert.deepStrictEqual(c.files, [
    { path: 'img.png', kind: 'both-added', binary: true, blocks: null },
    { path: 'lib/a b.js', kind: 'both-modified', binary: false, blocks: 2 },
    { path: 'old.js', kind: 'deleted-by-them', binary: false, blocks: 0 },
  ]);
  assert.deepStrictEqual(c.resolved, ['README.md']);
  const status = r.calls.find((x) => x.args.includes('status'));
  assert.ok(status.args.includes('--porcelain=v2') && status.args.includes('-z'));
});

ok('conflitti: rebase, passo e commit che si sta riapplicando', async () => {
  const r = fakeRepo({ heads: ['REBASE_HEAD'], rebase: { 'head-name': 'refs/heads/feat/x', onto: 'aaa111', msgnum: '3', end: '7' }, status: [u('UU', 'a.js')], files: { 'a.js': 'x\n' } });
  const c = await C.readConflicts(opts(r));
  assert.strictEqual(c.op, 'rebase');
  assert.deepStrictEqual(c.what, { incoming: 'feat/x', into: 'main', step: 3, total: 7, commit: 'abc1234', subject: 'messaggio del commit' });
});

ok('conflitti: cherry-pick e revert dicono il commit', async () => {
  for (const [head, op] of [['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]) {
    const c = await C.readConflicts(opts(fakeRepo({ heads: [head], status: [] })));
    assert.strictEqual(c.op, op);
    assert.strictEqual(c.what.commit, 'abc1234');
    assert.strictEqual(c.what.subject, 'messaggio del commit');
    assert.strictEqual(c.what.into, 'main');
  }
});

ok('risolvi: argv per ogni scelta, sempre -- e --literal-pathspecs', async () => {
  const cases = [
    ['mark', 'UU', 'a.js', 'pulito\n', [['add', '--', 'a.js']]],
    ['ours', 'UU', 'a.js', 'x', [['checkout', '--ours', '--', 'a.js'], ['add', '--', 'a.js']]],
    ['theirs', 'AA', 'a.js', 'x', [['checkout', '--theirs', '--', 'a.js'], ['add', '--', 'a.js']]],
    ['keep', 'UD', 'a.js', 'x', [['add', '--', 'a.js']]],
    ['delete', 'DU', 'a.js', 'x', [['rm', '--quiet', '--', 'a.js']]],
  ];
  for (const [how, xy, p, text, expected] of cases) {
    const r = fakeRepo({ status: [u(xy, p)], files: { [p]: text } });
    const res = await C.resolveFile(opts(r, { path: p, how }));
    assert.deepStrictEqual(res, { ok: true }, `${how}: ${res.error}`);
    const writes = r.calls.filter((c) => ['add', 'rm', 'checkout'].includes(c.args[1]));
    assert.deepStrictEqual(writes.map((c) => c.args), expected.map((e) => ['--literal-pathspecs', ...e]), how);
    assert.ok(writes.every((c) => c.opts.cwd === ROOT));
  }
});

ok('risolvi: rifiuta percorsi fuori, file non in conflitto, how sconosciuto, lato cancellato, marcatori', async () => {
  const r = fakeRepo({ status: [u('UU', 'a.js'), u('UD', 'old.js')], files: { 'a.js': 'su\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat/x\n', 'old.js': 'x' } });
  const no = async (extra, re) => {
    const res = await C.resolveFile(opts(r, extra));
    assert.strictEqual(res.ok, false, JSON.stringify(extra));
    assert.match(res.error, re);
  };
  await no({ path: '../fuori.js', how: 'mark' }, /percorso/i);
  await no({ path: 'b.js', how: 'mark' }, /non è (più )?fra i file in conflitto/);
  await no({ path: 'a.js', how: 'rm -rf' }, /scelta/i);
  await no({ path: 'old.js', how: 'theirs' }, /cancellato/);
  await no({ path: 'a.js', how: 'mark' }, /marcatori/);
  assert.ok(!r.calls.some((c) => ['add', 'rm', 'checkout'].includes(c.args[1])), 'ha scritto nonostante il rifiuto');
});

ok('continua: merge → commit --no-edit col tempo massimo e GIT_EDITOR=true', async () => {
  const r = fakeRepo({ status: [], after: [] });
  assert.deepStrictEqual(await C.continueOp(opts(r, { op: 'merge' })), { ok: true, done: true });
  const c = r.calls.find((x) => x.args[0] === 'commit');
  assert.deepStrictEqual(c.args, ['commit', '--no-edit']);
  assert.strictEqual(c.opts.env.GIT_EDITOR, 'true');
  assert.ok(c.opts.timeout > 0);
  assert.ok(!c.args.includes('--no-verify'));
});

ok('continua: un rebase che si ferma di nuovo → stopped', async () => {
  const rebase = { 'head-name': 'refs/heads/feat/x', onto: 'aaa111', msgnum: '1', end: '2' };
  const r = fakeRepo({ heads: [], rebase, status: [], cont: () => { throw fail(1, 'CONFLICT (content)'); }, after: ['rebase'] });
  const res = await C.continueOp(opts(r, { op: 'rebase' }));
  assert.deepStrictEqual(res, { ok: true, stopped: true });
  assert.ok(r.sent().includes('rebase --continue'));
});

ok('continua: rifiutato con file in conflitto, con op che non combacia, con op sconosciuta', async () => {
  const conflicted = fakeRepo({ status: [u('UU', 'a.js')] });
  assert.match((await C.continueOp(opts(conflicted, { op: 'merge' }))).error, /ancora in conflitto/);
  assert.match((await C.continueOp(opts(fakeRepo(), { op: 'rebase' }))).error, /pannello era vecchio/);
  assert.match((await C.continueOp(opts(fakeRepo(), { op: 'merge --strategy=ours' }))).error, /operazione/i);
  assert.ok(!conflicted.sent().some((s) => s.startsWith('commit')));
});

ok('continua: tempo scaduto → il messaggio del commit', async () => {
  const r = fakeRepo({ status: [], cont: () => { throw fail(null, '', { killed: true }); } });
  const res = await C.continueOp(opts(r, { op: 'merge' }));
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /nessuna risposta/);
});

ok('annulla: <op> --abort, solo se è quella a metà', async () => {
  for (const [head, op] of [['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]) {
    const r = fakeRepo({ heads: [head] });
    assert.deepStrictEqual(await C.abortOp(opts(r, { op })), { ok: true });
    assert.ok(r.sent().includes(`${op} --abort`));
  }
  const r = fakeRepo({ heads: ['MERGE_HEAD'] });
  assert.match((await C.abortOp(opts(r, { op: 'revert' }))).error, /pannello era vecchio/);
  assert.ok(!r.sent().some((s) => s.includes('--abort')));
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `node --test tests/git-conflicts.test.js`
Expected: FAIL «Cannot find module '../lib/git-conflicts'».

- [ ] **Step 3: implementazione**

`lib/git-conflicts.js`:

```js
'use strict';
/* Un merge, rebase, cherry-pick o revert fermo sui conflitti (docs/plans/69):
 * cosa è a metà, quali file sono in conflitto e come, e le quattro scritture
 * del pannello (risolvi un file, continua, annulla).
 *
 * - Sempre argv, mai la shell; percorsi dopo `--` e con `--literal-pathspecs`,
 *   e solo se compaiono adesso fra i file in conflitto.
 * - `op` da una lista chiusa, e deve essere quella che git ha a metà adesso:
 *   un pannello vecchio non continua l'operazione sbagliata.
 * - Hook come da terminale, tempo massimo come il commit (lib/git-commit.js).
 *
 * `run`, `exists` e `fsp` sono iniettabili: i test provano argv e controlli senza git. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { gitMessage } = require('./git-branches');
const { openRepo, isSafeRelative, GIT_GLOBAL } = require('./git-changes');
const { writeError, COMMIT_TIMEOUT_MS } = require('./git-commit');
const { busyWith } = require('./worktree');

const OPS = ['merge', 'rebase', 'cherry-pick', 'revert'];
const KINDS = {
  DD: 'both-deleted', AU: 'added-by-us', UD: 'deleted-by-them', UA: 'added-by-them',
  DU: 'deleted-by-us', AA: 'both-added', UU: 'both-modified',
};
/* Cosa si può fare di un file, per tipo: tenere un lato ha senso solo se ci sono tutti e due */
const HOWS = {
  'both-modified': ['mark', 'ours', 'theirs'], 'both-added': ['mark', 'ours', 'theirs'],
  'deleted-by-us': ['keep', 'delete'], 'deleted-by-them': ['keep', 'delete'],
  'added-by-us': ['keep', 'delete'], 'added-by-them': ['keep', 'delete'], 'both-deleted': ['delete'],
};
const MAX_FILES = 500;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const BINARY_PROBE = 8000;
const MARKERS = /^(?:<{7}|>{7})(?: |\r?$)/m;
const OPENING = /^<{7}(?: |\r?$)/gm;
const LIT = ['--literal-pathspecs'];

const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const fullPath = (platform, root, rel) => pathFor(platform).join(root, ...rel.split('/'));
const stale = (op) => `Il pannello era vecchio: adesso nel repository non c'è un ${op} a metà. Riapri il pannello.`;

/* Voci di `status --porcelain=v2 -z`: «u» in conflitto (10 campi, poi il
   percorso), «1» e «2» tracciati (8 e 9 campi; il «2» ha il nome vecchio
   nella voce dopo). Risolto = qualcosa in staging. */
function parseStatus(text) {
  const parts = String(text || '').split('\0');
  const conflicts = [];
  const resolved = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i];
    const fields = e.split(' ');
    if (e.startsWith('u ')) conflicts.push({ path: fields.slice(10).join(' '), kind: KINDS[fields[1]] || 'both-modified' });
    else if (e.startsWith('1 ') && fields[1][0] !== '.') resolved.push(fields.slice(8).join(' '));
    else if (e.startsWith('2 ')) { if (fields[1][0] !== '.') resolved.push(fields.slice(9).join(' ')); i += 1; }
  }
  return { conflicts, resolved };
}

async function readStatus(run, root) {
  return parseStatus(await run([...GIT_GLOBAL, 'status', '--porcelain=v2', '-z', '--untracked-files=no'], { cwd: root }));
}

/* Quanti blocchi restano; null se non si sa (binario, assente, troppo grande) */
async function describeFile(fsp, platform, root, f) {
  const file = fullPath(platform, root, f.path);
  try {
    if ((await fsp.stat(file)).size > MAX_READ_BYTES) return { ...f, binary: false, blocks: null };
    const text = String(await fsp.readFile(file, 'utf8'));
    if (text.slice(0, BINARY_PROBE).includes('\0')) return { ...f, binary: true, blocks: null };
    return { ...f, binary: false, blocks: (text.match(OPENING) || []).length };
  } catch {
    return { ...f, binary: false, blocks: null };
  }
}

const readText = (fsp, file) => fsp.readFile(file, 'utf8').then((t) => String(t).trim(), () => null);
const shortSha = async (run, root, ref) => run(['rev-parse', '--short', '--verify', ref], { cwd: root })
  .then((t) => t.trim().slice(0, 7), () => null);
const subjectOf = (run, root, ref) => run(['log', '-1', '--format=%s', ref, '--'], { cwd: root }).then((t) => t.trim(), () => null);
const currentBranch = (run, root) => run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root }).then((t) => t.trim() || null, () => null);

async function gitPath(run, root, platform, name) {
  const p = (await run(['rev-parse', '--git-path', name], { cwd: root })).trim();
  return pathFor(platform).resolve(root, p);
}

/* Il nome di un commit: il branch locale che ci punta, o lo sha corto */
async function nameOf(run, root, sha) {
  if (!sha) return null;
  const names = await run(['for-each-ref', '--points-at', sha, '--format=%(refname:short)', 'refs/heads'], { cwd: root })
    .then((t) => t.split('\n').map((l) => l.trim()).filter(Boolean), () => []);
  return names[0] || sha.slice(0, 7);
}

async function describeRebase(run, root, fsp, exists, platform) {
  const merge = await gitPath(run, root, platform, 'rebase-merge');
  const dir = exists(merge) ? merge : await gitPath(run, root, platform, 'rebase-apply');
  const file = (n) => readText(fsp, pathFor(platform).join(dir, n));
  const [headName, onto] = await Promise.all([file('head-name'), file('onto')]);
  const step = Number(await file(dir === merge ? 'msgnum' : 'next')) || null;
  const total = Number(await file(dir === merge ? 'end' : 'last')) || null;
  return {
    incoming: headName ? headName.replace(/^refs\/heads\//, '') : null,
    into: await nameOf(run, root, onto),
    step, total,
    commit: await shortSha(run, root, 'REBASE_HEAD'),
    subject: await subjectOf(run, root, 'REBASE_HEAD'),
  };
}

const MERGE_MSG_RE = /^Merge (?:remote-tracking )?branch(?:es)? '([^']+)'/;

async function describe(op, { run, root, fsp, exists, platform }) {
  const into = await currentBranch(run, root);
  if (op === 'rebase') return describeRebase(run, root, fsp, exists, platform);
  if (op === 'merge') {
    const msg = await readText(fsp, await gitPath(run, root, platform, 'MERGE_MSG'));
    const commit = await shortSha(run, root, 'MERGE_HEAD');
    const named = msg && MERGE_MSG_RE.exec(msg);
    return { incoming: named ? named[1] : commit, into, step: null, total: null, commit, subject: null };
  }
  const head = op === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD';
  return { incoming: null, into, step: null, total: null, commit: await shortSha(run, root, head), subject: await subjectOf(run, root, head) };
}

/* Repository e operazione a metà: i controlli comuni alle letture e alle scritture */
async function open(o) {
  const { run = runGit, platform = process.platform, exists = fs.existsSync, fsp = fs.promises } = o;
  const repo = await openRepo({ cwd: o.cwd, base: null, run, platform });
  if (!repo.ok) return repo;
  const op = await busyWith(run, repo.root, exists, platform);
  return { ok: true, root: repo.root, op, run, platform, exists, fsp };
}

/**
 * @param {{cwd: string, run?: Function, exists?: Function, fsp?: object, platform?: string}} o
 */
async function readConflicts(o = {}) {
  try {
    const ctx = await open(o);
    if (!ctx.ok || !ctx.op) return ctx.ok ? { ok: true, root: ctx.root, op: null } : ctx;
    const { conflicts, resolved } = await readStatus(ctx.run, ctx.root);
    const sorted = [...conflicts].sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_FILES);
    const files = await Promise.all(sorted.map((f) => describeFile(ctx.fsp, ctx.platform, ctx.root, f)));
    return { ok: true, root: ctx.root, op: ctx.op, what: await describe(ctx.op, ctx), files, resolved: [...resolved].sort() };
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
}

const RESOLVE_CALLS = {
  mark: (p) => [['add', '--', p]],
  ours: (p) => [['checkout', '--ours', '--', p], ['add', '--', p]],
  theirs: (p) => [['checkout', '--theirs', '--', p], ['add', '--', p]],
  keep: (p) => [['add', '--', p]],
  delete: (p) => [['rm', '--quiet', '--', p]],
};

async function resolveProblem(ctx, file, how) {
  if (!Object.prototype.hasOwnProperty.call(RESOLVE_CALLS, how)) return 'Scelta sconosciuta per il file in conflitto.';
  const { conflicts } = await readStatus(ctx.run, ctx.root);
  const found = conflicts.find((f) => f.path === file);
  if (!found) return `${file} non è più fra i file in conflitto.`;
  if (!HOWS[found.kind].includes(how)) {
    return how === 'ours' || how === 'theirs'
      ? `${file} è cancellato da una delle due parti: tienilo o eliminalo.`
      : `${file} va risolto scegliendo una delle due versioni.`;
  }
  if (how !== 'mark') return null;
  const text = await ctx.fsp.readFile(fullPath(ctx.platform, ctx.root, file), 'utf8').then(String, () => '');
  return MARKERS.test(text) ? `In ${file} restano marcatori di conflitto (<<<<<<< o >>>>>>>): sistemali e salva, poi riprova.` : null;
}

/**
 * @param {{cwd: string, path: string, how: 'mark'|'ours'|'theirs'|'keep'|'delete'}} o
 */
async function resolveFile(o = {}) {
  if (typeof o.path !== 'string' || !isSafeRelative(o.path)) return { ok: false, error: 'Percorso non valido.' };
  try {
    const ctx = await open(o);
    if (!ctx.ok) return ctx;
    if (!ctx.op) return { ok: false, error: 'Nel repository non c\'è più niente a metà.' };
    const problem = await resolveProblem(ctx, o.path, o.how);
    if (problem) return { ok: false, error: problem };
    for (const args of RESOLVE_CALLS[o.how](o.path)) await ctx.run([...LIT, ...args], { cwd: ctx.root });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: writeError(e, 'Risolvi') };
  }
}

/* Il repository fa adesso proprio `op`? Altrimenti il motivo */
async function checkOp(o) {
  if (!OPS.includes(o.op)) return { ok: false, error: 'Operazione sconosciuta.' };
  const ctx = await open(o);
  if (!ctx.ok) return ctx;
  if (ctx.op !== o.op) return { ok: false, error: stale(o.op) };
  return ctx;
}

const CONTINUE_ARGS = {
  merge: ['commit', '--no-edit'],
  rebase: ['rebase', '--continue'],
  'cherry-pick': ['cherry-pick', '--continue'],
  revert: ['revert', '--continue'],
};

/**
 * Concludi il merge o continua rebase/cherry-pick/revert. Il messaggio resta
 * quello preparato da git (GIT_EDITOR=true).
 * @param {{cwd: string, op: string}} o
 */
async function continueOp(o = {}) {
  let ctx;
  try {
    ctx = await checkOp(o);
    if (!ctx.ok) return ctx;
    const { conflicts } = await readStatus(ctx.run, ctx.root);
    if (conflicts.length) {
      return { ok: false, error: `${conflicts.length === 1 ? '1 file è' : `${conflicts.length} file sono`} ancora in conflitto.` };
    }
  } catch (e) {
    return { ok: false, error: gitMessage(e) };
  }
  try {
    await ctx.run(CONTINUE_ARGS[o.op], { cwd: ctx.root, env: { GIT_EDITOR: 'true' }, timeout: COMMIT_TIMEOUT_MS });
  } catch (e) {
    // Un rebase (o una serie di cherry-pick) che si ferma al passo dopo non è un errore
    const still = await busyWith(ctx.run, ctx.root, ctx.exists, ctx.platform).catch(() => null);
    if (still === o.op && !e.killed) {
      const { conflicts } = await readStatus(ctx.run, ctx.root).catch(() => ({ conflicts: [] }));
      if (conflicts.length || o.op === 'rebase') return { ok: true, stopped: true };
    }
    return { ok: false, error: writeError(e, o.op === 'merge' ? 'Commit di merge' : `${o.op} --continue`) };
  }
  const still = await busyWith(ctx.run, ctx.root, ctx.exists, ctx.platform).catch(() => null);
  return still === o.op ? { ok: true, stopped: true } : { ok: true, done: true };
}

/**
 * @param {{cwd: string, op: string}} o
 */
async function abortOp(o = {}) {
  try {
    const ctx = await checkOp(o);
    if (!ctx.ok) return ctx;
    await ctx.run([o.op, '--abort'], { cwd: ctx.root, timeout: COMMIT_TIMEOUT_MS });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: writeError(e, `${o.op} --abort`) };
  }
}

module.exports = { readConflicts, resolveFile, continueOp, abortOp, parseStatus, OPS };
```

Nota per il fake: `fakeRepo` toglie `--literal-pathspecs` prima di
guardare argv, così `a[0]` è il comando vero; `GIT_GLOBAL` (`-c …`) invece
resta davanti a `status`, per questo il fake cerca `a.includes('status')`.

`app/git.js`, in cima:

```js
const { readConflicts, resolveFile, continueOp, abortOp } = require('../lib/git-conflicts');
```

e in fondo a `registerGitHandlers`:

```js
  // Conflitti di un'operazione a metà (docs/plans/69): percorso, scelta e
  // operazione li ricontrolla lib/git-conflicts.js
  ipcMain.handle('git-conflicts', guard(({ cwd }) => readConflicts({ cwd })));
  ipcMain.handle('git-conflict-resolve', guard(({ cwd, path, how }) => resolveFile({ cwd, path, how })));
  ipcMain.handle('git-op-continue', guard(({ cwd, op }) => continueOp({ cwd, op })));
  ipcMain.handle('git-op-abort', guard(({ cwd, op }) => abortOp({ cwd, op })));
```

`preload.js`, dopo `gitMerge`:

```js
  gitConflicts: (cwd) => ipcRenderer.invoke('git-conflicts', { cwd }),
  gitConflictResolve: (cwd, path, how) => ipcRenderer.invoke('git-conflict-resolve', { cwd, path, how }),
  gitOpContinue: (cwd, op) => ipcRenderer.invoke('git-op-continue', { cwd, op }),
  gitOpAbort: (cwd, op) => ipcRenderer.invoke('git-op-abort', { cwd, op }),
```

- [ ] **Step 4: test unitari verdi**

Run: `node --test tests/git-conflicts.test.js && npm run test:unit`
Expected: PASS. `tests/git-ipc.test.js` e `tests/wiring.test.js` controllano
che ogni canale del preload abbia il suo handler: se elencano i canali a
mano, aggiungere i quattro nuovi.

- [ ] **Step 5: test con git vero**

In fondo a `tests/integration.test.js`, sul modello del test «unire un
branch nel corrente» (stessa preparazione del repository):

```js
ok('git: conflitti di merge, rebase e cherry-pick risolti dal pannello, con il git installato', async (t) => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const { resolveBinary } = require('../lib/binaries');
  const C = require('../lib/git-conflicts');
  const bin = resolveBinary('git');
  if (!bin.path) return t.skip('git non installato su questa macchina');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ais-conflitti-')));
  const git = (...args) => String(execFileSync(bin.path, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  const tryGit = (...args) => { try { git(...args); } catch { /* si ferma sui conflitti: voluto */ } };
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const commit = (file, text, msg) => { write(file, text); git('add', file); git('commit', '-q', '-m', msg); };
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Prova');
    git('config', 'user.email', 'p@x');
    git('config', 'core.hooksPath', '.git/hooks');
    git('config', 'commit.gpgsign', 'false');
    commit('a.txt', 'uno\n', 'init');
    git('switch', '-q', '-c', 'feat/x');
    commit('a.txt', 'dal branch\n', 'x1');
    commit('b.txt', 'b del branch\n', 'x2');
    git('switch', '-q', 'main');
    commit('a.txt', 'da main\n', 'm1');
    commit('b.txt', 'b di main\n', 'm2');
    const tip = git('rev-parse', 'HEAD');

    // Merge: tieni loro su a.txt, a mano b.txt, concludi
    tryGit('merge', '--no-edit', 'feat/x');
    let c = await C.readConflicts({ cwd: root });
    assert.strictEqual(c.op, 'merge');
    assert.deepStrictEqual(c.what.incoming, 'feat/x');
    assert.deepStrictEqual(c.files.map((f) => [f.path, f.kind, f.blocks]), [['a.txt', 'both-modified', 1], ['b.txt', 'both-added', 1]]);
    assert.match((await C.resolveFile({ cwd: root, path: 'b.txt', how: 'mark' })).error, /marcatori/);
    assert.match((await C.continueOp({ cwd: root, op: 'merge' })).error, /ancora in conflitto/);
    assert.deepStrictEqual(await C.resolveFile({ cwd: root, path: 'a.txt', how: 'theirs' }), { ok: true });
    write('b.txt', 'b sistemato\n');
    assert.deepStrictEqual(await C.resolveFile({ cwd: root, path: 'b.txt', how: 'mark' }), { ok: true });
    c = await C.readConflicts({ cwd: root });
    assert.deepStrictEqual(c.files, []);
    assert.deepStrictEqual(c.resolved, ['a.txt', 'b.txt']);
    assert.deepStrictEqual(await C.continueOp({ cwd: root, op: 'merge' }), { ok: true, done: true });
    assert.strictEqual(read('a.txt'), 'dal branch\n');
    assert.strictEqual(git('log', '-1', '--format=%s'), "Merge branch 'feat/x'");
    assert.strictEqual((await C.readConflicts({ cwd: root })).op, null);

    // Rebase su due commit in conflitto: si ferma due volte
    git('reset', '-q', '--hard', tip);
    git('switch', '-q', 'feat/x');
    tryGit('rebase', 'main');
    c = await C.readConflicts({ cwd: root });
    assert.strictEqual(c.op, 'rebase');
    assert.deepStrictEqual([c.what.incoming, c.what.into, c.what.step, c.what.total], ['feat/x', 'main', 1, 2]);
    assert.deepStrictEqual(await C.resolveFile({ cwd: root, path: 'a.txt', how: 'ours' }), { ok: true });
    assert.deepStrictEqual(await C.continueOp({ cwd: root, op: 'rebase' }), { ok: true, stopped: true });
    c = await C.readConflicts({ cwd: root });
    assert.strictEqual(c.what.step, 2);
    assert.deepStrictEqual(await C.resolveFile({ cwd: root, path: 'b.txt', how: 'theirs' }), { ok: true });
    assert.deepStrictEqual(await C.continueOp({ cwd: root, op: 'rebase' }), { ok: true, done: true });
    assert.strictEqual(read('b.txt'), 'b del branch\n');

    // Cherry-pick, poi abort: la cartella torna com'era
    git('switch', '-q', 'main');
    const before = git('rev-parse', 'HEAD');
    tryGit('cherry-pick', git('rev-parse', 'feat/x'));
    assert.strictEqual((await C.readConflicts({ cwd: root })).op, 'cherry-pick');
    assert.match((await C.abortOp({ cwd: root, op: 'merge' })).error, /pannello era vecchio/);
    assert.deepStrictEqual(await C.abortOp({ cwd: root, op: 'cherry-pick' }), { ok: true });
    assert.strictEqual(git('rev-parse', 'HEAD'), before);
    assert.strictEqual(git('status', '--porcelain'), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

Run: `node --test tests/integration.test.js`
Expected: PASS (o SKIP senza git).

- [ ] **Step 6: commit**

```
feat: leggere e risolvere i conflitti di un'operazione a metà

lib/git-conflicts.js dice cosa è a metà (merge, rebase, cherry-pick,
revert), i file in conflitto per tipo e i blocchi rimasti; risolve un
file, continua o annulla l'operazione. Ogni scrittura ricontrolla che
l'operazione sia ancora quella mostrata e che il file sia ancora in
conflitto. Quattro canali IPC per il pannello (piano 69).
```

---

### Task 4: «Unisci» lascia il merge a metà (cambio di comportamento)

**Files:**
- Modify: `lib/git-merge.js:60-75` (`undoMerge`)
- Modify: `lib/worktree.js:334-349` (`abortFailedMerge`)
- Modify: `renderer/worktree-actions.js:69,112-127`, `renderer/worktrees.js:20-31`
- Modify: `renderer/git-tab.js:55-62`
- Test: `tests/git-merge.test.js`, `tests/worktree.test.js`, `tests/worktree-actions.test.js`, `tests/integration.test.js:601-610,1229-1240`

**Interfaces:**
- Produces: al conflitto `mergeBranch` e `mergeWorktree` restituiscono
  `{ok: false, conflict: true, pending: true, root, files: string[], error}`;
  senza file in conflitto (hook, tempo scaduto) l'abort di prima.
- Produces: `createWorktreeActions({..., resolve?: (root) => Promise<void>})`,
  `api.abortMerge(root) → Promise<{ok, error?}>`.
- Consumes: `gitOpAbort(cwd, 'merge')` (Task 3). `openConflictsFor(root)`
  nasce nel Task 5: qui `git-tab.js` lo chiama solo se esiste
  (`typeof openConflictsFor === 'function'`) e `resolve` di `worktrees.js`
  si cabla nel Task 5. Fino ad allora «Risolvi» resta spento (`disabled: !resolve`).

- [ ] **Step 1: test che falliscono**

`tests/git-merge.test.js`: il test che oggi controlla l'abort sui conflitti
(riga ~108) diventa:

```js
ok('merge: conflitti → il merge resta a metà, coi file, niente abort', async () => {
  let aborted = false;
  const g = fakeGit({
    merge: () => { throw fail(1, '', { stdout: 'CONFLICT (content): Merge conflict in a.js\n', leavesMerge: true }); },
    conflicts: 'a.js\0lib/b.js\0',
    abort: () => { aborted = true; },
  });
  const r = await M.mergeBranch(opts(g));
  assert.strictEqual(aborted, false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(r.pending, true);
  assert.strictEqual(r.root, ROOT);
  assert.deepStrictEqual(r.files, ['a.js', 'lib/b.js']);
  assert.match(r.error, /a metà/);
});

ok('merge: fermo senza file in conflitto (hook) → annullato come prima', async () => {
  let aborted = false;
  const g = fakeGit({
    merge: () => { throw fail(1, 'hook pre-merge-commit fallito', { leavesMerge: true }); },
    conflicts: '',
    abort: () => { aborted = true; },
  });
  const r = await M.mergeBranch(opts(g));
  assert.strictEqual(aborted, true);
  assert.ok(!r.pending);
});
```

Il test vicino «abort che fallisce» (riga ~126) usa `conflicts: ''` per
continuare a provare l'abort fallito.

`tests/worktree.test.js`, al posto di «Unisci con conflitti annulla il merge»:

```js
ok('worktree: Unisci con conflitti lascia il merge a metà, worktree e branch', async () => {
  const { run, calls } = mergeRepo({ mergeFails: 'CONFLICT (content): Merge conflict in a.js', merging: true, over: { '--diff-filter=U': 'a.js\0' } });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(r.pending, true);
  assert.deepStrictEqual(r.files, ['a.js']);
  assert.strictEqual(r.root, '/src/progetto');
  const sent = argsOf(calls);
  assert.ok(!sent.includes('merge --abort'), 'annullato il merge');
  assert.ok(!sent.some((a) => a.startsWith('worktree remove') || a.startsWith('branch')), 'tolto il worktree dopo un conflitto');
});

ok('worktree: Unisci fermo senza file in conflitto annulla come prima', async () => {
  const { run, calls } = mergeRepo({ mergeFails: 'hook fallito', merging: true });
  const r = await mergeWorktree({ platform: 'linux', root: '/src/progetto', path: WT, run, rmdir: () => {} });
  assert.ok(!r.pending);
  assert.ok(argsOf(calls).includes('merge --abort'));
});
```

`tests/worktree-actions.test.js`, in `setup`:
- nuovi parametri `choices = null, aborts = []`;
- `choose` risponde `choices ? choices.shift() : choice` (menu, poi avviso);
- in `api`: `abortMerge: async (root) => { log.push(\`abort ${root}\`); return aborts.shift(); },`
- in `deps`: `resolve: async (root) => { log.push(\`resolve ${root}\`); },`

Il test «un conflitto lascia le sessioni vive» resta (risposta senza
`pending`); due test nuovi:

```js
const PENDING = { ok: false, conflict: true, pending: true, root: '/p', files: ['a.js'], error: 'Conflitti fra feat/x e main: il merge è a metà.' };

ok('azioni: merge a metà → chiede Risolvi o Annulla merge; Risolvi apre il pannello', async () => {
  const { actions, log, asked } = setup({ choices: ['merge', 'resolve'], asks: [true], merge: [PENDING], open: [{ id: 'a' }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  const q = asked[asked.length - 1];
  assert.deepStrictEqual(q.choices.map((c) => c.value), ['resolve', 'abort']);
  assert.match(q.text, /a metà/);
  assert.ok(log.includes('resolve /p'));
  assert.ok(!log.some((l) => l.startsWith('close')));
});

ok('azioni: merge a metà → Annulla merge fa l abort nella cartella principale', async () => {
  const { actions, log, told } = setup({ choices: ['merge', 'abort'], asks: [true], merge: [PENDING], aborts: [{ ok: true }] });
  await actions.openMenu(WT, '/p', ANCHOR);
  assert.ok(log.includes('abort /p'));
  assert.ok(!log.includes('resolve /p'));
  assert.strictEqual(told.length, 0);
});
```

`tests/integration.test.js`:
- riga ~601 (worktree): dopo `clash`, `assert.strictEqual(clash.pending, true)`,
  la cartella principale è a metà merge (`git(root, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')`
  non lancia), poi `git(root, 'merge', '--abort')` e la riga che controlla
  `status --porcelain` pulito resta.
- riga ~1229 (branch): stesso schema: `conf.pending === true`,
  `conf.files` = `['a.txt']`, poi `git('merge', '--abort')` prima dei
  controlli «la cartella com'era».

- [ ] **Step 2: verificare che falliscano**

Run: `npm run test:unit 2>&1 | grep "^not ok"`
Expected: FAIL sui test nuovi (`aborted` true, `pending` undefined).

- [ ] **Step 3: implementazione lib**

`lib/git-merge.js`, al posto di `undoMerge`:

```js
/* Un merge fermo sui conflitti resta a metà: si risolve dal pannello
   (docs/plans/69). Fermo per altro (un hook, il tempo) si annulla subito,
   come prima: non c'è niente da risolvere. */
async function undoMerge(run, root, name, into, error) {
  const merging = await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).then(() => true, () => false);
  if (!merging) return { ok: false, error };
  const files = await run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root }).then(parseNulList, () => []);
  if (files.length) {
    const list = files.map((f) => `  ${f}`).join('\n');
    return {
      ok: false, conflict: true, pending: true, root, files,
      error: `Conflitti fra ${name} e ${into}: il merge è a metà.\n\nFile in conflitto:\n${list}`,
    };
  }
  const aborted = await run(['merge', '--abort'], { cwd: root }).then(() => true, () => false);
  if (!aborted) {
    return { ok: false, conflict: true, files, error: `Il merge si è fermato e non si è potuto annullare: la cartella è a metà merge (git merge --abort).\n\n${error}` };
  }
  return { ok: false, error: `Il merge si è fermato ed è stato annullato, la cartella è com'era.\n\n${error}` };
}
```

(La JSDoc di `mergeBranch` aggiunge `pending?: boolean, root?: string`.)

`lib/worktree.js`, al posto di `abortFailedMerge`:

```js
/* Un merge rifiutato prima di cominciare non lascia niente da annullare; uno
   fermo sui conflitti resta a metà nella cartella principale, da risolvere
   dal pannello (docs/plans/69); fermo per altro si annulla */
async function abortFailedMerge(run, root, worktree, error) {
  const merging = await run(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).then(() => true, () => false);
  if (!merging) return { ok: false, error };
  const files = await run(['diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root })
    .then((t) => String(t).split('\0').filter(Boolean), () => []);
  if (files.length) {
    return {
      ok: false, conflict: true, pending: true, root, files,
      error: `Conflitti fra ${worktree.branch} e ${worktree.base}: il merge è a metà nella cartella principale.\n\n`
        + `File in conflitto:\n${files.map((f) => `  ${f}`).join('\n')}`,
    };
  }
  const aborted = await run(['merge', '--abort'], { cwd: root }).then(() => true, () => false);
  if (!aborted) {
    return { ok: false, conflict: true, error: `Il merge si è fermato e non si è potuto annullare: la cartella principale è a metà merge (git merge --abort).\n\n${error}` };
  }
  return { ok: false, error: `Il merge si è fermato ed è stato annullato, la cartella principale è com'era.\n\n${error}` };
}
```

(Niente `require('./git-changes')` in `worktree.js`: `git-changes` →
`git-commit` → `worktree` sarebbe un giro.)

- [ ] **Step 4: implementazione renderer**

`renderer/worktree-actions.js`: firma

```js
  function createWorktreeActions({ api, bubble, sessionsIn, closeSessions, refresh, review = null, resolve = null, confirmClose = async () => true }) {
```

e, in `openMenu`, prima di `// Il messaggio prima del rinfresco`:

```js
      if (res.pending) {
        await askPending(res, root, ctx);
        await refresh(root);
        return;
      }
```

con, accanto a `remove`:

```js
    /* Merge fermo sui conflitti (docs/plans/69): si risolve o si annulla.
       Chiudere la bolla lascia il merge a metà: il pannello lo ritrova. */
    async function askPending(res, root, ctx) {
      const pick = await bubble.choose({
        ...ctx,
        title: 'Conflitti: merge a metà',
        text: res.error,
        choices: [
          { value: 'resolve', label: 'Risolvi', hint: 'Apre il pannello dei conflitti sulla cartella principale', disabled: !resolve },
          { value: 'abort', label: 'Annulla merge', hint: 'La cartella principale torna com\'era', danger: true },
        ],
      });
      if (pick === 'resolve' && resolve) { await resolve(res.root || root); return; }
      if (pick !== 'abort') return;
      const undone = await call(() => api.abortMerge(res.root || root));
      if (!undone.ok) bubble.tell({ ...ctx, title: 'Non annullato', text: undone.error || 'Errore sconosciuto.' }).catch(() => {});
    }
```

`renderer/worktrees.js`, in `api`:

```js
    abortMerge: (root) => window.aisess.gitOpAbort(root, 'merge'),
```

(`resolve` si aggiunge nel Task 5, quando c'è `openConflictsFor`.)

`renderer/git-tab.js`, `mergeIntoCurrent`:

```js
  const r = await afterBranchChange(tab, window.aisess.gitMerge(tab.cwd, name, kind, seen.tip));
  // Fermo sui conflitti (docs/plans/69): il pannello si apre sulla scheda,
  // lì si risolve o si annulla; il selettore dice perché
  if (r && r.pending && typeof openConflictsFor === 'function') openConflictsFor(r.root).catch((e) => console.warn('[conflitti]', e));
  if (!r || !r.ok) return r;
```

- [ ] **Step 5: test verdi**

Run: `npm run test:unit && node --test tests/integration.test.js`
Expected: PASS.

- [ ] **Step 6: commit**

```
feat: Unisci lascia il merge a metà sui conflitti

Prima Unisci (branch e worktree) annullava subito il merge ed elencava
i file: un vicolo cieco. Ora sui conflitti il merge resta a metà e si
chiede «Risolvi» (pannello dei conflitti) o «Annulla merge». Un merge
fermo per altro, un hook o il tempo, si annulla come prima: lì non c'è
niente da risolvere (piano 69).
```

---

### Task 5: pannello in modalità Conflitti

**Files:**
- Create: `renderer/conflicts-model.js`, `renderer/conflicts-view.js`, `renderer/changes-conflicts.js`
- Create: `tests/conflicts-model.test.js`, `tests/conflicts-view.test.js`
- Modify: `renderer/changes-model.js` (esporta `writeBlock`)
- Modify: `renderer/changes-view.js` (factory, `render`)
- Modify: `renderer/changes-panel.js` (`changesState`, `renderChanges`, `refreshChanges`, `initChangesPanel`)
- Modify: `renderer/worktrees.js` (`resolve`)
- Modify: `renderer/index.html`, `renderer/styles.css`, `tests/renderer-source.js`

**Interfaces:**
- Consumes: canali del Task 3; `ChangesModel.writeBlock(tab, tabs, {root}, writing)`.
- Produces:
  - `AisessConflictsModel.viewState(c, {block, writing, outcome}) → {headline, sides: {ours, theirs}, files: [{path, kindLabel, blocksLabel, actions: [{how, label, title}]}], resolved: string[], footer: {continueLabel, canContinue, continueReason, abortLabel, canAbort, abortReason}, outcome}`;
    `outcomeOf(action, res) → {ok, text}|null`; `OP_NAMES`.
  - `AisessConflictsView.createConflictsPart({doc, onAction}) → {foot, items(state), render(state|null)}`;
    `onAction({how, path?, anchor})`, `how` ∈ `open, mark, ours, theirs, keep, delete, continue, abort`.
  - app: `openConflictsFor(root) → Promise<void>`, `handleConflict(action)`,
    `readConflictsOf(target) → Promise<object|null>`, `openEditorConflict(tab, rel)` (Task 6; fino ad allora `openEditorAt`).

- [ ] **Step 1: test del modello**

`tests/conflicts-model.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Modalità «Conflitti» del pannello (docs/plans/69): testata, nomi dei due
   lati per operazione, pulsanti. Niente DOM. */
const M = require('../renderer/conflicts-model');

const base = (op, what, files = [], resolved = []) => ({ ok: true, root: '/r', op, what, files, resolved });
const merge = base('merge', { incoming: 'feat/x', into: 'main', step: null, total: null, commit: 'abc1234', subject: null });

ok('conflitti: testata per merge, rebase, cherry-pick, revert', () => {
  assert.strictEqual(M.viewState(merge, {}).headline, 'Merge di feat/x in main, a metà');
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 3, total: 7, commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(rebase, {}).headline, 'Rebase di feat/x su main, passo 3 di 7 (abc1234 fix: x)');
  const pick = base('cherry-pick', { incoming: null, into: 'main', commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(pick, {}).headline, 'Cherry-pick di abc1234 fix: x in main');
  const rev = base('revert', { incoming: null, into: 'main', commit: 'abc1234', subject: 'fix: x' });
  assert.strictEqual(M.viewState(rev, {}).headline, 'Revert di abc1234 fix: x in main');
});

ok('conflitti: nostro e loro coi nomi, invertiti nel rebase', () => {
  assert.deepStrictEqual(M.viewState(merge, {}).sides, { ours: 'main', theirs: 'feat/x' });
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 1, total: 1, commit: 'abc1234', subject: 's' });
  assert.deepStrictEqual(M.viewState(rebase, {}).sides, { ours: 'main', theirs: 'abc1234 di feat/x' });
});

ok('conflitti: azioni per tipo di file', () => {
  const c = { ...merge, files: [
    { path: 'a.js', kind: 'both-modified', binary: false, blocks: 2 },
    { path: 'logo.png', kind: 'both-modified', binary: true, blocks: null },
    { path: 'old.js', kind: 'deleted-by-them', binary: false, blocks: 0 },
    { path: 'gone.js', kind: 'both-deleted', binary: false, blocks: null },
  ] };
  const [text, bin, del, both] = M.viewState(c, {}).files;
  assert.deepStrictEqual(text.actions.map((a) => a.how), ['open', 'mark']);
  assert.strictEqual(text.blocksLabel, '2 blocchi');
  assert.strictEqual(text.kindLabel, 'modificato da entrambi');
  assert.deepStrictEqual(bin.actions.map((a) => [a.how, a.label]), [['ours', 'Tieni main'], ['theirs', 'Tieni feat/x']]);
  assert.strictEqual(bin.kindLabel, 'binario, modificato da entrambi');
  assert.deepStrictEqual(del.actions.map((a) => a.how), ['keep', 'delete']);
  assert.strictEqual(del.kindLabel, 'cancellato in feat/x');
  assert.deepStrictEqual(both.actions.map((a) => a.how), ['delete']);
});

ok('conflitti: Concludi solo a zero conflitti e senza sessioni al lavoro', () => {
  const withFile = { ...merge, files: [{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }] };
  const f1 = M.viewState(withFile, {}).footer;
  assert.strictEqual(f1.continueLabel, 'Concludi merge');
  assert.strictEqual(f1.canContinue, false);
  assert.match(f1.continueReason, /1 file in conflitto/);
  assert.strictEqual(f1.canAbort, true);
  assert.strictEqual(f1.abortLabel, 'Annulla merge');
  const f2 = M.viewState(merge, {}).footer;
  assert.strictEqual(f2.canContinue, true);
  const f3 = M.viewState(merge, { block: 'La sessione sta lavorando: aspetta che si fermi.' }).footer;
  assert.strictEqual(f3.canContinue, false);
  assert.strictEqual(f3.canAbort, false);
  assert.match(f3.abortReason, /sta lavorando/);
  const rebase = base('rebase', { incoming: 'feat/x', into: 'main', step: 1, total: 2, commit: 'a', subject: 's' });
  assert.strictEqual(M.viewState(rebase, {}).footer.continueLabel, 'Continua rebase');
  assert.strictEqual(M.viewState(rebase, {}).footer.abortLabel, 'Annulla rebase');
});

ok('conflitti: esiti', () => {
  assert.deepStrictEqual(M.outcomeOf({ how: 'mark' }, { ok: false, error: 'marcatori' }), { ok: false, text: 'marcatori' });
  assert.strictEqual(M.outcomeOf({ how: 'mark' }, { ok: true }), null);
  assert.match(M.outcomeOf({ how: 'continue' }, { ok: true, stopped: true }).text, /fermata di nuovo/);
  assert.match(M.outcomeOf({ how: 'continue' }, { ok: true, done: true }).text, /concluso/i);
});
```

- [ ] **Step 2: verificare che fallisca**

Run: `node --test tests/conflicts-model.test.js`
Expected: FAIL «Cannot find module».

- [ ] **Step 3: `renderer/conflicts-model.js`**

```js
/* Modalità «Conflitti» del pannello delle modifiche (docs/plans/69): cosa
 * dice la testata, come si chiamano i due lati, quali pulsanti ha ogni file
 * e il piè di pagina. Niente DOM: lo disegna conflicts-view.js.
 *
 * «Nostro» e «loro» si dicono coi nomi: in un merge nostro è il branch
 * corrente e loro quello che entra; in un rebase git li inverte (nostro è
 * la base su cui si riapplica, loro il commit che si sta riapplicando).
 *
 * Wrapper UMD come changes-model.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictsModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const OP_NAMES = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' };
  const OP_TITLES = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };

  const commitText = (w) => [w.commit, w.subject].filter(Boolean).join(' ');

  function headline({ op, what: w }) {
    if (op === 'merge') return `Merge di ${w.incoming || w.commit || '?'} in ${w.into || 'HEAD'}, a metà`;
    if (op === 'rebase') {
      const step = w.step && w.total ? `, passo ${w.step} di ${w.total}` : '';
      const commit = commitText(w) ? ` (${commitText(w)})` : '';
      return `Rebase di ${w.incoming || 'HEAD'} su ${w.into || '?'}${step}${commit}`;
    }
    return `${OP_TITLES[op]} di ${commitText(w) || '?'} in ${w.into || 'HEAD'}`;
  }

  function sides({ op, what: w }) {
    if (op === 'rebase') return { ours: w.into || 'la base', theirs: w.incoming ? `${w.commit} di ${w.incoming}` : w.commit || 'il commit' };
    if (op === 'merge') return { ours: w.into || 'HEAD', theirs: w.incoming || w.commit || 'in arrivo' };
    return { ours: w.into || 'HEAD', theirs: w.commit || 'il commit' };
  }

  function kindLabel(f, s) {
    const labels = {
      'both-modified': 'modificato da entrambi', 'both-added': 'aggiunto da entrambi',
      'deleted-by-us': `cancellato in ${s.ours}`, 'deleted-by-them': `cancellato in ${s.theirs}`,
      'added-by-us': `aggiunto solo in ${s.ours}`, 'added-by-them': `aggiunto solo in ${s.theirs}`,
      'both-deleted': 'cancellato da entrambi',
    };
    const label = labels[f.kind] || 'in conflitto';
    return f.binary ? `binario, ${label}` : label;
  }

  const blocksLabel = (n) => (typeof n !== 'number' || n === 0 ? '' : n === 1 ? '1 blocco' : `${n} blocchi`);

  function actionsOf(f, s) {
    const both = f.kind === 'both-modified' || f.kind === 'both-added';
    if (both && f.binary) {
      return [
        { how: 'ours', label: `Tieni ${s.ours}`, title: `Tieni la versione di ${s.ours}` },
        { how: 'theirs', label: `Tieni ${s.theirs}`, title: `Tieni la versione di ${s.theirs}` },
      ];
    }
    if (both) {
      return [
        { how: 'open', label: '✎', title: 'Apri nell\'editor' },
        { how: 'mark', label: 'Segna risolto', title: 'Segna risolto (git add): il file non deve avere più marcatori' },
      ];
    }
    const keep = { how: 'keep', label: 'Tieni il file', title: 'Tieni il file com\'è nella cartella (git add)' };
    const drop = { how: 'delete', label: 'Eliminalo', title: 'Elimina il file (git rm)' };
    return f.kind === 'both-deleted' ? [drop] : [keep, drop];
  }

  function footer(c, block) {
    const name = OP_NAMES[c.op];
    const left = c.files.length;
    const continueLabel = c.op === 'merge' ? 'Concludi merge' : `Continua ${name}`;
    const continueReason = block || (left ? `${left} file in conflitto: risolvili prima.` : null);
    return {
      continueLabel, canContinue: !continueReason, continueReason,
      abortLabel: `Annulla ${name}`, canAbort: !block, abortReason: block || null,
    };
  }

  /**
   * @param {{op: string, what: object, files: object[], resolved: string[]}} c da gitConflicts
   * @param {{block?: string|null, outcome?: object|null}} o `block`: perché adesso non si scrive
   */
  function viewState(c, { block = null, outcome = null } = {}) {
    const s = sides(c);
    return {
      headline: headline(c),
      sides: s,
      files: c.files.map((f) => ({ path: f.path, kindLabel: kindLabel(f, s), blocksLabel: blocksLabel(f.blocks), actions: actionsOf(f, s) })),
      resolved: c.resolved,
      footer: footer(c, block),
      outcome,
    };
  }

  function outcomeOf(action, res) {
    if (!res || !res.ok) return { ok: false, text: (res && res.error) || 'git ha rifiutato l\'operazione.' };
    if (action.how !== 'continue') return null;
    return res.stopped
      ? { ok: true, text: 'Passo fatto: l\'operazione si è fermata di nuovo su altri conflitti.' }
      : { ok: true, text: 'Concluso.' };
  }

  return { viewState, outcomeOf, OP_NAMES };
});
```

- [ ] **Step 4: test della vista**

`tests/conflicts-view.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, descendants, fire } = require('./fake-dom');

/* La modalità «Conflitti» disegnata (docs/plans/69): elenco, pulsanti e piè
   di pagina su un DOM finto. Percorsi e nomi restano testo. */
const { createConflictsPart } = require('../renderer/conflicts-view');
const M = require('../renderer/conflicts-model');

const doc = { createElement };
const byClass = (root, cls) => descendants(root).filter((n) => n.classes.has(cls));
const textOf = (el) => [el.textContent, ...el.children.map(textOf)].join('');

const c = {
  ok: true, root: '/r', op: 'merge',
  what: { incoming: '<b>feat</b>', into: 'main', step: null, total: null, commit: 'abc1234', subject: null },
  files: [{ path: '<img src=x>.js', kind: 'both-modified', binary: false, blocks: 1 }],
  resolved: ['README.md'],
};

ok('vista conflitti: file, pulsanti e risolti, tutto come testo', () => {
  const acts = [];
  const part = createConflictsPart({ doc, onAction: (a) => acts.push(a) });
  const state = M.viewState(c, {});
  part.render(state);
  const box = createElement('div');
  box.replaceChildren(...part.items(state));
  assert.match(textOf(box), /<img src=x>\.js/);
  assert.match(textOf(box), /Risolti \(1\)/);
  assert.ok(!descendants(box).some((n) => n.tagName === 'IMG'));
  const mark = byClass(box, 'conflicts-action').find((b) => b.textContent === 'Segna risolto');
  fire(mark, 'click');
  assert.deepStrictEqual(acts.map((a) => [a.how, a.path]), [['mark', '<img src=x>.js']]);
});

ok('vista conflitti: piè di pagina spento con conflitti, il motivo nel title', () => {
  const acts = [];
  const part = createConflictsPart({ doc, onAction: (a) => acts.push(a) });
  part.render(M.viewState(c, {}));
  const [go] = byClass(part.foot, 'conflicts-continue');
  assert.strictEqual(go.textContent, 'Concludi merge');
  assert.strictEqual(go.disabled, true);
  assert.match(go.title, /in conflitto/);
  const [abort] = byClass(part.foot, 'conflicts-abort');
  fire(abort, 'click');
  assert.deepStrictEqual(acts.map((a) => a.how), ['abort']);
  part.render(null);
  assert.strictEqual(part.foot.hidden, true);
});
```

- [ ] **Step 5: `renderer/conflicts-view.js`**

```js
/* Modalità «Conflitti» del pannello delle modifiche (docs/plans/69): le
 * righe dei file in conflitto, i risolti e il piè di pagina con Concludi /
 * Continua e Annulla. changes-view.js le mette al posto dell'elenco solito.
 * Tutto con textContent: percorsi, nomi di branch e messaggi vengono da git.
 *
 * Wrapper UMD come changes-view.js. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessConflictsView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function el(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(doc, cls, text, title, onClick) {
    const b = el(doc, 'button', cls, text);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  /**
   * @param {{doc: Document, onAction: (a: {how: string, path?: string, anchor: Element}) => void}} o
   */
  function createConflictsPart({ doc, onAction }) {
    const foot = el(doc, 'div', 'conflicts-foot');
    foot.hidden = true;
    const outcome = el(doc, 'div', 'conflicts-outcome');
    const abort = button(doc, 'conflicts-abort', '', '', (b) => onAction({ how: 'abort', anchor: b }));
    const go = button(doc, 'conflicts-continue', '', '', (b) => onAction({ how: 'continue', anchor: b }));
    foot.appendChild(outcome);
    foot.appendChild(go);
    foot.appendChild(abort);

    function fileRow(f) {
      const row = el(doc, 'div', 'conflicts-file');
      row.appendChild(el(doc, 'span', 'conflicts-path', f.path));
      row.appendChild(el(doc, 'span', 'conflicts-kind', [f.kindLabel, f.blocksLabel].filter(Boolean).join(' · ')));
      for (const a of f.actions) {
        row.appendChild(button(doc, `conflicts-action is-${a.how}`, a.label, a.title, (b) => onAction({ how: a.how, path: f.path, anchor: b })));
      }
      return row;
    }

    function resolvedRow(p) {
      const row = el(doc, 'div', 'conflicts-file is-resolved');
      row.appendChild(el(doc, 'span', 'conflicts-path', p));
      row.appendChild(button(doc, 'conflicts-action is-open', '✎', 'Apri nell\'editor', (b) => onAction({ how: 'open', path: p, anchor: b })));
      return row;
    }

    function items(state) {
      const out = [el(doc, 'div', 'conflicts-heading', `In conflitto (${state.files.length})`)];
      out.push(...state.files.map(fileRow));
      if (!state.files.length) out.push(el(doc, 'div', 'changes-empty', 'Nessun file in conflitto.'));
      if (state.resolved.length) {
        out.push(el(doc, 'div', 'conflicts-heading', `Risolti (${state.resolved.length})`));
        out.push(...state.resolved.map(resolvedRow));
      }
      return out;
    }

    function render(state) {
      foot.hidden = !state;
      if (!state) return;
      const f = state.footer;
      go.textContent = f.continueLabel;
      go.title = f.continueReason || f.continueLabel;
      go.setAttribute('aria-label', go.title);
      go.disabled = !f.canContinue;
      abort.textContent = f.abortLabel;
      abort.title = f.abortReason || f.abortLabel;
      abort.setAttribute('aria-label', abort.title);
      abort.disabled = !f.canAbort;
      outcome.hidden = !state.outcome;
      outcome.textContent = state.outcome ? state.outcome.text : '';
      outcome.classList.toggle('is-error', Boolean(state.outcome && !state.outcome.ok));
    }

    return { foot, items, render };
  }

  return { createConflictsPart };
});
```

Run: `node --test tests/conflicts-model.test.js tests/conflicts-view.test.js`
Expected: PASS (se `fake-dom` non ha `replaceChildren` su un `div`, usare
`part.items(state).forEach((n) => box.appendChild(n))`).

- [ ] **Step 6: agganci in `changes-view.js` e `changes-model.js`**

`renderer/changes-model.js`: aggiungere `writeBlock` e `insideRoot`
all'oggetto restituito (il `return {` in fondo al file).

`renderer/changes-view.js`:
- factory: `factory(root && root.AisessChangesModel, root && root.AisessReviewNotes, root && root.AisessConflictsView)`
  e sotto Node `require('./conflicts-view')` come terzo argomento (seguire la
  forma che il file usa già per i primi due); la funzione riceve `ConflictsView`.
- `createChangesView({..., onConflict = null})`; dopo il piè di pagina dello
  scarto: `const conflictsPart = ConflictsView.createConflictsPart({ doc, onAction: (a) => onConflict && onConflict(a) });`
  e il suo `foot` aggiunto al pannello accanto a `discardFoot.foot` (stesso
  `appendChild`).
- in `render(state)`, dopo `discardFoot.render(state.discard || null);`:

```js
      conflictsPart.render(state.conflicts || null);
```

  e, al posto della riga `if (state.files.length) items.push(...fileItems(...))`:

```js
      if (state.conflicts) items.push(...conflictsPart.items(state.conflicts));
      else if (state.files.length) items.push(...fileItems(doc, state, diffOf, onFile, reviewOf(state), cc, onOpen));
```

  e la riga dell'elenco vuoto diventa `else if (!state.files.length && !state.conflicts)`.

Test in `tests/changes-view.test.js`:

```js
ok('pannello: con i conflitti l elenco e il piè di pagina sono quelli dei conflitti', () => {
  const M = require('../renderer/conflicts-model');
  const acts = [];
  const { host, view } = setup({ onConflict: (a) => acts.push(a) });
  const c = { ok: true, root: '/r', op: 'merge', what: { incoming: 'feat/x', into: 'main', commit: 'a' },
    files: [{ path: 'a.js', kind: 'both-modified', binary: false, blocks: 1 }], resolved: [] };
  view.render(baseState({ files: [], conflicts: M.viewState(c, {}) }));
  assert.strictEqual(byClass(host, 'conflicts-file').length, 1);
  assert.strictEqual(byClass(host, 'changes-empty').length, 0);
  assert.strictEqual(one(host, 'conflicts-foot').hidden, false);
  fire(byClass(host, 'conflicts-action').find((b) => b.textContent === 'Segna risolto'), 'click');
  assert.deepStrictEqual(acts.map((a) => a.how), ['mark']);
});
```

(`setup`, `baseState`, `byClass`, `one`, `fire` ci sono già in cima a
`tests/changes-view.test.js`.)

- [ ] **Step 7: `renderer/changes-conflicts.js`**

```js
/* ---------- Conflitti (docs/plans/69) ----------
 * Con un merge, rebase, cherry-pick o revert a metà il pannello delle
 * modifiche passa da sé alla modalità «Conflitti». La lettura parte solo a
 * pannello aperto e fuori da «Unisci»; le scritture una alla volta, come
 * quelle di staging (changes-panel.js, runCommitAction). */
const ConflictsModel = window.AisessConflictsModel;

/* I conflitti della cartella del pannello, o null se non c'è niente a metà */
async function readConflictsOf(target) {
  if (!target || !changesState.open || changesState.merge) return null;
  try {
    const r = await window.aisess.gitConflicts(target.cwd);
    return r && r.ok && r.op ? r : null;
  } catch (e) {
    console.warn('[conflitti]', e);
    return null;
  }
}

function conflictsStateOf(tab) {
  const c = changesState.conflicts;
  if (!c || changesState.merge) return null;
  const block = ChangesModel.writeBlock(tab, [...tabs.values()], { root: c.root }, changesState.writing);
  return ConflictsModel.viewState(c, { block, outcome: changesState.conflictOutcome });
}

const CONFLICT_CALLS = {
  continue: (c) => window.aisess.gitOpContinue(c.root, c.op),
  abort: (c) => window.aisess.gitOpAbort(c.root, c.op),
};
const callFor = (c, a) => (CONFLICT_CALLS[a.how] ? CONFLICT_CALLS[a.how](c) : window.aisess.gitConflictResolve(c.root, a.path, a.how));

function handleConflict(action) {
  if (!action || !changesState.conflicts) return;
  if (action.how === 'open') {
    openConflictFile(action.path).catch((e) => console.warn('[conflitti] apri nell\'editor', e));
    return;
  }
  runConflictAction(action).catch((e) => console.warn('[conflitti]', e));
}

/* Si ricontrolla qui quello che la vista ha già spento: fra il disegno e il
   clic una sessione può essere ripartita */
async function runConflictAction(action) {
  const c = changesState.conflicts;
  const view = conflictsStateOf(activeTab());
  if (!c || !view || changesState.writing) return;
  if (action.how === 'continue' && !view.footer.canContinue) return;
  if (action.how === 'abort') {
    if (!view.footer.canAbort) return;
    const sure = await closeConfirm.ask({
      anchor: action.anchor, title: `${view.footer.abortLabel}?`, confirmLabel: view.footer.abortLabel,
      text: 'Il lavoro di risoluzione fatto finora si perde: la cartella torna com\'era prima dell\'operazione.',
    });
    if (!sure) return;
  }
  const key = changesState.target && changesState.target.key;
  setChangesState({ writing: true, conflictOutcome: null });
  let res;
  try {
    res = await callFor(c, action);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  const same = Boolean(changesState.target && changesState.target.key === key);
  setChangesState({ writing: false, conflictOutcome: same ? ConflictsModel.outcomeOf(action, res) : null });
  const tab = activeTab();
  if (res && res.ok && !['mark', 'ours', 'theirs', 'keep', 'delete'].includes(action.how) && tab && tab.type === 'git') {
    refreshGitTab(tab).catch((e) => console.warn('[conflitti] timeline', e));
  }
  await refreshChanges();
}

/* Come openChangedFile, ma sulla radice dei conflitti e col cursore al primo blocco */
async function openConflictFile(path) {
  const c = changesState.conflicts;
  if (!c || typeof c.root !== 'string') return;
  const target = window.AisessEditorRoute.editorTarget({
    repoRoot: c.root, file: path, tabs: Order.applyOrder([...tabs.values()], sessionOrder), activeId,
  });
  if (!target) return;
  let tab = target.tabId ? tabs.get(target.tabId) : null;
  if (tab) setActive(tab.id);
  else tab = await createTab('editor', { cwd: target.cwd });
  if (!tab || !tabs.has(tab.id)) return;
  if (changesState.open) toggleChangesPanel(false);
  await (typeof openEditorConflict === 'function' ? openEditorConflict(tab, target.rel) : openEditorAt(tab, target.rel));
}

/* «Risolvi» da Unisci: una scheda sulla cartella col merge a metà (quella
   attiva se ci sta, poi la prima editor, altrimenti una nuova) e il pannello aperto */
async function openConflictsFor(root) {
  if (typeof root !== 'string' || !root) return;
  const inside = (t) => t && ChangesModel.insideRoot(t.cwd, root);
  const ordered = Order.applyOrder([...tabs.values()], sessionOrder);
  let tab = inside(activeTab()) ? activeTab()
    : ordered.find((t) => t.type === 'editor' && inside(t)) || null;
  if (tab) setActive(tab.id);
  else tab = await createTab('editor', { cwd: root });
  if (!tab || !tabs.has(tab.id)) return;
  toggleChangesPanel(true);
}
```

`insideRoot` esiste già in `changes-model.js` (riga ~218, la usa
`writeBlock`): va solo esportato, nello Step 6.

- [ ] **Step 8: agganci in `changes-panel.js`**

- `changesState` iniziale: aggiungere `conflicts: null, conflictsSignature: null, conflictOutcome: null`.
- `refreshChanges`, nel reset quando cambia la scheda: aggiungere
  `conflicts: null, conflictsSignature: null, conflictOutcome: null`.
- `refreshChanges`, dopo `changesState = { ...changesState, seq };`:

```js
  // Un'operazione a metà (docs/plans/69): il pannello parla di quella
  const conflicts = await readConflictsOf(target);
  if (seq !== changesState.seq) return;
  if (conflicts || changesState.conflicts) {
    const conflictsSignature = conflicts ? JSON.stringify(conflicts) : null;
    if (conflictsSignature !== changesState.conflictsSignature) {
      setChangesState({ conflicts, conflictsSignature, conflictOutcome: conflicts ? changesState.conflictOutcome : null });
    }
    if (conflicts) return;
  }
```

- `renderChanges`: `const conflicts = conflictsStateOf(activeTab());` in
  cima; nel `render`:
  - `open: open && Boolean(target) && (Boolean(conflicts) || readable || Boolean(merge) || !result),`
  - `loading: !result && !conflicts,`
  - `title: conflicts ? conflicts.headline : ChangesModel.headerTitle(...)`,
  - `heading: merge ? 'Stai per unire' : conflicts ? 'Conflitti' : 'Modifiche',`
  - `modes: merge || conflicts ? null : …`, `review: conflicts ? null : …`,
    `commit: conflicts ? null : …`, `discard: merge || conflicts ? null : …`,
  - `conflicts,`
- `noteChangesRunning`: ridisegnare anche con `changesState.conflicts`.
- `initChangesPanel`: `onConflict: (action) => handleConflict(action),`.

`renderer/worktrees.js`, in `createWorktreeActions({...})`:

```js
  // «Risolvi» dopo un Unisci fermo sui conflitti (docs/plans/69)
  resolve: (root) => openConflictsFor(root),
```

- [ ] **Step 9: pagina, stili, elenco degli script**

`renderer/index.html`: `conflicts-model.js` e `conflicts-view.js` subito
prima di `changes-view.js`; `changes-conflicts.js` subito dopo
`changes-panel.js`. `tests/renderer-source.js`: `'changes-conflicts.js'`
in `RENDERER_APP_FILES` dopo `'changes-panel.js'`.

`renderer/styles.css`, accanto agli stili `.changes-*`:

```css
/* Modalità Conflitti (docs/plans/69) */
.conflicts-heading { padding: 8px 12px 4px; font-size: 11px; text-transform: uppercase; opacity: 0.7; }
.conflicts-file { display: flex; align-items: center; gap: 8px; padding: 4px 12px; }
.conflicts-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conflicts-kind { flex: none; font-size: 11px; opacity: 0.7; }
.conflicts-file.is-resolved .conflicts-path { opacity: 0.7; }
.conflicts-action { flex: none; }
.conflicts-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border); }
.conflicts-outcome { flex: 1 1 auto; font-size: 12px; }
.conflicts-outcome.is-error { color: var(--danger); }
.conflicts-abort { color: var(--danger); }
```

(Usare le variabili di colore che `styles.css` ha già per bordi e pericolo:
cercare quelle usate da `.changes-discard-*`.)

- [ ] **Step 10: test verdi**

Run: `npm run test:unit`
Expected: PASS, compreso `renderer-load.test.js` (ordine degli script).

- [ ] **Step 11: commit**

```
feat: pannello delle modifiche in modalità Conflitti

Con un merge, rebase, cherry-pick o revert a metà il pannello non si
spegne più: elenca i file in conflitto per tipo, con le scelte che hanno
senso per ognuno (editor e Segna risolto, tieni un lato per i binari,
tieni o elimina per i cancellati), i risolti, e Concludi / Continua /
Annulla. Testata ed etichette dicono nostro e loro coi nomi dei branch,
invertiti nel rebase. «Risolvi» da Unisci apre qui (piano 69).
```

---

### Task 6: blocchi nell'editor

**Files:**
- Modify: `renderer/editor-monaco.js` (`make`, due metodi, `return`)
- Create: `renderer/editor-conflicts.js`
- Modify: `renderer/editor-tab.js:327-333` (`onEditorTextChange`), `:376` (`openEditorFile` dopo `host.open`)
- Modify: `renderer/index.html` (prima di `editor-tab.js`), `tests/renderer-source.js`, `renderer/styles.css`
- Test: `tests/editor-monaco.test.js`, `tests/editor-tab-setup.js`, `tests/editor-conflicts.test.js` (nuovo)

**Interfaces:**
- Consumes: `AisessConflictMarkers.parseBlocks/applyChoice` (Task 2).
- Produces: host `setConflicts(rel, blocks)`, `editText(rel, text)`; app
  `updateEditorConflicts(tab, rel)`, `scheduleEditorConflicts(tab, rel)`,
  `chooseEditorConflict(tab, rel, index, choice)`, `openEditorConflict(tab, rel) → Promise<boolean>`.

- [ ] **Step 1: test dell'host**

In `tests/editor-monaco.test.js`, il model finto ha già `deltaDecorations`
e `pushEditOperations`; aggiungere al model finto
`pushStackElement: () => { m.stack = (m.stack || 0) + 1; },`. Poi:

```js
ok('monaco: setConflicts colora marcatori, nostro, base e loro a righe intere', () => {
  const { h, fake } = host();
  h.open('a.txt', 'x\n<<<<<<< HEAD\nn\n||||||| b\nb\n=======\nl\n>>>>>>> f\n');
  const blocks = [{ start: 2, base: 4, sep: 6, end: 8, ours: [3, 3], theirs: [7, 7] }];
  h.setConflicts('a.txt', blocks);
  const m = fake.models[0];
  const classes = m.decorations.map((d) => [d.range.startLineNumber, d.range.endLineNumber, d.options.className]);
  assert.deepStrictEqual(classes.sort((a, b) => a[0] - b[0]), [
    [2, 2, 'editor-conflict-marker'], [3, 3, 'editor-conflict-ours'], [4, 5, 'editor-conflict-base'],
    [6, 6, 'editor-conflict-marker'], [7, 7, 'editor-conflict-theirs'], [8, 8, 'editor-conflict-marker'],
  ]);
  assert.ok(m.decorations.every((d) => d.options.isWholeLine));
  h.setConflicts('a.txt', []);
  assert.deepStrictEqual(m.decorations, []);
});

ok('monaco: editText è una modifica dell utente, annullabile, che lascia il file sporco', () => {
  const { h, fake, changes } = host();
  h.open('a.txt', 'uno\n');
  h.editText('a.txt', 'due\n');
  assert.strictEqual(h.getText('a.txt'), 'due\n');
  assert.strictEqual(h.isDirty('a.txt'), true);
  assert.deepStrictEqual(changes.pop(), ['a.txt', true]);
  assert.strictEqual(fake.models[0].stack, 2); // un passo di undo tutto suo
});
```

Se `m.decorations` nel model finto è l'insieme di tutte le decorazioni
(barrette comprese), confrontare solo quelle con `className` che comincia
per `editor-conflict-`.

- [ ] **Step 2: verificare che falliscano**

Run: `node --test tests/editor-monaco.test.js`
Expected: FAIL «host.setConflicts is not a function».

- [ ] **Step 3: host**

`renderer/editor-monaco.js`:
- in `make`, `gutter: [], conflicts: [],`
- accanto a `setGutter`:

```js
    /* Righe dei conflitti (docs/plans/69): marcatori, nostro, base e loro */
    function conflictDecorations(b) {
      const lines = (from, to, className) => ({
        range: { startLineNumber: from, startColumn: 1, endLineNumber: to, endColumn: 1 },
        options: { isWholeLine: true, className },
      });
      const out = [b.start, b.sep, b.end].map((n) => lines(n, n, 'editor-conflict-marker'));
      if (b.ours[0] <= b.ours[1]) out.push(lines(b.ours[0], b.ours[1], 'editor-conflict-ours'));
      if (b.base !== null && b.base !== undefined) out.push(lines(b.base, b.sep - 1, 'editor-conflict-base'));
      if (b.theirs[0] <= b.theirs[1]) out.push(lines(b.theirs[0], b.theirs[1], 'editor-conflict-theirs'));
      return out;
    }

    function setConflicts(rel, blocks) {
      const d = docs.get(rel);
      if (!d) return;
      d.conflicts = d.model.deltaDecorations(d.conflicts, (blocks || []).flatMap(conflictDecorations));
    }

    /* Testo nuovo come modifica dell'utente (una scelta su un conflitto): il
       file resta sporco e Ctrl+Z la annulla in un colpo, al contrario di
       replaceText che è il disco che cambia */
    function editText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const spans = spansOf(d);
      d.model.pushStackElement();
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      d.model.pushStackElement();
      putMarks(d, spans);
      followZones(d);
      if (view) editor.restoreViewState(view);
    }
```

- nel `return`: `setConflicts, editText,` dopo `setGutter`.

Run: `node --test tests/editor-monaco.test.js` → PASS.

- [ ] **Step 4: test della scheda**

`tests/editor-tab-setup.js`, in `fakeHost`:

```js
    conflicts: [], // a parte come gutters: i blocchi colorati
    setConflicts(rel, blocks) { this.conflicts.push([rel, blocks.map((b) => b.start)]); },
    editText(rel, text) { calls.push(['editText', rel, text]); texts[rel] = text; dirty.add(rel); },
```

`tests/editor-conflicts.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { settle, setup, plain } = require('./editor-tab-setup');

/* Conflitti nella scheda editor (docs/plans/69, renderer/editor-conflicts.js):
   colori e zone sui blocchi, le scelte, con la pagina vera e un host finto. */
const CONFLICT = 'su\n<<<<<<< HEAD\nnostro\n=======\nloro\n>>>>>>> feat/x\ngiu\n';
const read = (text) => async (root, rel) => ({ ok: true, text, mtime: 100, path: `${root}/${rel}`, bom: false });

ok('editor conflitti: aprendo un file coi marcatori, colori e una zona per blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', [2]]);
  const zones = [...s.host.zones.values()].filter((z) => z.rel === 'a.txt');
  assert.deepStrictEqual(zones.map((z) => z.afterLine), [2]);
});

ok('editor conflitti: una scelta sostituisce il blocco come modifica, e le zone se ne vanno', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  await s.fn('openEditorFile')(s.tab, 'a.txt');
  await settle();
  s.fn('chooseEditorConflict')(s.tab, 'a.txt', 0, 'both');
  assert.deepStrictEqual(s.host.calls.filter((c) => c[0] === 'editText'), [['editText', 'a.txt', 'su\nnostro\nloro\ngiu\n']]);
  s.fn('updateEditorConflicts')(s.tab, 'a.txt'); // l'host vero lo fa da onChange
  assert.deepStrictEqual(plain(s.host.conflicts).pop(), ['a.txt', []]);
  assert.strictEqual([...s.host.zones.values()].filter((z) => z.rel === 'a.txt').length, 0);
});

ok('editor conflitti: senza marcatori niente zone, e un blocco sparito non si applica', async () => {
  const s = setup({ main: { editorRead: read('pulito\n'), editorHeadText: async () => ({ ok: true, text: 'pulito\n' }) } });
  await s.fn('openEditorFile')(s.tab, 'b.txt');
  await settle();
  assert.strictEqual(s.host.zones.size, 0);
  s.fn('chooseEditorConflict')(s.tab, 'b.txt', 0, 'ours');
  assert.ok(!s.host.calls.some((c) => c[0] === 'editText'));
});

ok('editor conflitti: openEditorConflict porta il cursore al primo blocco', async () => {
  const s = setup({ main: { editorRead: read(CONFLICT), editorHeadText: async () => ({ ok: true, text: CONFLICT }) } });
  assert.strictEqual(await s.fn('openEditorConflict')(s.tab, 'a.txt'), true);
  assert.deepStrictEqual(s.host.reveals, [['a.txt', 2]]);
});
```

Run: `node --test tests/editor-conflicts.test.js`
Expected: FAIL «chooseEditorConflict is not a function» (o `s.fn` che non trova la funzione).

- [ ] **Step 5: `renderer/editor-conflicts.js`**

```js
/* Conflitti nella scheda editor (docs/plans/69): le righe di nostro e di
 * loro colorate e, sotto ogni `<<<<<<<`, una zona con «Tieni nostro · Tieni
 * loro · Tieni entrambi». La scelta è una modifica del testo (editText):
 * Ctrl+Z la annulla, salvare resta quello di sempre, «Segna risolto» sta
 * nel pannello. I blocchi si rileggono a ogni modifica, a riposo come le
 * barrette (editor-tab-gutter.js). */
const ConflictMarkers = window.AisessConflictMarkers;
const CONFLICT_ZONE_PX = 26;
const EDITOR_CONFLICTS_DELAY = 300;
const CONFLICT_CHOICES = [
  { choice: 'ours', label: 'Tieni nostro', side: 'oursLabel' },
  { choice: 'theirs', label: 'Tieni loro', side: 'theirsLabel' },
  { choice: 'both', label: 'Tieni entrambi', side: null },
];

function conflictBar(tab, rel, index, block) {
  const bar = document.createElement('div');
  bar.className = 'editor-conflict-bar';
  for (const c of CONFLICT_CHOICES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `editor-conflict-choice is-${c.choice}`;
    b.textContent = c.label;
    b.title = c.side && block[c.side] ? `${c.label} (${block[c.side]})` : c.label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // il fuoco resta nel testo
    b.addEventListener('click', () => chooseEditorConflict(tab, rel, index, c.choice));
    bar.appendChild(b);
  }
  return bar;
}

/* Colori e zone del file: si rifanno solo se i blocchi sono cambiati */
function updateEditorConflicts(tab, rel) {
  const ed = tab.editor;
  if (!ed || !ed.host) return;
  const text = ed.host.getText(rel);
  const blocks = typeof text === 'string' && text.includes('<<<<<<<') ? ConflictMarkers.parseBlocks(text) : [];
  const seen = ed.conflicts || {};
  const key = JSON.stringify(blocks);
  const prev = Object.prototype.hasOwnProperty.call(seen, rel) ? seen[rel] : null;
  if (prev && prev.key === key) return;
  if (!prev && !blocks.length) return;
  if (prev) prev.zones.forEach((id) => ed.host.removeZone(id));
  ed.host.setConflicts(rel, blocks);
  const zones = blocks.map((b, i) => ed.host.addZone(rel, b.start, conflictBar(tab, rel, i, b), CONFLICT_ZONE_PX)).filter(Boolean);
  const rest = Object.fromEntries(Object.entries(seen).filter(([r]) => r !== rel));
  ed.conflicts = blocks.length ? { ...rest, [rel]: { key, zones } } : rest;
}

function scheduleEditorConflicts(tab, rel) {
  const ed = tab.editor;
  if (!ed) return;
  const timers = ed.conflictTimers || {};
  clearTimeout(timers[rel]);
  ed.conflictTimers = { ...timers, [rel]: setTimeout(() => { if (tabs.has(tab.id)) updateEditorConflicts(tab, rel); }, EDITOR_CONFLICTS_DELAY) };
}

/* Il blocco si rilegge adesso dal testo, per posizione: quello della zona
   può essere di prima dell'ultima battuta */
function chooseEditorConflict(tab, rel, index, choice) {
  const host = tab.editor && tab.editor.host;
  const text = host ? host.getText(rel) : null;
  if (typeof text !== 'string') return;
  const block = ConflictMarkers.parseBlocks(text)[index];
  const next = block ? ConflictMarkers.applyChoice(text, block, choice) : null;
  if (next === null) { updateEditorConflicts(tab, rel); return; }
  host.editText(rel, next);
}

/** Apre il file e porta il cursore al primo blocco (dal pannello dei conflitti) */
async function openEditorConflict(tab, rel) {
  if (!(await openEditorFile(tab, rel))) return false;
  const host = tab.editor && tab.editor.host;
  if (!tabs.has(tab.id) || !host) return true;
  updateEditorConflicts(tab, rel);
  const [first] = ConflictMarkers.parseBlocks(host.getText(rel) || '');
  if (first) host.reveal(rel, first.start);
  return true;
}
```

`renderer/editor-tab.js`:
- `onEditorTextChange`: dopo `if (edited) scheduleEditorGutter(tab, rel);`
  aggiungere `if (edited) scheduleEditorConflicts(tab, rel);` (stessa riga
  con `{ … }` se si preferisce un solo `if`).
- `openEditorFile`, subito dopo `host.open(rel, r.text);`:
  `updateEditorConflicts(tab, rel);`.
- dove la scheda chiude un file (la funzione che chiama `host.close(rel)`):
  togliere la voce, `if (tab.editor.conflicts) tab.editor.conflicts = Object.fromEntries(Object.entries(tab.editor.conflicts).filter(([r]) => r !== rel));`
  (le zone le toglie già `host.close`).

`renderer/index.html`: `<script src="editor-conflicts.js"></script>` prima
di `editor-tab.js`. `tests/renderer-source.js`: `'editor-conflicts.js'`
prima di `'editor-tab.js'`.

`renderer/styles.css`, accanto a `.editor-gutter-*`:

```css
/* Conflitti nell'editor (docs/plans/69) */
.editor-conflict-marker { background: rgba(128, 128, 128, 0.18); }
.editor-conflict-ours { background: rgba(64, 160, 255, 0.14); }
.editor-conflict-base { background: rgba(128, 128, 128, 0.08); }
.editor-conflict-theirs { background: rgba(80, 200, 120, 0.14); }
.editor-conflict-bar { display: flex; gap: 6px; padding: 2px 8px; font-size: 12px; }
.editor-conflict-choice { padding: 1px 8px; }
```

Per i colori dentro Electron vale la memoria del progetto: misurarli
nell'app, non nel Chrome di sistema.

- [ ] **Step 6: test verdi**

Run: `node --test tests/editor-conflicts.test.js && npm run test:unit`
Expected: PASS. Se `fakeHost` non registra la zona perché `document` della
pagina è uno stub, `addZone` riceve comunque un nodo (lo stub): va bene,
il test guarda solo `afterLine`.

- [ ] **Step 7: commit**

```
feat: blocchi di conflitto nell'editor

Le righe di nostro e di loro colorate e, sotto ogni <<<<<<<, una zona
con Tieni nostro / loro / entrambi. La scelta è una modifica del testo:
Ctrl+Z la annulla, e chi sistema un blocco a mano vede sparire i suoi
pulsanti. Dal pannello dei conflitti il file si apre al primo blocco
(piano 69).
```

---

### Task 7: verifica finale e piano

- [ ] **Step 1:** `npm run test:unit` verde, `node --test tests/integration.test.js` verde.
- [ ] **Step 2: smoke nell'app** (`npm start`), su un repo di prova:

```bash
cd /tmp && rm -rf prova-conflitti && mkdir prova-conflitti && cd prova-conflitti
git init -q -b main && git config user.name P && git config user.email p@x
printf 'uno\ndue\ntre\n' > a.txt && printf '\x89PNG\0a' > logo.png && git add . && git commit -qm init
git switch -qc feat/x && printf 'uno\nDUE x\ntre\nquattro x\n' > a.txt && printf '\x89PNG\0b' > logo.png && git commit -qam x
git switch -q main && printf 'uno\nDUE main\ntre\nquattro main\n' > a.txt && printf '\x89PNG\0c' > logo.png && git commit -qam m
```

  Poi nell'app: scheda git sul repo → «Unisci» `feat/x` → il pannello si
  apre in Conflitti; `logo.png` «Tieni feat/x»; `a.txt` ✎ → nell'editor
  «Tieni entrambi» sul primo blocco, a mano il secondo, Ctrl+Z e di nuovo;
  salva; «Segna risolto»; «Concludi merge»; `git log --oneline -3`.
  Poi da terminale `git reset --hard HEAD~1 && git switch feat/x && git rebase main`:
  il pannello di una sessione sul repo mostra il rebase; risolvere e
  «Continua rebase» fino in fondo. Infine un worktree con conflitto:
  «Unisci» → bolla → «Annulla merge» → cartella pulita.
- [ ] **Step 3:** `docs/plans/README.md`, riga 69: stato «fatto, da provare»
  (o «fatto» dopo lo smoke); in `69-conflitti.md` una sezione «Punti
  aperti» se la review finale ne lascia.
- [ ] **Step 4: commit**

```
docs: piano 69, fatto
```

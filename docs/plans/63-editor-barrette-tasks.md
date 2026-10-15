# Barrette delle righe cambiate nell'editor — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nella scheda editor, accanto ai numeri di riga, una barretta verde per le righe aggiunte, una blu per le modificate e un triangolino rosso dove mancano righe. Il confronto è fra il testo nell'editor (anche non salvato) e quello dell'ultimo commit. Le barrette seguono mentre si scrive.

**Architecture:** il main legge il testo di HEAD con `git cat-file blob HEAD:./<rel>` (`lib/editor-git.js`, canale `editor-head-text`). Il renderer lo confronta riga per riga con un diff di Myers puro (`renderer/editor-gutter.js`, UMD). L'host Monaco disegna le righe come decorazioni del margine (`setGutter`). `renderer/editor-tab.js` tiene la base per ogni file (`gutterBase` in editor-files) e decide quando ricalcolare: 300 ms dopo l'ultima modifica, subito quando cambia la base o il file si ricarica dal disco. HEAD si rilegge all'apertura, al salvataggio, tornando in primo piano e dopo una rinomina.

**Tech Stack:** Electron 33, Monaco 0.57 (`model.deltaDecorations`, `linesDecorationsClassName`), git via `lib/git-run.js` (execFile, niente shell), test con `node --test`, git vero nei test del main.

Spec: `docs/plans/63-editor-barrette.md`.

## Global Constraints

- **git senza shell:** sempre `runGit` (`lib/git-run.js`): execFile con argv, `LC_ALL=C`. Mai stringhe di comando.
- **Percorsi:** il `rel` passa da `safeRel` (`lib/editor-paths.js`) prima di arrivare a git. Se esce dalla radice si risponde `{ ok: false, reason: 'outside' }` e git non parte. La radice è `files(root).realRoot`, già verificata da `createEditorFs`.
- **Windows:** niente `split('/')`. `safeRel` divide su `[\\/]` e restituisce `/`, che è quello che git vuole dopo `HEAD:./`.
- **`lib/` non fa `require('electron')`.** `lib/editor-git.js` riceve la radice come parametro, e `run`/`maxRead` per i test.
- **Moduli del renderer UMD** (`renderer/editor-gutter.js` come `editor-files.js`): globale `window.AisessEditorGutter` e `module.exports`. In `index.html` va fra i moduli, prima di `editor-tab.js` (l'ordine conta, `tests/renderer-load.test.js`).
- **UI:** nessun testo nuovo nella pagina. Le barrette sono classi CSS e nomi di file non entrano nel DOM. Se servisse, `textContent`, mai `innerHTML` interpolato.
- **Tetti:** `MAX_READ` (5 MB) come per l'apertura, `MAX_GUTTER_LINES = 20000`, `MAX_DIFF_STEPS = 1000000`. Oltre uno di questi, niente barrette (`null`), mai un errore in faccia all'utente.
- **Risposta di `headText`:** `{ ok: true, text }` oppure `{ ok: true, text: null }` (il file non c'è in HEAD, o il repository non ha commit) oppure `{ ok: false, reason }`. I `reason` sono `not-repo`, `no-git`, `outside`, `binary`, `not-utf8`, `too-large`, e `error` con `error: <prima riga dello stderr>`.
- **Test:** prima `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (il node di sistema è v12). I test con git vero si saltano con `t.skip` se git manca. La suite intera è `npm run test:unit` e deve restare verde (prima del piano: 1574 test, 1573 pass, 1 skip).
- **Commit:** messaggio in `/tmp/msg.txt`, poi `git commit --file=/tmp/msg.txt`. Formato `<tipo>: <cosa>` in italiano, il perché nel corpo, ultima riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scelte rispetto alla spec

- **`git cat-file blob` invece di `git show`.** Dà i byte del blob senza textconv. Su una cartella fallisce invece di elencarla. Su un percorso mancante o un repository senza commit dice `Not a valid object name`. I messaggi di `show` sono riconosciuti lo stesso.
- **Host:** niente metodo `onChange(fn)` nuovo. L'opzione `onChange` di `createEditorHost` scatta già a ogni cambio del testo, e `editor-tab.js` la riusa (`onEditorTextChange`).
- **Le righe tolte in cima** (`after: 0`) hanno una classe in più, `editor-gutter-del-top`: il triangolino va sopra la riga 1 invece che sotto.
- **Blu:** non c'era una variabile di stato blu. Se ne aggiunge una, `--state-changed: #5AA2FF` in `tokens.css`: lo stesso valore di `--type-codex`, ma con un nome che dice a cosa serve.
- **Accessore per il piano 64:** `editorFileChanges(tab, rel)`, che restituisce le righe cambiate del file o `null`.

---

### Task 1: testo di HEAD dal main (`lib/editor-git.js`, IPC, preload)

**Files:**
- Create: `lib/editor-git.js`
- Create: `tests/editor-git.test.js`
- Modify: `lib/editor-fs.js` (esportare `decode`)
- Modify: `app/editor.js` (handler `editor-head-text`)
- Modify: `preload.js` (`editorHeadText`)
- Modify: `tests/editor-ipc.test.js` (canale nella lista dei payload sbagliati + un test)

**Interfaces:**
- Consumes: `runGit(args, { cwd, buffer, timeout })` (`lib/git-run.js`), `safeRel(rel)` (`lib/editor-paths.js`), `MAX_READ` e `decode(buf) → {ok:true,text,bom}|{ok:false,reason}` (`lib/editor-fs.js`).
- Produces:
  - `createEditorGit({ root, run?, maxRead? }) → { headText(rel) }`, dove `headText(rel)` dà `Promise<{ok:true,text:string|null}|{ok:false,reason,error?}>`
  - canale IPC `editor-head-text` con payload `{ root, rel }`
  - preload `window.aisess.editorHeadText(root, rel)`

- [ ] **Step 1: scrivere il test che fallisce**

Creare `tests/editor-git.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorGit } = require('../lib/editor-git');
const { runGit } = require('../lib/git-run');
const { resolveBinary } = require('../lib/binaries');

/* Il testo di HEAD per le barrette dell'editor (docs/plans/63): repository
   di prova in una tmpdir, git vero. Saltati se git manca. In fondo le
   scelte senza git, con un `run` finto. */
const GIT = resolveBinary('git').path;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Prova', GIT_AUTHOR_EMAIL: 'p@x', GIT_COMMITTER_NAME: 'Prova', GIT_COMMITTER_EMAIL: 'p@x' };

function tmp(t) {
  // .native come git: su macOS /var -> /private/var, su Windows i nomi corti 8.3
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edgit-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
/** Un repository di prova; `git(...)` lancia git lì dentro. */
function repo(t) {
  const dir = tmp(t);
  const git = (...args) => execFileSync(GIT, args, { cwd: dir, env: ENV });
  git('init', '-q', '-b', 'main');
  return { dir, git };
}
const commit = (git) => { git('add', '-A'); git('commit', '-q', '-m', 'prova'); };

ok('headText: il file com è in HEAD, anche se sul disco è cambiato', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'a.txt', 'uno\ndue\n');
  commit(git);
  put(dir, 'a.txt', 'uno\ncambiato\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('a.txt'), { ok: true, text: 'uno\ndue\n' });
});

ok('headText: non tracciato o solo nell indice → text null', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'a.txt', 'a\n');
  commit(git);
  put(dir, 'nuovo.txt', 'n\n');
  put(dir, 'in-stage.txt', 's\n');
  git('add', 'in-stage.txt');
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.headText('nuovo.txt'), { ok: true, text: null });
  assert.deepStrictEqual(await g.headText('in-stage.txt'), { ok: true, text: null });
});

ok('headText: la cartella della scheda è una sottocartella del repository', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'sub/b.txt', 'b\n');
  commit(git);
  assert.deepStrictEqual(await createEditorGit({ root: path.join(dir, 'sub') }).headText('b.txt'), { ok: true, text: 'b\n' });
  // Separatori di Windows: arrivano a git come /
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('sub\\b.txt'), { ok: true, text: 'b\n' });
});

ok('headText: repository senza commit → text null', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir } = repo(t);
  put(dir, 'a.txt', 'a\n');
  assert.deepStrictEqual(await createEditorGit({ root: dir }).headText('a.txt'), { ok: true, text: null });
});

ok('headText: fuori da un repository → not-repo', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const root = tmp(t);
  put(root, 'a.txt', 'a\n');
  // git non risale sopra la tmpdir: se stesse dentro un repository, «fuori» non si proverebbe
  const run = (args, o) => runGit(args, { ...o, env: { GIT_CEILING_DIRECTORIES: path.dirname(root) } });
  assert.deepStrictEqual(await createEditorGit({ root, run }).headText('a.txt'), { ok: false, reason: 'not-repo' });
});

ok('headText: binario e troppo grande non si confrontano; il BOM non arriva', async (t) => {
  if (!GIT) return t.skip('git non installato su questa macchina');
  const { dir, git } = repo(t);
  put(dir, 'logo.bin', Buffer.from([1, 0, 2]));
  put(dir, 'grande.txt', 'x'.repeat(100));
  put(dir, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao\n')]));
  commit(git);
  const g = createEditorGit({ root: dir });
  assert.deepStrictEqual(await g.headText('logo.bin'), { ok: false, reason: 'binary' });
  assert.deepStrictEqual(await g.headText('bom.txt'), { ok: true, text: 'ciao\n' });
  assert.deepStrictEqual(await createEditorGit({ root: dir, maxRead: 10 }).headText('grande.txt'), { ok: false, reason: 'too-large' });
});

ok('headText: percorsi che escono dalla radice si rifiutano senza lanciare git', async () => {
  const calls = [];
  const g = createEditorGit({ root: '/w', run: async (...a) => { calls.push(a); return Buffer.from(''); } });
  for (const rel of ['../x', 'a/../../b', '/etc/passwd', 'C:\\x', '', null]) {
    assert.deepStrictEqual(await g.headText(rel), { ok: false, reason: 'outside' }, String(rel));
  }
  assert.deepStrictEqual(calls, []);
});

ok('headText: argomenti di git e risposte riconosciute dallo stderr', async () => {
  const args = [];
  const fine = createEditorGit({ root: '/w', run: async (a, o) => { args.push([a, o.cwd, o.buffer]); return Buffer.from('ciao'); } });
  assert.deepStrictEqual(await fine.headText('sub\\a.txt'), { ok: true, text: 'ciao' });
  assert.deepStrictEqual(args, [[['cat-file', 'blob', 'HEAD:./sub/a.txt'], '/w', true]]);

  const failing = (e) => createEditorGit({ root: '/w', run: async () => { throw e; } }).headText('a.txt');
  const git = (stderr) => Object.assign(new Error('Command failed'), { stderr });
  assert.deepStrictEqual(await failing(git('fatal: not a git repository (or any of the parent directories): .git\n')), { ok: false, reason: 'not-repo' });
  for (const stderr of ['fatal: Not a valid object name HEAD:./a.txt\n', "fatal: invalid object name 'HEAD'.\n",
    "fatal: path 'a.txt' does not exist in 'HEAD'\n", "fatal: path 'a.txt' exists on disk, but not in 'HEAD'\n"]) {
    assert.deepStrictEqual(await failing(git(stderr)), { ok: true, text: null }, stderr);
  }
  assert.deepStrictEqual(await failing(git('fatal: qualcosa di strano\naltro\n')), { ok: false, reason: 'error', error: 'fatal: qualcosa di strano' });
  assert.deepStrictEqual(await failing(Object.assign(new Error('git non trovato nel PATH'), { missing: true })), { ok: false, reason: 'no-git' });
  assert.deepStrictEqual(await failing(Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })), { ok: false, reason: 'too-large' });
});
```

In `tests/editor-ipc.test.js` aggiungere `'editor-head-text'` in fondo alla lista dei canali del test «payload mancanti o radici inesistenti» (riga 40):

```js
  for (const channel of ['editor-list', 'editor-read', 'editor-write', 'editor-stat', 'editor-create', 'editor-mkdir', 'editor-rename', 'editor-trash', 'editor-watch', 'editor-copy-plan', 'editor-copy-run', 'editor-head-text']) {
```

e in fondo al file:

```js
ok('ipc editor: il testo di HEAD rifiuta percorsi fuori dalla cartella', async (t) => {
  const { call, root } = setup(t);
  assert.deepStrictEqual(await call('editor-head-text', { root, rel: '../fuori.txt' }), { ok: false, reason: 'outside' });
});
```

- [ ] **Step 2: verificare che fallisce**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-git.test.js tests/editor-ipc.test.js`
Expected: FAIL. `Cannot find module '../lib/editor-git'`, e in editor-ipc manca l'handler `editor-head-text`.

- [ ] **Step 3: esportare `decode` da `lib/editor-fs.js`**

L'ultima riga di `lib/editor-fs.js` diventa:

```js
module.exports = { createEditorFs, MAX_READ, decode };
```

Così il testo di HEAD si decodifica come quello del disco: stesso BOM tolto, stessi `binary`/`not-utf8`.

- [ ] **Step 4: scrivere `lib/editor-git.js`**

```js
'use strict';
/* Il testo di un file com'è nell'ultimo commit, per le barrette delle righe
 * cambiate nella scheda editor (docs/plans/63). `git cat-file blob`: i byte
 * del blob così come sono (niente textconv, niente filtri) e un errore se il
 * percorso è una cartella. `HEAD:./<rel>` è relativo alla cartella della
 * scheda anche quando il repository parte più in alto. Sempre runGit:
 * execFile con argv, mai la shell; LC_ALL=C rende i messaggi riconoscibili. */
const { runGit } = require('./git-run');
const { safeRel } = require('./editor-paths');
const { MAX_READ, decode } = require('./editor-fs');

const TIMEOUT = 10000;
const NOT_REPO = /not a git repository/i;
// Il percorso non c'è in HEAD, o HEAD non c'è ancora (repository senza
// commit). cat-file dice «Not a valid object name»; gli altri sono di git show
// e di versioni vicine, riconosciuti per non dipendere dalla formulazione.
const NOT_IN_HEAD = /not a valid object name|invalid object name|does not exist in|exists on disk, but not in/i;

function failureOf(e) {
  if (e && e.missing) return { ok: false, reason: 'no-git' };
  if (e && e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, reason: 'too-large' };
  const stderr = String((e && e.stderr) || '');
  if (NOT_REPO.test(stderr)) return { ok: false, reason: 'not-repo' };
  if (NOT_IN_HEAD.test(stderr)) return { ok: true, text: null };
  const first = stderr.split('\n').find((l) => l.trim()) || String((e && e.message) || e);
  return { ok: false, reason: 'error', error: first.trim() };
}

/**
 * @param {{root: string, run?: Function, maxRead?: number}} o `root` la
 *   cartella della scheda (già verificata da lib/editor-fs.js); `run` e
 *   `maxRead` si sostituiscono nei test
 */
function createEditorGit({ root, run = runGit, maxRead = MAX_READ } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');

  /**
   * @param {string} rel percorso relativo alla cartella della scheda
   * @returns {Promise<{ok: true, text: string|null}|{ok: false, reason: string, error?: string}>}
   *   `text: null` = il file non c'è in HEAD (nuovo, non tracciato, repository senza commit)
   */
  async function headText(rel) {
    const clean = safeRel(rel);
    if (!clean) return { ok: false, reason: 'outside' };
    let buf;
    try {
      buf = await run(['cat-file', 'blob', `HEAD:./${clean}`], { cwd: root, buffer: true, timeout: TIMEOUT });
    } catch (e) {
      return failureOf(e);
    }
    if (buf.length > maxRead) return { ok: false, reason: 'too-large' };
    const decoded = decode(buf);
    return decoded.ok ? { ok: true, text: decoded.text } : { ok: false, reason: decoded.reason };
  }

  return { headText };
}

module.exports = { createEditorGit };
```

- [ ] **Step 5: handler e preload**

In `app/editor.js`, sotto `const { createEditorWatch } = require('../lib/editor-watch');`:

```js
const { createEditorGit } = require('../lib/editor-git');
```

e subito dopo la riga dell'handler `editor-stat`:

```js
  // Testo dell'ultimo commit, per le barrette delle righe cambiate (docs/plans/63)
  ipcMain.handle('editor-head-text', guard(({ root, rel }) => createEditorGit({ root: files(root).realRoot }).headText(rel)));
```

`files(root)` lancia se la radice manca o non esiste, e `guard` lo trasforma in `{ ok: false, error }`, come per gli altri canali.

In `preload.js`, subito dopo `editorUnwatch`:

```js
  editorHeadText: (root, rel) => ipcRenderer.invoke('editor-head-text', { root, rel }),
```

- [ ] **Step 6: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-git.test.js tests/editor-ipc.test.js tests/editor-fs.test.js`
Expected: PASS. In editor-git ci sono 8 test, che senza git diventano 6 skip e 2 pass.

- [ ] **Step 7: suite intera**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1583 test (1582 pass, 1 skip).

- [ ] **Step 8: commit**

```bash
git add lib/editor-git.js lib/editor-fs.js app/editor.js preload.js tests/editor-git.test.js tests/editor-ipc.test.js
cat > /tmp/msg.txt <<'EOF'
feat: testo di HEAD per l'editor (editor-head-text)

Le barrette delle righe cambiate confrontano il testo nell'editor con
quello dell'ultimo commit: il main lo legge con git cat-file blob, che
dà i byte del blob senza textconv e fallisce su una cartella. Il percorso
passa da safeRel e il testo da decode, come per l'apertura: stessi tetti,
stesso BOM. Un file che non c'è in HEAD (nuovo, repository senza commit)
risponde text: null, che per l'editor vuol dire «tutto aggiunto».

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 2: confronto riga per riga (`renderer/editor-gutter.js`)

**Files:**
- Create: `renderer/editor-gutter.js`
- Create: `tests/editor-gutter.test.js`
- Modify: `renderer/index.html` (script subito dopo `editor-monaco.js`, riga 495)
- Modify: `tests/renderer-load.test.js` (un test in fondo)

**Interfaces:**
- Produces: globale `window.AisessEditorGutter` e `module.exports` con:
  - `MAX_GUTTER_LINES = 20000`, `MAX_DIFF_STEPS = 1000000`
  - `diffLines(oldLines: string[], newLines: string[], { maxSteps? }) → Array<'='|'-'|'+'>|null`
  - `changeRanges(oldText: string|null, newText: string, { maxLines?, maxSteps? }) → Array<{kind:'add'|'mod',from,to}|{kind:'del',after}>|null`
    - le righe partono da 1 e gli estremi sono compresi
    - `after` è la riga dopo cui mancano righe (0 vuol dire in cima)
    - `oldText === null` vuol dire tutto aggiunto
    - `\r\n` vale come `\n`
    - `null` vuol dire niente barrette

- [ ] **Step 1: scrivere il test che fallisce**

Creare `tests/editor-gutter.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { MAX_GUTTER_LINES, diffLines, changeRanges } = require('../renderer/editor-gutter');

/* Le righe cambiate rispetto a HEAD (docs/plans/63): testo di HEAD contro
   testo nell'editor, righe da 1, `after` = riga dopo cui mancano righe. */

ok('gutter: testi uguali → nessuna barretta', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc\n', 'a\nb\nc\n'), []);
  assert.deepStrictEqual(changeRanges('', ''), []);
});

ok('gutter: righe aggiunte in cima, in mezzo, in fondo', () => {
  assert.deepStrictEqual(changeRanges('a\nb', 'x\na\nb'), [{ kind: 'add', from: 1, to: 1 }]);
  assert.deepStrictEqual(changeRanges('a\nb', 'a\nx\ny\nb'), [{ kind: 'add', from: 2, to: 3 }]);
  assert.deepStrictEqual(changeRanges('a\nb', 'a\nb\nx'), [{ kind: 'add', from: 3, to: 3 }]);
});

ok('gutter: righe tolte in cima, in mezzo, in fondo', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'b\nc'), [{ kind: 'del', after: 0 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nc'), [{ kind: 'del', after: 1 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nb'), [{ kind: 'del', after: 2 }]);
});

ok('gutter: righe cambiate, e cambiate più aggiunte o tolte', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nB\nc'), [{ kind: 'mod', from: 2, to: 2 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc', 'a\nB\nX\nc'),
    [{ kind: 'mod', from: 2, to: 2 }, { kind: 'add', from: 3, to: 3 }]);
  assert.deepStrictEqual(changeRanges('a\nb\nc\nd', 'a\nB\nd'),
    [{ kind: 'mod', from: 2, to: 2 }, { kind: 'del', after: 2 }]);
});

ok('gutter: due blocchi separati', () => {
  assert.deepStrictEqual(changeRanges('a\nb\nc\nd\ne', 'A\nb\nc\ne'),
    [{ kind: 'mod', from: 1, to: 1 }, { kind: 'del', after: 3 }]);
});

ok('gutter: file non in HEAD → tutto aggiunto', () => {
  assert.deepStrictEqual(changeRanges(null, 'a\nb'), [{ kind: 'add', from: 1, to: 2 }]);
});

ok('gutter: \\r\\n vale come \\n', () => {
  assert.deepStrictEqual(changeRanges('a\r\nb\r\n', 'a\nb\n'), []);
});

ok('gutter: testo mancante o troppe righe → null', () => {
  assert.strictEqual(changeRanges('a', undefined), null);
  assert.strictEqual(changeRanges(42, 'a'), null);
  const big = 'x\n'.repeat(MAX_GUTTER_LINES);
  assert.strictEqual(changeRanges('a', big), null);
  assert.strictEqual(changeRanges(big, 'a'), null);
  assert.strictEqual(changeRanges('a\nb', 'a\nb\nc', { maxLines: 2 }), null);
});

ok('gutter: oltre il tetto di passi → null, sotto il risultato', () => {
  const before = 'a\nb\nc\nd';
  const after = 'w\nx\ny\nz';
  assert.strictEqual(changeRanges(before, after, { maxSteps: 3 }), null);
  assert.deepStrictEqual(changeRanges(before, after), [{ kind: 'mod', from: 1, to: 4 }]);
});

ok('gutter: diffLines dà le operazioni riga per riga', () => {
  assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'c', 'd']), ['=', '-', '=', '+']);
  assert.deepStrictEqual(diffLines([], ['a']), ['+']);
  assert.deepStrictEqual(diffLines(['a'], []), ['-']);
});

ok('gutter: su testi a caso il diff è minimo e ricostruisce il testo nuovo', () => {
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const lines = () => Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const lcs = (a, b) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
      }
    }
    return t[a.length][b.length];
  };
  for (let round = 0; round < 300; round++) {
    const a = lines();
    const b = lines();
    const ops = diffLines(a, b);
    const rebuilt = [];
    let i = 0;
    for (const op of ops) {
      if (op === '=') { assert.strictEqual(a[i], b[rebuilt.length]); rebuilt.push(a[i++]); }
      else if (op === '-') i++;
      else rebuilt.push(b[rebuilt.length]);
    }
    assert.deepStrictEqual(rebuilt, b, `round ${round}`);
    assert.strictEqual(i, a.length, `round ${round}`);
    assert.strictEqual(ops.filter((o) => o === '=').length, lcs(a, b), `round ${round}`);
  }
});

ok('gutter: un file grande con poche righe cambiate si confronta in fretta', () => {
  const a = Array.from({ length: 19000 }, (_, i) => `riga ${i}`);
  const b = [...a.slice(0, 9000), 'nuova', ...a.slice(9000, 15000), ...a.slice(15001)];
  b[100] = 'cambiata';
  const started = Date.now();
  assert.deepStrictEqual(changeRanges(a.join('\n'), b.join('\n')), [
    { kind: 'mod', from: 101, to: 101 }, { kind: 'add', from: 9001, to: 9001 }, { kind: 'del', after: 15001 },
  ]);
  assert.ok(Date.now() - started < 1000, 'diff troppo lento');
});
```

In fondo a `tests/renderer-load.test.js`:

```js
ok('renderer: editor-gutter.js è nella pagina prima di editor-tab.js', () => {
  const at = (f) => pageScripts.indexOf(f);
  assert.ok(at('editor-gutter.js') >= 0, 'index.html non carica editor-gutter.js');
  assert.ok(at('editor-gutter.js') < at('editor-tab.js'), 'editor-gutter.js va caricato prima di editor-tab.js');
  const { ctx } = loadPage();
  assert.strictEqual(typeof ctx.AisessEditorGutter.changeRanges, 'function');
});
```

- [ ] **Step 2: verificare che fallisce**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-gutter.test.js tests/renderer-load.test.js`
Expected: FAIL. `Cannot find module '../renderer/editor-gutter'`, e renderer-load dice «index.html non carica editor-gutter.js».

- [ ] **Step 3: scrivere `renderer/editor-gutter.js`**

```js
/* Barrette delle righe cambiate nella scheda editor (docs/plans/63): il
 * confronto riga per riga fra il testo di HEAD e quello nell'editor.
 * Funzioni pure: git lo legge il main (lib/editor-git.js), Monaco lo tocca
 * editor-monaco.js, il cablaggio sta in editor-tab.js.
 * Due tetti tengono la pagina reattiva: oltre MAX_GUTTER_LINES righe o
 * MAX_DIFF_STEPS passi del diff la risposta è null, cioè niente barrette.
 *
 * Wrapper UMD come editor-files.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorGutter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const MAX_GUTTER_LINES = 20000;
  const MAX_DIFF_STEPS = 1000000;

  // Come Monaco: \r\n, \r e \n sono tutti un a capo, e uguali fra loro
  const splitLines = (text) => text.split(/\r\n|\r|\n/);
  const repeat = (op, count) => new Array(count).fill(op);

  /* Dalla V salvata a ogni d si risale al percorso, dalla fine all'inizio. */
  function backtrack(trace, n, m) {
    const ops = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const snap = trace[d]; // snap[k + d + 1] = V[k], k da -d-1 a d+1
      const k = x - y;
      const down = k === -d || (k !== d && snap[k + d] < snap[k + d + 2]);
      const prevK = down ? k + 1 : k - 1;
      const prevX = snap[prevK + d + 1];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push('='); x--; y--; }
      if (d > 0) ops.push(down ? '+' : '-');
      x = prevX;
      y = prevY;
    }
    return ops.reverse();
  }

  /* Myers O(ND). A ogni d si tiene solo la fetta di V che serve a risalire
     (k da -d-1 a d+1): la memoria cresce coi passi, non con N·D. */
  function myers(a, b, maxSteps) {
    const n = a.length;
    const m = b.length;
    if (!n || !m) return [...repeat('-', n), ...repeat('+', m)];
    const off = n + m + 1;
    const v = new Int32Array(2 * off + 1);
    const trace = [];
    let steps = 0;
    for (let d = 0; d <= n + m; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2));
      for (let k = -d; k <= d; k += 2) {
        const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
        let x = down ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; steps++; }
        v[off + k] = x;
        if (++steps > maxSteps) return null;
        if (x >= n && y >= m) return backtrack(trace, n, m);
      }
    }
    return null; // non si arriva qui: a d = n + m il percorso è finito
  }

  /**
   * Le operazioni per passare da `oldLines` a `newLines`: '=' riga uguale,
   * '-' tolta, '+' aggiunta. null oltre `maxSteps` passi.
   * @param {string[]} oldLines
   * @param {string[]} newLines
   * @param {{maxSteps?: number}} [o]
   * @returns {string[]|null}
   */
  function diffLines(oldLines, newLines, { maxSteps = MAX_DIFF_STEPS } = {}) {
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let endOld = oldLines.length;
    let endNew = newLines.length;
    while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }
    const middle = myers(oldLines.slice(start, endOld), newLines.slice(start, endNew), maxSteps);
    if (!middle) return null;
    return [...repeat('=', start), ...middle, ...repeat('=', oldLines.length - endOld)];
  }

  /* Un blocco di righe tolte e aggiunte fra due righe uguali: le righe in
     comune sono «modificate», il resto aggiunte o tolte. */
  function rangesFromOps(ops) {
    const out = [];
    let line = 0; // righe del testo nuovo già passate
    let removed = 0;
    let added = 0;
    const flush = () => {
      const before = line - added;
      const mod = Math.min(removed, added);
      if (mod) out.push({ kind: 'mod', from: before + 1, to: before + mod });
      if (added > mod) out.push({ kind: 'add', from: before + mod + 1, to: before + added });
      if (removed > mod) out.push({ kind: 'del', after: before + mod });
      removed = 0;
      added = 0;
    };
    for (const op of ops) {
      if (op === '-') { removed++; continue; }
      if (op === '=') flush();
      else added++;
      line++;
    }
    flush();
    return out;
  }

  /**
   * Le righe dell'editor cambiate rispetto a HEAD.
   * @param {string|null} oldText testo di HEAD; null = il file non c'è in HEAD
   * @param {string} newText testo nell'editor
   * @param {{maxLines?: number, maxSteps?: number}} [o]
   * @returns {Array<{kind: 'add'|'mod', from: number, to: number}|{kind: 'del', after: number}>|null}
   *   righe da 1, estremi compresi; `after` = riga dopo cui mancano righe (0 = in cima).
   *   null: niente barrette (troppe righe, diff troppo lungo, testo mancante)
   */
  function changeRanges(oldText, newText, { maxLines = MAX_GUTTER_LINES, maxSteps = MAX_DIFF_STEPS } = {}) {
    if (typeof newText !== 'string' || (oldText !== null && typeof oldText !== 'string')) return null;
    const newLines = splitLines(newText);
    if (newLines.length > maxLines) return null;
    if (oldText === null) return [{ kind: 'add', from: 1, to: newLines.length }];
    const oldLines = splitLines(oldText);
    if (oldLines.length > maxLines) return null;
    const ops = diffLines(oldLines, newLines, { maxSteps });
    return ops && rangesFromOps(ops);
  }

  return { MAX_GUTTER_LINES, MAX_DIFF_STEPS, diffLines, changeRanges };
});
```

- [ ] **Step 4: caricarlo nella pagina**

In `renderer/index.html`, subito dopo `<script src="editor-monaco.js"></script>`:

```html
<script src="editor-gutter.js"></script>
```

È un modulo UMD: va fra i moduli, prima di `app-state.js`. `tests/renderer-source.js` non cambia.

- [ ] **Step 5: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-gutter.test.js tests/renderer-load.test.js`
Expected: PASS, 12 + 3 test. Il file grande (19000 righe) si confronta in circa 15 ms.

- [ ] **Step 6: suite intera**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1596 test (1595 pass, 1 skip).

- [ ] **Step 7: commit**

```bash
git add renderer/editor-gutter.js renderer/index.html tests/editor-gutter.test.js tests/renderer-load.test.js
cat > /tmp/msg.txt <<'EOF'
feat: confronto riga per riga per le barrette dell'editor

Myers sulle righe, dopo aver tolto inizio e fine uguali: un file grande
con poche modifiche costa quanto le modifiche. Due tetti (20000 righe,
un milione di passi) tengono la pagina reattiva; oltre, niente barrette.
In ogni blocco le righe in comune fra tolte e aggiunte sono «modificate»,
come le barrette di VS Code. Modulo puro, verificato contro un LCS su
testi a caso.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 3: barrette in Monaco e cablaggio nella scheda

**Files:**
- Modify: `renderer/editor-monaco.js` (`setGutter`, `reveal`, campo `gutter` nei doc)
- Modify: `renderer/editor-files.js` (`gutterBase`, `changes` in `BLANK`)
- Modify: `renderer/editor-tab.js` (base per file, ricalcolo, letture di HEAD)
- Modify: `renderer/tokens.css` (`--state-changed`)
- Modify: `renderer/styles.css` (classi `editor-gutter-*`)
- Modify: `tests/editor-monaco.test.js`
- Modify: `tests/editor-tab.test.js`

**Interfaces:**
- Consumes: `window.aisess.editorHeadText` (Task 1), `AisessEditorGutter.changeRanges` (Task 2).
- Produces:
  - host: `setGutter(rel, ranges|null)` e `reveal(rel, line)` (quest'ultimo per il piano 64)
  - editor-tab: `onEditorTextChange(tab, rel, dirty)`, `updateEditorGutter(tab, rel)`, `scheduleEditorGutter(tab, rel)`, `loadEditorGutterBase(tab, rel)`, `editorFileChanges(tab, rel) → ranges|null` (piano 64)
  - stato del file: `gutterBase: {text: string|null}|null` e `changes: ranges|null`
  - `tab.editor.gutterTimer: {rel, id}|null`

- [ ] **Step 1: test dell'host che falliscono**

In `tests/editor-monaco.test.js`, dentro `fakeMonaco()`:

- nell'oggetto `editor`, dopo `focus() {}, updateOptions() {},`:

```js
    position: null, revealed: [],
    setPosition(p) { editor.position = p; },
    revealLineInCenter(line) { editor.revealed.push(line); },
```

- nel model, la riga `uri, disposed: false, eol: null,` diventa:

```js
      uri, disposed: false, eol: null, decorations: [], removed: [],
```

- e dopo `pushEOL`:

```js
      deltaDecorations: (old, decorations) => {
        m.removed.push(old);
        m.decorations = decorations;
        return decorations.map((_, i) => `${uri.path}#${m.removed.length}.${i}`);
      },
```

In fondo al file:

```js
ok('setGutter: barrette come decorazioni del margine, sostituite a ogni chiamata', () => {
  const { h, fake } = host();
  h.open('a.js', '1\n2\n3');
  const m = fake.models[0];
  h.setGutter('a.js', [{ kind: 'add', from: 1, to: 2 }, { kind: 'mod', from: 3, to: 3 }, { kind: 'del', after: 0 }, { kind: 'del', after: 2 }]);
  assert.deepStrictEqual(m.decorations, [
    { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-add' } },
    { range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-mod' } },
    { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-del editor-gutter-del-top' } },
    { range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: 'editor-gutter-del' } },
  ]);
  h.setGutter('a.js', null);
  assert.deepStrictEqual(m.decorations, []);
  // la seconda chiamata toglie gli id dati dalla prima
  assert.deepStrictEqual(m.removed, [[], ['/a.js#1.0', '/a.js#1.1', '/a.js#1.2', '/a.js#1.3']]);
  h.setGutter('nessuno.js', [{ kind: 'add', from: 1, to: 1 }]); // file non aperto: niente
});

ok('reveal: attiva il file, cursore a inizio riga, riga al centro', () => {
  const { h, fake } = host();
  h.open('a.js', '1');
  h.open('b.js', '2');
  h.reveal('a.js', 7);
  assert.strictEqual(h.current(), 'a.js');
  assert.deepStrictEqual(fake.editor.position, { lineNumber: 7, column: 1 });
  assert.deepStrictEqual(fake.editor.revealed, [7]);
  h.reveal('nessuno.js', 3);
  assert.deepStrictEqual(fake.editor.revealed, [7]);
});
```

- [ ] **Step 2: test della scheda che falliscono**

In `tests/editor-tab.test.js`, `fakeHost` registra le barrette in un array a parte, così i test che controllano `host.calls` non cambiano. Anche `open` ricorda il testo. L'inizio di `fakeHost` diventa:

```js
function fakeHost(texts) {
  const calls = [];
  const gutters = []; // a parte: le barrette arrivano anche da sole, dopo ogni lettura di HEAD
  const dirty = new Set();
  return {
    calls,
    gutters,
    texts,
    dirty,
    setGutter: (rel, ranges) => gutters.push([rel, ranges]),
```

e la sua ultima riga:

```js
    open: (rel, text) => { texts[rel] = text; }, close: () => {}, rename: () => {}, dispose: () => {},
```

In fondo al file (dove `plain` e `settle` esistono già):

```js
/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */

/** setup() con timer finti: `timers` quelli armati, `flush()` fa partire quelli ancora validi. */
function gutterSetup(opts) {
  const s = setup(opts);
  const timers = [];
  s.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; };
  s.page.ctx.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; };
  const flush = () => timers.filter((t) => !t.cleared && !t.done).forEach((t) => { t.done = true; t.fn(); });
  return { ...s, timers, flush };
}

const read = (text) => async (root, rel) => ({ ok: true, text, mtime: 100, path: `${root}/${rel}`, bom: false });

ok('barrette: aprendo un file si chiede HEAD e si disegnano le righe cambiate', async () => {
  const s = gutterSetup({ main: { editorRead: read('uno\ndue\n'), editorHeadText: async () => ({ ok: true, text: 'uno\n' }) } });
  assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.deepStrictEqual(s.sent('editorHeadText').map((c) => c.slice(1)), [['/w', 'a.txt']]);
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'add', from: 2, to: 2 }]]]);
  assert.deepStrictEqual(plain(s.fn('editorFileChanges')(s.tab, 'a.txt')), [{ kind: 'add', from: 2, to: 2 }]);
  assert.strictEqual(s.fn('editorFileChanges')(s.tab, 'chiuso.txt'), null);
});

ok('barrette: un file che non c è in HEAD è tutto aggiunto', async () => {
  const s = gutterSetup({ main: { editorRead: read('a\nb'), editorHeadText: async () => ({ ok: true, text: null }) } });
  await s.fn('openEditorFile')(s.tab, 'nuovo.txt');
  await settle();
  assert.deepStrictEqual(plain(s.host.gutters), [['nuovo.txt', [{ kind: 'add', from: 1, to: 2 }]]]);
});

ok('barrette: fuori da git o con un errore niente barrette, e il file si apre lo stesso', async () => {
  for (const editorHeadText of [async () => ({ ok: false, reason: 'not-repo' }), async () => { throw new Error('ipc giù'); }]) {
    const s = gutterSetup({ main: { editorRead: read('x'), editorHeadText } });
    assert.strictEqual(await s.fn('openEditorFile')(s.tab, 'a.txt'), true);
    await settle();
    assert.strictEqual(s.file('a.txt').changes, null);
    assert.ok(s.host.gutters.every(([, ranges]) => ranges === null), JSON.stringify(s.host.gutters));
  }
});

ok('barrette: scrivendo si ricalcola 300 ms dopo l ultima modifica, una volta', async () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'uno', mtime: 100 } } });
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'uno' } });
  const change = s.fn('onEditorTextChange');
  s.host.texts['a.txt'] = 'UNO';
  change(s.tab, 'a.txt', true);
  s.host.texts['a.txt'] = 'UNO\ndue';
  change(s.tab, 'a.txt', true);
  assert.deepStrictEqual(s.timers.map((t) => [t.ms, t.cleared]), [[300, true], [300, false]]);
  assert.deepStrictEqual(s.host.gutters, [], 'niente prima del timer');
  s.flush();
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'mod', from: 1, to: 1 }, { kind: 'add', from: 2, to: 2 }]]]);
  assert.strictEqual(s.file('a.txt').dirty, true);
});

ok('barrette: un ricalcolo in attesa per un altro file si fa subito', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 }, 'b.txt': { text: 'b', mtime: 1 } } });
  const Files = s.page.ctx.AisessEditorFiles;
  s.tab.editor.files = Files.update(Files.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'a' } }), 'b.txt', { gutterBase: { text: 'b' } });
  s.host.texts['a.txt'] = 'A';
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('onEditorTextChange')(s.tab, 'b.txt', false);
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'mod', from: 1, to: 1 }]]]);
  s.flush();
  assert.deepStrictEqual(plain(s.host.gutters[1]), ['b.txt', []]);
});

ok('barrette: tornando in primo piano e dopo un salvataggio si rilegge HEAD', async () => {
  let head = 'uno\n';
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno\ndue\n', mtime: 1 } },
    main: {
      editorHeadText: async () => ({ ok: true, text: head }),
      editorStat: async () => ({ ok: true, exists: true, mtime: 1 }),
      editorList: async () => ({ ok: true, entries: [] }),
      editorWrite: async () => ({ ok: true, mtime: 2 }),
    },
  });
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['a.txt', [{ kind: 'add', from: 2, to: 2 }]]);
  head = 'uno\ndue\n'; // un commit da un terminale
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(plain(s.host.gutters.pop()), ['a.txt', []], 'dopo il commit le barrette spariscono');
  await s.fn('refreshEditorTab')(s.tab);
  assert.deepStrictEqual(s.host.gutters, [], 'HEAD uguale: niente da ridisegnare');
  const before = s.sent('editorHeadText').length;
  assert.strictEqual(await s.fn('saveEditorFile')(s.tab, 'a.txt'), true);
  await settle();
  assert.strictEqual(s.sent('editorHeadText').length, before + 1);
});

ok('barrette: un file ricaricato dal disco si ricalcola subito', async () => {
  const s = gutterSetup({
    files: { 'a.txt': { text: 'uno', mtime: 100 } },
    main: { editorRead: read('uno\ndue') },
  });
  s.tab.editor.files = s.page.ctx.AisessEditorFiles.update(s.tab.editor.files, 'a.txt', { gutterBase: { text: 'uno' } });
  s.fn('handleEditorFileChange')(s.tab, 'a.txt', { path: '/w/a.txt', exists: true, mtime: 200 });
  await settle();
  assert.deepStrictEqual(plain(s.host.gutters), [['a.txt', [{ kind: 'add', from: 2, to: 2 }]]]);
  assert.deepStrictEqual(s.timers, []);
});

ok('barrette: chiudendo la scheda il ricalcolo in attesa si toglie', () => {
  const s = gutterSetup({ files: { 'a.txt': { text: 'a', mtime: 1 } } });
  s.fn('onEditorTextChange')(s.tab, 'a.txt', true);
  s.fn('disposeEditorTab')(s.tab);
  assert.strictEqual(s.timers[0].cleared, true);
  assert.strictEqual(s.tab.editor.gutterTimer, null);
});
```

- [ ] **Step 3: verificare che falliscono**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-monaco.test.js tests/editor-tab.test.js`
Expected: FAIL. `h.setGutter is not a function`, `onEditorTextChange is not defined`, `editorFileChanges is not defined`, e nessuna chiamata a `editorHeadText`.

- [ ] **Step 4: `setGutter` e `reveal` nell'host**

In `renderer/editor-monaco.js`:

- il commento della mappa `docs` diventa `// rel → { rel, model, savedVersion, viewState, forcedDirty, sub, gutter }`;
- in `make`, l'oggetto passato a `track` prende `gutter: []` prima di `...extra`:

```js
      track({ rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, gutter: [], ...extra });
```

  Una rinomina fa un model nuovo con `gutter: []`: le decorazioni del vecchio se ne vanno col suo `dispose()`.
- subito prima di `function close(rel) {`:

```js
    /* Barrette delle righe cambiate (docs/plans/63): decorazioni del model
       nel margine delle righe; `d.gutter` tiene gli id per sostituirle. */
    function gutterDecoration(r) {
      if (r.kind === 'del') {
        const line = Math.max(r.after, 1);
        const cls = r.after === 0 ? 'editor-gutter-del editor-gutter-del-top' : 'editor-gutter-del';
        return {
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, linesDecorationsClassName: cls },
        };
      }
      return {
        range: { startLineNumber: r.from, startColumn: 1, endLineNumber: r.to, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: `editor-gutter-${r.kind}` },
      };
    }

    /** @param {Array|null} ranges da AisessEditorGutter.changeRanges; null o [] tolgono le barrette */
    function setGutter(rel, ranges) {
      const d = docs.get(rel);
      if (!d) return;
      d.gutter = d.model.deltaDecorations(d.gutter, (ranges || []).map(gutterDecoration));
    }

    /** Porta il cursore all'inizio della riga e la mette al centro (piano 64). */
    function reveal(rel, line) {
      if (!docs.has(rel)) return;
      if (current !== rel) activate(rel);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.revealLineInCenter(line);
      editor.focus();
    }
```

- nel `return`, la prima riga diventa:

```js
      open, activate, markSaved, replaceText, rename, close, dispose, setGutter, reveal,
```

- [ ] **Step 5: i campi nuovi in `renderer/editor-files.js`**

La riga di `BLANK` diventa:

```js
  // gutterBase: {text} di HEAD (text null = non in HEAD), null = non si sa;
  // changes: le righe cambiate (editor-gutter.js), null = niente barrette
  const BLANK = { path: null, mtime: null, bom: false, dirty: false, deleted: false, conflict: null, diskMtime: null, error: null,
    gutterBase: null, changes: null };
```

`update` e `renamePath` copiano già tutti i campi, quindi non cambiano.

- [ ] **Step 6: cablaggio in `renderer/editor-tab.js`**

1. In cima, dopo `const EditorPanel = window.AisessEditorPanel;`:

```js
const EditorGutter = window.AisessEditorGutter;
// Le barrette si ricalcolano quando si smette di scrivere (docs/plans/63)
const EDITOR_GUTTER_DELAY = 300;
```

2. In `ensureEditorHost`, l'opzione `onChange` diventa:

```js
        onChange: (rel, dirty) => onEditorTextChange(tab, rel, dirty),
```

3. Subito prima del commento `/* Una rinomina, un salvataggio o una ricarica possono finire dopo` (sopra `watchEditorFile`):

```js
/* Il testo di un file è cambiato (scrittura, undo, ricarica, salvataggio) */
function onEditorTextChange(tab, rel, dirty) {
  const f = tab.editor.files.files[rel];
  if (!f) return;
  if (f.dirty !== dirty) setEditorFile(tab, rel, { dirty });
  scheduleEditorGutter(tab, rel);
}

/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */

/* Confronta il testo nell'editor con quello di HEAD e ridisegna le barrette.
   Senza base (fuori da git, errore, file troppo grande) niente barrette. */
function updateEditorGutter(tab, rel) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f || !ed.host) return;
  const changes = f.gutterBase ? EditorGutter.changeRanges(f.gutterBase.text, ed.host.getText(rel)) : null;
  ed.files = EditorFiles.update(ed.files, rel, { changes });
  ed.host.setGutter(rel, changes);
}

/* Si ricalcola EDITOR_GUTTER_DELAY ms dopo l'ultima modifica. Un timer per
   scheda: se ne aspetta uno di un altro file, quello si fa subito. */
function scheduleEditorGutter(tab, rel) {
  const ed = tab.editor;
  const pending = ed.gutterTimer;
  if (pending) {
    clearTimeout(pending.id);
    if (pending.rel !== rel) updateEditorGutter(tab, pending.rel);
  }
  const id = setTimeout(() => {
    ed.gutterTimer = null;
    updateEditorGutter(tab, rel);
  }, EDITOR_GUTTER_DELAY);
  ed.gutterTimer = { rel, id };
}

const sameGutterBase = (a, b) => Boolean(a && b && a.text === b.text);

/* Rilegge il testo di HEAD (all'apertura, al salvataggio, tornando in primo
   piano) e, se è cambiato, ricalcola subito. text null = file non in HEAD. */
async function loadEditorGutterBase(tab, rel) {
  const r = await callEditor(() => window.aisess.editorHeadText(tab.cwd, rel));
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f || !tabs.has(tab.id)) return;
  if (!r.ok && r.error) console.warn('editor-head-text fallito:', r.error);
  const base = r.ok && (typeof r.text === 'string' || r.text === null) ? { text: r.text } : null;
  if (sameGutterBase(f.gutterBase, base)) return;
  ed.files = EditorFiles.update(ed.files, rel, { gutterBase: base });
  updateEditorGutter(tab, rel);
}

/** Le righe cambiate di un file aperto rispetto a HEAD; null se non si sa (piano 64). */
function editorFileChanges(tab, rel) {
  const f = tab && tab.editor && tab.editor.files.files[rel];
  return f ? f.changes : null;
}
```

4. In `openEditorFile`, fra `renderEditorSubtabs(tab);` e `await watchEditorFile(tab, rel);`:

```js
  loadEditorGutterBase(tab, rel); // senza aspettare: le barrette arrivano dopo il testo
```

5. In `saveEditorFile`, nel ramo `if (r.ok)`, subito prima di `done = true;`:

```js
      loadEditorGutterBase(tab, rel); // un hook di git o un commit fatto altrove
```

6. In `reloadEditorFile`, subito dopo `ed.files = EditorFiles.update(ed.files, rel, { path: r.path, … error: null });`:

```js
  updateEditorGutter(tab, rel);
```

7. In `refreshEditorTab`, fra la fine del ciclo `for` e `await reloadEditorTree(tab);`:

```js
  // Un commit fatto da un terminale cambia HEAD: le barrette si rifanno
  await Promise.all(ed.files.order.map((rel) => loadEditorGutterBase(tab, rel)));
```

8. In `renameEditorEntry`, nel ciclo sui file spostati, fra `if (ed.host) ed.host.rename(rel, to);` e `await watchEditorFile(tab, to);`:

```js
    ed.files = EditorFiles.update(ed.files, to, { gutterBase: null, changes: null });
    loadEditorGutterBase(tab, to);
```

9. In `disposeEditorTab`, dopo il ciclo degli `unwatchEditorFile`:

```js
  if (ed.gutterTimer) { clearTimeout(ed.gutterTimer.id); ed.gutterTimer = null; }
```

10. In `createEditorTab`, la riga `host: null, hostPending: null, …, copying: false,` diventa:

```js
    host: null, hostPending: null, saving: new Set(), pendingChanges: new Map(), copying: false, gutterTimer: null,
```

`editor-tab.js` arriva a circa 750 righe, sotto il limite di 800. Se il piano 64 aggiunge molto, le funzioni delle barrette sono il primo pezzo da spostare (`editor-tab-gutter.js`).

- [ ] **Step 7: colori e CSS**

In `renderer/tokens.css`, sezione `/* stati */`, dopo `--state-error`:

```css
  --state-changed: #5AA2FF;  /* righe modificate rispetto a git (barrette dell'editor) */
```

In `renderer/styles.css`, subito dopo `.editor-host { flex: 1; min-height: 0; }`:

```css
/* Barrette delle righe cambiate rispetto a HEAD (docs/plans/63). Monaco
   mette la classe su un div .cldr a tutta altezza della riga, largo quanto
   il margine: la barretta è uno pseudo-elemento, così non dipende da lui. */
.monaco-editor .editor-gutter-add::before,
.monaco-editor .editor-gutter-mod::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: 2px; width: 3px;
}
.monaco-editor .editor-gutter-add::before { background: var(--state-ok); }
.monaco-editor .editor-gutter-mod::before { background: var(--state-changed); }
/* Righe tolte: un triangolino sul bordo sotto la riga (sopra la prima, se
   mancano in cima) */
.monaco-editor .editor-gutter-del::after {
  content: ''; position: absolute; left: 2px; bottom: -4px; z-index: 5;
  border-top: 4px solid transparent; border-bottom: 4px solid transparent;
  border-left: 5px solid var(--state-error);
}
.monaco-editor .editor-gutter-del-top::after { bottom: auto; top: -4px; }
```

- [ ] **Step 8: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-monaco.test.js tests/editor-tab.test.js tests/editor-files.test.js tests/renderer-load.test.js`
Expected: PASS, compresi i 2 test nuovi dell'host e gli 8 della scheda.

- [ ] **Step 9: suite intera**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1606 test (1605 pass, 1 skip).

- [ ] **Step 10: commit**

```bash
git add renderer/editor-monaco.js renderer/editor-files.js renderer/editor-tab.js renderer/tokens.css renderer/styles.css tests/editor-monaco.test.js tests/editor-tab.test.js
cat > /tmp/msg.txt <<'EOF'
feat: barrette delle righe cambiate nell'editor

Accanto ai numeri di riga: verde aggiunte, blu modificate, triangolino
rosso dove mancano righe, rispetto all'ultimo commit. Il testo di HEAD si
rilegge all'apertura, al salvataggio e tornando in primo piano (un commit
da un terminale le fa sparire); mentre si scrive si ricalcola 300 ms dopo
l'ultima modifica. Fuori da git o con un errore non c'è niente da
disegnare, e il file si apre lo stesso. L'host espone anche reveal() e la
scheda editorFileChanges(), che serviranno al piano 64.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

## Punti aperti

- I file sotto un filtro (LFS, smudge) e i link simbolici risultano cambiati per intero: il blob di HEAD non è quello che c'è sul disco.
- Una riformattazione grossa supera `MAX_DIFF_STEPS` e non mostra barrette, invece di mostrarne troppe.
- I triangolini si disegnano a cavallo fra due righe (`bottom: -4px`). Se Monaco taglia quello che esce dal div della riga, si vede solo metà: va guardato a mano, e nel caso si mette `overflow: visible` sui `.cldr`.

## Da verificare a mano (dopo i task)

Nell'app (`npm start` dal worktree), con una scheda editor su una cartella in git:
- Aprire un file modificato: barrette verdi, blu e triangolini rossi dove
  dice `git diff`.
- Scrivere: le barrette seguono. Annullare fino al testo di HEAD: spariscono.
- Fare un commit da un terminale e tornare sulla scheda: le barrette spariscono.
- File nuovo non tracciato: tutto verde. Cartella fuori da git: niente.
- In più: rinominare dall'albero un file modificato, e le barrette restano giuste sul nome nuovo.

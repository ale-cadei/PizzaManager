# 60 — Sessione editor: piano di implementazione

> **Per chi esegue:** un task alla volta, nell'ordine. Ogni task: test prima
> (rosso), codice (verde), commit. I passi usano le checkbox (`- [ ]`).
> Il *perché* delle scelte sta nel piano `docs/plans/60-sessione-editor.md`:
> questo file dice *cosa scrivere*.

**Obiettivo:** un tipo di sessione `editor` che apre una cartella, ne mostra
l'albero e modifica i file con Monaco (sotto-schede, cerca/sostituisci,
operazioni sui file, ripristino al riavvio, cambi esterni).

**Architettura:** il main legge e scrive i file (`lib/editor-fs.js`,
confinato nella cartella della sessione), sorveglia i file aperti
(`lib/editor-watch.js`) e ricorda le schede (`lib/editor-sessions.js`);
`app/editor.js` collega i canali IPC. Nel renderer tre moduli UMD puri
(`editor-files.js`, `editor-tree.js`, `editor-monaco.js`) e uno script
dell'app (`editor-tab.js`) che li cabla, sul modello di `git-tab.js`.

**Tecnologie:** Electron, Node ≥ 22 (`node --test`), `monaco-editor@0.57.0`
(loader AMD da `min/vs`).

## Vincoli globali

- `lib/` non fa `require('electron')` (c'è un test). `main.js` solo
  cablaggio: funzioni ammesse `sendToRenderer`, `fail`; righe sotto il limite
  di `tests/unit.test.js` (oggi `< 232`, questo piano lo porta a `< 234`).
- I test importano il codice vero, verificano comportamenti, non il testo
  del sorgente. Test di Windows in `tests/windows.test.js` con
  `platform: 'win32'`.
- Percorsi: separatori `[\\/]`, mai `split('/')` su percorsi del disco.
  I percorsi *relativi* dell'editor (`rel`) usano sempre `/`: li produce
  `safeRel`.
- Testo che arriva da fuori (nomi di file, errori): `textContent`, mai
  `innerHTML` interpolato.
- CSP: `script-src 'self'`, **mai** `'unsafe-inline'`. Si aggiunge solo
  `worker-src 'self' blob:`.
- `monaco-editor` versione **esatta** `0.57.0` (niente `^`).
- Eliminare = cestino (`shell.trashItem`), mai `unlink`/`rm`.
- Messaggi all'utente in italiano.
- Commit: `<tipo>: <cosa>` + perché nel corpo, chiuso da
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Il messaggio si
  scrive in `/tmp/msg.txt` e si passa con `git commit --file=/tmp/msg.txt`
  (un hook blocca `-F -`).
- Node dei test (quello di sistema è v12):

  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  ```

  Tutti i comandi `node --test` / `npm run test:unit` qui sotto lo
  presuppongono.

## Mappa dei file

| File | Nuovo/Modifica | Responsabilità |
|---|---|---|
| `lib/editor-paths.js` | nuovo | `validName`, `isInside`, `safeRel` (puri, con `platform`) |
| `lib/git-run.js` | modifica | opzione `input` (stdin) |
| `lib/editor-fs.js` | nuovo | list/read/write/stat/create/mkdir/rename/trashTarget confinati |
| `lib/editor-watch.js` | nuovo | `fs.watch` per file, debounce, riarmo |
| `lib/editor-sessions.js` | nuovo | store `editor-sessions.json` |
| `app/editor.js` | nuovo | canali IPC `editor-*`, watch per finestra, cestino |
| `app/editor-close.js` | nuovo | conferma d'uscita: `will-prevent-unload` + `editor-close-confirmed` |
| `main.js`, `preload.js` | modifica | una riga di require + una di registrazione; API `window.aisess.editor*` |
| `renderer/editor-files.js` | nuovo | stato dei file aperti (puro) |
| `renderer/editor-tree.js` | nuovo | modello e vista dell'albero, input inline, menu |
| `renderer/editor-monaco.js` | nuovo | unico modulo che tocca Monaco |
| `renderer/editor-tab.js` | nuovo | cablaggio della scheda |
| `renderer/{app-state,tabs,tab-names,session-titles,session-groups,type-color-themes,agent-icons,restore,renderer}.js`, `index.html`, `tokens.css`, `styles.css` | modifica | registrazione del tipo |
| `package.json`, `THIRD-PARTY-NOTICES.md` | modifica | dipendenza, esclusioni dal pacchetto, licenza |

---

### Task 1: `lib/editor-paths.js`

**File:**
- Crea: `lib/editor-paths.js`
- Test: `tests/editor-paths.test.js`, `tests/windows.test.js` (in coda)

**Interfacce prodotte:**
- `validName(name: string, platform?: string): boolean`
- `isInside(root: string, target: string, platform?: string): boolean`
- `safeRel(rel: string): string|null` — `''` = radice, `null` = rifiutato;
  risultato sempre con `/`.
- costanti `MAX_NAME = 255`, `MAX_REL = 1024`.

- [ ] **Passo 1: test che fallisce** — `tests/editor-paths.test.js`

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { validName, isInside, safeRel } = require('../lib/editor-paths');

ok('validName: i nomi normali passano, anche quelli riservati solo su Windows', () => {
  for (const n of ['a.js', '.env', 'README', 'con.txt', 'fine.']) assert.strictEqual(validName(n, 'linux'), true, n);
});

ok('validName: vuoti, punti, separatori, controllo e lunghi si rifiutano', () => {
  for (const n of ['', '.', '..', 'a/b', 'a\\b', 'a\nb', 'a\x00', 'x'.repeat(256), null, 3]) {
    assert.strictEqual(validName(n, 'linux'), false, JSON.stringify(n));
  }
});

ok('isInside: la radice e i figli sono dentro, i fratelli e i genitori no', () => {
  assert.strictEqual(isInside('/a/b', '/a/b', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/b/c/d.js', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/b/..foo', 'linux'), true);
  assert.strictEqual(isInside('/a/b', '/a/bc', 'linux'), false);
  assert.strictEqual(isInside('/a/b', '/a', 'linux'), false);
  assert.strictEqual(isInside('/a/b', '/a/b/../x', 'linux'), false);
});

ok('safeRel: normalizza i relativi e usa sempre /', () => {
  assert.strictEqual(safeRel('src/a.js'), 'src/a.js');
  assert.strictEqual(safeRel('./src//a.js'), 'src/a.js');
  assert.strictEqual(safeRel('src\\a.js'), 'src/a.js');
  assert.strictEqual(safeRel(''), '');
  assert.strictEqual(safeRel('.'), '');
});

ok('safeRel: rifiuta .., assoluti, lettere di unità, controllo e non-stringhe', () => {
  for (const r of ['../x', 'a/../b', '..', '/etc/passwd', '\\\\srv\\x', 'C:\\x', 'C:x', 'a\x00b', 'x'.repeat(1025), null, 1]) {
    assert.strictEqual(safeRel(r), null, JSON.stringify(r));
  }
});
```

In coda a `tests/windows.test.js`:

```js
// ---------- lib/editor-paths (docs/plans/60) ----------
const editorPaths = require('../lib/editor-paths');

ok('win: validName rifiuta nomi riservati, caratteri vietati, punti e spazi finali', () => {
  for (const n of ['CON', 'nul.txt', 'com1', 'LPT9.log', 'a<b', 'a:b', 'a?', 'a"b', 'a|b', 'a*', 'fine.', 'fine ']) {
    assert.strictEqual(editorPaths.validName(n, 'win32'), false, n);
  }
  assert.strictEqual(editorPaths.validName('console.js', 'win32'), true);
});

ok('win: isInside non bada alle maiuscole e non confonde le unità', () => {
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'c:\\prog\\app\\src\\a.js', 'win32'), true);
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'C:\\Prog\\AppX\\a.js', 'win32'), false);
  assert.strictEqual(editorPaths.isInside('C:\\Prog\\App', 'D:\\Prog\\App\\a.js', 'win32'), false);
});
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/editor-paths.test.js`
Atteso: FAIL, `Cannot find module '../lib/editor-paths'`.

- [ ] **Passo 3: implementazione** — `lib/editor-paths.js`

```js
'use strict';
/* Percorsi e nomi della sessione editor (docs/plans/60). Funzioni pure con
 * `platform` come parametro: i casi Windows si provano da Unix
 * (tests/windows.test.js). Le usano lib/editor-fs.js e lib/editor-sessions.js. */
const path = require('path');

const MAX_NAME = 255;
const MAX_REL = 1024;
const CONTROL = /[\x00-\x1f\x7f]/;
const WIN_FORBIDDEN = /[<>:"|?*]/;
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Un nome di file o cartella (non un percorso) che si può creare.
 * @param {unknown} name
 * @param {string} [platform]
 * @returns {boolean}
 */
function validName(name, platform = process.platform) {
  if (typeof name !== 'string' || !name || name.length > MAX_NAME) return false;
  if (name === '.' || name === '..' || /[\\/]/.test(name) || CONTROL.test(name)) return false;
  if (platform !== 'win32') return true;
  return !WIN_FORBIDDEN.test(name) && !WIN_RESERVED.test(name) && !/[. ]$/.test(name);
}

/**
 * `target` è `root` o sta sotto. Su Windows senza badare alle maiuscole.
 * @param {string} root
 * @param {string} target
 * @param {string} [platform]
 * @returns {boolean}
 */
function isInside(root, target, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s) => (platform === 'win32' ? String(s).toLowerCase() : String(s));
  const rel = p.relative(p.resolve(fold(root)), p.resolve(fold(target)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + p.sep) && !p.isAbsolute(rel));
}

/**
 * Un percorso relativo che arriva dal renderer o da un file: niente `..`,
 * niente assoluti, niente caratteri di controllo. `..` si rifiuta anche se
 * resterebbe dentro (`a/../b`): nessun chiamante onesto lo manda.
 * @param {unknown} rel
 * @returns {string|null} con `/`; `''` è la radice
 */
function safeRel(rel) {
  if (typeof rel !== 'string' || rel.length > MAX_REL || CONTROL.test(rel)) return null;
  if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const parts = rel.split(/[\\/]/).filter((s) => s && s !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/');
}

module.exports = { validName, isInside, safeRel, MAX_NAME, MAX_REL };
```

- [ ] **Passo 4: verifica che passi**

Run: `node --test tests/editor-paths.test.js tests/windows.test.js`
Atteso: PASS.

- [ ] **Passo 5: commit**

```bash
git add lib/editor-paths.js tests/editor-paths.test.js tests/windows.test.js
cat > /tmp/msg.txt <<'EOF'
feat: lib/editor-paths, nomi e percorsi della sessione editor

La sessione editor riceve percorsi relativi dal renderer: prima di
toccare il disco vanno ripuliti (safeRel), confrontati con la cartella
della sessione (isInside) e, per i nomi nuovi, controllati anche con le
regole di Windows (validName). Funzioni pure con platform, provate da
Unix in tests/windows.test.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 2: `runGit` con `input`, `lib/editor-fs.js`

**File:**
- Modifica: `lib/git-run.js` (funzione `runGit`)
- Crea: `lib/editor-fs.js`
- Test: `tests/git-run.test.js` (nuovo), `tests/editor-fs.test.js` (nuovo)

**Interfacce consumate:** `validName`, `isInside`, `safeRel` (Task 1).

**Interfacce prodotte:**
- `runGit(args, { cwd, env, timeout, buffer, input })` — `input: string|null`
  scritto sullo stdin.
- `createEditorFs({ root, platform }) →` oggetto con:
  - `realRoot: string`
  - `resolveInside(rel) → string` (assoluto, symlink seguiti; lancia con
    `code: 'EOUTSIDE'`)
  - `list(rel='') → Promise<{ok:true, entries:{name, kind:'file'|'dir', ignored:boolean}[]} | {ok:false, error}>`
  - `read(rel) → Promise<{ok:true, text, bom, mtime, path} | {ok:false, reason, error?}>`,
    `reason ∈ binary|too-large|not-utf8|outside|missing|not-file|error`
  - `write(rel, text, {expectedMtime=null, bom=false}) → Promise<{ok:true, mtime} | {ok:false, conflict:true, mtime:number|null} | {ok:false, error}>`
  - `stat(rel) → Promise<{ok:true, exists, mtime:number|null} | {ok:false, error}>`
  - `create(rel)`, `mkdir(rel) → Promise<{ok:true} | {ok:false, error}>`
  - `rename(rel, newName) → Promise<{ok:true, rel:newRel} | {ok:false, error}>`
  - `trashTarget(rel) → {ok:true, path} | {ok:false, error}` (sincrona)
- `MAX_READ = 5 * 1024 * 1024`.

- [ ] **Passo 1: test di `runGit` che fallisce** — `tests/git-run.test.js`

```js
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
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/git-run.test.js`
Atteso: il primo test FAIL (timeout, git `killed`).

- [ ] **Passo 3: `input` in `runGit`** — in `lib/git-run.js` aggiungere al
JSDoc di `runGit` `input?: string` («scritto sullo stdin: `check-ignore
--stdin` della sessione editor») e sostituire il corpo:

```js
function runGit(args, { cwd, env = {}, timeout = 0, buffer = false, input = null }) {
  // git si cerca come gli altri binari (PATH di login compreso)
  const bin = resolveBinary('git');
  if (!bin.path) return Promise.reject(Object.assign(new Error('git non trovato nel PATH'), { missing: true }));
  return new Promise((resolve, reject) => {
    const child = execFile(bin.path, args, {
      cwd, maxBuffer: MAX_BUFFER, windowsHide: true, timeout, encoding: buffer ? 'buffer' : 'utf8',
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr: String(stderr || ''), stdout: String(stdout || '') }));
      resolve(buffer ? stdout : String(stdout));
    });
    if (input !== null) {
      // git può uscire senza leggere (fuori da un repository): l'EPIPE sullo
      // stdin non è l'errore da riportare, quello arriva dalla callback
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}
```

- [ ] **Passo 4: verifica**

Run: `node --test tests/git-run.test.js tests/git-graph.test.js`
Atteso: PASS.

- [ ] **Passo 5: test di `editor-fs` che falliscono** — `tests/editor-fs.test.js`

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorFs, MAX_READ } = require('../lib/editor-fs');
const { resolveBinary } = require('../lib/binaries');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-editor-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

ok('createEditorFs: la cartella deve esistere ed essere una cartella', (t) => {
  const root = tmp(t);
  put(root, 'f.txt', 'x');
  assert.throws(() => createEditorFs({ root: path.join(root, 'manca') }));
  assert.throws(() => createEditorFs({ root: path.join(root, 'f.txt') }));
  assert.throws(() => createEditorFs({}));
});

ok('read: percorsi che escono si rifiutano, anche via symlink', async (t) => {
  const root = tmp(t);
  const outside = tmp(t);
  put(outside, 'secret.txt', 'segreto');
  fs.symlinkSync(outside, path.join(root, 'link'));
  const efs = createEditorFs({ root });
  for (const rel of ['../x', '/etc/passwd', 'link/secret.txt']) {
    assert.strictEqual((await efs.read(rel)).reason, 'outside', rel);
  }
  assert.strictEqual((await efs.write('link/nuovo.txt', 'x', { expectedMtime: null })).ok, false);
  assert.ok(!fs.existsSync(path.join(outside, 'nuovo.txt')));
});

ok('read: un symlink che resta dentro si segue', async (t) => {
  const root = tmp(t);
  put(root, 'src/a.js', 'ciao');
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'alias'));
  const r = await createEditorFs({ root }).read('alias/a.js');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'ciao');
  assert.strictEqual(r.path, path.join(root, 'src', 'a.js'));
});

ok('read: binari, troppo grandi, non UTF-8, mancanti, cartelle', async (t) => {
  const root = tmp(t);
  put(root, 'bin', Buffer.from([0x41, 0x00, 0x42]));
  put(root, 'big', Buffer.alloc(MAX_READ + 1, 0x41));
  put(root, 'latin1', Buffer.from([0x63, 0x61, 0x66, 0xe8]));
  fs.mkdirSync(path.join(root, 'dir'));
  const efs = createEditorFs({ root });
  assert.strictEqual((await efs.read('bin')).reason, 'binary');
  assert.strictEqual((await efs.read('big')).reason, 'too-large');
  assert.strictEqual((await efs.read('latin1')).reason, 'not-utf8');
  assert.strictEqual((await efs.read('manca.txt')).reason, 'missing');
  assert.strictEqual((await efs.read('dir')).reason, 'not-file');
});

ok('read/write: CRLF intatto, BOM tolto in lettura e rimesso in scrittura', async (t) => {
  const root = tmp(t);
  put(root, 'crlf.txt', 'a\r\nb\r\n');
  put(root, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ciao')]));
  const efs = createEditorFs({ root });
  const crlf = await efs.read('crlf.txt');
  assert.strictEqual(crlf.text, 'a\r\nb\r\n');
  assert.strictEqual(crlf.bom, false);
  const bom = await efs.read('bom.txt');
  assert.strictEqual(bom.text, 'ciao');
  assert.strictEqual(bom.bom, true);
  const w = await efs.write('bom.txt', 'ciao2', { expectedMtime: bom.mtime, bom: true });
  assert.strictEqual(w.ok, true);
  assert.deepStrictEqual([...fs.readFileSync(path.join(root, 'bom.txt'))].slice(0, 3), [0xef, 0xbb, 0xbf]);
  assert.strictEqual((await efs.read('bom.txt')).text, 'ciao2');
});

ok('write: atomica, mode conservato, nessun temporaneo lasciato', async (t) => {
  const root = tmp(t);
  const p = put(root, 'secret.env', 'A=1');
  fs.chmodSync(p, 0o600);
  const efs = createEditorFs({ root });
  const r = await efs.read('secret.env');
  const w = await efs.write('secret.env', 'A=2', { expectedMtime: r.mtime });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(typeof w.mtime, 'number');
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'A=2');
  assert.deepStrictEqual(fs.readdirSync(root), ['secret.env']);
});

ok('write: mtime diverso sul disco = conflitto, il file non si tocca', async (t) => {
  const root = tmp(t);
  const p = put(root, 'a.txt', 'uno');
  const efs = createEditorFs({ root });
  const r = await efs.read('a.txt');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(p, later, later);
  const w = await efs.write('a.txt', 'due', { expectedMtime: r.mtime });
  assert.strictEqual(w.ok, false);
  assert.strictEqual(w.conflict, true);
  assert.strictEqual(w.mtime, fs.statSync(p).mtimeMs);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'uno');
  // expectedMtime null su un file che esiste: conflitto anche quello
  assert.strictEqual((await efs.write('a.txt', 'tre', { expectedMtime: null })).conflict, true);
  // expectedMtime null su un file che non c'è: si crea
  assert.strictEqual((await efs.write('nuovo.txt', 'x', { expectedMtime: null })).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(root, 'nuovo.txt'), 'utf8'), 'x');
});

ok('stat: esiste o no, col suo mtime', async (t) => {
  const root = tmp(t);
  const p = put(root, 'a.txt', 'x');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(await efs.stat('a.txt'), { ok: true, exists: true, mtime: fs.statSync(p).mtimeMs });
  assert.deepStrictEqual(await efs.stat('manca.txt'), { ok: true, exists: false, mtime: null });
  assert.strictEqual((await efs.stat('../x')).ok, false);
});

ok('create, mkdir, rename: falliscono su una destinazione che esiste', async (t) => {
  const root = tmp(t);
  put(root, 'a.txt', 'x');
  put(root, 'b.txt', 'y');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(await efs.create('c.txt'), { ok: true });
  assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), '');
  const dup = await efs.create('a.txt');
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.error, 'Esiste già un file o una cartella con quel nome.');
  assert.deepStrictEqual(await efs.mkdir('src'), { ok: true });
  assert.strictEqual((await efs.mkdir('src')).ok, false);
  assert.strictEqual((await efs.rename('a.txt', 'b.txt')).ok, false);
  assert.strictEqual(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'y');
  assert.deepStrictEqual(await efs.rename('a.txt', 'z.txt'), { ok: true, rel: 'z.txt' });
  put(root, 'src/x.js', '');
  assert.deepStrictEqual(await efs.rename('src/x.js', 'y.js'), { ok: true, rel: 'src/y.js' });
  assert.strictEqual((await efs.rename('z.txt', 'a/b')).error, 'Nome non valido.');
  assert.strictEqual((await efs.create('src/..')).ok, false);
  assert.strictEqual((await efs.rename('', 'x')).ok, false);
});

ok('list: cartelle prima, ordine naturale, .git nascosta', async (t) => {
  const root = tmp(t);
  for (const f of ['f10.txt', 'f2.txt', 'B.txt', 'a.txt']) put(root, f, '');
  fs.mkdirSync(path.join(root, 'zdir'));
  fs.mkdirSync(path.join(root, '.git'));
  const r = await createEditorFs({ root }).list('');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.entries.map((e) => `${e.kind}:${e.name}`),
    ['dir:zdir', 'file:a.txt', 'file:B.txt', 'file:f2.txt', 'file:f10.txt']);
  assert.ok(r.entries.every((e) => e.ignored === false));
  assert.strictEqual((await createEditorFs({ root }).list('manca')).ok, false);
});

ok('list: ignored lo dice git, dentro un repository', async (t) => {
  if (!resolveBinary('git').path) return t.skip('git non installato su questa macchina');
  const root = tmp(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  put(root, '.gitignore', 'build/\n*.log\n');
  put(root, 'build/out.js', '');
  put(root, 'a.log', '');
  put(root, 'b.js', '');
  const r = await createEditorFs({ root }).list('');
  const ignored = Object.fromEntries(r.entries.map((e) => [e.name, e.ignored]));
  assert.deepStrictEqual(ignored, { build: true, '.gitignore': false, 'a.log': true, 'b.js': false });
});

ok('trashTarget: la voce stessa, mai la radice', (t) => {
  const root = tmp(t);
  put(root, 'a.txt', '');
  const efs = createEditorFs({ root });
  assert.deepStrictEqual(efs.trashTarget('a.txt'), { ok: true, path: path.join(root, 'a.txt') });
  assert.strictEqual(efs.trashTarget('').ok, false);
  assert.strictEqual(efs.trashTarget('manca').ok, false);
  assert.strictEqual(efs.trashTarget('../x').ok, false);
});
```

- [ ] **Passo 6: verifica che fallisca**

Run: `node --test tests/editor-fs.test.js`
Atteso: FAIL, `Cannot find module '../lib/editor-fs'`.

- [ ] **Passo 7: implementazione** — `lib/editor-fs.js`

```js
'use strict';
/* File della sessione editor (docs/plans/60). Ogni percorso arriva relativo
 * dal renderer e passa da qui: si risolve sotto la cartella della sessione,
 * symlink compresi, e si rifiuta se esce. Le letture rifiutano quello che
 * l'editor non sa mostrare (binari, > 5 MB, non UTF-8); le scritture sono
 * atomiche e non sovrascrivono un file cambiato da quando lo si è letto. */
const fs = require('fs');
const path = require('path');
const { runGit } = require('./git-run');
const { validName, isInside, safeRel } = require('./editor-paths');

const MAX_READ = 5 * 1024 * 1024;
const SNIFF = 8 * 1024;
const MAX_IGNORE_CHECK = 5000;
const IGNORE_TIMEOUT = 5000;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const HIDDEN = new Set(['.git']);

const MESSAGES = {
  EOUTSIDE: 'Il percorso esce dalla cartella della sessione.',
  EINVALNAME: 'Nome non valido.',
  EEXIST: 'Esiste già un file o una cartella con quel nome.',
  ENOENT: 'Non esiste più.',
  ENOTDIR: 'Non esiste più.',
  EACCES: 'Permesso negato.',
  EPERM: 'Permesso negato.',
  ENOSPC: 'Disco pieno.',
  EISDIR: 'È una cartella.',
  ENOTFILE: 'Non è un file.',
};

const coded = (code) => Object.assign(new Error(MESSAGES[code] || code), { code });
const failure = (e) => ({ ok: false, error: MESSAGES[e && e.code] || String((e && e.message) || e) });

function readFailure(e) {
  if (e && e.code === 'EOUTSIDE') return { ok: false, reason: 'outside' };
  if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { ok: false, reason: 'missing' };
  return { ok: false, reason: 'error', error: failure(e).error };
}

async function statOrNull(abs) {
  try { return await fs.promises.stat(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byKindThenName = (a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1);

/** Testo UTF-8 o il motivo per cui non lo è. */
function decode(buf) {
  if (buf.subarray(0, SNIFF).includes(0)) return { ok: false, reason: 'binary' };
  const bom = buf.subarray(0, 3).equals(BOM);
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? buf.subarray(3) : buf);
    return { ok: true, text, bom };
  } catch {
    return { ok: false, reason: 'not-utf8' };
  }
}

async function kindOf(dir, dirent) {
  if (dirent.isDirectory()) return 'dir';
  if (!dirent.isSymbolicLink()) return 'file';
  try { return (await fs.promises.stat(path.join(dir, dirent.name))).isDirectory() ? 'dir' : 'file'; } catch { return 'file'; }
}

/* Quali nomi della cartella git ignora. Exit 1 = nessuno, 128 = fuori da un
 * repository, git assente: in tutti i casi nessuno è attenuato, che è la
 * cosa giusta da mostrare. Oltre MAX_IGNORE_CHECK voci non si chiede. */
async function ignoredNames(dir, names) {
  if (!names.length || names.length > MAX_IGNORE_CHECK) return new Set();
  try {
    const out = await runGit(['check-ignore', '-z', '--stdin'], { cwd: dir, input: names.join('\0'), timeout: IGNORE_TIMEOUT });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * @param {{root: string, platform?: string}} o la cartella della sessione
 */
function createEditorFs({ root, platform = process.platform } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('cartella della sessione mancante');
  let st;
  try { st = fs.statSync(root); } catch { throw new Error('la cartella non esiste: ' + root); }
  if (!st.isDirectory()) throw new Error('non è una cartella: ' + root);
  const realRoot = fs.realpathSync(root);

  const relOf = (rel) => {
    const clean = safeRel(rel);
    if (clean === null) throw coded('EOUTSIDE');
    return clean;
  };
  const check = (abs) => {
    if (!isInside(realRoot, abs, platform)) throw coded('EOUTSIDE');
    return abs;
  };

  /* realpath del percorso o, se non esiste ancora, dell'antenato più vicino che esiste */
  function realOrAncestor(abs) {
    const rest = [];
    let cur = abs;
    for (;;) {
      try {
        return path.join(fs.realpathSync(cur), ...rest);
      } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
        const parent = path.dirname(cur);
        if (parent === cur) throw e;
        rest.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }

  /** Assoluto, symlink seguiti: dove si legge e si scrive il contenuto. */
  const resolveInside = (rel) => check(realOrAncestor(path.join(realRoot, relOf(rel))));

  /* La voce stessa, non il bersaglio di un symlink: padre risolto + nome.
     Serve a creare, rinominare, eliminare. La radice non si tocca. */
  function resolveEntry(rel) {
    const clean = relOf(rel);
    if (!clean) throw coded('EOUTSIDE');
    return check(path.join(resolveInside(path.posix.dirname(clean)), path.posix.basename(clean)));
  }

  function newEntry(rel) {
    const clean = relOf(rel);
    if (!validName(path.posix.basename(clean), platform)) throw coded('EINVALNAME');
    return resolveEntry(clean);
  }

  async function list(rel = '') {
    try {
      const dir = resolveInside(rel);
      const dirents = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => !HIDDEN.has(d.name));
      const entries = await Promise.all(dirents.map(async (d) => ({ name: d.name, kind: await kindOf(dir, d) })));
      const ignored = await ignoredNames(dir, entries.map((e) => e.name));
      return { ok: true, entries: entries.map((e) => ({ ...e, ignored: ignored.has(e.name) })).sort(byKindThenName) };
    } catch (e) {
      return failure(e);
    }
  }

  async function read(rel) {
    try {
      const abs = resolveInside(rel);
      const info = await fs.promises.stat(abs);
      if (!info.isFile()) return { ok: false, reason: 'not-file' };
      if (info.size > MAX_READ) return { ok: false, reason: 'too-large' };
      const decoded = decode(await fs.promises.readFile(abs));
      return decoded.ok ? { ...decoded, mtime: info.mtimeMs, path: abs } : decoded;
    } catch (e) {
      return readFailure(e);
    }
  }

  /* Scrittura atomica: temporaneo nella stessa cartella e rename. Il mode
     dell'originale si rimette dopo (writeFile lo applica solo alla creazione,
     e passa dall'umask): un .env a 0600 resta a 0600. */
  async function write(rel, text, { expectedMtime = null, bom = false } = {}) {
    if (typeof text !== 'string') return { ok: false, error: 'Testo mancante.' };
    let tmp = null;
    try {
      const abs = resolveInside(rel);
      const before = await statOrNull(abs);
      if (before && !before.isFile()) throw coded('ENOTFILE');
      const diskMtime = before ? before.mtimeMs : null;
      if (diskMtime !== expectedMtime) return { ok: false, conflict: true, mtime: diskMtime };
      tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.aisess-${process.pid}-${Date.now()}.tmp`);
      const body = Buffer.from(text, 'utf8');
      await fs.promises.writeFile(tmp, bom ? Buffer.concat([BOM, body]) : body, { flag: 'wx' });
      if (before) await fs.promises.chmod(tmp, before.mode & 0o777);
      await fs.promises.rename(tmp, abs);
      tmp = null;
      return { ok: true, mtime: (await fs.promises.stat(abs)).mtimeMs };
    } catch (e) {
      if (tmp) await fs.promises.rm(tmp, { force: true }).catch((err) => console.warn('[editor] temporaneo rimasto:', tmp, err.message));
      return failure(e);
    }
  }

  async function stat(rel) {
    try {
      const info = await statOrNull(resolveInside(rel));
      return { ok: true, exists: Boolean(info), mtime: info ? info.mtimeMs : null };
    } catch (e) {
      return failure(e);
    }
  }

  async function create(rel) {
    try {
      await fs.promises.writeFile(newEntry(rel), '', { flag: 'wx' });
      return { ok: true };
    } catch (e) {
      return failure(e);
    }
  }

  async function mkdir(rel) {
    try {
      await fs.promises.mkdir(newEntry(rel));
      return { ok: true };
    } catch (e) {
      return failure(e);
    }
  }

  async function rename(rel, newName) {
    try {
      if (!validName(newName, platform)) throw coded('EINVALNAME');
      const clean = relOf(rel);
      const from = resolveEntry(clean);
      const to = path.join(path.dirname(from), newName);
      const source = await fs.promises.lstat(from);
      const existing = await fs.promises.lstat(to).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
      // Stesso inode = cambia solo una maiuscola su un disco che non le distingue
      if (existing && !(existing.ino === source.ino && existing.dev === source.dev)) throw coded('EEXIST');
      await fs.promises.rename(from, to);
      const parent = path.posix.dirname(clean);
      return { ok: true, rel: parent === '.' ? newName : `${parent}/${newName}` };
    } catch (e) {
      return failure(e);
    }
  }

  /** Il percorso da mandare al cestino (app/editor.js): solo dopo i controlli. */
  function trashTarget(rel) {
    try {
      const abs = resolveEntry(rel);
      fs.lstatSync(abs);
      return { ok: true, path: abs };
    } catch (e) {
      return failure(e);
    }
  }

  return { realRoot, resolveInside, list, read, write, stat, create, mkdir, rename, trashTarget };
}

module.exports = { createEditorFs, MAX_READ };
```

- [ ] **Passo 8: verifica**

Run: `node --test tests/editor-fs.test.js tests/git-run.test.js && npm run test:unit`
Atteso: PASS (anche il test che vieta `require('electron')` in `lib/`).

- [ ] **Passo 9: commit**

```bash
git add lib/git-run.js lib/editor-fs.js tests/git-run.test.js tests/editor-fs.test.js
cat > /tmp/msg.txt <<'EOF'
feat: lib/editor-fs, confinamento e lettura/scrittura dei file

La sessione editor legge e scrive file a partire da percorsi che manda il
renderer: qui si risolvono sotto la cartella della sessione (symlink
compresi) e si rifiutano se escono. Le letture rifiutano binari, file
oltre 5 MB e non UTF-8; le scritture sono atomiche, conservano mode e
BOM e non sovrascrivono un file cambiato da quando lo si è letto.

runGit prende un input per lo stdin: check-ignore --stdin dice quali voci
dell'albero git ignora, con una sola chiamata per cartella.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 3: `lib/editor-watch.js`

**File:**
- Crea: `lib/editor-watch.js`
- Test: `tests/editor-watch.test.js`

**Interfacce prodotte:**
- `createEditorWatch({ onChange, debounceMs = 150, watchFn = fs.watch }) → { watch(abs): boolean, unwatch(abs): void, close(): void, size(): number }`
- `onChange({ path, exists, mtime })` — `mtime: number|null`.
- `watch` conta i riferimenti: due `watch` dello stesso percorso vogliono due
  `unwatch`. Restituisce `true` se un watcher è armato.

- [ ] **Passo 1: test che fallisce** — `tests/editor-watch.test.js`

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorWatch } = require('../lib/editor-watch');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* fs.watch finto: gli eventi li decide il test. Come quello vero lancia se
   il file non c'è. */
function fakeWatch() {
  const watchers = [];
  const watchFn = (p, listener) => {
    if (!fs.existsSync(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const w = new EventEmitter();
    w.path = p;
    w.closed = false;
    w.close = () => { w.closed = true; };
    w.on('change', listener);
    watchers.push(w);
    return w;
  };
  const live = (p) => watchers.filter((w) => w.path === p && !w.closed);
  const fire = (p) => live(p).forEach((w) => w.emit('change', 'change', path.basename(p)));
  return { watchers, watchFn, live, fire };
}

function tmpFile(t, content = 'x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-watch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'a.txt');
  fs.writeFileSync(p, content);
  return p;
}

ok('watch: più eventi ravvicinati diventano una notifica, col mtime del disco', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 20, watchFn: fake.watchFn });
  assert.strictEqual(w.watch(p), true);
  fake.fire(p); fake.fire(p); fake.fire(p);
  await sleep(80);
  assert.deepStrictEqual(seen, [{ path: p, exists: true, mtime: fs.statSync(p).mtimeMs }]);
  w.close();
});

ok('watch: dopo un evento si riarma (un rename sostituisce l\'inode)', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const w = createEditorWatch({ onChange: () => {}, debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fake.fire(p);
  await sleep(50);
  assert.strictEqual(fake.watchers.length, 2);
  assert.strictEqual(fake.watchers[0].closed, true);
  assert.strictEqual(fake.live(p).length, 1);
  w.close();
});

ok('watch: un file cancellato si notifica con exists false e non si riarma', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fs.rmSync(p);
  fake.fire(p);
  await sleep(50);
  assert.deepStrictEqual(seen, [{ path: p, exists: false, mtime: null }]);
  assert.strictEqual(fake.live(p).length, 0);
  w.close();
});

ok('watch: un errore del watcher non lancia e porta a un ricontrollo', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 10, watchFn: fake.watchFn });
  w.watch(p);
  fake.watchers[0].emit('error', new Error('EPERM'));
  await sleep(50);
  assert.strictEqual(seen.length, 1);
  w.close();
});

ok('watch: un file che non c\'è non arma niente e non lancia', (t) => {
  const p = path.join(path.dirname(tmpFile(t)), 'manca.txt');
  const w = createEditorWatch({ onChange: () => {}, watchFn: fakeWatch().watchFn });
  assert.strictEqual(w.watch(p), false);
  w.close();
});

ok('unwatch: conta i riferimenti', (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const w = createEditorWatch({ onChange: () => {}, watchFn: fake.watchFn });
  w.watch(p); w.watch(p);
  w.unwatch(p);
  assert.strictEqual(fake.live(p).length, 1);
  w.unwatch(p);
  assert.strictEqual(fake.live(p).length, 0);
  assert.strictEqual(w.size(), 0);
});

ok('close: ferma i watcher e le notifiche in attesa', async (t) => {
  const p = tmpFile(t);
  const fake = fakeWatch();
  const seen = [];
  const w = createEditorWatch({ onChange: (c) => seen.push(c), debounceMs: 20, watchFn: fake.watchFn });
  w.watch(p);
  fake.fire(p);
  w.close();
  await sleep(60);
  assert.deepStrictEqual(seen, []);
  assert.strictEqual(fake.live(p).length, 0);
});
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/editor-watch.test.js`
Atteso: FAIL, `Cannot find module '../lib/editor-watch'`.

- [ ] **Passo 3: implementazione** — `lib/editor-watch.js`

```js
'use strict';
/* Cambi sul disco dei file aperti nella sessione editor (docs/plans/60).
 * Un fs.watch per file, eventi raggruppati (un salvataggio di un altro
 * editor ne produce diversi). Dopo ogni evento il watcher si riarma: chi
 * salva scrivendo un temporaneo e rinominandolo (anche lib/editor-fs.js)
 * sostituisce l'inode, e il vecchio watcher resterebbe muto.
 * Un watcher che fallisce non fa cadere niente: il renderer ricontrolla i
 * file quando la scheda torna in primo piano. */
const fs = require('fs');

/**
 * @param {{onChange: (c: {path: string, exists: boolean, mtime: number|null}) => void,
 *   debounceMs?: number, watchFn?: typeof fs.watch}} o
 */
function createEditorWatch({ onChange, debounceMs = 150, watchFn = fs.watch } = {}) {
  const entries = new Map(); // percorso assoluto → { count, watcher, timer }

  function disarm(entry) {
    if (!entry.watcher) return;
    try { entry.watcher.close(); } catch (e) { console.warn('[editor-watch] chiusura fallita:', e.message); }
    entry.watcher = null;
  }

  function arm(abs, entry) {
    try {
      const w = watchFn(abs, () => schedule(abs));
      w.on('error', () => { disarm(entry); schedule(abs); });
      entry.watcher = w;
    } catch {
      // file sparito o non sorvegliabile: lo copre il ricontrollo in primo piano
      entry.watcher = null;
    }
  }

  function schedule(abs) {
    const entry = entries.get(abs);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { notify(abs, entry); }, debounceMs);
  }

  async function notify(abs, entry) {
    entry.timer = null;
    disarm(entry);
    const info = await fs.promises.stat(abs).catch(() => null);
    if (entries.get(abs) !== entry) return; // tolto nel frattempo
    if (info) arm(abs, entry);
    try {
      onChange({ path: abs, exists: Boolean(info), mtime: info ? info.mtimeMs : null });
    } catch (e) {
      console.error('[editor-watch] onChange:', e);
    }
  }

  function watch(abs) {
    const entry = entries.get(abs);
    if (entry) {
      entry.count += 1;
      if (!entry.watcher) arm(abs, entry);
      return Boolean(entry.watcher);
    }
    const created = { count: 1, watcher: null, timer: null };
    entries.set(abs, created);
    arm(abs, created);
    return Boolean(created.watcher);
  }

  function unwatch(abs) {
    const entry = entries.get(abs);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    clearTimeout(entry.timer);
    disarm(entry);
    entries.delete(abs);
  }

  function close() {
    for (const entry of entries.values()) {
      clearTimeout(entry.timer);
      disarm(entry);
    }
    entries.clear();
  }

  return { watch, unwatch, close, size: () => entries.size };
}

module.exports = { createEditorWatch };
```

- [ ] **Passo 4: verifica**

Run: `node --test tests/editor-watch.test.js`
Atteso: PASS.

- [ ] **Passo 5: commit** — insieme al Task 4 (commit 3 del piano: «lib/editor-watch e lib/editor-sessions»). Nessun commit qui.

---

### Task 4: `lib/editor-sessions.js`

**File:**
- Crea: `lib/editor-sessions.js`
- Test: `tests/editor-sessions.test.js`

**Interfacce consumate:** `safeRel` (Task 1).

**Interfacce prodotte:**
- `createEditorSessionsStore({ dir, now = Date.now }) → { file, read(), readState() → {sessions, savedAt}, write(list) → sessions }`
- sessione: `{ name: string|null, cwd: string, files: string[], active: string|null, startedAt: number|null }`
- `sanitizeEditorSessions(list)`, `EDITOR_SESSIONS_FILE = 'editor-sessions.json'`,
  `MAX_SESSIONS = 50`, `MAX_FILES = 30`.

- [ ] **Passo 1: test che fallisce** — `tests/editor-sessions.test.js`

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorSessionsStore, sanitizeEditorSessions, EDITOR_SESSIONS_FILE, MAX_SESSIONS, MAX_FILES } = require('../lib/editor-sessions');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edsess-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

ok('store: andata e ritorno, con savedAt', (t) => {
  const dir = tmp(t);
  const store = createEditorSessionsStore({ dir, now: () => 1234 });
  const list = [{ name: null, cwd: '/home/u/prj', files: ['src/a.js', 'README.md'], active: 'README.md', startedAt: 10 }];
  assert.deepStrictEqual(store.write(list), list);
  assert.deepStrictEqual(store.readState(), { sessions: list, savedAt: 1234 });
  assert.strictEqual(store.file, path.join(dir, EDITOR_SESSIONS_FILE));
});

ok('store: file mancante o corrotto = nessuna sessione', (t) => {
  const dir = tmp(t);
  const store = createEditorSessionsStore({ dir });
  assert.deepStrictEqual(store.readState(), { sessions: [], savedAt: null });
  fs.writeFileSync(store.file, '{ rotto');
  assert.deepStrictEqual(store.readState(), { sessions: [], savedAt: null });
});

ok('sanitize: cwd relative o sporche e file che escono si scartano', () => {
  const out = sanitizeEditorSessions([
    { cwd: 'relativa', files: [] },
    { cwd: '/ok\x00', files: [] },
    { cwd: ' /home/u/prj ', name: 'x'.repeat(41), files: ['../etc/passwd', 'a.js', 'a.js', './b.js', '/abs'], active: '../etc/passwd' },
    { cwd: 'C:\\prj', name: ' Mio ', files: 'non-lista', active: 'x' },
    null,
  ]);
  assert.deepStrictEqual(out, [
    { name: null, cwd: '/home/u/prj', files: ['a.js', 'b.js'], active: 'a.js', startedAt: null },
    { name: 'Mio', cwd: 'C:\\prj', files: [], active: null, startedAt: null },
  ]);
});

ok('sanitize: limiti su sessioni e file', () => {
  const files = Array.from({ length: MAX_FILES + 5 }, (_, i) => `f${i}.js`);
  const many = Array.from({ length: MAX_SESSIONS + 5 }, () => ({ cwd: '/p', files }));
  const out = sanitizeEditorSessions(many);
  assert.strictEqual(out.length, MAX_SESSIONS);
  assert.strictEqual(out[0].files.length, MAX_FILES);
  assert.deepStrictEqual(sanitizeEditorSessions('no'), []);
});
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/editor-sessions.test.js`
Atteso: FAIL, `Cannot find module '../lib/editor-sessions'`.

- [ ] **Passo 3: implementazione** — `lib/editor-sessions.js`

```js
'use strict';
/* Schede editor aperte, da riaprire al prossimo avvio (docs/plans/60).
 * Come lib/git-sessions.js: la lista la scrive per intero il renderer a ogni
 * cambio, qui si sanifica (è un file che chiunque può toccare) e si ricorda
 * quando è stata scritta, per savedBeforeBoot. Le modifiche non salvate non
 * ci sono: solo quali file erano aperti. */
const fs = require('fs');
const path = require('path');
const { safeRel } = require('./editor-paths');

const EDITOR_SESSIONS_FILE = 'editor-sessions.json';
const MAX_SESSIONS = 50;
const MAX_FILES = 30;
const MAX_CWD = 4096;
const MAX_NAME = 40;
const CONTROL = /[\x00-\x1f\x7f]/;

function cleanCwd(value) {
  if (typeof value !== 'string') return null;
  const cwd = value.trim();
  if (!cwd || cwd.length > MAX_CWD || CONTROL.test(cwd)) return null;
  return path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd) ? cwd : null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_NAME && !CONTROL.test(name) ? name : null;
}

function cleanFiles(value) {
  const out = [];
  for (const f of Array.isArray(value) ? value : []) {
    const rel = safeRel(f);
    if (rel && !out.includes(rel)) out.push(rel);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * @returns {{name: string|null, cwd: string, files: string[], active: string|null, startedAt: number|null}[]}
 */
function sanitizeEditorSessions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const cwd = cleanCwd(s.cwd);
    if (!cwd) continue;
    const files = cleanFiles(s.files);
    const wanted = safeRel(s.active);
    out.push({
      name: cleanName(s.name),
      cwd,
      files,
      active: files.includes(wanted) ? wanted : (files[0] || null),
      startedAt: Number.isFinite(s.startedAt) ? s.startedAt : null,
    });
    if (out.length >= MAX_SESSIONS) break;
  }
  return out;
}

function createEditorSessionsStore({ dir, now = Date.now } = {}) {
  if (!dir) throw new Error('createEditorSessionsStore richiede una directory');
  const file = path.join(dir, EDITOR_SESSIONS_FILE);

  /** @returns {{sessions: object[], savedAt: number|null}} */
  function readState() {
    try {
      if (!fs.existsSync(file)) return { sessions: [], savedAt: null };
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const savedAt = data && Number.isFinite(data.savedAt) ? data.savedAt : null;
      return { sessions: sanitizeEditorSessions(data && data.sessions), savedAt };
    } catch (e) {
      // file corrotto: si riparte senza schede editor, non un crash all'avvio
      console.warn('editor-sessions: file illeggibile, si riparte vuoti:', e.message || e);
      return { sessions: [], savedAt: null };
    }
  }

  function write(list) {
    const sessions = sanitizeEditorSessions(list);
    try {
      fs.writeFileSync(file, JSON.stringify({ savedAt: now(), sessions }, null, 2));
    } catch (e) {
      console.error('editor-sessions: scrittura fallita:', e.message || e);
    }
    return sessions;
  }

  return { file, read: () => readState().sessions, readState, write };
}

module.exports = { createEditorSessionsStore, sanitizeEditorSessions, EDITOR_SESSIONS_FILE, MAX_SESSIONS, MAX_FILES };
```

- [ ] **Passo 4: verifica**

Run: `node --test tests/editor-sessions.test.js tests/editor-watch.test.js`
Atteso: PASS.

- [ ] **Passo 5: commit**

```bash
git add lib/editor-watch.js lib/editor-sessions.js tests/editor-watch.test.js tests/editor-sessions.test.js
cat > /tmp/msg.txt <<'EOF'
feat: lib/editor-watch e lib/editor-sessions

editor-watch avvisa quando un file aperto nell'editor cambia sul disco:
fs.watch per file, eventi raggruppati, watcher riarmato dopo ogni evento
perché i salvataggi atomici sostituiscono l'inode.

editor-sessions ricorda le schede editor e i file aperti fra un avvio e
l'altro, come git-sessions per le schede git; i percorsi letti dal file
passano da safeRel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 5: canali IPC — `app/editor.js`, `app/editor-close.js`, `main.js`, `preload.js`

**File:**
- Crea: `app/editor.js`, `app/editor-close.js`
- Modifica: `main.js` (require in testa, registrazione accanto a
  `registerGitHandlers`, riga ~227), `preload.js` (dopo
  `saveGitSessions`, riga ~47), `tests/unit.test.js` (limite di righe di
  `main.js`, riga ~398-400)
- Test: `tests/editor-ipc.test.js`, `tests/editor-close.test.js`

**Interfacce consumate:** `createEditorFs` (Task 2), `createEditorWatch`
(Task 3), `createEditorSessionsStore` (Task 4), `savedBeforeBoot`
(`lib/git-sessions.js`).

**Interfacce prodotte:**
- `registerEditorHandlers(ipcMain, { electron: { app, shell, BrowserWindow }, userDataDir?, trash? })`
  — `userDataDir` e `trash` di default da `electron`; i test li passano.
- `installEditorCloseGuard({ app, ipcMain, BrowserWindow })`
- `window.aisess` (preload):
  `editorList(root, rel)`, `editorRead(root, rel)`,
  `editorWrite(root, rel, text, expectedMtime, bom)`, `editorStat(root, rel)`,
  `editorCreate(root, rel)`, `editorMkdir(root, rel)`,
  `editorRename(root, rel, name)`, `editorTrash(root, rel)`,
  `editorWatch(root, rel) → {ok, path, armed}`, `editorUnwatch(root, rel)`,
  `editorSessions() → {ok, sessions, ask}`, `saveEditorSessions(sessions)`,
  `editorCloseConfirmed() → {ok, what: 'quit'|'close'|'reload'|null}`,
  `onEditorFileChanged(cb)` con `{ path, exists, mtime }`.

- [ ] **Passo 1: test che falliscono** — `tests/editor-ipc.test.js`

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { registerEditorHandlers } = require('../app/editor');

/* app/editor.js non chiede Electron: riceve ipcMain e quello che serve di
   Electron come parametri, quindi dei finti bastano. */
function setup(t) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edipc-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edroot-')));
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const trashed = [];
  const app = Object.assign(new EventEmitter(), { quit() {}, getPath: () => userData });
  registerEditorHandlers(ipcMain, {
    electron: { app, shell: {}, BrowserWindow: { fromWebContents: () => null } },
    trash: async (p) => { trashed.push(p); },
  });
  const sender = Object.assign(new EventEmitter(), { id: 7, sent: [], isDestroyed: () => false, send(ch, v) { this.sent.push([ch, v]); } });
  const call = (channel, payload) => handlers.get(channel)({ sender }, payload);
  return { handlers, call, root, trashed, sender };
}

ok('ipc editor: ogni canale editor del preload ha il suo handler', (t) => {
  const { handlers } = setup(t);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('(editor-[a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(invoked.length >= 13, 'il preload espone ' + invoked.length + ' canali editor');
  for (const channel of invoked) assert.ok(handlers.has(channel), `${channel} nel preload ma senza handler`);
  assert.ok(/ipcRenderer\.on\('editor-file-changed'/.test(preload), 'manca onEditorFileChanged nel preload');
});

ok('ipc editor: payload mancanti o radici inesistenti rispondono con un errore', async (t) => {
  const { handlers, call } = setup(t);
  for (const channel of ['editor-list', 'editor-read', 'editor-write', 'editor-stat', 'editor-create', 'editor-mkdir', 'editor-rename', 'editor-trash', 'editor-watch']) {
    for (const payload of [undefined, null, {}, { root: '/non/esiste/proprio', rel: 'a' }]) {
      const r = await call(channel, payload);
      assert.strictEqual(r.ok, false, `${channel} con ${JSON.stringify(payload)}`);
      assert.ok(r.error || r.reason, `${channel} senza messaggio`);
    }
  }
  assert.ok(handlers.has('editor-unwatch'));
});

ok('ipc editor: scrive, rilegge, rinomina', async (t) => {
  const { call, root } = setup(t);
  assert.deepStrictEqual(await call('editor-create', { root, rel: 'a.txt' }), { ok: true });
  const r = await call('editor-read', { root, rel: 'a.txt' });
  const w = await call('editor-write', { root, rel: 'a.txt', text: 'ciao', expectedMtime: r.mtime, bom: 'sì' });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao'); // bom solo se === true
  // expectedMtime che non è un numero vale null: il file esiste, quindi conflitto
  assert.strictEqual((await call('editor-write', { root, rel: 'a.txt', text: 'x', expectedMtime: '1' })).conflict, true);
  assert.deepStrictEqual(await call('editor-rename', { root, rel: 'a.txt', name: 'b.txt' }), { ok: true, rel: 'b.txt' });
});

ok('ipc editor: il cestino riceve solo il percorso confinato', async (t) => {
  const { call, root, trashed } = setup(t);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  assert.deepStrictEqual(await call('editor-trash', { root, rel: 'a.txt' }), { ok: true });
  assert.deepStrictEqual(trashed, [path.join(root, 'a.txt')]);
  assert.strictEqual((await call('editor-trash', { root, rel: '../x' })).ok, false);
  assert.strictEqual((await call('editor-trash', { root, rel: '' })).ok, false);
  assert.strictEqual(trashed.length, 1);
});

ok('ipc editor: watch risponde col percorso e unwatch lo toglie; fuori si rifiuta', async (t) => {
  const { call, root, sender } = setup(t);
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  const w = await call('editor-watch', { root, rel: 'a.txt' });
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.path, path.join(root, 'a.txt'));
  assert.strictEqual((await call('editor-watch', { root, rel: '../x' })).ok, false);
  assert.deepStrictEqual(await call('editor-unwatch', { root, rel: 'a.txt' }), { ok: true });
  sender.emit('destroyed'); // non deve lanciare
});

ok('ipc editor: sessioni salvate e rilette, ask dopo un riavvio', async (t) => {
  const { call } = setup(t);
  const list = [{ name: null, cwd: '/p', files: ['a.js'], active: 'a.js', startedAt: 1 }];
  assert.deepStrictEqual(await call('editor-sessions-save', { sessions: list }), { ok: true, sessions: list });
  const r = await call('editor-sessions', undefined);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.sessions, list);
  assert.strictEqual(r.ask, false); // salvato adesso: la macchina non si è riavviata
});
```

`tests/editor-close.test.js`:

```js
const { EventEmitter } = require('events');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { installEditorCloseGuard } = require('../app/editor-close');

function setup() {
  const handlers = new Map();
  const calls = [];
  const app = Object.assign(new EventEmitter(), { quit: () => calls.push('quit') });
  const webContents = Object.assign(new EventEmitter(), { id: 3, reload: () => calls.push('reload') });
  const win = Object.assign(new EventEmitter(), { webContents, close: () => calls.push('close') });
  const BrowserWindow = { fromWebContents: (wc) => (wc === webContents ? win : null) };
  installEditorCloseGuard({ app, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, BrowserWindow });
  app.emit('browser-window-created', {}, win);
  const confirm = () => handlers.get('editor-close-confirmed')({ sender: webContents });
  return { app, win, webContents, calls, confirm };
}

ok('editor-close: un\'uscita fermata dal beforeunload si rifà alla conferma', async () => {
  const { app, win, webContents, calls, confirm } = setup();
  app.emit('before-quit');
  win.emit('close');
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'quit' });
  assert.deepStrictEqual(calls, ['quit']);
});

ok('editor-close: la chiusura della finestra si rifà chiudendo la finestra', async () => {
  const { win, webContents, calls, confirm } = setup();
  win.emit('close');
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'close' });
  assert.deepStrictEqual(calls, ['close']);
});

ok('editor-close: una ricarica si rifà ricaricando', async () => {
  const { webContents, calls, confirm } = setup();
  webContents.emit('will-prevent-unload', {});
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'reload' });
  assert.deepStrictEqual(calls, ['reload']);
});

ok('editor-close: senza niente in attesa la conferma non fa nulla', async () => {
  const { calls, confirm } = setup();
  assert.deepStrictEqual(await confirm(), { ok: true, what: null });
  assert.deepStrictEqual(calls, []);
});

ok('editor-close: l\'uscita annullata non resta appesa alla ricarica successiva', async () => {
  const { app, webContents, calls, confirm } = setup();
  app.emit('before-quit');
  webContents.emit('will-prevent-unload', {}); // l'utente sceglie Annulla: nessuna conferma
  webContents.emit('will-prevent-unload', {}); // poi Ctrl+R
  assert.deepStrictEqual(await confirm(), { ok: true, what: 'reload' });
  assert.deepStrictEqual(calls, ['reload']);
});
```

- [ ] **Passo 2: verifica che falliscano**

Run: `node --test tests/editor-ipc.test.js tests/editor-close.test.js`
Atteso: FAIL, `Cannot find module '../app/editor'` e `'../app/editor-close'`.

- [ ] **Passo 3: `app/editor-close.js`**

```js
'use strict';
/* Uscita con file non salvati nella sessione editor (docs/plans/60).
 * Il renderer ha un beforeunload che, con file sporchi, annulla la chiusura
 * e chiede che fare. Electron, quando una pagina annulla, emette
 * will-prevent-unload e si ferma lì. Qui si ricorda che cosa la pagina ha
 * fermato (l'uscita dall'app, la chiusura della finestra, una ricarica) e,
 * quando il renderer conferma, si rifà quella. Non si chiama preventDefault
 * su will-prevent-unload: vorrebbe dire ignorare il beforeunload.
 * app/quit-capture.js non c'entra: cattura lo scrollback e non blocca mai. */

/**
 * @param {{app: Electron.App, ipcMain: Electron.IpcMain, BrowserWindow: typeof Electron.BrowserWindow}} o
 */
function installEditorCloseGuard({ app, ipcMain, BrowserWindow }) {
  let quitting = false;
  const closing = new Set();
  const pending = new Map(); // webContents.id → 'quit' | 'close' | 'reload'

  app.on('before-quit', () => { quitting = true; });
  app.on('browser-window-created', (_e, win) => {
    const id = win.webContents.id;
    // 'close' arriva prima del beforeunload della pagina
    win.on('close', () => closing.add(id));
    win.webContents.on('will-prevent-unload', () => {
      pending.set(id, quitting ? 'quit' : closing.has(id) ? 'close' : 'reload');
      // Fermato: se l'utente annulla, la prossima richiesta è un'altra storia
      quitting = false;
      closing.delete(id);
    });
  });

  ipcMain.handle('editor-close-confirmed', (event) => {
    const id = event.sender.id;
    const what = pending.get(id) || null;
    pending.delete(id);
    if (what === 'quit') app.quit();
    else if (what === 'close') {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.close();
    } else if (what === 'reload') event.sender.reload();
    return { ok: true, what };
  });
}

module.exports = { installEditorCloseGuard };
```

- [ ] **Passo 4: `app/editor.js`**

```js
'use strict';
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorWatch } = require('../lib/editor-watch');
const { createEditorSessionsStore } = require('../lib/editor-sessions');
const { savedBeforeBoot } = require('../lib/git-sessions');
const { installEditorCloseGuard } = require('./editor-close');

/**
 * Canali IPC della sessione editor (docs/plans/60). La logica sta in lib/;
 * qui il collegamento, per non far crescere main.js. Ogni chiamata porta la
 * cartella della sessione (`root`) e un percorso relativo: editor-fs li
 * risolve e li confina ogni volta, il renderer non è creduto sulla parola.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {{electron: {app: Electron.App, shell: Electron.Shell, BrowserWindow: typeof Electron.BrowserWindow},
 *   userDataDir?: () => string, trash?: (absPath: string) => Promise<void>}} opts
 *   `userDataDir` e `trash` si sostituiscono nei test
 */
function registerEditorHandlers(ipcMain, {
  electron,
  userDataDir = () => electron.app.getPath('userData'),
  trash = (p) => electron.shell.trashItem(p),
} = {}) {
  let store = null;
  const sessions = () => (store = store || createEditorSessionsStore({ dir: userDataDir() }));
  const files = (root) => createEditorFs({ root });
  const guard = (fn) => async (event, payload = {}) => {
    try {
      return await fn(payload || {}, event);
    } catch (e) {
      console.error('[editor]', e);
      return { ok: false, error: 'editor: ' + String((e && e.message) || e) };
    }
  };

  // Un watch per finestra: gli eventi tornano a chi li ha chiesti. Una
  // ricarica o una finestra chiusa li butta via tutti.
  const watchers = new Map(); // webContents.id → editor-watch
  function watcherFor(sender) {
    const known = watchers.get(sender.id);
    if (known) return known;
    const w = createEditorWatch({
      onChange: (change) => { if (!sender.isDestroyed()) sender.send('editor-file-changed', change); },
    });
    watchers.set(sender.id, w);
    const forget = () => {
      w.close();
      if (watchers.get(sender.id) === w) watchers.delete(sender.id);
    };
    sender.once('destroyed', forget);
    sender.once('did-start-loading', forget);
    return w;
  }

  ipcMain.handle('editor-list', guard(({ root, rel }) => files(root).list(rel)));
  ipcMain.handle('editor-read', guard(({ root, rel }) => files(root).read(rel)));
  ipcMain.handle('editor-write', guard(({ root, rel, text, expectedMtime, bom }) => files(root).write(rel, text, {
    expectedMtime: Number.isFinite(expectedMtime) ? expectedMtime : null,
    bom: bom === true,
  })));
  ipcMain.handle('editor-stat', guard(({ root, rel }) => files(root).stat(rel)));
  ipcMain.handle('editor-create', guard(({ root, rel }) => files(root).create(rel)));
  ipcMain.handle('editor-mkdir', guard(({ root, rel }) => files(root).mkdir(rel)));
  ipcMain.handle('editor-rename', guard(({ root, rel, name }) => files(root).rename(rel, name)));
  // Mai unlink: il cestino, così un errore si recupera
  ipcMain.handle('editor-trash', guard(async ({ root, rel }) => {
    const target = files(root).trashTarget(rel);
    if (!target.ok) return target;
    await trash(target.path);
    return { ok: true };
  }));
  ipcMain.handle('editor-watch', guard(({ root, rel }, event) => {
    const abs = files(root).resolveInside(rel);
    return { ok: true, path: abs, armed: watcherFor(event.sender).watch(abs) };
  }));
  ipcMain.handle('editor-unwatch', guard(({ root, rel }, event) => {
    const w = watchers.get(event.sender.id);
    if (w) w.unwatch(files(root).resolveInside(rel));
    return { ok: true };
  }));
  // Schede editor da riaprire (lib/editor-sessions.js); dopo un riavvio
  // della macchina `ask`: si propongono, non si riaprono da sole.
  ipcMain.handle('editor-sessions', guard(() => {
    const { sessions: list, savedAt } = sessions().readState();
    return { ok: true, sessions: list, ask: savedBeforeBoot(savedAt) };
  }));
  ipcMain.handle('editor-sessions-save', guard(({ sessions: list }) => ({ ok: true, sessions: sessions().write(list) })));

  installEditorCloseGuard({ app: electron.app, ipcMain, BrowserWindow: electron.BrowserWindow });
}

module.exports = { registerEditorHandlers };
```

- [ ] **Passo 5: `preload.js`** — dopo la riga di `saveGitSessions`:

```js
  // Sessione editor (docs/plans/60): `root` è la cartella della scheda, `rel`
  // un percorso relativo; il main confina tutto (lib/editor-fs.js)
  editorList: (root, rel) => ipcRenderer.invoke('editor-list', { root, rel }),
  editorRead: (root, rel) => ipcRenderer.invoke('editor-read', { root, rel }),
  editorWrite: (root, rel, text, expectedMtime, bom) => ipcRenderer.invoke('editor-write', { root, rel, text, expectedMtime, bom }),
  editorStat: (root, rel) => ipcRenderer.invoke('editor-stat', { root, rel }),
  editorCreate: (root, rel) => ipcRenderer.invoke('editor-create', { root, rel }),
  editorMkdir: (root, rel) => ipcRenderer.invoke('editor-mkdir', { root, rel }),
  editorRename: (root, rel, name) => ipcRenderer.invoke('editor-rename', { root, rel, name }),
  editorTrash: (root, rel) => ipcRenderer.invoke('editor-trash', { root, rel }),
  editorWatch: (root, rel) => ipcRenderer.invoke('editor-watch', { root, rel }),
  editorUnwatch: (root, rel) => ipcRenderer.invoke('editor-unwatch', { root, rel }),
  editorSessions: () => ipcRenderer.invoke('editor-sessions'),
  saveEditorSessions: (sessions) => ipcRenderer.invoke('editor-sessions-save', { sessions }),
  editorCloseConfirmed: () => ipcRenderer.invoke('editor-close-confirmed'),
  onEditorFileChanged: (cb) => ipcRenderer.on('editor-file-changed', (_e, v) => cb(v)),
```

- [ ] **Passo 6: `main.js`** — accanto al require di `registerGitHandlers`
(riga ~31):

```js
const { registerEditorHandlers } = require('./app/editor');
```

e dopo `registerGitHandlers(...)` (riga ~227):

```js
registerEditorHandlers(ipcMain, { electron: { app, shell, BrowserWindow } });
```

In `tests/unit.test.js`, sopra l'assert del limite (riga ~398):

```js
  // 234: altre 2 per la sessione editor (piano 60): un require e la
  // registrazione; file, watch e conferma d'uscita stanno in app/editor*.js.
  assert.ok(main.split('\n').length < 234, `main.js e a ${main.split('\n').length} righe: sta ricrescendo`);
```

(sostituisce la riga `assert.ok(... < 232 ...)`).

- [ ] **Passo 7: verifica**

Run: `node --test tests/editor-ipc.test.js tests/editor-close.test.js && npm run test:unit`
Atteso: PASS (anche `build.files` copre `app/editor*.js` via `app/**/*`).

- [ ] **Passo 8: commit**

```bash
git add app/editor.js app/editor-close.js main.js preload.js tests/editor-ipc.test.js tests/editor-close.test.js tests/unit.test.js
cat > /tmp/msg.txt <<'EOF'
feat: canali IPC della sessione editor

app/editor.js collega lib/editor-fs, editor-watch ed editor-sessions ai
canali editor-*: ogni chiamata porta la cartella della sessione e un
percorso relativo, confinati di nuovo a ogni chiamata. Eliminare passa da
shell.trashItem; gli eventi del watch tornano alla finestra che li ha
chiesti e si buttano a una ricarica.

app/editor-close.js ricorda che cosa ha fermato il beforeunload del
renderer (uscita, chiusura della finestra, ricarica) e lo rifà quando
l'utente conferma di uscire con file non salvati.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 6: `renderer/editor-files.js`

**File:**
- Crea: `renderer/editor-files.js`
- Test: `tests/editor-files.test.js`

**Interfacce prodotte** (`window.AisessEditorFiles`, tutte pure):
- stato `{ order: string[], active: string|null, files: { [rel]: { rel, path, mtime, bom, dirty, deleted, conflict: null|'disk'|'save', diskMtime, error } } }`
- `empty()`, `open(state, rel, info)`, `activate(state, rel)`,
  `close(state, rel)`, `update(state, rel, patch)`,
  `movedPath(rel, from, to) → string|null`, `affectedBy(state, from) → rel[]`,
  `renamePath(state, from, to)`, `markDeleted(state, rel)`,
  `dirtyFiles(state) → rel[]`, `toSaved(state) → { files, active }`,
  `findByPath(state, abs) → rel|null`, `joinRel(dir, name)`,
  `parentRel(rel)`, `baseName(rel)`.

- [ ] **Passo 1: test che fallisce** — `tests/editor-files.test.js`

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const F = require('../renderer/editor-files');

const three = () => ['a.js', 'src/b.js', 'src/c.js'].reduce((s, rel) => F.open(s, rel, { path: '/p/' + rel, mtime: 1 }), F.empty());

ok('open: aggiunge in coda e attiva; riaprire non duplica', () => {
  let s = three();
  assert.deepStrictEqual(s.order, ['a.js', 'src/b.js', 'src/c.js']);
  assert.strictEqual(s.active, 'src/c.js');
  assert.strictEqual(s.files['a.js'].dirty, false);
  s = F.open(s, 'a.js');
  assert.deepStrictEqual(s.order, ['a.js', 'src/b.js', 'src/c.js']);
  assert.strictEqual(s.active, 'a.js');
  assert.strictEqual(s.files['a.js'].mtime, 1);
});

ok('close: l\'attiva passa alla successiva, o alla precedente se era l\'ultima', () => {
  let s = F.activate(three(), 'src/b.js');
  s = F.close(s, 'src/b.js');
  assert.strictEqual(s.active, 'src/c.js');
  s = F.close(s, 'src/c.js');
  assert.strictEqual(s.active, 'a.js');
  s = F.close(s, 'a.js');
  assert.deepStrictEqual(s, F.empty());
  const kept = F.close(F.activate(three(), 'a.js'), 'src/c.js');
  assert.strictEqual(kept.active, 'a.js');
});

ok('update e activate ignorano i file non aperti', () => {
  const s = three();
  assert.strictEqual(F.update(s, 'manca', { dirty: true }), s);
  assert.strictEqual(F.activate(s, 'manca'), s);
});

ok('renamePath: un file, o una cartella con quello che contiene', () => {
  let s = F.activate(three(), 'src/b.js');
  s = F.renamePath(s, 'src', 'lib');
  assert.deepStrictEqual(s.order, ['a.js', 'lib/b.js', 'lib/c.js']);
  assert.strictEqual(s.active, 'lib/b.js');
  assert.strictEqual(s.files['lib/b.js'].rel, 'lib/b.js');
  assert.strictEqual(s.files['src/b.js'], undefined);
  s = F.renamePath(s, 'a.js', 'z.js');
  assert.deepStrictEqual(s.order, ['z.js', 'lib/b.js', 'lib/c.js']);
});

ok('affectedBy e movedPath: "src" non tocca "srcx/a.js"', () => {
  const s = F.open(three(), 'srcx/a.js');
  assert.deepStrictEqual(F.affectedBy(s, 'src'), ['src/b.js', 'src/c.js']);
  assert.strictEqual(F.movedPath('srcx/a.js', 'src', 'lib'), null);
  assert.strictEqual(F.movedPath('src/b.js', 'src', 'lib'), 'lib/b.js');
});

ok('markDeleted, dirtyFiles, toSaved, findByPath', () => {
  let s = F.update(three(), 'a.js', { dirty: true });
  s = F.markDeleted(s, 'src/b.js');
  assert.deepStrictEqual({ ...s.files['src/b.js'], path: null }, { ...s.files['src/b.js'], path: null, deleted: true, mtime: null });
  assert.deepStrictEqual(F.dirtyFiles(s), ['a.js']);
  assert.deepStrictEqual(F.toSaved(s), { files: ['a.js', 'src/b.js', 'src/c.js'], active: 'src/c.js' });
  assert.strictEqual(F.findByPath(s, '/p/src/c.js'), 'src/c.js');
  assert.strictEqual(F.findByPath(s, '/altro'), null);
});

ok('i passi non toccano lo stato che ricevono', () => {
  const s = three();
  const copy = JSON.parse(JSON.stringify(s));
  F.close(F.renamePath(F.update(s, 'a.js', { dirty: true }), 'src', 'lib'), 'a.js');
  assert.deepStrictEqual(s, copy);
});

ok('joinRel, parentRel, baseName', () => {
  assert.strictEqual(F.joinRel('', 'a.js'), 'a.js');
  assert.strictEqual(F.joinRel('src', 'a.js'), 'src/a.js');
  assert.strictEqual(F.parentRel('src/x/a.js'), 'src/x');
  assert.strictEqual(F.parentRel('a.js'), '');
  assert.strictEqual(F.baseName('src/x/a.js'), 'a.js');
});
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/editor-files.test.js`
Atteso: FAIL, `Cannot find module '../renderer/editor-files'`.

- [ ] **Passo 3: implementazione** — `renderer/editor-files.js`

```js
/* Stato dei file aperti in una scheda editor (docs/plans/60): ordine delle
 * sotto-schede, quella attiva e, per ogni file, quello che serve a salvarlo
 * (mtime e BOM letti all'apertura) e a dire com'è messo (sporco, eliminato,
 * in conflitto col disco, errore). Il testo sta in Monaco (editor-monaco.js).
 * Funzioni pure: ogni passo restituisce uno stato nuovo.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorFiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const BLANK = { path: null, mtime: null, bom: false, dirty: false, deleted: false, conflict: null, diskMtime: null, error: null };

  const empty = () => ({ order: [], active: null, files: {} });

  function open(state, rel, info = {}) {
    const file = { ...BLANK, ...(state.files[rel] || {}), ...info, rel };
    const order = state.order.includes(rel) ? state.order : [...state.order, rel];
    return { order, active: rel, files: { ...state.files, [rel]: file } };
  }

  const activate = (state, rel) => (state.files[rel] ? { ...state, active: rel } : state);

  function close(state, rel) {
    const i = state.order.indexOf(rel);
    if (i < 0) return state;
    const order = state.order.filter((r) => r !== rel);
    const files = { ...state.files };
    delete files[rel];
    const active = state.active !== rel ? state.active : (order[i] || order[i - 1] || null);
    return { order, active, files };
  }

  function update(state, rel, patch) {
    if (!state.files[rel]) return state;
    return { ...state, files: { ...state.files, [rel]: { ...state.files[rel], ...patch } } };
  }

  /** Dove finisce `rel` se `from` (file o cartella) diventa `to`; null se non c'entra. */
  function movedPath(rel, from, to) {
    if (rel === from) return to;
    if (rel.startsWith(from + '/')) return to + rel.slice(from.length);
    return null;
  }

  const affectedBy = (state, from) => state.order.filter((r) => movedPath(r, from, from) !== null);

  function renamePath(state, from, to) {
    const map = (r) => movedPath(r, from, to) || r;
    const files = {};
    for (const r of state.order) files[map(r)] = { ...state.files[r], rel: map(r) };
    return { order: state.order.map(map), active: state.active && map(state.active), files };
  }

  /* Eliminato dal disco: il contenuto resta in Monaco, salvare lo ricrea
     (mtime null = «il file non deve esistere» per lib/editor-fs.js) */
  const markDeleted = (state, rel) => update(state, rel, { deleted: true, mtime: null, conflict: null, diskMtime: null });

  const dirtyFiles = (state) => state.order.filter((r) => state.files[r].dirty);
  const toSaved = (state) => ({ files: [...state.order], active: state.active });
  const findByPath = (state, abs) => state.order.find((r) => state.files[r].path === abs) || null;
  const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
  const parentRel = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
  const baseName = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

  return { empty, open, activate, close, update, movedPath, affectedBy, renamePath, markDeleted, dirtyFiles, toSaved, findByPath, joinRel, parentRel, baseName };
});
```

- [ ] **Passo 4: verifica**

Run: `node --test tests/editor-files.test.js`
Atteso: PASS.

- [ ] **Passo 5:** nessun commit: va con il commit del renderer (Task 9).

---

### Task 7: `renderer/editor-tree.js`

**File:**
- Crea: `renderer/editor-tree.js`
- Test: `tests/editor-tree.test.js`

**Interfacce prodotte** (`window.AisessEditorTree`):
- modello: `emptyTree() → { children: { [dirRel]: entry[] }, expanded: dirRel[], selected: rel|null }`,
  `setChildren(tree, dir, entries)`, `isExpanded(tree, dir)`,
  `toggle(tree, dir)`, `select(tree, rel)`, `renamePath(tree, from, to)`,
  `removePath(tree, rel)`, `visibleRows(tree) → { rel, name, kind, ignored, depth, expanded }[]`
- vista: `createTreeView({ root, document, onOpenFile(rel), onToggleDir(rel), onContextMenu(row|null, event) }) → { element, render(rows, selected), rowOf(rel) }`
- `promptName({ document, host, after, depth, initial }) → Promise<string|null>`
- `showMenu({ document, x, y, items: {label, danger?, run}[] }) → { element, close }`

- [ ] **Passo 1: test che fallisce** — `tests/editor-tree.test.js`

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, installDocument, fire } = require('./fake-dom');
const T = require('../renderer/editor-tree');

const entries = (...names) => names.map((n) => (n.endsWith('/') ? { name: n.slice(0, -1), kind: 'dir', ignored: false } : { name: n, kind: 'file', ignored: n.endsWith('.log') }));

function sample() {
  let tree = T.setChildren(T.emptyTree(), '', entries('src/', 'a.log', 'b.js'));
  tree = T.setChildren(tree, 'src', entries('lib/', 'x.js'));
  tree = T.setChildren(tree, 'src/lib', entries('y.js'));
  return tree;
}

ok('visibleRows: solo le cartelle aperte mostrano i figli, con la profondità', () => {
  let tree = sample();
  assert.deepStrictEqual(T.visibleRows(tree).map((r) => r.rel), ['src', 'a.log', 'b.js']);
  tree = T.toggle(tree, 'src');
  tree = T.toggle(tree, 'src/lib');
  const rows = T.visibleRows(tree);
  assert.deepStrictEqual(rows.map((r) => `${r.depth}:${r.rel}`), ['0:src', '1:src/lib', '2:src/lib/y.js', '1:src/x.js', '0:a.log', '0:b.js']);
  assert.strictEqual(rows[0].expanded, true);
  assert.strictEqual(rows[4].ignored, true);
  assert.strictEqual(T.visibleRows(T.toggle(tree, 'src')).length, 3);
});

ok('renamePath e removePath spostano o dimenticano un ramo', () => {
  let tree = T.select(T.toggle(T.toggle(sample(), 'src'), 'src/lib'), 'src/lib/y.js');
  const moved = T.renamePath(tree, 'src', 'core');
  assert.deepStrictEqual(moved.expanded.sort(), ['core', 'core/lib']);
  assert.ok(moved.children['core/lib']);
  assert.strictEqual(moved.children['src/lib'], undefined);
  assert.strictEqual(moved.selected, 'core/lib/y.js');
  const gone = T.removePath(tree, 'src');
  assert.deepStrictEqual(gone.expanded, []);
  assert.strictEqual(gone.children.src, undefined);
  assert.strictEqual(gone.selected, null);
  assert.ok(gone.children['']);
});

ok('vista: nomi come testo, classi per cartelle, ignorati e selezione', () => {
  const restore = installDocument();
  try {
    const root = createElement('div');
    const calls = [];
    const view = T.createTreeView({ root, document,
      onOpenFile: (rel) => calls.push(['open', rel]),
      onToggleDir: (rel) => calls.push(['toggle', rel]),
      onContextMenu: (row) => calls.push(['menu', row && row.rel]) });
    const tree = T.setChildren(T.emptyTree(), '', [{ name: '<img src=x onerror=alert(1)>', kind: 'file', ignored: false }, ...entries('src/', 'a.log')]);
    view.render(T.visibleRows(tree), 'a.log');
    const rows = view.element.children;
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.strictEqual(rows[0].innerHTML, '');
    assert.ok(rows[1].classList.contains('is-dir'));
    assert.ok(rows[2].classList.contains('is-ignored'));
    assert.ok(rows[2].classList.contains('is-selected'));
    fire(rows[1], 'click');
    fire(rows[2], 'click');
    fire(rows[2], 'contextmenu', { clientX: 1, clientY: 2 });
    fire(view.element, 'contextmenu', {});
    assert.deepStrictEqual(calls, [['toggle', 'src'], ['open', 'a.log'], ['menu', 'a.log'], ['menu', null]]);
    assert.strictEqual(view.rowOf('src'), rows[1]);
  } finally { restore(); }
});

ok('promptName: Invio dà il nome ripulito, Esc e blur null', async () => {
  const restore = installDocument();
  try {
    const host = createElement('div');
    const first = T.promptName({ document, host, initial: 'a.js' });
    const input = host.children[0];
    assert.strictEqual(input.value, 'a.js');
    input.value = '  nuovo.js ';
    fire(input, 'keydown', { key: 'Enter' });
    assert.strictEqual(await first, 'nuovo.js');
    assert.strictEqual(host.children.length, 0);

    const esc = T.promptName({ document, host });
    fire(host.children[0], 'keydown', { key: 'Escape' });
    assert.strictEqual(await esc, null);

    const blur = T.promptName({ document, host });
    fire(host.children[0], 'blur');
    assert.strictEqual(await blur, null);

    const blank = T.promptName({ document, host });
    host.children[0].value = '   ';
    fire(host.children[0], 'keydown', { key: 'Enter' });
    assert.strictEqual(await blank, null);
  } finally { restore(); }
});

ok('showMenu: una voce esegue e chiude, Esc chiude', () => {
  const restore = installDocument();
  try {
    let ran = 0;
    const menu = T.showMenu({ document, x: 10, y: 20, items: [{ label: 'Elimina', danger: true, run: () => { ran += 1; } }] });
    assert.strictEqual(document.body.children.includes(menu.element), true);
    assert.ok(menu.element.children[0].classList.contains('is-danger'));
    fire(menu.element.children[0], 'click');
    assert.strictEqual(ran, 1);
    assert.strictEqual(document.body.children.includes(menu.element), false);
    const other = T.showMenu({ document, x: 0, y: 0, items: [{ label: 'x', run: () => {} }] });
    fire(document, 'keydown', { key: 'Escape' });
    assert.strictEqual(document.body.children.includes(other.element), false);
  } finally { restore(); }
});
```

- [ ] **Passo 2: verifica che fallisca**

Run: `node --test tests/editor-tree.test.js`
Atteso: FAIL, `Cannot find module '../renderer/editor-tree'`.

- [ ] **Passo 3: implementazione** — `renderer/editor-tree.js`

```js
/* Albero dei file della scheda editor (docs/plans/60). Il modello è puro:
 * figli letti per cartella (lazy, `''` è la radice), cartelle aperte,
 * selezione. La vista lo disegna con textContent (i nomi dei file arrivano
 * dal disco) e passa i click a chi la usa (editor-tab.js). Qui anche
 * l'input inline per i nomi e il menu contestuale.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorTree = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const INDENT = 12;
  const PAD = 8;

  const emptyTree = () => ({ children: {}, expanded: [], selected: null });
  const setChildren = (tree, dir, entries) => ({ ...tree, children: { ...tree.children, [dir]: entries } });
  const isExpanded = (tree, dir) => tree.expanded.includes(dir);
  const toggle = (tree, dir) => ({
    ...tree,
    expanded: isExpanded(tree, dir) ? tree.expanded.filter((d) => d !== dir) : [...tree.expanded, dir],
  });
  const select = (tree, rel) => ({ ...tree, selected: rel });

  const under = (rel, base) => rel === base || rel.startsWith(base + '/');
  const moved = (rel, from, to) => (under(rel, from) ? to + rel.slice(from.length) : rel);

  function renamePath(tree, from, to) {
    const children = {};
    for (const [dir, list] of Object.entries(tree.children)) children[moved(dir, from, to)] = list;
    return {
      children,
      expanded: tree.expanded.map((d) => moved(d, from, to)),
      selected: tree.selected === null ? null : moved(tree.selected, from, to),
    };
  }

  function removePath(tree, rel) {
    const children = {};
    for (const [dir, list] of Object.entries(tree.children)) if (!under(dir, rel)) children[dir] = list;
    return {
      children,
      expanded: tree.expanded.filter((d) => !under(d, rel)),
      selected: tree.selected !== null && under(tree.selected, rel) ? null : tree.selected,
    };
  }

  function visibleRows(tree) {
    const rows = [];
    const walk = (dir, depth) => {
      for (const e of tree.children[dir] || []) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        const expanded = e.kind === 'dir' && isExpanded(tree, rel);
        rows.push({ rel, name: e.name, kind: e.kind, ignored: Boolean(e.ignored), depth, expanded });
        if (expanded) walk(rel, depth + 1);
      }
    };
    walk('', 0);
    return rows;
  }

  function createTreeView({ root, document: doc, onOpenFile, onToggleDir, onContextMenu }) {
    const list = doc.createElement('div');
    list.className = 'editor-tree';
    list.setAttribute('role', 'tree');
    // Click destro sul vuoto: le voci per creare nella radice
    list.oncontextmenu = (e) => { e.preventDefault(); onContextMenu(null, e); };
    root.appendChild(list);

    function rowElement(r, selected) {
      const el = doc.createElement('div');
      el.className = 'editor-tree-row'
        + (r.kind === 'dir' ? ' is-dir' : '')
        + (r.expanded ? ' is-open' : '')
        + (r.ignored ? ' is-ignored' : '')
        + (r.rel === selected ? ' is-selected' : '');
      el.dataset.rel = r.rel;
      el.setAttribute('role', 'treeitem');
      el.style.paddingLeft = `${PAD + r.depth * INDENT}px`;
      const twisty = doc.createElement('span');
      twisty.className = 'editor-tree-twisty';
      twisty.textContent = r.kind === 'dir' ? (r.expanded ? '▾' : '▸') : '';
      const name = doc.createElement('span');
      name.className = 'editor-tree-name';
      name.textContent = r.name; // testo, mai HTML: il nome viene dal disco
      el.append(twisty, name);
      el.onclick = () => (r.kind === 'dir' ? onToggleDir(r.rel) : onOpenFile(r.rel));
      el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(r, e); };
      return el;
    }

    return {
      element: list,
      render(rows, selected) { list.replaceChildren(...rows.map((r) => rowElement(r, selected))); },
      rowOf(rel) { return [...list.children].find((c) => c.dataset.rel === rel) || null; },
    };
  }

  /**
   * Input inline per un nome (nuovo file o cartella, rinomina), sotto la riga
   * `after` o in cima all'albero.
   * @returns {Promise<string|null>} il nome scritto; null con Esc, blur o vuoto
   */
  function promptName({ document: doc, host, after = null, depth = 0, initial = '' }) {
    return new Promise((resolve) => {
      const input = doc.createElement('input');
      input.className = 'editor-tree-input';
      input.value = initial;
      input.style.marginLeft = `${PAD + depth * INDENT}px`;
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(value);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // le scorciatoie dell'app non devono vedere i tasti del nome
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      });
      input.addEventListener('blur', () => finish(null));
      const before = after ? after.nextElementSibling : host.children[0] || null;
      host.insertBefore(input, before);
      input.focus();
      // Rinomina: selezionato il nome senza estensione, come nei file manager
      if (initial && typeof input.setSelectionRange === 'function') {
        const dot = initial.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : initial.length);
      }
    });
  }

  /** Menu contestuale: si chiude su una scelta, su Esc e sul click fuori. */
  function showMenu({ document: doc, x, y, items }) {
    const menu = doc.createElement('div');
    menu.className = 'editor-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const inside = (node) => { for (let n = node; n; n = n.parentNode) if (n === menu) return true; return false; };
    const onDown = (e) => { if (!inside(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    function close() {
      menu.remove();
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    }
    for (const item of items) {
      const b = doc.createElement('button');
      b.className = 'editor-menu-item' + (item.danger ? ' is-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.onclick = () => { close(); item.run(); };
      menu.appendChild(b);
    }
    doc.body.appendChild(menu);
    doc.addEventListener('mousedown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return { element: menu, close };
  }

  return { emptyTree, setChildren, isExpanded, toggle, select, renamePath, removePath, visibleRows, createTreeView, promptName, showMenu };
});
```

- [ ] **Passo 4: verifica**

Run: `node --test tests/editor-tree.test.js`
Atteso: PASS.

- [ ] **Passo 5:** nessun commit: va con il commit del renderer (Task 9).

---

### Task 8: Monaco — dipendenza, CSP, pacchetto, `renderer/editor-monaco.js`

**File:**
- Modifica: `package.json` (`dependencies`, `build.files`),
  `renderer/index.html` (CSP e commento), `THIRD-PARTY-NOTICES.md`
- Crea: `renderer/editor-monaco.js`
- Test: `tests/editor-monaco.test.js`, `tests/unit.test.js` (esclusioni)

**Interfacce prodotte** (`window.AisessEditorMonaco`):
- `load(win) → Promise<monaco>` (una volta; un fallimento si ritenta)
- `createEditorHost({ monaco, container, fontSize, onChange(rel, dirty), onSave(rel), onSaveAll() }) →`
  `{ open(rel, text), activate(rel), current(), getText(rel), isDirty(rel), markSaved(rel), replaceText(rel, text), rename(from, to), close(rel), dispose(), focus() }`

- [ ] **Passo 1: dipendenza**

```bash
npm install monaco-editor@0.57.0 --save-exact
grep '"monaco-editor"' package.json   # atteso: "monaco-editor": "0.57.0"
ls node_modules/monaco-editor/min/vs/loader.js node_modules/monaco-editor/min/vs/editor/editor.main.js
ls node_modules/monaco-editor
```

Annotare le cartelle di primo livello di `node_modules/monaco-editor`
(servono al passo 2). Se `min/vs/loader.js` non c'è, **fermarsi**: la 0.57.0
non ha più il build AMD e il piano va rivisto (dirlo all'utente).

- [ ] **Passo 2: test delle esclusioni che fallisce** — in coda a
`tests/unit.test.js`:

```js
ok('build: di monaco-editor nel pacchetto resta solo min/, senza mappe (piano 60)', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.dependencies['monaco-editor'], '0.57.0', 'monaco-editor va bloccato a 0.57.0 esatta');
  const files = pkg.build.files;
  const dir = path.join(root, 'node_modules', 'monaco-editor');
  if (!fs.existsSync(dir)) return; // senza node_modules si controlla solo la versione
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'min') continue;
    assert.ok(files.includes(`!node_modules/monaco-editor/${entry.name}/**`), `manca l'esclusione di monaco-editor/${entry.name}`);
  }
  assert.ok(files.includes('!node_modules/monaco-editor/**/*.map'), 'mancano le mappe fra le esclusioni');
  assert.ok(!files.some((f) => f.startsWith('!node_modules/monaco-editor/min')), 'min/ non va escluso');
});
```

Run: `node --test tests/unit.test.js`
Atteso: FAIL, «manca l'esclusione di monaco-editor/…».

- [ ] **Passo 3: esclusioni** — in `package.json`, `build.files`, dopo
`"THIRD-PARTY-NOTICES.md"`: una riga `"!node_modules/monaco-editor/<cartella>/**"`
per **ogni** cartella di primo livello annotata al passo 1 tranne `min`
(per esempio `esm`, `dev`, `min-maps`, se ci sono), più:

```json
      "!node_modules/monaco-editor/**/*.map",
```

Run: `node --test tests/unit.test.js`
Atteso: PASS.

- [ ] **Passo 4: CSP** — in `renderer/index.html`, nel commento sopra la
policy aggiungere:

```
  - worker-src 'self' blob:     i web worker di Monaco (sessione editor,
                                docs/plans/60): il loader li crea da blob:
```

e nella policy, dopo `script-src 'self';`:

```
  worker-src 'self' blob:;
```

`script-src` resta `'self'`. Se allo smoke (passo 9) la console dice che
serve altro, si allarga il minimo e si scrive perché nel commento.

- [ ] **Passo 5: licenza** — in `THIRD-PARTY-NOTICES.md` una voce come le
altre: `monaco-editor` 0.57.0, © Microsoft Corporation, licenza MIT,
<https://github.com/microsoft/monaco-editor>; copiare il testo da
`node_modules/monaco-editor/LICENSE`. Se c'è
`node_modules/monaco-editor/ThirdPartyNotices.txt`, riportare che le
licenze dei componenti inclusi stanno lì e aggiungere il file a
`build.files` (`"node_modules/monaco-editor/ThirdPartyNotices.txt"` è già
incluso: non è in una cartella esclusa, verificarlo).

- [ ] **Passo 6: test dell'host che fallisce** — `tests/editor-monaco.test.js`

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorHost } = require('../renderer/editor-monaco');

/* Monaco non gira sotto Node: un finto con le sole cose che l'host usa
   (model con versione, editor con view state e comandi). */
function fakeMonaco() {
  const models = [];
  const editor = {
    model: null, view: null, commands: [], disposed: false,
    setModel(m) { editor.model = m; },
    saveViewState: () => ({ of: editor.model && editor.model.uri.path }),
    restoreViewState(v) { editor.view = v; },
    focus() {}, updateOptions() {},
    addCommand(keys, fn) { editor.commands.push({ keys, fn }); },
    dispose() { editor.disposed = true; },
  };
  function createModel(text, _language, uri) {
    const listeners = [];
    let value = text;
    let version = 1;
    const change = () => { version += 1; listeners.forEach((f) => f()); };
    const m = {
      uri, disposed: false, eol: null,
      getValue: () => value,
      getAlternativeVersionId: () => version,
      getFullModelRange: () => ({ all: true }),
      pushEditOperations: (_sel, ops) => { value = ops[0].text; change(); },
      pushEOL: (eol) => { m.eol = eol; },
      onDidChangeContent: (f) => { listeners.push(f); return { dispose: () => listeners.splice(listeners.indexOf(f), 1) }; },
      dispose: () => { m.disposed = true; },
      type: (s) => { value += s; change(); }, // solo per il test: l'utente che scrive
    };
    models.push(m);
    return m;
  }
  const monaco = {
    editor: { create: () => editor, createModel, EndOfLineSequence: { LF: 0, CRLF: 1 } },
    Uri: { from: (o) => ({ ...o }) },
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyS: 49 },
  };
  return { monaco, editor, models };
}

function host(extra = {}) {
  const fake = fakeMonaco();
  const changes = [];
  const saved = [];
  const h = createEditorHost({ monaco: fake.monaco, container: {}, fontSize: 13,
    onChange: (rel, dirty) => changes.push([rel, dirty]), onSave: (rel) => saved.push(rel), onSaveAll: () => saved.push('*'), ...extra });
  return { h, fake, changes, saved };
}

ok('open: un model per file, URI col percorso relativo, pulito', () => {
  const { h, fake } = host();
  h.open('src/a.js', 'ciao');
  assert.strictEqual(fake.editor.model.uri.path, '/src/a.js');
  assert.strictEqual(fake.editor.model.uri.scheme, 'aisess');
  assert.strictEqual(h.isDirty('src/a.js'), false);
  assert.strictEqual(h.current(), 'src/a.js');
  h.open('src/a.js', 'altro');
  assert.strictEqual(fake.models.length, 1);
});

ok('scrivere sporca, markSaved pulisce, e lo dice a onChange', () => {
  const { h, fake, changes } = host();
  h.open('a.js', 'x');
  fake.models[0].type('y');
  assert.strictEqual(h.isDirty('a.js'), true);
  h.markSaved('a.js');
  assert.strictEqual(h.isDirty('a.js'), false);
  assert.deepStrictEqual(changes, [['a.js', true], ['a.js', false]]);
});

ok('activate: conserva e rimette cursore e scroll', () => {
  const { h, fake } = host();
  h.open('a.js', '1');
  assert.strictEqual(fake.editor.view, null); // appena aperto: niente da rimettere
  h.open('b.js', '2');
  h.activate('a.js');
  assert.strictEqual(fake.editor.model, fake.models[0]);
  assert.deepStrictEqual(fake.editor.view, { of: '/a.js' });
});

ok('replaceText: testo nuovo, pulito, a capo del file', () => {
  const { h, fake } = host();
  h.open('a.js', 'vecchio');
  h.replaceText('a.js', 'nuovo\r\n');
  assert.strictEqual(h.getText('a.js'), 'nuovo\r\n');
  assert.strictEqual(h.isDirty('a.js'), false);
  assert.strictEqual(fake.models[0].eol, 1);
});

ok('rename: model nuovo col nome nuovo, sporco se lo era, vecchio buttato', () => {
  const { h, fake } = host();
  h.open('a.js', 'x');
  fake.models[0].type('y');
  h.rename('a.js', 'lib/b.ts');
  assert.strictEqual(fake.models[0].disposed, true);
  assert.strictEqual(fake.editor.model.uri.path, '/lib/b.ts');
  assert.strictEqual(h.getText('lib/b.ts'), 'xy');
  assert.strictEqual(h.isDirty('lib/b.ts'), true);
  assert.strictEqual(h.getText('a.js'), null);
  assert.strictEqual(h.current(), 'lib/b.ts');
});

ok('close e dispose buttano i model', () => {
  const { h, fake } = host();
  h.open('a.js', 'x');
  h.open('b.js', 'y');
  h.close('b.js');
  assert.strictEqual(fake.models[1].disposed, true);
  assert.strictEqual(fake.editor.model, null);
  h.dispose();
  assert.strictEqual(fake.models[0].disposed, true);
  assert.strictEqual(fake.editor.disposed, true);
});

ok('Ctrl+S salva il file attivo, Ctrl+Shift+S tutti; due host non si pestano gli URI', () => {
  const { h, fake, saved } = host();
  h.open('a.js', 'x');
  for (const c of fake.editor.commands) c.fn();
  assert.deepStrictEqual(saved, ['a.js', '*']);
  const other = host();
  other.h.open('a.js', 'x');
  assert.notStrictEqual(other.fake.models[0].uri.authority, fake.models[0].uri.authority);
});
```

Run: `node --test tests/editor-monaco.test.js`
Atteso: FAIL, `Cannot find module '../renderer/editor-monaco'`.

- [ ] **Passo 7: implementazione** — `renderer/editor-monaco.js`

```js
/* L'unico modulo che conosce Monaco (docs/plans/60). Lo carica una volta,
 * col suo loader AMD, alla prima scheda editor che apre un file; a ogni
 * scheda dà un «host»: un editor Monaco e un model per file aperto, chiesti
 * per percorso relativo. Il resto del renderer non tocca Monaco: il motore
 * resta sostituibile.
 * Monaco è bloccato a 0.57.0 (package.json): il loader AMD è deprecato, un
 * aggiornamento è un lavoro a sé (docs/plans/60, «Motore: Monaco»).
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorMonaco = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const BASE = '../node_modules/monaco-editor/min/vs';
  const THEME = 'aisess';
  const FONT = "'IBM Plex Mono', JetBrains Mono, Menlo, Consolas, monospace";
  let loading = null;
  let hosts = 0;

  function cssColor(win, name, fallback) {
    const v = win.getComputedStyle(win.document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  }

  function defineTheme(win, monaco) {
    const bg = cssColor(win, '--bg', '#070505');
    monaco.editor.defineTheme(THEME, {
      base: 'vs-dark', inherit: true, rules: [],
      colors: {
        'editor.background': bg,
        'editorGutter.background': bg,
        'editor.lineHighlightBackground': cssColor(win, '--surface-2', '#151010'),
        'editorWidget.background': cssColor(win, '--surface', '#0E0B0A'),
      },
    });
  }

  /** Carica Monaco una volta. Se fallisce, la prossima chiamata ritenta. */
  function load(win) {
    if (win.monaco && win.monaco.editor) return Promise.resolve(win.monaco);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const doc = win.document;
      const script = doc.createElement('script');
      script.src = `${BASE}/loader.js`;
      script.onerror = () => reject(new Error(`loader di Monaco non trovato (${script.src})`));
      script.onload = () => {
        win.require.config({ paths: { vs: BASE } });
        win.require(['vs/editor/editor.main'], () => {
          defineTheme(win, win.monaco);
          resolve(win.monaco);
        }, (e) => reject(e instanceof Error ? e : new Error(String(e))));
      };
      doc.head.appendChild(script);
    }).catch((e) => { loading = null; throw e; });
    return loading;
  }

  /**
   * @param {{monaco: object, container: Element, fontSize: number,
   *   onChange: (rel: string, dirty: boolean) => void,
   *   onSave: (rel: string|null) => void, onSaveAll: () => void}} o
   */
  function createEditorHost({ monaco, container, fontSize, onChange, onSave, onSaveAll }) {
    // Autorità diversa per host: due schede sulla stessa cartella hanno model distinti
    const authority = `h${++hosts}`;
    const docs = new Map(); // rel → { rel, model, savedVersion, viewState, forcedDirty, sub }
    let current = null;
    const editor = monaco.editor.create(container, {
      model: null, theme: THEME, automaticLayout: true, fontSize, fontFamily: FONT,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderWhitespace: 'selection',
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave(current));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => onSaveAll());

    const uriOf = (rel) => monaco.Uri.from({ scheme: 'aisess', authority, path: `/${rel}` });
    const dirtyOf = (d) => d.forcedDirty || d.model.getAlternativeVersionId() !== d.savedVersion;

    function track(d) {
      d.sub = d.model.onDidChangeContent(() => onChange(d.rel, dirtyOf(d)));
      docs.set(d.rel, d);
    }

    function make(rel, text, extra = {}) {
      const model = monaco.editor.createModel(text, undefined, uriOf(rel));
      track({ rel, model, savedVersion: model.getAlternativeVersionId(), viewState: null, forcedDirty: false, sub: null, ...extra });
    }

    function activate(rel) {
      const d = docs.get(rel);
      if (!d) return;
      if (current && docs.has(current) && current !== rel) docs.get(current).viewState = editor.saveViewState();
      current = rel;
      editor.setModel(d.model);
      if (d.viewState) editor.restoreViewState(d.viewState);
      editor.focus();
    }

    function open(rel, text) {
      if (!docs.has(rel)) make(rel, text);
      activate(rel);
    }

    function markSaved(rel) {
      const d = docs.get(rel);
      if (!d) return;
      d.savedVersion = d.model.getAlternativeVersionId();
      d.forcedDirty = false;
      onChange(rel, false);
    }

    /* Ricarica dal disco: nella pila dell'undo (Ctrl+Z riporta il testo di
       prima), cursore e scroll conservati, a capo presi dal file nuovo. */
    function replaceText(rel, text) {
      const d = docs.get(rel);
      if (!d) return;
      const view = current === rel ? editor.saveViewState() : null;
      const eol = /\r\n/.test(text) ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF;
      d.model.pushEOL(eol);
      d.model.pushEditOperations([], [{ range: d.model.getFullModelRange(), text }], () => null);
      if (view) editor.restoreViewState(view);
      markSaved(rel);
    }

    /* Un model non cambia URI: se ne fa uno nuovo (anche il linguaggio può
       cambiare con l'estensione). La storia dell'undo non segue. */
    function rename(from, to) {
      const d = docs.get(from);
      if (!d || docs.has(to)) return;
      const wasCurrent = current === from;
      const viewState = wasCurrent ? editor.saveViewState() : d.viewState;
      docs.delete(from);
      make(to, d.model.getValue(), { viewState, forcedDirty: dirtyOf(d) });
      if (wasCurrent) { current = null; activate(to); }
      d.sub.dispose();
      d.model.dispose();
    }

    function close(rel) {
      const d = docs.get(rel);
      if (!d) return;
      docs.delete(rel);
      if (current === rel) { current = null; editor.setModel(null); }
      d.sub.dispose();
      d.model.dispose();
    }

    function dispose() {
      for (const rel of [...docs.keys()]) close(rel);
      editor.dispose();
    }

    return {
      open, activate, markSaved, replaceText, rename, close, dispose,
      current: () => current,
      getText: (rel) => (docs.has(rel) ? docs.get(rel).model.getValue() : null),
      isDirty: (rel) => docs.has(rel) && dirtyOf(docs.get(rel)),
      focus: () => editor.focus(),
    };
  }

  return { load, createEditorHost };
});
```

- [ ] **Passo 8: verifica**

Run: `node --test tests/editor-monaco.test.js && npm run test:unit`
Atteso: PASS.

- [ ] **Passo 9: smoke di caricamento in Electron** — temporaneo, da non
committare. In fondo a `renderer/index.html`, dopo `renderer.js`, uno
`<script src="editor-monaco.js"></script>` e da DevTools (Ctrl+Shift+I):

```js
AisessEditorMonaco.load(window).then((m) => {
  const div = document.createElement('div'); div.style.cssText = 'position:fixed;inset:20%;z-index:9999';
  document.body.appendChild(div);
  AisessEditorMonaco.createEditorHost({ monaco: m, container: div, fontSize: 13, onChange: console.log, onSave: console.log, onSaveAll: console.log })
    .open('prova.ts', 'const x: number = 1;\n');
});
```

Avvio: `npm start` (o `xvfb-run -a npm start` senza display). Atteso:
evidenziazione TypeScript, nessun errore CSP nella console, Ctrl+F apre la
ricerca. Se la console segnala worker bloccati o «Could not create web
worker», provare in quest'ordine, scrivendo nel piano 60 quale è servito:
1. allargare la CSP come dice l'errore (commento col perché);
2. in `load`, prima del `require.config`:
   `win.MonacoEnvironment = { getWorkerUrl: () => `${BASE}/base/worker/workerMain.js` };`
   (controllare che il file esista in `min/vs`).
Togliere lo script temporaneo prima del commit. Lo script vero si aggiunge
nel Task 9.

- [ ] **Passo 10: commit**

```bash
git add package.json package-lock.json renderer/index.html THIRD-PARTY-NOTICES.md renderer/editor-monaco.js tests/editor-monaco.test.js tests/unit.test.js
cat > /tmp/msg.txt <<'EOF'
chore: monaco-editor come dipendenza, CSP per i worker

Monaco è il motore della sessione editor (piano 60). Versione bloccata a
0.57.0: si carica il build AMD di min/vs, il cui loader è deprecato, e un
aggiornamento va fatto apposta. Dal pacchetto si escludono tutte le
cartelle tranne min/ e le mappe: nell'app resta solo ciò che il renderer
carica. La CSP ammette worker-src 'self' blob: per i worker dei
linguaggi; script-src resta 'self'.

renderer/editor-monaco.js è l'unico modulo che parla con Monaco: un model
per file, stato sporco dalla versione del model, view state conservato.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 9: la scheda editor nel renderer

**File:**
- Crea: `renderer/editor-tab.js`
- Modifica: `renderer/index.html`, `tests/renderer-source.js`,
  `tests/renderer-load.test.js`, `renderer/app-state.js`,
  `renderer/tabs.js`, `renderer/tab-names.js`, `renderer/session-titles.js`,
  `renderer/session-groups.js`, `renderer/type-color-themes.js`,
  `renderer/agent-icons.js`, `renderer/tokens.css`, `renderer/styles.css`,
  `renderer/renderer.js`

**Interfacce consumate:** `window.aisess.editor*` (Task 5),
`AisessEditorFiles` (Task 6), `AisessEditorTree` (Task 7),
`AisessEditorMonaco` (Task 8); dall'app: `tabs`, `$`, `counter`,
`setActive`, `updateEmpty`, `renderSidebar`, `resolveProjectRoot`,
`termFont`, `closeConfirm`, `ConfirmBubble`.

**Interfacce prodotte (globali dell'app):** `createEditorTab(opts)`,
`refreshEditorTab(tab)`, `confirmEditorClose(tab, anchor) → Promise<boolean>`,
`disposeEditorTab(tab)`, `saveEditorSessions()`,
`restoreEditorSessions() → Promise<session[]>`, `restoreEditorTab(s)`,
`editorFolderProblem(cwd) → Promise<string|null>`, `initEditorTabs()`.
Scheda: `tab.type === 'editor'`, `tab.editor = { ui, files, tree, host, hostPending, saving, pendingChanges }`.

- [ ] **Passo 1: test che falliscono** — registrazione del tipo.

In `tests/renderer-source.js`, in `RENDERER_APP_FILES` dopo `'git-tab.js'`:

```js
  'editor-tab.js',
```

In `tests/renderer-load.test.js`, nella lista dei globali attesi aggiungere
`'createEditorTab'` e `'initEditorTabs'`.

In `tests/session-groups.test.js`, in coda:

```js
ok('il tipo editor ha posto e nome nei gruppi (piano 60)', () => {
  assert.strictEqual(TYPE_ORDER.indexOf('editor'), TYPE_ORDER.indexOf('git') + 1);
  assert.strictEqual(TYPE_LABELS.editor, 'Editor');
});
```

Run: `npm run test:unit`
Atteso: FAIL — ordine degli script diverso da `RENDERER_APP_FILES`,
`editor` assente da `TYPE_ORDER`.

- [ ] **Passo 2: tipo, colori, icona**

`renderer/session-groups.js`:

```js
  const TYPE_ORDER = ['shell', 'git', 'editor', 'opencode', 'claude', 'codex', 'antigravity'];
```

e in `TYPE_LABELS` dopo `git: 'Git',` aggiungere `editor: 'Editor',`.

`renderer/tokens.css`, dopo `--type-git`:

```css
  --type-editor:   #B48EF0;  /* lilla: un foglio, non un processo */
```

`renderer/type-color-themes.js`: in ogni tema, in `colors`, dopo `git`:

| tema | `editor` |
|---|---|
| forno | `'#b48ef0'` |
| mare | `'#c9a7ff'` |
| bosco | `'#b9a3e3'` |
| lavanda | `'#e0c3fc'` |
| neon | `'#d58bff'` |
| ambra | `'#c7a2e8'` |
| bianco-nero | `'#d0d0d0'` |
| ghiaccio | `'#b8b5ff'` |

(`tests/type-color-themes.test.js` controlla chiavi, contrasto ≥ 4.5 su
`#070505` e che Forno coincida con `tokens.css`.)

`renderer/agent-icons.js`, dopo la voce `git`:

```js
    editor: {
      label: 'Editor',
      paths: [
        { d: 'M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8Z', stroke: true, width: 2 },
        { d: 'M14 2.5V8h5.5', stroke: true, width: 2 },
        { d: 'M10 12.5l-2 2l2 2', stroke: true, width: 2 },
        { d: 'M14 12.5l2 2l-2 2', stroke: true, width: 2 },
      ],
    },
```

`renderer/styles.css`, accanto alle regole di git (righe ~202, ~239, ~520):

```css
.agent-icon--editor { color: var(--type-editor); }
.type-editor { --type-color: var(--type-editor); }
.dot.editor { background: var(--type-editor); }
```

(copiare la forma esatta delle regole `git` vicine: se `.dot.git` usa
un'altra proprietà, usare quella.)

- [ ] **Passo 3: `renderer/editor-tab.js`**

```js
/* Scheda di tipo editor (docs/plans/60): niente pty, l'albero della cartella
   della sessione e Monaco con una sotto-scheda per file aperto. Leggere,
   scrivere e sorvegliare i file lo fa il main (lib/editor-fs.js,
   lib/editor-watch.js), che confina ogni percorso nella cartella.
   Lo stato dei file aperti sta in editor-files.js, l'albero in
   editor-tree.js, Monaco in editor-monaco.js: qui il cablaggio.
   Le schede si salvano (lib/editor-sessions.js) e tornano al riavvio coi
   file che avevano aperti, come le schede git. */

const EditorFiles = window.AisessEditorFiles;
const EditorTree = window.AisessEditorTree;
const EditorMonaco = window.AisessEditorMonaco;
// Domande appese all'editor (sotto-schede, albero): un fumetto suo, che i
// render della sidebar non spostano (closeConfirm segue le card)
const editorConfirm = ConfirmBubble.createConfirmBubble();

const EDITOR_READ_REASONS = {
  binary: 'è un file binario: l\'editor apre solo testo.',
  'too-large': 'è più grande di 5 MB.',
  'not-utf8': 'non è testo UTF-8.',
  outside: 'sta fuori dalla cartella della sessione.',
  missing: 'non esiste più.',
  'not-file': 'non è un file.',
};
let editorExitConfirmed = false;
let editorExitAsking = false;

const errorText = (e) => String((e && e.message) || e);
const readReason = (r) => EDITOR_READ_REASONS[r && r.reason] || (r && r.error) || 'errore sconosciuto.';

/** Una chiamata al main che non lancia mai: un rifiuto diventa {ok:false}. */
async function callEditor(fn) {
  try {
    return (await fn()) || { ok: false, error: 'nessuna risposta dal main' };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/* ---------- disegno ---------- */

function buildEditorLayout(tab) {
  const el = (tag, className, parent) => {
    const n = document.createElement(tag);
    n.className = className;
    parent.appendChild(n);
    return n;
  };
  const side = el('aside', 'editor-side', tab.wrap);
  const tools = el('div', 'editor-side-tools', side);
  const tool = (label, title, run) => {
    const b = el('button', 'btn btn--ghost editor-tool', tools);
    b.textContent = label;
    b.title = title;
    b.onclick = run;
  };
  tool('+ File', 'Nuovo file nella cartella della sessione', () => newEditorEntry(tab, '', 'file'));
  tool('+ Cartella', 'Nuova cartella nella cartella della sessione', () => newEditorEntry(tab, '', 'dir'));
  tool('⟳', 'Rileggi le cartelle aperte', () => reloadEditorTree(tab));
  const treeHost = el('div', 'editor-tree-host', side);
  const tree = EditorTree.createTreeView({
    root: treeHost, document,
    onOpenFile: (rel) => openEditorFile(tab, rel),
    onToggleDir: (rel) => toggleEditorDir(tab, rel),
    onContextMenu: (row, e) => editorTreeMenu(tab, row, e),
  });
  const main = el('section', 'editor-main', tab.wrap);
  const subtabs = el('div', 'editor-subtabs', main);
  subtabs.setAttribute('role', 'tablist');
  const bar = el('div', 'editor-bar', main);
  bar.hidden = true;
  const message = el('div', 'editor-message', main);
  message.hidden = true;
  const host = el('div', 'editor-host', main);
  return { treeHost, tree, subtabs, bar, message, host };
}

function renderEditorTree(tab) {
  const { tree, ui } = tab.editor;
  ui.tree.render(EditorTree.visibleRows(tree), tree.selected);
}

function showEditorMessage(tab, text) {
  const { message } = tab.editor.ui;
  message.textContent = text; // può contenere nomi di file ed errori del sistema
  message.hidden = false;
}

function hideEditorMessage(tab) {
  tab.editor.ui.message.hidden = true;
}

function renderEditorSubtabs(tab) {
  const { files, ui } = tab.editor;
  ui.subtabs.replaceChildren(...files.order.map((rel) => {
    const f = files.files[rel];
    const b = document.createElement('div');
    b.className = 'editor-subtab'
      + (rel === files.active ? ' is-active' : '')
      + (f.dirty ? ' is-dirty' : '')
      + (f.deleted ? ' is-deleted' : '');
    b.title = rel + (f.deleted ? ' — eliminato dal disco' : '');
    b.setAttribute('role', 'tab');
    const name = document.createElement('span');
    name.className = 'editor-subtab-name';
    name.textContent = EditorFiles.baseName(rel);
    const dot = document.createElement('span');
    dot.className = 'editor-subtab-dot';
    dot.textContent = '●';
    dot.title = 'Non salvato';
    const x = document.createElement('button');
    x.className = 'editor-subtab-close';
    x.textContent = '×';
    x.title = 'Chiudi';
    x.setAttribute('aria-label', `Chiudi ${rel}`);
    x.onclick = (e) => { e.stopPropagation(); closeEditorFile(tab, rel, x); };
    b.onclick = () => activateEditorFile(tab, rel);
    b.onauxclick = (e) => { if (e.button === 1) closeEditorFile(tab, rel, x); };
    b.append(name, dot, x);
    return b;
  }));
  renderEditorBar(tab);
}

/* La barra sotto le sotto-schede parla del file attivo: errore,
   conflitto col disco, file eliminato. */
function renderEditorBar(tab) {
  const { files, ui } = tab.editor;
  const f = files.active ? files.files[files.active] : null;
  const bar = ui.bar;
  bar.replaceChildren();
  bar.className = 'editor-bar';
  bar.hidden = true;
  const show = (text, cls, actions = []) => {
    bar.hidden = false;
    bar.classList.add(cls);
    const t = document.createElement('span');
    t.className = 'editor-bar-text';
    t.textContent = text;
    bar.appendChild(t);
    for (const [label, run] of actions) {
      const b = document.createElement('button');
      b.className = 'btn btn--ghost';
      b.textContent = label;
      b.onclick = run;
      bar.appendChild(b);
    }
  };
  if (!f) return;
  if (f.error) show(f.error, 'is-error', [['Chiudi', () => setEditorFile(tab, f.rel, { error: null })]]);
  else if (f.conflict === 'disk') show('Cambiato sul disco mentre lo modificavi.', 'is-warn',
    [['Ricarica', () => reloadEditorFile(tab, f.rel)], ['Tieni il mio', () => keepEditorVersion(tab, f.rel)]]);
  else if (f.conflict === 'save') show('Cambiato sul disco da quando l\'hai aperto: salvare lo sovrascrive.', 'is-warn',
    [['Sovrascrivi', () => keepEditorVersion(tab, f.rel, { save: true })], ['Ricarica', () => reloadEditorFile(tab, f.rel)]]);
  else if (f.deleted) show('Eliminato dal disco. Salva (Ctrl+S) per ricrearlo.', 'is-warn');
}

function setEditorFile(tab, rel, patch) {
  tab.editor.files = EditorFiles.update(tab.editor.files, rel, patch);
  renderEditorSubtabs(tab);
}

/* ---------- albero ---------- */

async function loadEditorDir(tab, dir) {
  const r = await callEditor(() => window.aisess.editorList(tab.cwd, dir));
  if (!tabs.has(tab.id)) return;
  if (!r.ok) {
    showEditorMessage(tab, `Impossibile leggere ${dir || 'la cartella'}: ${r.error}`);
    return;
  }
  tab.editor.tree = EditorTree.setChildren(tab.editor.tree, dir, r.entries);
  renderEditorTree(tab);
}

async function toggleEditorDir(tab, rel) {
  tab.editor.tree = EditorTree.select(EditorTree.toggle(tab.editor.tree, rel), rel);
  renderEditorTree(tab);
  if (EditorTree.isExpanded(tab.editor.tree, rel)) await loadEditorDir(tab, rel);
}

async function reloadEditorTree(tab) {
  for (const dir of ['', ...tab.editor.tree.expanded]) await loadEditorDir(tab, dir);
}

function editorTreeMenu(tab, row, e) {
  const dir = !row ? '' : row.kind === 'dir' ? row.rel : EditorFiles.parentRel(row.rel);
  const items = [
    { label: 'Nuovo file', run: () => newEditorEntry(tab, dir, 'file') },
    { label: 'Nuova cartella', run: () => newEditorEntry(tab, dir, 'dir') },
  ];
  if (row) {
    items.push({ label: 'Rinomina', run: () => renameEditorEntry(tab, row) });
    items.push({ label: 'Elimina', danger: true, run: () => trashEditorEntry(tab, row) });
  }
  EditorTree.showMenu({ document, x: e.clientX, y: e.clientY, items });
}

async function newEditorEntry(tab, dir, kind) {
  const ed = tab.editor;
  if (dir && !EditorTree.isExpanded(ed.tree, dir)) await toggleEditorDir(tab, dir);
  const name = await EditorTree.promptName({
    document, host: ed.ui.tree.element,
    after: dir ? ed.ui.tree.rowOf(dir) : null,
    depth: dir ? dir.split('/').length : 0,
  });
  if (!name) return;
  const rel = EditorFiles.joinRel(dir, name);
  const r = await callEditor(() => (kind === 'dir'
    ? window.aisess.editorMkdir(tab.cwd, rel)
    : window.aisess.editorCreate(tab.cwd, rel)));
  if (!r.ok) { showEditorMessage(tab, `Non si crea ${rel}: ${r.error}`); return; }
  await loadEditorDir(tab, dir);
  if (kind === 'file') await openEditorFile(tab, rel);
}

async function renameEditorEntry(tab, row) {
  const ed = tab.editor;
  const name = await EditorTree.promptName({
    document, host: ed.ui.tree.element, after: ed.ui.tree.rowOf(row.rel), depth: row.depth, initial: row.name,
  });
  if (!name || name === row.name) return;
  const r = await callEditor(() => window.aisess.editorRename(tab.cwd, row.rel, name));
  if (!r.ok) { showEditorMessage(tab, `Non si rinomina ${row.rel}: ${r.error}`); return; }
  // I file aperti lì sotto seguono: stato, model di Monaco, watch
  const moved = EditorFiles.affectedBy(ed.files, row.rel);
  for (const rel of moved) unwatchEditorFile(tab, rel);
  ed.files = EditorFiles.renamePath(ed.files, row.rel, r.rel);
  for (const rel of moved) {
    const to = EditorFiles.movedPath(rel, row.rel, r.rel);
    if (ed.host) ed.host.rename(rel, to);
    await watchEditorFile(tab, to);
  }
  ed.tree = EditorTree.renamePath(ed.tree, row.rel, r.rel);
  await loadEditorDir(tab, EditorFiles.parentRel(row.rel));
  renderEditorSubtabs(tab);
  saveEditorSessions();
}

async function trashEditorEntry(tab, row) {
  const ed = tab.editor;
  const yes = await editorConfirm.ask({
    anchor: ed.ui.tree.rowOf(row.rel) || ed.ui.treeHost,
    title: `Eliminare «${row.name}»?`,
    text: row.kind === 'dir' ? 'La cartella e tutto quello che contiene vanno nel cestino.' : 'Il file va nel cestino.',
    confirmLabel: 'Elimina',
  });
  if (!yes) return;
  const r = await callEditor(() => window.aisess.editorTrash(tab.cwd, row.rel));
  if (!r.ok) { showEditorMessage(tab, `Non si elimina ${row.rel}: ${r.error}`); return; }
  // Un file aperto e pulito si chiude; uno con modifiche resta, «eliminato»
  for (const rel of EditorFiles.affectedBy(ed.files, row.rel)) {
    if (ed.host && ed.host.isDirty(rel)) ed.files = EditorFiles.markDeleted(ed.files, rel);
    else dropEditorFile(tab, rel);
  }
  ed.tree = EditorTree.removePath(ed.tree, row.rel);
  await loadEditorDir(tab, EditorFiles.parentRel(row.rel));
  renderEditorSubtabs(tab);
  saveEditorSessions();
}

/* ---------- file aperti ---------- */

function ensureEditorHost(tab) {
  const ed = tab.editor;
  if (ed.host) return Promise.resolve(ed.host);
  if (!ed.hostPending) {
    ed.hostPending = EditorMonaco.load(window).then((monaco) => {
      if (!tabs.has(tab.id)) return null;
      ed.host = EditorMonaco.createEditorHost({
        monaco, container: ed.ui.host, fontSize: termFont.get(),
        onChange: (rel, dirty) => { const f = ed.files.files[rel]; if (f && f.dirty !== dirty) setEditorFile(tab, rel, { dirty }); },
        onSave: (rel) => saveEditorFile(tab, rel),
        onSaveAll: () => saveAllEditorFiles(tab),
      });
      return ed.host;
    }).finally(() => { ed.hostPending = null; });
  }
  return ed.hostPending;
}

async function watchEditorFile(tab, rel) {
  const r = await callEditor(() => window.aisess.editorWatch(tab.cwd, rel));
  if (!r.ok) { console.warn('editor-watch fallito:', r.error); return; }
  if (tab.editor.files.files[rel]) tab.editor.files = EditorFiles.update(tab.editor.files, rel, { path: r.path });
}

function unwatchEditorFile(tab, rel) {
  callEditor(() => window.aisess.editorUnwatch(tab.cwd, rel))
    .then((r) => { if (!r.ok) console.warn('editor-unwatch fallito:', r.error); });
}

/**
 * Apre (o porta davanti) un file. `quiet`: al ripristino un file sparito si
 * salta senza dirlo, e la lista salvata non si riscrive a ogni file.
 * @returns {Promise<boolean>} true se il file è aperto
 */
async function openEditorFile(tab, rel, { quiet = false } = {}) {
  const ed = tab.editor;
  ed.tree = EditorTree.select(ed.tree, rel);
  renderEditorTree(tab);
  if (ed.files.files[rel]) { activateEditorFile(tab, rel, { save: !quiet }); return true; }
  const r = await callEditor(() => window.aisess.editorRead(tab.cwd, rel));
  if (!r.ok) {
    if (!quiet) showEditorMessage(tab, `Non si apre ${rel}: ${readReason(r)}`);
    return false;
  }
  let host;
  try {
    host = await ensureEditorHost(tab);
  } catch (e) {
    console.error('Monaco non si carica', e);
    showEditorMessage(tab, `L'editor non si carica: ${errorText(e)}`);
    return false;
  }
  if (!host || !tabs.has(tab.id)) return false;
  if (ed.files.files[rel]) { activateEditorFile(tab, rel, { save: !quiet }); return true; } // aperto nel frattempo
  host.open(rel, r.text);
  ed.files = EditorFiles.open(ed.files, rel, { path: r.path, mtime: r.mtime, bom: r.bom });
  hideEditorMessage(tab);
  renderEditorSubtabs(tab);
  await watchEditorFile(tab, rel);
  if (!quiet) saveEditorSessions();
  return true;
}

function activateEditorFile(tab, rel, { save = true } = {}) {
  const ed = tab.editor;
  if (!ed.files.files[rel]) return;
  ed.files = EditorFiles.activate(ed.files, rel);
  if (ed.host) ed.host.activate(rel);
  hideEditorMessage(tab);
  renderEditorSubtabs(tab);
  if (save) saveEditorSessions();
}

/* Toglie la sotto-scheda senza chiedere niente (chi chiama ha già chiesto) */
function dropEditorFile(tab, rel) {
  const ed = tab.editor;
  if (!ed.files.files[rel]) return;
  ed.files = EditorFiles.close(ed.files, rel);
  if (ed.host) {
    ed.host.close(rel);
    if (ed.files.active) ed.host.activate(ed.files.active);
  }
  unwatchEditorFile(tab, rel);
  renderEditorSubtabs(tab);
}

async function closeEditorFile(tab, rel, anchor) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f) return;
  if (f.dirty) {
    const choice = await editorConfirm.choose({
      anchor, title: `«${EditorFiles.baseName(rel)}» ha modifiche non salvate`,
      choices: [{ value: 'save', label: 'Salva' }, { value: 'discard', label: 'Scarta', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save' && !(await saveEditorFile(tab, rel))) return;
  }
  dropEditorFile(tab, rel);
  saveEditorSessions();
}

/* ---------- salvataggio e cambi sul disco ---------- */

/** @returns {Promise<boolean>} true se il file è sul disco com'è nell'editor */
async function saveEditorFile(tab, rel) {
  const ed = tab.editor;
  const f = rel && ed.files.files[rel];
  if (!f || !ed.host || ed.saving.has(rel)) return false;
  if (f.conflict) { renderEditorBar(tab); return false; } // la barra chiede già che fare
  ed.saving.add(rel);
  let done = false;
  try {
    const text = ed.host.getText(rel);
    const r = await callEditor(() => window.aisess.editorWrite(tab.cwd, rel, text, f.mtime, f.bom));
    if (!ed.files.files[rel]) return false; // chiuso nel frattempo
    if (r.ok) {
      ed.files = EditorFiles.update(ed.files, rel, { mtime: r.mtime, deleted: false, conflict: null, diskMtime: null, error: null });
      // Se si è scritto ancora durante il salvataggio, resta sporco
      if (ed.host.getText(rel) === text) ed.host.markSaved(rel);
      if (f.deleted) { unwatchEditorFile(tab, rel); await watchEditorFile(tab, rel); } // ricreato: il watch si riarma
      done = true;
    } else if (r.conflict) {
      ed.files = EditorFiles.update(ed.files, rel, { conflict: 'save', diskMtime: r.mtime });
    } else {
      ed.files = EditorFiles.update(ed.files, rel, { error: `Salvataggio non riuscito: ${r.error}` });
    }
    renderEditorSubtabs(tab);
    return done;
  } finally {
    ed.saving.delete(rel);
    // Un evento del watch arrivato durante il salvataggio si guarda adesso,
    // col mtime nuovo: se è il nostro, non dice niente
    const pending = ed.pendingChanges.get(rel);
    ed.pendingChanges.delete(rel);
    if (pending) handleEditorFileChange(tab, rel, pending);
  }
}

async function saveAllEditorFiles(tab) {
  let allSaved = true;
  for (const rel of EditorFiles.dirtyFiles(tab.editor.files)) {
    allSaved = (await saveEditorFile(tab, rel)) && allSaved;
  }
  return allSaved;
}

/* Un file aperto è cambiato sul disco (watch o ricontrollo in primo piano):
   pulito → si ricarica; con modifiche → si chiede; sparito → «eliminato». */
function handleEditorFileChange(tab, rel, change) {
  const ed = tab.editor;
  const f = ed.files.files[rel];
  if (!f) return;
  if (ed.saving.has(rel)) { ed.pendingChanges.set(rel, change); return; }
  if (!change.exists) {
    if (f.deleted) return;
    ed.files = EditorFiles.markDeleted(ed.files, rel);
    renderEditorSubtabs(tab);
    return;
  }
  if (change.mtime === f.mtime) return; // il nostro salvataggio
  if (!(ed.host && ed.host.isDirty(rel))) { reloadEditorFile(tab, rel); return; }
  if (f.conflict === 'disk' && f.diskMtime === change.mtime) return;
  ed.files = EditorFiles.update(ed.files, rel, { conflict: 'disk', diskMtime: change.mtime });
  renderEditorSubtabs(tab);
}

async function reloadEditorFile(tab, rel) {
  const ed = tab.editor;
  const r = await callEditor(() => window.aisess.editorRead(tab.cwd, rel));
  const f = ed.files.files[rel];
  if (!f || !ed.host) return;
  if (!r.ok) {
    ed.files = r.reason === 'missing'
      ? EditorFiles.markDeleted(ed.files, rel)
      : EditorFiles.update(ed.files, rel, { error: `Non si ricarica: ${readReason(r)}` });
    renderEditorSubtabs(tab);
    return;
  }
  ed.host.replaceText(rel, r.text);
  ed.files = EditorFiles.update(ed.files, rel, {
    path: r.path, mtime: r.mtime, bom: r.bom, dirty: false, deleted: false, conflict: null, diskMtime: null, error: null,
  });
  if (f.deleted) { unwatchEditorFile(tab, rel); await watchEditorFile(tab, rel); }
  renderEditorSubtabs(tab);
}

/* «Tieni il mio» / «Sovrascrivi»: l'mtime atteso diventa quello del disco,
   il prossimo salvataggio sovrascrive (null: il file non c'è più, si ricrea) */
function keepEditorVersion(tab, rel, { save = false } = {}) {
  const f = tab.editor.files.files[rel];
  if (!f) return;
  setEditorFile(tab, rel, { mtime: f.diskMtime, conflict: null, diskMtime: null });
  if (save) saveEditorFile(tab, rel);
}

/** Tornando in primo piano: albero riletto e mtime dei file aperti ricontrollati. */
async function refreshEditorTab(tab) {
  const ed = tab && tab.editor;
  if (!ed) return;
  for (const rel of [...ed.files.order]) {
    const f = ed.files.files[rel];
    if (!f) continue;
    const r = await callEditor(() => window.aisess.editorStat(tab.cwd, rel));
    if (r.ok) handleEditorFileChange(tab, rel, { path: f.path, exists: r.exists, mtime: r.mtime });
    else console.warn('editor-stat fallito:', r.error);
  }
  await reloadEditorTree(tab);
}

/* ---------- scheda ---------- */

/** Chiudendo la scheda: i file con modifiche si salvano o si scartano. */
async function confirmEditorClose(tab, anchor) {
  const dirty = EditorFiles.dirtyFiles(tab.editor.files);
  if (!dirty.length) return true;
  const bubble = anchor ? closeConfirm : editorConfirm;
  const choice = await bubble.choose({
    anchor: anchor || tab.editor.ui.subtabs, key: anchor ? tab.id : null,
    title: dirty.length === 1 ? `«${EditorFiles.baseName(dirty[0])}» ha modifiche non salvate` : `${dirty.length} file con modifiche non salvate`,
    choices: [{ value: 'save', label: 'Salva tutto' }, { value: 'discard', label: 'Scarta', danger: true }],
  });
  if (!choice) return false;
  return choice === 'save' ? saveAllEditorFiles(tab) : true;
}

function disposeEditorTab(tab) {
  const ed = tab.editor;
  if (!ed) return;
  for (const rel of ed.files.order) unwatchEditorFile(tab, rel);
  try { if (ed.host) ed.host.dispose(); } catch (e) { console.warn('chiusura di Monaco fallita', e); }
}

async function createEditorTab({ name, cwd, startedAt = Date.now(), files = [], active = null, restoring = false, reveal = true } = {}) {
  const id = 'tab-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wrap = document.createElement('div');
  wrap.className = 'term-wrap editor-wrap type-editor';
  wrap.id = 'wrap-' + id;
  $('#terminals').appendChild(wrap);
  const folder = String(cwd || '').split(/[\\/]/).filter(Boolean).pop();
  const tab = { id, type: 'editor', name: name || folder || `editor · ${counter++}`, cwd, projectRoot: cwd || null, startedAt, autoNamed: !name,
    session: null, reattached: false, alive: true, needsAttention: false, running: false, term: null, fit: null, ro: null, wrap, editor: null };
  tab.editor = {
    ui: buildEditorLayout(tab), files: EditorFiles.empty(), tree: EditorTree.emptyTree(),
    host: null, hostPending: null, saving: new Set(), pendingChanges: new Map(),
  };
  tabs.set(id, tab);
  updateEmpty();
  setActive(id, { reveal });
  // Durante il ripristino la lista su disco è già quella giusta: riscriverla
  // a ogni scheda la accorcerebbe, se l'app si chiudesse a metà
  if (!restoring) saveEditorSessions();
  resolveProjectRoot(cwd).then((root) => {
    if (!tabs.has(id) || root === tab.projectRoot) return;
    tab.projectRoot = root;
    renderSidebar();
  }).catch((e) => console.warn('radice del progetto non risolta', e));
  await loadEditorDir(tab, '');
  for (const rel of files) await openEditorFile(tab, rel, { quiet: true });
  if (active && tab.editor.files.files[active]) activateEditorFile(tab, active, { save: !restoring });
}

/* ---------- salvataggio delle schede e ripristino ---------- */

/* La lista si riscrive per intero a ogni apertura/chiusura di scheda o file
   e a ogni rinomina. Un nome preso dalla cartella non si salva (null). */
function saveEditorSessions() {
  const sessions = [...tabs.values()].filter((t) => t.type === 'editor')
    .map((t) => ({ cwd: t.cwd, name: t.autoNamed ? null : t.name, startedAt: t.startedAt, ...EditorFiles.toSaved(t.editor.files) }));
  return window.aisess.saveEditorSessions(sessions)
    .then((r) => { if (r && !r.ok) console.warn('editor-sessions-save fallito:', r.error); })
    .catch((e) => console.warn('editor-sessions-save non raggiungibile', e));
}

/** Perché una cartella non si può aprire nell'editor; null se si può. */
async function editorFolderProblem(cwd) {
  if (!cwd) return 'Scegli la cartella da aprire.';
  const r = await callEditor(() => window.aisess.editorList(cwd, ''));
  return r.ok ? null : `Impossibile aprire la cartella: ${r.error}`;
}

/* Una cartella sparita nel frattempo: la scheda non torna */
async function restoreEditorTab(s) {
  const problem = await editorFolderProblem(s.cwd);
  if (problem) { console.warn('scheda editor non ripristinata:', s.cwd, problem); return false; }
  await createEditorTab({ name: s.name, cwd: s.cwd, startedAt: s.startedAt || Date.now(), files: s.files, active: s.active, restoring: true, reveal: false });
  return true;
}

/* All'avvio, come restoreGitSessions: senza riavvio della macchina le schede
   tornano da sole; dopo (`ask`) si restituiscono a offerRestore. */
async function restoreEditorSessions() {
  const r = await callEditor(() => window.aisess.editorSessions());
  if (!r.ok) { console.warn('editor-sessions fallito:', r.error); return []; }
  if (r.ask) return r.sessions;
  for (const s of r.sessions) await restoreEditorTab(s);
  return [];
}

/* ---------- uscita con file non salvati ---------- */

const editorDirtyTabs = () => [...tabs.values()].filter((t) => t.editor && EditorFiles.dirtyFiles(t.editor.files).length);

/* Il beforeunload ha fermato l'uscita (o la chiusura, o una ricarica):
   si chiede, e alla conferma il main rifà quello che era stato fermato
   (app/editor-close.js). */
async function askEditorExit() {
  if (editorExitAsking) return;
  editorExitAsking = true;
  try {
    const dirty = editorDirtyTabs();
    if (!dirty.length) return;
    const first = dirty[0];
    setActive(first.id);
    const count = dirty.reduce((n, t) => n + EditorFiles.dirtyFiles(t.editor.files).length, 0);
    const choice = await editorConfirm.choose({
      anchor: first.editor.ui.subtabs,
      title: count === 1 ? 'Un file con modifiche non salvate' : `${count} file con modifiche non salvate`,
      text: 'Uscendo senza salvare le modifiche si perdono.',
      choices: [{ value: 'save', label: 'Salva tutto ed esci' }, { value: 'discard', label: 'Esci senza salvare', danger: true }],
    });
    if (!choice) return;
    if (choice === 'save') {
      for (const t of dirty) {
        // Un salvataggio fallito: la barra del file dice perché, non si esce
        if (!(await saveAllEditorFiles(t))) { setActive(t.id); return; }
      }
    }
    editorExitConfirmed = true;
    const r = await callEditor(() => window.aisess.editorCloseConfirmed());
    if (!r.ok || !r.what) editorExitConfirmed = false; // niente da rifare: si resta
  } finally {
    editorExitAsking = false;
  }
}

/** Da init(): gli eventi del watch e la guardia sull'uscita. */
function initEditorTabs() {
  window.aisess.onEditorFileChanged((change) => {
    if (!change || typeof change.path !== 'string') return;
    for (const t of tabs.values()) {
      if (!t.editor) continue;
      const rel = EditorFiles.findByPath(t.editor.files, change.path);
      if (rel) handleEditorFileChange(t, rel, change);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (editorExitConfirmed || !editorDirtyTabs().length) return;
    // Annullare senza dialogo: Electron non ne mostra, la domanda è nostra
    e.preventDefault();
    e.returnValue = false;
    askEditorExit();
  });
}
```

- [ ] **Passo 4: integrazione nei file esistenti**

`renderer/index.html`:
- fra gli script UMD, dopo `git-graph-view.js`/`git-branch-picker.js`:

  ```html
  <script src="editor-files.js"></script>
  <script src="editor-tree.js"></script>
  <script src="editor-monaco.js"></script>
  ```
- fra gli script dell'app, subito dopo `git-tab.js`:

  ```html
  <script src="editor-tab.js"></script>
  ```
- nel dialogo nuova sessione, dopo la `type-card` di git (riga ~180):

  ```html
  <button class="type-card" data-type="editor"><span class="type-glyph" data-icon="editor"></span><b>Editor</b><span>file del progetto</span></button>
  ```

`renderer/app-state.js`, dopo `AI_TYPES`:

```js
// Tipi senza pty: niente kill alla chiusura, niente domanda «processo in corso»
const PANEL_TYPES = ['git', 'editor'];
```

`renderer/tabs.js`:
- in `createTab`, accanto alla riga di git (riga ~48):

  ```js
  if (type === 'editor') return createEditorTab({ name, cwd, startedAt, reveal });
  ```
- in `setActive`, dopo la riga di `refreshGitTab`:

  ```js
  // Anche i file aperti nell'editor: un agente può averli toccati intanto
  if (t && t.editor && id !== previousId) refreshEditorTab(t);
  ```
- in `closeTab`: `if (t.type !== 'git') await window.aisess.kill(id);`
  diventa `if (!PANEL_TYPES.includes(t.type)) await window.aisess.kill(id);`;
  dopo `try { if (t.git) t.git.picker.destroy(); } catch {}` aggiungere
  `if (t.editor) disposeEditorTab(t);`; in fondo, dopo
  `if (t.type === 'git') saveGitSessions();`, aggiungere
  `if (t.type === 'editor') saveEditorSessions();`.
- in `requestClose`, dopo `if (!t) return;`:

  ```js
  // Una scheda editor non ha processi: chiede solo per i file non salvati
  if (t.type === 'editor') {
    if (await confirmEditorClose(t, anchor)) await terminateTab(id);
    return;
  }
  ```
  e la condizione della domanda diventa
  `if (t.alive && anchor && !PANEL_TYPES.includes(t.type)) {`.

`renderer/tab-names.js` (riga ~166), dopo `if (tab.type === 'git') saveGitSessions();`:

```js
  if (tab.type === 'editor') saveEditorSessions();
```

`renderer/session-titles.js`, `needsAutoRefresh`:

```js
    if (!tab || tab.type === 'shell' || tab.type === 'git' || tab.type === 'editor') return false;
```

(e nel commento sopra: «Le shell e le schede git ed editor non hanno conversazioni.»)

`renderer/renderer.js`, nel click di `#new-confirm`, dopo il blocco di git:

```js
    if (pendingNewType === 'editor') {
      const problem = await editorFolderProblem(cwd);
      if (problem) { showNewError(problem); return; }
    }
```

e in `init()`, prima di `watchWorktrees();`:

```js
  initEditorTabs();
```

(il ripristino all'avvio arriva nel Task 10).

`renderer/styles.css`, dopo `.term-wrap.git-wrap` (riga ~1150):

```css
/* ---------- Sessione editor (docs/plans/60) ---------- */
.term-wrap.editor-wrap { padding: 0; }
.term-wrap.editor-wrap.active { display: flex; }
.editor-side {
  width: 240px; min-width: 160px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border); background: var(--surface);
}
.editor-side-tools { display: flex; gap: 4px; padding: 6px; border-bottom: 1px solid var(--divider); }
.editor-tool { font-size: 12px; padding: 2px 8px; }
.editor-tree-host { flex: 1; overflow: auto; padding: 4px 0; }
.editor-tree-row {
  display: flex; align-items: center; gap: 4px; height: 22px; padding-right: 8px;
  font: 13px var(--font-ui); color: var(--text-2); cursor: pointer; white-space: nowrap;
}
.editor-tree-row:hover { background: var(--surface-2); }
.editor-tree-row.is-selected { background: var(--surface-3); color: var(--text); }
.editor-tree-row.is-ignored { color: var(--text-faint); }
.editor-tree-twisty { width: 12px; flex-shrink: 0; color: var(--text-dim); }
.editor-tree-name { overflow: hidden; text-overflow: ellipsis; }
.editor-tree-input {
  display: block; width: calc(100% - 24px); height: 22px; font: 13px var(--font-ui);
  background: var(--bg); color: var(--text); border: 1px solid var(--border-strong);
}
.editor-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.editor-subtabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--border); background: var(--surface); }
.editor-subtab {
  display: flex; align-items: center; gap: 6px; padding: 0 6px 0 12px; height: 30px;
  font: 13px var(--font-ui); color: var(--text-muted); cursor: pointer; white-space: nowrap;
  border-right: 1px solid var(--divider);
}
.editor-subtab.is-active { color: var(--text); background: var(--bg); box-shadow: inset 0 2px 0 var(--type-editor); }
.editor-subtab.is-deleted .editor-subtab-name { text-decoration: line-through; }
.editor-subtab-dot { display: none; color: var(--type-editor); font-size: 10px; }
.editor-subtab.is-dirty .editor-subtab-dot { display: inline; }
.editor-subtab-close { background: none; border: 0; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 4px; }
.editor-subtab-close:hover { color: var(--text); }
.editor-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font: 13px var(--font-ui); }
.editor-bar.is-warn { background: var(--surface-3); color: var(--text); }
.editor-bar.is-error { background: var(--surface-3); color: var(--state-error); }
.editor-bar-text { flex: 1; }
.editor-message { padding: 10px 12px; font: 13px var(--font-ui); color: var(--state-error); border-bottom: 1px solid var(--divider); }
.editor-host { flex: 1; min-height: 0; }
.editor-menu {
  position: fixed; z-index: 1000; display: flex; flex-direction: column; min-width: 160px; padding: 4px;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 6px;
}
.editor-menu-item { text-align: left; background: none; border: 0; color: var(--text); padding: 6px 10px; font: 13px var(--font-ui); cursor: pointer; border-radius: 4px; }
.editor-menu-item:hover { background: var(--surface-3); }
.editor-menu-item.is-danger { color: var(--state-error); }
```

(se `--state-error` o una delle variabili usate non c'è in `tokens.css`,
usare quella equivalente che c'è: `grep -- '--state-\|--text' renderer/tokens.css`.)

- [ ] **Passo 5: verifica**

Run: `npm run test:unit`
Atteso: PASS (ordine degli script, globali, temi, colori distinti, gruppi).

- [ ] **Passo 6: smoke** (`npm start`):
1. Nuova sessione → Editor → cartella di un progetto: albero, cartelle
   prima, file ignorati attenuati.
2. Aprire tre file: sotto-schede, evidenziazione, Ctrl+F e Ctrl+H.
3. Modificare: pallino; Ctrl+S: pallino via, file sul disco giusto.
4. Da una shell `echo x >> file` su un file pulito → si ricarica; su uno
   sporco → barra «Ricarica / Tieni il mio».
5. Nuovo file, nuova cartella, rinomina di un file aperto (la sotto-scheda
   segue), elimina (finisce nel cestino del sistema).
6. × su una sotto-scheda sporca → «Salva / Scarta / Annulla».
7. × sulla card con file sporchi → stessa domanda.
8. Cartella inesistente nel dialogo → errore nel dialogo, che resta aperto.
9. Console del renderer senza errori CSP.

- [ ] **Passo 7: commit**

```bash
git add renderer/editor-files.js renderer/editor-tree.js renderer/editor-tab.js renderer/index.html renderer/app-state.js renderer/tabs.js renderer/tab-names.js renderer/session-titles.js renderer/session-groups.js renderer/type-color-themes.js renderer/agent-icons.js renderer/tokens.css renderer/styles.css renderer/renderer.js tests/editor-files.test.js tests/editor-tree.test.js tests/renderer-source.js tests/renderer-load.test.js tests/session-groups.test.js
cat > /tmp/msg.txt <<'EOF'
feat: scheda editor nel renderer

Nuovo tipo di sessione «Editor»: l'albero della cartella della sessione e
Monaco con una sotto-scheda per file aperto. Salvataggio con Ctrl+S
(Ctrl+Shift+S tutti), conflitto se il file è cambiato sul disco, ricarica
automatica dei file puliti cambiati da fuori, file eliminati tenuti aperti
finché non si decide. Dall'albero: nuovo file, nuova cartella, rinomina,
elimina nel cestino. Uscire con file non salvati chiede prima.

Stato dei file aperti (editor-files.js) e albero (editor-tree.js) sono
moduli puri provati col DOM finto; editor-tab.js li cabla come git-tab.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 10: ripristino delle schede editor

**File:**
- Modifica: `renderer/restore.js`, `renderer/renderer.js`

**Interfacce consumate:** `restoreEditorSessions`, `restoreEditorTab`,
`saveEditorSessions` (Task 9).

- [ ] **Passo 1: `renderer/restore.js`**

- firma: `async function offerRestore(gitLost = [], editorLost = []) {`
- voci: `const items = [...lost.map(sessionRestoreItem), ...gitLost.map(gitRestoreItem), ...editorLost.map(editorRestoreItem)];`
- dopo `const saveGit = …`:

  ```js
  const saveEditor = () => (editorLost.length ? saveEditorSessions() : Promise.resolve());
  ```
  e ovunque si chiama `await saveGit();` aggiungere subito dopo
  `await saveEditor();` (conferma e rinuncia).
- dopo `gitRestoreItem`:

  ```js
  function editorRestoreItem(s) {
    const folder = String(s.cwd || '').split(/[\\/]/).filter(Boolean).pop();
    const count = s.files.length;
    return {
      type: 'editor', name: s.name || folder || 'editor', cwd: s.cwd,
      how: count === 1 ? 'editor, 1 file' : `editor, ${count} file`,
      restore: () => restoreEditorTab(s),
    };
  }
  ```

  (verificare che `restore` delle altre voci sia usato con `await`; se il
  ciclo di conferma ignora il valore restituito, `restoreEditorTab` che
  restituisce `false` per una cartella sparita va bene così.)

- [ ] **Passo 2: `renderer/renderer.js`**, fine di `init()`:

```js
  const gitToOffer = await restoreGitSessions();
  const editorToOffer = await restoreEditorSessions();
  await offerRestore(gitToOffer, editorToOffer);
```

- [ ] **Passo 3: verifica**

Run: `npm run test:unit`
Atteso: PASS.

Smoke:
1. Scheda editor con tre file aperti, uno attivo in mezzo. Chiudere l'app
   (senza file sporchi) e riaprirla: la scheda torna con gli stessi file e
   lo stesso attivo, senza finestra di ripristino.
2. Rinominare la scheda, riavviare: il nome resta.
3. Spostare via un file aperto, riavviare: la scheda torna senza quel file,
   nessun messaggio.
4. Rinominare la cartella della sessione, riavviare: la scheda non torna.
5. Simulare il riavvio della macchina: in `editor-sessions.json` (cartella
   dei dati dell'app) mettere `"savedAt": 0`, avviare: la scheda compare
   nella finestra del ripristino come «editor, N file»; confermando torna.
6. File sporco, chiudere la finestra → domanda; «Annulla» → l'app resta;
   «Esci senza salvare» → si chiude. Stessa prova con Ctrl+Q (uscita) e
   Ctrl+R (ricarica): dopo la conferma si rifà quella cosa, non un'altra.

- [ ] **Passo 4: commit**

```bash
git add renderer/restore.js renderer/renderer.js
cat > /tmp/msg.txt <<'EOF'
feat: ripristino delle schede editor

Le schede editor tornano all'avvio coi file che avevano aperti e quello
attivo, come le schede git: da sole se la macchina non si è riavviata,
nella finestra del ripristino altrimenti. I file spariti si saltano in
silenzio, una cartella sparita non riapre la scheda.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 11: pacchetto e chiusura

**File:**
- Modifica: `docs/plans/README.md` (stato del piano 60),
  `docs/plans/60-sessione-editor.md` (quello che è emerso), eventualmente
  `package.json` (`build.asarUnpack`)

- [ ] **Passo 1: test completi**

Run: `npm run test:unit && npm run test:coverage`
Atteso: PASS; i moduli nuovi di `lib/` e i moduli UMD dell'editor sopra
l'80% di righe coperte (leggere la tabella della coverage).

- [ ] **Passo 2: `.deb`**

```bash
npm run dist:linux
ls -la dist/*.deb
```

Installare il `.deb` e ripetere sull'app installata i passi 1-3 e 9 dello
smoke del Task 9. In particolare:
- Monaco si carica (evidenziazione, Ctrl+F);
- nella console nessun errore di worker. Se i worker non partono dentro
  `app.asar`: aggiungere `"node_modules/monaco-editor/min/vs/**"` a
  `build.asarUnpack`, rifare il `.deb`, riprovare, e scriverlo nel piano 60
  (sezione «asar»).
- dimensione: `du -sh` della cartella `resources` dell'app installata prima
  e dopo; annotare la differenza nel piano 60.

- [ ] **Passo 3: piano e README** — in `docs/plans/README.md` la riga del
piano 60 passa allo stato «fatto» (stesso formato delle altre righe); nel
piano 60 annotare quello che è servito davvero (CSP, `getWorkerUrl`,
`asarUnpack`, peso).

- [ ] **Passo 4: commit**

```bash
git add docs/plans/README.md docs/plans/60-sessione-editor.md package.json
cat > /tmp/msg.txt <<'EOF'
docs: piano 60 chiuso, note dal pacchetto

Quello che il .deb ha chiesto per Monaco (worker, asar, peso) scritto nel
piano, perché il prossimo aggiornamento di Monaco parta da lì.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

## Note per chi esegue

- **Niente Ctrl+W** per le sotto-schede: nel menu Ctrl+W è del ruolo
  `close` e chiuderebbe la finestra. Si chiude con la × o col tasto centrale.
- **Worktree** (*corretto dopo la revisione finale*): rimuovere o unire un
  worktree chiudeva le sue sessioni con `terminateTab` senza domande, e una
  scheda editor lì dentro perdeva le modifiche non salvate (nel merge non
  entravano). Ora `createWorktreeActions` riceve `confirmClose`: dopo la
  conferma e prima di `api.merge`/`api.remove` chiede `confirmEditorClose`
  per ogni scheda editor del worktree, e un no annulla tutto
  (`renderer/worktree-actions.js`, `renderer/worktrees.js`).
- **Corpo del testo**: l'editor parte con la dimensione dei terminali
  (`termFont.get()`) e non segue i cambi da menu Vista. Se lo si vuole, è un
  piano a parte.
- Il pannello delle modifiche funziona anche su una scheda editor (ha una
  `cwd`): è voluto.

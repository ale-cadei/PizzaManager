# 61 — Copiare file dall'esterno nell'albero dell'editor: piano di implementazione

> **Per chi esegue:** un task alla volta, nell'ordine. Ogni task: test prima
> (rosso), codice (verde), commit. I passi usano le checkbox (`- [ ]`).
> Il *perché* delle scelte sta in `docs/plans/61-editor-copia-file.md`:
> questo file dice *cosa scrivere*.

**Obiettivo:** portare file e cartelle da fuori dentro una cartella
dell'albero della scheda editor, trascinandoli, con «Copia qui file…» o
incollandoli (menu «Incolla» e Ctrl+V), chiedendo cosa fare dei conflitti.

**Architettura:** il main fa tutto quello che tocca il disco in due fasi:
`planCopy` controlla e trova i conflitti, `runCopy` copia con le decisioni
(`lib/editor-copy.js`, puro, riceve `editorFs` e `trash`). Gli appunti si
leggono nel main e si traducono in percorsi in `lib/clipboard-files.js`.
`app/editor.js` aggiunge quattro canali. Nel renderer `editor-tree.js`
emette `onCopyInto(dir, source)` (drop, Ctrl+V), `editor-tab.js` aggiunge le
voci di menu, e lo script nuovo `editor-copy-ui.js` cabla il giro
sorgenti → piano → domande → copia → esito.

**Tecnologie:** Electron 33 (Node 20.18: `fileURLToPath(url, {windows})`
c'è da 20.13), `webUtils.getPathForFile` nel preload, Node ≥ 22 per i test
(`node --test`).

## Vincoli globali

- `lib/` non fa `require('electron')` (c'è un test). `main.js` solo
  cablaggio, sotto il limite di righe di `tests/unit.test.js` (`< 234`; oggi
  232): questo piano **non aggiunge righe** a `main.js`, cambia solo la riga
  del `require('electron')` e quella di `registerEditorHandlers`.
- I test importano il codice vero e verificano comportamenti, non il testo
  del sorgente. Test di Windows in `tests/windows.test.js` con
  `platform: 'win32'`.
- Testo che arriva da fuori (nomi di file, errori): `textContent`, mai
  `innerHTML` interpolato. La bolla di conferma usa già `textContent`.
- **Mai sovrascrivere.** Sostituire = `trash` (`shell.trashItem` nel main)
  e poi copiare; i file si copiano con `COPYFILE_EXCL`, le cartelle con
  `mkdir` non ricorsivo.
- I link simbolici si copiano come link e non si seguono mai (né per
  contare né per copiare).
- Limiti: `MAX_FILES = 10000` elementi (file, cartelle e link contati
  ricorsivamente), `MAX_BYTES = 1 GiB` (somma delle dimensioni dei file),
  `MAX_SOURCES = 1000` sorgenti di primo livello, `MAX_NUMBERED = 1000`
  tentativi di `nome (N)`.
- Messaggi all'utente in italiano, quelli esatti scritti nei task.
- CSP: `script-src 'self'`, **mai** `'unsafe-inline'`. Il file nuovo del
  renderer è un `<script src>`: la CSP non cambia.
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
| `lib/clipboard-files.js` | nuovo | buffer degli appunti → percorsi assoluti (GNOME, uri-list, `FileNameW`) |
| `lib/editor-copy.js` | nuovo | `planCopy`, `runCopy`, `numberedName`, `pickProperties` |
| `app/editor.js` | modifica | canali `editor-copy-plan`, `editor-copy-run`, `editor-pick-files`, `editor-clipboard-files` |
| `main.js` | modifica | passa `dialog` e `clipboard` ad `app/editor.js` (nessuna riga in più) |
| `preload.js` | modifica | `editorCopyPlan`, `editorCopyRun`, `editorPickFiles`, `editorClipboardFiles`, `editorPathForFile` |
| `renderer/editor-tree.js` | modifica | drop, evidenziazione, Ctrl+V → `onCopyInto(dir, source)` |
| `renderer/editor-tab.js` | modifica | voci di menu, `showEditorNotice`, `copying`, guardia sul drop fuori dall'albero |
| `renderer/editor-copy-ui.js` | nuovo | sorgenti → piano → domande → copia → esito |
| `renderer/index.html` | modifica | `<script src="editor-copy-ui.js">` dopo `editor-tab.js` |
| `renderer/styles.css` | modifica | `.editor-tree` a tutta altezza, `.is-drop-target`, `.editor-message.is-info` |
| `tests/clipboard-files.test.js` | nuovo | |
| `tests/editor-copy.test.js` | nuovo | |
| `tests/windows.test.js`, `tests/editor-ipc.test.js`, `tests/editor-tree.test.js`, `tests/editor-tab.test.js` | modifica | |

---

### Task 1: percorsi dagli appunti (`lib/clipboard-files.js`)

**File:**
- Crea: `lib/clipboard-files.js`
- Test: `tests/clipboard-files.test.js` (nuovo), `tests/windows.test.js` (in fondo)

**Interfacce:**
- Produce:
  - `filesFromClipboard(read: (format: string) => Buffer, platform?: string) → string[]`
    — percorsi assoluti, senza doppioni; `[]` se negli appunti non ci sono file.
  - `fileUriToPath(uri: string, platform?: string) → string | null`
  - `formatsFor(platform: string) → string[]`

- [ ] **Passo 1: test (rosso)** — `tests/clipboard-files.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { filesFromClipboard, fileUriToPath, formatsFor } = require('../lib/clipboard-files');

/* Gli appunti finti: un buffer per formato, vuoto per gli altri (come fa
   clipboard.readBuffer quando il formato non c'è). */
const board = (formats) => {
  const asked = [];
  const read = (format) => { asked.push(format); return Buffer.from(formats[format] || ''); };
  return { read, asked };
};

ok('fileUriToPath: solo file:// locali, con i %xx decodificati', () => {
  assert.strictEqual(fileUriToPath('file:///tmp/a%20b.txt', 'linux'), '/tmp/a b.txt');
  assert.strictEqual(fileUriToPath('file://localhost/tmp/x', 'linux'), '/tmp/x');
  assert.strictEqual(fileUriToPath('file:///tmp/%C3%A8.txt', 'linux'), '/tmp/è.txt');
  assert.strictEqual(fileUriToPath('http://example.com/a.txt', 'linux'), null);
  assert.strictEqual(fileUriToPath('file://server/share/a.txt', 'linux'), null);
  assert.strictEqual(fileUriToPath('file:///a%2Fb', 'linux'), null);
  assert.strictEqual(fileUriToPath('niente', 'linux'), null);
  assert.strictEqual(fileUriToPath('', 'linux'), null);
});

ok('appunti GNOME: «copy» o «cut» in testa, poi un URI per riga', () => {
  const { read, asked } = board({ 'x-special/gnome-copied-files': 'copy\nfile:///tmp/a.txt\nfile:///tmp/una%20cartella' });
  assert.deepStrictEqual(filesFromClipboard(read, 'linux'), ['/tmp/a.txt', '/tmp/una cartella']);
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files'], 'trovati i file, uri-list non si legge');
  // «Taglia» nel file manager: per noi è comunque una copia
  assert.deepStrictEqual(filesFromClipboard(board({ 'x-special/gnome-copied-files': 'cut\nfile:///tmp/a.txt\n' }).read, 'linux'), ['/tmp/a.txt']);
});

ok('appunti uri-list (KDE e altri): commenti, CRLF, righe non file scartate, doppioni tolti', () => {
  const list = '# copiati da Dolphin\r\nfile:///tmp/a.txt\r\nhttp://example.com/x\r\nfile:///tmp/a.txt\r\n\r\nfile:///tmp/b.txt\r\n';
  const { read, asked } = board({ 'text/uri-list': list });
  assert.deepStrictEqual(filesFromClipboard(read, 'linux'), ['/tmp/a.txt', '/tmp/b.txt']);
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files', 'text/uri-list']);
});

ok('appunti senza file: vuoti, solo testo, o un formato che non si legge', () => {
  assert.deepStrictEqual(filesFromClipboard(board({}).read, 'linux'), []);
  assert.deepStrictEqual(filesFromClipboard(board({ 'text/uri-list': 'https://example.com\n' }).read, 'linux'), []);
  assert.deepStrictEqual(filesFromClipboard(() => { throw new Error('formato sconosciuto'); }, 'linux'), []);
  assert.deepStrictEqual(formatsFor('linux'), ['x-special/gnome-copied-files', 'text/uri-list']);
  assert.deepStrictEqual(formatsFor('darwin'), ['x-special/gnome-copied-files', 'text/uri-list']);
});
```

In fondo a `tests/windows.test.js` (aggiungere in cima
`const { filesFromClipboard, fileUriToPath, formatsFor } = require('../lib/clipboard-files');`
accanto agli altri `require`):

```js
ok('windows: dagli appunti FileNameW (UTF-16, chiuso da zero), solo percorsi assoluti', () => {
  const asked = [];
  const read = (format) => { asked.push(format); return Buffer.from('C:\\Users\\jack\\una foto.png\0', 'utf16le'); };
  assert.deepStrictEqual(filesFromClipboard(read, 'win32'), ['C:\\Users\\jack\\una foto.png']);
  assert.deepStrictEqual(asked, ['FileNameW']);
  assert.deepStrictEqual(formatsFor('win32'), ['FileNameW']);
  assert.deepStrictEqual(filesFromClipboard(() => Buffer.from('relativo.txt\0', 'utf16le'), 'win32'), []);
  assert.deepStrictEqual(filesFromClipboard(() => Buffer.alloc(0), 'win32'), []);
  assert.strictEqual(fileUriToPath('file:///C:/a%20b/x.txt', 'win32'), 'C:\\a b\\x.txt');
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/clipboard-files.test.js tests/windows.test.js`
Atteso: FAIL con `Cannot find module '../lib/clipboard-files'`.

- [ ] **Passo 3: codice** — `lib/clipboard-files.js`:

```js
'use strict';
/* File copiati nel file manager del sistema → percorsi assoluti
 * (docs/plans/61). Puro: riceve chi legge gli appunti (`read(format)` →
 * Buffer; in app/editor.js è clipboard.readBuffer) e la piattaforma.
 * Formati: GNOME `x-special/gnome-copied-files` («copy»/«cut» e un URI per
 * riga), `text/uri-list` (KDE e altri), `FileNameW` su Windows (UTF-16LE,
 * un solo file: è quello che Electron sa leggere). */
const path = require('path');
const { fileURLToPath } = require('url');

const GNOME = 'x-special/gnome-copied-files';
const URI_LIST = 'text/uri-list';
const WINDOWS = 'FileNameW';

const formatsFor = (platform) => (platform === 'win32' ? [WINDOWS] : [GNOME, URI_LIST]);

/** Un URI `file://` locale → percorso assoluto; null per tutto il resto. */
function fileUriToPath(uri, platform = process.platform) {
  const windows = platform === 'win32';
  try {
    const url = new URL(String(uri).trim());
    if (url.protocol !== 'file:') return null;
    if (url.hostname && url.hostname !== 'localhost') return null; // solo file locali
    const p = fileURLToPath(url, { windows });
    return (windows ? path.win32 : path.posix).isAbsolute(p) ? p : null;
  } catch {
    return null; // non è un URI, o un %2F nel percorso: non è un file nostro
  }
}

const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function gnomeLines(text) {
  const all = lines(text);
  return all[0] === 'copy' || all[0] === 'cut' ? all.slice(1) : all;
}

function pathsFrom(format, buf, platform) {
  if (!buf || !buf.length) return [];
  if (format === WINDOWS) {
    return buf.toString('utf16le').split('\0').map((s) => s.trim()).filter((p) => p && path.win32.isAbsolute(p));
  }
  const text = buf.toString('utf8').replace(/\0/g, '');
  const uris = format === GNOME ? gnomeLines(text) : lines(text).filter((l) => !l.startsWith('#'));
  return uris.map((u) => fileUriToPath(u, platform)).filter(Boolean);
}

/**
 * @param {(format: string) => Buffer} read
 * @param {string} [platform]
 * @returns {string[]} percorsi assoluti, senza doppioni; il primo formato con dei file vince
 */
function filesFromClipboard(read, platform = process.platform) {
  for (const format of formatsFor(platform)) {
    let buf;
    try {
      buf = read(format);
    } catch (e) {
      console.warn('[clipboard-files]', format, e && e.message); // formato non supportato: si prova il prossimo
      continue;
    }
    const paths = pathsFrom(format, buf, platform);
    if (paths.length) return [...new Set(paths)];
  }
  return [];
}

module.exports = { filesFromClipboard, fileUriToPath, formatsFor };
```

- [ ] **Passo 4: verde**

Run: `node --test tests/clipboard-files.test.js tests/windows.test.js`
Atteso: PASS. Poi `npm run test:unit`: PASS (il test «lib/ senza electron»
copre il file nuovo da solo).

- [ ] **Passo 5: commit**

```bash
git add lib/clipboard-files.js tests/clipboard-files.test.js tests/windows.test.js
cat > /tmp/msg.txt <<'EOF'
feat: percorsi dei file copiati negli appunti del sistema

«Incolla» nell'albero dell'editor (piano 61) deve sapere quali file sono
stati copiati nel file manager. Ogni sistema li scrive in un formato suo
(GNOME, uri-list, FileNameW): qui si traducono in percorsi assoluti, solo
file locali, in un modulo puro che si prova senza Electron.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 2: il piano della copia (`lib/editor-copy.js`, `planCopy`)

**File:**
- Crea: `lib/editor-copy.js`
- Test: `tests/editor-copy.test.js` (nuovo), `tests/windows.test.js` (in fondo)

**Interfacce:**
- Consuma: `createEditorFs({ root })` di `lib/editor-fs.js` →
  `resolveInside(rel)` (percorso reale; lancia un errore con
  `code: 'EOUTSIDE'` se esce dalla radice); `isInside(root, target, platform)`
  di `lib/editor-paths.js` (vero se `target` è `root` o sta sotto).
- Produce:
  - `createEditorCopy({ editorFs, trash, platform?, maxFiles?, maxBytes? })`
    → `{ planCopy }` (il Task 3 aggiunge `runCopy`).
  - `planCopy(sources: string[], destRel: string)` →
    `{ ok: true, items: [{name, kind}], conflicts: [{name, kind, existingKind}], count, bytes }`
    oppure `{ ok: false, error }`. `kind`: `'file' | 'dir' | 'link'`.
    `count` = elementi contati ricorsivamente, `bytes` = somma dei file.
  - `numberedName(name, n, isDir)`, `pickProperties(platform)`,
    `MAX_FILES`, `MAX_BYTES`.

- [ ] **Passo 1: test (rosso)** — `tests/editor-copy.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createEditorFs } = require('../lib/editor-fs');
const { createEditorCopy, numberedName, pickProperties, MAX_FILES, MAX_BYTES } = require('../lib/editor-copy');

/* Una radice (la cartella della sessione), una cartella «fuori» coi
   sorgenti, e un cestino finto che sposta invece di cancellare. */
function setup(t, opts = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-copy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  const out = path.join(base, 'fuori');
  const bin = path.join(base, 'cestino');
  for (const d of [root, out, bin]) fs.mkdirSync(d);
  const trashed = [];
  const trash = async (p) => { trashed.push(p); fs.renameSync(p, path.join(bin, `${trashed.length}-${path.basename(p)}`)); };
  const copy = createEditorCopy({ editorFs: createEditorFs({ root }), trash, platform: 'linux', ...opts });
  const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  return { root, out, trashed, copy, write };
}

ok('numberedName: il numero prima dell estensione, non nei file col punto davanti né nelle cartelle', () => {
  assert.strictEqual(numberedName('a.txt', 2, false), 'a (2).txt');
  assert.strictEqual(numberedName('a.tar.gz', 3, false), 'a.tar (3).gz');
  assert.strictEqual(numberedName('.env', 2, false), '.env (2)');
  assert.strictEqual(numberedName('Makefile', 2, false), 'Makefile (2)');
  assert.strictEqual(numberedName('v1.2', 2, true), 'v1.2 (2)');
  assert.deepStrictEqual(pickProperties('linux'), ['openFile', 'multiSelections']);
  assert.deepStrictEqual(pickProperties('darwin'), ['openFile', 'openDirectory', 'multiSelections']);
  assert.strictEqual(MAX_FILES, 10000);
  assert.strictEqual(MAX_BYTES, 1024 ** 3);
});

ok('planCopy: file e cartelle senza conflitti, contati ricorsivamente, senza scrivere', async (t) => {
  const { root, out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'), 'ciao');
  write(path.join(out, 'd', 'x.txt'), '12345');
  write(path.join(out, 'd', 'sub', 'y.txt'), '1');
  const plan = await copy.planCopy([a, path.join(out, 'd')], '');
  assert.deepStrictEqual(plan, {
    ok: true,
    items: [{ name: 'a.txt', kind: 'file' }, { name: 'd', kind: 'dir' }],
    conflicts: [],
    count: 5, // a.txt, d, d/x.txt, d/sub, d/sub/y.txt
    bytes: 10,
  });
  assert.deepStrictEqual(fs.readdirSync(root), []);
});

ok('planCopy: i conflitti sono quelli di primo livello e dicono cosa c è già', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(root, 'src', 'a.txt'));
  fs.mkdirSync(path.join(root, 'src', 'd'));
  write(path.join(out, 'd', 'x.txt'));
  const sources = [write(path.join(out, 'a.txt')), path.join(out, 'd'), write(path.join(out, 'b.txt'))];
  const plan = await copy.planCopy(sources, 'src');
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual(plan.conflicts, [
    { name: 'a.txt', kind: 'file', existingKind: 'file' },
    { name: 'd', kind: 'dir', existingKind: 'dir' },
  ]);
});

ok('planCopy: destinazione fuori dalla radice, inesistente o file si rifiuta', async (t) => {
  const { root, out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'));
  write(path.join(root, 'f.txt'));
  assert.strictEqual((await copy.planCopy([a], '../fuori')).ok, false);
  fs.symlinkSync(out, path.join(root, 'link'));
  assert.deepStrictEqual(await copy.planCopy([a], 'link'), { ok: false, error: 'Il percorso esce dalla cartella della sessione.' });
  assert.deepStrictEqual(await copy.planCopy([a], 'f.txt'), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.planCopy([a], 'manca'), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.planCopy([a], 42), { ok: false, error: 'La destinazione non è una cartella.' });
});

ok('planCopy: sorgenti mancanti, relativi, inesistenti, troppi o la radice del disco si rifiutano', async (t) => {
  const { out, copy } = setup(t);
  for (const sources of [undefined, [], 'a', [42], ['relativo.txt']]) {
    assert.strictEqual((await copy.planCopy(sources, '')).ok, false, JSON.stringify(sources));
  }
  assert.deepStrictEqual(await copy.planCopy([], ''), { ok: false, error: 'Niente da copiare.' });
  assert.deepStrictEqual(await copy.planCopy(['relativo.txt'], ''), { ok: false, error: 'Percorso non valido.' });
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'no.txt')], ''), { ok: false, error: '«no.txt» non esiste più.' });
  assert.deepStrictEqual(await copy.planCopy(['/'], ''), { ok: false, error: 'Non si copia la radice di un disco.' });
  const many = Array.from({ length: 1001 }, (_, i) => path.join(out, `f${i}`));
  assert.deepStrictEqual(await copy.planCopy(many, ''), { ok: false, error: 'Troppi elementi: più di 1000.' });
});

ok('planCopy: due sorgenti con lo stesso nome si rifiutano; lo stesso percorso due volte conta una', async (t) => {
  const { out, copy, write } = setup(t);
  const a = write(path.join(out, 'x', 'a.txt'));
  const b = write(path.join(out, 'y', 'a.txt'));
  assert.deepStrictEqual(await copy.planCopy([a, b], ''), { ok: false, error: 'Due elementi si chiamano «a.txt»: copiali uno alla volta.' });
  assert.deepStrictEqual((await copy.planCopy([a, a + '/'], '')).items, [{ name: 'a.txt', kind: 'file' }]);
});

ok('planCopy: una cartella non si copia dentro se stessa né in una sua sottocartella', async (t) => {
  const { root, copy, write } = setup(t);
  write(path.join(root, 'd', 'sub', 'x.txt'));
  const d = path.join(root, 'd');
  assert.deepStrictEqual(await copy.planCopy([d], 'd/sub'), { ok: false, error: '«d» non si copia dentro se stessa.' });
  assert.deepStrictEqual(await copy.planCopy([d], 'd'), { ok: false, error: '«d» non si copia dentro se stessa.' });
  assert.strictEqual((await copy.planCopy([path.join(d, 'sub')], '')).ok, true, 'una sottocartella verso la radice va bene');
});

ok('planCopy: oltre i limiti di elementi o di byte si rifiuta prima di copiare', async (t) => {
  const { out, copy, write } = setup(t, { maxFiles: 3, maxBytes: 10 });
  for (const n of ['a', 'b', 'c']) write(path.join(out, 'd', n), '123');
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'd')], ''), { ok: false, error: 'Troppi file e cartelle: più di 3.' });
  const big = write(path.join(out, 'grande.bin'), '12345678901');
  assert.deepStrictEqual(await copy.planCopy([big], ''), { ok: false, error: 'Troppo grande: più di 10 byte.' });
});

ok('planCopy: i link non si seguono, né per contare né per girare in tondo', async (t) => {
  const { out, copy, write } = setup(t, { maxFiles: 3 });
  for (const n of ['1', '2', '3', '4', '5']) write(path.join(out, 'grande', n));
  fs.mkdirSync(path.join(out, 'd'));
  fs.symlinkSync(path.join(out, 'grande'), path.join(out, 'd', 'link'));
  fs.symlinkSync(out, path.join(out, 'd', 'giro'));
  const plan = await copy.planCopy([path.join(out, 'd')], '');
  assert.strictEqual(plan.ok, true, plan.error);
  assert.strictEqual(plan.count, 3); // d, d/link, d/giro
});

ok('planCopy: un file speciale (pipe) dentro una cartella si rifiuta', async (t) => {
  if (process.platform === 'win32') return t.skip('niente mkfifo');
  const { out, copy } = setup(t);
  fs.mkdirSync(path.join(out, 'd'));
  execFileSync('mkfifo', [path.join(out, 'd', 'tubo')]);
  assert.deepStrictEqual(await copy.planCopy([path.join(out, 'd')], ''), { ok: false, error: '«tubo» non è un file né una cartella.' });
});
```

In fondo a `tests/windows.test.js` (in cima, accanto agli altri `require`:
`const { createEditorFs } = require('../lib/editor-fs');` e
`const { createEditorCopy, pickProperties } = require('../lib/editor-copy');`
— `fs`, `os`, `path` ci sono già):

```js
ok('windows: editor-copy confronta i nomi senza maiuscole e il dialog offre solo file', async (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-wcopy-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  fs.mkdirSync(root);
  for (const d of ['x', 'y']) fs.mkdirSync(path.join(base, d));
  fs.writeFileSync(path.join(base, 'x', 'A.txt'), '');
  fs.writeFileSync(path.join(base, 'y', 'a.txt'), '');
  const copy = createEditorCopy({ editorFs: createEditorFs({ root }), trash: async () => {}, platform: 'win32' });
  const r = await copy.planCopy([path.join(base, 'x', 'A.txt'), path.join(base, 'y', 'a.txt')], '');
  assert.deepStrictEqual(r, { ok: false, error: 'Due elementi si chiamano «a.txt»: copiali uno alla volta.' });
  assert.deepStrictEqual(pickProperties('win32'), ['openFile', 'multiSelections']);
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/editor-copy.test.js tests/windows.test.js`
Atteso: FAIL con `Cannot find module '../lib/editor-copy'`.

- [ ] **Passo 3: codice** — `lib/editor-copy.js`:

```js
'use strict';
/* Copiare file e cartelle da fuori dentro la cartella della sessione editor
 * (docs/plans/61). Due fasi: planCopy controlla e trova i conflitti,
 * runCopy (Task 3) copia con le decisioni dell'utente. Fra le due il disco
 * può cambiare: runCopy rifà i controlli. I link non si seguono mai. Mai
 * sovrascrivere: chi sostituisce passa da `trash` (shell.trashItem). */
const fs = require('fs');
const path = require('path');
const { isInside } = require('./editor-paths');

const MAX_FILES = 10000;
const MAX_BYTES = 1024 ** 3;
const MAX_SOURCES = 1000;
const MAX_NUMBERED = 1000;

const MESSAGES = {
  EOUTSIDE: 'Il percorso esce dalla cartella della sessione.',
  ENOENT: 'Non esiste più.',
  ENOTDIR: 'Non esiste più.',
  EACCES: 'Permesso negato.',
  EPERM: 'Permesso negato.',
  ENOSPC: 'Disco pieno.',
  EEXIST: 'Esiste già.',
};

/** Un errore il cui messaggio è già per l'utente. */
function userError(message) {
  const e = new Error(message);
  e.code = 'EUSER';
  return e;
}

const messageOf = (e) => (e && e.code === 'EUSER' ? e.message : MESSAGES[e && e.code] || String((e && e.message) || e));

// Su Windows e macOS i nomi che differiscono solo per le maiuscole sono lo stesso file
const foldName = (name, platform) => (platform === 'win32' || platform === 'darwin' ? name.toLowerCase() : name);

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${+(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n} byte`;
}

/** «a.txt» → «a (2).txt»; «.env» e le cartelle prendono il numero in fondo. */
function numberedName(name, n, isDir) {
  const dot = isDir ? -1 : name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Linux e Windows non mescolano file e cartelle nella stessa finestra di scelta. */
const pickProperties = (platform) => (platform === 'darwin'
  ? ['openFile', 'openDirectory', 'multiSelections']
  : ['openFile', 'multiSelections']);

function kindOf(info) {
  if (info.isSymbolicLink()) return 'link';
  if (info.isDirectory()) return 'dir';
  if (info.isFile()) return 'file';
  return 'other';
}

async function lstatOrNull(abs) {
  try {
    return await fs.promises.lstat(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

/**
 * @param {{editorFs: {resolveInside: (rel: string) => string},
 *   trash: (absPath: string) => Promise<void>, platform?: string,
 *   maxFiles?: number, maxBytes?: number}} opts
 */
function createEditorCopy({ editorFs, trash, platform = process.platform, maxFiles = MAX_FILES, maxBytes = MAX_BYTES }) {
  async function destination(rel) {
    if (typeof rel !== 'string') throw userError('La destinazione non è una cartella.');
    const abs = editorFs.resolveInside(rel); // lancia EOUTSIDE
    const info = await fs.promises.stat(abs).catch(() => null);
    if (!info || !info.isDirectory()) throw userError('La destinazione non è una cartella.');
    return abs;
  }

  /** I sorgenti validati; con `missingOk` uno sparito resta con `kind: null`. */
  async function sourceEntries(sources, { missingOk = false } = {}) {
    if (!Array.isArray(sources) || !sources.length) throw userError('Niente da copiare.');
    if (sources.length > MAX_SOURCES) throw userError(`Troppi elementi: più di ${MAX_SOURCES}.`);
    const entries = [];
    const names = new Set();
    for (const raw of sources) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) throw userError('Percorso non valido.');
      const abs = path.resolve(raw);
      if (entries.some((e) => e.abs === abs)) continue;
      const name = path.basename(abs);
      if (!name) throw userError('Non si copia la radice di un disco.');
      const key = foldName(name, platform);
      if (names.has(key)) throw userError(`Due elementi si chiamano «${name}»: copiali uno alla volta.`);
      names.add(key);
      const info = await lstatOrNull(abs);
      if (!info && !missingOk) throw userError(`«${name}» non esiste più.`);
      entries.push({ abs, name, kind: info ? kindOf(info) : null });
    }
    return entries;
  }

  /** Conta senza seguire i link; si ferma appena passa un limite. */
  async function measure(entries) {
    let count = 0;
    let bytes = 0;
    const stack = entries.map((e) => e.abs);
    while (stack.length) {
      const abs = stack.pop();
      const info = await fs.promises.lstat(abs);
      const kind = kindOf(info);
      if (kind === 'other') throw userError(`«${path.basename(abs)}» non è un file né una cartella.`);
      count += 1;
      if (kind === 'file') bytes += info.size;
      if (count > maxFiles) throw userError(`Troppi file e cartelle: più di ${maxFiles}.`);
      if (bytes > maxBytes) throw userError(`Troppo grande: più di ${formatBytes(maxBytes)}.`);
      if (kind === 'dir') for (const name of await fs.promises.readdir(abs)) stack.push(path.join(abs, name));
    }
    return { count, bytes };
  }

  /** Tutti i controlli: li fa il piano e li rifà la copia. */
  async function checked(sources, destRel, { missingOk = false } = {}) {
    const dest = await destination(destRel);
    const entries = await sourceEntries(sources, { missingOk });
    const present = entries.filter((e) => e.kind);
    for (const e of present) {
      if (e.kind === 'dir' && isInside(await fs.promises.realpath(e.abs), dest, platform)) {
        throw userError(`«${e.name}» non si copia dentro se stessa.`);
      }
    }
    return { dest, entries, ...(await measure(present)) };
  }

  async function planCopy(sources, destRel) {
    try {
      const { dest, entries, count, bytes } = await checked(sources, destRel);
      const conflicts = [];
      for (const e of entries) {
        const existing = await lstatOrNull(path.join(dest, e.name));
        if (existing) conflicts.push({ name: e.name, kind: e.kind, existingKind: kindOf(existing) });
      }
      return { ok: true, items: entries.map(({ name, kind }) => ({ name, kind })), conflicts, count, bytes };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  }

  return { planCopy };
}

module.exports = { createEditorCopy, numberedName, pickProperties, MAX_FILES, MAX_BYTES };
```

`trash` e `MAX_NUMBERED` li usa il Task 3: per ora restano lì (il Task 3
segue subito, nello stesso branch).

- [ ] **Passo 4: verde**

Run: `node --test tests/editor-copy.test.js tests/windows.test.js`
Atteso: PASS. Poi `npm run test:unit`: PASS.

- [ ] **Passo 5: commit**

```bash
git add lib/editor-copy.js tests/editor-copy.test.js tests/windows.test.js
cat > /tmp/msg.txt <<'EOF'
feat: piano della copia di file da fuori nell'albero dell'editor

Prima di copiare il main controlla tutto (destinazione dentro la radice,
sorgenti assoluti ed esistenti, nomi doppi, cartella dentro se stessa,
limiti di 10.000 elementi e 1 GB senza seguire i link) e restituisce i
conflitti: le domande all'utente si fanno nel renderer, prima di toccare
il disco (piano 61).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 3: la copia (`runCopy`)

**File:**
- Modifica: `lib/editor-copy.js`
- Test: `tests/editor-copy.test.js` (in fondo)

**Interfacce:**
- Consuma: quello del Task 2 (`checked`, `lstatOrNull`, `kindOf`,
  `numberedName`, `userError`, `messageOf`, `MESSAGES`, `MAX_NUMBERED`).
- Produce: `runCopy({ sources, destRel }, decisions)` →
  `{ ok: true, copied, skipped, failed: [{ name, error }] }` oppure
  `{ ok: false, error }` (controlli non passati: niente è stato copiato).
  `decisions`: `{ [name]: 'replace' | 'keep-both' | 'skip' }`; una
  decisione mancante o sconosciuta vale `'keep-both'`.
  `createEditorCopy(...)` restituisce `{ planCopy, runCopy }`.

- [ ] **Passo 1: test (rosso)** — in fondo a `tests/editor-copy.test.js`:

```js
ok('runCopy: copia file e cartelle col contenuto, i link come link', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(out, 'a.txt'), 'ciao');
  write(path.join(out, 'd', 'sub', 'y.txt'), 'y');
  fs.symlinkSync('sub/y.txt', path.join(out, 'd', 'link'));
  const r = await copy.runCopy({ sources: [path.join(out, 'a.txt'), path.join(out, 'd')], destRel: '' }, {});
  assert.deepStrictEqual(r, { ok: true, copied: 2, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao');
  assert.strictEqual(fs.readFileSync(path.join(root, 'd', 'sub', 'y.txt'), 'utf8'), 'y');
  assert.strictEqual(fs.readlinkSync(path.join(root, 'd', 'link')), 'sub/y.txt');
  assert.strictEqual(fs.readFileSync(path.join(out, 'a.txt'), 'utf8'), 'ciao', 'l originale resta');
});

ok('runCopy: sostituisci passa dal cestino, tieni entrambi prende il primo nome libero, salta non tocca', async (t) => {
  const { root, out, copy, write, trashed } = setup(t);
  write(path.join(root, 'a.txt'), 'vecchio a');
  write(path.join(root, 'b.txt'), 'vecchio b');
  write(path.join(root, 'b (2).txt'), 'occupato');
  write(path.join(root, 'c.txt'), 'vecchio c');
  const sources = ['a.txt', 'b.txt', 'c.txt'].map((n) => write(path.join(out, n), `nuovo ${n}`));
  const r = await copy.runCopy({ sources, destRel: '' }, { 'a.txt': 'replace', 'b.txt': 'keep-both', 'c.txt': 'skip' });
  assert.deepStrictEqual(r, { ok: true, copied: 2, skipped: 1, failed: [] });
  assert.deepStrictEqual(trashed, [path.join(root, 'a.txt')]);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'nuovo a.txt');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'vecchio b');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b (2).txt'), 'utf8'), 'occupato');
  assert.strictEqual(fs.readFileSync(path.join(root, 'b (3).txt'), 'utf8'), 'nuovo b.txt');
  assert.strictEqual(fs.readFileSync(path.join(root, 'c.txt'), 'utf8'), 'vecchio c');
});

ok('runCopy: senza decisione, o con una sconosciuta, tiene entrambi; una cartella prende «d (2)»', async (t) => {
  const { root, out, copy, write } = setup(t);
  write(path.join(root, 'x.txt'), 'vecchio');
  write(path.join(root, 'd', 'vecchio.txt'));
  const sources = [write(path.join(out, 'x.txt'), 'nuovo'), path.dirname(write(path.join(out, 'd', 'nuovo.txt')))];
  assert.deepStrictEqual(await copy.runCopy({ sources, destRel: '' }, { d: 'boh' }), { ok: true, copied: 2, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'x (2).txt'), 'utf8'), 'nuovo');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'd (2)')), ['nuovo.txt']);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'd')), ['vecchio.txt']);
  assert.strictEqual((await copy.runCopy({ sources: [sources[0]], destRel: '' })).copied, 1, 'decisions assenti');
  assert.ok(fs.existsSync(path.join(root, 'x (3).txt')));
});

ok('runCopy: un sorgente sparito dopo il piano è un errore suo, gli altri si copiano', async (t) => {
  const { root, out, copy, write } = setup(t);
  const sources = [write(path.join(out, 'a.txt')), write(path.join(out, 'b.txt'))];
  assert.strictEqual((await copy.planCopy(sources, '')).ok, true);
  fs.rmSync(sources[1]);
  assert.deepStrictEqual(await copy.runCopy({ sources, destRel: '' }, {}), { ok: true, copied: 1, skipped: 0, failed: [{ name: 'b.txt', error: 'Non esiste più.' }] });
  assert.deepStrictEqual(fs.readdirSync(root), ['a.txt']);
});

ok('runCopy: sostituire un elemento con se stesso fa una copia accanto, non lo cestina', async (t) => {
  const { root, copy, write, trashed } = setup(t);
  const a = write(path.join(root, 'a.txt'), 'mio');
  assert.deepStrictEqual(await copy.runCopy({ sources: [a], destRel: '' }, { 'a.txt': 'replace' }), { ok: true, copied: 1, skipped: 0, failed: [] });
  assert.deepStrictEqual(trashed, []);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a (2).txt'), 'utf8'), 'mio');
});

ok('runCopy: non si sostituisce una cartella che contiene il sorgente', async (t) => {
  const { root, copy, write, trashed } = setup(t);
  write(path.join(root, 'd', 'd', 'x.txt'));
  const r = await copy.runCopy({ sources: [path.join(root, 'd', 'd')], destRel: '' }, { d: 'replace' });
  assert.deepStrictEqual(r, { ok: true, copied: 0, skipped: 0, failed: [{ name: 'd', error: 'Sta dentro l\'elemento da sostituire.' }] });
  assert.deepStrictEqual(trashed, []);
  assert.ok(fs.existsSync(path.join(root, 'd', 'd', 'x.txt')));
});

ok('runCopy: rifà i controlli del piano', async (t) => {
  const { out, copy, write } = setup(t);
  const a = write(path.join(out, 'a.txt'));
  assert.strictEqual((await copy.runCopy({ sources: [a], destRel: '../fuori' }, {})).ok, false);
  assert.deepStrictEqual(await copy.runCopy({}, {}), { ok: false, error: 'La destinazione non è una cartella.' });
  assert.deepStrictEqual(await copy.runCopy({ sources: [], destRel: '' }, {}), { ok: false, error: 'Niente da copiare.' });
  assert.deepStrictEqual(await copy.runCopy(undefined, undefined), { ok: false, error: 'La destinazione non è una cartella.' });
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/editor-copy.test.js`
Atteso: FAIL con `copy.runCopy is not a function`.

- [ ] **Passo 3: codice** — in `lib/editor-copy.js`:

Sopra `createEditorCopy` (funzioni che non dipendono dalla factory):

```js
const DECISIONS = new Set(['replace', 'keep-both', 'skip']);

function decisionFor(decisions, name) {
  const d = decisions && Object.prototype.hasOwnProperty.call(decisions, name) ? decisions[name] : null;
  return DECISIONS.has(d) ? d : 'keep-both';
}

/** Copia ricorsiva che non sovrascrive mai: i link si ricreano come link. */
async function copyEntry(from, to) {
  const info = await fs.promises.lstat(from);
  if (info.isSymbolicLink()) {
    const target = await fs.promises.readlink(from);
    // Il tipo serve solo a Windows, che distingue i link a cartelle
    const isDir = await fs.promises.stat(from).then((s) => s.isDirectory(), () => false);
    await fs.promises.symlink(target, to, isDir ? 'dir' : 'file');
    return;
  }
  if (info.isDirectory()) {
    await fs.promises.mkdir(to);
    for (const name of await fs.promises.readdir(from)) await copyEntry(path.join(from, name), path.join(to, name));
    return;
  }
  if (!info.isFile()) throw userError(`«${path.basename(from)}» non è un file né una cartella.`);
  await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
}

async function freeName(dest, name, isDir) {
  for (let n = 2; n <= MAX_NUMBERED; n += 1) {
    const candidate = path.join(dest, numberedName(name, n, isDir));
    if (!(await lstatOrNull(candidate))) return candidate;
  }
  throw userError('Nessun nome libero.');
}

async function sameEntry(abs, existing) {
  const info = await fs.promises.lstat(abs);
  return info.ino === existing.ino && info.dev === existing.dev;
}
```

Dentro `createEditorCopy`, dopo `planCopy`:

```js
  /** Un elemento di primo livello → 'copied' | 'skipped'; lancia se fallisce. */
  async function copyOne(entry, dest, decision) {
    const target = path.join(dest, entry.name);
    const existing = await lstatOrNull(target);
    if (!existing) {
      await copyEntry(entry.abs, target);
      return 'copied';
    }
    if (decision === 'skip') return 'skipped';
    // Sostituire un elemento con se stesso lo cestinerebbe: si tiene entrambi
    if (decision === 'replace' && !(await sameEntry(entry.abs, existing))) {
      if (existing.isDirectory() && isInside(target, await fs.promises.realpath(entry.abs), platform)) {
        throw userError('Sta dentro l\'elemento da sostituire.');
      }
      await trash(target);
      await copyEntry(entry.abs, target);
      return 'copied';
    }
    await copyEntry(entry.abs, await freeName(dest, entry.name, entry.kind === 'dir'));
    return 'copied';
  }

  async function runCopy({ sources, destRel } = {}, decisions = {}) {
    let plan;
    try {
      plan = await checked(sources, destRel, { missingOk: true });
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
    let copied = 0;
    let skipped = 0;
    const failed = [];
    // Un errore su un elemento non ferma gli altri
    for (const entry of plan.entries) {
      if (!entry.kind) {
        failed.push({ name: entry.name, error: MESSAGES.ENOENT });
        continue;
      }
      try {
        const outcome = await copyOne(entry, plan.dest, decisionFor(decisions, entry.name));
        if (outcome === 'copied') copied += 1; else skipped += 1;
      } catch (e) {
        console.error('[editor-copy]', entry.abs, e);
        failed.push({ name: entry.name, error: messageOf(e) });
      }
    }
    return { ok: true, copied, skipped, failed };
  }

  return { planCopy, runCopy };
```

(e togliere il vecchio `return { planCopy };`).

- [ ] **Passo 4: verde**

Run: `node --test tests/editor-copy.test.js tests/windows.test.js`
Atteso: PASS. Poi `npm run test:unit`: PASS.

- [ ] **Passo 5: commit**

```bash
git add lib/editor-copy.js tests/editor-copy.test.js
cat > /tmp/msg.txt <<'EOF'
feat: copia con le decisioni sui conflitti, senza sovrascrivere

runCopy rifà i controlli del piano (fra le due fasi il disco cambia) e
copia: «Sostituisci» manda l'esistente nel cestino, «Tieni entrambi»
prende il primo «nome (N)» libero, «Salta» non tocca. File con
COPYFILE_EXCL, cartelle con mkdir non ricorsivo, link ricreati: niente
viene sovrascritto per sbaglio. Un errore su un elemento non ferma gli
altri (piano 61).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 4: canali IPC, preload e `main.js`

**File:**
- Modifica: `app/editor.js`, `preload.js`, `main.js` (righe 1 e 229)
- Test: `tests/editor-ipc.test.js`

**Interfacce:**
- Consuma: `createEditorCopy`, `pickProperties` (Task 2-3),
  `filesFromClipboard` (Task 1).
- Produce (canali, payload → risposta):
  - `editor-copy-plan` `{root, rel, sources}` → risposta di `planCopy`
  - `editor-copy-run` `{root, rel, sources, decisions}` → risposta di `runCopy`
  - `editor-pick-files` → `{ ok: true, paths: string[] }` (`[]` se annullato)
  - `editor-clipboard-files` → `{ ok: true, paths: string[] }`
  - Errori imprevisti: `{ ok: false, error: 'editor: …' }` (il `guard` che c'è già).
- Produce (preload, `window.aisess`):
  - `editorCopyPlan(root, rel, sources)`, `editorCopyRun(root, rel, sources, decisions)`,
    `editorPickFiles()`, `editorClipboardFiles()` → Promise della risposta sopra
  - `editorPathForFile(file: File) → string` (sincrona; `''` se il file non è sul disco)
- `registerEditorHandlers(ipcMain, opts)`: `opts.electron` ora porta anche
  `dialog` e `clipboard`; opzione nuova `platform` (default `process.platform`).

- [ ] **Passo 1: test (rosso)** — in `tests/editor-ipc.test.js`:

`setup` deve poter aggiungere pezzi di `electron` senza buttare via quelli
di base. Sostituire la funzione `setup` con:

```js
function setup(t, { electron: more = {}, ...extra } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edipc-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edroot-')));
  t.after(() => { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const trashed = [];
  const app = Object.assign(new EventEmitter(), { quit() {}, getPath: () => userData });
  registerEditorHandlers(ipcMain, {
    electron: { app, shell: {}, BrowserWindow: { fromWebContents: () => null }, ...more },
    trash: async (p) => { trashed.push(p); },
    ...extra,
  });
  const sender = Object.assign(new EventEmitter(), { id: 7, sent: [], isDestroyed: () => false, send(ch, v) { this.sent.push([ch, v]); } });
  const call = (channel, payload) => handlers.get(channel)({ sender }, payload);
  return { handlers, call, root, trashed, sender, app };
}
```

Nel test `'ipc editor: payload mancanti o radici inesistenti rispondono con un errore'`
aggiungere `'editor-copy-plan', 'editor-copy-run'` alla lista dei canali.

In fondo al file:

```js
ok('ipc editor: piano e copia da fuori arrivano nella cartella della sessione', async (t) => {
  const { call, root } = setup(t);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aisess-edout-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const a = path.join(out, 'a.txt');
  fs.writeFileSync(a, 'ciao');
  const plan = await call('editor-copy-plan', { root, rel: '', sources: [a] });
  assert.strictEqual(plan.ok, true, plan.error);
  assert.deepStrictEqual(plan.conflicts, []);
  assert.deepStrictEqual(await call('editor-copy-run', { root, rel: '', sources: [a], decisions: {} }), { ok: true, copied: 1, skipped: 0, failed: [] });
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'ciao');
  assert.deepStrictEqual((await call('editor-copy-plan', { root, rel: '', sources: [a] })).conflicts, [{ name: 'a.txt', kind: 'file', existingKind: 'file' }]);
  assert.strictEqual((await call('editor-copy-plan', { root, rel: '../', sources: [a] })).ok, false);
});

ok('ipc editor: «Copia qui file…» apre il dialog del sistema sulla finestra di chi chiede', async (t) => {
  const shown = [];
  let answer = { canceled: false, filePaths: ['/x/a.txt', '/x/b'] };
  const win = { id: 'finestra' };
  const { call } = setup(t, {
    platform: 'linux',
    electron: {
      BrowserWindow: { fromWebContents: (wc) => (wc.id === 7 ? win : null) },
      dialog: { showOpenDialog: async (...args) => { shown.push(args); return answer; } },
    },
  });
  assert.deepStrictEqual(await call('editor-pick-files'), { ok: true, paths: ['/x/a.txt', '/x/b'] });
  assert.strictEqual(shown[0][0], win);
  assert.deepStrictEqual(shown[0][1].properties, ['openFile', 'multiSelections']);
  assert.strictEqual(shown[0][1].buttonLabel, 'Copia qui');
  answer = { canceled: true, filePaths: [] };
  assert.deepStrictEqual(await call('editor-pick-files'), { ok: true, paths: [] });
});

ok('ipc editor: «Incolla» legge i file dagli appunti nel main', async (t) => {
  const asked = [];
  const readBuffer = (format) => {
    asked.push(format);
    return format === 'x-special/gnome-copied-files' ? Buffer.from('copy\nfile:///tmp/a%20b.txt') : Buffer.alloc(0);
  };
  const { call } = setup(t, { platform: 'linux', electron: { clipboard: { readBuffer } } });
  assert.deepStrictEqual(await call('editor-clipboard-files'), { ok: true, paths: ['/tmp/a b.txt'] });
  assert.deepStrictEqual(asked, ['x-special/gnome-copied-files']);
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/editor-ipc.test.js`
Atteso: FAIL (`handlers.get(...) is not a function` sui canali nuovi; il
test «ogni canale editor del preload» passa ancora: il preload non è
cambiato).

- [ ] **Passo 3: codice**

`app/editor.js` — in cima, accanto agli altri `require`:

```js
const { createEditorCopy, pickProperties } = require('../lib/editor-copy');
const { filesFromClipboard } = require('../lib/clipboard-files');
```

Nel JSDoc di `registerEditorHandlers` il tipo di `electron` diventa
`{app, shell, BrowserWindow, dialog?: Electron.Dialog, clipboard?: Electron.Clipboard}`
e si aggiunge `platform?: string` alle opzioni. Firma:

```js
function registerEditorHandlers(ipcMain, {
  electron,
  onQuitCancelled,
  userDataDir = () => electron.app.getPath('userData'),
  trash = (p) => electron.shell.trashItem(p),
  platform = process.platform,
} = {}) {
```

Dopo `const files = (root) => createEditorFs({ root });`:

```js
  const copier = (root) => createEditorCopy({ editorFs: files(root), trash, platform });
```

Prima del commento `// Schede editor da riaprire`:

```js
  // Copiare da fuori (docs/plans/61): il piano trova i conflitti, il
  // renderer chiede, la copia rifà i controlli e copia
  ipcMain.handle('editor-copy-plan', guard(({ root, rel, sources }) => copier(root).planCopy(sources, rel)));
  ipcMain.handle('editor-copy-run', guard(({ root, rel, sources, decisions }) => copier(root).runCopy({ sources, destRel: rel }, decisions)));
  // Percorsi scelti nella finestra del sistema o copiati nel file manager:
  // tornano al renderer, che li manda al piano come quelli del drop
  ipcMain.handle('editor-pick-files', guard(async (_payload, event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    const opts = { title: 'Copia qui', buttonLabel: 'Copia qui', properties: pickProperties(platform) };
    const r = await (win ? electron.dialog.showOpenDialog(win, opts) : electron.dialog.showOpenDialog(opts));
    return { ok: true, paths: r.canceled ? [] : r.filePaths };
  }));
  ipcMain.handle('editor-clipboard-files', guard(() => ({
    ok: true,
    paths: filesFromClipboard((format) => electron.clipboard.readBuffer(format), platform),
  })));
```

`main.js` — riga 1:

```js
const { app, BrowserWindow, ipcMain, dialog, Notification, Menu, shell, clipboard } = require('electron');
```

riga 229:

```js
registerEditorHandlers(ipcMain, { electron: { app, shell, BrowserWindow, dialog, clipboard }, onQuitCancelled: quitCapture.reset });
```

(Il numero di righe di `main.js` non cambia: controllare con `wc -l main.js`
→ 232.)

`preload.js` — riga 1:

```js
const { contextBridge, ipcRenderer, webUtils } = require('electron');
```

Dopo `onEditorFileChanged: …`:

```js
  // Copiare da fuori (docs/plans/61): `sources` sono percorsi assoluti
  editorCopyPlan: (root, rel, sources) => ipcRenderer.invoke('editor-copy-plan', { root, rel, sources }),
  editorCopyRun: (root, rel, sources, decisions) => ipcRenderer.invoke('editor-copy-run', { root, rel, sources, decisions }),
  editorPickFiles: () => ipcRenderer.invoke('editor-pick-files'),
  editorClipboardFiles: () => ipcRenderer.invoke('editor-clipboard-files'),
  // Il percorso di un File trascinato: in Electron 33 File.path non c'è più
  editorPathForFile: (file) => webUtils.getPathForFile(file),
```

- [ ] **Passo 4: verde**

Run: `node --test tests/editor-ipc.test.js && npm run test:unit`
Atteso: PASS (compreso il test che ogni canale `editor-*` del preload ha il
suo handler, e il limite di righe di `main.js`).

- [ ] **Passo 5: commit**

```bash
git add app/editor.js preload.js main.js tests/editor-ipc.test.js
cat > /tmp/msg.txt <<'EOF'
feat: canali IPC per copiare file da fuori nell'editor

Quattro canali: piano, copia, finestra di scelta del sistema e appunti.
Il dialog e la lettura degli appunti stanno nel main (il renderer è
sandboxed); i percorsi del drop arrivano dal preload con webUtils, perché
Electron 33 non ha più File.path (piano 61).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 5: drop, evidenziazione e Ctrl+V nell'albero (`renderer/editor-tree.js`)

**File:**
- Modifica: `renderer/editor-tree.js` (`createTreeView`), `renderer/styles.css`
  (sezione «Sessione editor»)
- Test: `tests/editor-tree.test.js`

**Interfacce:**
- Produce: `createTreeView({ …, onCopyInto })` con
  `onCopyInto(dir: string, source)`; `dir` è la `rel` della cartella di
  arrivo (`''` la radice); `source` è `{ kind: 'drop', files: File[] }`
  oppure `{ kind: 'paste' }`. Il modulo non fa IPC.
- Cartella di arrivo: una riga-cartella → quella; una riga-file → la sua
  cartella; lo spazio vuoto → la radice. Ctrl+V → la cartella della riga
  selezionata (o la radice se niente è selezionato).
- Classe `is-drop-target` sulla riga della cartella di arrivo, o sulla
  lista intera (`.editor-tree`) quando è la radice.

- [ ] **Passo 1: test (rosso)** — in fondo a `tests/editor-tree.test.js`:

```js
/* ---------- copiare da fuori (docs/plans/61) ---------- */

const filesDrag = (more = {}) => ({ dataTransfer: { types: ['Files'], files: [], dropEffect: null, ...more } });

/** Albero con src aperta: src, src/lib, src/x.js, a.log, b.js. */
function copyView(selected = null) {
  const root = createElement('div');
  const copies = [];
  const view = T.createTreeView({ root, document, onOpenFile() {}, onToggleDir() {}, onContextMenu() {},
    onCopyInto: (dir, source) => copies.push([dir, source]) });
  view.render(T.visibleRows(T.toggle(sample(), 'src')), selected);
  return { view, copies };
}

ok('vista: i file trascinati da fuori vanno nella cartella sotto il puntatore, o nella radice', () => {
  const restore = installDocument();
  try {
    const { view, copies } = copyView();
    const f = { name: 'foto.png' };
    const e = fire(view.rowOf('src/lib'), 'drop', filesDrag({ files: [f] }));
    assert.strictEqual(e.defaultPrevented, true, 'senza preventDefault Electron apre il file nella finestra');
    fire(view.rowOf('src/x.js'), 'drop', filesDrag({ files: [f] }));
    fire(view.rowOf('b.js'), 'drop', filesDrag({ files: [f] }));
    fire(view.element, 'drop', filesDrag({ files: [f] }));
    assert.deepStrictEqual(copies.map(([dir]) => dir), ['src/lib', 'src', '', '']);
    assert.deepStrictEqual(copies[0][1], { kind: 'drop', files: [f] });
    // Un drag che non porta file (testo selezionato) non copia niente
    const text = fire(view.element, 'drop', { dataTransfer: { types: ['text/plain'], files: [] } });
    assert.strictEqual(text.defaultPrevented, false);
    assert.strictEqual(copies.length, 4);
  } finally { restore(); }
});

ok('vista: durante il drag si evidenzia la cartella di arrivo; si spegne uscendo e al render', () => {
  const restore = installDocument();
  try {
    const { view } = copyView();
    const lit = (el) => el.classList.contains('is-drop-target');
    const over = fire(view.rowOf('src/x.js'), 'dragover', filesDrag());
    assert.strictEqual(over.defaultPrevented, true);
    assert.strictEqual(over.dataTransfer.dropEffect, 'copy');
    assert.ok(lit(view.rowOf('src')), 'un file evidenzia la sua cartella');
    fire(view.rowOf('b.js'), 'dragover', filesDrag());
    assert.ok(!lit(view.rowOf('src')));
    assert.ok(lit(view.element), 'un file della radice evidenzia tutto l albero');
    fire(view.element, 'dragleave', { relatedTarget: view.rowOf('src') });
    assert.ok(lit(view.element), 'passare da una riga all altra non spegne');
    fire(view.element, 'dragleave', { relatedTarget: null });
    assert.ok(!lit(view.element));
    const plain = fire(view.rowOf('src'), 'dragover', { dataTransfer: { types: ['text/plain'] } });
    assert.strictEqual(plain.defaultPrevented, false);
    assert.ok(!lit(view.rowOf('src')));
    fire(view.rowOf('src/lib'), 'dragover', filesDrag());
    const lib = view.rowOf('src/lib');
    view.render(T.visibleRows(T.toggle(sample(), 'src')), null);
    assert.ok(!lit(lib) && !lit(view.element));
  } finally { restore(); }
});

ok('vista: Ctrl+V con l albero a fuoco incolla nella cartella della selezione', () => {
  const restore = installDocument();
  try {
    const { view, copies } = copyView('src/x.js');
    assert.strictEqual(view.element.tabIndex, 0, 'l albero deve poter avere il fuoco');
    const e = fire(view.element, 'keydown', { key: 'v', ctrlKey: true });
    assert.strictEqual(e.defaultPrevented, true);
    fire(view.element, 'keydown', { key: 'V', metaKey: true });
    fire(view.element, 'keydown', { key: 'v' });
    fire(view.element, 'keydown', { key: 'v', ctrlKey: true, shiftKey: true });
    fire(view.element, 'keydown', { key: 'v', ctrlKey: true, altKey: true });
    assert.deepStrictEqual(copies, [['src', { kind: 'paste' }], ['src', { kind: 'paste' }]]);
    const dir = copyView('src/lib');
    fire(dir.view.element, 'keydown', { key: 'v', ctrlKey: true });
    const none = copyView(null);
    fire(none.view.element, 'keydown', { key: 'v', ctrlKey: true });
    assert.deepStrictEqual([dir.copies[0][0], none.copies[0][0]], ['src/lib', '']);
  } finally { restore(); }
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/editor-tree.test.js`
Atteso: FAIL (nessun handler `drop`/`dragover`/`keydown`: `copies` vuoto,
`tabIndex` undefined).

- [ ] **Passo 3: codice** — in `renderer/editor-tree.js`:

Nel commento in cima, dopo «…e il menu contestuale.», aggiungere:
`Anche il drop di file da fuori e Ctrl+V (docs/plans/61): la vista dice
in quale cartella copiare, la copia la fa chi la usa.`

Sopra `createTreeView`, accanto a `under`/`moved`:

```js
  const parentOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  const dirOf = (row) => (row.kind === 'dir' ? row.rel : parentOf(row.rel));
  // Solo i drag che portano file del sistema: non il testo, non le righe
  const carriesFiles = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
```

`createTreeView` diventa:

```js
  function createTreeView({ root, document: doc, onOpenFile, onToggleDir, onContextMenu, onCopyInto = () => {} }) {
    const list = doc.createElement('div');
    list.className = 'editor-tree';
    list.setAttribute('role', 'tree');
    list.tabIndex = 0; // per Ctrl+V
    // Click destro sul vuoto: le voci per creare nella radice
    list.oncontextmenu = (e) => { e.preventDefault(); onContextMenu(null, e); };
    root.appendChild(list);

    let shown = { rows: [], selected: null };
    let lit = null; // l'elemento evidenziato durante il drag

    const rowOf = (rel) => list.children.find((c) => c.dataset.rel === rel) || null;
    function highlight(el) {
      if (lit === el) return;
      if (lit) lit.classList.remove('is-drop-target');
      lit = el;
      if (el) el.classList.add('is-drop-target');
    }
    const targetOf = (dir) => (dir ? rowOf(dir) || list : list);
    const within = (node) => { for (let n = node; n; n = n.parentNode) if (n === list) return true; return false; };
    function onDragOver(dir) {
      return (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault(); // senza, il drop non arriva
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        highlight(targetOf(dir));
      };
    }
    function onDrop(dir) {
      return (e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault(); // senza, Electron apre il file al posto della pagina
        e.stopPropagation();
        highlight(null);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onCopyInto(dir, { kind: 'drop', files });
      };
    }
    list.addEventListener('dragover', onDragOver(''));
    list.addEventListener('drop', onDrop(''));
    list.addEventListener('dragleave', (e) => { if (!within(e.relatedTarget)) highlight(null); });
    list.addEventListener('keydown', (e) => {
      const paste = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V');
      if (!paste) return;
      e.preventDefault();
      e.stopPropagation(); // non è l'incolla del terminale
      const row = shown.rows.find((r) => r.rel === shown.selected);
      onCopyInto(row ? dirOf(row) : '', { kind: 'paste' });
    });

    function rowElement(r, selected) {
      // … corpo di oggi invariato, fino a el.oncontextmenu compreso, poi:
      el.addEventListener('dragover', onDragOver(dirOf(r)));
      el.addEventListener('drop', onDrop(dirOf(r)));
      return el;
    }

    return {
      element: list,
      render(rows, selected) {
        for (const child of [...list.children]) { const cancel = openPrompts.get(child); if (cancel) cancel(); }
        shown = { rows, selected };
        highlight(null);
        list.replaceChildren(...rows.map((r) => rowElement(r, selected)));
      },
      rowOf,
    };
  }
```

(Il corpo di `rowElement` resta quello di oggi: si aggiungono solo le due
righe `addEventListener` prima di `return el`. `rowOf` diventa la funzione
locale, con lo stesso comportamento.)

`renderer/styles.css`, nella sezione «Sessione editor», dopo
`.editor-tree-host { … }`:

```css
/* Tutta l'altezza: lo spazio vuoto sotto le righe è la radice, per il drop
   e per il click destro (docs/plans/61) */
.editor-tree { min-height: 100%; }
.editor-tree:focus:not(:focus-visible) { outline: none; }
.editor-tree.is-drop-target,
.editor-tree-row.is-drop-target { outline: 1px dashed var(--type-editor); outline-offset: -1px; background: var(--surface-3); }
```

e dopo `.editor-message { … }`:

```css
.editor-message.is-info { color: var(--text-dim); }
```

- [ ] **Passo 4: verde**

Run: `node --test tests/editor-tree.test.js && npm run test:unit`
Atteso: PASS (anche i test di oggi della vista: `rowOf` e il render non
cambiano comportamento).

- [ ] **Passo 5: commit**

```bash
git add renderer/editor-tree.js renderer/styles.css tests/editor-tree.test.js
cat > /tmp/msg.txt <<'EOF'
feat: l'albero dell'editor accetta file trascinati e Ctrl+V

La vista evidenzia la cartella di arrivo durante il drag (una riga-file
vale la sua cartella, il vuoto la radice) e dice a chi la usa dove
copiare e cosa: i File del drop o «incolla». Solo i drag che portano file
del sistema; la copia non la fa la vista (piano 61).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 6: il giro nella scheda (`renderer/editor-copy-ui.js`, `editor-tab.js`)

**File:**
- Crea: `renderer/editor-copy-ui.js`
- Modifica: `renderer/editor-tab.js`, `renderer/index.html` (dopo la riga
  `<script src="editor-tab.js"></script>`)
- Test: `tests/editor-tab.test.js` (in fondo)

**Interfacce:**
- Consuma: `onCopyInto(dir, source)` della vista (Task 5); i metodi del
  preload del Task 4; da `editor-tab.js` (scope globale condiviso):
  `callEditor`, `showEditorMessage`, `editorConfirm`, `tabs`,
  `loadEditorDir`, `toggleEditorDir`, `EditorTree`.
  `editorConfirm.choose({anchor, title, text, key, choices})` → Promise del
  `value` scelto, `null` se annullato; `choices: [{value, label, danger?, hint?}]`.
- Produce (globali della pagina):
  - `copyIntoEditor(tab, dir, source)` — `source`: `{kind:'drop', files}`,
    `{kind:'pick'}`, `{kind:'paste'}`
  - `copyConflictChoices(remaining) → choices[]`, `copyOutcomeText(result) → string`
  - in `editor-tab.js`: `showEditorNotice(tab, text)` (messaggio non di
    errore, classe `is-info`); `tab.editor.copying` (boolean).
- Testi esatti: notice di avanzamento `Copio N elementi…` (`1 elemento`);
  esito `Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).`;
  `Non si copia: <errore>`; `Negli appunti non ci sono file da incollare.`;
  `I file trascinati non hanno un percorso sul disco.`; `Una copia è già in corso.`

- [ ] **Passo 1: test (rosso)** — in `tests/editor-tab.test.js`, in cima
accanto agli altri `require`:

```js
const { createElement } = require('./fake-dom');
```

e in fondo:

```js
/* ---------- copiare da fuori (docs/plans/61) ---------- */

/** Una scheda col main che risponde ok, un messaggio vero e le risposte della bolla. */
function copySetup({ main = {}, answers = [] } = {}) {
  const s = setup({ main: {
    editorPathForFile: (f) => f.p,
    editorCopyPlan: async () => ({ ok: true, items: [], conflicts: [], count: 2, bytes: 0 }),
    editorCopyRun: async () => ({ ok: true, copied: 2, skipped: 0, failed: [] }),
    editorList: async () => ({ ok: true, entries: [] }),
    ...main,
  } });
  const message = createElement('div');
  message.hidden = true;
  s.tab.editor.ui.message = message;
  s.tab.editor.copying = false;
  const asked = [];
  s.run('editorConfirm').choose = async (o) => { asked.push(o); return answers.length ? answers.shift() : null; };
  const copyInto = (dir, source) => s.fn('copyIntoEditor')(s.tab, dir, source);
  const drop = (...paths) => ({ kind: 'drop', files: paths.map((p) => ({ p })) });
  return { ...s, message, asked, copyInto, drop };
}

ok('copia: un drop senza conflitti fa piano, copia, esito e rilegge la cartella', async () => {
  const s = copySetup();
  await s.copyInto('', s.drop('/x/a', '/x/b'));
  assert.deepStrictEqual(s.sent('editorCopyPlan').map((c) => c.slice(1)), [['/w', '', ['/x/a', '/x/b']]]);
  assert.deepStrictEqual(s.sent('editorCopyRun').map((c) => c.slice(1)), [['/w', '', ['/x/a', '/x/b'], {}]]);
  assert.deepStrictEqual(s.asked, []);
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi.');
  assert.strictEqual(s.message.hidden, false);
  assert.ok(s.message.classList.contains('is-info'));
  assert.deepStrictEqual(s.sent('editorList').map((c) => c.slice(1)), [['/w', '']]);
  assert.strictEqual(s.tab.editor.copying, false);
});

ok('copia: i conflitti si chiedono uno alla volta, «per tutti» chiude i rimanenti', async () => {
  const conflicts = ['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, kind: 'file', existingKind: 'file' }));
  const s = copySetup({
    main: { editorCopyPlan: async () => ({ ok: true, items: [], conflicts, count: 3, bytes: 0 }) },
    answers: ['replace', 'skip-all'],
  });
  await s.copyInto('src', s.drop('/x/a.txt', '/x/b.txt', '/x/c.txt'));
  assert.strictEqual(s.asked.length, 2);
  assert.deepStrictEqual(s.asked[0].choices.map((c) => c.value), ['replace', 'keep-both', 'skip', 'replace-all', 'keep-both-all', 'skip-all']);
  assert.match(s.asked[0].title, /a\.txt/);
  assert.deepStrictEqual(s.sent('editorCopyRun')[0][4], { 'a.txt': 'replace', 'b.txt': 'skip', 'c.txt': 'skip' });
});

ok('copia: annullare una domanda non copia niente', async () => {
  const s = copySetup({ main: { editorCopyPlan: async () => ({ ok: true, items: [], conflicts: [{ name: 'a.txt', kind: 'file', existingKind: 'dir' }], count: 1, bytes: 0 }) } });
  await s.copyInto('', s.drop('/x/a.txt'));
  assert.strictEqual(s.asked.length, 1);
  assert.deepStrictEqual(s.asked[0].choices.map((c) => c.value), ['replace', 'keep-both', 'skip'], 'un solo conflitto: niente «per tutti»');
  assert.deepStrictEqual(s.sent('editorCopyRun'), []);
  assert.strictEqual(s.tab.editor.copying, false);
});

ok('copia: appunti senza file, drop senza percorsi, finestra annullata', async () => {
  const s = copySetup({ main: { editorClipboardFiles: async () => ({ ok: true, paths: [] }), editorPickFiles: async () => ({ ok: true, paths: [] }), editorPathForFile: () => '' } });
  await s.copyInto('', { kind: 'paste' });
  assert.strictEqual(s.message.textContent, 'Negli appunti non ci sono file da incollare.');
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'I file trascinati non hanno un percorso sul disco.');
  s.message.textContent = '';
  await s.copyInto('', { kind: 'pick' });
  assert.strictEqual(s.message.textContent, '', 'annullare la finestra non dice niente');
  assert.deepStrictEqual(s.sent('editorCopyPlan'), []);
});

ok('copia: un piano rifiutato lo dice come errore e non copia', async () => {
  const s = copySetup({ main: { editorCopyPlan: async () => ({ ok: false, error: 'Troppo grande: più di 1 GB.' }) } });
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'Non si copia: Troppo grande: più di 1 GB.');
  assert.ok(!s.message.classList.contains('is-info'));
  assert.deepStrictEqual(s.sent('editorCopyRun'), []);
});

ok('copia: gli elementi non copiati finiscono nel messaggio, come errore', async () => {
  const s = copySetup({ main: { editorCopyRun: async () => ({ ok: true, copied: 2, skipped: 1, failed: [{ name: 'x.txt', error: 'Non esiste più.' }] }) } });
  await s.copyInto('', s.drop('/x/a'));
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).');
  assert.ok(!s.message.classList.contains('is-info'));
});

ok('copia: in una cartella chiusa la apre per mostrare cosa è arrivato', async () => {
  const s = copySetup();
  await s.copyInto('src', s.drop('/x/a'));
  assert.ok(s.page.ctx.AisessEditorTree.isExpanded(s.tab.editor.tree, 'src'));
  assert.deepStrictEqual(s.sent('editorList').map((c) => c.slice(1)), [['/w', 'src']]);
});

ok('copia: «Copia qui file…» e «Incolla» nel menu di una cartella', async () => {
  const s = copySetup({ main: { editorPickFiles: async () => ({ ok: true, paths: ['/x/a'] }) } });
  const menus = [];
  s.page.ctx.AisessEditorTree.showMenu = (o) => menus.push(o);
  s.fn('editorTreeMenu')(s.tab, { rel: 'src', kind: 'dir' }, { clientX: 0, clientY: 0 });
  const labels = menus[0].items.map((i) => i.label);
  assert.ok(labels.includes('Copia qui file…') && labels.includes('Incolla'), labels.join(', '));
  await menus[0].items.find((i) => i.label === 'Copia qui file…').run();
  assert.strictEqual(s.sent('editorPickFiles').length, 1);
  assert.deepStrictEqual(s.sent('editorCopyPlan')[0].slice(1), ['/w', 'src', ['/x/a']]);
});

ok('copia: una seconda copia mentre la prima è in corso si rifiuta', async () => {
  const plan = deferred();
  const s = copySetup({ main: { editorCopyPlan: () => plan.promise } });
  const first = s.copyInto('', s.drop('/x/a'));
  await settle();
  await s.copyInto('', s.drop('/x/b'));
  assert.strictEqual(s.message.textContent, 'Una copia è già in corso.');
  plan.resolve({ ok: true, items: [], conflicts: [], count: 1, bytes: 0 });
  await first;
  assert.strictEqual(s.sent('editorCopyPlan').length, 1);
  assert.strictEqual(s.message.textContent, 'Copiati 2 elementi.');
});

ok('copia: un file lasciato fuori dall albero non apre niente nella finestra', () => {
  const { page, fn } = setup();
  fn('initEditorTabs')();
  const ev = (types) => ({ prevented: false, dataTransfer: { types, dropEffect: null }, preventDefault() { this.prevented = true; } });
  const over = ev(['Files']);
  page.listeners.dragover(over);
  assert.strictEqual(over.prevented, true);
  assert.strictEqual(over.dataTransfer.dropEffect, 'none');
  const dropped = ev(['Files']);
  page.listeners.drop(dropped);
  assert.strictEqual(dropped.prevented, true);
  const text = ev(['text/plain']);
  page.listeners.drop(text);
  assert.strictEqual(text.prevented, false, 'gli altri drag non si toccano');
});

ok('copia: testi dell esito e scelte dei conflitti', () => {
  const { fn } = setup();
  const text = fn('copyOutcomeText');
  assert.strictEqual(text({ copied: 1, skipped: 0, failed: [] }), 'Copiato 1 elemento.');
  assert.strictEqual(text({ copied: 0, skipped: 2, failed: [] }), 'Copiati 0 elementi, 2 saltati.');
  assert.strictEqual(text({ copied: 0, skipped: 0, failed: [{ name: 'a', error: 'Permesso negato.' }, { name: 'b', error: 'Disco pieno.' }] }),
    'Copiati 0 elementi, 2 non copiati: a (Permesso negato), b (Disco pieno).');
  const choices = fn('copyConflictChoices');
  assert.strictEqual(choices(1).length, 3);
  assert.ok(choices(1)[0].danger, '«Sostituisci» è l azione che cestina');
  assert.deepStrictEqual(choices(2).slice(3).map((c) => c.label), ['Sostituisci tutti', 'Tieni entrambi per tutti', 'Salta tutti']);
});
```

- [ ] **Passo 2: rosso**

Run: `node --test tests/editor-tab.test.js`
Atteso: FAIL (`copyIntoEditor is not defined`).

- [ ] **Passo 3: codice**

`renderer/editor-copy-ui.js` (nuovo):

```js
/* Copiare file da fuori nell'albero della scheda editor (docs/plans/61).
   Piano e copia li fa il main (lib/editor-copy.js); qui da dove vengono i
   percorsi (drop, finestra di scelta, appunti), le domande sui conflitti
   e l'esito nella barra dei messaggi. Script dell'app, caricato dopo
   editor-tab.js: ne usa le funzioni (callEditor, showEditorMessage,
   editorConfirm, loadEditorDir…) dallo scope globale. */

const COPY_CHOICES = [
  { value: 'replace', label: 'Sostituisci', danger: true, hint: 'Quello che c\'è già va nel cestino.' },
  { value: 'keep-both', label: 'Tieni entrambi', hint: 'La copia prende un nome libero, «nome (2)».' },
  { value: 'skip', label: 'Salta' },
];
const COPY_ALL_LABELS = { replace: 'Sostituisci tutti', 'keep-both': 'Tieni entrambi per tutti', skip: 'Salta tutti' };

const copyCount = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const copyEnding = (n) => (n === 1 ? 'o' : 'i');

/** Le scelte per un conflitto; con altri conflitti dopo, anche «per tutti». */
function copyConflictChoices(remaining) {
  if (remaining <= 1) return COPY_CHOICES;
  return [...COPY_CHOICES, ...COPY_CHOICES.map((c) => ({ ...c, value: `${c.value}-all`, label: COPY_ALL_LABELS[c.value] }))];
}

/** «Copiati 2 elementi, 1 saltato, 1 non copiato: x.txt (Non esiste più).» */
function copyOutcomeText({ copied = 0, skipped = 0, failed = [] }) {
  const parts = [`Copiat${copyEnding(copied)} ${copyCount(copied, 'elemento', 'elementi')}`];
  if (skipped) parts.push(`${skipped} saltat${copyEnding(skipped)}`);
  if (failed.length) {
    const names = failed.map((f) => `${f.name} (${String(f.error).replace(/\.$/, '')})`).join(', ');
    parts.push(`${failed.length} non copiat${copyEnding(failed.length)}: ${names}`);
  }
  return `${parts.join(', ')}.`;
}

/** @returns {Promise<Object<string, string>|null>} nome → decisione; null se annullato */
async function askCopyConflicts(tab, conflicts) {
  let decisions = {};
  for (let i = 0; i < conflicts.length; i += 1) {
    const c = conflicts[i];
    const answer = await editorConfirm.choose({
      anchor: tab.editor.ui.treeHost,
      title: `«${c.name}» c'è già`,
      text: `Nella cartella c'è già ${c.existingKind === 'dir' ? 'una cartella' : 'un file'} con questo nome.`,
      key: `copy:${tab.id}`,
      choices: copyConflictChoices(conflicts.length - i),
    });
    if (!answer) return null;
    if (answer.endsWith('-all')) {
      const value = answer.slice(0, -'-all'.length);
      return conflicts.slice(i).reduce((acc, rest) => ({ ...acc, [rest.name]: value }), decisions);
    }
    decisions = { ...decisions, [c.name]: answer };
  }
  return decisions;
}

/** I percorsi assoluti da copiare: dal drop qui, dalla finestra e dagli appunti nel main. */
async function editorCopySources(source) {
  if (source.kind === 'drop') {
    const paths = source.files.map((f) => {
      try {
        return window.aisess.editorPathForFile(f);
      } catch (e) {
        console.warn('percorso del file trascinato non leggibile', e);
        return '';
      }
    }).filter(Boolean);
    return { ok: true, paths };
  }
  if (source.kind === 'pick') return callEditor(() => window.aisess.editorPickFiles());
  if (source.kind === 'paste') return callEditor(() => window.aisess.editorClipboardFiles());
  return { ok: false, error: 'sorgente sconosciuta' };
}

const COPY_EMPTY = {
  drop: 'I file trascinati non hanno un percorso sul disco.',
  paste: 'Negli appunti non ci sono file da incollare.',
};

/** Fatta la copia, la cartella si mostra aperta e riletta. */
async function revealEditorDir(tab, dir) {
  if (dir && !EditorTree.isExpanded(tab.editor.tree, dir)) await toggleEditorDir(tab, dir);
  else await loadEditorDir(tab, dir);
}

async function copyIntoEditor(tab, dir, source) {
  const ed = tab.editor;
  if (ed.copying) {
    showEditorNotice(tab, 'Una copia è già in corso.');
    return;
  }
  ed.copying = true;
  try {
    const got = await editorCopySources(source);
    if (!tabs.has(tab.id)) return;
    if (!got.ok) { showEditorMessage(tab, `Non si copia: ${got.error}`); return; }
    if (!got.paths.length) {
      if (COPY_EMPTY[source.kind]) showEditorNotice(tab, COPY_EMPTY[source.kind]);
      return; // finestra di scelta annullata: niente da dire
    }
    const plan = await callEditor(() => window.aisess.editorCopyPlan(tab.cwd, dir, got.paths));
    if (!tabs.has(tab.id)) return;
    if (!plan.ok) { showEditorMessage(tab, `Non si copia: ${plan.error}`); return; }
    const decisions = await askCopyConflicts(tab, plan.conflicts);
    if (!decisions || !tabs.has(tab.id)) return;
    showEditorNotice(tab, `Copio ${copyCount(plan.count, 'elemento', 'elementi')}…`);
    const r = await callEditor(() => window.aisess.editorCopyRun(tab.cwd, dir, got.paths, decisions));
    if (!tabs.has(tab.id)) return;
    if (!r.ok) showEditorMessage(tab, `Non si copia: ${r.error}`);
    else if (r.failed.length) showEditorMessage(tab, copyOutcomeText(r));
    else showEditorNotice(tab, copyOutcomeText(r));
    await revealEditorDir(tab, dir);
  } finally {
    ed.copying = false;
  }
}
```

`renderer/index.html`, subito dopo `<script src="editor-tab.js"></script>`:

```html
<script src="editor-copy-ui.js"></script>
```

`renderer/editor-tab.js`:

1. In `buildEditorLayout`, nelle opzioni di `EditorTree.createTreeView`,
   dopo `onContextMenu`:

   ```js
       onCopyInto: (dir, source) => copyIntoEditor(tab, dir, source),
   ```

2. `showEditorMessage` toglie la classe del notice, e accanto nasce
   `showEditorNotice`:

   ```js
   function showEditorMessage(tab, text) {
     const { message } = tab.editor.ui;
     message.classList.remove('is-info');
     message.textContent = text; // può contenere nomi di file ed errori del sistema
     message.hidden = false;
   }

   /** Come showEditorMessage, ma non è un errore (avanzamento ed esito della copia). */
   function showEditorNotice(tab, text) {
     showEditorMessage(tab, text);
     tab.editor.ui.message.classList.add('is-info');
   }
   ```

3. In `editorTreeMenu`, l'array `items` diventa:

   ```js
     const items = [
       { label: 'Nuovo file', run: () => newEditorEntry(tab, dir, 'file') },
       { label: 'Nuova cartella', run: () => newEditorEntry(tab, dir, 'dir') },
       { label: 'Copia qui file…', run: () => copyIntoEditor(tab, dir, { kind: 'pick' }) },
       { label: 'Incolla', run: () => copyIntoEditor(tab, dir, { kind: 'paste' }) },
     ];
   ```

4. In `createEditorTab`, l'oggetto `tab.editor` prende `copying: false`:

   ```js
       host: null, hostPending: null, saving: new Set(), pendingChanges: new Map(), copying: false,
   ```

5. In `initEditorTabs`, in fondo:

   ```js
     // Un file lasciato fuori dall'albero non deve aprirsi al posto della
     // pagina (Electron naviga verso i file trascinati): il drop si rifiuta.
     // L'albero li accetta da sé e non lascia salire l'evento fin qui.
     const isFileDrag = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
     document.addEventListener('dragover', (e) => {
       if (!isFileDrag(e)) return;
       e.preventDefault();
       e.dataTransfer.dropEffect = 'none'; // il cursore dice «qui no»
     });
     document.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); });
   ```

- [ ] **Passo 4: verde**

Run: `node --test tests/editor-tab.test.js tests/renderer-load.test.js && npm run test:unit`
Atteso: PASS (`renderer-load` carica `index.html` con lo script nuovo
nell'ordine giusto).

- [ ] **Passo 5: commit**

```bash
git add renderer/editor-copy-ui.js renderer/editor-tab.js renderer/index.html tests/editor-tab.test.js
cat > /tmp/msg.txt <<'EOF'
feat: copiare file da fuori nell'albero dell'editor

Trascinare sull'albero, «Copia qui file…» e «Incolla» (anche Ctrl+V)
portano file e cartelle nella cartella scelta: il main fa il piano, qui
si chiede cosa fare di ogni conflitto (con «per tutti»), poi la copia e
l'esito nella barra. Un file lasciato fuori dall'albero non apre più la
pagina al suo posto (piano 61).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 7: smoke e chiusura

**File:**
- Modifica: `docs/plans/README.md` (riga del piano 61),
  `docs/plans/61-editor-copia-file.md` (quello che è emerso)

- [ ] **Passo 1: test completi**

Run: `npm run test:unit && npm run test:coverage`
Atteso: PASS; `lib/editor-copy.js` e `lib/clipboard-files.js` sopra l'80%
di righe coperte (leggere la tabella della coverage).

- [ ] **Passo 2: smoke** (`npm start`, una scheda editor su una cartella di
prova):
1. Trascinare dal file manager un file su una cartella dell'albero: la riga
   si evidenzia, il file arriva, la cartella si apre e lo mostra, la barra
   dice «Copiato 1 elemento.» in grigio.
2. Trascinare una cartella sullo spazio vuoto sotto le righe: va nella radice.
3. Ripetere il 1: compare la bolla «… c'è già»; «Sostituisci» → l'originale
   è nel cestino del sistema; «Tieni entrambi» → `nome (2).ext`.
4. Selezionare tre file già presenti, trascinarli: la bolla offre «per
   tutti»; «Salta tutti» → «Copiati 0 elementi, 3 saltati.»
5. Click destro su una cartella → «Copia qui file…»: la finestra del
   sistema si apre sopra l'app, il bottone dice «Copia qui».
6. Ctrl+C su due file nel file manager, click sull'albero, Ctrl+V: arrivano
   nella cartella della riga selezionata. «Incolla» dal menu fa lo stesso.
   Con testo negli appunti: «Negli appunti non ci sono file da incollare.»
7. Lasciare un file sui sotto-tab o su Monaco: non succede niente (la
   finestra **non** apre il file).
8. Console del renderer (Ctrl+Shift+I): nessun errore, nessuna violazione CSP.

- [ ] **Passo 3: piano e README** — in `docs/plans/README.md` la riga del
piano 61 passa da «da fare» a «✅ fatto» (stesso formato delle altre righe,
con una nota breve su cosa si è provato a mano); nel piano 61, sezione «Da
verificare a mano», annotare cosa è stato provato davvero (GNOME/KDE,
X11/Wayland) e cosa resta.

- [ ] **Passo 4: commit**

```bash
git add docs/plans/README.md docs/plans/61-editor-copia-file.md
cat > /tmp/msg.txt <<'EOF'
docs: piano 61 chiuso, note dallo smoke

Cosa si è provato a mano (drop, finestra di scelta, appunti sui file
manager disponibili) e cosa resta da provare, perché chi tocca la copia
dopo sappia da dove partire.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

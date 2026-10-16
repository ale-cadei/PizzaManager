# Aprire un file cambiato nell'editor — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni file nell'elenco del pannello modifiche ha un bottoncino «Apri nell'editor». Il click apre il file in una scheda editor e porta il cursore al primo blocco cambiato rispetto a HEAD. La scheda è quella già aperta che contiene il file (la prima nell'ordine della barra laterale), oppure una nuova sulla radice del repository.

**Architecture:** `renderer/editor-route.js` (UMD, puro) decide la scheda: dalla radice del repository (`result.root`, che `readChanges` e `readStaging` danno già) e dal percorso del file sceglie una scheda editor esistente con `rel` relativo alla sua cartella, oppure `{ cwd: root }` per crearne una. `renderer/changes-view.js` disegna il bottone accanto alla riga del file. `renderer/changes-panel.js` cabla il click: attiva o crea la scheda, poi chiama `openEditorAt(tab, rel)`. `openEditorAt` sta in `renderer/editor-tab-gutter.js`, file nuovo che prende le barrette del piano 63 da `editor-tab.js` (783 righe, vicino al tetto di 800). Apre il file, aspetta la lettura di HEAD più recente per quel file e chiama `host.reveal` sulla prima riga di `EditorGutter.firstChangedLine`.

**Tech Stack:** Electron 33, Monaco 0.57 (`reveal` dell'host, piano 63), script classici del renderer nello scope globale, test con `node --test` e la pagina vera in un contesto vm (`tests/renderer-page.js`).

Spec: `docs/plans/64-editor-apri-da-modifiche.md`.

## Global Constraints

- **Ordine degli script:** `editor-route.js` è un modulo UMD e va fra i moduli di `index.html`, dopo `editor-gutter.js`. `editor-tab-gutter.js` è uno script dell'app e va subito prima di `editor-tab.js`, e anche in `RENDERER_APP_FILES` (`tests/renderer-source.js`). Dopo `app-state.js` la pagina deve caricare esattamente quella lista (`tests/renderer-load.test.js`).
- **Scope condiviso:** `editor-tab-gutter.js` usa `EditorFiles`, `callEditor` e `tabs`, definiti in script caricati dopo o prima. Va bene perché li tocca solo dentro le funzioni, mai al caricamento. Una `const` dichiarata in due script fa esplodere la pagina, quindi `EditorGutter` e `EDITOR_GUTTER_DELAY` si **spostano**, non si copiano.
- **Windows:** niente `split('/')`. `editor-route.js` divide su `[\\/]+` e su `win32` confronta i nomi senza distinguere maiuscole e minuscole. `platform` è un parametro (default: `navigator.platform`, perché il renderer non ha `process`). I casi Windows si provano da Unix con `platform: 'win32'` e percorsi `path.win32`. Il `rel` che esce usa sempre `/`, che `safeRel` (`lib/editor-paths.js`) accetta su tutte e due le piattaforme.
- **Bottone:** `<button type="button">` con classe `changes-file-act changes-open-editor`, testo `↗`, e `title` e `aria-label` uguali a `Apri nell'editor`. Sta nella testata del file subito dopo la riga, mai dentro: un pulsante non ne contiene un altro. Il click chiama `stopPropagation` e non apre né chiude il diff. Non compare sui file cancellati (`status 'D'`), binari (`binary`) o che non sono file (`special`), né in modalità Unisci. Nel DOM il nome del file non entra: il bottone passa `f.path` al callback.
- **UI:** il testo nella pagina passa da `textContent` (`el`/`button` di changes-view). Niente `innerHTML`.
- **Immutabilità:** lo stato del pannello si sostituisce (`setChangesState`), quello dei file dell'editor passa da `EditorFiles.update`. L'unica struttura mutabile nuova è `ed.gutterReads` (una `Map` per scheda, come `gutterSeq`).
- **Test:** prima `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (il node di sistema è v12). La suite è `npm run test:unit` e deve restare verde. Prima del piano: 1620 test, 1 skip. Gli array nati nel contesto vm si confrontano passando da `plain` (JSON).
- **Commit:** messaggio in `/tmp/msg.txt`, poi `git commit --file=/tmp/msg.txt`, in un comando separato da qualsiasi `grep`. Formato `<tipo>: <cosa>` in italiano, il perché nel corpo, ultima riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Il Task 1 è un refactor puro e va in un commit da solo.

## Scelte rispetto alla spec

- **`openEditorAt` sta in `renderer/editor-tab-gutter.js`, non in `editor-tab.js`.** `editor-tab.js` ha 783 righe. Il Task 1 sposta lì le barrette (circa 85 righe) e `openEditorAt` le raggiunge: legge solo lo stato delle barrette.
- **Test divisi:** `tests/editor-tab.test.js` ha 750 righe e i nuovi test lo porterebbero oltre 800. Gli aiuti comuni (`setup`, `settle`, `deferred`, `plain`) vanno in `tests/editor-tab-setup.js`. I test delle barrette e quelli di `openEditorAt` vanno in `tests/editor-tab-gutter.test.js`.
- **«Quando le barrette sono pronte»:** la spec non dice come si aspetta. `loadEditorGutterBase` resta senza `await` dentro `openEditorFile`, ma da ora registra la sua promise in `ed.gutterReads`. `openEditorAt` aspetta l'ultima registrata per quel file, e se intanto ne parte una più nuova (`setActive` → `refreshEditorTab` rilegge HEAD) aspetta quella. Non si lancia una lettura in più.
- **Il cursore si sposta solo se il file è ancora quello attivo** nella scheda (`ed.files.active === rel`) e la scheda c'è ancora. Se intanto l'utente ha cambiato sotto-scheda, non si salta su un file che non sta guardando.
- **Righe tolte:** un blocco `del` con `after: n` porta alla riga `n`, e alla riga 1 se `after` è 0.
- **Modalità Unisci:** niente bottone. Lì il pannello guarda un altro worktree o un branch in arrivo, e la spec parla solo di «turno» e «staging».
- **Staging:** `readStaging` restituisce già `root` (da `openRepo`). Non si cambia codice, si aggiunge solo un test che lo fissa.
- **`createEditorTab` restituisce la scheda** (prima non restituiva niente), così `createTab('editor', …)` dà al pannello la scheda appena creata.

---

### Task 1: refactor, barrette della scheda editor in `renderer/editor-tab-gutter.js`

Spostamento puro: nessuna riga di logica cambia, nessun test nuovo.

**Files:**
- Create: `renderer/editor-tab-gutter.js`
- Modify: `renderer/editor-tab.js` (via la sezione delle barrette e le due costanti, commento di testa)
- Modify: `renderer/index.html` (script nuovo prima di `editor-tab.js`)
- Modify: `tests/renderer-source.js` (`RENDERER_APP_FILES`)
- Modify: `tests/renderer-load.test.js` (una funzione in più fra quelle attese)
- Create: `tests/editor-tab-setup.js`
- Create: `tests/editor-tab-gutter.test.js`
- Modify: `tests/editor-tab.test.js` (via gli aiuti e la sezione delle barrette)

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: nessun nome cambia. In `editor-tab-gutter.js`, nello scope globale: `EditorGutter`, `EDITOR_GUTTER_DELAY`, `updateEditorGutter`, `flushEditorGutter`, `scheduleEditorGutter`, `sameGutterBase`, `editorHeadWarned`, `warnEditorHead`, `loadEditorGutterBase`, `editorFileChanges`. In `tests/editor-tab-setup.js`: `module.exports = { settle, deferred, fakeHost, setup, plain }`.

- [ ] **Step 1: creare `renderer/editor-tab-gutter.js`**

Il file comincia con questo commento e prende, **senza cambiarle**:
1. le righe 14-16 di `editor-tab.js`: `const EditorGutter = …`, il commento `// Le barrette si ricalcolano…` e `const EDITOR_GUTTER_DELAY = 300;`;
2. le righe 330-409 di `editor-tab.js`: dalla riga `/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */` fino alla `}` che chiude `editorFileChanges`, compresa.

```js
/* Barrette delle righe cambiate nella scheda editor (docs/plans/63): il
   cablaggio fra lo stato dei file (editor-files.js), il confronto con HEAD
   (editor-gutter.js) e l'host Monaco. Separato da editor-tab.js per tenerlo
   sotto le 800 righe (docs/plans/64).
   Script classico nello scope globale, caricato prima di editor-tab.js:
   EditorFiles, callEditor e tabs li definiscono altri script, e qui si usano
   solo dentro le funzioni, mai al caricamento. */

const EditorGutter = window.AisessEditorGutter;
// Le barrette si ricalcolano quando si smette di scrivere (docs/plans/63)
const EDITOR_GUTTER_DELAY = 300;

/* ---------- barrette delle righe cambiate (docs/plans/63) ---------- */
// … le righe 331-409 di editor-tab.js, identiche …
```

`onEditorTextChange` (righe 321-328) resta in `editor-tab.js`: è il cablaggio dell'host.

- [ ] **Step 2: togliere le righe spostate da `editor-tab.js` e aggiornare la testata**

Via le righe 14-16 e 330-409, con la riga vuota che seguiva la sezione. Nel commento di testa, dopo `Monaco in editor-monaco.js: qui il cablaggio.`, aggiungere:

```js
   Le barrette delle righe cambiate (docs/plans/63) stanno in
   editor-tab-gutter.js, caricato prima di questo.
```

Controllo: `grep -n "EditorGutter\|EDITOR_GUTTER_DELAY\|sameGutterBase\|editorHeadWarned" renderer/editor-tab.js` non trova più niente. `wc -l renderer/editor-tab.js` dà circa 700.

- [ ] **Step 3: caricarlo nella pagina**

In `renderer/index.html`, fra `<script src="git-tab.js"></script>` e `<script src="editor-tab.js"></script>`:

```html
<script src="editor-tab-gutter.js"></script>
```

In `tests/renderer-source.js`, in `RENDERER_APP_FILES`, fra `'git-tab.js',` e `'editor-tab.js',`:

```js
  'editor-tab-gutter.js',
```

In `tests/renderer-load.test.js`, nel secondo test, la lista `expected` prende `'loadEditorGutterBase'` dopo `'initEditorTabs'`:

```js
    'createEditorTab', 'initEditorTabs', 'loadEditorGutterBase'];
```

- [ ] **Step 4: dividere i test**

Creare `tests/editor-tab-setup.js` con le righe 13-83 di `tests/editor-tab.test.js` (`settle`, `deferred`, `fakeHost`, `setup`) e la riga 284 (`plain`), identiche, sotto questa testata:

```js
/* Aiuti comuni ai test della scheda editor (editor-tab.test.js,
   editor-tab-gutter.test.js). La scheda vive nello scope globale del
   renderer: si carica la pagina vera (renderer-page.js) e si chiamano le sue
   funzioni su una scheda finta. Monaco è un `host` finto che ricorda il testo
   e le modifiche; il main è un `window.aisess` finto. */
const vm = require('vm');
const { loadPage, stub } = require('./renderer-page');

// … settle, deferred, fakeHost, setup (righe 13-83), identici …

/** Array e oggetti nati nel contesto vm della pagina hanno altri prototipi: si confrontano in copia. */
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { settle, deferred, fakeHost, setup, plain };
```

In `tests/editor-tab.test.js`:
- le righe 1-5 diventano:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement } = require('./fake-dom');
const { settle, deferred, setup, plain } = require('./editor-tab-setup');
```

- il commento delle righe 7-11 resta;
- via le righe 13-83, la riga 284 col suo commento (283) e le righe 514-750 (sezione `barrette delle righe cambiate`).

Creare `tests/editor-tab-gutter.test.js` con le righe 514-750 di prima, identiche, sotto:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { stub } = require('./renderer-page');
const { settle, setup, plain } = require('./editor-tab-setup');

/* Le barrette delle righe cambiate nella scheda editor (docs/plans/63,
   renderer/editor-tab-gutter.js), con la pagina vera e un host finto. */
```

Controllo: `grep -c "^ok(" tests/editor-tab.test.js tests/editor-tab-gutter.test.js` dà 27 e 15 (insieme sono i 42 di prima).

- [ ] **Step 5: verificare**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-tab.test.js tests/editor-tab-gutter.test.js tests/renderer-load.test.js`
Expected: PASS, 45 test (27 + 15 + 3).

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1620 test (1619 pass, 1 skip), come prima.

- [ ] **Step 6: commit**

```bash
git add renderer/editor-tab-gutter.js renderer/editor-tab.js renderer/index.html tests/renderer-source.js tests/renderer-load.test.js tests/editor-tab-setup.js tests/editor-tab-gutter.test.js tests/editor-tab.test.js
cat > /tmp/msg.txt <<'EOF'
refactor: barrette della scheda editor in editor-tab-gutter.js

editor-tab.js era a 783 righe e il piano 64 ci aggiunge openEditorAt,
che legge solo lo stato delle barrette: oltre il tetto di 800. Le
barrette (calcolo, timer, lettura di HEAD) passano identiche in un
file loro, caricato prima di editor-tab.js; i test seguono, con gli
aiuti comuni in editor-tab-setup.js. Nessuna riga di logica cambia:
se qualcosa si rompe qui è lo spostamento.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 2: `renderer/editor-route.js`, quale scheda editor apre un file

**Files:**
- Create: `renderer/editor-route.js`
- Create: `tests/editor-route.test.js`
- Modify: `renderer/index.html` (modulo dopo `editor-gutter.js`)

**Interfaces:**
- Consumes: niente.
- Produces: `window.AisessEditorRoute` / `module.exports` = `{ editorTarget }`.
  - `editorTarget({ repoRoot, path, tabs = [], platform }) → { tabId, rel } | { cwd, rel } | null`
  - `repoRoot`: la radice del repository (`result.root`). `path`: il percorso del file come lo dà git, relativo alla radice. `tabs`: le schede nell'ordine della barra laterale (`{ id, type, cwd }`).
  - `{ tabId, rel }`: la prima scheda `type === 'editor'` la cui cartella contiene il file, con `rel` relativo a quella cartella. `{ cwd: repoRoot, rel }`: nessuna scheda va bene e se ne crea una sulla radice. `null`: radice o percorso non validi (vuoti, o che risalgono con `..`).
  - `rel` è sempre unito con `/`.

- [ ] **Step 1: scrivere il test che fallisce**

Creare `tests/editor-route.test.js`:

```js
const path = require('path');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { editorTarget } = require('../renderer/editor-route');

/* Quale scheda editor apre un file del pannello modifiche (docs/plans/64). */

const ROOT = '/repo';
const ed = (id, cwd) => ({ id, type: 'editor', cwd });
const target = (tabs, file = 'lib/x.js', platform = 'linux') => editorTarget({ repoRoot: ROOT, path: file, tabs, platform });

ok('apri nell editor: una scheda sulla radice del repository si usa', () => {
  assert.deepStrictEqual(target([ed('a', ROOT)]), { tabId: 'a', rel: 'lib/x.js' });
});

ok('apri nell editor: una scheda su una sottocartella che contiene il file si usa, col percorso relativo a lei', () => {
  assert.deepStrictEqual(target([ed('a', `${ROOT}/lib/`)]), { tabId: 'a', rel: 'x.js' });
  assert.deepStrictEqual(target([ed('a', `${ROOT}/lib`)], 'lib/sub/y.js'), { tabId: 'a', rel: 'sub/y.js' });
});

ok('apri nell editor: una sottocartella che non contiene il file non vale, nemmeno con un nome che è un prefisso', () => {
  const tabs = [ed('a', `${ROOT}/docs`), ed('b', `${ROOT}/li`), ed('c', `${ROOT}/lib/x.js`), ed('d', '/altro')];
  assert.deepStrictEqual(target(tabs), { cwd: ROOT, rel: 'lib/x.js' });
});

ok('apri nell editor: senza schede se ne apre una sulla radice', () => {
  assert.deepStrictEqual(target([]), { cwd: ROOT, rel: 'lib/x.js' });
  assert.deepStrictEqual(editorTarget({ repoRoot: ROOT, path: 'a.md', platform: 'linux' }), { cwd: ROOT, rel: 'a.md' });
});

ok('apri nell editor: le schede non editor non contano, e fra due editor vince la prima nell ordine', () => {
  const tabs = [{ id: 's', type: 'shell', cwd: ROOT }, { id: 'g', type: 'git', cwd: ROOT }, ed('a', `${ROOT}/lib`), ed('b', ROOT)];
  assert.deepStrictEqual(target(tabs), { tabId: 'a', rel: 'x.js' });
  assert.deepStrictEqual(target([ed('b', ROOT), ed('a', `${ROOT}/lib`)]), { tabId: 'b', rel: 'lib/x.js' });
});

ok('apri nell editor: percorsi Windows, separatori misti e maiuscole diverse', () => {
  const root = path.win32.join('C:\\', 'Users', 'ale', 'repo');
  const tab = ed('a', path.win32.join('c:\\', 'users', 'ALE', 'repo', 'src'));
  assert.deepStrictEqual(editorTarget({ repoRoot: root, path: 'src/App.js', tabs: [tab], platform: 'win32' }), { tabId: 'a', rel: 'App.js' });
  assert.deepStrictEqual(editorTarget({ repoRoot: 'C:/Users/ale/repo', path: 'src/App.js', tabs: [ed('b', root)], platform: 'win32' }),
    { tabId: 'b', rel: 'src/App.js' });
  // Fuori da Windows le maiuscole contano: stessa cartella scritta diversa, scheda nuova
  assert.deepStrictEqual(editorTarget({ repoRoot: root, path: 'src/App.js', tabs: [tab], platform: 'linux' }), { cwd: root, rel: 'src/App.js' });
});

ok('apri nell editor: radice o percorso non validi danno null', () => {
  for (const bad of [{ repoRoot: '', path: 'a.js' }, { repoRoot: null, path: 'a.js' }, { repoRoot: ROOT, path: '' },
    { repoRoot: ROOT, path: '../fuori.js' }, { repoRoot: ROOT, path: 'a/../../b.js' }, { repoRoot: ROOT, path: 7 }]) {
    assert.strictEqual(editorTarget({ ...bad, tabs: [ed('a', ROOT)], platform: 'linux' }), null, JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: verificare che fallisce**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-route.test.js`
Expected: FAIL, `Cannot find module '../renderer/editor-route'`.

- [ ] **Step 3: scrivere il modulo**

Creare `renderer/editor-route.js`:

```js
/* Quale scheda editor apre un file del pannello modifiche (docs/plans/64).
 * Puro: riceve la radice del repository, il percorso del file come lo dà
 * git (relativo alla radice) e le schede nell'ordine della barra laterale.
 * Una scheda editor vale se la sua cartella contiene il file; se nessuna va
 * bene se ne apre una sulla radice. Separatori `/` e `\` insieme, e su
 * Windows maiuscole e minuscole uguali (regole Windows del CLAUDE.md).
 *
 * Wrapper UMD come editor-gutter.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorRoute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // Nel renderer non c'è process.platform: Windows si riconosce dal navigator
  const pagePlatform = () => (typeof navigator !== 'undefined' && /^win/i.test(navigator.platform || '') ? 'win32' : 'posix');

  /* I pezzi di un percorso; null se non è una stringa piena o se risale con «..» */
  function pieces(p) {
    if (typeof p !== 'string' || !p) return null;
    const parts = p.split(/[\\/]+/).filter((s) => s && s !== '.');
    return parts.includes('..') ? null : parts;
  }

  const samePiece = (win) => (a, b) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);

  /* Il resto di `file` sotto `dir`; null se `dir` non lo contiene (un file non contiene sé stesso) */
  function under(dir, file, same) {
    if (dir.length >= file.length) return null;
    return dir.every((s, i) => same(s, file[i])) ? file.slice(dir.length) : null;
  }

  /**
   * @param {{repoRoot: string, path: string, tabs?: Array<{id: string, type: string, cwd: string}>,
   *   platform?: string}} o
   * @returns {{tabId: string, rel: string}|{cwd: string, rel: string}|null}
   */
  function editorTarget({ repoRoot, path, tabs = [], platform = pagePlatform() } = {}) {
    const rootParts = pieces(repoRoot);
    const relParts = pieces(path);
    if (!rootParts || !relParts || !relParts.length) return null;
    const file = [...rootParts, ...relParts];
    const same = samePiece(platform === 'win32');
    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (!tab || tab.type !== 'editor') continue;
      const dir = pieces(tab.cwd);
      const rest = dir && under(dir, file, same);
      if (rest) return { tabId: tab.id, rel: rest.join('/') };
    }
    return { cwd: repoRoot, rel: relParts.join('/') };
  }

  return { editorTarget };
});
```

In `renderer/index.html`, subito dopo `<script src="editor-gutter.js"></script>`:

```html
<script src="editor-route.js"></script>
```

- [ ] **Step 4: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-route.test.js tests/renderer-load.test.js`
Expected: PASS, 7 + 3 test.

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1627 test (1626 pass, 1 skip).

- [ ] **Step 5: commit**

```bash
git add renderer/editor-route.js renderer/index.html tests/editor-route.test.js
cat > /tmp/msg.txt <<'EOF'
feat: editor-route, quale scheda editor apre un file del pannello

Il bottone «Apri nell'editor» del pannello modifiche deve riusare una
scheda editor che contiene già il file, e solo altrimenti aprirne una
sulla radice del repository. La scelta è pura (radice, percorso,
schede in ordine) e si prova da Node, Windows compreso: separatori
misti e maiuscole che su win32 non contano.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 3: `openEditorAt`, il file aperto al primo blocco cambiato

**Files:**
- Modify: `renderer/editor-gutter.js` (`firstChangedLine`)
- Modify: `tests/editor-gutter.test.js` (un test)
- Modify: `renderer/editor-tab-gutter.js` (`readEditorGutterBase`, `loadEditorGutterBase` che registra, `editorGutterReady`, `openEditorAt`)
- Modify: `renderer/editor-tab.js` (`gutterReads` nello stato, `createEditorTab` restituisce la scheda)
- Modify: `tests/editor-tab-setup.js` (`reveal` nell'host finto, `gutterReads` nella scheda finta)
- Modify: `tests/editor-tab-gutter.test.js` (5 test)

**Interfaces:**
- Consumes: `openEditorFile(tab, rel) → Promise<boolean>`, `editorFileChanges(tab, rel)`, `host.reveal(rel, line)` (`editor-monaco.js`, piano 63), `tabs`.
- Produces:
  - `EditorGutter.firstChangedLine(ranges) → number|null`
  - `openEditorAt(tab, rel) → Promise<boolean>`: false se il file non si apre (l'errore lo mostra `openEditorFile`, come sempre); true altrimenti, anche quando il cursore non si sposta
  - `editorGutterReady(tab, rel) → Promise<void>`
  - `loadEditorGutterBase(tab, rel)`: stessa firma e stesso effetto, in più tiene in `ed.gutterReads` la promise più recente per file
  - `createEditorTab(…) → Promise<tab>`, e quindi `createTab('editor', …) → Promise<tab>`

- [ ] **Step 1: scrivere i test che falliscono**

In `tests/editor-gutter.test.js`, la riga 3 diventa:

```js
const { MAX_GUTTER_LINES, diffLines, changeRanges, firstChangedLine } = require('../renderer/editor-gutter');
```

e in fondo:

```js
ok('barrette: firstChangedLine dà la prima riga del primo blocco, null senza blocchi', () => {
  assert.strictEqual(firstChangedLine(null), null);
  assert.strictEqual(firstChangedLine([]), null);
  assert.strictEqual(firstChangedLine([{ kind: 'mod', from: 7, to: 9 }, { kind: 'add', from: 3, to: 3 }]), 3);
  assert.strictEqual(firstChangedLine([{ kind: 'del', after: 4 }, { kind: 'mod', from: 9, to: 9 }]), 4);
  assert.strictEqual(firstChangedLine([{ kind: 'del', after: 0 }, { kind: 'add', from: 5, to: 6 }]), 1, 'tolte in cima: riga 1');
});
```

In `tests/editor-tab-setup.js`, nell'oggetto restituito da `fakeHost`, dopo `activate`:

```js
    reveals: [], // a parte come gutters: dove si è portato il cursore
    reveal(rel, line) { this.reveals.push([rel, line]); },
```

e nella scheda finta di `setup`, dopo `gutterSeqLast: 0`:

```js
gutterReads: new Map(),
```

In fondo a `tests/editor-tab-gutter.test.js`:

```js
/* ---------- aprire al primo blocco cambiato (docs/plans/64) ---------- */

/** Aspetta che il main finto abbia ricevuto `n` letture di HEAD (al massimo 20 giri). */
async function headReads(resolvers, n) {
  for (let i = 0; i < 20 && resolvers.length < n; i++) await settle();
  assert.strictEqual(resolvers.length, n);
}

ok('apri alla riga: apre il file e porta il cursore al primo blocco cambiato', async () => {
  const s = gutterSetup({ main: { editorRead: read('uno\nDUE\ntre\nquattro\n'), editorHeadText: async () => ({ ok: true, text: 'uno\ndue\ntre\n' }) } });
  assert.strictEqual(await s.fn('openEditorAt')(s.tab, 'a.txt'), true);
  assert.strictEqual(s.tab.editor.files.active, 'a.txt');
  assert.deepStrictEqual(plain(s.host.reveals), [['a.txt', 2]]);
});

ok('apri alla riga: uguale a HEAD o fuori da git il cursore resta dov è', async () => {
  for (const editorHeadText of [async () => ({ ok: true, text: 'uno\n' }), async () => ({ ok: false, reason: 'not-repo' })]) {
    const s = gutterSetup({ main: { editorRead: read('uno\n'), editorHeadText } });
    assert.strictEqual(await s.fn('openEditorAt')(s.tab, 'a.txt'), true);
    assert.deepStrictEqual(s.host.reveals, []);
  }
});

ok('apri alla riga: un file che non si apre dà false, senza leggere HEAD', async () => {
  const s = gutterSetup({ main: { editorRead: async () => ({ ok: false, reason: 'missing' }) } });
  assert.strictEqual(await s.fn('openEditorAt')(s.tab, 'via.txt'), false);
  assert.deepStrictEqual(s.sent('editorHeadText'), []);
  assert.deepStrictEqual(s.host.reveals, []);
});

ok('apri alla riga: se intanto parte una lettura di HEAD più nuova, aspetta quella', async () => {
  const resolvers = [];
  const s = gutterSetup({ main: { editorRead: read('uno\nDUE\n'), editorHeadText: () => new Promise((r) => resolvers.push(r)) } });
  const opened = s.fn('openEditorAt')(s.tab, 'a.txt');
  await headReads(resolvers, 1);
  s.fn('loadEditorGutterBase')(s.tab, 'a.txt'); // come refreshEditorTab, che setActive fa partire
  await headReads(resolvers, 2);
  resolvers[0]({ ok: true, text: 'uno\nDUE\n' }); // superata: si scarta, e non si salta ancora
  await settle();
  assert.deepStrictEqual(s.host.reveals, []);
  resolvers[1]({ ok: true, text: 'uno\ndue\n' });
  assert.strictEqual(await opened, true);
  assert.deepStrictEqual(plain(s.host.reveals), [['a.txt', 2]]);
});

ok('apri alla riga: se intanto si passa a un altro file il cursore non salta', async () => {
  const resolvers = [];
  const s = gutterSetup({
    files: { 'b.txt': { text: 'b', mtime: 1 } },
    main: { editorRead: read('uno\nDUE\n'), editorHeadText: () => new Promise((r) => resolvers.push(r)) },
  });
  const opened = s.fn('openEditorAt')(s.tab, 'a.txt');
  await headReads(resolvers, 1);
  s.fn('activateEditorFile')(s.tab, 'b.txt', { save: false });
  resolvers[0]({ ok: true, text: 'uno\ndue\n' });
  assert.strictEqual(await opened, true);
  assert.deepStrictEqual(s.host.reveals, []);
  assert.deepStrictEqual(plain(s.fn('editorFileChanges')(s.tab, 'a.txt')), [{ kind: 'mod', from: 2, to: 2 }], 'le barrette ci sono lo stesso');
});
```

- [ ] **Step 2: verificare che falliscono**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-gutter.test.js tests/editor-tab-gutter.test.js`
Expected: FAIL. `firstChangedLine is not a function`, e `openEditorAt is not defined` (ReferenceError dal contesto vm) nei 5 test nuovi. I 13 + 15 test di prima passano.

- [ ] **Step 3: `firstChangedLine` in `renderer/editor-gutter.js`**

Prima del `return` finale:

```js
  /**
   * La riga dove portare il cursore: la più alta fra i blocchi di changeRanges
   * (docs/plans/64). Un blocco di righe tolte sta dopo `after`, e in cima è la 1.
   * @param {Array|null} ranges
   * @returns {number|null} null senza blocchi
   */
  function firstChangedLine(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return null;
    return ranges.reduce((min, r) => Math.min(min, r.kind === 'del' ? Math.max(1, r.after) : r.from), Infinity);
  }
```

e il `return` diventa:

```js
  return { MAX_GUTTER_LINES, MAX_DIFF_STEPS, diffLines, changeRanges, firstChangedLine };
```

- [ ] **Step 4: le letture di HEAD si possono aspettare (`renderer/editor-tab-gutter.js`)**

`async function loadEditorGutterBase(tab, rel)` si rinomina `readEditorGutterBase`: corpo e commento restano quelli. Subito dopo:

```js
/* Rilegge HEAD per un file (readEditorGutterBase) e tiene in `gutterReads`
   la promise più recente, finché non risolve: chi deve aspettare le
   barrette (openEditorAt) aspetta quella, senza lanciarne un'altra. */
function loadEditorGutterBase(tab, rel) {
  const reads = tab.editor.gutterReads;
  const read = readEditorGutterBase(tab, rel);
  reads.set(rel, read);
  const done = () => { if (reads.get(rel) === read) reads.delete(rel); };
  read.then(done, done);
  return read;
}

/* Aspetta la lettura di HEAD in volo per il file, e quella che l'ha
   sostituita se intanto ne è partita un'altra (setActive → refreshEditorTab) */
async function editorGutterReady(tab, rel) {
  const reads = tab.editor.gutterReads;
  for (let p = reads.get(rel), seen = null; p && p !== seen; p = reads.get(rel)) {
    seen = p;
    await p.catch(() => {});
  }
}
```

E dopo `editorFileChanges`:

```js
/**
 * Apre un file e porta il cursore al primo blocco cambiato rispetto a HEAD
 * (pannello modifiche, docs/plans/64). Senza barrette (uguale a HEAD, fuori
 * da git, troppo grande) il cursore resta dov'è. Si salta solo se il file è
 * ancora quello attivo: intanto l'utente può essere passato a un altro.
 * @returns {Promise<boolean>} false se il file non si apre (l'errore lo mostra openEditorFile)
 */
async function openEditorAt(tab, rel) {
  if (!(await openEditorFile(tab, rel))) return false;
  await editorGutterReady(tab, rel);
  const ed = tab.editor;
  if (!tabs.has(tab.id) || !ed.host || ed.files.active !== rel) return true;
  const line = EditorGutter.firstChangedLine(editorFileChanges(tab, rel));
  if (line) ed.host.reveal(rel, line);
  return true;
}
```

- [ ] **Step 5: `renderer/editor-tab.js`**

Nello stato di `createEditorTab`, dopo `gutterSeqLast: 0`:

```js
gutterReads: new Map(),
```

In fondo a `createEditorTab`, dopo la riga `if (active && tab.editor.files.files[active]) activateEditorFile(…);`:

```js
  return tab;
```

`createTab` in `tabs.js` fa già `return createEditorTab(…)`: non cambia.

- [ ] **Step 6: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-gutter.test.js tests/editor-tab-gutter.test.js tests/editor-tab.test.js`
Expected: PASS, 14 + 20 + 27 test.

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1633 test (1632 pass, 1 skip).

- [ ] **Step 7: commit**

```bash
git add renderer/editor-gutter.js renderer/editor-tab-gutter.js renderer/editor-tab.js tests/editor-gutter.test.js tests/editor-tab-setup.js tests/editor-tab-gutter.test.js
cat > /tmp/msg.txt <<'EOF'
feat: openEditorAt, il file aperto al primo blocco cambiato

Dal pannello modifiche il file deve aprirsi sulla prima riga cambiata
rispetto a HEAD, presa dalle barrette del piano 63. Le barrette
arrivano dopo il testo, e setActive può far ripartire la lettura di
HEAD: le letture in volo restano in gutterReads e openEditorAt aspetta
l'ultima, senza lanciarne un'altra. Il cursore salta solo se il file è
ancora quello attivo. createEditorTab ora restituisce la scheda, per
chi la crea e ci deve aprire un file.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 4: bottone «Apri nell'editor» nel pannello modifiche

**Files:**
- Modify: `renderer/changes-model.js` (`openableInEditor`)
- Modify: `tests/changes-model.test.js` (un test)
- Modify: `renderer/changes-view.js` (opzione `onOpenFile`, stato `openable`, bottone in `fileRow`)
- Modify: `tests/changes-view.test.js` (3 test)
- Modify: `renderer/styles.css` (hover del bottone)
- Modify: `renderer/changes-panel.js` (`openChangedFile`, `openable` nel render, `onOpenFile` in `initChangesPanel`)
- Create: `tests/changes-open-editor.test.js` (3 test)
- Modify: `tests/git-staging.test.js` (un test: `root` c'è)

**Interfaces:**
- Consumes: `editorTarget` (Task 2), `openEditorAt` e `createTab('editor', { cwd }) → Promise<tab>` (Task 3), `setActive(id)`, `tabs`, `Order.applyOrder`, `sessionOrder`, `changesState.result.root`.
- Produces:
  - `ChangesModel.openableInEditor(f) → boolean`
  - `createChangesView({ …, onOpenFile?: (path: string) => void })` e, in `render(state)`, `state.openable?: boolean`
  - `openChangedFile(path) → Promise<void>` (scope globale del renderer)

- [ ] **Step 1: scrivere i test che falliscono**

In `tests/changes-model.test.js`, in fondo:

```js
ok('modifiche: si apre nell editor un file che c è ed è testo', () => {
  const f = (extra) => ({ path: 'a.js', status: 'M', binary: false, ...extra });
  assert.strictEqual(M.openableInEditor(f()), true);
  assert.strictEqual(M.openableInEditor(f({ status: '?' })), true, 'nuovo, non tracciato');
  assert.strictEqual(M.openableInEditor(f({ status: 'A' })), true);
  assert.strictEqual(M.openableInEditor(f({ status: 'R', oldPath: 'b.js' })), true);
  assert.strictEqual(M.openableInEditor(f({ status: 'D' })), false, 'cancellato');
  assert.strictEqual(M.openableInEditor(f({ binary: true })), false, 'binario');
  assert.strictEqual(M.openableInEditor(f({ special: true })), false, 'non è un file');
  assert.strictEqual(M.openableInEditor(f({ path: '' })), false);
  assert.strictEqual(M.openableInEditor(null), false);
});
```

In `tests/changes-view.test.js`, in fondo:

```js
/* ---------- apri nell'editor (docs/plans/64) ---------- */

const openButtons = (host) => byClass(host, 'changes-open-editor');

ok('apri nell editor: il bottone c è sui file modificati e nuovi, non su cancellati, binari e non file', () => {
  const { host, view } = setup({ onOpenFile: () => {} });
  view.render(baseState({ openable: true, files: [
    file('m.js'), file('n.js', { status: '?' }), file('via.js', { status: 'D' }),
    file('logo.png', { binary: true, added: null, removed: null }), file('link', { special: true }),
  ] }));
  const heads = byClass(host, 'changes-file-head');
  assert.deepStrictEqual(heads.map((h) => openButtons(h).length), [1, 1, 0, 0, 0]);
  const b = openButtons(heads[0])[0];
  assert.strictEqual(b.tag, 'button');
  assert.strictEqual(b.type, 'button');
  assert.strictEqual(b.title, "Apri nell'editor");
  assert.strictEqual(b.getAttribute('aria-label'), "Apri nell'editor");
  assert.strictEqual(heads[0].children.indexOf(b), 1, 'subito dopo la riga, non dentro');
  assert.strictEqual(byClass(one(heads[0], 'changes-file-row'), 'changes-open-editor').length, 0);
});

ok('apri nell editor: il click passa il percorso e non apre il diff', () => {
  const opened = [];
  const { host, view, calls } = setup({ onOpenFile: (p) => opened.push(p) });
  view.render(baseState({ openable: true, files: [file('lib/x.js')] }));
  const e = fire(openButtons(host)[0], 'click');
  assert.deepStrictEqual(opened, ['lib/x.js']);
  assert.strictEqual(e.propagationStopped, true);
  assert.deepStrictEqual(calls.files, [], 'il diff resta chiuso');
});

ok('apri nell editor: niente bottone se il pannello non lo chiede o nessuno lo ascolta', () => {
  const noListener = setup();
  noListener.view.render(baseState({ openable: true, files: [file('a.js')] }));
  assert.strictEqual(openButtons(noListener.host).length, 0);
  const notOpenable = setup({ onOpenFile: () => {} });
  notOpenable.view.render(baseState({ files: [file('a.js')] }));
  assert.strictEqual(openButtons(notOpenable.host).length, 0, 'senza openable, come in modalità Unisci');
});
```

In `tests/git-staging.test.js`, in fondo:

```js
ok('da committare: dice la radice del repository anche aperto da una sottocartella (piano 64)', async () => {
  const r = await readStaging({ cwd: `${ROOT}/lib`, run: fakeGit(), fsp: noDisk });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.root, ROOT);
});
```

Creare `tests/changes-open-editor.test.js`:

```js
const vm = require('vm');
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { loadPage } = require('./renderer-page');

/* Il bottone «Apri nell'editor» del pannello modifiche (docs/plans/64,
   renderer/changes-panel.js): la pagina vera, con setActive, createTab e
   openEditorAt sostituiti da registratori. */

function panelSetup({ result = { ok: true, root: '/repo', files: [] }, merge = null, tabs = [] } = {}) {
  const page = loadPage();
  const run = (code) => vm.runInContext(code, page.ctx);
  const calls = [];
  page.ctx.setActive = (id) => { calls.push(['setActive', id]); };
  page.ctx.createTab = async (type, opts) => {
    calls.push(['createTab', type, { ...opts }]);
    const tab = { id: 'tab-nuova', type, cwd: opts.cwd };
    run('tabs').set(tab.id, tab);
    return tab;
  };
  page.ctx.openEditorAt = async (tab, rel) => { calls.push(['openEditorAt', tab.id, rel]); return true; };
  for (const t of tabs) run('tabs').set(t.id, t);
  page.ctx.panelPatch = { result, merge };
  run('changesState = { ...changesState, ...panelPatch }');
  return { calls, open: (p) => run('openChangedFile')(p) };
}

ok('apri nell editor dal pannello: una scheda editor che contiene il file si riusa', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/lib' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['setActive', 'tab-ed'], ['openEditorAt', 'tab-ed', 'x.js']]);
});

ok('apri nell editor dal pannello: senza una scheda adatta se ne crea una sulla radice', async () => {
  const s = panelSetup({ tabs: [{ id: 'tab-sh', type: 'shell', cwd: '/repo' }, { id: 'tab-ed', type: 'editor', cwd: '/repo/docs' }] });
  await s.open('lib/x.js');
  assert.deepStrictEqual(s.calls, [['createTab', 'editor', { cwd: '/repo' }], ['openEditorAt', 'tab-nuova', 'lib/x.js']]);
});

ok('apri nell editor dal pannello: in modalità Unisci, senza lettura o senza radice non fa niente', async () => {
  for (const opts of [{ merge: { kind: 'worktree' } }, { result: null }, { result: { ok: false, error: 'x' } }, { result: { ok: true, files: [] } }]) {
    const s = panelSetup({ ...opts, tabs: [{ id: 'tab-ed', type: 'editor', cwd: '/repo' }] });
    await s.open('a.js');
    assert.deepStrictEqual(s.calls, [], JSON.stringify(opts));
  }
});
```

- [ ] **Step 2: verificare che falliscono**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/changes-model.test.js tests/changes-view.test.js tests/changes-open-editor.test.js tests/git-staging.test.js`
Expected: FAIL. `M.openableInEditor is not a function`, i 3 test della vista non trovano il bottone, e `openChangedFile is not defined` nei 3 del pannello. Il test di `git-staging` passa già (la radice c'è), e resta a fissarlo.

- [ ] **Step 3: `openableInEditor` in `renderer/changes-model.js`**

Prima del `return` finale, vicino a `fileCounts`:

```js
  /** Se un file del pannello si può aprire nell'editor (docs/plans/64): c'è sul disco ed è testo. */
  const openableInEditor = (f) => Boolean(f && typeof f.path === 'string' && f.path
    && f.status !== 'D' && !f.binary && !f.special);
```

e `openableInEditor` si aggiunge all'oggetto restituito, dopo `fileCounts`.

- [ ] **Step 4: il bottone in `renderer/changes-view.js`**

Sopra `fileRow`:

```js
  /* «Apri nell'editor» (docs/plans/64): accanto alla riga, e il click non
     apre né chiude il diff. Passa il percorso, non l'id della riga. */
  function openButton(doc, f, onOpen) {
    return button(doc, 'changes-file-act changes-open-editor', '↗', "Apri nell'editor", (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      onOpen(f.path);
    });
  }
```

`fileRow` prende un parametro in più, `onOpen` (una funzione o null), e mette il bottone subito dopo la riga:

```js
  function fileRow(doc, f, diff, onFile, rc, cc, onOpen) {
```

```js
    head.appendChild(row);
    if (onOpen && M.openableInEditor(f)) head.appendChild(openButton(doc, f, onOpen));
    for (const act of rowActions(doc, f, cc)) head.appendChild(act);
```

`fileItems` lo passa:

```js
  function fileItems(doc, state, diffOf, onFile, reviewOf, cc, onOpen) {
    const row = (f) => fileRow(doc, f, diffOf(M.itemId(f)), onFile, reviewOf(f.path), cc, onOpen);
```

`createChangesView` prende l'opzione, dopo `onCommit = () => {},`:

```js
    onOpenFile = null,
```

Nel JSDoc delle opzioni, dopo `onCommit?: …`, si aggiunge `onOpenFile?: (path: string) => void`. In quello di `render`, dopo `discard?: …`, si aggiunge `openable?: boolean`. In `render`, la riga che chiama `fileItems` diventa:

```js
      const onOpen = state.openable && onOpenFile ? onOpenFile : null;
      if (state.files.length) items.push(...fileItems(doc, state, diffOf, onFile, reviewOf(state), cc, onOpen));
```

In `renderer/styles.css`, dopo la regola di hover di `.changes-file-act.changes-discard`:

```css
.changes-file-act.changes-open-editor:hover, .changes-file-act.changes-open-editor:focus-visible { color: var(--text); background: var(--surface-2); outline: none; }
```

- [ ] **Step 5: il cablaggio in `renderer/changes-panel.js`**

In `renderChanges`, nell'oggetto passato a `changesView.render`, dopo `discard: …`:

```js
    // In modalità Unisci si guarda un altro worktree o un branch in arrivo: niente editor
    openable: !merge,
```

Sopra `initChangesPanel`:

```js
/* ---------- Apri nell'editor (docs/plans/64) ---------- */

/* Il bottone su un file: si riusa la prima scheda editor (nell'ordine della
   barra laterale) che contiene il file, altrimenti se ne apre una sulla
   radice del repository; poi il file si apre al primo blocco cambiato. */
async function openChangedFile(path) {
  const { result, merge } = changesState;
  if (merge || !result || !result.ok || typeof result.root !== 'string') return;
  const target = window.AisessEditorRoute.editorTarget({
    repoRoot: result.root, path, tabs: Order.applyOrder([...tabs.values()], sessionOrder),
  });
  if (!target) return;
  let tab = target.tabId ? tabs.get(target.tabId) : null;
  if (tab) setActive(tab.id);
  else tab = await createTab('editor', { cwd: target.cwd });
  if (!tab || !tabs.has(tab.id)) return;
  await openEditorAt(tab, target.rel);
}
```

In `initChangesPanel`, dopo `onCommit: (action) => handleCommit(action),`:

```js
    onOpenFile: (path) => { openChangedFile(path).catch((e) => console.warn('[modifiche] apri nell\'editor', e)); },
```

- [ ] **Step 6: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/changes-model.test.js tests/changes-view.test.js tests/changes-open-editor.test.js tests/git-staging.test.js tests/renderer-load.test.js`
Expected: PASS.

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: verde, 1641 test (1640 pass, 1 skip).

- [ ] **Step 7: smoke test**

`npm start` dal worktree, con una sessione agente su un repository con file modificati: aprire il pannello modifiche, click su `↗` di un file modificato. Si apre (o si riusa) la scheda editor e il cursore va sulla prima riga cambiata. La console del renderer non mostra errori, né violazioni della CSP.

- [ ] **Step 8: commit**

```bash
git add renderer/changes-model.js renderer/changes-view.js renderer/changes-panel.js renderer/styles.css tests/changes-model.test.js tests/changes-view.test.js tests/changes-open-editor.test.js tests/git-staging.test.js
cat > /tmp/msg.txt <<'EOF'
feat: «Apri nell'editor» sui file del pannello modifiche

Per correggere una riga vista nel diff bisognava aprire a mano una
scheda editor e cercare il file nell'albero. Il bottone accanto al
file riusa la prima scheda editor che lo contiene, oppure ne apre una
sulla radice del repository, e porta il cursore al primo blocco
cambiato. Non c'è sui file cancellati, binari o che non sono file, né
in modalità Unisci, dove il pannello guarda un altro worktree. Il click
non apre il diff. Il test su git-staging fissa la radice, che la
modalità staging dava già.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

## Punti aperti

- **Link simbolici:** `result.root` viene da `git rev-parse --show-toplevel`, che risolve i link. Una scheda editor aperta su un percorso con un link simbolico non combacia, e si apre una scheda nuova sulla stessa cartella. Per risolverlo serve un `realpath` dal main: va annotato nel piano che lo farà, non qui.
- **Il pannello resta aperto** sopra l'editor (la spec non dice di chiuderlo) e a destra può coprire la riga su cui si è saltati. `reveal` la mette al centro, quindi di solito si vede. Se dà fastidio, `toggleChangesPanel(false)` dopo l'apertura.
- **Un file già aperto e uguale a HEAD** tiene il cursore dov'era, non va in cima. La spec dice «resta in cima» pensando a un file appena aperto, ed è quello che succede in quel caso.
- **Staged di un file cancellato sul disco:** la riga staged ha `status 'M'`, quindi il bottone c'è, ma l'editor risponde «non esiste più». È l'errore di sempre nella scheda editor, come chiede la spec.
- **Cambiare scheda sposta il pannello:** con una scheda editor attiva, il pannello mostra le modifiche della sua cartella (`targetFor` funziona per le schede editor). Nella stessa repository l'elenco resta lo stesso, ma la modalità «turno» non c'è per l'editor e il pannello passa a quella disponibile.

## Da verificare a mano (dopo i task)

Nell'app (`npm start` dal worktree):
- Dal pannello di una sessione agente, click su `↗` di un file modificato: si apre una scheda editor sulla radice del repository, il file è aperto e il cursore è sulla prima riga cambiata.
- Con una scheda editor già aperta sul repository (o sulla sottocartella del file): nessuna scheda nuova, si usa quella. Con due schede adatte vince la più in alto nella barra laterale.
- Un file nuovo non tracciato si apre alla riga 1. Su file cancellati e binari il bottone non c'è.
- In modalità «turno» e «staging» il bottone funziona allo stesso modo. Con «Unisci» non c'è.
- Il click su `↗` non apre il diff del file. Con Tab il bottone prende il fuoco e Invio lo attiva.

## Autorevisione

- **Copertura della spec:** il bottone e le sue esclusioni (Task 4, view e model), la scelta della scheda (Task 2, coi sei casi chiesti e un settimo per gli ingressi non validi), il cursore sul primo blocco e niente salto senza barrette (Task 3), la radice in staging (Task 4, test), l'attivazione della scheda (Task 4, `setActive` o `createTab`, che attiva da sé). Le modalità «turno» e «staging» passano dalla stessa strada, perché `root` c'è in tutte e due le letture.
- **Segnaposto:** nessuno. Nel Task 1 le parti spostate sono indicate per righe e vanno copiate identiche. È un refactor puro, e riscriverle nel piano sarebbe solo un'occasione per sbagliare.
- **Coerenza dei nomi:** `editorTarget`, `firstChangedLine`, `openableInEditor`, `openEditorAt`, `editorGutterReady`, `readEditorGutterBase`, `gutterReads`, `onOpenFile`, `openable`, `openChangedFile` sono gli stessi in Interfaces, codice e test. `loadEditorGutterBase` mantiene nome e firma, quindi i suoi chiamanti (`openEditorFile`, `renameEditorEntry`, il watch, `refreshEditorTab`) non cambiano.
- **Conteggi:** 1620 → 1620 (Task 1) → 1627 (+7) → 1633 (+1 gutter, +5 openEditorAt) → 1641 (+1 model, +3 view, +3 pannello, +1 staging).
- **Righe:** `editor-tab.js` scende a circa 700. `editor-tab-gutter.js` arriva a circa 140 col Task 3. `changes-view.js` passa da 627 a circa 640, `changes-panel.js` da 551 a circa 570. Tutti sotto 800.

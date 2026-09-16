# Raggruppamento sessioni per progetto — piano di esecuzione

> **Per chi esegue:** i passi hanno la checkbox (`- [ ]`) per essere spuntati uno
> a uno. Design e motivazioni stanno in
> [`08-raggruppamento-sessioni.md`](08-raggruppamento-sessioni.md): questo file
> dice *cosa digitare*, quello dice *perché*.

**Obiettivo:** la sidebar può raggruppare le sessioni aperte per tipo (come ora,
default) o per progetto, inteso come radice del repository git, e la scelta
sopravvive al riavvio.

**Architettura:** due moduli puri nuovi (`lib/project-root.js` nel main process,
che è l'unico a toccare il filesystem; `renderer/session-groups.js` nella
pagina, che il renderer non può importare da `lib/` perché gira sandboxed), un
handler IPC di sola lettura che li collega, e la sidebar che passa dal
raggruppamento cablato su `t.type` a una funzione parametrica.

**Stack:** Electron, JavaScript senza build step, test con il runner di Node
(`node --test`), niente framework di test né jsdom.

## Vincoli globali

- **`lib/` non fa mai `require('electron')`** — è ciò che rende quei moduli
  importabili dai test. Un test lo verifica.
- **`main.js` è solo cablaggio**: registra l'handler e delega. Niente logica.
  Un test lo verifica.
- **Il renderer non ha `require`**: un modulo condiviso con i test usa il
  wrapper UMD di `renderer/session-titles.js` (globale + `module.exports`).
- **CSP**: nessun `onclick=` nell'HTML, nessuno script inline. Gli handler si
  registrano da JavaScript. `script-src` non deve mai ammettere `unsafe-inline`.
- **Dati esterni nella pagina**: `textContent` o `escapeHtml`, mai `innerHTML`
  con interpolazione non escapata. I path delle directory sono dati esterni.
- **Immutabilità**: le funzioni pure non mutano gli argomenti, restituiscono
  strutture nuove.
- **Nessun colore hardcoded** nel CSS: solo i token di `renderer/tokens.css`.
- **Commit separati** per il refactor (task 7) e per il comportamento nuovo
  (task 1-6).
- Comandi test: `node --test tests/<file>.test.js` per un file solo,
  `npm run test:unit` per tutti.

---

## Task 1: `lib/project-root.js` — la radice git di una directory

**File:**
- Crea: `lib/project-root.js`
- Crea: `tests/project-root.test.js`

**Interfacce:**
- Consuma: `normalizeDir` da `lib/recent-dirs.js` (già esportata e già testata:
  accetta solo path assoluti, toglie lo slash finale, ritorna `null` sul resto).
- Produce: `findProjectRoot(dir, { exists })` → `string | null`. La usa il task 3.

- [ ] **Passo 1: scrivi il test che fallisce**

Crea `tests/project-root.test.js`:

```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* La radice del "progetto" di una sessione: la directory che contiene .git,
   risalendo dalla directory di lavoro. Senza .git il progetto è la directory
   stessa, così nessuna sessione resta senza gruppo. */
const { findProjectRoot } = require('../lib/project-root');

// realpathSync: su macOS os.tmpdir() è /var/... che è un symlink a /private/var
const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

ok('progetto: la radice è la directory con .git, anche da una sottocartella profonda', () => {
  const root = tmp('ais-repo-');
  fs.mkdirSync(path.join(root, '.git'));
  const deep = path.join(root, 'src', 'renderer', 'parts');
  fs.mkdirSync(deep, { recursive: true });

  assert.strictEqual(findProjectRoot(deep), root, 'la risalita non trova il repo');
  assert.strictEqual(findProjectRoot(root), root, 'la radice stessa non si riconosce');
  fs.rmSync(root, { recursive: true, force: true });
});

ok('progetto: .git come file (worktree e submodule) vale quanto la directory', () => {
  const root = tmp('ais-wt-');
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /altrove/.git/worktrees/x\n');
  const sub = path.join(root, 'pacchetto');
  fs.mkdirSync(sub);

  assert.strictEqual(findProjectRoot(sub), root, 'un worktree non viene riconosciuto come progetto');
  fs.rmSync(root, { recursive: true, force: true });
});

ok('progetto: senza .git fino alla radice del filesystem vale la directory di partenza', () => {
  assert.strictEqual(findProjectRoot('/home/tizio/note', { exists: () => false }), '/home/tizio/note');
  assert.strictEqual(findProjectRoot('/home/tizio/note/', { exists: () => false }), '/home/tizio/note',
    'lo slash finale non viene normalizzato');
  assert.strictEqual(findProjectRoot('/', { exists: () => false }), '/');
});

ok('progetto: input inutilizzabile non produce un gruppo fantasma', () => {
  for (const v of [null, undefined, '', '   ', 'relativo/senza/slash', 42]) {
    assert.strictEqual(findProjectRoot(v, { exists: () => false }), null, `accettato ${JSON.stringify(v)}`);
  }
});

ok('progetto: un errore del filesystem non fa saltare la risalita', () => {
  const boom = () => { throw new Error('EACCES: permission denied'); };
  assert.strictEqual(findProjectRoot('/opt/segreto/lavoro', { exists: boom }), '/opt/segreto/lavoro');
});
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/project-root.test.js`
Atteso: FAIL — `Cannot find module '../lib/project-root'`.

- [ ] **Passo 3: scrivi l'implementazione minima**

Crea `lib/project-root.js`:

```js
/* Radice del "progetto" di una sessione: la directory che contiene .git,
 * risalendo dalla directory di lavoro. Modulo puro, nessun require('electron'):
 * gira nel main process (l'unico con accesso al filesystem) ed è importabile
 * dai test. */

const fs = require('fs');
const path = require('path');
const { normalizeDir } = require('./recent-dirs');

/**
 * @param {string} dir directory di lavoro della sessione
 * @param {{ exists?: (p: string) => boolean }} [options] `exists` iniettabile per i test
 * @returns {string|null} radice del progetto; la `dir` stessa se non è in un
 *   repository; `null` se `dir` non è un percorso assoluto utilizzabile
 */
function findProjectRoot(dir, options = {}) {
  const exists = typeof options.exists === 'function' ? options.exists : fs.existsSync;
  const start = normalizeDir(dir);
  if (!start) return null;

  let current = start;
  for (;;) {
    try {
      // .git è una directory nei repository normali e un file nei worktree
      // e nei submodule: entrambi i casi valgono come radice.
      if (exists(path.join(current, '.git'))) return current;
    } catch {
      // Filesystem inaccessibile (permessi): meglio la directory di partenza
      // che nessun gruppo.
      return start;
    }
    const parent = path.dirname(current);
    if (parent === current) return start; // arrivati a '/'
    current = parent;
  }
}

module.exports = { findProjectRoot };
```

- [ ] **Passo 4: lancia il test e verifica che passi**

Esegui: `node --test tests/project-root.test.js`
Atteso: PASS, 5 test.

- [ ] **Passo 5: commit**

```bash
git add lib/project-root.js tests/project-root.test.js
git commit -m "feat: modulo per risalire alla radice git di una directory

Serve a raggruppare le sessioni per progetto: due schede aperte in
sottocartelle diverse dello stesso repository devono finire nello stesso
gruppo. Senza .git il progetto è la directory stessa."
```

---

## Task 2: `renderer/session-groups.js` — i gruppi della sidebar

**File:**
- Crea: `renderer/session-groups.js`
- Crea: `tests/session-groups.test.js`

**Interfacce:**
- Consuma: niente (funzione pura, nessun I/O).
- Produce, sul globale `AisessGroups` e su `module.exports`:
  - `groupSessions(sessions, { mode, typeOrder, typeLabels })` → `Group[]`
    con `Group = { key, kind: 'type'|'project', label, title, items }`
  - `relativeSubpath(cwd, root)` → `string` (vuota se la sessione sta nella radice)
  - `TYPE_ORDER` → `['shell','opencode','claude','codex','antigravity']`
  - `TYPE_LABELS` → `{ shell: 'Terminale', opencode: 'OpenCode', claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity' }`
  - `NO_PROJECT_LABEL` → `'Senza directory'`

  Le usano i task 4, 5 e 6. `TYPE_ORDER`/`TYPE_LABELS` sono gli stessi valori
  oggi hardcoded come `GROUP_ORDER`/`GROUP_LABELS` in `renderer/renderer.js`:
  qui diventano l'unica fonte.

- [ ] **Passo 1: scrivi il test che fallisce**

Crea `tests/session-groups.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Raggruppamento delle sessioni aperte nella sidebar: per tipo (default) o per
   progetto. Il modulo sta in renderer/ perché il renderer non ha require e non
   potrebbe importarlo da lib/; il wrapper UMD lo rende comunque testabile qui. */
const { groupSessions, relativeSubpath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL } = require('../renderer/session-groups');

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
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/session-groups.test.js`
Atteso: FAIL — `Cannot find module '../renderer/session-groups'`.

- [ ] **Passo 3: scrivi l'implementazione minima**

Crea `renderer/session-groups.js`:

```js
/* Gruppi della sidebar: per tipo di sessione (com'è sempre stato) o per
 * progetto, cioè per radice del repository.
 *
 * Sta in renderer/ e non in lib/ per un vincolo: il renderer gira sandboxed,
 * non ha require e non potrebbe importare un modulo di lib/. Il wrapper UMD
 * espone il globale `AisessGroups` nella pagina e lo stesso oggetto sotto Node,
 * per poterlo testare senza browser — come session-titles.js.
 *
 * Funzioni pure: nessun I/O, nessuna mutazione degli argomenti. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGroups = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const TYPE_ORDER = ['shell', 'opencode', 'claude', 'codex', 'antigravity'];
  const TYPE_LABELS = {
    shell: 'Terminale', opencode: 'OpenCode', claude: 'Claude',
    codex: 'Codex', antigravity: 'Antigravity',
  };
  const NO_PROJECT_KEY = '';
  const NO_PROJECT_LABEL = 'Senza directory';

  /**
   * @param {Array<{id: string, type: string, projectRoot?: string|null}>} sessions
   * @param {{mode?: 'type'|'project', typeOrder?: string[], typeLabels?: Record<string,string>}} [options]
   * @returns {Array<{key: string, kind: 'type'|'project', label: string, title: string, items: object[]}>}
   */
  function groupSessions(sessions, options = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    return options.mode === 'project' ? groupByProject(list) : groupByType(list, options);
  }

  function groupByType(sessions, { typeOrder = TYPE_ORDER, typeLabels = TYPE_LABELS } = {}) {
    // I tipi noti entrano per primi nella Map, che conserva l'ordine di
    // inserimento: i tipi sconosciuti finiscono in coda, come oggi.
    const byKey = new Map(typeOrder.map((t) => [t, []]));
    for (const s of sessions) {
      const key = s && s.type ? s.type : 'shell';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    const out = [];
    for (const [key, items] of byKey) {
      if (!items.length) continue;
      const label = typeLabels[key] || key;
      out.push({ key, kind: 'type', label, title: label, items });
    }
    return out;
  }

  function groupByProject(sessions) {
    const byKey = new Map();
    for (const s of sessions) {
      const key = s && typeof s.projectRoot === 'string' && s.projectRoot ? s.projectRoot : NO_PROJECT_KEY;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(s);
    }
    const roots = [...byKey.keys()].filter((k) => k !== NO_PROJECT_KEY);
    const labels = projectLabels(roots);
    // A parità di etichetta si ordina sulla chiave: così l'ordine è totale e
    // due render successivi non invertono mai due gruppi.
    const out = roots
      .map((key) => ({ key, kind: 'project', label: labels.get(key), title: key, items: byKey.get(key) }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    if (byKey.has(NO_PROJECT_KEY)) {
      out.push({ key: NO_PROJECT_KEY, kind: 'project', label: NO_PROJECT_LABEL, title: NO_PROJECT_LABEL, items: byKey.get(NO_PROJECT_KEY) });
    }
    return out;
  }

  /* Etichette dei progetti: il nome della cartella, che è quello che l'utente
     riconosce. Se due radici diverse hanno lo stesso nome, ENTRAMBE passano a
     "genitore/nome": disambiguarne una sola renderebbe il confronto illeggibile. */
  function projectLabels(roots) {
    const base = new Map(roots.map((r) => [r, lastSegments(r, 1)]));
    const count = new Map();
    for (const name of base.values()) count.set(name, (count.get(name) || 0) + 1);
    const out = new Map();
    for (const [rootPath, name] of base) out.set(rootPath, count.get(name) > 1 ? lastSegments(rootPath, 2) : name);
    return out;
  }

  function lastSegments(p, n) {
    const parts = String(p || '').split('/').filter(Boolean);
    if (!parts.length) return '/';
    return parts.slice(-n).join('/');
  }

  /** Path della sessione relativo alla radice del progetto; vuoto se coincidono. */
  function relativeSubpath(cwd, projectRoot) {
    const dir = String(cwd || '').replace(/\/+$/, '');
    const base = String(projectRoot || '').replace(/\/+$/, '');
    if (!dir || !base || dir === base) return '';
    // Il '/' finale evita che /repo-bis passi per una sottocartella di /repo
    if (!dir.startsWith(base + '/')) return '';
    return dir.slice(base.length + 1);
  }

  return { groupSessions, relativeSubpath, TYPE_ORDER, TYPE_LABELS, NO_PROJECT_LABEL };
});
```

- [ ] **Passo 4: lancia il test e verifica che passi**

Esegui: `node --test tests/session-groups.test.js`
Atteso: PASS, 8 test.

- [ ] **Passo 5: commit**

```bash
git add renderer/session-groups.js tests/session-groups.test.js
git commit -m "feat: funzione di raggruppamento delle sessioni per tipo o progetto

Il raggruppamento era cablato dentro renderSidebar e quindi non testabile.
Qui diventa una funzione pura con le due modalità, ordine e disambiguazione
dei nomi omonimi verificati dai test."
```

---

## Task 3: l'handler IPC e la radice di progetto sulle schede

**File:**
- Modifica: `main.js` (import in testa, handler nella sezione "Cronologia e directory recenti")
- Modifica: `preload.js:13` (accanto a `getRecentDirs`)
- Modifica: `renderer/renderer.js` — `createTab` (righe ~617-692)
- Modifica: `tests/wiring.test.js` (in fondo)

**Interfacce:**
- Consuma: `findProjectRoot(dir)` dal task 1.
- Produce: `window.aisess.resolveProject(cwd)` → `Promise<{ok: boolean, root: string|null, error?: string}>`
  e il campo `tab.projectRoot` (string|null) su ogni scheda. Li usano i task 5 e 6.

- [ ] **Passo 1: scrivi il test che fallisce**

In fondo a `tests/wiring.test.js`:

```js
// ---------- Raggruppamento delle sessioni ----------
ok('raggruppamento: la radice di progetto arriva dal main alle schede', () => {
  const main = read('main.js');
  assert.ok(main.includes("'resolve-project'"), 'manca handler resolve-project');
  assert.ok(main.includes("require('./lib/project-root')"), 'main.js non usa il modulo project-root');
  assert.ok(read('preload.js').includes('resolveProject'), 'manca resolveProject nel preload');

  const js = read('renderer', 'renderer.js');
  assert.ok(/projectRoot/.test(js), 'la scheda non tiene la radice di progetto');
  // La cwd vera la decide il main (resolveWorkdir): risolvere prima dello
  // spawn legherebbe la scheda a una directory che non è quella usata.
  assert.ok(/res\.cwd[\s\S]{0,400}resolveProjectRoot/.test(js),
    'la radice di progetto non viene risolta sulla directory restituita dal main');
});
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/wiring.test.js`
Atteso: FAIL — `manca handler resolve-project`.

- [ ] **Passo 3: scrivi l'implementazione minima**

In `main.js`, accanto agli altri import di `lib/` (dopo la riga di `recent-dirs`):

```js
const { findProjectRoot } = require('./lib/project-root');
```

Sempre in `main.js`, subito dopo l'handler `get-recent-dirs`:

```js
ipcMain.handle('resolve-project', async (event, { cwd } = {}) => {
  try {
    return { ok: true, root: findProjectRoot(cwd) };
  } catch (e) {
    console.error('resolve-project fallito:', e);
    return { ...fail('', e), root: null };
  }
});
```

In `preload.js`, dopo `getRecentDirs`:

```js
  resolveProject: (cwd) => ipcRenderer.invoke('resolve-project', { cwd }),
```

In `renderer/renderer.js`, prima di `createTab`:

```js
/* ---------- Radice di progetto delle schede ----------
   La risalita la fa il main (il renderer non vede il filesystem). Il risultato
   si mette in cache per directory: aprire dieci sessioni nello stesso repo non
   deve costare dieci risalite. In caso di errore vale la cwd, così la scheda
   ha comunque un gruppo. */
const projectRootCache = new Map();

async function resolveProjectRoot(cwd) {
  if (!cwd) return null;
  if (projectRootCache.has(cwd)) return projectRootCache.get(cwd);
  let root = cwd;
  try {
    const r = await window.aisess.resolveProject(cwd);
    if (r && r.ok && typeof r.root === 'string' && r.root) root = r.root;
    else if (r && !r.ok) console.warn('resolve-project fallito:', r.error);
  } catch (e) {
    console.warn('resolve-project non raggiungibile', e);
  }
  projectRootCache.set(cwd, root);
  return root;
}
```

In `createTab`, nell'oggetto `tab` (riga ~636), aggiungi il campo accanto a `cwd`:

```js
  const tab = { id, type, name: label, cwd, projectRoot: cwd || null, resumeId, startedAt: Date.now(), autoNamed: !name,
```

Sempre in `createTab`, nel ramo di successo dello spawn, subito dopo
`if (res.cwd) tab.cwd = res.cwd;`:

```js
    // La radice si risolve sulla directory davvero usata dal pty, non su quella
    // digitata: con cwd vuota o inesistente il main sposta la sessione altrove.
    resolveProjectRoot(tab.cwd).then((root) => {
      if (!tabs.has(id) || root === tab.projectRoot) return;
      tab.projectRoot = root;
      renderSidebar();
    }).catch(() => {});
```

- [ ] **Passo 4: lancia i test e verifica che passino**

Esegui: `npm run test:unit`
Atteso: PASS, nessun test rotto.

- [ ] **Passo 5: verifica manuale**

Esegui: `npm start`, apri una sessione shell in una sottocartella di questo
repository e, nella console del renderer (Ctrl+Shift+I → Console), digita:

```js
await window.aisess.resolveProject('/percorso/di/questo/repo/renderer')
```

Atteso: `{ ok: true, root: '/percorso/di/questo/repo' }` — la radice, non la
sottocartella.

- [ ] **Passo 6: commit**

```bash
git add main.js preload.js renderer/renderer.js tests/wiring.test.js
git commit -m "feat: ogni scheda conosce la radice del progetto in cui gira

Il renderer non vede il filesystem: la risalita la fa il main e il risultato
viene messo in cache per directory. Si risolve dopo lo spawn perché la cwd
definitiva la decide il main."
```

---

## Task 4: `renderSidebar` usa `groupSessions` (nessun cambio di comportamento)

Passaggio intermedio apposta: la sidebar smette di raggruppare da sola ma
continua a raggruppare **per tipo**. Se qualcosa si rompe qui, è lo spostamento
della logica, non la funzionalità nuova.

**File:**
- Modifica: `renderer/index.html:~200` (blocco degli `<script>` in fondo)
- Modifica: `renderer/renderer.js` — costanti di gruppo (righe ~796-806), `renderSidebar` (righe ~856-904), `askSessionName` (riga ~570, unico altro uso di `GROUP_LABELS`)
- Modifica: `tests/ui.test.js` — test `sidebar: gruppo per tipo anche con una sola sessione`

**Interfacce:**
- Consuma: `AisessGroups.groupSessions`, `TYPE_ORDER`, `TYPE_LABELS` dal task 2.
- Produce: `renderSidebar()` che disegna a partire da `Group[]`, con
  `collapsedGroups` indicizzato sulla chiave del gruppo. Lo usano i task 5 e 6.

- [ ] **Passo 1: scrivi il test che fallisce**

In `tests/ui.test.js`, sostituisci il test `sidebar: gruppo per tipo anche con
una sola sessione` con:

```js
ok('sidebar: i gruppi arrivano dal modulo, non da una Map costruita a mano', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  const body = js.slice(js.indexOf('function renderSidebar'));
  assert.ok(!/items\.length === 1/.test(body),
    'con una sola sessione il gruppo collassabile viene ancora saltato');
  assert.ok(body.includes('group-header'), "manca l'header di gruppo");
  assert.ok(body.includes("collapsed ? '▸' : '▾'"), 'manca la freccina di collasso');
  assert.ok(/groupSessions\(/.test(body), 'la sidebar raggruppa ancora per conto suo');
  assert.ok(!/new Map\(GROUP_ORDER/.test(js), 'resta il raggruppamento per tipo cablato nel renderer');
  assert.ok(!/const GROUP_LABELS\s*=/.test(js), 'le etichette dei tipi sono duplicate nel renderer');

  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('session-groups.js'), 'session-groups.js non è incluso nella pagina');
});
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/ui.test.js`
Atteso: FAIL — `la sidebar raggruppa ancora per conto suo`.

- [ ] **Passo 3: scrivi l'implementazione minima**

In `renderer/index.html`, accanto agli altri script del renderer (prima di
`renderer.js`, che li usa):

```html
  <script src="session-groups.js"></script>
```

In `renderer/renderer.js`, sostituisci il blocco delle costanti di gruppo
(`const GROUP_ORDER = ...` fino a `saveCollapsedGroups`) con:

```js
/* ---------- Raggruppamento delle card (gruppi collassabili) ---------- */
const Groups = window.AisessGroups;
let collapsedGroups = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('aisess.collapsedGroups') || '[]');
  if (Array.isArray(saved)) collapsedGroups = new Set(saved.filter((t) => typeof t === 'string'));
} catch {}
function saveCollapsedGroups() {
  try { localStorage.setItem('aisess.collapsedGroups', JSON.stringify([...collapsedGroups])); } catch {}
}
```

In `askSessionName` (riga ~570), l'unico altro punto che usava `GROUP_LABELS`,
sostituisci la riga del sottotitolo:

```js
  if (sub) sub.textContent = [Groups.TYPE_LABELS[tab.type] || tab.type, shortPath(tab.cwd)].filter(Boolean).join(' · ');
```

Sostituisci il corpo di `renderSidebar` (dalla riga `const byType = new Map(...)`
fino alla chiusura del `for`) con:

```js
  const groups = Groups.groupSessions([...tabs.values()], {
    mode: 'type',
    typeOrder: Groups.TYPE_ORDER,
    typeLabels: Groups.TYPE_LABELS,
  });
  for (const g of groups) {
    // Gruppo espandibile/collassabile sempre, anche con una sola sessione:
    // la posizione delle card resta stabile quando il gruppo cresce.
    const collapsed = collapsedGroups.has(g.key);
    const group = document.createElement('div');
    group.className = 'session-group';
    const header = document.createElement('button');
    // Se collassato nasconde la scheda attiva (o una che lampeggia), l'header lo segnala
    const hidesActive = collapsed && g.items.some((t) => t.id === activeId);
    const hidesAttention = collapsed && g.items.some((t) => t.needsAttention);
    header.className = `group-header type-${g.key}`
      + (hidesActive ? ' has-active' : '')
      + (hidesAttention ? ' needs-attention' : '');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.title = g.title;
    header.innerHTML = `<span class="chevron">${collapsed ? '▸' : '▾'}</span>
      <span class="sel-mark" aria-hidden="true">◆</span>
      <span class="icon">${Icons.markup(g.key)}</span>
      <span class="group-name">${escapeHtml(g.label)}</span>
      <span class="group-count">${g.items.length}</span>`;
    header.onclick = () => {
      if (collapsedGroups.has(g.key)) collapsedGroups.delete(g.key);
      else collapsedGroups.add(g.key);
      saveCollapsedGroups();
      renderSidebar();
    };
    group.appendChild(header);
    const body = document.createElement('div');
    body.className = 'group-body';
    if (collapsed) body.hidden = true;
    for (const t of g.items) body.appendChild(createSessionItem(t));
    group.appendChild(body);
    list.appendChild(group);
  }
```

- [ ] **Passo 4: lancia i test e verifica che passino**

Esegui: `npm run test:unit`
Atteso: PASS.

- [ ] **Passo 5: verifica manuale**

Esegui `npm start`, apri tre sessioni di due tipi diversi: gruppi, conteggi,
collasso e marker devono essere **identici** a prima. Chiudi e riapri l'app: i
gruppi collassati restano collassati.

- [ ] **Passo 6: commit**

```bash
git add renderer/index.html renderer/renderer.js tests/ui.test.js
git commit -m "refactor: la sidebar disegna i gruppi che le passa session-groups

Stesso risultato a schermo, ma il raggruppamento non è più cablato dentro
renderSidebar: è la funzione pura del modulo, quella coperta dai test."
```

---

## Task 5: il selettore Tipo | Progetto

**File:**
- Modifica: `renderer/index.html:110` (riga `.side-section`)
- Modifica: `renderer/styles.css` (dopo il blocco `.side-section`)
- Modifica: `renderer/renderer.js` — stato dei gruppi, `init()`, `setActive` (righe ~708-723), `renderSidebar`
- Modifica: `tests/wiring.test.js` — test del task 3

**Interfacce:**
- Consuma: `tab.projectRoot` (task 3), `groupSessions` (task 2), `renderSidebar` (task 4).
- Produce: `groupMode` (`'type'|'project'`), `groupKeyFor(tab)`, `setGroupMode(mode)`.
  Li usa il task 6.

- [ ] **Passo 1: scrivi il test che fallisce**

In `tests/wiring.test.js`, aggiungi dopo il test del task 3:

```js
ok('raggruppamento: il selettore esiste, persiste e non usa handler inline', () => {
  const html = read('renderer', 'index.html');
  assert.ok(html.includes('id="group-mode-type"') && html.includes('id="group-mode-project"'),
    'manca il selettore Tipo | Progetto');
  const seg = html.match(/<div class="seg"[\s\S]*?<\/div>/);
  assert.ok(seg, 'manca il contenitore .seg del selettore');
  assert.ok(!/on(click|change)=/.test(seg[0]), 'handler inline: la CSP lo blocca');
  assert.ok(/aria-pressed/.test(seg[0]), 'il selettore non dice quale modalità è attiva');

  const js = read('renderer', 'renderer.js');
  assert.ok(js.includes("'aisess.groupMode'"), 'la modalità non viene persistita');
  assert.ok(js.includes("'aisess.collapsedProjects'"),
    'i collassi dei progetti condividono la chiave con quelli dei tipi');
  assert.ok(/groupKeyFor\(/.test(js), 'il collasso non segue la modalità corrente');
  assert.ok(!/collapsedGroups\.has\(t\.type\)/.test(js),
    'setActive espande ancora il gruppo per tipo anche in modalità progetto');
});
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/wiring.test.js`
Atteso: FAIL — `manca il selettore Tipo | Progetto`.

- [ ] **Passo 3: scrivi l'implementazione minima**

In `renderer/index.html`, sostituisci la riga della sezione:

```html
    <div class="side-section">SESSIONI APERTE <span id="count"></span>
      <div class="seg" role="group" aria-label="Raggruppa le sessioni">
        <button type="button" class="seg-btn" id="group-mode-type" aria-pressed="true" title="Raggruppa per tipo di sessione">Tipo</button>
        <button type="button" class="seg-btn" id="group-mode-project" aria-pressed="false" title="Raggruppa per progetto (radice del repository)">Progetto</button>
      </div>
    </div>
```

In `renderer/styles.css`, dopo il blocco `.side-section`:

```css
/* La riga di sezione ospita anche il selettore di raggruppamento */
.side-section { display: flex; align-items: center; gap: 8px; }
.side-section .seg { margin-left: auto; display: flex; gap: 2px; }
.seg-btn {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--text-dim);
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 3px 8px; cursor: pointer;
}
.seg-btn:hover { border-color: var(--border-strong); color: var(--text); }
.seg-btn[aria-pressed="true"] { background: var(--action-soft); color: var(--text); border-color: var(--border-strong); }
```

In `renderer/renderer.js`, nel blocco delle costanti di gruppo del task 4,
aggiungi sotto `saveCollapsedGroups`:

```js
/* Modalità di raggruppamento e collassi: liste separate per modalità, perché
   collassare "Claude" e collassare "aisessionmanager" sono scelte diverse e
   nella stessa chiave interferirebbero. */
const GROUP_MODES = ['type', 'project'];
const COLLAPSED_PROJECTS_KEY = 'aisess.collapsedProjects';
let groupMode = 'type';
try {
  const saved = localStorage.getItem('aisess.groupMode');
  if (GROUP_MODES.includes(saved)) groupMode = saved;
} catch {}
let collapsedProjects = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) || '[]');
  if (Array.isArray(saved)) collapsedProjects = new Set(saved.filter((k) => typeof k === 'string'));
} catch {}
function saveCollapsedProjects() {
  try { localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsedProjects])); } catch {}
}

/** Insieme dei gruppi collassati della modalità corrente. */
function collapsedSet() {
  return groupMode === 'project' ? collapsedProjects : collapsedGroups;
}
function saveCollapsed() {
  if (groupMode === 'project') saveCollapsedProjects();
  else saveCollapsedGroups();
}
/** Chiave del gruppo a cui appartiene una scheda, nella modalità corrente. */
function groupKeyFor(t) {
  return groupMode === 'project' ? (t.projectRoot || '') : t.type;
}

function setGroupMode(mode) {
  if (!GROUP_MODES.includes(mode) || mode === groupMode) return;
  groupMode = mode;
  try { localStorage.setItem('aisess.groupMode', mode); } catch {}
  updateGroupModeButtons();
  renderSidebar();
}

function updateGroupModeButtons() {
  const map = { type: $('#group-mode-type'), project: $('#group-mode-project') };
  for (const m of GROUP_MODES) {
    if (map[m]) map[m].setAttribute('aria-pressed', String(m === groupMode));
  }
}
```

In `init()`, accanto agli altri `addEventListener` (dopo `initSidebarResize()`):

```js
  $('#group-mode-type').addEventListener('click', () => setGroupMode('type'));
  $('#group-mode-project').addEventListener('click', () => setGroupMode('project'));
  updateGroupModeButtons();
```

In `renderSidebar`, sostituisci la chiamata a `groupSessions` e i tre punti che
usano `collapsedGroups`:

```js
  const groups = Groups.groupSessions([...tabs.values()], {
    mode: groupMode,
    typeOrder: Groups.TYPE_ORDER,
    typeLabels: Groups.TYPE_LABELS,
  });
```

```js
    const collapsed = collapsedSet().has(g.key);
```

```js
    header.className = `group-header` + (g.kind === 'type' ? ` type-${g.key}` : ' is-project')
      + (hidesActive ? ' has-active' : '')
      + (hidesAttention ? ' needs-attention' : '');
```

```js
    // In modalità progetto il marchio dell'agente non c'entra: serve un glifo
    // neutro, lo stesso già usato dai chip delle directory recenti.
    const groupIcon = g.kind === 'type' ? Icons.markup(g.key) : '📁';
    header.innerHTML = `<span class="chevron">${collapsed ? '▸' : '▾'}</span>
      <span class="sel-mark" aria-hidden="true">◆</span>
      <span class="icon">${groupIcon}</span>
      <span class="group-name">${escapeHtml(g.label)}</span>
      <span class="group-count">${g.items.length}</span>`;
    header.onclick = () => {
      const set = collapsedSet();
      if (set.has(g.key)) set.delete(g.key);
      else set.add(g.key);
      saveCollapsed();
      renderSidebar();
    };
```

In `setActive`, sostituisci il blocco che espande il gruppo:

```js
  const t = tabs.get(id);
  if (t) {
    const key = groupKeyFor(t);
    if (collapsedSet().has(key)) {
      collapsedSet().delete(key);
      saveCollapsed();
    }
  }
```

- [ ] **Passo 4: lancia i test e verifica che passino**

Esegui: `npm run test:unit`
Atteso: PASS.

- [ ] **Passo 5: verifica manuale**

Esegui `npm start` e apri quattro sessioni: due in sottocartelle diverse di uno
stesso repository, una in un altro repository, una in una directory senza `.git`
(es. la home). Verifica in ordine:

1. click su **Progetto**: le prime due stanno nello stesso gruppo, col nome del
   repository; la quarta sta in un gruppo con il nome della sua cartella;
2. collassa un gruppo, torna su **Tipo**: i gruppi per tipo sono aperti come li
   avevi lasciati (le due liste non si influenzano);
3. torna su **Progetto**: il gruppo collassato è ancora collassato;
4. collassa il gruppo che contiene la sessione attiva e clicca su un'altra
   scheda e poi di nuovo su quella: il gruppo si riapre;
5. chiudi e riapri l'app: riparte in modalità **Progetto**, con gli stessi
   collassi.

- [ ] **Passo 6: commit**

```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js tests/wiring.test.js
git commit -m "feat: la sidebar può raggruppare le sessioni per progetto

Chi lavora su più repository vedeva le sessioni dello stesso progetto sparse
in tre gruppi diversi. Il selettore in sidebar sceglie la modalità; i gruppi
collassati sono liste separate, una per modalità."
```

---

## Task 6: il sottotitolo delle card in modalità progetto

**File:**
- Modifica: `renderer/renderer.js` — `createSessionItem` (righe ~821-854)
- Modifica: `tests/ui.test.js`

**Interfacce:**
- Consuma: `groupMode` (task 5), `Groups.relativeSubpath` e `Groups.TYPE_LABELS` (task 2).
- Produce: niente di nuovo.

- [ ] **Passo 1: scrivi il test che fallisce**

In `tests/ui.test.js`, in fondo:

```js
ok('sidebar: in modalità progetto la card non ripete il path già scritto nell header', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const body = js.slice(js.indexOf('function createSessionItem'), js.indexOf('function renderSidebar'));
  assert.ok(/relativeSubpath\(/.test(body), 'la card non mostra il path relativo al progetto');
  assert.ok(/groupMode === 'project'/.test(body), 'il sottotitolo non cambia con la modalità');
  assert.ok(/TYPE_LABELS\[t\.type\]/.test(body),
    'in modalità progetto la card non dice di che tipo è la sessione');
  assert.ok(/title="\$\{escapeHtml\(fullSub\)\}"/.test(body),
    'il tooltip non mostra più la cwd completa');
});
```

- [ ] **Passo 2: lancia il test e verifica che fallisca**

Esegui: `node --test tests/ui.test.js`
Atteso: FAIL — `la card non mostra il path relativo al progetto`.

- [ ] **Passo 3: scrivi l'implementazione minima**

In `createSessionItem`, sostituisci le due righe che calcolano i sottotitoli:

```js
  const fullSub = [t.cwd || '', ...extras].filter(Boolean).join(' · ');
  // In modalità progetto l'header del gruppo è già il path: ripeterlo sotto è
  // rumore. Al suo posto il tipo della sessione (che lì non è più nell'header)
  // e la sottocartella, se la sessione non sta nella radice del progetto.
  const displayParts = groupMode === 'project'
    ? [Groups.TYPE_LABELS[t.type] || t.type, Groups.relativeSubpath(t.cwd, t.projectRoot), ...extras]
    : [shortPath(t.cwd), ...extras];
  const displaySub = displayParts.filter(Boolean).join(' · ');
```

- [ ] **Passo 4: lancia i test e verifica che passino**

Esegui: `npm run test:unit`
Atteso: PASS.

- [ ] **Passo 5: verifica manuale**

`npm start`, modalità **Progetto**: la card di una sessione nella radice mostra
solo il tipo (più account/comando se ci sono); quella in una sottocartella
mostra `Tipo · sottocartella`. Il tooltip su entrambe mostra la cwd completa.
Torna su **Tipo**: i sottotitoli tornano a mostrare il path corto.

- [ ] **Passo 6: commit**

```bash
git add renderer/renderer.js tests/ui.test.js
git commit -m "feat: in modalità progetto la card mostra tipo e sottocartella

Sotto un header che è già il path del progetto, ripetere il path nella card
non aggiunge niente: al suo posto va l'informazione che nell'header non c'è
più, cioè di che tipo è la sessione."
```

---

## Task 7: la sidebar esce da `renderer/renderer.js`

Refactor **senza** cambi di comportamento, in commit separato: `renderer.js` è
oltre le 1000 righe e i task precedenti ne hanno aggiunte.

**File:**
- Crea: `renderer/sidebar.js`
- Modifica: `renderer/index.html` (uno `<script>` in più)
- Modifica: `renderer/renderer.js` (rimozione delle funzioni spostate)
- Modifica: `tests/ui.test.js`, `tests/wiring.test.js` (le asserzioni sulla sidebar leggono il file nuovo)

**Interfacce:**
- Consuma: `AisessGroups`, `AisessIcons`, `localStorage`.
- Produce, sul globale `AisessSidebar`:
  `createSidebar({ list, count, storage, Icons, Groups, escapeHtml, onSelect, onClose, onRename })`
  → `{ render(sessions, activeId), getMode(), setMode(mode), expandGroupOf(session), groupKeyFor(session) }`.

Cosa si sposta in `sidebar.js`: `renderSidebar`, `createSessionItem`,
`shortPath`, `DOUBLE_CLICK_MS`/`lastCardClick`, lo stato dei gruppi
(`groupMode`, `collapsedGroups`, `collapsedProjects`, `collapsedSet`,
`saveCollapsed*`, `groupKeyFor`, `setGroupMode`, `updateGroupModeButtons`).

Cosa **resta** in `renderer.js`: `tabs`, `activeId`, `setActive`, `closeTab`,
`renameTab`, `noteActivity`/`flagAttention`/`clearAttention`, e `askSessionName`
(che usa già `Groups.TYPE_LABELS` dal task 4).

La sidebar non conosce `tabs` né `activeId`: li riceve a ogni `render`. Le
azioni tornano indietro come callback (`onSelect`, `onClose`, `onRename`). È
questo che rompe la dipendenza circolare tra i due file.

- [ ] **Passo 1: aggiorna i test perché puntino al file nuovo**

In `tests/ui.test.js` e `tests/wiring.test.js`, nelle asserzioni sulla sidebar,
sostituisci la lettura di `renderer/renderer.js` con `renderer/sidebar.js` per:
`sidebar: i gruppi arrivano dal modulo...`, `sidebar: in modalità progetto la
card...`, `raggruppamento: il selettore esiste...` (parte `js`), e la riga
`assert.ok(js.includes("t.needsAttention ? ' needs-attention' : ''"))` dentro
`sessioni: la card lampeggia...`. Le asserzioni su `setActive`, `onData`,
`term.onBell`, `t.id === activeId` restano su `renderer.js`.

Aggiungi in `tests/ui.test.js`:

```js
ok('sidebar: il modulo della sidebar non conosce lo stato delle schede', () => {
  const root = path.join(__dirname, '..');
  const js = fs.readFileSync(path.join(root, 'renderer', 'sidebar.js'), 'utf8');
  assert.ok(js.includes('window.AisessSidebar') || js.includes('AisessSidebar = api'),
    'sidebar.js non espone AisessSidebar');
  assert.ok(!/\btabs\.(get|set|delete|forEach|values)\b/.test(js),
    'la sidebar accede alla mappa delle schede invece di riceverla');
  assert.ok(!/\bactiveId\b\s*=/.test(js), 'la sidebar scrive lo stato di selezione');
  for (const cb of ['onSelect', 'onClose', 'onRename']) {
    assert.ok(js.includes(cb), `manca la callback ${cb}`);
  }
  const main = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.ok(!/function renderSidebar\(/.test(main), 'renderSidebar è ancora in renderer.js');
  assert.ok(fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8').includes('sidebar.js'),
    'sidebar.js non è incluso nella pagina');
});
```

- [ ] **Passo 2: lancia i test e verifica che falliscano**

Esegui: `node --test tests/ui.test.js`
Atteso: FAIL — `ENOENT ... renderer/sidebar.js`.

- [ ] **Passo 3: sposta il codice**

Crea `renderer/sidebar.js` con il wrapper UMD di `session-groups.js` (globale
`AisessSidebar`) e una factory che tiene solo lo stato dei gruppi:

```js
(function (root, factory) {
  const api = factory();
  if (root) root.AisessSidebar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function createSidebar(deps) {
    const { list, count, storage, Icons, Groups, escapeHtml, onSelect, onClose, onRename } = deps;
    // ... qui dentro, invariate: lo stato dei gruppi del task 5,
    // createSessionItem del task 6, shortPath, renderSidebar rinominata render.
    // `tabs`/`activeId` diventano i parametri di render(sessions, activeId).
    return { render, getMode, setMode, expandGroupOf, groupKeyFor };
  }
  return { createSidebar };
});
```

In `renderer/index.html`, dopo `session-groups.js`:

```html
  <script src="sidebar.js"></script>
```

In `renderer/renderer.js`, al posto delle funzioni spostate:

```js
const sidebar = window.AisessSidebar.createSidebar({
  list: $('#session-list'), count: $('#count'),
  storage: window.localStorage, Icons, Groups: window.AisessGroups, escapeHtml,
  onSelect: (id) => setActive(id),
  onClose: (id) => { closeTab(id).catch(() => {}); },
  onRename: (t) => { renameTab(t).catch(() => {}); },
});
const renderSidebar = () => sidebar.render([...tabs.values()], activeId);
```

E in `setActive`, al posto della manipolazione diretta dei collassi:

```js
  const t = tabs.get(id);
  if (t) sidebar.expandGroupOf(t);
```

I due bottoni del selettore, in `init()`, chiamano `sidebar.setMode('type')` e
`sidebar.setMode('project')` seguiti da `renderSidebar()`.

- [ ] **Passo 4: lancia i test e verifica che passino**

Esegui: `npm run test:unit`
Atteso: PASS, tutti i test dei task 1-6 compresi.

- [ ] **Passo 5: verifica manuale**

`npm start` e ripeti la lista di verifiche del task 5, più: doppio click su una
card la rinomina, la ✕ la chiude, la card lampeggia a fine turno di un agente e
smette quando la selezioni. Nessuna di queste deve essere cambiata.

- [ ] **Passo 6: commit**

```bash
git add renderer/sidebar.js renderer/renderer.js renderer/index.html tests/ui.test.js tests/wiring.test.js
git commit -m "refactor: la sidebar esce da renderer.js

renderer.js era oltre le 1000 righe, sopra il limite di 800, e questo branch
ne ha aggiunte. La sidebar non conosce lo stato delle schede: lo riceve a
ogni render e restituisce le azioni come callback. Nessun cambio di
comportamento."
```

---

## Chiusura del branch

- [ ] `npm run test:unit` verde.
- [ ] `npm run test:coverage`: i due moduli nuovi sopra l'80%.
- [ ] Smoke test finale dell'app: le cinque verifiche del task 5 più quelle del task 7.
- [ ] In `docs/plans/README.md`, riga 8 → `✅ fatto`.
- [ ] PR con `git diff main...HEAD`, e nel corpo il perché: la sidebar era
      utilizzabile solo per tipo.

# Albero dell'editor ridimensionabile e nascondibile — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'albero dei file della scheda editor si allarga e si stringe trascinando una striscia, si apre e si chiude con un bottone o con Ctrl+B, e ricorda larghezza e stato al riavvio.

**Architecture:** un modulo UMD nuovo, `renderer/editor-panel.js`, tiene le preferenze (`{ width, hidden }`), le legge e scrive in `localStorage` e le applica alla pagina: variabile CSS `--editor-tree-w` e classe `editor-tree-hidden` sul `body`. Così tutte le schede editor cambiano insieme. `renderer/editor-tab.js` aggiunge la striscia e il bottone al layout, e un listener Ctrl+B. Monaco ha già `automaticLayout: true` e si ridisegna da solo.

**Tech Stack:** Electron 33, renderer sandboxed con script classici e moduli UMD; test con `node --test` e DOM finto (`tests/fake-dom.js`).

Spec: `docs/plans/62-editor-pannello.md`.

## Global Constraints

- Larghezza: minimo 160px, massimo metà della larghezza della scheda, default 240px. Il doppio click sulla striscia torna a 240px.
- Chiavi `localStorage`: `aisess.editorTreeW` (numero intero di px, come stringa) e `aisess.editorTreeHidden` (`'1'` nascosto, `'0'` aperto).
- Variabile CSS `--editor-tree-w` e classe `editor-tree-hidden`, tutte e due sul `body`.
- Title del bottone: `Mostra/nascondi file (Ctrl+B)`.
- Ctrl+B agisce solo se la scheda attiva è un editor (`tab.editor`). Nelle altre schede non si tocca l'evento.
- Le eccezioni di `localStorage` non fermano niente.
- Moduli UMD in `renderer/`: niente `require('electron')`. Nomi della UI via `textContent`.
- Test: prima `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (il node di sistema è v12). La suite intera è `npm run test:unit` e deve restare verde.
- Commit: messaggio in `/tmp/msg.txt` e poi `git commit --file=/tmp/msg.txt`. Formato `<tipo>: <cosa>` in italiano, il perché nel corpo, ultima riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: modulo `renderer/editor-panel.js`

**Files:**
- Create: `renderer/editor-panel.js`
- Create: `tests/editor-panel.test.js`
- Modify: `tests/fake-dom.js` (aggiungere `style.setProperty`)
- Modify: `renderer/index.html` (aggiungere lo script subito dopo `editor-tree.js`, riga 493)

**Interfaces:**
- Produces: globale `window.AisessEditorPanel` e `module.exports` con:
  - `WIDTH_KEY = 'aisess.editorTreeW'`, `HIDDEN_KEY = 'aisess.editorTreeHidden'`, `DEFAULT_W = 240`, `MIN_W = 160`
  - `clampWidth(w: number, max: number) → number`
  - `readPanelPrefs(storage) → { width: number, hidden: boolean }`
  - `savePanelPrefs(storage, prefs) → void`
  - `applyPanelPrefs(doc, prefs) → void`
  - `createPanel({ doc, storage }) → { prefs(): {width, hidden}, toggle(): void, attachResizer(resizer, { side, wrap, win }): void }`
  - `isToggleKey(e) → boolean`

- [ ] **Step 1: `style.setProperty` nel DOM finto**

In `tests/fake-dom.js`, dentro `createElement`, sostituire la riga `style: {},` con:

```js
    // Le variabili CSS si scrivono con setProperty: qui finiscono nell'oggetto
    // come le altre proprietà. Non enumerabile, così non sporca i confronti.
    style: Object.defineProperty({}, 'setProperty', { value(k, v) { this[k] = String(v); } }),
```

- [ ] **Step 2: scrivere il test che fallisce**

Creare `tests/editor-panel.test.js`:

```js
const assert = require('node:assert');
const { test: ok } = require('node:test');
const { createElement, createStorage, fire } = require('./fake-dom');
const P = require('../renderer/editor-panel');

/* Il pannello dell'albero della scheda editor (docs/plans/62): preferenze in
   localStorage, applicate al body come variabile CSS e classe. */

function fakeDoc() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}
const widthOf = (doc) => doc.body.style['--editor-tree-w'];
const isHidden = (doc) => doc.body.classList.contains('editor-tree-hidden');
const brokenStorage = () => ({
  getItem() { throw new Error('negato'); },
  setItem() { throw new Error('pieno'); },
});

ok('clampWidth: fra 160 e la metà della scheda, con la scheda stretta vince il minimo', () => {
  assert.strictEqual(P.clampWidth(100, 500), 160);
  assert.strictEqual(P.clampWidth(900, 500), 500);
  assert.strictEqual(P.clampWidth(300.4, 500), 300);
  assert.strictEqual(P.clampWidth(300, 100), 160);
});

ok('readPanelPrefs: i default senza niente salvato o con valori rotti', () => {
  const def = { width: 240, hidden: false };
  assert.deepStrictEqual(P.readPanelPrefs(createStorage()), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': 'abc', 'aisess.editorTreeHidden': 'forse' })), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': '90' })), def);
  assert.deepStrictEqual(P.readPanelPrefs(createStorage({ 'aisess.editorTreeW': '320', 'aisess.editorTreeHidden': '1' })), { width: 320, hidden: true });
});

ok('readPanelPrefs e savePanelPrefs: uno storage che lancia non ferma niente', () => {
  assert.deepStrictEqual(P.readPanelPrefs(brokenStorage()), { width: 240, hidden: false });
  assert.doesNotThrow(() => P.savePanelPrefs(brokenStorage(), { width: 300, hidden: true }));
});

ok('savePanelPrefs: larghezza in px e nascosto come 1/0', () => {
  const storage = createStorage();
  P.savePanelPrefs(storage, { width: 300, hidden: true });
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '300');
  assert.strictEqual(storage.getItem('aisess.editorTreeHidden'), '1');
});

ok('createPanel: applica subito alla pagina le preferenze salvate', () => {
  const doc = fakeDoc();
  const panel = P.createPanel({ doc, storage: createStorage({ 'aisess.editorTreeW': '320', 'aisess.editorTreeHidden': '1' }) });
  assert.strictEqual(widthOf(doc), '320px');
  assert.strictEqual(isHidden(doc), true);
  assert.deepStrictEqual(panel.prefs(), { width: 320, hidden: true });
});

ok('toggle: nasconde e rimostra, e se lo ricorda', () => {
  const doc = fakeDoc();
  const storage = createStorage();
  const panel = P.createPanel({ doc, storage });
  assert.strictEqual(isHidden(doc), false);
  panel.toggle();
  assert.strictEqual(isHidden(doc), true);
  assert.deepStrictEqual(P.readPanelPrefs(storage), { width: 240, hidden: true });
  panel.toggle();
  assert.strictEqual(isHidden(doc), false);
  assert.strictEqual(storage.getItem('aisess.editorTreeHidden'), '0');
});

ok('toggle: con uno storage che lancia apre e chiude lo stesso', () => {
  const doc = fakeDoc();
  const panel = P.createPanel({ doc, storage: brokenStorage() });
  panel.toggle();
  assert.strictEqual(isHidden(doc), true);
  panel.toggle();
  assert.strictEqual(isHidden(doc), false);
});

/** Striscia agganciata a un albero largo 240 in una scheda larga 1000. */
function resizable(storage = createStorage()) {
  const doc = fakeDoc();
  const win = createElement('window');
  const resizer = createElement('div');
  const side = createElement('aside');
  const wrap = createElement('div');
  side.rect = { ...side.rect, width: 240 };
  wrap.rect = { ...wrap.rect, width: 1000 };
  const panel = P.createPanel({ doc, storage });
  panel.attachResizer(resizer, { side, wrap, win });
  return { doc, win, resizer, storage, panel };
}

ok('striscia: trascinare allarga e stringe fra i limiti, e salva al rilascio', () => {
  const { doc, win, resizer, storage, panel } = resizable();
  const down = fire(resizer, 'pointerdown', { clientX: 240, button: 0 });
  assert.strictEqual(down.defaultPrevented, true);
  assert.ok(doc.body.classList.contains('editor-resizing'));
  fire(win, 'pointermove', { clientX: 340 });
  assert.strictEqual(widthOf(doc), '340px');
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), null, 'durante il trascinamento non si salva');
  fire(win, 'pointermove', { clientX: 2000 });
  assert.strictEqual(widthOf(doc), '500px', 'al massimo metà della scheda');
  fire(win, 'pointermove', { clientX: 0 });
  assert.strictEqual(widthOf(doc), '160px', 'al minimo 160');
  fire(win, 'pointerup', {});
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '160');
  assert.ok(!doc.body.classList.contains('editor-resizing'));
  assert.strictEqual(win.listeners.get('pointermove').length, 0, 'il rilascio stacca i listener');
  assert.strictEqual(win.listeners.get('pointerup').length, 0);
  assert.strictEqual(panel.prefs().width, 160);
});

ok('striscia: il tasto destro non comincia un trascinamento', () => {
  const { win, resizer } = resizable();
  const down = fire(resizer, 'pointerdown', { clientX: 240, button: 2 });
  assert.strictEqual(down.defaultPrevented, false);
  assert.strictEqual(win.listeners.has('pointermove'), false);
});

ok('striscia: il doppio click torna a 240 e salva', () => {
  const { doc, resizer, storage } = resizable(createStorage({ 'aisess.editorTreeW': '400' }));
  assert.strictEqual(widthOf(doc), '400px');
  fire(resizer, 'dblclick', {});
  assert.strictEqual(widthOf(doc), '240px');
  assert.strictEqual(storage.getItem('aisess.editorTreeW'), '240');
});

ok('isToggleKey: solo Ctrl+B, senza altri modificatori', () => {
  const k = (p) => P.isToggleKey({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...p });
  assert.strictEqual(k({ ctrlKey: true, key: 'b' }), true);
  assert.strictEqual(k({ ctrlKey: true, key: 'B' }), true, 'anche col blocco maiuscole');
  assert.strictEqual(k({ key: 'b' }), false);
  assert.strictEqual(k({ ctrlKey: true, shiftKey: true, key: 'B' }), false);
  assert.strictEqual(k({ ctrlKey: true, altKey: true, key: 'b' }), false);
  assert.strictEqual(k({ ctrlKey: true, key: 'v' }), false);
});
```

- [ ] **Step 3: verificare che fallisce**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-panel.test.js`
Expected: FAIL, `Cannot find module '../renderer/editor-panel'`.

- [ ] **Step 4: scrivere il modulo**

Creare `renderer/editor-panel.js`:

```js
/* Albero della scheda editor ridimensionabile e nascondibile (docs/plans/62).
 * Larghezza e aperto/chiuso valgono per tutte le schede editor e si
 * ricordano in localStorage: stanno sulla pagina (variabile CSS
 * --editor-tree-w e classe editor-tree-hidden sul body), non nelle schede.
 * Striscia, bottone e Ctrl+B li aggancia editor-tab.js.
 *
 * Wrapper UMD come editor-tree.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessEditorPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const WIDTH_KEY = 'aisess.editorTreeW';
  const HIDDEN_KEY = 'aisess.editorTreeHidden';
  const DEFAULT_W = 240;
  const MIN_W = 160;

  /** Fra MIN_W e max (metà della scheda); con una scheda stretta vince il minimo. */
  const clampWidth = (w, max) => Math.round(Math.max(MIN_W, Math.min(w, max)));

  function readPanelPrefs(storage) {
    try {
      const w = Number(storage.getItem(WIDTH_KEY));
      return {
        width: Number.isFinite(w) && w >= MIN_W ? Math.round(w) : DEFAULT_W,
        hidden: storage.getItem(HIDDEN_KEY) === '1',
      };
    } catch {
      return { width: DEFAULT_W, hidden: false };
    }
  }

  function savePanelPrefs(storage, prefs) {
    try {
      storage.setItem(WIDTH_KEY, String(prefs.width));
      storage.setItem(HIDDEN_KEY, prefs.hidden ? '1' : '0');
    } catch {
      // localStorage negato o pieno: la preferenza vale fino al riavvio
    }
  }

  function applyPanelPrefs(doc, prefs) {
    doc.body.style.setProperty('--editor-tree-w', `${prefs.width}px`);
    doc.body.classList.toggle('editor-tree-hidden', prefs.hidden);
  }

  /** Le preferenze correnti stanno qui, non rilette dallo storage: se lo
   *  storage lancia, il bottone apre e chiude lo stesso. */
  function createPanel({ doc, storage }) {
    let prefs = readPanelPrefs(storage);
    const show = (patch) => {
      prefs = { ...prefs, ...patch };
      applyPanelPrefs(doc, prefs);
    };
    const keep = (patch) => {
      show(patch);
      savePanelPrefs(storage, prefs);
    };

    function attachResizer(resizer, { side, wrap, win }) {
      resizer.addEventListener('dblclick', () => keep({ width: DEFAULT_W }));
      resizer.addEventListener('pointerdown', (e) => {
        if (e.button) return; // solo il tasto principale
        e.preventDefault();
        const startX = e.clientX;
        const startW = side.getBoundingClientRect().width;
        const max = wrap.getBoundingClientRect().width / 2;
        const move = (ev) => show({ width: clampWidth(startW + ev.clientX - startX, max) });
        const up = () => {
          win.removeEventListener('pointermove', move);
          win.removeEventListener('pointerup', up);
          doc.body.classList.remove('editor-resizing');
          savePanelPrefs(storage, prefs);
        };
        doc.body.classList.add('editor-resizing');
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', up);
      });
    }

    applyPanelPrefs(doc, prefs);
    return {
      prefs: () => prefs,
      toggle: () => keep({ hidden: !prefs.hidden }),
      attachResizer,
    };
  }

  const isToggleKey = (e) => Boolean(e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    && typeof e.key === 'string' && e.key.toLowerCase() === 'b');

  return { WIDTH_KEY, HIDDEN_KEY, DEFAULT_W, MIN_W, clampWidth, readPanelPrefs, savePanelPrefs, applyPanelPrefs, createPanel, isToggleKey };
});
```

- [ ] **Step 5: verificare che passa**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-panel.test.js`
Expected: PASS, 11 test.

- [ ] **Step 6: caricarlo nella pagina**

In `renderer/index.html`, subito dopo `<script src="editor-tree.js"></script>`:

```html
<script src="editor-panel.js"></script>
```

È un modulo UMD: va fra i moduli, prima di `app-state.js`. `tests/renderer-source.js` non cambia, perché elenca solo gli script dell'app.

- [ ] **Step 7: suite intera**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: tutto verde (prima del piano: 1558 pass, 1 skip).

- [ ] **Step 8: commit**

```bash
git add renderer/editor-panel.js renderer/index.html tests/editor-panel.test.js tests/fake-dom.js
cat > /tmp/msg.txt <<'EOF'
feat: preferenze del pannello dell'albero dell'editor

Larghezza e aperto/chiuso dell'albero valgono per tutte le schede editor e
si ricordano in localStorage (aisess.editorTreeW, aisess.editorTreeHidden).
Si applicano al body come variabile CSS e classe, così ogni scheda segue
senza tenere stato. Lo stato corrente vive nel pannello: se localStorage
lancia, aprire e chiudere funziona lo stesso.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

### Task 2: striscia, bottone e Ctrl+B nella scheda editor

**Files:**
- Modify: `renderer/editor-tab.js` (testa del file; `buildEditorLayout` alle righe 42-78; `initEditorTabs` alle righe 630-656)
- Modify: `renderer/styles.css` (blocco «Sessione editor», `.editor-side` alla riga 1159 e `.editor-subtabs` alla riga 1187)
- Test: `tests/editor-tab.test.js` (in coda)

**Interfaces:**
- Consumes: `window.AisessEditorPanel` dal Task 1: `createPanel({ doc, storage })` → `{ prefs(), toggle(), attachResizer(resizer, { side, wrap, win }) }`, `isToggleKey(e)`, `DEFAULT_W`.
- Produces: il globale `editorPanel` nello scope del renderer (i test lo leggono con `run('editorPanel.prefs()')`).

- [ ] **Step 1: scrivere i test che falliscono**

In coda a `tests/editor-tab.test.js`:

```js
/* ---------- pannello dell'albero (docs/plans/62) ---------- */

/** Un document di fake-dom al posto dello stub della pagina: per guardare il layout. */
function fakeDocument() {
  const doc = createElement('html');
  doc.createElement = createElement;
  doc.body = createElement('body');
  return doc;
}

/** Il layout di una scheda editor disegnato in un wrap di fake-dom. */
function layout() {
  const env = setup();
  env.page.ctx.document = fakeDocument();
  const wrap = createElement('div');
  const ui = env.fn('buildEditorLayout')({ ...env.tab, wrap });
  const head = wrap.children[2].children[0];
  return { ...env, wrap, ui, head, toggle: head.children[0] };
}

ok('pannello: la striscia sta fra albero ed editor, il bottone fuori dalle sotto-schede', () => {
  const { wrap, ui, head, toggle } = layout();
  assert.deepStrictEqual(wrap.children.map((c) => c.className), ['editor-side', 'editor-resizer', 'editor-main']);
  assert.ok(toggle.classList.contains('editor-tree-toggle'));
  assert.strictEqual(toggle.title, 'Mostra/nascondi file (Ctrl+B)');
  assert.strictEqual(head.children[1], ui.subtabs, 'le sotto-schede si ridisegnano da sole, il bottone resta');
});

ok('pannello: il bottone apre e chiude l albero e se lo ricorda', () => {
  const { page, run, toggle } = layout();
  toggle.onclick();
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);
  assert.strictEqual(page.ctx.localStorage.getItem('aisess.editorTreeHidden'), '1');
  toggle.onclick();
  assert.strictEqual(run('editorPanel.prefs().hidden'), false);
});

ok('pannello: Ctrl+B apre e chiude solo con una scheda editor davanti', () => {
  const { page, fn, run } = setup();
  fn('initEditorTabs')();
  const key = (props = {}) => ({
    ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'b',
    prevented: false, preventDefault() { this.prevented = true; }, ...props,
  });
  run("activeId = 'tab-ed'");
  const onEditor = key();
  page.listeners.keydown(onEditor);
  assert.strictEqual(onEditor.prevented, true);
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);

  const plain = key({ ctrlKey: false });
  page.listeners.keydown(plain);
  assert.strictEqual(plain.prevented, false, 'una b scritta resta una b');
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);

  run("tabs.set('tab-term', { id: 'tab-term', type: 'shell' }); activeId = 'tab-term'");
  const onTerm = key();
  page.listeners.keydown(onTerm);
  assert.strictEqual(onTerm.prevented, false, 'nei terminali Ctrl+B resta della shell');
  assert.strictEqual(run('editorPanel.prefs().hidden'), true);
});
```

- [ ] **Step 2: verificare che falliscono**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-tab.test.js`
Expected: i tre test `pannello:` falliscono: i figli del wrap sono `['editor-side', 'editor-main']`, `editorPanel is not defined` e `page.listeners.keydown is not a function`. Gli altri test restano verdi.

- [ ] **Step 3: il pannello in `renderer/editor-tab.js`**

In testa, dopo `const EditorMonaco = window.AisessEditorMonaco;`:

```js
const EditorPanel = window.AisessEditorPanel;
// Larghezza e aperto/chiuso dell'albero, uguali per tutte le schede editor
// e ricordati al riavvio (docs/plans/62): applicati subito alla pagina
const editorPanel = EditorPanel.createPanel({ doc: document, storage: localStorage });
```

In `buildEditorLayout` sostituire:

```js
  const main = el('section', 'editor-main', tab.wrap);
  const subtabs = el('div', 'editor-subtabs', main);
  subtabs.setAttribute('role', 'tablist');
```

con:

```js
  const resizer = el('div', 'editor-resizer', tab.wrap);
  resizer.title = `Trascina per allargare l'albero, doppio click per tornare a ${EditorPanel.DEFAULT_W}px`;
  editorPanel.attachResizer(resizer, { side, wrap: tab.wrap, win: window });
  const main = el('section', 'editor-main', tab.wrap);
  // Il bottone sta fuori dal tablist: renderEditorSubtabs ne rimpiazza i figli
  const head = el('div', 'editor-head', main);
  const toggle = el('button', 'btn btn--ghost editor-tree-toggle', head);
  toggle.textContent = '☰';
  toggle.title = 'Mostra/nascondi file (Ctrl+B)';
  toggle.setAttribute('aria-label', 'Mostra/nascondi file');
  toggle.onclick = () => editorPanel.toggle();
  const subtabs = el('div', 'editor-subtabs', head);
  subtabs.setAttribute('role', 'tablist');
```

In `initEditorTabs`, in fondo dopo il listener `drop`:

```js
  // Ctrl+B apre e chiude l'albero solo con una scheda editor davanti: nei
  // terminali il tasto resta della shell. In cattura, così arriva prima di Monaco.
  document.addEventListener('keydown', (e) => {
    const t = activeId ? tabs.get(activeId) : null;
    if (!t || !t.editor || !EditorPanel.isToggleKey(e)) return;
    e.preventDefault();
    editorPanel.toggle();
  }, true);
```

- [ ] **Step 4: CSS in `renderer/styles.css`**

Sostituire la regola `.editor-side`:

```css
.editor-side {
  width: 240px; min-width: 160px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border); background: var(--surface);
}
```

con:

```css
.editor-side {
  width: var(--editor-tree-w, 240px); min-width: 160px; max-width: 50%; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border); background: var(--surface);
}
/* Striscia per allargare l'albero e bottone per nasconderlo (docs/plans/62):
   larghezza e stato sono della pagina, uguali per tutte le schede editor */
.editor-resizer { position: relative; z-index: 1; flex: 0 0 6px; margin: 0 -3px; cursor: ew-resize; }
.editor-resizer:hover, body.editor-resizing .editor-resizer { background: var(--action-ring); }
body.editor-resizing { cursor: ew-resize; user-select: none; }
body.editor-tree-hidden .editor-side,
body.editor-tree-hidden .editor-resizer { display: none; }
.editor-head { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
.editor-tree-toggle { flex-shrink: 0; padding: 0 10px; border-radius: 0; border-right: 1px solid var(--divider); }
```

e sostituire:

```css
.editor-subtabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--border); background: var(--surface); }
```

con:

```css
.editor-subtabs { flex: 1; min-width: 0; display: flex; overflow-x: auto; }
```

- [ ] **Step 5: verificare che passano**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; node --test tests/editor-tab.test.js tests/renderer-load.test.js`
Expected: PASS, compresi i tre `pannello:`.

- [ ] **Step 6: suite intera**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; npm run test:unit`
Expected: tutto verde.

- [ ] **Step 7: commit**

```bash
git add renderer/editor-tab.js renderer/styles.css tests/editor-tab.test.js
cat > /tmp/msg.txt <<'EOF'
feat: albero dell'editor ridimensionabile e nascondibile

Una striscia fra albero e Monaco si trascina (160px - metà scheda, doppio
click torna a 240) e un bottone in testa alle sotto-schede apre e chiude
l'albero; Ctrl+B fa lo stesso, ma solo con una scheda editor davanti:
nei terminali il tasto resta della shell. Monaco ha automaticLayout e si
adatta da solo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit --file=/tmp/msg.txt
```

---

## Da verificare a mano (dopo i task)

Nell'app (`npm start` dal worktree), con una scheda editor aperta:
1. Trascinare la striscia: l'albero si allarga fino a metà scheda e si stringe fino a 160px, Monaco segue. Doppio click: 240px.
2. Il bottone ☰ chiude e riapre l'albero.
3. Ctrl+B, anche col cursore dentro Monaco, chiude e riapre. In una scheda terminale Ctrl+B arriva alla shell (in bash: cursore indietro di un carattere).
4. Due schede editor: larghezza e stato cambiano insieme.
5. Chiudere e riaprire l'app: larghezza e stato restano.

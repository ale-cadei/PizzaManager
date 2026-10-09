# Segnale esatto dagli hook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le card di Claude, opencode e Codex dicono in modo esatto «lavora», «ha finito», «chiede un permesso» (lampeggio rapido), con l'euristica come rete quando il segnale non arriva.

**Architecture:** Gli hook (Claude `--settings`, plugin opencode via `OPENCODE_CONFIG_CONTENT`) scrivono una parola in `<userData>/signals/<chiave>`; il main osserva la cartella e manda `agent-signal {id, state}` al renderer. Codex manda OSC 9 nel pty (incapsulato da lui in `\ePtmux;` dentro tmux), intercettato da xterm. Nel renderer `agent-state.js` (UMD puro) decide barra e lampeggio; `signals.js` spegne l'euristica per le sessioni in modalità esatta.

**Tech Stack:** Electron, node-pty, xterm.js (`parser.registerOscHandler`), tmux 3.2+, `node --test`.

Spec: [46-hook-esatti.md](46-hook-esatti.md).

## Global Constraints

- Nessuna scrittura in `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`.
- `lib/` senza `require('electron')`; `main.js` solo cablaggio (test esistenti).
- Ogni comando tmux con `-L <socket>`; nei test socket `aistest-…`.
- Le funzioni di `lib/` prendono `platform` come parametro (default `process.platform`).
- Stati ammessi nel file: `ready`, `running`, `waiting`, `permission`. Nient'altro.
- Chiave del file: `^[A-Za-z0-9_-]{1,80}$` (nome sessione tmux, o `tab-<id>` senza tmux).
- Node per i test: quello di nvm (`node --test` non c'è sul node di sistema v12).
- Commit: `<tipo>: <cosa>`, perché nel corpo, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File

| File | Ruolo |
|---|---|
| `lib/agent-signals.js` (nuovo) | store dei file di stato: chiave → percorso, lettura, rimozione, pulizia, watch, scrittura del plugin |
| `lib/agent-hooks.js` (nuovo) | cosa aggiungere ad args/env per tipo; JSON hook di Claude; sorgente plugin opencode; testo OSC 9 di Codex → stato |
| `app/pty.js` | env `AISESS_SIGNAL_FILE` + iniezione allo spawn; inoltro dei segnali alla scheda giusta |
| `app/tmux.conf` | `set -gq allow-passthrough on` (tmux ≥ 3.3) |
| `main.js`, `preload.js` | cablaggio store → pty manager; `onAgentSignal` |
| `renderer/agent-state.js` (nuovo) | regole: running / done / permission, modalità esatta |
| `renderer/signals.js`, `renderer/tabs.js`, `renderer/renderer.js` | uso delle regole, OSC 9, euristica spenta in modalità esatta |
| `renderer/sidebar.js`, `renderer/styles.css` | classe `needs-permission`, lampeggio rapido |
| `lib/notifications.js`, `renderer/notify.js` | testo «chiede un permesso» |

---

### Task 1: Store dei file di stato (`lib/agent-signals.js`)

**Files:**
- Create: `lib/agent-signals.js`
- Test: `tests/agent-signals.test.js`

**Interfaces:**
- Produces: `parseState(text) → 'ready'|'running'|'waiting'|'permission'|null`; `isValidKey(key) → boolean`; `createAgentSignalStore({ dir }) → { dir, pathFor(key), read(key), remove(key), sweep(keepKeys), watch(onSignal) → stop(), writePlugin(source) → path }`. `onSignal(key, state)`. `STATES`.

- [ ] **Step 1: test che fallisce**

```js
// lib/agent-signals.js: i file in cui gli hook scrivono lo stato (piano 46)
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../lib/agent-signals');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ais-signals-'));

test('parseState: solo le quattro parole, spazi e a capo tollerati', () => {
  assert.equal(S.parseState('running'), 'running');
  assert.equal(S.parseState(' waiting\r\n'), 'waiting');
  assert.equal(S.parseState('permission\n'), 'permission');
  assert.equal(S.parseState('ready'), 'ready');
  assert.equal(S.parseState(''), null, 'vuoto: scrittura a metà');
  assert.equal(S.parseState('runn'), null);
  assert.equal(S.parseState('rm -rf /'), null);
  assert.equal(S.parseState(undefined), null);
});

test('isValidKey: nomi di sessione, mai percorsi', () => {
  assert.equal(S.isValidKey('ais-claude-lx1abc'), true);
  assert.equal(S.isValidKey('tab-12'), true);
  for (const k of ['', '../x', 'a/b', 'a\\b', '..', 'a b', 'x'.repeat(81), null]) {
    assert.equal(S.isValidKey(k), false, String(k));
  }
});

test('pathFor sta nella cartella signals e rifiuta chiavi malformate', () => {
  const dir = tmp();
  const store = S.createAgentSignalStore({ dir });
  assert.equal(store.pathFor('ais-claude-1'), path.join(dir, 'signals', 'ais-claude-1'));
  assert.throws(() => store.pathFor('../fuori'), /chiave/);
});

test('read: stato scritto da un hook; file mancante o sporco → null', () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  assert.equal(store.read('ais-x-1'), null);
  fs.mkdirSync(path.dirname(store.pathFor('ais-x-1')), { recursive: true });
  fs.writeFileSync(store.pathFor('ais-x-1'), 'permission');
  assert.equal(store.read('ais-x-1'), 'permission');
  fs.writeFileSync(store.pathFor('ais-x-1'), 'boh');
  assert.equal(store.read('ais-x-1'), null);
});

test('remove e sweep: restano solo le sessioni vive', () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  fs.mkdirSync(path.dirname(store.pathFor('a')), { recursive: true });
  for (const k of ['a', 'b', 'c']) fs.writeFileSync(store.pathFor(k), 'waiting');
  store.remove('a');
  store.remove('non-esiste'); // nessun errore
  store.sweep(['c']);
  assert.deepEqual(fs.readdirSync(path.dirname(store.pathFor('c'))), ['c']);
});

test('watch: una scrittura arriva come (chiave, stato)', async () => {
  const store = S.createAgentSignalStore({ dir: tmp() });
  const seen = [];
  const stop = store.watch((key, state) => seen.push([key, state]));
  try {
    fs.writeFileSync(store.pathFor('ais-y-1'), 'running');
    for (let i = 0; i < 50 && !seen.length; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.at(-1), ['ais-y-1', 'running']);
  } finally { stop(); }
});

test('writePlugin: file fuori da asar, percorso stabile, contenuto aggiornato', () => {
  const dir = tmp();
  const store = S.createAgentSignalStore({ dir });
  const p = store.writePlugin('export default 1;');
  assert.equal(p, path.join(dir, 'hooks', 'opencode-signal.mjs'));
  assert.equal(fs.readFileSync(p, 'utf8'), 'export default 1;');
  store.writePlugin('export default 2;');
  assert.equal(fs.readFileSync(p, 'utf8'), 'export default 2;');
});
```

- [ ] **Step 2:** `node --test tests/agent-signals.test.js` → FAIL (`Cannot find module '../lib/agent-signals'`).

- [ ] **Step 3: implementazione**

```js
'use strict';
/**
 * I file in cui gli hook degli agenti scrivono il loro stato (docs/plans/46).
 *
 * Un file per sessione, `<dir>/signals/<chiave>`, con una parola sola. La
 * chiave è il nome della sessione tmux (stabile fra un avvio e l'altro) o
 * `tab-<id>` senza tmux. Il file sopravvive all'app chiusa: un permesso chiesto
 * nel frattempo si ritrova alla riapertura.
 */
const fs = require('fs');
const path = require('path');

const STATES = ['ready', 'running', 'waiting', 'permission'];
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PLUGIN_NAME = 'opencode-signal.mjs';

function parseState(text) {
  const word = String(text == null ? '' : text).trim();
  return STATES.includes(word) ? word : null;
}

function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

function createAgentSignalStore({ dir }) {
  const signalsDir = path.join(dir, 'signals');
  const hooksDir = path.join(dir, 'hooks');

  function pathFor(key) {
    if (!isValidKey(key)) throw new Error(`chiave del segnale non valida: ${key}`);
    return path.join(signalsDir, key);
  }

  function ensureDir() { fs.mkdirSync(signalsDir, { recursive: true }); }

  function read(key) {
    try { return parseState(fs.readFileSync(pathFor(key), 'utf8')); } catch { return null; }
  }

  function remove(key) {
    if (!isValidKey(key)) return;
    fs.rmSync(pathFor(key), { force: true });
  }

  /** Cancella i file delle sessioni che non esistono più. */
  function sweep(keepKeys) {
    const keep = new Set(keepKeys);
    let names = [];
    try { names = fs.readdirSync(signalsDir); } catch { return; }
    for (const name of names) if (!keep.has(name)) remove(name);
  }

  /** @returns {() => void} ferma l'osservazione */
  function watch(onSignal) {
    ensureDir();
    const w = fs.watch(signalsDir, (_event, name) => {
      const key = name ? String(name) : '';
      if (!isValidKey(key)) return;
      const state = read(key);
      if (state) onSignal(key, state);
    });
    w.on('error', (e) => console.error('[agent-signals] watch interrotto:', e.message));
    return () => w.close();
  }

  /** Il plugin opencode lo legge un processo esterno: sta in userData, non in app.asar. */
  function writePlugin(source) {
    fs.mkdirSync(hooksDir, { recursive: true });
    const p = path.join(hooksDir, PLUGIN_NAME);
    fs.writeFileSync(p, source);
    return p;
  }

  return { dir: signalsDir, pathFor, read, remove, sweep, watch, writePlugin, ensureDir };
}

module.exports = { createAgentSignalStore, parseState, isValidKey, STATES };
```

- [ ] **Step 4:** `node --test tests/agent-signals.test.js` → PASS.
- [ ] **Step 5:** commit `feat: store dei file di stato scritti dagli hook degli agenti`.

---

### Task 2: Cosa iniettare per agente (`lib/agent-hooks.js`)

**Files:**
- Create: `lib/agent-hooks.js`
- Test: `tests/agent-hooks.test.js`

**Interfaces:**
- Consumes: niente (puro).
- Produces:
  - `claudeSettings({ platform }) → string` (JSON per `--settings`)
  - `opencodePluginSource() → string` (modulo ESM)
  - `CODEX_ARGS` (array). Il testo dell'OSC 9 lo interpreta il renderer (`codexOscState` in Task 4).
  - `injectFor(type, { pluginPath, platform, args, env }) → { args: string[], env: object, exact: boolean }` — `args`/`env` sono **da aggiungere**; `exact=false` se non si inietta niente.
  - `SIGNAL_ENV = 'AISESS_SIGNAL_FILE'`

- [ ] **Step 1: test che fallisce**

```js
// lib/agent-hooks.js: hook iniettati per processo, mai nella config dell'utente (piano 46)
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('../lib/agent-hooks');

test('Claude: --settings con gli hook, comando costante verso la env', () => {
  const r = H.injectFor('claude', { platform: 'linux', args: [], env: {} });
  assert.equal(r.exact, true);
  assert.equal(r.args[0], '--settings');
  const s = JSON.parse(r.args[1]);
  const cmd = (ev) => s.hooks[ev][0].hooks[0].command;
  assert.equal(cmd('Stop'), 'printf waiting > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('UserPromptSubmit'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('PreToolUse'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('PostToolUse'), 'printf running > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('StopFailure'), 'printf waiting > "$AISESS_SIGNAL_FILE"');
  assert.equal(cmd('SessionStart'), 'printf ready > "$AISESS_SIGNAL_FILE"');
  assert.equal(s.hooks.Notification[0].matcher, 'permission_prompt|elicitation_dialog');
  assert.equal(cmd('Notification'), 'printf permission > "$AISESS_SIGNAL_FILE"');
});

test('Claude su Windows: powershell esplicito', () => {
  const s = JSON.parse(H.claudeSettings({ platform: 'win32' }));
  const h = s.hooks.Stop[0].hooks[0];
  assert.equal(h.shell, 'powershell');
  assert.equal(h.command, 'Set-Content -NoNewline -LiteralPath $env:AISESS_SIGNAL_FILE -Value waiting');
});

test('Claude: se il profilo ha già --settings non si tocca niente', () => {
  for (const args of [['--settings', 'x.json'], ['--settings=x.json']]) {
    assert.deepEqual(H.injectFor('claude', { platform: 'linux', args, env: {} }), { args: [], env: {}, exact: false });
  }
});

test('opencode: plugin via OPENCODE_CONFIG_CONTENT, unito alla config utente', () => {
  const r = H.injectFor('opencode', { pluginPath: '/u/hooks/opencode-signal.mjs', platform: 'linux', args: [], env: {} });
  assert.equal(r.exact, true);
  assert.deepEqual(r.args, []);
  assert.deepEqual(JSON.parse(r.env.OPENCODE_CONFIG_CONTENT), { plugin: ['file:///u/hooks/opencode-signal.mjs'] });
});

test('opencode: il file:// di Windows ha la lettera di unità', () => {
  const r = H.injectFor('opencode', { pluginPath: 'C:\\Users\\a\\hooks\\opencode-signal.mjs', platform: 'win32', args: [], env: {} });
  assert.deepEqual(JSON.parse(r.env.OPENCODE_CONFIG_CONTENT).plugin, ['file:///C:/Users/a/hooks/opencode-signal.mjs']);
});

test('opencode: OPENCODE_CONFIG_CONTENT del profilo vince, niente plugin', () => {
  const r = H.injectFor('opencode', { pluginPath: '/p.mjs', platform: 'linux', args: [], env: { OPENCODE_CONFIG_CONTENT: '{}' } });
  assert.equal(r.exact, false);
  assert.deepEqual(r.env, {});
});

test('Codex: notifiche OSC 9 sempre, senza file', () => {
  const r = H.injectFor('codex', { platform: 'linux', args: [], env: {} });
  assert.deepEqual(r.args, ['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always']);
  assert.equal(r.exact, true);
});

test('shell, antigravity: niente', () => {
  for (const t of ['shell', 'antigravity', 'git']) {
    assert.deepEqual(H.injectFor(t, { platform: 'linux', args: [], env: {} }), { args: [], env: {}, exact: false });
  }
});

test('plugin opencode: scrive lo stato giusto per ogni evento', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-plugin-'));
  const file = path.join(dir, 'stato');
  const mod = path.join(dir, 'p.mjs');
  fs.writeFileSync(mod, H.opencodePluginSource());
  const prev = process.env.AISESS_SIGNAL_FILE;
  process.env.AISESS_SIGNAL_FILE = file;
  try {
    const plugin = (await import(pathToFileURL(mod).href)).default;
    const hooks = await plugin({});
    assert.equal(fs.readFileSync(file, 'utf8'), 'ready', 'al caricamento');
    const cases = [
      [{ type: 'session.status', properties: { status: { type: 'busy' } } }, 'running'],
      [{ type: 'permission.updated', properties: {} }, 'permission'],
      [{ type: 'permission.replied', properties: {} }, 'running'],
      [{ type: 'question.asked', properties: {} }, 'permission'],
      [{ type: 'question.rejected', properties: {} }, 'running'],
      [{ type: 'session.status', properties: { status: { type: 'retry' } } }, 'running'],
      [{ type: 'session.status', properties: { status: { type: 'idle' } } }, 'waiting'],
    ];
    for (const [event, want] of cases) {
      await hooks.event({ event });
      assert.equal(fs.readFileSync(file, 'utf8'), want, event.type);
    }
    await hooks.event({ event: { type: 'message.updated', properties: {} } });
    assert.equal(fs.readFileSync(file, 'utf8'), 'waiting', 'eventi ignoti non scrivono');
  } finally {
    if (prev === undefined) delete process.env.AISESS_SIGNAL_FILE; else process.env.AISESS_SIGNAL_FILE = prev;
  }
});

test('plugin opencode: senza env non scrive e non rompe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-plugin-'));
  const mod = path.join(dir, 'p2.mjs');
  fs.writeFileSync(mod, H.opencodePluginSource());
  const prev = process.env.AISESS_SIGNAL_FILE;
  delete process.env.AISESS_SIGNAL_FILE;
  try {
    const hooks = await (await import(pathToFileURL(mod).href)).default({});
    await hooks.event({ event: { type: 'session.status', properties: { status: { type: 'busy' } } } });
    assert.deepEqual(fs.readdirSync(dir), ['p2.mjs']);
  } finally {
    if (prev !== undefined) process.env.AISESS_SIGNAL_FILE = prev;
  }
});
```

- [ ] **Step 2:** `node --test tests/agent-hooks.test.js` → FAIL (modulo mancante).

- [ ] **Step 3: implementazione**

```js
'use strict';
/**
 * Hook degli agenti iniettati per processo (docs/plans/46).
 *
 * Mai nella config dell'utente: Claude li riceve con `--settings` (si sommano
 * ai suoi), opencode con un plugin in OPENCODE_CONFIG_CONTENT (unito alla sua
 * config), Codex non ha hook iniettabili (li salta finché l'utente non li
 * approva) e manda invece OSC 9 nel terminale. Antigravity: niente, resta
 * l'euristica. Se il profilo dell'utente usa già lo stesso canale, si rinuncia.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const SIGNAL_ENV = 'AISESS_SIGNAL_FILE';
const NOTHING = Object.freeze({ args: [], env: {}, exact: false });

function writeCommand(state, platform) {
  if (platform === 'win32') {
    return { type: 'command', shell: 'powershell', command: `Set-Content -NoNewline -LiteralPath $env:${SIGNAL_ENV} -Value ${state}` };
  }
  return { type: 'command', command: `printf ${state} > "$${SIGNAL_ENV}"` };
}

/** JSON per `claude --settings`. L'evento si sa da quale hook scatta: niente stdin. */
function claudeSettings({ platform = process.platform } = {}) {
  const on = (state, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [writeCommand(state, platform)] }];
  return JSON.stringify({
    hooks: {
      SessionStart: on('ready'),
      UserPromptSubmit: on('running'),
      PreToolUse: on('running'),
      PostToolUse: on('running'),
      Notification: on('permission', 'permission_prompt|elicitation_dialog'),
      Stop: on('waiting'),
      StopFailure: on('waiting'),
    },
  });
}

/* Gira dentro opencode (Bun). Un errore qui non deve mai rompere opencode:
   è l'unico punto in cui un errore si tace, perché non c'è un nostro log. */
function opencodePluginSource() {
  return `// Scritto da PizzaManager (docs/plans/46): stato della sessione per la sua card.
import { writeFileSync } from 'node:fs';
const write = (state) => {
  const file = process.env.${SIGNAL_ENV};
  if (!file) return;
  try { writeFileSync(file, state); } catch {}
};
const STATES = {
  'permission.updated': 'permission',
  'question.asked': 'permission',
  'permission.replied': 'running',
  'question.replied': 'running',
  'question.rejected': 'running',
};
export default async () => {
  write('ready');
  return {
    event: async ({ event }) => {
      if (!event) return;
      if (event.type === 'session.status') {
        const t = event.properties && event.properties.status && event.properties.status.type;
        if (t === 'idle') write('waiting');
        else if (t === 'busy' || t === 'retry') write('running');
        return;
      }
      if (STATES[event.type]) write(STATES[event.type]);
    },
  };
};
`;
}

const CODEX_ARGS = Object.freeze(['-c', 'tui.notifications=true', '-c', 'tui.notification_method=osc9', '-c', 'tui.notification_condition=always']);
function fileUrl(p, platform) {
  if (platform === 'win32') return 'file:///' + path.win32.resolve(p).replace(/\\/g, '/');
  return pathToFileURL(p).href;
}

const hasFlag = (args, flag) => (args || []).some((a) => a === flag || String(a).startsWith(flag + '='));

/**
 * @returns {{args: string[], env: Record<string,string>, exact: boolean}} da AGGIUNGERE ad args/env
 */
function injectFor(type, { pluginPath, platform = process.platform, args = [], env = {} } = {}) {
  if (type === 'claude') {
    if (hasFlag(args, '--settings')) return NOTHING;
    return { args: ['--settings', claudeSettings({ platform })], env: {}, exact: true };
  }
  if (type === 'opencode') {
    if (!pluginPath || env.OPENCODE_CONFIG_CONTENT) return NOTHING;
    return { args: [], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [fileUrl(pluginPath, platform)] }) }, exact: true };
  }
  if (type === 'codex') return { args: [...CODEX_ARGS], env: {}, exact: true };
  return NOTHING;
}

module.exports = { injectFor, claudeSettings, opencodePluginSource, CODEX_ARGS, SIGNAL_ENV };
```

Nota: `NOTHING` è congelato; i test confrontano con `deepEqual`, quindi ritornare l'oggetto condiviso va bene, ma chi chiama non deve modificarlo (non lo fa: si spalma in oggetti nuovi).

- [ ] **Step 4:** `node --test tests/agent-hooks.test.js` → PASS.
- [ ] **Step 5:** commit `feat: hook di Claude, plugin opencode e notifiche di Codex per processo`.

---

### Task 3: Cablaggio nel main (`app/pty.js`, `main.js`, `preload.js`, `app/tmux.conf`)

**Files:**
- Modify: `app/pty.js` (spawn ~133-215, track ~102, close/terminate/forget ~420-465, sweepScrollback ~378)
- Modify: `main.js` (store vicino a `scrollbackStore`, passaggio a `createPtyManager`, avvio watch)
- Modify: `preload.js` (`onAgentSignal`)
- Modify: `app/tmux.conf`
- Test: `tests/agent-wiring.test.js` (comportamento del manager con pty e tmux finti, se `createPtyManager` lo permette; altrimenti `tests/integration.test.js`)

**Interfaces:**
- Consumes: `createAgentSignalStore`, `injectFor`, `opencodePluginSource`, `SIGNAL_ENV`.
- Produces: canale IPC `agent-signal` con payload `{ id: string, state: 'ready'|'running'|'waiting'|'permission' }`; `window.aisess.onAgentSignal(cb)`. Al `track()` di una scheda il main manda subito lo stato già presente nel file (segnali arrivati ad app chiusa).

- [ ] **Step 1: test che fallisce** — `tests/agent-wiring.test.js`: crea `createPtyManager` con `node-pty` vero ma `tmux = null` (ramo senza tmux), `signalStore` su tmpdir, `profiles.load()` che ritorna un profilo `claude` con `bin: process.execPath` e `args: ['-e', 'require("fs").writeFileSync(process.env.AISESS_SIGNAL_FILE, "waiting"); setTimeout(()=>{}, 300)']`. Verifica: `sendToRenderer` riceve `('agent-signal', { id: 'tab1', state: 'waiting' })`; args passati contengono `--settings`. Se `node-pty` non si carica sotto node (modulo compilato per Electron) il test va in `tests/integration.test.js` con `t.skip`. Leggere prima come `tests/live-sessions.test.js` e `tests/wiring.test.js` costruiscono il manager e seguire lo stesso schema.

- [ ] **Step 2:** eseguire → FAIL.

- [ ] **Step 3: implementazione**

In `createPtyManager` aggiungere il parametro `signalStore = null` (funzione lazy come gli altri store) e:

```js
const { injectFor, opencodePluginSource, SIGNAL_ENV } = require('../lib/agent-hooks');
// …
let pluginPath = null;
/** Il plugin opencode si riscrive a ogni avvio: segue la versione dell'app. */
function ensurePlugin() {
  if (pluginPath || !signalStore) return pluginPath;
  try { pluginPath = signalStore().writePlugin(opencodePluginSource()); } catch (e) {
    console.error('[agent-signals] plugin opencode non scritto:', e.message);
  }
  return pluginPath;
}

/** Chiave del file di stato: il nome tmux (stabile ai riavvii), o la scheda. */
const signalKey = (id, session) => session || `tab-${String(id).replace(/[^A-Za-z0-9_-]/g, '')}`;

/** Args/env in più per il segnale esatto. Niente store, niente segnale: euristica. */
function signalInjection({ id, session, type, args, profileEnv }) {
  if (!signalStore) return { args: [], env: {} };
  const key = signalKey(id, session);
  const inj = injectFor(type, { pluginPath: ensurePlugin(), args, env: profileEnv || {} });
  if (!inj.exact) return { args: [], env: {} };
  signalStore().ensureDir();
  signalStore().remove(key); // uno stato vecchio non deve accendere la scheda nuova
  return { args: inj.args, env: { ...inj.env, [SIGNAL_ENV]: signalStore().pathFor(key) } };
}
```

In `spawn`, dopo `const session = …`:

```js
const extra = signalInjection({ id, session, type, args, profileEnv });
const fullArgs = [...args, ...extra.args];
```

`buildCommand` (`lib/commands.js`) riceve un'opzione `inject(args, profileEnv) → { args, env }`, chiamata subito dopo `withInlineFlag` e **prima** di `wrapForPlatform`: così su Windows gli args aggiunti finiscono anche in `commandLine` di `cmd.exe /d /s /c`. Ritorna in più `injectedEnv` (`{}` senza `inject`). `args` ritornato contiene già l'iniezione; per la cronologia `spawn` usa `profile`/`r.args` com'erano (campo nuovo `baseArgs`, gli args prima dell'iniezione).

```js
// lib/commands.js, dentro buildCommand
const baseArgs = withInlineFlag(type, r.args);
const extra = inject ? inject(baseArgs, r.env || {}) : { args: [], env: {} };
const args = [...baseArgs, ...extra.args];
// …i due return aggiungono: injectedEnv: extra.env, baseArgs
```

Test in `tests/windows.test.js`: con `platform: 'win32'`, binario `.cmd` e `inject: () => ({ args: ['--settings', '{"a":1}'], env: { X: '1' } })`, `commandLine` contiene `--settings` e `injectedEnv` è `{ X: '1' }`. In `tests/lib.test.js` (o dove sono i test di `buildCommand`): senza `inject` il risultato è quello di oggi.

In `spawn`: `session` si calcola prima di `buildCommand` (oggi è calcolato dopo: spostarlo, non dipende dal comando), poi

```js
const built = buildCommand(type, resumeId, commandProfileId, {
  profiles,
  inject: (a, pEnv) => signalInjection({ id, session, type, args: a, profileEnv: pEnv }),
});
```

`env` (pty diretto) e `sessionEnv` (tmux) ricevono `...injectedEnv` dopo `profileEnv`. Il ramo `replay` (ripristino da snapshot) lancia una shell: lì l'iniezione non serve e non fa danni. La riga `cmd` della cronologia usa `baseArgs`: niente JSON di hook nella cronologia.

In `track(id, p, session, type)` salvare `c.signalKey = signalKey(id, session)` e, se c'è uno stato nel file, mandarlo:

```js
if (signalStore) {
  const state = signalStore().read(c.signalKey);
  if (state) sendToRenderer('agent-signal', { id, state });
}
```

Funzione esportata `onSignal(key, state)`: cerca il client con `c.signalKey === key` e manda `agent-signal`. `forget(session)` e `close(id)` senza tmux chiamano `signalStore().remove(key)`. `sweepScrollback` diventa anche lo sweep dei segnali (`signalStore().sweep(nomi)`), e senza tmux `startCapture` non parte: aggiungere `sweepSignals()` chiamato da `main.js` all'avvio (senza tmux: `sweep([])`).

`main.js`:

```js
const { createAgentSignalStore } = require('./lib/agent-signals');
const signalStore = lazy(() => createAgentSignalStore({ dir: app.getPath('userData') }));
// in createPtyManager({...}): signalStore,
// dopo app ready:
try { signalStore().watch((key, state) => ptys.onSignal(key, state)); } catch (e) { console.error('[agent-signals] watch non avviato:', e.message); }
```

`preload.js`: `onAgentSignal: (cb) => ipcRenderer.on('agent-signal', (_e, v) => cb(v)),`

`app/tmux.conf`: in fondo
```
# Codex incapsula le sue notifiche OSC 9 in \ePtmux; (docs/plans/46).
# tmux 3.2 le lascia passare da sé; dalla 3.3 serve questo. -q: la 3.2 non lo conosce.
set -gq allow-passthrough on
```

- [ ] **Step 4:** `npm run test:unit` → PASS (compresi `wiring.test.js` e il test che `main.js` resti cablaggio).
- [ ] **Step 5:** commit `feat: le sessioni ricevono gli hook e il main inoltra i segnali alla scheda`.

---

### Task 4: Regole nel renderer (`renderer/agent-state.js`)

**Files:**
- Create: `renderer/agent-state.js` (UMD come `attention.js`, globale `AisessAgentState`)
- Modify: `renderer/index.html` (dopo `running.js`), `tests/renderer-load.test.js` se elenca i file
- Test: `tests/agent-state.test.js`

**Interfaces:**
- Produces: `codexOscState(text) → 'waiting'|'permission'`; `createAgentState() → { signal(id, state, { watched }) → { running: boolean|null, attention: null|'done'|'permission', changed: boolean }, isExact(id), seen(id), forget(id) }`.
  - `running: null` = «non toccare la barra» (Codex: la barra resta euristica).
  - `attention`: lo stato che la card deve avere **dopo** il segnale.

Regole:
- qualunque segnale → `exact = true`
- `ready` → `{ running: false, attention: <invariata> }`
- `running` → `ranSinceSeen = true`; `{ running: true, attention: null }`
- `waiting` → `{ running: false, attention: watched ? null : (ranSinceSeen ? 'done' : <invariata>) }`
- `permission` → `{ running: false, attention: watched ? null : 'permission' }`
- `seen(id)` → `attention = null`, `ranSinceSeen = false`
- `signal(id, state, { watched, codex: true })` → `running: null` (Codex non dà «running»)

- [ ] **Step 1: test che fallisce**

```js
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
```

Nota sui test di Codex: per Codex non arriva mai `running` esatto, e l'OSC 9 di fine turno lo manda solo a turno vero (non all'avvio): `ranSinceSeen` per Codex si considera sempre vero.

- [ ] **Step 2:** `node --test tests/agent-state.test.js` → FAIL.

- [ ] **Step 3: implementazione**

```js
/* Il segnale esatto degli agenti (docs/plans/46): «lavora», «ha finito»,
 * «chiede un permesso», detto dall'agente stesso tramite hook (o OSC 9 per
 * Codex). Decide barra e lampeggio; l'euristica di attention.js resta per le
 * sessioni che non hanno mai mandato un segnale.
 *
 * «Ha finito» solo se c'è stato un «lavora» dall'ultima visita: all'avvio e
 * con --resume l'agente si ferma senza aver lavorato, e non deve accendersi.
 * Il permesso si accende sempre: è una domanda, non un lavoro finito.
 *
 * Wrapper UMD come attention.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessAgentState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function createAgentState() {
    /** @type {Map<string, {ran: boolean, running: boolean|null, attention: null|'done'|'permission'}>} */
    const state = new Map();

    function get(id) {
      if (!state.has(id)) state.set(id, { ran: false, running: null, attention: null });
      return state.get(id);
    }

    function next(s, signal, watched, codex) {
      const ran = codex || s.ran;
      const quiet = (a) => (watched ? null : a);
      switch (signal) {
        case 'running': return { ran: true, running: codex ? null : true, attention: null };
        case 'waiting': return { ran: s.ran, running: codex ? null : false, attention: quiet(ran ? 'done' : s.attention) };
        case 'permission': return { ran: s.ran, running: codex ? null : false, attention: quiet('permission') };
        default: return { ran: s.ran, running: codex ? null : false, attention: s.attention };
      }
    }

    /**
     * @param {string} id
     * @param {'ready'|'running'|'waiting'|'permission'} signal
     * @param {{watched?: boolean, codex?: boolean}} [o]
     */
    function signal(id, sig, { watched = false, codex = false } = {}) {
      const s = get(id);
      const n = next(s, sig, watched, codex);
      const changed = n.running !== s.running || n.attention !== s.attention;
      state.set(id, n);
      return { running: n.running, attention: n.attention, changed };
    }

    function isExact(id) { return state.has(id); }
    function seen(id) { if (state.has(id)) state.set(id, { ...state.get(id), ran: false, attention: null }); }
    function forget(id) { state.delete(id); }

    return { signal, isExact, seen, forget };
  }


  /* Testi di Codex 0.143 per le richieste all'utente (tui/src/chatwidget):
     tutto il resto è la fine del turno (l'ultimo messaggio dell'assistente). */
  const CODEX_ASKS = ['Approval requested', 'Codex wants to edit', 'Plan mode prompt'];

  function codexOscState(text) {
    const s = String(text || '');
    return CODEX_ASKS.some((p) => s.startsWith(p)) ? 'permission' : 'waiting';
  }

  return { createAgentState, codexOscState };
});
```

Attenzione al test «lavora e poi finisce»: il primo `running` parte da `running: null` → `changed: true` ✔; `ready` e un `running` uguale al precedente → `changed: false` ✔.

- [ ] **Step 4:** `node --test tests/agent-state.test.js tests/renderer-load.test.js` → PASS.
- [ ] **Step 5:** commit `feat: regole del segnale esatto nel renderer`.

---

### Task 5: Renderer — segnali, OSC 9 di Codex, lampeggio rapido

**Files:**
- Modify: `renderer/signals.js`, `renderer/tabs.js:141`, `renderer/renderer.js:125-145`, `renderer/sidebar.js:417-420,536-552,629-632`, `renderer/styles.css:443-485`, `renderer/app-state.js:32-33`
- Test: `tests/sidebar-segnali.test.js` (estendere: classe `needs-permission` via `signal()`), `tests/agent-state.test.js` già copre le regole

**Interfaces:**
- Consumes: `window.AisessAgentState.createAgentState`, `window.AisessAgentState.codexOscState`, `window.aisess.onAgentSignal`.
- Produces: `t.attentionKind: 'done'|'permission'|null` accanto a `t.needsAttention`; `sidebar.signal(id, { needsAttention, permission })`.

- [ ] **Step 1: test che fallisce** — in `tests/sidebar-segnali.test.js` (seguire lo schema esistente con `fake-dom.js`):

```js
test('permesso: la card ha needs-attention e needs-permission; spenta, nessuna delle due', () => {
  // render con una scheda, poi:
  sidebar.signal('a', { needsAttention: true, permission: true });
  assert.ok(card.classList.contains('needs-attention'));
  assert.ok(card.classList.contains('needs-permission'));
  sidebar.signal('a', { needsAttention: false, permission: false });
  assert.ok(!card.classList.contains('needs-permission'));
});
```

- [ ] **Step 2:** eseguire → FAIL.

- [ ] **Step 3: implementazione**

`renderer/sidebar.js` `signal()`:
```js
if ('permission' in flags) p.card.classList.toggle('needs-permission', !!flags.permission);
```
e nel render (riga ~417): `+ (t.needsAttention && t.attentionKind === 'permission' ? ' needs-permission' : '')`; titolo `PERMISSION_TITLE = 'Ti sta chiedendo un permesso'` quando è un permesso. Gruppo chiuso: la testata prende `needs-permission` se almeno una card ce l'ha.

`renderer/styles.css`, dopo le regole `animation:`:
```css
/* Chiede un permesso (docs/plans/46): stesso colore della sessione, ritmo più rapido */
.session-item.needs-attention.needs-permission { animation-duration: .9s; }
.group-header.needs-attention.needs-permission { animation-duration: .9s; }
```
(il `prefers-reduced-motion` esistente la ferma già).

`renderer/app-state.js`: `const AgentState = window.AisessAgentState;`

`renderer/signals.js`:
```js
const agentState = AgentState.createAgentState();

/** Un segnale esatto (hook o OSC 9). @param {'ready'|'running'|'waiting'|'permission'} sig */
function applyAgentSignal(t, sig) {
  if (!t || !t.alive) return;
  const codex = t.type === 'codex';
  const r = agentState.signal(t.id, sig, { watched: isWatched(t), codex });
  if (!r.changed) return;
  clearTimeout(t.idleTimer);
  t.idleTimer = null;
  if (r.running !== null && r.running !== t.running) { t.running = r.running; showRunning(t); }
  const kind = r.attention;
  const was = t.needsAttention ? t.attentionKind : null;
  if (kind === was) return;
  t.needsAttention = Boolean(kind);
  t.attentionKind = kind;
  if (kind) notifyFinished(t); else attention.seen(t.id);
  if (r.running === false || kind === 'done') noteWorktreeSessionDone(t);
  syncBadge();
  if (!sidebar.signal(t.id, { needsAttention: Boolean(kind), permission: kind === 'permission' })) renderSidebar();
}
```
- `noteActivity(t, bytes)`: in testa `if (agentState.isExact(t.id)) return;` (l'euristica tace).
- `flagAttention(t, { bell })`: stesso controllo, ma `noteWorktreeSessionDone(t)` resta prima.
- `noteRunning(t)`: se `agentState.isExact(t.id) && t.type !== 'codex'` la barra non si tocca (la decide il segnale); per Codex resta com'è, e `retractAttention` continua a spegnere il lampeggio quando l'output riprende.
- `clearAttention(id)`: aggiungere `agentState.seen(id)` e `t.attentionKind = null`.
- `retractAttention(t)`: anche `t.attentionKind = null` e `sidebar.signal(..., { needsAttention: false, permission: false })`.
- In modalità esatta `attention` (euristica) non viene più consultato per quella scheda: nessuna funzione nuova in `attention.js`.

`renderer/renderer.js`, accanto a `onData`:
```js
window.aisess.onAgentSignal(({ id, state }) => applyAgentSignal(tabs.get(id), state));
```
e in `onExit`: `agentState.forget(id)`.

`renderer/tabs.js`, accanto a `term.onBell`:
```js
// Codex manda OSC 9 a fine turno e quando chiede un'approvazione (docs/plans/46)
if (tab.type === 'codex') {
  try { term.parser.registerOscHandler(9, (text) => { applyAgentSignal(tab, AgentState.codexOscState(text)); return true; }); } catch {}
}
```

- [ ] **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5:** commit `feat: lampeggio rapido per i permessi e segnale esatto sulle card`.

---

### Task 6: Notifica «chiede un permesso»

**Files:**
- Modify: `lib/notifications.js` (`validateItem`, `composeNotification`), `renderer/notify.js` (`notifyItem`)
- Test: `tests/notifications.test.js`, `tests/notify-store.test.js`

**Interfaces:**
- Produces: voce `{ id, name, typeLabel, where, kind: 'done'|'permission' }`; `kind` ignoto → `'done'`.

- [ ] **Step 1: test che falliscono** (in `tests/notifications.test.js`):

```js
ok('notifiche: un permesso ha il suo titolo', () => {
  const n = N.composeNotification([N.validateItem(item('a', { kind: 'permission' }))]);
  assert.strictEqual(n.title, 'Claude chiede un permesso');
});

ok('notifiche: kind ignoto vale «ha finito»', () => {
  assert.strictEqual(N.validateItem(item('a', { kind: 'boh' })).kind, 'done');
  assert.strictEqual(N.validateItem(item('a')).kind, 'done');
});

ok('notifiche: più sessioni e almeno un permesso → «ti aspettano»', () => {
  const n = N.composeNotification([N.validateItem(item('a')), N.validateItem(item('b', { kind: 'permission' }))]);
  assert.strictEqual(n.title, '2 sessioni ti aspettano');
});
```
e in `tests/notify-store.test.js`: `notifyItem({ ..., attentionKind: 'permission' }, …).kind === 'permission'`.

- [ ] **Step 2:** eseguire → FAIL.
- [ ] **Step 3:** `validateItem`: `kind: raw.kind === 'permission' ? 'permission' : 'done'`. `composeNotification`: singola → `${typeLabel} chiede un permesso` se `kind === 'permission'`; multiple → `N sessioni ti aspettano` se qualcuna è `permission`, altrimenti il testo di oggi. `notifyItem`: `kind: tab.attentionKind === 'permission' ? 'permission' : 'done'`.
- [ ] **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5:** commit `feat: la notifica di sistema distingue il permesso dalla fine del turno`.

---

### Task 7: Integrazione, smoke, documenti

**Files:**
- Modify: `tests/integration.test.js`, `docs/plans/46-hook-esatti.md`, `docs/plans/README.md`, `docs/plans/idee.md`

- [ ] **Step 1: test di integrazione** (saltati senza il tool):

```js
test('claude accetta i nostri hook con --settings', (t) => {
  const bin = which('claude'); if (!bin) return t.skip('claude non installato');
  const { claudeSettings } = require('../lib/agent-hooks');
  const r = spawnSync(bin, ['--settings', claudeSettings({ platform: process.platform }), '--version'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
});

test('OSC 9 incapsulato attraversa tmux con la config dell app', (t) => {
  // tmux -L aistest-osc-<pid> -f app/tmux.conf new-session -d … printf '\ePtmux;\e\e]9;Approval requested: ls\a\e\\'
  // attach via `script -q -c`, poi cercare '\x1b]9;Approval requested' nell'output. t.skip senza tmux o `script`.
});
```
(Usare i helper `which` già presenti nel file; socket sempre `aistest-…` e `kill-server` nel `finally`.)

- [ ] **Step 2:** `npm run test:unit` → PASS.
- [ ] **Step 3: smoke nell'app** (`npm start`, finestra dietro un'altra):
  1. Claude in secondo piano: chiedere `esegui ls /tmp` senza permessi preapprovati → lampeggio rapido + notifica «Claude chiede un permesso». Approvare → barra. Fine → lampeggio normale + «Claude ha finito».
  2. opencode: stesso giro (permesso di bash).
  3. Codex: una richiesta che chiede approvazione; verificare lampeggio rapido; fine turno → lampeggio normale. Annotare in 46 il testo reale ricevuto a fine turno.
  4. Chiudere l'app con un permesso pendente su Claude, riaprire → card con lampeggio rapido.
  5. Antigravity: comportamento invariato.
- [ ] **Step 4:** aggiornare 46 (sezione Verifica con l'esito), README (stato), `idee.md` (`[x] fatto`, `[x] provato` se lo smoke passa).
- [ ] **Step 5:** commit `docs: piano 46, esito delle prove`.

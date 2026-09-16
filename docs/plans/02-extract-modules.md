# Branch 2 — `refactor/extract-modules`

**Dipende da**: branch 1 (mergiato). **Taglia**: 1 giorno. **Rischio**: basso, ma è il branch da cui dipende tutto il resto.

> **Stato: fatto** (seconda esecuzione, 2026-09-16). La prima (PR #5) era
> diventata non mergiabile: vedi la nota nel README. Rispetto al piano
> originale è comparso `lib/profiles.js` (store dei profili di comando, sul
> modello di accounts/history) e `lib/commands.js` costruisce il comando dai
> profili invece che da una tabella fissa. `main.js`: 801 → 137 righe, 85 test,
> copertura 90%.

---

## Contesto

AISessionManager è un'app Electron che gestisce sessioni di terminale in schede:
shell semplice, `opencode` e `claude`, ognuna in un PTY reale (`node-pty` + `xterm.js`).
Sa anche riprendere sessioni precedenti, leggendo `opencode session list --format json`
e scansionando `~/.claude/projects/**/*.jsonl`.

Struttura attuale:

```
main.js       513 righe — fa tutto: risoluzione binari, account Claude, cronologia,
                          discovery sessioni, handler IPC, finestra, menu applicazione
preload.js     24 righe — contextBridge, superficie IPC
renderer/      504 righe di renderer.js + index.html + styles.css
tests/         run-tests.js, 13 test
```

**Il problema che questo branch risolve.** `main.js` fa `require('electron')` alla
riga 1. Tutto ciò che sta nel file eredita quella dipendenza, quindi non è
importabile da un processo Node normale. La conseguenza si vede nei test:

```js
// tests/run-tests.js:13 — questa NON è la buildCommand dell'app, è una copia
function buildCommand(type, resumeId) {
  if (type === 'opencode') return resumeId ? { cmd: 'opencode', args: ['--session', resumeId] } : ...
```

I test verificano una replica della logica. Se qualcuno rompe la `buildCommand`
vera, restano verdi. Gli altri 9 test su 13 sono asserzioni del tipo
`assert.ok(js.includes('proposeDimensions'))`: controllano che certe stringhe
esistano nei file, non che il comportamento sia corretto, e si rompono a ogni
rinomina senza aver mai catturato un bug.

Copertura reale della logica: circa zero.

## Obiettivo

Separare la logica pura dal codice che dipende da Electron, e riscrivere i test
perché importino i moduli veri.

## Struttura di arrivo

```
lib/                     ← logica pura. VINCOLO: nessun require('electron')
  shell.js               getDefaultShell
  login-path.js          risoluzione del PATH di login
  binaries.js            isExecutable, candidatesFor, resolveBinary, augmentedEnv
  commands.js            buildCommand
  accounts.js            account Claude: OAuth + profili API key
  history.js             sessions-history.json
  claude-sessions.js     parser di ~/.claude/projects/**/*.jsonl
  opencode-sessions.js   wrapper di `opencode session list --format json`

app/                     ← codice che Electron ce l'ha per natura
  menu.js                buildAppMenu (usa Menu, non può stare in lib/)
  window.js              createWindow

main.js                  ← solo wiring: registra gli handler IPC e avvia l'app
```

La distinzione `lib/` vs `app/` è il punto di tutto il branch: in `lib/` finisce
ciò che si può testare senza avviare Electron, in `app/` ciò che non ha senso
testare in isolamento. Costruire un menu nativo appartiene alla seconda categoria,
non forzarlo in `lib/`.

## Il vincolo che rende testabile il tutto

Due moduli oggi chiamano `app.getPath('userData')` dentro di sé:

```js
// main.js:129 e main.js:169
function claudeAccountsFile() { return path.join(app.getPath('userData'), 'claude-accounts.json'); }
function historyFile()        { return path.join(app.getPath('userData'), 'sessions-history.json'); }
```

Vanno trasformati in factory che ricevono la directory dall'esterno:

```js
// lib/accounts.js
function createAccountStore({ dir }) { /* ritorna { list, add, remove, envFor, detectOauth } */ }

// lib/history.js
function createHistoryStore({ dir }) { /* ritorna { load, append } */ }
```

`main.js` passa `app.getPath('userData')`, i test passano una directory
temporanea. È questa inversione — e non lo spostamento dei file — a rendere i
moduli testabili.

> Nota per il branch 3: `accounts.js` dovrà accettare anche un `encryptor`
> iniettato, per `safeStorage`. Progettare la factory tenendone conto
> (`createAccountStore({ dir, encryptor })` con default in chiaro) risparmia
> un secondo refactor.

## Task

1. **Creare `lib/` un modulo alla volta, un commit per modulo.** Ordine
   consigliato, dal meno al più intrecciato: `shell` → `login-path` → `binaries`
   → `commands` → `history` → `accounts` → `opencode-sessions` → `claude-sessions`.
   A ogni commit `main.js` importa il nuovo modulo e la vecchia funzione sparisce.
2. **Estrarre `app/menu.js` e `app/window.js`.**
3. **Riscrivere `tests/run-tests.js`.** I 9 test basati su `grep` si eliminano.
   Quelli che codificavano un requisito vero diventano comportamentali — in
   particolare `tests/run-tests.js:92` («la lista deve proiettare solo id+nome»)
   diventa: chiama `store.list()` e verifica che nessun oggetto restituito abbia
   la chiave `apiKey`. È la garanzia che si voleva davvero.
4. **Fixture per il parser JSONL** in `tests/fixtures/`: almeno un file valido,
   uno troncato a metà riga, uno senza messaggi utente.
5. **Passare al test runner di Node** (`node --test --experimental-test-coverage`),
   aggiornando `package.json`. È stdlib su Node 24, zero dipendenze nuove, e dà
   la misura di copertura che oggi non esiste.

## Verifica

```bash
# 1. il vincolo strutturale — non deve trovare NIENTE
grep -rn "require('electron')" lib/

# 2. main.js è tornato a fare solo wiring
wc -l main.js        # atteso: < 150

# 3. i test passano e misurano
npm run test:unit

# 4. smoke test manuale: apri una shell, una sessione claude, e un resume
npm start
```

## Criteri di uscita

- `grep -rn "require('electron')" lib/` non trova nulla.
- `main.js` sotto le 150 righe.
- **Test di falsificazione**: rompi apposta `buildCommand` in `lib/commands.js`
  (per esempio cambia `--resume` in `--resumo`) e i test devono diventare **rossi**.
  Oggi resterebbero verdi: se restano verdi anche dopo, il branch ha fallito il
  suo unico scopo. Ripristina dopo la verifica.
- La copertura è **misurabile**. Non serve centrare l'80% in questo branch:
  serve poterlo misurare.
- **Comportamento identico**: smoke test manuale superato su tutti e tre i tipi
  di sessione, più un resume.

## Rollback

Il branch non tocca dati né configurazioni dell'utente: `git checkout main` e
non resta traccia. Se solo una parte è problematica, i commit sono per modulo,
quindi si fa `git revert` del singolo.

## Fuori scope

Niente `safeStorage`, niente CSP, niente `getLoginPath` async, niente
validazioni nuove, niente correzioni di immutabilità: hanno i loro branch (3 e 4).
Sono tutte cose che si vedono passare sotto gli occhi mentre si sposta il codice,
ed è esattamente la tentazione da evitare — mescolarle rende impossibile dire se
una regressione viene dal refactor o dalla modifica.

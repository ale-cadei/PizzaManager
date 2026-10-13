# 60 — `feat/sessione-editor`: una sessione per leggere e modificare i file

Dipende da: 25 (sessione git, il modello di scheda senza pty). Taglia: ~2-3 giorni.

## Perché

Le sessioni dell'app sono terminali e la timeline git. Per guardare un file
che un agente ha appena toccato, o correggerne due righe, oggi si apre un
editor esterno o si lancia `nano` in una shell. Una scheda `editor` sulla
cartella del progetto tiene tutto nella stessa finestra.

## Cosa fa (perimetro)

- Albero delle cartelle a partire dalla cartella della sessione.
- Più file aperti, in sotto-schede dentro la scheda editor, con indicatore
  «non salvato».
- Evidenziazione della sintassi e numeri di riga.
- Cerca / sostituisci nel file aperto (Ctrl+F / Ctrl+H).
- Dall'albero: nuovo file, nuova cartella, rinomina, elimina.
- Al riavvio tornano la scheda e i file aperti (non le modifiche non salvate:
  alla chiusura si chiede).
- Un file cambiato sul disco si ricarica da solo se nell'editor è pulito; se
  ha modifiche, si chiede.

## Fuori

- Ricerca nell'intero progetto, LSP, debug, terminale integrato: ci sono già
  le schede shell e gli agenti.
- Diff e staging: c'è il pannello delle modifiche (piano 32).
- Modifiche non salvate che sopravvivono al riavvio.
- File binari, non UTF-8, oltre 5 MB: si rifiutano con un messaggio.

## Motore: Monaco

Scelto dall'utente su CodeMirror 6 e su un editor da terminale: è il motore
di VS Code, copre tutto il perimetro senza codice nostro (sintassi, ricerca,
multi-cursore). Il prezzo:

- **Peso**: `monaco-editor` come dipendenza, si carica
  `node_modules/monaco-editor/min/vs` col suo loader AMD. `min/vs/**` va nei
  `files` del build, il resto del pacchetto no.
- **CSP**: Monaco crea web worker per i linguaggi. In `renderer/index.html` si
  aggiunge `worker-src 'self' blob:`. `script-src` resta `'self'`, **mai**
  `'unsafe-inline'`. Se il loader chiede altro, la console del renderer lo
  dice: si allarga la policy il minimo, con un commento sul perché.
- **asar**: i worker si caricano dal renderer, che sa leggere dentro
  `app.asar`. Va comunque verificato nel `.deb` (lezione di `tmux.conf`): se
  non partono, `min/vs/**` in `build.asarUnpack`.

Un solo modulo tocca Monaco (`renderer/editor-monaco.js`): il resto del
renderer parla con lui, così il motore resta sostituibile.

## Architettura

### Main — `lib/` (niente Electron, tutto testato)

- **`lib/editor-fs.js`** — `createEditorFs({ root, platform })`:
  - `list(rel)` → voci `{ name, kind: 'file'|'dir', ignored }`, cartelle
    prima, ordine alfabetico; `.git` non compare. `ignored` lo dice git
    (`check-ignore` via `lib/git-run.js`), fuori da un repo è sempre `false`.
  - `read(rel)` → `{ ok, text, mtime, eol, bom }` o `{ ok:false, reason }` con
    `reason` fra `binary` (byte NUL nei primi 8 KB), `too-large` (> 5 MB),
    `not-utf8`, `outside`, `missing`.
  - `write(rel, text, { expectedMtime, eol, bom })` → `{ ok, mtime }` o
    `{ ok:false, conflict:true, mtime }` se il file sul disco è più nuovo di
    `expectedMtime`. Scrittura atomica: temporaneo nella stessa cartella +
    `rename`, mode dell'originale conservato. `expectedMtime: null` = file
    nuovo o ricreato.
  - `create(rel)`, `mkdir(rel)`, `rename(rel, newName)`: falliscono se la
    destinazione esiste.
  - **Confinamento**: ogni percorso passa da `resolveInside(rel)`:
    `path.resolve(root, rel)` poi `realpath` (della cartella padre, se il file
    non esiste ancora) e verifica che stia sotto `realpath(root)`. Rifiuta
    percorsi assoluti, `..` che escono, symlink che portano fuori.
  - **Nomi** (`validName`): niente vuoti, `.`, `..`, separatori `[\\/]`,
    caratteri vietati su Windows (`<>:"|?*`, controllo), nomi riservati
    (`CON`, `NUL`, `COM1`…) e spazi/punti finali quando `platform: 'win32'`.
- **`lib/editor-watch.js`** — `createEditorWatch({ onChange, debounceMs })`:
  `watch(absPath)` / `unwatch(absPath)` / `close()`. `fs.watch` per file,
  eventi raggruppati con debounce, riporta `{ path, exists, mtime }`. Un errore
  del watcher non fa cadere niente: il file resta coperto dal ricontrollo in
  primo piano.
- **`lib/editor-sessions.js`** — store come `lib/git-sessions.js`:
  `{ savedAt, sessions: [{ name, cwd, files: [rel…], active }] }`, scritto per
  intero dal renderer, sanificato in lettura (limiti su numero, lunghezze,
  `rel` che non escono), file corrotto → nessuna sessione.
- **`lib/editor-language.js`** (UMD, usato anche dal renderer) — estensione /
  nome file → id linguaggio Monaco (`Dockerfile`, `Makefile`, `.mjs`…),
  `plaintext` di default.

### Main — `app/`

- **`app/editor.js`** — elimina con `shell.trashItem` (mai `unlink`/`rm`):
  il percorso passa prima da `resolveInside` di `editor-fs`. Tiene un
  `editor-watch` per finestra e manda gli eventi al renderer
  (`editor-file-changed`).
- **`app/window.js`** — conferma d'uscita con file sporchi (vedi Chiusura).

### `main.js`

Solo handler IPC: `editor-list`, `editor-read`, `editor-write`,
`editor-create`, `editor-mkdir`, `editor-rename`, `editor-trash`,
`editor-watch`, `editor-unwatch`, `editor-sessions`, `editor-sessions-save`.
Ogni handler riceve `root` dal renderer e costruisce `createEditorFs({ root })`:
`root` deve esistere ed essere una cartella, altrimenti errore.

### `preload.js`

Le funzioni corrispondenti sotto `window.aisess.editor*` e
`onEditorFileChanged`.

### Renderer

- **`renderer/editor-monaco.js`** — carica Monaco una volta (loader AMD,
  lazy alla prima scheda editor), crea un'istanza per scheda, un `model` per
  file, tema dai token dell'app, font dell'app (`term-font.js`). Espone
  `open(file, text, language)`, `activate(file)`, `getText(file)`,
  `isDirty(file)`, `markSaved(file)`, `replaceText(file, text)` (conserva
  cursore e scroll), `dispose()`.
- **`renderer/editor-tree.js`** (UMD) — modello dell'albero: cartelle aperte,
  figli letti in modo lazy, selezione; vista separata. Menu contestuale:
  nuovo file / cartella, rinomina (input inline), elimina (conferma con
  `confirm-bubble.js`). File ignorati da git attenuati.
- **`renderer/editor-files.js`** (UMD) — stato dei file aperti per scheda:
  ordine, attivo, `mtime`, `eol`, `bom`, sporco, `deleted`, `conflict`.
  Funzioni pure, testate: apri/attiva/chiudi/rinomina/segna-eliminato.
- **`renderer/editor-tab.js`** — cablaggio: `createEditorTab({ name, cwd })`
  chiamata da `tabs.js` come `createGitTab`; sotto-schede, barre di avviso,
  scorciatoie (Ctrl+S, Ctrl+Shift+S, Ctrl+W sulla sotto-scheda).
- **Aggiunte ai file esistenti**: `tabs.js` (tipo `editor`, niente `kill`),
  `new-session.js` (voce nel dialogo), `session-groups.js` (`TYPE_ORDER`,
  etichetta), `type-color-themes.js` (colore `editor` in ogni tema),
  `agent-icons.js`/`shell-icons.js` (icona), `restore.js` (ripristino),
  `index.html` (script nell'ordine giusto + CSP),
  `tests/renderer-load.test.js`.

## Flusso

**Apertura sessione.** Dialogo nuova sessione → tipo «Editor» + cartella
(stessa scelta di cwd degli altri tipi). Root = quella cartella, nome scheda =
nome della cartella.

**Apertura file.** Click nell'albero → `editor-read`. Errore → messaggio nel
pannello del file (perché non si apre), non un toast che sparisce. Già
aperto → si attiva la sua sotto-scheda. Si avvia il watch sul file.

**Salvataggio.** Ctrl+S (file attivo), Ctrl+Shift+S (tutti i sporchi) →
`editor-write` con `expectedMtime`, `eol`, `bom` letti all'apertura:
- ok → nuovo `mtime`, pallino via;
- `conflict` → barra «Cambiato sul disco: Sovrascrivi / Ricarica»;
- errore (permessi, disco pieno) → barra rossa col messaggio di sistema.

EOL e BOM rimessi come erano: un salvataggio senza modifiche non produce diff.

**Cambi esterni.** Evento del watch, o ricontrollo dei `mtime` quando la
scheda torna in primo piano (come la timeline git):
- file pulito → ricarica, cursore e scroll conservati;
- file con modifiche → barra «Cambiato sul disco: Ricarica / Tieni il mio»
  («Tieni il mio» aggiorna `expectedMtime`, il prossimo Ctrl+S sovrascrive);
- file eliminato → sotto-scheda marcata «eliminato», contenuto conservato,
  Ctrl+S lo ricrea.

**Operazioni sull'albero.** Nuovo/rinomina con input inline e `validName`.
Rinomina di un file aperto → la sotto-scheda segue (nome, watch). Elimina →
cestino dopo conferma; file aperto eliminato → sotto-scheda chiusa se pulita,
marcata «eliminato» se sporca. Dopo ogni operazione si rilegge la cartella
toccata.

**Chiusura.** Sotto-scheda sporca → «Salva / Scarta / Annulla». Scheda
editor con file sporchi → la stessa domanda per l'insieme. Uscita dall'app
con file sporchi → oggi non c'è una conferma d'uscita da agganciare
(`app/quit-capture.js` cattura lo scrollback e non deve mai bloccare la
chiusura), quindi è nuova: `app/window.js` intercetta il `close` della
finestra, chiede al renderer se ci sono file sporchi (`editor-dirty`) e, se
sì, il renderer mostra «Salva tutto / Esci senza salvare / Annulla» e
risponde. Tetto di tempo sulla risposta: un renderer bloccato non deve
impedire la chiusura.

**Ripristino.** A ogni apertura/chiusura di file o scheda e a ogni rinomina,
il renderer riscrive `editor-sessions.json`. All'avvio, come le schede git:
riaperte da sole, o proposte nella finestra del ripristino (`restore.js`)
dopo un riavvio della macchina. File spariti nel frattempo → saltati in
silenzio; cartella sparita → la scheda non torna.

## Sicurezza

- I contenuti dei file vanno in Monaco come testo del `model`, mai in HTML.
  Nomi di file e messaggi di errore nell'albero e nelle barre: `textContent`.
- Il confinamento sta nel main, non nel renderer: il renderer manda percorsi
  relativi, il main li risolve e li verifica a ogni chiamata.
- Eliminare manda al cestino: un errore si recupera.
- Nessun file viene eseguito: l'editor legge e scrive testo.

## Windows

- Percorsi relativi con separatori `[\\/]`; i percorsi verso il main usano il
  `path` della macchina.
- `validName` con `platform: 'win32'` rifiuta nomi riservati, caratteri
  vietati, punti e spazi finali.
- Confronto «sta sotto root» insensibile a maiuscole su `win32`.
- Casi in `tests/windows.test.js` con `platform: 'win32'`, mai
  `if (os.platform())` nei test.

## Test

Unitari (codice vero, tmpdir, fixture in `tests/fixtures/editor/`):

- `tests/editor-fs.test.js` — confinamento (`..`, assoluti, symlink verso
  fuori, symlink dentro ammesso); `read` di binario / > 5 MB / non UTF-8 /
  mancante; EOL CRLF e BOM rimessi da `write`; scrittura atomica e mode
  conservato (`0o600` resta `0o600`); conflitto su `mtime`; `create`/`mkdir`/
  `rename` su destinazione esistente; `list` ordinato, `.git` escluso,
  `ignored` dentro e fuori da un repo.
- `tests/editor-watch.test.js` — modifica e cancellazione notificate,
  debounce che raggruppa, `close` ferma tutto.
- `tests/editor-sessions.test.js` — andata e ritorno, file corrotto,
  sanificazione (`rel` che escono scartati), `savedAt`.
- `tests/editor-language.test.js` — estensioni e nomi speciali.
- `tests/editor-files.test.js` — stato dei file aperti: apri/attiva/chiudi,
  rinomina, eliminato, sporco.
- `tests/windows.test.js` — `validName` e confinamento su `win32`.
- `tests/renderer-load.test.js` — nuovi script nell'ordine giusto.

Nell'app (smoke, Monaco e cestino non si provano da Node): aprire una
cartella, navigare, aprire tre file, modificare, salvare; cerca/sostituisci;
modificare lo stesso file da una shell → ricarica / barra; nuovo, rinomina,
elimina (finisce nel cestino); chiudere con file sporchi; riavviare l'app →
scheda e file tornano. Poi lo stesso nel `.deb` per i worker di Monaco.

## Commit

Separati, nell'ordine:

1. `chore: monaco-editor come dipendenza, CSP per i worker`
2. `feat: lib/editor-fs, confinamento e lettura/scrittura dei file` + test
3. `feat: lib/editor-watch e lib/editor-sessions` + test
4. `feat: scheda editor nel renderer` (albero, sotto-schede, Monaco)
5. `feat: ripristino delle schede editor`

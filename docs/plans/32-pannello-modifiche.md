# 32 — Pannello «cosa ha cambiato»

Branch: `feat/pannello-modifiche` · Dipende da: 25, 27, 31, 36 · Taglia: ~1½ g

## Obiettivo

Quando un agente dice «fatto», la domanda è sempre la stessa: **che cosa ha
toccato?** Oggi per saperlo si apre una shell e si lancia `git status` /
`git diff`. Il pannello lo mostra dentro l'app, in tre momenti:

1. **mentre l'agente lavora** — un'occhiata: quanti file, quante righe;
2. **quando dice «fatto»** — la revisione: elenco dei file e diff;
3. **prima di «Unisci»** un worktree (piano 36) — cosa sta per finire nella
   base. Oggi Unisci parte alla cieca.

È l'idea «Pannello "cosa ha cambiato"» di [idee.md](idee.md), sezione
«Agenti in parallelo».

## Cosa c'è già (non rifarlo)

- **Scheda git** (piani 25, 27, 31): `renderer/git-tab.js`,
  `renderer/git-graph-view.js` (Timeline / Mappa), `renderer/git-map-view.js`.
- `lib/git-run.js` (`runGit`): git con `execFile`, niente shell,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (leggere non deve mai
  bloccare né prendere lock sul repository dell'utente). **Tutte le letture
  di questo piano passano da lì.**
- `lib/git-graph.js`: modello di un lettore con `run` iniettabile e parsing
  puro testato senza git (`tests/git-graph.test.js`).
- **Worktree** (piano 36): `lib/worktree.js` legge `git worktree list` e la
  base di ogni branch da `branch.<nome>.pizzaBase`;
  `renderer/worktree-cache.js` tiene `{ path, branch, base }` per radice;
  `renderer/worktree-section.js` disegna la riga `⑂ <branch> da <base>`;
  `renderer/worktree-actions.js` fa scelta → conferma → azione di Unisci /
  Tieni il branch / Butta.
- Le schede di sessione conoscono `cwd` e `projectRoot` (`renderer/tabs.js`).
- «Ha finito»: `flagAttention()` in `renderer/signals.js` (inattività o bell),
  solo per le schede non in primo piano.
- Refit del terminale: un `ResizeObserver` su `inner` in `renderer/tabs.js`
  ridimensiona il pty a ogni cambio di misura del contenitore.

## Decisioni (prese con l'utente il 2026-10-01)

1. **Pannello sovrapposto al terminale, con una linguetta sul fianco destro**,
   in alto, testo girato e bordo arancione tenue; +N verde, −N rosso. Sul
   fianco c'è anche la barra di scorrimento del terminale (`term-scroll.js`):
   quando la linguetta c'è, la barra comincia sotto (`has-changes-tab`).
   (Una prima versione la appendeva al bordo alto: l'utente la voleva di
   lato, il 2026-10-01.)
   ```
   ┌ sidebar ┬──────────── terminale ─────────────┬─┐
   │         │ $ claude                          │5│ ← linguetta: contatore
   │         │ ● Sto modificando app.js…         │·│   dal vivo (momento 1)
   │         │                                   │+│
   │         │                                   │1│
   │         │                                   │2│
   └─────────┴───────────────────────────────────┴─┘
                 clic sulla linguetta / scorciatoia ↓
   ┌ sidebar ┬───── terminale ──────┬─ Modifiche · feat/x da main ─┐
   │         │ $ claude             │ 5 file  +120 −30         [×] │
   │         │ ● Sto modificando…   │ ▾ M renderer/app.js  +12 −3  │
   │         │                      │   @@ -10,4 +10,6 @@          │
   │         │                      │   - vecchia riga             │
   │         │                      │   + nuova riga               │
   │         │                      │ ▸ A lib/x.js         +40     │
   │         │                      │ ▸ D old.js           −20     │
   └─────────┴──────────────────────┴──────────────────────────────┘
   ```
   - **Sovrapposto, non affiancato**: il contenitore del terminale non cambia
     misura, quindi il pty non viene ridimensionato e Claude non ridisegna la
     sua interfaccia a ogni apertura/chiusura. L'utente temeva la terza
     colonna fissa; questa c'è solo quando serve.
   - **Non ruba la tastiera**: un clic sul terminale e si scrive all'agente col
     diff ancora aperto. `Esc` dentro il pannello lo chiude.
   - **File a fisarmonica**, non lista + diff affiancati (a metà schermo
     sarebbero troppo stretti). Il bordo sinistro si trascina per allargarlo,
     come la sidebar; la larghezza si ricorda (localStorage, con try/catch).
   - Scorciatoia: **⌘⇧M** / **Ctrl+Shift+M**, voce «Mostra modifiche» nel menu
     Vista. Non `Ctrl+D` (è EOF nella shell su Linux/Windows).
   - **Apribile in ogni sessione** (agenti e shell), purché la cartella sia un
     repository; altrimenti la linguetta non compare. Non sulla scheda git.
2. **Rispetto a cosa**, deciso dalla sessione:
   - cartella principale → **albero di lavoro contro `HEAD`**: staged, non
     staged e file nuovi;
   - worktree con base → **contro il punto di partenza dalla base**
     (`git merge-base <base> HEAD`, poi `git diff <quello>`): commit del
     branch **più** quello non ancora committato, cioè tutto il lavoro
     dell'agente. Nell'intestazione: `Modifiche · <branch> da <base>`;
   - worktree senza base (creato a mano, HEAD staccato) → come la cartella
     principale, contro `HEAD`.
   L'idea «da quando è partita la sessione» (sha annotato all'avvio) cade: con
   i worktree il branch contro la sua base risponde già.
3. **Aggiornamento.**
   - Linguetta e pannello: polling di `git status --porcelain=v2 -z` + numstat
     **solo per la sessione in primo piano**, ogni 3 s, fermo quando la
     finestra non è visibile (`document.hidden`). Il contenuto del diff si
     legge **solo per il file aperto**, e si rilegge quando cambiano i suoi
     contatori.
   - **Sidebar: contatore sulla riga del worktree** (`⑂ feat/x da main
     +120 −30`), **senza polling**: si aggiorna quando una sessione di quel
     worktree finisce (`flagAttention`), al ritorno della finestra in primo
     piano (come già `worktree-cache.js`) e quando il polling della sessione
     in primo piano legge quel worktree. Niente contatore sulle card, né sulle
     sessioni della cartella principale: troppe chiamate.
4. **Unisci con revisione.** «Unisci» dal menu `⋯` del worktree apre lo stesso
   pannello in modalità «stai per unire»: diff del branch contro la base e, in
   fondo, **Unisci in <base>** / **Annulla**. Prende il posto della conferma a
   fumetto di oggi (il testo su cartella principale e sessioni chiuse va in
   fondo al pannello); i passi dopo la conferma restano quelli di
   `worktree-actions.js`. Funziona anche se il worktree non ha sessioni
   aperte: il pannello è uno solo, sopra l'area dei terminali, e il suo
   contenuto è un **bersaglio** (`{ cwd, base }`), non la scheda attiva.
   Se il worktree ha modifiche non committate il pannello lo dice in cima
   (oggi è il main a rifiutare: il rifiuto resta, l'avviso arriva prima).
5. **Solo lettura.** Niente stage, scarta, commit: li fa l'agente o il
   terminale. «Scarta» è distruttivo e merita un piano suo.
6. **Un solo branch** per tutti e tre i momenti.

## Come

### `lib/git-changes.js` — puro + `runGit`

- `readChanges(cwd, { base, run })` → `{ ok, against: 'HEAD'|<sha>, baseName?,
  files: [{ path, oldPath?, status: 'M'|'A'|'D'|'R'|'?', added, removed,
  binary }], totals: { files, added, removed } }`.
  - contro `HEAD`: `git status --porcelain=v2 -z --untracked-files=all` +
    `git diff --numstat -z HEAD`;
  - con `base`: `git merge-base <base> HEAD`, poi `git diff --numstat -z
    --find-renames <sha>` + lo status per i non tracciati;
  - i file non tracciati non compaiono in numstat: le righe si contano
    leggendo il file (tetto di dimensione, oltre → «grande», niente numero);
  - repository senza commit (`HEAD` non esiste): tutto è «nuovo», niente
    errore;
  - non è un repository → `{ ok: false, reason: 'not-a-repo' }`, e la
    linguetta non compare.
- `readFileDiff(cwd, path, { against, run })`: `git diff --no-color
  --no-ext-diff <against> -- <path>`; per un file non tracciato, il contenuto
  letto e formattato come aggiunta. **Tetto**: oltre N righe il diff si tronca
  e lo dice. Binario → «file binario», niente righe.
- `parseStatus`, `parseNumstat`, `parseUnifiedDiff` puri → blocchi
  (`@@ … @@`) e righe `{ kind: 'add'|'del'|'ctx'|'note', oldNo, newNo, text }`,
  testati su fixture in `tests/fixtures/`.
- Opzioni fisse: `-c core.quotepath=off`, `--no-ext-diff`, `--no-color`,
  `--` prima dei percorsi.
- **Il percorso chiesto dal renderer va validato**: si accetta solo un
  percorso presente nell'ultimo `readChanges` per quella cartella, risolto
  dentro la radice (niente `..`, niente assoluti). Il renderer non deve poter
  far leggere un file qualsiasi. Anche `base` va validato: deve essere un
  branch esistente (`refs/heads/<base>`), mai passato a git come opzione.
- Windows: separatori `[\\/]`, `platform` come parametro, casi in
  `tests/windows.test.js` (regole di `CLAUDE.md`).

### IPC

`git-changes` e `git-file-diff` in `main.js` (solo cablaggio: c'è un test sul
tetto di righe, se lo alzi spiega il perché nel commit), metodi nel
`preload.js`. La base di un worktree la conosce già il renderer
(`worktree-cache.js`); il main la ricontrolla comunque (validazione sopra).

### Renderer

- `renderer/changes-model.js` — **UMD puro**: dato il bersaglio e l'ultima
  lettura, cosa mostrare (testo della linguetta, intestazione, stato vuoto,
  file aperti); decide quando rileggere il diff del file aperto. Testato
  senza DOM.
- `renderer/changes-view.js` — **UMD**, il pannello su `fake-dom`: linguetta,
  intestazione, fisarmonica dei file, righe del diff, modalità «stai per
  unire» con i due pulsanti, errori. Il testo dei diff è **arbitrario**: righe
  con `textContent`, **mai** `innerHTML` interpolato.
- `renderer/changes-panel.js` — script dell'app che cuce: un solo pannello
  sopra l'area dei terminali, **fuori** da `inner` (o assoluto senza
  influirne la misura: il `ResizeObserver` di `tabs.js` non deve scattare),
  polling della sessione attiva, scorciatoia dal menu, apertura da Unisci.
- `renderer/worktree-section.js`: contatore `+N −M` sulla riga, dai dati
  della cache delle modifiche (stesso schema di `worktree-cache.js`: oggetto
  nuovo a ogni cambio, `onChange` solo se cambia davvero).
- `renderer/worktree-actions.js`: per `merge`, al posto di `bubble.ask` la
  conferma arriva dal pannello (dipendenza iniettata, i test esistenti
  restano sul flusso).
- `renderer/signals.js`: `flagAttention` avvisa anche la cache delle
  modifiche (solo se la scheda sta in un worktree).
- File nuovi in `index.html` **e** in `tests/renderer-source.js`, nell'ordine
  giusto (`tests/renderer-load.test.js`). CSP: niente da cambiare, nessuno
  script inline.
- Colori: `--state-ok` / `--state-error` di `tokens.css`; stile dei controlli
  come il resto dell'app, nessun controllo nativo.

## Test

- `tests/git-changes.test.js`: status (modificati, rinominati, cancellati, non
  tracciati, nomi con spazi e accenti), numstat (binari), diff unificato (più
  blocchi, «\ No newline at end of file»), troncamento, merge-base, repository
  senza commit, **rifiuto di un percorso fuori dall'elenco o fuori dalla
  radice, e di una base che non è un branch o inizia con `-`**.
- `tests/changes-model.test.js`: testo della linguetta, quale bersaglio per
  cartella principale / worktree con base / senza base, quando rileggere.
- `tests/changes-view.test.js` su `fake-dom`: fisarmonica, stato vuoto,
  modalità Unisci, un diff con `<script>` nel testo resta testo.
- `tests/worktree-actions.test.js`: Unisci passa dalla conferma del pannello;
  Annulla non tocca niente.
- Caso con git vero in `tests/integration.test.js` (`t.skip` senza git): repo
  temporaneo, una modifica, un file nuovo, un rename; worktree con commit +
  modifica non committata contro la base.
- `npm run test:unit` verde.

## Commit previsti

1. `docs:` questo piano (+ riga nel README dei piani, spunte in idee.md)
2. `feat:` `lib/git-changes.js` + test
3. `feat:` IPC + pannello con linguetta (momenti 1 e 2)
4. `feat:` contatore sulla riga del worktree
5. `feat:` Unisci passa dal pannello (momento 3)

Eventuali spostamenti di codice esistente in commit `refactor:` separati.

## Vincoli operativi

- **Niente `npm start`**: l'app installata è aperta e condivide socket tmux
  (`aisession`) e cartella dati. Lo smoke test lo fa l'utente; a fine lavoro
  dargli la lista di cosa provare: repo con modifiche, file nuovo, rename,
  binario, diff enorme, repo pulito, cartella che non è un repository,
  worktree con commit + modifiche, Unisci → Annulla, Unisci → conferma,
  pannello aperto mentre l'agente scrive (il terminale non si ridimensiona).
- Chiedere all'utente prima di pushare e aprire la PR.

## Fuori

- Azioni sul diff (stage, scarta, commit).
- Evidenziazione della sintassi e vista affiancata (side-by-side).
- «Chiedi all'agente» da una riga del diff.
- Diff di un commit della timeline (clic su un commit): annotato nel piano 25,
  userebbe `readFileDiff` con un intervallo di commit.
- Contatori su tutte le card e sulle sessioni della cartella principale.

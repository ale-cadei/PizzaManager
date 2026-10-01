# 36 — Sessione in un git worktree

Branch: `feat/sessione-worktree` · Dipende da: 8, 25, 27 · Taglia: ~1½ g
Scritto il 2026-10-01, dopo lo studio fatto con l'utente (decisioni sotto).

## Obiettivo

Due agenti sullo stesso repository oggi lavorano nella stessa cartella: si
pestano i file, e un `git switch` dell'uno cambia i file sotto i piedi
all'altro. Con un **worktree** ogni agente ha la sua cartella e il suo branch,
sullo stesso repository (stessa storia, commit visibili subito ovunque).

L'app crea il worktree dal gruppo del progetto, ci apre la sessione, lo mostra
nella sidebar sotto il progetto e, a lavoro finito, lo **unisce**, lo **tiene
come branch** per una PR, oppure lo **butta**.

È l'idea «Ogni agente nel suo git worktree» di [idee.md](idee.md), sezione
«Agenti in parallelo».

## Cosa c'è già (non rifarlo)

- `lib/git-run.js` (`runGit`): git con `execFile`, niente shell,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`. **Tutte le
  chiamate a git di questo piano passano da lì.**
- `lib/git-branches.js`: `validateBranchName`, `deleteBranch` con la logica a
  doppia conferma (`-d`, poi `-D` se `notMerged`), `gitMessage`. Modello per
  le funzioni nuove: `run` iniettabile, test senza git.
- `app/git.js`: dove si registrano gli IPC git (non in `main.js`).
- `lib/project-root.js` (`findProjectRoot`): riconosce già `.git` come file,
  ma un worktree diventa **un progetto a sé** (vedi passo 1).
- `renderer/session-groups.js` (`groupByProject`) e `renderer/sidebar.js`:
  gruppi per progetto con «+» (`createAddButton`) e «⟲»
  (`createResumeButton`) nell'intestazione.
- `renderer/new-session.js` (`openNewModal({ cwd })`): il modale nuova
  sessione con la directory precompilata.
- `app/pty.js` (`terminate`) per chiudere le sessioni tmux di un worktree.
- `claude --worktree` e `codex --worktree` esistono, ma **non si usano**: solo
  due tipi su sei, l'app non saprebbe il percorso (titolo automatico e Resume
  riconoscono la conversazione dalla directory) e la pulizia la deciderebbe
  l'agente.

## Decisioni (prese con l'utente il 2026-10-01)

1. **Chi crea il worktree: l'app**, con `git worktree add`, per ogni tipo di
   sessione (anche shell e opencode).
2. **Dove:** accanto al progetto, in una cartella per progetto che raccoglie
   tutti i suoi worktree:
   ```
   Digitiamo/
   ├── PizzaManager/
   └── PizzaManager.worktrees/
       ├── feat-scorciatoie/
       └── chore-icona-mac/
   ```
   Fuori dal repository: `git status` pulito, nessuna ricerca che trova tutto
   due volte. Una sola voce in più nella cartella genitore, tolta quando
   l'ultimo worktree se ne va. Il nome della cartella è il branch con `/` → `-`
   (`feat/login` e `fix/login` non collidono). Se esiste già, errore nel
   modale: mai sovrascrivere né inventare un altro nome.
3. **Da dove parte:** dal branch corrente della cartella principale,
   preselezionato nel modale e cambiabile (`main`/branch di default sempre
   fra le prime voci). HEAD staccato → si parte dal commit e il modale mostra
   l'hash. Merge o rebase in corso nella cartella principale → rifiuto con
   messaggio. Modifiche non committate nella cartella principale → avviso
   («N file modificati non saranno nel worktree»), nessun trasferimento.
4. **File ignorati da git:**
   - `node_modules` del progetto, se esiste → **symlink** nel worktree
     (su Windows `junction`, che non chiede privilegi di amministratore);
   - quello che elenca `.worktreeinclude` nella radice (sintassi `.gitignore`,
     stessa convenzione di Claude Code) → **copiato**. Senza il file non si
     copia niente: l'app non decide da sola di duplicare file che possono
     contenere segreti.
   Il rischio noto del symlink (un `npm install` nel worktree tocca le
   dipendenze del progetto) si accetta: se una feature cambia le dipendenze,
   l'agente toglie il symlink e installa.
5. **Fine lavoro**, dal menu `⋯` della riga del worktree:

   | Azione | Cartella | Branch | Merge |
   |---|---|---|---|
   | **Unisci** | cancellata | cancellato (`-d`) | sì, solo se va liscio |
   | **Tieni il branch** | cancellata | resta, per la PR | no |
   | **Butta** | cancellata | cancellato (`-D`) | no |

   La ✕ di una card chiude **solo la sessione**: il worktree resta.
6. **Unisci prudente.** Si fa nella cartella principale, solo se:
   - è sul branch base del worktree e non ha modifiche ai file tracciati;
   - il worktree non ha modifiche non committate (non finirebbero nel merge).
   Altrimenti l'app spiega cosa manca e non tocca niente. `git merge --no-edit
   <branch>` (fast-forward quando possibile, come di default in git). Se git
   trova conflitti → `git merge --abort` subito, cartella principale com'era, e
   il messaggio: «conflitti con <base>: allinea il branch nel worktree» (lì
   l'agente fa `git merge <base>` e li risolve). Niente interfaccia per i
   conflitti.
7. **Memoria della base:** `git config branch.<nome>.pizzaBase <base>`, nella
   config del repository. Resta dentro git, nessun file dell'app; `git branch
   -d/-D` toglie la sezione da solo. Un worktree senza `pizzaBase` (creato a
   mano o con HEAD staccato) non offre «Unisci»: il menu lo dice e propone
   «Tieni il branch».
8. **Sidebar, modalità progetto:** ogni worktree è una **sotto-sezione** del
   gruppo del suo progetto, sotto le sessioni della cartella principale:
   ```
   📁 PizzaManager                      3   [+] [⟲] [⑂]
      ◆ Claude · quota per profilo
      ▸ Terminale
      ─────────────────────────────
      ⑂ feat/scorciatoie   da main         [+] [⋯]
         ▸ Claude · scorciatoie ⌘T
      ⑂ chore/icona-mac    da main         [+] [⋯]
         (nessuna sessione)
   ```
   `[⑂]` = «Crea worktree». `[+]` della riga = nuova sessione in quel worktree.
   Un worktree senza sessioni resta visibile: è il posto da cui si butta, e
   l'antidoto all'«intasamento» di cartelle dimenticate.
   **Modalità per tipo:** niente sotto-sezioni; la card aggiunge
   `⑂ <branch>` nella riga sotto il nome. Creare e chiudere worktree si fa solo
   in modalità progetto.
9. **Elenco = git.** I worktree si leggono da `git worktree list --porcelain`:
   nessun registro dell'app, compaiono anche quelli creati a mano. Il worktree
   principale si salta; quelli `prunable` (cartella cancellata a mano) non si
   mostrano, e `git worktree prune` si lancia prima di creare o rimuovere (la
   lettura resta senza scritture).

## Passi

Commit separati, in quest'ordine. Il passo 1 cambia un comportamento
esistente: commit `feat:` suo, così se qualcosa si rompe si sa dove.

### 1. Un worktree appartiene al progetto principale ✅ fatto

Emerso strada facendo: anche la **scheda git** va riportata al progetto
principale. Prende la radice da `git rev-parse --show-toplevel`
(`lib/git-graph.js`), che in un worktree risponde con il worktree: passa
anch'essa da `mainWorktreeRoot`. Caso con git vero in
`tests/integration.test.js`.

`findProjectRoot`: se `.git` è un **file**, leggere `gitdir: <percorso>`; se
in quella directory c'è `commondir`, la radice è la cartella che contiene la
directory comune (`<gitdir>/<commondir>`, di norma `…/repo/.git` →
`…/repo`). Un submodule punta a `.git/modules/<x>` senza `commondir`: resta
un progetto a sé. Qualsiasi errore di lettura → si torna al comportamento di
oggi (la cartella con il `.git` file).

`readFile` iniettabile come `exists`, `pathImpl` per Windows. Test in
`tests/project-root.test.js`: worktree → radice principale; submodule →
sé stesso; `gitdir` relativo; file `.git` malformato; caso `path.win32`.

Effetti da verificare: i worktree fatti a mano (`../PizzaManager-<tema>`)
finiscono nel gruppo PizzaManager; filtro progetto del Resume
(`renderer/resume-projects.js`), nome nella barra (`usage-bar.js`) e
pannello estensioni (`extensions-panel.js`) usano la radice principale.

### 2. `lib/worktree.js` — la logica, senza Electron ✅ fatto

Divisa in due file: `lib/worktree.js` (git) e `lib/worktree-files.js`
(symlink e copie). Emerso strada facendo, tutto dal test con git vero:
- **il symlink `node_modules` non è ignorato** da un `.gitignore` con
  `node_modules/` (la barra vale solo per le cartelle): il worktree sembrava
  sempre «con modifiche» e un `git add -A` lo avrebbe committato. Se
  `check-ignore` dice che non è ignorato, si aggiunge `/node_modules` a
  `info/exclude` (locale, condiviso dai worktree, mai committato);
- **`.worktreeinclude` copia solo i file ignorati da git**, come Claude Code:
  un file tracciabile copiato renderebbe il worktree mai pulito. «Ignorato» si
  chiede nel worktree, dove deve risultare pulito;
- `check-ignore -z` vale solo con `--stdin`: si legge per righe con
  `core.quotePath=false`;
- `worktree add --no-track`: da una base remota il branch non la segue.

Tutto con `run` iniettabile (default `runGit`) e `fs`/`path` iniettabili dove
servono, come `lib/git-branches.js`.

- `worktreeDirFor(root, branch, { pathImpl })` → `<genitore>/<nome>.worktrees/<branch con / → ->`.
- `parseWorktreeList(text)` → `[{ path, head, branch, detached, prunable, locked }]`
  dall'output `--porcelain` (blocchi separati da riga vuota).
- `listWorktrees({ root })` → elenco senza il principale né i `prunable`,
  con `base` letta da `git config --get-regexp '^branch\..*\.pizzaBase$'`
  (una sola chiamata per tutto l'elenco).
- `worktreeStart({ root })` → per il modale: branch corrente o hash, numero di
  file modificati (`git status --porcelain=v2 -z`), merge/rebase in corso
  (`git rev-parse --git-path MERGE_HEAD` / `rebase-merge` / `rebase-apply`
  esistono?), elenco dei branch locali per il menu «parte da».
- `createWorktree({ root, branch, base })`: valida il nome
  (`validateBranchName` + `check-ref-format`), rifiuta cartella esistente,
  `worktree prune`, `worktree add -b <branch> <dir> <base>`,
  `config branch.<branch>.pizzaBase <base>` (solo se la base è un branch),
  poi `linkIgnored`. Se un passo dopo `add` fallisce, il worktree resta e
  l'errore lo dice (meglio un worktree senza `node_modules` che uno sparito).
- `linkIgnored({ root, dir })`: symlink (`junction` su Windows) di
  `node_modules` se esiste e non è già nel worktree; se c'è
  `.worktreeinclude`, l'elenco da copiare lo dà git stesso, senza
  reimplementare `.gitignore`:
  `git ls-files --others --ignored --exclude-from=.worktreeinclude -z`
  (esclusi `node_modules/`). Copia con i permessi originali: un `.env` a
  `0600` resta `0600` (verificarlo nel test).
- `mergeWorktree({ root, path, branch })`: i controlli della decisione 6,
  poi merge / abort. Risultato `{ ok, conflict?, error? }`.
- `removeWorktree({ root, path, branch, deleteBranch: 'none'|'merged'|'force', force })`:
  `worktree remove [--force]`, poi `branch -d|-D` se richiesto, poi
  `rmdir` della cartella `.worktrees` se vuota. Senza `force` e con
  modifiche, git rifiuta: si restituisce `{ ok: false, dirty: true }` per la
  seconda conferma (come `notMerged` di `deleteBranch`).

### 3. IPC ✅ fatto

Provato con un finto `ipcMain` in `tests/git-ipc.test.js`: i canali ci sono,
ogni canale `git-*`/`worktree-*` del preload ha il suo handler, un payload
vuoto risponde con un errore.

In `app/git.js`, stessa `guard`: `worktree-list`, `worktree-start`,
`worktree-create`, `worktree-merge`, `worktree-remove`. In `preload.js` le
funzioni corrispondenti. `main.js` non cambia.

Prima di `worktree-merge` / `worktree-remove` le sessioni aperte nella
cartella vanno chiuse: lo fa il renderer (che le conosce) con il `terminate`
esistente, dopo la conferma «N sessioni aperte verranno terminate». Un
processo con la cartella cancellata sotto i piedi è peggio di una conferma in
più.

### 4. Gruppi con sotto-sezioni ✅ fatto (la funzione; il collegamento nel 5)

`groupSessions` con `worktrees` è pronta e testata, ma la sidebar non gliela
passa ancora: le sessioni dei worktree uscirebbero da `items` e sparirebbero
finché il passo 5 non disegna le sotto-sezioni. Cache e collegamento entrano
nel commit del passo 5, così ogni commit lascia l'app usabile.

Limite noto, accettato: un worktree si vede solo se il suo progetto ha un
gruppo nella sidebar, cioè almeno una sessione aperta (nella cartella
principale o in un worktree). Chiusa l'ultima, i worktree restano su disco e
ricompaiono alla prossima sessione nel progetto.

`renderer/session-groups.js`: `groupSessions(sessions, { mode: 'project',
worktrees })` dove `worktrees` è `{ [root]: [{ path, branch, base }] }`. Ogni
gruppo progetto riceve `worktrees: [{ path, branch, base, items }]`; una
sessione va nel worktree se la sua `cwd` è il percorso del worktree o ci sta
dentro (stesso controllo col separatore di `relativeSubpath`), altrimenti
resta in `items` del progetto. Funzione pura, test in
`tests/session-groups.test.js`. Modalità per tipo: invariata.

Da dove arrivano i `worktrees`: il renderer chiede `worktree-list` per ogni
radice di progetto visibile e lo tiene in una cache (come
`projectRootCache` in `renderer/tabs.js`), rinfrescata dopo
crea/unisci/tieni/butta e quando la finestra torna in primo piano. Un worktree
toccato fuori dall'app si vede al rientro, non in tempo reale: va bene.

### 5. Sidebar ✅ fatto (il [⑂] si accende col modale, passo 6)

Com'è venuto, in sei commit:
- il fumetto di conferma (`confirm-bubble.js`) ha `ask` con titolo, testo e
  pulsante propri, e `choose` per il menu ⋯ (azioni in colonna, quelle non
  disponibili spente col perché nel tooltip);
- `renderer/worktree-section.js` costruisce la riga e il contenitore (tutto
  `textContent`: git ammette `<` nei nomi dei branch); `sidebar.js` ci mette
  le card e conta nel gruppo anche quelle dei worktree;
- `renderer/worktree-cache.js`: ultimo elenco per radice, ridisegno solo se
  cambia, richiesta al rientro in primo piano;
- `renderer/worktree-actions.js`: il flusso del ⋯. **Le sessioni del worktree
  si chiudono dopo** che la cartella se n'è andata, non prima: un Unisci
  rifiutato o un conflitto non costano gli agenti al lavoro. Se la rimozione
  fallisce con sessioni aperte (Windows: un processo blocca la cartella) si
  chiudono e si riprova una volta;
- `renderer/worktrees.js` collega cache e azioni a `tabs`, `window.aisess` e
  `closeConfirm`; `findAnchor` ritrova il ⋯ dopo un render (`worktree:<path>`).
- Una cartella senza git ora non ha worktree invece di dare errore a ogni
  rientro; se Unisci fa il merge ma la cartella resta, lo dice (`merged`).

Il [⑂] della linguetta c'è nella sidebar ma compare solo quando il renderer
passa `onNewWorktree`, cioè col modale del passo 6.

`renderer/sidebar.js`:
- `[⑂]` nell'intestazione dei gruppi progetto con radice (stessa regola di
  «+» e «⟲»: non su «Senza directory»), callback `onNewWorktree(root)`;
- sotto le card del progetto, una riga per worktree: `⑂ <branch>`,
  `da <base>`, `[+]` (`onNewInWorktree(path)` → `openNewModal({ cwd: path })`),
  `[⋯]` con Unisci / Tieni il branch / Butta (Unisci disabilitato con il
  motivo se manca `base`); sotto, le sue card o «(nessuna sessione)»;
- modalità per tipo: `⑂ <branch>` aggiunto alla riga sotto il nome della card.
  Il branch la scheda lo prende dal match `cwd` ↔ elenco worktree, non da un
  campo nuovo su tmux.

Le conferme usano il fumetto esistente (`renderer/confirm-bubble.js`), non
`confirm()`. Butta con modifiche o branch non unito: **una** conferma che
elenca entrambe le cose, non due di fila.

Drag & drop delle card: una card **non** si trascina fra il progetto e un
worktree (la `cwd` non cambia trascinando). Test in un
`tests/sidebar-worktree.test.js` con `tests/fake-dom.js`.

### 6. Modale «Crea worktree» ✅ fatto

Cambiato rispetto a sotto: niente card del tipo dentro questo modale. «Crea e
apri una sessione» crea il worktree e apre il modale **«Nuova sessione»** già
impostato sulla sua cartella: stesse card, account Claude e profili, senza
copiarne il codice. «Crea soltanto» è il caso «Nessuna». La parte pura
(voci di «Parte da», avvisi, blocchi, anteprima della cartella) è
`renderer/worktree-form.js`; la colla `renderer/worktree-modal.js`. Gli
avvisi di creazione (node_modules non collegato, file non copiati) escono in
un fumetto dalla riga del worktree appena comparsa.

Nuovo modale in `renderer/index.html` (nessuno script inline: CSP) e un
`renderer/worktree-modal.js` (caricato prima di `renderer.js`; aggiornare
l'ordine verificato da `tests/renderer-load.test.js`):
- **Nome del branch** (validato subito con le stesse regole);
- **Parte da**: menu con il branch corrente preselezionato e il default fra
  le prime voci;
- **Tipo di sessione**: le stesse card del modale nuova sessione (riusare,
  non copiare), più «Nessuna» per creare solo il worktree;
- avvisi di `worktree-start` (file modificati; merge/rebase in corso →
  pulsante disabilitato);
- percorso finale mostrato in piccolo (`PizzaManager.worktrees/feat-x`).

Crea → `worktree-create` → `createTab(tipo, { cwd: path })`.

### 7. Resume dopo che il worktree non c'è più

Le conversazioni restano nella cronologia con la `cwd` del worktree. Nel
Resume: se la `cwd` non esiste più ed è dentro una cartella `.worktrees`,
riga con «worktree eliminato» e apertura nella **radice del progetto** (lì il
codice ormai è unito, o il branch esiste ancora). Senza questo il pty partiva
nella home (`resolveWorkdir`).

**Claude: verificato a mano (2026-10-01).** Conversazione nata in
`progetto.worktrees/feat-prova`, poi `claude --resume <id>` lanciato da
`progetto/`: con il worktree ancora presente ritrova tutta la chat; con il
worktree già rimosso (`git worktree remove`) la ritrova lo stesso e la riapre
nella cartella principale. Quindi per Claude basta cambiare la `cwd` di
apertura, nessun avviso «non riprendibile».

Codex e opencode non sono verificati: provarli allo stesso modo durante
l'implementazione (Codex salva le conversazioni per data, non per directory,
e dovrebbe comportarsi uguale; opencode le lega al progetto). Se uno dei due
non la ritrova, per quel tipo la riga lo dice invece di promettere.

## Test

- Unitari con `run` finto: `tests/worktree.test.js` (porcelain, nome della
  cartella, argomenti passati a git per crea/unisci/butta, rifiuti).
- `tests/project-root.test.js`, `tests/session-groups.test.js`,
  `tests/sidebar-worktree.test.js` come sopra.
- Integrazione con git vero in `tests/integration.test.js` (repo in tmpdir,
  `t.skip` se git manca): crea → commit nel worktree → unisci; unisci con
  conflitto → la cartella principale torna pulita (`git status` vuoto, nessun
  `MERGE_HEAD`); butta con file non committato → `dirty`, poi con `force`;
  `node_modules` symlink e, dopo la rimozione, `node_modules` del progetto
  intatto; `.worktreeinclude` con un `.env` a `0600`.
- `tests/windows.test.js`: `worktreeDirFor` e `findProjectRoot` con
  `path.win32`.

## Vincoli operativi

- **Niente `npm start`**: l'app installata è aperta e condivide socket tmux
  (`aisession`) e cartella dati. Lo smoke test lo fa l'utente.
- Lavorare in un worktree accanto se l'utente sta usando la cartella
  principale (`git worktree add -b feat/sessione-worktree
  ../PizzaManager-worktree origin/main`, `node_modules` in symlink).
- Chiedere prima di pushare e aprire la PR.

Da far provare all'utente: crea da `main` e da un altro branch; crea con file
modificati nella cartella principale (avviso); nome già esistente; due agenti
in due worktree che committano; unisci liscio; unisci con conflitto (la
cartella principale resta pulita); tieni il branch e apri la PR; butta con
lavoro non committato; worktree creato a mano che compare nel gruppo;
cartella cancellata dal Finder che sparisce; Resume di una conversazione di
un worktree buttato; ⌘Q e riapertura con sessioni nei worktree.

## Fuori

- Risoluzione dei conflitti nell'app.
- PR da dentro l'app (`gh pr create`): «Tieni il branch» si ferma al branch.
- Allineare il worktree alla base con un pulsante (`git merge <base>` nel
  worktree): lo fa l'agente o l'utente.
- `node_modules` separato per worktree (`npm install` automatico).
- Pannello modifiche (piano 32) su un worktree: diff del branch contro
  `pizzaBase`. Annotato nel piano 32, si fa lì.
- Aggiornamento dal vivo dell'elenco (watcher su `.git/worktrees`).

# 32 — Pannello «cosa ha cambiato»

Branch: `feat/pannello-modifiche` · Dipende da: 25, 27, 31 · Taglia: ~1 g
Stato: **bozza da cui partire**. Scritta il 2026-09-28 fuori da un branch:
chi la riprende crea il branch da `main`, verifica che il numero 32 sia
ancora libero in `docs/plans/README.md`, completa le decisioni aperte con
l'utente e committa questo file come primo commit `docs:`.

## Obiettivo

Quando un agente dice «fatto», la domanda è sempre la stessa: **che cosa ha
toccato?** Oggi per saperlo si apre una shell e si lancia `git status` /
`git diff`. Il pannello lo mostra dentro l'app: file modificati, righe +/−,
e cliccando un file il suo diff, aggiornato mentre l'agente lavora.

È l'idea «Pannello "cosa ha cambiato"» di [idee.md](idee.md), sezione
«Agenti in parallelo».

## Cosa c'è già (non rifarlo)

La **scheda git** esiste (piani 25, 27, 31):
- `renderer/git-tab.js`: scheda senza pty, pannello con timeline e mappa dei
  branch; si aggiorna tornando in primo piano e dal pulsante «Aggiorna».
- `renderer/git-graph-view.js`: selettore **Timeline / Mappa**;
  `renderer/git-map-view.js`, `renderer/git-branch-picker.js`.
- `lib/git-run.js` (`runGit`): git lanciato con `execFile`, niente shell,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (leggere non deve mai
  bloccare né prendere lock sul repository dell'utente). **Tutte le letture
  di questo piano passano da lì.**
- `lib/git-graph.js`: modello di un lettore con `run` iniettabile e parsing
  puro testato senza git (`tests/git-graph.test.js`); caso con git vero in
  `tests/integration.test.js`.
- IPC `git-graph`, `git-branches`, `git-switch`… in `main.js` / `preload.js`.
- Le schede di sessione (agenti, shell) conoscono `cwd` e `projectRoot`
  (`renderer/tabs.js`, `resolveProjectRoot`).

## Decisioni aperte — da chiedere all'utente (con raccomandazione)

1. **Dove sta il pannello.** L'utente teme di dividere troppo lo schermo
   (sidebar + terminale + pannello = tre colonne; lo ha detto per le
   «sessioni affiancate»).
   - **A (consigliata): terza vista della scheda git**, «Modifiche», accanto
     a Timeline e Mappa, più un pulsante sulla card di una sessione agente
     («vedi modifiche») che apre o porta in primo piano la scheda git del
     suo progetto già sulla vista Modifiche. Zero spazio rubato al
     terminale, riusa tutta l'infrastruttura della scheda git.
   - B: pannello a scomparsa a destra del terminale della sessione, con una
     scorciatoia. Più immediato mentre l'agente lavora, ma è la terza
     colonna.
2. **Rispetto a cosa.**
   - **Consigliata: albero di lavoro contro `HEAD`**, cioè quello che non è
     ancora committato (staged + non staged + file nuovi). È il «cosa ha
     toccato» del caso tipico.
   - In più, se costa poco: **«da quando è partita la sessione»**, cioè il
     diff contro il commit che era `HEAD` all'avvio della sessione (così si
     vedono anche i commit fatti dall'agente). Richiede di annotare lo sha
     all'avvio: sulla scheda, e sulla sessione tmux (`@ais_*`) per
     sopravvivere a un riavvio dell'app.
   - Con i worktree (idea futura): branch contro `main`.
3. **Aggiornamento dal vivo.**
   - **Consigliato: polling di `git status` solo mentre la vista è
     visibile** (ogni 2–3 s, `--porcelain=v2 -z`, economico), più
     l'aggiornamento esistente al ritorno in primo piano. Il contenuto del
     diff si legge solo per il file aperto.
   - Alternativa: `fs.watch` sul repository (il piano 25 annotava un watcher
     su `.git/refs` e `.git/HEAD`). Ricorsivo non è affidabile su Linux, e
     `node_modules` genera rumore: il polling è più semplice e prevedibile.
4. **Solo lettura o anche azioni** (stage, scarta, commit).
   **Consigliato: solo lettura** in questo branch. «Scarta» è distruttivo e
   merita un piano suo con le sue conferme.

## Come (con le scelte consigliate)

### `lib/git-changes.js` — puro + `runGit`

- `readChanges(cwd, { run })`: `git status --porcelain=v2 -z
  --untracked-files=all` + `git diff --numstat -z HEAD` → elenco
  `{ path, oldPath?, status: 'M'|'A'|'D'|'R'|'?', added, removed, binary }`.
  I file nuovi non tracciati non compaiono in `--numstat`: le righe si
  contano leggendo il file (con tetto di dimensione).
- `readFileDiff(cwd, path, { run })`: `git diff --no-color --no-ext-diff
  HEAD -- <path>` (per un file nuovo: `--no-index /dev/null <path>`, o il
  contenuto letto e formattato come aggiunta). Tetto di dimensione:
  un diff enorme si tronca e lo dice.
- `parseStatus`, `parseNumstat`, `parseUnifiedDiff` puri → blocchi
  (`@@ … @@`) e righe `{ kind: 'add'|'del'|'ctx', oldNo, newNo, text }`,
  testati su fixture in `tests/fixtures/`.
- Opzioni fisse: `-c core.quotepath=off` (nomi con accenti leggibili),
  `--no-ext-diff`, `--no-color`, `--` prima dei percorsi.
- **Il percorso chiesto dal renderer va validato**: si accetta solo un
  percorso presente nell'ultimo elenco di `readChanges` per quel repository,
  risolto dentro la radice (niente `..`, niente assoluti). Il renderer non
  deve poter far leggere un file qualsiasi.
- Windows: separatori `[\\/]`, `platform` come parametro, casi provati in
  `tests/windows.test.js` (regole di `CLAUDE.md`).

### IPC

`git-changes` e `git-file-diff` in `main.js` (solo cablaggio: c'è un test sul
tetto di righe, se lo alzi spiega il perché nel commit), metodi nel
`preload.js`.

### Renderer

- `renderer/git-changes-view.js`, **modulo UMD testabile** come
  `sidebar.js` / `search-results.js`: lista file (icona di stato, percorso
  relativo, `+N −M` colorati), clic → diff del file sotto o accanto, stato
  vuoto «Nessuna modifica rispetto all'ultimo commit», errori.
- Il testo dei diff è **arbitrario**: righe costruite con `textContent`,
  **mai** `innerHTML` interpolato (regola di sicurezza di `CLAUDE.md`).
- Terza voce nel selettore di `git-graph-view.js`; il polling si ferma
  quando la vista o la scheda non sono visibili.
- Pulsante sulla card (se scelta A): passa da una callback in
  `renderer/sidebar.js` (modello `onRename` / `onClose`) a
  `session-list.js`, che trova o crea la scheda git del `projectRoot`.
- Il renderer è diviso in script classici che condividono lo scope: un file
  nuovo va in `index.html` **e** in `tests/renderer-source.js`, nell'ordine
  giusto (`tests/renderer-load.test.js` lo verifica).
- Colori: `--state-ok` / `--state-error` di `tokens.css` per aggiunte e
  rimozioni, come il resto dell'app.

## Test

- `tests/git-changes.test.js`: parsing di status (modificati, rinominati,
  cancellati, non tracciati, nomi con spazi e accenti), numstat (binari),
  diff unificato (più blocchi, «\ No newline at end of file»), troncamento,
  **rifiuto di un percorso fuori dall'elenco o fuori dalla radice**.
- Vista su DOM finto (`tests/fake-dom.js`): lista, selezione, stato vuoto, e
  che un diff con `<script>` nel testo resti testo.
- Caso con git vero in `tests/integration.test.js` (`t.skip` senza git):
  repo temporaneo, una modifica, un file nuovo, un rename → elenco e diff.
- `npm run test:unit` verde.

## Commit previsti

1. `docs:` questo piano (+ riga nel README dei piani, spunte in idee.md)
2. `feat:` `lib/git-changes.js` + test
3. `feat:` IPC + vista Modifiche nella scheda git
4. `feat:` pulsante «vedi modifiche» sulla card (se scelta A)

Eventuali spostamenti di codice esistente in commit `refactor:` separati.

## Vincoli operativi

- **Niente `npm start`**: l'app installata è aperta e condivide socket tmux
  (`aisession`) e cartella dati. Lo smoke test lo fa l'utente; a fine lavoro
  dargli la lista di cosa provare (repo con modifiche, file nuovo, rename,
  binario, diff enorme, repo pulito, directory che non è un repository).
- Se l'utente sta lavorando nella cartella principale, lavorare in un
  worktree accanto (`git worktree add -b feat/pannello-modifiche
  ../PizzaManager-modifiche origin/main`, `node_modules` in symlink).
- Chiedere all'utente prima di pushare e aprire la PR.

## Fuori

- Azioni sul diff (stage, scarta, commit).
- Evidenziazione della sintassi e vista affiancata (side-by-side).
- Diff di un commit della timeline (clic su un commit): annotato nel piano 25,
  userebbe `readFileDiff` con un intervallo di commit.
- Worktree per agente (idea separata in idee.md): quando arriverà, il
  pannello mostrerà il branch contro `main`.

# 69 — `feat/conflicts`: vedere e risolvere i conflitti git dall'app

Dipende da: 53 (commit dal pannello), 54 (unisci un branch), 36 (Unisci dei
worktree), 60-64 (sessione editor, apri da modifiche). Taglia: ~3-4 giorni.
Passi di implementazione, test e codice: `69-conflitti-tasks.md`.

## Perché

Oggi un conflitto è un vicolo cieco. «Unisci» (piani 36 e 54) fa
`merge --abort` subito ed elenca i file; un merge o un rebase fermato da
terminale o da un agente spegne il pannello delle modifiche («finiscilo o
annullalo dal terminale», `BUSY` in `lib/git-commit.js`). Il piano 54 lo
metteva fuori apposta; qui si fa.

## Cosa fa (perimetro)

Scelte dall'utente (2026-10-28):

- **Qualsiasi operazione a metà**, chiunque l'abbia avviata (terminale,
  agente, «Unisci»): merge, rebase, cherry-pick, revert.
- **Risoluzione per blocco nell'editor**, più modifica a mano libera.
- **«Unisci» chiede**: al conflitto non annulla più da sé.
- **Niente agente** in questo branch (annotato in `idee.md`).

### Il pannello in modalità «Conflitti»

Con un'operazione a metà il pannello delle modifiche (linguetta, piano 32/68)
non si spegne più: passa da sé alla modalità «Conflitti», al posto di quella
di staging.

```
┌─ Merge di feat/x in main, a metà ─────────────────────┐
│ In conflitto (2)                                      │
│ lib/a.js        entrambi modificati · 3 blocchi  [✎] [✓ Risolto] │
│ img/logo.png    binario         [Tieni nostro] [Tieni loro]     │
│ lib/old.js      cancellato da loro [Tieni il file] [Eliminalo]   │
│ Risolti (1)                                           │
│ README.md       (diff come in staging)                │
│                                                       │
│ [Concludi merge]                    [Annulla merge]   │
└───────────────────────────────────────────────────────┘
```

- **Testata**: cosa è a metà e fra cosa. «Merge di `feat/x` in `main`»,
  «Rebase di `feat/x` su `main`, passo 3 di 7 (`abc1234` messaggio)»,
  «Cherry-pick di `abc1234`», «Revert di `abc1234`».
- **File in conflitto**, col tipo letto da git:
  - *testo, modificato da entrambi / aggiunto da entrambi*: «Apri
    nell'editor» (piano 64, cursore al primo blocco) e il numero di blocchi
    rimasti; «Segna risolto» = `git add`, rifiutato se nel file restano
    marcatori (`<<<<<<<`, `=======`, `>>>>>>>` a inizio riga).
  - *cancellato da una parte*: «Tieni il file» (`add`) / «Eliminalo» (`rm`).
  - *binario*: «Tieni nostro» / «Tieni loro» (`checkout --ours|--theirs`
    e poi `add`).
- **Risolti**: i file già in staging, col diff di sempre.
- **Piè di pagina**:
  - «Concludi merge» (`commit --no-edit`, messaggio preparato da git) /
    «Continua rebase» / «Continua cherry-pick» / «Continua revert»
    (`<op> --continue`, `GIT_EDITOR=true`: il messaggio resta quello di git).
    Acceso solo a zero file in conflitto. Hook come da terminale, tempo
    massimo come il commit (53).
  - «Annulla merge/rebase/…» (`<op> --abort`), con conferma (bolla,
    `confirm-bubble.js`): butta il lavoro di risoluzione.
  - Un rebase che si ferma di nuovo al passo dopo: il pannello si rilegge
    sul passo nuovo. Finito tutto torna in modalità staging.
- **Nostro e loro** si chiamano col nome: in un merge «nostro» è il branch
  corrente e «loro» quello che entra; in un rebase git li inverte («nostro»
  è la base su cui si riapplica, «loro» il commit tuo che si sta
  riapplicando). Le etichette lo dicono coi nomi dei branch, mai solo
  «ours/theirs».
- **Stato cambiato da fuori** (l'utente conclude dal terminale): il pannello
  rilegge e torna a staging; un'azione partita sul vecchio stato si rifiuta
  (vedi «Quando no»).

### Nell'editor

Un file con marcatori di conflitto, aperto in una scheda editor:

- le righe di «nostro» e di «loro» colorate in modo diverso (marks
  dell'host Monaco, `editor-monaco.js`);
- sopra ogni blocco una zona (`addZone`) con «Tieni nostro · Tieni loro ·
  Tieni entrambi»; la scelta sostituisce il blocco con un'operazione di
  modifica del modello (`pushEditOperations`): Ctrl+Z la annulla;
- i blocchi si ricalcolano a ogni modifica: chi scrive a mano vede sparire
  i pulsanti del blocco che ha sistemato;
- formato `diff3`/`zdiff3` (`|||||||` base) riconosciuto: la base si mostra
  ma non si offre come scelta.
- Salvare resta quello di sempre; «Segna risolto» sta nel pannello.

### «Unisci» al conflitto

Branch (54) e worktree (36): il merge resta a metà. Al posto dell'errore
un avviso con i file in conflitto e due pulsanti: «Risolvi» (apre il
pannello in modalità Conflitti) e «Annulla merge» (`merge --abort`, la
cartella torna com'era: il comportamento di oggi). Su un errore che non è un
conflitto (hook che fallisce, tempo scaduto) resta l'abort automatico.
Per un worktree, dopo «Concludi merge» la rimozione del worktree non parte
da sola: il worktree resta e si butta col suo pulsante.

## Quando no (rifiutato prima di cominciare, col motivo)

- `continue`/`abort` con un'operazione diversa da quella che il pannello ha
  mostrato (`op` passato dal renderer confrontato con `busyWith`): il
  pannello era vecchio.
- `continue` con file ancora in conflitto.
- `resolveFile` su un percorso che esce dalla radice (`isSafeRelative`) o
  che non è fra i file in conflitto; `how` sconosciuto; `ours/theirs` su un
  file cancellato da quella parte.
- «Segna risolto» con marcatori rimasti nel file.
- una sessione sta lavorando nello stesso repository (`t.running`, come 53):
  continue e abort spenti, col motivo.

## Sicurezza

- Argv soltanto, `--` prima dei percorsi, `--literal-pathspecs`.
- `op` da una lista chiusa; mai `--strategy`, `-X`, `--no-verify`,
  `--skip` dalla UI.
- Il contenuto dei file entra nella pagina solo dentro Monaco o con
  `textContent`; i nomi dei branch e i messaggi dei commit nella testata con
  `textContent`.

## Dove

- `lib/worktree.js`: `busyWith` riconosce anche `cherry-pick`
  (`CHERRY_PICK_HEAD`) e `revert` (`REVERT_HEAD`). `BUSY` in
  `lib/git-commit.js` le copre e rimanda al pannello, non al terminale.
- `lib/conflict-markers.js` (nuovo, UMD puro come `renderer/sidebar.js`,
  caricato anche dal renderer): `parseBlocks(text)` →
  `[{start, sep, base, end, ours, theirs}]` (righe), `applyChoice(text,
  block, 'ours'|'theirs'|'both')` → testo nuovo. CRLF conservato.
- `lib/git-conflicts.js` (nuovo; `run`, `exists`, `fsp` iniettabili):
  - `readConflicts({ cwd })` → `{ ok, root, op, what: {incoming, into,
    step, total, commit, subject}, files: [{path, kind, binary, blocks}],
    resolved: [...] }`. File da `status --porcelain=v2 -z` (righe `u`, il
    tipo dalla coppia `XY`), descrizione da `MERGE_HEAD`, `MERGE_MSG`,
    `rebase-merge/{head-name,onto,msgnum,end}` (e `rebase-apply`),
    `CHERRY_PICK_HEAD`, `REVERT_HEAD`.
  - `resolveFile({ cwd, path, how: 'mark'|'ours'|'theirs'|'keep'|'delete' })`.
  - `continueOp({ cwd, op })`: `{ ok: true, done }` oppure
    `{ ok: true, stopped: true }` se un rebase si ferma di nuovo.
  - `abortOp({ cwd, op })`.
- `lib/git-merge.js`, `lib/worktree.js` (`mergeWorktree`): al conflitto
  `{ ok: false, conflict: true, pending: true, files }`, niente abort.
- `app/git.js`, `preload.js`: canali `git-conflicts`,
  `git-conflict-resolve`, `git-op-continue`, `git-op-abort`.
- `renderer/conflicts-model.js` (nuovo, UMD puro, testato): testata,
  etichette nostro/loro per operazione, stato dei pulsanti.
- `renderer/conflicts-view.js` (nuovo) e `renderer/changes-panel.js`: la
  modalità Conflitti quando `busy`.
- `renderer/editor-conflicts.js` (nuovo) e `renderer/editor-tab.js`: marks
  e zone sui blocchi.
- `renderer/worktree-actions.js`, `renderer/git-tab.js`: l'avviso
  «Risolvi / Annulla merge».
- `renderer/index.html` (ordine degli script), `renderer/styles.css`.

## Fuori

- Chiedere all'agente di risolvere i conflitti (→ `idee.md`).
- Vista a tre colonne base/nostro/loro.
- `rerere`, strategie (`-X ours`…), `rebase --skip`, rebase interattivo.
- Scrivere il messaggio del commit di merge (resta quello di git).

## Commit (refactor e comportamento separati, CLAUDE.md)

1. `busyWith` con cherry-pick e revert, messaggi `BUSY`.
2. `lib/conflict-markers.js`.
3. `lib/git-conflicts.js` e canali IPC.
4. «Unisci» lascia il merge a metà (cambio di comportamento).
5. Pannello in modalità Conflitti.
6. Blocchi nell'editor.

## Verifica

- `npm run test:unit` verde:
  - `conflict-markers` su fixture (`tests/fixtures/conflicts/`: merge
    semplice, più blocchi, `diff3`, CRLF, `=======` fuori da un blocco che
    non va preso per marcatore);
  - `git-conflicts` con `run` finto: argv, percorso fuori radice, file non
    in conflitto, `how` sconosciuto, marcatori rimasti, `op` non
    combaciante, continue con conflitti, rebase che si ferma di nuovo,
    tempo scaduto;
  - `mergeBranch`/`mergeWorktree`: conflitto → `pending`, niente abort;
    errore di hook → abort come prima;
  - `conflicts-model`: testate e etichette per merge/rebase/cherry-pick/revert;
  - git vero in `tests/integration.test.js`: merge in conflitto → tieni
    loro → concludi; rebase su due commit in conflitto; cherry-pick; abort
    → cartella intatta.
- Smoke nell'app: repo di prova con `main` e `feat/x` in conflitto su un
  file di testo e uno binario; «Unisci» → avviso → «Risolvi» → pannello;
  editor: «Tieni entrambi» su un blocco, a mano l'altro, Ctrl+Z; «Segna
  risolto», «Concludi merge», `git log`. Poi un rebase da terminale in
  conflitto: il pannello lo vede, «Continua rebase» fino in fondo.

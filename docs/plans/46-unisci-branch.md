# 46 — `feat/unisci-branch`: unire un branch qualsiasi nel corrente

Terzo pezzo della «Review attiva» (`idee.md`), dopo i commenti sul diff (44)
e il commit dal pannello (45). Poi la PR (47).

## Cosa

Oggi «Unisci» c'è solo per i worktree (piano 36): il branch del worktree
nella sua base, dalla cartella principale. Per unire un branch qualsiasi si va
in una shell. Qui il selettore dei branch della sessione git (piano 27) ha, su
ogni riga, «Unisci in `<corrente>`»: `git merge` di quel branch nel branch su
cui è la cartella.

```
┌─ Branch ──────────────────────────────────────┐
│ Locali                                        │
│ main                          corrente        │
│ feat/login   ↔ origin/feat/login   [⤵] [🗑]   │
│ Remoti                                        │
│ origin/fix/y          → nuovo fix/y locale [⤵]│
└───────────────────────────────────────────────┘
```

- **Conferma guardando il diff**, come «Unisci» dei worktree: il pannello
  delle modifiche si apre su «Stai per unire», con quello che il branch porta
  (dal punto in cui si è staccato dal corrente fino alla sua punta), e in
  fondo «Unisci in `main`» / Annulla. Chiudere il pannello vale Annulla.
- **Merge**: `git merge --no-edit <branch>` dalla radice. Default di git:
  fast-forward quando si può, altrimenti commit di merge col messaggio
  standard. Hook come da terminale, tempo massimo 60 s (come il commit, 45).
- **Esito**: nel selettore, «`feat/login` unito in `main` (fast-forward)»
  oppure «… (commit `abc1234`)»; la timeline della scheda si rilegge.
- **Conflitti**: `git merge --abort` subito, la cartella torna com'era;
  l'errore elenca i file in conflitto. Se l'abort non riesce si dice che la
  cartella è a metà merge.
- **Il branch unito resta**: per eliminarlo c'è già il cestino.
- **Locali e remoti** (`origin/x`, senza fetch). Non sul branch corrente, né
  con la cartella su un commit staccato.

## Quando no (rifiutato prima di cominciare, col motivo)

- la cartella ha modifiche non committate ai file tracciati: il merge le
  mescolerebbe e un abort non saprebbe rimetterle a posto. Il pannello lo
  avvisa già nella conferma e spegne «Unisci»;
- merge o rebase a metà (`busyWith`);
- una sessione sta lavorando nello stesso repository (`t.running`, come 45);
- niente da unire: il branch è già contenuto nel corrente
  (`merge-base --is-ancestor`);
- il branch si è spostato fra la conferma e il merge: la conferma mostrava
  un'altra cosa. Il pannello si ricorda la punta che ha mostrato e il merge
  la confronta.

## Sicurezza

- Argv soltanto. Il nome del branch passa `validateBranchName` (niente `-`
  all'inizio: git lo leggerebbe come opzione) e deve esistere come
  `refs/heads/<nome>` (locale) o `refs/remotes/<nome>` (remoto). Un remoto
  con lo stesso nome di un locale si rifiuta: git sceglierebbe il locale.
- Nessun `--no-verify`, nessuna strategia (`-X theirs`…) dalla UI.

## Dove

- `lib/git-merge.js` (nuovo): `mergeBranch({ cwd, name, kind, expect })`.
  Controlli, merge, abort ai conflitti con l'elenco dei file. `run` ed
  `exists` iniettabili.
- `lib/git-changes.js`: `readChanges` e `readFileDiff` con `incoming`
  (nome di un branch): confronto fra due commit, `merge-base HEAD <branch>`
  e la punta del branch, che il risultato riporta (`tip`) insieme a quanti
  file non committati ha la cartella (`uncommitted`).
- `app/git.js`, `preload.js`: canale `git-merge`; `git-changes` e
  `git-file-diff` passano `incoming`.
- `renderer/git-branch-picker.js`: pulsante «Unisci in …» sulle righe,
  `onMerge(name, kind)`.
- `renderer/git-tab.js`: `onMerge` apre la conferma nel pannello e poi
  chiama `gitMerge`; rilegge la timeline.
- `renderer/changes-panel.js`: la conferma di «Unisci» vale per un worktree
  o per un branch (`merge.kind`); il piè di pagina e il titolo di conseguenza.
- `renderer/changes-model.js`: il piè di pagina di Unisci (puro, testato),
  compreso il blocco per una sessione che lavora.
- `renderer/styles.css`.

## Fuori

- Rebase, squash, `--no-ff`, scegliere la strategia.
- Unire il corrente in un altro branch (si passa prima a quello).
- Fetch prima del merge di un remoto.
- Lasciare il merge a metà per risolvere i conflitti con l'agente.

## Verifica

- `npm run test:unit` verde: `lib/git-merge.js` con `run` finto (argv,
  nome con `-`, remoto ambiguo, cartella sporca, già unito, punta spostata,
  conflitto → abort con file, abort fallito, tempo scaduto); `incoming` in
  readChanges/readFileDiff; il modello del piè di pagina; il pulsante nel
  selettore; e git vero in `tests/integration.test.js` (fast-forward, commit
  di merge, conflitto annullato con la cartella intatta).
- Smoke nell'app: repo di prova con `main` e `feat/x` divergenti, sessione
  git, selettore, ⤵ su `feat/x` → pannello col diff, «Unisci in main» →
  esito, `git log` mostra il merge; un secondo caso con conflitto → cartella
  pulita e file elencati.

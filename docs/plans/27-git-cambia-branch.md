# 27 — Sessione git: cambiare branch, isolare una linea, riaprirla al riavvio

Branch: `feat/git-cambia-branch` · Dipende da: 25 · Taglia: ~1 g

## Obiettivo

Dalla sessione git:
- **cambiare branch**, scegliendo anche fra quelli remoti, o **crearne uno
  nuovo**;
- **isolare una linea**: clic sul nome di un branch, su una linea o su un
  suo pallino e restano solo quei commit. Riclic, clic altrove nel pannello
  o Esc tornano a tutte le linee.
- **riaprire le schede git** che erano aperte quando l'app si è chiusa.

## Scelte

- Il selettore si apre dal nome del branch nell'intestazione (`⎇ main ▾`):
  un campo che filtra locali e remoti; se il testo non è un branch locale
  propone "+ Crea «nome»" (dal commit corrente). Invio sceglie la prima voce.
- **`git switch`, mai `--force`**: con modifiche in conflitto git rifiuta e
  il suo messaggio compare nel selettore. Niente stash automatici.
- Un remoto (`origin/x`) diventa `git switch --track origin/x`; se `x`
  esiste già in locale si passa a quello.
- Nomi validati due volte: regole di git in `validateBranchName` (rifiuta
  anche un `-` iniziale, che git leggerebbe come opzione) e poi
  `git check-ref-format --branch`. Sempre `execFile`, niente shell.
- La linea isolata si riconosce dall'indice di colore (è l'identità della
  corsia); dopo un aggiornamento si ritrova dal suo commit più recente.

## Fatto

- Refactor (commit separato): `lib/git-run.js` (lancio di git condiviso) e
  `app/git.js` (canali IPC git), così `main.js` resta solo cablaggio.
- `lib/git-branches.js`: `parseBranches`, `validateBranchName`,
  `listBranches`, `switchBranch`, `createBranch`. IPC `git-branches`,
  `git-switch`, `git-create-branch`.
- `renderer/git-branch-picker.js`: il selettore (`filterBranches` testato).
- `renderer/git-graph-view.js`: `focusRows`, `laneLabel`, clic su linee
  (tratto trasparente largo sopra ognuna), pallini e nomi dei branch.
- Test: `tests/git-branches.test.js`, casi nuovi in `tests/git-graph.test.js`,
  e in `tests/integration.test.js` un repository vero con origin: remoto →
  locale che lo segue, nome duplicato, cambio bloccato da modifiche senza
  perderle.
- Ripristino: `lib/git-sessions.js` (`git-sessions.json` nella cartella dei
  dati, IPC `git-sessions` / `git-sessions-save`). Una scheda git non ha una
  sessione tmux che la ricordi, quindi è l'unico registro: il renderer lo
  riscrive a ogni apertura, chiusura (✕) o rinomina. All'avvio le schede
  tornano da sole, senza chiedere: non fanno partire processi. Vale anche
  senza tmux (Windows). Test: `tests/git-sessions.test.js`.

## Da fare / idee emerse

- **Niente `git fetch`**: "Aggiorna" rilegge solo il repository locale, i
  remoti sono quelli dell'ultimo fetch. Un pulsante "Fetch" a parte, con
  un timeout, perché può chiedere credenziali o restare appeso alla rete.
- Il nuovo branch parte sempre dal commit corrente: scegliere il punto di
  partenza (un commit della timeline) sarebbe il passo dopo.

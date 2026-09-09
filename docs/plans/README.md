# Piani di refactoring

Un file per branch. Ogni piano è **autosufficiente**: una sessione che apre solo
quel file ha tutto il contesto per eseguirlo, senza aver letto gli altri.

## Sequenza

| # | Branch | Dipende da | Taglia | Stato |
|---|--------|-----------|--------|-------|
| 1 | `chore/cleanup` | — | ~1h | ✅ mergiato (PR #1) |
| 2 | [`refactor/extract-modules`](02-extract-modules.md) | 1 | 1-2 gg | da fare |
| 3 | [`fix/security`](03-security.md) | 2 | ~4h | da fare |
| 4 | [`fix/robustness`](04-robustness.md) | 2 | ~4h | da fare |
| 5 | [`spike/tmux`](05-spike-tmux.md) | — | ~4h | da fare |
| 6 | [`feat/tmux-backend`](06-tmux-backend.md) | 2, 5 | 3-5 gg | bloccato dal 5 |

**3 e 4 sono paralleli** fra loro (toccano parti diverse), ma entrambi dopo il 2.
**5 non dipende da niente**: si può fare in qualsiasi momento, anche subito.
**6 non si pianifica prima che il 5 abbia risposto** — vedi il file.

## Perché il 2 viene prima di tutto

`main.js` fa `require('electron')` alla riga 1, quindi niente di quello che
contiene è importabile fuori da Electron. Conseguenza concreta:
`tests/run-tests.js` **ricopia** `buildCommand` invece di importarla, e 9 test
su 13 sono `grep` sul testo dei sorgenti. Se domani qualcuno rompe la vera
`buildCommand`, i test restano verdi.

Finché non è risolto, ogni altra modifica si fa senza rete.

## Regola comune a tutti i branch

Un branch fa **solo** quello che dice il suo piano. Se durante il lavoro salta
fuori qualcosa che appartiene a un altro branch, si annota e si lascia lì:
mescolare rovina il confronto "stesso comportamento prima e dopo", che è
l'unica garanzia che un refactor non abbia rotto niente.

I numeri di riga citati nei piani si riferiscono a `main` al 2026-09-09
(commit `e6c551a`) e vanno presi come indicazione: cercare per nome di funzione.

## Backlog — rilevato ma non assegnato a un branch

Cose emerse durante l'analisi che non appartengono a nessuno dei sei branch.
Non sono urgenti; stanno qui per non essere dimenticate.

- **`aisessionmanager-tokens.css` e `renderer/tokens.css` sono identici**, copia
  letterale byte per byte. Due file da tenere allineati a mano: prima o poi
  divergeranno. Serve una sola fonte di verità.
- **La palette del terminale è duplicata in due linguaggi**: esadecimali
  hardcoded nel tema di xterm (`renderer/renderer.js`, `new Terminal({ theme: … })`)
  e variabili in `tokens.css`. Stesso problema, stessa soluzione.
- **`renderer/renderer.js` è a 613 righe** e cresce a ogni funzionalità. Sotto il
  limite di 800, ma la direzione è quella sbagliata: andrebbe diviso per area
  (schede, modali, account, resume).
- **Scorciatoie da tastiera per le schede** (⌘T / ⌘W) e `Esc` per chiudere i
  modali. ⌘N per la nuova sessione esiste già dal commit `e6c551a`.
- **Icona `.icns` per macOS**: `assets/icon.png` è a risoluzione singola.
- **`npm run dist` punta a Linux anche su Mac**; `dist:mac` esiste ma non è il
  default.
- **`npm audit`**: 15 vulnerabilità, tutte in `electron-builder` /
  `electron-rebuild`, quindi devDependencies che non finiscono nel bundle. Da
  sistemare prima di distribuire l'app.

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

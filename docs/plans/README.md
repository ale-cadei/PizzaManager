# Piani di refactoring

Un file per branch. Ogni piano è **autosufficiente**: una sessione che apre solo
quel file ha tutto il contesto per eseguirlo, senza aver letto gli altri.

## Sequenza

| # | Branch | Dipende da | Taglia | Stato |
|---|--------|-----------|--------|-------|
| 1 | `chore/cleanup` | — | ~1h | ✅ mergiato (PR #1) |
| 2 | [`refactor/extract-modules`](02-extract-modules.md) | 1 | 1 g | ✅ fatto (2ª volta, vedi nota) |
| 3 | [`fix/security`](03-security.md) | 2 | ~1h | ✅ fatto (ridotto, vedi 03) |
| 4 | [`fix/robustness`](04-robustness.md) | 2 | ~4h | parziale: menubar in-app ✅ |
| 5 | [`spike/tmux`](05-spike-tmux.md) | — | ~4h | ✅ fatto, [risultati](05-risultati.md) |
| 6 | [`feat/tmux-backend`](06-tmux-backend.md) | 2, 5 | 1 g | ✅ fatto |
| 7 | [`feat/claude-account-login`](07-account-claude-login.md) | — | 1-2 gg | proposto, non pianificato |

**3 e 4 sono paralleli** fra loro (toccano parti diverse), ma entrambi dopo il 2.
**7 non è in coda**: è una proposta di ergonomia, il suo caso d'uso è già
risolto a mano dalla configurazione comandi. Si fa se e quando si decide.
**5 non dipende da niente**: si può fare in qualsiasi momento, anche subito.
**6 non si pianifica prima che il 5 abbia risposto** — vedi il file.

## Perché il 2 viene prima di tutto

`main.js` fa `require('electron')` alla riga 1, quindi niente di quello che
contiene è importabile fuori da Electron. Conseguenza concreta:
`tests/run-tests.js` **ricopia** `buildCommand` invece di importarla, e 9 test
su 13 sono `grep` sul testo dei sorgenti. Se domani qualcuno rompe la vera
`buildCommand`, i test restano verdi.

Finché non è risolto, ogni altra modifica si fa senza rete.

## Nota sul branch 2: fatto due volte

La prima esecuzione (PR #5) è rimasta aperta una settimana; nel frattempo
`main` ha ricevuto i profili di comando (+200 righe in `main.js`, +434 in un
file test qui rinominato) e la PR non era più mergiabile. Ricomporla costava
quanto rifarla: è stata chiusa e l'estrazione rifatta sulla base nuova — più
corta, perché `command-profiles`, `recent-dirs` e `codex-sessions` erano già
moduli separati. **Un branch di refactor si merge il giorno stesso.**

Le convenzioni che ne derivano stanno in [`CLAUDE.md`](../../CLAUDE.md).

## Regola comune a tutti i branch

Un branch fa **solo** quello che dice il suo piano. Se durante il lavoro salta
fuori qualcosa che appartiene a un altro branch, si annota e si lascia lì:
mescolare rovina il confronto "stesso comportamento prima e dopo", che è
l'unica garanzia che un refactor non abbia rotto niente.

I numeri di riga citati nei piani si riferiscono a `main` al 2026-09-09
(commit `e6c551a`) e vanno presi come indicazione: cercare per nome di funzione.

## Possibile branch 8 — ripristino dopo un riavvio della macchina

tmux protegge dalla chiusura dell'app, non dal riavvio del computer: le
sessioni sono processi in memoria e un reboot le termina tutte. Le CLI AI
conservano la conversazione nei loro file (si riprende dal Resume, a schermo
pulito); le shell si perdono.

Si può fare di meglio lato app: allo stacco (chiusura scheda o finestra)
scrivere su disco i metadati che già stanno in tmux; all'avvio, se tmux non ha
sessioni ma lo snapshot sì, chiedere «Ripristinare le N sessioni di prima?» e
ricrearle — `claude --resume <id>` nella stessa directory con lo stesso profilo,
una shell nella stessa directory per il tipo shell. Mezza giornata. Vale la pena
solo se riavviare con sessioni aperte capita davvero.

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
- **`safeStorage` per le API key** (era nel branch 3, differito). Su macOS lega
  l'accesso alla firma dell'app: un'app in sviluppo non è firmata e ogni rebuild
  può perdere l'accesso alla chiave, facendo sparire gli account. Il file su
  disco diventa opaco. Per un programma non ancora distribuito è più fastidio che
  protezione: torna in gioco quando si firma l'app per distribuirla.
- **Google Fonts caricati da rete** (`renderer/index.html`): IBM Plex Mono e
  Inter arrivano da fonts.googleapis.com. Offline si ricade sul fallback locale,
  ma è una dipendenza di rete in un'app desktop; valutare di includerli.
- **`npm audit`**: 15 vulnerabilità, tutte in `electron-builder` /
  `electron-rebuild`, quindi devDependencies che non finiscono nel bundle. Da
  sistemare prima di distribuire l'app.

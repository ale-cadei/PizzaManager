# Piani di refactoring

Un file per branch. Ogni piano è **autosufficiente**: una sessione che apre solo
quel file ha tutto il contesto per eseguirlo, senza aver letto gli altri.

## Sequenza

| # | Branch | Dipende da | Taglia | Stato |
|---|--------|-----------|--------|-------|
| 1 | `chore/cleanup` | — | ~1h | ✅ mergiato (PR #1) |
| 2 | [`refactor/extract-modules`](02-extract-modules.md) | 1 | 1 g | ✅ fatto (2ª volta, vedi nota) |
| 3 | [`fix/security`](03-security.md) | 2 | ~1h | ✅ fatto (ridotto, vedi 03) |
| 4 | [`fix/robustness`](04-robustness.md) | 2 | ~4h | ✅ fatto |
| 5 | [`spike/tmux`](05-spike-tmux.md) | — | ~4h | ✅ fatto, [risultati](05-risultati.md) |
| 6 | [`feat/tmux-backend`](06-tmux-backend.md) | 2, 5 | 1 g | ✅ fatto |
| 8 | `feat/restore-after-reboot` | 6 | ½ g | ✅ fatto (vedi sotto) |
| 7 | [`feat/claude-account-login`](07-account-claude-login.md) | — | 1-2 gg | proposto, non pianificato |
| 8 | [`feat/raggruppamento-per-progetto`](08-raggruppamento-sessioni.md) ([task](08-raggruppamento-sessioni-tasks.md)) | 2 | ~½ g | ✅ fatto |
| 9 | [ordinamento manuale](09-ordinamento-manuale.md) — sul branch dell'8 | 8 | ~2h | ✅ fatto |
| 10 | [`feat/pizza-branding`](10-pizza-branding.md) | — | ~1h | ✅ fatto |
| 11 | [`feat/nuova-sessione-nel-progetto`](11-nuova-sessione-nel-progetto.md) | 8 | ~1h | ✅ fatto |
| 12 | [`feat/windows`](12-windows.md) | — | ~1 g | ✅ fatto, provato su Windows (vedi 24) |
| 13 | [`chore/release-build`](13-release-build.md) | 12 | ~2h | ✅ fatto |
| 14 | [`feat/barra-usage`](14-barra-usage.md) | — | ~1 g | ✅ fatto |
| 15 | [`feat/quota-token-5h`](15-quota-token-5h.md) | 14 | ~½ g | ✅ fatto |
| 16 | [`spike/quota-claude`](16-spike-quota-claude.md) | 15 | ~3h | ✅ risposto ([risultati](16-risultati.md)) |
| 17 | [`feat/quota-endpoint-claude`](17-quota-endpoint-claude.md) | 15, 16 | ~2h | ✅ fatto |
| 18 | [aggiornamento automatico](18-aggiornamento-automatico.md) — 3 branch | 13 | ~1 g | ✅ 1 e 2 fatti (44, `feat/auto-update`); firma mac fatta nel 44 |
| 19 | [`feat/sposta-progetti-e-chat-corrente`](19-sposta-progetti-e-chat-corrente.md) | 8, 9, 14 | ~2h | fatto, da provare nell'app |
| 20 | [`feat/onboarding`](20-onboarding.md) | — | ~1 g | fatto, da provare nell'app |
| 21 | [`refactor/split-renderer`](21-split-renderer.md) | — | ~2h | ✅ fatto (PR #30) |
| 22 | [`feat/ricerca-conversazioni`](22-ricerca-conversazioni.md) | 21 | ~1 g | fatto, da provare nell'app |
| 23 | [`feat/export-markdown`](23-export-markdown.md) | 22 | ~½ g | fatto, da provare nell'app |
| 24 | [`fix/windows`](24-windows-prova-vera.md) | 12, 13 | ~½ g | fatto, CI verde (PR #33), da mergiare |
| 25 | [`feat/sessione-git`](25-sessione-git.md) | 21 | ~1 g | fatto, da provare nell'app |
| 26 | [`feat/scrollback-shell`](26-scrollback-shell.md) | 6, 8 | ~½ g | fatto, da provare nell'app |
| 26b | [`feat/scrollback-senza-tmux`](26-scrollback-shell.md) — Windows | 26 | ~1 g | proposto |
| 27 | [`feat/git-cambia-branch`](27-git-cambia-branch.md) | 25 | ~1 g | fatto, da provare nell'app |
| 28 | [`fix/rotella-codex`](28-rotella-codex.md) | 6 | ~1h | fatto, da provare nell'app |
| 29 | [`feat/plugin-skill`](29-plugin-skill.md) | — | ~½ g | fatto, da provare nell'app |
| 30 | [`feat/plugin-skill-progetto`](30-plugin-skill-progetto.md) | 29 | ~½ h | fatto, da provare nell'app |
| 31 | [`feat/git-branch-map-claude`](31-mappa-branch.md) | 25, 27 | ~1 g | fatto, da provare nell'app |
| 32 | [`feat/pannello-modifiche`](32-pannello-modifiche.md) | 25, 27, 31, 36 | ~2 g | fatto, provato nell'app (pannello, ultimo giro); da provare Unisci e contatori dei worktree |
| 33 | [`feat/animaletti`](33-animaletti.md) | — | ~1 g | fatto, da provare nell'app |
| 34 | [`feat/git-main-a-sinistra`](34-git-main-a-sinistra.md) | 25, 27 | ~½ g | fatto, provato nell'app (smoke) |
| 35 | [`feat/quota-per-profilo`](35-quota-per-profilo.md) | 17 | ~½ g | fatto, provato nell'app (smoke) |
| 36 | [`feat/sessione-worktree`](36-sessione-worktree.md) | 8, 25, 27 | ~1½ g | fatto, provato nell'app |
| 37 | [`fix/collassi-al-riavvio`](37-collassi-al-riavvio.md) | 8, 6 | ~1h | fatto, da provare nell'app |
| 38 | [`feat/notifiche-sistema`](38-notifiche-sistema.md) — macOS e Linux | — | ~½ g | fatto, provato nell'app su macOS; da provare su Linux |
| 39 | [`feat/temi-colori`](39-temi-colori.md) — temi pronti nel dialogo Colori | — | ~¼ g | fatto, provato nell'app |
| 40 | [`spike/psmux`](40-windows-sessioni-persistenti.md) → fase 2 — Windows, **più il pacchetto che non si costruisce** | 6, 8, 24, 26 | ~½ g + ~1 g | spike fatto: psmux regge, il mouse si risolve con `mouse on` ([risultati](40-risultati.md)); fase 2: piano 52 con psmux originale; pacchetto ancora da fare |
| 41 | [`fix/temi-personalizzati`](41-temi-personalizzati.md) — i ritocchi restano al loro tema | 39 | ~¼ g | fatto |
| 42 | [`fix/opencode-resume-id`](42-opencode-resume-id.md) — le schede opencode tornano dopo un riavvio | 8 | ~2h | fatto, provato nell'app |
| 43 | [`feat/modifiche-staged`](43-modifiche-staged.md) — «Da committare»: staged e non staged nel pannello | 32 | ~½ g | fatto, provato nell'app (smoke sotto xvfb) |
| 44 | [`chore/release-firmata`](44-release-firmata.md) — 1.1.0 firmata, notarizzata, su repo pubblico | 13 | ~½ g | in corso |
| 44 | [`feat/review-attiva`](44-review-commenti.md) — commenti sul diff, inviati all'agente | 32, 43 | ~1 g | fatto, provato nell'app (smoke sotto xvfb, agente finto) |
| 48 | [`feat/segnalazioni`](48-segnalazioni.md) — bacheca di richieste e problemi nell'app | 18, 44 | ~1 g | ✅ mergiato (PR #51), nella 1.5.0 |
| 46 | [`feat/hooks-esatti`](46-hook-esatti.md) — lavora / ha finito / chiede un permesso, dagli hook di Claude, opencode e Codex | 38 | ~1½ g | fatto, smoke da fare |
| 49 | [`chore/via-personaggi-nickelodeon`](49-via-personaggi-nickelodeon.md) — SpongeBob, Patrick e Gary fuori dal catalogo degli animaletti | 33 | ~2h | ✅ mergiato (PR #52), smoke da fare |
| 50 | [`fix/segnalazioni-rifiniture`](50-segnalazioni-rifiniture.md) — titolo cliccabile, tipo visibile, etichette `stato:*`, e il testo che non arrivava su GitHub | 48 | ~1h | ✅ mergiato (PR #53) |
| 51 | [fork di psmux](51-fork-psmux.md) (`JackGrieco/psmux`) — barra di scorrimento fluida, con PR all'autore | 40 | ~1 g | idea, non bloccante ([idee](idee.md)) |
| 52 | [`feat/psmux-backend`](52-psmux-backend.md) — psmux nel pacchetto, sessioni persistenti su Windows | 40, 26 | ~1½ g + ½ g CI | proposto, da fare sul fisso Windows |
| 53 | [`feat/resume-worktree`](53-resume-worktree.md) — ⟲ sulla riga del worktree, Resume delle sole sue chat | 36, 8 | ~2h | fatto, da provare nell'app |

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

## Branch 8 — ripristino dopo un riavvio della macchina ✅ fatto (2026-09-16)

tmux protegge dalla chiusura dell'app, non dal riavvio del computer. Ora:

- **Registro** `live-sessions.json` in userData: specchio di tmux, riscritto a
  ogni spawn / stacco / termina / cambio titolo o id (`lib/live-sessions.js`).
  Non è la cronologia: è l'insieme delle sessioni aperte adesso.
- **L'id della conversazione arriva appena noto**: subito se la sessione nasce
  da un Resume; altrimenti quando il titolo automatico (`session-titles.js`)
  trova il `.jsonl` — quel punto scriveva già l'id nella scheda, ora lo spedisce
  anche a tmux (`@ais_resume_id`) e quindi al registro. È il pezzo che rende
  ripristinabili le sessioni nate "nuove", cioè quasi tutte.
- **All'avvio**: se tmux è vuoto e il registro no → modal «Ripristinare le
  sessioni di prima?» con spunte. Con id → `--resume` nella stessa directory,
  stesso profilo e account; senza → sessione pulita dello stesso tipo nella
  stessa directory; shell → shell nella stessa directory. «Non ora» svuota il
  registro. Se tmux ha ancora *qualche* sessione, quelle mancanti sono state
  uccise di proposito: niente da proporre, registro riallineato.

Verificato sull'app: Claude nata nuova → id scoperto dal titolo → ⌘Q →
`kill-server` (= riavvio) → riapertura → modal → Ripristina →
`claude --resume <quell'id>`. Coperto dal test d'integrazione su tmux reale.

Fuori, volutamente: lo scrollback (si potrebbe salvare con `capture-pane` e
ricopiarlo grigio al ripristino; è un trucco visivo, il processo è nuovo).

## Idee per feature nuove

Brainstorming con checklist di avanzamento: [idee.md](idee.md).

## Backlog — rilevato ma non assegnato a un branch

Cose emerse durante l'analisi che non appartengono a nessuno dei sei branch.
Non sono urgenti; stanno qui per non essere dimenticate.

- **`aisessionmanager-tokens.css` e `renderer/tokens.css` sono identici**, copia
  letterale byte per byte. Due file da tenere allineati a mano: prima o poi
  divergeranno. Serve una sola fonte di verità.
- **La palette del terminale è duplicata in due linguaggi**: esadecimali
  hardcoded nel tema di xterm (`TERM_THEME` in `renderer/app-state.js`)
  e variabili in `tokens.css`. Stesso problema, stessa soluzione.
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
- **La suite di test assume Unix** (bit di esecuzione, path POSIX nei test di
  `binaries` e `claude-sessions`): su un runner Windows fallisce, per questo
  `release.yml` non la esegue. Farla girare anche lì vorrebbe dire iniettare
  `platform: 'linux'` nei test che oggi usano il default.
- ~~La CI su `windows-2022` è rossa dal 2026-09-28~~: corretta in
  `fix/ci-windows` (PR #55). Erano 31 test che presumevano Unix, più un difetto
  vero (la cartella del worktree restava su Windows). In locale su Windows è
  tutto verde.
- **GitHub Actions è fermo (2026-10-10).** I job Windows appesi 6 ore hanno
  finito i minuti dell'account `ale-cadei`, e i job non partono più. Decisione
  dell'utente: **test e build si fanno in locale** finché il repo non diventa
  pubblico (si decide nella settimana del 2026-10-12). Mac e Windows sono
  dell'utente, Linux è del collega. Prima di un merge: `npm run test:unit`
  verde sulle macchine che la modifica tocca. `ci.yml` ha ora un limite di 20
  minuti, perché un blocco non bruci di nuovo i minuti.
- **`npm audit`**: 15 vulnerabilità, tutte in `electron-builder` /
  `electron-rebuild`, quindi devDependencies che non finiscono nel bundle. Da
  sistemare prima di distribuire l'app.

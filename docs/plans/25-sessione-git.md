# 25 — Sessione git: la timeline dei branch

Branch: `feat/sessione-git` · Dipende da: 21 · Taglia: ~1 g

## Obiettivo

Un nuovo tipo di sessione, **Git**, fra Terminale e OpenCode nella modale
"Nuova". Se la directory è dentro un repository git, apre un pannello (niente
pty) con la timeline dei branch locali: una linea colorata per branch, un
punto per commit, e per ogni commit messaggio, autore, data e ora, hash.

## Scelte

- **Pannello grafico, non un `git log --graph` nel terminale**: righe
  allineate, colori per corsia, hash copiabile con un clic.
- **Solo branch locali** (`git log --branches HEAD`): i remoti compaiono come
  etichetta sul commit a cui puntano, ma non aprono corsie proprie.
- Il layout (colonna di ogni commit, linee fra una riga e la successiva) si
  calcola in `lib/git-graph.js`, testabile senza DOM; il renderer disegna
  (`renderer/git-graph-view.js`, un solo `<svg>` + una lista).
- Al massimo 500 commit, i più recenti (`--date-order`).
- git si lancia con `execFile` (niente shell), `GIT_TERMINAL_PROMPT=0` e
  `GIT_OPTIONAL_LOCKS=0`: leggere la timeline non deve mai bloccare né
  prendere lock sul repository dell'utente.

## Fatto

- `lib/git-graph.js`: `parseGitLog`, `parseRefs`, `layoutGraph`, `readGitGraph`.
- IPC `git-graph` (`main.js`, `preload.js`).
- Modale: card Git; se la directory non è un repository l'errore compare
  nella modale, che resta aperta.
- Scheda git (`renderer/git-tab.js`): si aggiorna quando torna in primo piano
  e dal pulsante "Aggiorna"; prende il nome del repository; chiuderla non
  chiede conferma (non c'è un processo da perdere).
- Colore del tipo `--type-git`, icona, gruppo "Git" nella sidebar, pallino
  nella legenda in basso. I nomi dei branch hanno il colore della loro linea.
- Test: `tests/git-graph.test.js` (parsing, layout, disegno) e un caso con
  git vero in `tests/integration.test.js`.

## Da fare / idee emerse

- **Le schede git non si ripristinano dopo un riavvio**: non vivono in tmux
  e non stanno in `live-sessions.json`. Riaprirle costa poco, ma andrebbero
  ricordate.
- Niente aggiornamento automatico mentre la scheda è in primo piano (un
  commit fatto da un'altra sessione si vede solo con "Aggiorna" o cambiando
  scheda). Un watcher su `.git/refs` e `.git/HEAD` risolverebbe.
- Clic su un commit → dettaglio (file toccati, diff): fuori da questo piano.

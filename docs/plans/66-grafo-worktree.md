# 66 — `fix/git-worktrees-in-graph`: i worktree nella timeline git

Dipende da: 25 (sessione git), 36 (sessione worktree). Taglia: ~½ giorno.

## Perché

Nella timeline della sessione git i worktree non si riconoscono:

- il branch di un worktree è un branch locale come gli altri: ha la sua
  linea, ma niente dice che vive in un worktree;
- «Unisci» (`lib/worktree.js`) faceva `git merge --no-edit`: se la base non
  si era mossa, git avanzava in fast-forward, i commit finivano dritti sulla
  linea della base e il branch veniva cancellato. Nessuna diramazione, nessuna
  traccia che lì c'era stato un worktree.

## Cosa fa (perimetro)

Scelte dall'utente:

- **Unisci fa sempre un merge vero** (`--no-ff`): la linea del worktree si
  stacca dalla base e ci rientra, come un branch.
- **Il merge si firma**: messaggio `Merge branch '<nome>' (worktree)`. Così un
  worktree già unito (branch cancellato) resta riconoscibile. I merge fatti
  prima di questo branch non hanno la firma e restano linee normali.
  `parseMergeSubject` (mappa dei branch) legge il nome come prima.
- **Segno nella timeline**:
  - la linea di un worktree è **tratteggiata**;
  - il nome del branch ha **⌂** davanti e il bordo a puntini (il tratteggio
    del bordo è già dei branch remoti).
- Quali linee sono di un worktree (`worktreeLanes`, `lib/git-graph.js`):
  - **vivi**: da `git worktree list`, tolto il principale. La linea è del
    worktree se il suo commit più recente è la punta del branch del worktree.
    Un worktree senza commit suoi sta sulla linea della base: niente
    tratteggio, solo l'etichetta;
  - **uniti**: il secondo genitore di un merge firmato apre la linea del
    worktree.
  - Mai le linee fisse (main, develop).

## Fuori perimetro

- La mappa dei branch (`renderer/git-map-view.js`) resta com'è: se serve il
  segno anche lì, è un piano a parte.
- Il merge di un branch qualsiasi dal selettore (`lib/git-merge.js`, piano
  54) non cambia: niente `--no-ff` forzato lì.

## Verifica

- `tests/worktree.test.js`: Unisci chiede `--no-ff` e il messaggio firmato.
- `tests/git-graph.test.js`: `worktreeLanes` (vivo, unito, senza commit suoi,
  linee fisse escluse) e `readGitGraph` che marca ref e linee.
- `tests/git-view.test.js`: linea tratteggiata ed etichetta ⌂.
- Smoke: worktree con un commit, Unisci con main fermo → linea tratteggiata
  che si stacca e rientra.

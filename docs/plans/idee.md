# Idee — feature da valutare

Raccolta dal brainstorming del 2026-09-23. Non sono piani: quando un'idea
diventa un branch, qui si spunta «piano» e si rimanda al file numerato
(`NN-nome.md`), che resta la fonte di verità.

Legenda passi: **studio** = capire se/come farla · **piano** = file in
`docs/plans/` · **fatto** = mergiato su `main` · **provato** = verificato
nell'app installata.

---

## Prima di tutto

### Dividere `renderer/renderer.js`
Piano: [21-split-renderer.md](21-split-renderer.md). Era a 1464 righe
(limite 800): avvio, modali nuova sessione / resume / account, creazione e
chiusura delle schede, titoli automatici, attenzione e «sta lavorando»,
ripristino dopo riavvio, ordine manuale, menubar, resize della sidebar,
barra usage. Quasi ogni feature qui sotto ci mette le mani: dividerlo
prima le rende più economiche. Refactor puro, stesso comportamento, merge in
giornata.

- [x] piano
- [x] fatto (PR #30)
- [x] provato

---

## Agenti in parallelo

### Ogni agente nel suo git worktree
«Nuova sessione in un worktree»: l'app crea `git worktree add` su un branch
nuovo, ci lancia l'agente, la card mostra il branch. A lavoro finito: «Unisci»
o «Butta» (rimuove worktree e branch). Due agenti sullo stesso repo smettono di
pestarsi i file.

- [x] studio — fatto con l'utente il 2026-10-01: worktree in
      `<Progetto>.worktrees/`, base = branch corrente, `node_modules` in
      symlink, Unisci prudente / Tieni il branch / Butta, sotto-sezioni nel
      gruppo del progetto
- [x] piano — [36-sessione-worktree.md](36-sessione-worktree.md)
- [ ] fatto (branch `feat/sessione-worktree`, PR aperta)
- [x] provato — repository di prova: crea, Unisci, conflitto, Butta con
      modifiche, Tieni il branch + Resume, worktree fatti fuori dall'app

### Pannello «cosa ha cambiato»
Accanto al terminale, `git diff` del progetto della sessione: file toccati,
righe +/−, aggiornato mentre l'agente lavora. Con i worktree: diff del branch
contro `main`.

- [x] studio — fatto con l'utente il 2026-10-01: pannello sovrapposto al
      terminale con linguetta-contatore, contro `HEAD` o contro la base del
      worktree, contatore sulla riga del worktree, Unisci passa dal pannello,
      solo lettura
- [x] piano — [32-pannello-modifiche.md](32-pannello-modifiche.md)
- [ ] fatto
- [ ] provato

### Segnale esatto «ha finito / ti sta chiedendo qualcosa»
Oggi il lampeggio c'è, ma è **dedotto dall'output** (`renderer/attention.js`:
soglie di byte e di tempo) e si vede solo dentro l'app. L'idea:
- per Claude, usare i suoi hook `Stop` e `Notification`: è Claude stesso a
  dire «ho finito» o «mi serve un permesso», niente euristiche; distingue anche
  i due casi (lampeggio diverso per «aspetta te»);
- notifica di sistema macOS/Linux e badge sul Dock quando l'app non è in
  primo piano;
- Codex/opencode restano sull'euristica attuale.

Le notifiche di sistema si fanno subito sul segnale di oggi, senza toccarlo:
[38-notifiche-sistema.md](38-notifiche-sistema.md) (fatto, da provare
nell'app). Il segnale esatto (hook) resta qui, ci lavora Ale.

- [ ] studio — come installare l'hook senza sporcare la config dell'utente
- [ ] piano
- [ ] fatto
- [ ] provato

---

## Navigazione e memoria

### Ricerca in tutte le conversazioni passate
Casella di ricerca testuale sui `.jsonl` di Claude, Codex e opencode (i
lettori esistono già in `lib/*-sessions.js`); risultato → «Riprendi» con
`--resume` nella sua directory.

- [x] studio — scansione senza indice (~1,5 s su 300 MB), solo nei messaggi
- [x] piano — [22-ricerca-conversazioni.md](22-ricerca-conversazioni.md)
- [x] fatto — linguetta 🔎 Cerca nel Resume (Claude Code e Codex; opencode e Antigravity solo per titolo)
- [ ] provato

### Esportare una conversazione in Markdown
Dalla card o dal resume: «Esporta in .md» → file con domande, risposte e
tool usati, leggibile e condivisibile. Branch `feat/export-markdown` (piano 23): riusa il suo
`lib/transcripts.js`.

- [x] piano — [23-export-markdown.md](23-export-markdown.md)
- [x] fatto — ⤓ sulla card e «⤓ .md» nel Resume (Claude Code e Codex; domande, risposte e nomi dei tool)
- [ ] provato

### Due sessioni affiancate
Es. agente a sinistra, shell dello stesso progetto a destra. Dubbio aperto: con
la sidebar diventano tre colonne. Possibili risposte: sidebar che si riduce a
icone quando lo split è attivo, oppure split solo orizzontale (shell in basso,
bassa e a scomparsa).

- [ ] studio — decidere il layout prima di tutto
- [ ] piano
- [ ] fatto
- [ ] provato

### Scrollback delle shell dopo un riavvio del Mac
Chiudere e riaprire l'app non perde niente (tmux tiene vive le sessioni). Dopo
un **riavvio della macchina** invece il ripristino (branch 8) ricrea la shell
nella stessa cartella, ma vuota. Come fa VS Code con «History restored»: si
salva il testo del terminale e lo si rimette sopra la shell nuova. Il processo
non torna (un server che girava va rilanciato), torna quello che c'era scritto.
- **salvare**: `tmux -L aisession capture-pane -p -e -S -5000` (ultime 5000
  righe, con i colori), periodico sulle sessioni che hanno scritto e alla
  chiusura dell'app: a uno spegnimento brusco la chiusura non arriva;
- **ripristinare dentro tmux**, non in xterm (tmux ci ridisegnerebbe sopra):
  la sessione nuova stampa il file salvato e una riga `── cronologia
  ripristinata ──`, poi avvia la shell. Così il testo vecchio si scorre con la
  rotella come il resto;
- il file può contenere segreti comparsi a schermo: `0600` + `chmodSync`, e si
  cancella quando la sessione si chiude con la ✕;
- serve alle **shell**: Claude e Codex con `--resume` ricaricano già la
  conversazione da sé;
- Windows (senza tmux): addon `serialize` di xterm, lo stesso di VS Code.

- [x] piano — [26-scrollback-shell.md](26-scrollback-shell.md) (due branch: con tmux e senza)
- [x] fatto con tmux (macOS, Linux) — branch `feat/scrollback-shell`
- [ ] fatto senza tmux (Windows) — branch `feat/scrollback-senza-tmux`
- [ ] provato

---

## Fuori dalla scrivania

### Vista web in sola lettura
PizzaManager apre un piccolo server web sulla rete di casa/ufficio; dal
telefono si apre l'indirizzo e si vede la lista delle sessioni (chi lavora, chi
ha finito, chi aspetta) e l'ultimo pezzo di output. Sola lettura: non si scrive
nei terminali. Serve un token nell'URL/QR code per non esporre i terminali a
chiunque sia sulla stessa Wi-Fi.

- [ ] studio — sicurezza (token, solo LAN) prima di tutto
- [ ] piano
- [ ] fatto
- [ ] provato

### Sessioni su una macchina remota
Le sessioni girano in tmux su un'altra macchina via SSH e continuano col Mac
spento. Non serve per forza comprare un server: basta una macchina sempre
accesa (un PC Linux, un Raspberry, una VPS da pochi euro al mese).

- [ ] studio — c'è una macchina adatta?
- [ ] piano
- [ ] fatto
- [ ] provato

---

## Distribuzione

### Installare da sorgente su Windows: `npm run install:win`
Come `install:mac`: costruisce il setup e lo installa in silenzio, rifiuta
se l'app è aperta. Nel piano [24-windows-prova-vera.md](24-windows-prova-vera.md).

- [x] piano
- [ ] fatto (branch `fix/windows`)
- [x] provato su Windows 11

### Aggiornamento automatico
Già pianificato: [18-aggiornamento-automatico.md](18-aggiornamento-automatico.md)
(repo pubblico solo per le release, `electron-updater`, banner «Riavvia»).
Tre branch:

- [ ] `chore/release-pubblica`
- [ ] `feat/auto-update`
- [ ] `chore/firma-mac` (facoltativo)
- [ ] provato su macOS
- [ ] provato su Linux (collega)

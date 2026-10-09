# 40 — Sessioni persistenti su Windows

Branch: `spike/psmux` per la fase 1 (codice usa-e-getta; da lì si mergia solo
questo piano e i risultati), poi il branch della fase 2 · Dipende da: 6, 8,
24, 26 · Taglia: ~½ g di spike + ~1 g di feature
**Si fa su una macchina Windows**: da Mac non si prova niente di utile.

> **Per il Claude che lo riceve.** Questo è un passaggio di consegne: la
> discussione è avvenuta su un Mac, il lavoro si fa sul fisso Windows
> dell'utente, che porta avanti con te piano e implementazione. Prima di
> tutto leggi `CLAUDE.md` (convenzioni, tmux, Windows, processo), poi questo
> piano, poi `26-scrollback-shell.md` (percorso B e «Trappole»),
> `24-windows-prova-vera.md` e `05-risultati.md` (modello per i risultati di
> uno spike). I riferimenti al codice sono verificati su `main` al commit
> `fec750b` (2026-10-06): cercali per nome di funzione, le righe si spostano.

## Da fare anche: il pacchetto Windows non si costruisce più

Trovato il 2026-10-08, durante la release 1.1.0. Il job Windows del workflow
fallisce subito:

```
⨯ ENOENT: no such file or directory, open 'D:\a\...\.npmRebuild=false'
```

`-c.npmRebuild=false` non arriva intero a electron-builder: la shell dei runner
Windows è `pwsh`, che spezza l'argomento in `-c` e `.npmRebuild=false`, e
quest'ultimo viene preso per il nome di un file di configurazione. Non è una
regressione del codice: quella riga della matrice non era mai stata eseguita in
una release (la 1.0.2 aveva solo `--win`), e il difetto è solo della shell —
`yargs` legge bene entrambe le forme (verificato) e su Unix l'argomento passa.

La correzione probabile è **una riga**: `shell: bash` sul passo del build, dato
che bash c'è anche sui runner Windows e lì l'argomento passa come su Unix. Non
è stata messa alla cieca perché si scoprirebbe se funziona solo bruciando un
giro di release: va provata da qui, con la macchina Windows a disposizione.

Nel frattempo il job è **commentato** in `.github/workflows/release.yml`, con
la stessa spiegazione accanto, e la 1.1.0 esce senza pacchetto Windows.

## Il problema

Su Mac e Linux ogni sessione vive nel server tmux dell'app (socket
`aisession`, config `app/tmux.conf`): chiudere l'app è uno *stacco*, il
processo resta vivo e alla riapertura la scheda si riaggancia. Dopo un
riavvio del computer il registro `live-sessions.json` permette di ripartire
con `claude --resume` (branch 8), e lo scrollback delle shell torna grigio
sopra la shell nuova (piano 26, percorso A).

Su Windows tmux non c'è, e oggi **non c'è niente di tutto questo**:

- `detectTmux` (`lib/tmux.js`) restituisce `null` su `win32`, apposta: un
  `tmux.exe` di MSYS2/Cygwin userebbe socket e percorsi POSIX (piano 12);
- `syncSnapshot()` (`app/pty.js`) esce subito senza tmux: il registro non si
  scrive mai;
- `offerRestore` (`renderer/restore.js`) chiede `restorable()` solo se
  `tmuxAvailable`; `reattachLiveSessions` esce subito;
- `sweepScrollback()` (`app/pty.js`) esce su `!viaTmux`;
- `replayCommand` (`lib/scrollback-command.js`) restituisce `null` su `win32`
  (usa `/bin/sh`).

Risultato: **le sessioni muoiono con l'app** e alla riapertura nessuno propone
niente.

## Decisioni già prese con l'utente

- **Una sola repo.** Niente fork per Windows: le differenze stanno in `lib/`
  con `platform` come parametro, come già fanno `lib/win-command.js`,
  `lib/binaries.js` ecc. La CI gira già su `windows-2022` (`ci.yml`, PR #33).
- **Prima si prova psmux, poi si decide** (fase 1 → fase 2). psmux, se
  funziona, rimette su Windows lo stesso modello di Mac senza una seconda
  architettura.
- psmux, se adottato, è un **prerequisito opzionale** come tmux su Mac: senza,
  l'app funziona come oggi. Non lo installiamo noi e non lo impacchettiamo.
- Ripristino: si **chiede** con il modal, non si fanno ripartire N processi da
  soli.
- Scrollback (piano 26): **solo shell**, **2000 righe** per sessione,
  salvataggio **ogni 30 s**.
- Fuori: WSL (piano 12). Un nostro demone che tiene i ConPTY (come
  wmux/minimux) **solo** se psmux fallisce, e con un piano a parte: è
  riscrivere un pezzo di tmux, e su Windows il demone terrebbe bloccati i
  file dell'app durante gli aggiornamenti (piano 18).

---

## Fase 1 — Spike: psmux al posto di tmux (`spike/psmux`, ~½ g)

**psmux** è un clone di tmux nativo per Windows, in Rust, basato su ConPTY:
niente WSL, Cygwin, MSYS2. Dichiara 76 comandi tmux, legge `.tmux.conf`,
installa anche un comando `tmux`.

- <https://github.com/psmux/psmux> e <https://github.com/wojtek/psmux>:
  capire quale è l'originale e quale il fork, e usare quello mantenuto
- <https://lib.rs/crates/psmux>
- alternative meno complete, stessa architettura (demone + named pipe):
  <https://github.com/bahri-hirfanoglu/wmux>, <https://github.com/llk214/minimux>

**L'idea**: tutto il backend tmux passa da `lib/tmux.js`, che si limita a
lanciare comandi tmux. Se psmux li capisce, su Windows basta accettarlo in
`detectTmux`: `app/pty.js`, registro, ripristino, scorrimento restano come
sono.

**Il rischio**: «76 comandi» non vuol dire «quelli che usiamo noi». Lo spike
risponde con i fatti, non con il README di psmux.

### Domande

| # | Domanda |
|---|---|
| Q1 | psmux accetta **esattamente** gli argomenti che costruisce `lib/tmux.js`? (tabella sotto) |
| Q2 | Il server psmux **sopravvive alla chiusura di PizzaManager**? Su Windows i figli possono stare in un Job Object che muore con l'app |
| Q3 | Le TUI (`claude`, `codex`, `opencode`) e PowerShell reggono dentro psmux dentro xterm.js? Colori, resize, box-drawing |
| Q4 | `app/tmux.conf` viene applicata? Niente prefisso (`Ctrl+B` inerte), niente barra di stato, mouse al terminale, niente alternate screen (`smcup@:rmcup@`) |
| Q5 | Come si distingue psmux dal tmux di MSYS2/Cygwin (`-V`? nome del binario?) |
| Q6 | Dopo un riavvio di Windows il server psmux è morto (atteso) e il registro è pieno? |
| Q7 | Lo scrollback del percorso A si può rimettere su Windows? `replayCommand` usa `/bin/sh`: serve una variante PowerShell che stampi il file e poi lasci la shell interattiva (es. `powershell -NoExit -Command …`). Va provata dentro psmux |

### Preparazione

1. `git fetch`, `git switch spike/psmux`, `npm install` (su Windows non si
   compila node-pty: piano 24). `npm run test:unit` verde **prima** di
   toccare niente.
2. Installare psmux dal suo README (release precompilata o `cargo install
   psmux`: da verificare). Annotare versione, percorso, output di `-V` del
   binario `psmux` e del suo `tmux`.
3. **Socket di prova sempre**: `-L aistest-psmux`, mai `aisession` (regola
   di `CLAUDE.md`). Alla fine `psmux -L aistest-psmux kill-server`.

### Q1 — I comandi, uno per uno

Da PowerShell, nella root della repo: `$b = 'C:\percorso\psmux.exe'`,
`$L = '-L','aistest-psmux'`, `$f = '-f', "$PWD\app\tmux.conf"`. Ogni riga
viene da una funzione di `lib/tmux.js` (tra parentesi). `<|>` è `FIELD_SEP`.

| Cosa | Comando | Atteso |
|---|---|---|
| nascita con dimensioni, cwd, env (`spawnArgs`, `sizeArgs`) | `& $b @L @f new-session -d -s ais-shell-prova -x 120 -y 30 -c C:\Users -e FOO=bar -- powershell.exe` | exit 0 |
| la variabile arriva al processo | attaccarsi, `echo $env:FOO` | `bar` |
| il PATH del client arriva al comando iniziale (commento di `spawnArgs`) | client lanciato con un PATH modificato, poi `echo $env:PATH` dentro | il PATH modificato |
| metadati (`metaArgs`) | `& $b @L @f set-option -t ais-shell-prova @ais_type shell` | exit 0 |
| elenco coi metadati (`listArgs`, `LIST_FORMAT`) | `& $b @L @f list-sessions -F '#{session_name}<\|>#{session_created}<\|>#{session_attached}<\|>#{@ais_type}'` | `ais-shell-prova<\|><epoch><\|>0<\|>shell` (l'app chiede tutte le `META_KEYS`) |
| match esatto (`hasArgs`) | `has-session -t '=ais-shell-prova'` / `-t '=ais-shell'` | exit 0 / exit ≠ 0 |
| attacco (`attachArgs`) | `& $b @L @f attach-session -t '=ais-shell-prova'` | si vede la shell |
| riapplicare la config (`sourceArgs`) | `& $b @L @f source-file "$PWD\app\tmux.conf"` | exit 0, nessun errore |
| stato dello scorrimento (`SCROLL_FORMAT`) | `& $b @L display-message -p -t '=ais-shell-prova:' '#{pane_in_mode}<\|>#{scroll_position}<\|>#{history_size}<\|>#{pane_height}<\|>#{alternate_on}'` | 5 campi valorizzati (prima un po' di output: `1..300`) |
| comandi concatenati con `;` (`scrollArgs`, `chain`) | `& $b @L copy-mode -e -t '=ais-shell-prova:' ';' send-keys -t '=ais-shell-prova:' -X -N 10 scroll-up ';' display-message -p -t '=ais-shell-prova:' '#{scroll_position}'` | `10` |
| salto (`scrollToArgs`, `cancelScrollArgs`) | `send-keys -X goto-line 50`, poi `send-keys -X cancel` | posizione 50, poi fuori dalla copy-mode |
| cattura con colori (`captureArgs`) | `& $b @L capture-pane -p -e -S -2000 -t '=ais-shell-prova:'` | il testo, con le sequenze di colore |
| morte (`killArgs`) | `& $b @L kill-session -t '=ais-shell-prova'` | exit 0, sparisce dall'elenco |

Se un comando fallisce, provare la variante più vicina e annotarla: serve a
decidere se adattare `lib/tmux.js` (una funzione per piattaforma, non `if`
sparsi) o spegnere quella funzione su Windows.

### Q1 bis — I test d'integrazione veri contro psmux

`tests/integration.test.js` ha 5 test su un tmux reale (ciclo di vita con
metadati e registro, mouse, alternate screen, scorrimento, scrollback). Su
Windows oggi si dichiarano saltati perché `detectTmux` dà `null`.

Per lo spike, **modifica locale da non committare** in `detectTmux`: su
`win32`, se c'è `process.env.AIS_TMUX_BIN`, usare quel binario. Poi:

```powershell
$env:AIS_TMUX_BIN = 'C:\percorso\psmux.exe'
node --test tests/integration.test.js
```

Annotare quali passano e, per gli altri, il messaggio di asserzione (sono
scritti apposta per dire *cosa* si è rotto).

### Q2, Q3, Q4 — L'app vera

Con la stessa modifica locale e `AIS_TMUX_BIN` impostata, `npm start`:

- Nuova → Terminale e Nuova → Claude in una repo: colori, box-drawing,
  resize, selezione col mouse e copia, rotella (deve scorrere la history di
  psmux, non mandare frecce alla shell).
- `Ctrl+B` inerte, nessuna barra di stato.
- Chiudere PizzaManager, poi `& $b -L aisession list-sessions`: **le sessioni
  devono esserci ancora** (Q2). Ripulire con `kill-session`.
- Riaprire: le schede si riagganciano con l'output di prima.
- 10–15 minuti con l'app chiusa e ricontrollare (lo spike del piano 5 ha
  visto morti di sessione dovute all'ambiente, non a tmux).

### Q6 — Riavvio

Una Claude con conversazione avviata e una shell; riavviare Windows; riaprire
l'app → modal «Ripristinare le sessioni di prima?», Claude riparte con
`--resume`, la shell con lo scrollback se Q7 è risolta.

### Consegna della fase 1

`docs/plans/40-risultati.md`, sul modello di `05-risultati.md`: ambiente
(Windows, psmux e da quale repo, Node, Electron), **verdetto in testa** (sì /
sì con rinunce / no), una sezione per domanda con comandi e output, la tabella
di Q1 compilata. Aggiornare la riga 40 di `README.md`.

---

## Fase 2 — dipende dal verdetto

Prima di partire, **chiedi all'utente** quale strada prendere e se fondere i
branch: è una sua decisione.

### Se psmux regge (anche con rinunce) → `feat/psmux-backend`

- `detectTmux` su `win32` accetta un binario **solo** se `-V` lo identifica
  come psmux (Q5); il tmux di MSYS2 resta escluso.
- Le funzioni che psmux non regge si spengono su Windows **in un punto solo**
  di `lib/tmux.js`.
- `replayCommand` con una variante `win32` (Q7), in `lib/scrollback-command.js`,
  con `platform` come parametro.
- Casi in `tests/windows.test.js` con `platform: 'win32'`; i test
  d'integrazione girano con psmux se installato e si dichiarano saltati se no.
- Il server psmux gira dalla cartella di psmux, non dalla nostra: non blocca i
  file dell'aggiornamento automatico.
- Nell'onboarding (piano 20) / legenda, psmux compare come tmux su Mac:
  facoltativo, con cosa si perde senza.

### Senza psmux → `feat/scrollback-senza-tmux` (riga 26b del README)

Serve in **entrambi i casi**: è ciò che hanno gli utenti Windows senza psmux.
Il lavoro è descritto in `26-scrollback-shell.md`, «Percorso B»: prima far
esistere il ripristino senza tmux (registro scritto da `app/pty.js`, stesso
file e formato), poi lo scrollback con `@xterm/addon-serialize` (fra le
`dependencies`, caricato in `index.html` come gli altri addon: la CSP non
cambia). Su Windows il modal comparirà anche dopo una chiusura normale: è
voluto, lì chiudere l'app perde davvero le sessioni.

Riusa quello che c'è già su `main` dal piano 26: `lib/scrollback.js` (store
con `0o600` + `chmodSync`, `sweep`, `shouldCapture`, `SEPARATOR`,
`MAX_LINES` = 2000); `previousSession` arriva già da `restore.js` →
`createTab` → `window.aisess.spawn`; `spawn` consuma e cancella il file di
`previousSession` dopo averlo usato.

## Trappole già note (non riscoprirle)

1. **`session` nel renderer significa «c'è tmux»**, non «identificativo»:
   `tabs.js` ci decide `detachable` e il backend di scorrimento,
   `tab-names.js` se chiamare `setLabel`, `session-order.js` ci costruisce
   chiavi `tmux:<nome>`. Senza tmux serve un campo nuovo (`restoreKey`, piano
   26), altrimenti su Windows si spegne lo scorrimento di xterm.
2. **La pulizia degli orfani deve tenere le chiavi vive E quelle del
   registro**, altrimenti cancella i file prima del modal (fix `c4f49d6`).
   Senza tmux le chiavi vive sono `[]`: il registro è l'unica protezione.
   `sweepScrollback` oggi esce su `!viaTmux`: va fatta girare anche lì.
3. **Non agganciare la pulizia a `discardRestorable`**: «Ripristina» lo chiama
   (`forget` in `renderer/restore.js`) **prima** di ricreare le schede.
4. `restorableSessions(registro, [])` e `restorePlan` funzionano già con
   `live = []`: **non vanno toccate**.
5. **Ogni comando tmux/psmux passa da `-L`**; nei test socket `aistest-…`.
6. **Il tmux di MSYS2** nel PATH non è psmux: per questo il piano 12 ha
   spento la ricerca su `win32`.
7. **Job Object**: su Windows un processo figlio può morire con il padre
   anche se «staccato». È Q2 della fase 1; vale anche per qualunque demone
   nostro.
8. **Percorsi**: niente `split('/')` né `':'` per il PATH; `path.win32` nei
   test (regole Windows di `CLAUDE.md`). `.gitattributes` forza LF: se
   `app/tmux.conf` arriva in CRLF, il checkout è vecchio.

## Come lavorare sul fisso

- Un branch per piano; refactor e correzioni in commit separati; messaggi
  `<tipo>: <cosa>` col perché nel corpo (`CLAUDE.md`, «Processo»).
- Prima della PR: `npm run test:unit` verde e smoke test dell'app (`npm
  start`); per provare l'app installata, `npm run install:win` ad app chiusa.
- Quello che emerge fuori da questo piano si annota nel piano giusto o nel
  backlog di `README.md`, non si infila nel branch.

# 26 — Lo scrollback delle shell sopravvive al riavvio

Branch: `feat/scrollback-shell` (con tmux) e `feat/scrollback-senza-tmux`
Dipende da: 6 (backend tmux), 8 (ripristino dopo riavvio) · Taglia: ~½ g + ~1 g

## Obiettivo

Chiudere e riaprire l'app non perde niente: tmux tiene vive le sessioni. Un
**riavvio della macchina** invece uccide il server tmux, e il ripristino del
branch 8 ricrea la shell nella stessa cartella ma **vuota**: si è perso cosa si
stava facendo, quali comandi erano stati dati, cosa avevano risposto.

Qui si salva il testo del terminale e lo si rimette sopra la shell nuova, come
fa VS Code con «History restored». **Il processo non torna** — un server che
girava va rilanciato — torna quello che c'era scritto sullo schermo, colori
compresi, scorribile con la rotella come il resto.

Su Windows (e su qualunque macchina senza tmux) oggi il ripristino non esiste
affatto: le sessioni muoiono già alla chiusura dell'app. Lì il lavoro è doppio
— prima far esistere il ripristino, poi dargli lo scrollback — ed è il motivo
per cui questo piano è **due branch**.

## Di chi si salva lo scrollback: solo le shell

- **`claude`, `codex`, `opencode`, `antigravity` no.** Con `--resume`
  ricaricano la conversazione da soli, e soprattutto sono TUI che disegnano
  nell'**alternate screen**: una cattura restituirebbe il fotogramma di
  un'interfaccia, non una cronologia, e rimetterlo sopra la TUI nuova
  lascerebbe residui. Il valore sarebbe negativo, non nullo.
- **Le shell sì**: è l'unico tipo la cui memoria sta tutta nello schermo.

La regola vive in una funzione (`shouldCapture`), non sparsa in `if`: quando
si vorrà includere un altro tipo si cambia lì.

## Misure (Mac dell'utente, 2026-09-25, tmux 3.7c, socket di prova)

2000 righe di output colorato, pane a 120 colonne:

| Cattura | Byte | Byte/riga |
|---|---|---|
| `capture-pane -p -e` (con colori) | 186 894 | 93 |
| `capture-pane -p` (senza colori) | 166 894 | 83 |

Output più colorato (prompt con git, `ls`, `grep --color`) costa di più: la
stima realistica è **100–300 byte/riga**, cioè **0,2–0,6 MB per sessione** a
2000 righe e **0,5–1,5 MB** a 5000. `-S -5000` su una history da 1961 righe
restituisce 1961 righe, non 5000 righe di vuoto: il tetto non gonfia i file
piccoli.

`history-limit` è 50000 (`app/tmux.conf:32`), ma salvare 50000 righe per
sessione ogni mezzo minuto sarebbe sproporzionato rispetto a quanto si scorre
davvero indietro.

## Due percorsi, una sola interfaccia

| | macOS, Linux | Windows (nessun tmux) |
|---|---|---|
| Chi cattura | il **main**, con `capture-pane` | il **renderer**, con `@xterm/addon-serialize` |
| Dove sta la history vera | tmux (`history-limit`) | xterm (`scrollback: 20000`) |
| Chi la rimette | il **comando iniziale** della sessione tmux | il **renderer**, `term.write()` prima dell'output |

Quello che i due percorsi condividono, e che va scritto una volta sola:

- **la chiave**: `previousSession`, il nome della sessione di prima, che il
  ripristino del branch 8 già porta dal registro fino a `createTab`;
- **lo store**: `lib/scrollback.js`, un file per chiave, stessi permessi,
  stessa pulizia;
- **la decisione**: `shouldCapture` (solo shell, non in alternate screen);
- **il separatore**: `── cronologia ripristinata ──`, in grigio.

Il renderer non si riempie di `if (tmux)`: chiama `Scrollback.start(tab)` e
`Scrollback.stop(tab)` sempre, ed è quel modulo a non fare nulla quando la
cattura è compito del main.

---

## Percorso A — con tmux (`feat/scrollback-shell`, ~½ g)

### Salvare

`tmux -L aisession capture-pane -p -e -S -2000 -t '=<sessione>:'`, argomenti
composti in `lib/tmux.js` come tutti gli altri (`captureArgs` + un metodo su
`createTmuxControl`), sempre con `-L` da `baseArgs`.

**Quando**: un timer nel main ogni 30 s, **solo sulle sessioni che hanno
scritto qualcosa** dall'ultimo salvataggio. Il segnale c'è già: `track()` in
`app/pty.js` è abbonato a `p.onData`, basta alzare un flag. Dieci shell ferme
non fanno nulla; una shell che macina compila un file ogni 30 s.

**Anche alla chiusura dell'app**, con un tetto di tempo: `before-quit` cattura
le sessioni sporche e lascia comunque uscire l'app entro 1 s. È un di più —
uno spegnimento brusco non lo chiama mai, ed è il timer la vera protezione:
quindi non deve mai poter impedire la chiusura.

**Non si cattura** una sessione con `alternate_on = 1` (un `less`, un `vim`
lasciato aperto): si terrebbe il file precedente, che è più utile del
fotogramma di un pager. Il campo si legge già in `SCROLL_FORMAT`.

### Ripristinare dentro tmux, non in xterm

Dietro tmux lo scrollback di xterm vale 0 (`tabs.js:148`) e tmux ridisegna
sopra: il testo va messo **nella history di tmux**, cioè stampato dentro la
sessione prima che parta la shell. La sessione nuova nasce con comando
iniziale:

```
sh -c 'cat "$AIS_SCROLLBACK"; printf "…"; exec "$AIS_SHELL"'
```

**La stringa dopo `-c` è una costante del sorgente: non contiene nulla di
interpolato.** Il percorso del file e la shell da lanciare arrivano
dall'ambiente, con `new-session -e AIS_SCROLLBACK=… -e AIS_SHELL=…`, e
l'ambiente non passa da nessun parser. Questo rispetta la regola del repo
(«i comandi dei profili vanno in `pty.spawn` senza shell»): quella regola
protegge dai comandi **dell'utente**, che non devono essere interpretati; qui
il comando è dell'app, fisso, e l'unica parte variabile non tocca la riga di
comando. Vale solo per le shell: gli agenti non passano mai di qui.

Verificato davvero (socket di prova): la sessione ripristinata ha la history
piena del testo vecchio **con i colori**, il separatore in fondo, e
`pane_current_command = zsh` — cioè la shell è quella vera, non un `sh`
intermedio, perché `exec` lo sostituisce.

### Larghezza al momento della stampa

La sessione nasce **staccata** e solo dopo il client si attacca: il pane è a
80×24 di default, e il testo verrebbe mandato a capo a 80 colonne **dentro la
history**, dove resta storto anche dopo il resize. `new-session` accetta
`-x`/`-y`: `spawn` già riceve `cols`/`rows` dal renderer e li passa. Serve
solo al ripristino, ma è giusto per tutte le sessioni.

---

## Percorso B — senza tmux (`feat/scrollback-senza-tmux`, ~1 g)

### Prima dello scrollback manca il ripristino

Senza tmux, oggi: `syncSnapshot()` esce subito (`app/pty.js:84`), quindi
`live-sessions.json` non si scrive mai; `restorable()` torna `[]`;
`offerRestore` e `reattachLiveSessions` escono su `if (!tmuxAvailable)`. Le
sessioni muoiono con l'app e nessuno chiede niente.

Quello che tmux fa da registro, lì lo fa il gestore:

- `app/pty.js` tiene i metadati della sessione (tipo, cwd, etichetta,
  `resumeId`, account, profilo) accanto al client, aggiornati da `setMeta`
  come oggi li aggiorna su tmux, e riscrive il registro agli stessi momenti
  (spawn, setMeta, terminate). **Stesso file, stesso formato**: le funzioni
  pure `restorableSessions` e `restorePlan` non cambiano di una riga.
- Senza tmux non c'è niente di vivo a cui riattaccarsi, quindi
  `restorableSessions(registro, [])` propone tutto: **è il comportamento
  giusto**, perché lì anche una chiusura normale dell'app perde le sessioni.
  Conseguenza da accettare: su Windows il modal compare anche dopo un ⌘Q
  pulito, mentre su Mac no. È la differenza vera fra le due macchine, non un
  difetto — e si continua a **chiedere**, non a far ripartire N processi da soli.
- `reattachLiveSessions` resta com'è: senza tmux non c'è nulla da riagganciare.

### La chiave non è `session`

Serve un identificativo anche senza tmux, ma **`session` nel renderer
significa «c'è tmux»**: `tabs.js:148` ci spegne lo scrollback di xterm,
`tabs.js:99` ci sceglie il backend di scorrimento, `tab-names.js` ci decide se
chiamare `setLabel`. Riusarlo per una chiave sintetica spegnerebbe lo
scorrimento su Windows.

Quindi `spawn` restituisce un campo nuovo, `restoreKey`, valorizzato sempre;
con tmux coincide col nome della sessione. Il registro lo salva in `name`, e
`restorePlan` lo rimanda indietro come `previousSession` senza sapere quale
dei due mondi l'ha generato.

### Salvare e rimettere con `@xterm/addon-serialize`

È l'addon che usa VS Code: serializza il buffer con i colori in una stringa di
sequenze ANSI. `renderer/scrollback.js` la produce ogni 30 s per le schede
shell che hanno ricevuto dati, e la manda al main con un canale nuovo
(`scrollback-save`); il main la scrive con lo stesso store del percorso A.

Al ripristino il testo torna nella risposta di `spawn` e il renderer lo scrive
nel terminale **prima** che arrivi l'output della shell: la scheda è appena
nata, nessuno ha ancora scritto, e `scrollback: 20000` è attivo perché non c'è
tmux.

Dipendenza `@xterm/addon-serialize` fra le `dependencies`, caricata in
`index.html` accanto agli altri addon (`script-src 'self'`: è un file locale,
la CSP non cambia).

---

## Riservatezza

Sullo schermo di una shell finiscono token, chiavi, `export` sbagliati. Quindi:

- file in `<userData>/scrollback/<chiave>.txt`, scritti con `mode: 0o600`
  **e** `chmodSync` dopo (`writeFileSync` applica il mode solo alla creazione:
  regola di CLAUDE.md);
- la directory la riceve lo store come parametro (`createScrollbackStore({ dir })`),
  mai `app.getPath` dentro `lib/`;
- **si cancella quando la sessione finisce davvero**: `terminate` e
  `terminateSession`, cioè la ✕ della card, che oggi termina per davvero
  (`sidebar.js:428`). **Non** su `close`/`closeAll`, che sono stacchi: lì la
  sessione vive ancora in tmux ed è proprio quella da poter ripristinare;
- **pulizia all'avvio**: i file la cui chiave non è né viva in tmux né nel
  registro sono orfani (l'app uccisa nel momento sbagliato) e vanno via.
  Senza, la cartella cresce per sempre — di file che contengono segreti.

## Pezzi

- **`lib/scrollback.js`** (puro) — `createScrollbackStore({ dir })`:
  `save(key, text)`, `read(key)`, `remove(key)`, `sweep(chiaviValide)`.
  Più `shouldCapture({ type, alternate })` e `SEPARATOR`. Modello:
  `lib/live-sessions.js`.
- **`lib/tmux.js`** — `captureArgs({ confPath, socket, name, lines })` e
  `control.capture(name, lines)`. Bersaglio `=nome:` col due punti: con
  `=nome` nudo tmux risponde «can't find pane» (verificato oggi su 3.7c, è la
  stessa trappola già annotata per lo scorrimento).
- **`lib/scrollback-command.js`** (puro) — compone il comando iniziale della
  sessione ripristinata: costante `sh -c`, valori per ambiente. Prende
  `platform`: su `win32` restituisce `null` (là ci pensa il renderer).
- **`app/pty.js`** — flag «ha scritto» in `track()`, timer, cattura, chiave
  `restoreKey`, registro anche senza tmux, `-x`/`-y` alla `new-session`,
  cancellazione in `terminate`/`terminateSession`.
- **`main.js`** — cablaggio: store, `scrollback-save`, sweep all'avvio.
  **Il tetto di righe è < 210 e il file è a 205**: va alzato, e il commit
  spiega perché (tre handler nuovi, non logica).
- **`renderer/scrollback.js`** — `start`/`stop`/`replay`, con dentro la sola
  differenza fra i due mondi.
- **`renderer/tabs.js`** — `previousSession` fino a `window.aisess.spawn`
  (oggi arriva a `createTab` e si ferma lì: `tabs.js:133`), e `replay` del
  testo restituito.
- **Test**: `tests/scrollback.test.js` (store: permessi con `fs.statSync`,
  sweep, `shouldCapture`), `tests/tmux.test.js` (`captureArgs`: socket,
  bersaglio col due punti, tetto righe), `tests/windows.test.js`
  (`platform: 'win32'`: niente comando tmux, registro scritto lo stesso,
  chiave presente), `tests/integration.test.js` (tmux vero su socket
  `aistest-…`, `t.skip` se manca: cattura → ricrea → la history contiene il
  testo vecchio).

## Trappole trovate studiando

1. **`capture-pane` vuole `=nome:`**, col due punti. Con `=nome` fallisce.
2. **La larghezza al momento della stampa resta nella history**: senza
   `-x`/`-y` il testo ripristinato è mandato a capo a 80 colonne per sempre.
3. **`session` nel renderer significa «c'è tmux»**, non «identificativo»:
   serve un campo nuovo, o su Windows si spegne lo scorrimento.
4. **La ✕ oggi termina** (una sola ✕ dal rifacimento della card): è il punto
   giusto dove cancellare il file, e non esiste più una ✕ «stacca» da cui
   guardarsi.
5. **`-S -5000` non gonfia**: su una history corta restituisce quello che c'è.
6. **La pulizia all'avvio deve tenere anche il registro** (trovata allo smoke
   test): dopo un `kill-server` tmux non ha sessioni, e una pulizia che
   guardasse solo quelle cancellava tutti i file prima del modal. E non va
   agganciata a `discardRestorable`: «Ripristina» la chiama *prima* di
   ricreare le schede.

## Verifica sull'app (la fa l'utente)

**macOS**, con due shell aperte in cartelle diverse e un po' di output
(`ls -la`, un `git log --oneline`, un comando che sbaglia e stampa in rosso):

1. aspettare ~1 minuto, poi **riavviare il Mac** (o, più veloce:
   `tmux -L aisession kill-server` da un Terminale esterno, che è ciò che il
   riavvio fa al server);
2. riaprire l'app → modal «Ripristinare le sessioni di prima?» → Ripristina;
3. la shell si riapre nella stessa cartella, con sopra il testo di prima **coi
   colori**, la riga `── cronologia ripristinata ──` e il prompt sotto;
4. la rotella scorre indietro dentro il testo ripristinato;
5. una scheda `claude` nella stessa prova **non** deve avere testo ripristinato
   (riprende la conversazione con `--resume`, come prima);
6. chiudere una shell con la ✕ e controllare che il suo file sparisca da
   `~/Library/Application Support/AISessionManager/scrollback/`;
7. `ls -l` su quella cartella: i file devono essere `-rw-------`.

**Linux** (il collega): gli stessi passi da 1 a 4, con `reboot` o
`tmux -L aisession kill-server`.

**Windows 11** (piano 24), dove non c'è tmux:

8. aprire due shell, dare qualche comando, **chiudere l'app** (non serve
   riavviare: senza tmux basta quello);
9. riaprirla → il modal «Ripristinare le sessioni di prima?» deve comparire
   (oggi non compare mai);
10. ripristinare: le shell tornano nella stessa cartella col testo di prima;
11. la rotella scorre indietro (se lo scrollback si fosse spento, è la trappola 3).

## Fuori scope

- **Il processo non torna.** Un server che girava, un `tail -f`, una sessione
  `ssh`: tornano le loro righe, non loro. Scriverlo nel modal sarebbe rumore;
  il separatore basta a dire che quello è passato.
- **Gli agenti** (vedi sopra): se un giorno servisse, `shouldCapture` è il
  punto unico da cambiare.
- **Il `.deb` e il resto della distribuzione**: piano 18.

## Scelte prese (utente, 2026-09-25)

- **2000 righe** per sessione (~0,2–0,6 MB), **ogni 30 s**, solo sulle shell
  che hanno scritto qualcosa dall'ultimo salvataggio.
- **Due branch**, in quest'ordine: prima `feat/scrollback-shell` (tmux: macOS
  e Linux, le macchine di chi sviluppa), poi `feat/scrollback-senza-tmux`.

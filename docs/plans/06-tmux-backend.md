# Branch 6 — `feat/tmux-backend`

**Dipende da**: branch 2 e branch 5. **Taglia stimata**: 3-5 giorni.

> ## Stato: fatto (2026-09-16, branch `feat/tmux-backend`)
>
> Verificato sull'app vera, a mano e con un test d'integrazione su tmux reale:
> crea una sessione → ⌘Q → riapri → la scheda torna da sola, col titolo e lo
> scrollback. Il processo dentro è lo stesso di prima (stesso pid).
>
> **Com'è fatto.** `lib/tmux.js` costruisce gli argomenti e legge l'output
> (puro, 100% coperto); `app/pty.js` in modalità tmux crea la sessione
> *staccata*, vi salva i metadati, e solo dopo apre il pty come client
> `attach-session` — così il pty è sempre e solo un client, uguale per
> sessioni nuove e riattaccate. `main.js` rileva tmux all'avvio e lo passa al
> manager; senza tmux tutto ricade sul comportamento classico.
>
> **Due scoperte in corso d'opera, oltre a quelle dello spike:**
> - **tmux cattura l'ambiente alla nascita del server** e le sessioni
>   successive ereditano quello, non l'ambiente del client che le crea. Senza
>   `new-session -e VAR=val` esplicito, un secondo profilo Claude prendeva in
>   silenzio la `CLAUDE_CONFIG_DIR` del primo. Verificato e coperto.
> - **`set-option -t` non accetta il prefisso `=`** che `has/kill/attach-session`
>   accettano: per le opzioni il nome va nudo.
>
> **I metadati vivono in tmux** (user option `@ais_*`): tipo, directory,
> etichetta, profilo, resume id, account. tmux è l'unica fonte di verità per le
> sessioni vive, niente registro parallelo. Il titolo della scheda si risalva
> quando cambia, così torna al riattacco.
>
> **UI**: la ✕ stacca (tooltip lo dice), un ⏻ accanto termina per davvero con
> conferma. Una sessione sparita nel frattempo mostra un messaggio e rimanda al
> Resume, non un errore.

---

## Il problema

Oggi l'app lancia i processi **come figli propri**:

```
App Electron
  └── node-pty ──> claude          claude è figlio dell'app
```

Quando l'app muore, i figli muoiono con lei. `window-all-closed` li uccide
esplicitamente (`main.js`, `for (const [, p] of ptys) p.kill()`).

**Quel kill non è un bug, ed è importante capire perché.** Togliendolo senza
aggiungere un percorso di riattacco si ottengono zombie invisibili: non esiste
un IPC `pty-list` per enumerare i PTY vivi, il renderer si inventa gli id
(`'tab-' + Date.now() + '-' + random`), e `p.onData` chiude sulla *variabile*
`mainWindow` — quindi dopo la riapertura i vecchi PTY manderebbero dati alla
finestra nuova, che li scarta in silenzio perché `tabs.get(id)` è `undefined`.
Processi vivi, invisibili, non uccidibili dall'interfaccia. Peggio di adesso.

Il buco non è il kill: è **l'assenza di un percorso di riattacco**. È una
funzionalità mancante, non un difetto da patchare.

## La soluzione scelta

tmux ha un **processo server che gira per conto suo** e possiede i terminali.
Quello che apri è un **client** che si collega per guardarci dentro.

```
App Electron
  └── node-pty ──> tmux (client) ──┐
                                   │  socket
        tmux server ───────────────┘   ← indipendente, NON figlio dell'app
          └── claude
```

Chiudi l'app → muore solo il client. Riapri → ti riattacchi e ritrovi tutto,
scrollback compreso. Sopravvive a ⌘Q, al crash dell'app e alla sua riapertura.

**Scartata l'alternativa** «riattacco in-process» (ring buffer dell'output nel
main + IPC `pty-list`): costa quasi uguale e dà una garanzia più debole, perché
muore comunque al ⌘Q.

## Cosa si sa già del lavoro

**Parte tecnica** — ridotta rispetto alle stime iniziali, perché lo spike ha
trovato una strada migliore:

- **Socket dedicato, non solo config file.** `tmux -f <config>` viene *ignorato*
  se un server tmux è già attivo sulla macchina (caso comune: l'utente usa tmux
  per conto suo, o un altro strumento lo usa — sulla macchina di prova c'erano
  quattro sessioni del CLI `xirp`). Serve `tmux -L aisession`, che dà all'app un
  server proprio.
- **Conseguenza gradita**: `tmux -L aisession ls` elenca solo le sessioni
  dell'app. Il filtro per prefisso di nome previsto in origine **non serve più**.
- ⚠️ **Ogni comando tmux dell'app deve passare per `-L aisession`.** Un
  `tmux kill-server` senza socket ammazzerebbe le sessioni personali dell'utente.
- **Configurazione da distribuire** (verificata funzionante):
  ```tmux
  set -g prefix None      # Ctrl+B arriva all'app ospitata
  unbind C-b
  set -g default-terminal "tmux-256color"
  set -as terminal-features ",xterm-256color:RGB"
  set -g escape-time 0
  set -g history-limit 50000
  set -g status off       # tmux deve essere invisibile
  set -g mouse on
  ```
- **Comando da eseguire**:
  ```
  tmux -L aisession -f <config> new-session -A -s <nome> -- <cmd> <args>
  ```
  `-A` riattacca se la sessione esiste, la crea altrimenti: è la primitiva su cui
  poggia tutto il riattacco.
- `tmux` entra nel resolver dei binari con i suoi candidati (`/opt/homebrew/bin`,
  `/usr/local/bin`, `/usr/bin`) — l'infrastruttura esiste già.
- All'avvio il renderer ricostruisce le schede dalle sessioni vive.
- `window-all-closed` non uccide più: stacca.
- Fallback quando tmux non c'è: comportamento attuale più un avviso.

**Parte di prodotto** (più grande — è questa a mangiare i giorni):

- La sidebar smette di mostrare «le schede aperte in questa finestra» e passa a
  mostrare «le sessioni che esistono sulla macchina». Apri l'app e trovi già roba
  dentro, anche se era chiusa da ieri.
- La ✕ diventa ambigua. Oggi «chiudi scheda» e «termina processo» coincidono;
  dopo sono due azioni distinte, **stacca** e **termina**, e vanno rese esplicite
  in UI. Se non lo sono, l'utente crede di aver chiuso tutto e accumula sessioni
  tmux invisibili — lo stesso problema degli zombie, spostato di un livello.
- Nascono due categorie di ripresa da separare nell'interfaccia: le sessioni
  **vive**, a cui ci si riattacca davvero, e quelle **morte**, che si ricreano col
  resume nativo di `claude`/`opencode`. Se stanno nello stesso posto, l'utente non
  capisce perché a volte ritrova lo schermo com'era e a volte no.

## Criteri di uscita — verificati

- ✅ Apri una sessione, ⌘Q, riapri l'app: la ritrovi attaccata e con lo scrollback.
- ✅ Senza tmux installato l'app funziona come oggi (`viaTmux=false`, stessi test).
- ✅ Non è possibile lasciare sessioni tmux orfane senza accorgersene: all'avvio
  tutte le sessioni vive tornano come schede.
  - **Rivisto dopo l'uso (22/09/2026).** I due pulsanti erano uno di troppo: per
    scegliere fra ✕ (stacca) e ⏻ (termina) bisognava sapere che cos'è tmux, e la
    differenza non si vedeva dalla card. Ora la ✕ è una sola e **termina**, con
    una conferma in un fumetto appoggiato alla card
    (`renderer/confirm-bubble.js`). Lo stacco resta dov'è naturale: chiudendo
    l'app le sessioni restano vive e tornano alla riapertura — che è il motivo
    per cui esiste questo backend. Staccare una singola sessione tenendo l'app
    aperta non ha più un comando: non serviva a niente che la card non facesse
    già (la sessione la si lascia lì e basta).
- ✅ Test d'integrazione su tmux reale (`tests/integration.test.js`), su un
  socket dedicato al test: le sessioni reali dell'app non si toccano.
- ✅ **Scorrimento (23/09/2026).** Nella shell la rotella non scorreva: tmux
  ridisegna il terminale esterno con `CSI n S` e xterm.js quelle righe non le
  mette nello scrollback (buffer di 24 righe dopo `seq 200`; forzando i newline
  lo scrollback compare ma a buchi, perché tmux salta i fotogrammi). La history
  vera è quella di tmux: rotella e barra laterale (`renderer/term-scroll.js`)
  muovono la copy-mode (`scrollArgs`/`scrollToArgs` in `lib/tmux.js`), un tasto
  premuto la chiude prima di arrivare al programma (`app/pty.js`). Con tmux lo
  scrollback di xterm è a 0; senza tmux la barra scorre quello di xterm. Le TUI
  che chiedono il mouse tengono la rotella; nell'alternate screen (less, vim)
  la rotella manda frecce, come farebbe xterm.
- ✅ **Barra nelle TUI a schermo intero (23/09/2026).** claude, opencode e codex
  girano nell'alternate screen col mouse acceso: tmux ha `history_size` 0 e la
  barra restava nascosta. La history è del programma e da fuori non si vede:
  la barra ne stima la posizione contando gli scatti di rotella inviati (xterm
  ne manda uno per evento), esatta in fondo e indicativa salendo. Click e
  trascinamento generano eventi `wheel` sull'elemento di xterm, che li codifica
  per il programma (SGR/X10) come quelli veri. Scrivere riporta la stima in
  fondo; uscire dall'alternate screen la azzera. Acceso, il cursore prende
  `--type-color` (il wrap del terminale porta la classe `type-*`).

## Rimasto fuori, volutamente

- Ridimensionamento a due livelli: con `window-size latest` in config e un solo
  client per sessione non si è visto nessun problema, ma non è stato provato con
  due client sulla stessa sessione (caso che l'app non produce).
- Elenco delle sessioni vive *staccate* nel dialog Resume: oggi tornano tutte
  come schede all'avvio, che è più semplice. Se diventano tante, andrà ripensato.

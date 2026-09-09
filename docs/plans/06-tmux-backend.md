# Branch 6 — `feat/tmux-backend`

**Dipende da**: branch 2 e branch 5. **Taglia stimata**: 3-5 giorni.

> ## Stato: sbloccato, si può cominciare
>
> Lo [spike](05-spike-tmux.md) è stato eseguito il 2026-09-09 con esito positivo
> su tutte e quattro le domande: vedi [i risultati](05-risultati.md). Le sezioni
> qui sotto contengono la configurazione reale, verificata sul campo.
>
> La sopravvivenza dei processi alla chiusura dell'app è confermata fino a 15
> minuti senza client attaccato, sia per una shell che per `claude`.
>
> **Requisito emerso dallo spike**: su una macchina sotto pressione di memoria le
> sessioni staccate possono essere uccise dal sistema. Il riattacco deve quindi
> gestire il caso «sessione sparita» come normale, non come errore — vedi
> [i risultati](05-risultati.md), Q4.

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

## Criteri di uscita (bozza)

- Apri tre sessioni, ⌘Q, riapri l'app: le ritrovi attaccate e con lo scrollback.
- Ripeti uccidendo l'app da Monitoraggio Attività invece che con ⌘Q.
- Senza tmux installato l'app funziona come oggi, con un avviso.
- Non è possibile lasciare sessioni tmux orfane senza essersene accorti.

## Ancora da definire

- Lo schema di naming delle sessioni (deve sopravvivere ai riavvii e mappare
  a tipo + directory).
- **Il ridimensionamento a due livelli** (client tmux vs finestra tmux) non è
  stato provato sistematicamente: nello spike la finestra è stata ridimensionata
  senza problemi evidenti, ma non è un test rigoroso. Da verificare presto,
  perché tocca `refitTab` e la logica di `ResizeObserver` già esistente.
- Il disegno delle due azioni **stacca** / **termina** in UI.
- Il comportamento quando una sessione attesa non esiste più (mietuta dal
  sistema): va degradata a «ricreabile via resume», senza errori criptici.

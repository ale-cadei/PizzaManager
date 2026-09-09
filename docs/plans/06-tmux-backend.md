# Branch 6 — `feat/tmux-backend`

**Dipende da**: branch 2 e branch 5. **Taglia stimata**: 3-5 giorni.

> ## ⚠ Questo piano è volutamente incompleto
>
> Va compilato **dopo** [lo spike](05-spike-tmux.md), non prima. Scriverlo adesso
> significherebbe indovinare: se lo spike scopre che serve una configurazione
> tmux particolare, o che `Ctrl+B` va gestito in un certo modo, metà del piano
> cambierebbe. Meglio uno stub onesto che dieci pagine da buttare.
>
> Qui sotto c'è solo quello che si sa già con certezza.

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

**Parte tecnica** (piccola, e in buona parte riusa quello che c'è):

- `tmux` entra nel resolver dei binari con i suoi candidati (`/opt/homebrew/bin`,
  `/usr/local/bin`, `/usr/bin`) — l'infrastruttura esiste già.
- **Configurazione tmux isolata**, distribuita con l'app e passata con `tmux -f`.
  Senza, l'app eredita il `.tmux.conf` personale di chi la usa: comportamento
  diverso da macchina a macchina e bug irriproducibili.
- `buildCommand` avvolge il comando in `tmux new-session -A -s <nome> -- ...`.
- La scoperta delle sessioni la fa `tmux ls -F`, che sostituisce il `pty-list`
  che nell'alternativa scartata sarebbe stato da scrivere a mano.
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

## Da compilare dopo lo spike

- La configurazione tmux minima da distribuire.
- Lo schema di naming delle sessioni.
- Come si comporta il ridimensionamento a due livelli (client tmux vs finestra).
- Il disegno delle due azioni **stacca** / **termina** in UI.

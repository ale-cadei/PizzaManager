# Risultati dello spike tmux — 2026-09-09

Eseguito su macOS 25.5 (arm64), tmux 3.7c da Homebrew, Electron 33.4.11.
Branch del codice usa-e-getta: `spike/tmux`, commit `699a090`. **Non va mergiato.**

---

## Verdetto

**L'opzione B è confermata: il branch 6 si può fare.** Le TUI di `claude` e
`opencode` attraversano tmux e xterm.js senza degrado, il prefisso si disattiva
e i processi sopravvivono alla chiusura dell'app.

Con una riserva aperta, in fondo a questa pagina, che va chiusa prima di
cominciare il branch 6.

---

## Q1 — Le TUI reggono dentro tmux?

**Sì, entrambe.**

`claude` disegna correttamente box-drawing, marker e prompt. Emette solo colori
a 256 (`38;5;153`, `38;5;220`, `38;5;246`), quindi per lui la questione del
truecolor non si pone nemmeno.

`opencode` usa davvero il truecolor (`38;2;245;167;66` e simili) e **tmux lo
passa intatto**, verificato catturando i byte del pane:

```bash
tmux capture-pane -p -e -t <sessione> | cat -v | grep -o '\^\[\[38;2;[0-9;]*m'
```

Risultato: `^[[38;2;255;100;0m` conservato, nessun declassamento a `38;5;N`.
Funziona **anche con la configurazione di default** (`-f /dev/null`): tmux 3.7
non ha bisogno di `terminal-features` per questo. La riga di config resta
comunque, non fa danno ed è esplicita.

## Q2 — E dentro xterm.js?

**Sì.** Verificato a schermo dentro l'app con il wrapper attivo: rendering
identico, nessuno sfarfallio, nessun testo tagliato.

> Durante la prova la UI dell'app appariva rotta (font serif ovunque). **Non
> c'entra tmux**: su `main` manca il file `renderer/tokens.css`, mai committato
> nel commit dei design token `e6c551a`. L'`@import` fallisce, i 28 token
> restano indefiniti e `font-family: var(--font-ui)` ricade su serif. È un
> difetto a sé, da correggere con un hotfix: il terminale — l'unica cosa che
> interessava allo spike — era integro perché il suo tema è hardcoded in
> `renderer.js`, non nei token.

## Q3 — `Ctrl+B` viene mangiato da tmux?

**No, con `set -g prefix None`.** Verificato sul socket vivo dell'app:

```
prefix None
status off
```

Restano due binding su `C-b`, ma solo nelle tabelle `copy-mode` / `copy-mode-vi`,
e in copy mode ci si entra col prefisso — che è disattivato. Sono irraggiungibili.

Nota: `Cmd+B` non è un test valido. Su macOS le combinazioni con ⌘ non vengono
trasmesse al terminale, quindi "non fa niente" a prescindere da tmux.

## Q4 — Sopravvivenza alla chiusura dell'app

**Osservato positivo**, con una riserva.

Chiusa la finestra dell'app:

```
processi Electron dell'app:  0
sessione tmux:               ais-claude-Users-jack   VIVA
claude:                      pid 5509, in esecuzione da 5:05
scrollback:                  intatto
```

**La riserva**: qualche minuto dopo quella verifica la sessione era sparita, e
non è stato catturato il perché. Le ipotesi sono due — `claude` che esce da solo
quando nessun client è attaccato, oppure il gestore di memoria del sistema, che
in quella finestra temporale aveva già ucciso un altro processo per memoria bassa.

**Distinguerle è obbligatorio prima del branch 6**: una funzionalità che tiene
vive le sessioni per cinque minuti e poi le perde è peggio di non averla, perché
l'utente ci fa affidamento. Verifica in corso con due sonde parallele senza
client attaccato: un processo banale con heartbeat (se muore, è tmux o il
sistema) e un `claude` (se muore solo lui, è comportamento di claude).

---

## La scoperta che vale lo spike

**`tmux -f <config>` non isola niente se un server tmux è già attivo.**

Sulla macchina di prova c'erano già quattro sessioni del CLI `xirp`. Lanciando
`tmux -f nostra-config new-session`, la sessione si è agganciata a **quel**
server e ha ereditato la sua configurazione: `prefix` restava `C-b` e la status
bar restava accesa, come se il file non esistesse. Il flag `-f` vale solo quando
tmux avvia un server nuovo.

**La soluzione è un socket dedicato**: `tmux -L aisession -f <config>`. Con quello:

- la configurazione viene applicata davvero (verificato: `prefix None`, `status off`, `history-limit 50000`);
- l'app ha un server tutto suo, isolato da quello personale dell'utente;
- `tmux -L aisession ls` mostra **solo** le sessioni dell'app — quindi il filtro
  per prefisso di nome previsto nel piano 06 non serve più;
- le sessioni personali dell'utente non vengono mai toccate.

⚠️ **Corollario operativo**: `tmux kill-server` senza `-L` ammazzerebbe le
sessioni personali dell'utente. Ogni comando dell'app deve passare per il proprio
socket, sempre.

## Configurazione che ha funzionato

```tmux
set -g prefix None
unbind C-b
set -g default-terminal "tmux-256color"
set -as terminal-features ",xterm-256color:RGB"
set -g escape-time 0
set -g history-limit 50000
set -g status off
set -g mouse on
```

Da distribuire con l'app e passare come `tmux -L aisession -f <questo file>`.

## Comando che l'app dovrà eseguire

```
tmux -L aisession -f <config> new-session -A -s <nome> -- <cmd> <args>
```

`-A` fa sì che si riattacchi se la sessione esiste già, e la crei altrimenti:
è la primitiva su cui poggia tutto il riattacco del branch 6.

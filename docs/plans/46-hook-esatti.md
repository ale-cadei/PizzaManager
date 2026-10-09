# 46 — `feat/hooks-esatti`: segnale esatto dagli agenti (lavora / ha finito / chiede un permesso)

## Cosa

Oggi la card di una sessione dice due cose, entrambe **dedotte dall'output**
del pty: «sta lavorando» (`renderer/running.js`, barra animata) e «ha finito»
(`renderer/attention.js`, lampeggio). L'euristica distingue male «ha finito»
da «ti chiede un permesso»: tutte e due sono output che si ferma.

Gli agenti sanno in che stato sono e lo dicono tramite hook. Il branch li usa
per Claude, opencode e Codex:

| Stato | Card | Notifica di sistema |
|---|---|---|
| `running` | barra animata, lampeggio spento | — |
| `waiting` (ha finito) | lampeggio di oggi | «‹Agente› ha finito» (di oggi) |
| `permission` (chiede un permesso) | **lampeggio più rapido**, stesso colore della sessione | «‹Agente› chiede un permesso» |

Antigravity resta sull'euristica: i suoi hook stanno solo in
`~/.gemini/config/hooks.json` (globale), non iniettabili per processo. Nota in
`idee.md`.

### Vincolo: niente nella config dell'utente

Nessun file in `~/.claude`, `~/.codex`, `~/.config/opencode` viene toccato.
Ogni meccanismo vale per il solo processo lanciato dall'app:

| Agente | Meccanismo (verificato il 2026-10-08) |
|---|---|
| Claude 2.1.x | `--settings '<json>'`: gli hook si **sommano** a quelli dell'utente (le liste si uniscono). Va ripassato a ogni `--resume`, quindi a ogni spawn. |
| opencode 1.18 | env `OPENCODE_CONFIG_CONTENT='{"plugin":["file:///…/opencode-signal.mjs"]}'`: unito alla config dell'utente, i suoi plugin restano. Il plugin gira dentro opencode. |
| Codex 0.143 | gli hook iniettati vengono **saltati** (fiducia per hash in `[hooks.state]`; l'unico scavalco è `--dangerously-bypass-hook-trust`, escluso). Si usa invece `-c tui.notifications=true -c tui.notification_method=osc9 -c tui.notification_condition=always`: Codex scrive OSC 9 nel terminale a fine turno e alle richieste di approvazione. |

## Canale: un file di stato per sessione

```
hook / plugin ──printf──▶ <userData>/signals/<id> ──fs.watch──▶ main ──IPC agent-signal──▶ renderer
Codex ──OSC 9 nel pty──▶ xterm (registerOscHandler(9)) ──────────────────────────────────▶ renderer
```

- Allo spawn `app/pty.js` mette nell'env `AISESS_SIGNAL_FILE=<userData>/signals/<id>`
  (con tmux: `new-session -e`, come il resto dell'env di sessione).
- Il file contiene una parola: `ready`, `running`, `waiting`, `permission`.
  Contenuto vuoto, ignoto o a metà scrittura → ignorato (si legge con `trim()`).
- Sopravvive all'app chiusa: alla riapertura il main legge gli stati presenti,
  un `permission` scritto nel frattempo fa lampeggiare la card.
- All'avvio si cancellano i file di sessioni che tmux non ha più; alla
  chiusura di una sessione, il suo.

### Hook di Claude (dentro `--settings`)

| Evento | Matcher | Scrive |
|---|---|---|
| `SessionStart` | — | `ready` |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | — | `running` |
| `Notification` | `permission_prompt\|elicitation_dialog` | `permission` |
| `Stop`, `StopFailure` | — | `waiting` |

Ordine reale: `PreToolUse` → richiesta di permesso → (concesso) `PostToolUse`.
Il diniego chiude il turno con `Stop`.

Comandi fissi, l'evento è noto da quale hook scatta: niente parsing di stdin,
niente `node`, niente percorso di Electron (con AppImage cambia a ogni avvio,
e un Claude in tmux sopravvive all'app).
- Unix: `printf running > "$AISESS_SIGNAL_FILE"`
- Windows: `"shell": "powershell"` esplicito (con Git Bash installato Claude
  usa bash per la forma shell, `cmd` non è garantito):
  `Set-Content -NoNewline -LiteralPath $env:AISESS_SIGNAL_FILE -Value running`

### Plugin opencode (`opencode-signal.mjs`)

Scritto dall'app in `userData` all'avvio (percorso stabile, fuori da
`app.asar`: lo legge un processo esterno). Il contenuto viene da
`lib/agent-hooks.js` come stringa, così è provabile.

| Evento | Scrive |
|---|---|
| caricamento del plugin | `ready` |
| `session.status` `busy` / `retry` | `running` |
| `session.status` `idle` | `waiting` |
| `permission.updated`, `question.asked` | `permission` |
| `permission.replied`, `question.replied`, `question.rejected` | `running` |

Scrive solo se `process.env.AISESS_SIGNAL_FILE` esiste. Errori di scrittura
inghiottiti **dentro il plugin** (un nostro errore non deve rompere opencode);
è l'unico punto in cui si tace, perché lì non c'è un log nostro.

### Codex (OSC 9)

- Primo passo del branch, prima di scrivere il resto: verificare che OSC 9
  attraversi tmux (socket di prova). Se tmux lo inghiotte, provare
  `set -g allow-passthrough on` in `app/tmux.conf`. Registrare quale testo
  manda Codex nei due casi (fine turno, approvazione): da lì la regola che
  distingue `waiting` da `permission`.
- Se OSC 9 non passa in nessun modo: ripiego su `-c notify=[…]` (non
  soggetto alla fiducia degli hook) che dà solo `waiting`, e il permesso resta
  all'euristica. Annotarlo qui.
- Il «sta lavorando» di Codex resta euristico (non c'è un evento esatto).

## Regole (`renderer/agent-state.js`)

Per sessione, modulo UMD puro come `attention.js`, orologio iniettato:

- `exact = false` alla nascita. Il primo segnale (qualunque, file o OSC 9) lo
  porta a `true`: da lì l'euristica del lampeggio è spenta per quella
  sessione. Se gli hook non arrivano mai (versione vecchia, policy
  `allowManagedHooksOnly`, OSC 9 inghiottito) resta tutto come oggi.
- `running` → barra accesa; lampeggio (di ogni tipo) spento.
- `waiting` → barra spenta; «ha finito» **solo se c'è stato un `running`
  dall'ultima visita**. Così avvio e `--resume` non accendono niente, senza
  finestre di tempo.
- `permission` → barra spenta; lampeggio rapido e notifica, sempre.
- Scheda sotto gli occhi (attiva e finestra col focus): niente lampeggio, come
  oggi. Tornarci lo spegne (`seen`).
- Codex: OSC 9 accende `waiting`/`permission`; l'output che riprende spegne
  come oggi (`resumed`).

## Dove

- `lib/agent-hooks.js` (nuovo, puro): `injectFor(type, { signalFile, pluginPath, platform, args, env })`
  → `{ args, env }` da aggiungere; JSON degli hook di Claude per `platform`;
  sorgente del plugin opencode. **Non inietta** se il profilo ha già
  `--settings` (Claude) o `OPENCODE_CONFIG_CONTENT` (opencode): la sessione
  resta sull'euristica invece di sovrascrivere la scelta dell'utente.
- `lib/agent-signals.js` (nuovo, store con `{ dir }`): `pathFor(id)`,
  `read(id)`, `readAll()`, `remove(id)`, `prune(liveIds)`, `watch(cb)`,
  `writePlugin()`.
- `app/pty.js`: allo spawn env `AISESS_SIGNAL_FILE` + iniezione; `remove` alla
  chiusura; `prune` all'avvio insieme al ripristino.
- `main.js`: crea lo store, `watch` → `agent-signal`, canale per lo stato
  iniziale.
- `preload.js`: `onAgentSignal`, `agentSignals()`.
- `renderer/agent-state.js` (nuovo) + `index.html` (ordine di caricamento,
  `tests/renderer-load.test.js`).
- `renderer/signals.js`: riceve i segnali, `registerOscHandler(9)` per Codex,
  salta l'euristica quando `exact`.
- `renderer/notify.js` / `app/notify.js`: testo «chiede un permesso».
- CSS: `.needs-permission`, stesso keyframe del lampeggio con durata più
  breve, colore della sessione.

## Sicurezza

- Il JSON di `--settings` è costruito da noi, senza input esterno: il comando
  scrive una parola costante nel percorso di una env che passiamo noi.
- `id` della sessione nel nome del file: solo i caratteri già ammessi per i
  nomi di sessione tmux; `pathFor` rifiuta separatori e `..`.
- I file di stato non contengono segreti: mode di default.

## Test

- `tests/agent-hooks.test.js`: iniezione per tipo; `platform: 'win32'`; rinuncia
  con `--settings`/`OPENCODE_CONFIG_CONTENT` già presenti; JSON valido; il
  sorgente del plugin importato da una tmpdir e chiamato con eventi finti
  scrive i valori giusti (e niente senza env).
- `tests/agent-signals.test.js`: tmpdir; read/readAll/remove/prune; contenuti
  sporchi; `pathFor` rifiuta id malformati; `watch` segnala una scrittura.
- `tests/agent-state.test.js`: le transizioni sopra (avvio, resume, permesso
  senza running, scheda guardata, Codex).
- `tests/integration.test.js` (`t.skip` se manca il tool): `claude --settings
  '<json>' --help` accettato; OSC 9 di Codex attraverso tmux (socket
  `aistest-…`).
- Smoke nell'app: Claude e opencode con un permesso su una scheda in secondo
  piano e finestra dietro (lampeggio rapido + notifica); risposta → barra;
  fine turno → lampeggio normale. Riavvio dell'app con un permesso pendente.

## Fuori

- Antigravity (vedi sopra).
- Rispondere al permesso dalla notifica o dalla card.
- Usare il testo del permesso (tool, comando) oltre al nome dell'agente.

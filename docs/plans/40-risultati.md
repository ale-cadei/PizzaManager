# Risultati dello spike psmux — 2026-10-08 / 2026-10-10

Eseguito su Windows 11 Pro 10.0.26200 (x64), **psmux 3.3.8** (`66cf613`,
2026-08-18) dallo zip ufficiale di <https://github.com/psmux/psmux> (SHA-256
verificato con quello della release), Node 24.19.0, Electron 33.4.11.
Branch: `spike/psmux`. La modifica a `detectTmux` usata per le prove (su `win32`
il binario da `AIS_TMUX_BIN`, la config da `AIS_TMUX_CONF`) **non è committata**:
si rifà in tre righe, vedi «Come rifare le prove».

`psmux/psmux` è l'originale ed è mantenuto (3.6k stelle, push quotidiani);
`wojtek/psmux` è un suo fork senza release.

---

## Verdetto

**Sì, con rinunce.** La persistenza c'è tutta, ed è lo stesso modello di Mac:

- le sessioni **sopravvivono alla chiusura dell'app** e le schede si
  **riagganciano** alla riapertura (Q2);
- dopo uno spegnimento il registro c'è, il modal compare, **Claude riparte con
  `--resume`** sulla conversazione giusta (Q6);
- lo scrollback delle shell si può ristampare in PowerShell (Q7).

Ma psmux **non è un multiplexer trasparente** come tmux: il suo client è una TUI
(ratatui + crossterm) che ridisegna lo schermo da sé, e alcune scelte sono
cablate nel codice, non nella config. Tre difetti contano:

| | Difetto | Peso | Rimedio |
|---|---|---|---|
| 1 | **Niente selezione col mouse**: il client attiva sempre la cattura del mouse | **bloccante** per l'uso quotidiano | da trovare in fase 2 (vedi Q4) |
| 2 | **L'ultima riga del terminale resta vuota**: il client riserva sempre una riga alla barra di stato, anche con `status off` | cosmetico | issue a psmux |
| 3 | **Il prefisso non si spegne** (`prefix None` scartato): Ctrl+B apre finestre psmux | risolto | config a parte per psmux, prefisso su `C-M-S-F12` |

Poi rinunce minori: lo scorrimento comandato dall'app (catene con `;`) non
funziona, e Ctrl+B arriva a PowerShell come `^B` letterale. Dettagli sotto.

---

## Q1 — psmux capisce gli argomenti di `lib/tmux.js`?

**Quasi tutti.** Provati con uno script Node che chiama le funzioni **vere** di
`lib/tmux.js` e le esegue con `execFile`, come fa l'app (così il quoting di
PowerShell non falsa niente). Socket `aistest-psmux`.

| Cosa | Funzione | Esito |
|---|---|---|
| nascita con dimensioni, cwd, env | `spawnArgs`, `sizeArgs` | ✅ exit 0 |
| la variabile arriva al processo | `-e FOO=bar` | ✅ `FOO=bar` |
| il PATH del client arriva al comando iniziale | `create()` | ✅ primo elemento del PATH = quello del client |
| metadati, anche con `òà €` | `metaArgs` | ✅ |
| elenco coi metadati | `listArgs`, `parseSessionList` | ✅ tutti i 12 campi, accenti intatti |
| match esatto | `hasArgs` | ✅ `=ais-shell-prova` exit 0, `=ais-shell` exit 1 |
| attacco | `attachArgs` | ✅ (con node-pty e nell'app) |
| riapplicare la config | `sourceArgs` | ✅ exit 0, ma vedi Q4 |
| stato dello scorrimento | `scrollStateArgs`, `parseScrollState` | ✅ 5 campi valorizzati |
| **comandi concatenati con `;`** | `chain`, `scrollArgs`, `scrollToArgs` | ❌ vedi sotto |
| `send-keys -X -N 10 scroll-up` | — | ⚠️ scorre **una** riga, `-N` ignorato |
| `send-keys -X goto-line 50` | — | ❌ la posizione resta 0 |
| `send-keys -X cancel` | `cancelScrollArgs` | ✅ esce dalla copy-mode |
| cattura con colori | `captureArgs` | ✅ testo e sequenze SGR |
| morte | `killArgs` | ✅ sparisce dall'elenco |

**Le catene non esistono.** Il `;` come argomento a sé non separa i comandi:

```
psmux -L aistest-psmux display-message -p A ';' display-message -p B
→ A ; display-message B
psmux -L aistest-psmux copy-mode -e -t =s: ';' display-message -p -t =s: '#{pane_in_mode}…'
→ (niente: esegue solo copy-mode)
```

Con `\;` è uguale. Eseguiti uno per volta, `copy-mode` e `cancel` funzionano.

**Avviso innocuo** alla nascita del server: `app/tmux.conf:16: unknown option
'terminal-features'`. I colori arrivano lo stesso (Q3).

## Q1 bis — I test d'integrazione contro psmux

**Non dicono niente su psmux.** I 5 test tmux di `tests/integration.test.js`
lanciano `/bin/sh` e `sleep`, che su Windows non esistono: falliscono prima di
arrivare a psmux (`"Shell di prova": /bin/sh non è un eseguibile valido`,
`CreateProcessW "sleep 30" … os error 2`). La loro sostanza (mouse, alternate
screen, scorrimento, cattura) è coperta qui da Q1, Q4 e Q7. In fase 2 servono
varianti Windows con `powershell.exe`.

## Q2 — Il server sopravvive alla chiusura di PizzaManager?

**Sì.** Chiusa la finestra di prova, da fuori:

```
ais-claude-… attached=0 type=claude
ais-shell-…  attached=0 type=shell
```

Riaperta l'app, entrambe `attached=1` con l'output di prima. Verificato due
volte, la seconda con l'app lanciata con un ambiente pulito.

Perché regge: il server nasce con `CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP
| CREATE_BREAKAWAY_FROM_JOB` (`src/platform.rs`), quindi esce dalla console e
dal Job Object del padre. Se il job vieta il breakaway ripiega senza flag, e lì
morirebbe col padre: non è il caso di Electron.

**Ogni sessione è un processo server a sé** (`~/.psmux/servers/<socket>__<nome>`),
non un server unico come tmux. L'ambiente di una sessione è quello del client
che la crea, più i `-e`.

Non verificato: una sessione staccata per 15 minuti di fila (il piano 5 l'aveva
fatto per tmux). Le prove sono durate qualche minuto alla volta.

## Q3 — Le TUI e PowerShell reggono dentro psmux dentro xterm.js?

**Sì** per PowerShell e `claude`: colori, box-drawing, resize, Invio, Ctrl+B
come «indietro» nell'input di Claude. Verificato a schermo dall'utente.
`codex` e `opencode` non provati (opencode non è installato su questa macchina).

**Rinuncia minore**: in **PowerShell** Ctrl+B compare come `^B` letterale invece
di spostare il cursore (PSReadLine). In Claude funziona. Probabile difetto di
come psmux ricodifica i Ctrl+lettera verso ConPTY; da segnalare.

## Q4 — `app/tmux.conf` viene applicata?

**In parte.** `status off`, `mouse off`, `escape-time 0`, `history-limit 50000`,
`window-size latest`, `default-terminal`, `mode-style` passano. Il resto no:

- **`set -g prefix None` viene scartato** in silenzio: `parse_key_name("None")`
  non riconosce il nome e il prefisso resta `C-b`. Con un client attaccato,
  Ctrl+B seguito da `c` apre una seconda finestra. Rimedio provato: prefisso su
  una combinazione che nessuno preme, `set -g prefix C-M-S-F12`. Ctrl+B arriva
  allora all'applicazione. `app/tmux.conf` non si può cambiare (su Mac serve
  `None`), quindi in fase 2 serve **una config per psmux**.
- **`terminal-overrides ',*:smcup@:rmcup@'` ignorato**, ma non per la config:
  il client entra **sempre** nello schermo alternativo e attiva **sempre** la
  cattura del mouse (`src/main.rs`, `execute!(stdout, EnterAlternateScreen, …,
  EnableMouseCapture, …)`).
- **Una riga in meno**: client a 140×40 → pane 140×39 con `status off`. Il
  client riserva `max(status_lines, 1)` righe (`src/client.rs`, `.max(1)`).

**Conseguenze nell'app**, verificate dall'utente:

- **la selezione col mouse non funziona**: xterm.js vede un'applicazione che
  ha chiesto il mouse e gli manda il drag invece di selezionare;
- **la rotella invece scorre**, ma per la strada di psmux: con il mouse
  catturato `renderer/term-scroll.js` lascia la rotella all'«applicazione», e
  psmux scorre da sé (`scroll-enter-copy-mode on`). La strada dell'app
  (`scrollArgs`, le catene) non entra mai in gioco. La barra di scorrimento
  laterale invece passa da `scrollTo`, che su psmux non funziona.

**Il server caldo.** psmux tiene pronto un server `__warm__` per il prossimo
`new-session`, ma lo riusa solo per sessioni senza config, comando, cartella,
`-e` e dimensioni: l'app passa sempre tutti e cinque, quindi è solo un processo
in più. `set -g warm off` nella config per psmux.

## Q5 — Come si distingue psmux dal tmux di MSYS2?

**Dalla seconda riga di `-V`**, uguale per i tre binari dello zip (`psmux.exe`,
`tmux.exe`, `pmux.exe`):

```
tmux 3.3.8
psmux 3.3.8 (66cf613 2026-08-18)
```

Il tmux di MSYS2/Cygwin stampa solo `tmux 3.x`. `detectTmux` può accettare un
binario su `win32` solo se l'output contiene una riga che comincia con `psmux `.

## Q6 — Dopo un riavvio

**Sì, tutta la catena.** Successo per caso il primo giro: l'8 ottobre alle 22:49
il PC è stato spento. Il server psmux è morto, com'è atteso, e
`live-sessions.json` era pieno. Alla riapertura il modal «Ripristinare le
sessioni di prima?» è comparso e il ripristino ha ricreato le schede.

Claude però era ripartito vuoto, per due motivi indipendenti da psmux:

1. nessun messaggio era stato scritto, quindi non c'era una conversazione;
2. l'app di prova era lanciata **da dentro una sessione di Claude Code**, e le
   sessioni ereditavano `CLAUDE_CODE_CHILD_SESSION`: il Claude nella scheda
   diceva *«Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
   marker»* e non salvava niente.

Rifatta con l'ambiente ripulito (`env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDECODE
…`): scritto «ciao», `@ais_resume_id` valorizzato sulla sessione psmux e in
`live-sessions.json`. Poi `psmux -L aisession kill-server` ad app chiusa,
come simulazione del riavvio. Riaperta l'app: modal, **Ripristina**, e Claude è
ripartito con `--resume` mostrando il «ciao» e la risposta.

> **Trappola**: con l'avvio rapido di Windows, «Arresta il sistema» iberna il
> kernel e `LastBootUpTime` **non cambia** (diceva 4 ottobre). I processi
> dell'utente muoiono comunque. Per sapere se c'è stato uno spegnimento
> servono gli eventi di sistema: `Winlogon 7002` (disconnessione) e
> `Kernel-Boot 27` con tipo `0x1` (ripristino da ibernazione).

## Q7 — Lo scrollback si ristampa in PowerShell?

**Sì, per PowerShell.** Su Windows non c'è `exec`, ma per PowerShell non serve
un guscio: la shell stessa stampa il file e resta interattiva. Script costante,
file e separatore dall'ambiente, come `REPLAY_SCRIPT`:

```
powershell.exe -NoLogo -NoExit -Command
  [Console]::Out.Write([IO.File]::ReadAllText($env:AIS_SCROLLBACK)); [Console]::Out.Write($env:AIS_SCROLLBACK_SEP)
```

Provato dentro psmux con un file che contiene colori, accenti e una riga di 150
colonne:

- colori arrivati come sequenze vere (`\e[0;93m`, `\e[0;1;32m`), nessun `←[`;
- separatore «── cronologia ripristinata ──» e accenti intatti;
- la shell risponde (`echo "viva $PID"`);
- `pane_current_command` = `powershell`: nessun processo intermedio.

`pwsh.exe` non è installato qui: stessa riga, da provare. Per `cmd.exe` e le
altre shell la cosa più semplice è **niente replay** (`null`, come oggi).

Un caso reale c'era già: lo scrollback salvato dall'app conteneva la prova di
Ctrl+B dell'utente, `PS C:\Users\giaco> FWE^B^B^B^B`.

---

## Cosa serve alla fase 2, se si adotta psmux

1. **La selezione col mouse**, prima di tutto. Strade da valutare:
   - una issue a psmux perché il client rispetti `mouse off` (niente
     `EnableMouseCapture`);
   - in `app/pty.js`, togliere dall'output del client psmux le sequenze che
     accendono il mouse (`\e[?1000h`, `1002h`, `1003h`, `1006h`). Allora però la
     rotella torna alla strada dell'app (punto 3), e le TUI dentro psmux perdono
     il mouse.
2. **Config separata** (`app/psmux.conf`): `prefix C-M-S-F12`, `warm off`, senza
   `terminal-features`; anche lei in `build.asarUnpack`.
3. **Scorrimento senza catene** in `lib/tmux.js`, in un punto solo: un comando
   per invocazione, `scroll-up` ripetuto invece di `-N`, e un sostituto di
   `goto-line`. Oppure lasciare la rotella a psmux e spegnere `scrollTo` su
   Windows.
4. `detectTmux` su `win32`: binario dal PATH, accettato solo se `-V` ha la riga
   `psmux ` (Q5).
5. `replayCommand` con la variante PowerShell di Q7, `platform` come parametro.
6. Issue a psmux per la riga in meno e per `^B` in PowerShell.

## Come rifare le prove

1. Scaricare lo zip x64 dalla release e scompattarlo (qui `C:\Users\giaco\tools\psmux`).
2. In `detectTmux` (`lib/tmux.js`), al posto di `if (platform === 'win32') return null;`:

   ```js
   if (platform === 'win32' && !process.env.AIS_TMUX_BIN) return null;
   const r = platform === 'win32' ? { path: process.env.AIS_TMUX_BIN } : resolve('tmux');
   if (platform === 'win32' && process.env.AIS_TMUX_CONF) rawConfPath = process.env.AIS_TMUX_CONF;
   ```

3. Una copia di `app/tmux.conf` con `set -g prefix C-M-S-F12` e `set -g warm off`.
4. Lanciare l'app **da un terminale normale**, non da una sessione di Claude
   Code (vedi Q6): `AIS_TMUX_BIN=…\psmux.exe AIS_TMUX_CONF=…\copia.conf npx electron .`

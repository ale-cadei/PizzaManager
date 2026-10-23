# 52 — psmux dentro PizzaManager: sessioni persistenti su Windows

Branch: `feat/psmux-backend` · Dipende da: 40, 26 ·
Taglia: ~1½ g, più ~½ g di CI. **Si fa su Windows.**

> **Per chi lo riceve.** Prima `CLAUDE.md` (tmux, Windows, sicurezza), poi
> [`40-risultati.md`](40-risultati.md) (cosa fa psmux, misurato). Si usa
> **psmux originale**: il fork del piano 51 non serve (2026-10-10). Le
> «Trappole» del piano 40 valgono tutte anche qui.

## Obiettivo

Su Windows PizzaManager fa quello che fa su Mac con tmux: chiudere l'app
**stacca** le sessioni, riaprirla le **riaggancia**, e dopo un riavvio il modal
le ripropone (Claude con `--resume`, la shell con lo scrollback). **L'utente
non installa niente**: psmux viaggia nel pacchetto.

## Il disegno

L'idea dello spike resta: tutto il backend tmux passa da `lib/tmux.js`, e psmux
ne capisce i comandi. Su Windows `detectTmux` restituisce psmux invece di
`null`, mentre `app/pty.js`, il registro, il ripristino e lo scorrimento non
cambiano. Le differenze di piattaforma stanno in `lib/`, con `platform` come
parametro (regole Windows di `CLAUDE.md`).

### 1. psmux nel pacchetto, copiato fuori dall'app

- Lo zip della release ufficiale di psmux (oggi v3.3.8), **a versione
  fissata e con lo SHA-256 nel repo**, lo scarica uno script prima di
  electron-builder. Se un giorno servisse il fork (piano 51), cambiano solo
  URL e SHA-256.
  `psmux.exe` e il suo `LICENSE` vanno in `extraResources` (es.
  `resources/psmux/`). Niente Rust nella CI di PizzaManager.
- All'avvio, su Windows, l'app copia `psmux.exe` in
  `%LOCALAPPDATA%\PizzaManager\psmux\<versione>\` se non c'è già, e lo lancia
  **da lì**. Motivo: le sessioni restano vive ad app chiusa, e un psmux.exe
  dentro la cartella dell'app la terrebbe bloccata durante l'aggiornamento
  automatico (piano 18). Una cartella per versione, così il nuovo non
  sovrascrive mai un exe in uso.
- La copia è logica pura su file, quindi va in `lib/` (es.
  `lib/psmux-install.js`), con le cartelle passate dalla factory:
  `main.js`/`app/pty.js` passano `process.resourcesPath` e la cartella locale,
  i test una tmpdir. **Niente `app.getPath` dentro `lib/`.**
- La versione dell'exe si legge con `-V` e **deve** avere la riga `psmux `
  (Q5 di `40-risultati.md`). Senza quella riga, o se la copia fallisce,
  l'app ricade sul comportamento di oggi, senza errori a schermo.

### 2. `detectTmux` su `win32`

Oggi restituisce `null` apposta, per non usare un `tmux.exe` di MSYS2. Domani:
su `win32` usa **solo** il psmux installato al punto 1, mai un `tmux` dal
PATH. Un psmux che l'utente ha installato da sé non c'entra: il nostro ha la
versione che abbiamo provato, e il socket `aisession` resta nostro. Casi in
`tests/windows.test.js` con `platform: 'win32'`.

### 3. Una config per psmux: `app/psmux.conf`

`app/tmux.conf` non si tocca (su Mac serve `prefix None`). Quella per psmux:

- `set -g prefix C-M-S-F12`: psmux non accetta `None` (piano 51,
  correzione 4). Nessuno preme questa combinazione, quindi Ctrl+B arriva
  all'applicazione;
- **`set -g mouse on`**, al contrario di Mac. Con `mouse off` il server psmux
  scarta gli eventi di mouse destinati al pane, e Claude non seleziona più.
  Con `on` Claude e le TUI ricevono il mouse, nelle shell seleziona psmux, e
  la rotella scorre la history di psmux («Il mouse» in `40-risultati.md`);
- `set -g warm off`: il server caldo non verrebbe mai usato dall'app;
- niente `terminal-features` (psmux dà un avviso) né `terminal-overrides`
  (ignorato);
- il resto come `tmux.conf`: `status off`, `escape-time 0`,
  `history-limit 50000`, `window-size latest`, `destroy-unattached off`,
  `mode-style`.

psmux la deve leggere, quindi va in `build.asarUnpack` e passa da
`externalPath()`. È la trappola del `.deb` in `CLAUDE.md`: barra verde e
Ctrl+B attivo perché tmux non leggeva la config.

### 4. Lo scrollback delle shell (Q7)

`replayCommand` (`lib/scrollback-command.js`) oggi restituisce `null` su
`win32`. Per `powershell.exe`/`pwsh.exe` diventa:

```
<shell> -NoLogo -NoExit -Command <script costante>
  [Console]::Out.Write([IO.File]::ReadAllText($env:AIS_SCROLLBACK)); [Console]::Out.Write($env:AIS_SCROLLBACK_SEP)
```

con file e separatore (`SEPARATOR` di `lib/scrollback.js`) passati
nell'ambiente, come la versione Unix. Provato in psmux: colori, accenti,
separatore e shell interattiva, e nessun processo intermedio. Per le altre
shell resta `null`. `pwsh.exe` va provato. Se il profilo ha già degli
argomenti, vanno messi prima di `-NoExit`.

### 5. Aggiornamenti con sessioni vive

psmux ha un processo server **per sessione**. Dopo un aggiornamento le sessioni
nate prima girano sul psmux vecchio, quelle nuove sul nuovo. Da decidere
leggendo il codice di psmux: un client nuovo sa attaccarsi a un server
vecchio? Se no:

- `@ais_psmux` nei metadati: la versione con cui è nata la sessione;
- l'attacco usa l'exe di **quella** versione, che resta nella sua cartella;
- all'avvio si cancellano solo le cartelle di versioni che nessuna sessione
  viva usa più.

**Letto nel codice (2026-10-11, sorgente 3.3.8 `66cf613` e storia dei tag
v0.4.5…v3.3.8).** La risposta è «di fatto sì, ma nessuno lo promette», quindi
il disegno qui sopra resta, tutto:

- **Il protocollo non ha versione.** Client e server parlano TCP su loopback
  (porta in `~/.psmux/<socket>__<nome>.port`): `AUTH <chiave>`, poi comandi
  testuali una riga per volta; l'attacco (`PERSISTENT`, `client-attach`)
  riceve frame JSON `DumpState`. Nessun controllo di versione da nessuna parte.
- **Finora regge per disciplina.** In `DumpState` dalla 0.4.5 alla 3.3.8 i campi
  sono passati da 26 a 84, sempre con `#[serde(default)]`: gli obbligatori sono
  ancora solo `layout` e `windows`, e i campi in più si ignorano. Le modifiche
  alla codifica dei comandi della 3.3.8 (#547 virgolette e backslash, #560 a
  capo in `send-keys`) toccano solo chi codifica, il decoder non è cambiato. Un
  frame illeggibile il client lo scarta in silenzio e ne chiede un altro
  (`client.rs`, `JSON parse error` → `force_dump`): se un giorno il formato
  cambiasse, la scheda resterebbe vuota senza errori.
- **L'exe di una sessione viva è bloccato.** Il server è `current_exe()` lanciato
  di nuovo (`platform.rs`, `spawn_server_hidden`): ogni sessione tiene aperto il
  `psmux.exe` che l'ha creata. La cartella per versione è quindi obbligatoria
  comunque, e quella vecchia non si cancella finché le sue sessioni vivono: la
  pulizia deve guardare `@ais_psmux`, non affidarsi a un `rm` che fallisce.
- **Il reaper.** Ogni invocazione di psmux (`main.rs`, `reap_orphaned_servers`)
  termina i server con immagine `psmux`/`tmux`/`pmux` che il suo registro non
  conosce. Dalla 3.3.8 (#510) solo quelli con un marcatore di proprietà nella
  **sua** cartella dati: un psmux più vecchio con un'altra cartella dati
  potrebbe uccidere i nostri. Con la stessa cartella (`~/.psmux`, quella di
  default) i nostri hanno il `.port` e non si toccano. Caso raro, non ci si fa
  niente; se servisse, `PSMUX_DATA_DIR` (dalla 3.3.8) separa i registri.

Quindi: l'attacco usa l'exe della versione della sessione (è il pezzo più
fragile, frame JSON e tasti), i comandi una tantum (`list`, `has`, metadati,
cattura, `kill`) l'exe corrente. Quando si cambia la versione fissata, le prove
di «Come rifare le prove» includono un server della versione vecchia con il
client nuovo.

### 6. Scorrimento

**Niente da fare.** Il client psmux tiene sempre il terminale in modalità
mouse, quindi `renderer/term-scroll.js` lo tratta come una TUI. La rotella va
a psmux, e la barra manda scatti di rotella con una lunghezza stimata.
Verificato nell'app (2026-10-10): funziona, un po' a scatti. `scrollArgs` e
`scrollToArgs` su psmux non vengono mai chiamati, e non devono esserlo: le
catene con `;` non funzionano (Q1). Una barra fluida e precisa è
la rifinitura del piano 51.

### 7. CI e release

- `release.yml`: riaccendere il job Windows con **`shell: bash`** sul passo del
  build. È il difetto di `pwsh` descritto nel piano 40, e va provato da qui.
  Poi lo script che scarica psmux, verifica lo SHA-256 e lo mette in
  `extraResources`.
- `ci.yml`: i test d'integrazione tmux girano anche su `windows-2022` con il
  psmux scaricato. Servono varianti con `powershell.exe` al posto di
  `/bin/sh` e `sleep` (Q1 bis di `40-risultati.md`). Senza psmux si dichiarano
  saltati, non fingono di passare.
- La CI Windows è stata sistemata (PR #55), ma GitHub Actions è fermo
  finché il repo non diventa pubblico (backlog del README). Fino ad allora i
  test girano in locale sul fisso Windows, e il pacchetto Windows si
  costruisce lì: la parte su `release.yml` serve quando Actions riparte.

### 8. Onboarding e legenda

Su Windows le sessioni persistenti ci sono, come su Mac: niente prerequisito
da spiegare. I testi che dicono «su Windows chiudere l'app perde le sessioni»
vanno aggiornati. Il `LICENSE` di psmux finisce nel pacchetto (punto 1).

## Rischi

- **Antivirus e SmartScreen.** Un exe non firmato, copiato in `%LOCALAPPDATA%`
  e lanciato da un'app a sua volta non firmata, può insospettire un antivirus.
  Va provato con Windows Defender su un PC pulito. Se psmux non parte, l'app
  ricade sul comportamento di oggi: per questo `feat/scrollback-senza-tmux`
  (riga 26b) resta utile come rete di sicurezza.
- **Ambiente ereditato.** Ogni sessione psmux prende l'ambiente del client che
  la crea. Un'app lanciata da dentro Claude Code passa `CLAUDE_CODE_CHILD_SESSION`
  e il Claude nelle schede non salva le conversazioni (Q6). Riguarda solo chi
  sviluppa: le prove si lanciano da un terminale normale.
- **psmux cambia in fretta.** La versione è fissata: ogni aggiornamento si
  rifà con le prove di «Come rifare le prove» (piano 40) prima di cambiare lo
  SHA-256.

## Fatto quando

- dal pacchetto installato, su un Windows senza psmux né tmux: Nuova → Claude,
  chiudere l'app, riaprirla → la scheda si riaggancia con l'output;
- spegnere il PC, riaccenderlo, riaprire → modal, Claude con `--resume`, shell
  con lo scrollback in grigio;
- selezione col mouse, rotella, barra di scorrimento e Ctrl+B come su Mac;
- un aggiornamento automatico con sessioni vive non fallisce e non le uccide;
- `npm run test:unit` verde e CI Windows verde.

## Stato (2026-10-23)

Punti 1–8 fatti, un commit per punto (il 7 in due: refactor e test). Provato
sul fisso Windows 11, con l'app di sviluppo:

- **chiusura e riapertura**: 6 schede, staccate e riagganciate con l'output
  (l'utente le ha viste). psmux copiato in
  `%LOCALAPPDATA%\PizzaManager\psmux\3.3.8\` e lanciato da lì;
- **riavvio simulato** (`kill-server` su `aisession` ad app chiusa): modal,
  Claude con lo stesso `@ais_resume_id`, la shell PowerShell con il testo di
  prima (euro compreso), il separatore e il prompt;
- **selezione, rotella, Ctrl+B**: confermati dall'utente;
- **pacchetto**: `npm run dist:win` mette `resources\psmux` e
  `app.asar.unpacked\app\psmux.conf`; `detectTmux` con quel layout li trova;
- **test**: varianti psmux dei test d'integrazione (`tests/integration.test.js`),
  che girano contro `vendor/psmux`. Su Windows la suite ha 11 fallimenti che
  vengono da `main` e non da questo branch (percorsi POSIX nei test, permessi
  Unix, CRLF di git, `readlink`): sono del piano 24.

Ancora da fare o da vedere:

- **dal pacchetto installato** (primo punto di «Fatto quando»): il setup
  sostituisce l'app installata, quindi va chiusa prima;
- **CI e release** su GitHub: i file sono pronti, li provano il primo push e il
  primo tag;
- **aggiornamento con due versioni vere** di psmux: verificato solo con versioni
  finte nei test. Si fa quando si cambia la versione fissata;
- **`pwsh.exe`**: stessa riga di `powershell.exe`, non installato qui;
- **Codex dentro psmux**: le notifiche OSC 9 incapsulate (piano 46) e lo stato
  scritto ad app chiusa non sono provati; i due test d'integrazione restano
  solo tmux;
- **Defender e SmartScreen su un PC pulito** (Rischi);
- **npm 12** non esegue gli script d'installazione non autorizzati, e senza
  quelli `npm install` non scarica Electron: la lista `allowScripts` sta nel
  branch `chore/allow-scripts`, separato da questo.

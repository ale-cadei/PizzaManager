# 46 — psmux dentro PizzaManager: sessioni persistenti su Windows

Branch: `feat/psmux-backend` · Dipende da: 40, 45 (la release del fork), 26 ·
Taglia: ~1½ g, più ~½ g di CI. **Si fa su Windows.**

> **Per chi lo riceve.** Prima `CLAUDE.md` (tmux, Windows, sicurezza), poi
> [`40-risultati.md`](40-risultati.md) (cosa fa psmux, misurato) e
> [`45-fork-psmux.md`](45-fork-psmux.md) (cosa correggiamo in psmux). Le
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

- Lo zip della release del fork (piano 45), **a versione fissata e con lo
  SHA-256 nel repo**, lo scarica uno script prima di electron-builder.
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
PATH. Un psmux che l'utente ha installato da sé non c'entra: il nostro ha le
nostre correzioni, e il socket `aisession` resta nostro. Casi in
`tests/windows.test.js` con `platform: 'win32'`.

### 3. Una config per psmux: `app/psmux.conf`

`app/tmux.conf` non si tocca (su Mac serve `prefix None`). Quella per psmux:

- `set -g prefix C-M-S-F12`: psmux non accetta `None`, e il fork non lo
  corregge (piano 45, correzione 4). Nessuno preme questa combinazione, quindi
  Ctrl+B arriva all'applicazione;
- `set -g warm off`: il server caldo non verrebbe mai usato dall'app;
- niente `terminal-features` (psmux dà un avviso) né `terminal-overrides`
  (ignorato);
- il resto come `tmux.conf`: `status off`, `mouse off`, `escape-time 0`,
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

### 6. Scorrimento

Con la correzione 3 del piano 45, `scrollArgs`/`scrollToArgs` funzionano su
psmux come su tmux: **niente da fare**. Senza quella correzione non si parte con
questo piano: la variante a tre processi per scatto andrebbe a scatti su
Windows.

### 7. CI e release

- `release.yml`: riaccendere il job Windows con **`shell: bash`** sul passo del
  build. È il difetto di `pwsh` descritto nel piano 40, e va provato da qui.
  Poi lo script che scarica psmux, verifica lo SHA-256 e lo mette in
  `extraResources`.
- `ci.yml`: i test d'integrazione tmux girano anche su `windows-2022` con il
  psmux scaricato. Servono varianti con `powershell.exe` al posto di
  `/bin/sh` e `sleep` (Q1 bis di `40-risultati.md`). Senza psmux si dichiarano
  saltati, non fingono di passare.
- Prima va sistemata la CI Windows, rossa dal 28 settembre (backlog del
  README), altrimenti non si capisce cosa rompe questo branch.

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
- **Il fork resta indietro.** Ogni release di psmux va valutata. Quando le PR
  sono accettate si torna alla release ufficiale (piano 45).

## Fatto quando

- dal pacchetto installato, su un Windows senza psmux né tmux: Nuova → Claude,
  chiudere l'app, riaprirla → la scheda si riaggancia con l'output;
- spegnere il PC, riaccenderlo, riaprire → modal, Claude con `--resume`, shell
  con lo scrollback in grigio;
- selezione col mouse, rotella, barra di scorrimento e Ctrl+B come su Mac;
- un aggiornamento automatico con sessioni vive non fallisce e non le uccide;
- `npm run test:unit` verde e CI Windows verde.

# 93 — Sessioni su SSH e WSL (`feat/sessioni-ssh`, poi `feat/sessioni-wsl`)

Nel modal «Nuova sessione» si sceglie, oltre a tipo e directory, **dove**
gira la sessione: questo computer, un server SSH o una distribuzione WSL. La
directory si scrive lì dentro.

## Decisioni (2026-11-13, con l'utente)

- **Persistenza: tmux locale avvolge il client.** La sessione tmux dell'app
  (socket `aisession`) esegue `ssh -t host …` o `wsl.exe -d …`: sopravvive
  alla chiusura dell'app come le altre. Se il computer dorme o la rete cade,
  il processo remoto muore con la connessione. Il tmux **sul server**
  (sessione che continua a Mac spento) resta l'idea in `idee.md`, branch
  futuro: non si mischia qui.
- **Directory: campo di testo + recenti per ambiente.** Default `~`.
  «Sfoglia…» è nascosto quando l'ambiente non è locale. Niente browser remoto.
- **Solo tipi terminale**: Terminale, Claude, Codex, OpenCode, Antigravity.
  Git ed Editor leggono i file con `fs` locale: su ambiente remoto le loro
  card sono disabilitate (title che spiega perché).
- **Host SSH solo da `~/.ssh/config`.** Voci `Host` senza wildcard (`*`, `?`,
  `!`). L'autenticazione è di ssh (chiavi, agent, password digitata nel
  terminale): l'app non vede né salva segreti.

## Modello: l'«ambiente»

Un valore unico che viaggia ovunque:

```
{ kind: 'local' }
{ kind: 'ssh', host: 'nas' }            // alias di ~/.ssh/config
{ kind: 'wsl', distro: 'Ubuntu-24.04' }
```

Chiave testuale stabile (`local`, `ssh:nas`, `wsl:Ubuntu-24.04`) per
meta tmux, cronologia, recenti, raggruppamento in sidebar.

## Pezzi

### `lib/remote-env.js` (nuovo, puro)
- `parseSshConfig(text)` → alias usabili (con `Include` relativi a `~/.ssh`
  e glob semplici; righe commentate ignorate; `Host a b` dà due voci).
- `parseWslList(buffer)` → distro da `wsl.exe -l -q` (output **UTF-16LE**
  con BOM e `\0`; si scartano righe vuote e `docker-desktop*`).
- `envKey(env)` / `parseEnvKey(key)` con validazione: host = `[A-Za-z0-9._-]`,
  **mai** con `-` iniziale (sarebbe un'opzione di ssh); distro idem.
- `validateRemoteDir(dir)`: `~`, `~/…` o assoluto POSIX; niente `\0`/a capo.
- `wrapRemote({ env, cwd, cmd, args, vars })` → `{ cmd, args }` locale:
  - ssh: `ssh -t -- <host> sh -c '<riga>'` (sempre `sh` esplicito: la
    shell di login del server può essere fish); la riga è
    `cd <dir> 2>/dev/null || { echo '…directory non trovata, parto da ~'; cd; }; exec env K=V… "$SHELL" -lc '<cmd args>'`,
    tutto con quoting POSIX a singoli apici (`~/` resta fuori dagli apici
    perché il server lo espanda). Shell di login: PATH di nvm/brew/~/.local
    sul server, dove stanno `claude` e compagni.
  - wsl: `wsl.exe -d <distro> --cd <dir> --exec sh -lc '<stessa riga>'`.
- Il binario **non** si risolve in locale: `buildCommand` oggi cerca nel
  PATH della macchina. Per remoto serve il nome nudo del comando del profilo
  (`claude`, `codex`…), più args e `--resume`. Si estrae da `lib/commands.js`
  una funzione che dà `{ bin, args }` senza risoluzione (refactor in commit
  a sé), e `buildCommand` la usa.

### `lib/remote-hosts.js` (nuovo)
- `createRemoteHosts({ home, platform, run })`: legge `~/.ssh/config`
  (assente = lista vuota, non errore), e su `win32` interroga `wsl.exe -l -q`
  con timeout. Cache breve (30 s): il modal si apre spesso.

### `app/pty.js`
- `spawn` accetta `env` (default local). Se remoto:
  - salta `describeWorkdir` (il cwd del pty locale è la home);
  - comando = `wrapRemote(...)`; il binario locale da trovare è `ssh` /
    `wsl.exe` (messaggio d'installazione se manca);
  - **niente** iniezione del segnale esatto a file (hook che scrivono sul
    disco del server: nessuno li leggerebbe). Codex parla con OSC 9 nel
    terminale e attraversa ssh: quello resta;
  - meta tmux nuova `@ais_env` (in `META_KEYS`); history con `env`.
- `attach` non cambia: si riattacca al client tmux locale.

### Segreti
- Account Claude **a chiave API** su remoto: rifiutato con messaggio. La
  chiave finirebbe nella riga di comando del server (visibile in `ps` a
  tutti gli utenti di quella macchina). Si usa il login fatto sul server.
- Stesso controllo per `ANTHROPIC_API_KEY` (o variabili con `KEY`, `TOKEN`,
  `SECRET` nel nome) nell'env di un profilo di comando.
- Le altre variabili del profilo passano con `env K=V`.

### `main.js`
- `ipcMain.handle('list-remote-envs')` → `{ ssh: [...], wsl: [...] }`.
- `get-recent-dirs` accetta `env` e filtra.

### Renderer
- `index.html`: riga «Dove» sopra la directory, `<select id="new-env">`
  con optgroup *Questo computer* / *SSH* / *WSL* (WSL solo se ci sono distro).
  Ricorda l'ultimo scelto (`localStorage`, try/catch).
- `new-session.js`: al cambio ambiente → cwd = `~` (o ultima recente di
  quell'ambiente), Sfoglia nascosto, chip filtrati, card Git/Editor
  disabilitate; se erano selezionate si torna a Terminale.
- Scheda e sidebar: etichetta dell'host accanto al titolo (`nas`, `WSL`).
  Raggruppamento per progetto con chiave `envKey + cwd`: `/home/ale/app`
  sul server non si fonde con quella locale.
- Spenti per schede remote: titolo automatico dalla conversazione (legge
  `~/.claude` locale), pannello Modifiche, barra usage per profilo. Restano
  l'euristica di attività e il segnale OSC.
- Resume / ripristino dopo riavvio: la sessione remota si ricrea con lo
  stesso ambiente (`env` in history e meta). La lista «Riprendi» delle
  conversazioni resta locale: riprendere una chat remota per id è fuori
  piano.

### `lib/recent-dirs.js`
- `normalizeDir` oggi vuole un assoluto: per remoto accetta anche `~…`.
- Le voci senza `env` sono `local` (cronologia vecchia). `exists` si
  applica solo alle locali.

## Branch

1. **`feat/sessioni-ssh`** (Linux/Mac, ~1 g): tutto tranne WSL. Commit:
   refactor `commands.js` (comando senza risoluzione) → `remote-env.js` +
   test → hosts SSH → pty → IPC → UI → sidebar/degradi.
2. **`feat/sessioni-wsl`** (~½ g, prova su Windows): `parseWslList`,
   `wsl.exe` in `wrapRemote`, optgroup WSL. Su Windows non c'è tmux ma
   psmux (piano 52): verificare che `wsl.exe` dentro psmux si riattacchi.

## Test

- `tests/remote-env.test.js`: parse del config (Include, wildcard, Host
  multipli, commenti, file assente); WSL UTF-16LE con BOM; quoting di dir
  con spazi, apici, `~`, `$`, backtick (deve arrivare letterale); host con
  `-` iniziale rifiutato; segreti rifiutati.
- `tests/pty-remote.test.js` con socket di prova (`aistest-…`) e un finto
  `ssh` in `tests/fixtures/` che stampa argv: la sessione tmux nasce col
  comando giusto e `@ais_env`.
- `tests/integration.test.js`: `ssh -o BatchMode=yes localhost true`,
  `t.skip` se non c'è sshd/chiave.
- `tests/windows.test.js`: `platform: 'win32'` per la riga di `wsl.exe`.
- Smoke: `AISESS_PROFILE=ssh npm start`, sessione Claude su un host del
  config, chiudere e riaprire l'app → si riattacca.

## Rischi

- **Host key / password**: ssh chiede nel terminale, va bene così. Con
  `BatchMode` mai: l'utente deve poter rispondere.
- **Shell remota non POSIX** (fish come login shell): la riga esterna va in
  `sh -c` apposta; solo il comando finale passa da `"$SHELL" -lc`, che con
  fish regge comandi semplici. Da provare su un host con fish.
- **TERM sul server**: `xterm-256color` arriva via ssh; se il server non ha
  il terminfo, i colori degradano. Non si tocca.

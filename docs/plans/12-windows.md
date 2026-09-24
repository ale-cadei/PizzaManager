# 12 — Windows

Branch: `feat/windows` · Dipende da: — · Taglia: ~1 g (+ prova su una macchina Windows)

## Obiettivo

Rendere l'app **utilizzabile** su Windows: shell di sistema, Claude Code,
Codex e OpenCode nativi, Resume, directory recenti, raggruppamento per
progetto. Senza tmux (non esiste su Windows): le sessioni muoiono con l'app,
come su Mac/Linux senza tmux — è il fallback già previsto in `app/pty.js`.

Fuori scope: installer (piano 13), WSL, Antigravity su Windows (la CLI non è
distribuita per Windows: resta "non trovato"), firma del codice.

## Cosa si rompe oggi e perché

Tutto il codice assume convenzioni POSIX. Ogni punto qui sotto ha un test
con `platform: 'win32'` iniettato: i moduli in `lib/` ricevono già
piattaforma, home, `exists` ecc. come parametri, si continua così. La CI e la
macchina di sviluppo sono Unix: **i test devono passare qui**, e la prova
vera su Windows si fa a mano (checklist in fondo).

| Modulo | Problema | Correzione |
|---|---|---|
| `lib/login-path.js` | `shell -lc 'echo $PATH'` (PowerShell non lo capisce); PATH spezzato su `:` | su `win32` non si interroga nessuna shell: Windows non ha una "shell di login", il PATH di un'app avviata dalla GUI è già quello dell'utente (registro). `dedupePath` usa `path.delimiter` |
| `lib/binaries.js` | PATH spezzato su `:`; nessuna estensione `.exe`/`.cmd`; candidati solo Unix; `augmentedEnv` scrive `PATH` accanto a un eventuale `Path` (su Windows le variabili sono case-insensitive: due chiavi = ambiguità) | delimitatore per piattaforma; su `win32` un nome senza estensione prova `.exe .cmd .bat .com` (l'ordine di `PATHEXT`); candidati Windows: `%APPDATA%\npm\<tool>.cmd` (npm -g), `%USERPROFILE%\.local\bin\<tool>.exe` (installer nativo di Claude), `%USERPROFILE%\.opencode\bin\opencode.exe`, `%USERPROFILE%\.codex\bin\codex.exe`; `augmentedEnv` riusa la chiave PATH esistente qualunque sia il suo case |
| `lib/commands.js` | "percorso esplicito" = contiene `/` | anche `\` e `X:` ; su `win32` un binario `.cmd`/`.bat` non si può lanciare direttamente (sono script di `cmd.exe`): si lancia `cmd.exe /d /s /c "<bin> args"` — deciso qui, in `lib/`, così è testabile, non in `app/pty.js` |
| `lib/recent-dirs.js` | assoluto = inizia con `/` | anche `C:\`, `C:/`, `\\server\share`; toglie i separatori finali ma non quello di `C:\` |
| `lib/project-root.js` | usa `normalizeDir` (sopra) e `path.dirname` | `path` iniettabile (`path.win32` nei test) |
| `lib/claude-sessions.js` | `cwdFromProjectDir`: `C--Users-jack-repo` → `/C//Users/…` | è solo il fallback quando il `.jsonl` non ha `cwd`; su Windows `X--` in testa diventa `X:\` e i `-` diventano `\` |
| `renderer/session-groups.js` | `split('/')`, `startsWith(base + '/')` | separatore `[\\/]`; `relativeSubpath` sep-agnostica |
| `lib/tmux.js` | `detectTmux` cerca `tmux` nel PATH: con MSYS2 potrebbe trovarne uno e provare socket/config POSIX | su `win32` non si cerca nemmeno |
| `lib/shell.js` | — | già a posto: `powershell.exe` |
| `lib/workdir.js` | espande solo `~/` | anche `~\` |

`app/pty.js`: passa a node-pty `commandLine` (stringa) quando c'è, altrimenti l'argv — node-pty su Windows accoda una stringa così com'è (`windowsPtyAgent.js`, `isCommandLine`). `main.js`, `app/window.js`, `app/menu.js`: niente da cambiare.
La cartella dati finisce in `%APPDATA%\AISessionManager`, i `chmod 0o600` su
Windows non falliscono (e non proteggono: lì contano le ACL, fuori scope).

## Checklist di prova su Windows (a mano)

Prerequisiti: Node 22+, `npm i -g @anthropic-ai/claude-code` (o l'installer
nativo di Claude). Poi `npm install && npm start`. I Build Tools non servono:
vedi il piano 23.

Provata il 2026-09-24 su Windows 11 (piano 23), da sorgente, col pacchetto
v1.0.2 e col setup costruito da `dist:win`:

- [x] La finestra si apre, la menubar in-app c'è (come su Linux)
- [x] «Nuova» → Terminale: parte PowerShell nella directory scelta
- [x] Legenda in basso: `claude` trovato (tooltip col percorso `.cmd` o `.exe`)
- [x] «Nuova» → Claude in una cartella con `.git`: Claude parte, il titolo
      automatico arriva, la sidebar per Progetto la raggruppa con il nome
      della cartella
- [x] Resume → Claude: elenca le conversazioni (la riapertura con `--resume`
      non è stata provata)
- [x] Riapri il dialog «Nuova»: la directory appena usata è fra le recenti
- [x] Chiudi e riapri l'app: nessun modal di ripristino (senza tmux non
      c'è niente da ripristinare), nessun errore in console

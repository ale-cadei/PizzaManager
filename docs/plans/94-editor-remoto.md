# 94 — Editor su un server SSH (`feat/editor-remoto`)

Il piano 93 apre i terminali su un server, ma l'editor resta su questo
computer: la sua card è disabilitata quando «Dove» non è locale. Qui
l'editor apre una cartella **del server**: albero, lettura, salvataggio,
rinomina, cestino, barrette git, blame, Ctrl+P, Ctrl+click.

## Decisioni (2026-11-13, con l'utente)

- **Helper su ssh, non sshfs.** Una connessione ssh per host, aperta dal
  main con `child_process` (non pty), lancia sul server un piccolo helper
  Python (solo libreria standard) che esegue un elenco **fisso** di
  operazioni. Niente da installare qui; sul server serve `python3`.
- **Branch nuovo dopo il merge di `feat/sessioni-ssh`** (fatto: `1a36c89`).
- WSL non è qui: su Windows l'editor può aprire `\\wsl$\Distro\…` con
  l'`editor-fs` locale. Va nel piano 93, branch `feat/sessioni-wsl`.

## Pezzi

### `lib/remote-helper.py` (nuovo)
Letto dal main e mandato sullo stdin, mai copiato sul server. Protocollo a
righe JSON: `{id, op, args}` → `{id, ok, …}` o `{id, ok:false, code, error}`.
Operazioni:
- `list`, `stat`, `stat_many`, `read` (byte in base64, limite 5 MB),
  `write` (atomica: file temporaneo + `os.replace`, controllo mtime),
  `create`, `mkdir`, `rename`, `trash` (cestino freedesktop
  `~/.local/share/Trash`, mai unlink).
- `realpath` della radice (con `~`).
- `git`: argv passato a `subprocess.run` **senza shell**, primo argomento in
  una lista bianca (`ls-files`, `status`, `rev-parse`, `check-ignore`,
  `cat-file`, `blame`, `grep`); stesse variabili di `lib/git-run.js`.

Ogni percorso arriva relativo: l'helper fa `realpath` e rifiuta quello che
esce dalla radice (`EOUTSIDE`), come `lib/editor-fs.js`.

Avvio: `ssh -T -o BatchMode=yes -- host "python3 -u -c '<bootstrap>'"`. Il
bootstrap legge una riga con la lunghezza, poi il sorgente dell'helper, e lo
esegue: la riga di comando resta corta e fissa.

### `lib/remote-channel.js` (nuovo)
- Un canale per host, condiviso fra le schede; id per richiesta, timeout per
  richiesta, chiusura dopo 5 min senza schede.
- Processo morto → tutte le richieste in volo falliscono con un messaggio
  chiaro, la richiesta dopo riapre.
- Errori d'avvio tradotti: `Permission denied` → «serve una chiave o
  ssh-agent: l'editor non può chiedere la password»; `python3: not found` →
  «sul server serve python3».
- `spawn` iniettabile: i test usano un finto ssh che lancia l'helper con il
  python locale.

### `lib/editor-remote-fs.js` (nuovo)
Stessa interfaccia di `createEditorFs` (`list`, `read`, `write`, `stat`,
`create`, `mkdir`, `rename`, …), asincrona, sopra il canale. `decode()` si
esporta da `lib/editor-fs.js` e si riusa: binari, BOM, non UTF-8 restano
decisi qui. `run` remoto per `lib/editor-git.js`, `editor-index.js`,
`editor-definition.js` (già iniettabile): stesso codice, git sul server.

### `app/editor.js`
`root` può essere una stringa (locale, come oggi) o `{ env, dir }`. Un
`backendFor(root)` sceglie locale o remoto; validazione con
`parseEnvKey` / `validateRemoteDir` di `lib/remote-env.js`. Sul remoto:
- `editor-watch`: polling con `stat_many` ogni 3 s (niente `fs.watch`).
- `editor-reveal`, `editor-copy-*` (copia da questo computer): rifiutati con
  messaggio; la UI nasconde le voci.

### Renderer
- Card Editor attiva anche su un server (Git resta disabilitata).
- La scheda editor porta `env`; `editorRoot(tab)` sostituisce `tab.cwd`
  nelle chiamate `window.aisess.editor*`.
- Sul remoto: niente «Mostra nella cartella», niente drop/incolla di file
  da fuori, niente kernel dei notebook (gira qui), anteprima markdown senza
  immagini locali.
- `editor-sessions` salva anche `env`: la scheda si riapre sul server.

## Test

- `tests/remote-helper.test.js`: l'helper col python locale su una tmpdir
  (ogni operazione, `EOUTSIDE` con `..` e symlink, scrittura in conflitto,
  `git` fuori lista, cestino) e il canale con un finto ssh (richieste
  concorrenti, processo che muore, errori d'avvio). `t.skip` senza python3.
- `tests/editor-remote-fs.test.js`: stesse risposte di `editor-fs`, e
  editor-git/index/definition col `run` remoto.
- `tests/editor-remote-watch.test.js`: polling, un giro per server.
- `tests/editor-ipc.test.js`: andata e ritorno remoto, `root` remoto non
  valido rifiutato senza aprire connessioni, canali solo locali rifiutati.
- `tests/editor-remote-tab.test.js`: `{ env, dir }` nelle richieste, eventi
  del watch per server, niente copia/branch locali, card del modal.
- `tests/editor-sessions.test.js`: `env` salvato, WSL e chiavi non valide scartate.
- Smoke: `AISESS_PROFILE=ssh npm start`, editor su un host, salvare un file
  e vederlo dal terminale remoto; modificarlo dal terminale e vedere
  l'avviso nell'editor.

## Rischi

- **Password**: il canale non ha terminale. Con chiave o agent va; altrimenti
  messaggio chiaro. `ControlMaster` nel config dell'utente lo fa riusare la
  connessione del terminale.
- **python3 assente** (alcune immagini minime): messaggio, niente fallback.
- **Latenza**: un giro per operazione; l'albero carica una cartella per
  volta come oggi, Ctrl+P fa un solo `ls-files`.
- **Windows**: `ssh.exe` di OpenSSH c'è; nessun ControlMaster. Da provare.

## Stato

Fatto su `feat/editor-remoto`, test verdi (`npm run test:unit`). Da fare:
smoke con un host vero (`AISESS_PROFILE=ssh npm start`). Il branch in barra
di stato sul server non c'è (git-branches è locale): da aggiungere se serve.

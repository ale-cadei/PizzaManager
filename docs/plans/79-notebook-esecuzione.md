# 79 — `feat/notebook-esecuzione`: le celle si eseguono con un kernel

Dipende da: 78 (notebook modificabile). Taglia: ~1–2 giornate.

## Perché

Col 78 il notebook si modifica, ma non gira: per vedere un risultato bisogna
aprirlo in Jupyter. Eseguire le celle è la metà di un notebook.

## Cosa fa

- **Eseguire**:
  - `Ctrl+Invio` esegue la cella selezionata, o quella in modifica (che torna
    in modo comando);
  - `Shift+Invio` esegue e passa alla cella dopo (dall'ultima ne crea una).
    Sulle markdown resta quello del 78 (la cella si rende e si passa oltre);
  - ▶ nella barra della cella;
  - «▶ Esegui tutto» nella barra del notebook.
- **Kernel**:
  - Parte alla prima esecuzione, nella cartella del notebook. Il nome viene
    da `metadata.kernelspec.name`, altrimenti `python3`.
  - Uno per notebook aperto; si spegne chiudendo il file, la scheda, la
    finestra o l'app.
  - Nella barra del notebook ci sono lo stato del kernel (avvio, inattivo,
    occupato, spento), «■ Interrompi» e «↻ Riavvia».
- **Output in streaming**:
  - Mentre una cella è in coda o gira, il prompt mostra `[*]`.
  - Gli output arrivano dentro gli `outputs` della cella nel JSON: `stream`
    (stdout/stderr uniti come fa Jupyter), `execute_result`, `display_data`,
    `error`, `clear_output` (anche con `wait`).
  - Alla fine c'è il numero di esecuzione. Il file diventa «modificato» come
    in Jupyter.
- **Errori**: un errore ferma le celle in coda (come «Esegui tutto» di
  Jupyter); l'interruzione dà `KeyboardInterrupt`.
- **Senza Python, senza jupyter_client o senza il kernel** la barra lo dice
  (con il `pip install` che serve) e il notebook resta modificabile.

## Come

- **`app/kernel-bridge.py`**: ponte in Python. Legge comandi JSON a righe da
  stdin (`start`, `execute`, `interrupt`, `restart`, `shutdown`) e scrive
  eventi JSON a righe su stdout:
  - `ready`, `missing`, `status`, `output`, `clear`, `done`, `dead`, `error`;
  - una cella è finita quando sono arrivati sia `execute_reply` sia `idle`
    su iopub, così nessun output arriva dopo `done`;
  - con stdin chiuso spegne il kernel ed esce;
  - `sys.stdout` va su stderr, così un `print` sfuggito non rompe il
    protocollo.

  Sta in `asarUnpack` e si passa con `externalPath()`, perché Python non
  legge dentro `app.asar`.
- **`lib/kernel-bridge.js`** (senza electron):
  - `findPython` (`python3`, poi `python`, con `resolveBinary`);
  - `createKernelBridge({spawn, python, script, cwd, env, onEvent})`:
    `spawn` senza shell, righe di stdout → eventi, coda di stderr nel
    messaggio di uscita, `send(cmd)`, `close()` (stdin chiuso e `kill`
    dopo un timeout).
- **`app/notebook-kernel.js`**: `registerKernelHandlers(ipcMain, …)`.
  - Canali `kernel-start` (`{dir, kernel}` → id), `kernel-execute`,
    `kernel-interrupt`, `kernel-restart`, `kernel-shutdown`; eventi su
    `kernel-event` al webContents che ha avviato.
  - Valida tutto: `dir` cartella assoluta esistente, nome del kernel
    `[\w.-]`, codice stringa ≤ 1 MB, id noti a quel webContents.
  - Una ricarica o la chiusura della finestra spengono i kernel di quel
    webContents; `shutdownAll` all'uscita dell'app.
- **`renderer/notebook-run.js`** (UMD puro):
  - `appendOutput(outputs, output, clearPending)`: stream consecutivi con lo
    stesso nome si uniscono; `clear_output` con `wait` svuota al primo
    output dopo;
  - `kernelNameOf(raw)`.
- **`renderer/notebook-edit.js`**:
  - `setOutputs(raw, index, outputs, count)`;
  - `cellIndexById(raw, id, fallback)`: una cella che gira si ritrova dal suo
    `id` (nbformat 4.5) anche se nel frattempo se ne aggiungono o spostano
    altre.
- **`renderer/notebook-view.js`** esporta `renderOutputs`: si ridisegnano
  solo le righe di output e il prompt della cella che riceve output. La
  scrittura nel JSON è `quiet`, così la cella in modifica altrove (o la
  stessa) non perde l'editor.
- **`renderer/editor-notebook-run-ui.js`**:
  - kernel per (scheda, file); coda delle esecuzioni;
  - output raccolti e scritti nel JSON al più ogni 100 ms (pochi passi
    nell'undo, pochi ridisegni);
  - bottoni, stato e i comandi `run` / `run-next` del modo comando e
    dell'editor della cella.
- `preload.js`: `kernelStart`, `kernelExecute`, `kernelInterrupt`,
  `kernelRestart`, `kernelShutdown`, `onKernelEvent`.

## Test

- `tests/kernel-bridge.test.js`:
  - `spawn` finto: righe spezzate fra più chunk, JSON rotto ignorato,
    uscita con la coda di stderr, `close` (stdin chiuso, poi kill);
  - `findPython`;
  - **integrazione col Python vero**, saltata se manca `jupyter_client` o
    `ipykernel`: print + risultato, `done` dopo gli output, errore che
    annulla la coda, interrupt, restart, kernel inesistente → `missing`.
- `tests/notebook-kernel.test.js`: handler con bridge finto. Copre:
  validazione degli input, eventi solo al webContents giusto, spegnimento a
  ricarica e chiusura, `shutdownAll`.
- `tests/notebook-run.test.js`: `appendOutput` (stream uniti, nomi
  diversi, `clear` subito o con `wait`, immutabilità) e `kernelNameOf`.
- `tests/notebook-edit.test.js`: `setOutputs`, `cellIndexById`.
- `tests/editor-notebook-run-ui.test.js`, con `window.api` finto:
  - Ctrl+Invio avvia il kernel una volta sola ed esegue;
  - `[*]`, poi output e numero nel JSON;
  - Shift+Invio esegue e passa oltre;
  - «Esegui tutto»;
  - output con un'altra cella in modifica (l'editor resta);
  - interrompi e riavvia;
  - `missing` → messaggio in barra;
  - chiudere il file spegne il kernel.

## Fuori

- `input()` (stdin del kernel): risponde con un errore, come
  `allow_stdin=False`.
- Scegliere o cambiare kernel dalla barra; `update_display_data`;
  completamento e tooltip dal kernel; widget.
- «Esegui sopra/sotto», `Alt+Invio`.
- Togliere gli output dalla pila dell'undo: il JSON resta l'unica verità,
  e ogni scrittura ci passa.

## Emerso strada facendo

- Lo spegnimento a `will-quit` sta in `app/notebook-kernel.js` (opzione
  `app`): `main.js` resta cablaggio, una riga in più per la registrazione.
  Il tetto di `main.js` in `tests/unit.test.js` passa a 240, con la nota.
- Il bridge gira con `-B` ma non con `-I`/`-s`: `jupyter_client` e
  `ipykernel` installati con `pip install --user` stanno nel site utente,
  che `-s` toglie.
- Shift+Invio sulla cella di codice ora la esegue e poi passa oltre, come
  in Jupyter; su una markdown passa e basta.
- L'output scrive nel JSON senza ridisegnare il notebook: si aggiorna solo
  la cella interessata, così l'editor di un'altra cella aperta resta dov'è.
  Le scritture sono raggruppate ogni 100 ms, tranne `started` e `done`.
- Le corse sono legate all'`id` della cella, non all'indice: spostare la
  cella mentre gira non manda l'output altrove.
- «Esegui tutto» si ferma al primo errore come Jupyter: le celle dopo
  restano `[ ]` (il kernel le annulla con `aborted`).
- `NB` e `nbSetup` dei test sono passati in `tests/editor-notebook-setup.js`,
  usato sia dai test di modifica sia da quelli di esecuzione.
- Dalla review: un `restart` che falliva (python del kernel sparito, venv
  cancellato) lasciava il ponte a metà, con `km` vivo e `kc` nullo, e ogni
  riavvio dopo cadeva su `stop_channels`. Ora il kernel fallito si lascia
  andare (`discard_kernel`) e il riavvio dopo riparte da capo; `connect`
  pulisce su qualunque eccezione, non solo `RuntimeError`.
- Dalla review: nei notebook senza `id` (nbformat < 4.5, ancora tanti) la
  corsa usava l'indice di partenza, e una cella aggiunta o eliminata
  intanto faceva finire l'output sulla cella di un altro. Ora senza id si
  ritrova la cella dal sorgente: all'indice di partenza se c'è ancora lei,
  se no l'unica cella di codice con quel sorgente; se non si sa quale,
  l'output si perde. Limite: se si modifica la cella mentre gira, il suo
  output va perso. Il formato del file non si tocca (niente passaggio a 4.5).

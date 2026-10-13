# 61 — `feat/editor-copia-file`: copiare file dall'esterno nell'albero dell'editor

Dipende da: 60 (sessione editor). Taglia: ~1-2 giorni.
Passi di implementazione, test e codice: `61-editor-copia-file-tasks.md`.

## Perché

L'albero della scheda editor sa creare, rinominare e cestinare, ma per
portarci dentro un file che sta altrove (un'immagine scaricata, un file di
configurazione da un altro progetto) oggi si passa dal file manager del
sistema o da una shell. Copiarlo dall'albero tiene il lavoro nella finestra.

## Cosa fa (perimetro)

Tre modi di portare file e cartelle dentro una cartella dell'albero (scelti
dall'utente, tutti e tre):

- **Trascinare** file o cartelle dal file manager del sistema su una
  cartella dell'albero, o sullo spazio vuoto per la radice. La cartella
  sotto il puntatore si evidenzia.
- **Menu**: nel menu di una cartella (e della radice) la voce «Copia qui
  file…» apre la finestra di scelta del sistema, più file selezionabili.
- **Incolla**: voce «Incolla» nello stesso menu, e Ctrl+V con l'albero a
  fuoco, dopo aver copiato i file nel file manager.

Regole (scelte dall'utente):

- **Conflitti**: se nella destinazione c'è già un elemento con lo stesso
  nome si chiede ogni volta: «Sostituisci», «Tieni entrambi» (la copia
  prende un nome libero, `nome (2).ext`), «Salta», con «per tutti».
  Sostituire manda l'elemento esistente nel **cestino**, mai cancellato.
- **Cartelle** ricorsive, con tutto il contenuto. I link simbolici si
  copiano come link, non si seguono.
- **Limiti**: oltre 10.000 file o 1 GB in totale la copia si rifiuta prima
  di cominciare, dicendo quanto sarebbe.

## Fuori

- Spostare file trascinandoli dentro l'albero stesso.
- Barra di avanzamento e annullamento: durante la copia la barra della
  scheda dice «Copio N file…». Se copie grandi lo chiedono, è un piano a parte.
- Copiare dall'albero verso l'esterno (trascinare fuori, Ctrl+C).

## Come: due fasi decise dal main

Il renderer è sandboxed e non tocca il disco; il main non deve fare domande
all'utente in mezzo a una copia. Quindi:

1. **Piano** (`editor-copy-plan`): il main riceve i percorsi sorgente e la
   cartella di destinazione (`rel`), controlla, conta, e restituisce i
   conflitti di primo livello (gli elementi copiati direttamente nella
   destinazione; il contenuto di una cartella sostituita non conta come
   conflitto a parte).
2. **Domande** nel renderer, con la bolla di conferma già usata
   (`renderer/confirm-bubble.js`), una per conflitto, «per tutti» per
   chiudere le rimanenti.
3. **Copia** (`editor-copy-run`): il main riceve il piano e le decisioni,
   copia, restituisce cosa è andato e cosa no. Il renderer ricarica la
   cartella di destinazione.

Scartata l'alternativa «un file alla volta col main che chiede al renderer
a ogni conflitto»: IPC nei due sensi, più fragile, nessun guadagno.

## Componenti

- **`lib/editor-copy.js`** (puro, niente electron; riceve `editorFs`,
  `trash` e `platform` dalla factory):
  - `planCopy(sources, destRel)` → `{ ok, items, conflicts, files, bytes }`
    o `{ ok: false, error }`. Controlla: sorgenti assoluti ed esistenti;
    destinazione dentro la radice (`resolveInside` di `lib/editor-fs.js`)
    ed è una cartella; nessuna cartella copiata dentro se stessa o dentro
    una sua sottocartella; due sorgenti con lo stesso nome finale (da
    cartelle diverse) → rifiuto con messaggio, perché finirebbero sullo
    stesso nome; limiti di file e byte (contando ricorsivamente, senza
    seguire i link).
  - `runCopy(plan, decisions)` → `{ ok, copied, skipped, failed: [{name, error}] }`.
    `decisions` mappa il nome di ogni conflitto a `replace | keep-both | skip`.
    Ricorsiva; i link si ricreano come link; `keep-both` sceglie il primo
    `nome (N).ext` libero; `replace` cestina l'esistente e poi copia. Un
    errore su un elemento non ferma gli altri.
  - Il piano rifà i controlli quando arriva a `runCopy` (fra le due fasi il
    disco può cambiare): un sorgente sparito diventa un `failed`, non un crash.
- **`lib/clipboard-files.js`** (puro): dai buffer degli appunti ai percorsi.
  `x-special/gnome-copied-files` (GNOME: `copy\nfile:///…`),
  `text/uri-list` (KDE e altri, righe `file://`, commenti `#`), `FileNameW`
  su Windows (UTF-16LE, terminato da zero). Solo `file://` locali, decodifica
  dei `%xx`, percorsi assoluti.
- **`app/editor.js`**: canali `editor-copy-plan`, `editor-copy-run`,
  `editor-pick-files` (apre `dialog.showOpenDialog` dal main, con
  `openFile`, `openDirectory` dove il sistema lo permette e
  `multiSelections`: i percorsi scelti non passano dalla UI prima di essere
  usati), `editor-clipboard-files` (legge gli appunti nel main con
  `clipboard.readBuffer` e li passa a `lib/clipboard-files.js`).
- **`preload.js`**: `editorPathForFile(file)` → `webUtils.getPathForFile`
  (in Electron 33 `File.path` non c'è più) e le quattro chiamate nuove.
- **`renderer/editor-tree.js`**: drop sulle righe-cartella e sullo spazio
  vuoto (radice), evidenziazione durante il `dragover`; voci di menu
  «Copia qui file…» e «Incolla» sulle cartelle e sulla radice; Ctrl+V con
  l'albero a fuoco. Il modulo emette un'azione (`copy-into`, con la `rel`
  della cartella e la sorgente: `drop` con i percorsi, `pick`, `paste`);
  non fa IPC.
- **`renderer/editor-tab.js`**: gestisce l'azione: ottiene i percorsi (drop:
  già nell'azione; pick/paste: chiamata al main), chiede il piano, le
  decisioni, lancia la copia, ricarica la cartella, scrive l'esito nella
  barra («Copiati 12 file, 1 saltato, 2 non copiati: …»).

## Sicurezza

- I percorsi sorgente arrivano dal renderer solo nel caso del drop (dal
  preload, `webUtils`); negli altri due casi li ottiene il main. Il modello
  di fiducia è quello del piano 60: il renderer già sceglie la radice
  dell'editor e lancia comandi nei pty. Il main comunque valida: sorgenti
  assoluti, esistenti; destinazione dentro la radice con `realpath`.
- Nessuna sovrascrittura silenziosa: chi sostituisce passa dal cestino.
- Nomi dei file nella UI via `textContent`.

## Windows

- `FileNameW` dagli appunti; percorsi con separatori `[\\/]`.
- `dialog.showOpenDialog` su Windows non mescola file e cartelle nella
  stessa finestra: si offrono i file (le cartelle si portano col drop o
  incollando).
- Test con `platform: 'win32'` in `tests/windows.test.js`.

## Test

- `lib/editor-copy.js` con tmpdir: piano senza conflitti; conflitti; le tre
  decisioni; «Tieni entrambi» con `(2)` già occupato; cartella dentro se
  stessa; link simbolico copiato come link; limiti di file e di byte;
  sorgente sparito fra piano e copia; destinazione fuori dalla radice.
- `lib/clipboard-files.js`: i tre formati, URI con `%20`, righe non `file:`
  scartate, buffer vuoti.
- `app/editor.js`: i quattro canali con dialog/clipboard finti.
- `renderer/editor-tree.js`: drop su cartella e su spazio vuoto, voci di menu.
- `renderer/editor-tab.js` (harness di `tests/editor-tab.test.js`): flusso
  piano → domande → copia → ricarica; «per tutti»; esito nella barra.

## Da verificare a mano

- Trascinare da Nautilus/Dolphin un file e una cartella; incollare dopo
  Ctrl+C nel file manager su GNOME e su KDE (X11 e Wayland se possibile).
- Sostituisci: l'originale è nel cestino del sistema.

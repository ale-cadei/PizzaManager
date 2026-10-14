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
- **Limiti**: oltre 10.000 elementi (file, cartelle e link) o 1 GB in
  totale la copia si rifiuta prima di cominciare, dicendo quale limite passa
  («Troppi file e cartelle: più di 10000.», «Troppo grande: più di 1 GB.»).
  Il conteggio si ferma appena passa il limite: dire il totale vorrebbe dire
  contare tutto anche quando è enorme.

## Fuori

- Spostare file trascinandoli dentro l'albero stesso.
- Barra di avanzamento e annullamento: durante la copia la barra della
  scheda dice «Copio N elementi…». Se copie grandi lo chiedono, è un piano a parte.
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
  - `planCopy(sources, destRel)` → `{ ok, items, conflicts, count, bytes }`
    (`count` = elementi contati ricorsivamente, file e cartelle)
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
  `openFile` e `multiSelections`, più `openDirectory` solo su macOS: Linux e
  Windows non mescolano file e cartelle nella stessa finestra),
  `editor-clipboard-files` (legge gli appunti nel main con
  `clipboard.readBuffer` e li passa a `lib/clipboard-files.js`). Gli ultimi
  due restituiscono i percorsi al renderer, che li passa al piano come
  quelli del drop: un solo giro per le tre sorgenti, e il main li rivalida.
- **`preload.js`**: `editorPathForFile(file)` → `webUtils.getPathForFile`
  (in Electron 33 `File.path` non c'è più) e le quattro chiamate nuove.
- **`renderer/editor-tree.js`**: drop sulle righe (una riga-file vale la
  sua cartella) e sullo spazio vuoto (radice), evidenziazione durante il
  `dragover`; Ctrl+V con l'albero a fuoco. Emette
  `onCopyInto(dir, source)`, con `source` `{kind:'drop', files}` (gli
  oggetti `File`) o `{kind:'paste'}`; non fa IPC.
- **`renderer/editor-tab.js`**: voci «Copia qui file…» e «Incolla» nel menu
  dell'albero (`editorTreeMenu`, cartelle e radice); `showEditorNotice` per
  i messaggi che non sono errori; una guardia sul `document` che rifiuta i
  file lasciati fuori dall'albero (altrimenti Electron apre il file al
  posto della pagina).
- **`renderer/editor-copy-ui.js`** (nuovo, caricato dopo `editor-tab.js`):
  il giro. Ottiene i percorsi (drop: `editorPathForFile` sui `File`;
  pick/paste: chiamata al main), chiede il piano, le decisioni, lancia la
  copia, apre e ricarica la cartella, scrive l'esito nella barra
  («Copiati 12 elementi, 1 saltato, 2 non copiati: …»). Una copia alla
  volta per scheda.

## Sicurezza

- I percorsi sorgente arrivano sempre dal renderer al piano: dal drop (via
  preload, `webUtils`) o dopo un giro nel main (finestra di scelta,
  appunti). Il modello di fiducia è quello del piano 60: il renderer già
  sceglie la radice dell'editor e lancia comandi nei pty. Il main comunque
  valida a ogni fase: sorgenti assoluti, esistenti; destinazione dentro la
  radice con `realpath`.
- Nessuna sovrascrittura silenziosa: chi sostituisce passa dal cestino.
- Nomi dei file nella UI via `textContent`.

## Windows

- `FileNameW` dagli appunti; percorsi con separatori `[\\/]`. `FileNameW`
  porta un solo file (quello che Electron sa leggere): incollarne più di
  uno su Windows ne copia il primo.
- Nomi confrontati senza maiuscole (anche su macOS): `A.txt` e `a.txt`
  dallo stesso drop si rifiutano come doppioni.
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

Verificato su GNOME/Wayland con Nautilus:
- Trascinare un file su una cartella dell'albero: evidenziazione, copia,
  «Copiato 1 elemento» nella barra.
- Trascinare una cartella sullo spazio vuoto: va nella radice.
- Conflitti: «Sostituisci» → cestino del sistema; «Tieni entrambi» →
  `nome (2).ext`; «Salta tutti» → «0 copiati, N saltati».
- Finestra «Copia qui file…»: apre il dialog del sistema.
- Incolla con Ctrl+V e voce «Incolla» dal menu dopo Ctrl+C nel file manager.
- Click nella finestra di conferma durante una copia: una sola bolla,
  no picchi.
- File su sotto-tab, Monaco e scheda terminale: no-op, console pulita.
- Ctrl+V non raggiunge il terminale.

Ancora da verificare (KDE/Dolphin, X11, Windows, macOS):
- `text/uri-list` su Dolphin e X11.
- `FileNameW` su Windows, single file.
- macOS.

## Punti aperti

- **Cartella copiata parzialmente**: se una copia di cartella fallisce a metà,
  la cartella parziale resta su disco e l'outcome dice solo «non copiato»
  senza dettagli. Chi pulisce il disco?
- **Windows + symlink senza Developer Mode**: copiare una cartella che
  contiene un symlink fallisce con messaggio generico «Permesso negato»,
  senza avvertire che serve Developer Mode.
- **Path duplicati case-sensitive**: `isInside` confronta i percorsi per
  caso esatto anche su win32 e darwin (dove il filesystem è case-insensitive);
  due sorgenti da cartelle diverse riconosciute come doppioni solo su
  case-sensitive.
- **Case folding di `isInside` e `foldName`**: `isInside` piega il case solo
  su win32; `foldName` anche su darwin. Inconsistente.

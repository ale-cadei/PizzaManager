# 62 — `feat/editor-pannello`: albero dell'editor ridimensionabile e nascondibile

Dipende da: 60 (sessione editor), 61 (copia di file). Taglia: ~0,5-1 giorno.
Passi di implementazione, test e codice: `62-editor-pannello-tasks.md`.

## Perché

Nella scheda editor l'albero dei file è largo 240px fissi. Con nomi lunghi
o cartelle profonde si taglia; quando si scrive codice ruba spazio a Monaco.
Allargarlo, stringerlo o toglierlo di mezzo con un gesto tiene l'editor
comodo in tutti e due i casi.

## Cosa fa (perimetro)

Scelte dall'utente:

- **Ridimensionare**: una striscia di 6px fra l'albero e l'editor si
  trascina col mouse. Minimo 160px, massimo metà della larghezza della
  scheda. Doppio click sulla striscia: torna a 240px.
- **Nascondere**: un bottone all'inizio della riga delle sotto-schede
  (sempre visibile, anche ad albero chiuso) apre e chiude il pannello;
  title «Mostra/nascondi file (Ctrl+B)». **Ctrl+B** fa lo stesso, solo con
  una scheda editor attiva: nelle schede terminale Ctrl+B resta della shell.
  Oggi Ctrl+B non è usato da nessuna parte nell'app.
- **Memoria**: larghezza e aperto/chiuso sono uguali per tutte le schede
  editor e si ricordano al riavvio, in `localStorage`
  (`aisess.editorTreeW`, `aisess.editorTreeHidden`), come la sidebar
  (`renderer/panels.js`) e il pannello modifiche.

## Fuori

- Larghezza o stato per singola scheda.
- Chiudere il pannello trascinando la striscia sotto il minimo.
- Spostare l'albero a destra.

## Come

Tutte le schede editor cambiano insieme, quindi lo stato non sta nelle
schede ma sulla pagina:

- la larghezza è una variabile CSS sul documento, `--editor-tree-w`, che
  `.editor-side` usa come `width`;
- nascosto = classe `editor-tree-hidden` su `body`, che mette
  `.editor-side` e la striscia a `display: none`.

Monaco ha già `automaticLayout: true` (`renderer/editor-monaco.js`): si
ridisegna da solo quando il suo contenitore cambia larghezza.

## Componenti

- **`renderer/editor-panel.js`** (nuovo, UMD come `editor-tree.js`,
  caricato prima di `editor-tab.js`):
  - puro: `clampWidth(w, max)` → fra 160 e `max` (metà scheda, mai sotto
    160); `readPanelPrefs(storage)` → `{ width, hidden }` coi default
    (240, aperto) se il valore salvato manca o non è valido;
    `savePanelPrefs(storage, prefs)`; le eccezioni di `localStorage` non
    fermano niente (come in `panels.js`).
  - DOM: `applyPanelPrefs(doc, prefs)` scrive variabile e classe;
    `createPanel({ doc, storage })` tiene le preferenze correnti (così il
    bottone funziona anche se `localStorage` lancia), le applica subito e
    offre `toggle()`, `prefs()` e `attachResizer(resizer, { side, wrap, win })`:
    trascinamento con `pointerdown` e `pointermove`/`pointerup` sulla
    finestra, come `changes-panel.js`, salvato al rilascio; doppio click.
    `isToggleKey(e)` riconosce Ctrl+B.
- **`renderer/editor-tab.js`**: in `buildEditorLayout` la striscia
  (`editor-resizer`) fra `.editor-side` e `.editor-main`; il bottone
  (`editor-tree-toggle`) in una riga che contiene anche le sotto-schede, ma
  **fuori** dal `tablist` (le sotto-schede si ridisegnano e lo
  cancellerebbero).
- **Ctrl+B**: un listener `keydown` sul `document`, attivo solo se la
  scheda attiva è un editor; `preventDefault` solo in quel caso. Se Monaco
  ha il fuoco il tasto arriva comunque (Monaco non usa Ctrl+B).
- **Avvio**: le preferenze si applicano una volta al caricamento, così una
  scheda editor nuova nasce già con larghezza e stato giusti.
- **CSS** in `renderer/styles.css`: striscia (cursore `ew-resize`, colore al
  passaggio come `#sidebar-resizer`), bottone, regole per
  `body.editor-tree-hidden`.

## Interazioni con il piano 61

- Ad albero nascosto un file lasciato sulla scheda finisce nella guardia
  del documento: non succede niente.
- «Copia qui file…» e Ctrl+V nell'albero ci sono solo ad albero aperto.

## Test

- `tests/editor-panel.test.js`:
  - `clampWidth` (sotto il minimo, sopra il massimo, massimo minore del
    minimo);
  - `readPanelPrefs` con storage vuoto, valori validi, valori rotti, e con
    uno storage che lancia;
  - `applyPanelPrefs` scrive variabile e classe;
  - trascinamento e doppio click con fake-dom;
  - `toggle` salva, e funziona anche con uno storage che lancia.
- `tests/editor-tab.test.js`: il layout ha striscia e bottone; il bottone
  apre e chiude; Ctrl+B con scheda editor attiva sì, con scheda terminale
  no.
- `tests/renderer-load.test.js`: la pagina si carica col modulo nuovo.

## Da verificare a mano

- Trascinare la striscia: l'albero si allarga e si stringe nei limiti,
  Monaco si adatta. Doppio click: torna a 240px.
- Bottone e Ctrl+B (anche col cursore dentro Monaco) aprono e chiudono;
  in una scheda terminale Ctrl+B arriva alla shell.
- Chiudere e riaprire l'app: larghezza e stato restano. Due schede editor
  cambiano insieme.

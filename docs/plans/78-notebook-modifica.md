# 78 — `feat/notebook-completo`: il notebook si modifica dalla vista

Dipende da: 77 (vista notebook). Taglia: ~1 giornata. Seguito: 79 (eseguire
le celle con un kernel).

## Perché

La vista del 77 è in sola lettura: per cambiare una riga di codice bisogna
passare al JSON e cercarla tra le virgolette. Un notebook si usa cella per
cella, come in Jupyter.

## Cosa fa

- **Selezione**: un click seleziona la cella (bordo a sinistra). Tastiera in
  *modo comando* (vista col fuoco, nessuna cella in modifica):
  - `↑`/`↓` o `K`/`J` cambiano cella; `Invio` la modifica;
  - `A`/`B` inseriscono una cella di codice sopra/sotto;
  - `D D` elimina; `M` markdown, `Y` codice, `R` raw;
  - `Z`/`Ctrl+Z` annulla, `Ctrl+Shift+Z`/`Ctrl+Y` ripete;
  - `Ctrl+S` salva, `Shift+Invio` passa alla cella dopo.
- **Modifica**: doppio click o `Invio` → Monaco dentro la cella (linguaggio
  del kernel, `markdown` per le markdown), alto quanto il testo. `Esc` torna
  al modo comando; `Shift+Invio` chiude e passa alla cella dopo (alla fine ne
  crea una nuova); `Ctrl+S` salva. Una markdown chiusa si mostra resa.
- **Barra della cella** (all'hover e sulla selezionata): ↑ ↓ sposta, tipo
  (codice/markdown/raw), «Cancella output», 🗑 elimina.
- **Barra del notebook** in cima: «+ Codice», «+ Markdown» (sotto la
  selezionata, o in fondo), «Cancella tutti gli output».
- Il file resta il JSON nel model di Monaco: ogni modifica lo riscrive con
  `host.editText` (nella pila dell'undo, segna il file «modificato»).
  Salvare, ricaricare dal disco, il bottone «{ } Sorgente» funzionano come
  prima.

## Come

- **`renderer/notebook-edit.js`** (UMD puro): operazioni sul JSON grezzo,
  ognuna torna un oggetto nuovo: `parseRaw`, `setSource`, `insertCell`,
  `deleteCell`, `moveCell`, `setType`, `clearOutputs`, `serialize`.
  - `serialize` scrive come Jupyter: rientro preso dal file (default 1),
    `source` ad array di righe con il `\n`, a capo finale se c'era. L'ordine
    delle chiavi resta quello del file: un notebook di Jupyter cambia solo
    dove si è modificato. Le celle nuove hanno le chiavi in ordine
    alfabetico, come le scrive Jupyter.
  - Celle nuove con `id` (nbformat ≥ 4.5), da un generatore passato
    (`crypto.randomUUID` nella pagina, deterministico nei test).
  - Cambiare tipo: verso codice aggiunge `outputs: []` e
    `execution_count: null`, via dal codice li toglie.
- **`renderer/notebook-model.js`**: ogni cella porta `index`, la posizione
  nel JSON grezzo (le celle non oggetto si saltano, gli indici restano
  quelli del file).
- **`renderer/notebook-view.js`**: con `opts.selected` la classe
  `nb-cell--selected`; `dataset.index` su ogni cella. Resta solo disegno.
- **`renderer/editor-notebook-ui.js`**: selezione, modo comando/modifica,
  barre, tasti. Le scritture nel JSON dalla vista non ridisegnano la cella in
  modifica (la versione nuova si annota come già mostrata); quelle da fuori
  (undo, JSON, disco) sì.
- **`renderer/editor-monaco.js`**: l'host espone
  `cellEditor(node, {text, language, onChange, onKey})` (un editor piccolo
  senza margini, alto quanto il contenuto, tasti per Esc/Shift+Invio/Ctrl+S)
  e `undo(rel)`/`redo(rel)` sul model del file.
- Battendo, il testo arriva al JSON dopo 300 ms di pausa e subito uscendo
  dalla cella: lo stato «modificato» si accende senza riscrivere il JSON a
  ogni tasto.

## Test

- `tests/notebook-edit.test.js`: ogni operazione, immutabilità, `serialize`
  identico all'originale senza modifiche (rientro 1 e 2, a capo finale),
  righe di `source`, id delle celle nuove solo da 4.5, cambio di tipo.
- `tests/notebook-model.test.js`: `index` con celle non oggetto in mezzo.
- `tests/notebook-view.test.js`: selezionata e `dataset.index`.
- `tests/editor-notebook-ui.test.js`: click seleziona; tasti A/B/DD/M/Y/
  frecce scrivono il JSON giusto via `editText`; modifica → editor della
  cella → testo nel JSON; Esc torna al comando; Shift+Invio sull'ultima crea
  una cella; Z chiama `undo`; Ctrl+S salva; barra della cella sposta ed
  elimina.
- `tests/editor-monaco.test.js`: `cellEditor` con Monaco finto (opzioni,
  altezza, tasti), `undo`/`redo`.

## Fuori

- Eseguire le celle: piano 79.
- Copia/incolla di celle (`C`/`V`), selezione multipla, trascinare le celle.
- «+ Codice | + Markdown» tra due celle all'hover: bastano `A`/`B` e la barra in alto, che aggiunge sotto la selezionata.
- Modificare i metadati del notebook o delle celle.

## Emerso strada facendo

- Gli ultimi tasti nella cella (in attesa dei 300 ms) sfuggivano a «Salva»,
  «Salva tutto», chiusura del file, della scheda e dell'app: ora
  `flushEditorNotebook` li scrive nel modello prima di ogni controllo
  `dirty` (`editorDirtyFiles` in `editor-tab.js`).
- `renderer/editor-tab.js` è a ~807 righe, oltre il tetto di 800: va diviso
  in un branch di refactor a sé (es. salvataggio/chiusura in un file loro).

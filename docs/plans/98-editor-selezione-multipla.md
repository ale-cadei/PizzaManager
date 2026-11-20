# 98 — Selezione multipla nell'albero dell'editor (`feat/editor-selezione-multipla`)

Il piano 95 copia e taglia un elemento alla volta: l'albero ha una sola
selezione. Qui Ctrl+click e Maiusc+click per sceglierne più d'uno, e
copia/taglia/incolla di tutti insieme, anche fra schede editor diverse.

## Decisioni

- **Il modello**: `selected` resta la riga a fuoco (F2, Canc, Ctrl+V, apertura
  dei file); in più `marked` (le righe scelte) e `anchor` (da dove parte
  Maiusc+click). `selection(tree)` dà tutte le righe scelte, quella a fuoco
  per ultima; senza `marked` è solo `selected`.
- **Click semplice** come prima: apre il file o la cartella e azzera la
  scelta. **Ctrl/Cmd+click** aggiunge o toglie la riga, senza aprire niente.
  **Maiusc+click** sceglie l'intervallo dall'ancora fra le righe mostrate
  (anche nella vista filtrata).
- **Ctrl+C / Ctrl+X** e le voci del menu mettono negli appunti tutte le righe
  scelte (formato GNOME, un URI per riga). Il menu su una riga fuori dalla
  scelta lavora solo su quella. Una cartella scelta insieme a qualcosa che
  contiene: va negli appunti solo la cartella (`outermost`, lib/editor-paths.js),
  altrimenti lo spostamento della cartella farebbe sparire il resto.
- **Fra schede editor**: gli appunti sono già quelli del sistema. Mancava che
  le altre schede se ne accorgessero (l'albero non ha un watch sulle
  cartelle): dopo una copia o uno spostamento ogni altra scheda locale rilegge
  le cartelle toccate che ha già letto, e i file aperti spostati dentro la sua
  stessa cartella la seguono. `runCopy` dà per questo anche i percorsi
  assoluti (`from`, `to`) di ogni spostamento.
- Windows: gli appunti (`FileNameW`) tengono un solo file. Con più righe
  scelte il main risponde con un errore chiaro.

## Fuori

- Elimina e trascina di più righe insieme: restano su una riga sola.

## Test

- `tests/editor-tree.test.js`: markToggle, markRange, selection, renamePath e
  removePath con `marked`; vista: Ctrl/Maiusc+click chiamano `onMark`, righe
  scelte evidenziate, Ctrl+C con più righe.
- `tests/editor-paths.test.js` (o lib): `outermost`.
- `tests/editor-ipc.test.js`: put con `rels`, cartella e figlio, Windows.
- `tests/editor-copy.test.js`: `moved` con `from`/`to`.

## Stato

Fatto. Test verdi (suite intera 2424 pass); smoke nell'app da fare.

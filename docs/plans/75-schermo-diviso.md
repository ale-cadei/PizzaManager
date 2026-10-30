# 75 — `feat/multi-window`: due sessioni a schermo diviso

Taglia: ~1 giornata.

## Perché

Lavorare con un agente e intanto guardare una shell (o l'editor, o un
secondo agente) oggi costa un cambio di scheda ogni volta. Due sessioni
affiancate, o una sopra l'altra, si guardano insieme.

## Cosa fa

- **Si apre trascinando una card** dalla sidebar sopra l'area dei terminali.
  Appare una velina: il bordo più vicino al cursore (sinistra, destra, sopra,
  sotto) decide dove va la sessione trascinata; l'altra metà resta alla
  sessione in primo piano. Destra/sinistra → affiancate, sopra/sotto →
  impilate.
- Già diviso: trascinare una delle due card la sposta dalla parte indicata
  (anche cambiando orientamento); trascinarne una terza sostituisce la metà
  **non** in primo piano.
- **Linea divisoria trascinabile**: proporzione fra 20% e 80%, doppio click
  torna a 50/50.
- **All'hover della linea** un pulsantino ⇄ scambia le due sessioni (la linea
  resta dov'è). Accanto un ✕ toglie la divisione e lascia la sessione in
  primo piano.
- Una metà è **in primo piano** (`activeId`): bordo sottile del colore
  principale. Click o fuoco dentro l'altra metà la porta in primo piano;
  sidebar, barra dell'uso e pannello delle modifiche la seguono come oggi.
- Click su una card che non è nella divisione: prende il posto della metà in
  primo piano (come i gruppi di un editor).
- Chiudere una delle due sessioni toglie la divisione.
- **Si ricorda al riavvio**: orientamento, proporzione e le due sessioni
  (chiavi stabili di `session-order.js`, più `tipo:cartella` per git ed
  editor) in `aisess.split`. Si ricompone una volta, a riaggancio e
  ripristino automatici finiti, solo se tornano entrambe.

## Come

- `renderer/split-layout.js` (UMD, puro, testato): stato
  `{ orientation: 'row'|'column', first, second, ratio }` o `null`.
  `dropZone`, `place`, `select`, `swap`, `without`, `visibleIds`,
  `clampRatio`, `ratioAt`, `toSaved`, `fromSaved`. Nessuna mutazione.
- `renderer/split-view.js` (script dell'app, dopo `app-state.js`): stato
  corrente, classi su `#terminals` (`split-row`/`split-column`), `order` e
  `flex-basis` dei due wrap, `#split-divider` con ⇄ e ✕, velina
  `#split-drop`, trascinamento della linea, salvataggio.
- `.active` sul wrap continua a voler dire **visibile** (fit, barra di
  scorrimento, `isVisible` la usano): diventano `.active` le due metà;
  `.split-focus` segna quella in primo piano.
- `tabs.js`: `setActive` passa da `splitSelect`, `fitActive` rifà il fit di
  tutte le visibili, `closeTab` lascia il posto alla compagna.
- La card trascinata si riconosce da `dragstart` su `.session-item`:
  file o testo trascinati da fuori non aprono la velina.

## Test

- `tests/split-layout.test.js`: zone ai bordi, divisione nuova dai quattro
  bordi, card già divisa che cambia lato/orientamento, terza card che
  sostituisce la metà non in primo piano, nessuna divisione con sé stessa,
  scambio, chiusura, click su card dentro/fuori, ratio limitato e da
  puntatore, salvataggio e ripristino con chiavi, dati salvati malformati.
- `tests/renderer-load.test.js`: il file nuovo è nella pagina.

## Fuori

- Più di due metà.
- Ricomporre la divisione con sessioni ricreate dal dialogo dopo un riavvio
  della macchina (arrivano più tardi, su scelta dell'utente).
- Segno sulla card della metà non in primo piano.
- Scorciatoie da tastiera per dividere / scambiare.

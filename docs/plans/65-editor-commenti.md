# 65 — `feat/editor-commenti`: commenti sulle righe dell'editor e prompt

Dipende da: 60 (sessione editor). Taglia: ~1-2 giorni.
Passi di implementazione, test e codice: `65-editor-commenti-tasks.md`.

## Perché

Il pannello modifiche lascia commentare le righe del diff e manda i
commenti all'agente come prompt di review. Nella scheda editor, mentre si
legge il codice, non c'è niente di simile: le osservazioni si scrivono a
parte e poi si ricopiano a mano nel prompt.

## Cosa fa (perimetro)

Scelte dall'utente:

- **Commentare**: su qualsiasi riga, non solo quelle cambiate. Con più
  righe selezionate il commento vale per l'intervallo.
  - Un «+» nel margine quando il mouse passa su una riga, o il menu del
    tasto destro di Monaco → «Commenta riga» / «Commenta selezione».
  - Si apre un riquadro sotto la riga (zona di Monaco) con un campo di
    testo: Ctrl+Enter salva, Esc annulla.
- **Commenti salvati**: restano visibili nel riquadro sotto l'ultima riga
  commentata, con «Modifica» ed «Elimina». Le righe commentate hanno uno
  sfondo leggero. Se il testo sopra cambia, il commento segue le sue righe.
- **Prompt**: nella riga in alto della scheda editor compare, quando ci
  sono commenti, «N commenti · Copia prompt · Svuota».
  - «Copia prompt» mette negli appunti il prompt, nello stesso formato di
    quello del pannello modifiche (`formatPrompt` di
    `renderer/review-notes.js`), con l'intestazione «Correggi questi punti
    del codice:» e i commenti di tutti i file della scheda, in ordine di
    file e riga.
  - Dopo la copia un fumetto chiede «Copiato. Svuoto i commenti?».
- **Vita dei commenti**: in memoria nella scheda editor, come quelli del
  pannello modifiche; spariscono chiudendo la scheda. Chiudere un file con
  commenti chiede conferma (i suoi commenti si perdono).

## Fuori

- Salvare i commenti fra un riavvio e l'altro.
- Incollare il prompt direttamente in una sessione agente.
- Commenti nel pannello modifiche che compaiono nell'editor, o viceversa.

## Come

- **`renderer/review-notes.js`**: `formatPrompt(notes, { header })` con
  l'intestazione di oggi come default; nient'altro cambia per il pannello
  modifiche.
- **`renderer/editor-notes.js`** (nuovo, UMD, puro): stato dei commenti di
  una scheda, immutabile (`add`, `update`, `remove`, `clear`, `forFile`,
  `move` per aggiornare le righe dopo una modifica) e `toReviewNotes(notes,
  linesOf)` che li trasforma nelle note di `formatPrompt` (`path`, righe con
  `side: 'new'`, `kind: 'ctx'`, testo della riga).
- **`renderer/editor-monaco.js`**: l'host offre le zone (`addZone(rel,
  afterLine, node)` → id, `removeZone`), le decorazioni con tracciamento
  delle righe (`trackLines(rel, from, to)` → id, `linesOf(id)`), l'azione
  nel menu del tasto destro e il «+» nel margine (`glyphMargin`).
- **`renderer/editor-notes-ui.js`** (nuovo): riquadri di scrittura e di
  lettura, barra «N commenti», copia e fumetto. Testo dell'utente sempre
  con `textContent`.
- **Appunti**: `window.aisess.clipboardWrite(text)`, che esiste già.

## Test

- `tests/editor-notes.test.js`: aggiungere, modificare, togliere, svuotare;
  `move` dopo righe inserite/tolte sopra; `toReviewNotes` + `formatPrompt`
  con riga singola, intervallo, più file, intestazione nuova.
- `tests/review-notes.test.js`: il default dell'intestazione non cambia.
- `tests/editor-tab.test.js`: la barra compare col primo commento e sparisce
  con l'ultimo; «Copia prompt» chiama `clipboardWrite` col prompt; chiudere un
  file con commenti chiede conferma.

## Da verificare a mano

- Commentare una riga e una selezione: riquadri sotto le righe, sfondo.
- Scrivere sopra un commento: il riquadro segue le righe.
- «Copia prompt» e incollarlo in una sessione claude: formato leggibile,
  percorsi giusti.
- Chiudere il file e la scheda: conferme e commenti persi come detto.
- Il «+» nel margine accanto alle barrette del piano 63: si vedono entrambi.
- Dentro la casella: Ctrl+C/V, Esc, Ctrl+Invio; aggiungere e togliere
  commenti non fa saltare la vista.
- La rotellina del mouse sopra un riquadro: l'editor scorre? (la sonda
  sotto xvfb non sa simulare la rotellina, neanche sulle righe)
- Ricaricare il file dal disco con commenti, poi Ctrl+Z: i commenti restano
  alle loro righe (il Monaco finto dei test non lo mostra).

## Punti aperti

Emersi dalle review, non fatti in questo branch:

- **Casella aperta oltre i limiti:** con già 50 commenti, o una selezione di
  oltre 200 righe, la casella si apre lo stesso; si scopre che non si salva
  solo con Ctrl+Invio. Il messaggio di `add` con la lista piena è quello
  delle righe, non quello del tetto.
- **Casella non salvata alla chiusura:** chiudere il file o la scheda con una
  casella aperta e non salvata la perde senza chiedere: la domanda conta solo
  i commenti salvati.
- **Cestinare un file pulito** dall'albero toglie i suoi commenti, e il
  fumetto della cancellazione non li nomina.
- **Commenti cresciuti oltre 200 righe:** nel prompt il conteggio «altre N
  righe» è più basso del vero.
- **Due «Svuota»:** quello della barra chiude anche la casella aperta, quello
  dopo la copia la tiene (apposta: si copia ciò che è salvato, la bozza resta).
- **Riquadri ricostruiti** a ogni aggiunta, modifica o eliminazione: se nella
  prova si vede saltare la vista, ricostruire solo quelli del file toccato.
- **Senza test:** il collegamento `onComment` (margine e menu → casella) e la
  domanda di chiusura senza `anchor` (dall'editor, o quando un worktree chiude
  le sue schede: `worktrees.js:37`).
- **Pulizia:** i listener del mouse non sono tenuti per il dispose (ci
  pensa `editor.dispose()`); in `putMarks` il parametro `from` copre quello
  di `rename`. Innocui.
- **Riquadri in overlay:** lo strato delle righe di Monaco sta sopra le zone
  e si prende clic e fuoco, quindi la casella nella zona non si poteva usare
  (visto nello smoke). Come lo ZoneWidget di Monaco, la zona tiene lo spazio
  e il riquadro sta in un overlay widget messo all'altezza della zona
  (`onDomNodeTop`). Gli overlay restano dopo `setModel`: l'host li toglie
  cambiando file, rinominando e chiudendo.
- **Uscire dall'app** con commenti non chiede niente: `askEditorExit` guarda
  solo i file con modifiche.
- **Percorsi nel prompt** relativi alla cartella della scheda editor: se
  l'agente gira altrove non combaciano (vedi i punti aperti del piano dei task).
- `editor-tab.js` è a ~720 righe: la prossima modifica lì sposta prima
  qualcosa fuori.

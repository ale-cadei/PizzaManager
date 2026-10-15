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

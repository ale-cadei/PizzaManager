# 83 — `feature/visualizzatore-md`: anteprima dei file markdown nell'editor

Dipende da: 60 (scheda editor), 77 (parser e disegno del markdown dei notebook).
Taglia: ~2h.

## Perché

Un `.md` aperto nella scheda editor si legge solo come sorgente: titoli con
`#`, tabelle a pipe, blocchi di codice fra backtick. Per leggere un README o
un piano (come questo) serve vederlo reso.

## Cosa fa

- Un file `*.md` / `*.markdown` / `*.mdown` / `*.mkd` si apre **in Monaco**,
  come oggi: si modifica senza un clic in più.
- Nella testata compare **«▤ Anteprima» / «{ } Sorgente»**: passa alla vista
  resa, **in sola lettura**, e torna al sorgente.
- La vista si disegna dal testo dell'editor (anche non salvato); ricaricato
  dal disco o cambiato, si ridisegna e resta allo stesso punto di scorrimento.
- La scelta vale per file: passando a un altro e tornando si ritrova; chiuso
  il file, se ne va.

## Come

- **Niente parser nuovo**: `notebook-markdown.js` + `NotebookView.renderMarkdown`
  (piano 77). Quindi stesse garanzie: `createElement`/`textContent`, l'HTML
  nel markdown resta testo, i link non navigano (bersaglio nel `title`),
  immagini solo da `data:`, codice colorato da Monaco col tema dell'app.
- **`renderer/editor-markdown-ui.js`** (script dell'app, dopo
  `editor-notebook-ui.js`): `syncEditorMarkdown`, `toggleEditorMarkdown`,
  `dropEditorMarkdown`, stato in `tab.editor.markdown`.
- **`renderer/editor-tab.js`**: bottone `mdToggle` dopo quello del notebook,
  contenitore `markdown` nel riquadro (classe `editor-notebook editor-markdown`,
  ne riusa scorrimento e caratteri).
- **`renderer/editor-open-ui.js`**: `renderEditorOpen` chiama
  `syncEditorMarkdown` **dopo** `syncEditorNotebook`; sui file non markdown
  non tocca `ui.host`, che resta del notebook.
- **`renderer/styles.css`**: `.md-preview`, colonna da lettura (860px).

## Test

- `tests/editor-markdown-ui.test.js`: bottone e vista nascosti nel layout;
  `.md` apre nel sorgente; toggle → titoli, grassetto, codice colorato col
  linguaggio del blocco; `<script>` resta testo; altri file senza bottone e
  scelta ricordata per file; notebook non toccato; ridisegno al cambio di
  testo e riuso a testo uguale; chiusura del file.

### Incidente: un test che finiva la RAM

Aggiungere il contenitore nel riquadro ha fatto fallire
`editor-tab.test.js` («layout: …»), che confrontava con `deepStrictEqual` i
**nodi** del DOM finto. Nel costruire il diff, assert ispeziona nodi con
riferimenti circolari (genitore ↔ figli): la stringa cresce senza fine,
26 GB di RSS, PC bloccato due volte. Corretto così:
- il test confronta le classi, e gli altri confronti fra nodi finti
  (`editor-tab`, `editor-notes-ui`, `changes-view`, `editor-quick`) sono
  diventati `assert.ok(a === b, …)`: un fallimento non stampa i nodi;
- `test:unit` e `test:coverage` girano con `--max-old-space-size=2048`,
  ereditato dai processi figli di `node --test` (verificato: heap 2096 MB nel
  figlio), su ogni piattaforma: un test fuori controllo muore da solo.

**Regola**: mai passare nodi di `fake-dom` a `deepStrictEqual`/`strictEqual`;
confrontare classi, testi o `===`.

## Smoke

Da fare: app vera con `AISESS_PROFILE`, scheda editor su questa cartella,
`docs/plans/README.md` → «Anteprima» (tabella, link, titoli), modifica nel
sorgente → la vista la mostra, Ctrl+S dal sorgente.

## Fuori

- Immagini relative al file (`![](img/x.png)`): restano `[immagine: …]`,
  servirebbe leggerle dal disco nel main.
- Link cliccabili (anche verso altri `.md` del progetto).
- Anteprima affiancata al sorgente, sincronizzata nello scorrimento.
- Cerca (Ctrl+F) nella vista; formule, diagrammi mermaid, HTML grezzo.
- Ricordare la scelta dopo un riavvio.

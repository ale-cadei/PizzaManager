# 77 — `feat/jupyter-notebooks`: i notebook `.ipynb` si leggono come notebook

Dipende da: 60 (sessione editor, Monaco). Taglia: ~1 giornata.

## Perché

Un `.ipynb` aperto nella scheda editor è un JSON lungo: celle come array di
stringhe, output in base64, tracebacks pieni di codici ANSI. Si capisce poco
di cosa fa il notebook e niente di cosa ha prodotto. Chi lavora con un agente
su un progetto Python/dati vuole guardarlo com'è in Jupyter.

## Cosa fa

- Un file `*.ipynb` apre in **vista notebook**, in sola lettura:
  - celle markdown rese (titoli, paragrafi, liste, citazioni, blocchi di
    codice, tabelle, grassetto/corsivo/codice, link, immagini anche da
    `attachment:`);
  - celle di codice colorate col linguaggio del kernel
    (`metadata.kernelspec.language`, poi `language_info.name`, poi python),
    col numero di esecuzione `[n]` a sinistra;
  - output: testo (`stream`, `text/plain`), errori (nome, messaggio,
    traceback senza codici ANSI), immagini PNG/JPEG/GIF/SVG, HTML (tabelle di
    pandas) e markdown;
  - celle raw come testo.
- Un bottone nella testata, **«{ } Sorgente» / «▤ Notebook»**, passa al JSON
  in Monaco e torna indietro. Si modifica e si salva dal JSON come per ogni
  altro file; tornando alla vista, si ridisegna dal testo dell'editor (anche
  non salvato).
- JSON non valido o non nbformat 4: la vista dice perché e offre il sorgente.
- Il file cambiato sul disco e ricaricato: la vista si ridisegna.

## Come

- **`renderer/notebook-model.js`** (UMD puro): `isNotebook(rel)`,
  `parseNotebook(text)` → `{ok, language, cells}` o `{ok:false, error}`.
  Normalizza `source` (stringa o array), sceglie un solo formato per output
  (`image/png` > `image/jpeg` > `image/gif` > `image/svg+xml` > `text/html` >
  `text/markdown` > `text/plain`), toglie l'ANSI, costruisce i `data:` delle
  immagini solo da base64 valido.
- **`renderer/notebook-markdown.js`** (UMD puro): `parseMarkdown(text)` →
  albero di blocchi e inline. Niente HTML: il testo resta testo.
- **`renderer/notebook-view.js`** (UMD, `document` passato): disegna
  l'albero con `createElement` e `textContent`. Mai `innerHTML`.
  - I link **non** sono `<a href>`: l'app non ha un gestore per la
    navigazione e un click porterebbe la finestra fuori dalla pagina. Testo
    sottolineato col bersaglio nel `title`.
  - L'HTML degli output va in un `<iframe sandbox="allow-same-origin" srcdoc>`:
    senza `allow-scripts` niente script, form, popup o navigazione in alto;
    eredita la CSP della pagina (immagini solo `data:`). `allow-same-origin`
    serve solo a misurarne l'altezza dal genitore.
  - Il colore del codice lo dà Monaco (`colorizeElement`), dall'host, **col
    tema dell'app**: senza `theme`, `colorizeElement` fa `setTheme('vs')` per
    tutta la pagina e anche l'editor diventa chiaro (visto nello smoke).
- **`renderer/editor-notebook-ui.js`** (script dell'app, come
  `editor-blame-ui.js`): bottone, scelta fra vista e Monaco per il file
  attivo, ridisegno quando la versione del testo cambia.
- **`renderer/editor-monaco.js`**: l'host espone `colorize(node, language)`.
- **`renderer/editor-languages.js`**: `.ipynb` → `json`, per il sorgente.
- **`renderer/editor-tab.js`**: il bottone in testata (dopo lo spazio, prima
  dei commenti e di «Vai al file») e il contenitore della vista nel riquadro
  di Monaco (`editor-stage`), sotto conflitto e stato vuoto.
- **`renderer/editor-open-ui.js`**: `renderEditorOpen` chiama
  `syncEditorNotebook`, dove cambia il file attivo o il suo testo.

Nato come piano 75 prima del ridisegno dell'editor (75, PR #61) e dello
schermo diviso (76): rinumerato 77 al merge, bottone e vista spostati nella
testata e nel riquadro nuovi.

## Test

- `tests/notebook-model.test.js`: riconoscimento per estensione; `source` a
  stringa e ad array; linguaggio dai metadati; scelta del formato; ANSI tolto;
  base64 non valido scartato; attachment; JSON rotto e nbformat 3 → errore.
- `tests/notebook-markdown.test.js`: ogni blocco e inline, annidamenti,
  testo con `<script>` resta testo.
- `tests/notebook-view.test.js` (DOM finto): celle e output nell'ordine,
  niente `innerHTML`, link senza `href`, iframe con `sandbox` senza
  `allow-scripts`, colorize chiamato col linguaggio.
- `tests/editor-notebook-ui.test.js` (pagina vera, host finto): `.ipynb`
  apre in vista, bottone passa al sorgente e torna, file non notebook non
  mostra il bottone, testo cambiato → ridisegno, JSON rotto → messaggio.
- `tests/editor-monaco.test.js`: `colorize` passa il tema dell'editor.

## Smoke

App vera sotto xvfb, `HOME` e `TMUX_TMPDIR` isolati, guidata via CDP: scheda
editor su una cartella con un notebook (markdown, codice, stream, errore,
PNG, tabella HTML). Vista notebook coi blocchi attesi, codice colorato
(`mtk*`), iframe dell'HTML alto quanto la tabella; «Sorgente» mostra Monaco
col JSON, una modifica + «Notebook» si vede nella vista.

Esito: ok. Celle `[1]…[3]`, markdown (titolo, grassetto, link, tabella),
codice colorato col tema scuro, PNG alla sua misura, tabella pandas
nell'iframe (91px); l'HTML ostile nell'output (`<script>` e `onerror` che
cambiano `parent.document.title`) non gira, le sue immagini esterne restano
bloccate. «Sorgente» → Monaco col JSON in `json`; `1/0` → `2/0` nel JSON e
la vista lo mostra. `a.py` senza bottone; `rotto.ipynb` → messaggio d'errore
con «Apri il sorgente».

Ripetuto dopo il merge col ridisegno: stessa vista (celle `[1]…[3]`, codice
colorato, PNG 8px, iframe 91px con 3 righe, titolo intatto), bottone in
testata fra spazio e «Vai al file», toggle e modifica ok, console pulita.

## Fuori

- Modificare ed eseguire le celle (serve un kernel).
- Formule LaTeX (`$…$` restano testo), widget ipywidgets, output JavaScript.
- Cerca (Ctrl+F) dentro la vista.

# 63 — `feat/editor-barrette`: barrette delle righe cambiate nell'editor

Dipende da: 60 (sessione editor). Taglia: ~1 giorno.
Passi di implementazione, test e codice: `63-editor-barrette-tasks.md`.
Seguono: 64 (aprire un file dal pannello modifiche) che usa gli intervalli
calcolati qui, 65 (commenti nell'editor).

## Perché

Nella scheda editor non si vede cosa è cambiato rispetto all'ultimo commit:
per saperlo si apre il pannello modifiche, che però mostra il diff a parte.
Le barrette nel margine, come in VS Code, dicono mentre si scrive quali
righe sono nuove o diverse.

## Cosa fa (perimetro)

Scelte dall'utente:

- **Rispetto a cosa**: il testo **nell'editor** (anche non salvato)
  confrontato con la versione di **HEAD**. Le modifiche già in stage
  contano come modifiche (come la modalità «commit» del pannello).
- **Quando**: dal vivo, mentre si scrive.
- **Come**: barra verde a sinistra delle righe aggiunte, blu per le righe
  modificate, triangolino rosso fra due righe dove ne sono state tolte.

Casi:

- File non tracciato, o aggiunto all'indice ma mai committato: tutte le
  righe aggiunte.
- Cartella fuori da un repository git, repository senza commit, file
  binario o troppo grande per git: nessuna barretta, nessun errore.
- File identico a HEAD: nessuna barretta.

## Fuori

- Cliccare una barretta per vedere il diff in linea o annullare il blocco.
- Barrette nella minimappa o nella barra di scorrimento.
- Confronto con l'indice invece che con HEAD.

## Come

### Main: il testo di HEAD

- **`lib/editor-git.js`** (nuovo): `createEditorGit({ root, run })` con
  `headText(rel)` → `{ ok: true, text }` col contenuto del file a HEAD,
  `{ ok: true, text: null }` se il file a HEAD non c'è (nuovo, non
  tracciato, repository senza commit), `{ ok: false, reason }` se la
  cartella non è un repository, il file è binario o supera `MAX_READ`
  (lo stesso limite di `lib/editor-fs.js`).
  - `rel` passa da `safeRel` (`lib/editor-paths.js`) come le altre
    operazioni dell'editor: niente percorsi fuori dalla radice.
  - `git -C root show HEAD:./<rel>` con `run` (`lib/git-run.js`, `execFile`
    senza shell, `buffer: true`): `./` rende il percorso relativo alla
    cartella della scheda anche se il repository parte più in alto. Su
    Windows i separatori diventano `/`.
  - Riconosce «non è un repository» e «il percorso non esiste in HEAD»
    dallo stderr di git (`LC_ALL=C`).
- **`app/editor.js`**: handler `editor-head-text` col `guard` degli altri.
  **`preload.js`**: `editorHeadText(root, rel)`.

### Renderer: il confronto

- **`renderer/editor-gutter.js`** (nuovo, UMD, caricato prima di
  `editor-tab.js`):
  - `diffLines(oldLines, newLines)` → lista di operazioni, Myers O(ND) con
    un tetto di passi: oltre il tetto restituisce `null` (niente barrette
    invece di bloccare la pagina);
  - `changeRanges(oldText, newText)` → `[{ kind: 'add'|'mod', from, to }`
    (righe dell'editor, da 1, estremi compresi) `| { kind: 'del', after }]`
    (`after` = riga dopo cui mancano righe, 0 = in cima). Un blocco di
    righe tolte seguito da righe aggiunte è `mod` per le righe in comune,
    il resto `add` o `del`. `oldText === null` → tutto `add`. Fine riga
    `\r\n` e `\n` sono uguali.
  - oltre `MAX_GUTTER_LINES` righe (in uno dei due testi) → `null`.
- **`renderer/editor-monaco.js`**: l'host ha
  - `setGutter(rel, ranges)`: decorazioni del modello con
    `linesDecorationsClassName` (`editor-gutter-add`, `-mod`, `-del`);
    sostituisce quelle precedenti, `null` le toglie;
  - `onChange(fn)` per sapere quando un modello cambia;
  - `reveal(rel, line)`: cursore alla riga, centrata (serve al 64).
- **`renderer/editor-tab.js`**:
  - per ogni file aperto tiene il testo di HEAD (`gutterBase`), letto
    all'apertura e riletto quando la scheda torna attiva
    (`refreshEditorTab`) e dopo un salvataggio (un agente può aver
    committato intanto);
  - ricalcola le barrette 300 ms dopo l'ultima modifica del file attivo,
    e subito quando cambia `gutterBase` o il file viene ricaricato dal
    disco; gli intervalli correnti restano nello stato del file
    (`changes(rel)` per il 64).
- **CSS** in `renderer/styles.css`: barra di 3px nella colonna delle
  decorazioni di riga, colori presi dalle variabili del tema già usate dal
  pannello modifiche per aggiunte e rimozioni, blu per le modificate.

## Test

- `tests/editor-gutter.test.js`: `changeRanges` con file uguale, righe
  aggiunte in cima, in mezzo e in fondo, righe tolte (in cima, in mezzo, in
  fondo), righe modificate, misto modifica + aggiunta, `oldText` null,
  `\r\n` contro `\n`, tetto di righe e di passi → `null`.
- `tests/editor-git.test.js` (repo di prova in una tmpdir, git vero, saltato
  se git manca): file tracciato, modificato su disco (HEAD resta quello
  vecchio), non tracciato → `null`, cartella della scheda dentro una
  sottocartella del repo, repository senza commit, fuori da un repository,
  file binario, `rel` che esce dalla radice rifiutato.
- `tests/editor-tab.test.js`: aprire un file chiede `editorHeadText` e
  passa gli intervalli all'host; una modifica ricalcola dopo l'attesa; un
  errore di `editorHeadText` non mostra niente e non rompe l'apertura.
- `tests/renderer-load.test.js`: la pagina si carica col modulo nuovo.

## Da verificare a mano

- Aprire un file modificato: barrette verdi, blu e triangolini rossi dove
  dice `git diff`.
- Scrivere: le barrette seguono. Annullare fino al testo di HEAD: spariscono.
- Fare un commit da un terminale e tornare sulla scheda: le barrette spariscono.
- File nuovo non tracciato: tutto verde. Cartella fuori da git: niente.

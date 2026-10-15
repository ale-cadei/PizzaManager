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
- File ignorato da git (`.env`, `dist/…`): nessuna barretta (non è «tutto
  nuovo», git semplicemente non lo segue).
- File dentro un sottomodulo, un repository annidato o un worktree dentro
  il repository: si confronta col HEAD del repository più interno, come fa
  git dal terminale. Una scheda aperta su una cartella che contiene più
  repository mostra le barrette dei file dentro ciascuno.
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
  - Il percorso si risolve con `resolveInside` di `lib/editor-fs.js`
    (confinato nella radice); `git cat-file blob HEAD:./<nome>` parte con
    `cwd` = cartella del file, così git sceglie il repository più interno
    (sottomodulo, repository annidato) anche se la scheda è più in alto o
    fuori da ogni repository. `run` = `lib/git-run.js` (`execFile` senza
    shell, `buffer: true`).
  - Riconosce «non è un repository» e «il percorso non esiste in HEAD»
    dallo stderr di git (`LC_ALL=C`). Se il file non c'è in HEAD si chiede
    `git check-ignore -q -- <nome>`: ignorato → `{ ok: false, reason:
    'ignored' }`, niente barrette.
- **`app/editor.js`**: handler `editor-head-text` col `guard` degli altri.
  **`preload.js`**: `editorHeadText(root, rel)`.

### Renderer: il confronto

- **`renderer/editor-gutter.js`** (nuovo, UMD, caricato prima di
  `editor-tab.js`):
  - `diffLines(oldLines, newLines)` → lista di operazioni, Myers O(ND) con
    un tetto di passi per non bloccare la pagina. Oltre il tetto (un file
    riformattato, riscritto da un agente) non si restituisce `null`, che
    lo farebbe sembrare uguale a HEAD: tolte le righe uguali in cima e in
    fondo, il tratto in mezzo diventa un blocco solo, `mod` per le righe
    in comune e `add` o `del` per quelle in più (decisione dell'utente
    dopo la review finale);
  - `changeRanges(oldText, newText)` → `[{ kind: 'add'|'mod', from, to }`
    (righe dell'editor, da 1, estremi compresi) `| { kind: 'del', after }]`
    (`after` = riga dopo cui mancano righe, 0 = in cima). Un blocco di
    righe tolte seguito da righe aggiunte è `mod` per le righe in comune,
    il resto `add` o `del`. `oldText === null` → tutto `add`. Fine riga
    `\r\n` e `\n` sono uguali.
  - oltre `MAX_GUTTER_LINES` righe (in uno dei due testi) → `null`.
    `editor-tab.js` chiede prima il numero di righe del model
    (`host.lineCount`): un file oltre il tetto non si copia né si spezza
    a ogni pausa nella scrittura.
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
  `\r\n` contro `\n`, tetto di righe → `null`, oltre il tetto di passi un
  blocco solo fra le righe uguali in cima e in fondo (`mod` più `add` o
  `del`).
- `tests/editor-git.test.js` (repo di prova in una tmpdir, git vero, saltato
  se git manca): file tracciato, modificato su disco (HEAD resta quello
  vecchio), non tracciato → `null`, cartella della scheda dentro una
  sottocartella del repo, repository senza commit, fuori da un repository,
  file binario, `rel` che esce dalla radice rifiutato; file in un
  repository annidato e in un sottomodulo (confrontato col loro HEAD, non
  tutto verde), scheda su una cartella non-repository che ne contiene uno,
  file ignorato → `ignored`.
- `tests/editor-tab.test.js`: aprire un file chiede `editorHeadText` e
  passa gli intervalli all'host; una modifica ricalcola dopo l'attesa; un
  errore di `editorHeadText` non mostra niente e non rompe l'apertura.
- `tests/renderer-load.test.js`: la pagina si carica col modulo nuovo.

## Da verificare a mano

- Aprire un file modificato: barrette verdi, blu e triangolini rossi dove
  dice `git diff`.
- Scrivere: le barrette seguono. Annullare fino al testo di HEAD: spariscono.
- Fare un commit da un terminale e tornare sulla scheda: le barrette spariscono.
- Togliere le prime righe e le ultime di un file: il triangolino rosso in
  cima e in fondo si vede intero (il margine di Monaco taglia quel che esce).
- Riformattare tutto un file lungo: barrette su tutto il tratto cambiato,
  non niente.
- File nuovo non tracciato: tutto verde. Cartella fuori da git: niente.
  File ignorato (`.env`): niente. File in un sottomodulo o in un worktree
  dentro `.worktrees/`: le barrette del suo repository.

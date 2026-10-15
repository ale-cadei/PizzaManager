# 64 — `feat/editor-apri-da-modifiche`: aprire un file cambiato nell'editor

Dipende da: 63 (barrette e `reveal`). Taglia: ~0,5-1 giorno.
Passi di implementazione, test e codice: `64-editor-apri-da-modifiche-tasks.md`.

## Perché

Il pannello modifiche mostra il diff ma non lascia toccare il file: per
correggere una riga si apre a mano una scheda editor e si cerca il file
nell'albero. Un bottone sul file porta dritto alla riga cambiata.

## Cosa fa (perimetro)

Scelte dall'utente:

- Ogni file nell'elenco del pannello modifiche ha un bottoncino «Apri
  nell'editor» (title così). Non c'è sui file cancellati, né sui file
  binari.
- **Quale scheda**: se c'è già una scheda editor la cui cartella contiene il
  file, si usa quella (la prima, nell'ordine delle schede); altrimenti se ne
  apre una nuova sulla radice del repository. La scheda diventa attiva.
- **Dove**: il file si apre e il cursore va al primo blocco cambiato, preso
  dalle barrette del 63 (quindi rispetto a HEAD, qualunque sia la modalità
  del pannello). Se non ci sono barrette (file uguale a HEAD, troppo grande)
  il cursore resta in cima.

## Fuori

- Aprire alla riga del diff su cui si è cliccato.
- Bottone sulle singole righe del diff.

## Come

- **Radice del repository nel renderer**: `readChanges` (`lib/git-changes.js`)
  restituisce già `root`; il pannello lo tiene nel suo stato. In modalità
  staging (`lib/git-staging.js`) va aggiunto se manca.
- **`renderer/editor-route.js`** (nuovo, UMD, puro):
  `editorTarget({ repoRoot, path, tabs, platform })` → `{ tabId, rel }` di
  una scheda editor esistente che contiene il file, oppure
  `{ cwd: repoRoot, rel: path }` per crearne una. Confronti di percorso
  con separatori `[\\/]`, `path.win32` nei test (regole Windows del
  CLAUDE.md); una scheda la cui cartella è *dentro* il repo vale solo se il
  file ci sta sotto.
- **`renderer/changes-view.js`**: il bottone nella riga del file; il click
  non apre/chiude il diff (`stopPropagation`).
- **`renderer/changes-panel.js`**: al click chiede `editorTarget`, crea la
  scheda se serve (`createTab('editor', { cwd })`), la attiva, poi
  `openEditorAt(tab, rel)`.
- **`renderer/editor-tab.js`**: `openEditorAt(tab, rel)` = `openEditorFile`
  e poi, quando le barrette del file sono pronte, `reveal` sul primo
  intervallo. Se il file non si può aprire l'errore è quello di sempre
  nella scheda editor.

## Test

- `tests/editor-route.test.js`: scheda sulla radice, scheda su una
  sottocartella che contiene il file, scheda su una sottocartella che non lo
  contiene, nessuna scheda, schede non editor ignorate, percorsi Windows.
- `tests/changes-view.test.js`: il bottone c'è sui file modificati e nuovi,
  non su cancellati e binari; il click non espande il file.
- `tests/editor-tab.test.js`: `openEditorAt` apre il file e chiama
  `reveal` con la prima riga cambiata; senza intervalli niente `reveal`.

## Da verificare a mano

- Dal pannello di una sessione agente: click sul bottone → si apre (o si
  riusa) la scheda editor, il file è aperto, il cursore è sulla prima riga
  cambiata.
- Con una scheda editor già aperta sul repo: nessuna scheda nuova.
- In modalità «turno» e «staging»: il bottone funziona allo stesso modo.

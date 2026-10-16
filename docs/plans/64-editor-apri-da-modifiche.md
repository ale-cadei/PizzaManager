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
- **Quale scheda**: se la scheda attiva è un editor la cui cartella
  contiene il file, si usa quella (il pannello parla di lei, il bottone non
  deve portare altrove). Altrimenti la prima scheda editor, nell'ordine
  delle schede, la cui cartella contiene il file; altrimenti se ne apre una
  nuova sulla radice del repository. La scheda diventa attiva.
- **Il pannello si chiude** dopo il click: sta sopra l'editor e coprirebbe
  la riga. Si chiude appena la scheda è pronta, prima di aspettare il file:
  se intanto lo si riapre resta aperto.
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
  `editorTarget({ repoRoot, file, tabs, activeId, platform })` →
  `{ tabId, rel }` di una scheda editor esistente che contiene il file
  (prima quella attiva, poi l'ordine di `tabs`), oppure
  `{ cwd: repoRoot, rel: file }` per crearne una. Confronti di percorso
  con separatori `[\\/]`, `path.win32` nei test (regole Windows del
  CLAUDE.md); una scheda la cui cartella è *dentro* il repo vale solo se il
  file ci sta sotto.
- **`renderer/changes-view.js`**: il bottone nella riga del file; il click
  non apre/chiude il diff (`stopPropagation`).
- **`renderer/changes-panel.js`**: al click chiede `editorTarget` (con
  `activeId`), crea la scheda se serve (`createTab('editor', { cwd })`), la
  attiva, chiude il pannello (`toggleChangesPanel(false)`), poi
  `openEditorAt(tab, rel)`.
- **`renderer/editor-tab.js`**: `openEditorAt(tab, rel)` = `openEditorFile`
  e poi, quando le barrette del file sono pronte, `reveal` sul primo
  intervallo. Un file già aperto rilegge HEAD (se non c'è già una lettura
  in volo) e il cursore aspetta quella: le barrette di prima possono
  essere di prima di un commit. Se il file non si può aprire l'errore è quello di sempre
  nella scheda editor.

## Test

- `tests/editor-route.test.js`: scheda sulla radice, scheda su una
  sottocartella che contiene il file, scheda su una sottocartella che non lo
  contiene, nessuna scheda, schede non editor ignorate, la scheda attiva
  prima dell'ordine (e l'ordine se l'attiva non contiene il file),
  percorsi Windows.
- `tests/changes-view.test.js`: il bottone c'è sui file modificati e nuovi,
  non su cancellati e binari; il click non espande il file.
- `tests/editor-tab-gutter.test.js`: `openEditorAt` apre il file e chiama
  `reveal` con la prima riga cambiata; senza intervalli niente `reveal`; un
  file già aperto con HEAD cambiato salta alla riga di HEAD nuovo.
- `tests/changes-open-editor.test.js`: scheda riusata o creata, la scheda
  attiva vince, il pannello si chiude.

## Da verificare a mano

- Dal pannello di una sessione agente: click sul bottone → si apre (o si
  riusa) la scheda editor, il file è aperto, il cursore è sulla prima riga
  cambiata.
- Con una scheda editor già aperta sul repo: nessuna scheda nuova.
- Con una scheda editor in primo piano su una sottocartella e un'altra sulla
  radice più in alto: il bottone resta su quella in primo piano.
- Un file già aperto in un editor in secondo piano, dopo un commit
  dell'agente e un'altra modifica: il cursore va sulla modifica nuova.
- Finestra stretta: dopo il click il pannello è chiuso e la riga si vede.
- In modalità «turno» e «staging»: il bottone funziona allo stesso modo.

## Punti aperti

Emersi dalla review finale, non fatti in questo branch:

- **M2 — Salto su un editor nascosto.** Se mentre si aspetta (il primo
  caricamento di Monaco dura circa un secondo) si passa a un'altra sessione,
  `reveal` gira su un editor `display:none`: il fuoco non si ruba, ma lo
  scroll usa misure vecchie. Tornando il cursore è sulla riga, la vista
  forse no. Possibile: fare lo scroll solo se la scheda è ancora attiva.
- **M3 — Percorsi con link simbolici.** La radice viene da
  `git rev-parse --show-toplevel`, che risolve i link: una scheda editor
  aperta passando da un link non combacia mai e se ne apre un'altra sulla
  stessa cartella. Va nel piano che porterà `realpath` ai confronti di
  percorso. (Anche i filesystem di macOS che ignorano le maiuscole si
  confrontano rispettandole: conta solo se macOS diventa un obiettivo.)
- **M4 — Backslash nei nomi su Linux.** `editor-route.js` divide i percorsi
  anche su `\` fuori da Windows: un nome di file con un backslash vero
  diventa due pezzi e il `rel` è sbagliato. Rarissimo; si può dividere su
  `\` solo con `platform === 'win32'`.
- **M5 — Ordine con le schede raggruppate per progetto.** «La prima
  nell'ordine» usa l'ordine piatto (`Order.applyOrder`); con il
  raggruppamento per progetto due schede editor adatte in gruppi diversi
  possono stare in un ordine visivo diverso. Trascurabile.

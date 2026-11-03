# 81 — `feature/anteprima-codice-e-modifiche`: modifiche nella scrollbar e anteprima del codice

Dipende da: 63 (barrette delle righe cambiate). Taglia: ~2h.

## Perché

In un file lungo le barrette del margine (piano 63) si vedono solo sulle righe
a schermo: per trovare dove un agente ha cambiato qualcosa bisogna scorrere
tutto il file. E l'anteprima del codice a destra (la minimappa di VS Code) è
spenta senza modo di accenderla.

## Cosa fa

- **Segni nella barra di scorrimento**: ogni blocco di righe aggiunte,
  modificate o tolte ha un segno nella corsia sinistra della barra di
  scorrimento (verde, blu, rosso, gli stessi colori delle barrette). Click
  sulla barra in quel punto e ci si arriva. Dal vivo come le barrette.
- **Anteprima del codice**: bottone con l'icona della mappa nella testata
  dell'editor, accanto a «Vai al file». Accende e spegne la minimappa in tutte
  le schede editor, quelle aperte e quelle che si apriranno; la scelta si
  ricorda al riavvio (`localStorage`, `aisess.editorMinimap`). Spenta di
  default, come prima. Con la minimappa accesa le modifiche si vedono anche
  nel suo bordo sinistro.

Toglie dal «Fuori» del piano 63 «Barrette nella minimappa o nella barra di
scorrimento».

## Come

- `renderer/editor-monaco.js`: le decorazioni di `setGutter` hanno anche
  `overviewRuler` (corsia `Left`) e `minimap` (posizione `Gutter`). Il colore
  è un `ThemeColor` (`editorOverviewRuler.addedForeground`,
  `minimapGutter.modifiedBackground`…) definito nel tema `aisess` dalle
  variabili `--state-ok` / `--state-changed` / `--state-error`: segue i colori
  scelti dall'utente senza ridisegnare le decorazioni. `createEditorHost`
  prende `minimap`, l'host espone `setMinimap(on)`.
- `renderer/editor-panel.js`: la preferenza `minimap` accanto a larghezza e
  nascosto dell'albero; `toggleMinimap()` la salva, mette
  `body.editor-minimap-on` (lo stato del bottone) e chiama `onMinimap(on)`.
- `renderer/editor-tab.js`: il bottone `editor-minimap-toggle`; `onMinimap`
  passa la scelta agli host di tutte le schede, `ensureEditorHost` la dà ai nuovi.

## Test

- `tests/editor-monaco.test.js`: decorazioni con i segni, colori nel tema,
  minimappa all'avvio e `setMinimap`.
- `tests/editor-panel.test.js`: preferenza letta, salvata, applicata; storage rotto.
- `tests/editor-tab.test.js`: il bottone accende e spegne gli host aperti.

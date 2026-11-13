# 95 — Copia, taglia e incolla nell'albero dell'editor (`feat/editor-copia-taglia`)

Nell'albero della scheda editor Ctrl+V incolla già i file copiati nel file
manager del sistema (piano 61). Mancano Ctrl+C e Ctrl+X sulle voci
dell'albero: copiare o spostare un file o una cartella in un'altra cartella
della sessione.

## Decisioni

- **Gli appunti sono quelli del sistema.** Ctrl+C/Ctrl+X scrivono il
  percorso assoluto dell'elemento come lo scrive il file manager di GNOME
  (`x-special/gnome-copied-files`, `copy`/`cut` + URI `file://`); su Windows
  `FileNameW`. Ctrl+V resta quello del piano 61: legge gli appunti, piano,
  conflitti, copia. Così si incolla anche in un'altra scheda editor o nel
  file manager, e un file copiato fuori dopo vince su quello dell'albero.
- **Taglia = sposta.** Il main ricorda l'ultimo «taglia» (Windows non ha il
  `cut` negli appunti); su GNOME vale l'intestazione degli appunti. Lo
  spostamento è un `rename`; fra dischi diversi (`EXDEV`) copia e poi
  cancella l'originale. Dopo uno spostamento gli appunti si svuotano (se
  contengono ancora quei file): un secondo Ctrl+V non troverebbe niente.
- **Stesso posto.** Incollare nella cartella da cui viene: una copia prende
  «nome (2)» senza chiedere; uno spostamento non fa niente.
- **I file aperti seguono** uno spostamento dentro la stessa scheda, come per
  Rinomina (stato, model di Monaco, note, watch). Spostati da un'altra
  scheda: lì li segna come cancellati il watch, come oggi.
- Un elemento alla volta: l'albero ha una sola selezione.

## Pezzi

- `lib/clipboard-files.js`: `clipboardPayload(paths, mode, platform)` →
  `{format, buffer}`; `clipboardSelection(read, platform)` → `{paths, cut}`
  (`cut` null se il formato non lo dice).
- `lib/editor-copy.js`: `planCopy`/`runCopy` con `{move}`; il piano segna i
  conflitti con se stesso (`same`); `runCopy` restituisce `moved:
  [{fromRel, toRel}]` relativi alla radice della scheda.
- `app/editor.js`: `editor-clipboard-put` (root, rel, mode), cut in
  `editor-clipboard-files`, `move` in plan/run, appunti svuotati dopo lo
  spostamento.
- Renderer: Ctrl+C/Ctrl+X nell'albero (`editor-tree.js`), voci «Copia» e
  «Taglia» nel menu, `copyIntoEditor` con `move`; i file aperti seguono
  (helper estratto da `renameEditorEntry`, commit di refactor a parte).

## Test

- `tests/clipboard-files.test.js`: payload per piattaforma, andata e
  ritorno, `cut` dall'intestazione GNOME.
- `tests/editor-copy.test.js`: spostamento, conflitti, stesso posto,
  cartella dentro se stessa, `moved`.
- `tests/editor-ipc.test.js`: put → files con `cut`, appunti svuotati.
- `tests/editor-tree.test.js`: Ctrl+C/Ctrl+X chiamano `onClipboard`.
- `tests/editor-tab.test.js`: un file aperto segue lo spostamento.
- Smoke: copia e taglia fra cartelle, incolla in Nautilus, Ctrl+V dopo una
  copia fatta in Nautilus.

## Dopo

- Con `feat/editor-remoto` (piano 94): sulle schede su un server il
  copia/incolla da questo computer è spento; copia e sposta **dentro** il
  server vanno fatti con due operazioni nuove dell'helper.

## Stato

Fatto, test verdi (`tests/editor-cut-paste.test.js` in più di quelli
elencati). Smoke nell'app da fare: in particolare se Nautilus incolla
quello che scrive l'app (Electron `writeBuffer` col formato GNOME). Su
Windows Esplora risorse non lo legge: `FileNameW` da solo non gli basta
(vuole `CF_HDROP`), vale solo dentro l'app.

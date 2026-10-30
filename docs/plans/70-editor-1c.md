# 70 — `feat/redesign-file-editor`: la scheda editor ridisegnata («1c»)

Dipende da: 60-65 (sessione editor, pannello, barrette, commenti), 69
(conflitti nell'editor). Taglia: ~3-4 giorni, in quattro passi.

Riferimento: il handoff di Claude Design in [`70-editor-1c/`](70-editor-1c/):
`handoff.md` (schermate, misure, comportamenti), `SPEC.md` (DOM, CSS coi
token, ordine di lavoro), `design/*.dc.html` (prototipi da aprire nel browser
con `support.js` accanto). Gli screenshot 2x sono rimasti fuori dal repo
(4 MB): i prototipi mostrano gli stessi stati.

## Perché

La scheda editor è cresciuta a strati (60-69) e si vede: sotto-schede dei
file che si accavallano, bottoni «+ File / + Cartella / ⟳» in testo, nessuna
icona nell'albero, il conflitto col disco come una riga grigia che sposta il
codice. Il redesign rimette ordine senza cambiare cosa fa la scheda.

## Cosa cambia

- **Niente sotto-schede**: i file aperti stanno nella sezione «Aperti» in cima
  al pannello; il file attivo diventa il titolo dell'area, con cartella e
  simbolo sotto.
- **Icone vere** (`@vscode/codicons`, caricate da `node_modules`: la CSP vieta
  i CDN), lettere git M/U/A/D nell'albero, intestazioni di sezione con azioni a
  icona.
- **Barra di stato**, conflitto col disco come **scheda flottante**, **stato
  vuoto** con i file recenti.
- Nuovi: **Vai al file (Ctrl+P)**, **menu «N aperti»** con l'albero nascosto,
  **filtro dell'albero**.

Restano com'erano: logica di apertura, salvataggio, conflitti col disco,
commenti, barrette, Ctrl+B, larghezza ricordata (solo il default passa da 240
a 256).

## Passi

Un commit (o più) per passo; refactor e cambi di comportamento separati.

1. **Icone, intestazione del pannello, righe dell'albero.** `editor-icons.js`
   (UMD, `iconFor(name, kind, open)`), codicon in `index.html`, testata «FILE»
   con filtro/nuovo file/nuova cartella/rileggi al posto di
   `.editor-side-tools`, righe alte 26 con chevron e icona, menu contestuale
   con icone, scorciatoie e separatori, voce «Copia percorso».
2. **«Aperti» al posto delle sotto-schede, titolo col percorso.**
   `renderEditorSubtabs` → `renderEditorOpen`; le conferme si ancorano a
   `ui.title`. Salva tutto / Chiudi tutti nella testata.
3. **Barra di stato, conflitto flottante, stato vuoto.** `Ln/Col`, spazi,
   codifica, fine riga, linguaggio, branch; `.editor-bar` diventa una scheda
   assoluta con titolo; lo stato vuoto apre Ctrl+P e mostra i recenti.
4. **Lettere git, filtro, Ctrl+P, simbolo nel percorso.** IPC
   `editorListAll(cwd)` in `lib/editor-fs.js` (salta gli ignorati, tetto
   ~20k voci, cache per scheda invalidata da `reloadEditorTree`);
   `renderer/editor-quick.js`; lettere da `lib/git-changes.js`; simbolo dal
   `DocumentSymbolProvider` di Monaco in debounce.

## Note

- Monaco porta il suo font `codicon` (data URI) e lo dichiara quando si apre
  il primo file: due `@font-face` con lo stesso nome. I punti di codice delle
  icone usate sono stabili fra le versioni, quindi chi vince è indifferente.
- `@vscode/codicons`: icone CC-BY-4.0, codice MIT. Va in
  `THIRD-PARTY-NOTICES.md`.
- Il fondo di Monaco oggi viene da `--bg` di `:root`; va letto da `#main`, così
  segue il colore scelto in View → Colori (passo 3). Fatto con `termTheme()`,
  lo stesso fondo dei terminali, e ridefinito quando si cambiano i colori.
- **Alt+1…9 sul Mac è ⌃1…9**: Opzione+cifra scrive caratteri (`~` è
  Opzione+5 sulla tastiera italiana), e catturarla romperebbe la scrittura in
  Monaco. Fuori dal Mac Ctrl+Alt è AltGr e non conta.
- «Copia percorso» copia il percorso relativo alla cartella della sessione:
  è quello che serve in un prompt.
- Chi aveva già salvato la larghezza dell'albero (anche solo aprendo e
  chiudendo il pannello) resta a 240: il 256 vale per chi non l'ha mai toccata.
- «Aperti di recente» sono per scheda (ultimi 5 file chiusi a mano) e si
  salvano con la scheda in `editor-sessions.json`: una scheda nuova sulla
  stessa cartella parte senza.
- Lo stato vuoto non ha ancora il campo «Vai al file»: arriva col passo 4,
  insieme a Ctrl+P. Il sottotitolo per ora rimanda all'albero.
- Tema «Forno»: le funzioni in `#F6F1EC` del mock non si possono colorare a
  parte, perché il tokenizer di Monaco le dà come `identifier`. Restano del
  colore degli identificatori.
- Ctrl+Alt+N (nuovo file nella cartella selezionata) è nuovo: lo stato vuoto
  lo mostra fra le scorciatoie.
- Rimandato: la × per chiudere un file dal menu «N aperti» (oggi lo chiude
  «Chiudi tutti», o riaprendo l'albero).

## Stato

- [x] 1 · icone, pannello, albero
- [x] 2 · Aperti e titolo (smoke nell'app da fare)
- [x] 3 · barra di stato, conflitto, stato vuoto, chip dei commenti, tema (smoke da fare)
- [ ] 4 · git, filtro, Ctrl+P, simbolo

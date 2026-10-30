# Handoff: scheda Editor «1c» (PizzaManager)

## Overview
Ridisegno della scheda di tipo **editor** di PizzaManager (`renderer/editor-tab.js` e collegati). Obiettivi:
- togliere le sotto-schede dei file: i file aperti vanno in una sezione «Aperti» in cima al pannello;
- il file attivo diventa il titolo dell'area, con cartella e simbolo sotto;
- icone vere nell'albero (codicon), lettere git M/U/A/D, intestazione del pannello con azioni a icona al posto di «+ File / + Cartella / ⟳»;
- barra di stato, conflitto col disco come scheda flottante, stato vuoto utile;
- nuovi: **Vai al file (Ctrl+P)**, **menu «N aperti»** quando l'albero è nascosto (Ctrl+B), **filtro dell'albero**.

## About the Design Files
I file in `design/` sono **riferimenti di design fatti in HTML**: prototipi che mostrano aspetto e comportamento voluti, **non codice da copiare**. Il compito è ricrearli nel renderer esistente (JS vanilla, DOM costruito a mano, CSS in `renderer/styles.css` con i token di `renderer/tokens.css`), seguendo i pattern già in uso: moduli UMD, `textContent` per i nomi che arrivano dal disco, niente `innerHTML` con dati utente, CSP invariata.

Per aprirli: tenere `support.js` accanto ai `.dc.html` e aprirli nel browser. Sono canvas con pan e zoom.

## Fidelity
**Alta fedeltà.** Colori, tipografia, misure e stati sono quelli finali. Ogni hex corrisponde a un token di `tokens.css` (tabella sotto): nel codice vanno usati i token, non gli hex.

## Files
- `design/File Editor 1c.dc.html`: **il riferimento**. Contiene 2a (scheda intera con stati attivabili: file aperto/vuoto, conflitto, commento, menu contestuale), 2b (Ctrl+P), 2c (albero nascosto con menu «4 aperti»), 2d (filtro in uso).
- `design/File Editor - confronto.dc.html`: contesto. Contiene 1a (com'è oggi, ricostruita dal codice), 1b (alternativa scartata) e 1c (prima versione di questa direzione).
- `SPEC.md`: **struttura DOM, CSS completo con i token, comportamenti, ordine di lavoro.** Leggerlo per intero prima di iniziare.
- `screenshots/` (2x): `2a-file-aperto.png`, `2a-conflitto.png`, `2a-menu-contestuale.png`, `2a-vuoto.png`, `2b-vai-al-file.png`, `2c-albero-nascosto.png`, `2d-filtro.png`.

File del repo da toccare: `renderer/editor-tab.js`, `renderer/editor-tree.js`, `renderer/editor-panel.js` (DEFAULT_W 240 → 256), `renderer/editor-monaco.js` (tema, simbolo, cursore), `renderer/editor-notes-ui.js` (chip commenti), `renderer/styles.css` (blocco «Sessione editor», righe ~1178–1291), `renderer/index.html` (link codicon e nuovi script), `lib/editor-fs.js` (+ `editorListAll`), `preload.js` (esporre la nuova IPC), `package.json` (+ `@vscode/codicons`).

## Screens / Views

### 2a · Scheda editor (area a destra della sidebar app)
Layout: flex orizzontale. Pannello `aside.editor-side` largo 256px (ridimensionabile come oggi, minimo 160), resizer da 6px, poi `section.editor-main` in colonna.

**Pannello (fondo `--surface`, bordo destro 1px `--border`)**
- **Sezione Aperti**: testata alta 34px, padding `0 8px 0 14px`, etichetta «APERTI» in IBM Plex Mono 10px/500, letter-spacing .14em, maiuscolo, `--text-dim`. Il contatore «4» è in `--accent`. A destra due bottoni icona 24×24 con raggio 5: `codicon-save-all` «Salva tutto (Ctrl+Shift+S)» e `codicon-close-all` «Chiudi tutti».
  - Righe alte 26px, margine orizzontale 6px, padding `0 6px 0 10px`, raggio 5, gap 8. Contenuto: icona file 15px colorata · nome in Plex Sans 13px `--text-2` · cartella in Mono 11px `--text-faint` (si tronca) · slot di stato 18×18.
  - Riga attiva: fondo `--surface-lift`, testo `--text`, `box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--type-editor) 38%, transparent)`. Hover: `--surface-2`.
  - Slot di stato: con modifiche non salvate un pallino da 7px `--type-editor`; in hover diventa una × (`codicon-close` 14px). Con un conflitto col disco: `codicon-warning` 13px `--accent`. File eliminato: nome barrato.
  - Sotto la sezione: padding-bottom 8px e bordo 1px `--divider`.
- **Sezione File**: testata come sopra, «FILE». Azioni: `codicon-filter`, `codicon-new-file`, `codicon-new-folder`, `codicon-refresh`. Gli hover sono `--surface-3` / `--text`.
- **Righe dell'albero**: alte 26px, margine 0 6px, raggio 5, rientro `8 + profondità×14` px, gap 6. Contenuto: chevron (`codicon-chevron-right` / `-down`, 14px, `--text-faint`; vuoto per i file) · icona 15px · nome 13px `--text-2` · lettera git Mono 11/500.
  - Lettere git: M `--state-changed`, U/A `--state-ok`, D `--state-error`. Le cartelle che contengono modifiche hanno un «•» `--state-changed`.
  - Ignorati: opacità .5. Selezione: come la riga attiva degli Aperti. Drop di file da fuori: come oggi (contorno tratteggiato `--type-editor`).

**Intestazione `header.editor-head`**: alta 52px, padding `0 10px 0 8px`, gap 10, fondo `--surface`, bordo inferiore `--border`.
- Toggle 30×30, raggio 6: `codicon-layout-sidebar-left` su `--surface-2` con il pannello aperto; `-off` su fondo trasparente in `--text-dim` con il pannello chiuso. Titolo: «Mostra/nascondi file (Ctrl+B)».
- Titolo su due righe:
  - riga 1: icona del file 18px · nome Plex Sans 14/600 `--text` · pallino 7px `--type-editor` se non salvato · lettera git Mono 11/500;
  - riga 2 (gap 2): Mono 11px `--text-dim` «renderer › ƒ buildEditorLayout». Il separatore è `codicon-chevron-right` 11px; il simbolo ha `codicon-symbol-method` 12px `--type-editor` e il nome in `--text-muted`.
- A destra, solo se ci sono commenti: un chip alto 28px, raggio 6, fondo `--action-soft`, testo `--action-text` 12/500, con `codicon-comment` · «1 commento» · separatore 1px · `codicon-copy` «Copia prompt» in `--text`. «Svuota» passa in un menu o sotto un tooltip.
- In fondo a destra: bottone «Vai al file…» largo 220px, alto 30px, fondo `--bg`, bordo `--border-strong`, raggio 6. Contiene `codicon-search` 14px · placeholder 12.5px `--text-faint` · kbd «Ctrl P». Il kbd è Mono 11px, padding 1×6, raggio 4, fondo `--surface-2`, bordo `--border-strong`, testo `--text-muted`.

**Codice (Monaco)**
- Fondo `#070505`, cioè `--bg` di `:root`: è quello che legge `defineTheme`. Meglio leggerlo da `#main`.
- Font IBM Plex Mono 13px, riga 20px, padding-top 10px.
- Margine sinistro: glyph margin 22px (il «+» per commentare è in `--action-text` 14/600), numeri di riga larghi 36 (`#5E4E47`, la riga attiva `--text-2`), corsia decorazioni 18 con barrette a left 6px larghe 3, raggio 2 (modificate `--state-changed`, aggiunte `--state-ok`).
- Riga corrente: `#140B09`. Righe commentate: `rgba(255,155,111,.10)`.
- Commento inline (zona Monaco): padding `6px 24px 8px 76px`, scheda larga al massimo 620, fondo `--surface-2`, bordo 1px `--border`, raggio 8, padding `10px 12px 11px`, ombra `0 8px 20px rgba(0,0,0,.45)`.
  - Testata: `codicon-comment` · «righe 57–58» in Mono 11/500 `--action-text` · a destra `codicon-edit` e `codicon-trash` in `--text-faint`.
  - Corpo: 13px/1.5 `--text`.
  - Niente bordo sinistro colorato: sostituisce `.changes-comment` solo dentro l'editor.
- Tema sintattico «Forno» (opzionale; la prop `syntax` del design permette il confronto con vs-dark): parole chiave `#FF9B6F`, stringhe `#E3C27A`, commenti `#8A7A72` in corsivo, numeri e classi `#C9A8F5`, funzioni `#F6F1EC`, identificatori `#D9CDC6`, punteggiatura `#9A8A82`. Va in `defineTheme` → `rules`.

**Barra di stato `footer.editor-status`**: alta 24px, fondo `--bg`, bordo superiore `--divider`, Mono 11px `--text-dim`, gap 16, padding 0 12.
- Sinistra: «● Non salvato» in `--type-editor` (solo se dirty) · `codicon-git-branch` + nome del branch.
- Destra: «Ln 57, Col 23» · «Spazi: 2» · «UTF-8 · LF» · «JavaScript» (in `--text-2`).
- Nascosta senza file aperti.

**Conflitto col disco**: `.editor-bar` diventa una scheda assoluta in alto a destra dell'host (top 14, right 18), larga 340, fondo `--surface-2`, bordo `--border-strong`, raggio 10, padding `14px 14px 12px`, gap 10, `--shadow-modal`.
- Titolo: `codicon-warning` `--accent` + «Cambiato sul disco» 13/600.
- Testo 12.5/1.5 `--text-muted`: «editor-tab.js è cambiato sul disco mentre lo modificavi. Le tue modifiche non sono ancora salvate.»
- Bottoni alti 28, a destra: «Tieni il mio» (ghost senza bordo) e «Ricarica dal disco» (secondario: `--surface-3`, bordo `--border-strong`, `--text-2`).
- Stessa forma per `conflict: 'save'` («Sovrascrivi» / «Ricarica»), per `deleted` e per `error` (titolo in `--state-error`).

**Stato vuoto** (nessun file aperto): colonna larga 480, centrata, a 150px dall'alto.
- «Apri un file» 19/600 · «Scrivi parte del nome, oppure riprendi da dove avevi lasciato.» 13px `--text-muted`.
- Campo alto 42 con raggio 8, bordo `--action`, anello `0 0 0 3px var(--action-ring)`; apre Ctrl+P.
- Scheda «APERTI DI RECENTE»: fondo `--surface`, bordo `--border`, raggio 8, righe alte 32 con icona, nome, cartella e quando.
- Scorciatoie: «Nuovo file Ctrl Alt N», «Mostra/nascondi file Ctrl B».

**Menu contestuale**: largo 232, padding 4, fondo `#151010` (`--surface-2` di `:root`, perché il menu sta su `body`), bordo `--border-strong`, raggio 8, `--shadow-modal`.
- Voci alte 28, raggio 5, 12.5px, icona 15px `--text-dim`, scorciatoia Mono 11 a destra. Hover `--action-soft`.
- Separatori 1px `--border`, margine 4×6.
- Voci: Nuovo file (Ctrl Alt N), Nuova cartella | Copia qui file…, Incolla (Ctrl V) | Rinomina (F2), Copia percorso | Elimina (Canc, `--state-error`).

### 2b · Vai al file (Ctrl+P)
Riquadro centrato nell'area dell'editor, a 64px dall'alto, largo 580, fondo `#151010`, bordo `--border-strong`, raggio 10, `--shadow-modal`. Il codice sotto resta visibile (nel mock è attenuato a opacità .55).
- Campo alto 46: `codicon-search` 16 · testo Mono 14 `--text` · cursore 1.5px `--action-text` · conteggio «6 file» Mono 11 `--text-dim`. Bordo inferiore `--border`.
- Gruppi «APERTI» e «NEL PROGETTO» con etichetta Mono 10 maiuscola.
- Righe alte 32, raggio 6: icona · nome con la corrispondenza in `--action-text` 600 · cartella Mono 11 `--text-faint` · eventuale «APERTO» (Mono 10, bordo `--border-strong`) · lettera git. Riga selezionata `--action-soft`.
- Piede: «↑↓ scegli · Invio apri · Esc chiudi».

### 2c · Albero nascosto e menu «N aperti»
Con `body.editor-tree-hidden`, accanto al titolo compare il bottone «4 aperti ▾»: alto 28, raggio 6, bordo `--border-strong`, 12/500. Da aperto: bordo `--action`, fondo `--action-soft`, chevron in su `--action-text`.
- Il menu ha l'angolo in alto a sinistra sotto il titolo; è largo 340, con lo stile del menu contestuale.
- Righe alte 30: icona · nome · cartella · «Alt N» · pallino oppure ×. Attiva `--action-soft`, hover `--surface-3`.
- Poi un separatore, «Salva tutto (Ctrl Shift S)» e «Chiudi tutti».

### 2d · Filtro dell'albero in uso
Sotto la sezione Aperti, al posto della testata «FILE», compare un campo alto 30, raggio 6, bordo `--action`, anello `--action-ring`.
- Contenuto: `codicon-filter` `--action-text` · testo Mono 12.5 · conteggio · × per svuotare.
- Righe dei risultati alte 38, su due livelli: icona + nome con la corrispondenza evidenziata + lettera git; sotto, la cartella in Mono 10.5 `--text-faint`, rientrata di 22px.
- In fondo: «Cerca nei nomi delle cartelle già lette. Per tutto il progetto usa Ctrl+P.» 11.5px `--text-faint`.

## Interactions & Behavior
- **Aperti**: click attiva (`activateEditorFile`); click centrale o × chiude (`closeEditorFile`, con le stesse conferme di oggi). Alt+1…9 attivano. Le conferme si ancorano a `.editor-title`, non più a `ui.subtabs`.
- **Ctrl+B**: invariato (`editor-panel.js`). Cambia solo l'icona del toggle e compare «N aperti».
- **Ctrl+P**: catturato come Ctrl+B in `initEditorTabs`, solo con una scheda editor davanti. Ordine dei risultati: prima gli aperti, poi la sottostringa nel nome, poi il fuzzy; il percorso pesa meno del nome. Invio → `openEditorFile`. Esc chiude.
- **Filtro**: lavora su `tree.children` già letti. Esc o × lo chiudono e l'albero torna com'era (aperture e selezione invariate).
- **Git**: lettere da `lib/git-changes.js`, aggiornate su `refreshEditorTab` e dopo ogni salvataggio.
- **Simbolo nel percorso**: dall'outline di Monaco alla posizione del cursore, in debounce di circa 150ms. Senza simbolo si mostra solo la cartella.
- **Barra di stato**: `onDidChangeCursorPosition`, `model.getOptions()`, `getEOL()`, `getLanguageId()`, `f.bom`.
- **Hover**: righe → `--surface-2`; bottoni icona → `--surface-3` / `--text`; «Vai al file» → bordo `--action`.
- **Movimento**: nessuna animazione nuova, oltre all'apertura di menu e Ctrl+P in 120ms ease-out (opacità + translateY 4px) e niente con `prefers-reduced-motion`.

## State Management
In più rispetto a `tab.editor`:
- `quick: { open, query, results, index }` per Ctrl+P;
- `filter: { active, query }` per l'albero;
- `git: Map<rel, 'M'|'U'|'A'|'D'>`;
- `cursor: { line, col, symbol }`;
- `allFiles` (cache di `editorListAll`, invalidata da `reloadEditorTree`);
- `recent` (da `lib/editor-sessions.js`).

## Design Tokens (dal blocco `#main` di tokens.css, con il colore principale predefinito #F04E23)

| Token | Hex risolto |
| --- | --- |
| `--bg` | `#050200` (Monaco usa quello di `:root`, `#070505`) |
| `--surface` | `#070201` |
| `--surface-2` | `#170A06` |
| `--surface-3` | `#261713` |
| `--surface-lift` | `#2F1F1B` |
| `--divider` | `#140805` |
| `--border` | `#32211C` |
| `--border-strong` | `#45322D` |

Colori che non cambiano col contesto:
- **Azione**: `--action #F04E23`, `--action-text #FF9B6F`, `--action-soft #2B120A`, `--action-ring rgba(240,78,35,.22)`.
- **Accento e tipo**: `--accent #F2C14E`, `--type-editor #B48EF0`.
- **Stati**: `--state-changed #5AA2FF`, `--state-ok #7FC45A`, `--state-error #FF4D74`.
- **Testo**: `#F6F1EC`, `#D9CDC6`, `#B8A79E`, `#9A8A82`, `#8A7A72`.

Il resto:
- **Tipografia**: IBM Plex Sans (interfaccia 12–15px, titoli 14/600) e IBM Plex Mono (etichette 10px .14em maiuscolo, metadati 11px, codice 13/20).
- **Raggi**: 4 (kbd), 5 (righe e bottoni icona), 6 (controlli), 8 (menu e schede), 10 (Ctrl+P, conflitto).
- **Gap**: 2 / 6 / 8 / 10 / 16. Ombre: `--shadow-modal`, più `0 8px 20px rgba(0,0,0,.45)` per i commenti.

Tinte delle icone dei file (nuove, stessa luminosità e saturazione): js `oklch(0.82 0.11 90)`, css `oklch(0.78 0.11 245)`, html `oklch(0.76 0.12 40)`, md `oklch(0.78 0.10 300)`, json `oklch(0.80 0.11 145)`, cartelle `color-mix(in srgb, var(--type-editor) 75%, var(--text-dim))`, altro `--text-dim`.

## Assets
- **Icone**: `@vscode/codicons` (MIT), da caricare in locale da `node_modules` (la CSP blocca i CDN; nei mock è caricato da jsDelivr solo per comodità). La mappa estensione → icona è in SPEC.md §0.
- **Logo e icone dei tipi di sessione**: già nel repo (`pizza-logo.js`, `agent-icons.js`). Nei mock sono copiati solo per la sidebar dell'app, che **non cambia**.

## Ordine di lavoro consigliato
1. Codicon, intestazione del pannello e righe dell'albero (CSS + `editor-tree.js`).
2. «Aperti» al posto delle sotto-schede, e titolo con il percorso (`editor-tab.js`).
3. Barra di stato, conflitto flottante, stato vuoto.
4. Lettere git, filtro, Ctrl+P (+ IPC `editorListAll`), simbolo nel percorso.

Aggiornare i test che toccano `editor-subtab` o `editor-side-tools` (`tests/`) e aggiungere un piano in `docs/plans/` come da abitudine del repo.

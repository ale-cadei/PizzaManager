# Editor 1c: specifiche per il repo

Riferimento visivo: `File Editor 1c.dc.html` (2a–2d). Tutti i colori sono token di `renderer/tokens.css`, presi dal blocco `#main` (l'editor sta dentro `#main`).

## 0. Icone

- Aggiungere `@vscode/codicons` (MIT) a `package.json` e in `index.html`:
  `<link rel="stylesheet" href="../node_modules/@vscode/codicons/dist/codicon.css" />`
  La CSP va già bene (`style-src 'self'`, `font-src 'self'`). Monaco ha già le codicon nel suo CSS, ma si carica solo quando si apre il primo file, e l'albero le usa prima.
- Nuovo modulo `renderer/editor-icons.js` (UMD come `editor-tree.js`): `iconFor(name, kind, open)` → `{ cls, tint }`.

| Caso | Classe | Tinta |
| --- | --- | --- |
| cartella chiusa / aperta | `codicon-folder` / `codicon-folder-opened` | `color-mix(in srgb, var(--type-editor) 75%, var(--text-dim))` |
| `.js .mjs .cjs .ts` | `codicon-file-code` | `oklch(0.82 0.11 90)` |
| `.css` | `codicon-symbol-color` | `oklch(0.78 0.11 245)` |
| `.html` | `codicon-code` | `oklch(0.76 0.12 40)` |
| `.md` | `codicon-markdown` | `oklch(0.78 0.10 300)` |
| `.json` | `codicon-json` | `oklch(0.80 0.11 145)` |
| `.gitignore` | `codicon-git-commit` | `var(--text-dim)` |
| altro | `codicon-file` | `var(--text-dim)` |

Le tinte hanno la stessa luminosità e la stessa saturazione e cambiano solo nella tonalità; non sono token di stato.

## 1. Struttura (`buildEditorLayout` in `editor-tab.js`)

```
.editor-wrap
├─ aside.editor-side
│  ├─ section.editor-open          ← NUOVO, sostituisce le sotto-schede
│  │  ├─ .editor-section-head  «APERTI  4»  [salva tutto] [chiudi tutti]
│  │  └─ .editor-open-list  (role=tablist, una .editor-open-row per file)
│  ├─ .editor-section-head  «FILE»  [filtro] [nuovo file] [nuova cartella] [rileggi]
│  │   (sostituisce .editor-side-tools con «+ File / + Cartella / ⟳»)
│  ├─ .editor-filter  (hidden finché non si attiva il filtro)
│  └─ .editor-tree-host
├─ .editor-resizer   (invariato)
└─ section.editor-main
   ├─ header.editor-head
   │  ├─ button.editor-tree-toggle  (codicon layout-sidebar-left / -off)
   │  ├─ .editor-title  icona · nome · pallino · lettera git
   │  │                 └─ .editor-crumb  cartella › simbolo
   │  ├─ button.editor-open-menu «N aperti ▾»  (solo con l'albero nascosto)
   │  ├─ .editor-notes-bar  (stesso nodo di oggi, ridisegnato come chip)
   │  └─ button.editor-quick  «Vai al file…  Ctrl P»
   ├─ .editor-message   (invariato)
   ├─ .editor-host      (Monaco)
   │  ├─ .editor-empty  (stato vuoto, quando files.order è vuoto)
   │  └─ .editor-bar    (ORA è una scheda flottante in alto a destra)
   └─ footer.editor-status
```

- `renderEditorSubtabs` diventa `renderEditorOpen`: stessi dati (`files.order`, `active`, `dirty`, `deleted`) e stessi handler (click attiva, click centrale e × chiudono). Disegna le righe di `.editor-open-list`, aggiorna `.editor-title` e, se il pannello è nascosto, il contatore di `.editor-open-menu`. Chiama ancora `renderEditorBar`.
- I dialoghi di conferma che oggi usano `tab.editor.ui.subtabs` come ancora (`confirmEditorClose`, `askEditorExit`) ora usano `ui.title`.
- `.editor-bar` resta lo stesso nodo, con la stessa logica: `is-warn` / `is-error`, «Ricarica» / «Tieni il mio» / «Sovrascrivi». Cambiano solo il CSS e un titolo in più (`.editor-bar-title`): «Cambiato sul disco», «Salvataggio non riuscito», «Eliminato dal disco».

## 2. CSS (sostituisce il blocco «Sessione editor» di `styles.css`, righe 1178–1236)

```css
.editor-side { width: var(--editor-tree-w, 256px); }               /* DEFAULT_W in editor-panel.js → 256 */
.editor-section-head {
  height: 34px; display: flex; align-items: center; gap: 2px; padding: 0 6px 0 14px;
  font: 500 10px var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--text-dim);
}
.editor-section-head .count { color: var(--accent); margin-left: 6px; letter-spacing: 0; }
.editor-section-head .spacer { flex: 1; }
.editor-icon-btn {
  width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 5px;
  background: transparent; color: var(--text-dim); cursor: pointer; font-size: 15px;
}
.editor-icon-btn:hover { background: var(--surface-3); color: var(--text); }
.editor-icon-btn[aria-pressed="true"] { color: var(--action-text); background: var(--action-soft); }

.editor-open { padding-bottom: 8px; border-bottom: 1px solid var(--divider); }
.editor-open-row, .editor-tree-row {
  display: flex; align-items: center; gap: 6px; height: 26px; margin: 0 6px; padding-right: 10px;
  border-radius: 5px; font: 13px var(--font-ui); color: var(--text-2); cursor: pointer; white-space: nowrap;
}
.editor-open-row { gap: 8px; padding: 0 6px 0 10px; }
.editor-open-row:hover, .editor-tree-row:hover { background: var(--surface-2); }
.editor-open-row.is-active, .editor-tree-row.is-selected {
  background: var(--surface-lift); color: var(--text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--type-editor) 38%, transparent);
}
.editor-open-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 11px var(--font-mono); color: var(--text-faint); }
.editor-open-state { width: 18px; height: 18px; display: grid; place-items: center; }
.editor-open-row.is-dirty .editor-open-state::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--type-editor); }
.editor-open-row .editor-open-close { display: none; }
.editor-open-row:hover .editor-open-state::before { display: none; }
.editor-open-row:hover .editor-open-close { display: grid; }            /* × al posto del pallino */
.editor-open-row.is-deleted .editor-open-name { text-decoration: line-through; }

.editor-tree-twisty { width: 14px; flex: none; color: var(--text-faint); font-size: 14px; }
.editor-tree-icon { flex: none; font-size: 15px; }
.editor-tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.editor-tree-git { font: 500 11px var(--font-mono); }
.editor-tree-git.is-M { color: var(--state-changed); }
.editor-tree-git.is-U, .editor-tree-git.is-A { color: var(--state-ok); }
.editor-tree-git.is-D { color: var(--state-error); }
.editor-tree-row.is-ignored { opacity: .5; }

.editor-filter { padding: 8px 8px 6px; }
.editor-filter input {
  width: 100%; height: 30px; padding: 0 28px 0 28px; border-radius: var(--radius);
  background: var(--bg); border: 1px solid var(--action); box-shadow: 0 0 0 3px var(--action-ring);
  color: var(--text); font: 12.5px var(--font-mono); outline: none;
}
.editor-match { color: var(--action-text); font-weight: 600; }

.editor-head {
  height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 8px;
  border-bottom: 1px solid var(--border); background: var(--surface);
}
.editor-tree-toggle { width: 30px; height: 30px; border-radius: var(--radius); border: 0; background: var(--surface-2); color: var(--text-2); }
body.editor-tree-hidden .editor-tree-toggle { background: transparent; color: var(--text-dim); }
.editor-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.editor-title-name { font: 600 14px var(--font-ui); }
.editor-title-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--type-editor); }
.editor-crumb { display: flex; align-items: center; gap: 3px; font: 11px var(--font-mono); color: var(--text-dim); }
.editor-crumb .sym { color: var(--text-muted); }
.editor-open-menu { display: none; }
body.editor-tree-hidden .editor-open-menu { display: inline-flex; }
.editor-quick {
  margin-left: auto; width: 220px; height: 30px; display: flex; align-items: center; gap: 8px;
  padding: 0 6px 0 10px; border-radius: var(--radius); background: var(--bg);
  border: 1px solid var(--border-strong); color: var(--text-faint); font: 12.5px var(--font-ui); cursor: pointer;
}
.editor-quick:hover { border-color: var(--action); }
.kbd { font: 11px var(--font-mono); padding: 1px 6px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text-muted); }

.editor-notes-bar {
  display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border: 0;
  border-radius: var(--radius); background: var(--action-soft); color: var(--action-text); font: 500 12px var(--font-ui);
}

.editor-host { position: relative; }
.editor-bar {
  position: absolute; top: 14px; right: 18px; z-index: 5; width: 340px;
  display: flex; flex-direction: column; gap: 10px; padding: 14px 14px 12px;
  background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal); font: 12.5px/1.5 var(--font-ui); color: var(--text-muted);
}
.editor-bar-title { font: 600 13px var(--font-ui); color: var(--text); }
.editor-bar.is-warn .editor-bar-title::before { content: '\ea6c'; font-family: codicon; color: var(--accent); margin-right: 8px; }
.editor-bar.is-error .editor-bar-title::before { content: '\ea87'; font-family: codicon; color: var(--state-error); margin-right: 8px; }
.editor-bar .btn { height: 28px; padding: 0 12px; font-size: 12px; }   /* oggi sono 11×20px */

.editor-status {
  height: 24px; display: flex; align-items: center; gap: 16px; padding: 0 12px;
  background: var(--bg); border-top: 1px solid var(--divider);
  font: 11px var(--font-mono); color: var(--text-dim); white-space: nowrap;
}
.editor-status .is-dirty { color: var(--type-editor); }
.editor-status .lang { color: var(--text-2); }
```

Fondo dell'editor: oggi `defineTheme` legge `--bg` da `:root` (`#070505`), mentre il resto dell'area è su `#main` (`--bg` mescolato col colore principale). Conviene leggerlo da `#main`, così il tema segue il colore scelto da View → Colori.

## 3. Comportamenti nuovi

**Ctrl+P · Vai al file (2b).** Nuovo modulo `renderer/editor-quick.js`.
- Serve un elenco piatto dei file: nuova IPC `editorListAll(cwd)` in `lib/editor-fs.js`, che salta gli ignorati, ha un tetto (~20k voci) e una cache per scheda invalidata da `reloadEditorTree`.
- Ordine dei risultati: prima i file aperti, poi corrispondenza del nome per sottostringa e poi fuzzy. Il percorso vale meno del nome.
- Tasti: ↑↓, Invio → `openEditorFile(tab, rel)`, Esc chiude.
- Tasto catturato come Ctrl+B (in `initEditorTabs`), solo con una scheda editor davanti.

**Menu «N aperti» (2c).** Si vede solo con `body.editor-tree-hidden`. Riusa `EditorTree.showMenu`, con le voci dei file aperti più «Salva tutto» e «Chiudi tutti». Alt+1…9 attivano i file aperti.

**Filtro dell'albero (2d).** Si attiva dall'icona filtro o scrivendo con il fuoco sull'albero.
- Lavora solo sulle cartelle già lette (`tree.children`); per tutto il progetto c'è Ctrl+P, e lo dice una riga in fondo.
- Le righe diventano piatte: nome con la corrispondenza evidenziata (`.editor-match`), cartella sotto in mono 10.5px.
- Esc o × svuotano il filtro e riportano l'albero com'era.

**Lettere git nell'albero.** I dati ci sono già (`lib/git-changes.js` per il pannello modifiche). Bastano `M`/`U`/`A`/`D` per file e un `•` sulle cartelle che li contengono. Si aggiornano su `refreshEditorTab` e dopo ogni salvataggio.

**Simbolo nel percorso.** Con `monaco.languages` si prende la funzione che contiene il cursore (outline o `DocumentSymbolProvider` per JS/TS), in debounce su `onDidChangeCursorPosition`. Se non c'è nessun simbolo, il percorso mostra solo la cartella.

**Barra di stato.** `Ln/Col` da `onDidChangeCursorPosition`; `Spazi: N` da `model.getOptions()`; `UTF-8` (con BOM se `f.bom`); `LF/CRLF` da `model.getEOL()`; il linguaggio da `model.getLanguageId()`. Il branch è quello che la sidebar ha già.

**Stato vuoto.** Si vede quando `files.order` è vuoto: campo che apre Ctrl+P, «Aperti di recente» (da `lib/editor-sessions.js`, ultimi 5 file chiusi in questa cartella) e scorciatoie.

## 4. Menu contestuale (`showMenu`)

Le voci accettano `icon`, `key` e `{ sep: true }`:

```css
.editor-menu { min-width: 232px; padding: 4px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-modal); }
.editor-menu-item { display: flex; align-items: center; gap: 9px; height: 28px; padding: 0 10px; border-radius: 5px; font-size: 12.5px; }
.editor-menu-item:hover { background: var(--action-soft); }
.editor-menu-item .codicon { color: var(--text-dim); font-size: 15px; }
.editor-menu-item.is-danger, .editor-menu-item.is-danger .codicon { color: var(--state-error); }
.editor-menu-key { margin-left: auto; font: 11px var(--font-mono); color: var(--text-dim); }
.editor-menu-sep { height: 1px; background: var(--border); margin: 4px 6px; }
```

La voce nuova «Copia percorso» va in `editorTreeMenu`. F2 rinomina e Canc elimina sulla riga selezionata.

## 5. Ordine consigliato

1. Icone, intestazione del pannello e righe dell'albero (solo CSS e `editor-tree.js`).
2. «Aperti» al posto delle sotto-schede, e titolo con il percorso.
3. Barra di stato, conflitto a scheda flottante, stato vuoto.
4. Lettere git, filtro, Ctrl+P, simbolo nel percorso.

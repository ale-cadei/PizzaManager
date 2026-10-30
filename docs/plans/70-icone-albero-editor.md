# 70 — `feat/icone-in-filemanager`: icone nell'albero della scheda editor

Dipende da: 60 (sessione editor). Taglia: ~mezza giornata.

## Perché

Nell'albero della scheda editor cartelle e file si distinguono solo dalla
freccetta `▸`. Un'icona accanto al nome dice a colpo d'occhio cos'è: cartella
(aperta o chiusa) o file, e che tipo di file.

## Cosa fa

- **Cartelle**: icona cartella, aperta quando la cartella è espansa.
- **File**: icona per nome noto (`package.json`, `Dockerfile`, `.gitignore`,
  `README.md`, `vite.config.*`…), altrimenti per estensione, la composta
  prima (`d.ts` prima di `ts`). Senza corrispondenza un file generico.
- I file ignorati da git hanno l'icona sbiadita, come il nome.

## Come

- **Icone**: Material Icon Theme 5.40.0 (MIT, npm `material-icon-theme`).
  Copiate in `renderer/file-icons/` solo le SVG che la mappa usa (114 file,
  ~470 KB su disco). Licenza in `THIRD-PARTY-NOTICES.md`. Niente dipendenza
  npm: il pacchetto pesa decine di MB per 114 disegni.
- **Mappa**: `renderer/file-icons.js` (UMD, puro). `iconOf(row)` → nome
  dell'icona, `iconUrl(row)` → percorso relativo alla pagina, `ALL_ICONS`.
- **Vista**: `createTreeView` accetta `iconUrl` opzionale; con, ogni riga ha
  un `<img>` decorativo (`alt=""`, `aria-hidden`) fra freccia e nome.
  `editor-tab.js` passa `FileIcons.iconUrl`.
- **CSP**: nessuna modifica, `img-src 'self'` ammette già le SVG locali.

## Test

- `tests/file-icons.test.js`: cartelle, estensioni, composte, nomi noti,
  ripiego; le SVG sul disco sono esattamente quelle che la mappa nomina;
  nessuna SVG contiene script, handler o riferimenti esterni.
- `tests/editor-tree.test.js`: con `iconUrl` l'icona c'è, al posto giusto,
  decorativa.

## Aggiungere un'icona

Scegliere l'SVG da `icons/` del pacchetto `material-icon-theme` (stessa
versione), copiarla in `renderer/file-icons/` e nominarla nella mappa: il
test dice se manca qualcosa dall'una o dall'altra parte.

## Fuori

- Icone dedicate per cartelle speciali (`src`, `node_modules`, `.git`…).
- Icone nelle sotto-schede dei file aperti e nel pannello delle modifiche.

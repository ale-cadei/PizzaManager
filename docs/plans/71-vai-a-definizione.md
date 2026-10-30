# 71 — `feat/controlclick`: Ctrl+click (⌘+click) va alla definizione

Dipende da: 60 (sessione editor). Taglia: ~1 giorno.

## Perché

Nella scheda editor un nome (variabile, funzione, classe…) non porta da
nessuna parte: per trovare dove è definito serve un terminale e un grep.
Ctrl+click (⌘+click su Mac) lo fa dall'editor.

## Cosa fa

- Tenendo premuto Ctrl (⌘) il nome sotto il mouse si sottolinea; il click
  apre il file della definizione (o la porta davanti) e mette il cursore sul nome.
- Più candidati: si va al più vicino (vedi «Ordine»). Nessuno: un fumetto
  «Nessuna definizione per …» sul cursore.
- Tutti i linguaggi, nessun server da installare: è una ricerca, non un LSP
  (che il piano 60 lascia fuori). Può sbagliare con nomi omonimi.

## Come

- **Ricerca** (`lib/editor-definition.js`): `git grep -n -z -I -w -F
  --untracked` del nome nella cartella della scheda (rispetta `.gitignore`,
  trova i file nuovi); fuori da un repository `--no-index --exclude-standard`.
  Sempre `runGit` (execFile, mai la shell). Ogni riga trovata passa per le
  **forme di definizione**:
  - *forti*, introdotte da una parola chiave: `function`, `class`,
    `interface`, `type`, `enum`, `struct`, `trait`, `def`, `fn`, `func`,
    `fun`, `const`/`let`/`var`/`val`, `#define`, metodi Go `func (r T) X`…
  - *deboli*: assegnazioni (`X =`, `obj.X =`), chiavi (`X:`), metodi con
    corpo sulla stessa riga (`X(a) {`), funzioni C-like (`int X(`),
    funzioni di shell (`X() {`).
  Righe oltre 1000 caratteri (minificati) si saltano. Nomi non validi o parole
  chiave comuni (`if`, `return`…) non si cercano.
- **Ordine**: forti prima delle deboli; poi lo stesso file (la definizione
  più vicina sopra il click, poi sotto); poi stessa famiglia di linguaggio
  (`.ts` e `.js` sono una famiglia); poi cartelle più vicine; poi percorso.
  Al massimo 50 risultati.
- **IPC**: `editor-definition` (`app/editor.js`), percorsi confinati come gli
  altri canali.
- **Monaco** (`renderer/editor-monaco.js`): l'host ascolta mouse e tasti, e
  con Ctrl/⌘ + click sinistro sul testo chiama `onDefinition(rel, parola,
  posizione)`. Le definizioni interne di Monaco per JS/TS e CSS si spengono
  (`setModeConfiguration`): darebbero un secondo salto, solo dentro il file.
  `hint(testo)` mostra il fumetto di Monaco sul cursore.
- **Scheda** (`renderer/editor-definition-ui.js`): chiede al main, apre il
  file, `reveal(rel, riga, colonna)`. Un click più recente scarta la risposta
  di uno vecchio.

## Test

- `tests/editor-definition.test.js`: forme per linguaggio, falsi positivi
  (chiamate, confronti), colonna, ordine, nomi rifiutati, git grep vero su
  una tmpdir (repository e no), file ignorati esclusi.
- `tests/editor-monaco.test.js`: Ctrl/⌘ + click chiama `onDefinition`, il
  click senza modificatore no, sottolineatura col modificatore, `reveal` con
  colonna, definizioni interne spente.
- `tests/editor-ipc.test.js`: il canale risponde e rifiuta payload cattivi.

## Fuori

- Un elenco fra cui scegliere quando i candidati sono più d'uno.
- Analisi vera del codice (scope, import): servirebbe un LSP per linguaggio.
- «Trova tutti i riferimenti», «Indietro» dopo il salto.

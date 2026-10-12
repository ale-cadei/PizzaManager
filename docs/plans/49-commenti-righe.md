# 49 — `feat/commenti-righe`: un commento su un gruppo di righe

Chiesto dall'utente il 2026-10-09. I commenti del piano 44 stanno su una
riga sola: per dire «questo blocco va rifatto» oggi si commenta l'ultima
riga e si spera che l'agente capisca fin dove.

## Cosa

- Clic sul ＋ di una riga: come oggi, textarea sotto quella riga.
- Con la textarea aperta, **Shift+clic** sul ＋ di un'altra riga **dello
  stesso hunk**: il commento ora copre tutte le righe fra le due (l'ordine
  non conta). Le righe si evidenziano, la textarea scende sotto l'ultima, il
  testo già scritto resta. Un altro Shift+clic ridefinisce la fine.
- Shift+clic su un altro hunk: non estende, un suggerimento nella textarea
  dice «solo righe dello stesso blocco» (fra due hunk ci sono righe che il
  diff non mostra).
- Salvato, il commento sta sotto l'ultima riga del gruppo; le righe del
  gruppo hanno un segno a sinistra (barra del colore dei commenti). ✎ riapre
  la textarea col gruppo evidenziato, e Shift+clic lo cambia anche lì.
- Una riga sola è il caso da = a: i commenti di prima funzionano uguale.

```
  12 + const a = 1;          ▌
  13 + const b = 2;          ▌
  14 + return a + b;         ▌
      ┌───────────────────────────────┐
      │ righe 12–14: usa una funzione │
      └───────────────────────────────┘
```

## Modello (`renderer/review-notes.js`)

- L'ancora diventa l'elenco delle righe coperte, nell'ordine del diff:
  `{ path, lines: [{ side, no, text }] }` (side `new` per aggiunte e
  contesto, `old` per le tolte, come `anchorOf` oggi).
- `rangeAnchor(path, hunk, fromLine, toLine)`: le righe del hunk fra le due,
  estremi compresi; null se le due righe non sono nello stesso hunk.
- `id`: `primo-ultimo:path` (`new:12-new:14:lib/a.js`). Stesso primo e
  ultimo → stessa nota, si riscrive.
- La nota si mostra sotto la sua ultima riga se **tutte** le sue righe ci
  sono ancora, con lo stesso testo e consecutive nello stesso hunk;
  altrimenti è orfana (in cima al file, come oggi), e non si perde.
- Le note stanno in memoria (piano 44): niente da migrare.
- Limite: 200 righe per gruppo (un hunk più lungo si commenta a pezzi).

## Nel prompt per l'agente

```
2. lib/a.js:12-14
   + const a = 1;
   + const b = 2;
   + return a + b;
   usa una funzione
```

- Numeri del file nuovo se il gruppo ha righe aggiunte o di contesto
  (`path:12-14`, `path:12` se una); solo righe tolte → `path (righe 5-8
  tolte)`; misto → numeri nuovi più «(e 2 righe tolte)».
- Citate col segno del diff (`+`, `-`, spazio) al massimo 20 righe, poi
  `   … (altre N righe)`. Una riga sola resta citata com'è oggi (`> testo`).
- Ordine: per file e per prima riga, come oggi. Stessa pulizia dei
  caratteri di controllo (`sanitize`).

## Dove

- `renderer/review-notes.js`: ancora a intervallo, `rangeAnchor`,
  `notesAt` (le note che finiscono su questa riga), `coveredBy` (la riga
  sta in un gruppo, per il segno), `formatPrompt`.
  *Fatto così:* `notesAt`, `coveredBy` e `orphansOf` sono diventati
  `placeNotes`, che in un passaggio solo sul diff dà `endsAt` (riga → note
  che finiscono lì), `covered` (righe segnate) e `orphans`: con una ricerca
  per riga un hunk lungo costava il quadrato.
- `renderer/changes-view.js`: Shift+clic sul ＋ (l'evento arriva con
  `shiftKey`), evidenza delle righe del gruppo in modifica, segno sulle
  righe dei gruppi salvati.
- `renderer/changes-panel.js`: `rc.open(anchor, draft)` accetta un'ancora a
  intervallo; `rc.extend(line, hunk)` per lo Shift+clic.
  *Fatto così:* `open` ed `extend` stanno nella vista (`changes-view.js`),
  dove già viveva la textarea; il pannello passa solo `replaces` ad
  `addNote`.
- Emerso in review: allargare un gruppo fin sulle righe esatte di un altro
  commento lo sovrascriveva. Ora la textarea lo dice e il gruppo resta
  quello di prima; `addNote` con `replaces` rifiuta lo stesso caso.
- `renderer/styles.css`.

## Fuori

- Trascinare per selezionare.
- Gruppi a cavallo di più hunk o di più file.
- Selezione da tastiera (resta Shift+clic).

## Verifica

- `npm run test:unit`: `review-notes` (ancora, id, orfane quando una riga
  del gruppo cambia, gruppo in un hunk solo, limite, prompt con numeri
  nuovi / solo tolte / misto, citazione troncata); Shift+clic, evidenza e
  segno col DOM finto (`tests/changes-view.test.js`).
- Smoke nell'app: gruppo di righe, ✎ e cambio del gruppo, invio
  all'agente finto e testo incollato.

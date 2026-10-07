# 41 — Temi personalizzati che si ricordano

Branch: `fix/temi-personalizzati` · Dipende da: 39 · Taglia: ~¼ g
Scritto il 2026-10-07.

**Stato (2026-10-07):** fatto, suite verde.

## Problema

Col piano 39 un tema era solo un punto di partenza: si salvavano i colori uno
per uno, senza sapere da quale tema venissero. Ritoccare un colore (es. Codex
in Ghiaccio), passare a un altro tema e tornare indietro perdeva il ritocco:
cliccare Ghiaccio rimetteva i suoi colori di fabbrica.

## Obiettivo

- Ogni tema ha i suoi colori predefiniti. Ritoccarne uno lo rende
  **personalizzato**: il pulsante diventa «Ghiaccio (personalizzato)», e i
  ritocchi restano a quel tema anche passando agli altri e tornando.
- «Forno» perde l'etichetta «(predefinito)»: è un tema come gli altri.
- «Ripristina colori predefiniti» compare solo quando il tema scelto ha
  ritocchi, e toglie solo quelli del tema scelto.
- Ogni riga ritoccata ha il suo «Ripristina», che torna al colore del tema.

## Scelte

- **Lo stato è `{ theme, custom }`** (`aisess.colorTheme`): il tema scelto e,
  per ogni tema, i soli colori che differiscono dai suoi. Un colore riportato a
  mano al valore del tema smette di essere un ritocco. I colori da scrivere su
  `:root` si ricavano dallo stato (`appliedColors`); per Forno sono solo i
  ritocchi, così `tokens.css` resta la fonte dei predefiniti (piano 39).
- **Migrazione dalla scelta piatta** (`aisess.typeColors`, piano 39): diventa
  il tema più vicino (meno colori diversi, a pari merito Forno) con le
  differenze come ritocchi. La vecchia chiave sparisce al primo salvataggio.
- **Annulla scarta tutto**, compresi i ritocchi fatti ad altri temi nella
  stessa apertura del dialogo: si salva solo con «Salva», come prima.
- I campioni di un tema personalizzato mostrano i colori ritoccati.

## File

- `renderer/type-color-themes.js` — stato, transizioni pure, store e migrazione.
- `renderer/type-colors.js` — tolto lo store piatto, ora in `type-color-themes.js`.
- `renderer/type-colors-ui.js` — nomi «(personalizzato)», ripristini.
- `renderer/app-state.js`, `renderer/menu-actions.js`, `renderer/index.html`,
  `renderer/styles.css` — cablaggio e stile.
- `tests/type-color-themes.test.js`, `tests/type-colors.test.js`.

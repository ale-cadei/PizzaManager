# 39 — Temi pronti nel dialogo «Colori»

Branch: `feat/temi-colori` · Dipende da: — · Taglia: ~¼ g
Scritto il 2026-10-06.

**Stato (2026-10-06):** fatto, suite verde, provato nell'app (Electron sotto
xvfb): sette pulsanti, click su «Lavanda» → `--action` diventa `#9b7bff` e il
pulsante resta acceso.

## Obiettivo

Il dialogo View → Colori… chiede di scegliere sette colori uno per uno. Sopra
i selettori ora ci sono dei temi pronti (Forno — il predefinito —, Mare di
notte, Bosco, Lavanda, Neon, Ambra, Bianco e nero, Ghiaccio): un click riempie tutti i selettori, con anteprima dal vivo.

## Scelte

- **Un tema è un punto di partenza, non uno stato.** Si salva colore per
  colore come una scelta a mano (`aisess.typeColors`): nessun «tema attivo» da
  ricordare né da migrare. Il pulsante si accende quando la scelta corrente
  coincide col tema (`matchTheme`), quindi anche riaprendo il dialogo; un
  ritocco lo spegne.
- **Il predefinito «Forno» è il primo tema**, ma sceglierlo salva niente:
  toglie i colori cambiati come «Ripristina predefiniti», così resta valido
  `tokens.css`. I suoi colori nel file servono solo ai campioni, e un test li
  confronta con `tokens.css` perché non divergano.
- **Leggibilità verificata nei test**: ogni colore ha contrasto ≥ 4.5 su
  `--bg`, e il testo del pulsante primario (ricavato da `actionVars`) pure.

## File

- `renderer/type-color-themes.js` — i temi (congelati), `themeColors`, `matchTheme`.
- `renderer/type-colors-ui.js` — i pulsanti dei temi (`themesEl`, `themes`).
- `renderer/index.html`, `renderer/menu-actions.js`, `renderer/styles.css` — cablaggio e stile.
- `tests/type-color-themes.test.js`.

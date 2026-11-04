# 88 — `feat/switch-split`: affiancate ↔ impilate dalla linea

Dipende da: 76 (schermo diviso). Taglia: ~1h.

## Perché

Per passare da due sessioni affiancate a due impilate (o il contrario) oggi
bisogna ritrascinare una card su un altro bordo. Sulla linea ci sono già ⇄
(scambia) e ✕ (togli la divisione): manca il cambio di orientamento.

## Cosa fa

- Terzo pulsante **↻** sulla linea, accanto a ⇄ e ✕, visibile all'hover come
  gli altri.
- Da affiancate (`row`) a impilate (`column`) e viceversa: stesse due sessioni
  nello stesso ordine (sinistra → sopra), stessa proporzione, stessa sessione
  in primo piano.
- Titolo e `aria-label` dicono cosa succede al click: «Impila le sessioni» o
  «Affianca le sessioni».
- L'orientamento nuovo si salva come gli altri cambi (`setSplit`).

## Come

- `renderer/split-layout.js`: `toggleOrientation(state)`, pura.
- `renderer/split-view.js`: click → `setSplit(Split.toggleOrientation(…))`;
  `applySplitLayout` aggiorna titolo ed etichetta del pulsante.
- `renderer/index.html`: il pulsante `.split-orient`.
- Test in `tests/split-layout.test.js`.

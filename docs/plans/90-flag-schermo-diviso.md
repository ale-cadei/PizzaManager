# 90 — `feat/flag-con-splitscreen`: quale sessione c'è in ogni metà

Dipende da: 76 (schermo diviso). Taglia: ~1h.

## Perché

Con lo schermo diviso due terminali si somigliano: per sapere quale sessione
è in quale metà bisogna guardare la sidebar e indovinare. Senza divisione il
problema non c'è (la card selezionata è quella visibile).

## Cosa fa

- In divisione, ogni metà ha **in cima una barra a tutta larghezza** con
  l'icona della sessione nel colore del tipo (`--type-*`), allineata alla prima
  colonna del terminale, poi il nome, e il tipo in mono maiuscolo a destra. Il
  nome intero sta nel `title`.
- La barra della metà **in primo piano** ha fondo rialzato (`--surface-3`),
  testo pieno in semibold e sotto lo stesso filo pomodoro della cornice;
  l'altra sta sul fondo pannello (`--surface`), con testo e icona smorzati.
- In divisione la linguetta «cosa ha cambiato» scende sotto la barra.
- Il nome segue rinomina e titolo automatico (passano da `renderSidebar`).
- Una striscia in cima alla metà è riservata alla linguetta: non copre la
  prima riga del terminale né la barra di editor e git.
- Senza divisione nessuna linguetta, nessuna striscia.

## Come

- `renderer/split-layout.js`: `paneFlags(state, activeId)` → le due metà con
  `focused`; `flagTitle(name, typeLabel)` per il testo. Pure.
- `renderer/split-view.js`: `renderSplitFlags()` crea/aggiorna `.split-flag`
  dentro i wrap, chiamata da `applySplitLayout` e da `renderSidebar`.
- `renderer/styles.css`: linguetta e striscia riservata solo sotto
  `#terminals.split-row` / `.split-column`.
- Test in `tests/split-layout.test.js`.

## Fuori

- Click sulla linguetta (rinomina, menu): oggi è solo un'etichetta.
- Stato della sessione (al lavoro, ha finito) sulla linguetta.

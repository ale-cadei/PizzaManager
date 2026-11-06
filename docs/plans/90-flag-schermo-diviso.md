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
- La barra occupa uno spazio suo in cima alla metà (`--split-flag-h`, 28px):
  non copre la prima riga del terminale né l'intestazione di editor e git.
- Senza divisione nessuna barra, nessuno spazio riservato.

## Come

- `renderer/split-layout.js`: `paneFlags(state, activeId)` → le due metà con
  `focused`; `flagTitle(name, typeLabel)` per il testo. Pure.
- `renderer/split-view.js`: `renderSplitFlags()` crea/aggiorna `.split-flag`
  dentro i wrap, chiamata da `applySplitLayout` e da `renderSidebar`.
- `renderer/styles.css`: barra e spazio riservato solo sotto
  `#terminals.split-row` / `.split-column`.
- Test in `tests/split-layout.test.js`.

## Emerso strada facendo: la vista git a metà larghezza

A schermo diviso la scheda git ha mezza finestra, ma le sue colonne
guardavano la finestra: badge dei branch fuori dalla cella, messaggio
schiacciato, linguetta «cosa ha cambiato» sopra il bordo delle righe.

- `.git-view` è un *container*: le soglie guardano il pannello. Sotto 720px
  sparisce l'autore, sotto 600px la data e i badge oltre il primo, sostituiti
  da un «+N»; il contatore in intestazione resta solo con una linea isolata.
- I badge si restringono con «…» e il messaggio tiene almeno il 40% della riga.
- Quello che sparisce va nei tooltip: `refTitle` (nome intero del ref),
  `moreRefs` (il «+N» e l'elenco), `commitTitle` (messaggio, autore e data)
  in `renderer/git-graph-view.js`, testati in `tests/git-graph.test.js`.

## Fuori

- Click sulla barra (rinomina, menu): oggi è solo un'etichetta.
- Stato della sessione (al lavoro, ha finito) sulla barra.

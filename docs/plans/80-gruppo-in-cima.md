# 80 — `feature/improvements-groups`: un gruppo in cima alla lista

Taglia: ~un'ora.

## Perché

Con molti gruppi aperti la lista delle sessioni scorre, e per lavorare su un
gruppo bisogna trascinare la scrollbar finché la sua testata non arriva in
alto. Serve un gesto solo.

## Cosa fa

- Ogni testata di gruppo (per tipo e per progetto) ha un tasto `⤒`, accanto a
  `+` / `⟲` / `⑂`. Il click fa scorrere `#session-list` finché il bordo alto del
  gruppo coincide col bordo alto della lista, cioè subito sotto «SESSIONI
  APERTE».
- Non apre né chiude il gruppo: il click non arriva alla linguetta.
- Anche gli ultimi gruppi arrivano in cima: se sotto non c'è abbastanza lista
  da scorrere, la lista si allunga in fondo dello spazio che manca. Lo spazio
  si toglie appena si torna a scorrere verso l'alto oltre il punto in cui
  non serve più, così non resta un vuoto in fondo.
- Scorrimento morbido, istantaneo con `prefers-reduced-motion`.
- Sidebar collassata: il tasto sparisce come gli altri tasti della testata.

## Come

- `renderer/group-scroll.js` (UMD, testabile): `scrollPlan()` è il calcolo
  puro (dove scorrere, quanto spazio aggiungere); `createGroupScroller({ list,
  reducedMotion })` → `{ toTop(groupEl) }` lo applica. Lo spazio in più è la
  variabile CSS `--scroll-room` nel `padding-bottom` della lista: sopravvive ai
  `render()`, che svuotano la lista.
- `sidebar.js` riceve `onGroupToTop(groupEl)` e disegna il tasto solo se c'è;
  non sa nulla dello scorrimento. Il collegamento sta in `session-list.js`.

## Aggiunta: apertura e chiusura animate

- Aprendo un gruppo il corpo cresce da 0 alla sua altezza e la fetta ruota;
  chiudendo si schiaccia a 0 e solo alla fine il gruppo si ridisegna chiuso.
  ~180ms; istantaneo con `prefers-reduced-motion`.
- `render()` ricrea la lista, quindi una transizione CSS non vedrebbe mai lo
  stato di prima: `renderer/group-fold.js` usa le Web Animations sul corpo
  (`createGroupFold({ reducedMotion, getStyle })` → `{ open, close }`).
  Aprendo si anima il corpo NUOVO dopo il render; chiudendo il vecchio, prima.
- Un click durante la chiusura non ne avvia un'altra; un render arrivato da
  fuori a metà chiusura disegna il gruppo già chiuso, senza lampeggi.

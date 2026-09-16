# 9 — Ordinamento manuale delle card della sidebar

Branch: `feat/raggruppamento-per-progetto` (insieme al piano 8, per scelta
esplicita) · Dipende da: 8 · Taglia: ~2h

## Obiettivo

Trascinare una card della sidebar per spostarla dove si vuole **dentro il suo
gruppo**. Il piano 8 aveva messo l'ordinamento personalizzabile fuori scope:
questo è il suo seguito.

Fuori scope: spostare una sessione da un gruppo all'altro (il gruppo dipende dal
tipo o dal progetto della sessione, non da dove sta nella lista: un drop
altrove non potrebbe essere onorato); riordinare i gruppi fra loro; persistere
l'ordine fra un avvio e l'altro.

## Perché l'ordine non si persiste

Gli id delle schede si generano a runtime (`'tab-' + Date.now() + …` in
`createTab`): dopo un riavvio non esiste più niente a cui riagganciare un ordine
salvato. Persisterlo vorrebbe dire prima dare alle sessioni un'identità stabile,
che è un problema diverso e più grande.

## Una sola lista, non una per gruppo

L'ordine vive in **una lista di id per tutta la sidebar** (`sessionOrder` in
`renderer.js`), non una per gruppo. I gruppi sono una vista sulla stessa lista:
`groupSessions` conserva l'ordine relativo con cui riceve le sessioni, quindi
mettere un id accanto a un altro nella lista globale equivale a spostare la card
accanto all'altra dentro il suo gruppo.

Il vantaggio è che **cambiare modalità di raggruppamento non butta via l'ordine
scelto**: le stesse card, raggruppate diversamente, restano nell'ordine relativo
che l'utente ha dato loro.

## Pezzi

**`renderer/session-order.js`** (nuovo, puro, UMD come `session-groups.js`):

- `moveAdjacent(order, movedId, targetId, {before})` → nuova lista. Toglie prima
  l'id spostato e cerca il bersaglio dopo, così l'indice non va corretto a
  seconda che la card venisse da sopra o da sotto. Mossa nulla o id sconosciuti
  → restituisce la lista invariata (stesso riferimento: il chiamante ci si
  appoggia per non rirenderizzare).
- `applyOrder(sessions, order)` → sessioni ordinate; quelle non ancora in lista
  restano in coda nell'ordine di arrivo, così nessuna sparisce mai dalla sidebar
  per colpa dell'ordine.
- `syncOrder(order, ids)` → schede nuove in coda, schede chiuse via.

**`renderer/sidebar.js`**: nuova callback `onReorder(movedId, targetId, {before})`
e handler `dragstart/dragover/dragleave/drop/dragend` sulle card. Il drop si
accetta (`preventDefault`) **solo** se la card sorvolata sta nello stesso gruppo
di quella trascinata: altrove il cursore mostra "vietato". Il lato del bersaglio
si decide confrontando `clientY` con la metà del rettangolo della card.

Il click che chiude un trascinamento non deve selezionare né rinominare:
`DRAG_CLICK_GUARD_MS` (250 ms dopo `dragend`/`drop`) lo scarta, come già si fa a
mano per il doppio click.

**`renderer/renderer.js`**: `sessionOrder` accanto a `tabs` (è una proprietà
delle schede aperte, non della sidebar, che riceve già la lista ordinata);
`renderSidebar` sincronizza e ordina prima di passare.

**`renderer/styles.css`**: `.session-item.dragging` sbiadita; `.drop-before` /
`.drop-after` come `box-shadow` e non come bordo vero — un bordo cambierebbe
l'altezza della card e farebbe saltare la lista sotto il cursore proprio mentre
si mira.

## Test

- `tests/session-order.test.js` — modulo puro: spostamenti in su e in giù (il
  caso "verso il basso" è quello dove l'indice si sfasa), testa e coda, mosse
  nulle, nessuna mutazione degli argomenti.
- `tests/sidebar-drag.test.js` — il codice vero della sidebar su un DOM finto
  (`tests/fake-dom.js`, niente jsdom): metà alta/bassa del bersaglio, drop
  rifiutato fuori dal gruppo in entrambe le modalità, click dopo il drag
  neutralizzato, segni visivi puliti a fine trascinamento.

## Aperto

- **Nessuna alternativa da tastiera.** Il trascinamento è l'unico modo di
  riordinare: chi non usa il mouse resta fuori. Servirebbe una scorciatoia tipo
  ⌥↑/⌥↓ sulla card selezionata, che riusa `moveAdjacent` senza toccare il resto.

# 19 — Spostare i progetti e sapere in che chat si è

Branch: `feat/sposta-progetti-e-chat-corrente` · Dipende da: 8, 9, 14 · Taglia: ~2h

## Obiettivo

1. **Riordinare i gruppi progetto** trascinandone la linguetta, come già si fa
   con le card (piano 9). Solo in modalità «Progetto»: per tipo l'ordine è fisso.
2. **Dire in che chat si è**: nella barra in basso, a sinistra delle quote,
   `📁 cartella · nome della chat` della scheda in primo piano.

## Scelte

- **L'ordine dei progetti si salva** (`localStorage`, chiave
  `aisess.projectOrder`), a differenza di quello delle card: la chiave di un
  gruppo è la radice del repository, stabile fra un avvio e l'altro.
  I progetti non aperti restano nella lista salvata (tetto: 200), così
  riaprendoli ritrovano un posto.
- I progetti mai spostati vanno **in coda, in ordine alfabetico**; «Senza
  directory» resta sempre in fondo e non si trascina.
- Il rilascio si **segna** (riga sopra/sotto il fascicolo sorvolato) invece di
  spostare il gruppo dal vivo: un fascicolo aperto è alto e farebbe saltare la
  lista sotto il cursore.
- La cartella nella barra è la **radice del progetto** (o la cwd se non c'è);
  il percorso completo sta nel tooltip. Il riquadro si tronca per primo, le
  quote no. Si aggiorna da `renderSidebar()`, dove passano cambio scheda,
  rinomina e titoli automatici.

## Pezzi

- `renderer/session-groups.js`: `groupSessions(..., { projectOrder })`.
- `renderer/sidebar.js`: drag della linguetta (`attachGroupDrag` /
  `attachGroupDrop`), ordine salvato; riceve `Order` nelle deps.
- `renderer/usage-bar.js`: `currentChat(tab)` e `setCurrent(tab)`.
- Test: `tests/sidebar-group-drag.test.js`, casi nuovi in
  `session-groups.test.js` e `usage-bar.test.js`.

## Aggiunta: l'ordine delle card si salva

Il piano 9 non lo salvava perché l'id della scheda nasce a runtime. Si salva
invece una lista di **chiavi stabili** (`aisess.sessionOrder`, `tabKeys` in
`renderer/session-order.js`): l'id della conversazione (`claude:<id>`, regge il
riavvio della macchina) e la sessione tmux (`tmux:<nome>`, regge la chiusura
dell'app). Una scheda che riappare con una di quelle chiavi torna al suo posto;
le schede ancora chiuse restano nella lista accanto a chi le precedeva
(`mergeSaved`), così il riaggancio una alla volta all'avvio non le perde.
Una shell senza tmux, o ricreata pulita dopo un riavvio, non ha chiave: in coda.

## Fuori scope

Spostare una sessione da un progetto all'altro (il progetto dipende dalla cwd);
riordinare i gruppi per tipo.

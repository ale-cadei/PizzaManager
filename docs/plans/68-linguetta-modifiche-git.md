# 68 — linguetta «Modifiche» anche nella scheda git, e trascinabile

`fix/linguetta-git-in-git-session`

## Il problema

La linguetta delle modifiche (piano 32) compare in tutte le schede tranne
quella git: `ChangesModel.targetFor` restituisce `null` per `type: 'git'`.
Ma la scheda git ha una cartella (`cwd`, la radice del repository) e chi la
guarda è proprio chi vuole sapere cosa c'è da committare.

La linguetta sta poi sempre allo stesso posto (in alto a destra) e copre
quello che c'è sotto: nella scheda git il pulsante «Aggiorna», nei terminali
le prime righe a destra.

## Cosa cambia

- `targetFor` non esclude più la scheda git. Ultimo giro e commenti
  all'agente restano spenti (la scheda git non ha un agente: già così in
  `modeChoice` e `reviewAvailable`). Dopo un commit dal pannello la timeline
  della scheda git si rilegge.
- La linguetta si trascina su e giù, sempre attaccata al bordo destro.
  Un trascinamento sotto i 4 px resta un clic. La posizione si ricorda
  (`localStorage`) e si tiene dentro l'area dei terminali anche quando la
  finestra si rimpicciolisce.
- Spostata dal suo posto, la barra di scorrimento del terminale torna lunga
  quanto il terminale (la classe `has-changes-tab` le faceva spazio solo in
  alto).

## Fuori

- Spostarla sul bordo sinistro: scelta dell'utente, resta a destra.

# 31 — Sessione git: la mappa dei branch

Branch: `feat/git-branch-map-claude` · Dipende da: 25, 27 · Taglia: ~1 g

## Obiettivo

Una seconda vista nella scheda git, accanto alla timeline: la **mappa dei
branch**. `main` è una linea orizzontale; ogni branch se ne stacca dal commit
da cui è nato, sopra o sotto, e un branch nato da un altro branch si stacca
da quello (non da `main`). Un branch già unito torna su `main` nel commit di
merge. È la forma che si disegna a mano su un foglio per spiegare "chi viene
da dove".

```
            ╭──●──●──  branch #2
       ╭──●─●──●──  branch #1
  ●────●──────●──── +12 ──●──  main
              ╰──●──●──╯       branch #3 (già unito)
```

## Scelte

- **Locali e remoti insieme**: `x` e `origin/x` sono un branch solo; uno che
  esiste solo sul remoto (il lavoro di un collega) compare col nome a bordo
  tratteggiato. Per questo la mappa fa una seconda lettura,
  `git log --branches --remotes HEAD` (massimo 500): la timeline resta sui
  soli locali. Niente `fetch`: si vede quello che git sa già.
  Se il locale è solo indietro rispetto al remoto (un pull senza conflitti)
  la linea segue il remoto: un `main` locale non aggiornato faceva sembrare
  aperti branch già uniti su GitHub (è successo con `fix/tenant-isolation`,
  PR #24). Se è avanti o separato, segue il locale. Con più remoti vale `origin`.
- **Tutta la logica in `lib/`**, testabile senza DOM:
  `branchTopology` in `lib/git-branch-topology.js` (chi nasce da chi, chi è
  unito e dove) e `layoutBranchMap` in `lib/git-branch-map.js` (colonne e
  corsie). Il renderer
  (`renderer/git-map-view.js`) converte colonne e corsie in pixel e disegna.
- **Git non registra da quale branch ne nasce un altro.** Si ricostruisce
  dalla storia: ogni branch segue il suo primo genitore finché incontra una
  linea già disegnata; lì è il punto in cui si stacca. Quando due branch
  condividono dei commit, li prende **la linea più lunga** (come `main` fa da
  tronco per tutti): l'altra si stacca da lei.
- **Ogni merge su `main` è un ramo che ci rientra**, anche se il branch è
  stato cancellato dopo la PR: il secondo genitore del merge è la sua punta.
  Il nome viene dal branch che ci punta ancora o, se non c'è più, dal
  messaggio del merge ("Merge pull request #37 from ale/feat/x", "Merge
  branch 'x'"); accanto al nome, PR e giorno del merge (`#37 ✓ 28/09`). Il
  merge che fa `git pull` quando `main` locale e remoto si separano si chiama
  "main (pull)". Un branch unito e poi continuato sono due linee con lo
  stesso nome: la seconda nasce dalla prima.
- **Unito** senza merge (fast-forward, o rimasto indietro): il suo ultimo
  commit è già in `main`, non c'è un punto di ritorno da mostrare.
- I branch uniti si vedono per default; "già uniti (N)" li nasconde, tranne
  quelli da cui nasce un branch aperto: senza di loro il figlio resterebbe
  appeso nel vuoto.
- **Tratti di `main` senza eventi si comprimono** in un segno `+N`: una
  mappa con 400 commit di `main` e tre branch deve stare in uno schermo.
- **Corsie**: i figli di `main` si alternano sopra e sotto, il più vicino
  possibile alla linea; un figlio di un branch sta dalla stessa parte del
  padre, più lontano. Due branch che non si sovrappongono nel tempo
  condividono la corsia.
- Clic sul nome di un branch → torna alla timeline con quella linea isolata
  (la funzione del piano 27). Passaggio del mouse → si illumina il branch e
  la strada fino a `main`.

## Limiti noti

- Oltre i 500 commit più recenti: un branch che si stacca prima compare
  tratteggiato da sinistra ("origine fuori dalla storia letta"); un branch
  fermo da più di 500 commit non compare affatto.
- Uno squash merge (quello dei PR di GitHub in modalità squash) non lascia
  traccia nella storia: il branch resta "aperto".
- I remoti sono quelli dell'ultimo `fetch`: un branch cancellato su GitHub
  resta finché non si fa `git fetch --prune`.

## Fatto

- `lib/git-branch-topology.js`, `lib/git-branch-map.js` + campo `map` in
  `readGitGraph` (seconda lettura con `--remotes`).
- `renderer/git-map-view.js`, selettore Timeline/Mappa in
  `renderer/git-graph-view.js`, stili in `styles.css`.
- Test: `tests/git-branch-map.test.js` (topologia, layout, disegno su DOM
  finto) e un caso con git vero in `tests/integration.test.js`.

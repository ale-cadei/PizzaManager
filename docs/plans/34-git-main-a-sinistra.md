# 34 — Timeline git: main e develop sempre a sinistra

Branch: `feat/git-main-a-sinistra`. Dipende da 25 (sessione git) e 27 (cambio branch).

## Problema

`layoutGraph` assegna le colonne in ordine di arrivo: il primo commit in alto
prende la colonna 0. Se l'ultimo commit è su un feature branch, main finisce
in colonna 1 o 2 e la "base" della storia cambia posto a ogni commit.

Cambiando branch dal selettore, la timeline si rilegge ma l'unico segno è il
nome nell'intestazione, che cambia in silenzio.

## Cosa fa

1. **Corsie fisse.** `main` (o `master`, se `main` non c'è) prende sempre la
   colonna 0, `develop` la successiva. Si fissa la catena dei *primi genitori*
   dalla punta di ciascuno: quei commit stanno sempre nella loro colonna, anche
   quando la linea non è ancora iniziata (la colonna resta riservata e vuota).
   Un commit comune ai due sta su main. Tutti gli altri branch usano le
   colonne a destra. Colori fissi: main il colore del tipo git, develop il
   secondo della tavolozza.
2. **Cambio di branch visibile.** Quando fra due letture il branch corrente
   cambia (dal selettore o da un terminale), il pulsante del branch pulsa, un
   avviso dice "da X a Y" per qualche secondo e la timeline scorre fino al
   commit di HEAD. La riga di HEAD è sempre evidenziata.

## Fuori

- Nomi configurabili delle linee fisse (`trunk`, `release/*`).
- La mappa dei branch (31) ha già un suo tronco: non cambia.

# 20 — Onboarding

Branch: `feat/onboarding` · Dipende da: — · Taglia: ~1 g

## Obiettivo

Chi apre l'app la prima volta deve (1) sapere che cosa gli manca per usarla,
(2) scoprire le funzioni che non si vedono guardando, (3) senza un tour a
schermate che si salta al primo avvio e non si riapre più.

## Tre pezzi, un commit ciascuno

**1. Controllo di che cosa manca** — `lib/setup-check.js` (puro, `platform`
come parametro) produce un resoconto: per ogni agente trovato/mancante e, se
manca, il comando per installarlo; tmux trovato o no (su Windows non si
chiede). Arriva al renderer dentro `check-deps`, che i binari li cercava già
(un secondo handler avrebbe sforato il tetto di righe di `main.js` e cercato
i binari due volte); il renderer lo mostra nella
schermata vuota con un pulsante «Copia» per il comando e «Ricontrolla» per
rileggere dopo aver installato. tmux si attiva solo al riavvio dell'app: il
testo lo dice.

Comandi: quelli già in `lib/commands.js#INSTALL_HINTS`. Antigravity non ha un
comando da copiare, solo il link.

**2. Schermata vuota** — `renderer/welcome.js` (UMD) sostituisce la riga
«Nessuna sessione aperta…» con: pulsanti Nuova / Resume, gli strumenti
(pezzo 1), e 4-5 cose da sapere (rinomina, trascinamento, «+» del progetto,
tmux, barra d'uso). Si vede proprio quando serve e sparisce da sola alla
prima sessione.

**3. Suggerimenti una volta sola** — `renderer/hints.js` (UMD) decide quale
suggerimento mostrare (`nextHint`, puro) e ricorda quelli già visti
(`aisess.seenHints` in localStorage). Il fumetto è quello di
`confirm-bubble.js`, con una variante `tell()` a un solo pulsante che **non
prende il fuoco e non intercetta Esc**: chi sta scrivendo nel terminale non
deve perdere i tasti, e Esc interrompe gli agenti.

Suggerimenti:
- due chat nello stesso gruppo → «trascinale per riordinarle, doppio click per
  rinominare», sulla seconda card;
- modalità Progetto con due progetti → «trascina la linguetta, + apre una
  sessione qui», sulla linguetta del secondo.

Un suggerimento conta come visto quando appare, non quando si chiude: non deve
mai ripresentarsi. Non appare se c'è già un fumetto aperto (la conferma di
chiusura ha la precedenza).

## Fuori scope

Tour guidato; suggerimento sulla barra d'uso (è larga quanto la finestra, il
fumetto non ha dove puntare: va fra le cose da sapere); installare i tool
dall'app.

# 49 — Via i personaggi di Nickelodeon dagli animaletti

Branch: `chore/via-personaggi-nickelodeon`. Dipende dal 33 (animaletti).
Taglia: ~2h.

## Perché

Il piano 33 scelse di tenere i personaggi di SpongeBob **sapendo** che sono di
Nickelodeon/Paramount, e lo scrisse: «il rischio di una segnalazione DMCA è
accettato». Quella decisione è del 29 settembre 2026, quando:

- il repo pubblico non esisteva;
- non c'erano release scaricabili;
- l'app non aveva un titolare dichiarato.

Da allora è cambiato tutto e tre: le release stanno su
`JackGrieco/PizzaManager-releases`, chiunque le scarica, l'aggiornamento
automatico le spinge, la licenza è proprietaria e il copyright porta due nomi
e cognomi veri. Distribuire un'opera derivata di un personaggio protetto, con
il suo nome, sotto termini che vietano a chi la riceve di ridistribuirla è una
posizione diversa da «un programma che usiamo in due». Quindi si tolgono.

Lo stesso piano 33 aveva già previsto l'uscita: «se arriva una segnalazione, si
tolgono le voci da `pets-sprites.js`: il motore non dipende da nessun
personaggio». Qui si fa senza aspettare la segnalazione.

## Cosa si toglie

| id | Perché |
|----|--------|
| `spongebob` | Personaggio e marchio Nickelodeon, e il disegno è ricopiato da uno sprite GBA ritoccato da un fan: l'unico non originale di tutto il catalogo |
| `patrick` | Personaggio e marchio Nickelodeon (disegno originale, ma il personaggio no) |
| `gary` | Personaggio Nickelodeon: è la lumaca di SpongeBob, col suo nome nella tendina |

E con loro la voce di cast `inseguimento` (SpongeBob + medusa), che è la coppia.

## Cosa resta, e perché

- **La medusa** (`medusa`): senza SpongeBob accanto è una medusa qualsiasi —
  nessun nome di personaggio, nessun marchio, disegno fatto qui. Resta la voce
  `medusa`, che già esisteva e che già si comportava da sola (gironzola
  ondeggiando, chiama solo se non c'è nessun altro).
- **Tutti gli altri**: gatto, rana, uccellino sono pixel art fatta in questo
  repo; pizza, fizzo, rotolacampo, babbo, morte, zucca, fantasmino, ape,
  chiocciola, papera con anatroccoli, robottino, tazzina, pesce e trenino
  vengono dai pacchetti di sprite dell'utente (`pets-sprite-*.js`), che non
  hanno niente a che fare con Nickelodeon.

## Conseguenze nel motore

L'inseguimento era una **feature**, non un disegno: via SpongeBob se ne va
tutta la macchina della coppia in `renderer/pets.js`.

- `spawn` non ha più il caso speciale `kinds[0] === 'spongebob'`, e `placePair`
  spariscono: nessun personaggio nasce accoppiato a un altro.
- `chase` e `flee` spariscono. Attenzione: `chase` leggeva
  `Sprites.SPRITES.spongebob.speed`, quindi lasciarle lì sarebbe stato codice
  morto che va in errore al primo uso.
- Il campo `mate` esce da `newPet` e da `step`, e con lui `lift`/`passing`:
  servivano solo al salto con cui la medusa scansava il retino. `float` resta,
  perché l'ondeggio della medusa resta.
- Costanti via: `SWING_DIST`, `FLEE_DIST`, `TOO_CLOSE`, `START_GAP`, `LEASH`,
  `CORNER`, `FLEE_FACTOR`, `SWING_SLOWDOWN`, `LIFT_FALL`. `LEASH` era anche
  esportata (la usavano i test).
- La medusa perde la posa `flee` e i suoi due fotogrammi: non ha più nessuno
  da cui scappare. Il disegno aveva quattro colonne vuote a sinistra, che
  servivano ai tentacoli in fuga: si tagliano, così il suo ingombro torna
  esatto (18 → 14 colonne; il lato del pixel non cambia, perché si ricava
  dalle righe).

## Impostazioni già salvate

`cast` sta in `localStorage` e il default era `['inseguimento']`: chi non ha
mai aperto il pannello degli animaletti ha quella voce salvata, e chi l'ha
scelta a mano può avere anche `patrick` o `gary`.

`sanitizeCast` **scarta le voci sconosciute** (è la regola del piano 33: quello
che si legge dallo storage è input esterno). Quindi quelle configurazioni si
puliscono da sé, senza migrazione. Chi aveva solo l'inseguimento si ritrova il
cast vuoto; il default diventa `['pizza']` — Peppo, che è il personaggio
dell'app — e gli animaletti sono spenti di default, quindi nessuno se ne
accorge per sorpresa.

`MAX_CAST` scende da 21 a 19: è «quante voci ci sono», non un limite scelto.

## Le release già pubblicate

Dalla 1.1.0 alla 1.4.0 contengono i tre personaggi dentro `app.asar`. Gli
animaletti sono **spenti di default**, quindi per vederli bisogna accenderli
dalle impostazioni, ma il codice c'è. Da decidere a parte (non in questo
branch): lasciarle e far sparire i personaggi con la prossima versione, o
ritirare gli asset delle vecchie.

## Da chiarire col collega (non in questo branch)

`THIRD-PARTY-NOTICES.md` elenca i **componenti software** (le dipendenze npm) e
non dice niente dei disegni. Dei pacchetti di sprite non sappiamo scritto da
nessuna parte provenienza e licenza: se sono acquistati o CC0 va bene, ma va
annotato lì, perché finiscono dentro un programma distribuito. Da chiedere ad
Alessandro per i suoi, e da scrivere nelle note.

## Prove

- `npm run test:unit` verde: cadono i test dell'inseguimento (erano 8), restano
  quelli della medusa da sola, che diventano il caso normale.
- Un test verifica che nel catalogo non ci sia nessuno dei tre id e nessuna
  etichetta che li nomini: se qualcuno li rimette per sbaglio, diventa rosso.
- Smoke nell'app: pannello animaletti, le tre voci non ci sono più, la medusa
  da sola ondeggia e chiama.

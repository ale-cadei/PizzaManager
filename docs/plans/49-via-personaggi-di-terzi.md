# 49 — Via i personaggi di terzi dagli animaletti

Branch: `chore/via-personaggi-di-terzi`. Dipende dal 33 (animaletti).
Taglia: ~2h.

## Perché

Fra gli animaletti c'erano tre personaggi che non erano nostri: disegni e nomi
presi da un cartone animato. Quando il piano 33 li aggiunse, PizzaManager era
un programma che giravano in due su due computer.

Oggi non è più così: le release sono pubbliche e le scarica chiunque,
l'aggiornamento automatico le spinge, la licenza è proprietaria e il copyright
porta due nomi e cognomi veri. Un'app distribuita così non può contenere il
personaggio di qualcun altro — non è una questione di quanto è probabile che
qualcuno se ne accorga, è che non è roba nostra da distribuire.

Il piano 33 aveva già previsto l'uscita: «si tolgono le voci da
`pets-sprites.js`: il motore non dipende da nessun personaggio». Qui si fa.

## Cosa si toglie

Tre voci del catalogo e la voce di cast `inseguimento`, che ne legava due in
coppia. Il catalogo adesso è **chiuso** e un test lo verifica: per aggiungere
un personaggio bisogna dichiararlo anche lì, ed è quello il momento in cui ci
si ferma a chiedersi da dove viene il disegno.

## Cosa resta, e perché

- **La medusa** (`medusa`): è una medusa qualsiasi, nessun nome di personaggio,
  disegno fatto qui. Resta la sua voce di cast, che già esisteva e che già
  funzionava da sola (gironzola ondeggiando, chiama solo se non c'è nessun
  altro).
- **Tutti gli altri**: gatto, rana e uccellino sono pixel art fatta in questo
  repo; pizza, fizzo, rotolacampo, babbo, morte, zucca, fantasmino, ape,
  chiocciola, papera con anatroccoli, robottino, tazzina, pesce e trenino
  vengono dai pacchetti di sprite dell'utente (`pets-sprite-*.js`), fatti con
  Claude Design: roba nostra.

## Conseguenze nel motore

L'inseguimento era una **feature**, non un disegno: via la coppia se ne va
tutta la sua macchina in `renderer/pets.js`.

- `spawn` non ha più il caso speciale per la coppia, e `placePair` sparisce:
  nessun personaggio nasce accoppiato a un altro.
- `chase` e `flee` spariscono. Attenzione: `chase` leggeva la velocità del
  personaggio che inseguiva da `Sprites.SPRITES`, quindi lasciarla lì sarebbe
  stato codice morto che va in errore al primo uso.
- Il campo `mate` esce da `newPet` e da `step`, e con lui `lift`/`passing`:
  servivano solo al salto con cui la medusa scansava chi la rincorreva.
  `float` resta, perché l'ondeggio della medusa resta.
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
mai aperto il pannello degli animaletti ha quella voce salvata, e chi li ha
scelti a mano può avere anche gli altri due id.

`sanitizeCast` **scarta le voci sconosciute** (è la regola del piano 33: quello
che si legge dallo storage è input esterno). Quindi quelle configurazioni si
puliscono da sé, senza migrazione. Chi aveva solo l'inseguimento si ritrova il
cast vuoto; il default diventa `['pizza']` — Peppo, che è il personaggio
dell'app — e gli animaletti sono spenti di default, quindi nessuno se ne
accorge per sorpresa.

`MAX_CAST` scende da 21 a 18: è «quante voci ci sono», non un limite scelto.

## Le release già pubblicate

Dalla 1.1.0 alla 1.4.0 contengono i tre personaggi dentro `app.asar`. Gli
animaletti sono **spenti di default**, quindi per vederli bisogna accenderli
dalle impostazioni, ma il codice c'è.

**Gli asset si tolgono** (decisione dell'utente, 9 ottobre 2026). Fatto lo
stesso giorno per **1.1.0, 1.2.0, 1.2.1 e 1.3.0**: 48 file via, le release
restano con le loro note e il loro tag, ma non c'è più niente da scaricare.

La **1.4.0** si è aspettata, perché era la release corrente: è quella che la
pagina offre a chi arriva, ed è il suo `latest-mac.yml` che l'aggiornamento
automatico legge. Svuotarla prima avrebbe lasciato la pagina pubblica senza
niente da installare. Svuotata **subito dopo aver pubblicato la 1.5.0**: da
lì l'unica release con dei file è la 1.5.0, e quei personaggi non ci sono in
nessun pacchetto scaricabile.

Effetto collaterale, piccolo: `electron-updater` scarica la differenza fra due
versioni usando il `.blockmap` della vecchia. Senza quei file ricade sullo
scaricamento intero, che è quello che faceva comunque per chi salta più
versioni. I pacchetti sono rifacibili dai tag, se mai servissero.

## Da dove vengono gli altri disegni

Chiesto e risposto (utente, 9 ottobre 2026): **i pacchetti di sprite sono stati
fatti con Claude Design**, cioè generati qui. Non sono roba di terzi comprata o
scaricata, quindi non c'è nessuna licenza altrui da rispettare e niente da
elencare fra i componenti di terze parti.

`THIRD-PARTY-NOTICES.md` elenca i **componenti software** (le dipendenze npm) e
dei disegni non diceva niente: ora lo dice, perché quel file si apre dall'app
(`Aiuto → Note di terze parti`) e chi legge non deve chiedersi da dove vengano
i personaggi.

Scrivendola è saltato fuori che una riga secca («i disegni sono nostri») sarebbe
stata **falsa**: `build.files` impacchettava `assets/**/*`, e lì dentro ci sono
i logo di Docker, GitHub, Node.js e Python (`assets/shell-icons/`) più quelli di
Claude Code e Antigravity, da cui le icone nella pagina sono ricalcate
(`renderer/agent-icons.js`). Sono marchi di altri, usati per dire *quale*
strumento è quello — l'uso normale, che fa qualunque IDE — ma va dichiarato, e
adesso le note lo dicono. I due file che servivano solo come riferimento per
ricalcare non entrano più nel pacchetto.

## Prove

- `npm run test:unit` verde: cadono i test dell'inseguimento (erano 6), restano
  quelli della medusa da sola, che diventano il caso normale.
- Un test verifica che il catalogo sia **esattamente** quello dichiarato: se
  qualcuno aggiunge una voce senza passare di lì, diventa rosso.
- Smoke nell'app: pannello animaletti, le tre voci non ci sono più, la medusa
  da sola ondeggia e chiama.

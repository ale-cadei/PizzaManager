# 33 — Animaletti che camminano in fondo alla finestra

Branch: `feat/animaletti` · Dipende da: — · Taglia: ~1 g

## Obiettivo

Una striscia in fondo alla finestra dove camminano dei personaggi mentre si
lavora. Il pezzo forte è **il pescatore che rincorre una medusa con il retino**;
accanto, altri personaggi di quel cartone e qualche animale generico. I
personaggi reagiscono allo stato delle sessioni, così la striscia dice anche
qualcosa: corrono quando un agente lavora, dormono quando è tutto fermo, si
fermano e chiamano quando una sessione aspetta te.

Spento di default. Si accende e si regola da `Vista › Personaggi…`.

## Scelte

- **Dentro la finestra dell'app, non sul desktop.** Una finestra trasparente
  sempre in primo piano è fragile (compositor, Wayland, multi-monitor) e su
  Windows si comporta diversamente. La striscia è un `<div>` nel renderer.
- **La striscia non copre il terminale.** Quando è accesa occupa la sua
  altezza sotto l'area dei terminali, e il fit addon ricalcola righe e
  colonne. Ha `pointer-events: none` e `aria-hidden="true"`: non ruba click
  né lettori di schermo. Quando è spenta ha `display: none` e il ciclo di
  animazione non gira.
- **Motore in JS, logica pura separata dal DOM.** Le reazioni allo stato (e
  l'inseguimento) sono logica, non keyframes: con CSS puro non si potrebbero
  verificare da Node. Si divide in:
  - `renderer/pets.js` (UMD, come `running.js`): stato e `step()`, nessun DOM.
  - `renderer/pets-sprites.js` (UMD): i disegni, come dati.
  - `renderer/pets-view.js`: DOM e `requestAnimationFrame`.
  - `renderer/pets-ui.js`: il pannello delle impostazioni.
- **Pixel art disegnata qui, in SVG costruito con `createElementNS`.** Niente
  file esterni, niente `innerHTML`, niente domini nuovi: la CSP non cambia.
  Ogni sprite è una griglia di caratteri + palette (`'..yy..'`, `{ y: '#f7e03c' }`)
  convertita in `<rect>`: si legge e si modifica a mano, e un test verifica
  che ogni riga abbia la stessa larghezza e ogni carattere un colore.
- **Impostazioni in `localStorage`**, come `term-font.js` e `type-colors.js`:
  sono preferenze di UI, non dati da far sopravvivere fuori dall'app. Il
  valore letto è input esterno: si valida e, se non torna, si usa il default.
- **Altezza: un pixel del disegno vale `size / GRID` (16 righe)**, così i
  piccoli restano piccoli; chi ha più righe si rimpicciolisce per stare in
  `size`. Un disegno può fissare `height` (frazione di `size`) per le
  proporzioni: medusa 0.5 e rana 0.4 (`Sprites.pixel`).
- **Aspetti a sorte (`variants`)**: un disegno può elencare palette
  alternative, solo con i colori che cambiano; `Sprites.paletteOf(kind, i)`
  le fonde con quella di base. Il motore tira `pet.variant` alla nascita
  (`newPet`), la vista costruisce i rettangoli con quella palette: stesso
  disegno, colori diversi, e due pesci in scena non sono per forza uguali.
  Per ora uccellino e pesce.
- **Pausa sempre, non opzione**: con la finestra nascosta o senza fuoco il
  ciclo si ferma (`visibilitychange`, `blur`/`focus`). Con
  `prefers-reduced-motion: reduce` i personaggi stanno fermi al loro posto.

## Personaggi

| id | Nome | Cosa fa |
|----|------|---------|
| `pescatore` | il pescatore | Rincorre la medusa col retino alzato; quando è vicino dà un colpo di retino (frame `swing`) e la manca sempre |
| `medusa` | Medusa | Galleggia ondeggiando (seno sulla y); quando il pescatore è vicino scatta via. Anche da sola, come voce `medusa`: gironzola e chiama solo se non c'è nessun altro |
| `stella` | Stella | Cammina piano |
| `lumaca` | Lumaca | Lumaca: lentissimo |
| `gatto` | Gatto | Cammina |
| `pizza` | Peppo, la pizza | Fetta con gambine, dal pacchetto «Sprite pixel-art originale» dell'utente |
| `rana` | Rana | Salta (`motion: 'hop'`): avanza solo in aria, posa `jump` |
| `uccellino` | Uccellino | Vola sopra la striscia (`fly`); per dormire o chiamare si posa. Azzurro, pettirosso, canarino o cardinale, a sorte |
| `pesce` | Pesce | Nuota ondeggiando appena sopra il fondo (`swim`), chiama soffiando bolle (un disegno a parte davanti alla bocca); dal pacchetto «Spritelli». Azzurro, arancio, verde o rosa, a sorte |
| `fizzo` | Fizzo, la bibita | Bicchiere con cannuccia, dal pacchetto |
| `rotolacampo` | Rotolacampo | Rotola (12 frame); quando chiama rimbalza |
| `babbo` | Babbo Natale | Slitta con le renne, vola (`fly`); dal pacchetto |
| `morte` | La Morte | Fluttua appena sopra il fondo (`swim`); quando chiama dà una falciata (8 frame) |
| `zucca` | Zucco, la zucca | Cammina; dal pacchetto di Halloween |
| `fantasmino` | Fantasmino | Vola (`fly`) col lenzuolo; dorme abbassandosi, fa «buu» quando chiama |
| `ape` | Ape | Vola (`fly`); ha un fiore suo in un punto della striscia, e ci vola sopra per dormire e per chiamare |
| `chiocciola` | Chiocciola | Lentissima; dorme chiusa nel guscio, chiama dondolando le antenne |
| `papera` | Papera e anatroccoli | La papera gironzola, i due anatroccoli (`anatroccolo`) le vanno dietro in fila; chiama facendo qua qua |
| `robottino` | Robottino | Cammina con l'antenna che lampeggia; chiama con lo schermo giallo |
| `tazzina` | Tazzina di caffè | Saltella come la rana (`hop`, posa `jump`) fumando; da fredda dorme |

Rana, uccellino e pesce aggiunti su richiesta dell'utente dopo il primo
giro. Pizza, Fizzo, Rotolacampo e Babbo Natale vengono dal pacchetto
«Sprite pixel-art originale» dell'utente, La Morte e Zucco dall'«Halloween
Pack», il Fantasmino dal pacchetto «Fantasmino Lenzuolo» (rifatto col
lenzuolo al posto di quello dell'Halloween Pack). Ape, chiocciola, papera
con anatroccoli, robottino, tazzina e il pesce (al posto di quello
disegnato a mano) dal pacchetto «Spritelli», che ha un formato suo:
fotogrammi con un nome in `<cartella>-sheet.json`, senza animazioni. Le
pose mancanti (sonno della papera, richiamo col becco aperto…) sono
fotogrammi derivati nel generatore: righe ritoccate e altri fotogrammi
sovrapposti.

**Disegni a parte**: come l'ombra del fantasmino, stanno fuori dal div del
personaggio (così non si specchiano né saltellano con lui) e li disegna la
vista. `perch` è il posatoio: il fiore dell'ape, una griglia ferma a terra e
`seat`, l'altezza in righe a cui si siede. Il motore le dà alla nascita un
punto, `home`, che rientra nei bordi come la x; per dormire o chiamare ci
vola sopra con la posa del volo e poi si siede a `seat` pixel del disegno.
`bubbles` sono le bolle del pesce: griglie alte quanto lui, davanti alla
bocca (dalla parte in cui guarda) e alla sua quota, una dopo l'altra, solo
in posa `call`; al bordo, se dall'altra parte c'è più posto, il pesce si
gira per chiamare, così le bolle non escono dalla striscia. Nel generatore sono la voce facoltativa `layers` in fondo a
una riga di `SPRITELLI`.

Ogni pacchetto
porta PNG 1x e un `data.json` con le animazioni: un file generato per
personaggio, `renderer/pets-sprite-*.js`, caricato prima di
`pets-sprites.js` che li fonde nel catalogo. Le pose: `cammina`/`fluttua`/`insegui-dx`
→ walk, `blink`/`occhi spenti`/`dorme` → sleep, `felice`/`falciata`/`buu` → call. Il modo di muoversi è un campo del disegno (`motion`), e il motore
ha una funzione per ognuno (`MOVES` in `pets.js`).

**La coppia pescatore + medusa** si sceglie come una voce sola, «il pescatore
e la medusa» (`inseguimento`): sono due personaggi legati. Il pescatore non ha
una direzione sua: punta la medusa e tiene una distanza minima. La medusa
fugge verso il lato con più spazio; messa all'angolo si alza e gli passa
sopra. Il retino non la prende mai.

**In fila**: una voce con più personaggi che non sia l'inseguimento
(`papera` = papera + due anatroccoli) nasce in fila. Ognuno ha un `lead`,
quello davanti, e gli sta a `LINE_GAP` misure dietro rispetto al verso in
cui va, recuperando più svelto (`CATCH_UP`); arrivato si ferma, guarda
dove guarda lui e non zampetta sul posto. Quando la papera si gira e se
li trova davanti, gli anatroccoli non le passano attraverso: la aspettano
guardandola e, passata, le vanno dietro. Chi segue non chiama mai: tocca
al primo.

Frame per personaggio: `walk` (2 frame; il pescatore 4, con il corpo che sale
fra un passo e l'altro), `sleep`, `call`. Il pescatore ha anche `swing`, la
medusa `flee`. Le «z» di chi dorme e il saltello di chi
chiama sono CSS sulla classe della posa, non frame in più.

**Pose opzionali** (`OPTIONAL_POSES`): i pacchetti ne portano altre, e il
motore le usa solo per chi le ha; chi non le ha fa come prima. Sono
*azioni* (`pet.act`): il personaggio sta fermo con quella posa per la durata
della sequenza (o della pausa), poi torna a camminare.

| posa | quando | chi |
|------|--------|-----|
| `idle` | a passeggio, a caso (`PAUSE_PER_S`), per 1,5–3,5 s | Peppo, Fizzo, Zucco, la Morte, Fantasmino |
| `turn` | cambio di verso (rimbalzo al bordo o a caso) | Fantasmino |
| `startle` | l'umore passa a `busy` | Peppo, Fizzo, Zucco, Fantasmino |
| `laugh` | finisce l'`attention` durante la quale chiamava | Fantasmino |
| `sad` | chiama da più di `SAD_AFTER_MS` (1 min), al posto di `call` | Fantasmino |
| `appear` | entra in scena (accensione o aggiunto al cast) | Fantasmino |
| `vanish` | esce dal cast; finita la sequenza il motore lo toglie | Fantasmino |

Il sonno interrompe ogni azione tranne lo svanire. Un'azione in corso non
viene scavalcata da un'altra (niente spavento mentre ride).

**Ombra a terra**: un disegno può avere `shadow`, una lista di griglie (una
per frame di `walk`) fuori da `frames`, perché ha un'altra misura. La vista
la disegna in un `<div class="pet-shadow">` a parte, a terra e centrato
sotto il personaggio, nascosto quando lui si posa (`y === 0`). Solo il
Fantasmino, per ora.

**Cambio di cast a striscia accesa** (`recast`): chi resta continua da
dov'è, chi esce svanisce (o sparisce subito, se non sa svanire), chi entra
appare. Le chiavi vengono da un contatore (`state.seq`), non dall'indice nel
cast, così chi svanisce e chi arriva non si confondono. Cambiare misura
ricostruisce tutto.

I file `pets-sprite-*.js` li genera `scripts/pets-pack.py` dai pacchetti
(PIL): lì stanno le pose scelte per ogni personaggio, l'ombra e i colori
ritoccati. Si ritocca quello, non i file generati.

## Stati

Il motore riceve un `mood` calcolato da chi lo chiama con i segnali che ci
sono già:

| mood | Quando | Effetto |
|------|--------|---------|
| `busy` | almeno una sessione in esecuzione (`running.js`) | velocità ×2, inseguimento più stretto |
| `idle` | nessuna in esecuzione | velocità base |
| `sleep` | `idle` da più di `SLEEP_AFTER_MS` (5 min) | frame `sleep`, fermi; la medusa resta sospesa |
| `attention` | una sessione aspetta te (`attention.js`) | il personaggio più vicino al centro si ferma e fa `call`; gli altri continuano |

Precedenza: `attention` > `busy` > `sleep` > `idle`.

## Impostazioni

```js
{
  enabled: false,
  cast: ['inseguimento'],  // id dal catalogo, ripetibili; massimo MAX_CAST
  size: 'm',               // 's' | 'm' | 'l'  → 24 / 32 / 48 px
  speed: 'normale',        // 'lenta' | 'normale' | 'veloce'
}
```

- `MAX_CAST = 20` voci del dialogo, una per ognuna; la coppia pescatore e medusa è una voce, la papera con gli anatroccoli pure
  (contarla due impediva di sceglierne una di ognuna).
- Voci sconosciute scartate, valori fuori elenco → default, JSON rotto →
  default intero.

Pannello `Vista › Personaggi…` (voce di menu `menu-pets`, come `Colori…`):
interruttore, per ogni personaggio un contatore `– n +` con anteprima,
dimensione, velocità. Le modifiche si vedono subito nella striscia.

## API di `pets.js`

```js
createPets({ cast, width, random })  // → stato iniziale, posizioni sparse
recast(state, { cast, width, random }) // → stesso stato con chi entra ed esce
step(state, { dt, width, mood, speed }) // → stato nuovo, non muta l'input
sanitizeConfig(raw)                  // → config valida
moodOf({ running, attention, idleMs }) // → 'busy' | 'idle' | 'sleep' | 'attention'
```

`random` iniettato: i test sono deterministici. `width` cambia al resize e
nessuno deve restare fuori dalla striscia.

## Test

- `tests/pets.test.js`:
  - `step` non muta lo stato ricevuto; nessuno esce da `[0, width]`,
    anche quando la larghezza si restringe.
  - `busy` raddoppia lo spostamento rispetto a `idle` a parità di `dt`.
  - `sleep` ferma tutti; `attention` ferma solo il più vicino al centro e
    gli dà il frame `call`.
  - Inseguimento: Il pescatore si muove sempre verso la medusa; sotto la
    distanza minima fa `swing` e la medusa passa a `flee`; dopo N passi
    simulati la distanza non va mai a zero.
  - `moodOf`: tabella di precedenza.
  - Pose opzionali: pausa solo per chi ha `idle`, `turn` al bordo, spavento
    una volta sola al passaggio a `busy`, risata a fine attesa, tristezza
    dopo `SAD_AFTER_MS`, entrata con `appear`, `recast` che fa svanire e
    poi toglie.
  - `sanitizeConfig`: JSON rotto, voci sconosciute, più di `MAX_CAST`,
    `size`/`speed` fuori elenco.
- `tests/pets-sprites.test.js`: ogni sprite ha righe della stessa
  larghezza, ogni carattere ha un colore in palette, ogni personaggio ha i
  frame richiesti dai suoi stati.
- `tests/renderer-load.test.js`: i nuovi script caricano nell'ordine di
  `index.html`.
- Smoke test nell'app: accendere, sessione `claude` al lavoro → corrono,
  sessione che chiede conferma → uno chiama, finestra senza fuoco → fermi
  (0% CPU da DevTools › Performance).

## Fatto

- `renderer/pets-sprites.js` (disegni), `pets-config.js` (impostazioni in
  localStorage), `pets.js` (motore, inseguimento, umori), `pets-view.js`
  (striscia e ciclo rAF), `pets-ui.js` (dialogo), stili in `styles.css`.
- Voce «Personaggi…» nel menu View, nativo e in-app (`menu-pets`).
- Rana, uccellino e pesce, con `motion` per disegno.
- Test: `tests/pets-*.test.js`, compreso il retino che in 20 000 passi non
  prende mai la medusa.
- Provato in Electron (xvfb, dati e socket tmux in una tmpdir): la striscia
  compare sotto il terminale, i personaggi camminano, il dialogo si apre e
  ridisegna mentre si sceglie. Da provare a mano: corsa con un agente al
  lavoro, chiamata con una sessione in attesa, fermi senza fuoco.

## Fuori da questo branch

- Personaggi cliccabili, uno per sessione, pacchetti di sprite caricati da
  file, animali sul desktop fuori dalla finestra.

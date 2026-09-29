# 33 — Animaletti che camminano in fondo alla finestra

Branch: `feat/animaletti` · Dipende da: — · Taglia: ~1 g

## Obiettivo

Una striscia in fondo alla finestra dove camminano dei personaggi mentre si
lavora. Il pezzo forte è **SpongeBob che rincorre una medusa con il retino**;
accanto, altri personaggi di Bikini Bottom e qualche animale generico. I
personaggi reagiscono allo stato delle sessioni, così la striscia dice anche
qualcosa: corrono quando un agente lavora, dormono quando è tutto fermo, si
fermano e chiamano quando una sessione aspetta te.

Spento di default. Si accende e si regola da `Vista › Animaletti…`.

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
- **Personaggi di SpongeBob riconoscibili, con i loro nomi.** Decisione
  dell'utente (2026-09-29), sapendo che sono personaggi e marchi di
  Nickelodeon/Paramount e che il repo è pubblico con release: il rischio di
  una segnalazione DMCA è accettato. SpongeBob è ricopiato da uno sprite GBA
  ritoccato da un fan (gianlucarugergr, DeviantArt), scelta dell'utente; gli
  altri sono pixel art originale fatta qui. Se arriva una segnalazione, si
  tolgono le voci da `pets-sprites.js`: il motore non dipende da nessun
  personaggio.
- **Impostazioni in `localStorage`**, come `term-font.js` e `type-colors.js`:
  sono preferenze di UI, non dati da far sopravvivere fuori dall'app. Il
  valore letto è input esterno: si valida e, se non torna, si usa il default.
- **Altezza: un pixel del disegno vale `size / GRID` (16 righe)**, così i
  piccoli restano piccoli; chi ha più righe si rimpicciolisce per stare in
  `size`. Un disegno può fissare `height` (frazione di `size`) per le
  proporzioni: medusa 0.5 e rana 0.4 (`Sprites.pixel`).
- **Pausa sempre, non opzione**: con la finestra nascosta o senza fuoco il
  ciclo si ferma (`visibilitychange`, `blur`/`focus`). Con
  `prefers-reduced-motion: reduce` i personaggi stanno fermi al loro posto.

## Personaggi

| id | Nome | Cosa fa |
|----|------|---------|
| `spongebob` | SpongeBob | Rincorre la medusa col retino alzato; quando è vicino dà un colpo di retino (frame `swing`) e la manca sempre |
| `medusa` | Medusa | Galleggia ondeggiando (seno sulla y); quando SpongeBob è vicino scatta via |
| `patrick` | Patrick | Cammina piano |
| `gary` | Gary | Lumaca: lentissimo |
| `gatto` | Gatto | Cammina |
| `pizza` | Fetta di pizza | Fetta con gambine (riusa la palette di `pizza-slice.js`) |
| `rana` | Rana | Salta (`motion: 'hop'`): avanza solo in aria, posa `jump` |
| `uccellino` | Uccellino | Vola sopra la striscia (`fly`); per dormire o chiamare si posa |
| `pesce` | Pesce | Nuota ondeggiando appena sopra il fondo (`swim`) |

Rana, uccellino e pesce aggiunti su richiesta dell'utente dopo il primo
giro. Il modo di muoversi è un campo del disegno (`motion`), e il motore
ha una funzione per ognuno (`MOVES` in `pets.js`).

**La coppia SpongeBob + medusa** si sceglie come una voce sola, «SpongeBob
e la medusa» (`inseguimento`): sono due personaggi legati. SpongeBob non ha
una direzione sua: punta la medusa e tiene una distanza minima. La medusa
fugge verso il lato con più spazio; messa all'angolo si alza e gli passa
sopra. Il retino non la prende mai.

Frame per personaggio: `walk` (2 frame; SpongeBob 4, con il corpo che sale
fra un passo e l'altro), `sleep`, `call`. SpongeBob ha anche `swing`, la
medusa `flee`. Le «z» di chi dorme e il saltello di chi
chiama sono CSS sulla classe della posa, non frame in più.

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

- `MAX_CAST = 8` voci del dialogo, una per ognuna; la coppia SpongeBob e medusa è una voce
  (contarla due impediva di sceglierne una di ognuna).
- Voci sconosciute scartate, valori fuori elenco → default, JSON rotto →
  default intero.

Pannello `Vista › Animaletti…` (voce di menu `menu-pets`, come `Colori…`):
interruttore, per ogni personaggio un contatore `– n +` con anteprima,
dimensione, velocità. Le modifiche si vedono subito nella striscia.

## API di `pets.js`

```js
createPets({ cast, width, random })  // → stato iniziale, posizioni sparse
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
  - Inseguimento: SpongeBob si muove sempre verso la medusa; sotto la
    distanza minima fa `swing` e la medusa passa a `flee`; dopo N passi
    simulati la distanza non va mai a zero.
  - `moodOf`: tabella di precedenza.
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
- Voce «Animaletti…» nel menu View, nativo e in-app (`menu-pets`).
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

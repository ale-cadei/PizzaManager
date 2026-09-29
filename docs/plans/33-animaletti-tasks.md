# 33 — Animaletti: task

Piano: [33-animaletti.md](33-animaletti.md). Branch `feat/animaletti`.

Test: `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"; npm run test:unit`
(il node di sistema è v12 e non conosce `--test`).

## Vincoli comuni

- Moduli UMD come `running.js`: globale nella pagina, `module.exports` sotto Node.
- Niente `innerHTML` con dati; SVG con `createElementNS`. CSP invariata.
- Stato immutabile: `step()` restituisce oggetti nuovi, non tocca l'input.
- `localStorage` si legge in `try`, un valore rotto torna al default.

## File

| File | Cosa fa |
|------|---------|
| `renderer/pets-sprites.js` | Disegni (griglie + palette), catalogo del cast, `toRects()` |
| `renderer/pets-config.js` | `sanitizeConfig`, `createPetsStore`, conteggio del cast |
| `renderer/pets.js` | `createPets`, `step`, `moodOf`: movimento, inseguimento, stati |
| `renderer/pets-view.js` | DOM della striscia, ciclo `requestAnimationFrame`, pausa |
| `renderer/pets-ui.js` | Dialogo «Animaletti» |
| `index.html`, `styles.css`, `menu-actions.js`, `renderer.js`, `app-state.js`, `app/menu.js`, `preload.js` | Cablaggio |

## Task 1 — Disegni (`pets-sprites.js`)

Interfacce prodotte:
- `SPRITES: Record<kind, { palette: Record<char,string>, speed: number, frames: Record<pose, string[][]> }>`
  — kind: `spongebob medusa patrick gary gatto pizza`; ogni frame è un array di righe.
- `REQUIRED_POSES = ['walk', 'sleep', 'call']`; `spongebob` ha anche `swing`, `medusa` anche `flee`.
- `CAST: Record<castId, kind[]>` — `inseguimento: ['spongebob','medusa']`, gli altri a un elemento.
- `CAST_LABELS: Record<castId, string>`.
- `GRID = 16`: righe di riferimento, un pixel vale `size / GRID`.
- `toRects(rows, palette) → {x,y,w,fill}[]`: pixel uguali contigui sulla riga fusi in un rettangolo.

Test (`tests/pets-sprites.test.js`): righe di un frame tutte della stessa
larghezza e frame di un personaggio tutti delle stesse dimensioni; ogni
carattere diverso da `.` è in palette; pose richieste presenti; `walk` ha
almeno 2 frame; ogni kind del cast esiste; `toRects` fonde e salta `.`.

## Task 2 — Impostazioni (`pets-config.js`)

- `DEFAULTS = { enabled:false, cast:['inseguimento'], size:'m', speed:'normale' }`
- `SIZES = { s:24, m:32, l:48 }`, `SPEEDS = { lenta:0.5, normale:1, veloce:1.8 }`, `MAX_PETS = 5`
- `castCount(cast) → number` (la coppia conta 2)
- `sanitizeConfig(raw) → config` — accetta oggetto o stringa JSON
- `createPetsStore(storage) → { get(), save(cfg) → cfg }`, chiave `aisess.pets`

Test: JSON rotto → default; voci sconosciute scartate; oltre `MAX_PETS` si
tronca dalla fine; size/speed fuori elenco → default; `enabled` solo
booleano; store salva e rilegge, e sopravvive a uno storage che lancia.

## Task 3 — Motore (`pets.js`)

- `createPets({ cast, width, size, random }) → state` —
  `state = { size, pets: [{ key, kind, x, y, dir, pose, anim, lift, passing }] }`
- `step(state, { dt, width, mood, speed, random }) → state` — `dt` in ms,
  limitato a `MAX_DT`.
- `moodOf({ running, attention, idleMs }) → 'attention'|'busy'|'sleep'|'idle'`
- `SLEEP_AFTER_MS = 300000`, `FRAME_MS`, `frameIndex(pet, n)`.

Regole: bordi `[0, width - larghezza del pet]` con rimbalzo; `busy` ×2;
`sleep` fermi in posa `sleep`; `attention` → il pet non-medusa più vicino
al centro in posa `call`, gli altri come `idle`. Inseguimento: SpongeBob
punta la medusa, sotto `SWING_DIST` posa `swing`; la medusa sotto
`FLEE_DIST` posa `flee` e scappa più veloce di lui, verso il lato con
spazio; se non c'è, si alza (`lift`) e gli passa sopra.

Test: `step` non muta; bordi rispettati anche quando la larghezza cala;
`busy` sposta il doppio di `idle`; `sleep`; `attention`; SpongeBob verso la
medusa; `swing`/`flee`; su 3000 passi simulati la medusa non è mai sotto il
retino (distanza < metà misura) senza essere sollevata; `moodOf` precedenze.

## Task 4 — Vista (`pets-view.js`)

- `createPetsView({ doc, win, strip, signals, now, raf, caf, reducedMotion }) → { apply(config), pause(), resume(), isRunning() }`
- `signals() → { running: boolean, attention: boolean }`
- Un `<svg>` per pet, un `<g>` per frame (si accende quello giusto), classi
  `pet`, `pet--<pose>`, `pet--left`. `apply` con `enabled:false` svuota e
  nasconde la striscia e ferma il ciclo. Pausa su `blur`/`visibilitychange`.

Test con un DOM finto (`tests/pets-view.test.js`): `apply` crea un svg per
pet; spento → striscia nascosta e niente `raf`; `pause`/`resume`;
`reducedMotion` → disegna e non avvia il ciclo; un tick con `running`
cambia la posa/posizione.

## Task 5 — Dialogo e cablaggio

- `pets-ui.js`: `createPetsDialog({ doc, backdrop, body, saveBtn, cancelBtn, store, onChange })`
  — anteprima dal vivo via `onChange(draft)`, Annulla/Esc rimette il salvato.
- Menu: `View › Personaggi…` nativo (`menu-pets`) e in-app (`data-action="pets"`),
  `runMenuAction` case `pets`, allowlist del preload.
- `#pets-strip` fra `#terminals` e `.bottombar`; modal `#modal-pets`.
- Script in `index.html` prima di `app-state.js`, nell'ordine
  sprites → config → pets → view → ui.

Test: dialogo (contatori, limite, annulla); `renderer-load` verde;
`wiring` (voce di menu e canale nel preload).

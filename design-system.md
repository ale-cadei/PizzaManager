# AISessionManager — design system

Palette **Teal notturno**: fondo nero, azione teal, accento corallo.

## Colori

| Ruolo | Hex | Uso |
| --- | --- | --- |
| base | `#000000` | sfondo app e area terminale |
| pannello | `#0B0A0E` | sidebar, modali, card |
| riga | `#111017` | elementi di elenco |
| elevato | `#151220` | elemento selezionato |
| bordo | `#1E1A24` | separatori, bordo card |
| bordo forte | `#2A2434` | input, pulsanti secondari |
| azione | `#1FA79A` | pulsanti primari, focus, selezione |
| azione hover | `#31C3B4` | hover del pieno |
| azione tenue | `#0E2E2B` | fondo di tab e chip attivi |
| testo azione | `#5FD8CB` | testo e bordi teal su nero |
| inchiostro azione | `#02201D` | testo sopra il teal pieno (5.8:1) |
| accento | `#FF8A6B` | badge runtime, sessione attiva, link |
| stato ok | `#5BC78F` | sessione in esecuzione |
| errore | `#E8556E` | errori, chiusura distruttiva |
| testo | `#F2EFF4` / `#A79FB0` / `#7C7488` | primario / secondario / terziario |

Regole: un solo pulsante pieno per schermata; l'accento non si usa mai per le azioni; il verde significa solo "in esecuzione".

## Tipografia

- **IBM Plex Sans** — interfaccia. 19/600 titoli modale, 15/600 titoli, 13/500-600 controlli, 12/500 etichette campo.
- **IBM Plex Mono** — percorsi, id, comandi, log, etichette di sezione (10-11px, letter-spacing .12em, maiuscolo).

## Forma e spazio

Raggi 8 / 10 / 14 / 16 px. Gap 6 / 8 / 12 / 20 px. Padding modale 26px, card 20-22px, pulsanti 11×20px. Ombra modale `0 24px 60px rgba(0,0,0,.6)`.

## Componenti

- **Pulsante**: primario (pieno teal, inchiostro scuro), outline (bordo teal, si riempie in hover), secondario (superficie elevata), ghost (solo bordo neutro).
- **Input**: fondo nero, bordo `#2A2434`, mono 13px, bordo teal in focus.
- **Card sessione**: fondo elevato, bordo teal, barra corallo a sinistra, badge runtime, path troncato a sinistra.
- **Tab**: gruppo su fondo nero con padding 5px; attivo su `#0E2E2B` con bordo teal.
- **Path**: contenitore `direction:rtl` + figlio `direction:ltr` per troncare a sinistra senza slash finale spurio.

I token pronti all'uso sono in `aisessionmanager-tokens.css`.

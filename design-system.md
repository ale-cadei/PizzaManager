# PizzaManager — design system

Palette **Forno**: neri caldi, azione pomodoro, accento crosta.

Le superfici non sono grigi neutri ma neri virati al rosso: sotto un testo caldo
(`#F6F1EC`) un grigio neutro sembrerebbe sporco di blu. Il pomodoro è l'unico
colore che comanda un'azione; la crosta conta e segnala, non agisce.

## Colori

| Ruolo | Hex | Uso |
| --- | --- | --- |
| base | `#070505` | sfondo app e area terminale |
| pannello | `#0E0B0A` | sidebar, modali, card |
| riga | `#151010` | elementi di elenco |
| elevato | `#1C1513` | elemento selezionato |
| separatore | `#1A1412` | linee *dentro* un pannello (fasce della sidebar) |
| bordo | `#251C19` | bordo card, separazione fra pannelli |
| bordo forte | `#35271F` | input, pulsanti secondari |
| azione | `#F04E23` | pulsanti primari, focus, selezione |
| azione hover | `#FF6A3D` | hover del pieno |
| azione tenue | `#2B120A` | fondo di tab e chip attivi |
| testo azione | `#FF9B6F` | testo e bordi d'azione su nero |
| inchiostro azione | `#1A0A05` | testo sopra il pieno pomodoro (5.3:1) |
| accento | `#F2C14E` | badge runtime, contatore sessioni, sessione attiva |
| accento tenue | `#2A1F0C` | fondo dei badge |
| stato ok | `#7FC45A` | sessione in esecuzione (basilico) |
| errore | `#FF4D74` | errori, chiusura distruttiva |
| testo | `#F6F1EC` / `#D9CDC6` / `#B8A79E` / `#9A8A82` / `#8A7A72` | primario → sfumato |

Ogni accoppiata testo/fondo passa WCAG AA (la più bassa è `#8A7A72` su `#0E0B0A`,
4.77:1).

Regole: un solo pulsante pieno per schermata (riservato alla conferma nei
modali); l'accento non si usa mai per le azioni; il verde significa solo "in
esecuzione".

### Identità per tipo di sessione

`shell #F2C14E`, `opencode #FF8A4C`, `claude #C39BF5`, `codex #9AA7B8`,
`antigravity #4F8DF5`. Colorano la barra della card, il marker di selezione e la
legenda a piè di sidebar. Il verde è riservato a "in esecuzione", quindi codex
prende il grigio-blu. Distinti dai colori di marchio (`--brand-*`), che valgono
solo per le icone degli agenti e non seguono la palette.

## Logo

Pizza intera con una fetta sollevata — "sessioni AI, una fetta alla volta". Il
buco che la fetta lascia è una **maschera**, non un settore ridipinto di nero:
così il logo funziona su qualsiasi superficie. Cornicione `#E7A33C`, formaggio
`#F5C45A`, salame `#E2412A`, basilico `#7FC45A`; sono colori fissi, non token,
perché il logo deve restare sé stesso anche dentro un modale.

Tre incarnazioni dello stesso disegno: `renderer/pizza-logo.js` (SVG, sidebar),
`renderer/pizza-slice.js` (la fetta che apre e chiude i gruppi) e
`assets/generate-icon.py` (le PNG di sistema, con il bordo `--action`).

## Tipografia

- **IBM Plex Sans** — interfaccia. 23/600 titoli modale, 19/700 wordmark,
  13/500-600 controlli, 12/500 etichette campo.
- **IBM Plex Mono** — percorsi, id, comandi, log, stato dipendenze ed etichette
  di sezione (10-12px, letter-spacing .14em, maiuscolo).

## Forma e spazio

Raggi 6 (controlli, card, chip, badge) / 8 (pannelli) / 10 (modali) px. Gap 6 /
8 / 12 / 20 px. Padding modale 36px, pulsanti 11×20px. Ombra modale
`0 24px 60px rgba(0,0,0,.6)`.

## Componenti

- **Pulsante**: primario (pieno pomodoro, inchiostro scuro), outline (bordo
  pomodoro, si riempie in hover), secondario (superficie elevata), ghost (bordo
  neutro che diventa pomodoro in hover).
- **Input**: fondo nero, bordo `#35271F`, mono 13-14px, bordo pomodoro in focus.
- **Card sessione**: fondo elevato, bordo pomodoro, barra del tipo a sinistra,
  badge runtime in crosta, path troncato a sinistra.
- **Tab**: gruppo su fondo nero con padding 5px; attivo su `#2B120A` con bordo
  pomodoro.
- **Sidebar**: 300px, divisa in fasce (marchio, azioni, filtri, elenco, piede)
  separate da linee `--divider` che corrono da bordo a bordo — il padding lo
  porta ogni fascia, non il contenitore. Dal terminale la separa una riga
  pomodoro di 2px smorzata al 45% (`#702612` sul fondo), che è anche la maniglia
  di ridimensionamento: in hover si accende e si allarga ai 6px della presa.
- **Area terminale**: senza cornice. Il riquadro lo fa già la sidebar e un bordo
  attorno al testo ruberebbe colonne alle righe lunghe.
- **Path**: contenitore `direction:rtl` + figlio `direction:ltr` per troncare a
  sinistra senza slash finale spurio.

I token pronti all'uso sono in `aisessionmanager-tokens.css`.

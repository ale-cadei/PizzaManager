# 10 — Branding pizza (`feat/pizza-branding`)

Branch di sola immagine: l'app cambia nome e vestito, il comportamento no.

## Cosa cambia

1. **Icona**: `assets/generate-icon.py` disegna una pizza tagliata in 8 spicchi,
   ciascuno scostato radialmente cosi' che i tagli restino leggibili anche a
   16x16. Fondo `--bg` e bordo `--action` della palette Forno (vedi punto 4);
   cornicione, formaggio e salame sono gli stessi degli SVG del renderer. Le PNG
   in `assets/icon.png` e `assets/icons/NxN.png` sono rigenerate dallo script.

   *Dopo:* lo script disegna invece il logo della sidebar (punto 4) — pizza
   intera con la fetta sollevata — perché icona di sistema e logo in finestra
   devono essere la stessa immagine. Gli 8 spicchi erano un secondo marchio.
2. **Nome**: `AISessionManager` → `PizzaManager` in tutto ciò che l'utente
   legge (titolo finestra, sidebar, menu Help, `productName` e voce `.desktop`)
   e nei titoli dei documenti.
3. **Glifo di collasso dei gruppi**: le freccine `▸`/`▾` diventano una fetta di
   pizza (`renderer/pizza-slice.js`). Il tracciato punta a destra e la CSS lo
   ruota di 90° quando `aria-expanded="true"`: un solo glifo, il verso lo dà lo
   stato ARIA dell'header.
4. **Palette**: da *Teal notturno* a **Forno** (`renderer/tokens.css`, rispecchiato
   in `aisessionmanager-tokens.css`, documentato in `design-system.md`). Il teal
   era l'ultimo residuo del vestito precedente: con una pizza nell'icona, un
   azzurro-verde per le azioni faceva a pugni con tutto il resto. Ora le
   superfici sono neri virati al caldo, l'azione è pomodoro `#F04E23` e l'accento
   è la crosta `#F2C14E`. Tutte le coppie testo/fondo sono state verificate a
   WCAG AA (la più bassa è 4.77:1).

   Nell'arrivarci sono cambiati anche:
   - **Logo**: `renderer/pizza-logo.js`, pizza intera con la fetta sollevata, SVG
     nella sidebar (nitido a ogni zoom della finestra, cosa che la PNG non è). Il
     buco è una `<mask>`, non un settore nero: così il logo regge su qualsiasi
     superficie, modali compresi.
   - **Sidebar**: 300px e divisa in fasce separate da `--divider` da bordo a
     bordo; il padding lo porta ogni fascia, non più il contenitore. Chi ha già
     usato l'app tiene la larghezza salvata in `aisess.sidebarW`: il nuovo
     default vale solo per le installazioni nuove.
   - **Terminale**: senza cornice. Il riquadro lo fa già la sidebar e un bordo
     attorno al testo ruberebbe colonne alle righe lunghe. Lo stacco fra i due
     pannelli lo fa una riga pomodoro di 2px, smorzata al 45% perché corre per
     tutta l'altezza della finestra, che coincide con la maniglia di
     ridimensionamento: il bordo neutro spariva fra due neri vicini, e una linea
     in più accanto alla maniglia avrebbe raddoppiato i verticali. Il pomodoro
     pieno resta un segnale di interazione e torna in hover.

     La riga si fermava 33px prima del fondo: `#app` aveva l'altezza cablata a
     `calc(100vh - 33px)`, cioè la menubar in-app, che però su macOS è nascosta
     perché il SO disegna la sua. Ora `body` è una colonna e `#app` prende quel
     che resta, quindi non c'è più un'altezza da tenere in sync a mano.
   - **Verso della fetta**: nella prima stesura il tracciato aveva la punta a
     sinistra, così la rotazione di 90° la mandava in alto invece che in basso.
     Geometria specchiata: chiusa punta a destra, aperta in basso, come un
     chevron.
   - **xterm**: tema esplicito allineato ai token (`TERM_THEME` in
     `renderer/renderer.js`). Ciano e magenta restano i default di xterm: la
     palette Forno non ha un colore freddo da prestargli, e un "ciano" caldo
     finirebbe addosso al rosso.

## Cosa resta com'era, pur stonando un po'

Il pulsante **Nuova** della sidebar resta `btn--outline` anche se l'artboard lo
mostra pieno: la regola "un solo pulsante pieno per schermata" tiene il pieno
pomodoro per la conferma nei modali, ed è verificata da un test in
`tests/ui.test.js`. Fra la regola e l'artboard vince la regola.

## Cosa NON cambia (di proposito)

- `package.json` `name` resta `aisessionmanager`, e con lui `appId`,
  `homepage` e la directory del repo: cambiarli è una migrazione (dati in
  `userData`, URL del repository), non un ritocco grafico.
- Le chiavi in `localStorage` (`aisess.*`) e il socket tmux (`aisession`):
  rinominarle butterebbe via le preferenze e scollegherebbe le sessioni vive.
- I piani precedenti in `docs/plans/`: sono il registro di cosa è successo,
  non documentazione dell'app.

## Verifica

- `npm run test:unit` verde (nuovi `tests/sidebar-chevron.test.js`: la fetta
  finisce nell'header e lo stato aperto/chiuso resta sull'attributo ARIA;
  `tests/pizza-logo.test.js`: due logi nella stessa pagina non condividono l'id
  della maschera, che è l'unico modo in cui quell'SVG può rompersi).
- `python3 assets/generate-icon.py` rigenera il set completo.
- Smoke test dell'app: nome e logo in sidebar, titolo, fetta che ruota aprendo e
  chiudendo un gruppo, terminale senza cornice, nessun teal rimasto a schermo.

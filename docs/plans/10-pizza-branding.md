# 10 — Branding pizza (`feat/pizza-branding`)

Branch di sola immagine: l'app cambia nome e vestito, il comportamento no.

## Cosa cambia

1. **Icona**: `assets/generate-icon.py` disegna una pizza tagliata in 8 spicchi,
   ciascuno scostato radialmente cosi' che i tagli restino leggibili anche a
   16x16. Restano il fondo scuro e il bordo teal dell'icona precedente, cosi'
   l'app resta riconoscibile nel dock; il salame usa `--accent`. Le PNG in
   `assets/icon.png` e `assets/icons/NxN.png` sono rigenerate dallo script.
2. **Nome**: `AISessionManager` → `PizzaManager` in tutto ciò che l'utente
   legge (titolo finestra, sidebar, menu Help, `productName` e voce `.desktop`)
   e nei titoli dei documenti.
3. **Glifo di collasso dei gruppi**: le freccine `▸`/`▾` diventano una fetta di
   pizza (`renderer/pizza-slice.js`). Il tracciato punta a destra e la CSS lo
   ruota di 90° quando `aria-expanded="true"`: un solo glifo, il verso lo dà lo
   stato ARIA dell'header.

## Cosa NON cambia (di proposito)

- `package.json` `name` resta `aisessionmanager`, e con lui `appId`,
  `homepage` e la directory del repo: cambiarli è una migrazione (dati in
  `userData`, URL del repository), non un ritocco grafico.
- Le chiavi in `localStorage` (`aisess.*`) e il socket tmux (`aisession`):
  rinominarle butterebbe via le preferenze e scollegherebbe le sessioni vive.
- I piani precedenti in `docs/plans/`: sono il registro di cosa è successo,
  non documentazione dell'app.

## Verifica

- `npm run test:unit` verde (nuovo `tests/sidebar-chevron.test.js`: la fetta
  finisce nell'header e lo stato aperto/chiuso resta sull'attributo ARIA).
- `python3 assets/generate-icon.py` rigenera il set completo.
- Smoke test dell'app: nome in sidebar e titolo, fetta che ruota aprendo e
  chiudendo un gruppo.

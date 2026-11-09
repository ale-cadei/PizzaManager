# 92 — Fenicottero ed elicottero (`feat/fenicottero`)

Due personaggi nuovi per la striscia degli animaletti (piano 33).

## Cosa

- Dallo zip dell'utente `elicottero-fenicottero.zip`: due fogli Pixel Reef
  (`flamingo-sheet.png`, `helicopter-sheet.png`), stesso formato di
  granchio e barchetta — 4 colonne da 32×32, righe `idle`, `walk`, `call`,
  `sleep` (niente `vanish`).
- Generati con `scripts/pets-pack.py` in `renderer/pets-sprite-fenicottero.js`
  e `renderer/pets-sprite-elicottero.js`, come gli altri Pixel Reef: via il
  contorno scuro e le «z» del sonno, lo scuro attorno al bianco degli occhi
  resta (`eyes`). Pixel della stessa misura degli altri Pixel Reef.
- Il generatore ha una seconda cartella Pixel Reef (`REEF2_DIR`, voce `dir`,
  sovrascrivibile con `PETS_REEF2_DIR`) e accetta dei nomi per rigenerare
  solo quelli: `python3 scripts/pets-pack.py fenicottero elicottero`. Senza
  nomi rigenera tutto, e servono tutti gli zip scompattati.
- Fenicottero: cammina su due zampe, in pausa sta su una, chiama sbattendo
  le ali, dorme con la testa sul dorso. Elicottero: in `walk` si alza e vola
  con le scie di vento (è nei frame, `motion` resta `walk`), chiama
  saltellando con un «!», dorme a terra col rotore fermo.
- Un primo fenicottero disegnato a mano in `pets-sprites.js` è stato
  sostituito da quello del pacchetto prima del commit.
- `MAX_CAST` passa a 20.

## Test

- `tests/pets-sprites.test.js`: tutti e due nel catalogo chiuso, quattro
  tempi di passo, pausa, pixel fine quanto i pacchetti a 32 righe, nessuna
  «z» nel sonno, nessun contorno scuro.
- Smoke nell'app: Vista › Personaggi… → Fenicottero, Elicottero.

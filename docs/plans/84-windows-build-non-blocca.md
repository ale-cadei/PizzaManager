# 84 — `feat/release-windows-build`: anche un build Windows rotto non blocca le release

Taglia: ~1h. **Proposta, da discutere** prima di farla.

## Perché

Il piano 81 ha fatto sì che i **test** Windows rossi escludano Windows dalla
release senza fare rosso niente: avviso giallo, Mac e Linux escono. Ma copre
solo i test. Su Windows restano tre passi senza `continue-on-error` in
`release.yml`:

- **`npm ci`**: compila `node-pty` sul runner. Si rompe se GitHub cambia
  l'immagine `windows-2022` (Visual Studio, Python, SDK).
- **`npm run fetch:psmux`**: scarica lo zip di psmux da GitHub e ne verifica lo
  SHA-256 (`scripts/fetch-psmux.js`). Rete giù o hash diverso → rosso. Gira
  **prima** dei test, quindi in quel caso non ci sono né test né build.
- **`electron-builder --win … --publish always`**: pacchetto NSIS, zip,
  caricamento sulla Release. Può cadere a metà del caricamento.

Se uno di questi cade, il job Windows è **rosso**. Mac e Linux non si fermano
(job separati, `fail-fast: false`) e caricano lo stesso; ma la guida
(`docs/rilasci/README.md` §4) dice «un job rosso = non pubblicare», e la bozza
può avere **file Windows a metà**: per esempio il `.exe` senza `latest.yml`, o
`latest.yml` che punta a un file mai arrivato. Oggi si sistema a mano: si
cancellano dalla bozza i file Windows e si pubblica.

Windows lo sistema una persona sola, nel weekend: un guasto di build Windows
non dovrebbe chiedere a chi rilascia in settimana di decidere a mano.

## La regola proposta

**Qualsiasi guasto del job Windows lo esclude dalla release come i test rossi:**
avviso giallo, nessun file Windows sulla bozza, job verde. Il rosso resta per
Mac e Linux, dove un guasto è un guasto.

## Cosa cambierebbe

1. **`release.yml`**, solo su Windows:
   - `continue-on-error: true` su `npm ci`, `fetch:psmux` e sul passo di
     `electron-builder` (con un `id`, per esempio `build-win`). Sul **passo** e
     non sul job, per lo stesso motivo del piano 81: sul job il check resta
     rosso.
   - I passi dopo un passo fallito vanno condizionati
     (`steps.<id>.outcome == 'success'`): con `continue-on-error` il job
     prosegue, e non deve fare i test dopo un `npm ci` fallito né il build dopo
     un `fetch:psmux` fallito.
   - Un passo finale, se qualcosa è andato storto dopo l'inizio del caricamento:
     **toglie dalla bozza i file Windows** (`PizzaManager-win-*`, `latest.yml`,
     i `.blockmap`) con `gh release delete-asset`, e stampa
     `::warning::Windows escluso da questa release: build fallito…`.
     Nomi presi da `build.nsis.artifactName` e `build.artifactName` in
     `package.json`.
2. **`docs/rilasci/README.md`** — §4 (schema: «Windows: qualsiasi guasto →
   avviso, niente file, job verde») e §8 (nuova riga di sintomo con l'avviso
   del build).
3. **Piano 81** — una riga che rimanda qui.

## Da decidere nella discussione

- **Vale la pena?** Alternativa a costo zero: lasciare tutto com'è e scrivere
  in §3 della guida «job Windows rosso → cancella i file Windows dalla bozza e
  pubblica». Il build Windows è andato verde nella 1.7.0; finora il guasto è
  stato solo nei test.
- **Il rischio della proposta**: un guasto vero del build Windows (non dei
  test) diventa un avviso giallo, più facile da non vedere. Si rischia di
  pubblicare due o tre versioni di fila senza Windows senza accorgersene. Un
  rimedio possibile: nelle note di rilascio la riga «Windows: resta alla 1.x.y»
  è obbligatoria, e chi pubblica la scrive solo se ha letto l'avviso.
- **Trappola della 1.7.0** (piano 81): chi ha la 1.7.0 su Windows, davanti a
  una release senza Windows, vede «Cannot find latest.yml…». Vale anche qui,
  finché non esce una release che contiene Windows.

## Come si verificherebbe

- YAML parsato con `js-yaml`; `npm run test:unit` verde (nessun codice
  dell'app cambia).
- Sul vero GitHub, con `gh workflow run release.yml --ref <branch>` e un guasto
  provocato apposta (per esempio un hash sbagliato in `fetch-psmux.js` sul
  branch): job Windows verde con l'avviso, nessun file `win` né `latest.yml`
  sulla bozza, Mac e Linux caricati. Poi la bozza si cancella.
  - Il rilancio a mano carica sulla bozza della versione in `package.json`: sul
    branch di prova va messa una versione che non esiste (es. `0.0.0-prova`),
    o si sporca la bozza della release vera.

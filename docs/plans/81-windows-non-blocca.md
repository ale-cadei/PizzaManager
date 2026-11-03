# 81 — `feat/release-system`: Windows che non blocca le release

Taglia: ~2h.

## Perché

Su Mac e Linux si sviluppa ogni giorno (Giacomo e Ale); Windows lo prova solo
Giacomo, da casa. Prima di questo branch:

- **CI** (`.github/workflows/ci.yml`): il job `test (windows-2022)` era rosso a
  ogni merge da almeno tre merge (notebook, gruppi). Non bloccava niente, ma
  `main` era sempre rosso, e un rosso costante insegna a ignorarlo — anche
  quando a rompersi è Linux.
- **Release** (`.github/workflows/release.yml`): non eseguiva i test. Un tag
  avrebbe costruito e pubblicato Windows con test rossi e nessuna prova a mano.
- **Saltare Windows non era gratis**: se la release più recente non ha
  `latest.yml`, l'app Windows mostrava ogni 4 ore «Aggiornamento non riuscito:
  Cannot find latest.yml…» (`app/updater.js`, evento `error` → banner di
  `lib/update-policy.js`).
- **README**: la riga Windows diceva «pacchetto non disponibile», falso dalla
  1.7.0.

## La regola

**Una release contiene Windows solo se i test Windows passano su quel
commit.** Automatico, senza flag manuali. Mac e Linux escono sempre; Windows
quando è pronto, e rientra nella versione *successiva*.

Non si «aggiunge dopo» alla stessa release: la correzione sta in commit
successivi al tag, e ricostruire dal tag ricostruirebbe il codice rotto; e
electron-builder non carica su una release già pubblicata. Chi usa Windows
resta sull'ultima versione buona, senza errori, e poi salta direttamente a
quella nuova.

## Cosa cambia

1. **`ci.yml`** — `continue-on-error: ${{ runner.os == 'Windows' }}` sul
   **passo** dei test, non sul job, più un passo che stampa
   `::warning::Test Windows rossi su questo commit…`. Windows gira e si legge
   come prima, ma non fa rossa la CI. Linux sì.
   - Prima versione col `continue-on-error` sul job: sulla PR #62 il workflow
     chiudeva verde, ma il check `test (windows-2022)` restava `fail` e la PR
     «Some checks were not successful». È il `main` rosso che si voleva
     togliere, quindi si è spostato sul passo, come in `release.yml`.
2. **`release.yml`** — nel job di build, solo su Windows, dopo
   `fetch:psmux`: passo `Test su Windows` (`id: test-win`, `continue-on-error:
   true` sul **passo**, `timeout-minutes: 20` come la CI). Il build
   (`electron-builder --publish always`) gira se `runner.os != 'Windows' ||
   steps.test-win.outcome == 'success'`. Se i test sono rossi (o scadono) un
   passo stampa `::warning::Windows escluso da questa release: test rossi…`.
   Il job resta **verde**: «un job rosso = non pubblicare» vale per i guasti
   veri, e Windows escluso non lo è.
   - Test nella release e non l'esito di `ci.yml`: chi tagga subito dopo il
     merge troverebbe la CI ancora in corso.
   - La matrice ha un job per sistema; i passi macOS restano com'erano (`if:
     runner.os == 'macOS'`).
3. **Updater** — `isNoUpdateError({ platform, error })` in
   `lib/update-policy.js`: su `win32`, un errore il cui messaggio contiene
   «Cannot find latest.yml» (electron-updater 6.8, GitHubProvider, codice
   `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`) vuol dire «nessun aggiornamento».
   `app/updater.js` lo ignora come farebbe con `update-not-available`: lo
   stato resta com'è, quindi anche un aggiornamento già scaricato resta pronto.
   - Si guarda il messaggio e non il codice: il codice è lo stesso per il
     manifesto di ogni sistema, e su Mac/Linux un manifesto mancante è una
     release rotta, da mostrare.
   - Ogni altro errore (rete, firma, nessuna release) si mostra come prima.
4. **README** — la riga Windows nomina `PizzaManager-win-x64-setup.exe` e
   punta alla pagina delle Releases, **non** a `releases/latest/download/…exe`:
   quando l'ultima release non ha Windows quel link dà 404.
5. **`docs/rilasci/README.md`** — §3 (cosa fare quando Windows manca, come
   scriverlo nelle note: «Windows: resta alla 1.x.y, arriva con la prossima»),
   §4 (schema col runner Windows e la regola), §5 (i file Windows), §6
   (Windows senza release resta fermo in silenzio), §8 (sintomi: avviso nel
   job, CI verde con l'avviso sui test Windows, errore `latest.yml` sulla
   1.7.0; il Windows rosso si sistema anche da Mac).

## Trappola: la 1.7.0

Il «nessun aggiornamento» c'è solo nelle versioni **dopo** la 1.7.0. Chi ha la
1.7.0 su Windows, davanti a una release senza Windows, vede ancora l'errore,
finché non esce una release che contiene Windows. Quindi **la prima release
dopo la 1.7.0 conviene che contenga Windows**: è quella che porta la
correzione. Scritto anche in `docs/rilasci/README.md` §3.

## Come si verifica

- `npm run test:unit` verde: `tests/update-policy.test.js` copre Windows con e
  senza `latest.yml`, Mac e Linux col manifesto mancante (restano errori), e
  gli altri errori su Windows (rete, firma, nessuna release, `null`).
- YAML dei due workflow parsato con `js-yaml`.
- **Da qui non si verifica** — si vede solo sul vero GitHub:
  - sulla PR e al primo push su `main`: i due check verdi, e sul run
    l'avviso giallo dei test Windows finché restano rossi;
  - al primo tag con Windows rosso: job Windows verde con l'avviso, nessun
    `.exe` né `latest.yml` sulla bozza, Mac e Linux caricati;
  - al primo tag con Windows verde: tutto come nella 1.7.0;
  - sull'app Windows (dopo la release che porta la correzione), davanti a
    una release senza Windows: nessun banner.

## Annotato strada facendo, fuori da questo branch

- **I test Windows rossi** li sistema Giacomo a casa: non toccati qui. Si
  possono guardare anche da Mac pushando un branch e leggendo il job Windows.
- **`check()` in `app/updater.js`** chiama `checkForUpdates()` senza gestire la
  promessa: quando fallisce, electron-updater emette `error` (gestito) *e*
  rifiuta la promessa, che resta senza `catch` (unhandled rejection nel main).
  Innocuo oggi, da chiudere con un `.catch` che non pubblichi due volte.
- Il commento sulla matrice di `release.yml` dice ancora «Sul runner non è
  ancora provato: lo dirà il primo tag» per Windows: la 1.7.0 l'ha provato.

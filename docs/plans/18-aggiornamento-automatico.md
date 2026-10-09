# 18 — Aggiornamento automatico e distribuzione ai colleghi

Branch: `chore/release-pubblica` → `feat/auto-update` → (`chore/firma-mac`)
Dipende da: 13 · Taglia: ~½ g + ~½ g (+ ~½ g la firma, se si fa)

## Obiettivo

Dare l'app a un collega senza che debba clonare il repo, costruirla o
ricordarsi di aggiornarla: scarica un file, lo apre, e da lì in poi le versioni
nuove arrivano da sole con un banner «versione 1.0.3 pronta — Riavvia».

Macchine reali oggi: macOS (Giacomo) e Linux (il collega). Windows si costruisce
già e riceverebbe gli aggiornamenti, ma nessuno lo usa: non si verifica qui.

## Perché due repo

`electron-updater` chiede gli aggiornamenti a un indirizzo **pubblico**: legge
un manifesto (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`) con versione,
nome del pacchetto e checksum. Su un repo privato servirebbe un token dentro
l'app distribuita, cioè un segreto regalato a chi la scarica: non si fa.

Rendere pubblico il codice è una decisione separata e non necessaria. Un
**secondo repo pubblico che contiene solo le release** basta: i pacchetti sono
*release assets*, non file del repo, quindi lì dentro non finisce una riga di
sorgente. Il repo pubblico ha un solo commit, il README con i link di download.

Il sorgente resta dov'è: **non si pusha niente** da un repo all'altro. È il
workflow che, al tag, carica i pacchetti sull'altro repo con un token.

## Come si aggiorna un'app, in concreto

L'indirizzo dove cercare gli aggiornamenti viene scritto **dentro il pacchetto
al momento del build** (`app-update.yml`, generato da electron-builder dalla
sezione `publish`). Un'app costruita dal repo privato bussa quindi al repo
pubblico, e i due non si incontrano mai a runtime.

All'avvio e poi ogni 4 ore l'app scarica il manifesto, confronta la versione
con la propria (quella di `package.json`: comanda il tag), e se è più nuova
scarica il pacchetto in **background**, usando i `.blockmap` — già generati dal
workflow — per prendere i soli blocchi cambiati invece di 100 MB. Verifica il
checksum, poi mostra il banner. Il riavvio dura due secondi: il pacchetto è già
sul disco, non c'è nessun build.

Due conseguenze:
- **una release in bozza non viene vista** da electron-updater. È anche
  l'interruttore: finché la bozza non si pubblica, nessuno riceve niente.
  Il flusso del piano 13 (controlla i file, poi pubblica) resta identico.
- **su macOS l'aggiornamento passa dallo `.zip`**, non dal `.dmg`. Il workflow
  li costruisce già entrambi: il `.dmg` è per la prima installazione a mano,
  lo `.zip` per gli aggiornamenti.

## macOS senza firma: cosa funziona e cosa no

Squirrel.Mac **rifiuta di installare un aggiornamento non firmato**: non è una
configurazione, è il progetto. Quindi su Mac, finché non c'è un Developer ID:

| | Prima installazione | Aggiornamento |
|---|---|---|
| Linux (AppImage) | nessun avviso | automatico, completo |
| Windows (NSIS) | avviso SmartScreen | automatico, completo |
| macOS | avviso «danneggiato», una volta (`xattr -cr` o Impostazioni → Privacy e sicurezza) | banner «c'è la 1.0.3» + tasto che apre la pagina di download |

Il ramo macOS non firmato **non è codice buttato**: è lo stesso banner, con
`autoDownload` spento e il tasto che apre un link invece di riavviare. Quando
arriva il certificato si toglie quel ramo. La firma è solo variabili d'ambiente
nel workflow, non cambia la struttura di niente (vedi terzo branch).

Il `.deb` non è aggiornabile da electron-updater (lo gestisce apt): chi lo
installa riceve il banner con il link, come il Mac non firmato. L'AppImage è
il formato consigliato nel README per Linux.

## Branch 1 — `chore/release-pubblica`

Nessun codice dell'app: solo distribuzione.

- **Repo `ale-cadei/PizzaManager-releases`**, pubblico, un commit: README con
  la tabella di download e la nota sull'app non firmata (copiata da qui).
- **PAT fine-grained** con `contents: write` **solo** su quel repo, salvato nel
  repo privato come secret `PUBLIC_RELEASE_TOKEN`. Scadenza un anno, annotata
  nel README dei piani: quando scade, la release fallisce e il motivo non è
  ovvio.
- **`package.json`** → `build.publish`: `{ provider: 'github', owner:
  'ale-cadei', repo: 'PizzaManager-releases', releaseType: 'draft' }`.
- **`release.yml`** → `GH_TOKEN: ${{ secrets.PUBLIC_RELEASE_TOKEN }}` nel job
  di build **e** nel job `draft` (che crea la bozza: deve crearla di là).
- **README** del repo privato → i link di download puntano al repo pubblico.
- **Verifica**: `npm version patch`, push del tag, si pubblica la bozza, e si
  scarica un file **da un browser non loggato** (finestra anonima). È l'unico
  modo di accorgersi se il repo o il token sono sbagliati: da loggati funziona
  comunque.

## Branch 2 — `feat/auto-update` ✅ fatto il 2026-10-09

Scelte dell'utente: **scarica da sé** in background, e il banner compare
**quando il pacchetto è già pronto** — così «Riavvia ora» costa due secondi
invece di 100 MB di attesa. Controllo 10 secondi dopo l'avvio e poi ogni
4 ore.

Com'è venuto, file per file:

- **`lib/update-policy.js`** (puro) — `updateMode` decide `off` / `auto` /
  `manual`, e `bannerText` compone il messaggio e dice quale tasto mostrare.
  Qui vive anche `DOWNLOAD_URL`, che prima era duplicato in `app/menu.js`:
  ora quello lo importa da qui.
- **`app/updater.js`** — `registerUpdateHandlers(ipcMain, …)`, nella forma
  degli altri moduli di `app/`. Richiede `electron-updater` **in modo pigro**,
  dentro la funzione: quel pacchetto costruisce `autoUpdater` al primo accesso
  e vuole `app.getVersion()`, quindi importarlo in testa al file lo renderebbe
  non caricabile sotto Node e porterebbe giù i test.
- **`renderer/update-banner.js`** — disegna e non decide: riceve testo e tasto
  già pronti. `textContent`, mai `innerHTML`: nel messaggio finiscono la
  versione e (in prospettiva) le note scritte su GitHub, cioè dati esterni.
- **`renderer/panels.js`** — `initUpdateBanner()`: si abbona all'evento **e**
  chiede lo stato corrente all'avvio, perché l'evento può essere passato prima
  che la pagina esistesse o dopo un ricaricamento.
- **`main.js`** — due righe, tetto alzato da 225 a 227 con il perché nel test.

### Perché `off` in sviluppo

Con `npm start` manca `app-update.yml` — il file che electron-builder scrive
**dentro il pacchetto** con l'indirizzo da cui scaricare — e il codice è già
quello corrente. Senza la guardia, ogni avvio darebbe un errore in console.

### Perché `manual` sul `.deb`

Lì gli aggiornamenti li fa `apt`, e `electron-updater` non saprebbe dove
scrivere. Si dice che c'è una versione nuova e si apre la pagina dei download.
La distinzione si fa sulla variabile `APPIMAGE`, che è il formato stesso a
mettere nell'ambiente quando l'app parte.

## Branch 2 — com'era pianificato

- **`electron-updater`** in `dependencies` (non dev: finisce nel pacchetto).
- **`lib/update-policy.js`** — puro, testabile senza Electron: decide *cosa
  fare* data la piattaforma, il formato installato e lo stato
  (`{ platform, isSigned, format }` → `'auto' | 'manual'`), e formatta il testo
  del banner. È la regola macOS-non-firmato / `.deb` in un posto solo, con i
  test dei casi.
- **`app/updater.js`** — il pezzo che tocca Electron: configura `autoUpdater`
  (niente `autoDownload` in modalità manuale), si abbona a `update-available`,
  `download-progress`, `update-downloaded`, `error`, e li gira al renderer.
  `quitAndInstall()` sul tasto Riavvia. **Spento in sviluppo**: senza
  `app-update.yml` (cioè con `npm start`) non parte e non logga errori.
- **`main.js`** — solo il cablaggio, come sempre.
- **`renderer/update-banner.js`** — banner in cima, non un modal: versione,
  note, barra di avanzamento durante il download, tasti **Riavvia ora** /
  **Più tardi**. Isolato come `usage-bar.js`, così `renderer.js` non cresce
  (è già a 1229 righe).
- **Le note di rilascio** sono quelle della Release su GitHub: `electron-updater`
  le passa nell'evento. Vanno quindi scritte quando si pubblica la bozza —
  oggi sono vuote. Bastano due righe per versione.
- **Il riavvio e le sessioni**: su Mac e Linux tmux le tiene vive, si
  riattaccano da sole (piano 06). Su Windows no, ma lì non c'è nessuno.
- **Test**: `tests/update-policy.test.js` (la matrice piattaforma × formato ×
  firma), `tests/update-banner.test.js` sul DOM finto (stati: disponibile, in
  scaricamento, pronto, errore, modalità manuale).

## Verifica sull'app

1. Installa la 1.0.2 **scaricata** (non `npm run install:mac`: quella non ha
   `app-update.yml` con l'indirizzo giusto e non ha la quarantena, quindi non
   rappresenta il caso vero).
2. `npm version patch` → tag → il workflow costruisce → pubblica la bozza.
3. L'app aperta, entro pochi minuti: banner. Su Linux scarica da sola e il
   tasto riavvia; su Mac non firmato il tasto apre la pagina.
4. Un collega che non ha mai visto il repo scarica dal link del README in una
   finestra anonima e arriva all'app funzionante.

## Fuori scope

- **Windows**: si costruisce e riceverebbe gli aggiornamenti, ma non si
  verifica finché non c'è una macchina (stessa regola del piano 12).
- **La sentinella su `main`** (versione precedente di questo piano): dice a chi
  sviluppa che la sua build è indietro rispetto a `main`, senza passare dai
  tag. Serve a noi due, non ai colleghi; è un piano a sé, se servirà.
- **Canali beta** (`allowPrerelease`, `channel`): quando avrà senso avere una
  versione di prova separata da quella dei colleghi.
- **`safeStorage`** per le API key: torna in gioco con la firma, non prima.

## Terzo branch, condizionale — `chore/firma-mac`

Solo se c'è un Developer ID. **Prima di spendere: chiedere in Digitiamo se
esiste già un account sviluppatore Apple come organizzazione** — in quel caso
basta essere aggiunti al team e il certificato non costa niente.

- Certificato «Developer ID Application» esportato in `.p12`, messo nei secret
  (`CSC_LINK` in base64, `CSC_KEY_PASSWORD`) insieme a `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` per la notarizzazione.
- Si toglie `CSC_IDENTITY_AUTO_DISCOVERY: false` dal workflow e si mette
  `mac.notarize: true`. electron-builder fa il resto: il workflow non cambia
  struttura.
- `lib/update-policy.js` restituisce `'auto'` anche per macOS: il ramo manuale
  sparisce da solo, senza toccare il banner.
- Si guadagna insieme: niente avviso «danneggiato» alla prima installazione,
  aggiornamento automatico sul Mac, e `safeStorage` che diventa sensato.

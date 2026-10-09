# 44 — Release firmata, e pacchetti aggiornati

Branch: `chore/release-firmata` · Dipende da: 13 · Taglia: ~½ g

## Obiettivo

L'ultima release scaricabile è la **1.0.2 del 21 settembre**: da allora `main`
ha preso 159 commit e 19 funzionalità (worktree, pannello modifiche, notifiche,
mappa dei branch, temi, scrollback…). Chi scarica il pacchetto usa un'app di
due settimane fa.

Qui si fa una **1.1.0 firmata e notarizzata** per macOS, con i pacchetti per
Linux e Windows aggiornati nello stesso giro. L'utente ha preso l'Apple
Developer Program: la firma, che il piano 13 aveva lasciato fuori per questo,
ora si può fare.

**Il codice resta privato, le versioni vanno in chiaro** (decisione del
2026-10-08): `JackGrieco/PizzaManager-releases` è pubblico e contiene **solo**
le Release. I pacchetti sono *release asset*, non file di quel repo: là non
finisce una riga di sorgente, e non si pusha niente da un repo all'altro — è
il workflow che, al tag, carica i file dall'altra parte.

È il primo dei tre branch del [piano 18](18-aggiornamento-automatico.md)
(`chore/release-pubblica`), fatto qui insieme alla firma perché sono lo stesso
giro di release. Con questo in piedi, l'aggiornamento automatico diventa
possibile: resta da fare, ed è il secondo branch di quel piano.

## Cosa cambia la firma

| | Prima (non firmata) | Dopo (firmata + notarizzata) |
|---|---|---|
| macOS, prima apertura | «PizzaManager è danneggiato», serve *Apri comunque* o `xattr -cr` | si apre, nessun avviso |
| Linux | nessun avviso | invariato |
| Windows | avviso SmartScreen | **invariato**: serve un certificato Windows, altra spesa |

Sblocca anche due cose rimandate: `safeStorage` per le API key (differito dal
branch 3 perché su app non firmata il Keychain perde accesso a ogni rebuild) e,
quando si vorrà, l'aggiornamento automatico su Mac.

## Com'è fatta la configurazione

Poco, perché electron-builder 26 fa quasi tutto da sé:

- **Gli entitlement di default sono già quelli giusti** per Electron
  (`allow-jit`, `allow-unsigned-executable-memory`,
  `disable-library-validation`): nessun file da scrivere.
- **`hardenedRuntime` è già `true`** per default, ed è un requisito della
  notarizzazione.
- **La notarizzazione è opt-out**, non opt-in: parte da sé appena le
  credenziali sono nell'ambiente. Non serve `mac.notarize: true`; serve che i
  secret esistano.
- Quindi il lavoro è: togliere `CSC_IDENTITY_AUTO_DISCOVERY: false` dal
  workflow (c'era per dire «non cercare certificati») e passargli i secret.

`CSC_IDENTITY_AUTO_DISCOVERY` va **spento quando il certificato non c'è**,
altrimenti un build senza secret (un fork, o questo branch prima che i secret
esistano) tenterebbe di firmare e fallirebbe. Si lega al secret stesso:
`${{ secrets.MAC_CSC_LINK != '' }}`.

### Credenziali: la chiave API, non la password dell'Apple ID

**Cronaca utile, perché costa mezza giornata a chi la rifà.** L'accesso
all'API di App Store Connect su un account individuale non si crea: si
*richiede*, e Apple lo concede quando vuole («organization will be given first
access followed by individuals»). Nemmeno le *Individual Keys* sono una via
d'uscita: quelle le genera ciascuno dal proprio profilo, non da quella pagina.
Quindi si era partiti con una app-specific password, e il workflow è stato
cablato per accettare entrambe. L'accesso è poi arrivato **lo stesso giorno**
(2026-10-08) e la chiave `A6LD5BA326` è quella in uso. Il ripiego resta
cablato: serve se la chiave viene revocata e bisogna rilasciare subito.

Per notarizzare electron-builder accetta tre strade; la documentazione
consiglia la prima e la seguiamo:

1. `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — chiave di App
   Store Connect, revocabile da sola, non è la password di nessuno;
2. `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`;
3. un profilo nel keychain (solo in locale).

La chiave è un file `.p8`: nei secret ci va il **contenuto**, e il workflow lo
scrive in un file temporaneo prima del build, perché `APPLE_API_KEY` vuole un
percorso.

## La trappola del certificato sbagliato

Provato in locale sul Mac dell'utente (2026-10-07), **prima** di installare il
Developer ID: electron-builder ha firmato comunque, con l'«Apple Development»
che era nel keychain, e nei log ha scritto `signing … type=distribution`.
Sembra tutto a posto. Ma:

```
spctl -a -vvv -t install dist/mac-arm64/PizzaManager.app
  → rejected   origin=Apple Development: Giacomo Grieco
```

Quel certificato serve a far girare l'app sui propri dispositivi: **Gatekeeper
lo rifiuta su ogni altro Mac**, e la notarizzazione lo rifiuterebbe comunque.
È peggio di un pacchetto non firmato, perché non si vede dai log.

Per questo il workflow, dopo il build su macOS, **verifica** che l'autorità sia
`Developer ID Application` e che i `.dmg` siano notarizzati (`stapler
validate`), e fallisce se no. Gli asset a quel punto sono già caricati, ma la
Release nasce in bozza e si pubblica a mano: un job rosso è il segnale di non
pubblicare. Non si pinna `mac.identity` in `package.json` perché bloccherebbe
anche i build locali di chi non ha quel certificato.

## Il .dmg non eredita niente dall'app

Misurato il 2026-10-08, e scoperto per gradi perche' ogni passo *sembrava*
aver funzionato:

| Oggetto | `syspolicy_check distribution` |
|---|---|
| `PizzaManager.app` firmato e notarizzato | **ready for distribution** |
| `.dmg` appena costruito | fallito, *fatal*: «File is not signed at all» |
| `.dmg` notarizzato, firma adhoc | fallito: «adhoc signed … not suitable for distribution» |
| `.dmg` firmato Developer ID, notarizzato, timbrato | **ready for distribution** |

`mac.notarize` notarizza il `.app`; il `.dmg` viene costruito **dopo** e nasce
con la firma adhoc che gli mette `hdiutil`, senza ticket. Ma chi scarica
riceve il `.dmg`, ed e' il primo oggetto che macOS valuta: con l'app dentro
perfetta, `spctl` lo rifiutava comunque con «no usable signature».

**L'ordine conta**: firmare invalida un francobollo gia' attaccato, perche' il
ticket e' legato all'impronta del file. Quindi **firma → notarizza → timbra**,
e vale per entrambi gli oggetti.

La documentazione di electron-builder sconsiglia `dmg.sign` («will lead to
unwanted errors in combination with notarization requirements»). Qui si fa il
contrario di quel consiglio, in cognizione di causa: senza firma Gatekeeper non
ha un'identita' da verificare e rifiuta anche col francobollo attaccato, e sono
due strumenti di Apple a dirlo. Il sospetto e' che quel consiglio riguardi
l'ordine sbagliato. Per questo la firma del `.dmg` sta in
`scripts/notarize-dmg.js` e non in quell'opzione: cosi' resta accanto
all'invio, nella sequenza giusta.

### Il controllo che non controllava

Il gancio verifica con `spctl` e fallisce se il verdetto non e' accettato. La
prima versione approvava sempre: `spctl` scrive il verdetto su **stderr** (non
su stdout) ed **esce con codice diverso da zero quando rifiuta** — quindi
leggendo solo stdout con `execFileSync` si otteneva una stringa vuota quando
accettava, e un'eccezione senza motivo leggibile quando rifiutava. Si legge con
`spawnSync` unendo i due flussi, e `isAccepted` pretende sia `: accepted` sia
`source=Notarized Developer ID` — perche' «firmato ma senza francobollo»
risponde `rejected / no usable signature`, ed e' il caso che e' sfuggito due
volte. I casi sbagliati sono in `tests/notarize-dmg.test.js`.

## Il portachiavi lo prepara il workflow, non electron-builder

Trovato il 2026-10-08 al primo tag vero, e vale la pena sapere com'è fatto il
sintomo perché inganna.

Con `CSC_LINK` e `CSC_KEY_PASSWORD` nell'ambiente, electron-builder 26.15.3 fa
così (`app-builder-lib/out/codeSign/macCodeSign.js`):

```
create-keychain          -p <casuale, 32 byte>     ← password del portachiavi
import … -P              <password del .p12>       → «1 identity imported»
set-key-partition-list … -k <password del .p12>    ← quella SBAGLIATA
```

Crea il portachiavi con una password casuale e poi prova a sbloccarlo con
quella del certificato. Su macOS recenti `set-key-partition-list` la valida
davvero, e il build muore con:

```
security: SecKeychainUnlock: The user name or passphrase you entered is not correct.
```

**Sembra una password sbagliata, e invece è giusta**: l'import, la riga prima,
è riuscito. Ci si perde mezz'ora a rifare secret che erano corretti — e la
verifica che lo dimostra è `openssl pkcs12 -legacy -in <file> -nokeys`, dove
`-legacy` serve perché il Portachiavi cifra i `.p12` con RC2-40-CBC e OpenSSL 3
rifiuta quell'algoritmo se non glielo si chiede (un altro errore che sembra di
password e non lo è).

Non esiste una versione stabile in cui sia corretto (la 27 è in alpha), quindi
quella strada si evita: il workflow **prepara il portachiavi da sé** — con la
password del portachiavi dove va la password del portachiavi — e a
electron-builder non passa `CSC_LINK`. Con l'identità già installata, la trova
con l'auto-discovery. Due dettagli necessari: `set-keychain-settings -lut
21600`, o il portachiavi si richiude prima che la notarizzazione finisca, e
`list-keychains -d user -s`, o `codesign` non lo guarda nemmeno.

## Prima in locale, poi sul CI

Ogni giro del workflow costa ~5 minuti e la firma sbaglia in modi che si
leggono male. Quindi si valida sul Mac, dove il certificato è già nel keychain
e il ciclo è immediato:

```
npm run dist:mac
codesign -dv --verbose=4 "dist/mac-arm64/PizzaManager.app"   # Authority = Developer ID Application
spctl -a -vvv -t install "dist/mac-arm64/PizzaManager.app"   # accepted, source=Notarized Developer ID
xcrun stapler validate "dist/PizzaManager-mac-arm64.dmg"     # The validate action worked!
```

Solo quando questi tre passano si esportano il `.p12` e i secret e si tagga.

## Il repo pubblico

Creato il 2026-10-08: `JackGrieco/PizzaManager-releases`, un commit solo (il
README con la tabella di download e la nota sulla prima apertura). Sta
sull'account personale e non sotto `ale-cadei` perché quello è l'account del
collega, e là l'utente non può creare niente.

Tre cose non ovvie:

- **Serve un PAT**, `PUBLIC_RELEASE_TOKEN`: il `GITHUB_TOKEN` di un workflow
  vale solo per il repo che lo esegue, e non scrive nel repo pubblico.
  Fine-grained, `contents: write` **solo** su quel repo.
- **Niente `--target` quando si crea la bozza**: il tag non esiste nel repo
  pubblico, e `GITHUB_SHA` è un commit di questo repo, che là non c'è. Senza,
  la bozza si appoggia al branch di default.
- **I link del repo pubblico sono relativi** (`../../releases/latest/download/…`):
  così restano giusti anche se il repo cambia nome o proprietario.

Cambia anche cosa vede chi usa l'app: `homepage` (che finisce nei metadati del
`.deb`) e il link del menu *Help* puntavano al repo del codice, cioè a un 404
per chiunque non sia noi due. Ora vanno alla pagina pubblica.

## Pezzi

- **`package.json`** — `version: 1.1.0`, `build.publish` con `owner`/`repo`
  del repo pubblico, `homepage` alla pagina pubblica. `repository` resta il
  repo del **codice**: serve a npm e al changelog, non alla pubblicazione.
- **`.github/workflows/release.yml`** — i secret di firma e notarizzazione nel
  job di build, `CSC_IDENTITY_AUTO_DISCOVERY` legato alla presenza del
  certificato, il `.p8` scritto su file prima del build.
- **`README.md`** — la nota «I pacchetti non sono firmati» diventa vera: su
  macOS non serve più niente, su Windows l'avviso resta. I link di download e
  il badge della versione puntano al repo pubblico.
- **`scripts/notarize-dmg.js`** + `build.afterAllArtifactBuild` — firma,
  notarizza e timbra i `.dmg` dopo il build, e verifica il risultato. Accetta
  le tre forme di credenziali nella precedenza di electron-builder (chiave API,
  app-specific password, profilo del portachiavi), cosi' in locale e sul CI
  gira **la stessa procedura**: nessuna coppia di sequenze da tenere allineata.
  Non fa niente, senza fallire, fuori da macOS o senza materiale di firma.
- **`app/menu.js`** — il link di *Help* alla pagina pubblica, e
  *Informazioni su PizzaManager* con la versione: da quando l'app si scarica
  invece di ricostruirla, «che versione hai?» non aveva risposta in nessun
  punto dell'interfaccia. `role: 'about'` + `setAboutPanelOptions`.
- **`docs/rilasci/v1.1.0.md`** — le note della Release. Su un repo pubblico
  la pagina della Release è la pagina del prodotto: vuota sembra abbandonata.
  Non si possono generare da sole — `gh release --generate-notes` legge i
  commit del repo in cui crea la Release, e là ci sono solo quelli del README:
  si scrivono a mano e si conservano qui.
- **`docs/plans/13-release-build.md`** — la riga «fuori scope: firma» non vale
  più: rimanda qui.

I test coprono il controllo sul verdetto e la scelta delle credenziali
(`tests/notarize-dmg.test.js`); il giro vero si prova costruendo, e l'esito è
la tabella qui sopra. Resta la verifica finale: scaricare il `.dmg` dalla
release su una macchina che non l'ha mai visto.

## Il gancio giusto: `artifactBuildCompleted`, non `afterAllArtifactBuild`

Il secondo giro di release e' uscito **verde con i `.dmg` non firmati**, ed e'
il difetto piu' insidioso incontrato in questo lavoro.

Nel log del runner tutto sembrava perfetto: app notarizzata, poi
`dmg: firma` → `dmg: invio ad Apple` → `dmg: accettato da Gatekeeper`. Ma il
`.dmg` scaricato *dalla Release* rispondeva `rejected / no usable signature`.
I timestamp spiegano:

```
15:53:46.70   uploading  file=PizzaManager-mac-arm64.dmg.blockmap
15:53:46.75   dmg: firma …                                   ← 50 ms DOPO
```

`--publish always` **carica gli artefatti mentre li produce**, e
`afterAllArtifactBuild` gira dopo: il gancio firmava un file che era gia'
partito. Il lavoro c'era, non arrivava a destinazione.

La soluzione sta nel codice di electron-builder
(`app-builder-lib/out/packager.js`):

```js
async emitArtifactBuildCompleted(event) {
  await this.eventEmitter.emit("artifactBuildCompleted", event);  // gancio utente, ATTESO
  await this.emitArtifactCreated(event);                          // qui il publisher carica
}
```

`artifactBuildCompleted` viene **atteso prima** dell'evento su cui il
PublishManager carica. Spostato lì, il file parte firmato. Differenza d'uso:
quel gancio riceve **un artefatto per volta** (`event.file`), non l'elenco,
quindi filtra sui `.dmg` e ignora il resto.

Effetto collaterale accettato: il `.dmg.blockmap` viene calcolato prima della
firma, quindi non corrisponde al file finale. Non importa — su macOS
`electron-updater` aggiorna dallo **zip**, non dal `.dmg`.

### E il controllo guardava il file sbagliato

Il passo di verifica nel workflow era passato, perche' controllava il `.dmg`
in `dist/` — quello che il gancio aveva sistemato. Un controllo che non puo'
vedere il difetto che deve intercettare non e' un controllo: ora **riscarica
l'asset dalla Release** e verifica quello. E' l'unica cosa che conta, perche'
e' il file che la gente scarichera'.

## Un manifesto per architettura si sovrascrive

Trovato il 2026-10-09, sulla 1.2.1, e scoperto solo perche' l'utente ha
guardato cosa stava scaricando: su un Mac **arm64**, con l'app **arm64**
installata, l'aggiornamento tirava giu' `PizzaManager-mac-x64.zip`.

`latest-mac.yml` elencava **solo i file x64**. Non e' che l'updater scegliesse
male: non aveva alternative. I due job macOS giravano in parallelo, **ognuno
scriveva il proprio `latest-mac.yml`** con i soli file che aveva prodotto, e
caricando sulla stessa Release l'ultimo sovrascriveva il primo.

`electron-updater` sa scegliere — `MacUpdater`: «on arm64 Macs (including
Rosetta), arm64 files are preferred when available», e `findFile` cerca
`process.arch` nel nome — ma solo se le trova entrambe nel manifesto.

Correzione: **un solo job per macOS**, `--mac --arm64 --x64` in un'unica
invocazione, cosi' electron-builder scrive un manifesto con tutti e quattro i
file. Verificato in locale prima di rilasciare. Si paga che un problema su x64
ferma anche arm64, ma un manifesto che manda a tutti il build sbagliato e'
peggio dell'isolamento fra le due architetture.

Il vecchio campo `path:` in coda al manifesto resta a puntare a x64: e' il
ripiego per i client antichi, e `getFileList` usa `files` quando c'e'.

### Perche' non l'ha preso il controllo nel workflow

Il passo che riscarica l'asset verifica **firma e francobollo**, e quelli
erano giusti: il pacchetto x64 era perfettamente firmato e notarizzato. Il
difetto non era nel pacchetto, era nel **manifesto** — un file che quel
controllo non guardava. Quello che l'avrebbe preso e' un controllo sul
contenuto di `latest-mac.yml`: che elenchi uno zip per ogni architettura
costruita.

## Stato al 2026-10-08, sera

Tag `v1.1.0` spinto (su `013c35d`), **bozza di Release creata** sul repo
pubblico, secret tutti e sei installati, certificato e chiave di
notarizzazione a posto.

Tre giri, e ognuno ha trovato una cosa:

1. **primo giro**: i due macOS morti sul portachiavi (vedi sopra) e Windows
   sull'argomento spezzato da `pwsh` (vedi
   [piano 40](40-windows-sessioni-persistenti.md));
2. **secondo giro**: tutti e tre i job verdi, ma i `.dmg` sulla Release **non
   firmati** — gancio sbagliato (vedi sopra). Scoperto solo scaricando l'asset
   dalla Release: nel log del runner sembrava tutto a posto;
3. **terzo giro**: da lanciare, con gancio e controllo corretti.

Si rilancia a mano con `gh workflow run release.yml --ref main` — non serve
ri-taggare, il workflow carica sulla stessa bozza e sovrascrive gli asset.

⚠️ **La bozza adesso contiene due `.dmg` non firmati**: non va pubblicata
finche' il terzo giro non e' verde e il controllo sull'asset riscaricato non
passa.

**Cosa resta da fare, in ordine:**

1. guardare com'è andata l'ultima corsa:
   `gh run list --workflow=release.yml --limit 1`
   e, se è rossa, `gh run view <id> --log-failed`;
2. contare i file sulla bozza — devono essere **sette** senza Windows (2 dmg,
   2 zip e 2 blockmap per i due Mac più `latest-mac.yml`, oltre ai tre file
   Linux già caricati):
   `gh release view v1.1.0 --repo JackGrieco/PizzaManager-releases`;
3. **la verifica che conta**: scaricare il `.dmg` *dalla release* (non quello
   costruito in locale) e passargli i tre controlli:
   ```sh
   spctl -a -vvv -t open --context context:primary-signature <dmg>   # accepted, Notarized Developer ID
   syspolicy_check distribution <dmg>                                 # ready for distribution
   xcrun stapler validate <dmg>                                       # The validate action worked!
   ```
4. solo allora **pubblicare la bozza**, incollando
   [`../rilasci/v1.1.0.md`](../rilasci/v1.1.0.md) nelle note. Finché è bozza
   non esiste per nessuno: i link di download non funzionano e nessuno può
   scaricare mezza release.

Da fare dopo, a release pubblicata: il documento di processo per chi rilascia
(in `docs/rilasci/`), e l'aggiornamento automatico — secondo branch del
[piano 18](18-aggiornamento-automatico.md), ora possibile perché i
`latest-*.yml` finiscono già nel repo pubblico.

## Cosa serve dall'utente (non si può fare da qui)

1. **Certificato «Developer ID Application»** ✅ fatto il 2026-10-08
   (`CBRAP62CDG`): Xcode → Settings → Accounts →
   il team → *Manage Certificates* → **+** → *Developer ID Application*.
   Nel keychain oggi c'è solo un «Apple Development», che serve a far girare
   l'app sui propri dispositivi e **non** vale per distribuire.
2. **Chiave di App Store Connect** (appstoreconnect.apple.com → Users and
   Access → Integrations → Team Keys), ruolo *Developer*: si scarica una volta
   sola. ✅ fatta il 2026-10-08 (`A6LD5BA326`), validata, nel portachiavi come
   profilo `pizzamanager-api`.
3. **Un PAT fine-grained** con `contents: write` su
   `JackGrieco/PizzaManager-releases` ✅ fatto il 2026-10-08, **scade il
   4 ottobre 2027**: quando scade la release fallisce e il motivo non è ovvio,
   quindi la procedura sta in [`../rilasci/rinnovo-token.md`](../rilasci/rinnovo-token.md).
4. **I secret nel repo del codice** ✅ tutti e sei installati il 2026-10-08:
   `PUBLIC_RELEASE_TOKEN`, `MAC_CSC_LINK` (il `.p12` in base64),
   `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER`.

## Fuori scope

- **Firma Windows**: altro certificato, altra spesa, e SmartScreen resta
  scettico finché non accumula reputazione.
- **Aggiornamento automatico**: il secondo branch del piano 18. Ora è
  possibile (i `latest-*.yml` finiscono già nel repo pubblico a ogni release),
  ma è un'altra cosa: `electron-updater` nell'app e il banner «Riavvia».
- **Il dominio**: non serve a niente di tutto questo. Se arriva, il sito può
  linkare gli asset o si passa a `provider: generic`; la firma vale comunque.

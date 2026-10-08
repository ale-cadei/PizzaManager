# I secret che servono alla release

Vanno in **`ale-cadei/PizzaManager`** (il repo del codice, dove gira il
workflow): *Settings → Secrets and variables → Actions → New repository
secret*.

**Li può aggiungere solo `ale-cadei`.** Quel repo è sotto un account
personale, e lì i ruoli granulari non esistono: un collaboratore ha accesso in
scrittura, l'unico admin è il proprietario. Admin/Maintain/Triage esistono solo
per i repo di un'organizzazione — se un giorno il progetto si trasferisce in
`digitiamosrl`, questo vincolo cade.

Finché non ci sono, il workflow **non fallisce**: costruisce i pacchetti senza
firmarli e senza notarizzarli (le guardie in `release.yml` sono scritte per
questo). Semplicemente il `.dmg` torna a dare l'avviso «è danneggiato».

## Notarizzare: due strade, serve una sola

La **chiave API** di App Store Connect è quella consigliata (revocabile da
sola, non è la password di nessuno), ma su un account **individuale** l'accesso
all'API **va richiesto e Apple lo approva quando vuole**: la pagina dice
«organization will be given first access followed by individuals». Non è
qualcosa su cui si può contare per uscire con una release.

Quindi: si chiede l'accesso e intanto si usa una **app-specific password**
(appleid.apple.com → *Sign-In and Security* → *App-Specific Passwords*), che si
crea in due clic. `electron-builder` guarda prima la chiave API e poi questa,
quindi il giorno in cui l'accesso arriva basta aggiungere i tre secret della
chiave e la password smette di essere usata, senza toccare il workflow.

## I valori



| Secret | Cos'è | Da dove viene |
|---|---|---|
| `PUBLIC_RELEASE_TOKEN` | PAT fine-grained, `contents: write` **solo** su `JackGrieco/PizzaManager-releases` | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained |
| `MAC_CSC_LINK` | il certificato *Developer ID Application* esportato in `.p12`, **in base64** | Accesso Portachiavi → Esporta |
| `MAC_CSC_KEY_PASSWORD` | la password scelta esportando il `.p12` | la inventi tu |
| `APPLE_ID` | l'indirizzo dell'Apple ID dello sviluppatore | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password, formato `abcd-efgh-ijkl-mnop` | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | l'identificativo del team: **`CBRAP62CDG`** | è fra parentesi nel nome del certificato |

E, **solo quando Apple concederà l'accesso all'API**, questi tre al posto dei
precedenti:

| Secret | Cos'è |
|---|---|
| `APPLE_API_KEY_P8` | il contenuto del file `.p8`, righe `BEGIN`/`END` comprese |
| `APPLE_API_KEY_ID` | il *Key ID* della chiave (es. `A1B2C3D4E5`) |
| `APPLE_API_ISSUER` | l'*Issuer ID*, uno per tutto l'account (un UUID) |

I primi due servono a **firmare**, il gruppo Apple a **notarizzare**, il PAT a
**pubblicare** nel repo pubblico. Senza le credenziali di notarizzazione il
build va avanti firmato ma non notarizzato; senza il PAT il caricamento dei
pacchetti fallisce.

## Copiarli senza stamparli

Un segreto incollato in un terminale resta nella cronologia della shell, nei
log di una sessione, e in qualsiasi trascrizione di chi stava guardando. Si
passa dagli appunti:

```sh
# MAC_CSC_LINK (il .p12 in base64)
base64 -i ~/percorso/PizzaManager-DeveloperID.p12 | pbcopy

# APPLE_API_KEY_P8, il giorno in cui ci sara' (il file intero)
pbcopy < ~/percorso/AuthKey_A1B2C3D4E5.p8
```

Gli altri valori si copiano dalla pagina da cui vengono.

**In locale non serve passare da nessun secret**: `xcrun notarytool
store-credentials <nome> --apple-id <email> --team-id CBRAP62CDG` chiede la
password in un prompt e la mette nel portachiavi. Da lì il build la usa con
`APPLE_KEYCHAIN_PROFILE=<nome>`, e la password non compare mai in una riga di
comando, in una cronologia della shell o in una trascrizione.

**Come consegnarli ad `ale-cadei`**: un elemento condiviso di un gestore di
password, o un file cifrato con la password su un canale diverso. Mai in un
messaggio di chat o in una mail: resterebbero lì per sempre, e con il `.p12`
chi li ha può firmare applicazioni a nome dell'account Apple che li ha emessi.

Da sapere: la pagina dell'API di App Store Connect dice a chiare lettere «you
may not share authorization credentials with anyone outside your team», e
l'accordo di licenza dice lo stesso dell'identità di firma. Se chi incolla i
secret non è nel team Apple, è un passaggio che va contro quelle condizioni —
non un problema tecnico, una cosa da sapere. Le alternative, se un giorno pesa:
trasferire il repo in `digitiamosrl` (dove i ruoli esistono e i secret li mette
chi fa le release), oppure assemblare la release dal Mac di chi firma, senza
secret.

## Quando scadono

- il **PAT** ha una scadenza scelta alla creazione: quando scade, il
  caricamento dei pacchetti fallisce con un errore che non dice il perché.
  Scadenza impostata: _da annotare qui alla creazione_;
- il **certificato Developer ID** dura 5 anni;
- la **app-specific password** non scade, ma si revoca da appleid.apple.com e
  decade se si cambia la password dell'Apple ID;
- la **chiave di App Store Connect**, quando ci sarà, non scade ma si revoca.

## Se il certificato si perde

La chiave privata del Developer ID esiste **solo sul Mac che l'ha creata**:
Apple non la ridà. Il `.p12` esportato è l'unica copia — va in un posto che
sopravvive al disco. Senza, il certificato si rifà da zero (e Apple ne concede
pochi per account).

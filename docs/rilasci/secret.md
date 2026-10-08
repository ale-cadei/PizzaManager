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

## Notarizzare: si usa la chiave API

L'accesso all'API di App Store Connect **è stato concesso il 2026-10-08** e la
chiave è attiva (`A6LD5BA326`), validata e salvata nel portachiavi. È la strada
da usare: revocabile da sola senza toccare l'account, e non muore quando si
cambia la password dell'Apple ID.

Resta documentata anche la **app-specific password** come ripiego, perché è ciò
che si usa se la chiave viene revocata e serve rilasciare subito.
`electron-builder` e `scripts/notarize-dmg.js` guardano **prima** la chiave API
e poi la password: se ci sono entrambe vince la chiave, senza modificare nulla.

Una chiave **non si può modificare dopo la creazione** per aggiungere servizi
(lo dice la pagina di Apple). Se servisse altro, si crea una chiave nuova: ne
sono ammesse 50 attive.

## I valori

| Secret | Cos'è | Da dove viene |
|---|---|---|
| `PUBLIC_RELEASE_TOKEN` | PAT fine-grained, `contents: write` **solo** su `JackGrieco/PizzaManager-releases` | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained |
| `MAC_CSC_LINK` | il certificato *Developer ID Application* esportato in `.p12`, **in base64** | Accesso Portachiavi → Esporta |
| `MAC_CSC_KEY_PASSWORD` | la password scelta esportando il `.p12` | la inventi tu |
| `APPLE_API_KEY_P8` | il contenuto del file `.p8`, righe `BEGIN`/`END` comprese | il file scaricato alla creazione della chiave |
| `APPLE_API_KEY_ID` | il *Key ID*: **`A6LD5BA326`** | la colonna accanto alla chiave |
| `APPLE_API_ISSUER` | l'*Issuer ID*, uno per tutto l'account | sopra la tabella delle chiavi |

Il ripiego, **solo** se la chiave viene revocata:

| Secret | Cos'è |
|---|---|
| `APPLE_ID` | l'indirizzo dell'Apple ID dello sviluppatore |
| `APPLE_APP_SPECIFIC_PASSWORD` | formato `abcd-efgh-ijkl-mnop`, da appleid.apple.com |
| `APPLE_TEAM_ID` | l'identificativo del team: **`CBRAP62CDG`** |

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

# APPLE_API_KEY_P8 (il file intero)
pbcopy < ~/percorso/AuthKey_A6LD5BA326.p8
```

Il `.p8` è una chiave privata: va tenuto **fuori dal repo** e con permessi
`600`. Appena scaricato è `644`, cioè leggibile da qualunque utente della
macchina.

Gli altri valori si copiano dalla pagina da cui vengono.

**In locale non serve passare da nessun secret.** Il profilo
`pizzamanager-api` è già nel portachiavi, creato così:

```sh
xcrun notarytool store-credentials pizzamanager-api \\
  --key ~/percorso/AuthKey_A6LD5BA326.p8 \\
  --key-id A6LD5BA326 --issuer <issuer-id>
```

e il build lo usa con `APPLE_KEYCHAIN_PROFILE=pizzamanager-api`. Con la chiave
il comando non è interattivo; con la app-specific password invece chiede la
password in un prompt, **e va lanciato da un Terminale vero**: da un comando
senza stdin interattivo manda una password vuota e Apple risponde `401`.

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
- la **chiave di App Store Connect** non scade, ma si revoca e non si può
  modificare dopo la creazione;
- la **app-specific password** (il ripiego) non scade, ma decade se si cambia
  la password dell'Apple ID — e la release inizierebbe a fallire con un errore
  di autenticazione che non dice «è scaduta la password».

## Se il certificato si perde

La chiave privata del Developer ID esiste **solo sul Mac che l'ha creata**:
Apple non la ridà. Il `.p12` esportato è l'unica copia — va in un posto che
sopravvive al disco. Senza, il certificato si rifà da zero (e Apple ne concede
pochi per account).

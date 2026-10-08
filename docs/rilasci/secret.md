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

## I sei valori

| Secret | Cos'è | Da dove viene |
|---|---|---|
| `PUBLIC_RELEASE_TOKEN` | PAT fine-grained, `contents: write` **solo** su `JackGrieco/PizzaManager-releases` | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained |
| `MAC_CSC_LINK` | il certificato *Developer ID Application* esportato in `.p12`, **in base64** | Accesso Portachiavi → Esporta |
| `MAC_CSC_KEY_PASSWORD` | la password scelta esportando il `.p12` | la inventi tu |
| `APPLE_API_KEY_P8` | il contenuto del file `.p8` della chiave App Store Connect, righe `BEGIN`/`END` comprese | appstoreconnect.apple.com → Users and Access → Integrations → Keys |
| `APPLE_API_KEY_ID` | il *Key ID* della stessa chiave (es. `A1B2C3D4E5`) | la colonna accanto alla chiave |
| `APPLE_API_ISSUER` | l'*Issuer ID*, uno per tutto l'account (un UUID) | sopra la tabella delle chiavi |

I primi tre servono a **firmare**, il quarto e il quinto e il sesto a
**notarizzare**, il PAT a **pubblicare** nel repo pubblico. Senza i due gruppi
Apple il build va avanti non firmato; senza il PAT il caricamento dei pacchetti
fallisce.

## Copiarli senza stamparli

Un segreto incollato in un terminale resta nella cronologia della shell, nei
log di una sessione, e in qualsiasi trascrizione di chi stava guardando. Si
passa dagli appunti:

```sh
# MAC_CSC_LINK (il .p12 in base64)
base64 -i ~/percorso/PizzaManager-DeveloperID.p12 | pbcopy

# APPLE_API_KEY_P8 (il file intero)
pbcopy < ~/percorso/AuthKey_A1B2C3D4E5.p8
```

`APPLE_API_KEY_ID`, `APPLE_API_ISSUER` e `PUBLIC_RELEASE_TOKEN` si copiano
dalla pagina da cui vengono.

**Come consegnarli ad `ale-cadei`**: un elemento condiviso di un gestore di
password, o un file cifrato con la password su un canale diverso. Mai in un
messaggio di chat o in una mail: resterebbero lì per sempre, e con il `.p12`
chi li ha può firmare applicazioni a nome dell'account Apple che li ha emessi.

## Quando scadono

- il **PAT** ha una scadenza scelta alla creazione: quando scade, il
  caricamento dei pacchetti fallisce con un errore che non dice il perché.
  Scadenza impostata: _da annotare qui alla creazione_;
- il **certificato Developer ID** dura 5 anni;
- la **chiave di App Store Connect** non scade, ma si può revocare.

## Se il certificato si perde

La chiave privata del Developer ID esiste **solo sul Mac che l'ha creata**:
Apple non la ridà. Il `.p12` esportato è l'unica copia — va in un posto che
sopravvive al disco. Senza, il certificato si rifà da zero (e Apple ne concede
pochi per account).

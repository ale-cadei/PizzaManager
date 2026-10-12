# Come si rilascia PizzaManager

Documento per chi fa una release, o per chi deve capire cosa succede quando
qualcuno la fa. Scritto dopo la 1.1.0, cioè dopo aver sbagliato tre volte: le
trappole qui dentro sono tutte successe davvero.

---

## 1. I tre oggetti che si confondono

- **commit** — una modifica al codice. Se ne fanno decine al giorno.
- **tag** — un'etichetta su *un* commit (`v1.2.0`). Non costruisce niente:
  dice «questo punto della storia ha un nome».
- **release** — una *pagina* su GitHub legata a un tag, con dei file allegati
  (gli *asset*) e un testo. È l'unica delle tre che un utente vede.

**L'aggiornamento automatico guarda le release, non i commit.** È il motivo per
cui non si può «aggiornare a ogni push»: servirebbe una release per push, cioè
tre runner e due invii ad Apple ogni volta che si mergia.

## 2. Due repository, e perché

| | |
|---|---|
| **`ale-cadei/PizzaManager`** (privato) | il codice. Qui si lavora, qui gira il workflow |
| **`JackGrieco/PizzaManager-releases`** (pubblico) | **solo** le release. Un commit in tutto: il README con la tabella dei download |

I pacchetti sono *release asset*, non file di quel repo: **là non finisce una
riga di sorgente**, e non si pusha niente da un repo all'altro. È il workflow
che, al tag, carica i file dall'altra parte con un token.

Serve un repo pubblico perché l'aggiornamento automatico scarica un file
**senza autenticazione**. L'alternativa sarebbe mettere un token dentro l'app
distribuita, cioè regalarlo a chi la scarica.

## 3. Fare una release

```sh
# 1. da main aggiornato e con la suite verde
git checkout main && git pull
npm run test:unit

# 2. alza la versione: aggiorna package.json, fa il commit e crea il tag
npm version minor      # 1.1.0 → 1.2.0   (funzionalità nuove)
npm version patch      # 1.1.0 → 1.1.1   (solo correzioni)

# 3. manda su commit e tag: è il tag che accende tutto
git push --follow-tags
```

Poi si aspetta il workflow (~15 minuti) e si pubblica la bozza:

```sh
gh run list --workflow=release.yml --limit 1          # deve essere verde
gh release view v1.2.0 --repo JackGrieco/PizzaManager-releases
gh release edit v1.2.0 --repo JackGrieco/PizzaManager-releases \
  --draft=false --notes-file docs/rilasci/v1.2.0.md
```

Le **note** si scrivono a mano in `docs/rilasci/v<versione>.md` prima di
pubblicare. Non si generano da sole: `gh release --generate-notes` legge i
commit del repo in cui crea la release, e là ci sono solo quelli del README.
Su un repo pubblico la pagina della release *è* la pagina del prodotto: vuota
sembra abbandonata.

## 4. Cosa fa il workflow

```
tag v*  (oppure «Run workflow» a mano)
   │
   ├─ job "draft"     crea la bozza di Release sul repo PUBBLICO
   │                  è il primo punto di rottura utile: se il token è
   │                  scaduto si ferma qui, prima di costruire niente
   │
   └─ job "build"     tre runner in parallelo
         macOS arm64 ─┐  portachiavi → electron-builder → firma app →
         macOS x64   ─┤  notarizza app → costruisce dmg → firma dmg →
                      │  notarizza dmg → francobollo → carica
         Linux       ─┘  costruisce e carica
                         │
                         └─ su macOS: RISCARICA l'asset dalla Release
                            e verifica che Gatekeeper lo accetti
   │
   └─ una persona apre la bozza, incolla le note, pubblica
```

Tre runner perché `node-pty` è un modulo nativo: si compila sul sistema di
destinazione, non si cross-builda. **Windows è fuori** per un difetto suo
(vedi §8).

### Il cancello manuale è la cosa importante

Finché la release è **bozza** non esiste per nessuno: né i link di download,
né l'aggiornamento automatico la vedono. Il momento in cui si preme *Publish*
è il momento in cui la versione raggiunge le persone. È lì che si guarda che i
file ci siano tutti e che il job non sia rosso.

## 5. I file di una release

Dodici file, ma da scaricare ce ne sono tre.

**Per le persone:**

| Hai | Scarica |
|---|---|
| Mac Apple Silicon | `PizzaManager-mac-arm64.dmg` |
| Mac Intel | `PizzaManager-mac-x64.dmg` |
| Linux | `PizzaManager-linux-x86_64.AppImage` (o il `.deb`) |

**Per l'aggiornamento automatico** (non si toccano, non si cancellano):

- `latest-mac.yml`, `latest-linux.yml` — versione, nome del file e checksum.
  È l'unica cosa che l'app scarica a ogni controllo;
- i `.zip` — su macOS l'aggiornamento passa da qui, non dal `.dmg`;
- i `.blockmap` — permettono di scaricare solo i pezzi cambiati invece di
  100 MB interi.

GitHub aggiunge da sé «Source code (zip/tar.gz)»: nel nostro caso contengono
il README del repo pubblico, non il codice. Non si possono togliere.

## 6. L'aggiornamento automatico, dal lato di chi usa l'app

All'avvio (dopo 10 secondi) e poi ogni 4 ore, l'app scarica il manifesto dal
repo pubblico e confronta la versione con la propria. Se è più nuova, **scarica
in background** e mostra il banner **quando ha già finito**: «La versione 1.2.0
è pronta — Riavvia ora». Il riavvio dura due secondi, perché il pacchetto è
già sul disco.

Su Mac e Linux le sessioni sopravvivono al riavvio e si riattaccano da sole
(è il backend tmux), quindi chiudere non costa niente.

Tre casi in cui non si aggiorna da sé:

- **in sviluppo** (`npm start`): non controlla nemmeno;
- **installato da `.deb`**: lì lo fa `apt`. Il banner avvisa e apre la pagina;
- **Windows**: non c'è ancora un pacchetto.

> ⚠️ **Chi ha la 1.1.0 non si aggiornerà da solo alla 1.2.0.** La 1.1.0 non
> contiene il codice dell'aggiornamento: quello arriva *con* la 1.2.0. Dalla
> 1.2.0 in poi funziona. Quindi la 1.2.0 va annunciata a voce, ed è l'ultima
> volta che serve farlo.

## 7. Chi può fare cosa

| Cosa | Chi |
|---|---|
| Taggare e far partire il workflow | chi ha push sul repo del codice |
| Installare i secret | chi ha accesso in scrittura — **non serve essere il proprietario** |
| Firmare e notarizzare | serve il certificato *Developer ID* nel portachiavi di chi lo possiede; sul CI arriva dai secret |
| Pubblicare la bozza | chi ha accesso al repo pubblico |

I sei secret e come si preparano: [`secret.md`](secret.md). Il token scade il
**4 ottobre 2027**, e la procedura per rifarlo è in
[`rinnovo-token.md`](rinnovo-token.md).

## 8. Quando qualcosa va storto

| Sintomo | Causa vera |
|---|---|
| Il job `draft` risponde `404` o `403` | il **token** è scaduto. GitHub dice «not found» invece di «non hai il permesso»: su un repo pubblico che esiste di sicuro, quel 404 vuol dire token → [`rinnovo-token.md`](rinnovo-token.md) |
| `SecKeychainUnlock: passphrase not correct` | **non** è la password sbagliata. È un difetto di electron-builder, già aggirato: il portachiavi lo prepara il workflow → [piano 44](../plans/44-release-firmata.md) |
| `RC2-40-CBC unsupported` provando il `.p12` | nemmeno questa è una password sbagliata: è OpenSSL 3 che rifiuta l'algoritmo del Portachiavi. Serve `openssl pkcs12 -legacy …` |
| Job verde ma il `.dmg` scaricato dà «è danneggiato» | era il gancio sbagliato, già corretto: il file veniva caricato 50 ms prima di essere firmato. Per questo il workflow ora **riscarica l'asset e lo verifica** |
| Il pacchetto Windows non si costruisce | `pwsh` spezza `-c.npmRebuild=false`. Correzione probabile: `shell: bash`. Da provare su una macchina Windows → [piano 40](../plans/40-windows-sessioni-persistenti.md) |
| **Un job non parte proprio**: zero passi eseguiti, muore in pochi secondi, e nelle sue annotazioni c'è «*payments have failed or your spending limit needs to be increased*» | **Sono finiti i minuti di Actions del mese.** Non è un difetto nostro e non c'è niente da aggiustare nel codice → §10 qui sotto |

### Verificare a mano un pacchetto macOS

```sh
spctl -a -vvv -t open --context context:primary-signature <file.dmg>
  # atteso: accepted, source=Notarized Developer ID
syspolicy_check distribution <file.dmg>
  # atteso: App passed all pre-distribution checks and is ready for distribution
xcrun stapler validate <file.dmg>
  # atteso: The validate action worked!
```

**Sempre sul file scaricato dalla release**, non su quello costruito in
locale: la differenza fra i due è esattamente il difetto che ci è sfuggito.

## 9. Quanto costa una release (e perché può fermarsi)

`ale-cadei/PizzaManager` è **privato**, quindi le sue Actions consumano i
minuti del piano di chi possiede il repo: 2000 al mese sul piano gratuito. E
i minuti non valgono tutti uguale — è questo che sorprende:

| Runner | Moltiplicatore |
|---|---|
| Linux | ×1 |
| Windows | ×2 |
| **macOS** | **×10** |

Una release costa circa **66 minuti fatturati**: ~6 reali di macOS (che ne
valgono 60), più Linux e la bozza. Fanno circa **28 release al mese**, che è
molto più di quanto serva — ma il 9 ottobre 2026 i minuti sono finiti lo
stesso: sei release in un giorno, la CI che gira due volte per ogni merge
(una sulla PR, una sul push a `main`) e un job Windows rotto che restava
appeso sei ore contando doppio. Da lì in poi **nessun job è più partito**,
nemmeno su Linux.

Il repo pubblico delle release non c'entra: è pubblico, quindi le sue Actions
sono gratis, cron delle segnalazioni compreso.

**Cosa fare quando succede.** Niente panico sui soldi: il tetto di spesa è a
zero di default, quindi GitHub *blocca* invece di addebitare — il fatto che i
job si fermino è la prova che non si sta spendendo. L'allocazione riparte al
rinnovo del piano, che non è il primo del mese ma il giorno in cui il piano è
stato aperto (si legge su <https://github.com/settings/billing/usage>, pagina
del proprietario del repo).

Se una release serve prima, **si costruisce in locale**: il pacchetto macOS
si fa sulla macchina di chi ha il certificato *Developer ID* nel portachiavi e
la chiave di notarizzazione. Tre avvertenze, tutte già costate care una volta:

1. va passato `--config.extraMetadata.buildFrom=release`, altrimenti l'app
   costruita **non si aggiornerà mai più da sola** e non lo dice (§6);
2. il manifesto deve elencare uno zip per **ogni** architettura: a mano quella
   guardia non c'è, e un `latest-mac.yml` sbagliato manda gli arm64 a
   scaricare la build Intel;
3. si verifica Gatekeeper sull'asset **riscaricato dalla Release**, non sul
   file locale.

## 10. Ogni quanto rilasciare

Quando c'è qualcosa che si vuole far avere agli altri — non a ogni merge. Ogni
release costa tre runner e due invii ad Apple, e una bozza da pubblicare a
mano. Con l'aggiornamento automatico in piedi, però, rilasciare costa poco a
*chi riceve*: non deve più sapere che esiste una versione nuova.

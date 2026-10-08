# Rinnovare il token della release

> **Scade il 4 ottobre 2027.** Creato il 2026-10-08.

Questo file serve a una persona che fra un anno non ricorda niente di tutto
questo e ha una release che non parte. Si legge dall'inizio.

## Di che token si parla

`PUBLIC_RELEASE_TOKEN`, un *personal access token* fine-grained salvato fra i
secret di **`ale-cadei/PizzaManager`** (il repo del codice, dove gira il
workflow). Serve a una cosa sola: permettere al workflow di caricare i
pacchetti su **`JackGrieco/PizzaManager-releases`**, il repo pubblico che
contiene solo le Release.

Serve un token perché il `GITHUB_TOKEN` che GitHub dà a ogni workflow vale
**solo per il repo che lo esegue**: non scrive da nessun'altra parte. Vedi
[`secret.md`](secret.md) per il quadro completo e
[`../plans/44-release-firmata.md`](../plans/44-release-firmata.md) per il
perché dei due repo.

## Come si riconosce che è scaduto

Il sintomo non dice «il token è scaduto», e questo è il motivo per cui esiste
questo file.

- **GitHub manda una mail** qualche giorno prima della scadenza. È l'unico
  avviso gentile che arriva.
- Dopo la scadenza, al primo tag `v*` il workflow `release` **fallisce nel job
  `draft`**, prima di costruire qualsiasi cosa: `gh release view/create` sul
  repo pubblico risponde `HTTP 404` oppure `HTTP 403`.
  - **Il `404` inganna**: GitHub risponde «not found» invece di «non hai il
    permesso» per non rivelare l'esistenza delle risorse. Con un repo pubblico
    che esiste di sicuro, un 404 da quel job vuol dire **token**, non repo.
- Se la scadenza capita fra il job `draft` e i build, falliscono invece i
  quattro job di build al momento del caricamento.

**Quello che NON succede**: i pacchetti non vengono pubblicati a metà. Il job
`draft` gira prima di tutto proprio per questo.

## Rifarlo — la via breve

Un token fine-grained si può **rigenerare** conservando configurazione e
permessi, senza rifare le scelte:

1. **github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens**
2. clicca il token (si chiama come l'avevi chiamato alla creazione)
3. **Regenerate token**, scegli la nuova scadenza
4. copia il valore: **si vede una volta sola**

## Rifarlo da zero

Se il token è stato cancellato, o non si trova:

1. stessa pagina → **Generate new token**
2. **Token name**: qualcosa che si riconosca fra un anno, es.
   `PizzaManager release → repo pubblico`
3. **Resource owner**: `JackGrieco` — è l'account che possiede il repo
   pubblico. Se metti un'organizzazione il token non vedrà quel repo.
4. **Expiration**: la scadenza massima che ti concede. Poi **torna qui e
   aggiorna la data in testa a questo file.**
5. **Repository access** → *Only select repositories* →
   `PizzaManager-releases`. Non *All repositories*: questo token deve poter
   fare una cosa sola.
6. **Permissions → Repository permissions → Contents** → **Read and write**.
   È l'unico permesso necessario: le Release e i loro asset stanno sotto
   *Contents*. Non servono *Actions*, *Workflows*, *Metadata* (quest'ultimo
   viene aggiunto da GitHub in sola lettura, è normale).
7. **Generate token** e copia il valore.

## Installarlo

Da un Terminale vero (il comando chiede il valore e non lo mostra):

```sh
gh secret set PUBLIC_RELEASE_TOKEN --repo ale-cadei/PizzaManager
```

Poi controlla che la data di aggiornamento sia di oggi:

```sh
gh secret list --repo ale-cadei/PizzaManager
```

## Verificarlo senza fare una release

Un giro di release costa quattro runner e due invii ad Apple. Il token si
prova in due secondi, con il valore nuovo negli appunti:

```sh
# lettura: deve rispondere con i permessi, e admin dev'essere true
GH_TOKEN="$(pbpaste)" gh api repos/JackGrieco/PizzaManager-releases -q '.permissions'

# scrittura: crea una bozza finta e la cancella subito
GH_TOKEN="$(pbpaste)" gh release create prova-token --repo JackGrieco/PizzaManager-releases \
  --draft --title "prova" --notes ""
GH_TOKEN="$(pbpaste)" gh release delete prova-token --repo JackGrieco/PizzaManager-releases --yes
```

Se la prima risponde `404`, il token non vede il repo: hai sbagliato
*Resource owner* o *Repository access* al passo 3 o 5. Se la prima passa e la
seconda dà `403`, manca *Contents: read and write* (passo 6).

Una bozza non è visibile a chi non ha accesso al repo, quindi la prova non
mostra niente a nessuno. Cancellala comunque.

## Quando ci sei

Mentre sei in zona, due cose che scadono o si revocano e che si rompono nello
stesso modo silenzioso:

- il **certificato Developer ID** dura 5 anni — emesso nel 2026, quindi fino
  al 2031. Alla scadenza i pacchetti già firmati restano validi (c'è il
  timestamp), ma non se ne firmano di nuovi;
- la **chiave di App Store Connect** (`A6LD5BA326`) non scade, ma si può
  revocare. Se qualcuno la revoca, la notarizzazione fallisce e il
  [ripiego](secret.md) è una app-specific password.

Tutte e tre le scadenze stanno in [`secret.md`](secret.md).

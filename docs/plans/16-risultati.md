# 16 — Risultati dello spike

## ESITO: sì, si può. `GET https://api.anthropic.com/api/oauth/usage`

Autenticazione: `Authorization: Bearer <accessToken>` da
`~/.claude/.credentials.json` (chiave `claudeAiOauth`). Nessun header beta
necessario. Risposta:

```json
{"five_hour":{"utilization":10.0,"resets_at":"2026-09-21T18:30:00+00:00",
              "limit_dollars":null,"used_dollars":null,"locked_reason":null},
 "seven_day":{"utilization":5.0,"resets_at":"2026-09-25T02:00:00+00:00", ...},
 "extra_usage":{"is_enabled":false, ...}, ...}
```

`utilization` è la percentuale (0-100), `resets_at` un ISO 8601. Sono gli stessi
due numeri del pannello `/usage`, quindi **lato server e sincronizzati fra
dispositivi**: è esattamente ciò che manca alla calibrazione del piano 15.

Note per il piano 17:
- La risposta porta molti campi sperimentali (`nimbus_quill`, `tangelo`,
  `iguana_necktie`…), quasi tutti `null`. Leggere **solo** `five_hour` e
  `seven_day`, ignorare il resto: cambieranno senza preavviso.
- Endpoint non documentato. Va trattato come tale: qualunque errore ricade
  sulla calibrazione, senza svuotare la barra.
- Chiamato senza token risponde `429`, non `401`. Un `429` quindi **non**
  significa per forza «troppe chiamate»: può essere un token mancante.
- `/api/oauth/profile` esiste (`401` senza token); gli altri path provati
  (`/api/claude_cli/usage`, `/api/claude_code/usage`, `/api/usage`) danno `404`.

## Come ci si è arrivati

Stato della prima tornata: **parziale**. Una via a costo zero esiste ma non porta la percentuale;
la prova decisiva (chiamata HTTP) non è eseguibile da qui, serve un comando
lanciato a mano.

## 1. Via ufficiale: `/usage` in modalità print — funziona, ma non basta

```
claude -p "/usage" --output-format json
```

- Gira **in locale**: `num_turns: 0`, `duration_api_ms: 0`, `total_cost_usd: 0`,
  143 ms. Nessun token consumato: si potrebbe chiamare spesso.
- Ma il `result` contiene **solo** la sezione «What's contributing to your
  limits usage»: richieste e sessioni delle ultime 24h e 7g, percentuali di
  contesto >150k, top skill e plugin. Dichiara pure che è
  «approximate, based on local sessions on this machine».
- **Le percentuali di quota non ci sono.** Quelle che si vedono in interattivo
  (`8%`) non compaiono nell'output print.

Provato anche `claude -c -p "/usage"`, cioè continuando una sessione che aveva
già fatto chiamate vere: output **identico**, sempre senza percentuali. Quindi
non è questione di sessione fredda. La via «esegui `/usage` e leggi il
risultato» è chiusa: `/usage` è un rendering di due dati diversi, e in print
esce solo quello locale.

Altro provato: nessun sottocomando `usage` (`claude --help` → agents, auth,
auto-mode, doctor, gateway, install, mcp, plugin, project, setup-token,
ultrareview, update). `/status` risponde «isn't available in this environment».

## 2. Da dove arriva allora quell'8%

Non da disco (già verificato nel piano 15) e non dal comando locale. Restano
due ipotesi, e distinguerle è il cuore del resto dello spike:

- **A: header di risposta.** L'API risponde alle normali chiamate con header
  tipo `anthropic-ratelimit-unified-*`; il client li tiene in memoria e `/usage`
  li mostra. Se è così **non esiste un endpoint da interrogare**: per avere il
  numero bisognerebbe fare una chiamata vera, cioè spendere quota per misurarla.
  Sarebbe un no secco all'integrazione.
- **B: endpoint dedicato** interrogato all'avvio della sessione. In questo caso
  l'integrazione è possibile, con cache lunga.

**Vince B, e c'è la prova.** In fondo al pannello `/usage` interattivo compare
«Could not refresh usage data · **r to retry**». Un dato che si ricarica
premendo un tasto, senza mandare nessun prompt, non può essere un header di
risposta di una chiamata a pagamento: è una richiesta dedicata, fatta all'avvio
del pannello e ripetibile. Il pannello mostra `Current session N% used` con
`Resets 8:30pm` e `Current week (all models) N% used` con `Resets Sep 25, 4am`:
le due finestre e i due reset che servono a noi, già pronti.

Ne esce anche l'esperimento pulito per trovare l'endpoint: aprire `/usage` in
interattivo e premere `r` mentre si osserva il traffico. In quel momento
l'unica richiesta in volo è quella della quota.

**Che sia server-side, però, è certo**: la percentuale di `/usage` è coerente
fra dispositivi diversi che usano lo stesso account, e un numero sincronizzato
non può uscire dai log di una macchina. Lo conferma l'output print stesso, che
marca la *sua* sezione come «based on local sessions on this machine — does not
include other devices or claude.ai»: la disclaimer c'è dove il dato è locale, e
manca dove il dato è la quota. È anche il limite noto della calibrazione del
piano 15, che resta per macchina.

## 3. Cosa non ha funzionato, e perché non è una risposta

- `claude --debug api -p "ok"` e `claude --debug -p "ok"`: nessuna riga di
  traffico API nell'output. Le categorie di debug non sembrano stampare le
  richieste in modalità print.
- `curl` verso tre endpoint ipotizzati (`/api/oauth/usage`, `/api/oauth/profile`,
  `/api/claude_code/usage`) con il token OAuth locale: **HTTP `000` su tutti e
  tre**, cioè connessione non stabilita. Non è un 404: è l'ambiente in cui giro
  che non ha rete. Le tre ipotesi restano non verificate.

## 3-bis. Come si legge il path senza TLS

`ANTHROPIC_BASE_URL` fa parlare il client in chiaro con un listener locale, che
logga **solo metodo e path** (mai gli header: lì dentro c'è il token). Provato,
funziona: `node /tmp/sniff.js &` e
`ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude -p "ok"` producono

```
HEAD /api/hello
POST /v1/messages?beta=true
```

In print mode la quota non compare, coerente col resto: il pannello non si apre.
Va rifatto **in interattivo** (`/usage`, tasto `r`), dove la chiamata parte.
Il listener risponde 500 a tutto: la sessione non funziona, ma il tentativo
basta a far comparire il path nel log.

## 4. Il prossimo passo, da lanciare a mano

Serve una sessione con rete. Due comandi, in questo ordine:

1. Osservare il traffico vero invece di indovinare:
   ```
   strace -f -e trace=connect -o /tmp/claude-connect.log claude -p "ok"
   ```
   oppure, meglio per vedere il path HTTP, un proxy locale (`mitmproxy`) con
   `HTTPS_PROXY` e `NODE_EXTRA_CA_CERTS`, mentre si esegue `/usage` in
   interattivo. Se compare una sola chiamata `/v1/messages` e nient'altro →
   ipotesi A confermata, spike chiuso con un no.
2. Se compare un path di quota, riprovare la sonda `curl` di sopra con
   l'Authorization presa da `~/.claude/.credentials.json` **senza stamparla**.

Regole del piano 16 in vigore: solo lettura del file credenziali, token mai nei
log né in questi appunti, nessun host oltre `anthropic.com`.

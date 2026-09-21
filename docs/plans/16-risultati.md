# 16 — Risultati dello spike (prima tornata)

Stato: **parziale**. Una via a costo zero esiste ma non porta la percentuale;
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

L'ipotesi A è la più probabile (spiega perché in print manca: nessuna chiamata
API fatta, quindi nessun header raccolto), ma non è dimostrata.

## 3. Cosa non ha funzionato, e perché non è una risposta

- `claude --debug api -p "ok"` e `claude --debug -p "ok"`: nessuna riga di
  traffico API nell'output. Le categorie di debug non sembrano stampare le
  richieste in modalità print.
- `curl` verso tre endpoint ipotizzati (`/api/oauth/usage`, `/api/oauth/profile`,
  `/api/claude_code/usage`) con il token OAuth locale: **HTTP `000` su tutti e
  tre**, cioè connessione non stabilita. Non è un 404: è l'ambiente in cui giro
  che non ha rete. Le tre ipotesi restano non verificate.

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

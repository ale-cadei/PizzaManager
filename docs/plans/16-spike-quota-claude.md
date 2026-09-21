# 16 — Spike: la quota vera di Claude, quella che mostra `/usage`

Branch: `spike/quota-claude`. Dipende da: 15 (la quota calibrata).
Taglia: ~3h. **È uno spike: produce una risposta, non una funzionalità.**

## La domanda

Il riquadro FINESTRA 5h oggi mostra una percentuale **calibrata** sul massimo
storico dell'utente (piano 15): 100% = «la tua peggiore finestra di sempre»,
non il limite del piano. `/usage` dentro Claude Code mostra invece la quota
vera. Quel numero non è su disco — verificato: nessun campo di quota nei
`.jsonl` di `~/.claude/projects`, nessuna cache in `~/.claude` — quindi il
client lo chiede ai server Anthropic con le credenziali OAuth.

**Si può chiedere anche noi, in modo stabile e lecito?**

Lo spike risponde sì/no con prove. Se sì, il piano 17 lo implementa; se no, la
calibrazione resta e la risposta è scritta qui per non rifare il giro.

## Cosa provare, in ordine

1. **Esiste una via ufficiale?** Prima di guardare dentro al client: `claude
   --help`, sottocomandi, flag tipo `--print`/`-p` con `/usage`, eventuale
   output JSON. Una via documentata vale dieci reverse engineering.
2. **Qual è la chiamata che fa il client.** Il CLI non è più JS leggibile: è un
   binario compilato (`~/.nvm/.../@anthropic-ai/claude-code/bin/claude.exe`,
   ~275 MB) e un `grep` con pattern complesso va in timeout. Approcci, dal meno
   invasivo:
   - `grep -a` con pattern **semplici** (`https://[a-z0-9.-]*anthropic[^ ]*`),
     che scorrono il file una volta sola;
   - osservare il traffico invece del binario: `strace -f -e trace=connect`, o
     un proxy HTTPS locale con `HTTPS_PROXY` se il client lo rispetta, mentre si
     esegue `/usage` a mano.
3. **Rispondere con le credenziali che ci sono già.** `~/.claude/.credentials.json`
   contiene il token OAuth dell'account. Provare la chiamata con `curl` e
   guardare: forma della risposta, se ci sono le due finestre (5h e settimana),
   se c'è il reset, quanto è stabile.
4. **Quanto spesso si può chiamare.** La barra si aggiorna ogni 8 secondi: un
   endpoint di quota non si interroga a quel ritmo. Capire se risponde con
   header di rate limit e decidere una cache (un minuto? cinque?).

## Cosa deve dire la risposta (in `16-risultati.md`)

- Endpoint, metodo, header necessari; forma della risposta.
- Se è documentato o dedotto. **Dedotto = fragile**: va detto quanto.
- Come si rinnova il token quando scade, e cosa succede alla barra se scade.
- Frequenza sostenibile.
- Comportamento con **più account** (`lib/accounts.js`): la quota è per
  account, e l'app ne gestisce più d'uno.
- Verdetto: vale il prezzo o no.

## Regole (questo spike tocca credenziali)

- **Il token non lascia il main process e non finisce nei log.** Vale la regola
  già scritta in CLAUDE.md per le API key: alla UI vanno numeri, mai segreti.
  Nei risultati dello spike si incolla la *forma* della risposta, mai il token.
- **Si chiama solo `anthropic.com`**, cioè il server dell'account dell'utente.
  Nessun terzo host, nessuna telemetria.
- **Solo lettura.** Lo spike non tocca, non rinnova e non riscrive
  `.credentials.json`: un file di credenziali corrotto costa un logout, e
  l'app ci gira sopra con gli account (`lib/accounts.js`).
- Niente codice di produzione in questo branch: uno script in `scripts/` o
  comandi a mano, e il file dei risultati. L'integrazione è il piano 17.

## Se la risposta è sì

Il posto dove innestarla esiste già: `lib/usage/aggregate.js:fiveHourQuota`
preferisce una quota dichiarata alla calibrazione (`limitKind: 'declared'`,
oggi alimentato dai `rate_limits` di Codex). Serve una sorgente in più che
produca lo stesso oggetto `{ usedPercent, windowMinutes, resetsAt }` per
`claude`, più una cache: la barra non deve chiamare la rete a ogni giro, e
quando la chiamata fallisce ricade sulla calibrazione invece di svuotarsi.

## Se la risposta è no

Resta il piano 15 e il tooltip che dichiara la stima. In quel caso vale la pena
valutare la strada piccola: un tetto scritto a mano nelle impostazioni, per chi
il proprio limite lo conosce.

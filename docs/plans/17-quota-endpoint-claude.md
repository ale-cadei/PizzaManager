# 17 — La quota vera di Claude nella barra

Branch: `feat/quota-endpoint-claude`. Dipende da: 15 (quota in token), 16 (spike).

## Perché

La stima calibrata del piano 15 legge i log di **questa** macchina: due
computer sullo stesso account hanno due tetti diversi e nessuno dei due vede
il totale che conta il fornitore. Lo spike 16 ha trovato il numero giusto:
`GET https://api.anthropic.com/api/oauth/usage`, autenticato col token OAuth
già presente in `~/.claude/.credentials.json`, restituisce `five_hour` e
`seven_day` con `utilization` e `resets_at`. È lo stesso dato del pannello
`/usage`, quindi sincronizzato fra dispositivi.

## Cosa cambia

- **FINESTRA 5h** su scheda Claude: percentuale del server (`limitKind:
  'declared'`), reset dal server. La calibrazione resta come rete di sicurezza.
- **SETTIMANA** segue lo stesso assistente della finestra di 5h: due quote di
  fornitori diversi affiancate non si sommano e non si confrontano.
- Codex invariato (dichiara già i suoi `rate_limits`), opencode invariato
  (nessuno dichiara niente: resta la calibrazione).

## Struttura

```
lib/usage/claude-quota.js    nuovo: legge il token, chiama l'endpoint, cache
lib/usage/aggregate.js       `declared` accetta più quote: vale quella
                             dell'assistente guardato
lib/usage/index.js           istanza condivisa, sceglie la quota per sorgente
tests/claude-quota.test.js   parsing, cache, errori (fetch iniettato)
tests/usage-quota-live.test.js  l'innesto dentro collectUsage
```

## Le regole che il codice rispetta

- **Il token non esce dal main process** e non finisce nei log né
  nell'oggetto restituito: si legge, si mette in un header, fine.
- **Cache di 5 minuti**, e dopo un errore si aspetta un minuto prima di
  riprovare. La barra si aggiorna ogni 8 secondi: senza cache sarebbe una
  chiamata di rete a ogni giro.
- **Un errore non svuota la barra**: si tiene l'ultimo numero buono, e se non
  ce n'è mai stato uno si ricade sulla stima calibrata. È ciò che fa il CLI
  quando scrive «could not refresh usage data».
- **Si leggono solo `five_hour` e `seven_day`.** La risposta porta una decina
  di campi sperimentali (`nimbus_quill`, `tangelo`, `iguana_necktie`…) quasi
  sempre `null`: cambieranno senza preavviso.
- **La rete si accende solo in produzione**: l'istanza condivisa nasce solo se
  arriva `limitsDir` (cioè se a chiamare è l'app). La suite non tocca la rete,
  e chi vuole provarla inietta `quota`. Un test lo verifica.
- **Endpoint non documentato**: può sparire. Quando succede la barra torna alla
  stima senza che nessuno debba accorgersene.

## Aperto

- Il file delle credenziali ha **un** token: l'app gestisce più account Claude
  (`lib/accounts.js`), e la quota mostrata è quella dell'account con cui il CLI
  è loggato adesso. Per ora coincide con quello che usano le sessioni; se
  cambia, va legato all'account della scheda.
- Senza token l'endpoint risponde `429`, non `401`: un `429` non prova che si
  stia chiamando troppo.

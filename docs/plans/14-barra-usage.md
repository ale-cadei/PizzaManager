# 14 — Barra dell'uso in basso

Branch: `feat/barra-usage`. Dipende da: niente (legge file già esistenti).
Taglia: ~1 g.

## Cosa si vede

Una barra in fondo **all'area del terminale**, non alla finestra: sta dentro
`<main>`, quindi parte dove finisce la sidebar. Parla della sessione in primo
piano, e sotto l'elenco delle sessioni non avrebbe niente da dire.

```
┌────────────┬────────────────────────────────────────────────────────────────┐
│  sessioni  │                        terminale                               │
│  (sidebar) ├────────────────────────────────────────────────────────────────┤
│            │ SESSIONE 58% ███░░ │ FINESTRA 5h 50% ██░░░ │ SETTIMANA —      │
└────────────┴────────────────────────────────────────────────────────────────┘
```

**Solo percentuali.** Ogni riquadro dice quanto e' pieno, con la percentuale e
una barra, e niente altro: un conteggio di token («8.4M») non ha una scala
addosso, quindi non risponde alla domanda. I numeri assoluti, l'ora del reset e
la ripartizione per agente stanno nel tooltip. Un divisore verticale separa le
tre metriche: sono tre finestre diverse, non una riga unica.

**Nessun costo in dollari.** La barra risponde a «quanto manca al limite», e i
limiti non sono in dollari: sono il contesto del modello, la finestra di 5 ore
e la settimana. I prezzi c'erano (`lib/usage/pricing.js`, un listino locale per
famiglia di modello) e sono stati tolti: mostravano una stima che nessuno usava
per decidere, e andavano aggiornati a mano a ogni cambio di listino. Se
servissero di nuovo, stanno nella storia di git di questo branch.

- **SESSIONE**: quanto e' pieno il **contesto dell'ultimo scambio** (token della
  richiesta sul limite del modello, `lib/usage/context-window.js`). E' l'unica
  quota della sessione con un tetto vero: i token consumati si accumulano
  all'infinito, quindi una barra su di essi avrebbe un denominatore inventato.
  Barra e percentuale spariscono — non vanno a zero — quando il contesto non e'
  calcolabile: modello fuori tabella, evento che e' gia' una somma di piu'
  messaggi (opencode aggrega per ora), scheda che e' una shell, conversazione
  non ancora abbinabile a un log. In quei casi il riquadro mostra `—`, e il
  tooltip dice perche' e quanti token ha speso la sessione.
- **FINESTRA 5h**: la **quota dichiarata dal CLI** se c'e' (`rate_limits` di
  Codex), altrimenti il **tempo trascorso** nella finestra — e il tooltip dice
  quale delle due, perche' sono due cose diverse. Fuori da una finestra aperta:
  `—`, non `0%`.
  **Superato dal piano 15**: il tempo trascorso si leggeva come consumo (79%
  sulla barra contro 8% di `/usage`). Ora la barra disegna i token su un tetto
  calibrato per assistente, e il tempo e' diventato «reset fra 1h 12m» accanto
  alla percentuale. Vedi [15-quota-token-5h.md](15-quota-token-5h.md).
- **SETTIMANA**: quota settimanale dichiarata da un CLI, su finestra mobile (il
  limite degli abbonamenti scorre con l'uso, non col calendario). Claude non la
  scrive da nessuna parte nei `.jsonl`: con il solo Claude il riquadro resta `—`
  e i token degli ultimi 7 giorni si leggono nel tooltip.

Tooltip di un riquadro: i token in cifre, l'ora o il countdown del reset, la
ripartizione per agente e le sorgenti che non hanno risposto.

## Da dove arrivano i numeri

| Agente | Sorgente | Cosa contiene |
|--------|----------|---------------|
| claude | `~/.claude/projects/<proj>/<id>.jsonl` | `message.usage` per risposta: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, più `message.model` |
| codex | `~/.codex/sessions/AAAA/MM/GG/rollout-*.jsonl` | eventi `token_count` con `last_token_usage` (delta del turno); modello da `turn_context.payload.model`; `rate_limits` con le percentuali già calcolate da OpenAI |
| opencode | `opencode db "<SQL>" --format json` | tabella `message`, colonna `data` JSON: `tokens.{input,output,reasoning,cache.{read,write}}`, `modelID` |
| antigravity | `~/.gemini/antigravity-cli/conversations/<id>.pb` | **protobuf binario, non leggibile**: la barra mostra `—` per questo agente |

Antigravity è dichiarato non supportato (`supported: false`) invece che
silenziosamente a zero: uno zero si confonde con «non ha consumato niente».

## Limiti e quote

`lib/usage/context-window.js`: finestra di contesto per famiglia di modello
(Claude 200K, gpt-5.x 400K, Gemini 3 1M). L'abbinamento nome → famiglia sta in
`lib/usage/model-family.js` e prende il prefisso più lungo, così
`claude-opus-4-20250514` resta riconosciuto.

Modello fuori tabella → `null`, non un limite di ripiego: la barra si nasconde.
Stessa regola per le quote dichiarate dai CLI (`lib/usage/rate-limits.js`): le
finestre si riconoscono da `window_minutes` (300 = 5 ore, 10080 = settimana),
non dalla posizione `primary`/`secondary` — su un account free il `primary` di
Codex è mensile, e leggerlo come «5 ore» mostrerebbe un numero sbagliato.

## Finestra di 5 ore

Claude fattura a blocchi di 5 ore che partono dal primo messaggio e vengono
arrotondati all'ora piena. Il blocco corrente è quello che contiene `now`:
inizio = ora piena del primo evento del blocco, fine = inizio + 5h.
Per codex la percentuale la dà il CLI stesso, quando c'è, e ha la precedenza:
è un dato dichiarato, non una stima nostra.

## Prestazioni

I `.jsonl` di Claude sono decine di MB e la barra si aggiorna ogni 8 secondi:
rileggerli interi ogni volta è escluso. Sono file **append-only**, quindi la
cache tiene per ogni file `{ size, mtime, totali }` e rilegge solo i byte dopo
`size`. Un file che non è cambiato non si apre nemmeno.

Deduplica: la stessa risposta può comparire in più file (resume, sidechain).
Chiave `messageId:requestId`, come fa `ccusage`.

Si legge **una settimana più un giorno di margine**, non di più: è la finestra
più larga che un riquadro mostra. Su dati veri (~130M token in 7 giorni) un
aggiornamento completo costa ~0,9 s, quasi tutti nella prima lettura.

La query di opencode **aggrega in SQL** per sessione/modello/ora: il CLI tronca
lo stdout quando è lungo (esce prima di svuotarlo) e una riga per messaggio
supera il limite dopo poche settimane. Quegli eventi portano `aggregated: true`,
così la barra del contesto sa di non poterli usare.

## Struttura

```
lib/usage/model-family.js  nome modello -> famiglia (prefisso più lungo)
lib/usage/context-window.js  finestra di contesto per famiglia  puro
lib/usage/claude-usage.js  .jsonl Claude -> eventi              fs
lib/usage/codex-usage.js   rollout Codex -> eventi              fs
lib/usage/opencode-usage.js  opencode db -> eventi              execFile
lib/usage/rate-limits.js   rate_limits dei CLI -> {5h, settimana}  puro
lib/usage/aggregate.js     eventi -> {sessione+contesto, 5h, settimana} puro
lib/usage/index.js         collectUsage(): unisce le sorgenti
main.js                    handler IPC `usage-snapshot`
preload.js                 `usage(opts)`
renderer/usage-bar.js      rendering + polling
```

Ogni modulo prende i percorsi come parametro (`home`, `base`, `run`): i test
girano su fixture in `tests/fixtures/usage/`, senza toccare i dati veri.

## Non in questo branch

- Grafici storici e schermata di dettaglio (la barra è una riga sola).
- Costi in dollari: tolti di proposito (vedi sopra).
- Antigravity: serve decodificare il protobuf, è un branch a sé.
- Percentuale settimanale per Claude: i `.jsonl` non contengono nessun limite,
  quindi restano i token degli ultimi 7 giorni senza denominatore. Servirebbe
  una soglia configurata a mano dall'utente.

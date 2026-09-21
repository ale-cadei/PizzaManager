# 15 — Quota in token della finestra di 5h, per ogni assistente

Branch: `feat/quota-token-5h`. Dipende da: 14 (barra dell'uso).
Taglia: ~½ g.

## Il problema

Il riquadro FINESTRA 5h mostrava `79%` quando `/usage` di Claude Code diceva
`8%`. Non era un bug di conteggio: erano due numeri diversi. Senza una quota
dichiarata dal CLI (solo Codex la scrive nei suoi rollout) la barra ripiegava
sul **tempo trascorso** nella finestra — 79% = «sono passate 3h57m delle 5
ore» — e il tooltip lo diceva, ma il numero grande da solo si legge come
consumo.

Quello che serve è il consumo in token, e accanto **quanto manca al reset**.
Per tutti gli assistenti, non solo per Codex.

## Cosa cambia

```
FINESTRA 5h  62%  ███████░░░░   claude · reset fra 1h 12m
```

- **La barra disegna i token**, non il tempo.
- **Il tempo diventa testo** accanto alla percentuale: `reset fra 1h 12m`.
- **Il riquadro segue la scheda attiva**: scheda Claude → quota di Claude.
  I limiti sono per account e per fornitore: sommare claude+codex+opencode
  contro un tetto unico non corrisponde a nessun limite reale. Senza scheda
  riconosciuta si mostra l'assistente con l'attività più recente, e il
  tooltip dice quale.

## Da dove esce il tetto

Una percentuale in token ha bisogno di un denominatore, e Claude e opencode
non lo dichiarano da nessuna parte: nei `.jsonl` non esiste nessun campo di
quota (verificato) e `/usage` la chiede all'API al momento. Restano tre
strade, e due sono sbagliate: una tabella di tetti per piano andrebbe
indovinata e invecchierebbe; un numero chiesto all'utente sposta su di lui un
problema che non sa risolvere.

**Auto-calibrazione.** Il tetto è il **massimo consumo mai osservato in una
finestra di 5 ore conclusa**, per assistente, salvato in
`usage-limits.json` nella cartella dei dati. Non è un numero inventato: è un
fatto misurato sull'uso di chi sta guardando la barra.

Regole, e il perché di ognuna:

- **Solo finestre chiuse** entrano nella calibrazione. Una finestra ancora
  aperta è un massimo per forza (è l'unica che c'è, il primo giorno), e
  darebbe `100%` a chiunque abbia appena installato l'app.
- **Finché non c'è nessuna finestra chiusa il riquadro mostra `—`**, non uno
  `0%` né una stima. Il tooltip spiega che il tetto si sta ancora calibrando.
  È la stessa regola del contesto fuori tabella (piano 14): meglio nessuna
  barra che una barra su un limite inventato.
- **Il tetto sale, non scende**: è il massimo storico, non quello degli ultimi
  8 giorni. Le finestre lette a ogni giro coprono una settimana; il valore
  salvato conserva quello che c'era prima.
- **Oltre il tetto si resta a 100%** e il tooltip lo dice («oltre il massimo
  osservato»). Quando quella finestra si chiude diventa lei il nuovo tetto.
- **La quota dichiarata vince sempre.** Se l'assistente in primo piano è Codex
  e il suo rollout porta `rate_limits`, si usa quella: è un dato del
  fornitore, non una stima nostra. Anche il reset arriva da lì
  (`resets_at`), che è più preciso della fine del blocco calcolata da noi.

Il tooltip dichiara sempre **quale delle due** si sta guardando, con il valore
del tetto in cifre e quando è stato osservato. Una stima presentata come
quota ufficiale sarebbe peggio del 79% di prima.

## Dove sta il reset

Con quota dichiarata: `resets_at` del CLI. Altrimenti: fine del blocco di 5
ore, cioè ora piena del primo evento + 5h (`lib/usage/aggregate.js`, invariato
dal piano 14). Fuori da una finestra aperta non c'è reset da mostrare: il
riquadro resta `—`, e la prossima richiesta apre una finestra nuova.

Formato: `1h 12m` sotto le 5 ore, `48m` sotto l'ora, `<1m` alla fine. Il
`formatDelta` del piano 14 arrotondava a «fra 1 h», che su una finestra di 5
ore nasconde proprio il minuto che interessa.

## Struttura

```
lib/usage/aggregate.js       + blocksOf, peakOf, peaksBySource,
                               sourcesByRecency, fiveHourQuota (il blocco
                               diventa per-sorgente e porta con sé limite,
                               percentuale e reset)
lib/usage/usage-limits.js    nuovo: store dei tetti osservati (usage-limits.json),
                               { dir } dalla factory come gli altri store
lib/usage/index.js           legge i tetti, li passa all'aggregazione,
                               registra i nuovi massimi
renderer/usage-bar.js        barra sui token, testo del reset, tooltip
renderer/styles.css          .usage-sub (il testo secondario del reset)
main.js                      passa `limitsDir` (la cartella dati di Electron)
```

## Fuori da questo branch

- **Percentuale settimanale calibrata.** Stessa idea, ma la calibrazione
  richiede settimane intere per avere un massimo credibile, e nel frattempo
  il riquadro direbbe `100%`. SETTIMANA resta sulla sola quota dichiarata.
- **Peso per modello.** I limiti veri di Claude contano Opus più di Sonnet; il
  tetto qui è in token grezzi. È coerente con se stesso (100% = la tua
  peggiore finestra di sempre, misurata allo stesso modo), ma non è la
  formula del fornitore.
- **Chiedere la quota all'API** come fa `/usage`: la barra legge solo file,
  aggiungere una chiamata di rete autenticata è un altro branch (spike 16).

## Il limite grosso di questa stima: è per macchina

La calibrazione legge i log locali, quindi **non si sincronizza fra
dispositivi**. Chi usa lo stesso account da due computer ha due tetti diversi e
due consumi diversi, e in entrambi i casi **meno** di quello che il fornitore
sta contando: il limite vero è per account. La quota di `/usage` invece è
sincronizzata, ed è la prova che quel numero non è calcolabile in locale —
lo tiene il server (spike 16).

Conseguenza pratica: la barra calibrata va letta come «quanto ho consumato *da
qui*», non come «quanto mi resta». Il tooltip dice già che è una stima; se lo
spike 16 riesce, quel numero la sostituisce e il problema sparisce.

## Fatto

Suite verde (340 test), fra cui `tests/usage-quota.test.js` (le finestre, il
tetto calibrato, la precedenza della quota dichiarata) e
`tests/usage-limits.test.js` (persistenza, tetto che non scende, file corrotto).

Nota su `main.js`: lo store **non** si crea li'. Il test di guardia tiene il
file sotto le 200 righe e ammette solo cablaggio: l'handler passa
`limitsDir: app.getPath('userData')` e `collectUsage` costruisce lo store, come
gia' fa per i collettori.

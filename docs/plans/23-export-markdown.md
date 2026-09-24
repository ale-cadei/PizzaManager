# 23 — Esportare una conversazione in Markdown

Branch: `feat/export-markdown` · Dipende da: 22 · Taglia: ~½ g

## Obiettivo

Una conversazione di Claude Code o di Codex diventa un file `.md` leggibile e
condivisibile: intestazione con titolo, progetto, date, agente e id, poi i
messaggi nell'ordine in cui sono stati scritti, con chi parla e quando.
Oggi l'unico modo di rileggere una conversazione vecchia è riprenderla con
`--resume` e scorrere il terminale.

Solo Claude Code e Codex: sono gli unici di cui si legge il testo
(`lib/transcripts.js`, piano 22). opencode sta in SQLite, Antigravity in
protobuf: per loro l'export non si offre (nessun bottone, non un bottone che
poi fallisce).

## Misure (Mac dell'utente, 2026-09-24)

| File | Dimensione | Righe | Messaggi | Lettura | Conversione | `.md` |
|---|---|---|---|---|---|---|
| Claude, il più grosso | 25 MB | 9 284 | 570 | 30–60 ms | ~70 ms | 483 KB |
| Codex, il più grosso | 2,2 MB | 658 | 119 | 5 ms | 5 ms | 662 KB |

La conversione è quasi tutta `JSON.parse`. Quindi:
- **niente worker**: lettura con `fs.promises.readFile` (non blocca) e
  conversione sincrona. Nel caso peggiore il main si ferma ~70 ms, una volta,
  su un clic esplicito: l'output dei terminali arriva con quel ritardo, non si
  perde. Il worker della ricerca esiste già, ma riusarlo vorrebbe dire
  generalizzarlo a due tipi di lavoro per risparmiare un decimo di secondo.
  Si rivaluta se un file supera i ~100 MB (conversione ~300 ms);
- in quella conversazione ci sono **1 036 chiamate a Bash** e 268 coppie di
  messaggi consecutivi dello stesso ruolo (Claude scrive una riga per blocco).
  Un elenco dei tool con i loro argomenti sarebbe più lungo della
  conversazione, e i messaggi consecutivi vanno uniti sotto un solo titolo.

## Come

### Refactor prima (commit a sé)

- `codexIdFromFile` passa da `lib/conversation-search.js` a
  `lib/codex-sessions.js`, esportata: serve a trovare il rollout di un id.
- `lib/codex-sessions.js` esporta anche titolo e cwd di un rollout già letto
  (oggi `parseRollout` legge dal disco e non è esportata) e l'indice dei
  titoli (`loadSessionIndex`). Per Claude c'è già `sessionFromLines`, pura.

Stesso comportamento: la ricerca e il Resume non cambiano.

### `lib/transcript-markdown.js` — il formattatore (puro)

`toMarkdown({ source, id, title, cwd, messages, exportedAt, timeZone })` →
stringa. `timeZone` è un parametro perché i test girano in UTC e l'utente no.

```markdown
# Titolo della conversazione

- **Progetto:** `/Users/jack/Desktop/Digitiamo/PizzaManager`
- **Agente:** Claude Code
- **Date:** 24/09/2026 14:02 → 16:40
- **Id:** `a8fe4174-a892-4666-9196-3f584fa91264`
- **Esportata:** 24/09/2026 18:10 da PizzaManager

---

## Tu · 14:02

testo del messaggio, così com'è

## Claude · 14:03

risposta, così com'è
```

- «Tu» / «Claude» (o «Codex»); l'orario è quello del primo messaggio della
  sezione, con la data davanti quando cambia giorno rispetto alla sezione
  prima.
- Messaggi consecutivi dello stesso ruolo: **una sezione sola**, testi
  separati da una riga vuota.
- Il testo va così com'è (è già Markdown), con un'eccezione: se un messaggio
  lascia aperto un blocco di codice (numero dispari di righe ```` ``` ````), il
  formattatore lo chiude. Altrimenti tutto il resto del file finisce dentro il
  blocco.
- Nome proposto: `exportFileName({ title, date })` → `AAAA-MM-GG-titolo.md`,
  con la data del **primo messaggio** (i file si ordinano per quando è
  successa la conversazione). Titolo in minuscolo, senza accenti, solo
  `[a-z0-9-]`, al massimo 60 caratteri; vuoto → l'id abbreviato. Niente
  caratteri vietati su Windows (`<>:"/\|?*`).

### `lib/transcript-export.js` — trovare e leggere (fs)

`readConversation({ source, id }, { home })` → `{ ok, source, id, title, cwd,
messages }` o `{ ok: false, error }`:
- valida l'input: `source` fra `claude` e `codex`, `id` nel formato uuid.
  L'id **non** entra in un percorso: il file si cerca fra quelli elencati
  (`claudeSessionFiles`, `codexRolloutFiles` + `codexIdFromFile`), quindi un id
  inventato non può puntare fuori dalle cartelle delle conversazioni;
- legge il file intero, poi `claudeMessages` / `codexMessages`;
- titolo e cwd dalle stesse righe (`sessionFromLines` per Claude; indice dei
  titoli e `session_meta` per Codex), nessun titolo ricalcolato a mano;
- conversazione senza messaggi → errore «Niente da esportare», non un file
  con la sola intestazione.

### Nel main: `app/export.js`

Come `app/clipboard.js`: `registerExportHandlers(ipcMain, { getWindow })`,
una riga in `main.js` (il tetto di 210 righe resta). Handler
`export-conversation`, `{ source, id }` dal renderer:
1. `readConversation` + `toMarkdown` (prima del dialog: se il file non si
   legge, lo si dice subito);
2. `dialog.showSaveDialog` con `defaultPath` = Download + nome proposto e il
   filtro `.md`. **Il percorso lo decide il dialog**: il renderer non ne passa
   mai uno;
3. `fs.promises.writeFile`, poi `{ ok: true, path }`; annullato →
   `{ ok: false, cancelled: true }`.

Preload: `exportConversation(source, id)`.

### Nel renderer

Dipende dalla scelta 1 (sotto). In ogni caso:
- bottone visibile solo per `claude` e `codex` con un id;
- esito: riuscito → niente (il file l'utente l'ha appena scelto); errore →
  messaggio con `textContent` (nel Resume una nota sotto la voce, sulla card
  il fumetto di `confirm-bubble.js`, che ha già `tell`).

## Da decidere con l'utente

1. **Da dove si esporta.** Bottone «⤓ .md» sulle voci del Resume e della
   ricerca; icona ⤓ sulla card della sidebar accanto alla ✕ (la card conosce
   `type` e `resumeId`); o entrambi. *Consiglio: entrambi.* Il Resume copre le
   conversazioni vecchie, la card il caso più frequente («salvami quello che
   ho appena fatto»), e il costo in più è una callback `onExport` nella
   sidebar.
2. **Cosa entra nel .md.** Solo domande e risposte, o anche i tool usati.
   *Consiglio: una riga compatta per risposta*, `_Strumenti: Bash ×12 · Edit
   ×3_`, **senza argomenti**: con 1 036 Bash l'elenco completo è illeggibile,
   e gli argomenti dei comandi possono contenere segreti (token in un `curl`,
   variabili d'ambiente) in un file fatto per essere condiviso. Richiede di
   estendere `lib/transcripts.js` con i nomi dei tool senza cambiare ciò che
   vede la ricerca.
3. **Dove salva.** Dialog «Salva con nome» aperto su Download col nome
   proposto, o direttamente in Download. *Consiglio: il dialog*: si sceglie
   dove metterlo e si vede il nome prima di scriverlo; direttamente in
   Download servirebbe comunque un modo per dire dove è finito il file e per
   non sovrascrivere un export precedente.

## Test

- `tests/transcript-markdown.test.js`: intestazione, sezioni per ruolo con
  unione dei consecutivi, cambio di giorno, blocco di codice lasciato aperto,
  Codex, nome del file (accenti, caratteri vietati, titolo vuoto, lunghezza).
  Su fixture in `tests/fixtures/transcripts/` e `timeZone: 'UTC'`.
- `tests/transcript-export.test.js`: su una home temporanea — trova il file
  di un id Claude e Codex, id sconosciuto, id non valido o con `../`, fonte
  non ammessa, conversazione senza messaggi.
- Cablaggio: handler, preload e bottoni (`wiring.test.js`); se la card
  cambia, il test del modulo sidebar con `fake-dom.js`.

## Commit

1. `docs:` questo piano (+ README)
2. `refactor:` `codexIdFromFile` e i pezzi del lettore Codex esportati
3. `feat:` `lib/transcript-markdown.js` + `lib/transcript-export.js` + test
4. `feat:` handler, preload e bottoni nell'interfaccia

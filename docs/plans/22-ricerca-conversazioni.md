# 22 — Ricerca in tutte le conversazioni passate

Branch: `feat/ricerca-conversazioni` · Dipende da: 21 · Taglia: ~1 g

## Obiettivo

Nel modal Resume una linguetta **🔎 Cerca**: si scrive una parola o una frase e
compaiono le conversazioni che la contengono, **dei messaggi veri** (quelli
dell'utente e le risposte dell'agente), con il pezzo di testo intorno al punto
trovato e il pulsante «Resume». Oggi la casella del Resume filtra solo titolo,
directory e id: una conversazione si ritrova se si ricorda più o meno quando
era.

Decisioni prese con l'utente (2026-09-24):
- sta **nel modal Resume**, non in una finestra nuova;
- cerca **solo nei messaggi**, non nell'output dei tool né nelle istruzioni di
  sistema;
- l'esportazione in Markdown è un branch a parte (23), che riusa il lettore
  delle conversazioni scritto qui.

## Misure (Mac dell'utente, 2026-09-24)

| Fonte | Dove | Dimensione |
|---|---|---|
| Claude | `~/.claude/projects/**/*.jsonl` | 284 MB, 224 file (10 sopra 5 MB) |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | 24 MB, 73 file |
| opencode | `~/.local/share/opencode/opencode.db` (SQLite) | 12 MB |
| Antigravity | `~/.gemini/antigravity-cli/conversations/*.pb` (protobuf) | 11 MB |

Scansione completa di Claude + Codex senza indice: **~1,5 s**. Cercando la
parola nel testo grezzo delle righe, «worktree» compare in 243 conversazioni su
297 (prompt di sistema, output dei tool); cercandola solo nei messaggi, in 21.
Quindi:
- **niente indice** per ora: 1,5 s per una ricerca esplicita va bene, e un
  indice è un secondo stato da tenere allineato. Si rivaluta se i dati crescono
  di un ordine di grandezza;
- **filtro in due tempi**: prima `includes` sulla riga grezza (economico), poi
  `JSON.parse` e confronto sul testo del messaggio solo per le righe candidate.

## Come

### `lib/transcripts.js` — i messaggi di una conversazione (puro)

Funzioni pure, dalle righe già lette ai messaggi `{ role: 'user'|'assistant',
text, at }`:
- `claudeMessages(lines)`: righe `user`/`assistant` non `isMeta`; il testo
  utente passa dalla stessa ripulitura del titolo (blocchi iniettati:
  `system-reminder`, `command-*`, `ide_*`…), quindi **si esporta**
  `userPromptText` da `lib/claude-sessions.js` invece di riscriverla. Per
  l'assistente solo i blocchi `text` (niente `tool_use`, niente `thinking`).
- `codexMessages(lines)`: `event_msg` di tipo `user_message` / `agent_message`.

È lo stesso modulo che userà l'export (23).

### `lib/conversation-search.js` — la ricerca (puro + fs)

`searchConversations(query, { sources, limit, now })`:
- normalizza la query: minuscole e **senza accenti** («perche» trova «perché»);
  minimo 2 caratteri;
- per ogni file: filtro grezzo, poi i messaggi, poi i punti trovati;
- risultato per conversazione: `{ source, id, title, cwd, mtime, hits,
  snippets }`, al massimo 3 frammenti ciascuna (~120 caratteri intorno al
  punto trovato, `snippet()` pura e testata);
- ordine: dalla più recente; al massimo 50 conversazioni, e se ne sono state
  scartate lo dice (`truncated`), come fa già la lista del Resume con
  `skipped`;
- titolo e cwd arrivano dai lettori esistenti (`listClaudeSessions`,
  `listCodexSessions`, con la loro cache), non si ricalcolano;
- opencode e Antigravity: **solo sul titolo**, come oggi. Il testo di opencode
  sta in SQLite (servirebbe una dipendenza nativa), quello di Antigravity in
  protobuf: fuori da questo branch, annotati sotto.

I file si elencano con funzioni esportate dai lettori (`claudeSessionFiles`,
`codexRolloutFiles`): oggi la scansione delle directory è chiusa dentro
`list*Sessions`. Esportarle è un **commit di refactor a sé**, prima della
feature.

### Nel main: un thread a parte

Leggere 300 MB nel main process lo bloccherebbe per un secondo e mezzo, e con
lui l'output di tutti i terminali. La ricerca gira in un `worker_threads`
(`lib/search-worker.js`: API di Node, niente Electron, quindi resta in `lib/`).
Handler IPC `search-conversations` in `main.js`, `searchConversations` nel
preload. Una ricerca nuova annulla quella in corso (il renderer scarta le
risposte vecchie con un numero di sequenza; il worker controlla un flag di
annullamento fra un file e l'altro).

### Nel renderer: `resume.js`

- linguetta `Cerca` in testa alle altre; con la linguetta attiva la casella
  esistente cerca nei contenuti, con un ritardo di 300 ms dall'ultimo tasto;
- stati: «Scrivi almeno 2 caratteri», «Cerco…», «Nessun messaggio contiene
  …», errore;
- ogni risultato: icona del tipo, titolo, progetto e data, poi i frammenti
  con la parola evidenziata. L'evidenziazione si costruisce con nodi DOM
  (`textContent` + `<mark>`), **mai** `innerHTML` sul testo della
  conversazione (è testo arbitrario: può contenere HTML);
- «Resume» riusa le viste esistenti (`RESUME_VIEWS.claude` / `.codex`), quindi
  anche la scelta dell'account Claude.

## Test

- `tests/transcripts.test.js`: su fixture in `tests/fixtures/` — blocchi
  iniettati esclusi, `tool_result` e `tool_use` esclusi, contenuto stringa o a
  blocchi, righe troncate o non JSON ignorate, Codex user/agent.
- `tests/conversation-search.test.js`: su una directory temporanea — match nel
  messaggio ma non nell'output dei tool, accenti, maiuscole, ordine per data,
  limite con `truncated`, frammenti ai bordi del testo, query troppo corta.
- Il worker: una ricerca vera attraverso il thread, e l'annullamento.
- Cablaggio: handler, preload e linguetta presenti (`wiring.test.js`).

## Commit

1. `docs:` questo piano (+ idee.md, README)
2. `refactor:` esportare `userPromptText` e l'elenco dei file dai lettori
3. `feat:` `lib/transcripts.js` + test
4. `feat:` `lib/conversation-search.js` + worker + IPC + test
5. `feat:` linguetta Cerca nel Resume

## Fuori, annotato

- Testo delle conversazioni opencode (SQLite: serve `better-sqlite3` o
  `node:sqlite`, che arriva con una Electron più nuova) e Antigravity
  (protobuf).
- Un indice persistente, se la scansione diventa lenta.
- Le conversazioni di config dir diverse da `~/.claude` (account con
  `CLAUDE_CONFIG_DIR`): il Resume oggi non le vede, la ricerca eredita il
  limite.

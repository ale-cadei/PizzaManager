# 97 — Sessione GitHub Copilot CLI (`feat/copilot-support`)

Un quinto agente accanto a opencode, Claude, Codex e Antigravity: la CLI di
GitHub Copilot (`copilot`). Si apre da «Nuova sessione», si riprende dal
«Resume», ha profili, pallino di stato del binario e colore suo.

## Cosa sappiamo della CLI (2026-11-17, versione 1.0.112)

- Pacchetto npm `@github/copilot`, binario `copilot` (un loader node che
  lancia il binario nativo `@github/copilot-<os>-<arch>`). Serve un
  abbonamento Copilot; il login lo fa la CLI stessa (`/login`).
- Dati in `~/.copilot` (o `$COPILOT_HOME`, che sostituisce l'intero percorso).
  Una cartella per sessione: `session-state/<uuid>/` con
  - `workspace.yaml` — metadati, chiavi piatte `chiave: valore`: `id`,
    `name` (dato dall'utente con `--name`/`/rename` o generato), `user_named`,
    `summary_count`, `created_at`, a volte `updated_at`, `cwd`, `summary`;
  - `events.jsonl` — una riga JSON per evento: `session.start`
    (`data.context.cwd`, `data.context.branch`), `user.message`
    (`data.content`), `assistant.message`, `session.shutdown`…
  Le versioni vecchie scrivevano `session-state/<uuid>.jsonl` piatto.
  Non è un'API pubblica: il formato può cambiare.
- Resume: `copilot --resume=<id>` (anche prefisso o nome). `--continue`
  riprende l'ultima.

Fonti: docs.github.com (config dir reference, command reference), parser di
terze parti (`kenn-io/agentsview`, `yigitkonur/cli-continues`).

## Decisioni

- **Tipo `copilot`, binario `copilot`.** Resume di default `--resume={id}`
  in un solo argomento, come scrive la reference ufficiale.
- **Lista del Resume da `workspace.yaml`**, senza dipendenza YAML: si leggono
  solo le chiavi di primo livello `chiave: valore` (virgolette tolte).
  Titolo: `name`, poi `summary`, poi il primo `user.message`; cwd dallo
  yaml o dal `session.start`. Di `events.jsonl` si legge solo l'inizio
  (64 KB): basta per cwd e primo messaggio, e una sessione lunga non pesa.
- **Fuori da questo branch** (si annotano qui, non si fanno):
  - nome della scheda passato alla CLI con `--name` (piano 86): il flag
    esiste, ma va provato con la CLI installata, insieme al resume;
  - segnale esatto lavora/finito/permesso dagli hook di Copilot (piano 46);
  - token nella barra dell'uso (`session.shutdown` ha `modelMetrics`);
  - ricerca nelle conversazioni ed export Markdown (piani 22, 23).

## Pezzi

- `lib/copilot-sessions.js`: `listCopilotSessions(limit, { home })` →
  `{ ok, sessions: [{ id, title, cwd, mtime }] }`, come gli altri.
- `lib/command-profiles.js`, `lib/binaries.js`, `lib/commands.js`
  (suggerimento d'installazione), `lib/setup-check.js` (schermata vuota).
- `main.js` + `preload.js`: `list-copilot-sessions` / `listCopilot`.
- `app/pty.js`: `copilot` anche sugli ambienti remoti.
- Renderer: card della nuova sessione, linguetta del Resume e dei profili,
  pallino nella barra in basso, icona (marchio Copilot di Primer, MIT),
  colore `--type-copilot` in `tokens.css` e negli 8 temi, liste dei tipi
  (`session-groups`, `command-config`, `app-state`, `resume`, `tab-names`).

## Verifica

- `npm run test:unit` verde.
- Smoke con la CLI installata: nuova sessione Copilot, chiudi, Resume la
  ritrova col titolo e la riapre sulla conversazione.

Fatto il 2026-11-17 con Copilot CLI 1.0.112 (Electron sotto xvfb, profilo
`AISESS_PROFILE=copilot`): binario trovato, card e pallino ok, sessione
avviata (Copilot chiede la fiducia nella cartella), linguetta Copilot del
Resume con i titoli veri, resume sulla conversazione giusta. Emerso:
`session-state/.session-operation-locks/` è una cartella di lock, non una
sessione: i nomi col punto si saltano. Copilot riscrive `name` col
riassunto che genera (`user_named: false`), quindi il titolo nel Resume può
cambiare dopo una ripresa.

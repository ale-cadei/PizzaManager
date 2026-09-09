# AISessionManager

Gestore unificato di **terminali, sessioni OpenCode, Claude Code e Codex** in un'unica finestra desktop.
Compatibile con **Linux (.deb / AppImage)** e **macOS (.dmg / .zip)**.

## Funzionalità

- 🖥 **Terminale semplice** (bash su Linux, zsh/bash su macOS)
- ⚡ **Sessione OpenCode** — avvia `opencode` in un pty dedicato
- 🤖 **Sessione Claude Code** — avvia `claude` in un pty dedicato
- ✳ **Sessione Codex** — avvia `codex` in un pty dedicato
- 🧭 **Navbar a sinistra** con classificazione per tipo (badge + icona), switch e chiusura schede; **ridimensionabile** via trascinamento (larghezza ricordata)
- ➕ **Pulsante unico «Nuova sessione»** in sidebar: il tipo (terminale / OpenCode / Claude / Codex) si sceglie nel dialog
- ⚙ **Configurazione comandi** (`File → Configurazione comandi…`, `Ctrl+,`): per ogni tipo di sessione si possono definire **più comandi di avvio** (nome, riga di comando, argomenti di resume con segnaposto `{id}`). Se un tipo ha più comandi, all'avvio della sessione viene chiesto quale usare. I comandi sono in `userData/command-profiles.json` e vengono eseguiti direttamente, senza shell (pipe/redirezioni non supportate).
- 👤 **Account Claude multipli**: rilevamento del login OAuth corrente + profili API key aggiuntivi (⚙ nel dialog, salvati in locale con permessi 600); se ce n'è più di uno, il dialog chiede quale usare (`ANTHROPIC_API_KEY` per le sessioni con chiave)
- ⟲ **Dialog Resume**: ripristina vecchie sessioni
  - OpenCode via `opencode session list --format json` → resume con `opencode --session <id>`
  - Claude Code via scan `~/.claude/projects/**/*.jsonl` → resume con `claude --resume <id>`
  - Codex via scan `~/.codex/sessions/**/rollout-*.jsonl` (titoli da `~/.codex/session_index.jsonl`) → resume con `codex resume <id>`
  - Cronologia app (ultime 200 aperture, in `userData/sessions-history.json`)
- Terminali reali basati su **node-pty + xterm.js** (supporto TUI fullscreen)

## Requisiti

- Node.js 20+
- `opencode`, `claude` e/o `codex` installati nel PATH per le rispettive sessioni

## Sviluppo

```bash
npm install
npm run test:unit
npm start
```

## Build

```bash
# Linux: produce dist/*.deb + AppImage
npm run dist:linux

# macOS (su Mac): produce dist/*.dmg + .zip
npm run dist:mac
```

Il `.deb` installa voce di menu `AISessionManager` (categoria Development).

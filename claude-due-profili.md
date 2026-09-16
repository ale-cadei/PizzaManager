# Claude Code con due account: `claudel` (lavoro) e `claudep` (personale)

Ricostruito dalle due chat del **4 settembre 2026** (profilo lavoro, progetto `cwick-app-leads`):

- **08:29 – sessione `c18c5003`** → creazione degli alias e del profilo personale
- **15:39 – sessione `f6bd81df`** → condivisione di sessioni e memoria tra i due profili

Per riaprirle: `claudel`, poi `/resume` dentro la cartella `~/Desktop/Digitiamo/cwick/cwick-playground-v2/apps/cwick-app-leads`.

---

## Il problema

Avevi un solo account Claude Code (quello Digitiamo) e volevi tenere, su terminali diversi, un account di **lavoro** e uno **personale**, con login e quote separate, senza fare `/login` e `/logout` ogni volta.

## Il meccanismo: `CLAUDE_CONFIG_DIR`

Claude Code tiene tutta la sua identità (credenziali, cronologia sessioni, plugin, MCP) in una directory di configurazione, di default `~/.claude`. La variabile d'ambiente `CLAUDE_CONFIG_DIR` la sposta altrove.

Il dettaglio chiave su macOS: il token OAuth sta nel **Keychain**, sotto una chiave derivata dal path della config dir (hash sha256). Quindi:

> due config dir diverse = due entry Keychain diverse = due login davvero indipendenti

Non serve toccare il Keychain a mano, e `/login` dentro la sessione **non** serve a questo (cambia l'account per l'installazione, non per il singolo terminale).

---

## Passo 1 — Gli alias in `~/.zshrc`

Queste sono le righe che hai in `~/.zshrc` (righe 27-29):

```zsh
# Claude Code: due account isolati
alias claudel="CLAUDE_CONFIG_DIR=$HOME/.claude claude"           # lavoro
alias claudep="CLAUDE_CONFIG_DIR=$HOME/.claude-personal claude"  # personale
```

Come funzionano:

- `alias nome="comando"` crea una scorciatoia: quando digiti `claudep`, zsh sostituisce il testo prima di eseguire.
- `CLAUDE_CONFIG_DIR=... claude` è la forma `VAR=valore comando`: imposta la variabile **solo per quel processo**, non per la shell. È per questo che l'isolamento funziona per-terminale: due sessioni aperte in parallelo vedono due valori diversi e non si pestano i piedi.
- `claudel` è tecnicamente ridondante (`~/.claude` è già il default), ma avere due nomi simmetrici evita di lanciare `claude` nudo per abitudine quando volevi il personale.

Il blocco era stato aggiunto con un heredoc con `'EOF'` tra apici, così `$HOME` è finito nel file **letteralmente** (non espanso in `/Users/jack`): funziona uguale ma non è fragile se cambia utente o macchina.

Dopo la modifica: `source ~/.zshrc` (o riapri il terminale), perché gli alias non esistono nei terminali già aperti.

## Passo 2 — La config personale

```zsh
mkdir -p ~/.claude-personal
```

## Passo 3 — Condividere regole, agent, comandi e skill via symlink

La config nuova nasce vuota: senza questo passo l'account personale non avrebbe le `rules/common/*.md`, gli agent, i comandi custom né le skill. Invece di tenerne due copie che vanno fuori sincrono, si usano **link simbolici** (puntatori, non copie: modifichi una volta e lo vedono entrambi).

```zsh
ln -s ~/.claude/rules    ~/.claude-personal/rules
ln -s ~/.claude/agents   ~/.claude-personal/agents
ln -s ~/.claude/commands ~/.claude-personal/commands
ln -s ~/.claude/skills   ~/.claude-personal/skills
```

Cosa **non** si è linkato, e perché:

| Non linkato | Motivo |
|---|---|
| `.credentials` / Keychain | è il token: condividerlo annulla l'isolamento |
| `settings.json` | contiene permessi/env del lavoro; sul personale è un file separato (scelta esplicita: "lascia separato il settings.json") |
| `.claude.json` | config globale con `oauthAccount`, storico progetti e server MCP: deve restare diverso per i due account |

## Passo 4 — Primo login sul personale

```zsh
claudep
```

Parte il flow di login nel browser: si usa l'account **personale**. Il token finisce nel Keychain sotto la chiave del path `~/.claude-personal`, quindi non sovrascrive quello del lavoro. Dai lanci successivi non serve più.

## Passo 5 — Verifica

Due terminali, uno con `claudel` e uno con `claudep`, e in ognuno `/status`: mostra l'email loggata. Se vedi la mail Digitiamo in uno e la personale nell'altro, con entrambe le sessioni vive, funziona.

---

## Seconda chat (15:39): condividere sessioni e memoria

Nella sessione del pomeriggio hai chiesto di poter **continuare sul personale le chat iniziate sul lavoro** (e viceversa), memoria compresa. Il risultato è che anche `projects/` è condiviso:

```zsh
# 1. merge di ciò che il personale aveva già creato dentro projects/ di lavoro
rsync -a ~/.claude-personal/projects/ ~/.claude/projects/

# 2. la cartella personale originale messa da parte (niente cancellato)
mv ~/.claude-personal/projects ~/.claude-personal/projects.bak.$(date +%Y%m%d-%H%M%S)

# 3. symlink: entrambi i profili leggono/scrivono la stessa cronologia
ln -s ~/.claude/projects ~/.claude-personal/projects
```

`projects/` contiene i transcript delle sessioni e la `memory/` per-progetto: condividendolo, `/resume` vede le stesse chat da entrambi gli account, e la memoria è unica. Il backup è ancora in `~/.claude-personal/projects.bak.20260904-174533`.

Nota: `history.jsonl` (la cronologia dei prompt usata per la freccia su) è invece rimasto separato per profilo.

---

## Stato finale di `~/.claude-personal`

```
agents    -> ~/.claude/agents     (symlink)
commands  -> ~/.claude/commands   (symlink)
rules     -> ~/.claude/rules      (symlink)
skills    -> ~/.claude/skills     (symlink)
projects  -> ~/.claude/projects   (symlink, dalla seconda chat)
settings.json                     (file proprio, separato)
.claude.json                      (file proprio: account personale)
history.jsonl                     (file proprio)
plugins/, cache/, backups/ ...    (propri)
```

## Cose da sapere

- **`claude` nudo = lavoro.** `~/.claude` resta il default, quindi VS Code, script e cron usano l'account Digitiamo. Gli alias vivono solo nei terminali interattivi zsh.
- **La scelta si fa al lancio** e resta per tutta la sessione: se sbagli, esci e rilancia con l'altro alias.
- **`ANTHROPIC_API_KEY` vince sull'abbonamento.** Se fosse esportata nel profilo shell, in modalità `-p` verrebbe usata sempre e l'isolamento diventerebbe apparente. Controllo: `env | grep ANTHROPIC`.
- **`claudep: command not found`** → `source ~/.zshrc` non fatto, o alias nel file sbagliato. Controllo: `alias | grep claude`.
- **Per disfare tutto**: togli le righe da `~/.zshrc` e cancella `~/.claude-personal`. I symlink puntano a `~/.claude`, ma cancellare un link non tocca la sorgente. Attenzione però a `projects`: è un symlink, quindi `rm -rf ~/.claude-personal` è sicuro, mentre un `rm -rf ~/.claude-personal/projects/` (con la barra finale) cancellerebbe il contenuto vero.

## Fonti usate nella chat originale

- [Claude Code settings — CLAUDE_CONFIG_DIR](https://code.claude.com/docs/en/settings)
- [Claude Code env vars — ANTHROPIC_API_KEY](https://code.claude.com/docs/en/env-vars)
- [Manage Multiple Claude Code Accounts (gist)](https://gist.github.com/KMJ-007/0979814968722051620461ab2aa01bf2)
- [claude-code-dual-account](https://github.com/valeriodiaco/claude-code-dual-account)
- [claude-env](https://github.com/solomon-b/claude-env)

# Branch 7 — `feat/claude-account-login`

**Dipende da**: niente di bloccante (il 2 renderebbe i test veri invece che `grep`).
**Taglia**: 1-2 giorni. **Rischio**: medio — tocca i dati di login dell'utente.
**Stato**: proposto, non pianificato. Scritto il 2026-09-15.

---

## Contesto

Claude Code non ha profili integrati: un'installazione = un login. Chi vuole due
account (lavoro e personale) deve duplicare la **config dir**, che di default è
`~/.claude` e si sposta con la variabile `CLAUDE_CONFIG_DIR`.

Il dettaglio che fa funzionare la cosa: su macOS il token OAuth sta nel
**Keychain**, sotto una chiave derivata dall'hash del path della config dir.
Due config dir diverse = due entry Keychain diverse = due login indipendenti,
senza toccare il Keychain a mano. Su Linux il token è in
`<config-dir>/.credentials.json`, stesso risultato.

Un utente dell'app (Giacomo) ha già questo setup, fatto a mano con due alias
zsh — vedi [`claude-due-profili.md`](../../claude-due-profili.md) nella root,
che descrive la sua configurazione reale, non una proposta.

### Cosa c'è già in `main`

Dal 2026-09-15 la configurazione comandi accetta assegnamenti `VAR=valore` in
testa alla riga di comando, quindi **il caso d'uso è già coperto**:

| Nome | Riga di comando | Argomenti resume |
|---|---|---|
| Claude lavoro | `claude` | `--resume {id}` |
| Claude personale | `CLAUDE_CONFIG_DIR=~/.claude-personal claude` | `--resume {id}` |

Funziona, ma chiede all'utente di sapere cos'è una variabile d'ambiente e dove
Claude Code tiene la sua config. Questo branch elimina quella richiesta.

**Non** si parte da zero: `command-profiles.js` ha già `splitEnvAssignments()` e
`expandVars()`, `main.js` passa `profileEnv` a `pty.spawn` e
`detectClaudeOauth(configDir)` legge il login della config dir giusta.

## Obiettivo

L'utente aggiunge un account facendo **solo il login nel browser**. Niente
alias, niente variabili d'ambiente, niente symlink a mano.

## Il meccanismo: `claude auth`

La CLI espone già tutto (verificato su `claude` 2026-09, output reali):

```console
$ claude auth --help
Commands:
  login [options]   Sign in to your Anthropic account
  logout            Log out from your Anthropic account
  status [options]  Show authentication status

$ claude auth status --json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "alessandro.cadei@digitiamo.com",
  "orgId": "1ce1c576-…",
  "orgName": "Digitiamo",
  "subscriptionType": "team"
}

$ CLAUDE_CONFIG_DIR=/tmp/dir-vuota claude auth status --json
{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty"
}
```

Tre conseguenze pratiche:

1. Il login si fa con `claude auth login`, **senza entrare nella TUI** e digitare
   `/login`. Apre il browser e torna.
2. L'identità dell'account si legge da `auth status --json`: email, piano,
   organizzazione. L'app non deve far inventare un nome all'utente, né fare
   parsing di file di configurazione.
3. Una config dir vuota risponde `loggedIn: false` in modo pulito, senza errori:
   è un test di stato affidabile, non un'euristica.

`claude` crea la config dir da solo al primo comando: basta `CLAUDE_CONFIG_DIR`
puntata dove si vuole.

## Design

### Modello dati

L'elenco account diventa una lista di due tipi, mutuamente esclusivi:

```js
// <userData>/claude-accounts.json
{ id, kind: 'config-dir', name, configDir, email, subscriptionType, createdAt }
{ id, kind: 'api-key',    name, apiKey,    createdAt }   // già esistente
```

Le dir gestite dall'app stanno in `<userData>/claude-profiles/<slug>/`. Una dir
**importata** (caso Giacomo: `~/.claude-personal`) è identica salvo che l'app non
la cancella mai.

`kind: 'oauth'` resta come voce implicita e non cancellabile: è `~/.claude`,
cioè `claude` senza variabili.

### Flusso "Aggiungi account"

1. L'utente preme **Accedi con un altro account** nel gestore account
2. L'app crea `<userData>/claude-profiles/<slug>/` e apre una **scheda normale**
   dell'app con `claude auth login` e `CLAUDE_CONFIG_DIR` puntata lì — il login
   avviene dentro l'app, il browser si apre da sé
3. All'uscita del processo, l'app esegue `claude auth status --json` nella stessa
   dir: se `loggedIn`, salva l'account con email e piano come nome; altrimenti
   rimuove la dir appena creata e non salva niente
4. All'avvio di una sessione Claude, l'account scelto nel dropdown decide
   `CLAUDE_CONFIG_DIR`. L'utente non scrive comandi custom.

Rimozione: `claude auth logout` nella dir; cancellare la dir solo su conferma
esplicita e solo se creata dall'app (mai una dir importata).

### Condivisione della configurazione

Una config dir nuova nasce vuota: senza intervento, il nuovo account non ha
`rules/`, `agents/`, `commands/`, `skills/`. L'app crea quei quattro symlink
verso `~/.claude` (è quello che Giacomo ha fatto a mano).

`projects/` è diverso, perché contiene i transcript delle sessioni e la
`memory/` per progetto: condividerlo significa cronologia e memoria uniche fra
account. **Decisione presa: checkbox al momento della creazione, default
"condiviso"** — comodo per l'uso normale, disattivabile da chi vuole isolamento
vero.

Non vanno mai condivisi, per motivi diversi:

| File | Perché no |
|---|---|
| `.credentials.json` / Keychain | è il token: condividerlo annulla l'isolamento |
| `.claude.json` | contiene `oauthAccount`: deve restare diverso per account |
| `settings.json` | permessi e env sono per-account |

## Modifiche per file

- **`claude-accounts.js`** (nuovo, estratto da `main.js`) — CRUD degli account
  nei due `kind`, creazione/import/rimozione delle config dir, symlink. Modulo
  puro dove possibile, con `fs` iniettabile per i test.
- **`main.js`** — `detectClaudeOauth(configDir)` c'è già; aggiungere
  `claudeAuthStatus(configDir)` (spawn di `claude auth status --json`, timeout,
  parsing difensivo) e gli handler IPC `start-claude-login`,
  `import-claude-config-dir`, `remove-claude-account`. `claudeAccountEnv()`
  ritorna `{ CLAUDE_CONFIG_DIR }` per `kind: 'config-dir'`.
- **`renderer/renderer.js` + `index.html`** — il gestore account passa da
  "nome + chiave API" a elenco con "Accedi con un altro account" e "Usa una
  cartella esistente…". La chiave API resta, in secondo piano.
- **`main.js` (resume)** — `claudeProjectsDir()` è fisso su
  `~/.claude/projects`: va parametrizzato sulla config dir dell'account scelto,
  altrimenti con `projects/` non condiviso la lista di resume mostra le sessioni
  sbagliate.

## Punti di attenzione

- **`CLAUDE_CONFIG_DIR` conta se è impostata, non quanto vale.** Con la
  variabile, `.claude.json` sta *dentro* la dir; senza, è `~/.claude.json`.
  Quindi `CLAUDE_CONFIG_DIR=~/.claude claude` **non** equivale a `claude`:
  cambia storico progetti e trust prompt (il login regge, perché
  `.credentials.json` è nella dir). Il doc di Giacomo dice che `claudel` è
  "tecnicamente ridondante": non lo è. L'app non deve mai impostare la variabile
  per l'account di default.
- **`ANTHROPIC_API_KEY` vince sul login OAuth.** Un account a chiave API
  combinato con una config dir renderebbe l'isolamento apparente, con consumo
  addebitato sulla chiave. Oggi `main.js` blocca la combinazione con un errore;
  con i due `kind` nello stesso elenco il conflitto sparisce per costruzione, e
  quel controllo si può togliere.
- **Il login richiede un browser.** Su una macchina headless il flow non si
  completa: l'app deve dirlo invece di restare appesa.
- **Timeout su `auth status`**: è un processo esterno, va ucciso se non risponde.
- **Mai copiare `.credentials.json`** da una dir all'altra, nemmeno per comodità.
- **Symlink su Windows**: richiedono privilegi o Developer Mode. Se falliscono,
  degradare a "nessuna condivisione" con un avviso, non crashare.

## Test

I test attuali sono `grep` sui sorgenti (vedi il branch 2). Quelli veri da
scrivere con `fs` iniettabile:

- lo slug di un'email produce un nome dir valido e non collide
- creazione dir → symlink attesi presenti, `projects` secondo la checkbox
- login fallito → la dir creata viene rimossa, nessun account salvato
- import di una dir esistente → l'account si salva ma la dir non è mai cancellabile
- `auth status` che risponde JSON malformato / va in timeout → errore gestito
- account `config-dir` → l'env della sessione contiene `CLAUDE_CONFIG_DIR`
- account di default → l'env **non** contiene `CLAUDE_CONFIG_DIR`

## Perché non è stato fatto subito

La strada manuale funziona già e copre il caso reale. Questo branch è
ergonomia: vale quando l'app esce dalle mani di chi sa cos'è `~/.zshrc`.

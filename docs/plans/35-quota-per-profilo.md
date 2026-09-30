# 35 — La quota di Claude giusta, per il profilo della scheda

Branch: `feat/quota-per-profilo`. Dipende da: 17 (quota dall'endpoint).
Taglia: ~½ g. Scritto il 2026-09-30.

## Il sintomo

Su macOS, con due profili Claude (lavoro in `~/.claude`, personale in
`~/.claude-personal` via `CLAUDE_CONFIG_DIR`), la barra in basso mostra la
FINESTRA 5h di Claude al **21%**, e il numero non corrisponde a nessuno dei due
account (`/usage` dice altro in entrambi).

## Perché succede

Il piano 17 legge il token OAuth da `~/.claude/.credentials.json`
(`lib/usage/claude-quota.js`, `readToken`). È verificato su Linux (spike 16),
ma su macOS quel file di norma non esiste: Claude Code tiene il token nel
**Keychain**, in una voce diversa per ogni config dir
([`claude-due-profili.md`](../../claude-due-profili.md), piano 07).

Senza token, `read()` torna `null` e la barra ricade sulla **stima calibrata**
del piano 15: token della finestra corrente diviso il massimo mai osservato in
una finestra di 5h (`usage-limits.json` → `claude.fiveHourPeak`, 128,7M token,
osservato il 2026-09-21). Il tooltip lo dice ("Stima calibrata sul tuo uso, non
una quota del fornitore"), ma il numero sulla barra sembra una quota vera.

Due aggravanti:

- **Un solo token per tutta l'app.** Anche col token al posto giusto, la barra
  mostrerebbe sempre la quota dello stesso account, qualunque sia la scheda in
  primo piano. Era già segnato come aperto nel piano 17.
- **I log sono condivisi.** In questo setup `~/.claude-personal/projects` è un
  symlink a `~/.claude/projects`: la stima somma i consumi di entrambi gli
  account e li divide per un picco che può venire da uno qualsiasi dei due.
  Dai `.jsonl` non si capisce con quale account è stata fatta una sessione,
  quindi la stima **non** si può separare per profilo. Si può solo dichiarare.

## Cosa cambia

1. **Token letto dove sta, per piattaforma.** macOS: Keychain; Linux e Windows:
   `<configDir>/.credentials.json`. Su macOS, se il Keychain non ha niente, si
   prova comunque il file (installazioni vecchie o con keychain disattivato).
2. **Quota per config dir.** La FINESTRA 5h e la SETTIMANA di una scheda Claude
   mostrano la quota dell'account di *quella* scheda: la config dir si ricava
   dal profilo di comando (`CLAUDE_CONFIG_DIR`), o è quella di default.
3. **La stima si vede.** Quando il numero è `limitKind: 'calibrated'` la barra
   lo scrive come stima (es. `~21%`), non solo nel tooltip. Il tooltip aggiunge
   che la stima include tutti i profili che condividono i log.

## Passo 0 — il nome della voce nel Keychain ✅ verificato (2026-09-30)

Lanciato a mano (stampa solo i nomi dei servizi, nessun segreto):

```console
$ security dump-keychain | grep -o '"Claude Code-credentials[^"]*"' | sort -u
"Claude Code-credentials-82109b51"
"Claude Code-credentials-ba3d4882"
"Claude Code-credentials"

$ printf %s "$HOME/.claude-personal" | shasum -a 256 | cut -c1-8
82109b51
$ printf %s "$HOME/.claude" | shasum -a 256 | cut -c1-8
ba3d4882
```

La regola:

- **senza `CLAUDE_CONFIG_DIR`** → servizio `Claude Code-credentials`
- **con `CLAUDE_CONFIG_DIR=<dir>`** → `Claude Code-credentials-` + i primi 8
  caratteri esadecimali di `sha256(<dir>)`, dove `<dir>` è il path assoluto
  con `~` espanso e **senza** slash finale (con lo slash l'hash è un altro:
  `e227974e`).

Conseguenza che conta: **`CLAUDE_CONFIG_DIR=~/.claude` non è il default**. Ha
una voce sua (`ba3d4882`), cioè un login separato da quello di `claude` nudo:
è la stessa asimmetria che il piano 07 aveva trovato per `.claude.json`.
Quindi il servizio si calcola dalla *presenza* della variabile nel profilo,
mai confrontando il path con `~/.claude`.

La variabile può arrivare anche dall'**ambiente dell'app**, non solo dal
profilo: chi fa `export CLAUDE_CONFIG_DIR=...` in `~/.zshrc` e lancia l'app da
terminale (`npm start`) la passa a ogni `claude` senza variabile nel comando.
Quindi la config dir di una scheda è, in ordine: `profileEnv.CLAUDE_CONFIG_DIR`,
poi `process.env.CLAUDE_CONFIG_DIR` del main, poi nessuna (voce senza suffisso).

Non verificato: se il CLI normalizza il valore prima di calcolare l'hash
(slash finale, `..`, symlink). L'app calcola l'hash sulla stessa stringa che
passa nell'env dello spawn (`profileEnv.CLAUDE_CONFIG_DIR`, già espansa da
`command-profiles.js`), quindi le due cose coincidono per costruzione; un
profilo scritto con lo slash finale va nei test e, se non torna, si normalizza
togliendolo in un posto solo.

Ancora da vedere, allo smoke test: se leggere la voce con
`security find-generic-password -s <servizio> -w` da dentro l'app fa comparire
il dialogo "PizzaManager vuole accedere al portachiavi". La voce la crea
`/usr/bin/security`, quindi leggerla con lo stesso binario non dovrebbe
chiedere niente, ma va provato dall'app impacchettata, non da terminale.

## Struttura

```
lib/usage/claude-token.js      nuovo: readClaudeToken({ configDir, platform, run, fs })
                               Keychain su darwin (execFile di `security`, senza
                               shell, timeout), file altrove e come ripiego
lib/usage/claude-quota.js      readToken sparisce, usa claude-token; la cache
                               diventa una Map per configDir
lib/usage/index.js             collectUsage riceve la configDir della scheda
                               attiva e chiede la quota di quella
main.js                        usage-snapshot: da commandProfileId alla configDir
                               (store dei profili già esistente), niente path
                               dal renderer
renderer/panels.js             activeUsageSession passa anche commandProfileId
                               e claudeAccountId della scheda
renderer/usage-bar.js          "~" davanti alla percentuale stimata; tooltip
tests/claude-token.test.js     darwin/linux/win32 con run e fs iniettati
tests/claude-quota.test.js     cache separata per configDir
```

## Le regole che il codice rispetta

- **Il token non esce dal main process**, non si logga e non finisce
  nell'oggetto restituito (regola del 17, invariata). L'output di `security`
  non si scrive mai in un messaggio d'errore: un errore dice solo "non
  trovato" o "timeout".
- **`security` senza shell**: `execFile('security', ['find-generic-password',
  '-s', servizio, '-w'])`. Il nome del servizio lo calcola l'app dalla
  configDir, non arriva dal renderer.
- **La configDir non arriva dal renderer.** Il renderer manda
  `commandProfileId`; il main la risolve dallo store dei profili, come fa già
  `app/pty.js` allo spawn. Un id sconosciuto vale "default".
- **L'app non rinfresca mai il token.** Se è scaduto (l'endpoint risponde
  `401`) si ricade sulla stima: rinnovarlo userebbe il refresh token del CLI e
  potrebbe sloggarlo. Il tooltip dice di aprire una sessione di quel profilo,
  che il token lo rinnova da sé.
- **Account a chiave API**: niente quota a 5h (non esiste per l'API). La barra
  non mostra percentuali dichiarate per quella scheda.
- **La rete si accende solo in produzione** (regola del 17): senza `limitsDir`
  niente istanza condivisa, la suite non tocca rete né Keychain. I test
  iniettano `run` e `fs`, mai `security` vero. `platform` è un parametro
  (convenzione Windows di `CLAUDE.md`).
- **Cache per configDir**, stessi tempi del 17 (5 minuti, un minuto dopo un
  errore). Due profili = al massimo due chiamate ogni 5 minuti.

## Test

- darwin: `run` restituisce il JSON della voce → token letto; `run` fallisce →
  si prova il file; entrambi assenti → `null`
- il nome del servizio: nessuna variabile → `Claude Code-credentials`;
  `/Users/jack/.claude-personal` → `…-82109b51`; `/Users/jack/.claude`
  esplicito → `…-ba3d4882`, **non** il default (valori del passo 0)
- linux / win32: si legge `<configDir>/.credentials.json`, `run` mai chiamato
- quota: due configDir → due chiamate a `fetch`, due cache; la seconda lettura
  della stessa configDir entro il TTL non chiama `fetch`
- `usage-snapshot` con un `commandProfileId` che imposta `CLAUDE_CONFIG_DIR`
  → la quota chiesta è quella di quella dir; id sconosciuto → default
- usage-bar: `limitKind: 'calibrated'` → testo con `~`; `'declared'` → senza

Smoke nell'app: una scheda lavoro e una personale, passare dall'una all'altra
e confrontare la FINESTRA 5h con `/usage` dentro ciascuna.

## Stato (2026-09-30)

Fatto: `claude-token.js`, cache per config dir, `claude-target.js`, cablaggio
scheda → main → `collectUsage`, tilde sulla stima. Suite verde.

Emerso allo smoke test: una scheda Claude appena aperta (non ancora abbinata
a un log) mostrava la finestra di Codex, perche' senza id di sessione la barra
parlava dell'ultimo assistente attivo. Ora decide il tipo della scheda
(`focus` in `aggregate`); solo una scheda shell ricade sul piu' recente.

Non ancora: il tooltip che, col token scaduto (`401`), dice di aprire una
sessione di quel profilo. Oggi il `401` ricade sulla stima in silenzio, come
qualunque altro errore. E lo smoke test nell'app (compreso il dialogo del
Keychain).

## Fuori da questo branch

- **Separare la stima per profilo.** Con `projects/` condiviso è impossibile
  (vedi sopra). Con `projects/` separato si potrebbe leggere
  `<configDir>/projects` per ogni profilo e tenere i picchi per profilo in
  `usage-limits.json`; si fa se e quando qualcuno ha quel setup.
- **Log dei profili non condivisi**: oggi `claude-usage.js` legge solo
  `~/.claude/projects`. Stesso discorso, stesso momento.

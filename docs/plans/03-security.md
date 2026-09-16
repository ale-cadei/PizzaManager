# Branch 3 — `fix/security`

**Dipende da**: branch 2. **Taglia**: ~1h. **Rischio**: basso.

> **Stato: fatto** (2026-09-16), in forma ridotta rispetto al piano originale.
> Decisione presa con il proprietario del prodotto: è un programma locale a
> utente singolo, non ancora distribuito. Le modifiche che rendono più sicuro
> senza complicare sviluppo o uso sono entrate; `safeStorage` è stato differito
> (vedi backlog nel README). Fatto:
>
> - `command-profiles.json` a 600 come `claude-accounts.json` — i profili
>   accettano `VAR=valore`, incluso `ANTHROPIC_API_KEY=…`, e il file era a 644
> - blocco di «`ANTHROPIC_API_KEY` nel profilo + account a chiave API», lo
>   stesso conflitto già gestito per `CLAUDE_CONFIG_DIR`: l'env del profilo
>   vince in silenzio e l'addebito finisce dove l'utente non si aspetta
> - CSP in `renderer/index.html` (`style-src` ammette l'inline per xterm.js,
>   `script-src` no)
> - `escapeHtml` su `oauth.label`
>
> Il testo che segue è il piano originale, conservato per il ragionamento.

---

## Contesto

AISessionManager permette di configurare più account Claude: il login OAuth
rilevato da `~/.claude/.credentials.json`, più profili aggiuntivi con API key
salvati dall'app. Quando si avvia una sessione con un profilo a chiave, l'app
passa `ANTHROPIC_API_KEY` nell'ambiente del PTY.

Le chiavi non lasciano mai il main process: `list-claude-accounts` proietta solo
`{ id, name }` verso la UI. Quella parte è fatta bene ed è già coperta da un test.

Restano tre buchi.

## I tre interventi

### 1. Le API key sono in chiaro su disco

Oggi (`main.js:141`, prima del branch 2):

```js
function saveClaudeKeyAccounts(acc) {
  fs.writeFileSync(claudeAccountsFile(), JSON.stringify(acc, null, 2), { mode: 0o600 });
  try { fs.chmodSync(claudeAccountsFile(), 0o600); } catch {}
}
```

I permessi `0600` proteggono dagli **altri utenti** della macchina, non da un
qualsiasi processo che gira come te — inclusi gli script `postinstall` di ogni
pacchetto npm che installi.

Electron espone `safeStorage.encryptString()`, che su macOS appoggia la chiave al
Keychain di sistema. Va iniettato nella factory creata al branch 2:

```js
// main.js passa l'encryptor vero
createAccountStore({ dir: app.getPath('userData'), encryptor: safeStorageEncryptor })
// i test passano un encryptor finto o nessuno
```

**Tre casi da gestire, tutti obbligatori:**

- **Migrazione**: all'avvio, se il file esiste ed è in chiaro, va letto, cifrato e
  riscritto. Un utente che ha già salvato degli account non deve perderli né
  doverli reinserire.
- **`safeStorage.isEncryptionAvailable() === false`** (succede su alcune
  configurazioni Linux senza keyring): fallback al comportamento attuale **con
  avviso esplicito in UI**, non in silenzio. L'utente deve sapere che le sue
  chiavi sono in chiaro.
- **Decifratura fallita** (Keychain cambiato, profilo migrato da un'altra
  macchina): messaggio chiaro e possibilità di reinserire la chiave, non un
  crash e non una lista vuota senza spiegazione.

### 2. Manca la Content-Security-Policy

`renderer/index.html` non ha nessuna CSP. Con `contextIsolation: true` e
`nodeIntegration: false` il rischio è già contenuto, ma il renderer inietta nel
DOM stringhe che arrivano da file esterni: i titoli letti dai `.jsonl` di Claude
e l'output di `opencode`. La CSP è la seconda rete sotto la prima.

Attenzione: `renderer/index.html` carica xterm da `../node_modules/`, quindi la
policy deve permettere gli script locali dell'app senza aprire tutto.

### 3. Un `innerHTML` non escapato

`renderer/renderer.js:223`:

```js
oauthRow.innerHTML = `<span class="meta">OAuth — ${(claudeAccounts.oauth && claudeAccounts.oauth.label) || 'login corrente'}</span>`;
```

È l'unico `innerHTML` del file senza `escapeHtml`. Il valore viene da
`subscriptionType` nel file credenziali, quindi il rischio pratico è quasi nullo
— ma l'incoerenza è il problema vero: chi legge non capisce se l'escape sia stato
omesso di proposito, e replica il pattern sbagliato altrove.

## Verifica

```bash
# le chiavi non sono più leggibili su disco
grep -r "sk-ant-" ~/Library/Application\ Support/AISessionManager/   # non deve trovare nulla

npm run test:unit
npm start
```

**Prova manuale della migrazione**, da fare davvero e non a occhio:

1. Su `main`, avvia l'app e aggiungi un account con una chiave finta (`sk-ant-test123`).
2. Verifica che `claude-accounts.json` contenga la stringa in chiaro.
3. Passa al branch, riavvia l'app.
4. L'account c'è ancora nella lista, e il file **non** contiene più `sk-ant-test123`.
5. Avvia una sessione con quell'account e verifica che `ANTHROPIC_API_KEY` arrivi
   giusta nel PTY (`echo $ANTHROPIC_API_KEY` in una shell di prova).

## Criteri di uscita

- Nessuna API key in chiaro su disco quando `safeStorage` è disponibile.
- Migrazione da file legacy verificata a mano con i 5 passi qui sopra, più un
  test automatico che parte da un file in chiaro e verifica il risultato.
- Il caso `isEncryptionAvailable() === false` mostra un avviso in UI.
- CSP presente e l'app funziona ancora (xterm si carica, i terminali si aprono).
- Nessun `innerHTML` senza escape in `renderer.js`.

## Rollback

**Questo è l'unico branch che tocca dati esistenti dell'utente.** La migrazione
riscrive `claude-accounts.json` in forma cifrata, e tornare a `main` dopo la
migrazione lascia un file che il codice vecchio non sa leggere: gli account
risulteranno spariti (non persi — il file c'è — ma illeggibili).

Prima di provare il branch, copiare il file:

```bash
cp ~/Library/Application\ Support/AISessionManager/claude-accounts.json ~/Desktop/backup-accounts.json
```

## Fuori scope

Validazione degli input ai confini e degrado esplicito degli errori stanno nel
branch 4, anche se sono argomenti vicini.

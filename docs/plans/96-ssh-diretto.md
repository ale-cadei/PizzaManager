# 96 — Server SSH scritto a mano nella nuova sessione (`feat/ssh-diretto`)

Il piano 93 propone nel «Dove» solo gli host di `~/.ssh/config`. Per un
server che lì non c'è bisogna oggi aprire un terminale e scrivere `ssh`.
Qui: una voce «Altro server…» con un campo `utente@host:porta`.

## Decisioni (2026-11-13, con l'utente)

- **Campo di testo, niente modulo.** `host`, `utente@host`,
  `utente@host:porta`. `~/.ssh/config` non si tocca e l'app non salva
  nessun segreto: password, conferma della chiave dell'host e passphrase le
  chiede ssh nel terminale, come per gli alias.
- **Recenti dai dati che ci sono già.** I server scritti a mano tornano nel
  «Dove» (gruppo «Usati di recente») leggendo la cronologia, che ha già
  `env` (piano 93). Nessun file nuovo. Quelli già in `~/.ssh/config` non si
  ripetono.
- **L'ambiente resta una stringa**: `ssh:ale@10.0.0.5:2222`. Viaggia in
  tmux, cronologia, recenti, editor come `ssh:nas`. `:22` si toglie (stesso
  server, stessa chiave).
- **L'editor remoto** (piano 94) funziona uguale, ma con `BatchMode=yes`:
  serve una chiave o ssh-agent, come per gli alias; il messaggio c'è già.
- IPv6 fra parentesi quadre: fuori. Per quello c'è `~/.ssh/config`.
- **«Salva» in `~/.ssh/config`** (chiesto dopo, stesso giorno): accanto al
  campo un nome facoltativo (di default l'host) e «Salva». L'app aggiunge
  un blocco `Host nome` / `HostName` / `User` / `Port`, e da lì il server è
  un alias come gli altri. Vale su Linux, macOS e Windows (OpenSSH di
  Windows legge `%USERPROFILE%\.ssh\config`). Regole:
  - solo aggiunte, mai modifiche alle righe che ci sono; il blocco va
    **prima** del primo `Host` con wildcard o `Match` (in ssh_config vince
    il primo valore: dopo un `Host *` con `User` il nostro `User` non
    conterebbe), altrimenti in fondo;
  - nome già presente (anche in un `Include`) → errore, niente scrittura;
  - file nuovo con `0600` e cartella `~/.ssh` `0700`; un file che c'è tiene
    i suoi permessi e i suoi a capo (`\r\n` se li usa); se è un link
    simbolico (dotfiles) si scrive il file vero, non si sostituisce il link;
  - scrittura in un file temporaneo accanto e `rename`: a metà non resta
    un config troncato.

## Sicurezza

- Utente e host: `[A-Za-z0-9._-]`, **mai** `-` in testa (sarebbe
  un'opzione di ssh: `-oProxyCommand=…` esegue comandi qui). La
  destinazione va comunque dopo `--`. Porta: intero 1–65535, passata con
  `-p` prima di `--`.
- Un solo validatore in `lib/remote-env.js` usato da `parseEnvKey`: pty,
  canale dell'editor e cronologia passano tutti da lì.

## Pezzi

- `lib/remote-env.js`: `parseSshTarget(text)` → `{user, host, port}` o
  null; `normalizeSshTarget(text)`; `sshDestArgs(target)` →
  `['-p', '2222', '--', 'ale@host']`. `parseEnvKey('ssh:…')` valida con
  `parseSshTarget`. `wrapRemote` usa `sshDestArgs`.
- `lib/remote-channel.js`: `sshArgs` usa `sshDestArgs`.
- `lib/recent-dirs.js`: `recentSshTargets(history, {exclude, limit})`.
- `app/remote-envs.js`: `list-remote-envs` dà anche `recent`;
  `check-ssh-target` (testo → chiave o messaggio).
- `lib/ssh-config-save.js`: `addSshHost(text, {alias, target})` (puro) e
  `createSshConfigSaver({home})`; `app/remote-envs.js`: `save-ssh-host`.
- Renderer: «Altro server…» nel select, campo `#new-ssh-target` che appare
  solo allora, gruppo «Usati di recente». La riga «Dove» c'è sempre (prima
  spariva senza host in config).

## Test

- `tests/ssh-target.test.js`: forme valide, `-` in testa, porta fuori
  range, `:22` tolto, `sshDestArgs`, `wrapRemote` e `sshArgs` con porta,
  `recentSshTargets`, IPC `check-ssh-target` e `recent`.
- `tests/new-session-env.test.js`: gruppi del «Dove» (il server richiesto
  entra nei recenti), `resolveNewEnv` (testo giusto → chiave, sbagliato o
  main giù → errore nel modal).
- `tests/ssh-config-save.test.js`: blocco in fondo o prima di `Host *` /
  `Match`, `\r\n` conservati, nome non valido o già presente, file nuovo
  `0600`, link simbolico seguito, permessi di un file esistente tenuti; IPC
  `save-ssh-host` (nome di default, doppione negli Include, errore del disco).
- `tests/editor-remote-tab.test.js`: un evento di `ssh:nas:2222:/x` non
  va alla scheda di `ssh:nas`.
- Smoke: sessione su `utente@host` mai visto (conferma della chiave nel
  terminale), poi il server fra i recenti; editor sullo stesso server.

## Dopo

- **«Configura accesso con chiave»** accanto a «Salva» (chiesto il
  2026-11-13, da fare in un branch suo). Oggi la password la chiede ssh a
  ogni sessione e l'editor remoto senza chiave non parte (`BatchMode=yes`).
  Il bottone apre una scheda terminale che:
  - crea `~/.ssh/id_ed25519` con `ssh-keygen -t ed25519` se manca
    (passphrase chiesta da ssh-keygen lì, l'app non la vede);
  - copia la chiave pubblica sul server: `ssh-copy-id` su Linux e macOS; su
    Windows non c'è, quindi `ssh … "mkdir -p ~/.ssh && cat >>
    ~/.ssh/authorized_keys"` con la `.pub` sullo stdin. La password la
    chiede ssh una volta, nel terminale.
  Regole: l'app non legge né salva password o passphrase; argomenti senza
  shell (`sshDestArgs`, destinazione dopo `--`); niente `sshpass`. Da
  valutare: proporre `AddKeysToAgent yes` (e `UseKeychain yes` su macOS)
  per la passphrase, e su Windows avvisare se il servizio `ssh-agent` è
  fermo. Test: argomenti per piattaforma, chiave già presente non
  rigenerata, destinazione con `-` in testa rifiutata.

## Stato

Fatto, test verdi. Nel select la voce è «Altro server SSH…»; la scelta si
ricorda alla conferma col server scritto, che al giro dopo è fra i recenti.
«Salva» fatto. Smoke nell'app da fare, anche su macOS e Windows per il
«Salva» (su Windows: che ssh accetti i permessi del config creato).

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
- `tests/editor-remote-tab.test.js`: un evento di `ssh:nas:2222:/x` non
  va alla scheda di `ssh:nas`.
- Smoke: sessione su `utente@host` mai visto (conferma della chiave nel
  terminale), poi il server fra i recenti; editor sullo stesso server.

## Stato

Fatto, test verdi. Nel select la voce è «Altro server SSH…»; la scelta si
ricorda alla conferma col server scritto, che al giro dopo è fra i recenti.
Smoke nell'app da fare.

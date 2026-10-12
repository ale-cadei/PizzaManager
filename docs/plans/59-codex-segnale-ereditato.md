# 59 — `fix/codex-segnale-ereditato`: il file del segnale non si eredita

Dipende da: 46 (segnale esatto degli agenti). Taglia: ~1h.

## Perché

Ogni sessione claude e opencode riceve `AISESS_SIGNAL_FILE`, il percorso dove
il suo hook scrive lo stato. Codex no: parla con OSC 9 nel terminale, e un
file non lo scriverebbe nessuno (`signalInjection` in `app/pty.js`).

Ma l'ambiente di una sessione parte da `process.env` dell'app. Se l'app è
avviata da dentro una sessione di PizzaManager (succede sviluppandola: `npm
start` da una scheda claude), `process.env` ha già `AISESS_SIGNAL_FILE`,
quello della scheda di fuori, e passa così com'è a ogni sessione che non lo
sovrascrive: codex e le shell. Un hook lanciato lì dentro scriverebbe lo
stato sulla scheda sbagliata, di un'altra istanza dell'app.

Se n'è accorto un test: `codex: gli args delle notifiche sì, il file del
segnale no` (`tests/agent-wiring.test.js`) fallisce quando la suite gira da
una scheda claude, e passa da un terminale normale.

## Cosa

- `withoutSignal(env)` in `lib/agent-hooks.js`: una copia dell'ambiente
  senza `AISESS_SIGNAL_FILE`. Il valore lo mette solo `signalInjection`, per
  la sessione a cui appartiene.
- `app/pty.js` la usa sull'ambiente di partenza dello spawn.
- `lib/tmux.js` la usa sull'ambiente del client che crea la sessione: è da
  lì che nasce il server tmux, e le sessioni dopo ereditano il suo ambiente.

## Test

- `tests/agent-hooks.test.js`: `withoutSignal` toglie la variabile, lascia
  il resto, non tocca l'oggetto ricevuto.
- `tests/agent-wiring.test.js`: il test di codex mette lui
  `AISESS_SIGNAL_FILE` in `process.env`, così non dipende più da dove gira
  la suite.

## Fuori

Un server tmux nato prima della correzione, da un'app avviata dentro una
scheda, ha già la variabile nel suo ambiente: le sessioni nuove la
ereditano finché il server non si riavvia. Riguarda solo chi sviluppa
l'app, e si risolve con un `kill-server` sul socket `aisession` (che però
chiude tutte le sessioni): non vale un `-e` vuoto su ogni sessione.

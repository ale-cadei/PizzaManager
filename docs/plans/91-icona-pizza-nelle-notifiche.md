# 91 — `feat/pizzamanagericoninnotifications`: pizza e Peppo nelle notifiche

Dipende da: 38 (notifiche di sistema). Taglia: ~30 min.

## Perché

Le notifiche di PizzaManager partivano senza icona: nel centro notifiche non
si distinguevano da quelle che Claude e opencode mandavano con i loro hook
(`code-notify`, plugin `notify.js` di opencode), che arrivavano in doppio.

## Cosa fa

- Ogni notifica porta `assets/notification-icon.png`: la pizza dell'app con
  Peppo (la fetta dei pets) più piccolo nell'angolo in basso a destra.
- Fuori dal codice, sulla macchina dell'utente: tolti gli hook di notifica
  esterni (`code-notify` in `~/.claude/settings.json`, plugin
  `~/.config/opencode/plugins/notify.js`). Restano solo le notifiche di
  PizzaManager, che sanno se la finestra è davanti e raggruppano.

## Come

- `assets/generate-notification-icon.py`: disegna lo sprite `idle` di Peppo
  letto via node da `renderer/pets-sprite-pizza.js` (niente griglia copiata).
  Escluso dal pacchetto.
- `app/notify.js`: opzione `icon`, passata alla `Notification` se c'è.
- `main.js`: passa il percorso dell'icona.

## Verifica

- `tests/notify-ipc.test.js`: con `icon` la Notification la riceve, senza
  non c'è il campo; il PNG esiste.
- Smoke: notifica Electron vera con l'icona su Linux.

## Ritocco: solo Peppo (2026-11-06)

Con il tema scuro di GNOME (le notifiche le disegna gnome-shell: sfondo e
stile non si scelgono dall'app, seguono il tema) l'icona è cambiata:

- Via la pizza: solo Peppo, grande quanto tutta l'icona (240×240, 12 px per
  cella), senza il contorno chiaro che sul fondo scuro stonava.
- Braccia e gambe nello sprite sono quasi nere (`#3A1F14`) e sul fondo scuro
  sparivano: nell'icona prendono il marrone della crosta (`#A85A24`). Le
  pupille restano scure, lo sprite dei pets non cambia.
- gnome-shell tiene in cache l'icona per percorso: dopo l'aggiornamento la
  vecchia resta finché non si rientra nella sessione.

# 44 — `feat/review-attiva`: commenti sul diff, inviati all'agente

Primo pezzo della «Review attiva» (`idee.md`). Gli altri, ognuno col suo
piano e il suo branch: commit dal pannello (45), merge di un branch qualsiasi
(46), PR (47).

## Cosa

Il pannello delle modifiche (piani 32, 43) è in sola lettura: si guarda il
diff, poi per chiedere una correzione all'agente si riscrive a mano
«in lib/a.js alla riga 42…». Qui si commenta direttamente la riga del diff, e
i commenti partono tutti insieme come un prompt.

```
┌─ Modifiche · dall'ultimo commit ─────────┐
│ ▾ M lib/a.js          +12 −3  💬2        │
│   41   const a = 1;                      │
│ ＋42 + const x = foo();   ← hover: ＋     │
│   ┌ Qui manca il controllo su null. ✎ ✕ ┐│
│ ▸ A lib/b.js          +40                │
│ 3 commenti · [Svuota] [Invia all'agente] │
└──────────────────────────────────────────┘
```

- **Aggiungere**: passando su una riga del diff compare `＋` nel margine; un
  clic apre una textarea sotto la riga. Ctrl+Invio salva, Esc annulla.
- **Nota salvata**: riquadro sotto la riga, ✎ modifica, ✕ toglie. Sulla riga
  del file, il contatore 💬.
- **Ancora**: `{ path, side, no, text, body }`. `side` è `old` solo per le
  righe tolte (`del`, numero `oldNo`), altrimenti `new` (`newNo`). `text` è la
  riga com'era quando si è scritta la nota. Id = `side:no:path`.
- **Riga sparita**: se il diff cambia sotto (l'agente lavora) e a quel numero
  non c'è più quella riga, la nota resta e compare in testa al file come «riga
  non più nel diff». Si invia lo stesso: il testo citato basta all'agente.
- **Vita**: in memoria, per scheda. Sopravvive a chiusura e riapertura del
  pannello e al cambio di modo; si svuota dopo l'invio e quando si chiude la
  scheda. Niente su disco.
- **Dove**: solo nelle schede con un agente (non `shell`, non `git`), come
  «Ultimo giro». In modalità «Unisci» niente commenti.
- **Invio**: il testo va nel terminale con `term.paste()` di xterm, **senza
  Invio**: l'utente rilegge e invia. Se l'agente sta lavorando o è su un menu
  dei permessi, un Invio automatico finirebbe nel posto sbagliato. Passare da
  `term.paste` e non da `window.aisess.write` vuol dire che l'incolla segue la
  strada di un tasto premuto (cattura del prompt, «Ultimo giro») e che xterm
  lo avvolge in `\x1b[200~…\x1b[201~` solo se l'agente ha acceso il bracketed
  paste. Se è spento ogni a capo diventerebbe un Invio: si rifiuta l'invio con
  un messaggio nel piè di pagina e le note restano. Il pannello si chiude e il
  fuoco torna al terminale.

Il testo inviato:

```
Review delle modifiche, correggi questi punti:

1. lib/a.js:42
   > const x = foo();
   Qui manca il controllo su null.

2. lib/b.js (riga 10 tolta)
   > old();
   Perché è stata tolta?
```

## Sicurezza

Righe del diff e note sono testo qualsiasi. Prima di finire nel pty se ne
tolgono i caratteri di controllo (ESC compreso, tranne `\n` e `\t`): un
`\x1b[201~` dentro un file chiuderebbe l'incolla e il resto arriverebbe come
tasti premuti. Nella pagina tutto con `textContent`, come il resto del
pannello. Limiti in costanti: nota ≤ 2000 caratteri, ≤ 50 note per scheda.

## Dove

- `renderer/review-notes.js` (nuovo, UMD puro come `changes-model.js`):
  `anchorOf(path, line)`, `addNote`/`removeNote` (restituiscono un nuovo
  elenco, niente mutazioni; `addNote` sulla stessa riga riscrive),
  `notesAt`/`orphansOf` (quali note stanno su una riga, quali sono orfane),
  `formatPrompt(notes)`, `sanitize(text)`, `pasteFor(notes, { bracketed })`
  (il testo da incollare, o perché no).
- `renderer/changes-view.js`: `＋` nel margine, textarea, riquadri delle
  note, note orfane in testa al file, contatore 💬, piè di pagina con Svuota e
  Invia.
- `renderer/changes-panel.js`: tiene le note sulla scheda (`tab.reviewNotes`,
  sostituito a ogni modifica), le passa alla vista, all'invio chiama
  `tab.term.paste(…)` e svuota; con la scheda se ne vanno anche le note.
- `renderer/changes-model.js`: dice se i commenti sono disponibili
  (scheda agente, non Unisci), accanto a `turnAvailable`.
- `renderer/index.html`: `review-notes.js` prima di `changes-view.js`.
- `renderer/styles.css`: margine, textarea, riquadri.

Nessun canale IPC nuovo: l'incolla passa da xterm, che scrive nel pty come
per un tasto premuto.

## Fuori

- Commit, stage/unstage, merge generico, PR: piani 45–47.
- Commenti su un intervallo di righe, persistenza su disco.
- Invio automatico con Invio.

## Verifica

- `npm run test:unit` verde: `tests/review-notes.test.js` (aggiungi, modifica,
  togli, ancore `old`/`new`, note orfane, formato, pulizia di ESC e di
  `\x1b[201~`, limiti), vista (`＋` solo con commenti disponibili, riquadri,
  contatore, piè di pagina), rifiuto senza bracketed paste, ordine degli
  script (`tests/renderer-load.test.js`).
- Smoke nell'app: in una scheda Claude, tre note su due file (una su una riga
  tolta), Invia → il testo compare nel prompt di Claude senza partire; Invio →
  Claude lavora sui punti.

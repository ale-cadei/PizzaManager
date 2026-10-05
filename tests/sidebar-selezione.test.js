const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Selezione «scheda sollevata» (tokens-selezione-scheda.css, adattata ai nomi e
   alla palette dell'app). La riga attiva diventa un cartoncino: superficie
   propria, bordo, e sotto un filetto pieno — dentro un fascicolo è il foglio
   tirato fuori dalla cartellina. Tre segnali e non uno di più; il filetto non è
   il viola del file originale ma il colore del tipo della sessione
   (--type-color), così la selezione alza l'identità che la card ha già. */

/* Luminanza relativa e L* (CIE): servono a verificare che i gradini di
   superficie siano veri gradini e che il testo ci resti leggibile sopra. */
const lin = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const lstar = (hex) => { const y = lum(hex); return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : y * 903.3; };
const contrasto = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const styles = () => fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const tokensFiles = ['renderer/tokens.css', 'aisessionmanager-tokens.css']
  .map((p) => path.join(__dirname, '..', p));

const strati = (value) => {
  // Gli strati si separano sulle virgole di primo livello: dentro color-mix()
  // ce ne sono altre che non dividono niente.
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
  }
  out.push(value.slice(start));
  return out.map((s) => s.trim());
};

ok('selezione: sotto la card attiva c è un solo filetto, del colore del tipo', () => {
  const css = styles();
  const m = css.match(/--shadow-session:\s*([^;]+);/);
  assert.ok(m, 'manca --shadow-session in styles.css');
  const layers = strati(m[1].replace(/\s+/g, ' ').trim());
  // Il cartoncino porta già superficie e bordo: un alone sfocato sarebbe il
  // quarto segnale sulla stessa riga, e quattro non si sommano, si annullano.
  assert.equal(layers.length, 1, `il rilievo ha più di un filetto: ${m[1]}`);
  assert.ok(/^0 \d+px 0 /.test(layers[0]), `il filetto è sfocato o spostato: ${layers[0]}`);
  assert.ok(/var\(--type-color/.test(layers[0]),
    `il filetto non è del colore della sessione: ${layers[0]}`);
  // Smorzato, non pieno: col cartoncino sotto, un colore a piena forza urla.
  assert.ok(/color-mix/.test(layers[0]), `il filetto è a piena forza: ${layers[0]}`);
});

/* Il cartoncino: una superficie che sale di un gradino pieno sopra il pannello
   del fascicolo, e un bordo che sale sopra di lei. Il gradino ha un tetto: più
   sale la superficie, meno contrasto ha sopra il testo dei metadati. */
ok('selezione: il cartoncino sale di un gradino vero e il testo ci resta sopra', () => {
  const tokens = fs.readFileSync(tokensFiles[0], 'utf8');
  // I valori della sidebar sono quelli veri: lì dentro vivono le card. Quello
  // che la sidebar non ridefinisce (i testi) lo eredita da :root.
  const sidebar = tokens.slice(tokens.indexOf('#sidebar {'));
  const root = tokens.slice(0, tokens.indexOf('#sidebar {'));
  const val = (name) => {
    const re = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`);
    const m = sidebar.match(re) || root.match(re);
    assert.ok(m, `manca ${name} nella palette della sidebar`);
    return m[1];
  };
  const card = val('--surface-session-card');
  const bordo = val('--border-session-card');
  const pannello = val('--surface-group');
  assert.ok(lstar(card) - lstar(pannello) >= 6,
    `il cartoncino non si stacca dal pannello: Δ ${(lstar(card) - lstar(pannello)).toFixed(1)} L*`);
  assert.ok(lstar(bordo) > lstar(card), 'il bordo del cartoncino è più scuro della sua superficie');
  // I metadati (--text-muted) sono il testo più debole che ci finisce sopra.
  assert.ok(contrasto(card, val('--text-muted')) >= 4.5,
    `sul cartoncino i metadati scendono a ${contrasto(card, val('--text-muted')).toFixed(2)}:1`);
});

/* Le righe a riposo hanno un bordo trasparente della stessa misura: senza, al
   cambio di selezione la card cresce di 2px e la lista salta sotto il cursore. */
ok('selezione: il bordo del cartoncino non fa saltare la lista', () => {
  const css = styles();
  const item = css.match(/\n\.session-item \{[^}]*\}/);
  assert.ok(/border:\s*1px solid transparent/.test(item[0]),
    'le righe a riposo non riservano lo spazio del bordo: ' + item[0]);
  const active = css.match(/\n\.session-item\.active \{[^}]*\}/);
  assert.ok(/border-color:\s*var\(--border-session-card\)/.test(active[0]),
    'la card attiva non prende il bordo del cartoncino');
  assert.ok(/background:\s*var\(--surface-session-card\)/.test(active[0]),
    'la card attiva non prende la superficie del cartoncino');
});

/* Una custom property che contiene var() viene sostituita sull'elemento che la
   DICHIARA, non su quello che la usa: dichiarata in :root, var(--type-color) è
   già caduta sul fallback (la crosta) e ogni sessione avrebbe l'ombra gialla —
   è successo. Deve stare sulla card, dove la classe .type-* ha appena definito
   --type-color sullo stesso elemento. */
ok('selezione: il rilievo è dichiarato dove il tipo esiste, non in :root', () => {
  for (const file of tokensFiles) {
    const css = fs.readFileSync(file, 'utf8');
    assert.ok(!/--shadow-session:/.test(css),
      `${path.basename(file)} dichiara --shadow-session fuori dalla card: il colore del tipo non ci arriva`);
  }
  const css = styles();
  const decl = css.match(/([^\n{}]+)\{[^}]*--shadow-session:/);
  assert.ok(decl, 'nessuno dichiara --shadow-session');
  const selettore = decl[1].trim();
  assert.ok(/^\.session-item/.test(selettore),
    `--shadow-session è dichiarato su "${selettore}": lì --type-color non è ancora quello della card`);
  // …e il tipo deve essere definito sulla card stessa, non ereditato: se
  // arrivasse dal gruppo, in modalità progetto non arriverebbe affatto.
  assert.ok(/\.session-item[^\n{}]*\.type-|\.type-\w+\s*\{\s*--type-color/.test(css),
    'il tipo non è definito sulla card');
});

/* La barra del tipo sta DENTRO la card, staccata dal bordo: appoggiata al
   bordo sembrerebbe un segno del pannello, non della riga. Il testo le lascia
   spazio, altrimenti ci finisce sopra. */
ok('selezione: la barra del tipo è rientrata e il testo le fa posto', () => {
  const css = styles();
  const barra = css.match(/\n\.session-item::before \{[^}]*\}/);
  assert.ok(barra, 'manca la barra del tipo');
  const left = Number(barra[0].match(/left:\s*(\d+)px/)[1]);
  const width = Number(barra[0].match(/width:\s*(\d+)px/)[1]);
  assert.ok(left > 0, 'la barra del tipo è appoggiata al bordo della card');
  const item = css.match(/\n\.session-item \{[^}]*\}/);
  const padLeft = Number(item[0].match(/padding:[^;]*\s(\d+)px;/)[1]);
  assert.ok(padLeft >= left + width + 4, `il testo parte sopra la barra: padding ${padLeft}, barra fino a ${left + width}`);
});

/* Le card respirano: dentro (l'altezza della riga) e fuori (il margine che il
   pannello lascia attorno). Appoggiate al bordo del fascicolo sembrano il
   contenuto di una tabella, non fogli dentro una cartellina. */
ok('sidebar: le card respirano dentro e il pannello lascia margine attorno', () => {
  const css = styles();
  const item = css.match(/\n\.session-item \{[^}]*\}/);
  const padCard = Number(item[0].match(/padding:\s*(\d+)px/)[1]);
  assert.ok(padCard >= 9, `la riga è schiacciata: padding verticale ${padCard}px`);
  const body = css.match(/\n\.group-body \{[^}]*\}/);
  const padPannello = Number(body[0].match(/padding:\s*(\d+)px/)[1]);
  // Almeno quanto lo spazio fra due righe: sotto quella misura il bordo del
  // pannello stringe le card più di quanto le righe stiano fra loro.
  const gap = Number(fs.readFileSync(tokensFiles[0], 'utf8').match(/--space-session-gap:\s*(\d+)px/)[1]);
  assert.ok(padPannello >= gap + 4,
    `il pannello stringe le card: padding ${padPannello}px contro un gap di ${gap}px`);
});

ok('selezione: lo spazio riservato sotto la riga supera lo spessore del filetto', () => {
  const tokens = fs.readFileSync(tokensFiles[0], 'utf8');
  const thickness = Number(styles().match(/--shadow-session:\s*0 (\d+)px 0 /)[1]);
  const gap = Number(tokens.match(/--space-session-gap:\s*(\d+)px/)[1]);
  assert.ok(gap > thickness, 'il filetto finisce sotto la riga successiva');
  // Lo spazio lo tiene il pannello per TUTTE le righe: se lo prendesse solo la
  // riga attiva, cambiare sessione farebbe saltare la lista di quei pixel.
  const body = styles().match(/\n\.group-body \{[^}]*\}/);
  assert.ok(/gap:\s*var\(--space-session-gap\)/.test(body[0]),
    'il pannello non riserva lo spazio del filetto a ogni riga: la lista salta');
});

ok('selezione: la card attiva ha il filetto, l hover è solo il fondo', () => {
  const css = styles();
  const active = css.match(/\n\.session-item\.active \{[^}]*\}/);
  assert.ok(active, 'manca la regola .session-item.active');
  assert.ok(/box-shadow:\s*var\(--shadow-session\)/.test(active[0]), 'la card attiva non ha il filetto');
  // L'hover prende SOLO il fondo, e non tocca la riga già attiva: col bordo o
  // col filetto, passando il mouse sembrerebbe di aver selezionato.
  const hover = css.match(/\n\.session-item:hover:not\(\.active\) \{[^}]*\}/);
  assert.ok(hover, "l hover non esclude la riga attiva: gliene cambia il fondo sotto il cursore");
  assert.ok(!/box-shadow|border-color/.test(hover[0]), 'l hover imita la selezione: ' + hover[0]);
});

ok('selezione: le righe non attive arretrano, l attiva torna piena', () => {
  const css = styles();
  const dim = css.match(/\n\.session-item \.name \{[^}]*\}/);
  const full = css.match(/\n\.session-item\.active \.name \{[^}]*\}/);
  assert.ok(dim && /color:\s*var\(--text-muted\)/.test(dim[0]),
    'i titoli delle righe non attive non arretrano: metà del segnale è questo, non il filetto');
  assert.ok(full && /color:\s*var\(--text\)/.test(full[0]), 'il titolo della riga attiva non torna pieno');
  // Anche il percorso risale di un gradino: --text-dim, che sul pannello basta,
  // sulla superficie chiara del cartoncino scenderebbe sotto 4.5:1.
  const meta = css.match(/\n\.session-item\.active \.sub \{[^}]*\}/);
  assert.ok(meta && /color:\s*var\(--text-muted\)/.test(meta[0]),
    'il percorso della riga attiva resta al livello più basso: sul cartoncino non si legge');
});

ok('selezione: il filetto è solo della card, il fascicolo non lo prende', () => {
  const css = styles();
  // Il filetto dice «questa riga è selezionata» e la riga è una: se lo portasse
  // anche il gruppo, il segnale comparirebbe due volte per la stessa scelta.
  // Sul fascicolo resta --shadow-stack, che dice un'altra cosa (sta sopra).
  for (const regola of css.match(/\n\.session-group[^\n{]*\{[^}]*\}/g) || []) {
    assert.ok(!/var\(--shadow-session\)/.test(regola),
      'il filetto della selezione è finito sul gruppo: ' + regola.trim());
  }
  const active = css.match(/\n\.session-item\.active \{[^}]*\}/);
  assert.ok(/box-shadow:\s*var\(--shadow-session\)/.test(active[0]),
    'senza il filetto sulla card la selezione non si vede da nessuna parte');
});

/* Il marker sulla linguetta del gruppo chiuso prende il colore dal tipo della
   sessione attiva, che in modalità progetto non è il tipo del gruppo: senza
   questa classe un gruppo «~/repo» avrebbe il marker color crosta mentre la
   card che rappresenta ce l'ha verde. */
ok('selezione: il gruppo dichiara il tipo della sessione attiva che contiene', () => {
  const { installDocument, createElement, descendants, createStorage } = require('./fake-dom');
  const Groups = require('../renderer/session-groups');
  const { createSidebar } = require('../renderer/sidebar');
  const restore = installDocument();
  try {
    const list = createElement('div');
    const sidebar = createSidebar({
      list, count: createElement('span'), storage: createStorage({}),
      Icons: { markup: () => '' }, Slice: { markup: () => '' },
      Groups, escapeHtml: (s) => String(s),
      onSelect: () => {}, onClose: () => {}, onRename: () => {},
    });
    const sessions = [
      { id: 'a', type: 'codex', name: 'a', cwd: '/repo', alive: true },
      { id: 'b', type: 'shell', name: 'b', cwd: '/repo', alive: true },
    ];
    sidebar.render(sessions, 'a');
    const groups = descendants(list).filter((n) => n.classes.has('session-group'));
    const focused = groups.find((g) => g.classes.has('is-focused'));
    assert.ok(focused, 'nessun gruppo segnalato come attivo');
    assert.ok(focused.classes.has('type-codex'),
      'il gruppo attivo non dice di che tipo è la sessione selezionata');
    const altri = groups.filter((g) => g !== focused);
    for (const g of altri) {
      assert.ok(![...g.classes].some((c) => c.startsWith('type-')),
        'un gruppo senza la sessione attiva non deve portare un colore di tipo');
    }
  } finally { restore(); }
});

/* Il lampeggio «l'assistente ha finito» parla della SESSIONE: deve essere del
   suo colore, come la barra laterale e il filetto di selezione. Con un pomodoro
   uguale per tutte, di sfuggita non si capiva chi stesse chiamando. Stessa
   trappola del filetto: le tinte vanno dichiarate dove .type-* ha definito
   --type-color, non in :root. */
ok('lampeggio: la pulsazione è del colore del tipo, dichiarato dove il tipo esiste', () => {
  const css = styles();
  const pulse = css.match(/@keyframes attention-pulse[\s\S]*?\n\}/g);
  assert.ok(pulse && pulse.length === 2, 'mancano le due pulsazioni (card e linguetta)');
  for (const k of pulse) {
    assert.ok(!/--action-soft|--action-ring/.test(k),
      `la pulsazione usa il pomodoro d azione invece del colore della sessione: ${k}`);
    assert.ok(/var\(--attention-fill\)/.test(k) && /var\(--attention-ring\)/.test(k),
      `la pulsazione non usa le tinte del tipo: ${k}`);
  }
  for (const prop of ['--attention-fill', '--attention-ring']) {
    for (const file of tokensFiles) {
      assert.ok(!fs.readFileSync(file, 'utf8').includes(`${prop}:`),
        `${path.basename(file)} dichiara ${prop} fuori dalla card: il colore del tipo non ci arriva`);
    }
    const decl = css.match(new RegExp(`([^\\n{}]+)\\{[^}]*${prop}:\\s*([^;]+);`));
    assert.ok(decl, `nessuno dichiara ${prop}`);
    const selettore = decl[1].trim();
    assert.ok(/^\.session-item|^\.group-header/.test(selettore),
      `${prop} è dichiarato su "${selettore}": lì --type-color non è quello della sessione`);
    assert.ok(/var\(--type-color/.test(decl[2]), `${prop} non deriva dal colore del tipo: ${decl[2]}`);
  }
  // Anche chi ha disattivato le animazioni vede la tinta giusta, non il pomodoro.
  const ridotti = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}\n/g) || [];
  assert.ok(ridotti.some((b) => /needs-attention[\s\S]{0,120}background:\s*var\(--attention-fill\)/.test(b)),
    'senza animazioni la card resta del colore sbagliato');
});

/* Il lampeggio deve SALIRE e scendere, non accendersi e spegnersi di scatto.
   Una custom property non registrata vale del testo: `background:
   var(--attention-fill)` resta un color-mix() da fare, e un valore che si
   risolve così tardi il Chromium di Electron 33 non lo interpola — misurato,
   l'animazione diventava a due stati. Registrandole con @property il colore è
   calcolato subito e il motore ci mescola sopra. Vale finché le tinte passano
   da color-mix: se un giorno tornassero colori scritti a mano, questo test si
   può togliere insieme a loro. */
ok('lampeggio: le tinte animate sono colori registrati, o l animazione va a scatti', () => {
  const css = styles();
  const pulse = (css.match(/@keyframes attention-pulse[\s\S]*?\n\}/g) || []).join('\n');
  const usate = [...new Set([...pulse.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
  assert.ok(usate.length, 'la pulsazione non usa nessuna tinta');
  for (const prop of usate) {
    const reg = css.match(new RegExp(`@property ${prop} \\{[^}]*\\}`));
    assert.ok(reg, `${prop} non è registrata: il suo color-mix arriva all animazione come testo e il lampeggio scatta`);
    assert.ok(/syntax:\s*'<color>'/.test(reg[0]), `${prop} non è registrata come colore: ${reg[0]}`);
  }
  // Gli estremi del ciclo devono essere tinte registrate anche loro: un
  // `transparent` o un `none` scritto lì rimetterebbe a confronto due valori
  // che il motore non sa mescolare.
  for (const k of css.match(/@keyframes attention-pulse[\s\S]*?\n\}/g) || []) {
    assert.ok(!/(background|box-shadow):[^;]*\b(transparent|none)\b/.test(k),
      `un estremo del ciclo non è una tinta registrata: ${k}`);
  }
});

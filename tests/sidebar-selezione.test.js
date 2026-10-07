const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { test: ok } = require('node:test');

/* Selezione «sollevata»: la riga attiva è la stessa card ingrandita di
   --lift-scale, con un gradino di superficie in più, ombra, filo e un contorno
   leggero del colore della sessione. La barra laterale resta del suo colore. */

const styles = () => fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const tokensFiles = ['renderer/tokens.css', 'aisessionmanager-tokens.css']
  .map((p) => path.join(__dirname, '..', p));

ok('selezione: la card attiva si solleva ingrandita', () => {
  const css = styles();
  const active = css.match(/\n\.session-item\.active \{[^}]*\}/);
  assert.ok(active, 'manca la regola .session-item.active');
  assert.ok(/background:\s*var\(--surface-lift\)/.test(active[0]), 'la card attiva non ha il suo fondo: ' + active[0]);
  assert.ok(/box-shadow:\s*var\(--shadow-lift\)/.test(active[0]), 'la card attiva non ha l ombra: ' + active[0]);
  // Ingrandimento vero: tutto il contenuto scala insieme, distanze comprese.
  // `scale` e non `transform`, che il riordino (FLIP) sovrascrive inline.
  assert.ok(/\n\s*scale:\s*var\(--lift-scale\)/.test(active[0]), 'la card attiva non è ingrandita: ' + active[0]);
  assert.ok(!/transform:/.test(active[0]), 'lo zoom passa da transform: il riordino lo cancellerebbe');
  // La scala non occupa spazio: il margine riserva la crescita o copre le righe accanto.
  assert.ok(/margin:\s*calc\(\d+px \+ var\(--lift-grow\)\)/.test(active[0]), 'la card ingrandita copre le righe accanto');
  // Contorno leggero del colore della sessione, non un accento fisso.
  assert.ok(/border-color:\s*color-mix\(in srgb, var\(--type-color/.test(active[0]),
    'il contorno non è del colore della sessione: ' + active[0]);
  // --type-color deve essere definito sulla card stessa, non ereditato: se
  // arrivasse dal gruppo, in modalità progetto non arriverebbe affatto.
  assert.ok(/\.type-\w+\s*\{\s*--type-color/.test(css), 'il tipo non è definito sulla card');
});

/* La card ingrandita esce dal pannello: la lista non deve scorrere di lato. */
ok('selezione: la card ingrandita non apre uno scroll orizzontale', () => {
  assert.ok(/#session-list \{[^}]*overflow-x:\s*hidden/.test(styles()), 'la lista scorre di lato sotto la card ingrandita');
});

/* La barra scala con la card (niente spostamenti a mano) e resta del colore
   della sessione: un colore fisso le farebbe perdere l'identità. */
ok('selezione: la barra della riga sollevata è del colore della sessione e scala con la card', () => {
  const css = styles();
  const activeBar = css.match(/\n\.session-item\.active::before \{[^}]*\}/);
  assert.ok(activeBar, 'manca la regola della barra attiva');
  assert.ok(!/\bleft:/.test(activeBar[0]), 'la barra è spostata a mano invece di scalare con la card: ' + activeBar[0]);
  assert.ok(!/--type-color|background/.test(activeBar[0]), 'la barra attiva cambia colore: ' + activeBar[0]);
  assert.ok(/opacity:\s*1/.test(activeBar[0]), 'la barra attiva non è piena: ' + activeBar[0]);
});

/* --shadow-lift contiene var(--border): va dichiarata dove --border è quello
   della sidebar, non su :root, o il filo prenderebbe il bordo della palette forno. */
ok('selezione: l ombra della riga sollevata usa il bordo della sidebar', () => {
  const tokens = fs.readFileSync(tokensFiles[0], 'utf8');
  const sidebar = tokens.slice(tokens.indexOf('#sidebar,'));
  assert.ok(/--shadow-lift:[^;]*var\(--border\)/.test(sidebar), '--shadow-lift non è nella palette della sidebar');
  assert.ok(/--surface-lift:\s*color-mix\(in srgb, var\(--action\)/.test(sidebar),
    '--surface-lift non segue il colore principale');
});

ok('selezione: la card attiva mostra il marker ◆', () => {
  assert.ok(/\.session-item\.active\s*>\s*\.sel-mark\s*\{[^}]*visibility:\s*visible/.test(styles()),
    'il marker non viene mostrato sulla card attiva');
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
    sidebar.render([{ id: 'a', type: 'codex', name: 'a', cwd: '/repo', alive: true }], 'a');
    const card = descendants(list).find((n) => n.classes.has('session-item'));
    assert.ok(card, 'nessuna card disegnata');
    assert.ok(card.innerHTML.includes('class="sel-mark"'), 'la card non disegna il marker ◆');
  } finally { restore(); }
});

/* Le superfici della sidebar sono color-mix() col colore principale scelto da
   View → Colori…: vanno provate con più di un principale. */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Il valore di un token della sidebar con `action` come colore principale. */
const sidebarToken = (tokens, name, action) => {
  // Quello che la sidebar non ridefinisce (i testi) lo eredita da :root.
  const sidebar = tokens.slice(tokens.indexOf('#sidebar,'));
  const root = tokens.slice(0, tokens.indexOf('#sidebar,'));
  const mix = sidebar.match(new RegExp(
    `${name}:\\s*color-mix\\(in srgb, var\\(--action\\) (\\d+)%, (#[0-9A-Fa-f]{6})\\)`));
  if (mix) {
    const p = Number(mix[1]) / 100;
    const [a, b] = [rgb(action), rgb(mix[2])];
    return hex(a.map((c, i) => c * p + b[i] * (1 - p)));
  }
  const re = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`);
  const m = sidebar.match(re) || root.match(re);
  assert.ok(m, `manca ${name} nella palette della sidebar`);
  return m[1];
};

/* Il colore principale deve arrivare davvero allo sfondo: se la sidebar
   tornasse a esadecimali fissi, cambiare colore da View → Colori… non la
   toccherebbe più. */
ok('sidebar: lo sfondo segue il colore principale', () => {
  const tokens = fs.readFileSync(tokensFiles[0], 'utf8');
  for (const name of ['--surface', '--surface-group', '--border']) {
    assert.notEqual(sidebarToken(tokens, name, '#F04E23'), sidebarToken(tokens, name, '#5AA2FF'),
      `${name} non cambia col colore principale`);
  }
});

/* Le righe a riposo hanno un bordo trasparente della stessa misura: senza, al
   cambio di selezione la card cresce di 2px e la lista salta sotto il cursore. */
ok('selezione: il contorno non fa saltare la lista', () => {
  const css = styles();
  const item = css.match(/\n\.session-item \{[^}]*\}/);
  assert.ok(/border:\s*1px solid transparent/.test(item[0]),
    'le righe a riposo non riservano lo spazio del bordo: ' + item[0]);
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

ok('selezione: l hover è solo il fondo', () => {
  const css = styles();
  // L'hover prende SOLO il fondo, e non tocca la riga già attiva: col bordo,
  // passando il mouse sembrerebbe di aver selezionato.
  const hover = css.match(/\n\.session-item:hover:not\(\.active\) \{[^}]*\}/);
  assert.ok(hover, "l hover non esclude la riga attiva: gliene cambia il fondo sotto il cursore");
  assert.ok(!/box-shadow|border-color/.test(hover[0]), 'l hover imita la selezione: ' + hover[0]);
});

ok('selezione: le righe non attive arretrano, l attiva torna piena', () => {
  const css = styles();
  const dim = css.match(/\n\.session-item \.name \{[^}]*\}/);
  const full = css.match(/\n\.session-item\.active \.name \{[^}]*\}/);
  assert.ok(dim && /color:\s*var\(--text-muted\)/.test(dim[0]),
    'i titoli delle righe non attive non arretrano: metà del segnale è questo, non il contorno');
  assert.ok(full && /color:\s*var\(--text\)/.test(full[0]), 'il titolo della riga attiva non torna pieno');
  // Anche il percorso risale di un gradino.
  const meta = css.match(/\n\.session-item\.active \.sub \{[^}]*\}/);
  assert.ok(meta && /color:\s*var\(--text-muted\)/.test(meta[0]),
    'il percorso della riga attiva resta al livello più basso');
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
   suo colore, come la barra laterale e il contorno di selezione. Con un pomodoro
   uguale per tutte, di sfuggita non si capiva chi stesse chiamando. Le tinte vanno dichiarate dove .type-* ha definito
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

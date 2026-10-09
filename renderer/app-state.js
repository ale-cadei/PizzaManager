/* PizzaManager renderer — stato condiviso.
 *
 * Il renderer è diviso in più script classici (docs/plans/21-split-renderer.md):
 * le dichiarazioni di primo livello di uno script sono visibili a quelli
 * caricati dopo. Questo va caricato per primo, renderer.js per ultimo.
 * Il codice che gira al caricamento (fuori da una funzione) in ogni file può
 * usare solo ciò che sta qui o nel file stesso. */
const tabs = new Map();
let activeId = null;
/* Con tmux le sessioni sopravvivono alla chiusura: la ✕ stacca, «Termina» uccide. */
let tmuxAvailable = false;
let tmuxPath = null;
let counter = 1;
let pendingNewType = 'shell';
let resumeTab = 'opencode';
let resumeProjectFilterRoot = null;
let resumeCache = { opencode: null, claude: null, codex: null, history: null };
const emptyResumeCache = () => ({ opencode: null, claude: null, codex: null, history: null });

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Marchi ufficiali degli agenti (renderer/agent-icons.js)
const Icons = window.AisessIcons;
// Logo dell'app: pizza con la fetta sollevata (renderer/pizza-logo.js)
const Logo = window.PizzaLogo;
const Groups = window.AisessGroups;
const Order = window.AisessOrder;
const Sidebar = window.AisessSidebar;
// Fumetto di conferma appoggiato a una card (renderer/confirm-bubble.js)
const ConfirmBubble = window.AisessConfirmBubble;
// Regola del lampeggio «l'assistente ha finito» (renderer/attention.js)
const Attention = window.AisessAttention;
// «Sta lavorando adesso»: barra del tipo animata (renderer/running.js)
const Running = window.AisessRunning;
// Il segnale esatto degli hook degli agenti (renderer/agent-state.js, piano 46)
const AgentState = window.AisessAgentState;
const Titles = window.AisessTitles;
// Linguetta «Cerca» del Resume: frammenti, stati, debounce (renderer/search-results.js)
const ConvSearch = window.AisessSearch;
const ShellSearch = window.AisessShellSearch;
const PromptCapture = window.AisessPromptCapture;
const ShellIcons = window.AisessShellIcons;
/* I nomi rinominati a mano sopravvivono alla chiusura dell'app: stanno in
   localStorage, non nello stato in memoria delle schede. */
const titleStore = Titles.createTitleStore(window.localStorage);
// Tipi con un binario esterno da risolvere (lo shell è sempre disponibile)
const AI_TYPES = ['opencode', 'claude', 'codex', 'antigravity'];

// Corpo del testo dei terminali: una dimensione per tutte le schede, scelta
// dal menu Vista e ricordata (renderer/term-font.js)
const termFont = window.AisessTermFont.createFontSizeStore(window.localStorage);
const TERM_LINE_HEIGHT = 1.2;

// Animaletti in fondo alla finestra, accesi e scelti dal menu View (renderer/pets-config.js)
const petsStore = window.AisessPetsConfig.createPetsStore(window.localStorage);

// Notifiche di sistema accese o spente dal menu View (renderer/notify.js, piano 38)
const notifyStore = window.AisessNotify.createNotifyStore(window.localStorage);

// Colore principale e colori dei tipi scelti dal menu View (renderer/type-color-themes.js):
// si applicano subito, prima che la sidebar disegni la prima card.
const COLOR_KEYS = [window.AisessTypeColors.ACTION, ...Groups.TYPE_ORDER];
const COLOR_LABELS = { [window.AisessTypeColors.ACTION]: 'Colore principale', ...Groups.TYPE_LABELS };
const typeColors = window.AisessColorThemes.createThemeStore(window.localStorage, COLOR_KEYS);
window.AisessTypeColors.applyTypeColors(document.documentElement.style,
  window.AisessColorThemes.appliedColors(typeColors.get(), window.AisessColorThemes.THEMES, COLOR_KEYS), COLOR_KEYS);

/* Tema del terminale, allineato ai token (renderer/tokens.css): il fondo e il
   testo sono gli stessi dell'app, e i tre colori "di stato" della palette
   prendono il posto dei corrispondenti ANSI, così un ✔ verde del terminale è
   lo stesso verde del pallino "in esecuzione".
   Ciano e magenta restano quelli di default di xterm: la palette Forno non ha
   un colore freddo da prestargli, e reinventarlo caldo li renderebbe
   indistinguibili dal rosso. */
const TERM_THEME = {
  background: '#070505',        // --bg
  foreground: '#F6F1EC',        // --text
  black: '#070505',
  brightBlack: '#8A7A72',       // --text-faint
  white: '#F6F1EC',
  brightWhite: '#FFFFFF',
  green: '#7FC45A',             // --state-ok
  red: '#FF4D74',               // --state-error
  yellow: '#F2C14E',            // --accent (crosta)
};

/* Un colore CSS qualsiasi (anche color-mix(), che getComputedStyle restituisce
   come color(srgb …)) in #rrggbb: xterm vuole un colore che sa leggere. Lo
   risolve il canvas, che parla la stessa lingua del CSS della pagina. */
function cssColorToHex(value, fallback) {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !value) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/* Cursore e selezione seguono il colore principale, che si può cambiare dal
   menu View: si leggono da --action/--action-soft, non si ricopiano qui.
   Anche il fondo: è il --bg di #main (tokens.css), tinto dal principale, così
   il canvas del terminale non resta un rettangolo di un altro nero. */
function termTheme() {
  const css = getComputedStyle(document.documentElement);
  const main = document.getElementById('main');
  const background = main
    ? cssColorToHex(getComputedStyle(main).backgroundColor, TERM_THEME.background)
    : TERM_THEME.background;
  return {
    ...TERM_THEME,
    background,
    black: background,
    cursor: css.getPropertyValue('--action').trim(),
    selectionBackground: css.getPropertyValue('--action-soft').trim(),
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
const Titles = window.AisessTitles;
const PromptCapture = window.AisessPromptCapture;
/* I nomi rinominati a mano sopravvivono alla chiusura dell'app: stanno in
   localStorage, non nello stato in memoria delle schede. */
const titleStore = Titles.createTitleStore(window.localStorage);
// Tipi con un binario esterno da risolvere (lo shell è sempre disponibile)
const AI_TYPES = ['opencode', 'claude', 'codex', 'antigravity'];

// Corpo del testo dei terminali: una dimensione per tutte le schede, scelta
// dal menu Vista e ricordata (renderer/term-font.js)
const termFont = window.AisessTermFont.createFontSizeStore(window.localStorage);
const TERM_LINE_HEIGHT = 1.2;

// Colore principale e colori dei tipi cambiati dal menu View (renderer/type-colors.js):
// si applicano subito, prima che la sidebar disegni la prima card.
const COLOR_KEYS = [window.AisessTypeColors.ACTION, ...Groups.TYPE_ORDER];
const COLOR_LABELS = { [window.AisessTypeColors.ACTION]: 'Colore principale', ...Groups.TYPE_LABELS };
const typeColors = window.AisessTypeColors.createTypeColorStore(window.localStorage, COLOR_KEYS);
window.AisessTypeColors.applyTypeColors(document.documentElement.style, typeColors.get(), COLOR_KEYS);

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

/* Cursore e selezione seguono il colore principale, che si può cambiare dal
   menu View: si leggono da --action/--action-soft, non si ricopiano qui. */
function termTheme() {
  const css = getComputedStyle(document.documentElement);
  return {
    ...TERM_THEME,
    cursor: css.getPropertyValue('--action').trim(),
    selectionBackground: css.getPropertyValue('--action-soft').trim(),
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

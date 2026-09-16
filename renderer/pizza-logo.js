/* Logo di PizzaManager: pizza intera con una fetta sollevata.
 *
 * È il claim disegnato — "sessioni AI, una fetta alla volta": la fetta esce
 * dalla ruota, e il buco che lascia resta visibile. Il buco è una maschera
 * (il settore viene ritagliato dalla pizza) e non un settore ridipinto di
 * nero: così il logo funziona su qualsiasi superficie, non solo su --bg.
 *
 * I colori sono quelli dell'icona dell'app (assets/generate-icon.py) e non
 * token CSS: il logo deve restare sé stesso anche dentro un modale o su una
 * superficie elevata, mentre i token cambiano col contesto.
 *
 * Il markup è statico (nessun dato utente ci finisce dentro): può essere
 * assegnato via innerHTML senza rischio di injection. L'unica parte variabile
 * è l'id della maschera, che il chiamante deve rendere unico quando il logo
 * compare più di una volta nella stessa pagina (due `id` uguali e il browser
 * applicherebbe la prima maschera a entrambi gli SVG).
 *
 * Wrapper UMD come pizza-slice.js: globale `PizzaLogo` nella pagina (il
 * renderer non ha require) e module.exports sotto Node, per i test.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.PizzaLogo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const CRUST = '#E7A33C';
  const CHEESE = '#F5C45A';
  const PEPPERONI = '#E2412A';
  const BASIL = '#7FC45A';

  /* Ruota centrata in (50,54) per lasciare sopra lo spazio della fetta alzata.
     Il settore tagliato e quello sollevato condividono gli stessi angoli: la
     fetta che esce è esattamente il pezzo che manca. */
  const GAP = 'M50,54 L59.3,19.2 A36,36 0 0 1 82.6,38.8 Z';

  /** SVG del logo. `id` distingue la maschera quando il logo compare più volte. */
  function markup(id = 'pizza-logo-cut') {
    /* Decorativo: accanto al logo c'è sempre il nome scritto, e un secondo
       "PizzaManager" letto dallo screen reader sarebbe solo rumore. */
    return `<svg viewBox="0 0 100 100" class="pizza-logo" aria-hidden="true" focusable="false">`
      + `<mask id="${id}">`
      + `<rect x="0" y="0" width="100" height="100" fill="#fff" />`
      + `<path d="${GAP}" fill="#000" />`
      + `</mask>`
      + `<g mask="url(#${id})">`
      + `<circle cx="50" cy="54" r="34" fill="${CRUST}" />`
      + `<circle cx="50" cy="54" r="27.5" fill="${CHEESE}" />`
      + `<circle cx="36" cy="46" r="5" fill="${PEPPERONI}" />`
      + `<circle cx="54" cy="66" r="5.6" fill="${PEPPERONI}" />`
      + `<circle cx="33" cy="64" r="3.6" fill="${PEPPERONI}" />`
      + `<circle cx="47" cy="40" r="2.6" fill="${BASIL}" />`
      + `<circle cx="28" cy="54" r="2.4" fill="${BASIL}" />`
      + `</g>`
      /* La fetta: stessa geometria, traslata in alto a destra e ruotata di 7°,
         come se la stessero staccando. */
      + `<g transform="translate(7.5,-9) rotate(7 50 54)">`
      + `<path d="M50,54 L59.0,20.2 A33,33 0 0 1 80.6,38.6 Z" fill="${CRUST}" />`
      + `<path d="M50,54 L58.4,26.8 A27.5,27.5 0 0 1 74.6,40.6 Z" fill="${CHEESE}" />`
      + `<circle cx="63" cy="38" r="4.4" fill="${PEPPERONI}" />`
      + `<circle cx="57" cy="45" r="2.2" fill="${BASIL}" />`
      + `</g>`
      + `</svg>`;
  }

  /** Riempie ogni segnaposto `[data-pizza-logo]` del documento. */
  function hydrate(doc) {
    const nodes = doc.querySelectorAll('[data-pizza-logo]');
    nodes.forEach((node, i) => { node.innerHTML = markup(`pizza-logo-cut-${i}`); });
  }

  return { markup, hydrate };
});

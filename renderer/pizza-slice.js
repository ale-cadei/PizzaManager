/* Fetta di pizza: il glifo che apre e chiude i gruppi della sidebar.
 *
 * Sostituisce le vecchie freccine ▸/▾: la punta guarda a destra (gruppo chiuso)
 * e la CSS ruota di 90° in senso orario quando il gruppo è aperto, portandola in
 * basso. Così il verso resta quello di un chevron, e la rotazione è una sola
 * regola in styles.css invece di due disegni.
 *
 * I colori ricalcano quelli dell'icona dell'app (assets/generate-icon.py):
 * cornicione, formaggio, salame.
 *
 * Il markup è statico (nessun dato utente ci finisce dentro): può essere
 * assegnato via innerHTML senza rischio di injection.
 *
 * Wrapper UMD come sidebar.js: globale `PizzaSlice` nella pagina (il renderer
 * non ha require) e module.exports sotto Node, per poterlo leggere dai test.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.PizzaSlice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const CRUST = '#E7A33C';
  const CHEESE = '#F5C45A';
  const PEPPERONI = '#E2412A';

  /* Punta in (12.8, 8), cornicione sull'arco di sinistra: la fetta punta a
     destra, cioè dove si aprirà il gruppo. L'arco ha centro sulla punta, quindi
     è un settore vero e non un triangolo smussato. */
  const TIP = 'M12.8 8 L3.6 3.6 A10.2 10.2 0 0 0 3.6 12.4 Z';
  const RIND = 'M3.6 3.6A10.2 10.2 0 0 0 3.6 12.4';

  const MARKUP = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">`
    + `<path d="${TIP}" fill="${CHEESE}" />`
    + `<path d="${RIND}" fill="none" stroke="${CRUST}" stroke-width="2.4" stroke-linecap="round" />`
    + `<circle cx="8.2" cy="8" r="1.1" fill="${PEPPERONI}" />`
    + `<circle cx="5.6" cy="6.1" r="0.9" fill="${PEPPERONI}" />`
    + `<circle cx="5.8" cy="10.2" r="0.9" fill="${PEPPERONI}" />`
    + `</svg>`;

  /** SVG della fetta, orientata a destra. Il verso "aperto" lo dà la CSS. */
  function markup() {
    return MARKUP;
  }

  return { markup };
});

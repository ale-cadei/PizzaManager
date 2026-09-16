/* Fetta di pizza: il glifo che apre e chiude i gruppi della sidebar.
 *
 * Sostituisce le vecchie freccine ▸/▾: il tracciato punta a destra (gruppo
 * chiuso) e la CSS lo ruota di 90° quando il gruppo è aperto, così il verso
 * resta quello di un chevron e la rotazione è una sola regola in styles.css.
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
  const CRUST = '#D69A4E';
  const CHEESE = '#F7C96A';
  const PEPPERONI = '#FF8A6B';

  /* Punta in (3.2, 8), cornicione sull'arco di destra: l'arco ha centro sulla
     punta, quindi la fetta è un settore vero e non un triangolo smussato. */
  const TIP = 'M3.2 8 L12.4 3.6 A10.2 10.2 0 0 1 12.4 12.4 Z';
  const RIND = 'M12.4 3.6A10.2 10.2 0 0 1 12.4 12.4';

  const MARKUP = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">`
    + `<path d="${TIP}" fill="${CHEESE}" />`
    + `<path d="${RIND}" fill="none" stroke="${CRUST}" stroke-width="2.4" stroke-linecap="round" />`
    + `<circle cx="7.8" cy="8" r="1.1" fill="${PEPPERONI}" />`
    + `<circle cx="10.4" cy="6.1" r="0.9" fill="${PEPPERONI}" />`
    + `<circle cx="10.2" cy="10.2" r="0.9" fill="${PEPPERONI}" />`
    + `</svg>`;

  /** SVG della fetta, orientata a destra. Il verso "aperto" lo dà la CSS. */
  function markup() {
    return MARKUP;
  }

  return { markup };
});

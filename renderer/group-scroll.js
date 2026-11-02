/* Porta un gruppo della sidebar in cima alla lista delle sessioni, subito sotto
 * «SESSIONI APERTE» (docs/plans/80-gruppo-in-cima.md).
 *
 * Gli ultimi gruppi non avrebbero abbastanza lista sotto di sé per salire fino
 * in cima: la lista si allunga in fondo dello spazio che manca (variabile CSS
 * `--scroll-room`, sommata al padding in styles.css). Lo spazio si toglie
 * quando si torna a scorrere verso l'alto oltre il punto in cui serviva.
 *
 * Wrapper UMD come sidebar.js: globale nella pagina e module.exports sotto Node. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessGroupScroll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const ROOM_VAR = '--scroll-room';

  /**
   * Dove scorrere per mettere il gruppo in cima, e quanto spazio aggiungere in fondo.
   * @param {{offset: number, scrollTop: number, scrollHeight: number,
   *   clientHeight: number, room?: number}} m
   *   `offset`: distanza del gruppo dal bordo alto visibile della lista;
   *   `room`: lo spazio già aggiunto, compreso in `scrollHeight`.
   * @returns {{top: number, room: number}}
   */
  function scrollPlan({ offset, scrollTop, scrollHeight, clientHeight, room = 0 }) {
    const top = Math.max(0, Math.round(scrollTop + offset));
    const maxWithoutRoom = Math.max(0, scrollHeight - room - clientHeight);
    return { top, room: Math.max(0, top - maxWithoutRoom) };
  }

  /**
   * Lo spazio aggiunto si può togliere? Solo risalendo, e solo quando la lista
   * senza di esso arriverebbe comunque fin lì: scendendo (anche durante lo
   * scorrimento morbido verso il gruppo) toglierlo farebbe saltare la vista.
   */
  function canRelease({ scrollTop, previousTop, scrollHeight, clientHeight, room }) {
    if (!(room > 0) || scrollTop >= previousTop) return false;
    return scrollTop <= Math.max(0, scrollHeight - room - clientHeight);
  }

  /**
   * @param {{list: HTMLElement, reducedMotion?: () => boolean}} deps
   * @returns {{toTop: (group: HTMLElement) => void}}
   */
  function createGroupScroller({ list, reducedMotion = () => false }) {
    if (!list) throw new Error('createGroupScroller: manca la lista');
    let room = 0;
    let previousTop = list.scrollTop || 0;

    const setRoom = (px) => {
      room = px;
      list.style.setProperty(ROOM_VAR, `${px}px`);
    };

    list.addEventListener('scroll', () => {
      const scrollTop = list.scrollTop;
      const measures = { scrollTop, previousTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, room };
      previousTop = scrollTop;
      if (canRelease(measures)) setRoom(0);
    });

    function toTop(group) {
      if (!group || typeof group.getBoundingClientRect !== 'function') return;
      const plan = scrollPlan({
        offset: group.getBoundingClientRect().top - list.getBoundingClientRect().top,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
        room,
      });
      // Prima lo spazio, poi lo scorrimento: senza, il browser fermerebbe
      // la lista al vecchio massimo
      if (plan.room !== room) setRoom(plan.room);
      list.scrollTo({ top: plan.top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    return { toTop };
  }

  return { scrollPlan, canRelease, createGroupScroller, ROOM_VAR };
});

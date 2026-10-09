/* Finestra "Segnalazioni" (docs/plans/48-segnalazioni.md), dal pulsante in
   fondo a destra accanto a «Plugin e skill».

   Il pannello non decide: le voci arrivano dal main (che le scarica e le
   tiene in cache), filtri e disegno li fa feedback-view.js — anche i filtri,
   perché la pagina gira sandboxed e non può importare da lib/ (il perché è
   scritto in lib/feedback-source.js). Qui c'è solo il collegamento. */

const feedback = { dati: null, linguetta: 'tendenza', aperto: false };

const FB_LINGUETTE = [
  ['tendenza', 'Di tendenza'],
  ['recenti', 'Recenti'],
  ['pianificato', 'Pianificato'],
  ['rilasciate', 'Rilasciate'],
];

function renderFeedbackTabs() {
  const bar = $('#fb-tabs');
  if (!bar) return;
  bar.replaceChildren();
  for (const [id, label] of FB_LINGUETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (feedback.linguetta === id ? ' active' : '');
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.onclick = () => { feedback.linguetta = id; renderFeedbackTabs(); renderFeedbackBody(); };
    bar.appendChild(b);
  }
}

function renderFeedbackBody() {
  const body = $('#fb-body');
  if (!body || !window.AisessFeedbackView) return;
  const dati = feedback.dati || { voci: [], errore: null };
  const voci = window.AisessFeedbackView.filterBy(dati.voci, feedback.linguetta);
  window.AisessFeedbackView.renderFeedback(body, {
    voci,
    errore: dati.errore,
    onOpen: (numero) => window.aisess.feedbackOpenIssue(numero).catch(() => {}),
  });
}

/* Si rilegge a ogni apertura, ma il main serve dalla cache se è fresca: la
   bacheca non cambia ogni minuto, e senza cache basterebbero pochi utenti
   dietro lo stesso indirizzo per esaurire il limite di GitHub. */
async function loadFeedback({ ricarica = false } = {}) {
  const body = $('#fb-body');
  if (body && !feedback.dati) body.replaceChildren(Object.assign(document.createElement('p'), {
    className: 'muted small', textContent: 'Sto leggendo la bacheca…',
  }));
  try {
    feedback.dati = await window.aisess.feedbackList(ricarica);
  } catch (e) {
    feedback.dati = { voci: (feedback.dati && feedback.dati.voci) || [], errore: String(e.message || e) };
  }
  renderFeedbackBody();
}

function openFeedback() {
  const back = $('#modal-feedback');
  if (!back) return;
  feedback.aperto = true;
  back.hidden = false;
  renderFeedbackTabs();
  renderFeedbackBody();
  loadFeedback();
}

function closeFeedback() {
  // Prima si spegne `aperto`, poi si chiude il modulo: così non riapre la
  // bacheca che stiamo chiudendo.
  feedback.aperto = false;
  closeFeedbackForm();
  const back = $('#modal-feedback');
  if (back) back.hidden = true;
}

/* Il modulo per aprirne una nuova sta in un dialogo suo, e mentre è aperto la
   bacheca si chiude: una schermata alla volta, invece dell'elenco delle altre
   segnalazioni sotto a quello che stai scrivendo (piano 50).
   L'invio finale avviene su GitHub con la issue già compilata — compresa la
   riga di diagnostica, che altrimenti andrebbe chiesta a mano a ogni scambio. */
function openFeedbackForm() {
  const f = $('#modal-fb-new');
  if (!f) return;
  $('#fb-titolo').value = '';
  $('#fb-corpo').value = '';
  const back = $('#modal-feedback');
  if (back) back.hidden = true;
  f.hidden = false;
  $('#fb-titolo').focus();
}

/* Chiuso il modulo si torna da dove si era arrivati, cioè la bacheca — a meno
   che nel frattempo non l'abbia chiusa «Chiudi», che azzera feedback.aperto
   prima di passare di qui. */
function closeFeedbackForm() {
  const f = $('#modal-fb-new');
  if (f) f.hidden = true;
  const back = $('#modal-feedback');
  if (back && feedback.aperto) back.hidden = false;
}

async function submitFeedbackForm() {
  const titolo = ($('#fb-titolo').value || '').trim();
  if (!titolo) { $('#fb-titolo').focus(); return; }
  const tipo = $('#fb-tipo').value === 'segnalazione' ? 'segnalazione' : 'richiesta';
  let diagnostica = '';
  try { diagnostica = await window.aisess.feedbackDiagnostics(); } catch { /* si manda lo stesso */ }
  await window.aisess.feedbackCreate({ tipo, titolo, corpo: $('#fb-corpo').value || '', diagnostica });
  closeFeedbackForm();
}

function initFeedback() {
  const open = $('#feedback-open');
  if (!open) return;
  open.onclick = openFeedback;
  const bind = (sel, fn) => { const e = $(sel); if (e) e.onclick = fn; };
  bind('#fb-close', closeFeedback);
  bind('#fb-new', openFeedbackForm);
  bind('#fb-form-cancel', closeFeedbackForm);
  bind('#fb-form-send', submitFeedbackForm);
  bind('#fb-reload', () => loadFeedback({ ricarica: true }));
}

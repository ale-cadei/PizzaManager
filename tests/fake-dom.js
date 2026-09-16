/* DOM finto, minimo: quel tanto che serve a far girare renderer/sidebar.js
 * dentro `node --test`, senza jsdom e senza Electron.
 *
 * Non è un browser: non fa layout, non propaga eventi, non interpreta
 * l'innerHTML. Serve solo a poter chiamare il codice vero della sidebar e
 * guardare che cosa fa, invece di controllare il testo del sorgente.
 * Il rettangolo di ogni elemento si detta a mano (`setRect`), perché il punto
 * di rilascio del drag si decide confrontando il cursore con la metà della card. */

function createElement(tag) {
  const e = {
    tag,
    children: [],
    parent: null,
    classes: new Set(),
    attrs: {},
    listeners: new Map(),
    dataset: {},
    style: {},
    textContent: '',
    title: '',
    hidden: false,
    draggable: false,
    onclick: null,
    rect: { top: 0, left: 0, width: 200, height: 40 },
    get className() { return [...e.classes].join(' '); },
    set className(v) { e.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return e.html || ''; },
    // L'HTML non viene interpretato: azzerarlo però deve svuotare i figli, che
    // è il modo in cui la sidebar ricomincia da capo a ogni render.
    set innerHTML(v) { e.html = String(v); e.children = []; },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
    appendChild(child) {
      if (child.parent) child.parent.removeChild(child);
      child.parent = e; e.children.push(child); return child;
    },
    // Spostamento dei nodi: serve al riordino "vivo" delle card durante il
    // trascinamento, che muove davvero la card nel DOM invece di segnare il bersaglio.
    removeChild(child) {
      const i = e.children.indexOf(child);
      if (i >= 0) { e.children.splice(i, 1); child.parent = null; }
      return child;
    },
    insertBefore(child, ref) {
      if (!ref) return e.appendChild(child);
      if (child.parent) child.parent.removeChild(child);
      const i = e.children.indexOf(ref);
      child.parent = e;
      e.children.splice(i < 0 ? e.children.length : i, 0, child);
      return child;
    },
    get parentNode() { return e.parent; },
    get nextElementSibling() {
      if (!e.parent) return null;
      const i = e.parent.children.indexOf(e);
      return e.parent.children[i + 1] || null;
    },
    get previousElementSibling() {
      if (!e.parent) return null;
      const i = e.parent.children.indexOf(e);
      return i > 0 ? e.parent.children[i - 1] : null;
    },
    addEventListener(type, fn) {
      if (!e.listeners.has(type)) e.listeners.set(type, []);
      e.listeners.get(type).push(fn);
    },
    getBoundingClientRect() {
      return { ...e.rect, bottom: e.rect.top + e.rect.height, right: e.rect.left + e.rect.width };
    },
    querySelectorAll(selector) {
      const wanted = selector.split(',').map((s) => s.trim().replace(/^\./, '')).filter(Boolean);
      return descendants(e).filter((n) => wanted.some((c) => n.classes.has(c)));
    },
    classList: {
      add: (...cs) => cs.forEach((c) => e.classes.add(c)),
      remove: (...cs) => cs.forEach((c) => e.classes.delete(c)),
      contains: (c) => e.classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !e.classes.has(c) : !!force;
        if (on) e.classes.add(c); else e.classes.delete(c);
        return on;
      },
    },
  };
  return e;
}

function descendants(node) {
  const out = [];
  for (const child of node.children) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

/** Installa `document` come globale e restituisce come disinstallarlo. */
function installDocument() {
  const previous = global.document;
  global.document = { createElement };
  return () => { global.document = previous; };
}

/** localStorage finto: la sidebar ci salva gruppi collassati e modalità. */
function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

/** Evento finto: registra se qualcuno l'ha accettato con preventDefault. */
function createEvent(props = {}) {
  const e = {
    defaultPrevented: false,
    propagationStopped: false,
    dataTransfer: { data: {}, effectAllowed: null, dropEffect: null,
      setData(type, v) { e.dataTransfer.data[type] = v; } },
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    ...props,
  };
  return e;
}

/** Chiama gli handler registrati su un elemento per quel tipo di evento. */
function fire(el, type, props) {
  const event = createEvent(props);
  for (const fn of el.listeners.get(type) || []) fn(event);
  return event;
}

module.exports = { createElement, descendants, installDocument, createStorage, createEvent, fire };

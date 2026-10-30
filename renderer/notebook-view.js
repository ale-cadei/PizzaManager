/* Disegna un notebook già letto (notebook-model.js) per la scheda editor
 * (docs/plans/77). Solo createElement e textContent: il testo del notebook
 * non diventa mai HTML della pagina. Due eccezioni, isolate:
 * - il colore del codice lo mette Monaco (`colorize`, dall'host);
 * - l'HTML degli output (tabelle di pandas) sta in un iframe `sandbox`
 *   senza `allow-scripts`, che eredita la CSP della pagina e ne ha una sua.
 * I link non navigano: l'app non ha un gestore e la finestra uscirebbe dalla
 * pagina. Le immagini si mostrano solo da `data:` (allegati e output).
 *
 * Wrapper UMD come sidebar.js: globale nella pagina, module.exports sotto Node. */
(function (root, factory) {
  const api = factory(root ? root.AisessNotebookMarkdown : require('./notebook-markdown'));
  if (root) root.AisessNotebookView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function (Markdown) {
  const MAX_HTML_HEIGHT = 600;
  const FRAME_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  const DATA_IMAGE = /^data:image\/(png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

  /**
   * @typedef {{colorize?: (node: object, language: string) => void, htmlCss?: string,
   *   attachments?: Object<string, string>}} ViewOptions
   */

  function el(doc, tag, className, text) {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- markdown ---------- */

  function imageNode(doc, node, opts) {
    const attached = node.src.startsWith('attachment:') ? (opts.attachments || {})[node.src.slice('attachment:'.length)] : null;
    const src = attached || node.src;
    if (!DATA_IMAGE.test(src)) {
      const missing = el(doc, 'span', 'nb-missing', `[immagine: ${node.alt}]`);
      missing.title = node.src;
      return missing;
    }
    const img = el(doc, 'img', 'nb-image');
    img.setAttribute('src', src);
    img.setAttribute('alt', node.alt);
    return img;
  }

  function inlineNode(doc, node, opts) {
    const wrap = (tag, className) => {
      const n = el(doc, tag, className);
      n.append(...node.children.map((c) => inlineNode(doc, c, opts)));
      return n;
    };
    switch (node.type) {
      case 'code': return el(doc, 'code', 'nb-inline-code', node.text);
      case 'strong': return wrap('strong');
      case 'em': return wrap('em');
      case 'del': return wrap('del');
      case 'break': return el(doc, 'br');
      case 'image': return imageNode(doc, node, opts);
      case 'link': {
        const link = wrap('span', 'nb-link');
        link.title = node.href;
        return link;
      }
      default: return doc.createTextNode(node.text);
    }
  }

  const inlines = (doc, parent, nodes, opts) => {
    parent.append(...nodes.map((n) => inlineNode(doc, n, opts)));
    return parent;
  };

  function codeBlock(doc, text, language, opts) {
    const pre = el(doc, 'pre', 'nb-code', text);
    if (language && opts.colorize) opts.colorize(pre, language);
    return pre;
  }

  function tableNode(doc, block, opts) {
    const cell = (tag, content, k) => {
      const c = inlines(doc, el(doc, tag), content, opts);
      if (block.align[k]) c.style.textAlign = block.align[k];
      return c;
    };
    const row = (tag, cells) => {
      const tr = el(doc, 'tr');
      tr.append(...cells.map((content, k) => cell(tag, content, k)));
      return tr;
    };
    const head = el(doc, 'thead');
    head.append(row('th', block.head));
    const body = el(doc, 'tbody');
    body.append(...block.rows.map((r) => row('td', r)));
    const table = el(doc, 'table', 'nb-table');
    table.append(head, body);
    return table;
  }

  function blockNode(doc, block, opts) {
    const children = (tag, blocks) => {
      const n = el(doc, tag);
      n.append(...blocks.map((b) => blockNode(doc, b, opts)));
      return n;
    };
    switch (block.type) {
      case 'heading': return inlines(doc, el(doc, `h${block.level}`), block.inlines, opts);
      case 'code': return codeBlock(doc, block.text, block.lang, opts);
      case 'quote': return children('blockquote', block.blocks);
      case 'hr': return el(doc, 'hr');
      case 'table': return tableNode(doc, block, opts);
      case 'list': {
        const list = el(doc, block.ordered ? 'ol' : 'ul');
        if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
        list.append(...block.items.map((item) => children('li', item)));
        return list;
      }
      default: return inlines(doc, el(doc, 'p'), block.inlines, opts);
    }
  }

  /**
   * @param {Document} doc
   * @param {string} text sorgente markdown
   * @param {ViewOptions} opts
   */
  function renderMarkdown(doc, text, opts) {
    const box = el(doc, 'div', 'nb-md');
    box.append(...Markdown.parseMarkdown(text).map((b) => blockNode(doc, b, opts)));
    return box;
  }

  /* ---------- output ---------- */

  function htmlFrame(doc, html, opts) {
    const frame = el(doc, 'iframe', 'nb-html');
    frame.setAttribute('sandbox', 'allow-same-origin'); // senza allow-scripts: serve solo a misurarlo da qui
    frame.setAttribute('csp', FRAME_CSP);
    frame.setAttribute('srcdoc', `<!doctype html><meta charset="utf-8"><style>${opts.htmlCss || ''}</style>${html}`);
    frame.addEventListener('load', () => {
      const inner = frame.contentDocument;
      if (!inner || !inner.documentElement) return;
      frame.style.height = `${Math.min(inner.documentElement.scrollHeight, MAX_HTML_HEIGHT)}px`;
    });
    return frame;
  }

  function outputContent(doc, out, opts) {
    switch (out.kind) {
      case 'error': return el(doc, 'pre', 'nb-text nb-error', out.traceback || `${out.name}: ${out.value}`);
      case 'image': return imageNode(doc, { src: out.src, alt: 'output' }, opts);
      case 'html': return htmlFrame(doc, out.html, opts);
      case 'markdown': return renderMarkdown(doc, out.text, opts);
      default: return el(doc, 'pre', `nb-text${out.stream ? ' nb-stream' : ''}${out.stream === 'stderr' ? ' nb-stderr' : ''}`, out.text);
    }
  }

  /** Riga con il prompt `[n]` a sinistra e il contenuto a destra. */
  function row(doc, className, prompt, content) {
    const r = el(doc, 'div', className);
    r.append(el(doc, 'span', 'nb-prompt', prompt), content);
    return r;
  }

  function cellNode(doc, cell, language, opts) {
    const box = el(doc, 'div', `nb-cell nb-cell--${cell.type}`);
    if (cell.type === 'markdown') {
      box.append(row(doc, 'nb-row', '', renderMarkdown(doc, cell.source, { ...opts, attachments: cell.attachments })));
    } else if (cell.type === 'code') {
      box.append(row(doc, 'nb-row nb-input', `[${cell.count === null ? ' ' : cell.count}]`, codeBlock(doc, cell.source, language, opts)));
      box.append(...cell.outputs.map((out) => row(doc, 'nb-row nb-output', '', outputContent(doc, out, opts))));
    } else {
      box.append(row(doc, 'nb-row', '', el(doc, 'pre', 'nb-text', cell.source)));
    }
    return box;
  }

  /**
   * @param {Document} doc
   * @param {{language: string, cells: object[]}} notebook da parseNotebook
   * @param {ViewOptions} [opts]
   */
  function renderNotebook(doc, notebook, opts = {}) {
    const root = el(doc, 'div', 'nb');
    if (!notebook.cells.length) root.append(el(doc, 'div', 'nb-empty', 'Il notebook non ha celle.'));
    root.append(...notebook.cells.map((c) => cellNode(doc, c, notebook.language, opts)));
    return root;
  }

  return { renderNotebook, renderMarkdown };
});

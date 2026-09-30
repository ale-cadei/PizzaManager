/* Icone delle shell: catalogo e riconoscimento dei comandi inviati al pty.
 * Nessun output del terminale viene interpretato. */
(function (root, factory) {
  const api = factory();
  if (root) root.AisessShellIcons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const CHOICES = Object.freeze([
    { key: 'shell', label: 'Terminale' },
    { key: 'docker', label: 'Docker' },
    { key: 'github', label: 'GitHub' },
    { key: 'git', label: 'Git' },
    { key: 'node', label: 'Node.js' },
    { key: 'python', label: 'Python' },
  ]);
  const KEYS = new Set(CHOICES.map((c) => c.key));
  const normalize = (key) => KEYS.has(key) ? key : 'shell';

  /* Un comando molto caratteristico basta da solo. Gli altri richiedono due
     invocazioni dello stesso strumento: un uso occasionale non etichetta la shell. */
  function classify(line) {
    const command = String(line || '').trim().replace(/^(?:sudo\s+|env\s+)+/, '');
    if (/^docker\s+compose\b|^docker-compose\s+/.test(command)) return { key: 'docker', strong: true };
    if (/^docker\s+/.test(command)) return { key: 'docker', strong: false };
    if (/^gh\s+(?:pr|issue|repo|workflow|run|release)\b/.test(command)) return { key: 'github', strong: true };
    if (/^gh\s+/.test(command)) return { key: 'github', strong: false };
    if (/^git\s+/.test(command)) return { key: 'git', strong: false };
    if (/^(?:npm|pnpm|yarn|node)\s+/.test(command)) return { key: 'node', strong: false };
    if (/^(?:python(?:3(?:\.\d+)?)?|pip(?:3)?|pytest)\s+/.test(command)) return { key: 'python', strong: false };
    return null;
  }

  /* xterm invia caratteri, incolla e sequenze di controllo. Si conserva solo
     la riga digitata, con un limite per non accumulare incolli grandi. */
  function createCommandCapture() {
    let buffer = '';
    let last = null;
    let count = 0;
    const PASTE_START = /\x1b\[200~/g;
    const PASTE_END = /\x1b\[201~/g;
    const ESCAPE_SEQ = /\x1b(\][^\x07\x1b]*(\x07|\x1b\\)?|\[[0-9;?]*[ -/]*[@-~]|O[@-~]|.)/g;

    function observe(line) {
      const match = classify(line);
      if (!match) { last = null; count = 0; return null; }
      count = match.key === last ? count + 1 : 1;
      last = match.key;
      return match.strong || count >= 2 ? match.key : null;
    }

    function feed(data) {
      const raw = String(data == null ? '' : data);
      const pasted = raw.includes('\x1b[200~');
      if (!pasted && raw.startsWith('\x1b')) return null;
      const clean = raw.replace(PASTE_START, '').replace(PASTE_END, '').replace(ESCAPE_SEQ, '');
      let result = null;
      for (const ch of clean) {
        if (ch === '\x7f' || ch === '\b') buffer = buffer.slice(0, -1);
        else if (ch === '\r' || ch === '\n') {
          if (buffer) result = result || observe(buffer);
          buffer = '';
        } else if (ch >= ' ') buffer += ch;
        if (buffer.length > 4000) buffer = buffer.slice(-4000);
      }
      return result;
    }

    return { feed };
  }

  return { CHOICES, normalize, classify, createCommandCapture };
});

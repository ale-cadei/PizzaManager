'use strict';
/* Il frontmatter YAML di SKILL.md e dei comandi .md: servono solo nome e
 * descrizione, quindi niente libreria YAML. Si leggono le chiavi in cima al
 * blocco, con virgolette e blocchi su più righe (`>`, `|`); liste e mappe
 * annidate si ignorano. */

const KEY = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const BLOCK = /^[>|][+-]?$/;

function unquote(v) {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m ? m[2] : v;
}

/** @returns {{data: Record<string, string>, body: string}} */
function parseFrontmatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { data: {}, body: src };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { data: {}, body: src };
  const data = {};
  let key = null;
  for (const line of lines.slice(1, end)) {
    const m = KEY.exec(line);
    if (m) {
      key = m[1];
      const v = m[2].trim();
      data[key] = BLOCK.test(v) ? '' : unquote(v);
    } else if (key && /^\s+\S/.test(line) && !/^\s*-\s/.test(line)) {
      data[key] = data[key] ? `${data[key]} ${line.trim()}` : line.trim();
    }
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/* La prima riga che dice qualcosa: niente titoli, blocchi di codice, commenti HTML */
function firstTextLine(body) {
  let inCode = false;
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode || !line || line.startsWith('#') || line.startsWith('<!--') || line === '---') continue;
    return line;
  }
  return '';
}

/** Nome e descrizione di una skill o di un comando. */
function describe(text) {
  const { data, body } = parseFrontmatter(text);
  return {
    name: typeof data.name === 'string' ? data.name : '',
    description: data.description || firstTextLine(body),
  };
}

module.exports = { parseFrontmatter, describe };

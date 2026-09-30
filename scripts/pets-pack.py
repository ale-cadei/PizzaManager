"""Genera renderer/pets-sprite-*.js dai pacchetti di sprite dell'utente (docs/plans/33-animaletti.md).

Serve PIL. I pacchetti si scompattano nelle cartelle di PACKS; le pose di ogni
personaggio stanno in SPEC. Uso: python3 scripts/pets-pack.py"""
import json
from PIL import Image

import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'renderer', 'pets-sprite-%s.js')
LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

# id, pacchetto, cartella, pose → indici frame (0-based), speed, motion, height, commento
SPEC = [
    ('pizza', 'zip1', 'peppo',
     {'walk': [7, 8, 9, 10], 'sleep': [2], 'call': [6, 0, 6, 0],
      'idle': [0, 0, 1, 1, 0, 0, 1, 1, 2, 0], 'startle': [3, 4, 4, 4, 5, 0]},
     0.8, 'walk', None, 'Peppo, la fetta di pizza'),
    ('fizzo', 'zip1', 'fizzo',
     {'walk': [7, 8, 9, 10], 'sleep': [2], 'call': [6, 0, 6, 0],
      'idle': [0, 0, 1, 1, 0, 0, 1, 1, 2, 0], 'startle': [3, 4, 4, 4, 5, 0]},
     0.9, 'walk', None, 'Fizzo, il bicchiere di bibita'),
    ('rotolacampo', 'zip1', 'rotolacampo',
     {'walk': list(range(12)), 'sleep': [0], 'call': list(range(12, 20))},
     1.4, 'walk', 0.7, 'Rotolacampo: rotola, e rimbalza quando chiama'),
    ('babbo', 'zip1', 'babbo-natale',
     {'walk': [0, 1, 2, 3], 'sleep': [0], 'call': [0]},
     1.2, 'fly', None, 'Babbo Natale con la slitta, vola'),
    ('morte', 'zip2', 'la-morte',
     {'walk': [0, 1, 2, 3], 'sleep': [4], 'call': [0, 5, 6, 7, 8, 9, 10, 11, 12],
      'idle': [0, 0, 0, 4, 0, 4, 0, 0]},
     0.7, 'swim', None, 'La Morte: fluttua, e dà una falciata quando chiama'),
    ('zucca', 'zip2', 'zucco',
     {'walk': [7, 8, 9, 10], 'sleep': [2], 'call': [6, 0, 6, 0],
      'idle': [0, 0, 1, 1, 0, 0, 1, 1, 2, 0], 'startle': [3, 4, 4, 4, 5, 0]},
     0.9, 'walk', None, 'Zucco, la zucca'),
    ('fantasmino', 'zip3', 'fantasmino-lenzuolo',
     {'walk': [7, 8, 9, 10], 'sleep': [21], 'call': [0, 5, 6, 6, 6, 5, 0],
      'idle': [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 4, 0], 'turn': [4, 4],
      'startle': [15, 16, 15, 16, 15, 16, 15, 16, 0], 'laugh': [17, 18, 17, 18, 17, 18],
      'sad': [19], 'appear': [25, 24, 23, 22, 4], 'vanish': [4, 22, 23, 24, 25]},
     1.0, 'fly', None, 'Fantasmino col lenzuolo: vola, si ferma a guardare, fa buu'),
]
PACKS = {
    'zip1': ('/tmp/sb/zip/assets', 'Sprite pixel-art originale', 'frames'),
    'zip2': ('/tmp/sb/zip2/assets-halloween', 'Halloween Pack pixel-art', 'sheet'),
    'zip3': ('/tmp/sb/zip3', 'Fantasmino Lenzuolo', 'sheet'),
}
# Ombra a terra, in sincrono coi frame di chi vola: file, larghezza di un frame.
# È semitrasparente (alpha 50-70): soglia bassa, e il colore tiene l'alpha.
SHADOWS = {'fantasmino': ('ombra_1x.png', 24)}
SHADOW_MIN_ALPHA = 16
# Colori cambiati rispetto al pacchetto: originale → nostro, con il perché
PALETTE_FIX = {
    'morte': ({'#141018': '#262030', '#2A2430': '#403850'}, 'Veste (b, c) schiarita rispetto al pacchetto: sul terminale scuro spariva'),
    'fantasmino': ({'#14122446': '#A8ACCC59', '#14122432': '#A8ACCC40'}, 'Ombra (i, j) chiara invece che scura: sul terminale scuro un\'ombra scura sparisce'),
}


def load(pack, folder):
    base, _, mode = PACKS[pack]
    d = json.load(open(f'{base}/{folder}/data.json'))
    if mode == 'frames':
        ims = [Image.open(f'{base}/{folder}/frames/{i + 1:02d}_{name}_1x.png').convert('RGBA')
               for i, name in enumerate(d['frames'])]
    else:
        sheet = Image.open(f'{base}/{folder}/sheet_1x.png').convert('RGBA')
        fw, fh = d['frameWidth'], d['frameHeight']
        ims = [sheet.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(d['frameCount'])]
    return d, ims


def slices(path, fw):
    im = Image.open(path).convert('RGBA')
    return [im.crop((i * fw, 0, (i + 1) * fw, im.height)) for i in range(im.width // fw)]


def union_bbox(ims):
    x0 = y0 = 10 ** 6
    x1 = y1 = -1
    for im in ims:
        b = im.getbbox()
        x0, y0, x1, y1 = min(x0, b[0]), min(y0, b[1]), max(x1, b[2]), max(y1, b[3])
    return x0, y0, x1, y1


def grid(im, box, pal, min_alpha=128):
    """Sotto min_alpha il pixel è trasparente; fra min_alpha e 255 tiene l'alpha (hex a 8 cifre)."""
    x0, y0, x1, y1 = box
    rows = []
    for y in range(y0, y1):
        s = ''
        for x in range(x0, x1):
            r, g, b, a = im.getpixel((x, y))
            if a < min_alpha:
                s += '.'
                continue
            h = '#%02X%02X%02X' % (r, g, b) + ('' if a == 255 else '%02X' % a)
            if h not in pal:
                pal[h] = LETTERS[len(pal)]
            s += pal[h]
        rows.append(s)
    return rows


def const_block(name, rows):
    return [f'  const {name} = ['] + [f"    '{r}'," for r in rows] + ['  ];']


def palette_js(kind, pal):
    fix, why = PALETTE_FIX.get(kind, ({}, ''))
    js = ', '.join(f"{ch}: '{fix.get(h, h)}'" for h, ch in pal.items())
    return (f'// {why}\n      ' if why else '') + f'palette: {{ {js} }},'


def module_js(kind, comment, pack_name, lines, speed, motion, height, palette_js, shadow_js, frames_js):
    """Il file UMD di un personaggio, uguale per tutti i pacchetti."""
    height_js = f'\n      height: {height},' if height else ''
    return f"""/* {comment}.
 * Disegno del pacchetto «{pack_name}»: griglie ricavate dai PNG 1x nel
 * formato di pets-sprites.js, che lo fonde nel suo catalogo (AisessPetsPack).
 * Pose dalle animazioni del pacchetto.
 *
 * File generato: si ritocca il pacchetto, non queste righe.
 *
 * Wrapper UMD come gli altri moduli del renderer: in pagina i personaggi
 * del pacchetto si sommano nello stesso oggetto. */
(function (root, factory) {{
  const api = factory();
  if (root) root.AisessPetsPack = Object.assign({{}}, root.AisessPetsPack, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}})(typeof window !== 'undefined' ? window : null, function () {{
{chr(10).join(lines)}

  return {{
    {kind}: {{
      speed: {speed},
      motion: '{motion}',{height_js}
      {palette_js}{shadow_js}
      frames: {{
{frames_js},
      }},
    }},
  }};
}});
"""


def classic(kind, pack, folder, poses, speed, motion, height, comment):
    """Un personaggio dei pacchetti a frame numerati (zip1-3): il sorgente del file."""
    base, pack_name, _ = PACKS[pack]
    d, ims = load(pack, folder)
    used = sorted({i for v in poses.values() for i in v})
    pal = {}
    for hexv in d.get('palette', {}).values():
        pal[hexv.upper()] = LETTERS[len(pal)]
    box = union_bbox([ims[i] for i in used])
    grids = {i: grid(ims[i], box, pal) for i in used}
    names = d['frames']
    cn = lambda i: f"{kind.upper()}_{names[i].upper().replace('-', '_')}"
    lines = [f'  // ---- {comment} ({box[2] - box[0]}×{box[3] - box[1]}) ----']
    for i in used:
        lines += const_block(cn(i), grids[i])
    shadow_js = ''
    if kind in SHADOWS:
        file, fw = SHADOWS[kind]
        sh = slices(f'{base}/{folder}/{file}', fw)
        sbox = union_bbox(sh)
        lines.append(f'  // Ombra a terra, un frame per frame di volo ({sbox[2] - sbox[0]}×{sbox[3] - sbox[1]})')
        snames = []
        for j, im in enumerate(sh):
            snames.append(f'{kind.upper()}_OMBRA_{j + 1}')
            lines += const_block(snames[-1], grid(im, sbox, pal, SHADOW_MIN_ALPHA))
        shadow_js = f"\n      shadow: [{', '.join(snames)}],"
    frames_js = ',\n'.join('        %s: [%s]' % (p, ', '.join(cn(i) for i in idx)) for p, idx in poses.items())
    return module_js(kind, comment, pack_name, lines, speed, motion, height, palette_js(kind, pal), shadow_js, frames_js)


def write(kind, src):
    open(OUT % kind, 'w').write(src)
    print(kind, len(src.splitlines()), 'righe')


for entry in SPEC:
    write(entry[0], classic(*entry))

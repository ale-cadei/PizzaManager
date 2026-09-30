"""Genera renderer/pets-sprite-*.js dai pacchetti di sprite dell'utente (docs/plans/33-animaletti.md).

Serve PIL. I pacchetti si scompattano nelle cartelle di PACKS; le pose di ogni
personaggio stanno in SPEC. Uso: python3 scripts/pets-pack.py"""
import json
from PIL import Image

import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'renderer', 'pets-sprite-%s.js')
GRID = 16  # righe della cella di riferimento (pets-sprites.js GRID)
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
     1.0, 'swim', None, 'Fantasmino col lenzuolo: fluttua basso, si ferma a guardare, fa buu'),
]
PACKS = {
    'zip1': ('/tmp/sb/zip/assets', 'Sprite pixel-art originale', 'frames'),
    'zip2': ('/tmp/sb/zip2/assets-halloween', 'Halloween Pack pixel-art', 'sheet'),
    'zip3': ('/tmp/sb/zip3', 'Fantasmino Lenzuolo', 'sheet'),
}
# Nessun personaggio ha il contorno scuro attorno alla sagoma (l'utente lo
# vuole così: sul terminale scuro fa un alone). Colore del bordo dei pacchetti
# che ce l'hanno, tolto da unoutlined; Rotolacampo ha solo rametti, non bordo.
OUTLINES = {
    'pizza': '#3A1F14', 'fizzo': '#2B1418', 'zucca': '#3A1A0A', 'babbo': '#1F1420',
    'morte': '#050307', 'fantasmino': '#222034',
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

# Pacchetto «Spritelli»: fotogrammi con un nome (<cartella>-sheet.json), a 1x.
# Per personaggio: cartella, pose → nomi dei fotogrammi, speed, motion, commento,
# e i fotogrammi derivati che il pacchetto non ha: base, righe ritoccate
# (coordinate della cella) e altri fotogrammi sovrapposti in (x, y);
# in fondo, facoltativi, i disegni a parte (layers): 'perch' (fotogramma,
# riga a cui si siede) e 'bubbles' (larghezza, sovrapposizioni per frame).
SPRITELLI_DIR = '/tmp/spiritelli/spritelli'
# I fotogrammi Spritelli sono a 16 px, gli altri pacchetti a 24-32: si
# raddoppiano con EPX (arrotonda le diagonali, tiene i bordi dritti) così
# stanno allo stesso livello. Chi era più basso della cella tiene la sua
# misura in scena con height.
SPRITELLI_SCALE = 2
# I PNG Spritelli hanno un contorno di 1 px di questo colore attorno a ogni
# sagoma: si toglie (unoutlined) prima di ingrandire, come per gli altri.
SPRITELLI_OUTLINE = '#2B2233'
SPRITELLI = [
    ('ape', 'ape-fiore',
     {'walk': ['bee-fly-1', 'bee-fly-2'], 'sleep': ['bee-rest'], 'call': ['bee-fly-1', 'bee-rest']},
     0.9, 'fly', "L'ape: vola, e si posa sul suo fiore per dormire e per chiamare", {},
     # Il fiore resta a terra; l'ape si posa a 13 righe d'altezza, tra i petali
     {'perch': ('flower', 13)}),
    ('chiocciola', 'chiocciola',
     {'walk': ['snail-walk-1', 'snail-walk-2'], 'sleep': ['snail-sleep'],
      'call': ['snail-walk-1', 'snail-walk-2']},
     0.2, 'walk', 'La chiocciola: lenta, e per chiamare dondola le antenne', {
         # Senza le «z» disegnate: quelle di chi dorme le mette la vista, per tutti
         'snail-sleep': ('snail-sleep-1', {i: '.' * 16 for i in range(5)}, []),
     }),
    ('papera', 'papera-anatroccoli',
     {'walk': ['duck-walk-1', 'duck-walk-2'], 'sleep': ['duck-sleep'], 'call': ['duck-walk-1', 'duck-quack']},
     0.7, 'walk', 'La papera: cammina con gli anatroccoli dietro, e chiama facendo qua qua', {
         'duck-sleep': ('duck-walk-1', {4: '......abbbdbcca.'}, []),
         'duck-quack': ('duck-walk-1', {2: '.......abbbaaa..', 3: '......abbbbbcca.', 4: '......abbbaba...',
                                        5: '......abbbbbcca.', 6: '.......abbbaaa..'}, []),
     }),
    ('anatroccolo', 'papera-anatroccoli',
     {'walk': ['duckling-walk-1', 'duckling-walk-2'], 'sleep': ['duckling-sleep'], 'call': ['duckling-walk-1']},
     0.7, 'walk', "L'anatroccolo: va dietro alla papera", {
         'duckling-sleep': ('duckling-walk-1', {2: '...aeeefeca'}, []),
     }),
    ('robottino', 'robottino',
     {'walk': ['robot-walk-1-on', 'robot-walk-2-on', 'robot-walk-1-off', 'robot-walk-2-off'],
      'sleep': ['robot-sleep'], 'call': ['robot-call-1', 'robot-call-2']},
     0.7, 'walk', "Il robottino: cammina con l'antenna che lampeggia, e chiama con lo schermo acceso", {
         'robot-sleep': ('robot-walk-1-off', {5: '..adeeeeeeeeda..'}, []),
     }),
    ('pesce', '/tmp/spritelli-pesce/pesce',
     {'walk': ['fish-swim-1', 'fish-swim-2'], 'sleep': ['fish-sleep'],
      'call': ['fish-blow']},
     0.7, 'swim', 'Il pesce: nuota ondeggiando, e chiama soffiando bolle', {
         'fish-sleep': ('fish-swim-1', {6: '.abbbcccccccaaca.'}, []),
     },
     # Bolle davanti alla bocca (colonna 16, righe 6-7 della cella): nasce la
     # piccola, sale e si gonfia, poi ne nasce un'altra mentre la prima va su
     {'bubbles': (7, [[('bubble-small', 0, 4)], [('bubble-big', 0, 0)],
                      [('bubble-small', 2, 0), ('bubble-small', 0, 5)]])}),
]
# Colori a scelta (pets-sprites.js variants): colore del pacchetto → sostituto
VARIANTS = {
    'pesce': [
        {'#3A86A8': '#C8561E', '#5FB7D6': '#F2833A', '#C4EBF5': '#FFFFFF'},
        {'#3A86A8': '#3C8A34', '#5FB7D6': '#5DBB4A', '#C4EBF5': '#C8E88A'},
        {'#3A86A8': '#9A4A9A', '#5FB7D6': '#C86BC8', '#C4EBF5': '#F4D0F4'},
    ],
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
    if kind in OUTLINES:
        grids = {i: unoutlined(g, pal[OUTLINES[kind]]) for i, g in grids.items()}
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


def spritelli_frames(folder):
    """I fotogrammi del pacchetto come griglie di caratteri, per nome, e la palette."""
    path = folder if folder.startswith('/') else f'{SPRITELLI_DIR}/{folder}'
    name = path.rstrip('/').rsplit('/', 1)[-1]
    d = json.load(open(f'{path}/{name}-sheet.json'))
    sheet = Image.open(f'{path}/{name}-sheet.png').convert('RGBA')
    pal = {}
    frames = {}
    for f in d['frames']:
        im = sheet.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        frames[f['name']] = grid(im, (0, 0, f['w'], f['h']), pal)
    return frames, pal


def derive(frames, base, rows, over):
    """Un fotogramma nuovo: righe ritoccate, poi altri fotogrammi sopra (i '.' non coprono)."""
    out = [rows.get(i, r) for i, r in enumerate(frames[base])]
    for name, ox, oy in over:
        width = max(len(out[0]), ox + len(frames[name][0]))
        out = [r.ljust(width, '.') for r in out]
        for y, r in enumerate(frames[name]):
            line = list(out[oy + y])
            for x, ch in enumerate(r):
                if ch != '.':
                    line[ox + x] = ch
            out[oy + y] = ''.join(line)
    widths = {len(r) for r in out}
    assert len(widths) == 1 and len(out) == len(frames[base]), f'{base}: ritocco fuori misura'
    return out


def unoutlined(grid, ch):
    """Via il contorno esterno: i pixel del colore del bordo (ch) a contatto col
    vuoto e con un colore pieno. Restano quelli dentro (occhi, bocche, righe
    fra due colori), le linee fatte solo di quel colore (gambe, antenne) e il
    pixel del bordo a cui si attaccano, così non restano staccate."""
    h, w = len(grid), len(grid[0])
    at = lambda x, y: grid[y][x] if 0 <= x < w and 0 <= y < h else '.'
    around = lambda x, y: (at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1))
    corners = lambda x, y: (at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1))
    # Anche in diagonale: l'angolo del bordo tocca il pieno solo così
    filled = lambda x, y: any(c not in ('.', ch) for c in around(x, y) + corners(x, y))
    limb = lambda x, y: at(x, y) == ch and not filled(x, y)
    edge = lambda x, y: at(x, y) == ch and '.' in around(x, y) and filled(x, y)
    joint = lambda x, y: any(limb(x + dx, y + dy) for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)))
    return [''.join('.' if edge(x, y) and not joint(x, y) else c for x, c in enumerate(r)) for y, r in enumerate(grid)]


def epx(grid):
    """Il fotogramma a 2x con EPX/Scale2x: ogni pixel diventa 2×2, e sugli
    angoli fra due vicini uguali prende il loro colore, così le diagonali
    si arrotondano invece di fare le scalette."""
    h, w = len(grid), len(grid[0])
    at = lambda x, y: grid[y][x] if 0 <= x < w and 0 <= y < h else '.'
    out = [[''] * (w * 2) for _ in range(h * 2)]
    for y in range(h):
        for x in range(w):
            p, a, b, c, d = at(x, y), at(x, y - 1), at(x + 1, y), at(x - 1, y), at(x, y + 1)
            out[2 * y][2 * x] = a if c == a and c != d and a != b else p
            out[2 * y][2 * x + 1] = b if a == b and a != c and b != d else p
            out[2 * y + 1][2 * x] = c if d == c and d != b and c != a else p
            out[2 * y + 1][2 * x + 1] = b if b == d and b != a and d != c else p
    return [''.join(r) for r in out]


def scaled(grid, times):
    """EPX ripetuto: 1 lascia com'è, 2 raddoppia, 4 quadruplica."""
    return grid if times <= 1 else scaled(epx(grid), times // 2)


def crop(grids):
    """Stessa misura per tutti, allineati in basso e a sinistra, poi via il vuoto intorno.
    Torna anche le righe tenute (y0, y1), per ritagliare allo stesso modo i disegni a parte."""
    w = max(len(g[0]) for g in grids.values())
    h = max(len(g) for g in grids.values())
    full = {k: ['.' * w] * (h - len(g)) + [r.ljust(w, '.') for r in g] for k, g in grids.items()}
    ink = [(x, y) for g in full.values() for y, r in enumerate(g) for x, ch in enumerate(r) if ch != '.']
    x0, x1 = min(x for x, _ in ink), max(x for x, _ in ink) + 1
    y0, y1 = min(y for _, y in ink), max(y for _, y in ink) + 1
    return {k: [r[x0:x1] for r in g[y0:y1]] for k, g in full.items()}, (y0, y1)


def layer_grids(frames, layers, height, rows, scale):
    """I disegni a parte, per nome, ingranditi come il personaggio: il posatoio
    ritagliato da solo, le bolle disegnate su una tela alta quanto la cella e
    tagliate sulle righe (rows, già ingrandite) del personaggio."""
    out = {}
    if 'perch' in layers:
        out['perch'], _ = crop({'perch': scaled(frames[layers['perch'][0]], scale)})
        out['perch'] = out['perch']['perch']
    if 'bubbles' in layers:
        width, steps = layers['bubbles']
        blank = {'.': ['.' * width] * height}
        for i, over in enumerate(steps):
            out[f'bolle-{i + 1}'] = scaled(derive({**frames, **blank}, '.', {}, over), scale)[rows[0]:rows[1]]
    return out


def layers_js(kind, layers, names, scale):
    """I campi perch e bubbles del personaggio, coi nomi delle costanti."""
    js = ''
    if 'perch' in layers:
        js += f"\n      perch: {{ grid: {names('perch')}, seat: {layers['perch'][1] * scale} }},"
    if 'bubbles' in layers:
        js += f"\n      bubbles: [{', '.join(names(f'bolle-{i + 1}') for i in range(len(layers['bubbles'][1])))}],"
    return js


def spritelli(kind, folder, poses, speed, motion, comment, derived, layers=None):
    """Un personaggio del pacchetto Spritelli: il sorgente del file."""
    layers = layers or {}
    frames, pal = spritelli_frames(folder)
    frames = {**frames, **{n: derive(frames, *spec) for n, spec in derived.items()}}
    frames = {n: unoutlined(g, pal[SPRITELLI_OUTLINE]) for n, g in frames.items()}
    used = list(dict.fromkeys(n for v in poses.values() for n in v))
    scale = SPRITELLI_SCALE
    grids, rows = crop({n: scaled(frames[n], scale) for n in used})
    extra = layer_grids(frames, layers, len(frames[used[0]]), rows, scale)
    drawn = [*used, *extra]
    grids = {**grids, **extra}
    # Solo i colori usati, nell'ordine in cui compaiono
    ink = dict.fromkeys(ch for n in drawn for r in grids[n] for ch in r if ch != '.')
    letter = {ch: LETTERS[i] for i, ch in enumerate(ink)}
    grids = {n: [''.join(letter.get(ch, ch) for ch in r) for r in g] for n, g in grids.items()}
    hexes = {v: h for h, v in pal.items()}
    used_pal = {hexes[ch]: letter[ch] for ch in ink}
    cn = lambda n: f"{kind.upper()}_{n.upper().replace('-', '_')}"
    first = grids[used[0]]
    lines = [f'  // ---- {comment} ({len(first[0])}×{len(first)}) ----']
    for n in drawn:
        lines += const_block(cn(n), grids[n])
    frames_js = ',\n'.join('        %s: [%s]' % (p, ', '.join(cn(n) for n in v)) for p, v in poses.items())
    variants = VARIANTS.get(kind, [])
    variants_js = ''
    if variants:
        rows_js = ',\n'.join('        { %s }' % ', '.join(f"{used_pal[h]}: '{c}'" for h, c in v.items()) for v in variants)
        variants_js = f'\n      variants: [\n{rows_js},\n      ],'
    extra_js = variants_js + layers_js(kind, layers, cn, scale)
    # Alto in scena quanto lo era a 16 px: le righe sulla cella ingrandita
    cell = GRID * scale
    height = round(len(first) / cell, 3) if len(first) < cell else None
    return module_js(kind, comment, 'Spritelli', lines, speed, motion, height, palette_js(kind, used_pal), extra_js, frames_js)


def write(kind, src):
    open(OUT % kind, 'w').write(src)
    print(kind, len(src.splitlines()), 'righe')


if __name__ == '__main__':
    for entry in SPEC:
        write(entry[0], classic(*entry))
    for kind, *entry in SPRITELLI:
        write(kind, spritelli(kind, *entry))

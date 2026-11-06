#!/usr/bin/env python3
"""Genera assets/notification-icon.png, l'icona delle notifiche di sistema.

Solo Peppo, la fetta di pizza dei pets, grande quanto tutta l'icona: chi vede
la notifica capisce che a chiamarlo e' una sessione di PizzaManager.

Peppo si legge dal suo sprite (renderer/pets-sprite-pizza.js, posa `idle`)
tramite node: niente copia della griglia qui. Pixel ingranditi senza
interpolazione, senza bordo. Braccia e gambe nello sprite sono quasi nere e
sul fondo scuro delle notifiche sparivano: qui prendono il marrone della
crosta. Le pupille restano scure. Lo sprite dei pets non cambia.

Uso: python3 assets/generate-notification-icon.py
"""
import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAX_SIZE = 256
LIMB = 'a'           # colore di braccia, gambe e pupille nello sprite
LIMB_RECOLOR = 'c'   # marrone della crosta, visibile su fondo scuro
FIRST_BODY_ROW = 14  # da qui in giu' (sprite intero) le 'a' sono arti, sopra pupille

NODE_DUMP = """
const s = require(process.argv[1]).pizza;
process.stdout.write(JSON.stringify({ rows: s.frames.idle[0], palette: s.palette }));
"""


def load_peppo() -> dict:
    sprite = ROOT / 'renderer' / 'pets-sprite-pizza.js'
    out = subprocess.run(['node', '-e', NODE_DUMP, str(sprite)], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def hex_rgba(value: str) -> tuple:
    v = value.lstrip('#')
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def recolor_limbs(rows: list) -> list:
    """Braccia e gambe col colore della crosta; le pupille, piu' in alto, no."""
    return [
        ''.join(LIMB_RECOLOR if ch == LIMB and y >= FIRST_BODY_ROW else ch for ch in r)
        for y, r in enumerate(rows)
    ]


def crop(rows: list) -> list:
    """Toglie righe e colonne vuote: conta solo il disegno."""
    filled = [(y, x) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != '.']
    ys, xs = [p[0] for p in filled], [p[1] for p in filled]
    return [r[min(xs):max(xs) + 1] for r in rows[min(ys):max(ys) + 1]]


def render(rows: list, palette: dict) -> Image.Image:
    """Un pixel per cella, quadrato, Peppo centrato in orizzontale."""
    rows = crop(rows)
    h, w = len(rows), len(rows[0])
    side = max(w, h)
    img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox, oy = (side - w) // 2, (side - h) // 2
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.':
                img.putpixel((ox + x, oy + y), hex_rgba(palette[ch]))
    return img


def main() -> None:
    data = load_peppo()
    small = render(recolor_limbs(data['rows']), data['palette'])
    scale = MAX_SIZE // small.width
    icon = small.resize((small.width * scale, small.height * scale), Image.NEAREST)
    out = ROOT / 'assets' / 'notification-icon.png'
    icon.save(out, optimize=True)
    print(f'scritto {out.relative_to(ROOT)} ({icon.width}x{icon.height})')


if __name__ == '__main__':
    main()

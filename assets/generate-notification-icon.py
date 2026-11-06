#!/usr/bin/env python3
"""Genera assets/notification-icon.png, l'icona delle notifiche di sistema.

La pizza dell'app (assets/icons/256x256.png, da generate-icon.py) con Peppo,
la fetta di pizza dei pets, piu' piccolo nell'angolo in basso a destra. Chi
vede la notifica riconosce l'app e capisce che a chiamarlo e' una sessione.

Peppo si legge dal suo sprite (renderer/pets-sprite-pizza.js, posa `idle`)
tramite node: niente copia della griglia qui. Pixel ingranditi senza
interpolazione, senza bordo: con il tema scuro un contorno chiaro stona.

Uso: python3 assets/generate-notification-icon.py
"""
import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SIZE = 256
PIZZA_SIZE = 216     # la pizza lascia spazio a Peppo nell'angolo
PIXEL = 5            # lato di un pixel di Peppo

NODE_DUMP = """
const s = require(process.argv[1]).pizza;
process.stdout.write(JSON.stringify({ rows: s.frames.idle[0], palette: s.palette }));
"""


def load_peppo():
    sprite = ROOT / 'renderer' / 'pets-sprite-pizza.js'
    out = subprocess.run(['node', '-e', NODE_DUMP, str(sprite)], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def hex_rgba(value):
    v = value.lstrip('#')
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def crop(rows):
    """Toglie righe e colonne vuote: conta solo il disegno."""
    filled = [(y, x) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != '.']
    ys, xs = [p[0] for p in filled], [p[1] for p in filled]
    return [r[min(xs):max(xs) + 1] for r in rows[min(ys):max(ys) + 1]]


def render_peppo(rows, palette):
    rows = crop(rows)
    h, w = len(rows), len(rows[0])
    img = Image.new('RGBA', (w * PIXEL, h * PIXEL), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '.':
                continue
            box = (x * PIXEL, y * PIXEL, (x + 1) * PIXEL, (y + 1) * PIXEL)
            img.paste(hex_rgba(palette[ch]), box)
    return img


def main():
    pizza = Image.open(ROOT / 'assets' / 'icons' / '256x256.png').convert('RGBA')
    pizza = pizza.resize((PIZZA_SIZE, PIZZA_SIZE), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(pizza, (0, 0))
    data = load_peppo()
    peppo = render_peppo(data['rows'], data['palette'])
    canvas.alpha_composite(peppo, (SIZE - peppo.width, SIZE - peppo.height))
    out = ROOT / 'assets' / 'notification-icon.png'
    canvas.save(out, optimize=True)
    print(f'scritto {out.relative_to(ROOT)} ({SIZE}x{SIZE})')


if __name__ == '__main__':
    main()

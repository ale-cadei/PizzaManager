#!/usr/bin/env python3
"""Genera le icone di AISessionManager.

Produce:
- assets/icon.png (1024x1024), usato da BrowserWindow, dal renderer e dal
  target macOS;
- assets/icons/NxN.png, il set che electron-builder installa in
  /usr/share/icons/hicolor su Linux. Serve il set completo: con un solo PNG
  i pannelli che non riscalano (dock, launcher, alt-tab) mostrano l'icona
  sgranata o quella generica.

Disegno ("node"): quadrato scuro con bordo teal, anello teal spezzato da una
fascia orizzontale e nodo corallo al centro. Ricalca assets/icon-node-384.png
in forma vettoriale: il sorgente e' 392x392, sotto il minimo per generare il
set completo, e un upscale sfocherebbe i bordi.

Colori allineati ai token del design system (--action, --accent).

Uso: python3 assets/generate-icon.py
"""
import os
from PIL import Image, ImageDraw

# Colori (vedi renderer/tokens.css)
BG = (11, 10, 14, 255)        # fondo scuro, in tema con --bg
TEAL = (31, 167, 154, 255)    # --action  #1FA79A
CORAL = (255, 138, 107, 255)  # --accent  #FF8A6B

SIZE = 1024
SUPERSAMPLE = 4  # disegna 4x e riduci: bordi antialiasati

# Geometria in frazioni del lato, cosi' la resa e' identica a ogni risoluzione
CORNER_RADIUS = 0.2015
BORDER_WIDTH = 0.0102
RING_OUTER = 0.2219
RING_INNER = 0.1531
GAP_HALF_HEIGHT = 0.0740  # meta' altezza della fascia che spezza l'anello
DOT_RADIUS = 0.0702

OUTPUT = 'assets/icon.png'
ICON_SET_DIR = 'assets/icons'
ICON_SET_SIZES = (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)


def _circle(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def draw_icon(side: int) -> Image.Image:
    """Ritorna una nuova immagine RGBA con l'icona disegnata a lato `side`."""
    img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    center = (side - 1) / 2

    # Fondo scuro con bordo teal
    draw.rounded_rectangle(
        (0, 0, side - 1, side - 1),
        radius=round(CORNER_RADIUS * side),
        fill=BG,
        outline=TEAL,
        width=max(1, round(BORDER_WIDTH * side)),
    )

    # Anello: disco teal svuotato al centro
    _circle(draw, center, center, RING_OUTER * side, TEAL)
    _circle(draw, center, center, RING_INNER * side, BG)

    # Fascia orizzontale che spezza l'anello in due archi
    gap = GAP_HALF_HEIGHT * side
    draw.rectangle((0, center - gap, side - 1, center + gap), fill=BG)

    # Nodo centrale
    _circle(draw, center, center, DOT_RADIUS * side, CORAL)
    return img


def render(side: int) -> Image.Image:
    """Icona antialiasata al lato richiesto (disegno a SUPERSAMPLE x, poi riduzione)."""
    return draw_icon(side * SUPERSAMPLE).resize((side, side), Image.LANCZOS)


def main() -> None:
    render(SIZE).save(OUTPUT)
    print(f'scritto {OUTPUT} ({SIZE}x{SIZE})')
    os.makedirs(ICON_SET_DIR, exist_ok=True)
    for side in ICON_SET_SIZES:
        path = os.path.join(ICON_SET_DIR, f'{side}x{side}.png')
        render(side).save(path)
        print(f'scritto {path}')


if __name__ == '__main__':
    main()

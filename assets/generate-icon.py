#!/usr/bin/env python3
"""Genera le icone di PizzaManager.

Produce:
- assets/icon.png (1024x1024), usato da BrowserWindow, dal renderer e dal
  target macOS;
- assets/icons/NxN.png, il set che electron-builder installa in
  /usr/share/icons/hicolor su Linux. Serve il set completo: con un solo PNG
  i pannelli che non riscalano (dock, launcher, alt-tab) mostrano l'icona
  sgranata o quella generica.

Disegno ("pizza"): quadrato scuro con bordo pomodoro e una pizza tagliata in
spicchi, ciascuno scostato radialmente dal centro cosi' che i tagli restino
leggibili anche a 16x16. Ogni spicchio e' un settore di cornicione con sopra
un settore piu' piccolo di formaggio e due dischetti di salame.

Colori della palette "Forno" (renderer/tokens.css): fondo --bg, bordo
--action, e gli stessi cornicione/formaggio/salame degli SVG del renderer
(renderer/pizza-logo.js, renderer/pizza-slice.js), cosi' icona di sistema e
logo nella sidebar sono la stessa pizza.

Uso: python3 assets/generate-icon.py
"""
import math
import os
from PIL import Image, ImageDraw

# Colori (vedi renderer/tokens.css)
BG = (7, 5, 5, 255)              # --bg       #070505
ACTION = (240, 78, 35, 255)      # --action   #F04E23, il bordo
PEPPERONI = (226, 65, 42, 255)   # salame     #E2412A
CRUST = (231, 163, 60, 255)      # cornicione #E7A33C
CHEESE = (245, 196, 90, 255)     # formaggio  #F5C45A

SIZE = 1024
SUPERSAMPLE = 4  # disegna 4x e riduci: bordi antialiasati

# Geometria in frazioni del lato, cosi' la resa e' identica a ogni risoluzione
CORNER_RADIUS = 0.2015
BORDER_WIDTH = 0.0102
PIZZA_RADIUS = 0.355        # raggio del cornicione
CHEESE_RATIO = 0.84         # il formaggio lascia scoperto il bordo esterno
SLICES = 8
SLICE_GAP_DEG = 5.0         # taglio fra due spicchi
SLICE_EXPLODE = 0.022       # scostamento radiale di ogni spicchio
PEPPERONI_RADIUS = 0.035
# Posizione dei salami dentro lo spicchio: (frazione del raggio, scarto in gradi
# dalla bisettrice). Due per spicchio, sfalsati, cosi' non sembrano allineati.
PEPPERONI_SPOTS = ((0.42, 0.0), (0.68, -9.0))

OUTPUT = 'assets/icon.png'
ICON_SET_DIR = 'assets/icons'
ICON_SET_SIZES = (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)


def _circle(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill)


def _sector(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float,
            start: float, end: float, fill) -> None:
    draw.pieslice((cx - r, cy - r, cx + r, cy + r), start, end, fill=fill)


def draw_slice(draw: ImageDraw.ImageDraw, side: int, index: int) -> None:
    """Disegna lo spicchio `index`, scostato dal centro lungo la sua bisettrice."""
    center = (side - 1) / 2
    step = 360 / SLICES
    start = index * step + SLICE_GAP_DEG / 2
    end = (index + 1) * step - SLICE_GAP_DEG / 2
    middle = math.radians((start + end) / 2)

    # Lo spicchio ha un centro tutto suo: e' cosi' che nasce lo stacco fra le fette
    cx = center + math.cos(middle) * SLICE_EXPLODE * side
    cy = center + math.sin(middle) * SLICE_EXPLODE * side
    radius = PIZZA_RADIUS * side

    _sector(draw, cx, cy, radius, start, end, CRUST)
    _sector(draw, cx, cy, radius * CHEESE_RATIO, start, end, CHEESE)

    for distance, offset_deg in PEPPERONI_SPOTS:
        angle = math.radians((start + end) / 2 + offset_deg)
        _circle(draw,
                cx + math.cos(angle) * radius * distance,
                cy + math.sin(angle) * radius * distance,
                PEPPERONI_RADIUS * side,
                PEPPERONI)


def draw_icon(side: int) -> Image.Image:
    """Ritorna una nuova immagine RGBA con l'icona disegnata a lato `side`."""
    img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fondo scuro con bordo pomodoro
    draw.rounded_rectangle(
        (0, 0, side - 1, side - 1),
        radius=round(CORNER_RADIUS * side),
        fill=BG,
        outline=ACTION,
        width=max(1, round(BORDER_WIDTH * side)),
    )

    for index in range(SLICES):
        draw_slice(draw, side, index)
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

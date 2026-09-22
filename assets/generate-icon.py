#!/usr/bin/env python3
"""Genera le icone di PizzaManager.

Produce:
- assets/icon.png (1024x1024), usato da BrowserWindow, dal renderer e dal
  target macOS;
- assets/icons/NxN.png, il set che electron-builder installa in
  /usr/share/icons/hicolor su Linux. Serve il set completo: con un solo PNG
  i pannelli che non riscalano (dock, launcher, alt-tab) mostrano l'icona
  sgranata o quella generica.

Disegno: *lo stesso* logo della sidebar (renderer/pizza-logo.js) - pizza intera
con una fetta sollevata e il buco che lascia ancora visibile - su fondo
trasparente, senza cornice. Icona di sistema e logo in finestra devono essere
la stessa immagine: chi vede l'icona nel dock e poi apre l'app deve
riconoscerla.

Senza riquadro la pizza e' ritagliata dal fondo: il dock, il launcher e la
barra dei titoli la mostrano sopra il loro colore, qualunque sia. Per questo
niente ombre ne' bordi scuri, che si vedrebbero solo su fondo chiaro.

La geometria e' quella dell'SVG, nelle sue stesse coordinate (viewBox 0 0
100 100): ruota centrata in (50,54), fetta traslata di (7.5,-9) e ruotata di
7 gradi attorno al centro. Qui i settori sono `pieslice` invece di path, e il
buco e' una maschera sull'alpha invece che una `<mask>` SVG. Se tocchi
l'SVG, tocca anche questi numeri (e viceversa): non c'e' un test che possa
accorgersi che le due pizze si sono allontanate.

Colori: cornicione/formaggio/salame/basilico identici a quelli degli SVG del
renderer (palette "Forno", renderer/tokens.css).

Uso: python3 assets/generate-icon.py
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw

# Colori (vedi renderer/tokens.css e renderer/pizza-logo.js)
CRUST = (231, 163, 60, 255)      # cornicione  #E7A33C
CHEESE = (245, 196, 90, 255)     # formaggio   #F5C45A
PEPPERONI = (226, 65, 42, 255)   # salame      #E2412A
BASIL = (127, 196, 90, 255)      # basilico    #7FC45A

SIZE = 1024
SUPERSAMPLE = 4  # disegna 4x e riduci: bordi antialiasati

# Quanto del lato occupa il logo (lato maggiore del suo ingombro). Senza
# cornice la pizza puo' arrivare quasi al bordo: il margine che resta serve
# solo a non far tagliare l'antialias dai pannelli che riscalano l'icona.
LOGO_EXTENT = 0.94

# --- Geometria del logo, coordinate SVG (viewBox 0 0 100 100) ---------------
CENTER = (50.0, 54.0)      # centro della ruota
CRUST_R = 34.0             # raggio del cornicione
CHEESE_R = 27.5            # il formaggio lascia scoperto il bordo esterno
# Il settore mancante. Angoli in gradi, orario da ore 3 come in PIL e in SVG
# (y cresce verso il basso): sono quelli del path GAP di pizza-logo.js.
GAP_FROM, GAP_TO = -75.0, -25.0
GAP_R = 36.0               # oltre il cornicione: il taglio deve uscire pulito
# Il formaggio della fetta sollevata rientra di qualche grado sui due lati,
# cosi' il cornicione si vede anche lungo i tagli e non solo sull'arco.
SLICE_CHEESE_INSET_DEG = 2.2
SLICE_ROTATE_DEG = 7.0     # la fetta esce inclinata, come se la stessero alzando
SLICE_OFFSET = (7.5, -9.0)

# Condimenti della ruota: (x, y, raggio, colore)
TOPPINGS = (
    (36.0, 46.0, 5.0, PEPPERONI),
    (54.0, 66.0, 5.6, PEPPERONI),
    (33.0, 64.0, 3.6, PEPPERONI),
    (47.0, 40.0, 2.6, BASIL),
    (28.0, 54.0, 2.4, BASIL),
)
# Condimenti della fetta, prima della rotazione e della traslazione
SLICE_TOPPINGS = (
    (63.0, 38.0, 4.4, PEPPERONI),
    (57.0, 45.0, 2.2, BASIL),
)

# Ingombro del disegno finito (ruota + fetta sollevata), stesse coordinate.
# Ricavato dagli estremi: la ruota sta in 16..84 x 20..88, la fetta arriva a
# x 89.8 e sale a y 13.5. Serve per centrare il logo nel quadrato.
CONTENT_BOX = (16.0, 13.5, 89.8, 88.0)

OUTPUT = 'assets/icon.png'
ICON_SET_DIR = 'assets/icons'
ICON_SET_SIZES = (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)


class Frame:
    """Converte le coordinate del logo in pixel per un'icona di lato `side`."""

    def __init__(self, side: int):
        left, top, right, bottom = CONTENT_BOX
        self.scale = LOGO_EXTENT * side / max(right - left, bottom - top)
        # Il centro dell'ingombro finisce al centro dell'icona
        self.dx = (side - 1) / 2 - (left + right) / 2 * self.scale
        self.dy = (side - 1) / 2 - (top + bottom) / 2 * self.scale

    def point(self, x: float, y: float) -> tuple:
        return (x * self.scale + self.dx, y * self.scale + self.dy)

    def length(self, value: float) -> float:
        return value * self.scale


def rotated(x: float, y: float, degrees: float, about: tuple) -> tuple:
    """Ruota (x,y) di `degrees` attorno ad `about`, verso orario (y in giu')."""
    angle = math.radians(degrees)
    dx, dy = x - about[0], y - about[1]
    return (about[0] + dx * math.cos(angle) - dy * math.sin(angle),
            about[1] + dx * math.sin(angle) + dy * math.cos(angle))


def translated(x: float, y: float, offset: tuple) -> tuple:
    return (x + offset[0], y + offset[1])


def circle(draw: ImageDraw.ImageDraw, frame: Frame,
           x: float, y: float, r: float, fill) -> None:
    cx, cy = frame.point(x, y)
    radius = frame.length(r)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill)


def sector(draw: ImageDraw.ImageDraw, frame: Frame, center: tuple, r: float,
           start: float, end: float, fill) -> None:
    cx, cy = frame.point(*center)
    radius = frame.length(r)
    draw.pieslice((cx - radius, cy - radius, cx + radius, cy + radius),
                  start, end, fill=fill)


def draw_wheel(side: int, frame: Frame) -> Image.Image:
    """La pizza intera, col settore della fetta gia' tolto dall'alpha."""
    wheel = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(wheel)
    circle(draw, frame, CENTER[0], CENTER[1], CRUST_R, CRUST)
    circle(draw, frame, CENTER[0], CENTER[1], CHEESE_R, CHEESE)
    for x, y, r, color in TOPPINGS:
        circle(draw, frame, x, y, r, color)

    # Il buco e' una maschera, non un settore ridipinto di nero: cosi' l'icona
    # resta corretta anche dove il fondo non e' --bg (temi chiari, badge).
    hole = Image.new('L', (side, side), 255)
    sector(ImageDraw.Draw(hole), frame, CENTER, GAP_R, GAP_FROM, GAP_TO, 0)
    wheel.putalpha(ImageChops.multiply(wheel.getchannel('A'), hole))
    return wheel


def draw_slice(draw: ImageDraw.ImageDraw, frame: Frame) -> None:
    """La fetta sollevata: stessa geometria del buco, ruotata e spostata."""
    apex = translated(*rotated(CENTER[0], CENTER[1], SLICE_ROTATE_DEG, CENTER),
                      SLICE_OFFSET)
    start, end = GAP_FROM + SLICE_ROTATE_DEG, GAP_TO + SLICE_ROTATE_DEG
    sector(draw, frame, apex, CRUST_R, start, end, CRUST)
    sector(draw, frame, apex, CHEESE_R,
           start + SLICE_CHEESE_INSET_DEG, end - SLICE_CHEESE_INSET_DEG, CHEESE)

    for x, y, r, color in SLICE_TOPPINGS:
        px, py = translated(*rotated(x, y, SLICE_ROTATE_DEG, CENTER), SLICE_OFFSET)
        circle(draw, frame, px, py, r, color)


def draw_icon(side: int) -> Image.Image:
    """Ritorna una nuova immagine RGBA con l'icona disegnata a lato `side`."""
    img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    frame = Frame(side)
    img.alpha_composite(draw_wheel(side, frame))
    draw_slice(ImageDraw.Draw(img), frame)
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

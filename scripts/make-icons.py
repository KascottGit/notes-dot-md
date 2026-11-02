"""
Draws the app icon, ".md" in Source Serif 4 (the note text font), as SVG
outlines, so it looks the same in every browser tab without loading a font.

Run from the repo root (needs fonttools and brotli: pip install fonttools brotli):
    python scripts/make-icons.py
Writes public/favicon.svg (for browser tabs; dark text, light in dark mode) and
scripts/icon-tile.svg (the same text on a white tile), which the PNGs are
rendered from: public/favicon-32.png at 32px, and public/apple-touch-icon.png
at 180px with square corners (iOS rounds them itself and fills transparent
corners with black), e.g. with rsvg-convert -w 180.
Then raise the ?v= number on the icon links in index.html: browsers keep tab
icons by address and won't load the new ones otherwise.
"""
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT = Path(
    "node_modules/@fontsource-variable/source-serif-4/files/"
    "source-serif-4-latin-opsz-normal.woff2"
)
TEXT = ".md"
# A little heavier than the note text (400), so it reads at 16px; small-size optical size.
AXES = {"wght": 600, "opsz": 12}
SIZE = 64  # viewBox
PAD = 3  # left and right


def outlines() -> tuple[str, float, float, float]:
    """The text's path in font units (y down), with its left, top and width/height."""
    font = TTFont(FONT)
    font = instantiateVariableFont(font, {k: v for k, v in AXES.items() if k in [a.axisTag for a in font["fvar"].axes]})
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphs, ntos=lambda n: f"{n:.0f}")
    x = 0
    for char in TEXT:
        name = cmap[ord(char)]
        # Flip y (fonts point up, SVG down) and move along by the advance width.
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        x += glyphs[name].width
    # Ink bounds, from the drawn commands.
    from fontTools.pens.boundsPen import BoundsPen

    bounds = BoundsPen(glyphs)
    x = 0
    for char in TEXT:
        name = cmap[ord(char)]
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, -1, x, 0)))
        x += glyphs[name].width
    x_min, y_min, x_max, y_max = bounds.bounds
    return pen.getCommands(), x_min, y_min, x_max - x_min, y_max - y_min


def svg(path: str, left: float, top: float, width: float, height: float, tile: bool) -> str:
    scale = (SIZE - 2 * PAD - (8 if tile else 0)) / width
    dx = (SIZE - width * scale) / 2 - left * scale
    # Sit the letters a little below center, so the dot and the x-height balance.
    dy = (SIZE - height * scale) / 2 - top * scale + 1
    transform = f"matrix({scale:.5f} 0 0 {scale:.5f} {dx:.3f} {dy:.3f})"
    if tile:
        body = (
            f'  <rect width="{SIZE}" height="{SIZE}" rx="14" fill="#ffffff" />\n'
            f'  <path transform="{transform}" fill="#1b1b1f" d="{path}" />\n'
        )
    else:
        body = (
            "  <style>path { fill: #1b1b1f; } "
            "@media (prefers-color-scheme: dark) { path { fill: #e8e8ee; } }</style>\n"
            f'  <path transform="{transform}" d="{path}" />\n'
        )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">\n{body}</svg>\n'


if __name__ == "__main__":
    shape = outlines()
    Path("public/favicon.svg").write_text(svg(*shape, tile=False))
    Path("scripts/icon-tile.svg").write_text(svg(*shape, tile=True))
    print("wrote public/favicon.svg and scripts/icon-tile.svg")

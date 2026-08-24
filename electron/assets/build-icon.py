#!/usr/bin/env python3
"""Generate electron/assets/hades.ico from the brand sigil (mini).

Geometry follows docs/BRAND-HADES.md (mini sigil) and public/brand/hades-sigil-mini.svg:
viewBox 100x100, dark ink disk, amethyst ring (r36, stroke 9), gold core (r15).
Dark-theme brand values are used because the taskbar/tile sits on a chrome that is
usually dark, and the gold core reads best on ink. Kept identical to public/favicon.ico
intent so the desktop app and the browser tab share one mark.

Each size is supersampled 4x and downscaled with LANCZOS for a clean anti-aliased edge.
"""
from PIL import Image, ImageDraw

INK = (14, 20, 19, 255)        # #0e1413  papier (tmavý)
AMETHYST = (196, 162, 245, 255)  # #c4a2f5  akcent (tmavá téma)
GOLD = (216, 184, 120, 255)      # #d8b878  jadro / brand-gold

SIZES = [16, 24, 32, 48, 64, 128, 256]
SS = 4  # supersampling factor


def draw_sigil(px: int) -> Image.Image:
    n = px * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / 100.0  # viewBox 100 -> pixel scale
    cx = cy = 50.0 * s

    def disc(r, fill):
        d.ellipse([cx - r * s, cy - r * s, cx + r * s, cy + r * s], fill=fill)

    # Ink disk (r50 touches the square edges, corners stay transparent).
    disc(50, INK)
    # Amethyst ring as an annulus centred on r36 with stroke width 9 (r 31.5..40.5).
    disc(40.5, AMETHYST)
    disc(31.5, INK)
    # Gold core.
    disc(15, GOLD)

    return img.resize((px, px), Image.LANCZOS)


def main():
    frames = [draw_sigil(px) for px in SIZES]
    # PIL writes a multi-size .ico from the largest image + a sizes list.
    frames[-1].save(
        "hades.ico",
        format="ICO",
        sizes=[(px, px) for px in SIZES],
        append_images=frames[:-1],
    )
    print("wrote hades.ico:", SIZES)


if __name__ == "__main__":
    main()

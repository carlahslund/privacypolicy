#!/usr/bin/env python3
"""Builds the launcher artwork both TV apps need from the one logo in shared/web.

Android TV shows a 320x180 banner on the home row rather than an icon, and Tizen wants
a square icon; neither is worth hand-cutting every time the logo changes. Run:

    python3 tv/tools/make-art.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TV = os.path.dirname(HERE)
LOGO = os.path.join(TV, 'shared', 'web', 'logo.png')
BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

GB_RED = (221, 30, 37)
INK = (14, 15, 19)


def font(size):
    try:
        return ImageFont.truetype(BOLD, size)
    except OSError:
        return ImageFont.load_default()


def tracked(draw, xy, text, fill, f, tracking):
    """Letter-spaced text — the wordmark is set wide, and PIL has no tracking."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


def width_of(draw, text, f, tracking):
    return sum(draw.textlength(c, font=f) + tracking for c in text) - tracking


def banner(path, w=320, h=180):
    card = Image.new('RGBA', (w, h), INK)
    draw = ImageDraw.Draw(card)
    # a soft red glow behind the mark, echoing the display's radial background
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-w * 0.15, h * 0.45, w * 0.75, h * 1.7], fill=(78, 18, 23, 255))
    card = Image.alpha_composite(card, glow)
    draw = ImageDraw.Draw(card)
    draw.rectangle([0, 0, w, 4], fill=GB_RED)
    draw.rectangle([0, h - 5, w, h], fill=GB_RED)

    mark = Image.open(LOGO).convert('RGBA')
    side = int(h * 0.52)
    mark = mark.resize((side, side), Image.LANCZOS)
    card.paste(mark, (20, (h - side) // 2), mark)

    left = 20 + side + 16
    title = font(23)
    subtitle = font(11)
    tracked(draw, (left, h // 2 - 30), 'GRACIE', (255, 255, 255), title, 1.6)
    tracked(draw, (left, h // 2 - 4), 'BARRA', (255, 255, 255), title, 1.6)
    tracked(draw, (left, h // 2 + 28), 'ROUND TIMER', (226, 138, 142), subtitle, 2.4)
    card.convert('RGB').save(path)
    return path


def icon(path, size, rounded=True):
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    plate = Image.new('RGBA', (size, size), INK)
    if rounded:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size, fill=255)
        plate.putalpha(mask.resize((size, size), Image.LANCZOS))
    card = Image.alpha_composite(card, plate)
    mark = Image.open(LOGO).convert('RGBA')
    inner = int(size * 0.78)
    mark = mark.resize((inner, inner), Image.LANCZOS)
    card.paste(mark, ((size - inner) // 2, (size - inner) // 2), mark)
    card.save(path)
    return path


def square_foreground(path, size=432):
    """Adaptive-icon foreground: the mark alone, inside the safe circle."""
    card = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mark = Image.open(LOGO).convert('RGBA')
    inner = int(size * 0.52)
    mark = mark.resize((inner, inner), Image.LANCZOS)
    card.paste(mark, ((size - inner) // 2, (size - inner) // 2), mark)
    card.save(path)
    return path


def main():
    android = os.path.join(TV, 'android-tv', 'app', 'src', 'main', 'res')
    made = []
    os.makedirs(os.path.join(android, 'drawable-xhdpi'), exist_ok=True)
    made.append(banner(os.path.join(android, 'drawable-xhdpi', 'banner.png')))

    for folder, size in [('mipmap-mdpi', 48), ('mipmap-hdpi', 72), ('mipmap-xhdpi', 96),
                         ('mipmap-xxhdpi', 144), ('mipmap-xxxhdpi', 192)]:
        os.makedirs(os.path.join(android, folder), exist_ok=True)
        made.append(icon(os.path.join(android, folder, 'ic_launcher.png'), size))

    os.makedirs(os.path.join(android, 'drawable-nodpi'), exist_ok=True)
    made.append(square_foreground(os.path.join(android, 'drawable-nodpi', 'ic_launcher_mark.png')))

    tizen = os.path.join(TV, 'samsung-tv')
    os.makedirs(tizen, exist_ok=True)
    made.append(icon(os.path.join(tizen, 'icon.png'), 512, rounded=False))

    for path in made:
        print(os.path.relpath(path, TV), Image.open(path).size)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Regenerate the favicon set (assets/icons/ + favicon.ico).

Design: orange line-art junction arrow — straight up with one branch
diverting right — matching the app accent (#c2410c). Transparent
background everywhere except the apple-touch-icon (iOS renders
transparency as black, so it gets a white plate).

Usage:
    pip install pillow
    python3 tools/make_icons.py

Keep the geometry in sync with assets/icons/favicon.svg.
"""

import math
import os

from PIL import Image, ImageDraw

ORANGE = (194, 65, 12, 255)  # #c2410c

STEM = [(22, 58), (22, 10)]
HEAD = [((13, 20), (22, 10)), ((22, 10), (31, 20))]
B0, B1, B2, B3 = (22, 46), (22, 33), (33, 29), (49, 23)  # branch bezier


def bezier(t):
    mt = 1 - t
    return (
        mt**3 * B0[0] + 3 * mt**2 * t * B1[0] + 3 * mt * t**2 * B2[0] + t**3 * B3[0],
        mt**3 * B0[1] + 3 * mt**2 * t * B1[1] + 3 * mt * t**2 * B2[1] + t**3 * B3[1],
    )


tip = B3
_d = (B3[0] - B2[0], B3[1] - B2[1])
_dl = math.hypot(*_d)
_d = (_d[0] / _dl, _d[1] / _dl)


def arm(angle_deg, length=10):
    a = math.radians(angle_deg)
    rx = _d[0] * math.cos(a) - _d[1] * math.sin(a)
    ry = _d[0] * math.sin(a) + _d[1] * math.cos(a)
    return (tip[0] - rx * length, tip[1] - ry * length)


BRANCH_HEAD = [(arm(32), tip), (tip, arm(-32))]


def draw_icon(size, bg=None, pad_ratio=0.0):
    S = 16  # supersampling factor
    img = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0) if bg is None else bg)
    dr = ImageDraw.Draw(img)
    pad = size * S * pad_ratio
    scale = (size * S - 2 * pad) / 64.0

    def pt(p):
        return (pad + p[0] * scale, pad + p[1] * scale)

    w = max(2, int(5.5 * scale))

    def rline(a, b):
        dr.line([pt(a), pt(b)], fill=ORANGE, width=w)
        for p in (a, b):  # round caps
            x, y = pt(p)
            dr.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ORANGE)

    rline(*STEM)
    for a, b in HEAD:
        rline(a, b)
    pts = [bezier(i / 24) for i in range(25)]
    for a, b in zip(pts[:-1], pts[1:]):
        rline(a, b)
    for a, b in BRANCH_HEAD:
        rline(a, b)
    return img.resize((size, size), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "assets", "icons")
    os.makedirs(out, exist_ok=True)
    draw_icon(16).save(f"{out}/favicon-16.png")
    draw_icon(32).save(f"{out}/favicon-32.png")
    draw_icon(192).save(f"{out}/icon-192.png")
    draw_icon(512).save(f"{out}/icon-512.png")
    draw_icon(180, bg=(255, 255, 255, 255), pad_ratio=0.12).save(f"{out}/apple-touch-icon.png")
    draw_icon(256).save(os.path.join(root, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons written to", out)


if __name__ == "__main__":
    main()

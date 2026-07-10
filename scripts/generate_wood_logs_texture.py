"""Generate procedural wood-log bridge albedo and derived PBR maps."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from derive_pbr_maps import make_edge_mask, save_height_maps  # noqa: E402


def generate_wood_albedo(size: int = 1024) -> Image.Image:
    img = Image.new("RGB", (size, size), (92, 68, 44))
    draw = ImageDraw.Draw(img)
    plank_count = 14
    plank_h = size // plank_count

    for row in range(plank_count):
        y0 = row * plank_h
        y1 = min(size, y0 + plank_h - 3)
        wobble = int(4 * math.sin(row * 0.73 + 1.2))
        base = 78 + (row % 3) * 9
        color = (base + 18, base - 4, base - 22)
        draw.rectangle((wobble, y0, size - wobble, y1), fill=color)

        gap_y = y1 + 1
        if gap_y < size:
            draw.rectangle((0, gap_y, size, min(size, gap_y + 2)), fill=(48, 34, 22))

        for log in range(5):
            cx = int((log + 0.5) * size / 5 + math.sin(row * 1.7 + log) * 8)
            cy = (y0 + y1) // 2
            rx = int(size / 11)
            ry = int(plank_h * 0.34)
            ring_color = (color[0] - 14, color[1] - 10, color[2] - 8)
            draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=ring_color, outline=(color[0] - 24, color[1] - 18, color[2] - 14))

    img = img.filter(ImageFilter.GaussianBlur(0.45))
    img = ImageEnhance.Contrast(img).enhance(1.08)
    img = ImageEnhance.Sharpness(img).enhance(1.15)
    return img


def main() -> None:
    out_dir = ROOT / "public/assets/textures/roads/wood_logs"
    out_dir.mkdir(parents=True, exist_ok=True)
    albedo = generate_wood_albedo()
    albedo.save(out_dir / "albedo.png")
    save_height_maps(albedo, out_dir, road=True)
    make_edge_mask(out_dir)
    (out_dir / "README.md").write_text(
        "Wooden log bridge deck PBR texture set. Albedo generated procedurally; derived maps from scripts/derive_pbr_maps.py.\n",
        encoding="utf-8",
    )
    print(f"Wrote wood_logs textures to {out_dir}")


if __name__ == "__main__":
    main()

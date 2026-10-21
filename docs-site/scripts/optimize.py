"""Converts every PNG in a folder to a 256-color palette PNG. Usage: python3 optimize.py <folder>"""
import pathlib
import sys

from PIL import Image

folder = pathlib.Path(sys.argv[1])
for file in sorted(folder.glob("*.png")):
    before = file.stat().st_size
    with Image.open(file) as img:
        if img.mode == "P":
            continue
        small = img.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    small.save(file, optimize=True)
    print(f"{file.name}: {before // 1024} KB -> {file.stat().st_size // 1024} KB")

#!/usr/bin/env python3
"""Writes the pixelherd-agents animal sprites.

Each animal is 16 rows of 16 characters plus a character-to-color palette
("." is clear). The script writes mods/pixelherd-agents/sprites/<animal>.svg,
48 x 48 px with a 16 x 16 viewBox, one rect per run of same-colored pixels.
It never installs anything. Run it from anywhere:

    python3 -I tools/build-sprites.py

The mod lists the animals in its ANIMALS array; keep the two in step.
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "mods" / "pixelherd-agents" / "sprites"

# Shared colors, so the animals read as one set.
INK = "#1e1626"  # outline
WHITE = "#f4f1ea"

ANIMALS = {
    # A yellow rubber duck facing right, in front of a dark green bush.
    "duck": {
        "palette": {
            "K": INK, "Y": "#f9d548", "y": "#dba830", "O": "#f28c28",
            "W": WHITE, "G": "#1c4a33", "g": "#2c6a45", "L": "#6f9440", "S": "#7d8590",
        },
        "rows": [
            "................",
            "................",
            "....S.GGGG.S....",
            "..GGGGKKKKGGGG..",
            ".LLGGKYYYYKGGGG.",
            ".LLGKYYYYYYKGgG.",
            ".LLGKYYYWKYKGgG.",
            ".LLgKYYYYYYOOOK.",
            ".LggKYYYYYYOOK..",
            ".KKgKYYYYYYKggg.",
            ".KYKKYYYYYYYKgg.",
            ".KYYYYYYYYYYYKg.",
            ".KYYYYyYYYYYYYK.",
            ".KYYYYyyyYYYYYK.",
            "..KYYYYYYYYYYK..",
            "...KKKKKKKKKK...",
        ],
    },
    # A green frog with a light belly, wearing a flat gray cap.
    "frog": {
        "palette": {
            "K": INK, "G": "#5fc15c", "g": "#3d8f48", "B": "#c3e79a",
            "W": WHITE, "H": "#5d6672", "h": "#7e8896",
        },
        "rows": [
            "................",
            "................",
            "................",
            ".....KKKKKK.....",
            "....KhhhhhhK....",
            "..KKKHHHHHHKKK..",
            ".KWWKKKKKKKKWWK.",
            ".KWKGGGGGGGGKWK.",
            ".KGGGGGGGGGGGGK.",
            ".KgGGGGGGGGGGgK.",
            ".KGgKKKKKKKKgGK.",
            ".KGGGGGGGGGGGGK.",
            ".KGBBBBBBBBBBGK.",
            ".KGBBBBBBBBBBGK.",
            "KGGKBBBBBBBBKGGK",
            "KKKKKKKKKKKKKKKK",
        ],
    },
    # An orange tabby cat, sitting, tail curled up on the right.
    "cat": {
        "palette": {
            "K": INK, "O": "#f0a04b", "o": "#c46f2a", "C": "#fbe3c4",
            "P": "#f5a3b5", "E": "#a6e3a1",
        },
        "rows": [
            "................",
            "................",
            "..K......K......",
            ".KOK....KOK.....",
            ".KPOKKKKOPK.....",
            ".KOOoOOoOOK.....",
            ".KOOOOOOOOK.....",
            ".KOEKOOKEOK.....",
            ".KOOOPPOOOK..K..",
            "..KCCKKCCK..KoK.",
            "..KOOCCOOK..KoK.",
            ".KOoOCCOoOK.KoK.",
            ".KOOOCCOOOKKoK..",
            ".KOoOCCOoOOoK...",
            ".KOOKCCKOOKK....",
            "..KKKKKKKKK.....",
        ],
    },
    # A penguin, black back, white front, orange beak and feet.
    "penguin": {
        "palette": {
            "K": INK, "N": "#3b4258", "n": "#2a3044", "W": WHITE,
            "O": "#f5a742", "B": "#89b4fa",
        },
        "rows": [
            "................",
            "................",
            ".....KKKKKK.....",
            "....KNNNNNNK....",
            "...KNNWNNWNNK...",
            "...KNWKWWKWNK...",
            "...KNWWOOWWNK...",
            "..KNNNWOOWNNNK..",
            "..KNnWWWWWWnNK..",
            ".KNnNWWWWWWNnNK.",
            ".KNnNWWWWWWNnNK.",
            ".KNnNWWWWWWNnNK.",
            "..KNNWWWWWWNNK..",
            "..KNNNWWWWNNNK..",
            "...KOOKKKKOOK...",
            "...KKKK..KKKK...",
        ],
    },
}


def svg(animal):
    rows = animal["rows"]
    palette = animal["palette"]
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), "16 x 16 pixels"
    rects = []
    for y, row in enumerate(rows):
        x = 0
        while x < 16:
            ch = row[x]
            end = x
            while end < 16 and row[end] == ch:
                end += 1
            if ch != ".":
                rects.append(f'<rect x="{x}" y="{y}" width="{end - x}" height="1" fill="{palette[ch]}"/>')
            x = end
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 16 16" '
        'shape-rendering="crispEdges">' + "".join(rects) + "</svg>\n"
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, animal in ANIMALS.items():
        (OUT / f"{name}.svg").write_text(svg(animal))
        print(f"wrote {OUT / name}.svg")


if __name__ == "__main__":
    main()

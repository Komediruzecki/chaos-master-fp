#!/usr/bin/env python3
"""Author periodic linear detail fields for the Observatory architecture.

Geometry, palette and score-led lights are untouched. These seeded fields are
procedural material detail, not photographs, scans or AI-generated images.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw


SOURCE = Path(__file__).resolve()
HELPER = SOURCE.parents[1] / "almanac/build_surfaces.py"
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("almanac_surface_authoring", HELPER)
assert SPEC is not None and SPEC.loader is not None
SHARED = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SHARED)
SIZE = SHARED.SIZE
NAMES = ("mineral-stone", "worked-dark-finish", "aged-metal")
SEEDS = (71021, 81021, 91021)
DESCRIPTIONS = (
    "Honed architectural stone: restrained mineral strata, fine grains and small pores.",
    "Finely worked dark finish: quiet polishing marks, shallow pores and soft surface variation.",
    "Aged brass or bronze: fine directional machining, sparse scratches and tonal roughness patina.",
)


def warp(field: np.ndarray, dx: np.ndarray, dy: np.ndarray) -> np.ndarray:
    """Periodic bilinear resampling curves strata without a tile-edge jump."""
    yy, xx = np.indices((SIZE, SIZE), dtype=np.float64)
    xx, yy = (xx + dx) % SIZE, (yy + dy) % SIZE
    x0, y0 = np.floor(xx).astype(int), np.floor(yy).astype(int)
    fx, fy = xx - x0, yy - y0
    return (
        field[y0, x0] * (1 - fx) * (1 - fy)
        + field[y0, (x0 + 1) % SIZE] * fx * (1 - fy)
        + field[(y0 + 1) % SIZE, x0] * (1 - fx) * fy
        + field[(y0 + 1) % SIZE, (x0 + 1) % SIZE] * fx * fy
    )


def pores(rng: np.random.Generator, count: int, softness: float) -> np.ndarray:
    field = np.zeros((SIZE, SIZE), np.float64)
    points = rng.integers(0, SIZE, size=(count, 2))
    np.add.at(field, (points[:, 0], points[:, 1]), rng.uniform(0.2, 1, count))
    return SHARED.normalized(SHARED.blur(field, softness))


def stone(rng: np.random.Generator) -> np.ndarray:
    grains = SHARED.noise(rng, 1.6)
    micro = SHARED.noise(rng, 0.6)
    pits = pores(rng, 2700, 0.75)
    strata = warp(
        SHARED.noise(rng, 30, 4.2),
        7 * SHARED.noise(rng, 34),
        15 * SHARED.noise(rng, 38),
    )
    mineral = SHARED.normalized(strata * 0.75 + SHARED.noise(rng, 7.5) * 0.25)
    broad = SHARED.noise(rng, 56)
    height = 0.5 + 0.067 * grains + 0.025 * micro - 0.046 * pits + 0.032 * mineral
    roughness = 0.5 + 0.085 * grains + 0.12 * pits + 0.06 * mineral + 0.035 * micro
    albedo = 0.5 + 0.095 * mineral + 0.045 * grains - 0.025 * pits + 0.025 * broad
    return np.stack((height, roughness, albedo), axis=-1)


def dark_finish(rng: np.random.Generator) -> np.ndarray:
    brushed = SHARED.noise(rng, 29, 0.9)
    polish = SHARED.strokes(rng, 1800, (12, 90), directional=True)
    fine = SHARED.noise(rng, 0.7)
    skin = SHARED.noise(rng, 4.1)
    broad = SHARED.noise(rng, 23)
    pits = pores(rng, 1500, 0.65)
    height = 0.5 + 0.025 * brushed + 0.018 * polish + 0.019 * skin - 0.02 * pits + 0.01 * fine
    roughness = 0.5 + 0.08 * brushed + 0.055 * polish + 0.075 * fine + 0.055 * broad + 0.04 * pits
    albedo = 0.5 + 0.027 * broad + 0.022 * skin - 0.012 * pits + 0.008 * polish
    return np.stack((height, roughness, albedo), axis=-1)


def aged_metal(rng: np.random.Generator) -> np.ndarray:
    brushed = SHARED.noise(rng, 65, 0.65)
    scratches = SHARED.strokes(rng, 760, (13, 110), directional=True)
    fine = SHARED.noise(rng, 0.7)
    patch = SHARED.noise(rng, 19) * 0.7 + SHARED.noise(rng, 5.5) * 0.3
    patina = SHARED.normalized(np.tanh((patch + 0.08) * 2.7))
    polish = SHARED.noise(rng, 32, 8)
    height = 0.5 + 0.028 * brushed + 0.018 * scratches + 0.012 * patina + 0.009 * fine
    roughness = 0.5 + 0.11 * brushed + 0.17 * patina - 0.045 * scratches + 0.025 * fine
    albedo = 0.5 - 0.055 * patina + 0.025 * polish + 0.015 * fine
    return np.stack((height, roughness, albedo), axis=-1)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def representative_origin(tile: np.ndarray) -> np.ndarray:
    """Choose a quiet repeat origin with representative neighbouring gradients.

    This only cyclically translates an already periodic field. No border pixels
    are patched or removed. It avoids placing a rare strong machining stroke
    exactly at the origin of every tile, where it can resemble an authored seam.
    """
    values = tile[:, :, :3].astype(np.float64)
    for axis, average_axis in ((0, 1), (1, 0)):
        gradients = np.mean(np.abs(np.roll(values, -1, axis) - values), axis=average_axis)
        mean = np.maximum(np.mean(gradients, axis=0), 0.01)
        score = np.sum(((gradients / mean) - 1) ** 2, axis=1)
        offset = -(int(np.argmin(score)) + 1)
        tile = np.roll(tile, offset, axis=axis)
        values = np.roll(values, offset, axis=axis)
    return tile


def contact_sheet(tiles: list[np.ndarray], output: Path) -> None:
    size = 256
    sheet = Image.new("RGB", (size * 4, 3 * (size + 38)), "#171719")
    draw = ImageDraw.Draw(sheet)
    labels = ("Mineral stone", "Worked dark finish", "Aged metal")
    for row, (name, tile) in enumerate(zip(labels, tiles)):
        top = row * (size + 38)
        for channel, label in enumerate(("Height", "Roughness", "Albedo")):
            image = Image.fromarray(tile[:, :, channel]).resize((size, size), Image.Resampling.LANCZOS)
            sheet.paste(image.convert("RGB"), (channel * size, top + 28))
            draw.text((channel * size + 8, top + 8), f"{name} / {label}", fill="#e1d9c9")
        repeated = np.tile(tile[:, :, 0], (2, 2))
        image = Image.fromarray(repeated).resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(image.convert("RGB"), (size * 3, top + 28))
        draw.text((size * 3 + 8, top + 8), f"{name} / 2 x 2 repeat", fill="#e1d9c9")
    sheet.save(output / "surface-channel-contact-sheet.png")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path)
    args = parser.parse_args()
    if not args.evidence_dir.is_absolute():
        parser.error("--evidence-dir must be an absolute registered-run path")
    runtime = args.runtime_dir or SOURCE.parents[2] / "public/models/observatory/surfaces"
    runtime.mkdir(parents=True, exist_ok=True)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    tiles = [representative_origin(SHARED.encode(build(np.random.default_rng(seed)))) for build, seed in zip((stone, dark_finish, aged_metal), SEEDS)]
    chains = [SHARED.mip_chain(tile) for tile in tiles]
    payload = b"".join(level.tobytes() for chain in chains for level in chain)
    binary = struct.pack("<8s6I", b"LMSURF01", SIZE, SIZE, 3, 10, 4, len(payload)) + payload
    asset = "observatory-surfaces-v1.bin"
    (runtime / asset).write_bytes(binary)
    layers, offset = [], 32
    for index, (name, chain, seed, description) in enumerate(zip(NAMES, chains, SEEDS, DESCRIPTIONS)):
        mips = []
        for level, pixels in enumerate(chain):
            mips.append({"level": level, "width": pixels.shape[1], "height": pixels.shape[0], "offset": offset, "bytes": pixels.nbytes})
            offset += pixels.nbytes
        layers.append({"index": index, "name": name, "seed": seed, "description": description, "mips": mips})
        Image.fromarray(tiles[index]).save(args.evidence_dir / f"{name}-linear-data.png")
    manifest = {
        "schemaVersion": 1,
        "asset": asset,
        "sha256": digest(binary),
        "bytes": len(binary),
        "payloadBytes": len(payload),
        "authoring": "Deterministic procedural material fields; no scans, photographs, external assets or AI image models.",
        "generator": "assets-source/observatory/build_surfaces.py",
        "generatorSha256": digest(SOURCE.read_bytes()),
        "sharedAuthoringHelper": "assets-source/almanac/build_surfaces.py",
        "sharedAuthoringHelperSha256": digest(HELPER.read_bytes()),
        "generatorDependencies": {"numpy": np.__version__, "pillow": Image.__version__},
        "format": "LMSURF01 / 32-byte little-endian header / layer-major / mip-major / row-major tightly packed RGBA8",
        "colorSpace": "linear data; upload as rgba8unorm, never rgba8unorm-srgb",
        "width": SIZE,
        "height": SIZE,
        "layerCount": 3,
        "mipCount": 10,
        "channels": {"r": "height centred on 0.5", "g": "roughness variation centred on 0.5, not absolute roughness", "b": "albedo variation centred on 0.5, not base colour", "a": "constant 255; reserved, not ambient occlusion"},
        "mipFilter": "2x2 arithmetic area average of linear uint8 channels with integer round-to-nearest",
        "addressMode": "repeat",
        "scaleRecommendations": {"stoneBayRepeatUnits": 1.35, "stoneTempleRepeatUnits": 0.85, "workedDarkRepeatUnits": 0.32, "agedMetalRepeatUnits": 0.24, "qualification": "Artistic starting values in existing metre-oriented study units. Runtime may calibrate these against actual camera distance; headset physical scale is unverified."},
        "layers": layers,
    }
    (runtime / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    receipt = {"sha256": manifest["sha256"], "bytes": len(binary), "mipCount": 10, "seams": {name: SHARED.seam_metrics(tile) for name, tile in zip(NAMES, tiles)}}
    (args.evidence_dir / "surface-generation-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    contact_sheet(tiles, args.evidence_dir)
    print(json.dumps({"runtime": str(runtime), "bytes": len(binary), "sha256": manifest["sha256"]}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Author reproducible, periodic linear detail fields for the desktop Almanac.

No photographs, scans or generated image models are used. NumPy supplies the
seeded fields; Pillow writes inspection PNGs only. The runtime reads raw RGBA8.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw


SIZE = 512
MAGIC = b"LMSURF01"
NAMES = ("paper", "leather", "metal")
SEEDS = (41021, 51021, 61021)
DESCRIPTIONS = (
    "Black rag paper: short irregular fibres, fine pulp and broad quiet mottling.",
    "Tobacco-black leather: warped irregular pebbles, softened creases and pores.",
    "Polished metal: fine longitudinal brushing and sparse burnishing scratches.",
)


def blur(field: np.ndarray, sx: float, sy: float | None = None) -> np.ndarray:
    """Gaussian low pass on a torus; no clamped-border seams."""
    sy = sx if sy is None else sy
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.rfftfreq(SIZE)[None, :]
    kernel = np.exp(-2 * np.pi**2 * ((fx * sx) ** 2 + (fy * sy) ** 2))
    return np.fft.irfft2(np.fft.rfft2(field) * kernel, s=field.shape)


def normalized(field: np.ndarray) -> np.ndarray:
    """Bound the outliers without clipping them into plateaus."""
    field = field - np.mean(field)
    return np.tanh(field / max(float(np.std(field)) * 2.2, 1e-8))


def noise(rng: np.random.Generator, sx: float, sy: float | None = None) -> np.ndarray:
    return normalized(blur(rng.normal(size=(SIZE, SIZE)), sx, sy))


def strokes(
    rng: np.random.Generator,
    count: int,
    lengths: tuple[float, float],
    directional: bool = False,
) -> np.ndarray:
    """Deposit irregular short fibres/scratches with periodic bilinear coverage."""
    field = np.zeros((SIZE, SIZE), dtype=np.float64)
    for _ in range(count):
        length = rng.uniform(*lengths)
        angle = rng.normal(0, 0.012) if directional else rng.uniform(0, 2 * np.pi)
        steps = max(3, int(length * 2))
        t = np.linspace(-0.5, 0.5, steps)
        curvature = rng.normal(0, 0.13 if directional else 0.9)
        bend = curvature * np.sin((t + 0.5) * np.pi)
        xx = rng.uniform(0, SIZE) + t * length * np.cos(angle) - bend * np.sin(angle)
        yy = rng.uniform(0, SIZE) + t * length * np.sin(angle) + bend * np.cos(angle)
        amplitude = rng.uniform(0.45, 1) * rng.choice((-1, 1))
        weight = (np.sin((t + 0.5) * np.pi) ** 0.7) * amplitude
        x0, y0 = np.floor(xx).astype(int), np.floor(yy).astype(int)
        dx, dy = xx - x0, yy - y0
        for ox, oy, blend in (
            (0, 0, (1 - dx) * (1 - dy)),
            (1, 0, dx * (1 - dy)),
            (0, 1, (1 - dx) * dy),
            (1, 1, dx * dy),
        ):
            np.add.at(field, ((y0 + oy) % SIZE, (x0 + ox) % SIZE), weight * blend)
    return normalized(blur(field, 0.52))


def paper(rng: np.random.Generator) -> np.ndarray:
    pulp = noise(rng, 2.1)
    fine = noise(rng, 0.6)
    fibres = strokes(rng, 4900, (2.5, 13.0))
    cloud = noise(rng, 29)
    height = 0.5 + 0.075 * pulp + 0.095 * fibres + 0.026 * fine + 0.018 * cloud
    rough = 0.5 + 0.105 * pulp - 0.085 * fibres + 0.065 * fine + 0.04 * cloud
    color = 0.5 + 0.10 * fibres + 0.07 * pulp + 0.06 * cloud
    return np.stack((height, rough, color), axis=-1)


def leather(rng: np.random.Generator) -> np.ndarray:
    yy, xx = np.indices((SIZE, SIZE), dtype=np.float64)
    xx = (xx + 9 * noise(rng, 6) + 5 * noise(rng, 17)) % SIZE
    yy = (yy + 9 * noise(rng, 6) + 5 * noise(rng, 17)) % SIZE
    first = np.full((SIZE, SIZE), np.inf)
    second = first.copy()
    # Random sites with a minimum spacing avoid both square grids and tiny dark
    # collapsed cells. Rounded crowns carry more relief than the joined creases.
    sites: list[np.ndarray] = []
    while len(sites) < 1050:
        candidate = rng.uniform(0, SIZE, size=2)
        if sites:
            delta = np.abs(np.asarray(sites) - candidate)
            if np.min(np.sum(np.minimum(delta, SIZE - delta) ** 2, axis=1)) < 6.8**2:
                continue
        sites.append(candidate)
    for px, py in sites:
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        distance = np.minimum(dx, SIZE - dx) ** 2 + np.minimum(dy, SIZE - dy) ** 2
        second = np.minimum(second, np.maximum(first, distance))
        first = np.minimum(first, distance)
    gap = np.sqrt(second) - np.sqrt(first)
    crease = normalized(blur(np.exp(-gap / 1.2), 1.1))
    crown = normalized(blur(np.exp(-first / (2 * 5.6**2)), 0.9))
    subgrain = noise(rng, 2.0)
    dome = 0.70 * crown - 0.22 * crease + 0.08 * subgrain
    pores = np.zeros_like(dome)
    positions = rng.integers(0, SIZE, size=(5300, 2))
    np.add.at(pores, (positions[:, 0], positions[:, 1]), rng.uniform(0.35, 1, len(positions)))
    pores = normalized(blur(pores, 0.58))
    fine = noise(rng, 0.6)
    broad = noise(rng, 22)
    height = 0.5 + 0.16 * dome - 0.027 * pores + 0.012 * fine
    rough = 0.5 - 0.10 * dome + 0.045 * pores + 0.05 * broad + 0.025 * fine
    color = 0.5 + 0.045 * dome - 0.020 * pores + 0.05 * broad
    return np.stack((height, rough, color), axis=-1)


def metal(rng: np.random.Generator) -> np.ndarray:
    # Brushing follows local texture U. The random field stays periodic in V.
    brushed = noise(rng, 38, 0.65)
    satin = noise(rng, 18, 1.8)
    scratches = strokes(rng, 560, (12, 92), directional=True)
    polish = noise(rng, 32)
    height = 0.5 + 0.037 * brushed + 0.026 * scratches + 0.012 * satin
    rough = 0.5 + 0.14 * brushed - 0.085 * scratches + 0.06 * polish
    color = 0.5 + 0.035 * satin + 0.03 * polish + 0.015 * scratches
    return np.stack((height, rough, color), axis=-1)


def encode(fields: np.ndarray) -> np.ndarray:
    rgb = np.rint(np.clip(fields, 0, 1) * 255).astype(np.uint8)
    return np.concatenate((rgb, np.full((SIZE, SIZE, 1), 255, np.uint8)), axis=-1)


def mip_chain(base: np.ndarray) -> list[np.ndarray]:
    """Area average linear bytes offline, including the final 1 by 1 level."""
    levels = [base]
    while levels[-1].shape[0] > 1:
        prior = levels[-1].astype(np.uint16)
        summed = prior[::2, ::2] + prior[1::2, ::2] + prior[::2, 1::2] + prior[1::2, 1::2]
        levels.append(((summed + 2) // 4).astype(np.uint8))
    return levels


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def seam_metrics(tile: np.ndarray) -> dict:
    metrics = {}
    for index, channel in enumerate(("height", "roughness", "albedo")):
        values = tile[:, :, index].astype(np.float64)
        dx, dy = np.abs(np.roll(values, -1, 1) - values), np.abs(np.roll(values, -1, 0) - values)
        metrics[channel] = {
            "horizontalSeamMeanStep": round(float(dx[:, -1].mean()), 4),
            "horizontalInteriorMeanStep": round(float(dx[:, :-1].mean()), 4),
            "verticalSeamMeanStep": round(float(dy[-1].mean()), 4),
            "verticalInteriorMeanStep": round(float(dy[:-1].mean()), 4),
            "min": int(values.min()),
            "max": int(values.max()),
            "mean": round(float(values.mean()), 4),
        }
    return metrics


def contact_sheet(tiles: list[np.ndarray], evidence: Path) -> None:
    """Inspection only: grayscale data channels, not a claim of runtime shading."""
    size = 256
    sheet = Image.new("RGB", (size * 4, size * 3 + 38 * 3), "#171719")
    draw = ImageDraw.Draw(sheet)
    for layer, (name, tile) in enumerate(zip(NAMES, tiles)):
        row = layer * (size + 38)
        for channel, label in enumerate(("Height", "Roughness", "Albedo")):
            image = Image.fromarray(tile[:, :, channel]).resize((size, size), Image.Resampling.LANCZOS)
            sheet.paste(image.convert("RGB"), (channel * size, row + 28))
            draw.text((channel * size + 10, row + 8), f"{name.title()} / {label}", fill="#e1d9c9")
        # A doubled repeat exposes seams at the centre of each diagnostic tile.
        tiled = np.tile(tile[:, :, 0], (2, 2))
        image = Image.fromarray(tiled).resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(image.convert("RGB"), (size * 3, row + 28))
        draw.text((size * 3 + 10, row + 8), f"{name.title()} / 2 x 2 repeat", fill="#e1d9c9")
    sheet.save(evidence / "surface-channel-contact-sheet.png")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--runtime-dir", type=Path)
    args = parser.parse_args()
    if not args.evidence_dir.is_absolute():
        parser.error("--evidence-dir must be absolute")
    runtime = args.runtime_dir or Path(__file__).resolve().parents[2] / "public/models/almanac/surfaces"
    runtime.mkdir(parents=True, exist_ok=True)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    tiles = [encode(build(np.random.default_rng(seed))) for build, seed in zip((paper, leather, metal), SEEDS)]
    chains = [mip_chain(tile) for tile in tiles]
    payload = b"".join(level.tobytes() for levels in chains for level in levels)
    header = struct.pack("<8s6I", MAGIC, SIZE, SIZE, len(NAMES), len(chains[0]), 4, len(payload))
    binary = header + payload
    filename = "almanac-surfaces-v1.bin"
    (runtime / filename).write_bytes(binary)
    offset = len(header)
    layer_info = []
    for index, (name, levels, description, seed) in enumerate(zip(NAMES, chains, DESCRIPTIONS, SEEDS)):
        mip_info = []
        for level, pixels in enumerate(levels):
            count = pixels.nbytes
            mip_info.append({"level": level, "width": pixels.shape[1], "height": pixels.shape[0], "offset": offset, "bytes": count})
            offset += count
        layer_info.append({"index": index, "name": name, "seed": seed, "description": description, "mips": mip_info})
        Image.fromarray(tiles[index]).save(args.evidence_dir / f"{name}-linear-data.png")
    manifest = {
        "schemaVersion": 1,
        "asset": filename,
        "sha256": sha256(binary),
        "bytes": len(binary),
        "payloadBytes": len(payload),
        "authoring": "Deterministic procedural authoring; no scans, photographs, AI image models or external assets.",
        "generator": "assets-source/almanac/build_surfaces.py",
        "generatorSha256": sha256(Path(__file__).read_bytes()),
        "generatorDependencies": {"numpy": np.__version__, "pillow": Image.__version__},
        "format": "LMSURF01 / 32-byte little-endian header / layer-major / mip-major / row-major tightly packed RGBA8",
        "colorSpace": "linear data; upload as rgba8unorm, never rgba8unorm-srgb",
        "width": SIZE,
        "height": SIZE,
        "layerCount": len(NAMES),
        "mipCount": len(chains[0]),
        "channels": {"r": "height centred on 0.5", "g": "roughness control centred on 0.5", "b": "albedo variation centred on 0.5", "a": "constant 255; reserved, not ambient occlusion"},
        "intendedRepeatPeriodMm": 48,
        "mipFilter": "2x2 arithmetic area average of linear uint8 channels with integer round-to-nearest",
        "addressMode": "repeat",
        "layers": layer_info,
    }
    (runtime / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    receipt = {"sha256": manifest["sha256"], "bytes": len(binary), "mipCount": len(chains[0]), "seams": {name: seam_metrics(tile) for name, tile in zip(NAMES, tiles)}}
    (args.evidence_dir / "surface-generation-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    contact_sheet(tiles, args.evidence_dir)
    print(json.dumps({"runtime": str(runtime), "bytes": len(binary), "sha256": manifest["sha256"]}))


if __name__ == "__main__":
    main()

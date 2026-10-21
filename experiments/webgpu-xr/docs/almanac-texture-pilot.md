# Almanac surface detail pass

The desktop book now has a dedicated linear surface-data path alongside its
authored Blender material factors and analytic studio lighting. This replaces
the earlier proposal for one shared image with three distinct authored layers:
rag paper, pebbled leather and polished brushed metal. Matched desktop/phone
captures, unchanged clay comparisons and real optional-resource recovery checks
passed on hardware WebGPU. Actual pointer orbit and wheel zoom also passed;
returning to the original camera produced identical pixels without resampling
the fractals or another texture upload. Sampled motion frames show no obvious
material artifacts. Continuous shimmer, user art acceptance and physical Quest
checks remain open.

The book geometry, exported palette, earned reliefs, world identity, music and
saved progress keep their existing contracts. The maps are separate resources;
they are not embedded textures inside the GLBs and do not modify the shared GLB
parser's material values. There is no environment-map or transmission pipeline.

## Authored surface data

The layers are deterministic procedural material fields, not scans, photographs,
Meshy textures or generated image-model output. See the
[asset source README](../assets-source/almanac/README.md#surface-detail-bundle)
for authoring, reproducibility, hashes, the exact binary layout and an isolated
packed Blender study.

| Layer      | Surface character                                               | Runtime scope         |
| ---------- | --------------------------------------------------------------- | --------------------- |
| 0: paper   | Short irregular fibres, fine pulp and restrained broad mottling | Black paper           |
| 1: leather | Rounded irregular pebbles, softened curved creases and pores    | Tobacco-black binding |
| 2: metal   | Fine directional brushing and sparse polishing scratches        | Gilding               |

Silver settings, bone ink and verdigris gems remain smooth. The material
signatures select the intended surfaces without making a generic promise to
texture every imported metal or dark material.

Each layer is 512 × 512 RGBA8, with ten offline mip levels down to 1 × 1.
`public/models/almanac/surfaces/almanac-surfaces-v1.bin` stores all three layers
in a single `LMSURF01` raw bundle. The runtime validates the fixed header and
length, then uploads the numeric bytes as `rgba8unorm`. There is no PNG decode,
browser image colour conversion or bitmap lifecycle. An sRGB format is incorrect
for these packed data channels.

| Channel | Meaning                                                                 |
| ------- | ----------------------------------------------------------------------- |
| R       | Height, centred on 0.5; derive a shallow surface normal                 |
| G       | Roughness control, centred on 0.5                                       |
| B       | Albedo variation, centred on 0.5                                        |
| A       | Constant 255, reserved; not ambient occlusion or unique contact shadows |

Mips use linear 2 × 2 area averaging with integer round-to-nearest. The binary
is **4,194,332 bytes**, including its 32-byte header. The three complete mip
chains contain **4,194,300 bytes, approximately 4 MiB**, of nominal GPU texel
storage. This excludes driver allocation overhead, sampler/bind-group objects
and temporary download memory. A repeating field cannot encode the unique
shadow beneath an individual star or melody setting.

## Mapping and shading

The texture repeat is **0.48 book authoring units**, giving about six repetitions
across the 2.8-unit spread. These units are not metres. It corresponds to a 48 mm
physical repeat only under the illustrative assumption that the full spread is
280 mm wide. A future headset scene must establish its own physical scale.

Book-local triplanar mapping avoids relying on the existing inspection UVs,
which are not a packed bake unwrap. Three explicit-gradient texture fetches
sample the selected material layer and blend the three projection axes. This is
three fetches, not nine across all materials. Linear mip filtering and requested
anisotropy of 8 support oblique views. Shallow height perturbations are bounded
and account for instance scale so detail stays attached to the book in both
the Almanac and Observatory views.

TypeGPU slots specialize the texture path for book passes. Other Observatory
meshes keep their prior shader and acquire no surface-texture binding. The old
sine-based paper, leather and burnish grain is excluded from the detailed book
path, avoiding two competing grain systems. The existing local gutter darkening
remains. Smooth book materials and clay evaluate derivative-safe sampling but
do not apply the texture perturbation.

Warm key, cool fill, rim light and analytic softbox reflections remain the light
sources. They are not image-based lighting. Roughness broadens their response;
paper and leather receive a restrained analytic reflection contribution. The
isolated Cycles material study uses different lighting and shading, so it is an
authoring reference rather than a runtime parity claim.

## Optional-resource lifecycle

Each renderer retains one array texture and sampler. A neutral 1 × 1 texel per
layer, `[128, 128, 128, 255]`, keeps the book usable while detail loads or fails.
The fallback's nominal texel payload is 12 bytes. Failed or malformed optional
data must not prevent the base book, earned pages, selection or music from working.

The retry path reloads the optional detail without changing progress or
resampling the live fractals. The Almanac uses its existing book retry, which
also reloads and uploads the base and relief geometry; it is not a texture-only
operation. Observatory asset retry skips already-ready geometry. A ready texture
does not upload again in either path. A successful texture upload replaces and destroys the
previous texture. Aborted, stale or invalid upload candidates are discarded;
unmount aborts pending fetches and destroys owned textures. Ordinary selection
does not reload a ready texture. Actual browser checks passed for injected HTTP
404 failures, both real retry buttons, ready-texture deduplication, reload and
disposal during a delayed fetch. The last case destroyed all four created
textures, with no late allocation. A forced-device-loss test was not repeated
for this phase.

## Review gates

Compare fixed-camera baseline and textured views at desktop and phone sizes,
then inspect normal distance, nearest allowed zoom and oblique angles. Keep
camera, lighting, exposure, saved state and framing matched. Check paper and
leather close up, directional metal response, smooth settings and gems, clay,
orbit/zoom mip transitions, stationary stability and transformed Observatory
placement. The raised stars, melody and live orbs must remain readable.

Exercise a missing or malformed bundle, visible retry, repeated scene entry,
unmount during a request and device loss. Record retained texture count and
nominal bytes alongside unchanged geometry/draw counts. Data integrity tests
and a Blender beauty render do not replace these browser checks. Desktop art
acceptance remains separate from physical Quest performance, stereo comfort
and tracked-hand use.

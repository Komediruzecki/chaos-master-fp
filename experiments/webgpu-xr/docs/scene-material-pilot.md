# Observatory and temple material study

This pass extends the linear surface-data path to the Observatory architecture
and the temple. It preserves the accepted Almanac finish, mesh silhouettes,
authored base colours, musical score, encounter rules and saved progress.
The authored data, final desktop material comparison, book preservation,
optional-resource recovery and complete journey regression are verified locally.
Actual hardware WebGPU browser evidence uses AMD RDNA 4; a short camera sample
also passes. User art acceptance, continuous-motion quality and physical Quest
acceptance remain separate gates. This is not a browser performance result.

## Authored fields and scope

The [asset source README](../assets-source/observatory/README.md#observatory-and-temple-surface-fields)
contains the exact pre-integration material inventory and reproduction command.
`build_surfaces.py` authors seeded periodic numeric fields using NumPy and
Pillow, with the unchanged Almanac authoring helpers. These are procedural
materials, not photographs, scans, Meshy textures or generated image-model
output. No external asset or new paid generation is required.

| Layer                 | Character                                                               | Applied material family                                          |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0: mineral stone      | Restrained curved mineral strata, grains and pores                      | Bay basalt; bridge/landing basalt and slate; temple STONE        |
| 1: worked dark finish | Fine polishing marks, shallow pores and quiet surface variation         | Bay charcoal inset                                               |
| 2: aged metal         | Fine directional machining, sparse scratches and tonal roughness patina | Bay bronze; bridge/landing brass; teal-bronze relic; temple GOLD |

Patina changes surface response and small tonal variation; it adds no green
tint or painted light. Silver, bone, enamel and temple EDGE/TEAL/PALE retain
their smooth material response. Glasswake's caldera and tone-star pass are out
of scope. The book uses its own unchanged paper/leather/gilding array.

The current `sceneSurfaceKind` classification uses authored metalness/roughness
and the rendered RGB after instance tinting. Metalness below 0.2 and roughness at least 0.5 identify
stone candidates. Metalness below 0.01 with roughness strictly between 0.7 and
0.76 selects the bay charcoal layer. Other dark candidates with red below 0.4
select stone, preserving the bright enamel. Metalness above 0.55 selects alloy
detail only when red minus green exceeds 0.025 or green minus red exceeds 0.05;
neutral silver stays smooth. Classification has been checked at the existing
temple reveal intensities 0.4, 0.48 and 1. These are narrow signatures for this
asset kit, not a general imported-material classifier.

## Data and resource contract

`public/models/observatory/surfaces/observatory-surfaces-v1.bin` is independent
of the book bundle but uses the same validated `LMSURF01` format. Its 32-byte
header is eight ASCII magic bytes followed by six little-endian uint32 values:
width 512, height 512, three layers, ten mips, four channels, and payload size
4,194,300. Payload order is layer-major, then mip-major from 512 to 1, then
tightly packed row-major RGBA8. The complete file is **4,194,332 bytes**.

| Channel | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| R       | Height centred on 0.5; shallow normal perturbation                |
| G       | Roughness variation centred on 0.5; add to the authored roughness |
| B       | Albedo variation centred on 0.5; modulate the authored colour     |
| A       | Constant 255, reserved; no AO or unique contact shadows           |

Upload directly as `rgba8unorm`, never `rgba8unorm-srgb`. Offline mips are
linear 2 × 2 averages with integer round-to-nearest. Runtime decoding does not
use the inspection PNGs, browser image colour conversion or bitmap objects.
The manifest records seeds, source/helper hashes, dependency versions, layer
descriptions and every mip offset and length.

Nominal texel storage is **4,194,300 bytes, approximately 4 MiB**, for the new
architecture array. The accepted book retains its independent array of the
same size. Together, the two ready arrays contain **8,388,600 bytes**, roughly
8 MiB. These figures exclude driver overhead, samplers, bind groups, temporary
download memory, geometry, render targets and live fractal buffers. An asset
file's byte count is not a measurement of GPU execution time.

The resource uses a neutral three-layer 1 × 1 fallback, retry after a failed
optional fetch, deduplicated loading of ready textures, atomic replacement and
destruction of superseded textures. An actual HTTP 404 left the base scene and
book ready; the real retry button loaded the scene texture, and further ready
retries did not reupload either array. Both ready arrays reported one texture,
one upload, ten mips and 4,194,300 texel bytes each. Disposal during a delayed
fetch destroyed all six tracked textures; the late response caused no new
allocation. The recovery run used AMD RDNA 4 WebGPU and reported no unexpected
browser errors. Malformed-bundle and forced-device-loss coverage should be
reported separately; this browser pass does not establish those cases.

## Mapping and calibration

Object-local triplanar mapping uses three explicit-gradient samples of the
selected layer. It reuses the filtered height/roughness/albedo calculation with
separate scene profiles; it does not sample all three layers at every point.
Smooth materials and clay evaluate derivatives consistently but do not apply
the perturbation. Material height changes shading, not geometry or collision.

| Profile     | Stone / dark / metal repeat | Stone / dark / metal height | Stone / dark / metal colour contrast | Roughness variation | Slope bound |
| ----------- | --------------------------- | --------------------------- | ------------------------------------ | ------------------: | ----------: |
| Observatory | 1.35 / 0.32 / 0.24          | 0.006 / 0.001 / 0.0008      | 2.00 / 0.50 / 0.45                   |                0.60 |        0.24 |
| Temple      | 1.40 / 0.32 / 0.24          | 0.005 / 0.001 / 0.0008      | 3.00 / 0.50 / 0.45                   |                0.65 |        0.22 |

The first runtime comparison found the fine-grain calibration too subtle at
normal viewing distance. This second calibration increases colour and roughness
variation, and increases the temple's mineral repeat from 0.85 to 1.4. Height
and slope bounds stay fixed. No texture regeneration or palette replacement is
involved. The manifest's recommendations record initial authoring suggestions;
this table and `sceneSurface.ts` describe the current runtime values.

These are artistic calibration values in each asset's existing local units.
The Observatory was authored in metre-oriented study units, but physical
headset scale has not been measured. The book's unrelated 0.48 authoring-unit
repeat is unchanged and must not be interpreted as 0.48 metres.

The roughness and colour fields are centred on 128/255 before their profile
scales are applied. Roughness is bounded to 0.08–0.98. Shallow height gradients
are bounded and instance-scale aware. The profiles give stone broader readable
structure while keeping dark finishing and metal machining fine. Existing
score-linked lighting remains responsible for the temple response. This pass
does not add environment-map reflections, transmission or baked contact AO.

## Authoring verification and remaining proof

The bundle hash is
`10f6550043b645ad0725b55aa78d3109075b86243425b1cd797e64e402401588`.
An independent second generation produces identical bytes. All 30 mip records
have the expected dimensions, contiguous offsets, exact area-average values
and constant alpha. Source and helper hashes match the manifest. Full-resolution
RGB means lie between 126.20 and 127.98. Mean wrap-edge gradients are between
0.982 and 1.015 times their corresponding interior mean gradients. Periodicity
comes from the fields; a cyclic translation chooses a representative repeat
origin without patching border pixels.

Final fixed-camera baseline and textured views cover desktop and phone sizes,
including the bay floor/rails, bridge, relic and temple, with material close
crops. A separate diagnostic hides only the temple ending overlay at its normal
fixed camera; ordinary journey images retain the UI. The stronger finish is
readable at the normal camera distance. Seven book comparison PNGs are
byte-identical to the preceding phase: desktop/mobile material and clay, paper
close-up, leather back and grazing metal. The book lifecycle checks also pass.

The complete journey passes onboarding, responsive/touch controls, Glasswake,
Tideweave, motif replay, earned pages, reload/replay persistence and
blocked/corrupt/future-storage fallbacks. Audio runs in real time, but commanded
notes do not establish singing accuracy or subjective listening quality.

The experiment suite passed 200
tests before final calibration; the final shader/profile/classifier checks also
passed. Scene-bundle integrity is established by the independent regeneration
and binary checks, not by claiming that the complete suite tests those asset
bytes. Final experiment typecheck, Vite build, root `pnpm check`, generated-index
check and diff check passed. Root lint reports 89 warnings and zero errors;
scoped experiment lint reports four complexity warnings and zero errors. The
readonly review found no remaining actionable correctness issues.

Matched clay captures preserve all overview pixels and the compared bridge and
temple architecture regions. The bridge comparison excludes the slightly
different sampled gameplay path; the temple excludes replay-button hover.
Architecture geometry, buffers and retained fractal samples remain unchanged.
Overview is still 13 draws / 630,074 triangles, and the temple 36 / 529,960.
The final bridge capture is 89 draws / 635,710 triangles versus 87 / 635,686 in
the baseline because its real keyboard trace produced two extra response beams,
12 triangles each. This is a state-dependent effect, not added architecture.
Controlled capture scheduling is not a frame-rate or GPU-time measurement.

The short overview-camera check uses actual keyboard orbit/zoom and three
captured samples. Projections change and reset exactly; texture count/uploads,
buffer bytes and fractal generations remain fixed. After reset, scene pixels
above Y=700 are identical; changed pixels are confined to Y=763–859 in the lower
UI band, with their cause unisolated. This sampled
check does not establish continuous shimmer quality. The temple intentionally
has a fixed camera, so no temple orbit/zoom claim is made.

Evidence is split by purpose. The final art run completed its captures and
tracing/ending playback, then its later recovery harness timed out because the
test clock was still paused. That raw failure remains recorded. A separate
clean recovery run proves the resource cases; book, full-journey and camera
runs also complete independently. Do not treat the partially failed art receipt
as a clean all-in-one pass.

The phase commit contains the implementation and reproducible source. Its
remote publication is recorded separately in local planning document 38.
User art acceptance, hosted CI, physical Quest stereo/hand use, sustained
headset performance and a continuous-motion visual review remain open. Forced
device loss was not rerun in this phase.

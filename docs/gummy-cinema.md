# Gummy chess shot studio

Open `/gummy?view=cinema`. The existing board and material workbench remain at
`/gummy?view=board` and `/gummy`.

## Art direction

The **Sculpted candy** option adds compact two-ring bases, narrower stems,
rounded collars, a fuller knight cheek and muzzle, a scalloped mane, and more
readable queen and king tops. **Original moulds** preserves the previous shapes.
The sculpted fields remain connected at the supported particle resolutions.

The new lighting uses a broad warm reflection card, a narrow cool rim, and a
soft top reflection. Thickness-dependent absorption and rest-space colour remain
active after deformation. The cards are an artistic environment approximation;
they do not trace reflections of the other pieces. Piece refraction is screen-space.
Glass and lava are procedural board finishes over a solid, beveled board, with
a flat playing surface for the simulation. They are not separate physics types.

Concept images live in `assets/references/gummy-cinema/`. They are generated
references, not screenshots or claims about the real-time renderer.

Research informing the pass:

- [Filament materials](https://google.github.io/filament/Materials.md.html):
  separate absorption, surface gloss and dielectric reflection.
- [PBRT dielectric BSDF](https://www.pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF):
  preserve the Fresnel reflection/transmission split.
- [PBRT transmittance](https://www.pbr-book.org/4ed/Volume_Scattering/Transmittance):
  keep colour dependent on travel through the material.
- [PBRT area lights](https://www.pbr-book.org/4ed/Light_Sources/Area_Lights):
  use broad highlights to describe curvature. The reflection-card implementation
  here approximates that appearance rather than full area-light transport.

## V2 material and motion pass

V2 shot recipes expose `motion.shearOnset`, `motion.shearDistance` and
`motion.contactHold`. The first two place and size the lateral shearing motion;
`contactHold` allows a 0–0.6-second pause at half descent. These are explicit shot
settings. The visible **Press and peel** choice uses onset `0.35`, travel `1.1`
local piece units and a `0.35`-second hold. Travel scales with the piece, and the
attacker returns to the captured square. **Original motion** restores onset `1`,
travel `0.18` and no hold. The three built-in shots still start with original
motion; choosing Press and peel does not change their material settings.

The selected v2 recipes are in `assets/local/gummy-cinema/v2/recipes/`:

| Recipe                | Motion         | Material                                       |
| --------------------- | -------------- | ---------------------------------------------- |
| `pawn-knight-v2.json` | Press and peel | Mid, with fragility raised from `0.5` to `0.7` |
| `bishop-rook-v2.json` | Press and peel | Unchanged RockGummy                            |
| `queen-rook-v2.json`  | Press and peel | Unchanged High                                 |

The pawn recipe retains Mid's softness, flow and viscosity. Its fragility change
lowers the warm damage onset from stretch `1.220` to `1.188`, and the yielding
threshold from `1.120` to `1.104`. It does not rewrite the saved Mid preset.
Version 1 imports receive original motion; version 2 requires explicit validated
motion. Older two-control v2 recipes receive a zero hold.

The motion comparison showed readable asymmetric stretching and smearing before
final flattening. Moving the original short sweep earlier had little visible
effect; the longer sweep and mid-press hold let the upper body move sideways
while the victim retained height. The hold splits the descent into two eased
halves, so it also changes the approach to the midpoint. This remains prescribed
motion with unilateral frictional contact, not an adhesive pulling model. The
surface is reconstructed from discrete particles; damage alone does not create
a visible opening, and the captures do not establish physical fracture accuracy.

The glass board now computes analytic entry and exit refraction through its
thickness. A separate cached pass projects board-transmitted light onto the
floor. This board-to-floor projection is distinct from the piece caustics,
which still use a single-interface approximation. These changes do not turn
the renderer into a full scene path tracer or change the board's collision
surface. The lava finish uses a sparse cellular pattern for separated hot regions.

The chosen recipes passed three hardware WebGPU diagnostic captures at
1280×720 on the AMD RDNA 4 adapter (`fallback: false`). Their manifests are in
`assets/local/gummy-cinema/v2/diagnostics/{shot}-v2/capture.json`, with exact
recipes, stills and particle snapshots alongside them. All three report finite
end state, no surface overflow, no dropped vertices and no errors or warnings.

| Diagnostic       | Particles | Final surface vertices | Guard activations | Domain contacts |
| ---------------- | --------: | ---------------------: | ----------------: | --------------: |
| `pawn-knight-v2` |     2,936 |                129,432 |             6,787 |          51,697 |
| `bishop-rook-v2` |     3,132 |                167,808 |             2,228 |          65,842 |
| `queen-rook-v2`  |     3,132 |                122,340 |             1,827 |          52,320 |

The nonzero guard and domain-contact counts remain diagnostic limitations;
passing finite-state and capacity checks does not make the simulation exact.
These still-based runs validate the chosen motion and material settings. The six
final native video takes and all four assembled exports have also passed the
checks described below. Sampled opening and ending captions passed visual
review; human audio audition remains pending. V1 results below remain the
completed earlier reference set.

## Stage and reuse a shot

1. Pick a capture. The three presets are independent composed chess positions,
   not a historical match or a consecutive game.
2. Choose a piece design, board finish, attacker/victim colours, camera, material,
   size and quality. Choose **Original motion** or **Press and peel**, then open
   **Crush and shear** to adjust onset, travel and the mid-press hold. Changes stay
   in the draft until **Apply shot settings**.
3. Use **Position and move** for a custom FEN and source/target square. The tool
   checks move geometry, clear sliding paths, side to move and king safety.
   Capturing a king, castling, en passant and promotion are not supported.
4. Apply an existing saved material or import the material JSON from the workbench.
   The built-in RockGummy preset preserves the user's supplied settings.
5. **Share this shot** exports the full position, material, colours and camera as
   versioned JSON. Loading malformed JSON leaves the existing shot playable.

Only the captured piece runs MPM. Other pieces share cached meshes; the attacker
is a prescribed collision shape sampled from the same mould. It stays on the
captured square after impact. This is a directed capture showcase, not a full
rigid/soft-body simulation of every piece on the board.

## Playback and capture

Shots last eight display seconds and six simulation seconds. Physics uses fixed
1/120-second steps, with a smooth slowdown around contact. Scrubbing backwards
resets and rebuilds the same trajectory. Camera framing fits the two actors in
both landscape and portrait; it does not crop the landscape image for shorts.

The sidebar **Record** control records the live canvas at its current pixel size.
**High** requests 60 fps with a size-dependent bitrate; **Standard** requests
30 fps. Actual frame rate depends on the browser and rendering speed. The
controls show capture dimensions, the requested frame rate and the bitrate
reported by the encoder. A larger bitrate does not enlarge the source canvas.

**Export full-quality MP4** renders the entire applied shot frame by frame at
720p, 1080p or 4K, at 30 or 60 fps. It uses native canvas resolution and fixed
simulation timestamps, independently of live playback speed. It preserves the
applied render quality and supports landscape and portrait framing. The resulting
H.264 file is compressed, not mathematically lossless. Both recording methods
capture picture only; sound and captions are assembled separately below.

Export locks shot changes until completion, supports cancellation, and restores
the preview size and time afterwards. Leaving the tab cancels the export. A
failed or cancelled export preserves the previous successful download. This
path requires WebCodecs AVC support; the app does not silently substitute a
real-time recorder for a fixed-frame export. Smaller sizes and 30 fps are
available for devices with tighter memory or encoding limits.

The sidebar sections collapse independently. Their state survives hiding the
controls or applying a shot. **Share this shot** has a corner Copy button with
clipboard feedback and selected-text fallback if clipboard access is blocked.

For repeatable promotional
captures, use `packages/app/scripts/capture-gummy-cinema.mjs --help` against the
dev server. It exposes a development-only frame API, awaits GPU completion,
encodes using WebCodecs timestamps, validates finite particle state and surface
capacity, and verifies MP4 dimensions, duration and frame count with FFprobe.
GPU floating-point results can still differ between adapters.

On this workstation, wrap capture with
`/home/maff/.dotfiles/personal/video-kit/scripts/gpu-guard`. Run one GPU capture at
a time, freeze source files during a take to avoid HMR replacing the scene, and
keep its browser on the hidden `special:agents` workspace with class
`agent-browser`. The script closes only its own browser.

For the selected pawn take, run from the repository root with the dev server
already listening on port 5199:

```bash
rtk proxy /home/maff/.dotfiles/personal/video-kit/scripts/gpu-guard \
  --max-seconds 300 -- \
  node packages/app/scripts/capture-gummy-cinema.mjs \
  --url https://localhost:5199/gummy \
  --shot pawn-knight \
  --config assets/local/gummy-cinema/v2/recipes/pawn-knight-v2.json \
  --width 1920 --height 1080 --fps 60 --timeout 240 \
  --out assets/local/gummy-cinema/v2/final-takes/pawn-knight-landscape
```

Use 1080×1920 for the portrait take and the matching shot ID and recipe for the
other captures. The six selected take folders belong under
`assets/local/gummy-cinema/v2/final-takes/`. If that output folder already exists,
choose a new take directory; the driver refuses to overwrite it.

Every take saves a recipe and capture manifest alongside the video or stills.
Use a new output directory per take. Large local captures and edit projects live
under ignored `assets/local/gummy-cinema/`; the reusable driver and app source
are tracked. No social media upload is performed.

The first review set is in `assets/local/gummy-cinema/final-takes-v1/`: three
landscape and three independently framed portrait takes. Each native take is
eight seconds, 480 frames at 60 fps, with its exact material and shot recipe.
All six passed hardware WebGPU capture, finite particle-state and surface-capacity
checks. Phone and tablet layouts were checked with touch emulation; this new
studio has not yet been tested on a physical iOS device.

The v2 final capture set is in `assets/local/gummy-cinema/v2/final-takes/`, with
the same three landscape and three independently framed portrait takes. All six
manifests report a hardware adapter, finite state, no surface overflow or dropped
vertices, and no errors or warnings. FFprobe confirms H.264, eight seconds and
480 frames at 60 fps for each take, at 1920×1080 landscape or 1080×1920 portrait.

The CPU frame review sampled 2, 5.2, 5.6 and 7.5 seconds from each native video.
The active pieces remain within the frame, and each final sampled pose shows the
attacker over the capture square. Pawn and bishop show off-axis deformation
before flattening; the queen's deformation is subtler at 5.2 seconds and has an
asymmetric collapse by 5.6 seconds. The portrait frames crop some far debris at
the sides near the end, while preserving the attacker and central residue.
Settled debris still has visible discrete-particle edges. This is a sampled
visual review, not proof of continuity at every intervening frame.

Native PNG frames, contact sheets and `manifest-checks.json` are saved under
`assets/local/gummy-cinema/v2/final-qa/`. Separate assembly and caption checks
are recorded under `v2/delivery/` and `v2/mix-qa/`, as described below.

## Audio sources and edit assembly

The v2 audio set is local and ignored by Git at
`assets/local/gummy-cinema/audio-v2/`. ElevenLabs generated six independent sound
effects with `eleven_text_to_sound_v2` and one 28-second ambient bed with
`music_v1` and `force_instrumental: true`. The prompts request sticky gummy
contact, elastic stretch, soft peeling tears, compression, small gel drops and
settling. The music prompt requests sparse warm pads and felt piano, without
vocals, drums or a beat.

| Editing stem            | Source length |
| ----------------------- | ------------: |
| `sticky-contact.wav`    |     2 seconds |
| `elastic-stretch.wav`   |     6 seconds |
| `soft-peeling-tear.wav` |     4 seconds |
| `gummy-compression.wav` |     3 seconds |
| `tiny-soft-drops.wav`   |     4 seconds |
| `gel-settling.wav`      |     4 seconds |
| `warm-ambient.wav`      |    28 seconds |

Keep the original MP3 downloads and their `.request.json` / `.response.json`
records. They contain exact prompts, model settings, timestamps and selected
response metadata. The six successful SFX requests reported a combined
`character-cost` of 253; the music endpoint did not return a cost, and remaining
balance was unavailable. No dollar estimate is asserted. The existing Proton
Pass flow resolved the API credential without saving the secret in the assets.
Each successful generation was submitted once, with no paid retries.

The WAV editing copies are 48 kHz stereo, 24-bit PCM decoded from the downloaded
MP3s. All six SFX copies have 6 dB attenuation for mixing headroom; the music copy
retains its generated level. This conversion does not restore information lost
by MP3 encoding. `validation.json` records durations, levels, strongest-transient
positions, activity windows and clipping checks. Waveform PNGs are also retained.
The original stereo files and the editing copies stayed below full scale.

Audio decoding, levels and representative waveforms were checked. This agent
runtime cannot listen to audio, so semantic audition is still required. Prompt
wording is not proof that a take contains the intended material sound or lacks
unwanted noise. `force_instrumental` was requested for music; a listening review
has not been claimed for any stem or final mix.

Use `packages/app/scripts/mix-gummy-cinema.mjs` once the six approved captures
exist. Its `--takes` directory must contain the following folders, each with a
`capture.mp4`: `pawn-knight-landscape`, `bishop-rook-landscape`,
`queen-rook-landscape`, `pawn-knight-portrait`, `bishop-rook-portrait`, and
`queen-rook-portrait`. Each input needs at least eight seconds and 480 frames at
60 fps. The assembler accepts 1920×1080 or 3840×2160 landscape and
1080×1920 or 2160×3840 portrait. It downsamples 4K sources with Lanczos
in the same pass as the caption overlays and final encoding. Portrait
inputs are independently framed native captures, not crops of the landscape.

From the repository root after all six `v2/final-takes` are ready, use the selected
v2 cue overrides:

```bash
rtk proxy timeout 3600s node packages/app/scripts/mix-gummy-cinema.mjs \
  --takes assets/local/gummy-cinema/v2/final-takes \
  --audio assets/local/gummy-cinema/audio-v2 \
  --cues assets/local/gummy-cinema/v2/cues.json \
  --out assets/local/gummy-cinema/v2/delivery
```

Always choose a new `--out` directory. The assembler refuses an existing
directory, leaves raw captures untouched, and retains a separate 48 kHz stereo
WAV mix for every film. The outputs are one 24-second landscape promo and three
8-second vertical clips, encoded as H.264, YUV420P, 60 fps, with stereo AAC audio.
It trims each source to eight seconds without changing playback speed. Each
FFmpeg render has its own 15-minute deadline.

The v2 opening captions name each capture: “Pawn takes knight”, “Bishop takes rook” and
“Queen takes rook”. They fade away after 1.6 seconds. A “Gummy chess” / “Lumen
Apeiron” card in that version occupies the last 1.5 seconds of each output. The assembler copies
the existing static Outfit Medium font and its available OFL licence into the
new edit directory, so filter paths do not depend on installed system fonts.

The selected `v2/cues.json` aligns the strongest measured source transient to
the following times within each eight-second shot. A short part of each effect
may begin before that peak. These overrides follow the reviewed v2 motion;
picture/sound review is still required. The assembler's defaults differ, so pass
the cue file explicitly.

| Cue           | Transient time | Gain relative to editing WAV |
| ------------- | -------------: | ---------------------------: |
| `contact`     |    3.5 seconds |                         0 dB |
| `stretch`     |   4.15 seconds |                        −4 dB |
| `tear`        |    5.2 seconds |                         0 dB |
| `compression` |   5.55 seconds |                        +4 dB |
| `drops`       |    5.9 seconds |                        −3 dB |
| `settle`      |    6.8 seconds |                        +4 dB |

The music starts at −14 dB relative to its editing WAV, beneath the foley. The
mixer disables automatic gain normalization and limiter makeup gain. A limiter
provides headroom protection; it is not a loudness boost or a substitute for
listening. Individual effect tails are kept inside their shot boundaries.

Pass `--cues path/to/cues.json` to override a shot's event `time`, `volumeDb` or
`enabled` value and optionally the music level. Omitted settings keep their
defaults. For example:

```json
{
  "music": { "volumeDb": -16 },
  "shots": {
    "pawn-knight": {
      "contact": { "time": 3.7 },
      "tear": { "time": 4.65, "volumeDb": -2 },
      "drops": { "enabled": false }
    }
  }
}
```

Every run saves resolved cues, source trim and placement data, exact process
arguments, FFmpeg filter graphs and logs, FFprobe results, and input loudness
measurements for the WAV and AAC outputs. The checks require the expected frame
count, duration, resolution and codecs, finite loudness from −48 to −16 LUFS,
and a true peak no higher than −1 dBTP. These broad technical limits catch silence
or excessive levels; they do not certify the foley/music balance. Review the
films, effects and captions together before treating a v2 export as finished.

The mixer has focused Node tests for cue placement, timing bounds, input/output
metadata checks, loudness parsing and preservation of existing output files.
Those tests and syntax checks have passed. The capture guard and mixer suites
also passed all 17 Node tests after the final captures closed.

The completed v2 assembly is in `assets/local/gummy-cinema/v2/delivery/`.
`assembly.json` reports all four exports passed, with matching video and audio
durations. Each film has H.264 YUV420P video at 60 fps and 48 kHz stereo AAC;
the separate 24-bit PCM WAV mixes remain available for reuse.

| Export                             | Dimensions | Duration / frames  | Integrated loudness |  True peak |
| ---------------------------------- | ---------- | ------------------ | ------------------: | ---------: |
| `gummy-chess-promo-1080p60.mp4`    | 1920×1080  | 24 seconds / 1,440 |         −30.97 LUFS | −9.12 dBTP |
| `pawn-knight-vertical-1080p60.mp4` | 1080×1920  | 8 seconds / 480    |         −30.27 LUFS | −9.17 dBTP |
| `bishop-rook-vertical-1080p60.mp4` | 1080×1920  | 8 seconds / 480    |         −30.27 LUFS | −9.17 dBTP |
| `queen-rook-vertical-1080p60.mp4`  | 1080×1920  | 8 seconds / 480    |         −30.27 LUFS | −9.17 dBTP |

Caption review sampled each export at 0.7 seconds and at its ending card:
7.4 seconds for the vertical clips and 23.4 seconds for the promo. All eight
frames have legible text, no clipped captions and no caption overlap with the
main pieces. The original PNGs, exact extraction arguments and review record
are in `assets/local/gummy-cinema/v2/mix-qa/`. This confirms the sampled caption
frames, not every frame of the edit.

Human audio audition remains pending for the stems and all four final mixes.
Technical level checks and transient placement do not establish sound character,
perceptual synchronization or the balance between foley and music.

## Cinematic choices

The camera stays on one side of the movement axis to preserve screen direction.
Each take includes anticipation, contact and a settling hold; editing should not
cut away before the material response is readable. Each board receives one
continuous take, with a short opening caption and a quiet closing label.

These choices follow the practical framing principles in
[Epic's camera movement and framing guide](https://dev.epicgames.com/documentation/en-us/fortnite/making-cinematics-3-camera-movement-and-framing-in-unreal-editor-for-fortnite)
and the planning structure in [Adobe's shot-list guide](https://www.adobe.com/uk/creativecloud/video/discover/shot-list.html).

## V3 recording quality and selected soundtrack

The user selected **02 dense candy** for compression and **06 soft jelly peel**
for the tear from the new ElevenLabs comparison. Those editing stems are used
without changing their relative gain; the other five sources remain unchanged.
`assets/local/gummy-cinema/v3/audio-selected/` preserves source selection,
cue timing, quiet mixes, and separate posting mixes raised uniformly by 6 dB.
The latter retain over 3 dB measured true-peak headroom. No extra dynamics
processing was added for that gain change. The agent did not perform a listening
review; the candidate selection came from the user.

Six new native takes in `v3/final-takes/` use explicit High quality and 4K at
60 fps, with independent portrait framing. Each contains 480 frames across eight
seconds. All six hardware captures passed finite-state, surface-capacity,
codec, timing and frame-count checks, without GPU errors or warnings.
The selected v2 motion and material recipes are preserved in the v3 copies.

The current assembler uses unboxed two-line labels: the capture name and source
to destination squares. Opening labels clear by 1.9 seconds, leaving contact
and deformation unobstructed. The final identity appears at seven seconds
(23 seconds in the combined film). Landscape type is 64/42 px after review at
360 px display width; portrait remains 50/30 px with larger top safe space.
The sources are independent composed positions, not consecutive moves in one
game. Final delivery uses CRF 17 H.264 and retains the 4K sources separately.

The studio's full-resolution export was verified at 1920×1080/60 fps,
3840×2160/30 fps and 1080×1920/60 fps, including cancellation and preview
restoration. The native driver above also captured all six 4K/60 fps takes.
A desktop live recording decoded at the original 1120×900 canvas dimensions,
with 332 frames across 6.9153 seconds. This verifies capture and download, not
a promise of 60 fps on every device. Hardware browser checks used the hidden
agent workspace; no physical iOS export test was performed. Evidence is in
`assets/local/gummy-cinema/export-quality-v3/README.md`.

The finished files are in `assets/local/gummy-cinema/v3/posting/`:
`gummy-chess-promo-v3.mp4` (24 seconds, landscape) and
`pawn-knight-vertical-v3.mp4`, `bishop-rook-vertical-v3.mp4`,
`queen-rook-vertical-v3.mp4` (eight seconds each, portrait). These 1080p60
files use the selected posting soundtrack. `x-compatible/` contains 30 fps
copies rendered directly from the native takes. `delivery/` retains the quieter
intermediate mixes, so use `posting/` for sharing.

All eight posting files passed complete CPU audio/video decoding and an AAC
packet comparison with the approved posting mixes; the gain is applied once.
`posting/final-integrity.json` records file hashes and results. Final visual
review checked 24 native capture frames and 14 caption frames at native and
360 px phone sizes. No sampled framing or caption blockers were found; the
existing fine debris can look bead-like, and portrait framing crops some outer
debris after impact. This review does not certify X upload or recompression.
The posting files have not been uploaded to X.

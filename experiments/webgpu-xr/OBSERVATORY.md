# Irchiinnuss observatory

The `/observatory` route joins the Blender Almanac to a small authored place,
two retained WebGPU fractal worlds, a guided melody trace and a Glasswake
resonance encounter, with a shared saved Almanac.
This is a desktop study. It does not enter WebXR or replace the original XR lab.

## Run and inspect

```sh
rtk proxy timeout 10800 pnpm --dir /home/maff/.codex/worktrees/orb-specimen-bench/chaos-master-fp/experiments/webgpu-xr dev --host 0.0.0.0 --port 5192 --strictPort
```

Open <https://127.0.0.1:5192/observatory>. Trust the local development certificate
if prompted. The strict port fails if occupied. The server expires after three
hours; Ctrl+C stops an interactive run.

1. On a first visit, try the optional pitch ribbon or hear a reference note.
   Choose either world, or skip the introduction. Guide opens it again.
   Sound starts only through an explicit action.
2. Drag the view, scroll closer, or focus the canvas and use arrow keys and +/-.
   Choose Glasswake or Tideweave through the controls or their visible bounds.
3. Hear the world's motif. Playback needs a gesture; selecting another world
   stops it. Volume affects output. Pause motion holds the automatic scene.
4. Inspect the orb, then widen the view. Almanac opens the collected pages over
   the live scene; Open the book leads to the separate Blender book route.
5. Choose Tideweave and Trace a melody. Hear D–F–B–A, then drag through the four
   visible notes in order. Height plays a continuous pitch; each reached note gets
   a short accent. Lift to pause; resume from the last earned note. Mute trace
   leaves the guide and judging available. The main volume also affects tracing.
6. Keyboard alternative: choose Use keyboard, Enter to hold, arrow keys to move
   the tracer (two arrows can move diagonally), Enter to lift. The same judge
   evaluates both inputs. Escape returns.
7. Choose Glasswake and Wake the glass. Hear C4, drag vertically to its line,
   hold until the seal resonates, then release to shatter it. Continue with E4
   and G4. Early release lets you retry; it never removes an opened seal.
   Keyboard: Up/Down tune by a quarter-semitone, Enter holds/releases;
   Home/End select the bottom/top of the octave. Escape returns.
8. Glasswake keeps partial released seals when you return to the worlds during
   this visit. Rebuild seals starts again. Mute instrument silences held notes and
   fracture cues; Hear note remains an explicit reference audition. Volume
   affects all sound. Pause motion opens seals immediately without flying shards.
   Three small crystal stars remain at the opened seals. Their light grows after
   each release, while the surrounding obsidian caldera warms with progress.
9. Completing either encounter immediately earns its page. Open earned page
   replays the motif or leads to the other world. Once earned, Play again starts
   a fresh attempt without removing the page. A reload restores completed pages
   and last selection; sound stays stopped.
10. Once both pages are earned, choose Open temple signal in the world controls
    or Almanac. Listen together plays an original 27-second passage: Glasswake
    calls, Tideweave answers, then glass and reed meet at the temple threshold.
    Stop ending silences it immediately and holds the formation. Replay ending
    starts from the first note. Return to worlds or Escape leaves the scene.

The visible guide is intentional. This is practice following a melodic contour,
not a singing, pitch-recognition or rhythm assessment. There is no penalty for
retrying. Partial holds/notes remain local to the visit; only completed pages,
discoveries, last selection and the introduction preference are saved. The five
other constellations are proposed destinations.

## Optional world soundscapes

An opt-in desktop ambience layer passes development and emitted-build browser
soundscape checks.
Its [soundscape contract](docs/world-soundscapes.md) records Glasswake's C-Ionian
glass/chamber identity, Tideweave's D-Dorian reeds/current, explicit enable/mute
controls and a separate environmental bus inside the existing shared audio
context. Foreground teaching notes remain distinct from background sound;
entering the temple clears ambience. All 246 experiment tests and the focused
76-test audio suite pass, alongside the repository check, final experiment
typecheck and scoped lint. Real controls, master volume, analyser isolation,
bounded sources and narrow layouts have desktop proof. The linked document
records the measurements and passing connected journey/temple regressions.
It does not establish Quest spatial audio or subjective listening acceptance.

## Saved journey

`journey/progress.ts` owns a bounded, versioned localStorage record under
`lumen-observatory-journey`. Each earned page records its world, recipe, seed,
palette, motif and completed activity version. The saved activity means either
three seals opened or four notes traced; it is not a singing score. The
component-owned `useJourney` hook supplies both routes and imports storage
updates without restarting audio or changing the active encounter.

Storage errors keep the current visit playable and show a temporary-progress
notice. Invalid or unsupported-version saves are preserved without overwriting
them. The store merges previously saved awards before writing, preventing an
ordinary stale tab from removing another tab's page. Simultaneous localStorage
writes are not atomic. There is no account sync, export, device transfer or
automatic migration from an unknown schema.

The save belongs to this browser and origin (scheme, hostname and port).
`localhost:5192` and `127.0.0.1:5192` have different storage. Clearing site data
removes progress. Use the same address for a continuous visit.

## Two-world ending

Both earned pages make the ending available, including pages restored from
this browser's saved Almanac. Opening it does not start audio. The ending is a
transient performance, with no extra ownership flag or save migration. Reload
returns to the selected world with the pages intact and sound stopped.

`journey/templeScore.ts` contains the original 26.68-second arrangement at 72 BPM.
It preserves the complete pitches and rhythm of each world's original motif,
then uses controlled overlapping glass and reed voices and a D/A cadence. This
is an authored score built from the established motifs, not a generative remix
of altered localStorage data. The saved page motifs remain unchanged.
`MotifAudio.playArrangement()` uses the same context, output volume and
cancellation as the encounters. Audio-clock progress drives section cues and
the reveal; rendering speed cannot finish the music early.

The existing renderer adds a procedural stepped threshold, paired pointed
arches, radial gold and branching teal marks, seven crown marks and a shared
seal between the retained fractal worlds. The framing is stationary. Motion
off presents the architecture in place, with musical color cues and a final
lit seal. Its light grows through the cadence and reaches full strength at the
completed passage. This is a temple teaser;
there is no third playable region or forced camera travel.

The temple has real chamfers on 29 stone beams, derivative-filtered mineral
grain and veins, and directional highlights on gold and teal inlays. Its two
lights rise with the authored musical sections. A bounded world-space veil
behind the arch adds curved light curtains, an aureole and a narrow final shaft.
It shares the existing HDR/depth pass: one extra draw, two triangles and 32 bytes
of atmosphere uniforms. Temple lighting adds one shared 16-byte uniform.
The architecture and connections total 2,884 triangles and 418,608 mesh bytes.
This is analytic lighting and atmosphere, without texture maps, shadow maps,
physical volumetric scattering or another GPU owner. Clay mode omits the veil.
Stop freezes the light envelope and veil; motion-off fixes its drift while
musical color cues remain available.

Stop holds the partial formation while ordinary idle orb motion follows the
motion setting. Replay resets the passage. Opening Guide, the Almanac or atlas,
leaving the view, hiding the tab, a lost GPU or disposal cancels playback and any
pending audio start. Returning never restarts it automatically.

## Render and asset contract

- One device, HDR/depth pass and camera own the complete scene.
- Two 131,072-point buffers are constructed once from bounded recipes and seed 73129. Motion transforms/deforms retained samples; it does not resample them.
- Glasswake preserves Aureole's coordinates, with an ivory/amber palette and
  six faceted spires in a broken corona. Tideweave bends the original Thicket
  samples into five curling fronds around an ovoid, with teal/cobalt currents.
  This is an authored deformation of retained samples, not a new fractal equation.
- `almanac/worldIdentity.ts` shares core composition and palette between the
  Almanac and observatory. The raw specimen bench keeps its original presentation.
  Scene-specific framing differs: the book retains its smaller orbital mounts.
- `observatory/worldOrnaments.ts` builds one merged opaque ornament mesh per
  world. These are real faceted surfaces, not transparent/refractive glass.
  Bridge pieces remain repeated static draws, not GPU-instanced geometry.
- A shared 180 ms departure and 460 ms arrival threshold masks deliberate
  scene cuts, followed by a bounded 3.5% destination-camera settle. Instrument
  input waits for arrival; motion pause, reduced motion, window blur and hidden state settle
  the latest destination. No long flights, walking, collision, book page turning
  or animated docking is implemented. See [scene passages](docs/journey-passages.md)
  for the implementation contract and current verification status.
- Sky directions derive from the camera inverse matrix. Stars are not a
  screen-fixed image.
- Opaque meshes write shared depth; point sprites test it. Point-centre depth
  is an approximation, with no volumetric self-occlusion or dynamic shadows.
- Imported GLBs support opaque material factors: no texture maps, skins,
  morphs, skeletal animation or general PBR/IBL claims.
- Glasswake adds its own translucent pass: three curved petals, 48 closed
  triangular-prism shards, 384 solid triangles and 59,904 GPU buffer bytes.
  Geometry uploads once. Per-shard depth sorting, Fresnel highlights and
  premultiplied alpha approximate glass; there is no physical refraction.
  A release adds a bounded 1.4-second tumble/fade and delayed glints, at most
  two draws and 480 triangles. Reduced motion skips this movement.
- The Glasswake caldera is an authored opaque Blender island: 6,836 triangles,
  real beveled hexagonal columns, three listener slabs and a recessed porcelain
  sounding flower. Its analytic material uses one shared 16-byte uniform for
  progress-linked warmth; cool grazing light keeps the dark silhouette readable.
  The separate 48-triangle crystal is drawn at three fixed petal anchors.
  Opening seals changes light, not their position. The fade follows the existing
  encounter clock; reduced motion settles it immediately. These additions use
  the existing depth pass, without textures, shadows, physical refraction or
  further fractal sampling. Missing models leave the old landing playable and
  can be retried without resetting progress.

Editable Blender files and reproducible scripts are in
[`assets-source/observatory`](assets-source/observatory/README.md).
The three authored GLBs are observation bay (16,390 triangles), bridge section
(352), and far landing (3,580). The reused book has 66,332 triangles.
The caldera and crystal add two authored GLBs; their source/export hashes,
material factors, bounds and anchors are recorded in
[`glasswake-chamber.manifest.json`](public/models/observatory/glasswake-chamber.manifest.json).
The Meshy seed donor was reduced from 100,666 to 14,000 triangles in Blender.
Its original geometry is retained in the editable source; runtime metadata,
hashes and provider task are in
[`celestial-seed.manifest.json`](public/models/observatory/celestial-seed.manifest.json).
One preview cost 20 credits; no paid texture/refinement stage was used.

The scene uses one `MotifAudio` owner for auditions, live instruments, the
Glasswake fracture cue and optional ambience. Starting another foreground
activity replaces the previous foreground instrument; an enabled background
bed remains and ducks beneath it. Pointer and keyboard feed the same
ordered judge and vertical pitch map. An earned note receives an accent only
when progress advances; lifting, invalid movement, blur, hidden state, reset,
leaving and disposal stop the instrument. A pending audio unlock cannot start
a tone after cancellation. The trace has no microphone, pitch detector or
spatial audio. Motion pause and reduced motion freeze
world transforms and deformation, while instructional note color can still
follow playback. A hidden tab stops audio and cancels an active trace.
Returning requires deliberate playback. Failed models can be retried; a lost
GPU produces a reload action. The runtime owns and destroys its GPU device,
including shared resources, when disposed.

Glasswake requires 0.9 seconds within 0.4 semitones of the target; frames over
50 ms award no hold time. Once armed, a deliberate release opens exactly one
seal. Blur, hidden state, pointer cancellation, atlas entry and leaving cancel
the hold and pending sound without awarding progress. A 1.5-second interval
lets each fracture finish before the next hold. This remains a guided
instrument, not microphone input or a singing score. Its six synthesized
inharmonic partials share the same output gain and analyser as other sound.

## Verification

From this experiment:

```sh
rtk proxy timeout 180 pnpm test
rtk proxy timeout 90 pnpm typecheck
rtk proxy timeout 120 pnpm build
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/evidence VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 600 pnpm exec tsx scripts/verifyObservatory.ts
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/glasswake-evidence VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 600 pnpm exec tsx scripts/verifyGlasswake.ts
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/journey-evidence VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 600 pnpm exec tsx scripts/verifyJourney.ts
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/temple-evidence VERIFY_EARNED_SAVE=/absolute/path/to/genuinely-earned-save.json VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 600 pnpm exec tsx scripts/verifyTemple.ts
rtk proxy env VERIFY_OUT_DIR=/absolute/allocated/temple-lookdev VERIFY_EARNED_SAVE=/absolute/path/to/genuinely-earned-save.json VERIFY_BASE_URL=https://127.0.0.1:5192 timeout 180 pnpm exec tsx scripts/verifyTemplePolish.ts
```

The temple check requires a valid two-page save produced by the journey check.
It verifies restored-page access rather than earning both pages again. To check
the production build, run the same script against the preview server with
`VERIFY_BUILT_UI=1`; that path uses the emitted UI without development diagnostics.
The default development check also records the real scene and shared audio.
The separate polish check captures matched camera/time/progress samples through
development-only renderer controls, retaining the overview HUD. Those frames
compare materials; they do not establish ending UI behavior or performance.
Its motion-off check also requires identical rendered pixels across 480 ms of
controlled frames, stable buffers and no fractal regeneration.

The browser script is standalone, headed, and checks the real adapter. It uses
the required hidden `agent-browser` workspace and keeps its own browser hidden
and unfocused. Do not run the repository's SwiftShader Playwright test runner
as a substitute for WebGPU proof.

The local hidden compositor schedules animation frames at roughly 1 Hz even
with background-throttle flags. That is a scheduling limitation of this
verification surface, not a GPU benchmark. Keyboard verification uses controlled
32 ms frames with actual key events and the actual WebGPU renderer; the report
labels this explicitly. The script also reports whether native hidden-document
state can be observed. If this automation surface keeps background pages
visible, it explicitly simulates visibility changes to verify the handlers;
that does not establish native tab-hide behavior.

Synchronous allocation-failure cleanup, asset retry and loaded-device loss are
covered. Disposal while a device request, model fetch or validation is still
pending remains an asynchronous teardown coverage gap. Buffer counts exclude
viewport-dependent HDR/MSAA/depth textures. No desktop check establishes Quest stereo, hand reach, comfort or
sustained headset performance.

The current master sequence and implementation evidence are documented in
`/home/maff/.dotfiles/personal/lumen-meta/26-desktop-observatory-master-plan.md`
and `29-glasswake-desktop-encounter.md`. Document 28 records world identity and
trace sound. Document 27 records the
preceding foundation milestone.
Document 32 records the connected journey, earned pages, save contract and its
verification. Document 33 records the arranged two-world ending, procedural
temple reveal and desktop evidence. Document 34 records the temple's material,
bevel and atmospheric-light polish, with matched views and resource accounting.
The next art review is the complete passage at normal volume and with motion off.

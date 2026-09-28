# Timeline keyframing and audio-reactive modulation — EARS requirements

**Version:** 0.9.13 (`packages/app/package.json`) with the audio-reactive P0 fixes of
`fix/audio-reactive-p0` on top — the behaviour this describes
**Date:** 2026-09-28
**Scope:** The two systems that make a flame move over time — the timeline
(tracks, keyframes, interpolation, loop synthesis, auto-keyframing, transport)
and audio-reactive modulation (feature extraction, mapping evaluation,
attack/release envelopes, the wiring editor). It deliberately does **not** cover
the offline animation exporter (`utils/animationExport.ts`,
`ExportPngDialog`) beyond the audio modulation it replays (REQ-TA-039), the
recorder/replay wrappers in `recorder/timelineActions.ts`,
the Sonification panel, the WebMCP `arcade_*` audio tools, or the Timeline
panel's DOM layout — a missing requirement about any of those is out of bounds,
not a gap.

**Source:**

- `packages/app/src/utils/timeline.ts` — track/keyframe store, `resolveKeyframeValue`,
  loop synthesis (`resolveLoopValue`/`resolveSeamless`/`resolveCycle`), undo and
  coalescing, transport, `applyTracksToFlame`
- `packages/app/src/utils/easing.ts` — `applyEasing`, `catmullRom`, `clamp` (the copy
  the timeline actually imports)
- `packages/core/src/math/easing.ts` — a byte-identical second copy, re-exported from
  `packages/core/src/index.ts` (see REQ-TA-013)
- `packages/app/src/hooks/useWorkspaceTimelineBinding.ts` — the resolver/writer pair
  the timeline reads parameter values through and writes animated values back with
- `packages/app/src/utils/keyframeOnChange.ts` — the two auto-recording modes
  (Auto keyframe, track-changes) every slider calls after applying a value
- `packages/app/src/utils/audioAnalysis.ts` — FFT bands, beat/onset detection, the
  file and live analyzers, `getAudioFeatureNormalized`
- `packages/core/src/audio/` — the pure signal steps the analyzers share: band levels
  (`bandNormalization.ts`, against a file's whole track or the last 30 s of a live
  band, and the gate that keeps beats and onsets off noise), the running histogram a
  live input's levels are read from (`levelHistogram.ts`), beat picking
  (`peakPicking.ts`, centred for a file, causal for a live input), onsets
  (`onsetDetection.ts`) and the Hann window (`spectralWindow.ts`)
- `packages/app/src/utils/useAudioReactive.ts` — the 30 Hz transport + modulation loop
- `packages/app/src/utils/audioMapping.ts` — the mapping stage: envelopes, the mapped
  value and the dirty check (`resolveAudioMappingValues`)
- `packages/app/src/utils/audioTargets.ts` — the writers that lay settled values onto a
  copy of the flame (`applyAudioTargetValues`)
- `packages/app/src/utils/audioModulator.ts` — one modulation stream, the mapping stage
  then the comfort governor, owned by the live overlay and by each export
- `packages/app/src/comfort/` — the comfort governor and its presets (REQ-TA-039)
- `packages/app/src/utils/exportAudioModulation.ts` — the modulation an export replays
  and writes into each frame it renders
- `packages/app/src/utils/audioWiringPresets.ts` — render-only and flame-aware presets
- `packages/app/src/components/AudioWiringModal/AudioWiringModal.tsx` — the wiring editor
  (connect/replace, defaults, its own undo stack, import/export, shortcuts)
- `packages/app/src/flame/Flam3.tsx:551-603` (`deepClone`), `:1251-1258` (`isAutoFpsReady`) — where the timeline overlay is
  applied to the rendered flame and where playback advances
- `packages/app/src/components/Timeline/hooks/useSeekScrubber.ts` — scrub gesture

**Tests:**

- `packages/app/src/utils/timeline.test.ts` — resolution, all six easing curves,
  `constant`/`spline` interp, loop modes, `applyTracksToFlame`, transport arithmetic
- `packages/app/src/utils/timelineUndo.test.ts` — undo/redo, coalescing, no-op guards,
  load boundaries, value write-back
- `packages/app/src/utils/timeline.variation.test.ts` — `VariationParameterMaps` and
  `resolveVariationParameter`
- `packages/app/src/hooks/useWorkspaceTimelineBinding.test.ts` — resolver/writer round
  trips for render settings, camera, transforms and variations
- `packages/app/src/utils/audioAnalysisMappings.test.ts` — per-target appliers,
  attack/release envelope, dirty-check
- `packages/core/src/audio/bandNormalization.test.ts` — band levels in decibels against
  a track's own range, and against the last 30 s of a live band with its zero lifted
  by how far noise moves it; the frames loud enough to hold a beat or an onset
- `packages/core/src/audio/levelHistogram.test.ts` — the histogram of levels weighted
  by the audio time each stood, over a window of seconds
- `packages/core/src/audio/peakPicking.test.ts` — beats against a threshold that
  follows the music, centred for a file and causal for a live input, cleared by a
  margin over the loud flux, only where a band stands over its zero, and a minimum
  gap held in seconds and rounded up to whole frames
- `packages/core/src/audio/onsetDetection.test.ts` — the log spectral flux and the
  onsets picked from it, for a file and for a live input, only where a band stands
  over its zero
- `packages/core/src/audio/spectralWindow.test.ts` — the Hann window
- `packages/app/src/utils/audioAnalysis.test.ts` — the file analyzer on synthetic
  signals: band levels, a frame at any index, the raw `rms`, beats, onsets on a click
  track, and no beat or onset in a file of room noise
- `packages/app/src/utils/audioAnalysis.demoTracks.test.ts` — the onsets of the two
  bundled demo tracks
- `packages/app/src/utils/audioAnalysis.live.test.ts` — the microphone request and
  the start of a suspended context; the live frame processor: onsets and beats on a
  click track at 30 to 144 polls a second at 44.1 and 48 kHz, the three callers that
  share one input, a clock that steps under a late timer, a knock, band levels on room
  noise, after music and after a burst, and no beat or onset in room noise
- `packages/app/src/utils/audioMappingClamp.test.ts` — schema clamping, integer
  `skipIters`, probability floor, degenerate ranges
- `packages/app/src/utils/audioWiringPresets.test.ts` — preset determinism, targets that
  exist, ranges inside the schema, no preset driving the absolute zoom target, and a
  default wiring that leaves exposure as authored
- `packages/app/src/utils/useAudioReactive.test.ts` — modulation suspension, easing in
  from the authored flame and again after a mic restart, a preset chosen mid-track, a
  target governed home when its mapping is unwired, and a beat on a frame a late file
  tick passed
- `packages/app/src/comfort/comfortGovernor.test.ts` and `comfortPresets.test.ts` — the
  comfort caps in the units the renderer shows, the brightness and zoom windows, the
  schema's bounds, seeding, preset switches, stalls, steps of no time and non-finite
  input (REQ-TA-039)
- `packages/app/src/utils/audioModulator.test.ts` — easing in, targets leaving and
  returning to the wiring, a return inside the window a release left, releases that end
  in every case, a row asking past the schema, one step length for envelope and
  governor (REQ-TA-039)
- `packages/app/src/utils/exportAudioModulation.test.ts` and `exportAudioWiring.test.ts` —
  an export's modulation against the live step, frames read by time, the comfort windows
  held in the video's time, and what an export frame carries (REQ-TA-039)
- `packages/app/src/utils/audioTargets.test.ts` — the writers, by id, and the value they
  keep for one that is not finite (REQ-TA-032)
- `packages/app/src/components/AudioReactivePanel/AudioReactivePanel.test.tsx` —
  `defaultTarget` and `flameTargetKey` round trips
- `tests/timeline.ci.spec.ts` — end-to-end, in CI: the transport steps and seeks the
  playhead, the Frames field sets the length, play and pause toggle, and one settings
  change is one undo step. It does not count played frames: they advance in the
  renderer, which the software adapter can fail to mount.
- `packages/app/src/components/AudioWiringModal/AudioWiringModal.paste.test.tsx` —
  pasting wiring onto another transform (REQ-TA-040)
- `packages/app/src/components/AudioWiringModal/AudioWiringModal.import.test.tsx` —
  an import that does not fit, or that the workspace refuses, keeps the panel open
  (REQ-TA-037)
- `packages/app/src/utils/jsonQueryParam.test.ts` — the audio wiring in a share link:
  carried, dropped on its own when it does not fit, absent from older links (REQ-TA-041)
- `packages/app/src/components/ShareLinkModal/ShareLinkModal.test.tsx` — the share
  dialog's audio wiring switch, and the default wiring it leaves out (REQ-TA-041)
- `packages/app/src/commands/builtins/audio.test.ts` and
  `packages/app/src/hooks/useWorkspaceReplay.legacyWiring.test.ts` — legacy wiring stored
  with keys the moment it is set (REQ-TA-040)
- `packages/app/src/lib/audioWiringLoad.test.ts` — putting loaded wiring back never
  switches audio on (REQ-TA-041)
- `packages/app/src/utils/recentFlames.test.ts`, `packages/app/src/hooks/useWorkspaceAutosave.test.ts`,
  `packages/app/src/components/LoadFlameModal/flameLoad.test.ts`, `packages/app/src/lib/pauseSave.test.ts`,
  `packages/app/src/lib/workspaceHandoff.test.ts`, `packages/app/src/components/ExportJobs/ExportJobHost.recents.test.ts`
  and `packages/app/src/components/ExportPngDialog/quickExport.test.tsx` — the audio wiring a
  Recents entry keeps, the exports' entries included, and every way an entry opens (REQ-TA-041)
- `packages/app/src/utils/useLoadFlameFromFile.test.ts`, `packages/app/src/utils/useAppDragAndDrop.test.ts`
  and `packages/app/src/utils/flameImport.test.ts` — a flame's JSON dropped on the canvas
  opens as that flame, with its wiring (REQ-TA-041)
- `packages/app/src/utils/audioEnvelope.test.ts`,
  `packages/app/src/components/AudioWiringModal/ParamsPanel.test.tsx` and
  `packages/app/src/components/AudioReactivePanel/AudioReactivePanel.envelope.test.tsx` —
  the attack and release a row runs at, as the editor and the panel rows show them
  (REQ-TA-042)
- _Gap:_ nothing else tests `AudioWiringModal.tsx` (unit or e2e) — REQ-TA-035,
  REQ-TA-036 and REQ-TA-038 are entirely unguarded. `keyframeOnChange.ts` likewise has no test,
  so REQ-TA-020 is unguarded. See **Coverage gaps** at the end for the full list.

---

## Requirements

### Tracks and keyframes

### REQ-TA-001 — A track exists exactly as long as it holds keyframes

**When** a keyframe is written for a parameter path that has no track, the
timeline shall create a track for that path holding only that keyframe; **when**
the last keyframe is removed from a track, the timeline shall drop the track
entirely rather than keep an empty one.

_(`utils/timeline.ts:1045-1089` (`addKeyframeImpl`) creates; `:1096-1110` filters `keyframes.length > 0`.)_

### REQ-TA-002 — Re-keying a frame updates in place and keeps what the caller did not pass

**When** a keyframe is written at a frame that already holds one for that path,
the timeline shall replace that keyframe's value and shall preserve its existing
`easing` and `interp` for any of the two the caller omitted — so a value scrub
does not silently reset a keyframe to linear.

_(`utils/timeline.ts:1057-1078` — `easing: easing ?? kf.easing`, `interp: interp ?? kf.interp`.)_

### REQ-TA-003 — Keyframing at the playhead writes through to the flame

**When** a keyframe is written at a frame equal to the current frame and a value
writer is registered, the timeline shall also push that value into the flame
descriptor through the writer, so the canvas and the keyframe agree without
waiting for the next resolve.

_(`utils/timeline.ts:1091-1093` (`valueWriterFn`).)_

### REQ-TA-004 — An edit that changes nothing costs no undo entry

**If** `removeKeyframe` names a frame with no keyframe, `removeAllKeyframesForPath`
names a path with no track, `clearAllTracks` runs on an empty timeline, or
`setLoopMode` is handed the mode already in effect, **then** the timeline shall
return without pushing an undo entry and without clearing the redo stacks — a
Ctrl+Z must never be spent on a no-op, and must never destroy a live redo.

_(`utils/timeline.ts:1128-1133` (`removeKeyframe`), `:1536-1541` (`removeAllKeyframesForPath`), `:1710-1714` (`clearAllTracks`), `:1745-1747` (`stringify`); guarded by
`timelineUndo.test.ts:84-107` (`nothing`), `:300` "an idempotent loop-mode set burns no undo entry".)_

### REQ-TA-005 — Structural operations refuse non-interpolatable keyframes

**If** the keyframe named by `splitKeyframeAtFrame`, `moveKeyframe`,
`relocateKeyframe`, `applyMirroredValueFromTrack` or `setKeyframeInterp` holds
`null` or a boolean, **then** the operation shall be a no-op and shall report
failure to callers that return a status, rather than write a value the resolver
cannot blend.

_(`utils/timeline.ts:1154-1163` `setKeyframeInterp`, `:1291-1311` `splitKeyframeAtFrame`,
`:1365-1386` `applyMirroredValueFromTrack`, `:1659-1678` `moveKeyframe`,
`:1699-1700` `relocateKeyframe`; guarded by `utils/timeline.test.ts:225` "should handle boolean values correctly", `:327` "should return false if source value is boolean".)_

### REQ-TA-006 — A keyframe drag never clobbers its neighbour

**If** `relocateKeyframe` is asked to move a keyframe onto a frame that already
holds one on the same track, **then** it shall leave both keyframes untouched.
`relocateKeyframe` shall push no undo entry of its own, because the drag gesture
that owns it already opened one.

_(`utils/timeline.ts:1697-1709` (`relocateKeyframe`).)_

### REQ-TA-007 — Loading tracks is a document boundary

**When** `loadTracks` runs, the timeline shall deep-clone the incoming tracks and
keyframes, clear both undo and redo stacks, end any open coalescing run, and
clear `previewHeld` — so Ctrl+Z after opening another flame cannot restore the
previous flame's tracks onto the new one, and a stale redo cannot overwrite what
was just loaded.

_(`utils/timeline.ts:1755-1779` (`loadTracks`); guarded by `timelineUndo.test.ts:353-385` "load boundaries".)_

---

### Resolving a value at a frame

### REQ-TA-008 — The later keyframe owns the segment

The keyframe resolver shall take both the easing curve and the interpolation
mode for the segment `prev → next` from **`next`**, defaulting to `'linear'` for
each when unset — so a curve authored on a keyframe describes how the animation
arrives at it, not how it leaves it.

_(`utils/timeline.ts:632-633` (`easedT`); exercised throughout `utils/timeline.test.ts:366-410` "should use easeIn interpolation", which
authors the curve on the second keyframe.)_

### REQ-TA-009 — Outside the keyframe span the value holds

**If** the requested frame is at or before the first keyframe, **then** the
resolver shall return the first keyframe's value; **if** it is at or after the
last, it shall return the last keyframe's value; **if** two keyframes share a
frame, it shall return the earlier one's value. A track with no keyframes shall
resolve to `null`.

_(`utils/timeline.ts:601-611` (`sort`), `:625` (`frameRange`); the after-last hold is exercised indirectly by
`utils/timeline.test.ts:732` "seamless ramps from the held end value back to the start value", the empty case by `:412` "should return null for non-existent track".)_

### REQ-TA-010 — Six easing curves, applied to the normalized segment position

The resolver shall map the segment position `t = clamp((frame - prev.frame) /
(next.frame - prev.frame), 0, 1)` through the segment's curve before
interpolating, supporting exactly `linear`, `easeIn` (cubic), `easeOut`
(inverse cubic), `easeInOut`, `bounce` and `elastic`, and shall treat any
unrecognised curve as `linear`.

_(`utils/timeline.ts:628-632` (`rawT`), `core/src/math/easing.ts:7-24` (`applyEasing`); every curve guarded by
`utils/timeline.test.ts:366-410` "should use easeIn interpolation".)_

### REQ-TA-011 — Interpolation mode is orthogonal to easing

**Where** a segment's `interp` is `'constant'`, the resolver shall hold the
previous keyframe's value for the whole segment; **where** it is `'spline'`, the
resolver shall interpolate with Catmull-Rom (tension 0.5) using the two adjacent
keyframes as tangent controls, substituting the boundary value when a neighbour
is missing or is of a different shape; otherwise it shall interpolate linearly.
The eased `t` shall be fed to all three modes alike.

_(`utils/timeline.ts:534-586` (`interpolateNumberKeyframe`), `:633-662` (`linear`); guarded by `utils/timeline.test.ts:768-836` "spline (Catmull-Rom) interpolation".)_

### REQ-TA-012 — Arrays blend component-wise; strings and booleans hold

**While** both endpoints of a segment are numeric arrays of equal length, the
resolver shall interpolate them component-wise (RGB and RGBA colour tracks);
**if** the endpoints are strings, booleans, or arrays of differing length,
**then** it shall hold the previous value rather than produce a blended one, and
snap to the target only once the segment completes.

_(`utils/timeline.ts:553-586` (`interpolateArrayKeyframe`), `:646-667` (`isArray`), `:439-458` (`lerpKfValues`); array blending guarded by
`utils/timeline.test.ts:818` "interpolates array (colour) values with spline", `:417` "should handle array values".)_

### REQ-TA-013 — One implementation of the interpolation math

The monorepo shall hold exactly one implementation of `applyEasing`,
`catmullRom`, `lerp` and `clamp`, so that a fix to a curve reaches every caller.

<!-- cite-check: pinned a5c2f26f -->

> **Fixed deviation** (#115, `984926e4`; this note describes the code at `a5c2f26f`): `packages/core/src/math/easing.ts` is byte-identical to
> `packages/app/src/utils/easing.ts` (`diff` reports no difference). The core copy
> is re-exported by `packages/core/src/index.ts:5` and imported by nothing —
> repo-wide, the only importers of `applyEasing`/`catmullRom` are
> `packages/app/src/utils/timeline.ts:3` and `timeline.test.ts:2`, both of which
> resolve to the **app** copy. The math was copied into core rather than moved, so
> a change to the app twin silently leaves core stale and vice versa.

<!-- cite-check: live -->

---

### Loop synthesis

### REQ-TA-014 — With loop synthesis off, resolution is untouched

**Where** `config.loopMode` is `'off'` or absent, `loopOptsFromConfig` shall
return `null` and `resolveLoopValue` shall be exactly `resolveKeyframeValue`.

_(`utils/timeline.ts:417-435` (`loopOptsFromConfig`), `:460-474` (`resolveLoopValue`); guarded by `utils/timeline.test.ts:726` "equals resolveKeyframeValue when opts is null", `:653` "off leaves resolution unchanged".)_

### REQ-TA-015 — Seamless mode synthesizes a there-and-back tail

**Where** `loopMode` is `'seamless'`, the resolver shall, for frames in the
trailing window `(userEnd, endFrame]`, ramp each track from its held value at
`userEnd` back to its value at `startFrame` along an `easeInOut` curve, so that
`value(endFrame) === value(startFrame)` for every track. **If** either endpoint
resolves to `null`, or `endFrame <= userEnd`, **then** it shall fall back to
ordinary keyframe resolution. `userEnd` is the last keyframe frame across all
tracks.

_(`utils/timeline.ts:387-399` (`getUserEndFrame`), `:477-502` (`resolveSeamless`); guarded by `utils/timeline.test.ts:633` "seamless resolves endFrame back to the start value", `:732` "seamless ramps from the held end value back to the start value".)_

### REQ-TA-016 — Cycle mode wraps each track on its own phase

**Where** `loopMode` is `'cycle'`, the resolver shall treat
`[startFrame, endFrame]` as one period `P`, resolve normally inside a track's own
keyframe span, and outside it interpolate across the wrap from that track's last
keyframe to its first keyframe shifted by `+P`, easing with the **first**
keyframe's curve. **If** the track has fewer than two keyframes, `P <= 0`, or the
track's keyframes already span the full period, **then** it shall fall back to
ordinary resolution.

_(`utils/timeline.ts:505-532` (`resolveCycle`); guarded by `utils/timeline.test.ts:642` "cycle resolves start and end to the same value (seamless wrap)", `:746` "cycle interior interpolates normally", `:752` "cycle wraps the last keyframe back to the first across the period".)_

### REQ-TA-017 — Selecting a loop mode adds no keyframes and is undoable

**When** `setLoopMode` runs, it shall change only the config: `'cycle'` and
`'seamless'` shall additionally enable `loop`, and `'seamless'` shall extend
`endFrame` past the last keyframe by the forward span (so the return tail takes
as long as the forward animation) only when `endFrame` does not already exceed
`userEnd`. `'cycle'` shall never extend `endFrame`. The whole change shall record
one undo entry, because a silently rewritten `endFrame` must be reversible.

_(`utils/timeline.ts:1725-1753` (`setLoopMode`); guarded by `utils/timeline.test.ts:576` "seamless: adds no keyframes, enables loop, extends endFrame by span", `:613` "seamless is idempotent — re-selecting does not pile up frames", `:623` "cycle: enables loop and never extends endFrame" and
`timelineUndo.test.ts:287` "seamless loop mode is undoable, including its endFrame rewrite".)_

---

### Writing tracks onto a flame

### REQ-TA-018 — Only tracks that are present and correctly typed are written

**When** `applyTracksToFlame` runs, it shall write a value into the flame only
for parameter paths that have a track, and only when the resolved value matches
the target's type (number for scalars, string for `drawMode`/`colorInitMode`/
`pointInitMode`, a 3-element array for `backgroundColor`, a 4-element array for
`edgeFadeColor`) — leaving every unanimated field of the flame exactly as it was.
Camera tracks shall additionally be skipped when the flame carries no
`camera`/`camera3D` object to write into.

_(`utils/timeline.ts:1861-2012` (`applyTrackNumber`), `:2138-2153` (`applyTracksToFlame`); guarded by `utils/timeline.test.ts:929` "applies 2D camera tracks correctly", `:949` "applies 3D camera tracks correctly",
`:978` "applies render settings tracks correctly including color arrays", `:1054` "applies transform and variation tracks correctly".)_

### REQ-TA-019 — The final transform is seeded before it is animated

**If** a flame with `finalTransform` tracks has no `finalTransform`, **then**
`applyTracksToFlame` shall seed one with the identity matrix matching the flame's
dimensionality — the 12-parameter 3D identity when `renderSettings.dimensions === 3`,
the 6-parameter 2D identity otherwise — before applying the `finalTransform.*`
tracks.

_(`utils/timeline.ts:2093-2136` (`applyFinalTransformTracks`); guarded by `utils/timeline.test.ts:1100` "seeds and applies 2D finalTransform tracks", `:1144` "seeds and applies 3D finalTransform tracks with 12-param identity".)_

---

### Auto-keyframing on edit

### REQ-TA-020 — Two recording modes, both gated on the animation UI

**Where** Auto keyframe is on, an edit shall re-record a keyframe at the current
frame only for paths that **already** have a track; **where** the track-changes
diamond is on, an edit shall record a keyframe for every path it changed, creating
the first keyframe for a previously unanimated one. **If** `animationEnabled` is
false, **then** neither mode shall record anything, so a persisted "on" state
cannot leave ghost keyframes behind after the user leaves animation mode.

_(`keyframeOnChange.ts:21-55` (`keyframeChangedParams`); `autoKeyframe` persists under
`timeline-auto-keyframe` and defaults **on** — `utils/timeline.ts:763-766` (`setAutoKeyframe`);
`keyframeOnChange` persists under `editor/keyframe-on-change` and defaults **off**.)_

### REQ-TA-021 — Editing a keyframed parameter at its own keyframe records the new value

**When** the playhead sits exactly on a keyframe for a parameter and the user
edits that parameter, the value resolver shall return the freshly edited value
from the flame descriptor, so auto-keyframing overwrites the keyframe with the
edit.

<!-- cite-check: pinned a5c2f26f -->

> **Fixed deviation** (#90, `abd83151`; this note describes the code at `a5c2f26f`): `packages/app/src/hooks/useWorkspaceTimelineBinding.ts:87-96`
> — `getFlameCameraSetting` consults `getTimelineCameraKeyframeValue` (`:35-45`)
> _before_ checking whether the path is a camera path at all, and `getFlameValue`
> (`:374-384`) routes **every** path that is not a render setting through it. So for
> any transform, variation-weight or variation-parameter path, if the timeline is
> driving the view and a keyframe exists at the current frame, the resolver returns
> the **old keyframe value** instead of the edited one. `addKeyframesAtCurrentFrame`
> then re-keys that stale value, and `addKeyframeImpl` (`utils/timeline.ts:1020`, `valueWriterFn`) writes it
> straight back into the flame — the edit is discarded and the slider snaps back.
> Before the `MainWorkspace` decomposition (commit `88070311`) this short-circuit was
> inlined in seven camera `case` arms only (`camera.x`, `camera.y`, `camera.zoom`,
> `camera3D.theta`, `camera3D.phi`, `camera3D.radius`, `camera3D.fov` — never
> `camera.rotation`); the extraction widened it to all paths.

<!-- cite-check: live -->

### REQ-TA-022 — The keyframe override applies to camera paths only

**While** the timeline is driving the view, the value resolver shall prefer the
keyframe value over the flame descriptor's value **only** for the seven camera
paths that the timeline overlay, rather than the base flame, owns
(`camera.x`, `camera.y`, `camera.zoom`, `camera3D.theta`, `camera3D.phi`,
`camera3D.radius`, `camera3D.fov`). Every other path shall resolve from the live
flame descriptor.

<!-- cite-check: pinned a5c2f26f -->

> **Fixed deviation** (#90, `abd83151`; this note describes the code at `a5c2f26f`): `packages/app/src/hooks/useWorkspaceTimelineBinding.ts:87-96`
> — the override is reached for every non-render-setting path, not just the seven
> camera ones. Same root cause as REQ-TA-021; fixing it means testing
> `CAMERA_GETTERS[path]` before consulting the keyframe, not after.

<!-- cite-check: live -->

### REQ-TA-023 — One gesture is one undo step

**While** the same set of parameter paths is being re-recorded at the same frame,
successive `addKeyframesAtCurrentFrame` calls shall coalesce into the undo entry
the first of them pushed — so a slider scrub that fires per pointer-move costs
one Ctrl+Z, not hundreds. The run shall end **when** any of the following happens:
the playhead moves, the owning input calls `breakUndoCoalescing` at gesture end,
a different path set or frame is recorded, an undo or redo runs, or the caller
passes `coalesce: false` (dice rolls, diamond clicks, debounced flushes), each of
which shall be its own step.

_(`utils/timeline.ts:711-717` (`setCurrentFrame`), `:885-887` (`breakUndoCoalescing`), `:1618-1641` (`addKeyframeValuesAtFrame`), `:1646-1657` (`toggleKeyframeAtCurrentFrame`); guarded by
`timelineUndo.test.ts:109-208` "addKeyframesAtCurrentFrame (grouped writes)".)_

---

### Transport: scrubbing versus playing

### REQ-TA-024 — One definition of "the timeline owns the view"

The timeline shall expose `isDrivingView()` as
`animationEnabled() && (isPlaying() || isScrubbing() || previewHeld())`, and every
consumer that overlays animated values onto the rendered flame shall gate on that
accessor rather than on `isPlaying()` alone — otherwise a frame reached by
clicking or stepping renders its camera but not its transforms.

_(`utils/timeline.ts:774-775` (`isDrivingView`); consumed at `Flam3.tsx:578-581` (`isActive`).)_

### REQ-TA-025 — A seeked frame outlives the gesture that reached it

**When** the playhead is moved by any means — `goToFrame`, `advanceFrame`,
`goBackFrame` or `play` — the timeline shall latch `previewHeld`, so the canvas
keeps showing that frame's animated state after the pointer is released instead of
snapping back to the base flame. **While** a scrub drag is in progress
`isScrubbing` shall be true, and it shall be cleared on pointerup, pointercancel
or unmount; only `loadTracks`, `clearAllTracks` and the Home hand-off reset shall
clear `previewHeld`.

_(`utils/timeline.ts:1437-1505` (`advanceFrame`), `:1710-1711` (`clearAllTracks`), `:1755-1756` (`loadTracks`);
`useSeekScrubber.ts:11-17` (`finishSeek`), `:33-36` (`finishSeek`), `:68-70` (`onCleanup`); `MainWorkspace.tsx:2394-2400` (`pause`).)_

### REQ-TA-026 — Playback advances at the configured rate, or on quality with Auto FPS

**While** playback is running and Auto FPS is off, the renderer shall advance
`config.timeScale` frames every `1000 / config.fps` ms. **Where** Auto FPS is on,
that interval shall not run at all; the render loop shall advance one frame each
time the current frame reaches target quality, and the timeline shall report the
achieved rate as an exponential moving average (`0.8` prior, `0.2` new sample),
reported as `undefined` whenever playback stops.

_(`Flam3.tsx:579-602` (`createEffect`) and `:1251-1258` (`isAutoFpsReady`); `utils/timeline.ts:1437-1458` (`advanceFrame`), `:758-762` (`resetFpsMeter`).)_

### REQ-TA-027 — Playback without loop stops at the end

**When** `advanceFrame` passes `config.endFrame`, the timeline shall return the
playhead to `config.startFrame`, and **if** `config.loop` is false, **then** it
shall additionally stop playback and reset the FPS meter. `play` shall rewind to
`startFrame` first **if** looping is off and the playhead is already at or past
the end.

_(`utils/timeline.ts:1462-1470` (`setIsPlaying`), `:1496-1502` (`play`); guarded by `utils/timeline.test.ts:442-463` "should wrap to start frame when at end".)_

---

### Audio-reactive modulation

### REQ-TA-028 — Every audio feature reaches the mapper as 0-1

The analyzer shall expose thirteen features and normalize each into `[0, 1]`
before mapping: eight FFT bands (`subBass`…`fullSpectrum`) as their level in
decibels placed on `[0, 1]` against the range that band covers over the whole
track (its 10th percentile reads 0 and its 98th reads 1, with the zero no more
than 45 dB below the top and a span of at least 6 dB), `rms` as the raw frame
level capped at 1 (never normalised like the bands, so wirings made before band
levels keep their ranges), `centroid` divided by 20 kHz and
capped, `flatness` as computed, `onset` as a strength on the frame an onset
peaks and `0` between onsets (a peak of the log spectral flux, measured against
the track's loud onset flux, its 99th percentile, that clears the mean + 1.5σ of
the second around it by 0.05 of that loud flux, at least 50 ms after the last,
its strength that measure capped at 1), and
`beat` as `1` on a detected beat and `0` otherwise, a beat being a rise of the
band flux above the mean + 1.5σ of the 4 s around it by at least 5% of the loud
band flux there, its 99th percentile, at least 0.1 s after the last one. Both
gaps shall be counted in whole frames at the analyzer's real frame rate, rounded
up, so no two events land closer than the gap (0.1 s is 3 frames at 24 fps, and
50 ms 2 frames at 25 fps). A beat or an onset shall land only on a frame where
some band stands at least 9 dB over its zero: that band's 10th percentile over
the track, lifted by how far noise alone moves a band of its bins (16 dB /
n^0.45 for n bins), so a file of room noise holds none. The file analyzer shall
read a frame at any index: NaN as the first frame, a fraction as the frame it is
in, and past either end the frame at that end. An unrecognised feature name
shall yield `0`. The microphone has no whole track to measure against; REQ-TA-043
says how it reaches the same `[0, 1]`.

_(`audioMapping.ts:151-173` (`getAudioFeatureNormalized`), `audioAnalysis.ts:108-162` (`getFftBands`); beats at `:206-224` (`computeBeats`), picked by
`peakPicking.ts:116-138` (`detectBeatFrames`) against `:70-105` (`centredQuantiles`) at the rate `audioAnalysis.ts:257` (`fps`) gives; onsets from the flux at `:283`
(`logSpectralFlux`), picked by `onsetDetection.ts:69-97` (`detectOnsets`); both gaps by `peakPicking.ts:30-32`
(`gapInFrames`). Every frame's spectrum is the Hann-windowed `fftSize` samples centred on it, `audioAnalysis.ts:88-106`
(`frameSpectrum`), and any index reads a frame at `:310-318` (`getFrameData`).)_

_(The frames a beat or an onset may land on: `audioAnalysis.ts:294-299` (`trackAudibleFrames`), by
`bandNormalization.ts:134-150` (`trackAudibleFrames`) against `:119` (`EVENT_MIN_RISE_DB`) and
`:108-110` (`noiseWobbleDb`). Guarded by `bandNormalization.test.ts:105` "holds a frame audible when
some band stands 9 dB or more over its zero", `:113` "holds a frame audible when a band stands 9 dB
over its quiet level lifted by its noise wobble", `:57` "lifts the quiet level by what it is given,
as the file gate does by noise" and `audioAnalysis.test.ts:98` "finds no beat and no onset in a file
of room noise at %i dB, at 24, 30 and 60 fps".)_

_(Band levels at `bandNormalization.ts:57-66` (`trackBandRange`), put on every frame of
a file at `audioAnalysis.ts:303` (`normalizeTrackBands`); the raw `rms` at `:280`
(`computeRms`). Guarded by `bandNormalization.test.ts:39` "reads the 10th percentile
as 0 and the 98th as 1", `:48` "keeps the zero within 45 dB of the top, so a silent
intro does not squash the music", `audioAnalysis.test.ts:18` "reads a band from 0 to 1
over the range it covers in its track", `:26` "reads a frame at any index: NaN as the
first, a fraction as the frame it is in" and `:41` "keeps rms as the raw level of the
frame".)_

_(Beats guarded by `peakPicking.test.ts:37` "keeps the beats of a quiet passage that
follows a loud one", `:47` "holds the minimum gap at 0.1 s whatever the frame rate",
`:59` "rounds the minimum gap up to whole frames at 24 and 25 fps",
`:74` "marks the frame where the flux peaks, not the first frame that rises",
`:85` "needs a beat to clear its threshold by 5% of the loud flux around it",
`:94` "finds no beat on a frame where no band stands over its zero",
`audioAnalysis.test.ts:48` "keeps the beats of a quiet passage that follows a loud
one" and `:65` "holds the minimum gap between beats at 0.1 s at 60 fps".)_

_(Onsets guarded by `onsetDetection.test.ts:29` "marks the peaks that clear the local
threshold, strong against the loud onsets", `:49` "rounds the 50 ms gap up to whole
frames at 24 and 25 fps", `:64` "finds no onset in silence", `:68` "finds no onset on a
frame where no band stands over its zero", `:76` "finds no onset in a steady hiss",
`audioAnalysis.test.ts:74` "finds an onset at every click of a 120 BPM click track at %i
fps, %s s off the frame grid, and none in silence" and `audioAnalysis.demoTracks.test.ts:44`
"%s has %i onsets at 30 fps".)_

### REQ-TA-043 — The microphone is heard as music, timed in seconds

**Where** the source is the microphone, the analyzer shall ask for it with echo
cancellation, noise suppression and automatic gain control off, and shall start
an audio context the browser hands over suspended; **if** the context will not
start, **then** the analyzer shall give the microphone back and fail the start,
so the panel shows why. It shall take each spectrum through a Hann window. A band
shall read as its level in decibels placed on `[0, 1]` by the rule of a file's
band (REQ-TA-028) over the last 30 s of audio, with its zero lifted by how far
noise alone moves a band of its bins (16 dB / n^0.45 for n bins: 16 dB for one
bin, 5.95 dB for nine, 2.38 dB for 69), so steady room noise and silence read about
0 from the first second and again within seconds of music stopping. Until the
band has heard 5 s, its zero shall move down from the median to the 10th
percentile. The levels shall be kept in a histogram of 0.5 dB bins, each weighted
by the audio time it stood, at most 0.1 s, so the range does not depend on how
often the input is polled, and a 50 ms burst is too little of 30 s to move the
top. `rms` shall stay the raw level, as it does for a file.
An onset shall be a rise of the log spectral flux past the mean + 1.5σ of the
last second, by at least 5% of the loud flux of the last 10 s, its 99th
percentile and never below 1e-4, no sooner than 50 ms after the last one, its
strength the flux against that loud flux capped at 1; a beat, a rise of the band
flux past the mean + 1.5σ of the last 2 s, by at least 5% of the loud band flux
of those 2 s, its 99th percentile, no sooner than 0.1 s after the last one. A
beat or an onset shall land only while some band stands at least 9 dB over its
zero, so room noise fires none. Every window, gap and hold shall be measured in
seconds on the audio clock, so what is found does not depend on how often the
input is polled. A caller polling within 5 ms of audio time of the last analysis
shall get that analysis again, and a beat or an onset, once found, shall stay up
for 100 ms of audio time: one 33 ms poll of the modulation loop, plus a 21 ms
step of the clock the main thread reads, plus a timer that runs late. So the
modulation loop sees every one while the wiring editor's meters and node graph
poll the same input.

_(`audioAnalysis.ts:335-341` (`MIC_CONSTRAINTS`), `:347` (`LIVE_HOP_SECONDS`), `:356`
(`LIVE_EVENT_HOLD_SECONDS`), `:374-445` (`createLiveFrameProcessor`), the gate at `:422`
(`isAudible`), `:450-501` (`createLiveAnalyzer`); `bandNormalization.ts:181-211`
(`createLiveBandNormalizer`), `:156` (`LIVE_BAND_WINDOW_SECONDS`), `:162`
(`LIVE_BAND_SETTLE_SECONDS`), `:123-125` (`isAudible`); `levelHistogram.ts:34-93`
(`createLevelHistogram`); `peakPicking.ts:156-192` (`createCausalPicker`), `:200-217`
(`createLiveBeatDetector`); `onsetDetection.ts:106-128` (`createLiveOnsetDetector`), `:36`
(`LIVE_ONSET_LOUD_SECONDS`).)_

_(Guarded by `audioAnalysis.live.test.ts:125` "is asked for as music, with the browser
call processing off", `:104` "starts a suspended audio context, and leaves a running one
be", `:114` "fails the start when the context will not run, and gives the microphone
back", `:151` "finds an onset and a beat at every click polled %i times a second at %i Hz,
and none in silence", `:179` "shows the modulation loop every event while the node graph
and the meters poll the same input %s s after it", `:207` "shows the modulation loop every
event on a clock that steps, even when its timer is late", `:264` "does not let one knock
19 dB over the clicks quieten the onsets 2 s after it", `:299` "gives a caller that polls
within 5 ms of the last analysis the same frame", `:307` "holds a beat for 100 ms of audio,
however often it is polled", `:323` "reads a band from its quiet level, 0, to its loud one,
1", `:374` "read room noise at %i dB as about 0 in every band, from the first second and
still at 120 s", `:395` "read about 0 in every band within 5 s of the music stopping, and
long after", `:415` "keep every band within 0.1 of their reading 2 s after a burst 30 dB
over the clicks", `:459` "find no onset and no beat in room noise at %i dB, polled by one
caller or three".)_

_(And by `bandNormalization.test.ts:140` "is how far a band of n bins wobbles on noise, from
14.6 dB for one bin down", `:168` "reads a band at its quiet level as 0 and at its loud level
as 1", `:196` "reads 0 for a band that moves no more than its bins wobble on noise", `:204`
"holds its zero at the median until it has heard 5 s", `:218` "forgets a loud passage 30 s
after it", `levelHistogram.test.ts:16` "weighs each level by the audio time since the one
before", `:28` "counts a level for no more than 0.1 s, however long since the last", `:35`
"forgets a level once it is older than the window", `peakPicking.test.ts:136` "finds the
same beats whether it is asked 30 or 60 times a second", `:152` "needs a beat to clear its
threshold by 5% of the loud flux of the last 2 s", `:161` "finds no beat while no band
stands over its zero", `onsetDetection.test.ts:100` "measures an onset against the loud
flux of the last 10 s, its 99th percentile", `:111` "does not let one knock ten times louder
quieten the onsets 2 s after it", `:126` "forgets a loud passage within 10 s of its end" and
`:153` "finds no onset while no band stands over its zero".)_

### REQ-TA-029 — Attack and release are a one-pole envelope on the normalized feature

**Where** a mapping declares `attackMs` or `releaseMs`, the mapper shall smooth
the normalized feature with `next = prev + (dt / (tc + dt)) * (value - prev)`,
using `attackMs` as `tc` while the value is rising and `releaseMs` while it is
falling, falling back to whichever of the two is set when the other is absent.
**If** both are absent or zero, **then** the feature shall pass through
unsmoothed. `prev` shall come from the per-target smoothing state, seeded with the
current value on the first frame so a mapping does not ramp up from zero.

_(`audioMapping.ts:229-249` (`computeSmoothedEnvelope`), called from `:346-352` (`smoothed`), which takes its
times from `audioEnvelope.ts:19-27` (`effectiveEnvelope`); guarded by
`audioAnalysisMappings.test.ts:303` "applies attack and release envelope smoothing across consecutive frames".)_

### REQ-TA-030 — The mapped value is `lo + smoothed × sensitivity × (hi − lo)`

The mapper shall convert a smoothed feature into a target value as
`range[0] + smoothed * sensitivity * (range[1] - range[0])`. Sensitivity scales
the span rather than clipping it, so a sensitivity above 1 can carry the value
past `range[1]`; keeping the result inside the schema is the comfort governor's
job for what it steps (REQ-TA-039) and the writers' for what they write
(REQ-TA-032), not this formula's.

_(`audioMapping.ts:175-181` (`mappingToVal`), `:363` (`mappingToVal`); guarded by `audioAnalysisMappings.test.ts:100` "scales the output by the mapping sensitivity".)_

### REQ-TA-031 — Sub-threshold movement does not re-render

**If** a target's smoothed value would move its output by less than 0.2% of the
mapping's output range (never less than `1e-6`) from the value last applied to
that target, **then** the mapper shall skip writing it, shall keep the previously
applied value as the comparison baseline, and shall still record the new smoothed
value so the envelope keeps advancing. A target whose limited output (REQ-TA-039)
is still travelling shall count as moved once it has gone that same distance from
the value last published. **If** no target changed on a frame, the mapper shall
report the frame unchanged, and the live loop shall publish nothing for it while an
overlay is up, so the render loop sees no new work.

_(`audioMapping.ts:199-202` (`dirtyThreshold`), `:265-287` (`settleTargetValue`), `:290-299` (`outputMoved`), `:322-377` (`resolveAudioMappingValues`),
`useAudioReactive.ts:86-90` (`publishModulation`); guarded by
`audioAnalysisMappings.test.ts:338` "reports no change when a frame moves nothing past the dirty threshold",
`audioMapping.test.ts:74` "holds a move below 0.2% of the output range" and `:88` "keeps a frame changed while the limited output is still moving".)_

### REQ-TA-032 — Audio modulation cannot leave the flame schema-invalid

**When** the mapper writes a render setting, it shall hold the value to that
setting's schema domain with the projection the timeline and the commands use
(`projectFlameValue`): floor an integer setting such as `skipIters` the way the
renderer reads it, wrap the cyclic `palettePhase`, clamp every other bound, and
substitute `0` for a non-finite value. **When** it writes a transform probability, it shall clamp to
a floor of `0.001`, never zero or negative. **When** it writes a variation
weight, a transform's affine coefficient, a transform's colour coordinate or a
final-transform coefficient, it shall write only a finite value and otherwise keep
the one the flame has. **If** the target names a transform
or a variation the flame does not have (REQ-TA-040 says how a target names
them), **then** the write shall be skipped rather than create the missing object.

Rationale, not decoration: the live overlay writes only a copy of the authored
flame, but an export embeds the modulated flame in the file it writes, and one
out-of-range `palettePhase` makes that flame permanently un-breedable,
un-exportable and un-openable in the ancestry tree.

_(`audioTargets.ts:26-40` (`heldRenderSetting`), `:192-232` (`applyTransformPropertyTarget`), `:176-190` (`applyTransformAffineTarget`), `:234-244` (`applyVariationWeightTarget`), `:246-256` (`applyFinalAffineTarget`); guarded by
`audioMappingClamp.test.ts:80` "keeps a wildly out-of-range palettePhase valid" and `audioAnalysisMappings.test.ts:194` "enforces safe probability lower bound for transform probability target", `:262` "gracefully handles out-of-bounds transform indices", `audioTargets.test.ts:172` "keeps the authored weight when the settled value is not a number", `:242` "%s keeps its authored value for %d".)_

### REQ-TA-033 — Auditioning a track is not the same as driving the flame

**While** a decoded file is loaded, the audio transport — context, buffer source,
seek and the playback-position readout — shall run regardless of whether audio
reactivity is enabled and regardless of whether the analysis pass has finished;
only the modulation step shall wait on both. **Where** the source is the
microphone, both transport and modulation shall be gated on reactivity being
enabled, so an idle mic capture is never held open.

_(`useAudioReactive.ts:180-305` (`source`) for file mode — note the analyzer is consulted only
at `:255` (`analyzer`); `:307-344` (`source`) for mic mode.)_

### REQ-TA-034 — Replay suspension freezes modulation and its clock

**While** `modulationSuspended` is true — a recorder replay owns the document —
the audio loop shall write nothing to the flame and shall forget where its clock
stood, rather than charge the envelope for the whole suspended interval: the
microphone loop clears its `lastTickTime`, so the first tick after resuming uses a
fresh `dt`, and the file loop forgets the analyzer frame it stepped last, so the
first tick after resuming steps the frame under the playhead alone. The transport
clock shall keep advancing.

_(`useAudioReactive.ts:250-259` (`modulationSuspended`), `:315-319` (`modulationSuspended`); guarded, for the
microphone, by `useAudioReactive.test.ts:52` "freezes both the overlay and smoothing time while replay owns the document".)_

---

### The wiring editor

### REQ-TA-035 — One wire per target

**When** the user connects an audio source to a target that already has a wire,
the wiring editor shall remove the existing mapping, add the new one, and surface
a non-blocking replacement toast naming the displaced source for 2.5 s. **If** the
target is already wired to that same source, **then** the editor shall select the
existing wire and change nothing.

_(`AudioWiringModal.tsx:643-678` (`doConnect`).)_

### REQ-TA-036 — A new wire is audible by default

**When** a wire is created by drag or click, the editor shall give the entry
`sensitivity: 0.3`, `attackMs: 40`, `releaseMs: 150`, and a range of `[0, 1]` —
or `[0.5, 1.5]` **where** the target is camera zoom, for which `[0, 1]` would
collapse the view.

_(`AudioWiringModal.tsx:36-42` (`NEW_ENTRY_DEFAULTS`), `:662-669` (`isZoom`).)_

### REQ-TA-037 — Imported wiring is checked against the wiring schema before it is applied

**If** pasted or loaded wiring text is not JSON, or does not fit the schema the
flame and the commands use for wiring rows (`AudioMappingEntries`: at most 512
rows, each with a known feature, a well-formed target and a finite sensitivity
and range), **then** the editor shall keep the import panel open with the
complaints in words, each naming its row and field (the first three, and a
count of the rest), and leave the current mappings untouched. **If** the
workspace refuses wiring the editor passed on, **then** the panel shall stay
open and say that nothing changed. A valid import shall replace the mappings,
record an undo entry and close the panel. `audio.setMapping` shall refuse a
mapping the schema rejects before it is recorded, and tell its caller; a
refused mapping shall change nothing, so it shall not take the workspace back
from a timed replay either.

_(`wiringImport.ts:14-33` (`parseWiringImport`), `packages/core/src/schema/audioWiring.ts:128-136` (`validateAudioMappingEntriesWithErrors`),
`AudioWiringModal.tsx:1039-1063` (`applyImport`), `commands/builtins/audio.ts:115-120` (`rejectArgs`), `commands/registry.ts:516-520` (`refusal`), `:563-567` (`rejectArgs`); guarded by
`AudioWiringModal.import.test.tsx:54` "keeps the panel open and says why when a row does not fit",
`:66` "keeps the panel open when the workspace refuses the wiring" and
`commands/builtins/audio.test.ts:224` "is refused before it is recorded, and the caller hears so" and
`commands/registry.test.ts:487` "leave a replay preview alone, while an accepted one hands it back". The editor keeps its own
50-entry undo stack at `AudioWiringModal.tsx:503` (`MAX_UNDO`), `:693-721` (`saveForUndo`), cleared of redo on every mutating operation.)_

### REQ-TA-038 — Editor shortcuts never steal keys from a text field

**If** a keydown originates from an `INPUT`, `TEXTAREA` or `SELECT`, **then** the
editor shall not handle undo/redo or delete for it. Escape shall unwind exactly
one layer per press, in the order import panel → pending paste → active drag →
pending connection → selected wire → close the modal.

_(`AudioWiringModal.tsx:863-923` (`isEditableTarget`).)_

### REQ-TA-039 — Audio-driven motion is held to a comfort preset

**When** a mapping drives a target, the value shown shall pass the comfort
governor of the active preset, `calm`, `standard` or `intense`, in the units the
renderer shows it in:

- zoom shall move no faster than 0.15 / 0.35 / 0.7 e-folds per second and span no
  more than 0 / 0.02 / 0.05 e-folds inside any 5 s, so on `calm` audio holds zoom
  still;
- `palettePhase` shall turn no faster than 15 / 45 / 120 degrees per second the
  shorter way round;
- a brightness setting shall move no faster than 0.3 / 0.6 / 1.5 per second and
  span no more than 0.10 / 0.18 / 0.35 inside any 500 ms: exposure in its own units
  (it is already an ln gain, and may be negative), vibrancy and highlight, light and
  depth colour power linearly, contrast and gamma in ln units down to their schema
  minimum;
- affine coefficients, transform properties and variation weights shall move no
  faster than their preset's caps.

A window holds every pair of outputs up to its length apart, the pair exactly one
window apart included. The caps limit parameters, not the measured luminance of
the rendered frame. The governor shall take a mapped value, and the authored value
it starts from, as near as the renderer can show it: inside the schema's range for
a render setting (zoom's is the camera's) and no lower than `0.001` for a
transform probability, so a row that asks past a bound turns back the frame its
music does.

A target's first governed frame shall start from the value the authored flame
shows. **When** a target's mapping leaves the wiring — a row removed, a preset
without it, its target switched, the last row cleared — the target shall keep
being governed back to its authored value, or the nearest value it can show, and
leave the overlay once within its mapping's dirty threshold of it (REQ-TA-031);
one that returns before then shall turn round from the value on screen. Home, it
shall stay governed, off the overlay, for one window of its own, 500 ms for a
brightness setting and 5 s for zoom. Through that window the governor shall
record the value the authored flame shows, which a timeline or an edit may still
move, as shown and without caps, and one that returns inside the window shall
turn round from that value and be held to everything the window showed, its
release included. The overlay shall stay up, with nothing on it if nothing else
is, until no target is on its way home or resting there, and only then come
down. One the flame no longer carries shall leave at once. Only the overlay
coming down — audio off, a mic restart, a replay taking the document — or a
release the preset holds still, zoom on `calm`, may cut to the authored value in
one frame, and the governor shall start over for what it cut. The `calm` cut is
as large as the zoom the row built up before the switch, up to the row's whole
span. A preset change shall apply from the current values
without a jump: each window keeps the outputs already in it and holds them to
the new range. A step of no time, or of a value that is not finite, shall move
nothing, and on a target's first step such a value shall show the authored one.
A stalled tick shall count as 0.1 s at most, so the frame after a stall moves one
capped 0.1 s step.

_(`comfortGovernor.ts:342-401` (`createComfortGovernor`), `:240-279` (`advance`), `:224-237` (`record`), `:104-139` (`renderRule`), `:49-75` (`schemaSlew`), `comfortPresets.ts:90-94` (`COMFORT_CAPS`),
`audioModulator.ts:82-211` (`createAudioModulator`), `:93-149` (`release`), `:202-204` (`idle`), `useAudioReactive.ts:119-125` (`settleModulation`); guarded by `comfortGovernor.test.ts:57` "holds a slow square wave inside the window range on %s at %i fps",
`:81` "holds a 12 Hz square wave on exposure inside the window range", `:231` "holds %s %s to the window range across its domain",
`:302` "holds %s at its schema bound %d and turns back the next frame",
`:346` "holds %s zoom under %s at %i fps to its range inside any 5 s", `:393` "holds zoom at its authored value in Calm",
`:422` "never turns palettePhase faster than the hue cap", `:495` "moves at most one capped step after a stall",
`:518` "starts the next step from a tracked value, which the window holds like an output",
`:582` "shows the authored value for a first value of %d, then eases in from it", `:616` "keeps the window through a switch to a wider preset",
`audioModulator.test.ts:132` "turns Pulse's bass row at sensitivity 2 back as soon as the bass drops, on %s",
`:197` "governs a departing target back to its authored value", `:222` "eases a target back in when its mapping returns",
`:241` "keeps the window of a target home from its release when it returns, on %s %i frames after",
`:276` "keeps the 5 s zoom window of a target home from its release, on %s %i frames after",
`:310` "ends a zoom release on Calm, which holds zoom still, by cutting to the authored zoom",
`:341` "ends a probability release when the authored weight is under the writer's floor",
`:367` "ends the release of a value authored past the schema at the bound",
`:404` "returns on %s from the screen when the authored value moves %i a second through the rest, %i frames after arrival",
`:480` "switches Bloom to Drift and back inside 300 ms without a flash",
`useAudioReactive.test.ts:113` "eases the overlay in from it, and again after the mic restarts",
`:214` "governs its target home before the overlay comes down" and
`:416` "holds the %s window when the row returns %i frames after its target is home".)_

**While** a file drives the flame, the live loop shall step every analyzer frame the
playback clock passed since its last tick, each one analyzer frame long, reading the
analyzer at its real rate: a frame is a whole number of samples, so 44.1 kHz asked
for 24 frames a second runs at 24.0065. After a stall it shall step only the last
0.1 s of frames, and after a seek back only the frame under the playhead. An export
shall step every analyzer frame up to the one at output frame n's time, n / fps,
and the frames one output frame steps shall share its 1 / fps, so governed time is
the video's own: every comfort window holds in the time the video plays in, a
preview and an export of the same track agree, and no beat between two frames is
lost.

_(`useAudioReactive.ts:261-292` (`analyzerFrameRate`), `exportAudioModulation.ts:36-93` (`createExportAudioModulation`),
`audioModulator.ts:44-56` (`analyzerFrameRate`); guarded by `useAudioReactive.test.ts:315` "still delivers a beat that sits on the frame the tick skipped",
`exportAudioModulation.test.ts:135-140` "steps every analyzer frame up to the one at each output frame's time, at %i fps from %i Hz",
`:185` "holds the %s windows in video time at %i fps from %i Hz",
`:233` "hears a real analyzer's music at the output frame of its time" and
`exportAudioWiring.test.ts:45` "carries the eased, governed values, not the mapped ones".)_

The preset shall be chosen in the Audio Reactive panel's Comfort control and
remembered across sessions. With no choice made it shall be `calm` when the
system asks for reduced motion and `standard` otherwise. A preset chosen while
audio drives the flame shall apply from the next frame.

_(`comfortPreference.ts:22-27` (`initialComfortPreset`), `:44-47` (`setComfortPreset`); guarded by
`comfortPreference.test.ts:40` "is calm when the system asks for reduced motion", `:46` "remembers a choice, which wins over the system" and
`useAudioReactive.test.ts:166` "follows a preset chosen while the overlay runs".)_

### REQ-TA-040 — A target keeps pointing at what it was wired to

**Where** a transform target carries its transform's key (`transformId`), the
mapper shall find the transform by that key and not by `transformIdx`; **where**
a variation-weight target carries its variation's key (`variationId`), it shall
find the variation by that key and not by type. Per-target state (smoothing, the
comfort limiter, the editor's wires) shall be keyed the same way, so two
variations of one type are two targets. **Where** a target carries no key,
as wiring saved before targets carried them does, it shall resolve by position
and variation type as before. Presets, Randomize and the wiring editor shall
write keys. **When** wiring is set (the `audio.setMapping` command, a replayed
audio snapshot, a session's starting wiring), the workspace shall store each
legacy target with the keys of what sits at its position in the open flame, so
the target follows that transform through a reorder; a target that already
carries keys shall keep them, dangling ones included. **If** a key names a
transform or a variation the flame no longer has, **then** the target shall
drive nothing and its row shall say the transform was deleted. **When** wiring is pasted onto another transform, it shall name
that transform; **when** imported wiring names no transform of the open flame,
its keys shall be dropped and it shall be placed by position.

_(`audioTargets.ts:66-81` (`targetTransform`), `:87-105` (`targetVariation`), `audioMapping.ts:116-118` (`flameTargetKey`),
`audioTargetIds.ts:78-90` (`reconcileTransformTargets`), `:98-115` (`retargetTransform`), `:131-146` (`adoptImportedWiring`), `:180-190` (`keyLegacyWiring`),
`commands/builtins/audio.ts:81` (`keyLegacyWiring`), `:161` (`keyLegacyWiring`), `hooks/useWorkspaceReplay.ts:293` (`keyLegacyWiring`); guarded by
`audioTargets.test.ts:128` "drives two variations of one type separately", `:138` "follows its transform when the flame is reordered",
`:152` "goes inert when its transform or variation is gone", `audioTargetIds.test.ts:130` "takes wiring from another flame by position",
`AudioReactivePanel.rows.test.tsx:75` "says so when the transform a row drives was deleted",
`AudioWiringModal.paste.test.tsx:46` "names the transform the wiring is pasted onto",
`commands/builtins/audio.test.ts:310` "follows its transform after a reorder",
`:319` "goes inert after its transform is deleted, and stays inert when set again",
`:333` "keys a legacy row inside a replayed snapshot too" and
`useWorkspaceReplay.legacyWiring.test.ts:12` "gives a legacy row the keys of the transform at its position".)_

### REQ-TA-042 — The editor shows, and can reach, the envelope a row runs at

**Where** a row sets only one of `attackMs` and `releaseMs`, the wiring editor
and the panel rows shall show the other as the time the envelope uses for it
(REQ-TA-029), and **where** it sets neither, both as 0 ms. The editor's attack
slider shall reach 3000 ms and its release slider 6000 ms; **if** a row holds a
longer time, **then** the slider shall widen to it rather than clamp it when
touched. Every row in the audio panel shall show its attack and release.

_(`audioEnvelope.ts:19-27` (`effectiveEnvelope`), `:10` (`ATTACK_MAX_MS`), `:12` (`RELEASE_MAX_MS`),
`ParamsPanel.tsx:160` (`ATTACK_MAX_MS`), `:184` (`RELEASE_MAX_MS`),
`AudioReactivePanel.tsx:1147` (`envelopeLabel`); guarded by
`audioEnvelope.test.ts:15` "runs an unset attack at the release, as the envelope does",
`ParamsPanel.test.tsx:39` "reach a three-second attack and a six-second release",
`:52` "keep an imported time past their end instead of clamping it" and
`AudioReactivePanel.envelope.test.tsx:48` "names the attack and release each row runs at".)_

### Wiring that travels with a flame

### REQ-TA-041 — Audio wiring travels with a flame, and never switches audio on

**When** the share dialog makes a link and the workspace has audio wiring the
user made (it has rows and differs from the default wiring every workspace
starts with), the dialog shall offer to send the wiring along, switched on, and
the link and its Copy JSON shall carry the rows only while it is on. **While**
the wiring is the default, the dialog shall not offer it, and neither the link
nor Copy JSON shall carry it. **When** a share link that carries wiring
opens, the workspace shall make that wiring current and leave audio off if it
was off. **If** the carried wiring does not fit the wiring schema, **then** the
workspace shall drop the wiring and still open the flame. A link that carries
no wiring, including every link made before links could, shall leave the
workspace's wiring as it is.

**When** the workspace writes the open flame to Recents (the autosave, Save for
Later, the flush before another flame opens, the save a native app makes on
pause, an image export from the dialog, the quick export or a script), it
shall store the audio wiring with it, and a change to the wiring
alone shall count as unsaved work. **When** a Recents entry that carries wiring
opens, from the Library, the welcome screen or a cold-start reopen, the
workspace shall make that wiring current and leave audio off if it was off. A
stored wiring that does not fit the wiring schema shall be dropped and its
entry kept, and an entry written before entries carried wiring shall open with
the workspace's wiring unchanged.

**When** a flame's JSON that carries wiring (the share dialog's Copy JSON) is
dropped on the canvas or opened from the Library, the workspace shall open the
flame and make the wiring current the same way. A dropped JSON file shall open
as a flame when it holds one, and as a steps session only when it does not. A
dropped Recents record shall open as its flame and wiring; the tracks and
timeline it keeps at its top level are read by the Library only. **If** a
dropped JSON file is larger than 8 MB, **then** the workspace shall refuse it
by name without calling it a steps session.

_(`jsonQueryParam.ts:174-191` (`buildSharePayload`), `:294` (`parseAudioWiring`),
`audioWiringParse.ts:8-14` (`parseAudioWiring`), `lib/audioWiringLoad.ts:13-19` (`restoreLoadedAudioWiring`),
`MainWorkspace.tsx:3004` (`restoreLoadedAudioWiring`), `utils/shareLink.ts:33-41` (`userAudioWiring`), `ShareLinkModal.tsx:58-62` (`sharedAudioWiring`); guarded by
`jsonQueryParam.test.ts:50` "travels with the flame",
`:58` "is dropped on its own when it does not fit, and the flame still opens",
`:70` "is absent from a link made before links carried it",
`ShareLinkModal.test.tsx:101` "sends the wiring along until it is switched off",
`:123` "sends no wiring, and offers none, while the wiring is the default",
`:130` "knows the default after the wiring schema has rebuilt it",
`:139` "copies JSON with the wiring only when the user made it" and
`lib/audioWiringLoad.test.ts:47` "puts the rows back and leaves audio off".)_

_(`recentFlames.ts:128-140` (`readStoredEntry`), `useWorkspaceAutosave.ts:138` (`getAudioMapping`),
`flameLoad.ts:34-46` (`flameLoadOf`), `MainWorkspace.tsx:2775` (`restoreLoadedAudioWiring`),
`:799` (`restoreLoadedAudioWiring`), `pauseSave.ts:226` (`audio`), `ExportJobHost.tsx:83-89` (`saveImageJobToRecents`),
`ExportPngDialog.tsx:1103` (`getAudioMapping`), `:1307` (`getAudioMapping`); guarded by
`recentFlames.test.ts:764` "comes back with the entry Save for Later stored it in",
`:794` "is dropped when it does not fit, and its entry stays",
`ExportJobHost.recents.test.ts:69` "keeps the audio wiring it was exported under",
`quickExport.test.tsx:186` "files the audio wiring with the flame in Recents",
`useWorkspaceAutosave.test.ts:773` "is unsaved work on its own, and the write stores it",
`flameLoad.test.ts:35` "carries the audio wiring, even for an entry with no animation",
`pauseSave.test.ts:520` "reopens it with the audio wiring it was kept with" and
`workspaceHandoff.test.ts:119` "arrives with the flame, and a later seeding without one clears it".)_

_(`useLoadFlameFromFile.ts:31-48` (`readFlameJson`), `:89` (`readFlameJson`), `:63-68` (`MAX_SESSION_JSON_CHARS`), `flameImport.ts:161` (`parseAudioWiring`),
`useAppDragAndDrop.ts:57` (`audio`); guarded by
`useLoadFlameFromFile.test.ts:64` "opens a bare flame descriptor as that flame",
`:70` "opens a share payload with its animation and audio wiring",
`:79` "still opens a steps session as a session",
`:98` "says a JSON file is too large without calling it a steps session",
`:111` "opens a Recents record as its flame and wiring, without its timeline",
`useAppDragAndDrop.test.ts:46` "hands the dropped flame its audio wiring" and
`flameImport.test.ts:159` "drops audio wiring that does not fit, and keeps the flame".)_

---

## Coverage gaps

Requirements below have **no test whose assertion goes red when the requirement is
violated**. Naming a nearby test file would be a false claim of coverage, so they
are listed instead.

| Requirement                        | Why it is unguarded                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-TA-003                         | No test registers a value writer and then calls `addKeyframe` at the current frame. `timelineUndo.test.ts:315-352` "value write-back on undo/redo" exercises the write-back on **undo/redo** only.                                   |
| REQ-TA-006                         | `relocateKeyframe`'s "destination occupied" guard is never exercised. `recorder/timelineActions.test.ts:478` (`relocateKeyframe`) calls it, but asserts command coalescing, not the guard.                                           |
| REQ-TA-012 (strings)               | Array blending is tested; the string/boolean hold path (`utils/timeline.ts:664-667` (`prev`)) is not.                                                                                                                                |
| REQ-TA-013                         | Nothing asserts the two easing copies agree, and nothing imports the core copy, so drift is invisible.                                                                                                                               |
| REQ-TA-020                         | `keyframeOnChange.ts` has no test file. Neither the Auto-mode "already animated" filter nor the `animationEnabled` gate is covered.                                                                                                  |
| REQ-TA-021                         | **Actively hidden.** `useWorkspaceTimelineBinding.test.ts:11-12` mocks `isDrivingView` and `hasKeyframeAtFrame` to return `false` unconditionally, so the defective branch never runs in any test.                                   |
| REQ-TA-022                         | Same mock, same reason.                                                                                                                                                                                                              |
| REQ-TA-024                         | `isDrivingView` has no unit test; its three-term definition is only exercised through the app.                                                                                                                                       |
| REQ-TA-025                         | Neither the `previewHeld` latch nor the scrub gesture lifecycle is tested. `tests/timeline.ci.spec.ts:51` "steps and seeks the playhead from the transport bar" seeks with the transport buttons but asserts only the frame readout. |
| REQ-TA-026                         | The advance **arithmetic** is tested (`utils/timeline.test.ts:435-463` "advanceFrame"); the interval rate, `timeScale` multiplication, the Auto-FPS handoff and the EMA are not.                                                     |
| REQ-TA-033                         | `useAudioReactive.test.ts` covers suspension, the mic restart and the file loop's frame stepping. Nothing covers transport-without-reactivity or seek.                                                                               |
| REQ-TA-034 (file loop)             | `useAudioReactive.test.ts` drives the microphone loop through a suspension. Nothing drives the file loop through one.                                                                                                                |
| REQ-TA-035, REQ-TA-036, REQ-TA-038 | `AudioWiringModal.tsx` has **no e2e coverage**, and its two render tests import wiring (REQ-TA-037) and paste it (REQ-TA-040). Nothing drives connecting, the new-wire defaults or the shortcuts.                                    |

# Audio-Reactive Animation Channels

Per-timeline-track audio channel drivers that modulate resolved keyframe values
with audio features — exactly IFSRenderer's `AudioChannelDriver` + `Spectrogram`
architecture. A spectrogram strip sits under the timeline; each track can opt
into an audio driver that post-processes the resolved value before it hits the
flame.

Status: **planning** (2026-08-03)

---

## 1. Background — what we have vs what's missing

### Already built

- **Audio analysis** (`utils/audioAnalysis.ts`, 831 lines): custom FFT, 8-band
  spectral decomposition (sub-bass through brilliance + full spectrum), RMS,
  spectral centroid, spectral flatness, onset detection, beat detection.
  `AudioAnalyzer` (offline, frame-indexed) and `LiveAudioAnalyzer` (real-time
  mic). Smoothing envelope (attack/release) on mapped values.

- **Audio-reactive panel** (`AudioReactivePanel.tsx`, 42 KB):
  upload/decode/analyse audio, assign `AudioFeature → FlameTarget` mappings
  with sensitivity and range, preset library (Pulse/Groove/Ambient/Chaos),
  real-time flame modulation, waveform preview with beat markers.

- **Audio wiring modal + node graph** (`AudioWiringModal/`):
  draggable node-graph editor (`NodeGraphView.tsx`, 41.7 KB) for visually
  wiring audio sources to flame targets, `WireOverlay` with SVG bezier
  connections, per-transform target picker.

- **Animation export with audio** (`animationExport.ts`):
  `AudioAnalyzer.getFrameData(frameIndex)` → `applyAudioMappingsToFlame()`
  applied per-frame during export; `AudioEncoder` muxes AAC track into MP4.
  This means the **export path already knows how to consult audio per frame**.

- **Timeline resolver** (`utils/timeline.ts`):
  `resolveKeyframeValue(keyframes, frame)` → value, then
  `resolveLoopValue(keyframes, frame, opts)` wraps it with loop synthesis.
  Every value consumer routes through this one choke point.

- **Spline curve editor** (`Timeline/CurveEditor/`): Phase 1-2 shipped
  (Catmull-Rom interpolation, visual SVG graph). Phase 3 lists
  "audio-reactive channels" as the next extension.

- **Sonification panel** (`SonificationPanel.tsx`, 10.5 KB): real-time
  fractal→audio (the inverse direction). Exists, not touched by this plan.

### The gap

The current audio-reactive system drives flame parameters **globally** — a
single set of `AudioMappingEntry[]` mappings applied to the whole flame,
independent of the timeline. There is no way to:

1. Attach an audio driver to a **specific timeline track** so its keyframed
   value is modulated by an audio feature.
2. See a **spectrogram** under the timeline to visually align keyframes with
   musical events.
3. Have different tracks respond to different audio features (e.g. camera
   zoom → bass, palette phase → hi-hats).

This is exactly the gap IFSRenderer fills with `AudioChannelDriver` (a
per-channel modulation post-step) + `Spectrogram` (a frequency-domain strip
under the animation view).

---

## 2. Design

### 2.1 Architecture: post-resolver modulation

```
TimelineTrack
  ├── keyframes[]          ← existing
  ├── interp/easing        ← existing
  └── audioDriver?         ← NEW (optional)
        ├── feature: AudioFeature   (which band/feature to follow)
        ├── mode: 'multiply' | 'add' | 'replace'
        ├── sensitivity: number
        ├── range: [number, number]
        ├── attackMs?: number
        └── releaseMs?: number

resolveKeyframeValue(kfs, frame)          → rawValue (number | string | array | ...)
audioDriver.apply(rawValue, frameData)    → modulatedValue (same type)
```

The driver is a **post-step** after the resolver. The spline curve editor plan
already describes this hook point:

> gate behind the resolver post-step (`value = driver ? driver.apply(value, frame) : value`),
> exactly IFSRenderer's hook point.

### 2.2 Where it plugs in

There is exactly **one choke point** that every value consumer goes through:
`resolveLoopValue` (live playback, export, loop synthesis, scrubbing). Adding
the driver there lights up everywhere for free — same strategy used when
adding spline interpolation to `resolveKeyframeValue`.

```ts
// resolveLoopValue, post natural-resolution:
const natural = resolveKeyframeValue(keyframes, frame)
if (track.audioDriver && typeof natural === 'number') {
  const frameData = getDriverFrameData(frame) // AudioAnalyzer or LiveAnalyzer
  return track.audioDriver.apply(natural, frameData)
}
return natural
```

**Export path** (`animationExport.ts`) already calls `resolveLoopValue`
indirectly through `writeBackResolvedValues` — so modulated values flow
through automatically. No export-path changes needed.

**Live playback** in `MainWorkspace` / `Flam3.tsx` also routes through the
same resolver. When a `LiveAudioAnalyzer` (mic) is active, the driver's
`getFrameData()` consults the live analyzer instead of the offline one.

### 2.3 Data model

```ts
// flame/schema/timeline.ts — additive, defaulted → back-compat

export const AudioDriver = v.object({
  feature: AudioFeatureSchema, // 'bass' | 'centroid' | 'beat' | …
  mode: v.picklist(['multiply', 'add', 'replace']),
  sensitivity: v.pipe(v.number(), v.minValue(0), v.maxValue(10)),
  range: v.tuple([v.number(), v.number()]),
  attackMs: v.optional(v.number(), 0),
  releaseMs: v.optional(v.number(), 0),
})
export type AudioDriver = v.InferOutput<typeof AudioDriver>

// Add optional audioDriver to TimelineTrack
export const TimelineTrack = v.object({
  parameterPath: v.string(),
  keyframes: v.array(Keyframe),
  audioDriver: v.optional(AudioDriver), // NEW, defaulted → back-compat
})
```

`AudioFeatureSchema` is a valibot `v.picklist([...])` mirroring the
`AudioFeature` union in `audioAnalysis.ts` (kept in sync like
`KeyframeInterpolation`).

### 2.4 Spectrogram strip

A canvas/SVG strip rendered **under the dope sheet tracks**, horizontally
aligned with the timeline ruler. One strip shared across all tracks (not
one-per-track — IFSRenderer uses a single spectrogram).

- **X-axis**: frame number (same zoom/scroll/pan as the dope sheet ruler).
- **Y-axis**: frequency bins (8 bands, sub-bass → brilliance), log-spaced.
- **Color**: amplitude mapped through the flame's active palette (or a
  dedicated heatmap LUT), dark background.
- **Overlay**: beat markers as vertical lines, onset strength as subtle
  opacity pulses.

**Data source**: when a file is loaded, `AudioAnalyzer` is pre-computed
(frame-indexed). The spectrogram samples `getFrameData(i).bands` for every
frame and renders with a 1-pixel-wide column per frame (subsampled at low
zoom). When using live mic, the spectrogram scrolls in real-time, showing
the last N seconds of FFT history (ring buffer of ~10 seconds).

**Implementation**: `<canvas>` element inside the dope sheet scroll container,
synced to the same `scrollLeft` / `zoom` transform as the tracks. Re-render
on zoom/scroll change via `requestAnimationFrame`.

### 2.5 UI: assigning a driver to a track

**Track context menu** (right-click a track in the dope sheet):

- New item: "Add Audio Driver…" (or "Edit Audio Driver" if one exists)
- Opens a compact inline popover (not the full AudioWiringModal):
  - **Feature** dropdown: Sub-Bass, Bass, Low-Mid, Mid, Hi-Mid, Presence,
    Brilliance, Full Spectrum, RMS, Centroid, Flatness, Beat, Onset
  - **Mode** radio: Multiply (×), Add (+), Replace (=)
  - **Sensitivity** slider (0-10)
  - **Range** min/max number inputs
  - **Attack/Release** sliders (0-500 ms)
  - **Remove driver** button (if one exists)
  - **Preview**: a tiny sparkline showing the audio feature's value over the
    timeline span, with the track's keyframe diamonds overlaid

**Visual indicator on the track**: when a track has an audio driver, show a
small waveform icon (SVG from `src/icons`) next to the track label. The
track's diamonds in the dope sheet get a subtle color tint.

### 2.6 Driver modes

| Mode       | Formula                                         | Use case                                               |
| ---------- | ----------------------------------------------- | ------------------------------------------------------ |
| `multiply` | `value * (1 + featureNorm * sensitivity)`       | Intensity modulation: zoom, exposure, vibrancy, weight |
| `add`      | `value + featureNorm * sensitivity * rangeSpan` | Offset modulation: camera position, rotation, phase    |
| `replace`  | `lerp(value, featureNorm, sensitivity)`         | Full takeover: palette phase, draw mode transitions    |

`featureNorm` is `getAudioFeatureNormalized(frameData, feature)` (0–1),
already implemented. The `range` tuple clamps the output (safety net).

---

## 3. Implementation phases

### Phase 1 — Core driver + resolver integration

**Files to create:**

- `utils/audioDriver.ts` — `AudioDriver` type (shared), `applyAudioDriver(value, frameData, driver): number`, `getDriverFrameData` dispatching helper

**Files to modify:**

- `flame/schema/timeline.ts` — `AudioDriver` valibot schema, `audioDriver` field on `TimelineTrack`
- `utils/timeline.ts` — `KeyframeData` runtime type (add `audioDriver?`), `resolveLoopValue` (apply driver post-resolution), `resolveKeyframeValue` (same — live path), `createTimelineState` (expose `setTrackAudioDriver` op), `writeBackResolvedValues` (routes through same resolver so no changes needed)
- `utils/audioAnalysis.ts` — export `AudioFeature` as a const array for valibot `picklist` generation

**Acceptance:** existing tracks with no driver resolve byte-identically to
today (back-compat); a track with a multiply driver on `bass` visibly pulses
when audio plays during timeline playback; export produces identical frames
with driver removed; typecheck + lint green.

### Phase 2 — Spectrogram strip

**Files to create:**

- `components/Timeline/SpectrogramStrip.tsx` — canvas-based spectrogram
- `components/Timeline/SpectrogramStrip.module.css`

**Files to modify:**

- `components/Timeline/DopeSheet.tsx` — render `<SpectrogramStrip>` below the
  track list, wired to the same horizontal scroll/zoom state
- `components/Timeline/TimelineSection.tsx` — pass audio buffer/analyzer down

**Acceptance:** spectrogram renders when audio is loaded; scrolls/zooms in
sync with tracks; beat markers align with waveform peaks; zero-cost when no
audio loaded (canvas hidden/not mounted).

### Phase 3 — Track-level driver UI

**Files to create:**

- `components/Timeline/AudioDriverPopover.tsx` — compact driver editor
- `components/Timeline/AudioDriverPopover.module.css`

**Files to modify:**

- `components/Timeline/TrackContextMenu.tsx` — add "Audio Driver" item
- `components/Timeline/DopeSheetTrack.tsx` — waveform icon indicator on
  driver-equipped tracks
- `components/Timeline/KeyframeInspector.tsx` — show driver status for
  selected track, quick-toggle to enable/disable

**Acceptance:** right-click track → "Add Audio Driver" → popover opens;
configure bass ×2 sensitivity → track shows waveform icon; playback with
audio → track value visibly modulated; remove driver → track reverts to
pure keyframe interpolation.

### Phase 4 — Live mic + spectrogram scrolling

**Files to modify:**

- `components/Timeline/SpectrogramStrip.tsx` — ring buffer mode for live
  `LiveAudioAnalyzer`; scroll with playback head
- `components/Timeline/AudioDriverPopover.tsx` — show "Live (Mic)" as
  feature source option when mic is active

**Acceptance:** switch audio source to mic; spectrogram scrolls in real-time
showing last 10s of FFT history; drivers respond to live audio during
timeline playback.

---

## 4. Scope and non-goals

### In scope

- Per-track optional audio driver that modulates resolved keyframe values
- Spectrogram visualization under the timeline
- Compact driver editor UI (popover)
- Works with both file audio (offline analyzer) and live mic (live analyzer)
- Back-compat: tracks without a driver are byte-identical
- Export: modulated values flow through existing resolver → export path automatically

### Not in scope (separate plans)

- **Multi-track audio mixing** (multiple audio files, each driving different
  tracks) — the current system is single-audio-file. This could follow later.
- **Audio-reactive curve editor preview** (live waveform behind the curve
  graph) — deferred to a future plan.
- **Generative audio / tempo extraction** — belongs in `docs/audio-fractals.md`
  brainstorm items.
- **Changing the AudioWiringModal** — the node-graph wiring system drives
  the flame globally; this plan adds per-track drivers alongside it. They
  compose (global mappings + per-track modulation both apply). Document the
  composition order but don't change the wiring modal.
- **MIDI / external clock sync** — out of scope.

---

## 5. Composition order

When both global audio mappings (AudioWiringModal) and per-track drivers are
active, the order is:

```
1. Resolve keyframe value           ← resolveKeyframeValue / resolveLoopValue
2. Apply per-track audio driver     ← audioDriver.apply(rawValue, frameData)
3. Write modulated value to flame   ← writeBackResolvedValues
4. Apply global audio mappings      ← applyAudioMappingsToFlame (existing)
5. Render frame
```

Global mappings always win (they're the outermost layer), but per-track
drivers give fine-grained modulation that keyframes alone can't express.
Document this in the AudioDriverPopover tooltip.

---

## 6. Testing strategy

- **Unit** (`utils/timeline.test.ts`): driver apply with multiply/add/replace
  modes; null driver is no-op (back-compat); driver on non-number value is
  no-op; edge cases (zero sensitivity, out-of-range feature value).
- **Integration** (`utils/audioDriver.test.ts`): `applyAudioDriver` with real
  `FrameData` from a known sine sweep; output clamped to range; attack/release
  smoothing envelope correct.
- **Export regression**: existing export test with audio mappings produces
  identical frames when no per-track drivers are set; export with a driver
  produces different (modulated) frames.
- **Component smoke**: `AudioDriverPopover` renders, saves driver to track,
  remove clears it.

---

## 7. Files touched (summary)

| File                                         | Change                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `utils/audioDriver.ts`                       | **NEW** — `applyAudioDriver`, driver types                              |
| `flame/schema/timeline.ts`                   | Add `AudioDriver` schema, `audioDriver` on `TimelineTrack`              |
| `utils/timeline.ts`                          | `KeyframeData.audioDriver`, resolver integration, `setTrackAudioDriver` |
| `components/Timeline/SpectrogramStrip.tsx`   | **NEW** — canvas spectrogram                                            |
| `components/Timeline/AudioDriverPopover.tsx` | **NEW** — driver editor popover                                         |
| `components/Timeline/DopeSheet.tsx`          | Render spectrogram strip                                                |
| `components/Timeline/TrackContextMenu.tsx`   | "Audio Driver" menu item                                                |
| `components/Timeline/DopeSheetTrack.tsx`     | Waveform icon indicator                                                 |
| `utils/audioAnalysis.ts`                     | Export `AudioFeature` const array for valibot                           |

---

## 8. Risks

- **Resolver is a binary file** (`timeline.ts` is marked binary — likely
  contains embedded null bytes). Editing it requires care; use `grep -a` to
  navigate, and verify the file still parses after edits.
- **Schema change is additive + defaulted** so old saved/shared/embedded-PNG
  animations load unchanged. Round-trip test required.
- **Per-frame audio lookup during export** already works (see
  `animationExport.ts:181`); drivers add a second lookup in the resolver.
  Ensure the `AudioAnalyzer` instance is shared (singleton per export run).
- **Spectrogram canvas performance**: at full zoom with 1000+ frames,
  rendering every 1px column could be costly. Subsampling strategy: compute
  max amplitude per pixel-column at low zoom; switch to per-frame at high
  zoom (< 2px per frame).

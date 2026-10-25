# Glasswake patterns and resonance

25 October 2026. Desktop practice on the existing crystal instrument and audio
owner. Physical headset acceptance remains separate.

## Play

Open Glasswake in the observatory. **Hear pattern** demonstrates all three
notes; **Stop pattern** ends the demonstration. Then hold each target note until
the glass settles and shows **Release**. Release deliberately to open its seal.
**Hear note** plays the current target. Pointer movement tunes vertically;
keyboard arrows tune and Enter starts or releases a hold.

The original **First light** earns the Glasswake Almanac page. After earning it,
two further patterns become available:

| Pattern       | Notes    | Contour                  | Tempo  |
| ------------- | -------- | ------------------------ | ------ |
| First light   | C4–E4–G4 | Open a major triad       | 82 BPM |
| High glint    | C4–G4–C5 | Reach the upper octave   | 78 BPM |
| Falling light | G4–E4–C4 | Return through the triad | 76 BPM |

These are guided instruments, not microphone or singing scores. Practice never
replaces the earned page's original motif or changes the temple arrangement.

## Input and sound

- The whole-pattern demonstration blocks playing until it finishes or is
  stopped. Hear note can replace it with a single target reference.
- Selecting another pattern stops the current instrument, releases captured
  input and resets the attempt. It does not start playback.
- Rebuild keeps the selected pattern. Leaving and re-entering restores First
  light. Practice selections are visit-local; saved progress keeps its existing
  schema and identity.
- Cancellation, focus loss and hidden tabs never count as a musical release.
  Only an armed hold followed by deliberate release opens a seal.
- The existing ambience remains separately opt-in. Instrument changes do not
  enable it. Reloading never starts either sound path.

## Glass feedback

Fissures spread from the centre of the active petal towards its tips as resonance
builds. At full charge, vibration settles and a steady warm seam marks the
release opportunity. The existing shatter, glitter and recovery animation remain.
Cancelled holds clear the charge cue immediately.

This uses the existing 48 shards, instance buffers and draw bounds. No new asset,
texture, audio context or persistent GPU resource is required. Reduced-motion
and clay inspection retain their existing behaviour.

## Verification

Unit tests cover every authored pattern, invalid state, interrupted holds,
deliberate release and fissure progression. The standalone hardware browser
script `scripts/verifyGlassPhrases.ts` exercises the actual UI, persistence and
shared Tideweave selector, with separate emitted-production layout checks.
Point `VERIFY_BASE_URL` at the preview and `VERIFY_OUT_DIR` at a registered
agent-output directory; use the script's hidden `agent-browser` launch options.
Run with `pnpm exec tsx --tsconfig tsconfig.test.json scripts/verifyGlassPhrases.ts`
from this package so runtime aliases resolve. `VERIFY_MODE=production` selects
the separate emitted-build layout pass.
Never use the root Playwright runner for WebGPU acceptance.

The final evidence and next phase live in dotfiles document44. Desktop checks
do not establish Quest performance, hand interaction, comfort or audio output.

# Tideweave's living score

25 October 2026. Desktop practice using the existing crossing assets and audio
owner. Physical headset acceptance remains separate.

## Play

Earn the Tideweave Almanac page through the original crossing. The crossing
then offers **First crossing**, **Turning tide** and **Homeward**. Choose a
phrase, press **Replay phrase**, then follow its four notes. **Trace without
sound** remains available. Keyboard tracing uses Enter to hold/lift and arrows
to move. The selected note contour also positions the porcelain instruments.

| Phrase         | Notes   | Contour              | Tempo  |
| -------------- | ------- | -------------------- | ------ |
| First crossing | D–F–B–A | Rise, then settle    | 82 BPM |
| Turning tide   | D–A–F–B | Rise, dip, rise      | 86 BPM |
| Homeward       | B–A–F–D | Descend to the tonic | 76 BPM |

These are guided phrases, not pitch or rhythm scores. They do not add duplicate
Almanac pages, replace the saved world motif or alter the temple arrangement.
Each success answers the actual final note before the shared D-centred response.

## Lifecycle and renderer contract

- Phrase records own note names, MIDI notes, tempo and target positions.
  The original exports retain First crossing as their default for existing callers.
- Switching cancels captured input, held keys, teaching and trace voices. It
  resets the attempt and keyboard cursor. Playback requires a new explicit action.
- Re-entering or reloading restores the canonical phrase; practice state is
  visit-local. Earned page storage uses the existing unchanged version/schema.
- Four retained note instruments relocate to the supplied target. The existing
  five bridge spans and live fractal samples are reused. No new model, shader,
  material pack, audio context or persistent GPU resource is required.
- Reduced motion places instruments directly at their new positions and keeps
  earned spans visible. Old note pulses clear when a contour changes.
- Ambience retains its own opt-in/session policy. A phrase switch cancels the
  foreground instrument without silently enabling or revoking the ambient bed.

## Verification

The experiment test suite covers alternate trace paths, discontinuity rejection,
rejoining, pitch-at-target agreement, response notes, retained instrument storage
and motion-off positions. `scripts/verifyBridgePhrases.ts` exercises the actual
desktop UI on a hardware WebGPU browser. It uses an isolated progress fixture
for practice checks and separately verifies the first-page control gate.

Run it with `VERIFY_BASE_URL` pointing to the development server and
`VERIFY_OUT_DIR` pointing to an admitted agent-output directory. Use a bounded
command and the script's hidden `agent-browser` launch options. Do not run this
through the root Playwright runner, which selects a software graphics backend.

The final phase receipt and broader next-work plan live in dotfiles document42.
This phase does not implement the proposed Frostglass Causeway, microphone input,
an immersive simulator adapter or a physical Quest session.

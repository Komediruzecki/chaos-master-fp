# World soundscapes

**Implemented; desktop soundscape checks pass.** This phase adds
optional synthesized ambience for Glasswake and Tideweave through the existing
shared `MotifAudio` owner. All 246 experiment tests, including 76 focused audio
checks, pass. Experiment typecheck/build, repository check and the generated
index pass, alongside final scoped lint. Standalone hardware-browser checks
pass against both development and emitted production builds. The connected
journey and temple regressions also pass, including genuine page earning,
saved-progress protection and the complete arranged ending.

## Sound and controls

Enable ambience is a deliberate action. Reload and a new visit start silent.
Mute ambience stops the environmental layer without removing the encounter's
teaching notes or controls. The shared volume applies to both. The ambience
setting is not a new earned-page field or a migration of saved progress. The
header control is disabled before GPU readiness, on scene error, in the atlas
or a modal panel, and throughout the temple ending.

| Place                | Implemented identity                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Glasswake            | Upper-register C-Ionian sine tones suggest an airy glass chamber                                                                         |
| Tideweave            | Lower D-Dorian reed/current tones use triangle fundamentals and retain the characteristic B                                              |
| Scene change         | C5–E5–G5 for Glasswake or D4–F4–B4 for Tideweave; a new cue replaces the previous one and finishes within 0.595 seconds of scheduling    |
| Teaching and shatter | The background ducks to 18% with a 40 ms attack time constant, then recovers with a 250 ms time constant after foreground voices release |
| Temple               | Entering clears ambience; it stays disabled throughout the arranged ending                                                               |

The environmental layer has its own bus inside the existing audio context.
Foreground instruments pass through the musical analyser to the shared master;
ambience and navigation cues reach that master without entering the analyser.
The reported foreground level includes master volume, so zero volume reports
zero level. Ambience and cues do not advance note/progress snapshots.
Background sound cannot arm a seal, accept a trace point or complete the temple
score. The existing motif, trace, fracture and arranged-ending transport remains
the authority for musical instruction and completion.

The bed uses six retained tonal oscillators plus one amplitude-modulation LFO.
Glasswake's tones are C4, C5, E5, G5, B5 and E6, all sine. Tideweave uses
triangle D2/A2 and sine D3/F3/B3/A4. Slow modulation uses 0.075 Hz and 0.13 Hz
respectively. Changing worlds retunes the same bank, with frequency and level
time constants of 180 ms and 350 ms.

A settled bank has seven oscillators. During cue replacement, at most three
active and three retiring cue tones bring that bank's count to thirteen.
Replaced cues fade over 25 ms and stop after 30 ms. Muting fades the bed bus
over 40 ms, stops it after 45 ms and uses source-end cleanup rather than a new
timer. Rapid mute/re-enable can temporarily overlap one bounded retiring bank;
another stop prunes that older bank. Suspended contexts and forced disposal
disconnect immediately. This is a source bound, not a measured CPU benchmark.

`setAmbience(world, enabled)` handles the explicit enable action;
`changeAmbience(world, cue)` never creates or resumes a context. Instrument
stops preserve enabled ambience, while `stopAmbience()` clears its opt-in,
voices and pending starts. The overall `stop()` silences both buses. Hidden
state, context suspension and disposal clear the opt-in as well. Window blur,
atlas/modal entry and GPU failure also revoke it. Changing focus from canvas
to another in-scene control only releases the instrument. Restoration must
not restart sound without another deliberate action.

Navigation reshapes enabled ambience and cues the changed destination,
including an orb switch within the wide terrace that needs no camera passage.
Opening the temple clears the bed; its score remains a separate explicit
Listen together action with no ambient duet.

## Scope

These are synthesized conceptual soundscapes on desktop. There are no imported
field recordings, paid assets, microphone exercises, user music uploads or
headset-listener spatial-audio claims. The synthesized output is sound design
rather than measured room acoustics. Quest comfort, stereo space,
hand interaction and sustained performance remain untested.

The environment geometry, retained fractal identities, shared GPU resources,
encounter judge, earned pages and save schema remain the existing contracts.
Motion pause and sound controls remain separate choices. Audible quality and
the right background/teaching balance require user listening, even when
instrumented signal and cancellation checks pass.

## Verification record

Starting revision: `a2e21293`.
Exact remote handoff is recorded separately in local
`personal/lumen-meta/41-world-soundscapes.md` after push.

| Gate                                                      | Status                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine routing and bounded-source review                  | Independent review has no actionable findings; browser retains exactly seven settled sources after six real world selections and zero after mute                                                                             |
| Opt-in, volume, mute and pending-start cancellation tests | Focused audio suite: 76/76 pass                                                                                                                                                                                              |
| Analyser/progress isolation and teaching ducking          | Focused suite and actual browser measurements pass; ambience leaves the teaching analyser silent, teaching ducks/restores the bed and fixture progress stays unchanged                                                       |
| Experiment tests, typecheck and production build          | All 246 tests, typecheck and build pass                                                                                                                                                                                      |
| Generated-index check and mechanical UI review            | Index check passes; detector returns no findings                                                                                                                                                                             |
| Repository check                                          | `pnpm check` passes with 89 warnings and no errors                                                                                                                                                                           |
| Final experiment typecheck and scoped lint                | Pass                                                                                                                                                                                                                         |
| Actual desktop signal and both world identities           | Development and emitted-build soundscape checks pass in Chromium 148.0.7778.96; exact production-graph offline samples have distinct spectra                                                                                 |
| Interruption silence and no automatic restart             | Synthetic blur/hidden, modal entry and held-resume cancellation pass in the browser; suspension/disposal coverage passes in the audio suite                                                                                  |
| Real controls, narrow layouts and keyboard access         | Trusted keyboard enable/mute and master volume pass in both builds; fresh-context touch enable/mute passes at 390 px; production layouts pass at 1440/820/390 px                                                             |
| Connected encounters, saved pages and temple regression   | Pass: genuine onboarding/keyboard/touch, both earned pages, replay/reload and protected storage; temple smoke uses the new earned receipt and completes the full score, natural reveal, interruption and touch/reload checks |
| User listening and art acceptance                         | Pending                                                                                                                                                                                                                      |
| Hosted CI                                                 | Not established                                                                                                                                                                                                              |
| Physical Quest spatial audio, comfort and performance     | Open; hardware unavailable                                                                                                                                                                                                   |

Use standalone hardware-browser checks with the required hidden
`agent-browser` workspace. Signal levels can establish sound and silence at a
measurement point; they do not establish a pleasant mix or the player's
perception of space. Synthetic visibility/context probes must stay labelled.

The final soundscape receipts are `evidence/soundscapes/soundscapes.json` and
`evidence/soundscapes-built/soundscapes.json` in output run
`5515497869ea444fa758704e1de2b305`. Both report no browser errors. The production
check uses real controls without `__observatory`. These checks seed onboarding
and earned-page data solely for navigation inspection; they do not prove earning
either page. The six-second stereo WAVs render the exact production builder
offline at 24 kHz and master volume 0.55. They are listening references, not
recordings of speakers, a headset or the live browser output.

The preserved first attempt failed its lifecycle observation: delivery of an
ended callback can lag synchronous disconnection. The final observer separately
counts connected sources and still requires exactly seven unfinished source
lifecycles when settled and zero after mute. The initial attempt is recorded as
failed, not counted as a passing feature check.

The original journey and temple runs stalled in screenshot capture with a
paused test clock, despite loaded fonts, new GPU submissions and no application
errors. Failures remain under `evidence/journey` and `evidence/temple`. A separate
journey diagnostic recovered eight captures by resuming the clock at the same
scene and viewport. Both verifiers now resume the clock only while taking a
still and restore controlled timing afterward. The 15-second timeout and all
gameplay assertions remain intact. Final unmodified invocations of the updated
scripts pass under `evidence/journey-final` and `evidence/temple-final`; these
are functional desktop checks, not frame-rate measurements.

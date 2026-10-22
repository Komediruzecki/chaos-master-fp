# Observatory scene passages

**Implemented and verified on desktop.** Remote handoff is recorded separately
in the local phase 40 document. This phase connects the observatory, Glasswake, Tideweave and
temple views through one bounded threshold presentation. All 230 experiment
tests, experiment typecheck/build, repository check and index check pass.
The final focused passage run05 and genuinely earned connected-journey
diagnostic run pass. The focused temple run01 also passes using that genuinely
earned two-page save. User art/listening acceptance and Quest testing remain
separate.

## Visible handoff

Entering an encounter, inspecting an orb, returning to the terrace or opening
the temple uses a 180 ms departure followed by a 460 ms arrival. The outgoing
scene remains intact during departure. A fully opaque Night Almanac threshold
covers the geometry/camera change, then clears over the destination. Its
orbital seal carries the existing glass/star and reed/music symbols; the
destination name identifies the place being entered.

Arrival moves the destination camera through a bounded 3.5% distance settle.
There is no long flight, walking, collision or new locomotion system. The
encounter camera is stationary before its instrument accepts input. Selecting
the other orb while already in the wide terrace changes the selection directly,
without covering the same scene again.

The latest destination owns the passage. A new request replaces the pending
target and departs from the current threshold opacity, rather than queuing
several trips. Pause motion, reduced-motion preference, window blur or hidden
state settles the latest destination. Returning never resumes a partially completed
travel animation. The threshold has no pointer interception; header navigation
remains above it. A status announcement identifies the destination, and the
canvas reports its busy state. Changing focus from the canvas to another scene
control releases captured input without prematurely finishing the passage.
Navigation focuses the canvas to keep Escape available; temple arrival moves
focus to Listen together only if focus is still on that canvas or the page
body, preserving a deliberate header-navigation choice.

## Music and interaction boundaries

Tideweave's explicit Trace a melody gesture still opens the shared audio
context immediately. The existing motif accepts a bounded lead-in so its first
teaching note waits for arrival. `MotifAudio.play(motif, leadInSeconds)` clamps
that optional delay to 0–0.8 seconds, rejects non-finite delay values to zero,
and schedules it through the existing audio clock. It creates no second audio
owner. Cancellation invalidates pending starts and stops scheduled sound.

The other passages do not add automatic motif playback. Opening the temple
still requires both earned Almanac pages and enters its silent ready state.
Listen together remains a separate deliberate action after arrival. The
original arranged score and its audio-clock reveal remain unchanged.

Pointer orbit/picking, wheel input, trace movement and instrument actions wait
until the passage settles. Departure releases any captured pointer and cancels
active trace input without awarding a note. Leaving or interrupting the
lead-in stops it. The ordered trace judge, Glasswake hold/release rules,
forgiving retries, earned-page identities and local save schema remain the
existing contracts.

## Ownership and cost

`observatory/passage.ts` owns the pure `ScenePassage` timing and latest-target
state. The runtime retains the outgoing frame while its UI encounter unmounts,
then supplies the destination frame and a bounded arrival value to the current
camera calculation. `PassageThreshold.tsx` and `passage.css` present the DOM
threshold using existing Night Almanac tokens and icons.

This phase adds no models, texture arrays, paid assets, fractal samples or GPU
owners. Both retained world buffers, their recipes/seeds, scene materials and
the single HDR/depth renderer remain in place. The threshold is a screen-space
desktop presentation. Its appearance is not evidence of physical VR comfort or
a world-space portal implementation.

## Verification record

Starting revision: `17644796d850b45cb68154d4c604e10e9a97a055`.
The full phase record is in the local dotfiles document
`personal/lumen-meta/40-journey-transitions.md`.

| Gate                                                         | Status                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure timing and interruption regressions                     | Passed within the 230-test experiment suite                                                                                                                                                      |
| Shared-audio lead-in and cancellation regressions            | Passed within the 230-test experiment suite                                                                                                                                                      |
| Experiment tests, typecheck and production build             | All 230 tests, typecheck and build pass                                                                                                                                                          |
| Repository checks and generated index                        | `pnpm check` exits 0 with 89 warnings and no errors; index check passes                                                                                                                          |
| Scoped lint                                                  | No errors; two existing complexity warnings remain                                                                                                                                               |
| Hardware WebGPU departure/arrival views                      | Final passage run05 passes on AMD RDNA 4 / Chromium 148.0.7778.96 without browser errors, including the no-initial-loader regression                                                             |
| Pointer/keyboard input after arrival and rapid replacement   | Run05 passes trusted-input gating and Guide/Escape; latest-target replacement is separately covered through a development diagnostic                                                             |
| Pause/reduced motion and interrupted audio                   | Run05 passes exact paused pixel equality, reduced-motion entry without a veil, and synthetic window-blur/hidden-state cancellation followed by 800 ms silence                                    |
| Connected encounters and earned pages                        | Final diagnostic run passes genuine onboarding, hold/release, tracing, both earned pages, replay/reload and protected-storage behavior                                                           |
| Combined temple ending                                       | Final temple run01 passes with the genuinely earned save: silent ready state, full four-section score, natural reveal, stop/cancel, motion-off, touch replay, reload and five responsive layouts |
| Retained sample and warmed resource stability                | Run05 preserves both point hashes, 262,144 points, two sample generations, 12,165,312 counted buffer bytes and one upload per existing texture array                                             |
| App commit/push and exact remote head                        | Recorded separately in local `personal/lumen-meta/40-journey-transitions.md` after push                                                                                                          |
| Hosted CI                                                    | Not established                                                                                                                                                                                  |
| User art and listening acceptance                            | Pending                                                                                                                                                                                          |
| Physical Quest stereo, hands, scale, comfort and performance | Open; hardware unavailable                                                                                                                                                                       |

Use standalone headed hardware Chromium verification with the required hidden
`agent-browser` workspace. The repository's SwiftShader Playwright runner is
not WebGPU proof. Controlled-clock frames can prove phase boundaries and input
gates; they cannot establish sustained motion quality, native tab-hide behavior
or headset performance. Passage run05 uses explicitly seeded earned pages to
reach the temple; the journey diagnostic separately earns both pages through real
encounters. Window blur and hidden state in the focused passage check are
synthetic events, not native focus/visibility acceptance. The retained byte
counter excludes render targets and browser overhead.

The journey's capture-assisted reruns encountered intermittent 15-second
screenshot timeouts after resizing, without application browser errors. A
metadata-only protocol run completed all functional checks, retaining 68 CDP
request/response events with no requests outstanding. The exact cause remains unestablished;
this is a capture-harness limitation, not evidence of a repaired application
defect. CDP focus emulation is explicitly labelled and did not alone resolve
the stalls. Passage run05 supplies the final scene captures; the journey
diagnostic supplies genuine encounter/progress proof.

Temple run01 measures the actual shared AudioContext output, with a peak level
of 0.22621. Completion is observed at 26.754 seconds within a 27.036-second
observation. All four score sections are seen, all nine architecture parts
appear and the completed seal is lit. Synthetic visibility cancellation and
no-resume checks pass; they remain handler evidence, not native tab visibility.
No AV recording or subjective listening acceptance is claimed.

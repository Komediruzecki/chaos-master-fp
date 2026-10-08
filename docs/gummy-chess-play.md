# Play gummy chess

Open **Arcade → Chess**, or `/#arcade=chess`, for a local two-player game. Both
players use the same browser. Chess opens inside Arcade without an agent
connection; **Lumen Arcade** returns to the hub while retaining the editor
document and the saved match in the same tab.

The standalone match remains at `/gummy?view=match`. The crash study is at
`/gummy?view=board`, the material workbench at `/gummy?experiment=mpm`, and the
shot studio at `/gummy?view=cinema`.

This match flow is implemented and verified on the working branch. The focused
rules, rendering and UI tests pass. A native Chromium run on AMD RDNA-4 verified
touch selection, full capture playback, Skip/replay/undo, PGN/Cinema round-trips
and responsive controls at desktop, tablet and phone viewport sizes. The new
match page has not yet been tested on a physical iOS device.
The new Arcade shell and selection cards are verified in native Chromium;
Firefox production layout checks pass. Physical iOS and tablet checks of
this latest UI remain separate.

## Make a move

Tap or click a piece belonging to the side to move, then choose a highlighted
destination. Only legal destinations appear. Drag the board to orbit, use two
fingers to pan, and scroll to zoom. The **Move by square** section also lets you
select a piece by its square and choose a destination button. It avoids precise
3D picking and supports keyboard navigation through ordinary controls; the 3D
board still needs a working WebGPU renderer.

White starts a new game. Turns alternate, king safety is enforced, and promotion
asks you to choose a queen, rook, bishop or knight. Castling moves both the king
and rook; en passant removes the pawn from its actual captured square. Kings
remain on the board when the game ends in checkmate.

After the final animation, a result card appears over the board with the winner
and score (or the reason for a draw). **Review board** or Escape dismisses it;
**Show result** brings it back. **New game** starts again with the current board
and material settings. The result card does not cover an unfinished capture.

Ordinary occupied-square captures use the gummy crash presentation. Only the
victim runs MPM; the attacker follows the prescribed collision motion and finishes
on the captured square. Other pieces use cached meshes. The board stays visible while the victim solver
starts, then the camera eases into the capture and back to the same orbit, pan
and zoom. The six static piece meshes are baked once per match scene and shared
with each capture; returning to play keeps the existing board renderer. The
initial loading message does not return for captures or replay. Castling, en passant,
promotion and ordinary moves have short move animations. Special captures are
legal even where the cinematic crush does not yet support their presentation.

Captures now vary between **Press and settle**, **Shoulder sweep** and **Rock and
shear**. The match uses all three in a shuffled round, including the original
straight-down press, before refilling the choices. It avoids immediate repeats
between rounds and reduces travel or rotation around nearby pieces. A crowded position can use the simpler press. **Game & moves**
shows the selected capture's motion above its Cinema link. Replaying the move
uses the same choice and saved material rather than choosing again.

The rules commit each move once, before its animation starts:

- **Skip animation** finishes on the same committed position.
- **Replay move** presents the selected move again without applying it twice.
- **Undo move** removes the selected move and any later moves.
- The position arrows and move history review the existing game without changing
  its timeline. Playing from an earlier position creates a new continuation and
  replaces the later moves.
- **New game** returns to the standard starting position.

A renderer error leaves the legal game state intact. Skip an active presentation
if needed, then use **Reload board**. Animation completion is never the authority
for whose turn it is or which pieces remain.

## Choose the material and board

The sidebar shows large preview cards for **Marble**, **Lagoon** and **Candy**
piece colours, followed by **Classic**, **Glass** and **Lava** boards. Choose a
card to apply that look. The piece cards share the six existing gummy shapes;
they change the colour palette while retaining the current material physics.
Their images come from the actual WebGPU renderer and do not run additional
preview simulations.

Open **Board and material** to choose Classic, Glass or Lava; Auto, Tablet or High
render quality; and a piece size from 85% to 100%. The initial match uses Classic,
Auto, 90% size and the user's RockGummy material.

The shared preset controls offer **Low: firm**, **Mid: soft**, **High: mushy** and
**RockGummy**, plus saved and imported material presets. Tune a material in the
workbench, copy its preset JSON, then import and apply it here. Each capture
records the chosen softness, fragility, flow, viscosity and other material settings
when each capture is played. Later changes apply to future captures; replaying an
earlier move retains its saved look and motion. Open that capture in Cinema to
compare a different material or mechanic.
The white side uses the preset palette; the black side uses blue, or marbled
candy when white uses blue. Individual-piece palette editing remains in the crash study.
Settings cannot change during a move presentation.

## Save, import and review a game

The match saves its validated PGN, history cursor, current material/board settings
and each capture's resolved motion and appearance in `sessionStorage`. Reloading
or visiting the shot studio in the same browser tab
restores that session. This is tab-local storage, not an account backup or device
sync. Copy PGN before closing the tab if you need a portable game. When storage is
blocked, the page reports that the match can continue for the current visit.
PGN carries moves and setup; material settings travel separately through presets
or shot recipes.

Session version 2 stores the capture snapshots. Earlier version 1 sessions keep
their original Press and peel motion on recovery; they do not receive newly
selected effects. Invalid saved effect data produces a notice and falls back to
that earlier motion while retaining the legal game. Saved effects are matched to
the move's ply, pre-move FEN and notation before reuse. Undo, a new continuation,
or a draw claim from an earlier position removes effects belonging to discarded
future moves.

Open **Import or copy PGN**, paste one game and choose **Import game**. Validation
must succeed before it replaces the current game. An imported timeline opens at
its initial position; use the arrows or move history to review it. **Copy PGN**
exports the full retained timeline, even while reviewing an earlier position.
If clipboard access is blocked, the text is selected for manual copying.
PGN imports assign repeatable capture choices using the current material and
board settings, because PGN does not contain the original appearance history.

A short capture example:

```pgn
[Event "Gummy capture study"]
[Result "*"]

1. e4 d5 2. exd5 *
```

To start from a custom position, import a PGN with a complete six-field FEN and a
`SetUp` tag. There is no separate FEN editor in this first match page. This example
also exercises both castling sides:

```pgn
[Event "Castling study"]
[SetUp "1"]
[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]
[Result "*"]

1. O-O O-O-O *
```

Use `*` alone after the setup headers to load just the starting position. FEN
preserves side to move, castling rights, en-passant target and move counters.
Imported piece IDs derive from their initial squares and remain stable through
moves, promotion, undo and replay.

The importer accepts one standard-chess mainline, up to 100,000 characters and
2,000 half-move steps. It reads through PGN comments and side variations but does
not retain them. Chess960 and null moves are unsupported. Header metadata is
bounded and escaped on export. Invalid setup, moves or saved state produce an
error instead of partially applying a game.

## Turn a capture into a shot

Select a completed capture in the move history, then choose **Open in Cinema**.
An ordinary occupied-square capture becomes a validated shot recipe containing
its before-position FEN, source/destination and saved capture-time material,
actor palettes, board finish, size, render quality and motion. It starts with the
arc camera and sculpted pieces. New shot recipes use schema v3; earlier v1/v2
recipes retain their motion semantics when imported. In Cinema, choose a fixed
mechanic or tune the existing motion, then **Apply shot settings** to preview,
record or export; see
[gummy-cinema.md](gummy-cinema.md).

En-passant and promotion captures currently show an explanation instead of
opening a shot. Non-captures have no shot handoff. The match is saved before the
studio opens, and the handoff is retained in the same tab so the studio can be
reloaded. If saving fails, the page keeps the match open and offers PGN copying.
Returning to `/gummy?view=match` restores the retained game and cursor. Editing a
shot does not alter the match's legal history.

## Rule outcomes and current limits

Checkmate and stalemate end play. The adapter also detects the dependency's
recognized insufficient-material positions. Threefold repetition and the
fifty-move rule offer **Claim draw** for the current position; fivefold repetition
and the seventy-five-move rule end the game automatically. Checkmate takes
precedence at the seventy-five-move threshold. Repetition compares castling and
legally available en-passant rights, not just piece locations.

The first UI does not implement claims based on a declared next move. It has no
clocks, resignation/agreed-draw controls, AI opponent or online multiplayer.
Imported PGN results such as resignation or an agreed draw remain header
metadata; they do not force a terminal board status. Export derives its result
from the current rules state. A locally claimed draw round-trips using a
validated `LumenDrawClaim` header. Insufficient-material detection does not claim
to prove every possible geometric dead position.

The simulation remains a directed capture effect. Debris does not participate in
subsequent chess rules, and all 32 pieces are not continuously simulated. Tablet
quality reduces presentation cost, but a physical-device performance budget is
still unmeasured. This milestone is kept on `feat/gummy-fracture` alongside the
preserved studio pipeline.

## Implementation and verification pointers

Legal move generation uses exact runtime dependency
[chess.js 1.4.0](https://github.com/jhlywa/chess.js/tree/v1.4.0), under the
[BSD-2-Clause license](https://github.com/jhlywa/chess.js/blob/v1.4.0/LICENSE).
The adapter owns stable identity, immutable receipts, FEN preservation and the
claimable-versus-automatic draw distinction. Its rule interpretation follows
[FIDE Laws of Chess, articles 9.2, 9.3 and 9.6](https://handbook.fide.com/chapter/e012023).

| Responsibility               | Source                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Public pure API              | `packages/core/src/chess/chessGame.ts`                                                                        |
| Types and immutable receipts | `packages/core/src/chess/chessTypes.ts`                                                                       |
| Legal state and outcomes     | `packages/core/src/chess/chessRules.ts`                                                                       |
| PGN boundary                 | `packages/core/src/chess/chessPgn.ts`                                                                         |
| Rule regression coverage     | `packages/core/src/chess/chessGame.test.ts`                                                                   |
| Match controls and state     | `packages/app/src/pages/GummyBoard/GummyMatchPage.tsx`, `useGummyMatch.ts`                                    |
| Session and Cinema handoff   | `packages/app/src/pages/GummyBoard/gummyMatchSession.ts`                                                      |
| Renderer and move poses      | `packages/app/src/components/GummyBoard/GummyMatchScene.tsx`, `gummyMatchPresentation.ts`                     |
| Embedded Arcade entry        | `packages/app/src/components/Arcade/ArcadeHub.tsx`, `packages/app/src/lib/activeTab.ts`                       |
| Appearance cards and images  | `packages/app/src/pages/GummyBoard/GummyMatchLookCards.tsx`, `packages/app/public/assets/chess/manifest.json` |

The 35 focused core tests cover identity, full FEN, legal captures, pinned pieces,
castling, en passant, promotion, undo/branching, terminal outcomes, draw claims,
PGN round-trips and malformed input. Core TypeScript and scoped ESLint passed.
The combined app pass adds 105 tests for state/UI lifecycle, persistence, Cinema
handoff, scene integration, packing, abort cleanup and picking. `pnpm check`
and `pnpm docs:index:check` pass.

Hardware verification on 2026-10-07 used a native AMD RDNA-4 adapter in headed
Chromium, kept on the hidden agent workspace. It covered the full match and
Cinema round-trip described above, with no runtime/GPU errors or Solid owner
warnings. The static board submitted one initial frame and none during idle.
The hidden browser needed `--disable-frame-rate-limit` and `--disable-gpu-vsync`
in addition to the standard background flags: without those, presentation was
throttled to about one frame per second. This is functional verification, not a
tablet performance measurement. Local reports and screenshots are under
`/home/maff/agent-out/chaos-master-fp/2026-10-07/match-verification/`; generated
verification artifacts are excluded from Git.

A follow-up transition check on the same desktop GPU measured capture readiness
at 160 ms versus 1,159 ms before, and return to the board at 19 ms versus 956 ms.
These are individual local runs, not a cross-device benchmark. Instrumented GPU
command labels showed six total rest-mesh bakes across opening and capture, down
from eighteen; the board canvas remained mounted and no blank-canvas state was
observed. Replay, Skip during setup and Skip during playback preserved the exact
FEN. Camera tests cover matching board framing at both ends, including pan/zoom,
and mesh lease tests cover cancellation, failed setup and scope cleanup. Logs and
screenshots remain outside the repository in the adjacent `transition-verification/`
folder under the local verification path above.

On 2026-10-08 a native Chromium trace reproduced a capture handoff defect: a
cached cinematic reported ready before AutoCanvas's initial resize debounce
completed. Its renderer skipped the zero-sized frame, exposing the final board
for about 187 ms before the first real cinematic draw. Readiness now requires a
positive-sized frame and its GPU completion fence, with a size recheck; playback
does not advance during that initial wait. Tests cover delayed sizing, resize
during GPU work and Skip before sizing completes.

The resource audit repeated seven full captures. After the first ordinary move,
live application-created resources settled at 23 buffers (7,665,760 bytes) and
11 textures (36,987,072 estimated bytes) between every capture, with zero idle
GPU submissions and no growth in animation callbacks. These counts exclude
browser-owned swapchains, pipeline caches and driver overhead, and do not claim
to measure total VRAM. A one-time 64-byte allocation belonged to the static
board's moving instance and indirect draw, not an accumulating capture leak.
Canvas cleanup now explicitly unconfigures each completed shot, and failed
resize attachment setup releases its partial allocation. The idle board also
compares memoized state identity instead of serializing every piece each frame.
Local traces live under
`/home/maff/agent-out/chaos-master-fp/2026-10-08/match-audit/`.

The fixed browser run verified seven full captures/replays, Skip during setup
and playback, and result-card actions at 1440×1050, 834×1112, 390×844 and 844×390.
Every cinematic had acquired its first real presentation texture before becoming
visible; no final-position pre-flash samples or GPU/runtime errors occurred.
The combined focused app pass has 61 passing tests, including queued initial
resizes, result dismissal and fresh games. `pnpm check` and the agent index check
passed. Physical-device frame cost remains a separate check.

The user has also completed a full local game through checkmate. Chess now mounts
lazily inside Arcade. Editor shortcuts, secondary GPU loops and the main animation
loop are gated during play; explicit exports continue independently. Leaving the
world releases the match renderer and unconfigures its canvas, while a quality
change preserves the active canvas configuration.

The Arcade integration pass on 2026-10-08 passed 124 distinct focused tests across
shortcuts, canvases, navigation, the match and presets, plus typechecking. The
initial `pnpm check` reached five test-style lint failures; they were fixed,
scoped ESLint passed, and the remaining formatting and WGSL validation commands
passed. The production build passed. The original compound check was not rerun
as a single command.

Native headed Chromium on AMD RDNA-4 retained the selected looks and `e2-e4`
position through three world exits and re-entries. Tracked live GPU resources
settled at 24 after each exit, compared with 80 in the startup sample before
lazy cleanup, and a 1.2-second idle observation recorded zero GPU submissions.
There were no runtime/GPU errors or owner warnings. This does not measure browser
swapchains, driver caches or total system GPU memory.

Actual CDP touch card selection passed at 834×1112, 390×844 and 844×390, with a
desktop check at 1440px. Production Chromium screenshots were inspected at all
four sizes. Hiding the controls returns to the top of the board; safe-area
padding keeps the panel reachable. Firefox production layout checks at 1440×1050
and 390×844 passed selected/rendered cards, loaded images, no horizontal overflow,
the standalone host and zero page errors; screenshots were inspected. This is
layout evidence, not physical-GPU proof. Physical iOS and tablet testing of this
latest interface is still open.
Evidence lives outside the repository in
`/home/maff/agent-out/chaos-master-fp/2026-10-08/arcade-chess/`.

The metrics gate still reports the rebased branch's existing debt: 86 files over
500 lines, 40 over 800 and eight file-cap failures, matching the pre-Arcade state.
No baseline was relaxed. Extracting the affine-grid theme reduced that file's cap
from 1,172 to 1,154 lines.

The [Arcade integration plan](gummy-chess-arcade-plan.md) records the implemented
glass surface and varied capture mechanics. All three mechanics passed the Glass
pawn-knight native desktop run at Tablet quality, with finite sampled state,
no surface overflow or dropped vertices, no errors/warnings and a target-square
landing. Studio controls passed at 1440, 834 and 390px widths. Evidence is in
`/home/maff/agent-out/chaos-master-fp/2026-10-08/glass-captures/capture-native.json`.

The next acceptance work is physical iOS/tablet testing of the new angular
contact, performance measurement and broader role/material comparisons. Then
prove one authored fractal pawn through editing, saving, playing and Cinema
before expanding the collection. Private friend sessions remain a later planned
phase; this match still runs locally with both players in one browser.

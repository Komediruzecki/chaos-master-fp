# Play gummy chess

Open `/gummy?view=match` for a local two-player game. Both players use the same
browser. The crash study remains at `/gummy?view=board`, the material workbench
at `/gummy?experiment=mpm`, and the shot studio at `/gummy?view=cinema`.

This match flow is implemented and verified on the working branch. The focused
rules, rendering and UI tests pass. A native Chromium run on AMD RDNA-4 verified
touch selection, full capture playback, Skip/replay/undo, PGN/Cinema round-trips
and responsive controls at desktop, tablet and phone viewport sizes. The new
match page has not yet been tested on a physical iOS device.

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

Ordinary occupied-square captures use the gummy crash presentation. Only the
victim runs MPM; the attacker follows the prescribed collision motion and finishes
on the captured square. Other pieces use cached meshes. Castling, en passant,
promotion and ordinary moves have short move animations. Special captures are
legal even where the cinematic crush does not yet support their presentation.

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

Open **Board and material** to choose Classic, Glass or Lava; Auto, Tablet or High
render quality; and a piece size from 85% to 100%. The initial match uses Classic,
Auto, 90% size and the user's RockGummy material.

The shared preset controls offer **Low: firm**, **Mid: soft**, **High: mushy** and
**RockGummy**, plus saved and imported material presets. Tune a material in the
workbench, copy its preset JSON, then import and apply it here. Capture playback
uses the chosen softness, fragility, flow, viscosity and other material settings.
The white side uses the preset palette; the black side uses blue, or marbled
candy when white uses blue. Individual-piece palette editing remains in the crash study.
Settings cannot change during a move presentation.

## Save, import and review a game

The match saves its validated PGN, history cursor and material/board settings in
`sessionStorage`. Reloading or visiting the shot studio in the same browser tab
restores that session. This is tab-local storage, not an account backup or device
sync. Copy PGN before closing the tab if you need a portable game. When storage is
blocked, the page reports that the match can continue for the current visit.
PGN carries moves and setup; material settings travel separately through presets
or shot recipes.

Open **Import or copy PGN**, paste one game and choose **Import game**. Validation
must succeed before it replaces the current game. An imported timeline opens at
its initial position; use the arrows or move history to review it. **Copy PGN**
exports the full retained timeline, even while reviewing an earlier position.
If clipboard access is blocked, the text is selected for manual copying.

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
its before-position FEN, source/destination, current material, actor palettes,
board finish, size and render quality. It starts with the arc camera, sculpted
pieces and Press and peel motion. The studio can then change those choices,
preview, record or export using its existing controls; see
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

| Responsibility               | Source                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Public pure API              | `packages/core/src/chess/chessGame.ts`                                                    |
| Types and immutable receipts | `packages/core/src/chess/chessTypes.ts`                                                   |
| Legal state and outcomes     | `packages/core/src/chess/chessRules.ts`                                                   |
| PGN boundary                 | `packages/core/src/chess/chessPgn.ts`                                                     |
| Rule regression coverage     | `packages/core/src/chess/chessGame.test.ts`                                               |
| Match controls and state     | `packages/app/src/pages/GummyBoard/GummyMatchPage.tsx`, `useGummyMatch.ts`                |
| Session and Cinema handoff   | `packages/app/src/pages/GummyBoard/gummyMatchSession.ts`                                  |
| Renderer and move poses      | `packages/app/src/components/GummyBoard/GummyMatchScene.tsx`, `gummyMatchPresentation.ts` |

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

# Chess in Lumen Apeiron

Integration plan, reviewed 2026-10-08. The user approved Arcade integration and
confirmed the checkmate overlay. The embedded Arcade entry and visual selection
sidebar are implemented and verified in native Chromium. Firefox production
layout checks pass; physical-device verification remains separate. The
followups below remain planned until their acceptance evidence is recorded.

The user has played the local match through checkmate and published the Cinema
film. Keep that working game, its PGN history, material presets and shot pipeline
as the foundation. Chess fits in **Lumen Arcade** as a directly playable game,
with the fractal editor feeding its piece collections and Cinema recording its
captures.

## Recommended sequence

| Step                                                       | Benefit                                                                                  | Relative effort                  | Acceptance before expanding                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Add Chess to Arcade with a visual setup sidebar         | Make the game discoverable and its collections enjoyable to choose                       | Medium                           | Open without an agent connection; large piece-set and board cards apply the chosen look; preserve editor and match state on return; bound active GPU work |
| 2. Repair the glass playing surface                        | Put the squares, pieces and selection on one physical board                              | Medium                           | Inset glass squares share the picking grid at all tested camera angles; floor caustics stay on their separate receiver                                    |
| 3. Add capture motion variants                             | Vary the contact, smear and finish across a game                                         | Medium                           | Three bounded mechanics preserve the destination square; recorded seeds replay the same choreography                                                      |
| 4. Introduce saved piece collections and one authored pawn | Connect IFS creation to a game and its films                                             | Medium to large                  | Edit, save, reopen, place, capture and film one pawn; cached geometry and side/role readability fit the measured budget before expanding to six roles     |
| 5. Add private friend sessions                             | Invite a second player after choosing the collection and board                           | Large                            | Two clients converge on authoritative chess state through duplicate moves, disconnect, rejoin and different rendering speeds                              |
| 6. Expand material-specific effects and world placement    | Give glass and fractal pieces their own response, then place the game in a fractal scene | Large, with research uncertainty | Matched captures show coherent separation and bounded cost; world camera/picking use the same match controller                                            |

The local playability pass is complete: the user has played through checkmate,
and desktop checks cover result controls, capture handoffs and bounded resources.
Physical tablet profiling remains a parallel acceptance task. Keep the fully
soft 32-piece board and ranked competition outside the private-friend milestone.

The working branch was rebased cleanly onto fork `origin/main` at `9d8a0c7c`
before this integration pass. That records the current base only; a future
upstream merge needs another fetch and comparison before claiming compatibility.

## Fit with the current app

`components/Arcade/ArcadeHub.tsx` now offers Chess alongside the six agent-led
modes. `lib/activeTab.ts` handles `#arcade=chess`, and the hub lazily imports the
existing `GummyMatchPage` as `ChessWorld`. It renders the match inside Arcade
without an agent connection. The standalone `/gummy?view=match` route remains
available for direct testing and the existing Cinema workflow.

The `onBackToArcade` callback returns to the hub without replacing the app.
`MainWorkspace` stays mounted, preserving the editor document, while the existing
tab-local match session restores the game on re-entry. Editor shortcuts,
secondary GPU loops and the main animation loop are gated while Chess is active;
an explicitly running export retains its own work. That means entering Chess
does not cancel an export, and performance measurements should record whether
one is active.

The match renderer owns its resources and the match canvas is unconfigured when
the world is torn down. A quality change rebuilds the relevant renderer resources
without unconfiguring the still-live canvas. Navigation and quality changes have
different ownership boundaries. The native verification below measures repeated
world exits and idle GPU submissions; it does not measure total driver memory.

Keep the material workbench and Cinema as adjacent tools. A collection opens in
the editor to change its pieces, in Chess to play, and in Cinema to film a saved
move receipt. PGN stays portable and independent of material recipes.

## Chess world entry and selection

The implemented match shell follows the deep-zoom explorer's full canvas and
glass-panel treatment, using the shared glass tokens from fork main. The board
stays visible behind an independently scrolling sidebar with reachable controls
on smaller viewports.

Large **Marble**, **Lagoon** and **Candy** cards select colour looks for the six
existing gummy moulds. **Classic**, **Glass** and **Lava** cards select board
finishes. The chosen card has an explicit selected state; material physics
remains controlled by the existing preset section. These are palette choices,
with future authored shape collections covered separately below. Existing
per-piece palette editing remains in the crash study.

All six preview images are real static WebGPU captures from the application,
stored under `packages/app/public/assets/chess/`. Their manifest records the
renderer, shapes, material settings and camera used for the captures. Cards show
all six roles or a complete starting board without allocating a preview scene.
A later live preview should mount only for the selected or visible card and have an explicit
resource owner. A grid of offscreen simulations would undo the bounded-resource
work. Check sidebar scrolling, focus, keyboard selection, selected contrast and
safe-area controls in desktop, tablet and phone layouts.

Keep local play immediately available. A future **Play with a friend** action
belongs after set and board selection, once a real room service exists. It should
create a session, copy its invitation and show whether the second seat is occupied.
Do not expose a share control that copies a local-only match and claims it is an
online game.

## Glass board followup

The user reports squares visually below and offset from the glass slab. Current
rendering separates the slab's top contact plane at `y=0` from the lower caustic
receiver at `GUMMY_BOARD_GLASS_FLOOR`. The reported mismatch still needs a fixed
camera reproduction; these distinct layers make their coordinates worth auditing.

Build one glass board with clear and tinted or frosted square insets. Define
square size, origin, parity, top height and playable bounds in one shared board
description. Derive both rendered insets and square picking/highlights from it.
Keep the 64 square tops coplanar with the pieces' contact plane and use small
bevels or shallow insets that preserve that contact. The lower receiver remains
a surface for transmitted light, with no duplicate playing grid beneath it.

Acceptance: top and grazing views agree with all four corner squares; legal-move
markers sit on the square surface; piece bases stay centred; selected-square and
capture framing align after orbit/zoom; caustics remain visible at bounded cost.
Compare Classic and Lava under the same camera to catch coordinate regressions.
This is a board-material pass; it does not require remeshing the gummy pieces.

## Capture mechanics and reproducible variety

Start with three explicit mechanics, each retaining the attacker on the captured
square:

| Mechanic         | Contact and material response                                                      | Boundaries                                                             |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Press and settle | Existing vertical compression, a short pause, then settle                          | Preserve as the comparison and fallback                                |
| Shoulder sweep   | Make contact before full compression, push sideways to smear and tear, then centre | Limit lateral travel to protect neighbouring pieces and camera framing |
| Rock and shear   | Offset contact followed by a small alternating roll/turn and downward press        | Collider and visible mesh must share the same rotation and velocity    |

The current shot motion contract already has shear timing and sweep parameters in
`gummyBoardShots.ts`, and version 2 Cinema recipes store explicit motion. Extend
that seam with versioned mechanic IDs and bounded parameters. Angular movement
must first be supported by the collider; rendering a tilt while colliding with an
upright piece would give misleading contact.

Choose a mechanic once per committed capture from those compatible with the
attacker/victim bounds, material and quality tier. Store a presentation envelope
alongside the immutable chess receipt: mechanic/version, seed, resolved motion
parameters, material snapshot and appearance references. Use a seeded choice
with a no-immediate-repeat rule where enough compatible variants exist. Replay,
reload, Cinema export and remote peers reuse the stored choice; no new random
choice is made during drawing or replay. Allow a fixed mechanic override in the
studio for comparison and recording.

The seed makes the choreography repeatable; cross-device GPU particle physics
is not promised to be bit-identical. Every variant must preserve the same legal
after-position through full playback, Skip, failure and Undo. Verify early
material contact, neighbour clearance, piece height/role combinations, visible
tearing before full squash, and frame/resource cost with matched presets.

## Private friend session architecture

The current Worker serves static assets and bounded APIs for sharing and gallery
content. `worker/index.ts`, `worker/types.ts` and `wrangler.jsonc` have no chess
room or WebSocket authority. The existing short-link store is for share payloads;
it cannot establish turn ownership or serialize competing chess moves.

Propose one server-owned room per match, implemented as a Cloudflare Durable
Object if it meets the deployment and cost review. The existing pure chess rules
package should validate moves on that authority as well as local play. Treat the
transport and room hosting choice as a later implementation decision; no remote
service is provisioned or deployed by this Arcade pass.

The room contract should carry:

- A versioned room ID, initial FEN, ordered move log, current revision and result.
- Independent credentials for each seat, an expiring invitation to join the open
  seat, and explicit reconnect/resume credentials. A room ID or viewer link alone
  must not authorize a move. Scope, expiry, revocation and storage of these
  credentials need review before public access; keep them out of logs and previews.
- Validated moves containing a unique command ID and expected room revision.
  Accept each command once, enforce turn/seat ownership, reject stale or illegal
  moves, and return the authoritative receipt and next revision.
- A pinned collection/board manifest and material settings selected in the lobby,
  plus the resolved capture presentation envelope. Asset references must use
  validated bounded recipes or approved storage, never arbitrary remote scripts.
- A bounded reconnect snapshot and receipts after the client's last revision.
  Reload and duplicate socket messages must neither repeat a move nor lose history.

Physics, lighting, camera and recording remain client-local. Send moves and
presentation recipes rather than particle positions or video. Different quality
tiers and Skip may change visual timing without changing the room's position.
Separate the authoritative position from the currently presented receipt, so a
slow capture queues or skips toward the latest revision safely. Neither player
should need to wait for the other player's GPU animation to finish.

Start with a private, unranked, untimed match with two seats. Add explicit resign,
draw offer/acceptance and reconnect states. Establish room lifetime, abandoned
room cleanup, rate limits and deployment budgets before opening invitations to
the public. Clocks, spectators, accounts and matchmaking are later decisions.

Acceptance requires two independent clients over an actual network: legal and
illegal moves, simultaneous submissions, duplicate/reordered delivery, stale
revision recovery, reload, sleep/wake, disconnect/rejoin, an expired invitation,
seat impersonation rejection and final-result agreement. Repeat with one slow or
non-rendering client; game correctness must not depend on WebGPU availability.

## Collection and rendering boundary

The rules in `packages/core/src/chess/` remain independent of rendering.
Before/after move receipts are authoritative; a skipped, replayed or failed
effect always reaches the same legal position. The proposed collection record
should contain:

- Version and stable collection identity, with six role slots.
- Shape recipe/source, deterministic seed, orientation, normalized bounds and a
  cached display mesh or point representation at explicit detail levels.
- Side palettes and optical settings, separate from mechanical response.
- Capture adapter and its parameters: gummy MPM, rigid glass fracture, or a
  bounded fractal-fragment experiment.
- Collision/occupancy representation where needed, validated separately from
  visual geometry. Preserve the editable source when baking a display asset.

Existing Figurine studies and Pawn Forge are the starting sources for IFS roles.
An arbitrary flame point cloud does not automatically define a solid volume or
physical connectivity. For a glass-enclosed fractal piece, the shell can provide
the collision and fracture body while the inner flame retains its authored
appearance. For a solid fractal body, prove occupancy/meshing and chunk ownership
on one pawn or Menger rook before building a general fracture adapter.

Keep static waiting pieces cached and simulate only the active capture. Gummy
response should remain MPM with a reconstructed surface; glass needs a distinct
fracture treatment. Changing colours alone should never select the physics.

No additional artistic guidance is needed for Arcade entry. Before producing a
new fractal collection, show a single pawn next to the approved classic gummy
silhouette and glass-enclosed studies. The useful art decision is whether the
first set is a glass shell with an authored fractal interior, or a solid fractal
body with visible recursive structure. Keep both as options in the plan; prove
one selected representation through the complete creator-to-play path first.

## Verification and later world placement

On 2026-10-08, 124 distinct focused tests passed across navigation, editor
shortcuts, canvases, the match and presets. Typechecking passed. The initial
`pnpm check` stopped at five test-style lint errors; those were fixed and scoped
ESLint passed, then the remaining formatting and WGSL validation steps passed.
The production build passed. This records the completed checks, rather than
claiming the original compound command completed in one run.

Native headed Chromium on AMD RDNA-4 verified saved looks and the `e2-e4` position
through three exits and re-entries. Live application-created resources settled at
24 after every world exit, down from the startup sample of 80 before lazy cleanup.
The idle observation recorded zero GPU submissions over 1.2 seconds. There were
no runtime/GPU errors or owner warnings. These counts concern tracked application
resources; browser swapchains, driver caches and other applications are excluded.

Actual CDP touch input selected cards at 834×1112, 390×844 and 844×390, alongside
the desktop 1440px check. Production Chromium screenshots at all four sizes were
inspected; controls can be hidden to return to the top of the board, and safe-area
padding keeps the panel reachable. Firefox production layout checks at 1440×1050
and 390×844 verified rendered and selected cards, loaded images, no horizontal
overflow, the standalone host and zero page errors. Its screenshots were inspected;
this is layout verification, not physical-GPU proof. Native evidence and the
`production.json` and `production-firefox.json` receipts are outside the repository at
`/home/maff/agent-out/chaos-master-fp/2026-10-08/arcade-chess/`.

Code-health metrics retain pre-existing rebased-branch debt: the pre-Arcade state
and current work both report 86 files over 500 lines, 40 over 800 and eight file-cap
failures. No baseline was relaxed. The affine-grid theme was extracted and its
file cap reduced from 1,172 to 1,154 lines.

Measure several captures on the physical tablet with other heavy apps closed, including
solver, surface and lighting cost. A stable desktop resource audit does not
establish tablet performance or total driver memory use.

After the collection contract works, the same match controller can host a chess
table in a fractal environment. Camera, picking and scene lighting would adapt
to that world, while rules, collections and move receipts remain shared. That
is a later presentation layer, not a prerequisite for the Arcade game.

Related: [play guide](gummy-chess-play.md), [Cinema](gummy-cinema.md), and the
[feature priority matrix](../assets/references/gummy-chess-roadmap.json).

# Chess in Lumen Apeiron

Integration plan, reviewed 2026-10-08. The user approved Arcade integration and
confirmed the checkmate overlay. The embedded Arcade entry and visual selection
sidebar are implemented and verified in native Chromium. Firefox production
layout checks pass; physical-device verification remains separate. The
glass and capture implementations below are ready for review; physical-device
acceptance and the later collection/network phases remain open.

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

## Glass playing surface (G16)

Implemented on 2026-10-08. The slab already contacted pieces at `y=0`, but the
projected colour below it dominated the image and the top had no distinct inset
edges. `gummyBoardGrid.ts` now owns square size, centre/orientation, bounds and
contact height. Piece placement, CPU picking, GPU square parity and legal-move
marker projection use that shared description. The slab and rim derive their
bounds from it as well.

The top now carries 64 flush material insets with alternating clear/frosted and
tinted glass, narrow etched seams and bevel shading. These are analytic material
regions on the existing slab, not 64 new meshes or recessed collision shapes.
Every playable square and marker stays on the contact plane. The glass below is
a neutral substrate with thin coloured insets; the separate lower receiver at
`GUMMY_BOARD_GLASS_FLOOR` contains transmitted light and no playing-grid texture.
The receiver adds only focused excess over the studio illumination, with a soft
source-rim taper. Ordinary transmission no longer paints a bright rectangular
carpet. Camera reflections retain the etched micro-bevels; transmitted light uses
the smooth cast normal as an approximation of frost and broad studio-light
averaging, so there is no second etched grid visible through the top.

This adds no draw calls, textures, per-frame geometry or uniform layout changes.
It retains the fixed 96 by 96 light grid and cached receiver transport. It does
add bounded per-fragment material arithmetic; physical-tablet timing remains to
be measured rather than inferred from unchanged draw counts.

Verification: 67 focused tests pass across the shared grid, board themes, shader
resolution, FEN placement, receipt presentation and choreography. Tests cover all
64 square interiors, all four corner rays including grazing angles, marker
projection at `y=0`, rim rejection and restrained transmitted colour contrast.
Native Chromium compiled the shaders without GPU errors; overhead and grazing
captures show aligned surfaces and piece bases. Matched Classic and Lava controls
are retained with the glass captures under
`/home/maff/agent-out/chaos-master-fp/2026-10-08/glass-captures/`. Native Arcade
selection markers and complete capture framing passed on Glass. All-corner
touch selection and physical iOS/tablet checks remain open. No gummy-piece
remeshing was required. The floor follow-up was checked from overhead, grazing
and near-horizontal cameras, with no GPU errors. Matched Classic and Lava
control captures are retained alongside the glass views in
`/home/maff/agent-out/chaos-master-fp/2026-10-08/glass-floor-fix/`.

## Capture mechanics and reproducible variety (G17)

Implemented on 2026-10-08. Three mechanics retain the attacker on the captured
square:

| Mechanic         | Contact and material response                                               | Bounds                                                                 |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Press and settle | Existing vertical compression, a short late sweep, then settle              | Original motion template, reduced when neighbours limit travel         |
| Shoulder sweep   | Start the sideways push early, hold partway down, then return to the square | Conservative piece footprints bound lateral travel                     |
| Rock and shear   | Alternate a small turn around the vertical axis while pressing and sweeping | Visible mesh and collider share yaw; contact includes angular velocity |

`gummyCaptureMechanics.ts` chooses once per ordinary committed capture using a
stable receipt seed and a shuffle bag reconstructed from retained captures. Each
round includes all three mechanics once, with no immediate repeat across rounds;
a cramped position can fall back to Press and settle. Repeated safety fallbacks
count once toward the round, so the other motions resume when space opens up.
Shared mould bounds and board occupancy cap travel and yaw before saving the choice. These conservative
limits can make the motion subtle on crowded squares. Material and quality remain
explicit settings, rather than separate selector heuristics.

The session v2 presentation envelope stores mechanic/version/seed, resolved motion
and a deep appearance snapshot beside the immutable chess receipt. Ply, pre-move
FEN and move notation identify the receipt on reload. Replay and Cinema handoff
retain the captured material, palette, board, scale and quality even if the live
board settings later change. Branching, Undo and a draw claim from history remove
orphaned future effects. Version 1 sessions migrate with their original early-shear
motion; invalid effect data falls back while preserving the legal game.

Cinema offers fixed **Press and settle**, **Shoulder sweep** and **Rock and shear**
choices. **Apply shot settings** stages the selected motion without changing the
material. New recipes use schema v3 with optional provenance and explicit motion;
v1/v2 imports retain their earlier motion semantics. Manual motion edits clear the
mechanic label and preserve the edited parameters. Loading or replaying a recipe
never recomputes motion from its label or seed. Editing a fixed choice's position,
source/target square or size recalculates clearance using the same mechanic and
seed; incomplete position input stays editable until valid. Custom and legacy
motion remains explicit through those edits. No choice is made during drawing or
replay.

The floor and selection follow-up passes 68 focused tests across board themes,
grid alignment, capture selection, shot motion, match state and saved sessions.
The original press retains its late sweep and zero twist. Regression coverage
checks complete shuffled rounds, repeated safety fallbacks, reload followed by
more captures, and replay of the saved press. Native Arcade and standalone match
pages load with HMR enabled and no page, GPU or failed-request errors.

Native Chromium on the desktop AMD GPU ran all three mechanics at Tablet quality
for the pawn-versus-knight Glass shot. Sampled particle state remained finite,
marching cubes reported no overflow or dropped vertices, and the run recorded no
errors or warnings. The attacker finished on the target square. The receipt is
`/home/maff/agent-out/chaos-master-fp/2026-10-08/glass-captures/capture-native.json`.
Studio controls and horizontal overflow checks passed at 1440, 834 and 390px widths.
The final focused run passed 211 tests across 17 files, including saved choices,
migration, replay, branching, draw claims, corner clearance and the fixed Studio
controls. `pnpm check`, the production build and agent-index check pass.

A native Arcade run played e2-e4, d7-d5 and e4xd5 with Rock and shear, then
replayed, reloaded and opened the same capture in Cinema. Motion and appearance
stayed identical; the pawn retained d5, no GPU/runtime errors occurred, and live
tracked buffers/textures settled at 57 after both capture and replay. The receipt
is `glass-captures/match-final.json`. Hidden test-browser frame pacing needed
`--disable-gpu-vsync` and `--disable-frame-rate-limit`; no app timing was changed.
This resource count is an ownership check, not a measurement of total driver memory.

Existing repository health debt remains: the file-size ratchet is red, though
this extraction reduces files above 800 lines from 40 to 39. The architecture
check reports 11 pre-existing dependency cycles; this pass adds none. No
baseline or check was weakened.

The next acceptance gate is physical iOS/tablet testing of the new angular contact,
plus matched visual and timing comparisons across more role pairs, material presets
and crowded positions. Desktop Tablet quality does not establish mobile performance;
finite-state checks do not prove realistic fracture or visually distinct tearing in
every pairing. The seed reproduces choreography, not bit-identical particles across
GPUs. After that gate, the next feature milestone is G8's one authored fractal pawn
through edit, save, board placement, capture and Cinema. Friend sessions remain
planned; no network play is implemented by this pass.

## First authored pawn (G8)

Implemented on 2026-10-08. The first trial uses a finite-thickness structural IFS pawn with the
existing gummy MPM material. It is a single-role comparison: the other five
roles keep their approved gummy shapes. The original echo and lattice studies
remain available. Glass transparency is deferred at the user's request; its
rigid fracture and optical pass remain separate from this soft-body trial.

Pawn Forge can save up to eight named local pawn snapshots. Chess can select the
built-in lattice trial or a saved pawn, and open it for editing. Each snapshot
pins the generator/bake version, parameter recipe, seed and physical thickness.
The native IFS is sampled deterministically, thickened into a bounded distance
field and resampled into equal-volume material cells. It does not treat the
nonuniform density of IFS points as physical mass.

One field supplies the resting mesh, capture particles, pointer picking and
attacker contact. The authored pawn stays within the existing conservative pawn
bounds used by camera framing and capture clearance. Static waiting pieces use
cached compact meshes; only the active victim uses MPM. Changing shape rebuilds
the renderer while keeping the orbit. The match cache preserves active leases
and retains at most two unused variants; the CPU volume cache also holds two.

Captures store their own validated shape snapshot. Editing or removing a library
entry cannot change an old capture, and Cinema imports the recorded shape. Old
sessions and shots without an authored pawn keep the original gummy shape.
Saved shapes live in this browser; the Cinema JSON includes the complete snapshot
for transfer. This pass does not add cloud library sync or friend sessions.

Native Chromium on the desktop AMD GPU verified Forge save, reload and editing,
saved-shape selection, and switching between classic and authored pawns at a
390px viewport without horizontal overflow. An Arcade match played e2-e4, d7-d5
and e4xd5, replayed the capture, reloaded and opened that capture in Cinema with
the same authored snapshot. The sampled 2,947-particle victim state stayed finite.
Tracked live GPU resources settled at 62 after both capture and replay, with no
runtime or GPU errors. These are application resource counts, not total driver
memory or physical-tablet performance measurements. Screenshots and receipts are
under `/home/maff/agent-out/chaos-master-fp/2026-10-08/authored-pawn/`.

The final focused run passed 301 tests across 22 files, including strict snapshot
validation, connected material sampling, cache eviction, immutable replay,
Forge draft isolation and the old pawn designs. Typecheck, lint, formatting,
WGSL validation, production build and agent-index checks pass. The first
`pnpm check` stopped at a new affine-field narrowing error; it was fixed, then
typecheck and all remaining stages passed separately.

The material radius deliberately joins thin recursive branches into a connected
body at every supported particle spacing. That also fills small openings: the
playable shape currently reads as a lobed crown over a solid stem and squared
foot, while the Forge source preview retains finer IFS structure. Do not present
this first trial as a finished high-detail fractal collection.

Acceptance still requires a visual review of this first solid pawn before a
six-role fractal set. Compare branch readability, resolved openings and the
capture result on a physical tablet, then tune the design or its material.

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

# Chess in Lumen Apeiron

Proposed integration sequence, reviewed 2026-10-08. This is the next-step plan;
the Arcade entry and collection adapters below are not implemented yet.

The user has played the local match through checkmate and published the Cinema
film. Keep that working game, its PGN history, material presets and shot pipeline
as the foundation. Chess fits in **Lumen Arcade** as a directly playable game,
with the fractal editor feeding its piece collections and Cinema recording its
captures.

## Recommended sequence

| Step                                        | Benefit                                                            | Relative effort                  | Acceptance before expanding                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Finish the playability pass              | Clear game endings, correct capture handoffs, bounded resource use | Small                            | Result overlay, full replay/Skip and repeated-capture resource checks pass; repeat the run on the target tablet                              |
| 2. Add a Chess entry to Arcade              | Make the existing game discoverable inside Lumen Apeiron           | Small                            | Open a match without an agent connection; preserve editor state on return; verify editor compute is suspended and resources are bounded      |
| 3. Introduce saved piece collections        | Share one collection between the creator, board and Cinema         | Medium                           | Versioned six-role collection restores shape, side colours, bounds, orientation and material response; current gummy set remains the default |
| 4. Prove one authored fractal pawn          | Connect actual IFS creation to play                                | Medium to large                  | Edit, save, reopen, place, capture and film the same pawn; silhouette reads at game distance and cached geometry fits the measured budget    |
| 5. Expand material-specific capture effects | Give gummy, glass and fractal collections distinct behaviour       | Large, with research uncertainty | Matched single-capture comparisons show coherent separation and bounded frame/memory cost before expanding to six roles                      |

The immediate next feature after device verification should be the Arcade entry.
The first creator milestone should be one saved pawn, rather than six new role
editors and several physics systems at once. Online multiplayer, a fully soft
32-piece board and a walkable world can be evaluated after these paths work.

## Fit with the current app

`components/Arcade/ArcadeHub.tsx` currently lists six agent-led modes, and
`lib/activeTab.ts` owns their hash navigation. Chess needs a playable card with
ordinary navigation, not a prompt panel or agent prerequisite. Update the hub's
introductory copy to include both direct play and agent-led modes at that time.

Start by linking to the existing `/gummy?view=match` route with an explicit return
to Arcade. Verify editor document persistence before leaving it. The current
`App.tsx` mounts Arcade above `MainWorkspace`, retaining the editor's resources;
an embedded match must verify the existing visibility/compute gates and total
memory budget. Merely hiding the editor is not proof that all GPU work stops.
Avoid keeping a second, hidden chess simulation alive on navigation.

Keep the material workbench and Cinema as adjacent tools. A collection opens in
the editor to change its pieces, in Chess to play, and in Cinema to film a saved
move receipt. PGN stays portable and independent of material recipes.

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

## Verification and later world placement

Before shipping Arcade access, check direct navigation, reload, editor return,
same-tab saved matches, touch controls and reduced render quality. Measure
several captures on the physical tablet with other heavy apps closed, including
solver, surface and lighting cost. A stable desktop resource audit does not
establish tablet performance or total driver memory use.

After the collection contract works, the same match controller can host a chess
table in a fractal environment. Camera, picking and scene lighting would adapt
to that world, while rules, collections and move receipts remain shared. That
is a later presentation layer, not a prerequisite for the Arcade game.

Related: [play guide](gummy-chess-play.md), [Cinema](gummy-cinema.md), and the
[feature priority matrix](../assets/references/gummy-chess-roadmap.json).

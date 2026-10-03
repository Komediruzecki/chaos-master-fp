<!-- Research and implementation proposal for fracturing native IFS chess figurines, 2026-09-30. -->

# Fracture that belongs to the figurine

There is a mathematically sound way to split these fractals into recognizable parts. The useful next step is to keep each part's original geometry together as it moves. The current board instead fractures a common glass envelope and disperses the core's samples independently. It does not preserve the fractal's recursive parts or solve collision stress.

This is a research proposal. The board's capture effect has not been replaced in this pass. The new `/figurines` page compares three additional native IFS studies against the original lattice pawn.

## The mathematical starting point

For a contractive IFS with maps `f₁ … fₘ`, its attractor satisfies `K = ⋃ᵢ fᵢ(K)`. Repeated composition gives smaller subsets, `K_w = f_w₁ ∘ … ∘ f_w_d(K)`. For our affine studies these are affine images; anisotropic maps need not preserve shape. This supplies a hierarchy of candidate pieces. It does **not** guarantee that those pieces are disjoint or physically connected. This construction follows the invariant-set framework in [Hutchinson, _Fractals and Self-Similarity_ (1981)](https://doi.org/10.1512/iumj.1981.30.30055).

For this renderer, the proposed fragment identity is `(walker component, outermost map address)`. The independent `walkGroup` components must remain separate during sampling. In a chaos-game chain `xₙ = fᵢₙ(xₙ₋₁)`, the newest map is the **outermost** one. Store recent map IDs newest-first; a chronological prefix from the start of the walk is wrong. Apply the descriptor's final affine only when plotting, as the current sampler already does.

Choose a prefix-free set of addresses that covers the sampled population. A weak hit can release a few coarse fragments; a stronger hit subdivides only the affected fragments into their children. Avoid allocating all `m^d` possible fragments: build the occupied hierarchy and impose a fragment budget and minimum size.

At impact, freeze the visible samples and their membership. For a fragment with centre `c`, animate each of its points with the same rigid transform:

`x(t) = R_fragment(t) · (x(0) − c) + c + translation_fragment(t)`.

With `R_fragment(0) = identity` and zero initial translation, this reproduces the intact sample exactly. An orthonormal rotation preserves pairwise distances inside a fragment. That is the identity-preserving behavior missing from the present independent point burst. These equations describe our proposed animation, not an established law of fractal fracture.

## What must be supplied in addition to the fractal

An ideal fractal is not automatically a solid material. For example, after `d` iterations a unit Menger construction retains volume `(20/27)^d`, which tends to zero. A four-child, half-scale tetrahedral construction retains `(1/2)^d`. Those limits cannot simply be assigned ordinary bulk glass density and treated as solid chess pieces.

We must choose a finite material representation: stop the construction at a specified depth, thicken its structure by a radius, or construct an occupancy/density field with an explicit threshold. That choice controls physical volume, collisions and visible minimum feature size. Artistic sample probabilities determine brightness; they are not automatically physical mass or stiffness.

Address groups can overlap and can contain disconnected islands. Keep exactly one owner for every rendered sample. For solid geometry, partition overlapping volume explicitly, then split disconnected islands. A hull spanning a large void would make invisible material participate in collisions. Likewise, nearby points across a cavity must not acquire a bond merely because they are nearest neighbours.

The original Glass echo also uses stochastic `blur3D` maps. Its random reset operations do not have the same deterministic cylinder-set interpretation as the new affine studies. One option is a spatial partition of its frozen samples or materialized volume. Another is to retain the last reset primitive and the deterministic map suffix since that reset; earlier history no longer determines the point's geometry. Either partition can feed the same runtime fracture animation.

## A shared runtime that can serve different fractals

My recommendation is **recursive fragments plus a graph of material connections**:

1. While building the figurine, retain component and address membership, a finite material representation, fragment centres, masses and collision proxies.
2. Connect fragments only across actual material contacts. Store contact area/orientation and tunable breaking strength. Do not mistake recursive ancestry for physical adjacency.
3. At contact, obtain impact position, direction and impulse from the collision model. Propagate damage through the graph. Break selected bonds, then find the remaining connected components.
4. Move each released component as a rigid body, retaining its original fractal points or surface. Reserve dust for the smallest residual fragments.
5. Subdivide near the impact when needed. Keep distant structure in larger chunks. The glass envelope can have its own thinner, brittle fracture layer, aligned with the same contact event.

The graph approach has a practical reference in [NVIDIA Blast's support model](https://docs.omniverse.nvidia.com/kit/docs/blast-sdk/latest/docs/api/introduction.html): connected chunks become actors after bonds break. Its [stress extension](https://nvidia-omniverse.github.io/PhysX/blast/docs/api/extensions/ext_stress.html) operates on that graph and requires physical node data. We can implement the relevant ideas in our existing renderer; this is not a proposal to install the SDK.

A simple distance-based damage function would be a controllable game approximation. Calling it a stress simulation would require an actual force/stress model. Matching contact time, impulse direction, retained silhouette, angular motion and persistent debris should come before more particles or brighter flashes.

## Alternatives worth keeping

| Approach                                               | What it provides                                                     | Fit here                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| IFS addresses + material connection graph              | Coherent fragments whose structure follows the generator             | Best first prototype for the new affine studies; needs overlap and connectivity handling |
| Spatial/Voronoi cells clipped to a materialized volume | A common partition for arbitrary shapes, including stochastic flames | Useful fallback; Voronoi cells alone are not a fracture law                              |
| Precomputed fracture modes                             | Shape-dependent break patterns selected by impact                    | Strong later option once we have a finite solid per recipe                               |
| Meshless elastic fracture                              | Stress and evolving cracks using surface/volume samples              | Research-grade option with substantially more simulation work                            |

[Müller, Chentanez and Kim (2013)](https://matthias-research.github.io/pages/publications/fractureSG2013.pdf) demonstrate impact-local geometric fracture using volumetric convex decompositions. The method separates visual detail from the volume used for fracture. Our point clouds do not yet provide that volume.

[Sellán and colleagues, _Breaking Good_ (2022)](https://www.dgp.toronto.edu/projects/breaking-good/) precompute shape-specific fracture modes and project impacts onto them. Their [released implementation](https://github.com/sgsellan/fracture-modes) accepts tetrahedral volume data. This could give user-designed pieces characteristic weak regions without simulating crack propagation during every capture.

The reference implementation is not directly usable on our point clouds: its example tetrahedralizes a coarse cage and requires numerical dependencies including TetGen, libigl, scikit-sparse and a MOSEK licence. Its stated licence permits academic, non-commercial, non-military use; commercial use requires contacting the authors. Treat it as a later research reference, not a dependency approved for this game.

[Pauly and colleagues (2005)](https://graphics.cs.kuleuven.be/publications/MAOFS2005/index.html) show that meshless fracture is possible, but their framework includes an elastic material, volume sampling and explicit crack evolution. Rendering a cloud of points alone does not provide those ingredients.

## The comparison studies

| Figurine          | Structure to inspect                                       | Candidate break character, not yet implemented                |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Lattice pawn      | Existing faceted head, branching shaft and perforated foot | Faceted head clusters, stem joints and base fragments         |
| Menger rook       | Cubic tower and crenellations with repeating voids         | Hollow block clusters; preserve their holes while they tumble |
| Sierpinski bishop | Tetrahedral structure in a pointed bishop form             | Angular clusters; finer subdivision around the contact        |
| Branching knight  | Bent neck and projecting head with recursive branches      | Branches snap at their attachments and remain recognizable    |

The new bishop and knight components share designated fixed points at their attachments. This removes gross placement gaps; it does not prove that every recursive island is connected or give a point contact finite strength. A chosen thickness and an actual material connectivity check are still required before fracture physics.

The live study page renders native IFS descriptors. The six new GLBs and JSON recipes in this directory are reproducible comparison assets, exported by `packages/app/scripts/export-figurine-studies.mjs`. The GLBs contain 48,000 points each, without a glass envelope or triangle surface. They are not yet watertight PBR solids or collision meshes. See `figurine-studies-manifest.json` and the fresh Blender import receipt `figurine-studies-loader-report.json`.

## Acceptance checks for the next prototype

- At impact, fragment geometry reconstructs the intact sample without a position jump, duplicated samples or missing samples.
- Each fragment preserves internal distances while moving; its holes and branch shape remain visible.
- Moving the impact changes which nearby connections fail and the direction of motion.
- Mass is derived from the chosen physical representation, with linear/angular momentum and energy checked under the chosen collision and fracture model.
- A small hit can chip a local region; a large hit can break it more deeply. Budget limits change detail rather than remove half the object.
- Debris collides with the board, then sleeps or fades deliberately. Camera distance, reduced motion and repeated captures remain usable.

The first experiment should expose an exploded view and a single repeatable impact on the Menger rook. Its grid makes fragment boundaries and missing/duplicated material easiest to verify. The knight is the next useful challenge because it exposes whether the connection graph follows the actual structure.

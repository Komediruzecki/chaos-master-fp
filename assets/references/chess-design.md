# Human-scale chess collection

Status: superseded by the fractal glass direction. Retained as the original design reference; its proposed production budget is not approved. See chess-fractal-plan.json and the chess-fractal concept images. No Meshy generation has been submitted.

References created with the built-in ChatGPT image generation tool:

- chess-pieces-concept.png
- chess-board-concept.png

## Proposed design

Warm satin ivory porcelain and near-black polished volcanic stone, restrained brushed champagne-gold base bands, softened edges, clear traditional chess silhouettes, minimal ornament.

Six unique shapes: king, queen, bishop, knight, rook, pawn. Each shape will have light and dark material variants. Board: exact 8 x 8 grid on a low flat square platform.

## Proposed scale

GLB units: meters. Origins centered on base contact plane; final glTF Y up.

| Piece  | Height (m) |
| ------ | ---------- |
| King   | 1.80       |
| Queen  | 1.65       |
| Bishop | 1.45       |
| Knight | 1.40       |
| Rook   | 1.25       |
| Pawn   | 0.95       |

Board squares: 1.2 m. Playing surface: 9.6 x 9.6 m. Outer dimensions: 10.4 x 10.4 m. Platform thickness: 0.16 m.

## Proposed production

Use approved individual reference images with Meshy CLI 0.4.0, Smart Topology image-to-3D, PBR textures, GLB outputs. Seven unique models at estimated 15 credits each, 105 credits total according to https://docs.meshy.ai/en/api/pricing read 2026-09-30. Estimate, not an actual charge. No paid reruns or extra stages included.

Retain provider originals and task receipts. Make local light/dark variants using shared geometry, apply exact meter scale and base origins, check exact board layout, inventory actual geometry and embedded textures, and inspect exported models in a fresh renderer. Expected final standalone outputs: six light piece GLBs, six dark piece GLBs, chess-board.glb, all in assets/.

## Piece reference prompt

Use case: stylized-concept
Asset type: design approval reference sheet for a human-scale chess collection for a video game.
Primary request: Create an exceptionally beautiful, elegant, minimal contemporary chess collection, with six clearly identifiable piece types, an architectural sculptural presence, and physically plausible PBR materials. This is a concept lineup for user design approval, not a playable board scene.
Scene/backdrop: seamless pale warm gray studio, softly lit, no environment clutter.
Subject and composition: landscape editorial industrial-design sheet. Top two-thirds: six individual ivory chess pieces in one straight row, fully visible, generous separation, no overlaps, all grounded on a shared baseline, ordered KING, QUEEN, BISHOP, KNIGHT, ROOK, PAWN from left to right. Their relative heights: 1.80, 1.65, 1.45, 1.40, 1.25, 0.95 meters. Bottom third: a smaller matching row of the same six exact shapes in obsidian-black finish, with readable rim lighting. Orthographic-like three-quarter view, long lens with minimal perspective, camera at piece mid-height. Six labels below top row, tasteful small typography, exact labels 'KING', 'QUEEN', 'BISHOP', 'KNIGHT', 'ROOK', 'PAWN'. No other lettering.
Shared design language: a wide low circular plinth base with a thin recessed brushed champagne-gold metal band, beautifully softened bevels; a pure, gently tapering sculptural body; no ornamental engraving, no filigree, no noise. Graceful clean surfaces, bold iconic tops. Ivory pieces are warm satin porcelain with subtle micro-surface variation, black pieces are near-black polished volcanic stone with subdued reflections, metal accents are sparse genuine brushed metal.
Distinct top silhouettes: KING has a thick simple upright cross rising from a restrained collar; QUEEN has a simple crown with five broad solid points and a clean open rim; BISHOP has a sleek mitre with one pronounced diagonal slit; KNIGHT has an abstract but unmistakable horse head and neck carved in sweeping planes, ears clearly separate and muzzle readable, no eyes engraved, no mane strands; ROOK has a stout pure cylindrical tower ending in four broad squared crenellations; PAWN has a simple perfectly spherical head above a slender collar.
Design quality: timeless museum-quality collectible objects at monumental human scale, precision-crafted forms and elegant proportional rhythm. Visual impact comes from silhouettes and light, not ornament.
Lighting: large soft studio key light, neutral fill, crisp controlled soft reflections, gentle contact shadows, no dramatic colored lights, geometry visible.
Constraints: exactly six different types per row, all whole objects including bases, no chess board, no humans, no weapons, no logo or watermark, do not simplify away identifying chess features, no extra chess pieces, do not merge pieces together.

## Board reference prompt

Use case: stylized-concept
Asset type: approval reference image for the CHESS BOARD that belongs to the human-scale minimal luxury chess collection in the preceding image.
Input images: previous image is a material/style reference only: use the same warm ivory porcelain, obsidian-black stone, restrained brushed champagne-gold detailing and precision softened edges. Do not put any chess pieces on the board.
Primary request: an exceptional elegant minimal monumental chess board for a human-size chess video game. Buildable geometric object with physically plausible PBR materials.
Composition: landscape product design sheet with a large empty complete board in the left two-thirds viewed from elevated three-quarter angle with mild perspective; in the right third a smaller truly orthographic top-down view of the same complete board to prove the exact 8 by 8 layout. Both views show the entire perimeter, every corner, no cropped edges. Plain warm light gray seamless studio background. No labels or text.
Geometry: exactly 8 rows and 8 columns of perfectly equal alternating ivory and obsidian square tiles, 64 squares total, 32 light and 32 dark. The row nearest the viewer has a dark square at far left and a light square at far right. Square size 1.2 meters, playing surface 9.6 by 9.6 meters. Slim flat square platform, total 10.4 by 10.4 meters including uniform 0.4 meter border on each side, total thickness 0.16 meter. Top of tiles completely coplanar and walkable, almost invisible precision seams, no raised barriers. Border is pure satin obsidian, one narrow recessed champagne-gold line running around the outer top perimeter, softened microbevels on corners and edges. Platform side wall is solid obsidian with a slim inset gold trim. No pedestals, no feet, no legs, no floating detached frame, no railings.
Materials: warm satin ivory porcelain on light squares with very subtle tiny surface texture, near-black polished volcanic stone on dark squares and border with extremely sparse fine natural veins, brushed champagne-gold metal line. No shiny mirror floor, no grime, no ornamental etching, no logos. Balanced subtle reflective response; clean base color.
Lighting: luxury studio visualization, large soft side key, neutral fill, soft realistic contact shadows below platform, precision edge highlights, tasteful controlled reflections.
Visual quality: timeless architectural luxury, clean breathtaking silhouette and crafted material contrast. Preserve exact geometric regularity and checker count; do not invent extra rows or columns. No chess pieces, no human, no environment props, no watermark.

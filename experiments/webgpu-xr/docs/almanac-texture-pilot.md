# Almanac surface detail pilot

The current desktop pass uses authored Blender material factors, analytic studio
reflections and filtered shader grain. It does not load texture images, an
environment map, or glass transmission. The same exported palette is visible in
Blender and both runtime book views. No material values are secretly replaced in
the shared GLB parser.

## Next experiment, if the desktop review still needs tactile detail

Try one 512 × 512 RGBA8 **linear** repeating detail image, with mip levels and
anisotropic filtering. This is a separate runtime resource, not a texture inside
the GLBs. Project it in book-local coordinates at one tile per 48 mm. Use it only
for black paper and leather; keep the earned stars, gems, ink and silver crisp.

| Channel | Meaning                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| R       | Height, centred on 0.5; derive a shallow surface normal                             |
| G       | Roughness offset, at most ±0.1                                                      |
| B       | Albedo multiplier, 0.9–1.1                                                          |
| A       | Reserved; a repeating texture cannot encode unique shadows under individual reliefs |

A distinct non-repeating bake or analytic contact term would be needed for
relief shadows. Do not claim the tiled A channel provides that bake.

Allocate one texture and one sampler when the book loads. A neutral 1 × 1
fallback must keep the book usable on image failure, without changing progress
or withholding geometry. Dispose all resources on replacement and unmount.
Mip storage is approximately 1.33 MiB at 512² RGBA8, plus the sampler.

Compare fixed-camera exports at 1440 × 950 and 390 × 844, with material and clay
views, then orbit and zoom to check shimmer. Retain the change only if the paper
and leather become clearly more tactile without obscuring the stars, melody or
live fractals. Desktop acceptance is separate from Quest performance and stereo
comfort checks.

## Current lighting

Warm front-left key, a cool fill and a rear rim light reveal the raised geometry.
An analytic softbox and narrow cool strip provide view-dependent reflections.
The broadening depends on roughness. Material-specific grain fades before its
period becomes smaller than two screen pixels. Book-local coordinates prevent
grain from sliding when the Observatory transforms the book.

This is an intentionally limited material experiment. It does not add a general
texture pipeline, change saved progress or introduce another renderer.

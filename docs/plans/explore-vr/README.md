# Immersive desktop fractal atlas

The `/explore-vr` prototype places five flame worlds inside a fullscreen cosmic
scene. It runs in the existing Solid app and uses the existing TypeGPU/WebGPU
3D flame pipeline for the selected world. A perspective camera travels between
fixed world positions above a generated nebula environment. It does not start
a WebXR session.

![The desktop atlas rendering Verdant with the existing 3D flame pipeline](preview.png)

## Try it

Open `/explore-vr`, or use **Explore VR** in the desktop studio's version menu.
Select a world in space or in the thumbnail passage at the bottom. A 1.6-second
camera flight brings it into view. Drag the large world to orbit, or scroll to
zoom. Focus its canvas for arrow-key orbiting and `+`/`-` zoom. The information
button beside its name opens the inspector with zoom, reset, isolation and
discovery controls. Escape closes the inspector and returns focus.

**Guided journey** is opt-in. It waits nine seconds after arrival before moving
to the next world. Manual world selection or camera input ends the journey.
The top pause button freezes scene travel, flame refinement and the tour;
selection and reset preserve this pause. Explicitly starting a guided journey
resumes the scene. Hidden tabs suspend work without catching up missed stops.
Reduced-motion preference makes world changes immediate. The fullscreen button
uses the browser's Fullscreen API, with a notice when it is unavailable.

**Keep this discovery** records the selected world's ID in localStorage on the
current device. It is a personal bookmark, not an account, collectible economy,
or claim of completing a game. If storage is blocked, the page explains that
the log lasts only for the current visit. The fragment, such as `#verdant`,
reopens the selected world; camera positions are not persisted.

## Rendering boundary

- `orbPresets.ts` contains five authored 3D flame recipes and their inspection
  descriptions. These are fictional worlds with actual variation names.
- `atlasCamera.ts` contains the world positions, look-at projection, framing
  and shortest-path camera interpolation. `ImmersiveAtlas.tsx` uses that same
  projection for world billboards, 1,300 stars and fine orbital paths. It draws
  only when the camera or viewport changes; there is no idle animation loop.
- `FlameOrb.tsx` owns a GPU root, a compute gate, the selected canvas, and
  camera signals independent of editor state/history. Sampling refines a
  monoscopic image and stops at its quality budget. Camera changes restart
  accumulation. It pauses when hidden, off screen, or explicitly paused.
- A captured world remains visible during travel. The new live renderer mounts
  after arrival, keeping shader construction out of the camera flight. A local
  readiness latch keeps its poster visible until the new renderer is ready;
  same-world reset and resize preserve the existing renderer and readiness.
- Neighbors and unavailable-GPU images are captures of the same recipes.
  The nebula is generated environment art; its provenance is in
  [the asset notes](../../../packages/app/src/pages/ExploreVR/assets/README.md).
  There is no per-satellite GPU renderer or additional engine dependency.
- Entry routing follows the app's standalone-page mechanism, including static
  `explore-vr/index.html` output and Worker canonical slash redirects.

This preview combines real perspective scene movement, captured neighboring
billboards and one monoscopic live flame. It does not provide stereoscopy,
headset tracking, hand tracking, physics, entering a fractal, arbitrary-depth
zoom, combat, or an astronomy simulation. The progressive screen accumulator
must still be evaluated separately for a future stereoscopic renderer.

## Design and next decision

The [surface design](DESIGN.md) follows the user's orb concept and delegated
orbital arrangement. Start with this visual result when deciding whether to
invest in denser flame worlds, a real two-universe journey, and an XR renderer.
The separate personal research pack tracks rules, hardware, architecture
tradeoffs and the user's available 100–300 hours. Weekly allocation and the
eventual headset implementation remain open.

## Verification

Focused tests cover route/static/Worker behavior, menu discovery, page state and
storage failure, preset schema/WGSL resolution, and local camera input. Real
WebGPU verification uses standalone headed Chrome with a hardware adapter;
the repository's configured Playwright suite forces SwiftShader and is not
used as GPU evidence. Phone/tablet checks are browser viewport and touch-input
checks, not physical-device or Quest validation.

The initial gallery prototype was verified on 2026-09-24 with 132 focused tests
and hardware WebGPU checks. The fullscreen iteration passed 56 focused tests
across page, scene, camera, renderer and recipe suites, including renderer
ownership after paused and running reset/resize. Typecheck, focused lint,
formatting, WGSL validation, production build, generated index and citation
checks passed. The design detector reported only the retained app font, Inter;
the existing typography is intentional. Independent visual review passed
desktop, phone, tablet and short landscape compositions.

The production build passed standalone headed Chrome on AMD RDNA4: camera
travel and interruption, pause/reset/resize recovery, one live GPU canvas,
guided timing, local inspection/discovery, reduced motion, native fullscreen,
phone/tablet/short-landscape controls and emulated touch input. No page or
console errors were observed. The unavailable-GPU atlas retained navigation,
images and discovery; Firefox also passed phone fallback layout and selection.
These checks establish desktop behavior, not frame-time, VRAM or Quest budgets.

The preview above is a production-build screenshot, not an AI concept.

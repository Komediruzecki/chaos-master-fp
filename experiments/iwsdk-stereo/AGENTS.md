# Stereo flame experiment

Follow the repository-root instructions. This nested pnpm workspace pins IWSDK
and TypeGPU independently from the production app.

- Run this workspace's `pnpm typecheck`, `pnpm build`, and `pnpm verify`.
- `iwsdk.config.json` owns the scene, asset catalog, component catalog, XR
  features, and emulator activation. Pass `virtual:iwsdk-project` to World.create.
- Import Three runtime classes from `@iwsdk/core` to avoid duplicate instances.
- Reuse the source sampler in the sibling GL spike; do not copy variation math.
- TypeGPU generates GLSL helpers. IWSDK owns the only WebGL/XR frame loop,
  render targets, camera matrices, geometry, uniforms, blending and depth state.
- Never apply a desktop camera pose or IPD to a physical headset. Only IWER is
  configured with a 63 mm IPD. Two viewports with zero eye spacing are not stereo.
- Browser UI is Solid; scene interaction uses RayInteractable and Pressed.
  Initialize existing query members as well as future qualify events.
- Keep the flame in world space. Head movement must preserve the geometry UUID.
- Keep emulator injection off on Quest user agents and in production builds.
- Start managed dev with `--no-open`: the SDK browser launcher has no custom
  class option in this version. Verification launches headed Chromium with
  `--class=agent-browser` and controls the public IWER remote API. Do not change
  installed SDK files or claim this verifies the managed scene editor.
- Desktop emulation never proves Quest performance, comfort or tracking quality.

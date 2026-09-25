// Inspect real renderer cameras and resources only when requested, never per eye.
import { Mesh, RawShaderMaterial, Vector3 } from '@iwsdk/core'
import { experience } from './flame-system'
import { pointCount } from './scene-assets/flame.scene-asset'
import type { World } from '@iwsdk/core'
import type { XRDevice } from 'iwer'

export function snapshot(world: World) {
  const session = world.renderer.xr.getSession()
  const cloud = world.scene.getObjectByName('FlameCloud')
  const rig = world.scene.getObjectByName('Flame')
  const cameras = world.renderer.xr.getCamera().cameras
  const gl = world.renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    ...experience,
    backend: 'IWSDK WebGL + TypeGPU GLSL',
    pointCount,
    immersive: world.renderer.xr.isPresenting,
    visibility: session?.visibilityState ?? 'desktop',
    referenceSpace: world.renderer.xr.getReferenceSpace()?.constructor.name,
    eyes: world.renderer.xr.isPresenting
      ? cameras.map((camera) => ({
          // Read the tracked matrix without updating or recomposing SDK-owned cameras.
          position: new Vector3()
            .setFromMatrixPosition(camera.matrixWorld)
            .toArray(),
          projection: camera.projectionMatrix.toArray(),
          inverse: camera.matrixWorldInverse.toArray(),
          viewport: camera.viewport.toArray(),
        }))
      : [],
    center: rig?.getWorldPosition(new Vector3()).toArray(),
    cloudId: cloud?.uuid,
    geometryId: cloud instanceof Mesh ? cloud.geometry.uuid : undefined,
    shader:
      cloud instanceof Mesh && cloud.material instanceof RawShaderMaterial
        ? cloud.material.vertexShader
        : undefined,
    resources: { ...world.renderer.info.memory },
    draw: { ...world.renderer.info.render },
    renderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    experimentalWebGPUBinding: 'XRGPUBinding' in window,
    emulator: window.__IWSDK_EMULATION_PROFILE?.active ?? false,
    headsetTested: false,
  }
}

declare global {
  interface Window {
    IWER_DEVICE?: XRDevice
    __IWSDK_EMULATION_PROFILE?: {
      active: boolean
      device: string | null
      runtime: string | null
    }
    __lumenStereo?: {
      world: World
      snapshot: () => ReturnType<typeof snapshot>
    }
  }
}

// Minimal additions from the 2026-08-12 WebXR/WebGPU binding draft.
// Keep these local until @types/webxr includes the experimental binding.
export interface GpuSubImage {
  readonly colorTexture: GPUTexture
  readonly viewport: XRViewport
  getViewDescriptor(): GPUTextureViewDescriptor
}

export interface GpuXrBinding {
  getPreferredColorFormat(): GPUTextureFormat
  createProjectionLayer(init: {
    colorFormat: GPUTextureFormat
  }): XRProjectionLayer
  getViewSubImage(layer: XRProjectionLayer, view: XRView): GpuSubImage
}

export type GpuXrBindingConstructor = new (
  session: XRSession,
  device: GPUDevice,
) => GpuXrBinding

declare global {
  interface GPURequestAdapterOptions {
    xrCompatible?: boolean
  }
  interface Window {
    XRGPUBinding?: GpuXrBindingConstructor
  }
}

export interface EyeTarget {
  eye: string
  projection: Float32Array
  view: Float32Array
  position: number[]
  viewport: { x: number; y: number; width: number; height: number }
  color: GPUTextureView
  clear: boolean
  arrayLayer: number
}

/** Views belong to this XR callback only; never retain their GPU attachments. */
export function collectXrTargets(
  binding: GpuXrBinding,
  layer: XRProjectionLayer,
  pose: XRViewerPose,
): EyeTarget[] {
  const cleared = new Map<GPUTexture, Set<number>>()
  return pose.views.map((view) => {
    const sub = binding.getViewSubImage(layer, view)
    const descriptor = sub.getViewDescriptor()
    const arrayLayer = descriptor.baseArrayLayer ?? 0
    const slices = cleared.get(sub.colorTexture) ?? new Set<number>()
    const clear = !slices.has(arrayLayer)
    slices.add(arrayLayer)
    cleared.set(sub.colorTexture, slices)
    const p = view.transform.position
    return {
      eye: view.eye,
      projection: view.projectionMatrix,
      view: view.transform.inverse.matrix,
      position: [p.x, p.y, p.z],
      viewport: {
        x: sub.viewport.x,
        y: sub.viewport.y,
        width: sub.viewport.width,
        height: sub.viewport.height,
      },
      color: sub.colorTexture.createView(descriptor),
      clear,
      arrayLayer,
    }
  })
}

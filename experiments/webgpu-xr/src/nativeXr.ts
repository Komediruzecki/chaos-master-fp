// Native session ownership, including cancellation while entry is still pending.
import { collectXrTargets } from './xrTypes'
import type { EyeTarget, GpuXrBindingConstructor } from './xrTypes'

export interface XrCallbacks {
  start(format: GPUTextureFormat, referenceSpace: string): void
  frame(time: number, targets: EyeTarget[], visible: boolean): void
  end(): void
  visibility?(visible: boolean): void
  select: () => void
  error(message: string): void
}

export class NativeXr {
  private session?: XRSession
  private pending = false
  private disposed = false
  private frameId = 0

  constructor(
    private system: XRSystem,
    private Binding: GpuXrBindingConstructor,
    private device: GPUDevice,
    private callbacks: XrCallbacks,
  ) {}

  async enter() {
    if (this.pending || this.session || this.disposed) return
    this.pending = true
    let session: XRSession | undefined
    let ended = false
    const visibilityChanged = () => {
      this.callbacks.visibility?.(session?.visibilityState === 'visible')
    }
    const finish = () => {
      if (ended) return
      ended = true
      if (session && this.frameId) session.cancelAnimationFrame(this.frameId)
      session?.removeEventListener('select', this.callbacks.select)
      session?.removeEventListener('end', finish)
      session?.removeEventListener('visibilitychange', visibilityChanged)
      this.frameId = 0
      if (this.session === session) this.session = undefined
      if (!this.disposed) this.callbacks.end()
    }
    try {
      // Called directly from a click, before any unrelated await consumes activation.
      session = await this.system.requestSession('immersive-vr', {
        requiredFeatures: ['webgpu'],
        optionalFeatures: ['local-floor', 'hand-tracking'],
      })
      this.session = session
      session.addEventListener('end', finish)
      session.addEventListener('visibilitychange', visibilityChanged)
      if (this.disposed) {
        await session.end()
        return
      }
      const binding = new this.Binding(session, this.device)
      const format = binding.getPreferredColorFormat()
      // Additive flame has no opaque depth surface. Do not supply misleading
      // depth to the compositor or opt into space warp in this proof.
      const layer = binding.createProjectionLayer({ colorFormat: format })
      await session.updateRenderState({
        layers: [layer],
        depthNear: 0.05,
        depthFar: 100,
      })
      let spaceName = 'local-floor'
      let space = await session
        .requestReferenceSpace('local-floor')
        .catch(() => {
          spaceName = 'local'
          return session!.requestReferenceSpace('local')
        })
      if (ended || this.disposed) return
      if (spaceName === 'local') {
        // local is head-relative at entry. Estimate a floor only when the
        // runtime cannot supply one, keeping the flame in front of the viewer.
        space = space.getOffsetReferenceSpace(new XRRigidTransform({ y: -1.6 }))
        spaceName = 'local (estimated 1.6 m floor)'
      }
      this.callbacks.start(format, spaceName)
      visibilityChanged()
      session.addEventListener('select', this.callbacks.select)
      const onFrame: XRFrameRequestCallback = (time, frame) => {
        if (ended || this.disposed || !session) return
        try {
          const pose = frame.getViewerPose(space)
          if (pose && session.visibilityState !== 'hidden') {
            this.callbacks.frame(
              time,
              collectXrTargets(binding, layer, pose),
              session.visibilityState === 'visible',
            )
          }
          this.frameId = session.requestAnimationFrame(onFrame)
        } catch (error) {
          this.callbacks.error(`WebGPU XR frame failed: ${String(error)}`)
          void session.end().catch(() => {
            finish()
          })
        }
      }
      this.frameId = session.requestAnimationFrame(onFrame)
    } catch (error) {
      if (!this.disposed)
        this.callbacks.error(`WebGPU XR entry failed: ${String(error)}`)
      if (session && !ended) await session.end().catch(() => {})
      finish()
    } finally {
      this.pending = false
    }
  }

  async exit() {
    await this.session?.end()
  }

  dispose() {
    this.disposed = true
    if (this.frameId) this.session?.cancelAnimationFrame(this.frameId)
    void this.session?.end().catch(() => {})
  }
}

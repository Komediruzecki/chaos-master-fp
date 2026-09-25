// Exactly one frame owner: the desktop window or the native XR session.
import { mat4 } from 'wgpu-matrix'
import { acquireDevice } from './capabilities'
import { NativeXr } from './nativeXr'
import { createRenderer } from './renderer'
import type { Capabilities } from './capabilities'
import type { SceneMode } from './renderer'
import type { EyeTarget } from './xrTypes'

export class LabRuntime {
  mode: SceneMode = 'cached'
  paused = false
  stereo = false
  distance = 2.9
  yaw = 0
  ready = false
  immersive = false
  entering = false
  elapsed = 0
  nativeFrames = 0
  xrEntries = 0
  selections = 0
  referenceSpace = ''
  caps?: Capabilities
  error = ''
  readonly errors: string[] = []
  private disposed = false
  private failed = false
  private device?: GPUDevice
  private renderer?: ReturnType<typeof createRenderer>
  private context?: GPUCanvasContext
  private xr?: NativeXr
  private format: GPUTextureFormat = 'bgra8unorm'
  private desktopFormat: GPUTextureFormat = 'bgra8unorm'
  private raf = 0
  private lastTime = 0
  private reportedAt = 0
  private intervals: number[] = []
  private lastEyes: Omit<EyeTarget, 'color'>[] = []
  private lastNativeReport?: ReturnType<LabRuntime['frameReport']>
  private readonly matrices = Array.from({ length: 2 }, () => ({
    view: new Float32Array(16),
    projection: new Float32Array(16),
  }))

  constructor(
    private canvas: HTMLCanvasElement,
    private changed: () => void,
  ) {}

  async init() {
    try {
      const { device, caps } = await acquireDevice()
      if (this.disposed) {
        device.destroy()
        return
      }
      this.device = device
      this.caps = caps
      device.addEventListener('uncapturederror', this.onGpuError)
      void device.lost.then((info) => {
        if (!this.disposed && !this.failed)
          this.fail(
            `GPU device lost (${info.reason}): ${info.message || 'Reload to retry.'}`,
          )
      })
      device.pushErrorScope('validation')
      let validation: GPUError | null = null
      try {
        this.renderer = createRenderer(device)
        this.context = this.canvas.getContext('webgpu') ?? undefined
        if (!this.context)
          throw new Error('Cannot create a WebGPU canvas context.')
        this.desktopFormat = window.navigator.gpu.getPreferredCanvasFormat()
        this.format = this.desktopFormat
        this.context.configure({
          device,
          format: this.format,
          alphaMode: 'opaque',
        })
        this.renderer.prepare(this.format)
      } finally {
        validation = await device.popErrorScope()
      }
      if (validation) throw new Error(validation.message)
      if (this.disposed) return
      if (caps.xrCandidate && window.navigator.xr && window.XRGPUBinding) {
        this.xr = new NativeXr(
          window.navigator.xr,
          window.XRGPUBinding,
          device,
          {
            start: (format, reference) => {
              this.renderer!.prepare(format)
              cancelAnimationFrame(this.raf)
              this.format = format
              this.referenceSpace = reference
              this.immersive = true
              this.xrEntries++
              this.lastTime = 0
              this.intervals = []
              this.changed()
            },
            frame: (time, targets, visible) => {
              this.draw(time, targets, visible)
              this.nativeFrames++
            },
            end: () => {
              this.immersive = false
              this.format = this.desktopFormat
              this.lastTime = 0
              this.intervals = []
              if (this.ready && !this.disposed) {
                cancelAnimationFrame(this.raf)
                this.raf = requestAnimationFrame(this.desktopFrame)
              }
              this.changed()
            },
            select: () => {
              this.selections++
              this.paused = !this.paused
              this.changed()
            },
            error: (message) => {
              this.error = message
              this.errors.push(message)
              this.changed()
            },
          },
        )
      }
      this.ready = true
      this.raf = requestAnimationFrame(this.desktopFrame)
      this.changed()
    } catch (error) {
      if (!this.disposed) this.fail(String(error))
    }
  }

  private onGpuError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault()
    this.fail(`GPU validation failed: ${event.error.message}`)
  }

  private fail(message: string) {
    if (this.failed) return
    this.failed = true
    this.ready = false
    this.error = message
    this.errors.push(message)
    cancelAnimationFrame(this.raf)
    this.xr?.dispose()
    this.immersive = false
    this.context?.unconfigure()
    this.renderer?.dispose()
    this.device?.destroy()
    this.changed()
  }

  private desktopFrame = (time: number) => {
    if (this.disposed || !this.ready || this.immersive || !this.context) return
    try {
      if (!document.hidden) {
        const scale = Math.min(window.devicePixelRatio, 1.5)
        const width = Math.max(2, Math.floor(this.canvas.clientWidth * scale))
        const height = Math.max(2, Math.floor(this.canvas.clientHeight * scale))
        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width
          this.canvas.height = height
        }
        const color = this.context.getCurrentTexture().createView()
        const count = this.stereo ? 2 : 1
        const eyeWidth = Math.floor(width / count)
        const angle = (this.yaw * Math.PI) / 180
        const targets = Array.from({ length: count }, (_, index): EyeTarget => {
          const offset = count === 2 ? (index - 0.5) * 0.063 : 0
          const position = [
            Math.sin(angle) * this.distance + Math.cos(angle) * offset,
            1.6,
            -2.5 + Math.cos(angle) * this.distance - Math.sin(angle) * offset,
          ]
          const m = this.matrices[index]
          // Parallel camera axes preserve physical eye separation without toe-in.
          mat4.lookAt(
            position,
            [Math.cos(angle) * offset, 1.6, -2.5 - Math.sin(angle) * offset],
            [0, 1, 0],
            m.view,
          )
          mat4.perspective(
            Math.PI / 3,
            eyeWidth / height,
            0.05,
            100,
            m.projection,
          )
          return {
            eye:
              count === 1
                ? 'desktop'
                : index === 0
                  ? 'left-preview'
                  : 'right-preview',
            view: m.view,
            projection: m.projection,
            position,
            viewport: { x: index * eyeWidth, y: 0, width: eyeWidth, height },
            color,
            clear: index === 0,
            arrayLayer: 0,
          }
        })
        this.draw(time, targets, true)
      } else this.lastTime = 0
      this.raf = requestAnimationFrame(this.desktopFrame)
    } catch (error) {
      this.fail(String(error))
    }
  }

  private draw(time: number, targets: EyeTarget[], visible: boolean) {
    if (!this.ready || this.disposed) return
    const delta = this.lastTime ? Math.max(0, time - this.lastTime) : 0
    this.lastTime = time
    if (!this.paused && visible) this.elapsed += Math.min(delta, 50) / 1000
    if (visible && delta > 0) {
      this.intervals.push(delta)
      if (this.intervals.length > 180) this.intervals.shift()
    }
    this.renderer!.render(
      targets,
      this.format,
      this.mode,
      this.elapsed,
      !this.paused && visible,
    )
    if (time - this.reportedAt > 300) {
      this.reportedAt = time
      this.lastEyes = targets.map(({ color: _color, ...target }) => ({
        ...target,
        projection: new Float32Array(target.projection),
        view: new Float32Array(target.view),
      }))
      if (this.immersive) this.lastNativeReport = this.frameReport()
      this.changed()
    }
  }

  async enter() {
    if (!this.ready || this.entering || !this.xr) return
    this.entering = true
    this.error = ''
    this.changed()
    try {
      await this.xr.enter()
    } finally {
      this.entering = false
      if (!this.disposed) this.changed()
    }
  }

  async exit() {
    try {
      await this.xr?.exit()
    } catch (error) {
      this.error = String(error)
      this.changed()
    }
  }

  private frameReport() {
    const sorted = [...this.intervals].sort((a, b) => a - b)
    return {
      mode: this.mode,
      referenceSpace: this.referenceSpace,
      format: this.format,
      intervalSamples: sorted.length,
      frameIntervalMedianMs: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      frameIntervalP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      timingNote:
        'Last 180 visible frame callback intervals; includes long stalls and tracking gaps. Not GPU execution time or headset acceptance.',
      ...this.renderer?.stats(),
      eyes: this.lastEyes.map((eye) => ({
        ...eye,
        projection: Array.from(eye.projection),
        view: Array.from(eye.view),
      })),
    }
  }

  snapshot() {
    return {
      testedAt: new Date().toISOString(),
      userAgent: window.navigator.userAgent,
      ready: this.ready,
      immersive: this.immersive,
      paused: this.paused,
      stereoPreview: this.stereo,
      elapsed: this.elapsed,
      error: this.error,
      errors: [...this.errors],
      caps: this.caps,
      nativeFrames: this.nativeFrames,
      xrEntries: this.xrEntries,
      selections: this.selections,
      center: [0, 1.6, -2.5],
      ...this.frameReport(),
      lastNativeReport: this.lastNativeReport,
    }
  }

  async readPoints() {
    return this.renderer?.readPoints()
  }
  async stepForTest() {
    if (!this.paused || this.immersive) throw new Error('Pause desktop first.')
    await this.renderer?.stepForTest()
  }
  shader() {
    return this.renderer?.shader()
  }
  loseDeviceForTest() {
    this.device?.destroy()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.xr?.dispose()
    this.device?.removeEventListener('uncapturederror', this.onGpuError)
    this.context?.unconfigure()
    this.renderer?.dispose()
    this.device?.destroy()
  }
}

declare global {
  interface Window {
    __lumenGpuXr?: LabRuntime
  }
}

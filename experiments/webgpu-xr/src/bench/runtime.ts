// Desktop-only specimen lifecycle and camera input; the existing XR lab is separate.
import { BENCH_RECIPES } from './recipes'
import { createBenchRenderer } from './renderer'
import { DEFAULT_BENCH_SETTINGS, normalizeSettings } from './settings'
import type { BenchSettings } from './settings'

export { DEFAULT_BENCH_SETTINGS } from './settings'
export type { BenchSettings } from './settings'

export class BenchRuntime {
  private settings: BenchSettings = { ...DEFAULT_BENCH_SETTINGS }
  private device?: GPUDevice
  private context?: GPUCanvasContext
  private renderer?: ReturnType<typeof createBenchRenderer>
  private ready = false
  private active = true
  private disposed = false
  private error = ''
  private errors: string[] = []
  private adapter = ''
  private raf = 0
  private previousTime = 0
  private reportedAt = 0
  private intervals: number[] = []
  private worker?: Worker
  private workerKey = ''
  private cachedKey = ''
  private sampling = false
  private pointer?: { id: number; x: number; y: number }
  private scene: 'specimen' | 'book' = 'specimen'
  private bookDock: 'left' | 'right' = 'left'
  private bookInspection = false
  private bookClay = false
  constructor(
    private canvas: HTMLCanvasElement,
    private changed: () => void,
  ) {}

  async init() {
    try {
      if (!window.isSecureContext || !window.navigator.gpu)
        throw new Error(
          'Open this bench in a WebGPU-enabled browser over HTTPS or localhost.',
        )
      const adapter = await window.navigator.gpu.requestAdapter()
      if (!adapter)
        throw new Error(
          'No WebGPU adapter is available. Try Chrome with hardware acceleration enabled.',
        )
      const device = await adapter.requestDevice({
        label: 'Orb specimen bench',
      })
      if (this.disposed) {
        device.destroy()
        return
      }
      this.device = device
      this.adapter = [
        adapter.info.vendor,
        adapter.info.architecture,
        adapter.info.description,
      ]
        .filter(Boolean)
        .join(' / ')
      device.addEventListener('uncapturederror', this.onGpuError)
      void device.lost.then((info) => {
        if (!this.disposed && !this.error)
          this.fail(
            `GPU device lost: ${info.message || info.reason}. Reload to retry.`,
          )
      })
      device.pushErrorScope('validation')
      let validation: GPUError | null = null
      try {
        const format = window.navigator.gpu.getPreferredCanvasFormat()
        this.context = this.canvas.getContext('webgpu') ?? undefined
        if (!this.context)
          throw new Error('Cannot create the WebGPU canvas. Reload to retry.')
        this.context.configure({ device, format, alphaMode: 'opaque' })
        this.renderer = createBenchRenderer(device, format, this.changed)
      } finally {
        validation = await device.popErrorScope()
      }
      if (validation) throw new Error(validation.message)
      if (this.disposed) return
      this.renderer.setBookDock(this.bookDock)
      this.renderer.setBookInspection(this.bookInspection)
      this.renderer.setBookClay(this.bookClay)
      this.renderer.setScene(this.scene)
      this.ready = true
      this.canvas.addEventListener('pointerdown', this.onPointerDown)
      this.canvas.addEventListener('pointermove', this.onPointerMove)
      this.canvas.addEventListener('pointerup', this.onPointerEnd)
      this.canvas.addEventListener('pointercancel', this.onPointerEnd)
      this.canvas.addEventListener('lostpointercapture', this.onPointerEnd)
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
      this.canvas.addEventListener('keydown', this.onKey)
      this.raf = requestAnimationFrame(this.frame)
      this.changed()
    } catch (error) {
      if (!this.disposed) this.fail(String(error))
    }
  }

  private onGpuError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault()
    this.fail(`GPU validation failed: ${event.error.message}`)
  }
  private releaseGpu() {
    cancelAnimationFrame(this.raf)
    this.worker?.terminate()
    this.worker = undefined
    this.sampling = false
    this.context?.unconfigure()
    this.context = undefined
    this.renderer?.dispose()
    this.renderer = undefined
    this.device?.removeEventListener('uncapturederror', this.onGpuError)
    this.device?.destroy()
    this.device = undefined
  }
  private fail(message: string) {
    if (this.error) return
    this.error = message
    this.errors.push(message)
    this.ready = false
    this.releaseGpu()
    this.changed()
  }
  private frame = (time: number) => {
    if (this.disposed || !this.ready) return
    try {
      if (!document.hidden && this.active) {
        const delta = this.previousTime ? time - this.previousTime : 0
        if (delta > 0) {
          this.intervals.push(delta)
          if (this.intervals.length > 120) this.intervals.shift()
        }
        if (this.settings.rotation)
          this.settings.yaw =
            ((this.settings.yaw + Math.min(delta, 50) * 0.008 + 180) % 360) -
            180
        this.previousTime = time
        const scale = Math.min(window.devicePixelRatio, 1.5)
        const width = Math.max(2, Math.round(this.canvas.clientWidth * scale))
        const height = Math.max(2, Math.round(this.canvas.clientHeight * scale))
        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width
          this.canvas.height = height
        }
        this.ensureCachedSamples()
        this.renderer!.render(
          this.context!.getCurrentTexture().createView(),
          width,
          height,
          this.settings,
        )
        if (time - this.reportedAt > 300) {
          this.reportedAt = time
          this.changed()
        }
      } else this.previousTime = 0
      this.raf = requestAnimationFrame(this.frame)
    } catch (error) {
      this.fail(String(error))
    }
  }
  private ensureCachedSamples() {
    const settings = this.settings
    const key = `${settings.recipe}:${settings.pointCount}:${settings.seed}`
    if (settings.source !== 'cached') {
      this.worker?.terminate()
      this.worker = undefined
      this.workerKey = ''
      this.sampling = false
      return
    }
    if (key === this.cachedKey || key === this.workerKey) return
    this.worker?.terminate()
    const worker = new Worker(new URL('./sampleWorker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker = worker
    this.workerKey = key
    this.sampling = true
    worker.onmessage = (
      event: MessageEvent<{ key: string; data?: Float32Array; error?: string }>,
    ) => {
      if (this.disposed || this.worker !== worker || event.data.key !== key)
        return
      if (event.data.error || !event.data.data) {
        this.fail(event.data.error || 'CPU sampling returned no points.')
        return
      }
      this.renderer?.setCachedData(key, event.data.data)
      this.cachedKey = key
      this.sampling = false
      this.workerKey = ''
      this.worker = undefined
      worker.terminate()
      this.changed()
    }
    worker.onerror = (event) => {
      if (!this.disposed && this.worker === worker)
        this.fail(`CPU sampling failed: ${event.message}`)
    }
    worker.postMessage({
      key,
      recipe: settings.recipe,
      pointCount: settings.pointCount,
      seed: settings.seed,
    })
    this.changed()
  }
  private onPointerDown = (event: PointerEvent) => {
    if (!this.ready || this.pointer || !event.isPrimary || event.button !== 0)
      return
    this.canvas.focus({ preventScroll: true })
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
    this.setSettings({ rotation: false })
  }
  private onPointerMove = (event: PointerEvent) => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return
    this.setSettings({
      yaw:
        ((this.settings.yaw - (event.clientX - this.pointer.x) * 0.35 + 540) %
          360) -
        180,
      pitch: this.settings.pitch + (event.clientY - this.pointer.y) * 0.3,
    })
    this.pointer.x = event.clientX
    this.pointer.y = event.clientY
  }
  private onPointerEnd = (event: PointerEvent) => {
    if (this.pointer?.id !== event.pointerId) return
    this.pointer = undefined
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId)
  }
  private onWheel = (event: WheelEvent) => {
    if (!this.ready) return
    event.preventDefault()
    this.setSettings({
      distance: this.settings.distance + Math.sign(event.deltaY) * 0.15,
    })
  }
  private onKey = (event: KeyboardEvent) => {
    const steps: Record<string, Partial<BenchSettings>> = {
      ArrowLeft: { yaw: this.settings.yaw - 5 },
      ArrowRight: { yaw: this.settings.yaw + 5 },
      ArrowUp: { pitch: this.settings.pitch + 5 },
      ArrowDown: { pitch: this.settings.pitch - 5 },
      '+': { distance: this.settings.distance - 0.15 },
      '-': { distance: this.settings.distance + 0.15 },
    }
    if (steps[event.key]) {
      event.preventDefault()
      this.setSettings({ ...steps[event.key], rotation: false })
    }
  }
  setSettings(patch: Partial<BenchSettings>) {
    this.settings = normalizeSettings({ ...this.settings, ...patch })
    const key = `${this.settings.recipe}:${this.settings.pointCount}:${this.settings.seed}`
    if (
      this.worker &&
      (this.settings.source !== 'cached' || this.workerKey !== key)
    ) {
      this.worker.terminate()
      this.worker = undefined
      this.workerKey = ''
      this.sampling = false
    }
    this.changed()
  }
  /** Retain the specimen while its host shows an entry without a live preview. */
  setActive(active: boolean) {
    this.active = active
    this.previousTime = 0
    this.changed()
  }
  setScene(scene: 'specimen' | 'book') {
    this.scene = scene
    this.renderer?.setScene(scene)
    this.changed()
  }
  setBookDock(dock: 'left' | 'right') {
    this.bookDock = dock
    this.renderer?.setBookDock(dock)
    this.changed()
  }
  setBookInspection(inspecting: boolean) {
    this.bookInspection = inspecting
    this.renderer?.setBookInspection(inspecting)
    this.changed()
  }
  setBookClay(clay: boolean) {
    this.bookClay = clay
    this.renderer?.setBookClay(clay)
    this.changed()
  }
  retryBook() {
    this.renderer?.retryBook()
  }
  resetView() {
    this.setSettings({
      yaw: 0,
      pitch: 0,
      distance: DEFAULT_BENCH_SETTINGS.distance,
      rotation: false,
    })
  }
  rebuild() {
    this.renderer?.rebuild()
  }
  snapshot() {
    const sorted = [...this.intervals].sort((a, b) => a - b)
    return {
      ready: this.ready,
      active: this.active,
      error: this.error,
      errors: [...this.errors],
      settings: { ...this.settings },
      adapter: this.adapter,
      sampling: this.sampling,
      activeSource:
        this.settings.source === 'cached' &&
        this.cachedKey ===
          `${this.settings.recipe}:${this.settings.pointCount}:${this.settings.seed}`
          ? 'cached'
          : 'compute',
      generation: 0,
      scene: this.scene,
      book: {
        status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
        error: '',
        dock: this.bookDock,
        inspecting: this.bookInspection,
        clay: this.bookClay,
        triangles: 0,
        geometryBytes: 0,
        bytes: 0,
        materials: [] as string[],
        draws: 0,
      },
      ...this.renderer?.stats(),
      pointCount: this.settings.pointCount,
      frameIntervalMs: sorted[Math.floor(sorted.length / 2)] ?? null,
      frameIntervalP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      timingNote:
        'Visible desktop frame intervals, not GPU timings or headset results.',
    }
  }
  exportStudy() {
    return JSON.stringify(
      {
        schema: 'lumen-orb-study',
        version: 1,
        recipeVersion: 1,
        recipeId: BENCH_RECIPES[this.settings.recipe].id,
        settings: this.settings,
        capturedAt: new Date().toISOString(),
        evidence: this.snapshot(),
        limitations: [
          'Desktop only',
          'Bounded recipe subset, not editor import',
          'No audio deformation in this study',
          'Stars are a screen-space backdrop',
        ],
      },
      null,
      2,
    )
  }
  readPoints(count = 32, source: 'compute' | 'cached' = 'compute') {
    return this.renderer?.readPoints(count, source)
  }
  loseDeviceForTest() {
    this.device?.destroy()
  }
  dispose() {
    this.disposed = true
    this.ready = false
    if (this.pointer && this.canvas.hasPointerCapture(this.pointer.id))
      this.canvas.releasePointerCapture(this.pointer.id)
    this.pointer = undefined
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerEnd)
    this.canvas.removeEventListener('pointercancel', this.onPointerEnd)
    this.canvas.removeEventListener('lostpointercapture', this.onPointerEnd)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('keydown', this.onKey)
    this.releaseGpu()
  }
}

declare global {
  interface Window {
    __orbBench?: BenchRuntime
  }
}

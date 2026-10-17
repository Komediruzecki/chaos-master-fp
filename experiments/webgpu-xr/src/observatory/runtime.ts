// Desktop canvas, camera and trace input lifecycle for the observatory scene.
import { createObservatoryRenderer } from './renderer'
import { clamp, copyTrace, EMPTY_GLASSWAKE, EMPTY_TRACE, projectPoint, QUIET_MUSIC, traceAtCanvas, traceWorld, WORLD_PLACEMENTS, } from './scene'
import type { CameraState, GlasswakePresentation, MusicFrame, ObservatoryFrame, ObservatoryOptions, ObservatorySnapshot, ObservatoryView, TracePoint, TracePresentation, WorldId, } from './scene'

export class ObservatoryRuntime {
  private device?: GPUDevice
  private context?: GPUCanvasContext
  private renderer?: ReturnType<typeof createObservatoryRenderer>
  private ready = false
  private active = true
  private disposed = false
  private error = ''
  private errors: string[] = []
  private adapter = ''
  private raf = 0
  private time = 0
  private previousTime = 0
  private reportedAt = 0
  private intervals: number[] = []
  private selectedWorld: WorldId = 'glasswake'
  private view: ObservatoryView = 'overview'
  private motion = !window.matchMedia('(prefers-reduced-motion: reduce)')
    .matches
  private clay = false
  private trace: TracePresentation = copyTrace(EMPTY_TRACE)
  private glasswake: GlasswakePresentation = { ...EMPTY_GLASSWAKE }
  private music: MusicFrame = { ...QUIET_MUSIC }
  private instructionNote: number | null = null
  private camera: CameraState = { yaw: 0, pitch: 0, distance: 1 }
  private pointer?: {
    id: number
    x: number
    y: number
    startX: number
    startY: number
    tracing: boolean
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private options: ObservatoryOptions,
  ) {}

  async init() {
    if (this.device || this.disposed) return
    try {
      if (!window.isSecureContext || !window.navigator.gpu)
        throw new Error(
          'Open the observatory in a WebGPU-enabled browser over HTTPS or localhost.',
        )
      const adapter = await window.navigator.gpu.requestAdapter()
      if (!adapter)
        throw new Error(
          'No WebGPU adapter is available. Enable browser hardware acceleration and reload.',
        )
      const device = await adapter.requestDevice({
        label: 'Irchiinnuss observatory',
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
          throw new Error('The browser could not create the WebGPU canvas.')
        this.context.configure({ device, format, alphaMode: 'opaque' })
        this.renderer = createObservatoryRenderer(device, format, () => {
          this.options.changed()
        })
      } finally {
        validation = await device.popErrorScope()
      }
      if (validation) throw new Error(validation.message)
      if (this.disposed) return
      this.ready = true
      this.canvas.addEventListener('pointerdown', this.onPointerDown)
      this.canvas.addEventListener('pointermove', this.onPointerMove)
      this.canvas.addEventListener('pointerup', this.onPointerEnd)
      this.canvas.addEventListener('pointercancel', this.onPointerCancel)
      this.canvas.addEventListener('lostpointercapture', this.onPointerCancel)
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
      this.canvas.addEventListener('keydown', this.onKey)
      this.raf = requestAnimationFrame(this.frame)
      void this.renderer.loadAssets()
      this.options.changed()
    } catch (error) {
      if (!this.disposed)
        this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private onGpuError = (event: GPUUncapturedErrorEvent) => {
    event.preventDefault()
    this.fail(`GPU validation failed: ${event.error.message}`)
  }

  private fail(message: string) {
    if (this.error) return
    this.error = message
    this.errors.push(message)
    this.ready = false
    this.releaseGpu()
    this.options.changed()
  }

  private releaseGpu() {
    cancelAnimationFrame(this.raf)
    this.context?.unconfigure()
    this.context = undefined
    this.renderer?.dispose()
    this.renderer = undefined
    this.device?.removeEventListener('uncapturederror', this.onGpuError)
    this.device?.destroy()
    this.device = undefined
  }

  private frame = (now: number) => {
    if (this.disposed || !this.ready) return
    try {
      if (!document.hidden && this.active) {
        const elapsed = this.previousTime ? now - this.previousTime : 0
        this.previousTime = now
        if (elapsed > 0) {
          this.intervals.push(elapsed)
          if (this.intervals.length > 180) this.intervals.shift()
        }
        const music = this.options.music()
        // Color-only teaching feedback follows the audio even when world motion is frozen.
        this.instructionNote = music.playing ? music.activeNote : null
        if (this.motion) {
          this.time += Math.min(elapsed, 50) / 1000
          this.music = {
            playing: music.playing,
            level: Number.isFinite(music.level) ? clamp(music.level, 0, 1) : 0,
            activeNote: music.activeNote,
            progress: Number.isFinite(music.progress)
              ? clamp(music.progress, 0, 1)
              : 0,
          }
        }
        const scale = Math.min(window.devicePixelRatio, 1.5)
        const width = Math.max(2, Math.round(this.canvas.clientWidth * scale))
        const height = Math.max(2, Math.round(this.canvas.clientHeight * scale))
        if (this.canvas.width !== width || this.canvas.height !== height) {
          this.canvas.width = width
          this.canvas.height = height
        }
        const frame: ObservatoryFrame = {
          selectedWorld: this.selectedWorld,
          view: this.view,
          camera: this.camera,
          time: this.time,
          music: this.music,
          instructionNote: this.instructionNote,
          clay: this.clay,
          trace: this.trace,
          glasswake: this.glasswake,
          motion: this.motion,
        }
        this.renderer!.render(
          this.context!.getCurrentTexture().createView(),
          width,
          height,
          frame,
        )
        if (now - this.reportedAt > 100) {
          this.reportedAt = now
          this.options.changed()
        }
      } else this.previousTime = 0
      this.raf = requestAnimationFrame(this.frame)
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private normalizedPointer(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect()
    return [
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    ] as const
  }

  private pointerTrace(event: PointerEvent): TracePoint | null {
    const camera = this.renderer?.camera()
    const [x, y] = this.normalizedPointer(event)
    return camera ? traceAtCanvas(camera.inverse, x, y) : null
  }

  private onPointerDown = (event: PointerEvent) => {
    if (
      !this.ready ||
      !this.active ||
      this.view === 'glasswake' ||
      this.pointer ||
      !event.isPrimary ||
      event.button !== 0
    )
      return
    const tracing = this.view === 'trace'
    if (tracing && this.trace.phase !== 'answer') return
    this.canvas.focus({ preventScroll: true })
    this.pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      tracing,
    }
    this.canvas.setPointerCapture(event.pointerId)
    if (tracing)
      this.options.input({
        kind: 'trace',
        phase: 'start',
        point: this.pointerTrace(event),
      })
  }

  private onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    if (pointer.tracing) {
      // Preserve real intermediate input when the browser batches pointer samples.
      // Never invent interpolation across a jump that the encounter should reject.
      const samples = event.getCoalescedEvents?.() ?? []
      for (const sample of samples.length ? samples : [event])
        this.options.input({
          kind: 'trace',
          phase: 'move',
          point: this.pointerTrace(sample),
        })
    } else {
      this.camera.yaw = clamp(
        this.camera.yaw - (event.clientX - pointer.x) * 0.004,
        -1.1,
        1.1,
      )
      this.camera.pitch = clamp(
        this.camera.pitch + (event.clientY - pointer.y) * 0.003,
        -0.2,
        0.5,
      )
    }
    pointer.x = event.clientX
    pointer.y = event.clientY
  }

  private releasePointer() {
    const pointer = this.pointer
    this.pointer = undefined
    if (pointer && this.canvas.hasPointerCapture(pointer.id))
      this.canvas.releasePointerCapture(pointer.id)
  }

  private onPointerEnd = (event: PointerEvent) => {
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    if (pointer.tracing)
      this.options.input({
        kind: 'trace',
        phase: 'end',
        point: this.pointerTrace(event),
      })
    else if (
      Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      ) < 5
    ) {
      const camera = this.renderer?.camera()
      if (camera) {
        const [x, y] = this.normalizedPointer(event)
        // Include the authored corona in these approximate projected bounds.
        // This is a selection affordance, not a collision or mesh ray-picking claim.
        const hit = Object.entries(WORLD_PLACEMENTS)
          .map(([worldId, world]) => {
            const center = projectPoint(camera.viewProjection, world.center)
            const edge = projectPoint(camera.viewProjection, [
              world.center[0] + world.scale * 1.5,
              world.center[1],
              world.center[2],
            ])
            const bounds = this.canvas.getBoundingClientRect()
            const radius = Math.abs(edge.x - center.x) * bounds.width
            const distance = Math.hypot(
              (x - center.x) * bounds.width,
              (y - center.y) * bounds.height,
            )
            return {
              worldId: worldId as WorldId,
              inside: center.visible && distance < radius,
              distance,
            }
          })
          .filter((world) => world.inside)
          .sort((a, b) => a.distance - b.distance)[0]
        if (hit) this.options.input({ kind: 'world', worldId: hit.worldId })
      }
    }
    this.releasePointer()
  }

  private onPointerCancel = (event: PointerEvent) => {
    if (this.pointer?.id !== event.pointerId) return
    const tracing = this.pointer.tracing
    this.releasePointer()
    if (tracing)
      this.options.input({ kind: 'trace', phase: 'cancel', point: null })
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.ready || this.view === 'trace' || this.view === 'glasswake')
      return
    event.preventDefault()
    this.camera.distance = clamp(
      this.camera.distance + Math.sign(event.deltaY) * 0.07,
      0.7,
      1.6,
    )
  }

  private onKey = (event: KeyboardEvent) => {
    if (!this.ready || this.view === 'trace' || this.view === 'glasswake')
      return
    if (event.key === 'ArrowLeft') this.camera.yaw -= 0.06
    else if (event.key === 'ArrowRight') this.camera.yaw += 0.06
    else if (event.key === 'ArrowUp') this.camera.pitch += 0.04
    else if (event.key === 'ArrowDown') this.camera.pitch -= 0.04
    else if (event.key === '+' || event.key === '=')
      this.camera.distance -= 0.07
    else if (event.key === '-') this.camera.distance += 0.07
    else return
    this.camera.yaw = clamp(this.camera.yaw, -1.1, 1.1)
    this.camera.pitch = clamp(this.camera.pitch, -0.2, 0.5)
    this.camera.distance = clamp(this.camera.distance, 0.7, 1.6)
    event.preventDefault()
    this.options.changed()
  }

  selectWorld(worldId: WorldId) {
    if (!(worldId in WORLD_PLACEMENTS)) return
    this.selectedWorld = worldId
    this.options.changed()
  }
  setView(view: ObservatoryView) {
    if (!['overview', 'inspect', 'trace', 'glasswake'].includes(view)) return
    if (this.pointer?.tracing)
      this.options.input({ kind: 'trace', phase: 'cancel', point: null })
    this.releasePointer()
    this.view = view
    this.resetCamera()
  }
  setMotion(enabled: boolean) {
    this.motion = enabled
    this.previousTime = 0
    this.options.changed()
  }
  setClay(enabled: boolean) {
    this.clay = enabled
    this.options.changed()
  }
  setActive(active: boolean) {
    this.active = active
    this.previousTime = 0
    if (!active) {
      if (this.pointer?.tracing)
        this.options.input({ kind: 'trace', phase: 'cancel', point: null })
      this.releasePointer()
    }
    this.options.changed()
  }
  setTrace(state: TracePresentation) {
    this.trace = copyTrace(state)
    this.options.changed()
  }
  setGlasswake(state: GlasswakePresentation) {
    this.glasswake = {
      time: Number.isFinite(state.time) ? Math.max(0, state.time) : 0,
      charge: Number.isFinite(state.charge) ? clamp(state.charge, 0, 1) : 0,
      accepted: clamp(Math.trunc(state.accepted) || 0, 0, 3),
      holding: state.holding,
      burstTimes: state.burstTimes
        .slice(0, 3)
        .map((value) => (Number.isFinite(value) ? value : -10)),
    }
  }
  resetCamera() {
    this.camera = { yaw: 0, pitch: 0, distance: 1 }
    this.options.changed()
  }
  retryAssets() {
    void this.renderer?.loadAssets()
  }
  projectTrace(point: TracePoint) {
    const camera = this.renderer?.camera()
    return camera
      ? projectPoint(camera.viewProjection, traceWorld(point))
      : { x: 0, y: 0, visible: false }
  }
  readPoints(worldId: WorldId, count = 32) {
    return this.renderer?.readPoints(worldId, count)
  }
  loseDeviceForTest() {
    this.device?.destroy()
  }

  snapshot(): ObservatorySnapshot {
    const sorted = [...this.intervals].sort((a, b) => a - b)
    const stats = this.renderer?.stats() ?? {
      assets: [],
      submissions: 0,
      generations: 0,
      drawCalls: 0,
      triangles: 0,
      bridgeProgress: 0,
      renderedShards: 0,
      livePoints: 0,
      bufferBytes: 0,
      width: 0,
      height: 0,
    }
    return {
      ready: this.ready,
      active: this.active,
      error: this.error,
      errors: [...this.errors],
      adapter: this.adapter,
      selectedWorld: this.selectedWorld,
      view: this.view,
      motion: this.motion,
      clay: this.clay,
      assets: stats.assets,
      traceAnchors: this.trace.target.map((point) => this.projectTrace(point)),
      visual: {
        time: this.time,
        music: { ...this.music },
        instructionNote: this.instructionNote,
        bridgeProgress: stats.bridgeProgress,
        glasswake: {
          ...this.glasswake,
          burstTimes: [...this.glasswake.burstTimes],
          renderedShards: stats.renderedShards,
        },
      },
      frame: {
        submissions: stats.submissions,
        generations: stats.generations,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
        livePoints: stats.livePoints,
        bufferBytes: stats.bufferBytes,
        width: stats.width,
        height: stats.height,
        frameIntervalMedianMs: sorted[Math.floor(sorted.length / 2)] ?? null,
        frameIntervalP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
        timingNote:
          'Visible desktop frame intervals, not GPU timings or headset results.',
      },
    }
  }

  dispose() {
    this.disposed = true
    this.ready = false
    this.releasePointer()
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerEnd)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('lostpointercapture', this.onPointerCancel)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('keydown', this.onKey)
    this.releaseGpu()
  }
}

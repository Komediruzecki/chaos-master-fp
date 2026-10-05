/** Board replay, live materials and asynchronous mesh ownership at the scene boundary. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal, Show } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUMMY_BUILTIN_PRESETS } from '@/pages/GummyBear/gummyBuiltinPresets'
import { createGummyPreset } from '@/pages/GummyBear/gummyPresets'
import { createGummyBoardPieces, GUMMY_BOARD_ATTACKER_ID, GUMMY_BOARD_VICTIM_POSITION, gummyBoardRookPose, } from './gummyBoardChoreography'
import { GummyBoardScene } from './GummyBoardScene'
import type { ParentProps } from 'solid-js'
import type { GummyBoardQuality } from './gummyBoardQuality'
import type { GummyInteraction } from '@/components/GummyBear/GummyBearScene'
import type { GummyPalette } from '@/components/GummyBear/gummyMaterial'
import type { GummyPresetSettings } from '@/pages/GummyBear/gummyPresets'
import type { GummyParticleStep } from '@/simulation/gummy/gummyParticleSolver'

const fixture = vi.hoisted(() => ({
  canvas: undefined as HTMLCanvasElement | undefined,
  device: undefined as EventTarget | undefined,
  solvers: [] as {
    destroy: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    inputs: GummyParticleStep[]
  }[],
  renderers: [] as {
    destroy: ReturnType<typeof vi.fn>
    render: ReturnType<typeof vi.fn>
    readSurfaceStats: ReturnType<typeof vi.fn>
  }[],
  gate: undefined as Promise<void> | undefined,
  fence: undefined as Promise<void> | undefined,
  pairs: [] as {
    reset: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    step: ReturnType<typeof vi.fn>
  }[],
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas(props: ParentProps) {
    const [mounted, setMounted] = createSignal(false)
    return (
      <>
        <canvas
          ref={(canvas) => {
            fixture.canvas = canvas
            canvas.hasPointerCapture = () => false
            setMounted(true)
          }}
        />
        <Show when={mounted()}>{props.children}</Show>
      </>
    )
  },
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvas: fixture.canvas,
    context: {},
    canvasFormat: 'bgra8unorm',
    canvasSize: () => ({ width: 800, height: 600 }),
  }),
}))
vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({
    root: {},
    device: Object.assign(fixture.device!, {
      queue: { onSubmittedWorkDone: () => fixture.fence ?? Promise.resolve() },
    }),
  }),
}))
vi.mock('@/simulation/gummy/gummyParticleSolver', () => ({
  createGummyParticleSolver() {
    const record = {
      destroy: vi.fn(),
      reset: vi.fn(),
      inputs: [] as GummyParticleStep[],
    }
    fixture.solvers.push(record)
    return {
      ...record,
      positions: {},
      restPositions: new Float32Array([0, 1, 0, 1]),
      particleCount: 1,
      spacing: 0.08,
      gridBounds: { min: [-3, 0, -3], max: [3, 7, 3] },
      step: (_dt: number, input: GummyParticleStep) =>
        record.inputs.push(input),
      readState: () => Promise.resolve({}),
      readPositions: () => Promise.resolve(new Float32Array([0, 1, 0, 1])),
    }
  },
}))
vi.mock('@/simulation/gummy/gummyParticlePairSolver', () => ({
  createGummyParticlePairSolver() {
    const body = () => ({
      positions: {},
      restPositions: new Float32Array([0, 0.12, 0, 1]),
      particleCount: 1,
      spacing: 0.08,
      gridBounds: { min: [-4, 0, -3], max: [3, 7, 3] },
      readState: () => Promise.resolve({}),
      readPositions: () => Promise.resolve(new Float32Array([0, 0.12, 0, 1])),
    })
    const pair = {
      pawn: body(),
      rook: body(),
      reset: vi.fn(),
      destroy: vi.fn(),
      step: vi.fn(),
    }
    fixture.pairs.push(pair)
    return pair
  },
}))
vi.mock('./gummyBoardRenderer', () => ({
  async createGummyBoardRenderer() {
    const renderer = {
      destroy: vi.fn(),
      render: vi.fn(),
      readSurfaceStats: vi.fn(),
      readSecondarySurfaceStats: vi.fn(),
    }
    fixture.renderers.push(renderer)
    if (fixture.gate) await fixture.gate
    return renderer
  },
}))
vi.mock('@/components/GummyBear/gummyPointerRenderer', () => ({
  createGummyPointerRenderer: () => ({ render: vi.fn(), destroy: vi.fn() }),
}))

let frames = new Map<number, FrameRequestCallback>()
let frameId = 0

async function frame(now = 1000) {
  await Promise.resolve()
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
  await Promise.resolve()
}

function material() {
  const preset = GUMMY_BUILTIN_PRESETS[3]!.preset
  return createGummyPreset(preset.name, preset.settings).settings
}

function mount() {
  const [settings, setSettings] = createSignal(material())
  const [resetKey, setReset] = createSignal(0)
  const [crashKey, setCrash] = createSignal(0)
  const [impact, setImpact] = createSignal(1)
  const [collisionMode, setCollisionMode] = createSignal<'soft' | 'driven'>(
    'driven',
  )
  const [recording, setRecording] = createSignal(false)
  const [mode, setMode] = createSignal<GummyInteraction>('orbit')
  // Match the real page: all appearance props derive from one object signal.
  const [appearance, setAppearance] = createSignal<{
    pieceScale: number
    paletteOverrides: Partial<Record<number, GummyPalette>>
    quality: GummyBoardQuality
  }>({ pieceScale: 0.9, paletteOverrides: {}, quality: 'high' })
  const setPieceScale = (pieceScale: number) =>
    setAppearance((value) => ({ ...value, pieceScale }))
  const setPaletteOverrides = (
    paletteOverrides: Partial<Record<number, GummyPalette>>,
  ) => setAppearance((value) => ({ ...value, paletteOverrides }))
  const setQuality = (quality: GummyBoardQuality) =>
    setAppearance((value) => ({ ...value, quality }))
  const ready = vi.fn(),
    error = vi.fn()
  const view = render(() => (
    <GummyBoardScene
      settings={settings()}
      paused={false}
      resetKey={resetKey()}
      crashKey={crashKey()}
      resetViewKey={0}
      view="board"
      mode={mode()}
      recording={recording()}
      impact={impact()}
      collisionMode={collisionMode()}
      pieceScale={appearance().pieceScale}
      paletteOverrides={appearance().paletteOverrides}
      quality={appearance().quality}
      onReady={ready}
      onError={error}
    />
  ))
  return {
    view,
    setSettings,
    setReset,
    setCrash,
    setImpact,
    setCollisionMode,
    setMode,
    setRecording,
    setPieceScale,
    setPaletteOverrides,
    setQuality,
    ready,
    error,
  }
}
beforeEach(() => {
  fixture.device = new EventTarget()
  fixture.solvers = []
  fixture.pairs = []
  fixture.renderers = []
  fixture.gate = undefined
  fixture.fence = undefined
  frames = new Map()
  frameId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++frameId, cb)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('gummy board scene ownership and replay', () => {
  it('switches physics ownership and renders two deforming pieces without a duplicate rigid rook', async () => {
    const app = mount()
    await frame()
    app.setCollisionMode('soft')
    expect(fixture.solvers[0]!.destroy).toHaveBeenCalledOnce()
    await frame()
    expect(window.__gummyBoardStudy!.info()).toMatchObject({
      collisionMode: 'soft',
      rookParticleCount: 1,
    })
    const renderOptions = fixture.renderers.at(-1)!.render.mock.calls.at(-1)![1]
    expect(renderOptions.pieces).toHaveLength(30)
    expect(
      renderOptions.pieces.some(
        (piece: { id: number }) => piece.id === GUMMY_BOARD_ATTACKER_ID,
      ),
    ).toBe(false)
    expect(renderOptions.secondary).toEqual({
      id: GUMMY_BOARD_ATTACKER_ID,
      position: [-2.72, 0, 5.6000000000000005],
      side: 0,
      scale: 0.9,
      palette: 'marble',
      revision: 0,
    })
    app.setCrash(1)
    window.__gummyBoardStudy!.advanceFrames(721)
    const command = fixture.pairs[0]!.step.mock.calls.at(-1)![1]
    expect(command.collider).toBeUndefined()
    expect(command.rookGuide).toMatchObject({
      position: [0, 0.24, 0],
      velocity: [0, 0, 0],
    })
    expect(window.__gummyBoardStudy!.info().phase).toBe('complete')
    app.setReset(1)
    expect(fixture.pairs[0]!.reset).toHaveBeenCalledTimes(2)
    app.setCollisionMode('driven')
    expect(fixture.pairs[0]!.destroy).toHaveBeenCalledOnce()
    await frame()
    expect(window.__gummyBoardStudy!.info()).toMatchObject({
      collisionMode: 'driven',
      rookParticleCount: 0,
    })
    expect(window.__gummyBoardStudy!.info().pieces).toHaveLength(31)
  })
  it('waits for Play and keeps live material edits in the same solver', async () => {
    const app = mount()
    await frame()
    await frame(1100)
    expect(app.ready).toHaveBeenLastCalledWith(true)
    expect(fixture.solvers[0]!.inputs).toHaveLength(0)
    app.setSettings((current) => ({ ...current, softness: 0.9 }))
    expect(fixture.solvers).toHaveLength(1)
    app.setCrash(1)
    window.__gummyBoardStudy!.advanceFrames(3)
    expect(fixture.solvers[0]!.inputs.at(-1)?.softness).toBe(0.9)
    expect(fixture.solvers[0]!.reset).toHaveBeenCalledTimes(1)
  })
  it('uses one pose for the rendered rook and collider, latching impact until replay', async () => {
    const app = mount()
    await frame()
    app.setCrash(1)
    window.__gummyBoardStudy!.advanceFrames(340)
    app.setImpact(1.5)
    window.__gummyBoardStudy!.advanceFrames(1)
    const info = window.__gummyBoardStudy!.info()
    expect(info.impact).toBe(1)
    const expected = gummyBoardRookPose(info.crashTime, 1).position
    expect(info.attacker).toEqual(expected)
    const command = fixture.solvers[0]!.inputs.at(-1)!.collider!
    for (let axis = 0; axis < 3; axis++) {
      expect(
        command.position[axis]! + command.velocity[axis]! / 120,
      ).toBeCloseTo(expected[axis]!, 10)
      expect(
        info.pieces.find((p) => p.id === GUMMY_BOARD_ATTACKER_ID)!.position[
          axis
        ],
      ).toBeCloseTo(
        expected[axis]! * 0.9 + GUMMY_BOARD_VICTIM_POSITION[axis]!,
        10,
      )
    }
    app.setReset(1)
    expect(window.__gummyBoardStudy!.info()).toMatchObject({
      playing: false,
      crashTime: 0,
      phase: 'ready',
    })
    window.__gummyBoardStudy!.render()
    expect(
      window
        .__gummyBoardStudy!.info()
        .pieces.find((p) => p.id === GUMMY_BOARD_ATTACKER_ID)?.position,
    ).toEqual(createGummyBoardPieces()[0]!.position)
    app.setCrash(2)
    expect(window.__gummyBoardStudy!.info()).toMatchObject({
      playing: true,
      impact: 1.5,
    })
  })
  it('stages both bodies in the same frame before manual Soft-mode grabbing', async () => {
    const app = mount()
    app.setCollisionMode('soft')
    await frame()
    expect(window.__gummyBoardStudy!.info().staged).toBe(false)
    app.setMode('drag')
    window.__gummyBoardStudy!.render()
    const options = fixture.renderers.at(-1)!.render.mock.calls.at(-1)![1]
    expect(options.victimPosition).toEqual(GUMMY_BOARD_VICTIM_POSITION)
    expect(options.secondary.position).toEqual(GUMMY_BOARD_VICTIM_POSITION)
    expect(window.__gummyBoardStudy!.info()).toMatchObject({
      staged: true,
      playing: false,
      ticks: 0,
    })
    app.setMode('orbit')
    app.setReset(1)
    expect(window.__gummyBoardStudy!.info().staged).toBe(false)
  })
  it('updates scale and per-piece color without rebuilding or resetting physics', async () => {
    const app = mount()
    await frame()
    app.setCrash(1)
    window.__gummyBoardStudy!.advanceFrames(50)
    app.setPieceScale(0.95)
    app.setPaletteOverrides({ 1: 'lagoon', 21: 'berry' })
    window.__gummyBoardStudy!.render()
    expect(fixture.solvers).toHaveLength(1)
    expect(fixture.solvers[0]!.reset).toHaveBeenCalledTimes(1)
    const options = fixture.renderers[0]!.render.mock.calls.at(-1)![1]
    expect(options).toMatchObject({ victimScale: 0.95, victimPalette: 'berry' })
    expect(
      options.pieces.find((piece: { id: number }) => piece.id === 1),
    ).toMatchObject({ scale: 0.95, palette: 'lagoon' })
    expect(window.__gummyBoardStudy!.info().ticks).toBe(50)
  })
  it('does not redraw an unchanged idle board but responds to an appearance edit', async () => {
    const app = mount()
    await frame()
    await frame(1016)
    await frame(1032)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(1)
    app.setPaletteOverrides({ 2: 'blue' })
    await frame(1048)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(2)
  })
  it('keeps producing canvas frames while recording an otherwise idle board', async () => {
    const app = mount()
    await frame()
    app.setRecording(true)
    await frame(1016)
    await frame(1032)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(3)
    expect(fixture.solvers[0]!.inputs).toHaveLength(0)
    app.setRecording(false)
    await frame(1048)
    await frame(1064)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(4)
  })
  it('releases and rebuilds the renderer when presentation quality changes', async () => {
    const app = mount()
    await frame()
    app.setQuality('tablet')
    expect(fixture.renderers[0]!.destroy).toHaveBeenCalledOnce()
    await frame()
    expect(window.__gummyBoardStudy!.info().quality).toEqual({
      name: 'tablet',
      cellSize: 0.08,
      lightResolution: 512,
    })
  })
  it('rebuilds only when anchoring changes and disposes the previous GPU owners', async () => {
    const app = mount()
    await frame()
    app.setSettings((current: GummyPresetSettings) => ({
      ...current,
      pinnedFeet: false,
    }))
    expect(fixture.solvers).toHaveLength(2)
    expect(fixture.solvers[0]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.renderers[0]!.destroy).toHaveBeenCalledOnce()
    await frame()
    app.view.unmount()
    expect(fixture.solvers[1]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.renderers[1]!.destroy).toHaveBeenCalledOnce()
    expect(window.__gummyBoardStudy).toBeUndefined()
  })
  it('destroys a late renderer when unmounted during mesh preparation', async () => {
    let resolve!: () => void
    fixture.gate = new Promise<void>((done) => {
      resolve = done
    })
    const app = mount()
    await frame()
    expect(app.ready).not.toHaveBeenCalledWith(true)
    app.view.unmount()
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.renderers[0]!.destroy).toHaveBeenCalledOnce()
    expect(fixture.solvers[0]!.destroy).toHaveBeenCalledOnce()
  })
  it('does not queue more frames while the GPU is busy', async () => {
    let resolve!: () => void
    fixture.fence = new Promise<void>((done) => {
      resolve = done
    })
    const app = mount()
    await frame()
    app.setCrash(1)
    await frame(1016)
    await frame(1100)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(1)
    expect(fixture.solvers[0]!.inputs).toHaveLength(0)
    resolve()
    await Promise.resolve()
    await frame(1120)
    expect(fixture.renderers[0]!.render).toHaveBeenCalledTimes(2)
  })
})

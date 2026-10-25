/** Hidden editor grids stop their GPU loops even when their DOM still intersects the viewport. */
import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AffineEditor } from '@/components/AffineEditor/AffineEditor'
import { FlameColorEditor } from '@/components/FlameColorEditor/FlameColorEditor'
import { setActiveTab } from '@/lib/activeTab'
import type { JSXElement } from 'solid-js'
import type * as WheelZoomModule from '@/lib/WheelZoomCamera2D'

const gpu = vi.hoisted(() => {
  const pipeline = { with: () => pipeline, draw: vi.fn() }
  const submit = vi.fn()
  return {
    submit,
    root: { createRenderPipeline: () => pipeline },
    device: {
      queue: { submit },
      createCommandEncoder: () => ({
        beginRenderPass: () => ({ end: () => {} }),
        finish: () => ({}),
      }),
    },
  }
})

vi.mock('@/lib/RootContext', () => ({
  useLiveRootContext: () => ({ ...gpu, gpuReady: () => true }),
}))
vi.mock('@/lib/AutoCanvas', () => ({
  AutoCanvas: (props: { children: JSXElement }) => props.children,
}))
vi.mock('@/lib/CanvasContext', () => ({
  useCanvas: () => ({
    canvasFormat: 'bgra8unorm',
    context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
  }),
}))
vi.mock('@/lib/CameraContext', () => ({
  useCamera: () => ({ update: () => {}, bindGroup: {} }),
}))
vi.mock('@/lib/WheelZoomCamera2D', async (original) => ({
  ...(await original<typeof WheelZoomModule>()),
  WheelZoomCamera2D: (props: { children: JSXElement }) => props.children,
}))
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: () => 'dark' }),
}))
vi.mock('@/utils/useIntersectionObserver', () => ({
  // An overlay leaves intersection true; only app ownership can pause this.
  useIntersectionObserver: () => {},
}))
vi.mock('@/utils/scrollIntoViewOnChange', () => ({
  scrollIntoViewAndFocusOnChange: () => {},
}))

const frames = new Map<number, FrameRequestCallback>()
let id = 0
let time = 0

function frame() {
  const pending = [...frames.values()]
  frames.clear()
  time += 16
  for (const callback of pending) callback(time)
}

beforeEach(() => {
  setActiveTab('workspace')
  gpu.submit.mockClear()
  frames.clear()
  id = 0
  time = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
    frames.delete(handle),
  )
})

afterEach(() => {
  cleanup()
  setActiveTab('workspace')
  vi.unstubAllGlobals()
})

describe.each([
  ['affine grid', AffineEditor],
  ['colour grid', FlameColorEditor],
] as const)('%s', (_, Editor) => {
  it('submits no frames in chess and resumes after returning to the editor', () => {
    render(() => <Editor transforms={{}} setTransforms={vi.fn()} />)
    frame()
    expect(gpu.submit).toHaveBeenCalledTimes(1)

    setActiveTab('arcade', 'chess')
    frame()
    frame()
    expect(frames.size).toBe(0)
    expect(gpu.submit).toHaveBeenCalledTimes(1)

    setActiveTab('workspace')
    frame()
    expect(gpu.submit).toHaveBeenCalledTimes(2)
    cleanup()
    expect(frames.size).toBe(0)
  })
})

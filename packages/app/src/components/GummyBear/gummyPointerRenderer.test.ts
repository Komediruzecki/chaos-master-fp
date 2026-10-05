/** Recorded pointer cues must preserve the scene, project world grips correctly and own their resources. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it, vi } from 'vitest'
import { createGummyPointerRenderer, packGummyPointerFrame, } from './gummyPointerRenderer'
import { gummyPointerFragment, gummyPointerLineDistance, gummyPointerProject, GummyPointerUniform, gummyPointerVertex, } from './gummyPointerShaders'
import type { TgpuRoot } from 'typegpu'
import type { GummyPointerFrame } from './gummyPointerRenderer'

const identity = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])
const matrix = d.mat4x4f(
  d.vec4f(1, 0, 0, 0),
  d.vec4f(0, 1, 0, 0),
  d.vec4f(0, 0, 1, 0),
  d.vec4f(0, 0, 0, 1),
)
const frame: GummyPointerFrame = {
  width: 800,
  height: 600,
  viewProjection: identity,
  pointer: { x: 0.5, y: 0.5, active: false },
}

function gpuHarness() {
  const uniform = {
    $usage: vi.fn(() => uniform),
    write: vi.fn(),
    destroy: vi.fn(),
  }
  const pipeline = { with: vi.fn(() => pipeline), draw: vi.fn() }
  const pass = { end: vi.fn() }
  const encoder = {
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => 'commands'),
  }
  const view = { label: 'existing canvas attachment' }
  const texture = { createView: vi.fn(() => view) }
  const device = {
    createCommandEncoder: vi.fn(() => encoder),
    queue: { submit: vi.fn() },
  }
  const context = { getCurrentTexture: vi.fn(() => texture) }
  const root = {
    device,
    createBuffer: vi.fn(() => uniform),
    createBindGroup: vi.fn(() => 'group'),
    createRenderPipeline: vi.fn((_options: unknown) => pipeline),
    unwrap: vi.fn(),
  }
  const create = () =>
    createGummyPointerRenderer(
      root as unknown as TgpuRoot,
      device as unknown as GPUDevice,
      context as unknown as GPUCanvasContext,
      'bgra8unorm',
    )
  return {
    create,
    uniform,
    pipeline,
    pass,
    encoder,
    view,
    device,
    context,
    root,
  }
}

describe('gummy pointer overlay', () => {
  it('projects world points with top-left pixel origin and clips behind the near/far planes', () => {
    const projected = gummyPointerProject(
      matrix,
      d.vec3f(0.5, -0.5, 0.25),
      d.vec2f(800, 600),
    )
    expect([projected.x, projected.y, projected.z]).toEqual([600, 450, 1])
    for (const z of [-0.001, 1.001]) {
      const clipped = gummyPointerProject(
        matrix,
        d.vec3f(0, 0, z),
        d.vec2f(800, 600),
      )
      expect(clipped.z).toBe(0)
    }
    const behind = d.mat4x4f(
      d.vec4f(1, 0, 0, 0),
      d.vec4f(0, 1, 0, 0),
      d.vec4f(0, 0, 1, 0),
      d.vec4f(0, 0, 0, -1),
    )
    expect(
      gummyPointerProject(behind, d.vec3f(0, 0, 0.5), d.vec2f(800, 600)).z,
    ).toBe(0)
  })

  it('uses a finite rounded tether for side, endpoint and coincident-point distances', () => {
    expect(gummyPointerLineDistance(d.vec2f(5, 3), 10)).toBe(3)
    expect(gummyPointerLineDistance(d.vec2f(-3, 4), 10)).toBe(5)
    expect(gummyPointerLineDistance(d.vec2f(13, 4), 10)).toBe(5)
    expect(gummyPointerLineDistance(d.vec2f(3, 4), 0)).toBe(5)
  })

  it('packs current targets and clears stale target/origin flags when a grip ends', () => {
    const data = new Float32Array(d.sizeOf(GummyPointerUniform) / 4)
    expect(
      packGummyPointerFrame(
        data,
        {
          ...frame,
          pointer: {
            x: 0.3,
            y: 0.4,
            active: true,
            target: [1, 2, 3],
            origin: [4, 5, 6],
          },
        },
        true,
      ),
    ).toBe(true)
    const viewport =
      d.memoryLayoutOf(GummyPointerUniform, (value) => value.viewport).offset /
      4
    const pointer =
      d.memoryLayoutOf(GummyPointerUniform, (value) => value.pointer).offset / 4
    const target =
      d.memoryLayoutOf(GummyPointerUniform, (value) => value.endPoint).offset /
      4
    const origin =
      d.memoryLayoutOf(GummyPointerUniform, (value) => value.startPoint)
        .offset / 4
    expect(Array.from(data.slice(viewport, viewport + 4))).toEqual([
      800, 600, 1, 1,
    ])
    expect(Array.from(data.slice(target, target + 4))).toEqual([1, 2, 3, 0])
    expect(Array.from(data.slice(origin, origin + 4))).toEqual([4, 5, 6, 0])
    expect(Array.from(data.slice(pointer + 2, pointer + 4))).toEqual([1, 1])
    expect(packGummyPointerFrame(data, frame)).toBe(true)
    expect(Array.from(data.slice(viewport + 2, viewport + 4))).toEqual([0, 0])
    expect(Array.from(data.slice(pointer + 2, pointer + 4))).toEqual([0, 0])
    expect(Array.from(data.slice(target, target + 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(data.slice(origin, origin + 4))).toEqual([0, 0, 0, 0])
  })

  it('skips hidden and invalid pointers without allocating resources or touching the canvas', () => {
    const gpu = gpuHarness(),
      renderer = gpu.create()
    renderer.render({ ...frame, pointer: undefined })
    renderer.render({ ...frame, pointer: { x: -0.1, y: 0.5, active: false } })
    renderer.render({ ...frame, width: 0 })
    renderer.render({ ...frame, viewProjection: [NaN] })
    expect(gpu.context.getCurrentTexture).not.toHaveBeenCalled()
    expect(gpu.uniform.write).not.toHaveBeenCalled()
    expect(gpu.device.queue.submit).not.toHaveBeenCalled()
    renderer.destroy()
  })

  it('loads the existing canvas in one small blended pass and caches its GPU setup', () => {
    const gpu = gpuHarness(),
      renderer = gpu.create()
    renderer.render(frame)
    renderer.render(frame)
    expect(gpu.root.createBuffer).toHaveBeenCalledTimes(1)
    expect(gpu.root.createBindGroup).toHaveBeenCalledTimes(1)
    expect(gpu.root.createRenderPipeline).toHaveBeenCalledTimes(1)
    expect(gpu.encoder.beginRenderPass).toHaveBeenLastCalledWith({
      colorAttachments: [{ view: gpu.view, loadOp: 'load', storeOp: 'store' }],
    })
    expect(gpu.pipeline.draw).toHaveBeenLastCalledWith(6, 3)
    expect(gpu.device.queue.submit).toHaveBeenLastCalledWith(['commands'])
    expect(gpu.root.createRenderPipeline.mock.calls[0]?.[0]).toMatchObject({
      targets: {
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        },
      },
    })
    renderer.destroy()
    renderer.destroy()
    renderer.render(frame)
    expect(gpu.uniform.destroy).toHaveBeenCalledTimes(1)
    expect(gpu.device.queue.submit).toHaveBeenCalledTimes(2)
  })

  it('releases the uniform if shader setup fails', () => {
    const gpu = gpuHarness()
    gpu.root.unwrap.mockImplementationOnce(() => {
      throw new Error('shader validation')
    })
    expect(gpu.create).toThrow('shader validation')
    expect(gpu.uniform.destroy).toHaveBeenCalledTimes(1)
  })

  it.each([gummyPointerVertex, gummyPointerFragment])(
    'resolves the GPU entrypoints before native validation',
    (shader) => {
      const source = tgpu.resolve([shader], { names: 'strict' })
      expect(source).toMatch(/@(vertex|fragment)/)
      expect(source).not.toContain('NaN')
    },
  )
})

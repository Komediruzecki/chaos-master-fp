/** Pipeline reuse must follow root/format/mode identity and retry failed construction. */
import { describe, expect, it, vi } from 'vitest'
import { getGummyPipelines } from './gummyPipelines'
import type { TgpuRoot } from 'typegpu'

function harness() {
  const createRenderPipeline = vi.fn((descriptor: unknown) => ({ descriptor }))
  const createComputePipeline = vi.fn((descriptor: unknown) => ({ descriptor }))
  const unwrap = vi.fn()
  return {
    root: {
      createRenderPipeline,
      createComputePipeline,
      unwrap,
    } as unknown as TgpuRoot,
    createRenderPipeline,
    createComputePipeline,
    unwrap,
  }
}

describe('gummy pipeline cache', () => {
  it('materializes once for the same root, format and exit mode', () => {
    const state = harness()
    const first = getGummyPipelines(state.root, 'bgra8unorm', true)
    expect(getGummyPipelines(state.root, 'bgra8unorm', true)).toBe(first)
    expect(state.createRenderPipeline).toHaveBeenCalledTimes(7)
    expect(state.createComputePipeline).toHaveBeenCalledTimes(2)
    expect(state.unwrap).toHaveBeenCalledTimes(9)
    expect(getGummyPipelines(state.root, 'bgra8unorm-srgb', true)).not.toBe(
      first,
    )
    expect(getGummyPipelines(state.root, 'bgra8unorm', false)).not.toBe(first)
    expect(state.createRenderPipeline).toHaveBeenCalledTimes(21)
    const other = harness()
    expect(getGummyPipelines(other.root, 'bgra8unorm', true)).not.toBe(first)
    expect(other.unwrap).toHaveBeenCalledTimes(9)
  })

  it('never publishes partially initialized pipelines after construction fails', () => {
    const state = harness()
    state.unwrap.mockImplementationOnce(() => {
      throw new Error('pipeline failure')
    })
    expect(() => getGummyPipelines(state.root, 'bgra8unorm', true)).toThrow(
      'pipeline failure',
    )
    const ready = getGummyPipelines(state.root, 'bgra8unorm', true)
    expect(getGummyPipelines(state.root, 'bgra8unorm', true)).toBe(ready)
    expect(state.createRenderPipeline).toHaveBeenCalledTimes(14)
    expect(state.unwrap).toHaveBeenCalledTimes(10)
  })
})

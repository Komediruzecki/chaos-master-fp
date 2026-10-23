/** Resolve the mesh optics entrypoints before native GPU validation of the complete comparison. */
import { tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { marchingGummyComposite, marchingGummyExitFragment, marchingGummyFrontFragment, marchingGummyVertex, } from './marchingGummyRenderShaders'

describe('marching gummy optical passes', () => {
  it.each([
    marchingGummyVertex,
    marchingGummyFrontFragment,
    marchingGummyExitFragment,
    marchingGummyComposite,
  ])(
    'resolves the GPU entrypoint and its transitive dependencies',
    (shader) => {
      const source = tgpu.resolve([shader], { names: 'strict' })
      expect(source).toMatch(/@(vertex|fragment)/)
      expect(source).not.toContain('NaN')
    },
  )
})

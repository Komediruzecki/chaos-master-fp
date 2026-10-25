/** Contact interpolation preserves rigid chunks and remains seekable at quaternion seams. */
import { d, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { contactRotation, contactVertex, rotateContactVertex, } from './pawnContactShaders'

describe('contact solid shaders', () => {
  it('resolves the storage-backed native vertex entrypoint', () => {
    const code = tgpu.resolve([contactVertex])
    expect(code).toContain('@vertex')
    expect(code).toContain('var<storage, read>')
  })

  it('keeps the authored rest pose and rotates a rigid chunk without scaling it', () => {
    const vertex = d.vec3f(0.2, -0.1, 0.3)
    const rest = rotateContactVertex(vertex, d.vec4f(0, 0, 0, 1))
    expect([...rest]).toEqual([...vertex])
    const turn = rotateContactVertex(
      vertex,
      d.vec4f(0, Math.SQRT1_2, 0, Math.SQRT1_2),
    )
    expect(turn.x).toBeCloseTo(0.3, 6)
    expect(turn.y).toBeCloseTo(-0.1, 6)
    expect(turn.z).toBeCloseTo(-0.2, 6)
    expect(Math.hypot(...turn)).toBeCloseTo(Math.hypot(...vertex), 6)
  })

  it('takes the shortest arc and repeats identical poses for out-of-order seeks', () => {
    const first = d.vec4f(0, 0, 0, 1)
    const opposite = d.vec4f(0, 0, 0, -1)
    for (const blend of [0, 0.7, 0.2, 0.7, 1]) {
      const rotation = contactRotation(first, opposite, blend)
      expect([...rotation]).toEqual([...first])
      expect(Math.hypot(...rotation)).toBeCloseTo(1, 6)
    }
    const second = d.vec4f(0, Math.SQRT1_2, 0, Math.SQRT1_2)
    expect([...contactRotation(first, second, 0.6)]).toEqual([
      ...contactRotation(first, second, 0.6),
    ])
  })
})

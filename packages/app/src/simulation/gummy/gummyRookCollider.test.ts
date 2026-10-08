/** Rook collision agrees with the visible mould and admits only bounded, unilateral contact impulses. */
import { d, std, tgpu } from 'typegpu'
import { describe, expect, it } from 'vitest'
import { gummyChessField } from './gummyChessMoulds'
import { gummyParticleAdvanceTime, gummyParticleG2P, gummyParticleGridUpdate, gummyParticleP2G, } from './gummyParticleShaders'
import { gummyColliderRotateY, gummyColliderSurfaceVelocity, gummyRookContact, gummyRookContactCorrection, gummyRookContactVelocity, gummyRookMayContact, normalizeGummyRookCollider, } from './gummyRookCollider'

describe('prescribed rook collider', () => {
  it('transforms contact points and normals with the visible yaw and transfers the local surface velocity', () => {
    const point = d.vec3f(0.6, 2.3, -0.2)
    const localContact = gummyRookContact(point)
    const angle = 0.24
    const worldPoint = gummyColliderRotateY(point, angle)
    const recovered = gummyColliderRotateY(worldPoint, -angle)
    for (let axis = 0; axis < 3; axis++)
      expect(recovered[axis]).toBeCloseTo(point[axis]!, 6)
    const contact = gummyRookContact(recovered)
    expect(contact.w).toBeCloseTo(localContact.w, 6)
    const normal = gummyColliderRotateY(contact.xyz, angle)
    expect(std.length(normal)).toBeCloseTo(1, 6)
    const linear = d.vec3f(0.1, -0.2, 0.3),
      omega = 0.8,
      dt = 0.002
    const velocity = gummyColliderSurfaceVelocity(linear, worldPoint, omega)
    const next = gummyColliderRotateY(point, angle + omega * dt)
    const previous = gummyColliderRotateY(point, angle - omega * dt)
    for (let axis = 0; axis < 3; axis++)
      expect(velocity[axis]).toBeCloseTo(
        (next[axis]! - previous[axis]!) / (2 * dt) + linear[axis]!,
        4,
      )
    const config = {
      position: [0, 0, 0] as const,
      velocity: [0, 0, 0] as const,
    }
    expect(normalizeGummyRookCollider(config)?.angularVelocityY).toBe(0)
    for (const update of [
      { rotationY: NaN },
      { angularVelocityY: Infinity },
      { angularVelocityY: -4.01 },
    ])
      expect(() =>
        normalizeGummyRookCollider({ ...config, ...update }),
      ).toThrow('yaw')
  })
  it('rejects separated material cheaply without discarding any sampled exact contact', () => {
    for (const radius of [0.03, 0.04, 0.06])
      for (let y = -0.18; y < 2.8; y += 0.11)
        for (let x = -1; x <= 1; x += 0.09)
          for (const z of [-0.84, -0.48, 0, 0.39, 0.83]) {
            const point = d.vec3f(x, y, z)
            if (gummyRookContact(point).w <= radius)
              expect(gummyRookMayContact(point, radius)).toBe(true)
          }
    expect(gummyRookMayContact(d.vec3f(3.2, 1, 0), 0.06)).toBe(false)
    expect(gummyRookMayContact(d.vec3f(0, -0.5, 0), 0.06)).toBe(false)
    expect(gummyRookMayContact(d.vec3f(0, 2.8, 0), 0.06)).toBe(false)
  })

  it('matches the mould sign everywhere sampled and its exterior/near-surface distance', () => {
    for (let iy = -2; iy <= 27; iy++)
      for (let ix = -9; ix <= 9; ix++)
        for (const z of [-0.61, -0.27, 0, 0.19, 0.53]) {
          const point = [ix * 0.1, iy * 0.1, z] as const
          const visible = gummyChessField(point, 'rook')
          const collision = gummyRookContact(d.vec3f(...point))
          expect([...collision].every(Number.isFinite)).toBe(true)
          expect(collision.w <= 0).toBe(visible <= 0)
          if (visible > -0.04) expect(collision.w).toBeCloseTo(visible, 5)
          expect(std.length(collision.xyz)).toBeCloseTo(1, 5)
        }
  })

  it('gives outward normals on the sole, base, stem and rounded crown', () => {
    for (const point of [
      [0.2, 0, 0],
      [0.79, 0.23, 0],
      [0.41, 1.12, 0.1],
      [0.48, 2.52, 0],
    ] as const) {
      const contact = gummyRookContact(d.vec3f(point[0], point[1], point[2]))
      const epsilon = 0.0001
      const gradient = point.map((_, axis) => {
        const a: [number, number, number] = [...point]
        const b: [number, number, number] = [...point]
        a[axis]! += epsilon
        b[axis]! -= epsilon
        return (
          (gummyChessField(a, 'rook') - gummyChessField(b, 'rook')) /
          (2 * epsilon)
        )
      })
      const expected = std.normalize(
        d.vec3f(gradient[0]!, gradient[1]!, gradient[2]!),
      )
      expect(std.dot(contact.xyz, expected)).toBeGreaterThan(0.999)
    }
  })

  it('never changes material outside contact or already separating from the driven mould', () => {
    const normal = d.vec3f(0, -1, 0)
    const collider = d.vec3f(0, -2, 0)
    const stationary = d.vec3f(0)
    expect([
      ...gummyRookContactVelocity(stationary, collider, normal, 0.001, 1),
    ]).toEqual([0, 0, 0])
    const separating = d.vec3f(1, -3, 0)
    expect([
      ...gummyRookContactVelocity(separating, collider, normal, -0.01, 1),
    ]).toEqual([...separating])
    expect(
      std.length(
        gummyRookContactCorrection(d.vec4f(normal, 0.041), 0.04, 0.02),
      ),
    ).toBe(0)
  })

  it('matches the driven normal velocity and limits friction by the normal impulse', () => {
    const normal = d.vec3f(0, -1, 0)
    const collider = d.vec3f(0, -2, 0)
    const velocity = d.vec3f(3, 0, 0)
    const smooth = gummyRookContactVelocity(velocity, collider, normal, 0, 0)
    const rough = gummyRookContactVelocity(velocity, collider, normal, 0, 0.5)
    expect([...smooth]).toEqual([3, -2, 0])
    expect([...rough]).toEqual([2, -2, 0])
    expect(std.dot(std.sub(rough, collider), normal)).toBeCloseTo(0)
    expect(std.length(std.sub(rough, collider))).toBeLessThan(
      std.length(std.sub(velocity, collider)),
    )
    const stopped = gummyRookContactVelocity(
      d.vec3f(0.1, 0, 0),
      collider,
      normal,
      -0.01,
      1,
    )
    expect([...stopped]).toEqual([...collider])
  })

  it('caps normal projection independently of penetration depth', () => {
    const shallow = gummyRookContactCorrection(
      d.vec4f(0, -1, 0, 0.03),
      0.04,
      0.02,
    )
    const deep = gummyRookContactCorrection(d.vec4f(0, -1, 0, -10), 0.04, 0.02)
    expect(shallow.y).toBeCloseTo(-0.01)
    expect(deep.y).toBeCloseTo(-0.02)
  })

  it('validates finite poses and bounded speed, defaults friction and clamps its coefficient', () => {
    expect(normalizeGummyRookCollider()).toBeUndefined()
    const collider = { position: [0, 3.1, 0], velocity: [0, -2, 0] } as const
    expect(normalizeGummyRookCollider(collider)?.friction).toBe(0.35)
    expect(
      normalizeGummyRookCollider({ ...collider, friction: 3 })?.friction,
    ).toBe(1)
    expect(
      normalizeGummyRookCollider({ ...collider, friction: -3 })?.friction,
    ).toBe(0)
    expect(() =>
      normalizeGummyRookCollider({ ...collider, position: [0, NaN, 0] }),
    ).toThrow(RangeError)
    expect(() =>
      normalizeGummyRookCollider({ ...collider, position: [0, 1e100, 0] }),
    ).toThrow(RangeError)
    expect(() =>
      normalizeGummyRookCollider({ ...collider, velocity: [0, Infinity, 0] }),
    ).toThrow(RangeError)
    expect(() =>
      normalizeGummyRookCollider({ ...collider, velocity: [24, 24, 0] }),
    ).toThrow(RangeError)
    expect(() =>
      normalizeGummyRookCollider({ ...collider, friction: NaN }),
    ).toThrow(RangeError)
  })

  it('emits all contact kernels without packed matrix constructors or extra profile storage', () => {
    for (const shader of [
      gummyParticleP2G,
      gummyParticleGridUpdate,
      gummyParticleG2P,
      gummyParticleAdvanceTime,
    ]) {
      const wgsl = tgpu.resolve([shader], { names: 'strict' })
      expect(wgsl).toContain('@compute')
      expect(wgsl).not.toContain('atomic<f32>')
      expect(wgsl).not.toContain('mat3x3f(previous.deformation.columns')
    }
  })
})

/** Independent collision, impulse-triggered failure and deterministic-seek checks for the contact bake. */
import { describe, expect, it } from 'vitest'
import { connectedBodies, pointVelocity } from './rookContactBodies'
import { findRookContacts } from './rookContactCollision'
import { rotate } from './rookContactMath'
import { bakeRookContactShot, resolveRookContact } from './rookContactSolver'
import type { ContactVector, RookContactChunk, RookContactPhysics, RookContactShot, } from './rookContactTypes'

function cube(x: number): RookContactChunk {
  const points: number[] = []
  for (const dx of [-0.25, 0.25])
    for (const dy of [-0.25, 0.25])
      for (const dz of [-0.25, 0.25]) points.push(dx, dy, dz)
  return {
    centroid: [x, 0.25, 0],
    mass: 0.125,
    localMin: [-0.25, -0.25, -0.25],
    localMax: [0.25, 0.25, 0.25],
    boxes: new Float32Array([0, 0, 0, 0.25, 0.25, 0.25]),
    supportPoints: new Float32Array(points),
  }
}

function shot(contact = true): RookContactShot {
  const physics: RookContactPhysics = {
    cellSize: 0.1,
    chunks: [cube(-0.25), cube(0.25)],
    bonds: [
      { a: 0, b: 1, area: 0.25, centroid: [0, 0.25, 0], normal: [1, 0, 0] },
    ],
  }
  const path = new Float32Array(325 * 3)
  for (let frame = 0; frame < 325; frame++)
    path.set(
      [contact ? -2 + Math.min(frame / 120, 1.4) * 2 : -4, 0.1, 0],
      frame * 3,
    )
  return {
    physics,
    attacker: { path, radius: 0.18, height: 0.4 },
    duration: 2.7,
    sampleRate: 120,
    strength: 0.3,
  }
}

describe('worker-baked rigid contact fracture', () => {
  it('keeps resting bonded material intact without contact or a timed burst', () => {
    const result = bakeRookContactShot(shot(false))
    expect(result.brokenAt[0]).toBe(-1)
    expect(result.stats.firstContact).toBe(-1)
    expect(result.stats.brokenBonds).toBe(0)
    for (let offset = 0; offset < result.poses.length; offset += 8) {
      expect(Math.abs(result.poses[offset]!)).toBeLessThan(1e-6)
      expect(Math.abs(result.poses[offset + 1]!)).toBeLessThan(2e-5)
      expect(result.poses[offset + 7]).toBeCloseTo(1, 6)
    }
  })

  it('breaks only after a measured impact, responds to strength and replays bit-identically', () => {
    const input = shot(),
      result = bakeRookContactShot(input),
      replay = bakeRookContactShot(input)
    expect(result.stats.firstContact).toBeGreaterThan(0.5)
    expect(result.brokenAt[0]).toBeGreaterThanOrEqual(
      result.stats.firstContact - 1e-7,
    )
    expect(result.stats.brokenBonds).toBe(1)
    expect(result.poses).toEqual(replay.poses)
    expect(result.brokenAt).toEqual(replay.brokenAt)
    expect(
      bakeRookContactShot({ ...input, strength: 1000 }).stats.brokenBonds,
    ).toBe(0)
    expect(result.poses.every(Number.isFinite)).toBe(true)
    expect(result.poses[0]).toBe(0)
    expect(result.poses[7]).toBe(1)
  })

  it('keeps every rotated support point above the floor after collision corrections', () => {
    const input = shot(),
      result = bakeRookContactShot(input)
    let minimum = Infinity
    for (let frame = 0; frame < result.frameCount; frame++)
      input.physics.chunks.forEach((chunk, index) => {
        const offset = (frame * result.chunkCount + index) * 8
        const q = Array.from(result.poses.subarray(offset + 4, offset + 8)) as [
          number,
          number,
          number,
          number,
        ]
        expect(Math.hypot(...q)).toBeCloseTo(1, 5)
        for (let p = 0; p < chunk.supportPoints.length; p += 3) {
          const point = Array.from(
            chunk.supportPoints.subarray(p, p + 3),
          ) as ContactVector
          minimum = Math.min(
            minimum,
            chunk.centroid[1] + result.poses[offset + 1]! + rotate(point, q)[1],
          )
        }
      })
    expect(minimum).toBeGreaterThan(-2e-5)
  })

  it('rejects unbounded or malformed trajectories before allocating a bake', () => {
    const input = shot()
    expect(() => bakeRookContactShot({ ...input, duration: 30 })).toThrow('361')
    expect(() => bakeRookContactShot({ ...input, sampleRate: 1000 })).toThrow(
      '120',
    )
    input.attacker.path[0] = NaN
    expect(() => bakeRookContactShot(input)).toThrow('finite')
  })

  it('distinguishes touching fragment surfaces from penetration and exchanges their momentum', () => {
    const { physics } = shot()
    const bodies = connectedBodies(physics, new Float32Array([0]))
    const attacker = {
      position: [-4, 0, 0] as ContactVector,
      radius: 0.1,
      height: 1,
    }
    expect(
      findRookContacts(physics, bodies, attacker).filter(
        (contact) => contact.b >= 0,
      ),
    ).toHaveLength(0)
    bodies[0]!.center[0] += 0.02
    bodies[0]!.velocity = [1, 0, 0]
    bodies[1]!.velocity = [-1, 0, 0]
    const contact = findRookContacts(physics, bodies, attacker).find(
      (item) => item.b >= 0,
    )!
    expect(contact.depth).toBeCloseTo(0.02, 6)
    resolveRookContact(contact, bodies, [0, 0, 0])
    expect(bodies[0]!.velocity[0] + bodies[1]!.velocity[0]).toBeCloseTo(0, 6)
    expect(bodies[0]!.velocity[0]).toBeLessThan(0)
    expect(bodies[1]!.velocity[0]).toBeGreaterThan(0)
  })

  it('uses post-normal contact velocity for friction, avoiding an off-center tangent reversal', () => {
    const { physics } = shot(),
      bodies = connectedBodies(physics, new Float32Array([0]))
    bodies[0]!.velocity = [1, -1, 0]
    const point: ContactVector = [0, 0.5, 0]
    resolveRookContact(
      {
        a: 0,
        b: -1,
        chunkA: 0,
        chunkB: -1,
        point,
        normal: [0, 1, 0],
        depth: 0,
      },
      bodies,
      [0, 0, 0],
    )
    expect(pointVelocity(bodies[0]!, point)[0]).toBeCloseTo(0, 6)
  })
})

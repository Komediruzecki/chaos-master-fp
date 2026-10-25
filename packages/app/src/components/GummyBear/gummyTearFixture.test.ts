/** A held waist is a boundary condition, not a rest-shape or topology edit, and cannot overlap the pulled arm. */
import { describe, expect, it } from 'vitest'
import { buildGummyBearMesh } from '@/simulation/gummy/gummyMesh'
import { gummyJellyCommand, gummyRestBounds, holdGummyTearBody, } from './gummyStudyMath'

describe('continuous tear body support', () => {
  it('pins the inclusive waist box across depth, preserves outside masses and all material coordinates, and is idempotent', () => {
    const input = new Float32Array([
      -0.3, 0.85, -99, 2, 0.3, 1.2, 99, 3, 0.3001, 1, 0, 4, 0, 0.849, 0, 5, 0,
      1.201, 0, 6, 0, 1, 0, 0, 0, 0.1, 0, 0,
    ])
    const before = input.slice()
    const held = holdGummyTearBody(input)
    expect(input).toEqual(before)
    expect(held.positions).not.toBe(input)
    expect(held.heldNodes).toBe(2)
    for (let node = 0; node < input.length / 4; node++) {
      expect(held.positions.subarray(node * 4, node * 4 + 3)).toEqual(
        input.subarray(node * 4, node * 4 + 3),
      )
      expect(held.positions[node * 4 + 3]).toBe(
        node < 2 ? 0 : input[node * 4 + 3],
      )
    }
    const repeated = holdGummyTearBody(held.positions)
    expect(repeated.heldNodes).toBe(0)
    expect(repeated.positions).toEqual(held.positions)
  })

  it('holds the agreed real mould waist without pinning any part of the tear handle patch', () => {
    const mesh = buildGummyBearMesh({
      fracture: 'none',
      pinnedFeet: true,
      pinHeight: 0.48,
    })
    const result = holdGummyTearBody(mesh.positions)
    const grip = gummyJellyCommand(
      0,
      'tear',
      gummyRestBounds(mesh.positions),
    ).grip!
    let heldNodes = 0,
      pulledNodes = 0
    for (let node = 0; node < mesh.positions.length / 4; node++) {
      const offset = node * 4
      const newlyHeld =
        mesh.positions[offset + 3]! > 0 && result.positions[offset + 3] === 0
      const pulled =
        Math.hypot(
          mesh.positions[offset]! - grip.center[0],
          mesh.positions[offset + 1]! - grip.center[1],
          mesh.positions[offset + 2]! - grip.center[2],
        ) <= grip.radius
      if (newlyHeld) heldNodes++
      if (pulled) pulledNodes++
      expect(newlyHeld && pulled).toBe(false)
    }
    expect(heldNodes).toBe(135)
    expect(result.heldNodes).toBe(heldNodes)
    expect(pulledNodes).toBeGreaterThan(0)
  })

  it('rejects malformed, non-finite and negative-mass input', () => {
    expect(() => holdGummyTearBody(new Float32Array())).toThrow('packed xyzw')
    expect(() => holdGummyTearBody(new Float32Array([0, 1, 0]))).toThrow(
      'packed xyzw',
    )
    expect(() => holdGummyTearBody(new Float32Array([0, 1, NaN, 1]))).toThrow(
      'finite',
    )
    expect(() => holdGummyTearBody(new Float32Array([0, 1, 0, -1]))).toThrow(
      'inverse masses',
    )
  })
})

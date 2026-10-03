/** Perspective picking must remain aligned with the drawn board at different orbits/aspects. */
import { describe, expect, it } from 'vitest'
import { buildPawnShellGeometry } from '@/flame/chess/pawnBoardGeometry'
import { boardCameraMatrices, DEFAULT_BOARD_CAMERA, DEFAULT_INSPECTION_CAMERA, moveProgress, pawnInspectionCameraMatrices, pickBoardSquare, pickPawnSquare, squareWorld, } from './pawnBoardMath'

describe('pawn board projection and picking', () => {
  it.each([0.5, 0.8, 1.8])(
    'keeps the complete inspection shell in frame at aspect %s',
    (aspect) => {
      const vp = new Float32Array(16)
      pawnInspectionCameraMatrices(
        DEFAULT_INSPECTION_CAMERA,
        aspect,
        vp,
        new Float32Array(16),
        new Float32Array(3),
        new Float32Array(16),
        new Float32Array(16),
      )
      const vertices = buildPawnShellGeometry().vertices
      for (let i = 0; i < vertices.length; i += 6) {
        const x = vertices[i]!,
          y = vertices[i + 1]! + 0.09,
          z = vertices[i + 2]!
        const w = x * vp[3]! + y * vp[7]! + z * vp[11]! + vp[15]!
        const clipX = (x * vp[0]! + y * vp[4]! + z * vp[8]! + vp[12]!) / w
        const clipY = (x * vp[1]! + y * vp[5]! + z * vp[9]! + vp[13]!) / w
        expect(Math.abs(clipX)).toBeLessThan(0.94)
        expect(Math.abs(clipY)).toBeLessThan(0.94)
      }
    },
  )
  it('places all 64 square centres on the Y-up board without rank inversion', () => {
    expect(squareWorld({ file: 0, rank: 0 })).toEqual([
      -5.6000000000000005, 0.09, 5.6000000000000005,
    ])
    expect(squareWorld({ file: 7, rank: 7 })).toEqual([
      5.6000000000000005, 0.09, -5.6000000000000005,
    ])
  })
  it.each([0.5, 1, 1.8])(
    'picks every projected square from aspect %s and several orbit directions',
    (aspect) => {
      for (const theta of [-1.8, 0.38, 2.6]) {
        const vp = new Float32Array(16),
          inv = new Float32Array(16),
          eye = new Float32Array(3)
        boardCameraMatrices(
          { ...DEFAULT_BOARD_CAMERA, theta },
          aspect,
          vp,
          inv,
          eye,
          new Float32Array(16),
          new Float32Array(16),
        )
        for (let rank = 0; rank < 8; rank++)
          for (let file = 0; file < 8; file++) {
            const p = squareWorld({ file, rank })
            p[1] = 0.06
            const x = p[0] * vp[0]! + p[1] * vp[4]! + p[2] * vp[8]! + vp[12]!
            const y = p[0] * vp[1]! + p[1] * vp[5]! + p[2] * vp[9]! + vp[13]!
            const w = p[0] * vp[3]! + p[1] * vp[7]! + p[2] * vp[11]! + vp[15]!
            expect(pickBoardSquare(x / w, y / w, inv)).toEqual({ file, rank })
          }
        expect(pickBoardSquare(5, 5, inv)).toBeUndefined()
      }
    },
  )
  it('moves smoothly from the source to the destination and clamps late receipts', () => {
    expect(moveProgress(-1)).toBe(0)
    expect(moveProgress(0.325)).toBe(0.5)
    expect(moveProgress(0.65)).toBe(1)
    expect(moveProgress(20)).toBe(1)
  })
  it('selects a visible tall pawn head rather than the square behind it', () => {
    const vp = new Float32Array(16),
      inv = new Float32Array(16),
      eye = new Float32Array(3)
    boardCameraMatrices(
      { ...DEFAULT_BOARD_CAMERA, phi: 1.1 },
      1.5,
      vp,
      inv,
      eye,
      new Float32Array(16),
      new Float32Array(16),
    )
    const square = { file: 3, rank: 3 },
      p = squareWorld(square)
    p[1] += 1.47
    const x = p[0] * vp[0]! + p[1] * vp[4]! + p[2] * vp[8]! + vp[12]!
    const y = p[0] * vp[1]! + p[1] * vp[5]! + p[2] * vp[9]! + vp[13]!
    const w = p[0] * vp[3]! + p[1] * vp[7]! + p[2] * vp[11]! + vp[15]!
    expect(
      pickPawnSquare(x / w, y / w, inv, [
        { id: 'pawn', side: 'light', square, moved: true },
      ]),
    ).toEqual(square)
    expect(pickBoardSquare(x / w, y / w, inv)).not.toEqual(square)
    expect(
      pickPawnSquare(4, 4, inv, [
        { id: 'pawn', side: 'light', square, moved: true },
      ]),
    ).toBeUndefined()
  })
  it.each([0.5, 0.8, 1.32, 1.8])(
    'fits the complete slab and crowns inside an 8%% margin at aspect %s',
    (aspect) => {
      const vp = new Float32Array(16),
        inv = new Float32Array(16),
        eye = new Float32Array(3)
      boardCameraMatrices(
        { ...DEFAULT_BOARD_CAMERA },
        aspect,
        vp,
        inv,
        eye,
        new Float32Array(16),
        new Float32Array(16),
      )
      for (const x of [-6.63, 6.63])
        for (const y of [-0.455, 1.95])
          for (const z of [-6.63, 6.63]) {
            const clipX = x * vp[0]! + y * vp[4]! + z * vp[8]! + vp[12]!
            const clipY = x * vp[1]! + y * vp[5]! + z * vp[9]! + vp[13]!
            const clipZ = x * vp[2]! + y * vp[6]! + z * vp[10]! + vp[14]!
            const w = x * vp[3]! + y * vp[7]! + z * vp[11]! + vp[15]!
            expect(Math.abs(clipX / w)).toBeLessThanOrEqual(0.920001)
            expect(Math.abs(clipY / w)).toBeLessThanOrEqual(0.920001)
            expect(clipZ / w).toBeGreaterThan(0)
            expect(clipZ / w).toBeLessThan(1)
          }
    },
  )
})

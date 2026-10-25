/** Project sampled actor extents through the cinema camera, including special captures and tall promotions. */
import { applyChessMove, createChessGame, } from '@chaos-master/core/chess/chessGame'
import { describe, expect, it } from 'vitest'
import { NATIVE_CINEMA_DURATION, nativeCinemaCamera, nativeCinemaTime, } from './nativeCinemaCamera'
import { nativeMatchFrame, nativeMatchPieces } from './nativeFractalMatchFrame'
import type { CollectionCloud } from './collectionCloudWorker'

const clouds: CollectionCloud[] = [
  'pawn',
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
].flatMap((role) =>
  (['light', 'dark'] as const).map((side) => ({
    key: `${role}:${side}`,
    side,
    points: new Float32Array(),
    colors: new Float32Array(),
    bounds: {
      min: [-0.7, 0, -0.6] as const,
      max: [0.9, role === 'queen' ? 4.2 : 2.6, 0.8] as const,
    },
  })),
)
const fixtures = [
  { fen: '7k/8/8/3n4/4P3/8/8/K7 w - - 0 1', from: 'e4', to: 'd5' },
  { fen: '1n2k3/8/8/8/8/8/8/1R2K3 w - - 0 1', from: 'b1', to: 'b8' },
  { fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', from: 'e5', to: 'd6' },
  {
    fen: '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1',
    from: 'a7',
    to: 'b8',
    promotion: 'queen',
  },
] as const
const look = {
  collectionId: 'wild-canopy',
  enclosure: 'glass' as const,
  scale: 0.9,
}

function project(vp: Float32Array, point: readonly number[]) {
  const [x, y, z] = point as [number, number, number]
  const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!
  return [
    (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w,
    (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w,
    w,
  ]
}

describe('native cinema framing', () => {
  it('holds the original board, advances monotonically through impact and holds the legal destination', () => {
    const { receipt } = applyChessMove(
      createChessGame(fixtures[0].fen),
      fixtures[0],
    )
    expect(nativeCinemaTime(-1)).toBe(0)
    expect(nativeCinemaTime(0.5)).toBe(0)
    expect(nativeCinemaTime(1.7)).toBeCloseTo(0.9)
    expect(nativeCinemaTime(3.3)).toBeCloseTo(1.35)
    let previous = 0
    for (let frame = 0; frame <= 360; frame++) {
      const time = nativeCinemaTime(frame / 60)
      expect(time).toBeGreaterThanOrEqual(previous)
      previous = time
    }
    expect(nativeMatchFrame(receipt, nativeCinemaTime(0), look)).toEqual(
      nativeMatchPieces(receipt.before, look),
    )
    expect(nativeMatchFrame(receipt, nativeCinemaTime(5.2), look)).toEqual(
      nativeMatchPieces(receipt.after, look),
    )
    expect(
      nativeMatchFrame(
        receipt,
        nativeCinemaTime(NATIVE_CINEMA_DURATION + 1),
        look,
      ),
    ).toEqual(nativeMatchPieces(receipt.after, look))
  })

  for (const camera of ['arc', 'diagonal', 'hero'] as const)
    it(`keeps both sampled actors inside ${camera} framing for portrait, landscape and special captures`, () => {
      for (const fixture of fixtures) {
        const { receipt } = applyChessMove(
          createChessGame(fixture.fen),
          fixture,
        )
        for (const aspect of [16 / 9, 9 / 16, 0.25])
          for (let frame = 0; frame <= 120; frame++) {
            const displayTime = frame / 20
            const fitted = nativeCinemaCamera(
              receipt,
              clouds,
              { scale: look.scale, camera },
              displayTime,
              aspect,
            )
            const pieces = nativeMatchFrame(
              receipt,
              nativeCinemaTime(displayTime),
              look,
            )
            for (const piece of pieces.filter(
              (p) => p.id === receipt.pieceId || p.id === receipt.captured?.id,
            )) {
              const bounds = clouds.find(
                (cloud) => cloud.key === piece.cloudKey,
              )!.bounds
              for (const x of [bounds.min[0], bounds.max[0]])
                for (const y of [bounds.min[1], bounds.max[1]])
                  for (const z of [bounds.min[2], bounds.max[2]]) {
                    const projected = project(fitted.viewProjection, [
                      x * look.scale + piece.position[0],
                      y * look.scale + piece.position[1],
                      z * look.scale + piece.position[2],
                    ])
                    expect(projected[2]).toBeGreaterThan(0)
                    expect(Math.abs(projected[0]!)).toBeLessThan(0.9)
                    expect(Math.abs(projected[1]!)).toBeLessThan(0.9)
                  }
            }
          }
      }
    })

  it('repeats the same camera after backward scrubbing and changes framing for each camera choice', () => {
    const { receipt } = applyChessMove(
      createChessGame(fixtures[0].fen),
      fixtures[0],
    )
    const shot = { scale: 0.9, camera: 'arc' as const }
    const first = nativeCinemaCamera(receipt, clouds, shot, 2.5, 16 / 9)
    nativeCinemaCamera(receipt, clouds, shot, 6, 16 / 9)
    expect(nativeCinemaCamera(receipt, clouds, shot, 2.5, 16 / 9)).toEqual(
      first,
    )
    for (const camera of ['diagonal', 'hero'] as const)
      expect(
        nativeCinemaCamera(receipt, clouds, { ...shot, camera }, 2.5, 16 / 9)
          .eye,
      ).not.toEqual(first.eye)
  })

  it('reserves the visible point scatter envelope, including the ballistic height peak', () => {
    const { receipt } = applyChessMove(
      createChessGame(fixtures[0].fen),
      fixtures[0],
    )
    for (const aspect of [16 / 9, 9 / 16])
      for (let frame = 34; frame < 104; frame++) {
        const time = frame / 20
        const victim = nativeMatchFrame(
          receipt,
          nativeCinemaTime(time),
          look,
        ).find((piece) => piece.id === receipt.captured!.id)!
        if (victim.age < 0 || victim.age >= 1.6) continue
        const fitted = nativeCinemaCamera(
          receipt,
          clouds,
          { scale: look.scale, camera: 'hero' },
          time,
          aspect,
        )
        const bounds = clouds.find(
          (cloud) => cloud.key === victim.cloudKey,
        )!.bounds
        for (const x of [bounds.min[0], bounds.max[0]])
          for (const z of [bounds.min[2], bounds.max[2]])
            for (const direction of [-1, 1]) {
              // The renderer's deterministic velocity cone is bounded by these
              // extrema; its floor clamp keeps late points above the board.
              const point = [
                (x + direction * 2.8 * victim.age) * look.scale +
                  victim.position[0],
                Math.max(
                  0.015,
                  bounds.max[1] + 4 * victim.age - 3.8 * victim.age ** 2,
                ) *
                  look.scale +
                  victim.position[1],
                (z + direction * 2.8 * victim.age) * look.scale +
                  victim.position[2],
              ]
              const projected = project(fitted.viewProjection, point)
              expect(projected[2]).toBeGreaterThan(0)
              expect(Math.abs(projected[0]!)).toBeLessThan(0.9)
              expect(Math.abs(projected[1]!)).toBeLessThan(0.9)
            }
      }
  })
})

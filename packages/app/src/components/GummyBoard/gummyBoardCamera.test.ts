/** Board framing covers the edge ranks across portrait and landscape displays. */
import { describe, expect, it } from 'vitest'
import { gummyBoardCameraMatrices, initialGummyBoardOrbit, } from './gummyBoardCamera'

describe('gummy board camera', () => {
  it.each([0.4, 0.75, 1, 1.8])(
    'fits every waiting piece at aspect %s',
    (aspect) => {
      const vp = new Float32Array(16),
        inverse = new Float32Array(16),
        eye = new Float32Array(3)
      gummyBoardCameraMatrices(
        initialGummyBoardOrbit('board'),
        aspect,
        'board',
        vp,
        inverse,
        eye,
        new Float32Array(16),
        new Float32Array(16),
      )
      for (const x of [-6.4, 6.4])
        for (const y of [0, 3.38])
          for (const z of [-6.4, 6.4]) {
            const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!
            const px = (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w
            const py = (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w
            expect(Math.abs(px)).toBeLessThan(0.93)
            expect(Math.abs(py)).toBeLessThan(0.93)
          }
      expect([...inverse, ...eye].every(Number.isFinite)).toBe(true)
    },
  )
})

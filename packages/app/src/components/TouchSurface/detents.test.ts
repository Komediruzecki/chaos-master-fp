import { describe, expect, it } from 'vitest'
import { clampSheetHeight, detentHeights, heightOf, nearestDetent, settleDetent, } from './detents'

const H = detentHeights(852)

describe('detentHeights', () => {
  it('is 96, 44% and 88% of the viewport', () => {
    expect(H).toEqual({ peek: 96, medium: 375, large: 750 })
    expect(heightOf('medium', H)).toBe(375)
  })
})

describe('clampSheetHeight', () => {
  it('never goes below peek or above large', () => {
    expect(clampSheetHeight(10, H)).toBe(96)
    expect(clampSheetHeight(2000, H)).toBe(750)
    expect(clampSheetHeight(400, H)).toBe(400)
  })
})

describe('nearestDetent', () => {
  it('picks the closest height', () => {
    expect(nearestDetent(200, H)).toBe('peek')
    expect(nearestDetent(300, H)).toBe('medium')
    expect(nearestDetent(600, H)).toBe('large')
  })
})

describe('settleDetent', () => {
  it('settles at the nearest detent when released slowly', () => {
    expect(settleDetent(200, 0.1, H)).toBe('peek')
    expect(settleDetent(300, -0.1, H)).toBe('medium')
    expect(settleDetent(600, 0, H)).toBe('large')
  })

  it('goes to the next detent in the direction of a flick', () => {
    expect(settleDetent(200, 0.6, H)).toBe('medium')
    expect(settleDetent(200, -0.6, H)).toBe('peek')
    expect(settleDetent(400, 0.6, H)).toBe('large')
    expect(settleDetent(400, -0.6, H)).toBe('medium')
    expect(settleDetent(700, -0.6, H)).toBe('medium')
  })

  it('reaches peek from medium on a flick down, and never goes below it', () => {
    expect(settleDetent(375, -0.6, H)).toBe('peek')
    expect(settleDetent(360, -1.2, H)).toBe('peek')
    expect(settleDetent(96, -2, H)).toBe('peek')
  })

  it('stays at large on a flick up from large', () => {
    expect(settleDetent(750, 0.9, H)).toBe('large')
  })
})

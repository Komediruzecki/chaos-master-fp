import { describe, expect, it } from 'vitest'
import { isBenchmarksPath, isExplorerPath } from './appPath'

describe('isBenchmarksPath', () => {
  it.each(['/benchmarks', '/benchmarks/'])('matches %s', (pathname) => {
    expect(isBenchmarksPath(pathname)).toBe(true)
  })

  it.each(['/', '/benchmark', '/benchmarks/history', '/BENCHMARKS'])(
    'does not match %s',
    (pathname) => {
      expect(isBenchmarksPath(pathname)).toBe(false)
    },
  )
})

describe('isExplorerPath', () => {
  it.each(['/explore', '/explore/'])('matches %s', (pathname) => {
    expect(isExplorerPath(pathname)).toBe(true)
  })

  it.each(['/', '/explorer', '/explore/deep', '/benchmarks'])(
    'does not match %s',
    (pathname) => {
      expect(isExplorerPath(pathname)).toBe(false)
    },
  )
})

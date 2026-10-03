/** Standalone routes must match the same three forms on every host. */
import { describe, expect, it } from 'vitest'
import { isBenchmarksPath, isChessPath, isClashPath, isExplorerPath, isFigurinesPath, isGummyPath, isPawnPath, PAGE_ROUTES, pageRouteOf, } from './appPath'

describe('isBenchmarksPath', () => {
  it.each(['/benchmarks', '/benchmarks/', '/benchmarks/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isBenchmarksPath(pathname)).toBe(true)
    },
  )

  it.each(['/', '/benchmark', '/benchmarks/history', '/BENCHMARKS'])(
    'does not match %s',
    (pathname) => {
      expect(isBenchmarksPath(pathname)).toBe(false)
    },
  )
})

describe('isExplorerPath', () => {
  it.each(['/explore', '/explore/', '/explore/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isExplorerPath(pathname)).toBe(true)
    },
  )

  it.each(['/', '/explorer', '/explore/deep', '/benchmarks'])(
    'does not match %s',
    (pathname) => {
      expect(isExplorerPath(pathname)).toBe(false)
    },
  )
})

describe('isClashPath', () => {
  it.each(['/clash', '/clash/', '/clash/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isClashPath(pathname)).toBe(true)
    },
  )

  it.each(['/', '/clashes', '/clash/arena', '/arcade', '/explore'])(
    'does not match %s',
    (pathname) => {
      expect(isClashPath(pathname)).toBe(false)
    },
  )
})

describe('isPawnPath', () => {
  it.each(['/pawn', '/pawn/', '/pawn/index.html'])('matches %s', (pathname) => {
    expect(isPawnPath(pathname)).toBe(true)
  })

  it.each(['/', '/pawns', '/pawn/forge', '/PAWN', '/clash'])(
    'does not match %s',
    (pathname) => {
      expect(isPawnPath(pathname)).toBe(false)
    },
  )
})

describe('pageRouteOf', () => {
  // A static host serves the build's <route>/index.html by its own name too
  // (routing/staticEntries.ts), and the page there is the route's.
  it.each(PAGE_ROUTES)('reads %s in each of its spellings', (route) => {
    for (const pathname of [route, `${route}/`, `${route}/index.html`]) {
      expect(pageRouteOf(pathname)).toBe(route)
    }
  })

  it.each([
    '/',
    '/index.html',
    '/explore/index.htm',
    '/explore/deep/index.html',
    '/explore//index.html',
    '/explore.html',
  ])('names no page route for %s', (pathname) => {
    expect(pageRouteOf(pathname)).toBeUndefined()
  })
})

describe('isChessPath', () => {
  it.each(['/chess', '/chess/', '/chess/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isChessPath(pathname)).toBe(true)
    },
  )
  it.each(['/', '/chess/board', '/CHESS', '/pawn', '/chessboards'])(
    'does not match %s',
    (pathname) => {
      expect(isChessPath(pathname)).toBe(false)
    },
  )
})

describe('isFigurinesPath', () => {
  it.each(['/figurines', '/figurines/', '/figurines/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isFigurinesPath(pathname)).toBe(true)
    },
  )
  it.each(['/', '/figurine', '/figurines/pawn', '/FIGURINES', '/chess'])(
    'does not match %s',
    (pathname) => {
      expect(isFigurinesPath(pathname)).toBe(false)
    },
  )
})

describe('isGummyPath', () => {
  it.each(['/gummy', '/gummy/', '/gummy/index.html'])(
    'matches %s',
    (pathname) => {
      expect(isGummyPath(pathname)).toBe(true)
    },
  )
  it.each(['/', '/gummies', '/gummy/bear', '/GUMMY', '/chess', '/figurines'])(
    'does not match %s',
    (pathname) => {
      expect(isGummyPath(pathname)).toBe(false)
    },
  )
})

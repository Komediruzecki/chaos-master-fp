export const BENCHMARKS_PATH = '/benchmarks'

const BENCHMARK_PATHS = new Set([BENCHMARKS_PATH, `${BENCHMARKS_PATH}/`])

export function isBenchmarksPath(pathname: string): boolean {
  return BENCHMARK_PATHS.has(pathname)
}

export const EXPLORER_PATH = '/explore'

const EXPLORER_PATHS = new Set([EXPLORER_PATH, `${EXPLORER_PATH}/`])

export function isExplorerPath(pathname: string): boolean {
  return EXPLORER_PATHS.has(pathname)
}

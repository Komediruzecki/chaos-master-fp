const BENCHMARK_PATHS = new Set(['/benchmarks', '/benchmarks/'])

export function isBenchmarksPath(pathname: string): boolean {
  return BENCHMARK_PATHS.has(pathname)
}

/** A worker import must not load DOM editors or rely on window/document being present. */
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

describe('candidate solid worker imports', () => {
  it('boots and reports an unsupported request with no DOM globals', async () => {
    const bundled = await build({
      entryPoints: [resolve(import.meta.dirname, 'candidateSolidWorker.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'esnext',
      alias: {
        '@': resolve(import.meta.dirname, '../..'),
        '@chaos-master/core': resolve(
          import.meta.dirname,
          '../../../../core/src/index.ts',
        ),
      },
    })
    const scope: {
      onmessage?: (event: { data: unknown }) => void
      postMessage: ReturnType<typeof vi.fn>
    } = { postMessage: vi.fn() }
    runInNewContext(
      bundled.outputFiles[0]!.text,
      { self: scope, performance: globalThis.performance },
      { timeout: 2000 },
    )
    expect(scope.onmessage).toBeTypeOf('function')
    scope.onmessage!({ data: { version: 1 } })
    expect(scope.postMessage).toHaveBeenCalledWith({
      error: expect.stringContaining('finite-solid request'),
    })
  })
})

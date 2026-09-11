/**
 * GPU-free drift guard: fully resolves the worker's IFS compute shader to
 * WGSL, exactly like the app's ifsPipeline.resolve.test.ts does client-side.
 * The extraction wrapper rewrites app shader sources at runtime, so an app
 * render-core or typegpu upgrade that breaks the rewrite fails HERE in CI
 * instead of on a billable GPU worker.
 *
 * Run: deno task test
 */

import { tgpu } from 'typegpu'
import { createIFSPipeline } from '@/flame/ifsPipeline'
import { example1 } from '../../../packages/app/src/flame/examples/example1.ts'

// Mirrors the mock-root pattern of packages/app/src/flame/ifsPipeline.resolve.test.ts.
// deno-lint-ignore no-explicit-any
function mockRoot(capture: (compute: any) => void) {
  const fakeBuffer = {
    // deno-lint-ignore no-explicit-any
    $usage: () => fakeBuffer as any,
    write: () => {},
    destroy: () => {},
    buffer: {},
  }
  return {
    fakeBuffer,
    root: {
      createBuffer: () => fakeBuffer,
      createBindGroup: () => ({}),
      // deno-lint-ignore no-explicit-any
      createComputePipeline: ({ compute }: { compute: any }) => {
        capture(compute)
        // deno-lint-ignore no-explicit-any
        const p: any = {
          with: () => p,
          $name: () => p,
          dispatchWorkgroups: () => {},
        }
        return p
      },
    },
  }
}

Deno.test(
  'IFS compute shader resolves to WGSL under the extraction wrapper',
  () => {
    // deno-lint-ignore no-explicit-any
    let captured: any
    const { root, fakeBuffer } = mockRoot((c) => (captured = c))

    createIFSPipeline(
      // deno-lint-ignore no-explicit-any
      root as any,
      // deno-lint-ignore no-explicit-any
      { queue: { onSubmittedWorkDone: () => Promise.resolve() } } as any,
      // deno-lint-ignore no-explicit-any
      { bindGroup: {} } as any,
      20,
      // deno-lint-ignore no-explicit-any
      fakeBuffer as any,
      example1.transforms,
      [256, 256],
      // deno-lint-ignore no-explicit-any
      fakeBuffer as any,
      'colorInitZero',
      'pointInitUnitDisk',
    )

    const wgsl = tgpu.resolve({ externals: { captured }, names: 'strict' })
    if (!wgsl.includes('@compute')) {
      throw new Error('resolved WGSL is missing the @compute entry point')
    }
    if (/\bin\.\w+/.test(wgsl)) {
      throw new Error(
        'resolved WGSL still references `in.<field>` for a builtin (0.10-era shim leaked through)',
      )
    }
  },
)

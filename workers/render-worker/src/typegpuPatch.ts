/**
 * Runtime monkey-patch for typegpu's tgpu.fn and tgpu.computeFn.
 *
 * typegpu requires the `unplugin-typegpu` build plugin to pre-process function
 * bodies and attach metadata. At runtime in Deno, the plugin is not available.
 *
 * This module wraps tgpu.fn (and tgpu.computeFn) so that when a function
 * implementation is passed to the callable, it is automatically converted to a
 * WGSL string using extractWgslFromUseGpu(). typegpu's createFnCore() already
 * has a runtime string path (fnCore.js line 29) — we just feed it the right
 * format.
 *
 * Import this BEFORE any module that calls tgpu.fn(...)(impl) or
 * tgpu.computeFn(...)(impl) at module init time.
 */

import { tgpu } from 'typegpu'
import { extractWgslFromUseGpu } from './wgslExtractor.ts'

/**
 * Wraps a typegpu callable (the thing returned by `tgpu.fn([types], ret)`) in a
 * Proxy that intercepts function-implementation arguments and converts them to
 * WGSL strings.
 *
 * Any function implementation is converted — not just those with 'use gpu' —
 * because some modules (affineTranform) use tgpu.fn(...)(impl) without the
 * directive. If extraction fails (e.g. destructured params in compute fn bodies),
 * we pass through and let typegpu surface the metadata error at resolution time.
 */
function wrapCallable(
  callable: (...args: unknown[]) => unknown,
): typeof callable {
  return new Proxy(callable, {
    apply(target, thisArg, args) {
      const [impl, ...rest] = args
      if (typeof impl === 'function') {
        try {
          const wgsl = extractWgslFromUseGpu(impl)
          return Reflect.apply(target, thisArg, [wgsl, ...rest])
        } catch {
          // Extraction failed — likely a complex typegpu DSL function
          // (destructured params, slot accessors, typegpu std calls).
          // Pass through to original; will fail with metadata error at
          // resolution time. These must be handled separately (stubs, etc.)
        }
      }
      return Reflect.apply(target, thisArg, args)
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver)
    },
  })
}

// ---- patch tgpu.fn ----

const _originalFn = tgpu.fn.bind(tgpu)

const patchedFn: typeof tgpu.fn = function (
  ...args: Parameters<typeof tgpu.fn>
) {
  const callable = _originalFn(...args)
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
  ) as unknown as ReturnType<typeof tgpu.fn>
} as unknown as typeof tgpu.fn

Object.defineProperty(tgpu, 'fn', {
  value: patchedFn,
  configurable: true,
  writable: true,
  enumerable: true,
})

// ---- patch tgpu.computeFn ----

const _originalComputeFn = tgpu.computeFn.bind(tgpu)

const patchedComputeFn: typeof tgpu.computeFn = function (
  ...args: Parameters<typeof tgpu.computeFn>
) {
  const callable = _originalComputeFn(args[0])
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
  ) as unknown as ReturnType<typeof tgpu.computeFn>
} as unknown as typeof tgpu.computeFn

Object.defineProperty(tgpu, 'computeFn', {
  value: patchedComputeFn,
  configurable: true,
  writable: true,
  enumerable: true,
})

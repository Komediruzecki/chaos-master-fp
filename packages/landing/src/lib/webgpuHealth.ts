import { createSignal } from 'solid-js'

/**
 * Page-wide "is WebGPU healthy?" signal, shared across every Solid island (they
 * all import this one module instance from the bundle, so the signal is global
 * to the page). Live flames read `webgpuLive()`; on the first GPU failure
 * (out-of-memory uncapturederror, device loss) the whole page latches to its
 * static posters instead of leaving blank/black canvases — the "live by default,
 * poster on failure" behaviour.
 */
const [healthy, setHealthy] = createSignal(true)

/** Sync support probe — false when the browser advertises no WebGPU at all
 *  (old Safari, Firefox without the flag). No async adapter request. */
export function webgpuSupported(): boolean {
  // globalThis.navigator: bare `navigator` is eslint-restricted (no-restricted-globals).
  const nav = globalThis.navigator
  return typeof nav !== 'undefined' && 'gpu' in nav
}

/** Reactive: may live GPU flames run? False once support is missing or a GPU
 *  failure has fired. Latches false — never flips back (avoids OOM flip-flop). */
export function webgpuLive(): boolean {
  return webgpuSupported() && healthy()
}

let failed = false
/** Permanently flip the page to posters on the first GPU failure. Idempotent. */
export function reportGpuFailure(reason: string): void {
  if (failed) return
  failed = true
  console.warn(`[landing] WebGPU disabled, falling back to posters — ${reason}`)
  setHealthy(false)
}

const watched = new WeakSet<GPUDevice>()
/**
 * Attach failure listeners to a device once. The device is a cached singleton
 * shared across all Roots, so this no-ops after the first call. An OOM surfaces
 * as an `uncapturederror`; a driver/GPU reset surfaces via `device.lost`.
 */
export function watchDevice(device: GPUDevice): void {
  if (watched.has(device)) return
  watched.add(device)
  device.addEventListener('uncapturederror', (e) => {
    reportGpuFailure((e as GPUUncapturedErrorEvent).error.message)
  })
  device.lost
    .then((info) => {
      // 'destroyed' is an intentional teardown (Root unmount), not a failure.
      if (info.reason !== 'destroyed') {
        reportGpuFailure(`device lost: ${info.message}`)
      }
    })
    .catch(() => {})
}

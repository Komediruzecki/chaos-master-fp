/**
 * Server-side stub for @/lib/RootContext.
 */

import type { TgpuRoot } from 'typegpu'

export const RootContextProvider = (_props: Record<string, unknown>) =>
  undefined

export function useRootContext(): {
  adapter: GPUAdapter
  device: GPUDevice
  root: TgpuRoot
} {
  throw new Error(
    'Server-side stub: useRootContext() is not available in the render worker.',
  )
}

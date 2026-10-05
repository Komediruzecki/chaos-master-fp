/** Surface the first asynchronous GPU failure without hiding the browser's error event. */
export function bindGummyGpuErrors(
  device: GPUDevice,
  onError: (message: string) => void,
): () => void {
  let disposed = false
  let reported = false

  function uncapturedError(event: GPUUncapturedErrorEvent) {
    if (disposed || reported) return
    reported = true
    const error = event.error
    const kind = error.constructor.name
    const prefix =
      kind === 'GPUValidationError'
        ? 'GPU validation error'
        : kind === 'GPUInternalError'
          ? 'GPU internal error'
          : kind === 'GPUOutOfMemoryError'
            ? 'GPU out of memory'
            : 'GPU error'
    const detail =
      error.message.trim() || 'The GPU could not complete this operation.'
    const message = `${prefix}: ${detail}`
    onError(message.length > 1000 ? `${message.slice(0, 999)}…` : message)
  }

  device.addEventListener('uncapturederror', uncapturedError)
  return () => {
    if (disposed) return
    disposed = true
    device.removeEventListener('uncapturederror', uncapturedError)
  }
}

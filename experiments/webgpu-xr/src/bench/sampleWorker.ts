// Sample the CPU reference off the UI thread and transfer its point buffer without copying.
import { sampleSpecimen } from './recipes'

interface SampleRequest {
  key: string
  recipe: number
  pointCount: number
  seed: number
}

globalThis.onmessage = (event: MessageEvent<SampleRequest>) => {
  const request = event.data
  try {
    const data = sampleSpecimen(
      request.recipe,
      request.pointCount,
      request.seed,
    )
    globalThis.postMessage(
      { key: request.key, data },
      { transfer: [data.buffer] },
    )
  } catch (error) {
    globalThis.postMessage({
      key: request.key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

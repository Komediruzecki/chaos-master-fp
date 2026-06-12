/**
 * Client for the render-worker REST API (Deno CPU IFS rendering server).
 *
 * Endpoints:
 *   POST   /render           — Submit flame JSON + options, returns { jobId, status }
 *   GET    /render/:id        — Job status + progress
 *   GET    /render/:id/result — Download rendered PNG
 */

export interface ServerRenderOptions {
  width: number
  height: number
  quality: number
}

export interface ServerRenderJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  error?: string
  renderTimeMs?: number
}

export interface ServerRenderError {
  error: string
  status: number
}

export async function submitServerRender(
  serverUrl: string,
  flameJson: string,
  options: ServerRenderOptions,
): Promise<{ jobId: string }> {
  const url = `${serverUrl.replace(/\/+$/, '')}/render`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flameJson, options }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw Object.assign(new Error(body.error ?? 'Render submission failed'), {
      status: res.status,
    })
  }

  return res.json()
}

export async function getServerRenderStatus(
  serverUrl: string,
  jobId: string,
): Promise<ServerRenderJob> {
  const url = `${serverUrl.replace(/\/+$/, '')}/render/${encodeURIComponent(jobId)}`
  const res = await fetch(url)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw Object.assign(new Error(body.error ?? 'Status check failed'), {
      status: res.status,
    })
  }

  return res.json()
}

export async function getServerRenderResult(
  serverUrl: string,
  jobId: string,
): Promise<Uint8Array> {
  const url = `${serverUrl.replace(/\/+$/, '')}/render/${encodeURIComponent(jobId)}/result`
  const res = await fetch(url)

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw Object.assign(new Error(body.error ?? 'Result download failed'), {
      status: res.status,
    })
  }

  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Poll a render job until completion, calling onProgress with each status update.
 * Returns the final PNG bytes.
 */
export async function pollUntilComplete(
  serverUrl: string,
  jobId: string,
  onProgress: (job: ServerRenderJob) => void,
  intervalMs = 500,
): Promise<Uint8Array> {
  while (true) {
    const job = await getServerRenderStatus(serverUrl, jobId)
    onProgress(job)

    if (job.status === 'completed') {
      return getServerRenderResult(serverUrl, jobId)
    }

    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Render failed')
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

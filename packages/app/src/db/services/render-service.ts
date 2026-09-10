/**
 * Render service: submit server render jobs, poll status, download results.
 * Tier limits are enforced server-side; this client handles the API calls.
 */

import { getAuthHeaders } from './auth-service'

export interface ServerRenderOptions {
  width: number
  height: number
  quality: number
  backend?: 'gpu' | 'cpu'
}

export interface ServerRenderJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  createdAt: string
  error?: string
  renderTimeMs?: number
}

export interface SubscriptionInfo {
  tier: 'free' | 'premium' | 'pro'
  rendersThisMonth: number
  renderLimitMonthly: number
  /** Ledger balance; renders debit this, failures refund it. */
  credits?: number
  stripeCustomerId?: string | null
}

export async function fetchSubscription(): Promise<SubscriptionInfo> {
  const res = await fetch('/api/auth/subscription', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    return { tier: 'free', rendersThisMonth: 0, renderLimitMonthly: 5 }
  }
  return res.json()
}

export async function submitRender(
  flameJson: string,
  options: ServerRenderOptions,
): Promise<{ jobId: string; status: string }> {
  const res = await fetch('/api/renders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ flameJson, options }),
  })
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: 'Render submission failed' }))
    throw Object.assign(new Error(body.error ?? 'Render submission failed'), {
      status: res.status,
    })
  }
  return res.json()
}

export async function getRenderStatus(jobId: string): Promise<ServerRenderJob> {
  const res = await fetch(`/api/renders/${encodeURIComponent(jobId)}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: 'Status check failed' }))
    throw Object.assign(new Error(body.error ?? 'Status check failed'), {
      status: res.status,
    })
  }
  return res.json()
}

export async function getRenderResult(jobId: string): Promise<Uint8Array> {
  const res = await fetch(`/api/renders/${encodeURIComponent(jobId)}/result`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: 'Result download failed' }))
    throw Object.assign(new Error(body.error ?? 'Result download failed'), {
      status: res.status,
    })
  }
  return new Uint8Array(await res.arrayBuffer())
}

export async function listUserRenders(): Promise<ServerRenderJob[]> {
  const res = await fetch('/api/renders', { headers: getAuthHeaders() })
  if (!res.ok) return []
  return res.json()
}

/** Cancel a job. Refund happens server-side only while it is still queued. */
export async function cancelRender(
  jobId: string,
): Promise<{ status: string; refunded: boolean }> {
  const res = await fetch(`/api/renders/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Cancel failed' }))
    throw Object.assign(new Error(body.error ?? 'Cancel failed'), {
      status: res.status,
    })
  }
  return res.json()
}

export async function createCheckoutSession(
  type: 'credits' | 'subscription',
  sku: string,
): Promise<{ url: string }> {
  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ type, sku }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Checkout failed' }))
    throw Object.assign(new Error(body.error ?? 'Checkout failed'), {
      status: res.status,
    })
  }
  return res.json()
}

export async function createPortalSession(): Promise<{ url: string }> {
  const res = await fetch('/api/stripe/portal', { headers: getAuthHeaders() })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Portal failed' }))
    throw Object.assign(new Error(body.error ?? 'Portal failed'), {
      status: res.status,
    })
  }
  return res.json()
}

export async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  const res = await fetch('/api/feature-flags')
  if (!res.ok) return {}
  return res.json()
}

export interface PollOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export async function pollUntilComplete(
  jobId: string,
  onProgress: (job: ServerRenderJob) => void,
  opts: PollOptions = {},
): Promise<Uint8Array> {
  const { intervalMs = 500, timeoutMs = 300_000, signal } = opts
  const started = Date.now()

  let consecutiveFailures = 0

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (Date.now() - started > timeoutMs) {
      throw new Error('Render timed out')
    }

    let job: ServerRenderJob | null = null
    try {
      job = await getRenderStatus(jobId)
      consecutiveFailures = 0
      onProgress(job)
    } catch (err) {
      consecutiveFailures++
      if (consecutiveFailures >= 5) {
        throw err
      }
      console.warn(
        `Render status/result check failed (consecutive: ${consecutiveFailures}), retrying...`,
        err,
      )
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, intervalMs)
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            reject(new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      })
      continue
    }

    if (job.status === 'completed') {
      let resultError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await getRenderResult(jobId)
        } catch (err) {
          resultError = err
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      throw resultError instanceof Error
        ? resultError
        : new Error('Failed to download render result')
    }
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Render failed')
    }
    if (job.status === 'cancelled') {
      throw new DOMException('Render cancelled', 'AbortError')
    }

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, intervalMs)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    })
  }
}

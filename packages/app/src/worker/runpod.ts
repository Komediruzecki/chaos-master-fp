/**
 * RunPod serverless client for GPU render jobs (async queue mode only).
 *
 * Job flow: POST /v2/{endpoint}/run with { input } -> { id }; poll
 * GET /v2/{endpoint}/status/{id}; cancel via POST /v2/{endpoint}/cancel/{id}.
 * The handler (workers/render-worker/handler.py) uploads the finished PNG to
 * R2 and returns its key in `output.imageKey`. Handler failures surface as
 * status FAILED with the message in the TOP-LEVEL `error` field (the runpod
 * SDK fails any job whose handler returns { error }).
 *
 * Traceability contract: every mapped status keeps the raw payload (trimmed)
 * plus workerId/delay/execution timings so a failed job can be diagnosed from
 * the D1 row alone — no RunPod console spelunking required.
 */

const DEFAULT_BASE_URL = 'https://api.runpod.ai/v2'
const SUBMIT_TIMEOUT_MS = 30_000
// Status polls hang on half-open sockets without an explicit deadline (the
// mercurypitch "stuck on Waiting forever" bug) — keep it short; polls repeat.
const STATUS_TIMEOUT_MS = 15_000
const CANCEL_TIMEOUT_MS = 10_000
/** Cap for the raw payload snapshot persisted next to a job. */
const RAW_SNAPSHOT_MAX_CHARS = 2_000

export interface RunpodConfig {
  apiKey: string
  endpointId: string
  baseUrl?: string
}

export interface RenderJobInput {
  /** Our D1 render_jobs id — the handler derives the R2 key from it
   *  (`renders/<jobId>.png`), so status/result never need a URL exchange. */
  jobId: string
  flameJson: string
  width: number
  height: number
  quality: number
  seed: string
  /** Which server renderer the handler should run: the Deno CLI, or the app's
   *  own bundle in headless Chrome. Chrome has no per-allocation buffer
   *  ceiling, so it is the only path that reaches 4K/8K. */
  engine?: 'deno' | 'chrome'
}

export type RunpodJobPhase = 'queued' | 'running' | 'completed' | 'failed'

export interface RunpodJobStatus {
  phase: RunpodJobPhase
  /** RunPod's raw status string, for logs. */
  raw: string
  /** True while the job sits in the queue (cancel is refundable here). */
  inQueue: boolean
  imageKey?: string
  error?: string
  timings?: Record<string, number>
  /** RunPod-side observability: which worker ran it and for how long. */
  workerId?: string
  delayMs?: number
  executionMs?: number
  /** Engine the handler ACTUALLY used, as reported back by it. Compared
   *  against the requested engine so a mis-served job is visible rather than
   *  quietly attributed to the wrong renderer. */
  engine?: string
  /** Trimmed raw payload — persisted so failures are diagnosable from D1. */
  rawPayload: string
}

/** RunPod forgets job state ~30 min after completion; a 404 on status means
 *  expired (or never-existed), which callers treat differently from a
 *  transient network/5xx failure. */
export class RunpodJobExpiredError extends Error {
  constructor(jobId: string) {
    super(`RunPod job ${jobId} not found (expired or unknown)`)
    this.name = 'RunpodJobExpiredError'
  }
}

type FetchLike = typeof fetch

function headers(config: RunpodConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }
}

function baseUrl(config: RunpodConfig): string {
  return `${config.baseUrl ?? DEFAULT_BASE_URL}/${config.endpointId}`
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Submit a render job; returns the RunPod job id. Throws with the response
 *  body excerpt on non-2xx so submit failures are self-explanatory. */
export async function submitRunpodJob(
  config: RunpodConfig,
  input: RenderJobInput,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl(config)}/run`,
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ input }),
    },
    SUBMIT_TIMEOUT_MS,
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `RunPod submit failed (${res.status}): ${body.slice(0, 300)}`,
    )
  }
  const data = (await res.json()) as { id?: string }
  if (!data.id) {
    throw new Error('RunPod submit returned no job id')
  }
  return data.id
}

interface RunpodStatusPayload {
  status?: string
  // Handler failures put the message here (top-level), platform errors too.
  error?: string
  output?: {
    imageKey?: string
    error?: string
    timings?: Record<string, number>
    engine?: string
  }
  workerId?: string
  delayTime?: number
  executionTime?: number
}

/** Map a RunPod status payload onto our job phases. Pure — unit-tested. */
export function mapRunpodStatus(data: RunpodStatusPayload): RunpodJobStatus {
  const raw = data.status ?? 'UNKNOWN'
  const output = data.output
  const errorText = output?.error ?? data.error
  const common = {
    raw,
    workerId: data.workerId,
    delayMs: data.delayTime,
    executionMs: data.executionTime,
    // Present on both success and failure outputs — a failed job still needs to
    // say which renderer produced the failure.
    engine: output?.engine,
    rawPayload: JSON.stringify(data).slice(0, RAW_SNAPSHOT_MAX_CHARS),
  }

  if (raw === 'COMPLETED') {
    if (errorText || !output?.imageKey) {
      return {
        ...common,
        phase: 'failed',
        inQueue: false,
        error: errorText ?? 'Render produced no image',
      }
    }
    return {
      ...common,
      phase: 'completed',
      inQueue: false,
      imageKey: output.imageKey,
      timings: output.timings,
    }
  }
  if (raw === 'FAILED' || raw === 'CANCELLED' || raw === 'TIMED_OUT') {
    return {
      ...common,
      phase: 'failed',
      inQueue: false,
      error: errorText ?? `RunPod job ${raw.toLowerCase()}`,
    }
  }
  return {
    ...common,
    phase: raw === 'IN_QUEUE' ? 'queued' : 'running',
    inQueue: raw === 'IN_QUEUE',
  }
}

/** Fetch and map a job's status. Throws RunpodJobExpiredError on 404 and a
 *  plain Error on transport/5xx problems — callers must treat the two
 *  differently (expired -> reconcile via R2; transient -> keep state). */
export async function fetchRunpodStatus(
  config: RunpodConfig,
  jobId: string,
  fetchImpl: FetchLike = fetch,
): Promise<RunpodJobStatus> {
  const res = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl(config)}/status/${jobId}`,
    { headers: headers(config) },
    STATUS_TIMEOUT_MS,
  )
  if (res.status === 404) {
    throw new RunpodJobExpiredError(jobId)
  }
  if (!res.ok) {
    throw new Error(`RunPod status failed (${res.status})`)
  }
  return mapRunpodStatus((await res.json()) as RunpodStatusPayload)
}

/** Best-effort cancel — never throws; a cancel that races completion is fine
 *  (the status poll reconciles the truth). Returns whether RunPod accepted. */
export async function cancelRunpodJob(
  config: RunpodConfig,
  jobId: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl(config)}/cancel/${jobId}`,
      { method: 'POST', headers: headers(config) },
      CANCEL_TIMEOUT_MS,
    )
    return res.ok
  } catch {
    return false
  }
}

export function runpodConfigured(env: {
  RUNPOD_API_KEY?: string
  RUNPOD_ENDPOINT_ID?: string
  RUNPOD_BASE_URL?: string
}): RunpodConfig | null {
  if (!env.RUNPOD_API_KEY || !env.RUNPOD_ENDPOINT_ID) return null
  return {
    apiKey: env.RUNPOD_API_KEY,
    endpointId: env.RUNPOD_ENDPOINT_ID,
    baseUrl: env.RUNPOD_BASE_URL,
  }
}

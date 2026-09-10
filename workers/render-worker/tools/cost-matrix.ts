/**
 * Render cost matrix — measures real GPU seconds per (resolution x quality
 * preset) on the RunPod serverless endpoint, for credit pricing analysis.
 *
 * Usage (from workers/render-worker):
 *   RUNPOD_API_KEY=... RUNPOD_ENDPOINT_ID=... \
 *   deno run --allow-net --allow-env --allow-read --sloppy-imports tools/cost-matrix.ts
 *
 * Optional env:
 *   RUNPOD_GPU_USD_PER_HR   dollar rate for the $ column (default 0.69, 4090 community rate)
 *   MATRIX_RESOLUTIONS      comma list of widths, 16:9 heights derived (default 1280,1920,2560,3840)
 *   MATRIX_PRESETS          comma list of low,mid,high,ultra (default all)
 *   MATRIX_TIMEOUT_SECS     per-job wait (default 360)
 *
 * Jobs run SEQUENTIALLY (deliberate: workersMax may be 1 and queueing would
 * pollute delay numbers). The first job pays the cold start; a warm-up render
 * runs first and is excluded from the table. Results print as a markdown
 * table plus CSV lines for spreadsheets.
 */

import { example1 } from '../../../packages/app/src/flame/examples/example1.ts'

// Client quality presets (packages/app/src/components/Quality/QualityPresets.tsx
// + defaults): keep in sync — the whole point is server parity with what the
// user sees in-app for low/mid/high/ultra.
const PRESETS: Record<string, number> = {
  low: 0.75,
  mid: 0.85,
  high: 0.95,
  ultra: 0.995,
}

const API_KEY = Deno.env.get('RUNPOD_API_KEY')
const ENDPOINT = Deno.env.get('RUNPOD_ENDPOINT_ID')
if (!API_KEY || !ENDPOINT) {
  console.error('RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are required')
  Deno.exit(1)
}
const BASE = `https://api.runpod.ai/v2/${ENDPOINT}`
const USD_PER_HR = Number(Deno.env.get('RUNPOD_GPU_USD_PER_HR') ?? '0.69')
const TIMEOUT_SECS = Number(Deno.env.get('MATRIX_TIMEOUT_SECS') ?? '360')
const RESOLUTIONS = (
  Deno.env.get('MATRIX_RESOLUTIONS') ?? '1280,1920,2560,3840'
)
  .split(',')
  .map((w) => parseInt(w.trim(), 10))
const PRESET_KEYS = (Deno.env.get('MATRIX_PRESETS') ?? 'low,mid,high,ultra')
  .split(',')
  .map((p) => p.trim())
  .filter((p) => p in PRESETS)

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

/**
 * fetch with retries. A matrix run makes hundreds of calls over many minutes;
 * a single transient TCP reset ("connection reset by peer") must not kill the
 * whole run, so every network error is retried with backoff before giving up.
 */
async function fetchRetry(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      lastErr = err
      const wait = 1000 * 2 ** i
      console.error(
        `  network error (${err instanceof Error ? err.message : String(err)}), retrying in ${wait / 1000}s...`,
      )
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

/**
 * Fail fast on an unusable key. RunPod issues management-scoped keys (fine for
 * rest.runpod.io / the MCP) that CANNOT invoke serverless endpoints — those
 * 403 here. Without this check the matrix would run every cell and report a
 * wall of identical failures.
 */
async function preflight(): Promise<void> {
  let res: Response
  try {
    res = await fetchRetry(`${BASE}/health`, { headers: HEADERS })
  } catch (err) {
    console.error(
      `Cannot reach ${BASE}: ${err instanceof Error ? err.message : String(err)}`,
    )
    Deno.exit(1)
  }
  if (res.status === 401 || res.status === 403) {
    console.error(
      `Endpoint ${ENDPOINT} rejected this API key (${res.status}).\n` +
        'A management-scoped key (the kind used for the RunPod MCP) can read\n' +
        'rest.runpod.io but cannot invoke serverless endpoints. Use the same\n' +
        'key you set as the Cloudflare RUNPOD_API_KEY secret, or create a key\n' +
        'with serverless access in the RunPod console.',
    )
    Deno.exit(1)
  }
  if (!res.ok) {
    console.error(
      `Endpoint health check failed: ${res.status} ${await res.text()}`,
    )
    Deno.exit(1)
  }
  console.error(`Endpoint reachable: ${(await res.text()).slice(0, 160)}`)
}

/** Same formula as the renderer (render.ts computeQualityPointLimit). */
function estimatePoints(width: number, height: number, q: number): number {
  const bucketProbabilityInv = (height * height) / 4
  const rawLimit = bucketProbabilityInv / (q - 1) ** 2
  const maxPointsPerBucket = Math.floor(0xffffffff / 1000)
  const safeCap = Math.floor((maxPointsPerBucket * width * height) / 25)
  return Math.min(rawLimit, safeCap)
}

interface CellResult {
  preset: string
  q: number
  width: number
  height: number
  points: number
  delayMs: number | null
  execMs: number | null
  usd: number | null
  status: string
  error?: string
}

const flameJson = JSON.stringify(example1)

async function runJob(
  label: string,
  width: number,
  height: number,
  q: number,
): Promise<{
  status: string
  delayMs: number | null
  execMs: number | null
  error?: string
}> {
  const submit = await fetchRetry(`${BASE}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      input: {
        jobId: `cost-matrix-${label}-${crypto.randomUUID().slice(0, 8)}`,
        flameJson,
        width,
        height,
        quality: q,
        seed: 'cost-matrix',
      },
    }),
  })
  if (!submit.ok) {
    return {
      status: 'SUBMIT_FAILED',
      delayMs: null,
      execMs: null,
      error: `${submit.status} ${await submit.text()}`,
    }
  }
  const { id } = (await submit.json()) as { id: string }

  const deadline = Date.now() + TIMEOUT_SECS * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const res = await fetchRetry(`${BASE}/status/${id}`, { headers: HEADERS })
    if (!res.ok) continue
    const data = (await res.json()) as {
      status?: string
      error?: string
      delayTime?: number
      executionTime?: number
      output?: { error?: string }
    }
    const s = data.status ?? 'UNKNOWN'
    if (
      s === 'COMPLETED' ||
      s === 'FAILED' ||
      s === 'CANCELLED' ||
      s === 'TIMED_OUT'
    ) {
      return {
        status: s,
        delayMs: data.delayTime ?? null,
        execMs: data.executionTime ?? null,
        error: data.output?.error ?? data.error,
      }
    }
  }
  await fetchRetry(`${BASE}/cancel/${id}`, {
    method: 'POST',
    headers: HEADERS,
  }).catch(() => {})
  return { status: 'CLIENT_TIMEOUT', delayMs: null, execMs: null }
}

console.error(
  `Endpoint ${ENDPOINT} | $${USD_PER_HR}/hr | ${RESOLUTIONS.join('/')} x ${PRESET_KEYS.join('/')}`,
)
await preflight()
console.error('Warm-up render (excluded from results)...')
const warm = await runJob('warmup', 1280, 720, 0.75)
console.error(
  `  warm-up: ${warm.status} exec=${warm.execMs ?? '-'}ms delay=${warm.delayMs ?? '-'}ms\n`,
)

const results: CellResult[] = []
for (const width of RESOLUTIONS) {
  const height = Math.round((width * 9) / 16)
  for (const preset of PRESET_KEYS) {
    const q = PRESETS[preset]!
    const points = estimatePoints(width, height, q)
    console.error(
      `running ${width}x${height} ${preset} (q=${q}, ~${(points / 1e6).toFixed(1)}M pts)...`,
    )
    const r = await runJob(`${width}-${preset}`, width, height, q).catch(
      (err: unknown): Awaited<ReturnType<typeof runJob>> => ({
        status: 'CLIENT_ERROR',
        delayMs: null,
        execMs: null,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    const usd = r.execMs != null ? (USD_PER_HR * r.execMs) / 3_600_000 : null
    results.push({ preset, q, width, height, points, ...r, usd })
    console.error(
      `  -> ${r.status} exec=${r.execMs ?? '-'}ms delay=${r.delayMs ?? '-'}ms${r.error ? ` error=${r.error}` : ''}`,
    )
  }
}

console.log(
  '\n| Resolution | Preset | q | Est. points | Exec s | Delay s | $ / render |',
)
console.log('|---|---|---|---|---|---|---|')
for (const r of results) {
  console.log(
    `| ${r.width}x${r.height} | ${r.preset} | ${r.q} | ${(r.points / 1e6).toFixed(1)}M | ` +
      `${r.execMs != null ? (r.execMs / 1000).toFixed(1) : r.status} | ` +
      `${r.delayMs != null ? (r.delayMs / 1000).toFixed(1) : '-'} | ` +
      `${r.usd != null ? '$' + r.usd.toFixed(4) : '-'} |`,
  )
}

console.log('\ncsv:resolution,preset,q,points,execMs,delayMs,usd,status')
for (const r of results) {
  console.log(
    `csv:${r.width}x${r.height},${r.preset},${r.q},${Math.round(r.points)},${r.execMs ?? ''},${r.delayMs ?? ''},${r.usd?.toFixed(6) ?? ''},${r.status}`,
  )
}

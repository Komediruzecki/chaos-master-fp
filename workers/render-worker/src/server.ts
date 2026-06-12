/**
 * Deno render-worker: WebGPU-free CPU IFS rendering server.
 *
 * Endpoints:
 *   POST /render  — Submit render job (flameJson + options), returns jobId
 *   GET  /render/:id — Get job status + progress
 *   GET  /render/:id/result — Download rendered PNG
 *   GET  /health — Health check
 */

import { encodePNG } from './png.ts'
import { renderFlame } from './render.ts'
import { hashString } from './rng.ts'
import { tonemapAndColorGrade } from './tonemap.ts'

// In-memory job store — MVP only; jobs are lost on restart.
// TODO: persist to SQLite or D1 for production use.

interface RenderJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  flameJson: string
  options: { width: number; height: number; quality: number }
  result?: Uint8Array
  error?: string
  renderTimeMs?: number
  createdAt: number
}

const jobs = new Map<string, RenderJob>()

// ---- helpers ----

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

// ---- render execution ----

async function executeJob(job: RenderJob): Promise<void> {
  job.status = 'running'
  const startTime = Date.now()

  try {
    const flame = JSON.parse(job.flameJson)
    const seed = hashString(job.id).toString(16)

    const result = renderFlame(
      flame,
      {
        width: job.options.width,
        height: job.options.height,
        quality: job.options.quality,
        seed,
        skipIters: 20,
      },
      (progress: number) => {
        job.progress = progress
      },
    )

    const pixels = tonemapAndColorGrade(
      result.buckets,
      result.width,
      result.height,
      result.totalPoints,
      flame.palette ? { entries: flame.palette.entries } : undefined,
      flame.brightness,
      flame.gamma,
      flame.vibrancy,
    )

    const png = await encodePNG(pixels, result.width, result.height)

    job.result = png
    job.status = 'completed'
    job.progress = 1
    job.renderTimeMs = Date.now() - startTime
  } catch (e) {
    job.status = 'failed'
    job.error = e instanceof Error ? e.message : String(e)
  }
}

// ---- request handlers ----

async function handleSubmitRender(req: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON')
  }

  const flameJson = body.flameJson
  const options = body.options as
    | { width?: number; height?: number; quality?: number }
    | undefined

  if (!flameJson || typeof flameJson !== 'string') {
    return error('Missing flameJson (string)')
  }
  if (!options?.width || !options.height) {
    return error('Missing options.width and options.height')
  }

  const MAX_WIDTH = 7680
  const MAX_HEIGHT = 4320
  if (
    options.width < 16 || options.width > MAX_WIDTH ||
    options.height < 16 || options.height > MAX_HEIGHT
  ) {
    return error(
      `Resolution must be 16×16 to ${MAX_WIDTH}×${MAX_HEIGHT} pixels`,
    )
  }

  const quality = options.quality ?? 0.3
  if (quality < 0.01 || quality > 1) {
    return error('Quality must be between 0.01 and 1')
  }

  // Validate flame JSON parses
  try {
    JSON.parse(flameJson)
  } catch {
    return error('Invalid flameJson: must be valid JSON')
  }

  const jobId = globalThis.crypto.randomUUID()
  const job: RenderJob = {
    id: jobId,
    status: 'queued',
    progress: 0,
    flameJson,
    options: {
      width: options.width,
      height: options.height,
      quality,
    },
    createdAt: Date.now(),
  }

  jobs.set(jobId, job)

  // Execute asynchronously (don't await)
  void executeJob(job)

  return json({ jobId, status: 'queued' }, 201)
}

function handleGetJobStatus(_req: Request, jobId: string): Response {
  const job = jobs.get(jobId)
  if (!job) return error('Job not found', 404)

  return json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    renderTimeMs: job.renderTimeMs,
  })
}

function handleGetJobResult(_req: Request, jobId: string): Response {
  const job = jobs.get(jobId)
  if (!job) return error('Job not found', 404)
  if (job.status === 'queued' || job.status === 'running') {
    return error('Job is still processing', 202)
  }
  if (job.status === 'failed') {
    return error(job.error ?? 'Render failed', 500)
  }
  if (!job.result) {
    return error('No result available', 500)
  }

  return new Response(job.result as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=604800',
    },
  })
}

// ---- router ----

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (path === '/health' && req.method === 'GET') {
    return json({ status: 'ok' })
  }

  if (path === '/render' && req.method === 'POST') {
    return handleSubmitRender(req)
  }

  if (path.startsWith('/render/') && req.method === 'GET') {
    const parts = path.slice('/render/'.length).split('/')
    const jobId = parts[0]!
    if (parts.length === 2 && parts[1] === 'result') {
      return handleGetJobResult(req, jobId)
    }
    return handleGetJobStatus(req, jobId)
  }

  return error('Not Found', 404)
}

// ---- start server ----

const port = parseInt(Deno.env.get('PORT') ?? '8787')
console.info(`render-worker listening on http://localhost:${port}`)
Deno.serve({ port }, handleRequest)

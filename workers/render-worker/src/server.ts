/**
 * Deno render-worker: GPU-accelerated IFS flame rendering server.
 *
 * Endpoints:
 *   POST /render     — Submit render job (flameJson + options), returns jobId
 *   GET  /render/:id — Get job status + progress
 *   GET  /render/:id/result — Download rendered PNG
 *   GET  /health     — Health check
 */

import { encodePNG } from './png.ts'
import { renderFlameGPU } from './render.ts'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

// In-memory job store — MVP only; jobs are lost on restart.

interface RenderJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  flameJson: string
  options: {
    width: number
    height: number
    quality: number
    backend?: 'gpu' | 'cpu'
  }
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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

// ---- render execution ----

async function executeJob(job: RenderJob): Promise<void> {
  job.status = 'running'
  const startTime = Date.now()

  const tempFlameFile = await Deno.makeTempFile({
    prefix: 'flame_job_',
    suffix: '.json',
  })
  const tempOutputFile = await Deno.makeTempFile({
    prefix: 'flame_out_',
    suffix: '.png',
  })

  try {
    await Deno.writeTextFile(tempFlameFile, job.flameJson)

    let attempts = 0
    let success = false
    let currentBackend = job.options.backend ?? 'gpu'
    let lastErrorMsg = ''

    while (attempts < 2 && !success) {
      attempts++
      const env: Record<string, string> = {
        ...Deno.env.toObject(),
      }

      if (currentBackend === 'cpu') {
        const lvpPath = '/usr/share/vulkan/icd.d/lvp_icd.x86_64.json'
        try {
          if (Deno.statSync(lvpPath).isFile) {
            env['VK_ICD_FILENAMES'] = lvpPath
            console.log(
              `[render-worker] Job ${job.id} (Attempt ${attempts}): Forcing software Vulkan via ${lvpPath}`,
            )
          }
        } catch {}
      } else {
        delete env['VK_ICD_FILENAMES']
        console.log(
          `[render-worker] Job ${job.id} (Attempt ${attempts}): Running on hardware GPU`,
        )
      }

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '--unstable-webgpu',
          '--allow-read',
          '--allow-write',
          '--allow-env',
          '--import-map=deno.json',
          '--sloppy-imports',
          'src/cli.ts',
          '--flame',
          tempFlameFile,
          '--out',
          tempOutputFile,
          '--width',
          String(job.options.width),
          '--height',
          String(job.options.height),
          '--quality',
          String(job.options.quality),
        ],
        env,
        stdout: 'inherit',
        stderr: 'piped',
      })

      const child = command.spawn()

      // Read progress and errors from stderr
      const reader = child.stderr.getReader()
      const decoder = new TextDecoder()
      let stderrBuffer = ''
      let subprocessError = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        stderrBuffer += chunk

        const lines = stderrBuffer.split('\n')
        stderrBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('PROGRESS:')) {
            const progress = parseFloat(line.slice('PROGRESS:'.length))
            if (!isNaN(progress)) {
              job.progress = progress * 0.95
            }
          } else if (line.startsWith('ERROR:')) {
            subprocessError = line.slice('ERROR:'.length).trim()
          } else if (line.trim() !== '') {
            lastErrorMsg = line.trim()
          }
        }
      }

      const status = await child.status
      let isSuccess = status.code === 0
      if (!isSuccess && lastErrorMsg === 'SUCCESS') {
        try {
          const stats = Deno.statSync(tempOutputFile)
          if (stats.isFile && stats.size > 0) {
            isSuccess = true
            console.log(
              `[render-worker] Job ${job.id} succeeded despite non-zero exit code (Segmentation fault on exit during Vulkan teardown)`,
            )
          }
        } catch {}
      }

      if (isSuccess) {
        job.result = await Deno.readFile(tempOutputFile)
        job.status = 'completed'
        job.progress = 1
        job.renderTimeMs = Date.now() - startTime
        success = true
        console.log(
          `[render-worker] Job ${job.id} succeeded in ${job.renderTimeMs}ms (Backend: ${currentBackend})`,
        )
      } else {
        const errDetail =
          subprocessError ||
          lastErrorMsg ||
          'Subprocess exited with non-zero code'
        console.warn(
          `[render-worker] Job ${job.id} attempt ${attempts} failed: ${errDetail}`,
        )

        if (
          currentBackend === 'gpu' &&
          (errDetail.toLowerCase().includes('oom') ||
            errDetail.toLowerCase().includes('memory') ||
            errDetail.toLowerCase().includes('allocation'))
        ) {
          console.warn(
            `[render-worker] Job ${job.id}: Out of memory on GPU. Retrying with software Vulkan backend...`,
          )
          currentBackend = 'cpu'
        } else {
          throw new Error(errDetail)
        }
      }
    }
  } catch (e) {
    job.status = 'failed'
    job.error = e instanceof Error ? e.message : String(e)
    console.error(`[render-worker] Job ${job.id} failed permanently:`, e)
  } finally {
    try {
      await Deno.remove(tempFlameFile)
    } catch {}
    try {
      await Deno.remove(tempOutputFile)
    } catch {}
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
    | { width?: number; height?: number; quality?: number; backend?: string }
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
    options.width < 16 ||
    options.width > MAX_WIDTH ||
    options.height < 16 ||
    options.height > MAX_HEIGHT
  ) {
    return error(
      `Resolution must be 16×16 to ${MAX_WIDTH}×${MAX_HEIGHT} pixels`,
    )
  }

  const quality = options.quality ?? 0.3
  if (quality < 0.01 || quality > 1) {
    return error('Quality must be between 0.01 and 1')
  }

  const backend = options.backend ?? 'gpu'
  if (backend !== 'gpu' && backend !== 'cpu') {
    return error('options.backend must be either "gpu" or "cpu"')
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
      backend: backend as 'gpu' | 'cpu',
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

// Shared-secret gate for hosted pods: when RENDER_WORKER_TOKEN is set, every
// request (except OPTIONS) must carry it as a Bearer token. Unset = open, for
// local docker testing only. The RunPod serverless path doesn't use this HTTP
// server at all (handler.py invokes the CLI directly).
const workerToken = Deno.env.get('RENDER_WORKER_TOKEN')

function isAuthorized(req: Request): boolean {
  if (!workerToken) return true
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return false
  const provided = auth.slice(7)
  if (provided.length !== workerToken.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ workerToken.charCodeAt(i)
  }
  return diff === 0
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (!isAuthorized(req)) {
    return error('Unauthorized', 401)
  }

  if (path === '/health' && req.method === 'GET') {
    let adapterInfo = null
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        adapterInfo = {
          description: adapter.info.description,
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
        }
      }
    } catch (e) {
      adapterInfo = { error: e instanceof Error ? e.message : String(e) }
    }
    return json({ status: 'ok', adapter: adapterInfo })
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
console.info(`render-worker (GPU) listening on http://localhost:${port}`)
Deno.serve({ port }, handleRequest)

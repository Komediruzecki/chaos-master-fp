import { describe, expect, it, vi } from 'vitest'
import { decideJobTransition, MAX_RENDER_PIXELS, resolveRenderEngine, } from './index'
import { cancelRunpodJob, fetchRunpodStatus, mapRunpodStatus, runpodConfigured, RunpodJobExpiredError, submitRunpodJob, } from './runpod'
import type { RunpodConfig } from './runpod'

const CONFIG: RunpodConfig = { apiKey: 'k', endpointId: 'ep' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

// ── mapRunpodStatus ─────────────────────────────────────────────

describe('mapRunpodStatus', () => {
  it('maps COMPLETED with an imageKey to completed', () => {
    const s = mapRunpodStatus({
      status: 'COMPLETED',
      workerId: 'w1',
      delayTime: 1200,
      executionTime: 3400,
      output: { imageKey: 'renders/j1.png', timings: { totalMs: 1234 } },
    })
    expect(s.phase).toBe('completed')
    expect(s.imageKey).toBe('renders/j1.png')
    expect(s.timings?.totalMs).toBe(1234)
    expect(s.workerId).toBe('w1')
    expect(s.delayMs).toBe(1200)
    expect(s.executionMs).toBe(3400)
    expect(s.rawPayload).toContain('renders/j1.png')
  })

  it('maps COMPLETED with output.error to failed (handler error convention)', () => {
    const s = mapRunpodStatus({
      status: 'COMPLETED',
      output: { error: 'render timed out after 280s' },
    })
    expect(s.phase).toBe('failed')
    expect(s.error).toContain('timed out')
  })

  it('maps COMPLETED with no output to failed, never silently completed', () => {
    expect(mapRunpodStatus({ status: 'COMPLETED' }).phase).toBe('failed')
  })

  it('fails a COMPLETED job whose error rides next to an imageKey', () => {
    const s = mapRunpodStatus({
      status: 'COMPLETED',
      output: { imageKey: 'renders/x.png', error: 'partial upload' },
    })
    expect(s.phase).toBe('failed')
    expect(s.error).toBe('partial upload')
  })

  it('maps terminal RunPod errors to failed with a readable message', () => {
    for (const status of ['FAILED', 'CANCELLED', 'TIMED_OUT']) {
      const s = mapRunpodStatus({ status })
      expect(s.phase).toBe('failed')
      expect(s.error).toContain(status.toLowerCase())
    }
  })

  it('surfaces the top-level error field of a FAILED job (SDK handler failures)', () => {
    const s = mapRunpodStatus({ status: 'FAILED', error: "'S3_ENDPOINT_URL'" })
    expect(s.phase).toBe('failed')
    expect(s.error).toBe("'S3_ENDPOINT_URL'")
  })

  it('prefers output.error over the top-level error when both exist', () => {
    const s = mapRunpodStatus({
      status: 'FAILED',
      error: 'generic platform message',
      output: { error: 'stage=upload: 403 from R2' },
    })
    expect(s.error).toBe('stage=upload: 403 from R2')
  })

  it('maps queue/progress states with the refund-relevant inQueue flag', () => {
    const queued = mapRunpodStatus({ status: 'IN_QUEUE' })
    expect(queued.phase).toBe('queued')
    expect(queued.inQueue).toBe(true)

    const running = mapRunpodStatus({ status: 'IN_PROGRESS' })
    expect(running.phase).toBe('running')
    expect(running.inQueue).toBe(false)
  })

  it('treats unknown states as still running (no premature refund)', () => {
    expect(mapRunpodStatus({ status: 'SOMETHING_NEW' }).phase).toBe('running')
    expect(mapRunpodStatus({}).phase).toBe('running')
  })

  it('caps the persisted raw payload snapshot', () => {
    const s = mapRunpodStatus({
      status: 'FAILED',
      error: 'x'.repeat(10_000),
    })
    expect(s.rawPayload.length).toBeLessThanOrEqual(2_000)
  })
})

// ── HTTP client behaviors ───────────────────────────────────────

describe('submitRunpodJob', () => {
  const INPUT = {
    jobId: 'j1',
    flameJson: '{}',
    width: 640,
    height: 480,
    quality: 0.5,
    seed: 'abc',
  }

  it('POSTs the input envelope and returns the job id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 'rp-1' }))
    const id = await submitRunpodJob(CONFIG, INPUT, fetchMock)
    expect(id).toBe('rp-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.runpod.ai/v2/ep/run')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer k',
    )
    expect(JSON.parse(init.body as string)).toEqual({ input: INPUT })
  })

  it('throws with the response body excerpt on non-2xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('quota exceeded', { status: 429 }))
    await expect(submitRunpodJob(CONFIG, INPUT, fetchMock)).rejects.toThrow(
      /submit failed \(429\): quota exceeded/,
    )
  })

  it('throws when the accepted response carries no job id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    await expect(submitRunpodJob(CONFIG, INPUT, fetchMock)).rejects.toThrow(
      /no job id/,
    )
  })

  it('honors a custom base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'x' }))
    await submitRunpodJob(
      { ...CONFIG, baseUrl: 'https://mock.example/v2' },
      INPUT,
      fetchMock,
    )
    expect(fetchMock.mock.calls[0]![0]).toBe('https://mock.example/v2/ep/run')
  })
})

describe('fetchRunpodStatus', () => {
  it('maps a live payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: 'IN_PROGRESS', workerId: 'w9' }),
      )
    const s = await fetchRunpodStatus(CONFIG, 'rp-1', fetchMock)
    expect(s.phase).toBe('running')
    expect(s.workerId).toBe('w9')
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.runpod.ai/v2/ep/status/rp-1',
    )
  })

  it('throws RunpodJobExpiredError on 404 (job forgotten)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 404 }))
    await expect(
      fetchRunpodStatus(CONFIG, 'rp-old', fetchMock),
    ).rejects.toBeInstanceOf(RunpodJobExpiredError)
  })

  it('throws a plain error on 5xx (transient, not expiry)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 502 }))
    const err = await fetchRunpodStatus(CONFIG, 'rp-1', fetchMock).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RunpodJobExpiredError)
  })
})

describe('cancelRunpodJob', () => {
  it('returns true when RunPod accepts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await cancelRunpodJob(CONFIG, 'rp-1', fetchMock)).toBe(true)
  })

  it('never throws — network failures report false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    expect(await cancelRunpodJob(CONFIG, 'rp-1', fetchMock)).toBe(false)
  })
})

describe('runpodConfigured', () => {
  it('requires both the API key and the endpoint id', () => {
    expect(runpodConfigured({})).toBeNull()
    expect(runpodConfigured({ RUNPOD_API_KEY: 'k' })).toBeNull()
    expect(runpodConfigured({ RUNPOD_ENDPOINT_ID: 'e' })).toBeNull()
    expect(
      runpodConfigured({ RUNPOD_API_KEY: 'k', RUNPOD_ENDPOINT_ID: 'e' }),
    ).toEqual({ apiKey: 'k', endpointId: 'e', baseUrl: undefined })
  })
})

// ── decideJobTransition (persistence/refund decisions) ──────────

describe('decideJobTransition', () => {
  const job = {
    id: 'job-1',
    status: 'running',
    progress: 0,
    resultUrl: null,
    renderTimeMs: null,
  }

  it('completes with the reported imageKey and timings', () => {
    const t = decideJobTransition(
      job,
      mapRunpodStatus({
        status: 'COMPLETED',
        executionTime: 9000,
        output: { imageKey: 'renders/job-1.png', timings: { totalMs: 8000 } },
      }),
    )
    expect(t.status).toBe('completed')
    expect(t.progress).toBe(1)
    expect(t.resultUrl).toBe('renders/job-1.png')
    expect(t.renderTimeMs).toBe(8000)
    expect(t.shouldRefund).toBe(false)
  })

  it('falls back to the derived R2 key and executionTime when output is thin', () => {
    const t = decideJobTransition(
      job,
      mapRunpodStatus({
        status: 'COMPLETED',
        executionTime: 9000,
        output: { imageKey: 'renders/job-1.png' },
      }),
    )
    expect(t.renderTimeMs).toBe(9000)
  })

  it('fails with a refund and keeps the diagnostic snapshot', () => {
    const t = decideJobTransition(
      job,
      mapRunpodStatus({ status: 'FAILED', error: 'stage=render: boom' }),
    )
    expect(t.status).toBe('failed')
    expect(t.error).toBe('stage=render: boom')
    expect(t.shouldRefund).toBe(true)
    expect(t.runpodStatusJson).toContain('stage=render: boom')
  })

  it('passes queue/progress states through without refunds', () => {
    for (const raw of ['IN_QUEUE', 'IN_PROGRESS']) {
      const t = decideJobTransition(job, mapRunpodStatus({ status: raw }))
      expect(t.shouldRefund).toBe(false)
      expect(['queued', 'running']).toContain(t.status)
    }
  })

  it('never regresses a terminal job (late duplicate poll)', () => {
    const done = {
      ...job,
      status: 'completed',
      progress: 1,
      resultUrl: 'renders/job-1.png',
    }
    const t = decideJobTransition(
      done,
      mapRunpodStatus({ status: 'FAILED', error: 'late duplicate' }),
    )
    expect(t.status).toBe('completed')
    expect(t.resultUrl).toBe('renders/job-1.png')
    expect(t.shouldRefund).toBe(false)
    expect(t.runpodStatusJson).toBeNull()
  })

  it('never re-refunds an already-failed job', () => {
    const failed = { ...job, status: 'failed' }
    const t = decideJobTransition(
      failed,
      mapRunpodStatus({ status: 'FAILED', error: 'again' }),
    )
    expect(t.shouldRefund).toBe(false)
  })
})

// ── render engine selection ─────────────────────────────────────

describe('resolveRenderEngine', () => {
  it('defaults to chrome where the endpoint ships it', () => {
    expect(resolveRenderEngine(undefined, true)).toEqual({ engine: 'chrome' })
  })

  it('falls back to deno where the endpoint does not', () => {
    // An unnamed engine is a default, not a request, so this is not the silent
    // downgrade the rejection below exists to prevent.
    expect(resolveRenderEngine(undefined, false)).toEqual({ engine: 'deno' })
  })

  it('serves chrome only where the endpoint ships it', () => {
    expect(resolveRenderEngine('chrome', true)).toEqual({ engine: 'chrome' })
    const denied = resolveRenderEngine('chrome', false)
    expect('error' in denied && denied.error).toMatch(/not enabled/)
  })

  it('rejects an unknown engine instead of falling back', () => {
    // A silent fallback would attribute the render to the wrong engine, which
    // is exactly what the option exists to distinguish.
    const res = resolveRenderEngine('webgpu-native', true)
    expect('error' in res && res.error).toMatch(/Unknown render engine/)
  })

  it('never lets chrome availability upgrade a deno request', () => {
    expect(resolveRenderEngine('deno', true)).toEqual({ engine: 'deno' })
  })
})

describe('MAX_RENDER_PIXELS', () => {
  it('caps deno below 4K and lets chrome reach 8K', () => {
    // 4K is 8.29Mpx: deno cannot allocate its 132.7MB accumulation buffer.
    expect(3840 * 2160).toBeGreaterThan(MAX_RENDER_PIXELS.deno)
    expect(7680 * 4320).toBeLessThanOrEqual(MAX_RENDER_PIXELS.chrome)
  })

  it('still allows 1080p on deno', () => {
    expect(1920 * 1080).toBeLessThanOrEqual(MAX_RENDER_PIXELS.deno)
  })
})

describe('mapRunpodStatus engine attribution', () => {
  it('reports the engine the handler actually used on success', () => {
    const s = mapRunpodStatus({
      status: 'COMPLETED',
      output: { imageKey: 'renders/j.png', engine: 'chrome' },
    })
    expect(s.engine).toBe('chrome')
  })

  it('reports the engine on failure too — a failure needs attribution most', () => {
    const s = mapRunpodStatus({
      status: 'COMPLETED',
      output: { error: 'stage=render: no output produced', engine: 'chrome' },
    })
    expect(s.phase).toBe('failed')
    expect(s.engine).toBe('chrome')
  })
})

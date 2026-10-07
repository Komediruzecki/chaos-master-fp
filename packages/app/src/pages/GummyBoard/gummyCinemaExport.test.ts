/** Export preserves the frame grid, owns snapshots, and restores preview after failure/cancellation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportGummyCinema, gummyCinemaExportPlan } from './gummyCinemaExport'
import type { GummyCinemaController } from '@/components/GummyBoard/GummyCinemaScene'

const encoder = vi.hoisted(() => ({
  usedFallback: false,
  codec: 'avc',
  encodeFrame: vi.fn(),
  finalize: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('@/utils/videoEncoder', () => ({
  createVideoEncoder: vi.fn(() => Promise.resolve(encoder)),
}))

function fixture() {
  const bitmaps: {
    width: number
    height: number
    close: ReturnType<typeof vi.fn>
  }[] = []
  const scene = {
    info: () => ({ ready: true, displayDuration: 8, displayTime: 2.5 }),
    pause: vi.fn(),
    setCaptureSize: vi.fn(async () => {}),
    resetPaused: vi.fn(async () => {}),
    seekFrame: vi.fn(async () => {}),
    captureFrame: vi.fn(() => {
      const bitmap = {
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }
      bitmaps.push(bitmap)
      return Promise.resolve(bitmap)
    }),
  }
  const abort = new AbortController()
  return {
    scene,
    bitmaps,
    abort,
    options: {
      controller: scene as unknown as GummyCinemaController,
      settings: { resolution: 1080, fps: 60, portrait: false } as const,
      signal: abort.signal,
      onProgress: vi.fn(),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  encoder.usedFallback = false
  encoder.codec = 'avc'
  encoder.encodeFrame.mockImplementation((bitmap: ImageBitmap) => {
    bitmap.close()
    return Promise.resolve()
  })
  encoder.finalize.mockResolvedValue({
    blob: new Blob(['video']),
    mimeType: 'video/mp4',
    usedFallback: false,
  })
  vi.stubGlobal('VideoEncoder', vi.fn())
  vi.stubGlobal('VideoFrame', vi.fn())
  vi.stubGlobal('createImageBitmap', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('cinema export', () => {
  it('renders all 480 sequential frames at output resolution and restores the paused preview', async () => {
    const f = fixture()
    const result = await exportGummyCinema(f.options)
    expect(result).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 60,
      frames: 480,
      durationSeconds: 8,
    })
    expect(f.scene.setCaptureSize.mock.calls).toEqual([
      [expect.objectContaining({ width: 1920, height: 1080 })],
      [undefined],
    ])
    expect(f.scene.captureFrame.mock.calls).toEqual(
      Array.from({ length: 480 }, (_, i) => [i, 60]),
    )
    expect(encoder.encodeFrame.mock.calls.map((c) => c[1])).toEqual(
      Array.from({ length: 480 }, (_, i) => i),
    )
    expect(
      f.bitmaps.every((b) => vi.mocked(b.close).mock.calls.length === 1),
    ).toBe(true)
    expect(f.scene.seekFrame).toHaveBeenCalledWith(150, 60)
    expect(f.options.onProgress).toHaveBeenLastCalledWith(480, 480)
    expect(encoder.finalize).toHaveBeenCalledOnce()
  })

  it('rejects a real-time fallback before resizing or resetting the scene', async () => {
    encoder.usedFallback = true
    const f = fixture()
    await expect(exportGummyCinema(f.options)).rejects.toThrow(
      'cannot be exported as MP4',
    )
    expect(encoder.cancel).toHaveBeenCalledOnce()
    expect(f.scene.setCaptureSize).not.toHaveBeenCalled()
  })

  it('rejects a different codec instead of naming an unsupported export MP4', async () => {
    encoder.codec = 'vp9'
    await expect(exportGummyCinema(fixture().options)).rejects.toThrow(
      'cannot be exported as MP4',
    )
  })

  it('rejects missing WebCodecs without starting a real-time fallback', async () => {
    vi.stubGlobal('VideoEncoder', undefined)
    await expect(exportGummyCinema(fixture().options)).rejects.toThrow(
      'unavailable in this browser',
    )
    expect(encoder.encodeFrame).not.toHaveBeenCalled()
  })

  it('cancels between snapshot and encoding, closes snapshot, and restores preview', async () => {
    const f = fixture()
    f.scene.captureFrame.mockImplementationOnce(() => {
      f.abort.abort()
      const bitmap = {
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }
      f.bitmaps.push(bitmap)
      return Promise.resolve(bitmap)
    })
    await expect(exportGummyCinema(f.options)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(f.bitmaps[0]!.close).toHaveBeenCalledOnce()
    expect(encoder.encodeFrame).not.toHaveBeenCalled()
    expect(encoder.finalize).not.toHaveBeenCalled()
    expect(f.scene.setCaptureSize).toHaveBeenLastCalledWith(undefined)
    expect(f.scene.seekFrame).toHaveBeenCalledWith(150, 60)
  })

  it('restores the preview and rejects an encoder failure without producing a partial video', async () => {
    const f = fixture()
    encoder.encodeFrame.mockImplementationOnce((bitmap: ImageBitmap) => {
      bitmap.close()
      return Promise.reject(new Error('Encoder full'))
    })
    await expect(exportGummyCinema(f.options)).rejects.toThrow('Encoder full')
    expect(encoder.finalize).not.toHaveBeenCalled()
    expect(f.scene.setCaptureSize).toHaveBeenLastCalledWith(undefined)
  })

  it('closes an incorrectly sized snapshot and rejects instead of upscaling it', async () => {
    const f = fixture()
    const close = vi.fn()
    f.scene.captureFrame.mockResolvedValueOnce({
      width: 800,
      height: 450,
      close,
    })
    await expect(exportGummyCinema(f.options)).rejects.toThrow(
      'render size changed',
    )
    expect(close).toHaveBeenCalledOnce()
    expect(encoder.encodeFrame).not.toHaveBeenCalled()
  })

  it('keeps the original failure if navigation disposes the scene during restoration', async () => {
    const f = fixture()
    f.scene.captureFrame.mockRejectedValueOnce(new Error('GPU stopped'))
    f.scene.setCaptureSize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Disposed'))
    await expect(exportGummyCinema(f.options)).rejects.toThrow('GPU stopped')
  })

  it('does not start an already cancelled operation', async () => {
    const f = fixture()
    f.abort.abort()
    await expect(exportGummyCinema(f.options)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(f.scene.pause).not.toHaveBeenCalled()
  })

  it('plans portrait 4K and lower-memory 720p without changing the frame count', () => {
    expect(
      gummyCinemaExportPlan({ resolution: 2160, fps: 60, portrait: true }),
    ).toMatchObject({ width: 2160, height: 3840, bitrate: 100_000_000 })
    expect(
      gummyCinemaExportPlan({ resolution: 720, fps: 30, portrait: false }),
    ).toMatchObject({ width: 1280, height: 720, fps: 30 })
  })
})

/** Recording lifecycle tests pin final chunks, codec fallback, and resource ownership. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_CANVAS_RECORDING_MAX_SECONDS, startLiveCanvasRecording, supportsLiveCanvasRecording, } from './liveCanvasRecorder'
import type { LiveCanvasRecordingOptions } from './liveCanvasRecorder'

class RecordingTrack extends EventTarget {
  stop = vi.fn()
}

class RecordingRecorder extends EventTarget {
  static instances: RecordingRecorder[] = []
  static attempts: string[] = []
  static unsupported = new Set<string>()
  static constructorFailures = new Set<string>()
  static startFailures = new Set<string>()
  static actualMime: string | undefined
  static isTypeSupported(mime: string) {
    return !RecordingRecorder.unsupported.has(mime)
  }

  state: RecordingState = 'inactive'
  mimeType: string
  options: MediaRecorderOptions
  start = vi.fn((_timeslice: number) => {
    if (RecordingRecorder.startFailures.has(this.options.mimeType ?? '')) {
      throw new Error('No encoder available')
    }
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
  })

  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    super()
    const mime = options.mimeType ?? ''
    RecordingRecorder.attempts.push(mime)
    if (RecordingRecorder.constructorFailures.has(mime)) {
      throw new Error('No encoder available')
    }
    this.options = options
    this.mimeType = RecordingRecorder.actualMime ?? (mime || 'video/webm')
    RecordingRecorder.instances.push(this)
  }

  data(blob: Blob) {
    const event = new Event('dataavailable')
    Object.defineProperty(event, 'data', { value: blob })
    this.dispatchEvent(event)
  }

  finish() {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  }
}

const MP4 = 'video/mp4;codecs=avc1'
let canvas: HTMLCanvasElement
let track: RecordingTrack
let capture: ReturnType<typeof vi.fn>
let callbacks: {
  [K in keyof Required<LiveCanvasRecordingOptions>]: ReturnType<
    typeof vi.fn<Required<LiveCanvasRecordingOptions>[K]>
  >
}
let recordings: ReturnType<typeof startLiveCanvasRecording>[]

function start() {
  const recording = startLiveCanvasRecording(canvas, callbacks)
  recordings.push(recording)
  return recording
}

function currentRecorder() {
  return RecordingRecorder.instances.at(-1)!
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'performance',
    ],
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  RecordingRecorder.instances = []
  RecordingRecorder.attempts = []
  RecordingRecorder.unsupported = new Set()
  RecordingRecorder.constructorFailures = new Set()
  RecordingRecorder.startFailures = new Set()
  RecordingRecorder.actualMime = undefined
  vi.stubGlobal('MediaRecorder', RecordingRecorder)
  track = new RecordingTrack()
  capture = vi.fn(() => ({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  }))
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: capture,
  })
  canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  document.body.append(canvas)
  callbacks = {
    onComplete: vi.fn(),
    onError: vi.fn(),
    onElapsed: vi.fn(),
    onStopping: vi.fn(),
  }
  recordings = []
})

afterEach(() => {
  recordings.forEach((recording) => {
    recording.dispose()
  })
  canvas.remove()
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>)
    .captureStream
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('live canvas recording', () => {
  it('detects missing browser APIs before trying to capture', () => {
    expect(supportsLiveCanvasRecording()).toBe(true)
    vi.stubGlobal('MediaRecorder', undefined)
    expect(supportsLiveCanvasRecording()).toBe(false)
    expect(start).toThrow('This browser does not support canvas recording.')
    expect(capture).not.toHaveBeenCalled()
  })

  it('records the canvas at 30 fps and waits for the final chunk before completing', async () => {
    const recording = start()
    const recorder = currentRecorder()
    expect(capture).toHaveBeenCalledWith(30)
    expect(recorder.options).toEqual({
      mimeType: MP4,
      videoBitsPerSecond: 8_000_000,
    })
    expect(recorder.start).toHaveBeenCalledWith(1000)
    recorder.data(new Blob(['first'], { type: MP4 }))
    vi.advanceTimersByTime(1250)
    recording.stop()
    recording.stop()
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    expect(callbacks.onStopping).toHaveBeenCalledTimes(1)
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    recorder.data(new Blob(['last'], { type: MP4 }))
    recorder.data(new Blob())
    recorder.finish()
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1)
    const result = callbacks.onComplete.mock.calls[0]![0]
    expect(await result.blob.text()).toBe('firstlast')
    expect(result).toMatchObject({ extension: 'mp4', durationSeconds: 1.25 })
    expect(result.blob.type).toBe(MP4.toLowerCase())
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back after supported MP4 construction and start both fail', () => {
    RecordingRecorder.constructorFailures.add(MP4)
    RecordingRecorder.startFailures.add('video/mp4')
    start()
    const recorder = currentRecorder()
    expect(RecordingRecorder.attempts).toEqual([
      MP4,
      'video/mp4',
      'video/webm;codecs=vp9',
    ])
    recorder.data(new Blob(['video']))
    recorder.finish()
    expect(callbacks.onComplete.mock.calls[0]![0].extension).toBe('webm')
    // Failed candidates cannot complete or fail the active recording later.
    RecordingRecorder.instances[0]!.dispatchEvent(new Event('error'))
    RecordingRecorder.instances[0]!.finish()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1)
  })

  it('uses the browser actual MIME type rather than relabeling a WebM as MP4', () => {
    RecordingRecorder.actualMime = 'video/webm;codecs=vp8'
    start()
    currentRecorder().data(new Blob(['video']))
    currentRecorder().finish()
    expect(callbacks.onComplete.mock.calls[0]![0]).toMatchObject({
      extension: 'webm',
    })
    expect(callbacks.onComplete.mock.calls[0]![0].blob.type).toBe(
      'video/webm;codecs=vp8',
    )
  })

  it('allows browser-default encoding when no explicit codec is supported', () => {
    RecordingRecorder.unsupported = new Set([
      MP4,
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ])
    RecordingRecorder.actualMime = 'video/mp4'
    start()
    expect(RecordingRecorder.attempts).toEqual([''])
    expect(currentRecorder().options).toEqual({ videoBitsPerSecond: 8_000_000 })
    currentRecorder().data(new Blob(['video']))
    currentRecorder().finish()
    expect(callbacks.onComplete.mock.calls[0]![0].extension).toBe('mp4')
  })

  it('cleans every track when all encoders reject starting', () => {
    RecordingRecorder.startFailures = new Set([
      MP4,
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      '',
    ])
    expect(start).toThrow('The browser could not start a video recording.')
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    RecordingRecorder.instances.forEach((recorder) => {
      recorder.data(new Blob(['late']))
      recorder.finish()
      recorder.dispatchEvent(new Event('error'))
    })
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onComplete).not.toHaveBeenCalled()
  })

  it('reports an encoder error once and ignores late stop/data events', () => {
    start()
    const recorder = currentRecorder()
    recorder.dispatchEvent(new Event('error'))
    recorder.dispatchEvent(new Event('error'))
    recorder.data(new Blob(['late']))
    recorder.finish()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError.mock.calls[0]![0].message).toContain(
      'could not encode',
    )
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])(
    'discards safely on disposal with stop already requested: %s',
    (stopped) => {
      const recording = start()
      const recorder = currentRecorder()
      recorder.data(new Blob(['video']))
      if (stopped) recording.stop()
      recording.dispose()
      recording.dispose()
      const elapsedCalls = callbacks.onElapsed.mock.calls.length
      recorder.data(new Blob(['late']))
      recorder.finish()
      recorder.dispatchEvent(new Event('error'))
      track.dispatchEvent(new Event('ended'))
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(15_000)
      expect(callbacks.onComplete).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
      expect(callbacks.onElapsed).toHaveBeenCalledTimes(elapsedCalls)
      expect(track.stop).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('reports an empty clip instead of offering a broken download', () => {
    const recording = start()
    recording.stop()
    currentRecorder().data(new Blob())
    currentRecorder().finish()
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(callbacks.onError.mock.calls[0]![0].message).toContain(
      'No video frames',
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it.each(['resize', 'disconnect', 'hidden'] as const)(
    'finishes an interrupted clip after %s',
    (change) => {
      start()
      const recorder = currentRecorder()
      recorder.data(new Blob(['video']))
      if (change === 'resize') canvas.width = 720
      if (change === 'disconnect') canvas.remove()
      if (change === 'hidden') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
        document.dispatchEvent(new Event('visibilitychange'))
      }
      vi.advanceTimersByTime(250)
      expect(recorder.stop).toHaveBeenCalledTimes(1)
      expect(callbacks.onComplete).not.toHaveBeenCalled()
      recorder.finish()
      expect(callbacks.onComplete.mock.calls[0]![0].reason).toBe(
        {
          resize: 'Recording stopped because the canvas size changed.',
          disconnect: 'Recording stopped because the canvas was closed.',
          hidden: 'Recording stopped when you left this tab.',
        }[change],
      )
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('stops at two minutes while retaining the final flush', async () => {
    start()
    const recorder = currentRecorder()
    recorder.data(new Blob(['video']))
    vi.advanceTimersByTime(LIVE_CANVAS_RECORDING_MAX_SECONDS * 1000 - 1)
    expect(recorder.stop).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    recorder.data(new Blob(['tail']))
    recorder.finish()
    const result = callbacks.onComplete.mock.calls[0]![0]
    expect(result.durationSeconds).toBe(120)
    expect(result.reason).toBe('Recording stopped at the 2-minute limit.')
    expect(await result.blob.text()).toBe('videotail')
  })

  it('stops at the memory threshold without discarding the crossing chunk', async () => {
    start()
    const recorder = currentRecorder()
    const largeChunk = new Blob(['large encoded chunk'])
    // Exercise byte accounting without allocating 128 MiB in the test runner.
    Object.defineProperty(largeChunk, 'size', { value: 128 * 1024 * 1024 })
    recorder.data(largeChunk)
    expect(recorder.stop).toHaveBeenCalledTimes(1)
    recorder.data(new Blob(['tail']))
    recorder.finish()
    const result = callbacks.onComplete.mock.calls[0]![0]
    expect(result.reason).toContain('128 MB file-size limit')
    expect(await result.blob.text()).toBe('large encoded chunktail')
  })

  it('bounds waiting for a broken browser that never emits stop', () => {
    const recording = start()
    recording.stop()
    vi.advanceTimersByTime(10_000)
    expect(callbacks.onError.mock.calls[0]![0].message).toContain(
      'could not finish',
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
    currentRecorder().data(new Blob(['late']))
    currentRecorder().finish()
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

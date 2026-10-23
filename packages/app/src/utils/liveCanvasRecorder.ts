/** Own a short, real-time canvas recording without readbacks or a screen-share prompt. */
export const LIVE_CANVAS_RECORDING_MAX_SECONDS = 120
const MAX_RECORDING_BYTES = 128 * 1024 * 1024
const FINISH_TIMEOUT_MS = 10_000
export type LiveCanvasRecordingQuality = 'standard' | 'high'

export type LiveCanvasCaptureSettings = {
  width: number
  height: number
  requestedFrameRate: 30 | 60
  requestedBitsPerSecond: number
}

/** Budget detail per captured pixel; these are encoder requests, not guarantees. */
export function getLiveCanvasCaptureSettings(
  width: number,
  height: number,
  quality: LiveCanvasRecordingQuality = 'high',
): LiveCanvasCaptureSettings {
  const high = quality === 'high'
  const requestedFrameRate = high ? 60 : 30
  const bitsPerPixel = high ? 0.24 : 0.2
  const requestedBitsPerSecond = Math.min(
    high ? 60_000_000 : 30_000_000,
    Math.max(
      high ? 12_000_000 : 8_000_000,
      Math.round(
        (width * height * requestedFrameRate * bitsPerPixel) / 100_000,
      ) * 100_000,
    ),
  )
  return { width, height, requestedFrameRate, requestedBitsPerSecond }
}
const MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  '',
] as const

export type LiveCanvasRecordingResult = {
  blob: Blob
  extension: 'mp4' | 'webm'
  durationSeconds: number
  capture: LiveCanvasCaptureSettings
  /** Browser-reported encoder setting, not a measured file average. */
  encoderBitsPerSecond?: number
  reason?: string
}

export type LiveCanvasRecordingOptions = {
  quality?: LiveCanvasRecordingQuality
  onComplete: (result: LiveCanvasRecordingResult) => void
  onError: (error: Error) => void
  onElapsed: (seconds: number) => void
  onStopping?: () => void
}

export function supportsLiveCanvasRecording(): boolean {
  return (
    typeof globalThis.MediaRecorder === 'function' &&
    typeof globalThis.HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

export function startLiveCanvasRecording(
  canvas: HTMLCanvasElement,
  options: LiveCanvasRecordingOptions,
): {
  capture: LiveCanvasCaptureSettings
  stop: (reason?: string) => void
  dispose: () => void
} {
  if (!supportsLiveCanvasRecording()) {
    throw new Error('This browser does not support canvas recording.')
  }
  if (!canvas.isConnected || canvas.width < 1 || canvas.height < 1) {
    throw new Error('Wait for the canvas to load, then try recording again.')
  }
  if (document.hidden) {
    throw new Error('Keep this tab visible while recording.')
  }

  const width = canvas.width
  const height = canvas.height
  const capture = getLiveCanvasCaptureSettings(width, height, options.quality)
  const stream = canvas.captureStream(capture.requestedFrameRate)
  const tracks = stream.getTracks()
  if (!stream.getVideoTracks().length) {
    tracks.forEach((track) => {
      track.stop()
    })
    throw new Error('The canvas did not provide a video stream.')
  }

  let recorder: MediaRecorder | undefined
  let selectedMime = ''
  let chunks: Blob[] = []
  let bytes = 0
  let startedAt = 0
  let durationSeconds = 0
  let reason: string | undefined
  let stopping = false
  let settled = false
  let disposed = false
  let interval: ReturnType<typeof setInterval> | undefined
  let finishTimeout: ReturnType<typeof setTimeout> | undefined

  function detach(candidate: MediaRecorder) {
    candidate.removeEventListener('dataavailable', onData)
    candidate.removeEventListener('stop', onStop)
    candidate.removeEventListener('error', onRecorderError)
  }

  function cleanup() {
    clearInterval(interval)
    interval = undefined
    clearTimeout(finishTimeout)
    document.removeEventListener('visibilitychange', onVisibility)
    tracks.forEach((track) => {
      track.removeEventListener('ended', onTrackEnded)
    })
    if (recorder) {
      detach(recorder)
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // A device or encoder failure can invalidate the recorder first.
        }
      }
    }
    tracks.forEach((track) => {
      track.stop()
    })
    chunks = []
  }

  function fail(message: string) {
    if (settled || disposed) return
    settled = true
    cleanup()
    options.onError(new Error(message))
  }

  function stop(stopReason?: string) {
    if (stopping || settled || disposed) return
    stopping = true
    reason = stopReason
    durationSeconds = (globalThis.performance.now() - startedAt) / 1000
    clearInterval(interval)
    interval = undefined
    options.onStopping?.()
    if (settled || disposed) return
    finishTimeout = setTimeout(() => {
      fail('The browser could not finish the recording. Try a shorter clip.')
    }, FINISH_TIMEOUT_MS)
    try {
      // An inactive recorder may still have its final data and stop queued.
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    } catch {
      fail('The browser could not finish the recording. Please try again.')
    }
  }

  function onData(event: BlobEvent) {
    if (settled || disposed || event.target !== recorder) return
    if (event.data.size > 0) {
      chunks.push(event.data)
      bytes += event.data.size
      // Keep the crossing chunk and final flush: truncating encoded data can
      // make the whole clip unplayable. The limit is a stop threshold, since a
      // browser may delay delivery and supply a larger-than-timeslice chunk.
      if (bytes >= MAX_RECORDING_BYTES) {
        stop('Recording stopped at the 128 MB file-size limit.')
      }
    }
  }

  function onStop(event: Event) {
    if (settled || disposed || event.target !== recorder) return
    if (!bytes) {
      fail('No video frames were recorded. Let the scene render and try again.')
      return
    }
    const mimeType = recorder?.mimeType || chunks[0]?.type || selectedMime
    const container = mimeType.toLowerCase().split(';')[0]?.trim()
    const extension =
      container === 'video/mp4'
        ? 'mp4'
        : container === 'video/webm'
          ? 'webm'
          : undefined
    if (!extension) {
      fail(
        'The browser returned an unsupported video format. Try another browser.',
      )
      return
    }
    if (!stopping)
      durationSeconds = (globalThis.performance.now() - startedAt) / 1000
    const result: LiveCanvasRecordingResult = {
      blob: new Blob(chunks, { type: mimeType }),
      extension,
      durationSeconds,
      capture,
      encoderBitsPerSecond:
        recorder &&
        Number.isFinite(recorder.videoBitsPerSecond) &&
        recorder.videoBitsPerSecond > 0
          ? recorder.videoBitsPerSecond
          : undefined,
      reason,
    }
    settled = true
    cleanup()
    options.onComplete(result)
  }

  function onRecorderError(event: Event) {
    if (event.target !== recorder) return
    fail('The browser could not encode this recording. Please try again.')
  }

  function onTrackEnded() {
    stop('Recording stopped because the canvas video stream ended.')
  }

  function onVisibility() {
    if (document.hidden) stop('Recording stopped when you left this tab.')
  }

  tracks.forEach((track) => {
    track.addEventListener('ended', onTrackEnded)
  })
  document.addEventListener('visibilitychange', onVisibility)
  for (const mimeType of MIME_TYPES) {
    try {
      if (mimeType && !MediaRecorder.isTypeSupported(mimeType)) continue
      const candidate = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: capture.requestedBitsPerSecond,
      })
      recorder = candidate
      selectedMime = mimeType
      candidate.addEventListener('dataavailable', onData)
      candidate.addEventListener('stop', onStop)
      candidate.addEventListener('error', onRecorderError)
      try {
        candidate.start(1000)
        break
      } catch {
        detach(candidate)
        recorder = undefined
        if (candidate.state !== 'inactive') candidate.stop()
      }
    } catch {
      // Support probing is advisory; construction and starting can still fail.
    }
  }
  if (!recorder) {
    settled = true
    cleanup()
    throw new Error(
      'The browser could not start a video recording. Try another browser.',
    )
  }
  startedAt = globalThis.performance.now()
  options.onElapsed(0)
  interval = setInterval(() => {
    if (document.hidden) {
      onVisibility()
    } else if (!canvas.isConnected) {
      stop('Recording stopped because the canvas was closed.')
    } else if (canvas.width !== width || canvas.height !== height) {
      stop('Recording stopped because the canvas size changed.')
    } else {
      const elapsed = (globalThis.performance.now() - startedAt) / 1000
      options.onElapsed(elapsed)
      if (elapsed >= LIVE_CANVAS_RECORDING_MAX_SECONDS) {
        stop('Recording stopped at the 2-minute limit.')
      }
    }
  }, 250)

  return {
    capture,
    stop,
    dispose: () => {
      if (disposed || settled) return
      disposed = true
      cleanup()
    },
  }
}

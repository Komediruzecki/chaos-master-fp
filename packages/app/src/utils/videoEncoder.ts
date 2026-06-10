import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

export type VideoEncoderConfig = {
  codec: 'avc' | 'hevc' | 'vp9'
  width: number
  height: number
  fps: number
  bitrate?: number
}

export type EncodeResult = {
  blob: Blob
  mimeType: string
  usedFallback: boolean
}

type AvcProfile = 'high' | 'main' | 'baseline'

// Preference order: High enables CABAC/B-frames/8x8 transforms (best quality
// per bit — fractal frames are noise-like and need it), Main is the middle
// ground, Constrained Baseline is the lowest common denominator.
const AVC_PROFILE_ORDER: AvcProfile[] = ['high', 'main', 'baseline']

const AVC_PROFILE_PREFIX: Record<AvcProfile, string> = {
  high: '6400',
  main: '4D40',
  baseline: '42E0',
}

function getAvcCodecString(
  width: number,
  height: number,
  profile: AvcProfile = 'high',
): string {
  // Macroblock-aligned coded area determines the required AVC level.
  // Each macroblock is 16x16, so coded dimensions are ceil(w/16)*16.
  const codedWidth = Math.ceil(width / 16) * 16
  const codedHeight = Math.ceil(height / 16) * 16
  const codedArea = codedWidth * codedHeight

  // AVC levels and their MaxFS (max frame size in macroblocks = pixels/256):
  //   3.1:  3,600 MBs =   921,600 px
  //   4.0:  8,192 MBs = 2,097,152 px
  //   4.2:  8,704 MBs = 2,228,224 px
  //   5.0: 22,080 MBs = 5,652,480 px
  //   5.1: 36,864 MBs = 9,437,184 px
  let level = '33' // Level 5.1 (max 9,437,184 px)
  if (codedArea <= 921600)
    level = '1f' // Level 3.1
  else if (codedArea <= 2097152)
    level = '28' // Level 4.0
  else if (codedArea <= 2228224)
    level = '2A' // Level 4.2
  else if (codedArea <= 5652480) level = '32' // Level 5.0
  return `avc1.${AVC_PROFILE_PREFIX[profile]}${level}`
}

function getCodecString(
  codec: VideoEncoderConfig['codec'],
  width: number,
  height: number,
  avcProfile: AvcProfile = 'high',
): string {
  if (codec === 'avc') return getAvcCodecString(width, height, avcProfile)
  if (codec === 'hevc') return 'hvc1.1.6.L93.B0'
  return 'vp09.00.10.08'
}

/** Offline-export default bitrate: ~0.12 bits per pixel per frame, clamped to
 *  a sane range. A flat 8 Mbps default starves high-resolution exports. */
function getDefaultBitrate(width: number, height: number, fps: number): number {
  return Math.min(
    Math.max(8_000_000, Math.round(width * height * fps * 0.12)),
    60_000_000,
  )
}

let webCodecsSupported: boolean | undefined

function isWebCodecsSupported(): boolean {
  if (webCodecsSupported !== undefined) return webCodecsSupported
  webCodecsSupported =
    typeof globalThis.VideoEncoder !== 'undefined' &&
    typeof globalThis.VideoFrame !== 'undefined'
  return webCodecsSupported
}

function createWebCodecsPipeline(
  config: VideoEncoderConfig,
  codecString: string,
): {
  encode: (frame: VideoFrame, frameIndex: number) => Promise<void>
  finalize: () => Promise<EncodeResult>
  cancel: () => void
} {
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: config.codec, width: config.width, height: config.height },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  let encoder: VideoEncoder | undefined
  let cancelled = false
  let configured = false
  let framesEncoded = 0

  const bitrate =
    config.bitrate ?? getDefaultBitrate(config.width, config.height, config.fps)
  // Keyframe every ~2 seconds of output video.
  const keyFrameInterval = Math.max(1, Math.round(config.fps * 2))

  const initEncoder = () => {
    if (configured) return
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (cancelled) return
        muxer.addVideoChunk(chunk, meta)
      },
      error: (e) => {
        console.error('VideoEncoder error:', e)
        cancelled = true
        try {
          encoder?.close()
        } catch {
          /* already closed */
        }
      },
    })
    encoder.configure({
      codec: codecString,
      width: config.width,
      height: config.height,
      bitrate,
      framerate: config.fps,
      // No latencyMode here on purpose: the default ('quality') is right for
      // offline export — 'realtime' trades quality for latency we don't need.
      ...(codecString.startsWith('avc1')
        ? { avc: { format: 'avc' as const } }
        : {}),
    })
    configured = true
  }

  // Bound the encoder queue so fast frame production (low-quality exports can
  // finish a frame in a few ticks) cannot balloon memory with queued frames.
  const MAX_ENCODE_QUEUE = 4

  const waitForQueueDrain = async () => {
    while (
      !cancelled &&
      encoder !== undefined &&
      encoder.encodeQueueSize > MAX_ENCODE_QUEUE
    ) {
      await new Promise<void>((resolve) => {
        // Poll fallback in case 'dequeue' is not supported by the browser.
        const timer = setTimeout(resolve, 50)
        encoder?.addEventListener(
          'dequeue',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
    }
  }

  const encode = async (frame: VideoFrame, frameIndex: number) => {
    if (cancelled) return
    initEncoder()
    await waitForQueueDrain()
    if (cancelled) return
    const keyFrame = frameIndex === 0 || frameIndex % keyFrameInterval === 0
    try {
      encoder!.encode(frame, { keyFrame })
      framesEncoded++
    } catch (e) {
      console.error('VideoEncoder encode error:', e)
      cancelled = true
      try {
        encoder?.close()
      } catch {
        /* already closed */
      }
    }
  }

  const finalize = async (): Promise<EncodeResult> => {
    if (cancelled && framesEncoded === 0) {
      throw new Error('VideoEncoder failed before encoding any frames')
    }
    try {
      if (!cancelled && encoder) {
        await encoder.flush()
      }
      muxer.finalize()
      return {
        blob: new Blob([target.buffer], { type: 'video/mp4' }),
        mimeType: 'video/mp4',
        usedFallback: false,
      }
    } finally {
      if (!cancelled && encoder) {
        encoder.close()
      }
    }
  }

  const cancel = () => {
    cancelled = true
    try {
      encoder?.close()
    } catch {
      /* already closed */
    }
  }

  return { encode, finalize, cancel }
}

function createMediaRecorderFallback(
  width: number,
  height: number,
  fps: number,
): {
  encode: (bitmap: ImageBitmap) => void
  finalize: () => Promise<EncodeResult>
  cancel: () => void
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  let selectedMimeType = ''
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) {
      selectedMimeType = mt
      break
    }
  }

  const stream = canvas.captureStream(fps)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: selectedMimeType || undefined,
  })

  let cancelled = false

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const finalizePromise = new Promise<EncodeResult>((resolve) => {
    recorder.onstop = () => {
      const mimeType = selectedMimeType || 'video/webm'
      resolve({
        blob: new Blob(chunks, { type: mimeType }),
        mimeType,
        usedFallback: true,
      })
    }
  })

  recorder.start()

  const encode = (bitmap: ImageBitmap) => {
    if (cancelled) return
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
  }

  const finalize = async (): Promise<EncodeResult> => {
    if (cancelled)
      return { blob: new Blob(), mimeType: 'video/webm', usedFallback: true }
    if (recorder.state === 'recording') {
      recorder.stop()
    }
    return finalizePromise
  }

  const cancel = () => {
    cancelled = true
    if (recorder.state === 'recording') recorder.stop()
  }

  return { encode, finalize, cancel }
}

export async function createVideoEncoder(config: VideoEncoderConfig): Promise<{
  encodeFrame: (bitmap: ImageBitmap, frameIndex: number) => Promise<void>
  finalize: () => Promise<EncodeResult>
  cancel: () => void
  usedFallback: boolean
  codec: VideoEncoderConfig['codec']
}> {
  if (isWebCodecsSupported()) {
    const bitrate =
      config.bitrate ??
      getDefaultBitrate(config.width, config.height, config.fps)

    const probe = async (codecString: string): Promise<boolean> => {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: codecString,
          width: config.width,
          height: config.height,
          bitrate,
          framerate: config.fps,
          ...(codecString.startsWith('avc1')
            ? { avc: { format: 'avc' as const } }
            : {}),
        })
        return support.supported ?? false
      } catch {
        return false
      }
    }

    // Candidate list: the requested codec first (for avc trying High → Main →
    // Baseline profiles in turn), then the remaining codecs. First candidate
    // the encoder reports as supported wins.
    const codecOrder: VideoEncoderConfig['codec'][] = [
      config.codec,
      ...(['avc', 'vp9', 'hevc'] as const).filter((c) => c !== config.codec),
    ]
    const candidates: {
      codec: VideoEncoderConfig['codec']
      codecString: string
    }[] = []
    for (const codec of codecOrder) {
      if (codec === 'avc') {
        for (const profile of AVC_PROFILE_ORDER) {
          candidates.push({
            codec,
            codecString: getAvcCodecString(
              config.width,
              config.height,
              profile,
            ),
          })
        }
      } else {
        candidates.push({
          codec,
          codecString: getCodecString(codec, config.width, config.height),
        })
      }
    }

    let selected = candidates[0]!
    let probeSucceeded = false
    for (const candidate of candidates) {
      if (await probe(candidate.codecString)) {
        selected = candidate
        probeSucceeded = true
        break
      }
    }
    if (!probeSucceeded) {
      // No probed config reported support — keep the preferred candidate and
      // let the WebCodecs pipeline fail naturally with a useful error.
      console.warn(
        `[videoEncoder] no codec config reported support, trying ${selected.codecString} anyway`,
      )
    } else if (selected.codec !== config.codec) {
      console.warn(
        `[videoEncoder] ${config.codec} not supported, falling back to ${selected.codec} (${selected.codecString})`,
      )
    }

    const pipeline = createWebCodecsPipeline(
      { ...config, codec: selected.codec, bitrate },
      selected.codecString,
    )

    return {
      usedFallback: false,
      codec: selected.codec,
      encodeFrame: async (bitmap, frameIndex) => {
        const duration = Math.round(1e6 / config.fps)
        const timestamp = Math.round((frameIndex * 1e6) / config.fps)
        const frame = new VideoFrame(bitmap, { timestamp, duration })
        try {
          // Applies encoder backpressure: resolves once the encode queue has
          // room, keeping memory bounded when frames are produced quickly.
          await pipeline.encode(frame, frameIndex)
        } finally {
          frame.close()
          bitmap.close()
        }
      },
      finalize: pipeline.finalize,
      cancel: pipeline.cancel,
    }
  }

  const fallback = createMediaRecorderFallback(
    config.width,
    config.height,
    config.fps,
  )

  return {
    usedFallback: true,
    codec: config.codec,
    encodeFrame: (bitmap, _frameIndex) => {
      fallback.encode(bitmap)
      return Promise.resolve()
    },
    finalize: fallback.finalize,
    cancel: fallback.cancel,
  }
}

export function detectCodec(): {
  codec: VideoEncoderConfig['codec']
  method: 'webcodecs' | 'mediaRecorder'
} {
  return {
    codec: 'avc',
    method: isWebCodecsSupported() ? 'webcodecs' : 'mediaRecorder',
  }
}

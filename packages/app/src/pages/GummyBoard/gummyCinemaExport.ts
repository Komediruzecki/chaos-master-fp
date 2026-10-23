/** Render a complete cinema take on a fixed frame grid, independent of preview speed. */
import { createVideoEncoder } from '@/utils/videoEncoder'
import type { GummyCinemaController } from '@/components/GummyBoard/GummyCinemaScene'

export type GummyCinemaExportSettings = {
  resolution: 720 | 1080 | 2160
  fps: 30 | 60
  portrait: boolean
}

export function gummyCinemaExportPlan(settings: GummyCinemaExportSettings) {
  if (
    ![720, 1080, 2160].includes(settings.resolution) ||
    ![30, 60].includes(settings.fps)
  )
    throw new RangeError('Choose a supported video size and frame rate.')
  const short = settings.resolution
  const long = (short * 16) / 9
  const width = settings.portrait ? short : long
  const height = settings.portrait ? long : short
  return {
    width,
    height,
    fps: settings.fps,
    bitrate: Math.min(
      100_000_000,
      Math.max(12_000_000, Math.round(width * height * settings.fps * 0.28)),
    ),
  }
}

export function supportsGummyCinemaExport() {
  return (
    typeof globalThis.VideoEncoder === 'function' &&
    typeof globalThis.VideoFrame === 'function' &&
    typeof globalThis.createImageBitmap === 'function'
  )
}

type ExportController = Pick<
  GummyCinemaController,
  | 'info'
  | 'pause'
  | 'resetPaused'
  | 'seekFrame'
  | 'setCaptureSize'
  | 'captureFrame'
>

function readyExportSource(scene: ExportController) {
  const info = scene.info()
  if (!info.ready || info.error)
    throw new Error(info.error ?? 'Wait for the shot to finish loading.')
  if (
    !Number.isFinite(info.displayDuration) ||
    info.displayDuration <= 0 ||
    info.displayDuration > 30
  )
    throw new RangeError(
      'A video export must be between zero and thirty seconds.',
    )
  return info
}

export async function exportGummyCinema(options: {
  controller: ExportController
  settings: GummyCinemaExportSettings
  signal: AbortSignal
  onProgress: (frames: number, total: number) => void
}) {
  if (!supportsGummyCinemaExport())
    throw new Error(
      'Frame-by-frame export is unavailable in this browser. Use Record, or open the studio in a browser with WebCodecs.',
    )
  const plan = gummyCinemaExportPlan(options.settings)
  const scene = options.controller
  const previous = readyExportSource(scene)
  const duration = previous.displayDuration
  const frames = Math.round(duration * plan.fps)
  const assertActive = () => {
    if (options.signal.aborted)
      throw new DOMException('Video export cancelled.', 'AbortError')
  }
  assertActive()
  const encoder = await createVideoEncoder({ codec: 'avc', ...plan })
  if (encoder.usedFallback || encoder.codec !== 'avc') {
    encoder.cancel()
    throw new Error(
      'This video size cannot be exported as MP4 here. Try 720p or 30 fps, or use Record.',
    )
  }
  options.signal.addEventListener('abort', encoder.cancel, { once: true })
  let resized = false
  let failure: Error | undefined
  let output:
    | (Awaited<ReturnType<typeof encoder.finalize>> &
        typeof plan & { frames: number; durationSeconds: number })
    | undefined
  try {
    assertActive()
    scene.pause()
    resized = true
    await scene.setCaptureSize(plan)
    assertActive()
    await scene.resetPaused()
    options.onProgress(0, frames)
    for (let frame = 0; frame < frames; frame++) {
      assertActive()
      const bitmap = await scene.captureFrame(frame, plan.fps)
      if (options.signal.aborted) {
        bitmap.close()
        assertActive()
      }
      if (bitmap.width !== plan.width || bitmap.height !== plan.height) {
        bitmap.close()
        throw new Error(
          'The render size changed during export. Please try again.',
        )
      }
      // encodeFrame owns and closes the snapshot, including on encoder failure.
      await encoder.encodeFrame(bitmap, frame)
      assertActive()
      options.onProgress(frame + 1, frames)
      if (frame % 8 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    const result = await encoder.finalize()
    assertActive()
    if (!result.blob.size)
      throw new Error('The browser produced an empty video.')
    output = { ...result, ...plan, frames, durationSeconds: frames / plan.fps }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  } finally {
    options.signal.removeEventListener('abort', encoder.cancel)
    encoder.cancel()
    if (resized) {
      try {
        await scene.setCaptureSize(undefined)
        await scene.seekFrame(Math.round(previous.displayTime * 60), 60)
      } catch (error) {
        // Navigation/device loss can dispose the scene during cancellation.
        // Do not replace the original failure with a restoration failure.
        failure ??= error instanceof Error ? error : new Error(String(error))
      }
    }
  }
  if (failure) throw failure
  return output!
}
